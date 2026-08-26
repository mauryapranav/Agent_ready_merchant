import type { Mandate, Rail, SoftCriterion } from "../types/mandate.js";
import { sha256 } from "../core/hash.js";
import { rupees } from "../core/money.js";

export class ParseError extends Error {}

const BRANDS = ["Nike", "Adidas", "Puma", "Jockey", "Noise"];
const CATEGORY_WORDS: Record<string, string> = {
  shoes: "shoes",
  shoe: "shoes",
  runners: "shoes",
  sneakers: "shoes",
  tee: "apparel",
  shirt: "apparel",
  tshirt: "apparel",
  socks: "accessories",
  accessories: "accessories",
  band: "electronics",
  watch: "electronics",
  electronics: "electronics",
};
const RAIL_WORDS: Rail[] = ["upi", "card", "netbanking", "wallet"];

export interface ParsedIntent {
  capPaise: number;
  maxStretchPaise: number | null;
  softCriteria: SoftCriterion[];
  requireSoftMatches: number;
  allowedRails: Rail[];
  attachmentCriteria: SoftCriterion[];
}

export function parseIntentDeterministic(text: string): ParsedIntent {
  const normalized = text.toLowerCase();

  const capMatch = /(?:under|below|budget(?:\s+of)?|max(?:imum)?(?:\s+of)?)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k)?/i.exec(normalized);
  if (!capMatch) {
    throw new ParseError("Could not find a budget. Try: 'under ₹4000'.");
  }
  const capValue = parseFloat(capMatch[1]!.replace(/,/g, "")) * (capMatch[2] ? 1000 : 1);
  const capPaise = rupees(capValue);

  const stretchMatch = /stretch(?:\s+(?:by|to|up\s+to))?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i.exec(normalized);
  const maxStretchPaise = stretchMatch ? rupees(parseFloat(stretchMatch[1]!.replace(/,/g, ""))) : null;

  const ifClauseMatch = /\bif\b[^.]*/i.exec(text);
  const conditionText = (ifClauseMatch?.[0] ?? text).toLowerCase();

  const softCriteria: SoftCriterion[] = [];
  for (const brand of BRANDS) {
    if (conditionText.includes(brand.toLowerCase())) {
      softCriteria.push({ kind: "brand", value: brand });
    }
  }
  for (const [word, category] of Object.entries(CATEGORY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(conditionText)) {
      if (!softCriteria.some((c) => c.kind === "category" && c.value === category)) {
        softCriteria.push({ kind: "category", value: category });
      }
    }
  }

  const extrasMatch =
    /(?:extras|extra\s+(?:stuff|items|things|ones))\s+(?:only\s+)?(?:if\s+they\s*(?:'re|are)\s+(?:(?:from|by)\s+)?|(?:from|by)\s+)([^.!?]*)/i.exec(text);
  const extrasClause = (extrasMatch?.[1] ?? "").toLowerCase();
  const attachmentCriteria: SoftCriterion[] = [];
  for (const brand of BRANDS) {
    if (extrasClause.includes(brand.toLowerCase())) {
      attachmentCriteria.push({ kind: "brand", value: brand });
    }
  }
  for (const [word, category] of Object.entries(CATEGORY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(extrasClause) && !attachmentCriteria.some((c) => c.kind === "category" && c.value === category)) {
      attachmentCriteria.push({ kind: "category", value: category });
    }
  }

  const allowedRails = RAIL_WORDS.filter((r) => new RegExp(`\\b${r}\\b`).test(normalized));
  if (allowedRails.length === 0) {
    allowedRails.push("upi", "card");
  }

  return {
    capPaise,
    maxStretchPaise,
    softCriteria,
    requireSoftMatches: Math.min(softCriteria.length, stretchMatch ? Math.max(1, softCriteria.length - 1) : softCriteria.length),
    allowedRails,
    attachmentCriteria,
  };
}

export async function parseWithLLM(text: string, opts: { baseUrl?: string; apiKey?: string; model?: string } = {}): Promise<ParsedIntent> {
  const baseUrl = opts.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) {
    throw new ParseError("No LLM credentials configured.");
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            'Extract shopping intent as strict JSON: {"cap": number (rupees), "max_stretch": number|null (rupees), "brands": string[], "categories": string[], "rails": string[], "extras_brands": string[], "extras_categories": string[]}. Categories: shoes|apparel|accessories|electronics. Rails: upi|card|netbanking|wallet. extras_* capture allowed cross-sell attachments only, from clauses like "extras only from Jockey" or "extra stuff only if they\'re from Nike" — never from the main item request.',
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new ParseError(`LLM parse failed: ${res.status}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    throw new ParseError("LLM returned empty response.");
  }
  const j = JSON.parse(raw) as { cap: number; max_stretch: number | null; brands?: string[]; categories?: string[]; rails?: string[]; extras_brands?: string[]; extras_categories?: string[] };
  return {
    capPaise: rupees(j.cap),
    maxStretchPaise: j.max_stretch === null ? null : rupees(j.max_stretch),
    softCriteria: [
      ...(j.brands ?? []).map((b) => ({ kind: "brand" as const, value: normalizeBrand(b) })),
      ...(j.categories ?? []).map((c) => ({ kind: "category" as const, value: c.toLowerCase() })),
    ],
    requireSoftMatches: 2,
    allowedRails: (j.rails ?? []).filter((r): r is Rail => RAIL_WORDS.includes(r as Rail)),
    attachmentCriteria: [
      ...(j.extras_brands ?? []).map((b) => ({ kind: "brand" as const, value: normalizeBrand(b) })),
      ...(j.extras_categories ?? []).map((c) => ({ kind: "category" as const, value: c.toLowerCase() })),
    ],
  };
}

function normalizeBrand(b: string): string {
  const hit = BRANDS.find((x) => x.toLowerCase() === b.toLowerCase());
  return hit ?? b;
}

let mandateSeq = 0;

export function buildMandate(
  userId: string,
  intentText: string,
  parsed: ParsedIntent,
  cartHashAtConsent: string,
  consent: Mandate["consent"],
  now: Date
): Mandate {
  mandateSeq += 1;
  return {
    mandateId: `mdt_${Date.now().toString(36)}_${mandateSeq}`,
    userId,
    intentText,
    hardCapPaise: parsed.capPaise,
    flexRule:
      parsed.maxStretchPaise !== null && parsed.softCriteria.length > 0
        ? {
            maxStretchPaise: parsed.maxStretchPaise,
            requireSoftMatches: Math.max(1, parsed.requireSoftMatches),
            softCriteria: parsed.softCriteria,
          }
        : null,
    maxHuntMs: 30000,
    allowedRails: parsed.allowedRails,
    attachmentCriteria: parsed.attachmentCriteria,
    consent,
    cartHashAtConsent,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
  };
}

export function cartHash(items: Array<{ sku: string; qty: number }>): string {
  return sha256({ items });
}
