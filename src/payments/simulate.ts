import type { Rail } from "../types/mandate.js";

export interface PaymentResult {
  ok: boolean;
  rail: Rail;
  errorCode: string | null;
}

export interface PaymentOptions {
  failRails?: Rail[];
  latencyMs?: number;
}

export function simulatePayment(rail: Rail, opts: PaymentOptions = {}): PaymentResult {
  const failed = opts.failRails?.includes(rail) ?? false;
  return failed ? { ok: false, rail, errorCode: "PAYMENT_DECLINED" } : { ok: true, rail, errorCode: null };
}
