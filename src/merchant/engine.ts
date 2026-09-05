import type { CartState } from "../types/messages.js";
import type { OfferPolicy, WaterfallStep } from "../types/policy.js";
import type { CounterOffer, FundedCampaign, Product, RailOffer, SwapAlternatives } from "../types/catalog.js";
import { evaluateMerchantGate, type MerchantGateResult } from "../core/merchant-gate.js";
import type { ReleaseLedgerEntry } from "../types/policy.js";
import { productBySku as moduleProductBySku, OFFER_SURFACE, SWAP_ALTERNATIVES } from "./data.js";

export interface WaterfallInput {
  cart: CartState;
  requiredDiscountPaise: number;
  policy: OfferPolicy;
  ledger: ReleaseLedgerEntry[];
  userIdHash: string;
  buyerAllowedRails: string[];
  now: Date;
  offerTtlMs?: number | undefined;
  campaigns?: FundedCampaign[] | undefined;
  products?: Product[] | undefined;
  railOffers?: RailOffer[] | undefined;
  swapAlternatives?: SwapAlternatives | undefined;
}

/**
 * Resolve a SKU against the caller-supplied catalog when one is given, falling back to the
 * static module catalog. The API serves products from Postgres, so without this the gate
 * would price DB-only SKUs at cost 0 and never reject on floor margin.
 */
function resolveProduct(input: WaterfallInput, sku: string): Product | undefined {
  return input.products ? input.products.find((p) => p.sku === sku) : moduleProductBySku(sku);
}

export interface WaterfallOutcome {
  offer: CounterOffer | null;
  attempts: Array<{ step: WaterfallStep; gate: MerchantGateResult; viable: boolean }>;
  updatedCampaigns: FundedCampaign[] | null;
}

export function buildCounterOffer(input: WaterfallInput): WaterfallOutcome {
  const full = runWaterfall(input, input.requiredDiscountPaise);
  if (full.offer) {
    return full;
  }
  const partialTarget = Math.ceil(input.requiredDiscountPaise / 2);
  const partial = runWaterfall(input, partialTarget);
  if (partial.offer && partial.offer.newTotalPaise < input.cart.totalPaise) {
    return {
      offer: { ...partial.offer, explanation: `Partial rescue — covers part of the gap; the buyer may stretch the rest if their rules allow. ${partial.offer.explanation}` },
      attempts: [...full.attempts, ...partial.attempts.map((a) => ({ ...a, step: a.step }))],
      updatedCampaigns: partial.updatedCampaigns,
    };
  }
  return { offer: null, attempts: [...full.attempts, ...partial.attempts], updatedCampaigns: partial.updatedCampaigns };
}

function runWaterfall(input: WaterfallInput, requiredDiscountPaise: number): WaterfallOutcome {
  const attempts: WaterfallOutcome["attempts"] = [];
  const steps = input.policy.waterfall.filter((w) => w.enabled).map((w) => w.step);
  let currentCampaigns = input.campaigns ?? OFFER_SURFACE.campaigns;

  for (const step of steps) {
    const { offer: candidate, updatedCampaigns } = buildCandidate(step, { ...input, requiredDiscountPaise, campaigns: currentCampaigns });
    if (!candidate) {
      continue;
    }
    const gate = runGateForStep(step, candidate, input);
    attempts.push({ step, gate, viable: gate.allowed });
    if (gate.allowed) {
      // If this was a campaign offer, use the updated campaigns; otherwise keep current
      const finalCampaigns = updatedCampaigns ?? currentCampaigns;
      return { offer: candidate, attempts, updatedCampaigns: finalCampaigns };
    }
    // If campaign step was attempted but not viable, budgets were not decremented
  }
  return { offer: null, attempts, updatedCampaigns: currentCampaigns };
}

interface CandidateResult {
  offer: CounterOffer | null;
  updatedCampaigns: FundedCampaign[] | null;
}

function buildCandidate(step: WaterfallStep, input: WaterfallInput): CandidateResult {
  switch (step) {
    case "funded_campaign":
      return campaignCandidate(input);
    case "rail_offer":
      return { offer: railCandidate(input), updatedCampaigns: null };
    case "bundle_swap":
      return { offer: swapCandidate(input), updatedCampaigns: null };
    case "price_cut":
      return { offer: priceCutCandidate(input), updatedCampaigns: null };
  }
}

function campaignCandidate(input: WaterfallInput): CandidateResult {
  const campaigns = input.campaigns ?? OFFER_SURFACE.campaigns;
  const valid = campaigns.filter(
    (c) =>
      c.remainingBudgetPaise >= c.flatOffPaise &&
      c.flatOffPaise >= input.requiredDiscountPaise &&
      input.cart.totalPaise >= c.minCartPaise &&
      new Date(c.validTo) > input.now
  );
  const best = valid.sort((a, b) => a.flatOffPaise - b.flatOffPaise)[0];
  if (!best) {
    return { offer: null, updatedCampaigns: null };
  }
  const updatedCampaigns = campaigns.map((c) =>
    c.campaignId === best.campaignId ? { ...c, remainingBudgetPaise: c.remainingBudgetPaise - best.flatOffPaise } : c
  );
  const offer = makeOffer(input.cart.totalPaise - best.flatOffPaise, 0, best.fundedBy === "brand" ? "brand" : "merchant_marketing", { step: "funded_campaign", campaignId: best.campaignId }, `Covered by active campaign "${best.label}" — costs the merchant nothing.`, input.now, input.offerTtlMs);
  return { offer, updatedCampaigns };
}

function railCandidate(input: WaterfallInput): CounterOffer | null {
  const usable = (input.railOffers ?? OFFER_SURFACE.railOffers)
    .filter((r: RailOffer) => new Date(r.validTo) > input.now && input.buyerAllowedRails.includes(r.rail))
    .map((r) => ({ r, discount: Math.min(Math.floor((input.cart.totalPaise * r.discountPct) / 100), r.maxDiscountPaise) }))
    .filter((x) => x.discount >= input.requiredDiscountPaise)
    .sort((a, b) => b.discount - a.discount)[0];
  if (!usable) {
    return null;
  }
  return makeOffer(
    input.cart.totalPaise - usable.discount,
    0,
    usable.r.fundedBy === "merchant" ? "merchant_margin" : usable.r.fundedBy,
    { step: "rail_offer", railOfferRail: usable.r.rail },
    `${usable.r.label} covers ₹${(usable.discount / 100).toFixed(0)} if paid via ${usable.r.rail.toUpperCase()} — bank/network-funded.`,
    input.now,
    input.offerTtlMs
  );
}

function swapCandidate(input: WaterfallInput): CounterOffer | null {
  const swaps = input.swapAlternatives ?? SWAP_ALTERNATIVES;
  for (const item of input.cart.items) {
    for (const altSku of swaps[item.sku] ?? []) {
      const from = resolveProduct(input, item.sku);
      const to = resolveProduct(input, altSku);
      if (!from || !to) {
        continue;
      }
      const saving = (from.pricePaise - to.pricePaise) * item.qty;
      if (saving < input.requiredDiscountPaise) {
        continue;
      }
      const marginDelta = (from.pricePaise - from.costPaise) * item.qty - (to.pricePaise - to.costPaise) * item.qty;
      const merchantCost = Math.max(0, -marginDelta);
      return makeOffer(
        input.cart.totalPaise - saving,
        merchantCost,
        "merchant_margin",
        { step: "bundle_swap", swapFromSku: item.sku, swapToSku: altSku },
        `Swap ${from.title} → ${to.title} saves ₹${(saving / 100).toFixed(0)} with comparable specs.`,
        input.now,
        input.offerTtlMs
      );
    }
  }
  return null;
}

function priceCutCandidate(input: WaterfallInput): CounterOffer | null {
  const cut = input.requiredDiscountPaise;
  return makeOffer(
    input.cart.totalPaise - cut,
    cut,
    "merchant_margin",
    { step: "price_cut" },
    `Direct price cut of ₹${(cut / 100).toFixed(0)} — minimum sufficient discount, last resort in the waterfall.`,
    input.now,
    input.offerTtlMs
  );
}

function runGateForStep(step: WaterfallStep, offer: CounterOffer, input: WaterfallInput): MerchantGateResult {
  const itemsValue = input.cart.items.reduce((sum, i) => sum + (resolveProduct(input, i.sku)?.costPaise ?? 0) * i.qty, 0);
  return evaluateMerchantGate({
    policy: input.policy,
    step,
    revenuePaise: input.cart.totalPaise,
    costPaise: itemsValue,
    discountPaise: offer.merchantCostPaise,
    ledger: input.ledger,
    userIdHash: input.userIdHash,
    now: input.now,
  });
}

let offerSeq = 0;

function makeOffer(
  newTotalPaise: number,
  merchantCostPaise: number,
  fundedBy: CounterOffer["fundedBy"],
  mechanism: CounterOffer["mechanism"],
  explanation: string,
  now: Date,
  ttlMs = 120000
): CounterOffer {
  offerSeq += 1;
  return {
    offerId: `off_${Date.now().toString(36)}_${offerSeq}`,
    mechanism,
    newTotalPaise,
    merchantCostPaise,
    fundedBy,
    explanation,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}
