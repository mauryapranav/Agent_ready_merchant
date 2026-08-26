import type { AuditEntry } from "../audit/ledger.js";

export interface ReceiptResult {
  text: string;
  generated: "llm" | "template";
}

export function templateReceipt(buyerEvents: AuditEntry[], merchantEvents: AuditEntry[]): string {
  const settlement = buyerEvents.find((e) => e.kind === "SETTLEMENT_RESULT");
  const offer = merchantEvents.find((e) => e.kind === "OFFER_RELEASED");
  const cross = merchantEvents.find((e) => e.kind === "CROSS_SELL_ACCEPTED");
  const parts: string[] = [];
  parts.push(offer ? `A counter-offer was released through the ${(offer.event as { waterfallAttempts?: Array<{ step?: string }> }).waterfallAttempts?.[0]?.step ?? "waterfall"} step.` : "No discount was released.");
  if (cross) parts.push(`An attachment (${(cross.event as { sku?: string }).sku}) was accepted within the buyer's cap.`);
  const outcome = (settlement?.event as { outcome?: string })?.outcome ?? "UNKNOWN";
  parts.push(`Final outcome: ${outcome}. Both audit chains are sealed and verifiable; no LLM influenced any spend decision.`);
  return parts.join(" ");
}

export async function llmReceipt(
  buyerEvents: AuditEntry[],
  merchantEvents: AuditEntry[],
  opts: { baseUrl?: string; apiKey?: string; model?: string } = {}
): Promise<string | null> {
  const baseUrl = opts.baseUrl ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = opts.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = opts.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) {
    return null;
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Summarise this settled checkout for a merchant auditor in <=80 words, plain language. Cover: why the sale was blocked, what relief was offered and who funded it, buyer acceptance rationale, final outcome. Never speculate beyond the events.",
          },
          {
            role: "user",
            content: JSON.stringify({ buyer: buyerEvents, merchant: merchantEvents }),
          },
        ],
      }),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export async function buildReceipt(buyerEvents: AuditEntry[], merchantEvents: AuditEntry[], apiKey?: string | undefined): Promise<ReceiptResult> {
  const resolvedKey = apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  if (resolvedKey) {
    const text = await llmReceipt(buyerEvents, merchantEvents, { apiKey: resolvedKey });
    if (text) {
      return { text, generated: "llm" };
    }
  }
  return { text: templateReceipt(buyerEvents, merchantEvents), generated: "template" };
}
