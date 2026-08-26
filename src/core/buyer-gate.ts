import type { Mandate, SoftCriterion } from "../types/mandate.js";
import type { BuyerGateTrace } from "../types/messages.js";

export interface BuyerGateInput {
  mandate: Mandate;
  proposedTotalPaise: number;
  now: Date;
}

export interface BuyerGateResult {
  allowed: boolean;
  trace: BuyerGateTrace;
}

export function evaluateBuyerGate(input: BuyerGateInput): BuyerGateResult {
  const { mandate, proposedTotalPaise, now } = input;

  if (new Date(mandate.expiresAt) < now) {
    return rejected(mandate, proposedTotalPaise, "REJECT_NO_FLEX_RULE", [], mandate.flexRule?.requireSoftMatches ?? 0);
  }

  if (proposedTotalPaise <= mandate.hardCapPaise) {
    return {
      allowed: true,
      trace: {
        verdict: "PASS_CAP",
        capPaise: mandate.hardCapPaise,
        proposedPaise: proposedTotalPaise,
        stretchUsedPaise: 0,
        matchedCriteria: [],
        requiredMatches: 0,
      },
    };
  }

  const flex = mandate.flexRule;
  if (!flex) {
    return rejected(mandate, proposedTotalPaise, "REJECT_NO_FLEX_RULE", [], 0);
  }

  const stretchUsed = proposedTotalPaise - mandate.hardCapPaise;
  if (stretchUsed > flex.maxStretchPaise) {
    return rejected(mandate, proposedTotalPaise, "REJECT_OVER_STRETCH", [], flex.requireSoftMatches);
  }

  return rejected(mandate, proposedTotalPaise, "REJECT_INSUFFICIENT_MATCHES", [], flex.requireSoftMatches);
}

export function countSoftMatches(mandate: Mandate, context: SoftCriterion[]): number {
  const flex = mandate.flexRule;
  if (!flex) return 0;
  let matches = 0;
  for (const criterion of flex.softCriteria) {
    if (context.some((c) => c.kind === criterion.kind && c.value === criterion.value)) {
      matches += 1;
    }
  }
  return matches;
}

export function evaluateBuyerGateWithContext(
  input: BuyerGateInput & { matchedCriteria: string[] }
): BuyerGateResult {
  const base = evaluateBuyerGate(input);
  if (base.trace.verdict !== "REJECT_INSUFFICIENT_MATCHES") {
    return base;
  }
  const flex = input.mandate.flexRule!;
  const required = flex.requireSoftMatches;
  if (input.matchedCriteria.length >= required) {
    return {
      allowed: true,
      trace: {
        verdict: "PASS_FLEX",
        capPaise: input.mandate.hardCapPaise,
        proposedPaise: input.proposedTotalPaise,
        stretchUsedPaise: input.proposedTotalPaise - input.mandate.hardCapPaise,
        matchedCriteria: input.matchedCriteria,
        requiredMatches: required,
      },
    };
  }
  return base;
}

function rejected(
  mandate: Mandate,
  proposedTotalPaise: number,
  verdict: BuyerGateTrace["verdict"],
  matchedCriteria: string[],
  requiredMatches: number
): BuyerGateResult {
  return {
    allowed: false,
    trace: {
      verdict,
      capPaise: mandate.hardCapPaise,
      proposedPaise: proposedTotalPaise,
      stretchUsedPaise: Math.max(0, proposedTotalPaise - mandate.hardCapPaise),
      matchedCriteria,
      requiredMatches,
    },
  };
}
