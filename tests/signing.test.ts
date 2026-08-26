import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeyPair, signTip, verifyTipSignature } from "../src/audit/signing.js";
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
