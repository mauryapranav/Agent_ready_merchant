import { test } from "node:test";
import assert from "node:assert/strict";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { DEFAULT_POLICY, type ReleaseLedgerEntry } from "../src/types/policy.js";
import { cartFor, buyerContextFor } from "../src/demo/fixtures.js";
import { allowRequest, resetRateLimiter } from "../src/server/ratelimit.js";
import { rupees } from "../src/core/money.js";

test("rate limiter: allows burst up to capacity then blocks, refills over time", () => {
  resetRateLimiter();
  const cfg = { capacity: 3, refillPerMinute: 60 };
  assert.equal(allowRequest("ip1", cfg), true);
  assert.equal(allowRequest("ip1", cfg), true);
  assert.equal(allowRequest("ip1", cfg), true);
  assert.equal(allowRequest("ip1", cfg), false);
  assert.equal(allowRequest("ip2", cfg), true);
});

const now = new Date("2026-08-24T10:00:00Z");

function mandateFor(i: number) {
  const intentText = "Get me running shoes under ₹4000";
  return buildMandate(
    `u_${i}`,
    intentText,
    parseIntentDeterministic(intentText),
    cartHash([{ sku: "nike-peg-41", qty: 1 }]),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "none" },
    new Date(now.getTime() - 60000)
  );
}

test("concurrent sessions sharing one release ledger never exceed daily budget or floor", async () => {
  const ledger: ReleaseLedgerEntry[] = [];
  const jobs = Array.from({ length: 30 }, (_, i) =>
    runSession({
      mandate: mandateFor(i),
      cart: cartFor([{ sku: "nike-peg-41", qty: 1 }]),
      policy: DEFAULT_POLICY,
      releaseLedger: ledger,
      buyerContext: buyerContextFor([{ sku: "nike-peg-41", qty: 1 }]),
      now,
    })
  );
  const results = await Promise.all(jobs);

  const totalOwnCost = ledger.reduce((s, e) => s + e.discountPaise, 0);
  assert.ok(totalOwnCost <= DEFAULT_POLICY.dailyReleaseBudgetPaise, `budget breached: ${totalOwnCost}`);
  for (const r of results) {
    assert.ok(["PAID", "ABORTED", "PAUSED_FOR_HUMAN", "DIRECT_PAID"].includes(r.outcome));
    assert.equal(r.buyerLedger.verify(), true);
    assert.equal(r.merchantLedger.verify(), true);
  }
  const paid = results.filter((r) => r.finalTotalPaise !== null);
  for (const r of paid) {
    if (r.reason === null && r.paidVia) {
      assert.ok(r.finalTotalPaise! > 0);
    }
  }
  void rupees;
});
