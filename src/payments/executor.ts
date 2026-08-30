import type { Rail } from "../types/mandate.js";
import { createRazorpayClient, credentialsFromEnv, type RazorpayClient, type RazorpayCredentials } from "../razorpay/client.js";
import { getRazorpayClient, createCheckoutSession, verifyPaymentSignature } from "./checkout.js";

export interface PaymentResult {
  ok: boolean;
  rail: Rail;
  errorCode: string | null;
  razorpayOrderId?: string | undefined;
  executor: "simulated" | "razorpay";
  checkoutUrl?: string | undefined;
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

  constructor(
    private readonly client: RazorpayClient,
    private readonly creds: RazorpayCredentials | null
  ) {}

  async charge(input: ChargeInput, opts: PaymentOptions = {}): Promise<PaymentResult> {
    const cached = this.replayCache.get(input.idempotencyKey);
    if (cached) {
      return { ...cached, replayed: true };
    }

    const existingOrderId = this.orderIds.get(input.receiptId);
    let orderId = existingOrderId;

    if (!orderId) {
      try {
        const checkout = await createCheckoutSession(this.client, this.creds, {
          amountPaise: input.amountPaise,
          receipt: input.receiptId,
          rail: input.rail,
          notes: { ...input.notes, settle_rail: input.rail, idempotency_key: input.idempotencyKey },
        });
        orderId = checkout.orderId;
        this.orderIds.set(input.receiptId, orderId);
      } catch (error) {
        console.error("Failed to create checkout session:", error);
        return { ok: false, rail: input.rail, errorCode: "RAZORPAY_ORDER_FAILED", executor: "razorpay" };
      }
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

  async verifyPayment(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    return verifyPaymentSignature(this.client, this.creds, orderId, paymentId, signature);
  }
}

export function defaultExecutor(): PaymentExecutor {
  const creds = credentialsFromEnv();
  const client = createRazorpayClient(creds);
  return client.live ? new RazorpayExecutor(client, creds) : new SimulatedExecutor();
}