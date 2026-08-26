import { runSession } from "../negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../buyer/parser.js";
import { decideOnOffer } from "../buyer/agent.js";
import { CATALOG, productBySku, OFFER_SURFACE } from "../merchant/data.js";
import { DEFAULT_POLICY, type ReleaseLedgerEntry } from "../types/policy.js";
import type { CounterOffer } from "../types/catalog.js";
import { sha256 } from "../core/hash.js";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Shopper {
  id: string;
  sku: string;
  qty: number;
  capPaise: number;
  stretchPaise: number | null;
  prefersNike: boolean;
  prefersJockey: boolean;
}

export function generateShoppers(n: number, seed = 42): Shopper[] {
  const rng = mulberry32(seed);
  const shoppers: Shopper[] = [];
  for (let i = 0; i < n; i++) {
    const p = CATALOG[Math.floor(rng() * CATALOG.length)]!;
    const qty = rng() < 0.8 ? 1 : 2;
    const base = p.pricePaise * qty;
    const factor = 0.86 + rng() * 0.3;
    const capPaise = Math.round(base * factor);
    const hasFlex = rng() < 0.55;
    const stretchPaise = hasFlex ? Math.round(base * (0.03 + rng() * 0.06)) : null;
    const prefersNike = rng() < 0.4;
    const prefersJockey = rng() < 0.3;
    shoppers.push({ id: `u_${i}`, sku: p.sku, qty, capPaise, stretchPaise, prefersNike, prefersJockey });
  }
  return shoppers;
}

function mandateFor(s: Shopper) {
  const intentText =
    s.stretchPaise !== null && s.prefersNike
      ? `Get me this under ${(s.capPaise / 100).toFixed(0)}, can stretch by ${(s.stretchPaise / 100).toFixed(0)} if it's really Nike`
      : `Get me this under ${(s.capPaise / 100).toFixed(0)}`;
  const parsed = parseIntentDeterministic(intentText);
  return buildMandate(
    s.id,
    intentText,
    parsed,
    cartHash([{ sku: s.sku, qty: s.qty }]),
    { dpdpAcceptedAt: NOW.toISOString(), affinitySharing: "anonymized_topk" },
    NOW
  );
}

export interface ArmResult {
  arm: string;
  closes: number;
  conversionPct: number;
  revenuePaise: number;
  ownCostDiscountPaise: number;
  grossProfitPaise: number;
  lostSales: number;
  paused: number;
  attachedRevenuePaise?: number;
}

function emptyArm(arm: string): ArmResult {
  return { arm, closes: 0, conversionPct: 0, revenuePaise: 0, ownCostDiscountPaise: 0, grossProfitPaise: 0, lostSales: 0, paused: 0 };
}

const NOW = new Date("2026-08-24T10:00:00Z");

export function runArmNoRescue(shoppers: Shopper[]): ArmResult {
  const r = emptyArm("no_rescue");
  for (const s of shoppers) {
    const p = productBySku(s.sku)!;
    const total = p.pricePaise * s.qty;
    if (total <= s.capPaise) {
      r.closes += 1;
      r.revenuePaise += total;
      r.grossProfitPaise += total - p.costPaise * s.qty;
    } else {
      r.lostSales += 1;
    }
  }
  return finalize(r, shoppers.length);
}

export function runArmFlatDiscount(shoppers: Shopper[]): ArmResult {
  const r = emptyArm("flat_10_pct");
  for (const s of shoppers) {
    const p = productBySku(s.sku)!;
    const total = p.pricePaise * s.qty;
    const discounted = Math.round(total * 0.9);
    const mandate = mandateFor(s);
    const offer: CounterOffer = {
      offerId: `flat_${s.id}`,
      mechanism: { step: "price_cut" },
      newTotalPaise: discounted,
      merchantCostPaise: total - discounted,
      fundedBy: "merchant_margin",
      explanation: "Blanket 10% off",
      expiresAt: new Date(NOW.getTime() + 60000).toISOString(),
    };
    const decision = decideOnOffer(
      mandate,
      offer,
      { cartBrands: [p.brand], cartCategories: [p.category], affinityTopBrands: [], offeredRail: null, swapToSku: null },
      NOW
    );
    if (decision.accepted) {
      r.closes += 1;
      r.revenuePaise += discounted;
      r.ownCostDiscountPaise += total - discounted;
      r.grossProfitPaise += discounted - p.costPaise * s.qty;
    } else if (decision.gate.trace.verdict === "REJECT_INSUFFICIENT_MATCHES") {
      r.paused += 1;
    } else {
      r.lostSales += 1;
    }
  }
  return finalize(r, shoppers.length);
}

export async function runArmSettle(shoppers: Shopper[], policy = DEFAULT_POLICY): Promise<ArmResult> {
  const r = emptyArm("settle");
  r.attachedRevenuePaise = 0;
  const ledger: ReleaseLedgerEntry[] = [];
  const campaigns = structuredClone(OFFER_SURFACE.campaigns);
  for (const s of shoppers) {
    const p = productBySku(s.sku)!;
    const total = p.pricePaise * s.qty;
    const mandate = mandateFor(s);
    const result = await runSession({
      mandate,
      cart: { sessionId: `sim_${s.id}`, items: [{ sku: s.sku, qty: s.qty }], totalPaise: total, hash: sha256({ items: [{ sku: s.sku, qty: s.qty }] }) },
      policy,
      releaseLedger: ledger,
      buyerContext: { cartBrands: [p.brand], cartCategories: [p.category], affinityTopBrands: [...(s.prefersNike ? ["Nike"] : []), ...(s.prefersJockey ? ["Jockey"] : [])] },
      campaigns,
      now: NOW,
    });
    if (result.outcome === "PAID" || result.outcome === "DIRECT_PAID") {
      r.closes += 1;
      r.revenuePaise += result.finalTotalPaise ?? 0;
      const crossSellAccepted = result.merchantLedger.all().some((e) => e.kind === "CROSS_SELL_ACCEPTED");
      if (crossSellAccepted) {
        const acceptedEvent = result.merchantLedger.all().find((e) => e.kind === "CROSS_SELL_ACCEPTED");
        r.attachedRevenuePaise += ((acceptedEvent?.event as { incrementalRevenuePaise?: number })?.incrementalRevenuePaise ?? 0);
      }
      const offerEvent = result.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
      const offer = offerEvent ? (offerEvent.event as { offer?: { merchantCostPaise?: number } }).offer : undefined;
      r.ownCostDiscountPaise += offer?.merchantCostPaise ?? 0;
      r.grossProfitPaise += (result.finalTotalPaise ?? 0) - p.costPaise * s.qty;
    } else if (result.outcome === "PAUSED_FOR_HUMAN") {
      r.paused += 1;
    } else {
      r.lostSales += 1;
    }
  }
  return finalize(r, shoppers.length);
}

function finalize(r: ArmResult, n: number): ArmResult {
  r.conversionPct = Math.round((r.closes / n) * 1000) / 10;
  return r;
}

export function formatReport(results: ArmResult[]): string {
  const lines: string[] = [];
  lines.push("ARM".padEnd(14), "CLOSES", "CONV%", "REVENUE", "OWN-COST DISC", "GROSS PROFIT");
  lines.push("-".repeat(78));
  for (const r of results) {
    lines.push(
      r.arm.padEnd(14),
      String(r.closes).padEnd(6),
      `${r.conversionPct}%`.padEnd(6),
      `₹${(r.revenuePaise / 100).toLocaleString("en-IN")}`.padEnd(12),
      `₹${(r.ownCostDiscountPaise / 100).toLocaleString("en-IN")}`.padEnd(13),
      `₹${(r.grossProfitPaise / 100).toLocaleString("en-IN")}`
    );
  }
  return lines.join("\n");
}
