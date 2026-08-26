import { test } from "node:test";
import assert from "node:assert/strict";
import { runArmNoRescue, runArmFlatDiscount, runArmSettle, generateShoppers, type Shopper } from "../src/metrics/harness.js";
import { DEFAULT_POLICY } from "../src/types/policy.js";

function fixedShoppers(): Shopper[] {
  return generateShoppers(60, 7);
}

test("harness arms produce sane output", async () => {
  const shoppers = fixedShoppers();
  for (const r of [runArmNoRescue(shoppers), runArmFlatDiscount(shoppers), await runArmSettle(shoppers, DEFAULT_POLICY)]) {
    assert.ok(r.closes + r.lostSales + r.paused === shoppers.length, `${r.arm} miscounts outcomes`);
    assert.ok(r.conversionPct >= 0 && r.conversionPct <= 100);
    if (r.closes > 0) {
      assert.ok(r.grossProfitPaise > 0, `${r.arm} closing at a total loss is impossible with floor gates`);
    }
  }
});

test("settle converts at least as many as no-rescue", async () => {
  const shoppers = fixedShoppers();
  const base = runArmNoRescue(shoppers);
  const settle = await runArmSettle(shoppers, DEFAULT_POLICY);
  assert.ok(settle.closes >= base.closes, "rescue engine should never reduce conversions");
});

test("generation is reproducible per seed", () => {
  const a = generateShoppers(50, 99);
  const b = generateShoppers(50, 99);
  assert.deepEqual(a, b);
});
