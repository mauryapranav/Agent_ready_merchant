import { cartHash } from "../buyer/parser.js";
import { productBySku } from "../merchant/data.js";

export function cartFor(skus: Array<{ sku: string; qty: number }>) {
  const totalPaise = skus.reduce((sum, i) => sum + productBySku(i.sku)!.pricePaise * i.qty, 0);
  return { sessionId: `s_${Math.random().toString(36).slice(2, 8)}`, items: skus, totalPaise, hash: cartHash(skus) };
}

export function buyerContextFor(skus: Array<{ sku: string; qty: number }>) {
  const brands = new Set<string>();
  const categories = new Set<string>();
  for (const i of skus) {
    const p = productBySku(i.sku);
    if (p) {
      brands.add(p.brand);
      categories.add(p.category);
    }
  }
  return { cartBrands: [...brands], cartCategories: [...categories], affinityTopBrands: [] };
}
