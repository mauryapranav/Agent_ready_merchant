import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntentDeterministic, ParseError, buildMandate } from "../src/buyer/parser.js";
import { rupees } from "../src/core/money.js";

test("extracts cap, brand condition, and stretch", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹4000, can stretch by 300 if it's really Nike");
  assert.equal(p.capPaise, rupees(4000));
  assert.equal(p.maxStretchPaise, rupees(300));
  assert.ok(p.softCriteria.some((c) => c.kind === "brand" && c.value === "Nike"));
  assert.ok(!p.softCriteria.some((c) => c.kind === "category"), "words outside the if-clause are intent, not flex conditions");
});

test("conditions inside the if-clause become criteria", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹4000, can stretch by 300 if it's really Nike shoes");
  assert.ok(p.softCriteria.some((c) => c.kind === "brand" && c.value === "Nike"));
  assert.ok(p.softCriteria.some((c) => c.kind === "category" && c.value === "shoes"));
});

test("handles 'k' shorthand and missing stretch", () => {
  const p = parseIntentDeterministic("socks below 2k");
  assert.equal(p.capPaise, rupees(2000));
  assert.equal(p.maxStretchPaise, null);
});

test("no budget at all is a parse error", () => {
  assert.throws(() => parseIntentDeterministic("buy me shoes"), ParseError);
});

test("rails default to upi+card, respect mentions", () => {
  const p = parseIntentDeterministic("headphones under ₹3000 pay via upi");
  assert.deepEqual(p.allowedRails, ["upi"]);
});

test("buildMandate omits flexRule when no stretch", () => {
  const parsed = parseIntentDeterministic("shoes under ₹4000");
  const m = buildMandate("u_1", "shoes under ₹4000", parsed, "hash", { dpdpAcceptedAt: null, affinitySharing: "none" }, new Date());
  assert.equal(m.flexRule, null);
  assert.ok(m.mandateId.startsWith("mdt_"));
});

test("extras clause feeds attachmentCriteria, independent of flex", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹5000. Extras only from Jockey.");
  assert.deepEqual(p.attachmentCriteria, [{ kind: "brand", value: "Jockey" }]);
  const m = buildMandate("u_1", "extras test", p, "hash", { dpdpAcceptedAt: null, affinitySharing: "none" }, new Date());
  assert.equal(m.flexRule, null);
  assert.deepEqual(m.attachmentCriteria, [{ kind: "brand", value: "Jockey" }]);
});

test("extras and stretch-if can coexist", () => {
  const p = parseIntentDeterministic("shoes under ₹4000, can stretch by 100 if it's really Nike. Extras only from Jockey accessories.");
  assert.ok(p.softCriteria.some((c) => c.kind === "brand" && c.value === "Nike"));
  assert.ok(p.attachmentCriteria.some((c) => c.kind === "brand" && c.value === "Jockey"));
  assert.ok(p.attachmentCriteria.some((c) => c.kind === "category" && c.value === "accessories"));
});

test("no extras clause means empty attachmentCriteria", () => {
  const p = parseIntentDeterministic("shoes under ₹4000, can stretch by 100 if it's really Nike");
  assert.deepEqual(p.attachmentCriteria, []);
});

test("natural extras phrasing 'extra stuff only if they're from X' lands in attachmentCriteria", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹6000 and spend extra stuff only if they're from Nike");
  assert.deepEqual(p.attachmentCriteria, [{ kind: "brand", value: "Nike" }]);
  assert.equal(p.maxStretchPaise, null);
  const m = buildMandate("u_1", "natural extras test", p, "hash", { dpdpAcceptedAt: null, affinitySharing: "none" }, new Date());
  assert.equal(m.flexRule, null);
  assert.deepEqual(m.attachmentCriteria, [{ kind: "brand", value: "Nike" }]);
});

test("natural extras phrasing 'extra items only from X' works too", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹6000. Extra items only from Puma.");
  assert.deepEqual(p.attachmentCriteria, [{ kind: "brand", value: "Puma" }]);
});

test("natural extras phrasing with category word", () => {
  const p = parseIntentDeterministic("Get me running shoes under ₹6000. Extra stuff only if they're accessories.");
  assert.deepEqual(p.attachmentCriteria, [{ kind: "category", value: "accessories" }]);
});
