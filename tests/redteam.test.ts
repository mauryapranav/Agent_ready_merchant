import { test } from "node:test";
import assert from "node:assert/strict";
import { runRedTeam, ADVERSARIAL_CORPUS, formatRedTeamReport } from "../src/metrics/redteam.js";

test("red-team corpus is non-trivial", () => {
  assert.ok(ADVERSARIAL_CORPUS.length >= 5);
  assert.ok(ADVERSARIAL_CORPUS.some((c) => c.attack === "prompt_injection"));
  assert.ok(ADVERSARIAL_CORPUS.some((c) => c.attack === "unbounded_stretch"));
});

test("deterministic gates hold against the full adversarial corpus: zero violations", async () => {
  const report = await runRedTeam({ llmIntents: 0 });
  assert.equal(report.llmGeneratedIntents, 0);
  assert.ok(report.adversarialSessions >= 5, `expected most corpus cases to reach a session, got ${report.adversarialSessions}`);
  assert.deepEqual(report.violations, []);
  assert.equal(report.gateViolations, 0);
  const out = formatRedTeamReport(report);
  assert.match(out, /GATE VIOLATIONS\s+: 0/);
});
