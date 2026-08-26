import type { Product, OfferSurface } from "../types/catalog.js";
import { rupees } from "../core/money.js";

export const CATALOG: Product[] = [
  { sku: "nike-peg-41", title: "Nike Pegasus 41", brand: "Nike", category: "shoes", pricePaise: rupees(4180), costPaise: rupees(2600), imageHint: "shoe" },
  { sku: "adidas-ultra-4d", title: "Adidas Ultraboost 4D", brand: "Adidas", category: "shoes", pricePaise: rupees(3899), costPaise: rupees(2400), imageHint: "shoe" },
  { sku: "puma-flyflex", title: "Puma FlyFlex Runner", brand: "Puma", category: "shoes", pricePaise: rupees(3449), costPaise: rupees(2100), imageHint: "shoe" },
  { sku: "nike-dri-tee", title: "Nike Dri-FIT Tee", brand: "Nike", category: "apparel", pricePaise: rupees(1295), costPaise: rupees(600), imageHint: "tee" },
  { sku: "jockey-socks-3pk", title: "Cushion Crew Socks 3-pack", brand: "Jockey", category: "accessories", pricePaise: rupees(459), costPaise: rupees(180), imageHint: "socks" },
  { sku: "noise-band-pulse", title: "Noise Pulse 2 Max Fitness Band", brand: "Noise", category: "electronics", pricePaise: rupees(2499), costPaise: rupees(1500), imageHint: "band" },
];

export function productBySku(sku: string): Product | undefined {
  return CATALOG.find((p) => p.sku === sku);
}

export const OFFER_SURFACE: OfferSurface = {
  coupons: [
    { code: "SAVE5", kind: "pct_off", value: 5, minCartPaise: rupees(1000), stackable: false, validFrom: "2026-08-01T00:00:00Z", validTo: "2027-01-31T00:00:00Z" },
    { code: "FLAT200", kind: "flat_off", value: rupees(200), minCartPaise: rupees(2500), stackable: false, validFrom: "2026-08-01T00:00:00Z", validTo: "2027-01-31T00:00:00Z" },
    { code: "EXPIRED10", kind: "pct_off", value: 10, minCartPaise: 0, stackable: false, validFrom: "2026-01-01T00:00:00Z", validTo: "2026-08-20T00:00:00Z" },
  ],
  railOffers: [
    { rail: "upi", label: "UPI cashback 4% (bank-funded)", discountPct: 4, maxDiscountPaise: rupees(150), fundedBy: "bank", validTo: "2027-01-31T00:00:00Z" },
    { rail: "card", label: "ICICI cards 5% off (network-funded)", discountPct: 5, maxDiscountPaise: rupees(250), fundedBy: "network", validTo: "2027-01-31T00:00:00Z" },
  ],
  campaigns: [
    { campaignId: "nike-aug", label: "Nike festive flat-off", flatOffPaise: rupees(300), minCartPaise: rupees(3000), fundedBy: "brand", remainingBudgetPaise: rupees(9000), validTo: "2026-09-30T00:00:00Z" },
    { campaignId: "shoe-mela", label: "Shoe mela flat-off", flatOffPaise: rupees(150), minCartPaise: rupees(2000), fundedBy: "merchant_marketing", remainingBudgetPaise: rupees(4500), validTo: "2026-09-15T00:00:00Z" },
  ],
};

export const SWAP_ALTERNATIVES: Record<string, string[]> = {
  "nike-peg-41": ["adidas-ultra-4d", "puma-flyflex"],
  "adidas-ultra-4d": ["nike-peg-41", "puma-flyflex"],
};
