export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface RazorpayOrderInput {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export type RazorpayResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const API_BASE = process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com/v1";

export function credentialsFromEnv(): RazorpayCredentials | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return null;
  }
  return { keyId, keySecret };
}

export interface RazorpayClient {
  readonly live: boolean;
  createOrder(input: RazorpayOrderInput): Promise<RazorpayResult<RazorpayOrder>>;
  fetchOrder(orderId: string): Promise<RazorpayResult<RazorpayOrder>>;
}

export function createRazorpayClient(creds: RazorpayCredentials | null): RazorpayClient {
  if (!creds) {
    return { live: false, createOrder: noopCreate, fetchOrder: noopFetch };
  }

  const auth = `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;

  async function request<T>(method: string, path: string, body?: unknown): Promise<RazorpayResult<T>> {
    let res: Response;
    const headers: Record<string, string> = { authorization: auth };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      return { ok: false, status: 0, error: `network: ${(e as Error).message}` };
    }
    const payload = (await res.json().catch(() => null)) as (T & { error?: { description?: string } }) | null;
    if (!res.ok) {
      const description = payload?.error?.description ?? `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: description };
    }
    if (!payload) {
      return { ok: false, status: res.status, error: "empty response" };
    }
    return { ok: true, data: payload };
  }

  return {
    live: true,
    createOrder: (input) =>
      request<RazorpayOrder>("POST", "/orders", {
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes ?? {},
      }),
    fetchOrder: (orderId) => request<RazorpayOrder>("GET", `/orders/${orderId}`),
  };
}

async function noopCreate(): Promise<RazorpayResult<RazorpayOrder>> {
  return { ok: false, status: -1, error: "razorpay disabled: no credentials" };
}

async function noopFetch(): Promise<RazorpayResult<RazorpayOrder>> {
  return { ok: false, status: -1, error: "razorpay disabled: no credentials" };
}
