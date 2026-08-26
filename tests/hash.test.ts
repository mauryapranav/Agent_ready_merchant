import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, sha256, chainHash } from "../src/core/hash.js";

test("canonicalJson is key-order independent", () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test("sha256 is stable and deterministic", () => {
  assert.equal(sha256({ x: 1 }), sha256({ x: 1 }));
  assert.notEqual(sha256({ x: 1 }), sha256({ x: 2 }));
});

test("chainHash binds previous hash", () => {
  const e1 = chainHash(null, { seq: 1 });
  const e2a = chainHash(e1, { seq: 2 });
  const e2b = chainHash("different", { seq: 2 });
  assert.notEqual(e2a, e2b);
});
