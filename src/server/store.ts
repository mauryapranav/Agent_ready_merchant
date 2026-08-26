export interface SessionRecord {
  sessionId: string;
  at: string;
  itemsLabel: string;
  cartTotalPaise: number;
  gapPaise: number;
  mechanismStep: string | null;
  crossSoldSku: string | null;
  merchantCostPaise: number;
  fundedBy: string | null;
  outcome: string;
  finalTotalPaise: number | null;
  paidVia: string | null;
  reason: string | null;
  intentText: string;
  parsedBy: "llm" | "deterministic";
  consentSharing: "none" | "anonymized_topk";
  skus: Array<{ sku: string; qty: number }>;
  buyerEvents: unknown[];
  merchantEvents: unknown[];
  chainsVerified: boolean;
  tipSignatures: { buyer: { hash: string; signature: string } | null; merchant: { hash: string; signature: string } | null };
  receipt: unknown;
}

const records: SessionRecord[] = [];

export function saveRecord(r: SessionRecord): void {
  records.unshift(r);
}

export function recentRecords(limit = 50): SessionRecord[] {
  return records.slice(0, limit);
}

export interface Metrics {
  sessionsRun: number;
  directPaid: number;
  rescued: number;
  aborted: number;
  paused: number;
  rescuedRevenuePaise: number;
  ownCostDiscountPaise: number;
  fundedDiscountSessions: number;
  lostRevenuePaise: number;
}

export function computeMetrics(): Metrics {
  const m: Metrics = {
    sessionsRun: records.length,
    directPaid: 0,
    rescued: 0,
    aborted: 0,
    paused: 0,
    rescuedRevenuePaise: 0,
    ownCostDiscountPaise: 0,
    fundedDiscountSessions: 0,
    lostRevenuePaise: 0,
  };
  for (const r of [...records].reverse()) {
    if (r.outcome === "DIRECT_PAID") m.directPaid += 1;
    else if (r.outcome === "PAID") {
      m.rescued += 1;
      m.rescuedRevenuePaise += r.finalTotalPaise ?? 0;
      m.ownCostDiscountPaise += r.merchantCostPaise;
      if (r.fundedBy && r.fundedBy !== "merchant_margin" && r.fundedBy !== "merchant_marketing") {
        m.fundedDiscountSessions += 1;
      }
    } else if (r.outcome === "ABORTED") {
      m.aborted += 1;
      m.lostRevenuePaise += r.cartTotalPaise;
    } else if (r.outcome === "PAUSED_FOR_HUMAN") m.paused += 1;
  }
  return m;
}
