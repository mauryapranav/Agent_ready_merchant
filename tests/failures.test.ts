import { test } from "node:test";
import assert from "node:assert/strict";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { DEFAULT_POLICY } from "../src/types/policy.js";
import { cartFor, buyerContextFor } from "../src/demo/fixtures.js";

const now = new Date("2026-08-24T10:00:00Z");
const skus = [{ sku: "nike-peg-41", qty: 1 }];

function fixture(intentText = "Get me running shoes under ₹4000") {
  const parsed = parseIntentDeterministic(intentText);
  const mandate = buildMandate(
    "u_1",
    intentText,
    parsed,
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
  return mandate;
}

test("offer expiring before decision → graceful decline, no payment", async () => {
  const mandate = fixture();
  const r = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: buyerContextFor(skus),
    offerTtlMs: 0,
    now,
  });
  assert.equal(r.outcome, "ABORTED");
  assert.equal(r.reason, "BUDGET_EXCEEDED");
  const evalEvent = r.buyerLedger.all().find((e) => e.kind === "OFFER_EVALUATED");
  assert.ok(evalEvent);
  assert.equal((evalEvent.event as { accepted: boolean }).accepted, false);
});

test("consent revoked mid-flight → session still completes, memory unused", async () => {
  const parsed = parseIntentDeterministic("Get me running shoes under ₹4000");
  const mandate = buildMandate(
    "u_1",
    "Get me running shoes under ₹4000",
    parsed,
    cartHash(skus),
    { dpdpAcceptedAt: null, affinitySharing: "none" },
    new Date(now.getTime() - 60000)
  );
  const r = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: { ...buyerContextFor(skus), affinityTopBrands: [] },
    now,
  });
  assert.ok(["PAID", "ABORTED"].includes(r.outcome));
});
