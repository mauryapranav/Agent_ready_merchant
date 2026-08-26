import type { Consent } from "../types/mandate.js";
import type { SoftCriterion } from "../types/mandate.js";
import { sha256 } from "../core/hash.js";

export type EventType = "view" | "cart" | "purchase";

export interface AffinityEvent {
  type: EventType;
  brand: string;
  at: string;
}

const WEIGHTS: Record<EventType, number> = { view: 1, cart: 2, purchase: 4 };
const DECAY_PER_DAY = 0.1;
export const TOP_K = 2;
export const SCORE_THRESHOLD = 0.25;

export function recordEvent(memory: AffinityEvent[], event: AffinityEvent): AffinityEvent[] {
  return [...memory, event];
}

export function brandScores(memory: AffinityEvent[], consent: Consent, now: Date): Map<string, number> {
  const scores = new Map<string, number>();
  if (!consent.dpdpAcceptedAt) {
    return scores;
  }
  for (const e of memory) {
    const ageDays = Math.max(0, (now.getTime() - new Date(e.at).getTime()) / 86400000);
    const contribution = WEIGHTS[e.type] * Math.exp(-DECAY_PER_DAY * ageDays);
    scores.set(e.brand, (scores.get(e.brand) ?? 0) + contribution);
  }
  return scores;
}

export function ownTopBrands(memory: AffinityEvent[], consent: Consent, now: Date): string[] {
  const scores = brandScores(memory, consent, now);
  return [...scores.entries()]
    .filter(([, s]) => s >= SCORE_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_K)
    .map(([brand]) => brand);
}

export function affinityCriteriaForRanking(memory: AffinityEvent[], consent: Consent, now: Date): SoftCriterion[] {
  return ownTopBrands(memory, consent, now).map((brand) => ({ kind: "brand" as const, value: brand }));
}

export function shareWithMerchant(memory: AffinityEvent[], consent: Consent, now: Date): string[] | null {
  if (consent.dpdpAcceptedAt === null || consent.affinitySharing === "none") {
    return null;
  }
  return ownTopBrands(memory, consent, now);
}

export function pseudonymize(userId: string): string {
  return sha256({ userId }).slice(0, 16);
}
