import { test } from "node:test";
import assert from "node:assert/strict";
import { runSession } from "../src/negotiation/session.js";
import { buildMandate, parseIntentDeterministic, cartHash } from "../src/buyer/parser.js";
import { DEFAULT_POLICY } from "../src/types/policy.js";
import type { ReleaseLedgerEntry } from "../src/types/policy.js";
import type { FundedCampaign } from "../src/types/catalog.js";
import { cartFor, buyerContextFor } from "../src/demo/fixtures.js";
import { rupees } from "../src/core/money.js";

/* The pre-existing concurrency test shares a release ledger but passes no campaigns, so it
 * could never catch a campaign-pool bug. These cover the pool itself. */

const now = new Date("2026-08-24T10:00:00Z");
const SKU = "nike-peg-41"; // module catalog: Rs4180, cost Rs2600

function mandateFor(id: string, capRupees: number) {
  const intentText = `Get me running shoes under ${capRupees}`;
  return buildMandate(id, intentText, parseIntentDeterministic(intentText),
    cartHash([{ sku: SKU, qty: 1 }]),
    { dpdpAcceptedAt: now.toISOString(), affinitySharing: "none" },
    new Date(now.getTime() - 60000));
}

/** One campaign, funded for exactly two draws. */
function pool(): FundedCampaign[] {
  return [{
    campaignId: "test_two_draws", label: "Two draw campaign",
    flatOffPaise: rupees(500), minCartPaise: rupees(3000), fundedBy: "brand",
    remainingBudgetPaise: rupees(1000),
    validTo: new Date(now.getTime() + 86400000).toISOString(),
  }];
}

async function runOne(id: string, campaigns: FundedCampaign[], ledger: ReleaseLedgerEntry[]) {
  return runSession({
    mandate: mandateFor(id, 3700), // Rs4180 cart vs Rs3700 cap => Rs480 gap, one campaign covers it
    cart: cartFor([{ sku: SKU, qty: 1 }]),
    policy: DEFAULT_POLICY,
    releaseLedger: ledger,
    buyerContext: buyerContextFor([{ sku: SKU, qty: 1 }]),
    campaigns,
    now,
  });
}

test("campaign pool depletes when the caller threads updatedCampaigns forward", async () => {
  let campaigns = pool();
  const ledger: ReleaseLedgerEntry[] = [];
  const steps: string[] = [];

  for (let i = 0; i < 3; i++) {
    const r = await runOne(`u_${i}`, campaigns, ledger);
    if (r.updatedCampaigns) campaigns = r.updatedCampaigns;
    const ev = r.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED" || e.kind === "NO_OFFER");
    const offer = (ev?.event as { offer?: { mechanism?: { step?: string } } })?.offer;
    steps.push(offer?.mechanism?.step ?? "NO_OFFER");
  }

  assert.deepEqual(steps.slice(0, 2), ["funded_campaign", "funded_campaign"],
    "first two buyers should be covered by the campaign");
  assert.notEqual(steps[2], "funded_campaign",
    "third buyer must fall through: the campaign is out of budget");
  assert.equal(campaigns[0]!.remainingBudgetPaise, 0, "budget fully drawn, never negative");
});

test("campaign budget is never drawn below zero by the engine", async () => {
  let campaigns = pool();
  const ledger: ReleaseLedgerEntry[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await runOne(`v_${i}`, campaigns, ledger);
    if (r.updatedCampaigns) campaigns = r.updatedCampaigns;
    assert.ok(campaigns[0]!.remainingBudgetPaise >= 0,
      `budget went negative on iteration ${i}: ${campaigns[0]!.remainingBudgetPaise}`);
  }
});

test("concurrent sessions handed the same snapshot each claim it — the caller must serialise", async () => {
  // runSession is pure with respect to campaigns: it returns a new array rather than mutating
  // the input. Callers that fan out on one snapshot therefore all see the budget as available.
  // This is why the API decrements through a guarded UPDATE instead of trusting the snapshot.
  const snapshot = pool();
  const ledger: ReleaseLedgerEntry[] = [];
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) => runOne(`w_${i}`, snapshot, ledger)));

  const claimed = results.filter((r) => {
    const ev = r.merchantLedger.all().find((e) => e.kind === "OFFER_RELEASED");
    const offer = (ev?.event as { offer?: { mechanism?: { step?: string } } })?.offer;
    return offer?.mechanism?.step === "funded_campaign";
  });

  assert.ok(claimed.length > 2,
    "expected the un-serialised fan-out to over-claim a two-draw budget; if this fails the " +
    "engine started serialising internally and the API guard may be redundant");
  assert.equal(snapshot[0]!.remainingBudgetPaise, rupees(1000),
    "the input snapshot must not be mutated");
});
