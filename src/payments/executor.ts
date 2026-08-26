import type { Rail } from "../types/mandate.js";
import { createRazorpayClient, credentialsFromEnv, type RazorpayClient } from "../razorpay/client.js";

export interface PaymentResult {
  ok: boolean;
  rail: Rail;
  errorCode: string | null;
  razorpayOrderId?: string | undefined;
  executor: "simulated" | "razorpay";
  replayed?: boolean | undefined;
}

export interface PaymentOptions {
  failRails?: Rail[];
  latencyMs?: number;
}

export interface ChargeInput {
  rail: Rail;
  amountPaise: number;
  idempotencyKey: string;
  receiptId: string;
  notes?: Record<string, string>;
}

export interface PaymentExecutor {
  readonly name: "simulated" | "razorpay";
  charge(input: ChargeInput, opts?: PaymentOptions | undefined): Promise<PaymentResult>;
}

export function simulatePayment(rail: Rail, opts: PaymentOptions = {}): PaymentResult {
  const failed = opts.failRails?.includes(rail) ?? false;
  return failed
    ? { ok: false, rail, errorCode: "PAYMENT_DECLINED", executor: "simulated" }
    : { ok: true, rail, errorCode: null, executor: "simulated" };
}

export class SimulatedExecutor implements PaymentExecutor {
  readonly name = "simulated" as const;
  private replayCache = new Map<string, PaymentResult>();

  async charge(input: ChargeInput, opts: PaymentOptions = {}): Promise<PaymentResult> {
    const cached = this.replayCache.get(input.idempotencyKey);
    if (cached) {
      return { ...cached, replayed: true };
    }
    const result = simulatePayment(input.rail, opts);
    if (result.ok) {
      this.replayCache.set(input.idempotencyKey, result);
    }
    return result;
  }
}

export class RazorpayExecutor implements PaymentExecutor {
  readonly name = "razorpay" as const;
  private orderIds = new Map<string, string>();
  private replayCache = new Map<string, PaymentResult>();

  constructor(private readonly client: RazorpayClient) {}

  async charge(input: ChargeInput, opts: PaymentOptions = {}): Promise<PaymentResult> {
    const cached = this.replayCache.get(input.idempotencyKey);
    if (cached) {
      return { ...cached, replayed: true };
    }
    const orderId = await this.ensureOrder(input);
    if (!orderId) {
      return { ok: false, rail: input.rail, errorCode: "RAZORPAY_ORDER_FAILED", executor: "razorpay" };
    }
    const instrumentOutcome = simulatePayment(input.rail, opts);
    const result: PaymentResult = instrumentOutcome.ok
      ? { ok: true, rail: input.rail, errorCode: null, razorpayOrderId: orderId, executor: "razorpay" }
      : { ok: instrumentOutcome.ok, rail: input.rail, errorCode: instrumentOutcome.errorCode, razorpayOrderId: orderId, executor: "razorpay" };
    if (result.ok) {
      this.replayCache.set(input.idempotencyKey, result);
    }
    return result;
  }

  private async ensureOrder(input: ChargeInput): Promise<string | null> {
    const existing = this.orderIds.get(input.receiptId);
    if (existing) {
      return existing;
    }
    const result = await this.client.createOrder({
      amountPaise: input.amountPaise,
      receipt: input.receiptId,
      notes: { ...input.notes, settle_rail: input.rail, idempotency_key: input.idempotencyKey },
    });
    if (!result.ok) {
      return null;
    }
    this.orderIds.set(input.receiptId, result.data.id);
    return result.data.id;
  }
}

export function defaultExecutor(): PaymentExecutor {
  const client = createRazorpayClient(credentialsFromEnv());
  return client.live ? new RazorpayExecutor(client) : new SimulatedExecutor();
}
