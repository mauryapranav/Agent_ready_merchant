import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateBuyerGate, evaluateBuyerGateWithContext, countSoftMatches } from "../src/core/buyer-gate.js";
import type { Mandate } from "../src/types/mandate.js";
import { sha256 } from "../src/core/hash.js";

function makeMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    mandateId: "m_1",
    userId: "u_1",
    intentText: "running shoes under 4000",
    hardCapPaise: 400000,
    attachmentCriteria: [],
    flexRule: null,
    maxHuntMs: 30000,
    allowedRails: ["upi", "card"],
    consent: { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    cartHashAtConsent: sha256({ cart: "v1" }),
    issuedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    ...overrides,
  };
}

const now = new Date();

test("under cap passes without flex", () => {
  const r = evaluateBuyerGate({ mandate: makeMandate(), proposedTotalPaise: 399000, now });
  assert.equal(r.allowed, true);
  assert.equal(r.trace.verdict, "PASS_CAP");
});

test("over cap with no flex rule rejects", () => {
  const r = evaluateBuyerGate({ mandate: makeMandate(), proposedTotalPaise: 420000, now });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_NO_FLEX_RULE");
});

test("stretch beyond maxStretch rejects even with matches", () => {
  const m = makeMandate({
    flexRule: { maxStretchPaise: 20000, requireSoftMatches: 2, softCriteria: [{ kind: "brand", value: "Nike" }] },
  });
  const r = evaluateBuyerGateWithContext({
    mandate: m,
    proposedTotalPaise: 430000,
    now,
    matchedCriteria: ["brand:Nike"],
  });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_OVER_STRETCH");
});

test("within stretch but insufficient matches rejects", () => {
  const m = makeMandate({
    flexRule: { maxStretchPaise: 32000, requireSoftMatches: 2, softCriteria: [{ kind: "brand", value: "Nike" }, { kind: "category", value: "shoes" }] },
  });
  const r = evaluateBuyerGateWithContext({ mandate: m, proposedTotalPaise: 425000, now, matchedCriteria: ["brand:Nike"] });
  assert.equal(r.allowed, false);
  assert.equal(r.trace.verdict, "REJECT_INSUFFICIENT_MATCHES");
});

test("within stretch with enough matches passes via flex", () => {
  const m = makeMandate({
    flexRule: { maxStretchPaise: 32000, requireSoftMatches: 2, softCriteria: [{ kind: "brand", value: "Nike" }, { kind: "category", value: "shoes" }] },
  });
  const r = evaluateBuyerGateWithContext({
    mandate: m,
    proposedTotalPaise: 425000,
    now,
    matchedCriteria: ["brand:Nike", "category:shoes"],
  });
  assert.equal(r.allowed, true);
  assert.equal(r.trace.verdict, "PASS_FLEX");
  assert.equal(r.trace.stretchUsedPaise, 25000);
});

test("expired mandate never passes", () => {
  const m = makeMandate({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  const r = evaluateBuyerGate({ mandate: m, proposedTotalPaise: 100000, now });
  assert.equal(r.allowed, false);
});

test("countSoftMatches counts only provided context", () => {
  const m = makeMandate({
    flexRule: { maxStretchPaise: 1, requireSoftMatches: 1, softCriteria: [{ kind: "brand", value: "Nike" }, { kind: "rail", value: "upi" }] },
  });
  assert.equal(countSoftMatches(m, [{ kind: "brand", value: "Nike" }]), 1);
  assert.equal(countSoftMatches(m, []), 0);
});
