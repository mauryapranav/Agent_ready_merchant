import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMerchantGate } from "../src/core/merchant-gate.js";
import { DEFAULT_POLICY, type ReleaseLedgerEntry } from "../src/types/policy.js";
import { sha256 } from "../src/core/hash.js";

const now = new Date("2026-08-24T10:00:00Z");
const userHash = sha256({ user: "u_1" });

function ledger(entries: Partial<ReleaseLedgerEntry>[]): ReleaseLedgerEntry[] {
  return entries.map((e) => ({
    releasedAt: now.toISOString(),
    userIdHash: userHash,
    step: "price_cut" as const,
    discountPaise: 0,
    ...e,
  }));
}

const base = {
  policy: DEFAULT_POLICY,
  step: "price_cut" as const,
  revenuePaise: 425000,
  costPaise: 300000,
  discountPaise: 25000,
  ledger: [] as ReleaseLedgerEntry[],
  userIdHash: userHash,
  now,
};

test("healthy margin passes", () => {
  const r = evaluateMerchantGate(base);
  assert.equal(r.allowed, true);
  assert.equal(r.trace.verdict, "PASS");
});

test("discount below floor margin rejects", () => {
  const r = evaluateMerchantGate({
    ...base,
    costPaise: 390000,
    discountPaise: 40000,
  });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_FLOOR");
});

test("daily release cap blocks further releases", () => {
  const full = ledger(
    Array.from({ length: DEFAULT_POLICY.maxReleasesPerDay }, () => ({ discountPaise: 100 }))
  );
  const r = evaluateMerchantGate({ ...base, ledger: full });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_BUDGET");
});

test("daily budget exhausted blocks release", () => {
  const spent = ledger([{ discountPaise: DEFAULT_POLICY.dailyReleaseBudgetPaise, userIdHash: sha256({ user: "other" }) }]);
  const r = evaluateMerchantGate({ ...base, ledger: spent });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_BUDGET");
});

test("cooldown blocks rapid repeat release to same user", () => {
  const recent = ledger([{ releasedAt: new Date(now.getTime() - 5 * 60000).toISOString() }]);
  const r = evaluateMerchantGate({ ...base, ledger: recent });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_COOLDOWN");
});

test("cooldown does not affect other users", () => {
  const recentOtherUser = ledger([{ releasedAt: new Date(now.getTime() - 1 * 60000).toISOString(), userIdHash: sha256({ user: "u_2" }) }]);
  const r = evaluateMerchantGate({ ...base, ledger: recentOtherUser });
  assert.equal(r.allowed, true);
});
