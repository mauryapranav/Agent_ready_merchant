import { test } from "node:test";
import assert from "node:assert/strict";
import { rupees, formatINR, pct } from "../src/core/money.js";

test("rupees converts to paise without float drift", () => {
  assert.equal(rupees(1080.5), 108050);
  assert.equal(rupees(0.1 + 0.2), 30);
});

test("formatINR renders Indian grouping", () => {
  assert.equal(formatINR(123456789), "₹12,34,567.89");
  assert.equal(formatINR(-500), "-₹5.00");
});

test("pct handles zero denominator", () => {
  assert.equal(pct(10, 0), 0);
});
