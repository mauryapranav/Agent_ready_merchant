import type { CounterOffer } from "./catalog.js";

export type BlockReason = "BUDGET_EXCEEDED" | "NO_FITTING_OPTION" | "OFFER_INVALID" | "PAYMENT_DECLINED" | "CART_DRIFT";

export interface CartState {
  sessionId: string;
  items: Array<{ sku: string; qty: number }>;
  totalPaise: number;
  hash: string;
}

export interface BuyerGateTrace {
  verdict: "PASS_CAP" | "PASS_FLEX" | "REJECT_OVER_STRETCH" | "REJECT_INSUFFICIENT_MATCHES" | "REJECT_NO_FLEX_RULE";
  capPaise: number;
  proposedPaise: number;
  stretchUsedPaise: number;
  matchedCriteria: string[];
  requiredMatches: number;
}

export interface MerchantGateTrace {
  verdict: "PASS" | "REJECT_FLOOR" | "REJECT_BUDGET" | "REJECT_COOLDOWN";
  marginPctAfter: number;
  floorMarginPct: number;
}
