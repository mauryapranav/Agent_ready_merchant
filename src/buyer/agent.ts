import type { Mandate, SoftCriterion, Rail } from "../types/mandate.js";
import type { CounterOffer } from "../types/catalog.js";
import { evaluateBuyerGateWithContext, type BuyerGateResult } from "../core/buyer-gate.js";
import { productBySku } from "../merchant/data.js";

export interface OfferContextInput {
  cartBrands: string[];
  cartCategories: string[];
  affinityTopBrands: string[];
  offeredRail: string | null;
  swapToSku: string | null;
}

export interface BuyerDecision {
  accepted: boolean;
  gate: BuyerGateResult;
  narration: string;
}

export function contextForOffer(mandate: Mandate, offer: CounterOffer, ctx: OfferContextInput): SoftCriterion[] {
  const criteria: SoftCriterion[] = [];
  const brands = new Set([...ctx.cartBrands, ...ctx.affinityTopBrands]);
  if (offer.mechanism.step === "bundle_swap") {
    const swapped = productBySku(offer.mechanism.swapToSku);
    if (swapped) {
      brands.add(swapped.brand);
      criteria.push({ kind: "category", value: swapped.category });
    }
  }
  for (const brand of brands) {
    criteria.push({ kind: "brand", value: brand });
  }
  for (const cat of ctx.cartCategories) {
    criteria.push({ kind: "category", value: cat });
  }
  if (ctx.offeredRail) {
    criteria.push({ kind: "rail", value: ctx.offeredRail as Rail });
  }
  return criteria;
}

export function decideOnOffer(
  mandate: Mandate,
  offer: CounterOffer,
  ctx: OfferContextInput,
  now: Date
): BuyerDecision {
  if (new Date(offer.expiresAt) <= now) {
    return {
      accepted: false,
      gate: {
        allowed: false,
        trace: {
          verdict: "REJECT_NO_FLEX_RULE",
          capPaise: mandate.hardCapPaise,
          proposedPaise: offer.newTotalPaise,
          stretchUsedPaise: Math.max(0, offer.newTotalPaise - mandate.hardCapPaise),
          matchedCriteria: [],
          requiredMatches: 0,
        },
      },
      narration: "This offer expired before I could use it. I will not pay without a valid deal in place.",
    };
  }

  if (offer.mechanism.step === "rail_offer" && !mandate.allowedRails.includes(offer.mechanism.railOfferRail)) {
    return {
      accepted: false,
      gate: {
        allowed: false,
        trace: {
          verdict: "REJECT_OVER_STRETCH",
          capPaise: mandate.hardCapPaise,
          proposedPaise: offer.newTotalPaise,
          stretchUsedPaise: Math.max(0, offer.newTotalPaise - mandate.hardCapPaise),
          matchedCriteria: [],
          requiredMatches: 0,
        },
      },
      narration: `The offer needs payment via ${offer.mechanism.railOfferRail.toUpperCase()}, which you have not enabled. I declined it.`,
    };
  }

  const offeredRail = offer.mechanism.step === "rail_offer" ? offer.mechanism.railOfferRail : null;
  const swapTo = offer.mechanism.step === "bundle_swap" ? offer.mechanism.swapToSku : null;
  const criteria = contextForOffer(mandate, offer, { ...ctx, offeredRail, swapToSku: swapTo });

  const flex = mandate.flexRule;
  const matchedLabels: string[] = flex
    ? criteria
        .filter((c) => flex.softCriteria.some((s) => s.kind === c.kind && s.value === c.value))
        .map((c) => `${c.kind}:${c.value}`)
    : [];

  const result = evaluateBuyerGateWithContext({
    mandate,
    proposedTotalPaise: offer.newTotalPaise,
    now,
    matchedCriteria: matchedLabels,
  });

  return { accepted: result.allowed, gate: result, narration: narrate(mandate, offer, result) };
}

function narrate(mandate: Mandate, offer: CounterOffer, result: BuyerGateResult): string {
  if (!result.allowed) {
    return `The revised price is ₹${((offer.newTotalPaise - mandate.hardCapPaise) / 100).toFixed(0)} over your limit with none of your stated conditions met convincingly. I declined and paused for your call.`;
  }
  if (result.trace.verdict === "PASS_FLEX") {
    return `Price fits within the stretch you approved (${result.trace.matchedCriteria.join(", ") || "conditions met"}). Extra spend: ₹${(result.trace.stretchUsedPaise / 100).toFixed(0)}. Accepting.`;
  }
  return `Revised total ₹${(offer.newTotalPaise / 100).toFixed(0)} is inside your ₹${(mandate.hardCapPaise / 100).toFixed(0)} cap. ${offer.explanation} Accepting.`;
}
