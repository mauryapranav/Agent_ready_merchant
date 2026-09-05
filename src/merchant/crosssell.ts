import type { Product } from "../types/catalog.js";
import type { SoftCriterion } from "../types/mandate.js";
import { CATALOG } from "./data.js";

export const CROSS_SELL_ADJACENCY: Record<string, string[]> = {
  shoes: ["apparel", "accessories"],
  apparel: ["accessories"],
  electronics: ["accessories"],
  accessories: [],
};

export interface CrossSellSuggestion {
  sku: string;
  title: string;
  brand: string;
  category: string;
  pricePaise: number;
  reason: string;
}

export function suggestCrossSell(
  cartSkus: Array<{ sku: string; qty: number }>,
  headroomPaise: number,
  affinityBrands: string[],
  attachmentCriteria: SoftCriterion[] = [],
  catalog: Product[] = CATALOG
): CrossSellSuggestion | null {
  const inCart = new Set(cartSkus.map((i) => i.sku));
  const cartCategories = new Set(
    cartSkus.flatMap((i) => catalog.filter((p) => p.sku === i.sku).map((p) => p.category))
  );
  const adjacent = new Set(Array.from(cartCategories).flatMap((c) => CROSS_SELL_ADJACENCY[c] ?? []));

  const matchesCriteria = (p: Product) =>
    attachmentCriteria.length === 0 ||
    attachmentCriteria.some(
      (sc) =>
        (sc.kind === "brand" && sc.value.toLowerCase() === p.brand.toLowerCase()) ||
        (sc.kind === "category" && sc.value.toLowerCase() === p.category.toLowerCase())
    );

  let best: { product: Product; score: number } | null = null;
  for (const product of catalog) {
    if (inCart.has(product.sku) || !adjacent.has(product.category) || !matchesCriteria(product)) {
      continue;
    }
    if (product.pricePaise > headroomPaise) {
      continue;
    }
    const marginPct = ((product.pricePaise - product.costPaise) / product.pricePaise) * 100;
    const affinityHit = affinityBrands.includes(product.brand);
    const score = (affinityHit ? 100 : 0) + marginPct;
    if (!best || score > best.score) {
      best = { product, score };
    }
  }
  if (!best) {
    return null;
  }
  const { product } = best;
  const why = affinityBrands.includes(product.brand)
    ? `Matches your preferred brand ${product.brand}`
    : attachmentCriteria.length > 0
      ? `Fits your extras rule — ${product.brand} ${product.category}`
      : `Frequently paired with ${[...cartCategories][0]} orders`;
  return {
    sku: product.sku,
    title: product.title,
    brand: product.brand,
    category: product.category,
    pricePaise: product.pricePaise,
    reason: why,
  };
}
