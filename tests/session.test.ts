import { test } from "node:test";
import assert from "node:assert/strict";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { productBySku } from "../src/merchant/data.js";
import { DEFAULT_POLICY, type ReleaseLedgerEntry } from "../src/types/policy.js";
import { rupees } from "../src/core/money.js";
import { sha256 } from "../src/core/hash.js";

const now = new Date("2026-08-24T10:00:00Z");

interface Fixture {
  mandate: ReturnType<typeof buildMandate>;
  releaseLedger: ReleaseLedgerEntry[];
}

function fixture(intentText: string, skus: Array<{ sku: string; qty: number }>): Fixture {
  const parsed = parseIntentDeterministic(intentText);
  const mandate = buildMandate(
    "u_1",
    intentText,
    parsed,
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
  return { mandate, releaseLedger: [] };
}

function cartFor(skus: Array<{ sku: string; qty: number }>) {
  const totalPaise = skus.reduce((sum, i) => sum + productBySku(i.sku)!.pricePaise * i.qty, 0);
  return { sessionId: `s_${Math.random().toString(36).slice(2, 8)}`, items: skus, totalPaise, hash: sha256({ items: skus }) };
}

const buyerContext = { cartBrands: ["Nike"], cartCategories: ["shoes"], affinityTopBrands: [] };

test("happy rescue path: over-cap nike shoes saved by campaign offer", async () => {
  const f = fixture("Get me running shoes under ₹4000", [{ sku: "nike-peg-41", qty: 1 }]);
  const r = await runSession({ ...f, cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]), policy: DEFAULT_POLICY, buyerContext, now });
  assert.equal(r.outcome, "PAID");
  assert.ok(r.finalTotalPaise! < rupees(4180));
  assert.equal(r.paidVia, "upi");
});

test("within cap pays directly without negotiation", async () => {
  const f = fixture("Get me socks under ₹600", [{ sku: "jockey-socks-3pk", qty: 1 }]);
  const r = await runSession({ ...f, cart: cartFor([{ sku: "jockey-socks-3pk", qty: 1 }]), policy: DEFAULT_POLICY, buyerContext, now });
  assert.equal(r.outcome, "DIRECT_PAID");
  assert.equal(r.finalTotalPaise, rupees(459));
});

test("cart drift aborts before any payment", async () => {
  const f = fixture("Get me running shoes under ₹4000", [{ sku: "nike-peg-41", qty: 1 }]);
  const c = cartFor([{ sku: "nike-peg-41", qty: 1 }]);
  const drifted = { ...c, hash: sha256({ items: [{ sku: "nike-peg-41", qty: 2 }] }) };
  const r = await runSession({ ...f, cart: drifted, policy: DEFAULT_POLICY, buyerContext, now });
  assert.equal(r.outcome, "ABORTED");
  assert.equal(r.reason, "CART_DRIFT");
});

test("no profitable offer → graceful abort with both ledgers intact", async () => {
  const f = fixture("Get me socks under ₹400", [{ sku: "jockey-socks-3pk", qty: 1 }]);
  const policy = { ...DEFAULT_POLICY, floorMarginPct: 90, waterfall: [{ step: "price_cut" as const, enabled: true }] };
  const r = await runSession({ ...f, cart: cartFor([{ sku: "jockey-socks-3pk", qty: 1 }]), policy, buyerContext, now });
  assert.equal(r.outcome, "ABORTED");
  assert.equal(r.reason, "NO_FITTING_OPTION");
  assert.ok(r.merchantLedger.all().some((e) => e.kind === "NO_OFFER"));
});

test("flex conditions unmet → pauses for human instead of deciding", async () => {
  const f = fixture("Get me running shoes under ₹4000, can stretch by 300 if it's really Puma", [{ sku: "nike-peg-41", qty: 1 }]);
  const policy = { ...DEFAULT_POLICY, waterfall: [{ step: "price_cut" as const, enabled: true }], dailyReleaseBudgetPaise: rupees(220) };
  const releaseLedger: ReleaseLedgerEntry[] = [
    { releasedAt: now.toISOString(), userIdHash: sha256({ user: "other" }), step: "price_cut", discountPaise: rupees(100) },
  ];
  const ctx = { cartBrands: ["Nike"], cartCategories: [], affinityTopBrands: [] };
  const r = await runSession({ ...f, releaseLedger, cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]), policy, buyerContext: ctx, now });
  assert.equal(r.outcome, "PAUSED_FOR_HUMAN");
});

test("both audit chains verify after a paid session", async () => {
  const f = fixture("Get me running shoes under ₹4000", [{ sku: "nike-peg-41", qty: 1 }]);
  const r = await runSession({ ...f, cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]), policy: DEFAULT_POLICY, buyerContext, now });
  assert.equal(r.buyerLedger.verify(), true);
  assert.equal(r.merchantLedger.verify(), true);
});

test("payment declined on all rails → bounded graceful abort", async () => {
  const f = fixture("Get me running shoes under ₹5000", [{ sku: "nike-peg-41", qty: 1 }]);
  const r = await runSession({ ...f, cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]), policy: DEFAULT_POLICY, buyerContext, failRails: ["upi", "card"], now });
  assert.equal(r.outcome, "ABORTED");
  assert.equal(r.reason, "PAYMENT_DECLINED");
  const attempts = f.mandate ? undefined : undefined;
  void attempts;
});

test("merchant pays from own pocket via price cut (floor margin respected)", async () => {
  // Cart over cap, no campaigns/rail offers available, but price cut passes floor margin
  const f = fixture("Get me running shoes under ₹4000", [{ sku: "nike-peg-41", qty: 1 }]);
  const policy = { ...DEFAULT_POLICY, waterfall: [{ step: "price_cut" as const, enabled: true }], floorMarginPct: 12 };
  const r = await runSession({ ...f, cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]), policy, buyerContext, now });
  assert.equal(r.outcome, "PAID");
  assert.ok(r.finalTotalPaise && r.finalTotalPaise <= f.mandate.hardCapPaise);
  assert.ok(r.merchantLedger.all().some((e) => e.kind === "DISCOUNT_LEDGERED"));
  const discountEvent = r.merchantLedger.all().find((e) => e.kind === "DISCOUNT_LEDGERED");
  assert.ok(discountEvent && (discountEvent.event as any).cost > 0, "merchant should have spent own money");
});
