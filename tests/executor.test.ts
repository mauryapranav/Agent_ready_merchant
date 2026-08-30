import { test } from "node:test";
import assert from "node:assert/strict";
import { RazorpayExecutor, SimulatedExecutor, defaultExecutor } from "../src/payments/executor.js";
import type { RazorpayClient, RazorpayOrder, RazorpayResult } from "../src/razorpay/client.js";

const fakeClient = (fail: boolean): RazorpayClient & { calls: number } => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    live: true,
    async createOrder(input): Promise<RazorpayResult<RazorpayOrder>> {
      if (fail) {
        return { ok: false, status: 400, error: "bad amount" };
      }
      calls += 1;
      return { ok: true, data: { id: `order_test_${calls}`, amount: input.amountPaise, currency: "INR", status: "created", receipt: input.receipt } };
    },
    async fetchOrder(): Promise<RazorpayResult<RazorpayOrder>> {
      throw new Error("not used");
    },
  };
};

test("razorpay executor creates one order per receipt and reuses it across rails", async () => {
  const client = fakeClient(false);
  const creds = { keyId: "test_key", keySecret: "test_secret" };
  const exec = new RazorpayExecutor(client, creds);
  const opts = { failRails: ["upi" as const] };
  const first = await exec.charge({ rail: "upi", amountPaise: 388000, idempotencyKey: "k1", receiptId: "s_1" }, opts);
  assert.equal(first.ok, false);
  assert.equal(first.razorpayOrderId, "order_test_1");
  const second = await exec.charge({ rail: "card", amountPaise: 388000, idempotencyKey: "k2", receiptId: "s_1" }, opts);
  assert.equal(second.ok, true);
  assert.equal(second.razorpayOrderId, "order_test_1");
  assert.equal(second.executor, "razorpay");
  assert.equal(client.calls, 1);
});

test("order-creation failure surfaces as RAZORPAY_ORDER_FAILED without crashing", async () => {
  const creds = { keyId: "test_key", keySecret: "test_secret" };
  const exec = new RazorpayExecutor(fakeClient(true), creds);
  const r = await exec.charge({ rail: "upi", amountPaise: 100, idempotencyKey: "k", receiptId: "s_x" }, {});
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "RAZORPAY_ORDER_FAILED");
});

test("simulated executor keeps deterministic rail behaviour", async () => {
  const exec = new SimulatedExecutor();
  const ok = await exec.charge({ rail: "upi", amountPaise: 100, idempotencyKey: "a", receiptId: "s" }, {});
  const bad = await exec.charge({ rail: "upi", amountPaise: 100, idempotencyKey: "b", receiptId: "s" }, { failRails: ["upi"] });
  assert.equal(ok.ok, true);
  assert.equal(bad.errorCode, "PAYMENT_DECLINED");
});

test("defaultExecutor falls back to simulated without credentials", () => {
  const saved = { ...process.env };
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  try {
    assert.equal(defaultExecutor().name, "simulated");
  } finally {
    Object.assign(process.env, saved);
  }
});
