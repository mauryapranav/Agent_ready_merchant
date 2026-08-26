import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.SETTLE_NO_LISTEN = "1";
const { server } = await import("../src/server/api.js");

delete process.env.LLM_API_KEY;
delete process.env.OPENAI_API_KEY;

const port = await new Promise<number>((resolve, reject) => {
  server.listen(0, () => {
    const addr = server.address();
    if (addr && typeof addr === "object") resolve(addr.port);
    else reject(new Error("no address"));
  });
});

after(() => {
  server.close();
});

const BUDGET_PAISE = 20000;

const body = {
  intentText: "Get me running shoes under ₹4000",
  skus: [{ sku: "nike-peg-41", qty: 1 }],
  policyOverrides: { dailyReleaseBudgetPaise: BUDGET_PAISE },
  waterfallDisabled: ["funded_campaign", "rail_offer", "bundle_swap"],
};

async function postSession(): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

interface FeedRecord {
  sessionId: string;
  outcome: string;
  merchantCostPaise: number;
  chainsVerified: boolean;
}

async function getFeed(): Promise<FeedRecord[]> {
  const res = await fetch(`http://127.0.0.1:${port}/api/feed`);
  const data = (await res.json()) as { records: FeedRecord[] };
  return data.records;
}

test("release ledger binds across sessions: daily budget survives multiple HTTP requests", async () => {
  const r1 = await postSession();
  assert.equal(r1.outcome, "PAID", `first session should rescue within fresh budget, got ${r1.outcome}`);

  const r2 = await postSession();
  assert.notEqual(r2.outcome, "PAID", "second session must not rescue after budget exhausted by first");

  const records = await getFeed();
  const mine = records.filter((r) => r.sessionId === r1.sessionId || r.sessionId === r2.sessionId);
  assert.equal(mine.length, 2);

  const totalOwnCost = mine.reduce((sum, r) => sum + r.merchantCostPaise, 0);
  assert.ok(totalOwnCost > 0, "expected some own-money discount to have been spent");
  assert.ok(
    totalOwnCost <= BUDGET_PAISE,
    `cross-session budget breached: spent ${totalOwnCost} against cap ${BUDGET_PAISE}`
  );

  for (const rec of mine) {
    assert.equal(rec.chainsVerified, true);
  }
});
