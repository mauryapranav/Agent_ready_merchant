import { test } from "node:test";
import assert from "node:assert/strict";
import { parsedIntentFromLlm, parseIntentWithFallback, ParseError } from "../src/buyer/parser.js";

test("llm intent validator rejects junk caps", () => {
  for (const cap of [-5, 0, "4000", Number.NaN, null, undefined, 999_999]) {
    assert.throws(() => parsedIntentFromLlm({ cap }), ParseError, `cap=${String(cap)} must be rejected`);
  }
});

test("llm validator rejects negative stretch and non-object payloads", () => {
  assert.throws(() => parsedIntentFromLlm({ cap: 4000, max_stretch: -1 }), ParseError);
  assert.throws(() => parsedIntentFromLlm(null), ParseError);
  assert.throws(() => parsedIntentFromLlm([1, 2]), ParseError);
  assert.throws(() => parsedIntentFromLlm("cap 4000"), ParseError);
});

test("llm stretch above ceiling rejected; zero allowed", () => {
  assert.throws(() => parsedIntentFromLlm({ cap: 4000, max_stretch: 999_999 }), ParseError);
  const p = parsedIntentFromLlm({ cap: 4000, max_stretch: 0 });
  assert.equal(p.maxStretchPaise, 0);
});

test("llm validator contains hallucinations: unknown brands/categories/rails dropped", () => {
  const p = parsedIntentFromLlm({
    cap: 4000,
    max_stretch: 200,
    brands: ["Nike", "Supercell", 42],
    categories: ["shoes", "groceries"],
    rails: ["upi", "carrier-pigeon"],
    extras_brands: ["JOCKEY"],
    extras_categories: [],
  });
  assert.deepEqual(p.softCriteria, [{ kind: "brand", value: "Nike" }, { kind: "category", value: "shoes" }]);
  assert.deepEqual(p.allowedRails, ["upi"]);
  assert.deepEqual(p.attachmentCriteria, [{ kind: "brand", value: "Jockey" }]);
  assert.equal(p.capPaise, 400000);
  assert.equal(p.maxStretchPaise, 20000);
});

test("empty rails after filtering default to upi+card", () => {
  const p = parsedIntentFromLlm({ cap: 2500, max_stretch: null, rails: [], brands: [] });
  assert.deepEqual(p.allowedRails, ["upi", "card"]);
  assert.equal(p.softCriteria.length, 0);
  assert.equal(p.requireSoftMatches, 0);
});

test("requireSoftMatches recomputed deterministically from criteria count", () => {
  const withFlex = parsedIntentFromLlm({ cap: 5000, max_stretch: 300, brands: ["Nike", "Puma"], categories: ["shoes"] });
  assert.equal(withFlex.requireSoftMatches, 2);
  const noFlex = parsedIntentFromLlm({ cap: 5000, max_stretch: null, brands: ["Nike", "Puma"], categories: ["shoes"] });
  assert.equal(noFlex.requireSoftMatches, 3);
});

test("fallback: no credentials configured → deterministic parser wins", async () => {
  const prevLlm = process.env.LLM_API_KEY;
  const prevOpenai = process.env.OPENAI_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { parsed, parsedBy } = await parseIntentWithFallback("Get me running shoes under ₹5000. Extras only from Jockey.");
    assert.equal(parsedBy, "deterministic");
    assert.equal(parsed.capPaise, 500000);
    assert.deepEqual(parsed.attachmentCriteria, [{ kind: "brand", value: "Jockey" }]);
  } finally {
    if (prevLlm !== undefined) process.env.LLM_API_KEY = prevLlm;
    if (prevOpenai !== undefined) process.env.OPENAI_API_KEY = prevOpenai;
  }
});

test("fallback: unreachable LLM endpoint degrades gracefully to deterministic", async () => {
  const { parsed, parsedBy } = await parseIntentWithFallback("Running shoes under ₹3000", {
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:9/v1",
  });
  assert.equal(parsedBy, "deterministic");
  assert.equal(parsed.capPaise, 300000);
});
