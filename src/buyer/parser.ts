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
const KNOWN_CATEGORIES = [...new Set(Object.values(CATEGORY_WORDS))];
const MAX_INTENT_RUPEES = 100_000;

export type ParserSource = "llm" | "deterministic";

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

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function brandsToCriteria(v: unknown): SoftCriterion[] {
  if (!Array.isArray(v)) return [];
  const out: SoftCriterion[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const hit = BRANDS.find((b) => b.toLowerCase() === x.toLowerCase());
    if (hit && !out.some((c) => c.kind === "brand" && c.value === hit)) {
      out.push({ kind: "brand", value: hit });
    }
  }
  return out;
}

function categoriesToCriteria(v: unknown): SoftCriterion[] {
  if (!Array.isArray(v)) return [];
  const out: SoftCriterion[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const hit = KNOWN_CATEGORIES.find((c) => c === x.toLowerCase());
    if (hit && !out.some((c) => c.kind === "category" && c.value === hit)) {
      out.push({ kind: "category", value: hit });
    }
  }
  return out;
}

export function parsedIntentFromLlm(j: unknown): ParsedIntent {
  if (typeof j !== "object" || j === null || Array.isArray(j)) {
    throw new ParseError("LLM intent payload is not an object.");
  }
  const o = j as Record<string, unknown>;

  const cap = numOrNull(o.cap);
  if (cap === null || cap < 1 || cap > MAX_INTENT_RUPEES) {
    throw new ParseError("LLM cap failed validation.");
  }
  const stretchRaw = numOrNull(o.max_stretch);
  if (stretchRaw !== null && (stretchRaw < 0 || stretchRaw > MAX_INTENT_RUPEES)) {
    throw new ParseError("LLM stretch failed validation.");
  }

  const softCriteria = [...brandsToCriteria(o.brands), ...categoriesToCriteria(o.categories)];
  const attachmentCriteria = [...brandsToCriteria(o.extras_brands), ...categoriesToCriteria(o.extras_categories)];

  let allowedRails = Array.isArray(o.rails)
    ? o.rails.filter((r): r is Rail => typeof r === "string" && RAIL_WORDS.includes(r as Rail))
    : [];
  if (allowedRails.length === 0) {
    allowedRails = ["upi", "card"];
  }

  const n = softCriteria.length;
  return {
    capPaise: rupees(cap),
    maxStretchPaise: stretchRaw === null ? null : rupees(stretchRaw),
    softCriteria,
    requireSoftMatches: Math.min(n, stretchRaw !== null ? Math.max(1, n - 1) : n),
    allowedRails,
    attachmentCriteria,
  };
}

async function requestLlmIntentJson(
  text: string,
  opts: { baseUrl?: string; apiKey?: string; model?: string } = {}
): Promise<unknown> {
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
  return JSON.parse(raw) as unknown;
}

export async function parseWithLLM(
  text: string,
  opts: { baseUrl?: string; apiKey?: string; model?: string } = {}
): Promise<ParsedIntent> {
  return parsedIntentFromLlm(await requestLlmIntentJson(text, opts));
}

export function llmParserConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY);
}

export async function parseIntentWithFallback(
  text: string,
  opts: { baseUrl?: string; apiKey?: string; model?: string } = {}
): Promise<{ parsed: ParsedIntent; parsedBy: ParserSource }> {
  if (opts.apiKey !== undefined || llmParserConfigured()) {
    try {
      return { parsed: await parseWithLLM(text, opts), parsedBy: "llm" };
    } catch {
      return { parsed: parseIntentDeterministic(text), parsedBy: "deterministic" };
    }
  }
  return { parsed: parseIntentDeterministic(text), parsedBy: "deterministic" };
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
