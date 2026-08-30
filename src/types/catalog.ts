import type { Rail } from "./mandate.js";
import type { WaterfallStep } from "./policy.js";

export interface Product {
  sku: string;
  title: string;
  brand: string;
  category: string;
  pricePaise: number;
  costPaise: number;
  imageHint: string;
}

export interface Coupon {
  code: string;
  kind: "pct_off" | "flat_off";
  value: number;
  minCartPaise: number;
  stackable: boolean;
  validFrom: string;
  validTo: string;
}

export interface RailOffer {
  rail: Rail;
  label: string;
  discountPct: number;
  maxDiscountPaise: number;
  fundedBy: "bank" | "network" | "merchant";
  validTo: string;
}

export interface FundedCampaign {
  campaignId: string;
  label: string;
  flatOffPaise: number;
  minCartPaise: number;
  fundedBy: "brand" | "merchant_marketing";
  remainingBudgetPaise: number;
  validTo: string;
}

export type SwapAlternatives = Record<string, string[]>;

export type OfferSurface = {
  coupons: Coupon[];
  railOffers: RailOffer[];
  campaigns: FundedCampaign[];
};

export type CounterMechanism =
  | { step: "funded_campaign"; campaignId: string }
  | { step: "rail_offer"; railOfferRail: Rail }
  | { step: "bundle_swap"; swapFromSku: string; swapToSku: string }
  | { step: "price_cut" };

export interface CounterOffer {
  offerId: string;
  mechanism: CounterMechanism;
  newTotalPaise: number;
  merchantCostPaise: number;
  fundedBy: "bank" | "network" | "brand" | "merchant_marketing" | "merchant_margin";
  explanation: string;
  expiresAt: string;
}
