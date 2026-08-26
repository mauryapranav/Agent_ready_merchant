import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOnOffer } from "../src/buyer/agent.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import type { CounterOffer } from "../src/types/catalog.js";
import { rupees } from "../src/core/money.js";

const parsed = parseIntentDeterministic("Get me running shoes under ₹4000, can stretch by 300 if it's really Nike shoes");
const mandate = buildMandate(
  "u_1",
  "Get me running shoes under ₹4000, can stretch by 300 if it's really Nike shoes",
  parsed,
  cartHash([{ sku: "nike-peg-41", qty: 1 }]),
  { dpdpAcceptedAt: new Date().toISOString(), affinitySharing: "anonymized_topk" },
  new Date(Date.now() - 60000)
);

const now = new Date();

function offer(mechanism: CounterOffer["mechanism"], newTotalPaise: number): CounterOffer {
  return {
    offerId: "off_1",
    mechanism,
    newTotalPaise,
    merchantCostPaise: 0,
    fundedBy: "brand",
    explanation: "test",
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
  };
}

const baseCtx = {
  cartBrands: ["Nike"],
  cartCategories: ["shoes"],
  affinityTopBrands: [],
  offeredRail: null,
  swapToSku: null,
};

test("campaign-funded offer under cap accepted", () => {
  const d = decideOnOffer(mandate, offer({ step: "funded_campaign", campaignId: "nike-aug" }, rupees(3880)), baseCtx, now);
  assert.equal(d.accepted, true);
  assert.equal(d.gate.trace.verdict, "PASS_CAP");
});

test("price-cut into flex zone accepted via brand+category match", () => {
  const d = decideOnOffer(mandate, offer({ step: "price_cut" }, rupees(4250)), baseCtx, now);
  assert.equal(d.accepted, true);
  assert.equal(d.gate.trace.verdict, "PASS_FLEX");
  assert.equal(d.gate.trace.stretchUsedPaise, rupees(250));
});

test("price cut beyond stretch rejected", () => {
  const d = decideOnOffer(mandate, offer({ step: "price_cut" }, rupees(4500)), baseCtx, now);
  assert.equal(d.accepted, false);
  assert.equal(d.gate.trace.verdict, "REJECT_OVER_STRETCH");
});

test("rail offer on disallowed rail rejected with clear narration", () => {
  const d = decideOnOffer(
    mandate,
    offer({ step: "rail_offer", railOfferRail: "netbanking" }, rupees(3900)),
    baseCtx,
    now
  );
  assert.equal(d.accepted, false);
  assert.match(d.narration, /netbanking/i);
});

test("expired offer never accepted", () => {
  const expired: CounterOffer = { ...offer({ step: "price_cut" }, rupees(3900)), expiresAt: new Date(now.getTime() - 1000).toISOString() };
  const d = decideOnOffer(mandate, expired, baseCtx, now);
  assert.equal(d.accepted, false);
});
