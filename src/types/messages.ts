import type { CounterOffer } from "./catalog.js";

export type BlockReason = "BUDGET_EXCEEDED" | "NO_FITTING_OPTION" | "OFFER_INVALID" | "PAYMENT_DECLINED" | "CART_DRIFT" | "CONSENT_REVOKED";

export interface CartState {
  sessionId: string;
  items: Array<{ sku: string; qty: number }>;
  totalPaise: number;
  hash: string;
}

export type NegotiationMessage =
  | {
      type: "INTENT_BLOCKED";
      sessionId: string;
      mandateId: string;
      reason: BlockReason;
      cart: CartState;
      gapPaise: number;
      at: string;
    }
  | {
      type: "COUNTER_OFFER";
      sessionId: string;
      offer: CounterOffer;
      at: string;
    }
  | {
      type: "BUYER_DECISION";
      sessionId: string;
      mandateId: string;
      accepted: boolean;
      offerId: string;
      gateTrace: BuyerGateTrace;
      at: string;
    }
  | {
      type: "SETTLEMENT_RESULT";
      sessionId: string;
      offerId: string | null;
      status: "PAID" | "ABORTED" | "PAUSED_FOR_HUMAN";
      finalTotalPaise: number | null;
      reason: BlockReason | null;
      at: string;
    };

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
