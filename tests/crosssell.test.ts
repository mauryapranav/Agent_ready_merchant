import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCrossSell } from "../src/merchant/crosssell.js";
import { evaluateCrossSell } from "../src/buyer/crosssell-decision.js";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { DEFAULT_POLICY } from "../src/types/policy.js";
import { cartFor, buyerContextFor } from "../src/demo/fixtures.js";
import { rupees } from "../src/core/money.js";

const now = new Date("2026-08-24T10:00:00Z");
const shoeCart = [{ sku: "nike-peg-41", qty: 1 }];

test("suggester picks adjacent-category items within headroom, prefers affinity brand", () => {
  const withAffinity = suggestCrossSell(shoeCart, rupees(1400), ["Nike"]);
  assert.ok(withAffinity);
  assert.equal(withAffinity.brand, "Nike");
  assert.ok(["apparel", "accessories"].includes(withAffinity.category));
  assert.equal(withAffinity.sku, "nike-dri-tee");

  const withoutAffinity = suggestCrossSell(shoeCart, rupees(1400), []);
  assert.ok(withoutAffinity);
});

test("suggester respects headroom strictly", () => {
  const tiny = suggestCrossSell(shoeCart, rupees(400), []);
  if (tiny) {
    assert.ok(tiny.pricePaise <= rupees(400));
  }
});

function mandateFor(intentText: string): ReturnType<typeof buildMandate> {
  return buildMandate(
    "u_x",
    intentText,
    parseIntentDeterministic(intentText),
    cartHash(shoeCart),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
}

test("cross-sell accepted on affinity basis", () => {
  const mandate = mandateFor("Get me running shoes under ₹5000");
  const d = evaluateCrossSell(mandate, shoeCart, ["Jockey"]);
  assert.equal(d.accepted, true);
  assert.equal(d.basis, "affinity");
});

test("cross-sell declined when outside stated preferences", () => {
  const mandate = mandateFor("Get me running shoes under ₹5000");
  const d = evaluateCrossSell(mandate, shoeCart, []);
  assert.equal(d.offered, true);
  assert.equal(d.accepted, false);
  assert.match(d.declineReason ?? "", /extras rule/i);
});

test("accepts via extras rule even with no flex rule present", () => {
  const mandate = mandateFor("Get me running shoes under ₹5000. Extras only from Jockey.");
  const d = evaluateCrossSell(mandate, shoeCart, []);
  assert.equal(d.accepted, true);
  assert.equal(d.basis, "declared_criteria");
  assert.equal(d.suggestion?.brand, "Jockey");
});

test("suggester pre-filters by declared criteria — nike rule offers the tee, never socks", () => {
  const s = suggestCrossSell(shoeCart, rupees(2101), [], [{ kind: "brand", value: "Nike" }]);
  assert.ok(s);
  assert.equal(s.sku, "nike-dri-tee");
  assert.match(s.reason, /extras rule/i);
});

test("suggester returns null when criteria match nothing in adjacent categories", () => {
  const s = suggestCrossSell(shoeCart, rupees(2101), [], [{ kind: "brand", value: "Puma" }]);
  assert.equal(s, null);
});

test("screenshot case: ₹6000 cap, adidas cart, 'extra stuff only if from Nike' → tee attached", async () => {
  const intent = "Get me running shoes under ₹6000 and spend extra stuff only if they're from Nike";
  const cart = [{ sku: "adidas-ultra-4d", qty: 1 }];
  const mandate = buildMandate(
    "u_2",
    intent,
    parseIntentDeterministic(intent),
    cartHash(cart),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
  assert.deepEqual(mandate.attachmentCriteria, [{ kind: "brand", value: "Nike" }]);
  const r = await runSession({
    mandate,
    cart: cartFor(cart),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: { cartBrands: ["Adidas"], cartCategories: ["shoes"], affinityTopBrands: [] },
    now,
  });
  assert.equal(r.outcome, "DIRECT_PAID");
  assert.equal(r.finalTotalPaise, rupees(3899 + 1295));
  const accepted = r.buyerLedger.all().find((e) => e.kind === "CROSS_SELL_ACCEPTED");
  assert.ok(accepted);
  assert.equal((accepted.event as { basis: string }).basis, "declared_criteria");
});

test("session grows cart within cap when attachment accepted", async () => {
  const parsed = parseIntentDeterministic("Get me running shoes under ₹5000");
  const mandate = buildMandate(
    "u_1",
    "Get me running shoes under ₹5000",
    parsed,
    cartHash(shoeCart),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
  const r = await runSession({
    mandate,
    cart: cartFor(shoeCart),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: { ...buyerContextFor(shoeCart), affinityTopBrands: ["Jockey"] },
    now,
  });
  assert.equal(r.outcome, "DIRECT_PAID");
  assert.ok(r.finalTotalPaise! > rupees(4180));
  const kinds = r.buyerLedger.all().map((e) => e.kind);
  assert.ok(kinds.includes("CROSS_SELL_ACCEPTED"));
  assert.ok(kinds.includes("CART_RECONSENTED"));
  assert.ok(r.finalTotalPaise! <= rupees(5000));
});

test("no affinity and no criteria → suggestion offered but declined, base price paid", async () => {
  const mandate = mandateFor("Get me running shoes under ₹5000");
  const r = await runSession({
    mandate,
    cart: cartFor(shoeCart),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: { cartBrands: ["Nike"], cartCategories: ["shoes"], affinityTopBrands: [] },
    now,
  });
  assert.equal(r.outcome, "DIRECT_PAID");
  assert.equal(r.finalTotalPaise, rupees(4180));
  assert.ok(r.buyerLedger.all().some((e) => e.kind === "CROSS_SELL_DECLINED"));
});
