import type { OfferPolicy, ReleaseLedgerEntry, WaterfallStep } from "../types/policy.js";
import type { MerchantGateTrace } from "../types/messages.js";
import { pct } from "./money.js";

export interface MerchantGateInput {
  policy: OfferPolicy;
  step: WaterfallStep;
  revenuePaise: number;
  costPaise: number;
  discountPaise: number;
  ledger: ReleaseLedgerEntry[];
  userIdHash: string;
  now: Date;
}

export interface MerchantGateResult {
  allowed: boolean;
  trace: MerchantGateTrace;
}

export function evaluateMerchantGate(input: MerchantGateInput): MerchantGateResult {
  const { policy, revenuePaise, costPaise, discountPaise } = input;

  const netRevenue = revenuePaise - discountPaise;
  const marginAfter = pct(netRevenue - costPaise, netRevenue);

  if (marginAfter < policy.floorMarginPct) {
    return fail(input, marginAfter, "REJECT_FLOOR");
  }

  const startOfDay = new Date(input.now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const todayReleases = input.ledger.filter((e) => new Date(e.releasedAt) >= startOfDay);

  if (todayReleases.length >= policy.maxReleasesPerDay) {
    return fail(input, marginAfter, "REJECT_BUDGET");
  }

  const todayDiscountTotal = todayReleases.reduce((sum, e) => sum + e.discountPaise, 0);
  if (todayDiscountTotal + discountPaise > policy.dailyReleaseBudgetPaise) {
    return fail(input, marginAfter, "REJECT_BUDGET");
  }

  const lastForUser = input.ledger
    .filter((e) => e.userIdHash === input.userIdHash)
    .sort((a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime())[0];

  if (lastForUser) {
    const minutesSince = (input.now.getTime() - new Date(lastForUser.releasedAt).getTime()) / 60000;
    if (minutesSince < policy.cooldownMinutes) {
      return fail(input, marginAfter, "REJECT_COOLDOWN");
    }
  }

  return {
    allowed: true,
    trace: {
      verdict: "PASS",
      marginPctAfter: marginAfter,
      floorMarginPct: policy.floorMarginPct,
    },
  };
}

function fail(input: MerchantGateInput, marginAfter: number, verdict: MerchantGateTrace["verdict"]): MerchantGateResult {
  return {
    allowed: false,
    trace: {
      verdict,
      marginPctAfter: marginAfter,
      floorMarginPct: input.policy.floorMarginPct,
    },
  };
}
