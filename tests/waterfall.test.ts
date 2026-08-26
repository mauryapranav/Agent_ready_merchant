import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCounterOffer } from "../src/merchant/engine.js";
import { CATALOG, productBySku } from "../src/merchant/data.js";
import { DEFAULT_POLICY, type ReleaseLedgerEntry } from "../src/types/policy.js";
import type { CartState } from "../src/types/messages.js";
import { rupees } from "../src/core/money.js";
import { sha256 } from "../src/core/hash.js";

const now = new Date("2026-08-24T10:00:00Z");
const userHash = sha256({ user: "u_1" });

function cart(items: Array<{ sku: string; qty: number }>): CartState {
  const totalPaise = items.reduce((sum, i) => sum + (productBySku(i.sku)!.pricePaise * i.qty), 0);
  return { sessionId: "s_1", items, totalPaise, hash: sha256({ items }) };
}

const base = {
  policy: DEFAULT_POLICY,
  ledger: [] as ReleaseLedgerEntry[],
  userIdHash: userHash,
  buyerAllowedRails: ["upi", "card"],
  now,
};

test("gap covered by brand campaign → zero merchant cost", () => {
  const c = cart([{ sku: "nike-peg-41", qty: 1 }]);
  const gap = rupees(280);
  const out = buildCounterOffer({ ...base, cart: c, requiredDiscountPaise: gap });
  assert.ok(out.offer);
  assert.equal(out.offer.mechanism.step, "funded_campaign");
  assert.equal(out.offer.merchantCostPaise, 0);
  assert.equal(out.offer.newTotalPaise, c.totalPaise - rupees(300));
});

test("no fitting campaign falls to rail offer when rail allowed", () => {
  const policy = { ...DEFAULT_POLICY, waterfall: DEFAULT_POLICY.waterfall.filter((w) => w.step === "rail_offer" || w.step === "price_cut") };
  const c = cart([{ sku: "noise-band-pulse", qty: 1 }]);
  const out = buildCounterOffer({ ...base, policy, cart: c, requiredDiscountPaise: rupees(100) });
  assert.ok(out.offer);
  assert.equal(out.offer.mechanism.step, "rail_offer");
  assert.equal(out.offer.fundedBy, "network");
  if (out.offer.mechanism.step === "rail_offer") {
    assert.equal(out.offer.mechanism.railOfferRail, "card");
  }
});

test("rail offer skipped when buyer disallows that rail", () => {
  const policy = { ...DEFAULT_POLICY, waterfall: DEFAULT_POLICY.waterfall.filter((w) => w.step !== "funded_campaign" && w.step !== "bundle_swap") };
  const c = cart([{ sku: "noise-band-pulse", qty: 1 }]);
  const out = buildCounterOffer({ ...base, policy, cart: c, requiredDiscountPaise: rupees(400), buyerAllowedRails: ["netbanking"] });
  assert.ok(out.offer);
  assert.equal(out.offer.mechanism.step, "price_cut");
  assert.equal(out.offer.merchantCostPaise, rupees(400));
});

test("swap candidate triggers for nike shoes", () => {
  const policy = { ...DEFAULT_POLICY, waterfall: [{ step: "bundle_swap" as const, enabled: true }, { step: "price_cut" as const, enabled: true }] };
  const c = cart([{ sku: "nike-peg-41", qty: 1 }]);
  const out = buildCounterOffer({ ...base, policy, cart: c, requiredDiscountPaise: rupees(250) });
  assert.ok(out.offer);
  assert.equal(out.offer.mechanism.step, "bundle_swap");
  if (out.offer.mechanism.step === "bundle_swap") {
    assert.equal(out.offer.mechanism.swapToSku, "adidas-ultra-4d");
  }
});

test("full cut below floor → partial-rescue cut offered instead", () => {
  const policy = { ...DEFAULT_POLICY, floorMarginPct: 30, waterfall: [{ step: "price_cut" as const, enabled: true }] };
  const c = cart([{ sku: "jockey-socks-3pk", qty: 1 }]);
  const out = buildCounterOffer({ ...base, policy, cart: c, requiredDiscountPaise: rupees(210) });
  assert.ok(out.offer);
  assert.equal(out.offer.mechanism.step, "price_cut");
  assert.match(out.offer.explanation, /Partial rescue/);
  assert.ok(out.attempts[0]?.gate.trace.verdict === "REJECT_FLOOR");
});

test("even partial cut below floor → graceful null", () => {
  const policy = { ...DEFAULT_POLICY, floorMarginPct: 90, waterfall: [{ step: "price_cut" as const, enabled: true }] };
  const c = cart([{ sku: "jockey-socks-3pk", qty: 1 }]);
  const out = buildCounterOffer({ ...base, policy, cart: c, requiredDiscountPaise: rupees(210) });
  assert.equal(out.offer, null);
});

test("waterfall order prefers cheapest merchant cost first", () => {
  const c = cart([{ sku: "nike-peg-41", qty: 2 }]);
  const out = buildCounterOffer({ ...base, cart: c, requiredDiscountPaise: rupees(300) });
  assert.ok(out.offer);
  assert.equal(out.attempts[0]?.step, "funded_campaign");
});

test("catalog is internally consistent (cost < price)", () => {
  for (const p of CATALOG) {
    assert.ok(p.costPaise < p.pricePaise, `${p.sku} has cost >= price`);
  }
});

test("campaign budget is finite: exhausts across sessions and falls through", () => {
  const campaigns = [
    { campaignId: "c1", label: "tiny", flatOffPaise: rupees(300), minCartPaise: rupees(3000), fundedBy: "brand" as const, remainingBudgetPaise: rupees(300), validTo: "2027-01-01T00:00:00Z" },
  ];
  const c = cart([{ sku: "nike-peg-41", qty: 1 }]);
  const first = buildCounterOffer({ ...base, cart: c, requiredDiscountPaise: rupees(280), campaigns });
  assert.ok(first.offer);
  assert.equal(first.offer.mechanism.step, "funded_campaign");
  const second = buildCounterOffer({ ...base, cart: c, requiredDiscountPaise: rupees(280), campaigns });
  assert.ok(second.offer);
  assert.equal(second.offer.mechanism.step, "bundle_swap");
});
