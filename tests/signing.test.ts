import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeyPair, signTip, verifyTipSignature, verifyPayloadSignature } from "../src/audit/signing.js";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { SimulatedExecutor } from "../src/payments/executor.js";
import { DEFAULT_POLICY } from "../src/types/policy.js";
import { cartFor, buyerContextFor } from "../src/demo/fixtures.js";

const now = new Date("2026-08-24T10:00:00Z");
const skus = [{ sku: "nike-peg-41", qty: 1 }];

test("ed25519 verify passes for genuine tip, fails on tamper", () => {
  const pair = generateSigningKeyPair();
  const tip = "ab".repeat(32);
  const sig = signTip(tip, pair.privateKeyPem);
  assert.equal(verifyTipSignature(tip, sig, pair.publicKeyPem), true);
  assert.equal(verifyTipSignature("cd".repeat(32), sig, pair.publicKeyPem), false);
});

test("signed session produces verifiable tips on both ledgers", async () => {
  const parsed = parseIntentDeterministic("Get me running shoes under ₹5000");
  const mandate = buildMandate(
    "u_1",
    "Get me running shoes under ₹5000",
    parsed,
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
    new Date(now.getTime() - 60000)
  );
  const keys = generateSigningKeyPair();
  const r = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: buyerContextFor(skus),
    signingKeys: keys,
    now,
  });
  assert.ok(r.tipSignatures.buyer);
  assert.ok(r.tipSignatures.merchant);
  assert.equal(verifyTipSignature(r.tipSignatures.buyer!.hash, r.tipSignatures.buyer!.signature, keys.publicKeyPem), true);
  assert.equal(verifyTipSignature(r.tipSignatures.merchant!.hash, r.tipSignatures.merchant!.signature, keys.publicKeyPem), true);
});

test("released counter-offers carry verifiable ed25519 signatures", async () => {
  const intent = "Get me running shoes under ₹4000";
  const mandate = buildMandate(
    "u_offer_1",
    intent,
    parseIntentDeterministic(intent),
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "none" },
    new Date(now.getTime() - 60000)
  );
  const keys = generateSigningKeyPair();
  const r = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: buyerContextFor(skus),
    signingKeys: keys,
    now,
  });
  const ev = r.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
  assert.ok(ev, "expected an offer release event");
  const signed = (ev!.event as { signedOffer: Record<string, unknown> | null }).signedOffer;
  assert.ok(signed, "signedOffer artifact missing");
  assert.equal(signed!["type"], "settle.counter_offer.v1");
  assert.equal(signed!["alg"], "ed25519");
  const { signature, ...artifact } = signed as { signature: string } & Record<string, unknown>;
  assert.equal(verifyPayloadSignature(artifact, signature, keys.publicKeyPem), true);
  const tampered = { ...artifact, offer: { ...(artifact.offer as Record<string, unknown>), newTotalPaise: 1 } };
  assert.equal(verifyPayloadSignature(tampered, signature, keys.publicKeyPem), false);
});

test("without signing keys, offers are released unsigned", async () => {
  const intent = "Get me running shoes under ₹4000";
  const mandate = buildMandate(
    "u_offer_2",
    intent,
    parseIntentDeterministic(intent),
    cartHash(skus),
    { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "none" },
    new Date(now.getTime() - 60000)
  );
  const r = await runSession({
    mandate,
    cart: cartFor(skus),
    policy: DEFAULT_POLICY,
    releaseLedger: [],
    buyerContext: buyerContextFor(skus),
    now,
  });
  const ev = r.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
  assert.ok(ev, "expected an offer release event");
  assert.equal((ev!.event as { signedOffer: unknown }).signedOffer, null);
});

test("idempotency: same key replays cached success instead of charging twice", async () => {
  const exec = new SimulatedExecutor();
  const input = { rail: "upi" as const, amountPaise: 1000, idempotencyKey: "idem_1", receiptId: "s_9" };
  const first = await exec.charge(input, {});
  const second = await exec.charge({ ...input, amountPaise: 999999 }, {});
  assert.equal(first.ok, true);
  assert.equal(first.replayed ?? false, false);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
});
