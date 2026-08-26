import type { Mandate } from "../types/mandate.js";
import { suggestCrossSell, type CrossSellSuggestion } from "../merchant/crosssell.js";
import { productBySku } from "../merchant/data.js";

export interface CrossSellDecision {
  offered: boolean;
  accepted: boolean;
  suggestion: CrossSellSuggestion | null;
  basis: "affinity" | "declared_criteria" | null;
  declineReason: string | null;
}

export function evaluateCrossSell(
  mandate: Mandate,
  cartItems: Array<{ sku: string; qty: number }>,
  affinityBrands: string[]
): CrossSellDecision {
  const cartTotal = cartItems.reduce((sum, i) => sum + (productBySku(i.sku)?.pricePaise ?? 0) * i.qty, 0);
  const headroom = mandate.hardCapPaise - cartTotal;
  const suggestion = suggestCrossSell(cartItems, headroom, affinityBrands, mandate.attachmentCriteria);
  if (!suggestion) {
    return {
      offered: false,
      accepted: false,
      suggestion: null,
      basis: null,
      declineReason: "no fitting attachment within cap headroom",
    };
  }

  if (affinityBrands.includes(suggestion.brand)) {
    return { offered: true, accepted: true, suggestion, basis: "affinity", declineReason: null };
  }

  const criteriaHit = mandate.attachmentCriteria.some(
    (sc) =>
      (sc.kind === "brand" && sc.value === suggestion!.brand) ||
      (sc.kind === "category" && sc.value === suggestion!.category)
  );
  if (criteriaHit) {
    return { offered: true, accepted: true, suggestion, basis: "declared_criteria", declineReason: null };
  }

  return {
    offered: true,
    accepted: false,
    suggestion,
    basis: null,
    declineReason: "outside your extras rule — declining rather than upselling blindly",
  };
}
