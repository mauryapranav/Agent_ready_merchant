import type { Mandate } from "../types/mandate.js";
import type { Product } from "../types/catalog.js";
import { suggestCrossSell, type CrossSellSuggestion } from "../merchant/crosssell.js";
import { CATALOG, productBySku as moduleProductBySku } from "../merchant/data.js";

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
  affinityBrands: string[],
  catalog?: Product[]
): CrossSellDecision {
  // Without the caller-supplied catalog, DB-only SKUs price at 0 here, which inflates headroom
  // to the full cap and lets suggestCrossSell attach a product the store does not stock.
  const activeCatalog = catalog ?? CATALOG;
  const priceOf = (sku: string) => (catalog ? catalog.find((p) => p.sku === sku)?.pricePaise : moduleProductBySku(sku)?.pricePaise) ?? 0;
  const cartTotal = cartItems.reduce((sum, i) => sum + priceOf(i.sku) * i.qty, 0);
  const headroom = mandate.hardCapPaise - cartTotal;
  const suggestion = suggestCrossSell(cartItems, headroom, affinityBrands, mandate.attachmentCriteria, activeCatalog);
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
