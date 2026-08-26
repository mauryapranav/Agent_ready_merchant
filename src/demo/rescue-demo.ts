import { runSession } from "../negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../buyer/parser.js";
import { cartFor, buyerContextFor } from "./fixtures.js";
import { DEFAULT_POLICY } from "../types/policy.js";
import { formatINR } from "../core/money.js";

const now = new Date("2026-08-24T10:00:00Z");

export async function printRescueStory(): Promise<void> {
  const intent = "Get me running shoes under ₹4000";
  const skus = [{ sku: "nike-peg-41", qty: 1 }];
  const parsed = parseIntentDeterministic(intent);
  const mandate = buildMandate(
    "u_demo",
    intent,
    parsed,
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );

  const result = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: buyerContextFor(skus),
    now,
  });

  console.log("=== SETTLE RESCUE STORY ===");
  console.log(`Intent     : "${intent}"`);
  console.log(`Cap        : ${formatINR(mandate.hardCapPaise)}   Cart: ${formatINR(result.finalTotalPaise ?? 0)}\n`);

  const max = Math.max(result.buyerLedger.all().length, result.merchantLedger.all().length);
  console.log("BUYER SIDE".padEnd(58), "| MERCHANT SIDE");
  console.log("-".repeat(110));
  for (let i = 0; i < max; i++) {
    const b = result.buyerLedger.all()[i];
    const m = result.merchantLedger.all()[i];
    const bLine = b ? `${b.kind.padEnd(18)} ${summarize(b.event)}` : "";
    const mLine = m ? `${m.kind.padEnd(16)} ${summarize(m.event)}` : "";
    console.log(bLine.padEnd(56), "|", mLine);
  }
  console.log("-".repeat(110));
  console.log(`Outcome: ${result.outcome} via ${result.paidVia ?? "-"}   Audit chains verified: buyer=${result.buyerLedger.verify()} merchant=${result.merchantLedger.verify()}`);
}

function summarize(event: unknown): string {
  if (event === null || typeof event !== "object") return String(event);
  const e = event as Record<string, unknown>;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(e)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    parts.push(`${k}=${String(v).slice(0, 40)}`);
  }
  return parts.join(" ").slice(0, 60);
}

printRescueStory().catch(e => { console.error(e); process.exit(1); });
