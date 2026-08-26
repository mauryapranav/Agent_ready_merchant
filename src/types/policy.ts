export type WaterfallStep = "funded_campaign" | "rail_offer" | "bundle_swap" | "price_cut";

export interface WaterfallEntry {
  step: WaterfallStep;
  enabled: boolean;
}

export interface OfferPolicy {
  merchantId: string;
  waterfall: WaterfallEntry[];
  floorMarginPct: number;
  maxReleasesPerDay: number;
  dailyReleaseBudgetPaise: number;
  cooldownMinutes: number;
}

export interface ReleaseLedgerEntry {
  releasedAt: string;
  userIdHash: string;
  step: WaterfallStep;
  discountPaise: number;
}

export const DEFAULT_POLICY: OfferPolicy = {
  merchantId: "merchant_settle_demo",
  waterfall: [
    { step: "funded_campaign", enabled: true },
    { step: "rail_offer", enabled: true },
    { step: "bundle_swap", enabled: true },
    { step: "price_cut", enabled: true },
  ],
  floorMarginPct: 12,
  maxReleasesPerDay: 50,
  dailyReleaseBudgetPaise: 500000,
  cooldownMinutes: 30,
};
