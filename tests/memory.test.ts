import { test } from "node:test";
import assert from "node:assert/strict";
import { recordEvent, brandScores, ownTopBrands, shareWithMerchant, pseudonymize } from "../src/buyer/memory.js";
import type { Consent } from "../src/types/mandate.js";

const now = new Date("2026-08-24T10:00:00Z");
const consent: Consent = { dpdpAcceptedAt: "2026-08-01T00:00:00Z", affinitySharing: "anonymized_topk" };

test("purchase outweighs views and recent beats old", () => {
  const mem = [
    ...Array.from({ length: 3 }, (_, i) => ({ type: "view" as const, brand: "Puma", at: new Date(now.getTime() - 86400000).toISOString() })),
    { type: "purchase" as const, brand: "Adidas", at: new Date(now.getTime() - 2 * 86400000).toISOString() },
  ];
  const scores = brandScores(mem, consent, now);
  assert.ok(scores.get("Adidas")! > scores.get("Puma")!);
});

test("decay pulls old events below threshold", () => {
  const mem = [{ type: "view" as const, brand: "Nike", at: new Date(now.getTime() - 60 * 86400000).toISOString() }];
  assert.deepEqual(ownTopBrands(mem, consent, now), []);
});

test("no dpdp consent → memory is invisible everywhere", () => {
  const mem = [{ type: "purchase" as const, brand: "Nike", at: now.toISOString() }];
  const noConsent: Consent = { dpdpAcceptedAt: null, affinitySharing: "anonymized_topk" };
  assert.equal(ownTopBrands(mem, noConsent, now).length, 0);
  assert.equal(shareWithMerchant(mem, noConsent, now), null);
});

test("sharing off → merchant gets null even with consent to remember", () => {
  const mem = [{ type: "purchase" as const, brand: "Nike", at: now.toISOString() }];
  const noShare: Consent = { dpdpAcceptedAt: "2026-08-01T00:00:00Z", affinitySharing: "none" };
  assert.deepEqual(ownTopBrands(mem, noShare, now), ["Nike"]);
  assert.equal(shareWithMerchant(mem, noShare, now), null);
});

test("recordEvent does not mutate original array", () => {
  const mem: never[] = [];
  const next = recordEvent(mem, { type: "view", brand: "Nike", at: now.toISOString() });
  assert.equal(mem.length, 0);
  assert.equal(next.length, 1);
});

test("pseudonymize is stable and non-reversible-looking", () => {
  assert.equal(pseudonymize("u_1"), pseudonymize("u_1"));
  assert.notEqual(pseudonymize("u_1"), "u_1");
});
