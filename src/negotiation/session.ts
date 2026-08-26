import type { Mandate } from "../types/mandate.js";
import type { CartState } from "../types/messages.js";
import type { OfferPolicy, ReleaseLedgerEntry } from "../types/policy.js";
import { AuditLedger } from "../audit/ledger.js";
import { buildCounterOffer } from "../merchant/engine.js";
import { decideOnOffer, type OfferContextInput } from "../buyer/agent.js";
import { SimulatedExecutor, type PaymentExecutor } from "../payments/executor.js";
import { evaluateCrossSell } from "../buyer/crosssell-decision.js";
import { cartHash } from "../buyer/parser.js";
import { pseudonymize } from "../buyer/memory.js";
import { signTip, type SigningKeyPair } from "../audit/signing.js";

export interface TipSignature {
  hash: string;
  signature: string;
}

export interface SessionInput {
  mandate: Mandate;
  cart: CartState;
  policy: OfferPolicy;
  releaseLedger: ReleaseLedgerEntry[];
  buyerContext: Omit<OfferContextInput, "offeredRail" | "swapToSku">;
  failRails?: string[] | undefined;
  offerTtlMs?: number | undefined;
  executor?: PaymentExecutor;
  campaigns?: import("../types/catalog.js").FundedCampaign[] | undefined;
  signingKeys?: SigningKeyPair | undefined;
  now: Date;
}

export interface SessionOutcome {
  sessionId: string;
  outcome: "PAID" | "ABORTED" | "PAUSED_FOR_HUMAN" | "DIRECT_PAID";
  finalTotalPaise: number | null;
  reason: string | null;
  paidVia: string | null;
  razorpayOrderId: string | null;
  paymentExecutor: "simulated" | "razorpay";
  tipSignatures: { buyer: TipSignature | null; merchant: TipSignature | null };
  buyerLedger: AuditLedger;
  merchantLedger: AuditLedger;
}

const MAX_PAYMENT_ATTEMPTS = 3;

export async function runSession(input: SessionInput): Promise<SessionOutcome> {
  const { mandate, cart, now } = input;
  const sessionId = cart.sessionId;
  const userIdHash = pseudonymize(mandate.userId);
  const buyerLedger = new AuditLedger("buyer");
  const merchantLedger = new AuditLedger("merchant");
  const executor = input.executor ?? new SimulatedExecutor();
  const keys = input.signingKeys;

  buyerLedger.append("MANDATE_BOUND", { mandateId: mandate.mandateId, capPaise: mandate.hardCapPaise, flexRule: mandate.flexRule }, now);
  buyerLedger.append("CART_CONSENT", { cartHash: mandate.cartHashAtConsent }, now);

  if (!cartDrifted(mandate, cart)) {
    return finish(sessionId, "ABORTED", null, "CART_DRIFT", null, null, executor.name, buyerLedger, merchantLedger, now, "Cart changed after consent — refusing to pay stale prices.", keys);
  }

  if (cart.totalPaise <= mandate.hardCapPaise) {
    const crossSell = evaluateCrossSell(mandate, cart.items, input.buyerContext.affinityTopBrands);
    let payableItems = cart.items;
    let payableTotal = cart.totalPaise;

    if (crossSell.offered && crossSell.suggestion) {
      buyerLedger.append("CROSS_SELL_OFFERED", { sku: crossSell.suggestion.sku, title: crossSell.suggestion.title, reason: crossSell.suggestion.reason }, now);
      merchantLedger.append("CROSS_SELL_OFFERED", { sessionId, sku: crossSell.suggestion.sku }, now);
    }
    if (crossSell.accepted && crossSell.suggestion) {
      payableItems = [...cart.items, { sku: crossSell.suggestion.sku, qty: 1 }];
      payableTotal = cart.totalPaise + crossSell.suggestion.pricePaise;
      const reconsentedHash = cartHash(payableItems);
      buyerLedger.append("CROSS_SELL_ACCEPTED", { sku: crossSell.suggestion.sku, newTotalPaise: payableTotal, basis: crossSell.basis, reconsentedHash }, now);
      merchantLedger.append("CROSS_SELL_ACCEPTED", { sessionId, sku: crossSell.suggestion.sku, incrementalRevenuePaise: crossSell.suggestion.pricePaise }, now);
      buyerLedger.append("CART_RECONSENTED", { oldHash: mandate.cartHashAtConsent, newHash: reconsentedHash }, now);
    } else if (crossSell.offered && crossSell.declineReason) {
      buyerLedger.append("CROSS_SELL_DECLINED", { reason: crossSell.declineReason }, now);
    }

    const payment = await attemptPayment(executor, mandate.allowedRails, input.failRails ?? [], payableTotal, sessionId, buyerLedger, now);
    if (payment.ok) {
      const upsold = payableTotal > cart.totalPaise;
      return finish(sessionId, "DIRECT_PAID", payableTotal, null, payment.rail, payment.razorpayOrderId ?? null, executor.name, buyerLedger, merchantLedger, now, `${upsold ? "Attachment accepted within your cap — " : ""}Total ₹${(payableTotal / 100).toFixed(0)} within cap. Paid directly.${upsold ? ` (+₹${((payableTotal - cart.totalPaise) / 100).toFixed(0)} attached)` : ""}`, keys);
    }
    return finish(sessionId, "ABORTED", null, "PAYMENT_DECLINED", null, null, executor.name, buyerLedger, merchantLedger, now, "All payment rails declined.", keys);
  }

  const gapPaise = cart.totalPaise - mandate.hardCapPaise;
  buyerLedger.append("INTENT_BLOCKED", { reason: "BUDGET_EXCEEDED", gapPaise, totalPaise: cart.totalPaise }, now);
  merchantLedger.append("RESCUE_REQUEST", { sessionId, requiredDiscountPaise: gapPaise, cartTotalPaise: cart.totalPaise }, now);

  const wf = buildCounterOffer({
    cart,
    requiredDiscountPaise: gapPaise,
    policy: input.policy,
    ledger: input.releaseLedger,
    userIdHash,
    buyerAllowedRails: mandate.allowedRails,
    now,
    offerTtlMs: input.offerTtlMs,
    campaigns: input.campaigns,
  });
  merchantLedger.append(
    wf.offer ? "OFFER_RELEASED" : "NO_OFFER",
    {
      sessionId,
      waterfallAttempts: wf.attempts.map((a) => ({ step: a.step, verdict: a.gate.trace.verdict })),
      offer: wf.offer,
    },
    now
  );

  if (!wf.offer) {
    return finish(sessionId, "ABORTED", null, "NO_FITTING_OPTION", null, null, executor.name, buyerLedger, merchantLedger, now, "Merchant could not make a profitable offer. I stopped instead of overpaying.", keys);
  }

  const decision = decideOnOffer(
    mandate,
    wf.offer,
    { ...input.buyerContext, offeredRail: wf.offer.mechanism.step === "rail_offer" ? wf.offer.mechanism.railOfferRail : null, swapToSku: wf.offer.mechanism.step === "bundle_swap" ? wf.offer.mechanism.swapToSku : null },
    now
  );
  buyerLedger.append("OFFER_EVALUATED", { offerId: wf.offer.offerId, accepted: decision.accepted, trace: decision.gate.trace, narration: decision.narration }, now);
  merchantLedger.append("BUYER_DECISION", { sessionId, offerId: wf.offer.offerId, accepted: decision.accepted }, now);

  if (!decision.accepted) {
    if (decision.gate.trace.verdict === "REJECT_INSUFFICIENT_MATCHES") {
      return finish(sessionId, "PAUSED_FOR_HUMAN", null, "OFFER_INVALID", null, null, executor.name, buyerLedger, merchantLedger, now, decision.narration, keys);
    }
    return finish(sessionId, "ABORTED", null, "BUDGET_EXCEEDED", null, null, executor.name, buyerLedger, merchantLedger, now, decision.narration, keys);
  }

  const acceptedOffer = wf.offer;
  const offeredRail = acceptedOffer.mechanism.step === "rail_offer" ? acceptedOffer.mechanism.railOfferRail : null;
  const railsToTry = offeredRail
    ? [offeredRail, ...mandate.allowedRails.filter((r) => r !== offeredRail)].slice(0, MAX_PAYMENT_ATTEMPTS)
    : mandate.allowedRails.slice(0, MAX_PAYMENT_ATTEMPTS);

  const payment = await attemptPayment(executor, railsToTry as never[], input.failRails ?? [], acceptedOffer.newTotalPaise, sessionId, buyerLedger, now, {
    offerId: acceptedOffer.offerId,
    mechanismStep: acceptedOffer.mechanism.step,
    discountPaise: cart.totalPaise - acceptedOffer.newTotalPaise,
  });
  if (!payment.ok) {
    return finish(sessionId, "ABORTED", null, "PAYMENT_DECLINED", null, payment.razorpayOrderId ?? null, executor.name, buyerLedger, merchantLedger, now, "Every allowed payment method was declined. Bounded retries exhausted — handing back to you.", keys);
  }

  if (acceptedOffer.merchantCostPaise > 0) {
    input.releaseLedger.push({ releasedAt: now.toISOString(), userIdHash, step: acceptedOffer.mechanism.step, discountPaise: acceptedOffer.merchantCostPaise });
    merchantLedger.append("DISCOUNT_LEDGERED", { sessionId, cost: acceptedOffer.merchantCostPaise, step: acceptedOffer.mechanism.step }, now);
  }

  return finish(sessionId, "PAID", acceptedOffer.newTotalPaise, null, payment.rail, payment.razorpayOrderId ?? null, executor.name, buyerLedger, merchantLedger, now, decision.narration, keys);
}

function cartDrifted(mandate: Mandate, cart: CartState): boolean {
  return cart.hash === mandate.cartHashAtConsent;
}

async function attemptPayment(
  executor: PaymentExecutor,
  rails: string[],
  failRails: string[],
  amountPaise: number,
  sessionId: string,
  buyerLedger: AuditLedger,
  now: Date,
  offerNotes?: { offerId: string; mechanismStep: string; discountPaise: number }
): Promise<{ ok: boolean; rail: string | null; razorpayOrderId?: string | undefined }> {
  for (const rail of rails) {
    const result = await executor.charge(
      {
        rail: rail as never,
        amountPaise,
        idempotencyKey: `${sessionId}:${offerNotes?.offerId ?? "direct"}:${rail}`,
        receiptId: sessionId,
        notes: { session_id: sessionId, ...(offerNotes ? { offer_id: offerNotes.offerId, mechanism: offerNotes.mechanismStep, discount_paise: String(offerNotes.discountPaise) } : {}) },
      },
      { failRails: failRails as never[] }
    );
    buyerLedger.append("PAYMENT_ATTEMPT", { sessionId, rail, ok: result.ok, errorCode: result.errorCode, executor: result.executor, razorpayOrderId: result.razorpayOrderId }, now);
    if (result.ok) {
      return { ok: true, rail, razorpayOrderId: result.razorpayOrderId };
    }
  }
  return { ok: false, rail: null };
}

function finish(
  sessionId: string,
  outcome: SessionOutcome["outcome"],
  finalTotalPaise: number | null,
  reason: string | null,
  paidVia: string | null,
  razorpayOrderId: string | null,
  paymentExecutor: SessionOutcome["paymentExecutor"],
  buyerLedger: AuditLedger,
  merchantLedger: AuditLedger,
  now: Date,
  narration: string,
  signingKeys?: SigningKeyPair | undefined
): SessionOutcome {
  buyerLedger.append("SETTLEMENT_RESULT", { sessionId, outcome, finalTotalPaise, reason, narration }, now);
  merchantLedger.append("SETTLEMENT_RESULT", { sessionId, outcome, finalTotalPaise }, now);
  const tipSignatures: SessionOutcome["tipSignatures"] = {
    buyer: signingKeys ? { hash: buyerLedger.tip ?? "", signature: signTip(buyerLedger.tip ?? "", signingKeys.privateKeyPem) } : null,
    merchant: signingKeys ? { hash: merchantLedger.tip ?? "", signature: signTip(merchantLedger.tip ?? "", signingKeys.privateKeyPem) } : null,
  };
  return { sessionId, outcome, finalTotalPaise, reason, paidVia, razorpayOrderId, paymentExecutor, tipSignatures, buyerLedger, merchantLedger };
}
