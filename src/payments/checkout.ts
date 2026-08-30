import { createRazorpayClient, credentialsFromEnv, type RazorpayClient, type RazorpayCredentials } from "../razorpay/client.js";
import type { Rail } from "../types/mandate.js";
import { pool, query, transaction } from "../db/client.js";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutSessionData {
  sessionId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  receipt: string;
  rail: Rail;
  notes: Record<string, string>;
  expiresAt: Date;
}

export interface CheckoutOptions {
  amountPaise: number;
  receipt: string;
  rail: Rail;
  notes?: Record<string, string>;
  customerId?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export async function createCheckoutSession(
  client: RazorpayClient,
  creds: RazorpayCredentials | null,
  opts: CheckoutOptions
): Promise<{ orderId: string; checkoutUrl: string }> {
  const orderResult = await client.createOrder({
    amountPaise: opts.amountPaise,
    receipt: opts.receipt,
    notes: {
      ...opts.notes,
      settle_rail: opts.rail,
      settle_checkout: "true",
    },
  });

  if (!orderResult.ok) {
    throw new Error(`Failed to create Razorpay order: ${orderResult.error ?? "Unknown error"}`);
  }

  const orderId = orderResult.data.id;
  const keyId = creds?.keyId ?? process.env.RAZORPAY_KEY_ID ?? "test_key";
  const checkoutUrl = `https://api.razorpay.com/v1/checkout/embedded?order_id=${orderId}&key_id=${keyId}`;

  return { orderId, checkoutUrl };
}

export async function verifyPaymentSignature(
  client: RazorpayClient,
  creds: RazorpayCredentials | null,
  orderId: string,
  paymentId: string,
  signature: string
): Promise<boolean> {
  const keySecret = creds?.keySecret ?? process.env.RAZORPAY_KEY_SECRET ?? "";
  const expectedSignature = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}

export interface WebhookEvent {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        method: string;
        email: string;
        contact: string;
        notes: Record<string, string>;
        created_at: number;
        error_code?: string;
      };
    };
    order?: {
      entity: {
        id: string;
        amount: number;
        currency: string;
        receipt: string;
        notes: Record<string, string>;
        status: string;
        created_at: number;
      };
    };
  };
  created_at: number;
}

export function verifyWebhookSignature(
  webhookSecret: string,
  body: string,
  signature: string
): boolean {
  const expectedSignature = createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  return timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}

export async function handlePaymentCaptured(event: WebhookEvent, merchantId: string): Promise<void> {
  const payment = event.payload.payment?.entity;
  if (!payment) return;

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const amount = payment.amount;
  const method = payment.method;
  const notes = payment.notes ?? {};

  const sessionId = notes.settle_session_id ?? notes.idempotency_key?.split(":")[0];
  const settleRail = notes.settle_rail as Rail | undefined;

  if (!sessionId) {
    console.warn("Payment captured but no session ID in notes", { orderId, paymentId });
    return;
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE sessions SET status = 'paid', final_total_paise = $1, paid_via = $2, razorpay_order_id = $3, updated_at = NOW()
       WHERE session_id = $4 AND razorpay_order_id = $5`,
      [amount, method, orderId, sessionId, orderId]
    );

    await client.query(
      `INSERT INTO audit_events (ledger_type, session_id, event_kind, event_data, chain_hash, created_at)
       VALUES ('merchant', $1, 'PAYMENT_CAPTURED', $2, $3, NOW())`,
      [sessionId, JSON.stringify({ paymentId, orderId, amount, method, rail: settleRail }), ""]
    );
  });
}

export async function handlePaymentFailed(event: WebhookEvent, merchantId: string): Promise<void> {
  const payment = event.payload.payment?.entity;
  if (!payment) return;

  const orderId = payment.order_id;
  const paymentId = payment.id;
  const errorCode = payment.error_code ?? "PAYMENT_FAILED";
  const notes = payment.notes ?? {};

  const sessionId = notes.settle_session_id ?? notes.idempotency_key?.split(":")[0];
  const settleRail = notes.settle_rail as Rail | undefined;

  if (!sessionId) {
    console.warn("Payment failed but no session ID in notes", { orderId, paymentId });
    return;
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE sessions SET status = 'aborted', outcome = 'ABORTED', reason = 'PAYMENT_DECLINED', updated_at = NOW()
       WHERE session_id = $1 AND razorpay_order_id = $2`,
      [sessionId, orderId]
    );

    await client.query(
      `INSERT INTO audit_events (ledger_type, session_id, event_kind, event_data, chain_hash, created_at)
       VALUES ('merchant', $1, 'PAYMENT_FAILED', $2, $3, NOW())`,
      [sessionId, JSON.stringify({ paymentId, orderId, errorCode, rail: settleRail }), ""]
    );
  });
}

export async function handleOrderPaid(event: WebhookEvent, merchantId: string): Promise<void> {
  const order = event.payload.order?.entity;
  if (!order) return;

  const orderId = order.id;
  const amount = order.amount;
  const receipt = order.receipt;
  const notes = order.notes ?? {};

  const sessionId = notes.settle_session_id ?? receipt;

  if (!sessionId) {
    console.warn("Order paid but no session ID", { orderId, receipt });
    return;
  }

  await transaction(async (client) => {
    await client.query(
      `UPDATE sessions SET status = 'paid', final_total_paise = $1, razorpay_order_id = $2, updated_at = NOW()
       WHERE session_id = $3 AND razorpay_order_id = $2`,
      [amount, orderId, sessionId]
    );
  });
}

export async function processWebhookEvent(event: WebhookEvent, merchantId: string): Promise<void> {
  switch (event.event) {
    case "payment.captured":
      await handlePaymentCaptured(event, merchantId);
      break;
    case "payment.failed":
      await handlePaymentFailed(event, merchantId);
      break;
    case "order.paid":
      await handleOrderPaid(event, merchantId);
      break;
    default:
      console.log(`Unhandled webhook event: ${event.event}`);
  }
}

export async function getRazorpayClient(): Promise<{ client: RazorpayClient; creds: RazorpayCredentials | null }> {
  const creds = credentialsFromEnv();
  const client = createRazorpayClient(creds);
  return { client, creds };
}