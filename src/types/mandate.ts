export type Rail = "upi" | "card" | "netbanking" | "wallet";

export type SoftCriterion =
  | { kind: "brand"; value: string }
  | { kind: "category"; value: string }
  | { kind: "rail"; value: Rail };

export interface FlexRule {
  maxStretchPaise: number;
  requireSoftMatches: number;
  softCriteria: SoftCriterion[];
}

export interface Consent {
  dpdpAcceptedAt: string | null;
  affinitySharing: "none" | "anonymized_topk";
}

export interface Mandate {
  mandateId: string;
  userId: string;
  intentText: string;
  hardCapPaise: number;
  flexRule: FlexRule | null;
  attachmentCriteria: SoftCriterion[];
  maxHuntMs: number;
  allowedRails: Rail[];
  consent: Consent;
  cartHashAtConsent: string;
  issuedAt: string;
  expiresAt: string;
}
