# Settle — Full Project Brief for Technical Review

> Purpose of this document: give any reviewer (human or LLM) a complete, self-contained understanding of what Settle is, why every piece exists, how it works internally, what has been proven, and what has not. Written to support professional-grade evaluation after the post-review upgrade pass (real Razorpay contact, honest metrics, cross-sell growth loop, ledger signing, idempotent capture).
>
> Repo root assumed: `D:\programming\RAZORPAY_PROJECT`
> Verification status at time of writing: `tsc --noEmit` clean · **unit suite green (see `npm test`)** · **5/5 browser E2E scenarios** · deterministic metrics report regenerated (`docs/metrics-report.json`, seed 42).

---

## 1. Problem statement

AI buyers (agents acting for humans) are beginning to transact on real payment rails — NPCI's UAP protocol is in development, Razorpay itself powers agentic UPI payments on Claude for Zomato/Swiggy/Zepto, and protocols ACP/AP2/x402 standardize agent↔merchant transport.

**The unsolved gap this project targets:** when an AI buyer reaches a merchant checkout and the cart exceeds its authorized budget, the journey simply dies. That is an abandoned checkout with extra steps. And even when the cart fits, nothing grows the order the way human retail does (attachments, brand-aware suggestions) — because agents only ever see raw catalogs.

**Track fit:** Razorpay AI Buildathon Track 1 ("AI Growth & Agentic Commerce") demands either growing merchant revenue or making merchants transactable by AI buyers, with every money action explainable, bounded, gated, an audit trail, and ≥1 gracefully-handled failure. Settle does both halves explicitly:

- **Rescue** (revenue recovery): negotiate within pre-declared buyer bounds when carts bust caps, spending merchant money last.
- **Grow** (revenue expansion): consented-affinity-ranked cross-sell attachments on within-cap carts, accepted deterministically, never exceeding the cap.
- It hits three of the track page's four named example directions (agent-readable catalog ✅, conversational intent ✅, upsell/cross-sell ✅; campaign *orchestration* is selection-only ⚠️ — stated plainly in ARCHITECTURE.md).

## 2. One-paragraph description

Settle is a **merchant-side settlement engine for AI-buyer traffic**. The buyer's agent arrives with a mandate (hard cap plus optional pre-authorized flexibility rules and DPDP-scoped consent). When the cart busts the cap, Settle computes the cheapest relief that still closes the sale by walking a funding waterfall (brand-funded campaign → bank-funded rail offer → margin-neutral bundle swap → direct price cut, last), validating every candidate against merchant guardrails (floor margin, daily discount budget, per-user cooldown) and buyer mandate rules with pure-function gates. When the cart fits, it instead proposes a single affinity-ranked attachment inside the remaining headroom. Accepted settlements execute through **real Razorpay test-mode Orders API calls** (zero-dependency REST client); both parties' decisions land in dual hash-chained append-only ledgers whose tips are **ed25519-signed**, with payment capture idempotency-keyed so retries can never double-charge.

## 3. Tech stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | Type-level enforcement where money crosses boundaries |
| Runtime | Node.js 24 | Global `fetch` (no HTTP lib needed for Razorpay), `node:test`, `node:crypto` (sha256 + ed25519 built-in) |
| Runtime deps | **Zero** | Supply-chain resilience mid-hackathon; Razorpay integration deliberately SDK-free |
| Dev deps | `tsx` (TS execution/test runner), `typescript`, `@types/node`, `playwright` (browser E2E) | Verification tooling only; none ship at runtime |
| UI | Single vanilla HTML/CSS/JS console (`public/index.html`) | Demo reliability > framework fashion; stable `data-testid` hooks for E2E |
| Persistence | In-memory store + JSON report files | Test-mode scope; the durable artifact story is the signed audit ledgers |

Scripts: `npm run typecheck` · `test` · `demo` · `e2e` · `metrics` · `dev` · `rzp:integration`.

Optional env (see `.env.example`): `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` activate real order creation; `LLM_API_KEY` (+ `LLM_BASE_URL`, `LLM_MODEL`) activates LLM intent parsing and LLM session receipts.

## 4. Domain model (the contracts)

All amounts are **integer paise** (₹4,000 = `400000`). No floats in settlement arithmetic; Indian-grouping display happens only at presentation edges.

### 4.1 Mandate — buyer authority (`src/types/mandate.ts`)
Hard cap; optional `flexRule { maxStretchPaise, requireSoftMatches, softCriteria[] }` (stretch authorisation, parsed from the "can stretch by N if…" clause); **`attachmentCriteria[]`** — brands/categories the buyer allows as cross-sell attachments, parsed from the separate "extras only from…" clause (natural variants like "extra stuff only if they're from Nike" parse identically) and fully independent of the flex rule; hunt-time budget; allowed rails; `consent { dpdpAcceptedAt, affinitySharing: "none" | "anonymized_topk" }`; cart hash bound at consent; 15-minute validity. **Flexibility and attachment preferences are declared by the human up-front, in separate sentences, never inferred by the agent.**

### 4.2 OfferPolicy — merchant guardrails (`src/types/policy.ts`)
Waterfall step toggles; `floorMarginPct`; `maxReleasesPerDay`; `dailyReleaseBudgetPaise`; per-user `cooldownMinutes`. Defaults: floor 20% is the report's operating point (12% retained as labelled ceiling), ₹5,000/day budget, 50 releases/day, 30-min cooldown.

### 4.3 CounterOffer — negotiation token (`src/types/catalog.ts`)
Mechanism (`funded_campaign | rail_offer | bundle_swap | price_cut`), new total, `merchantCostPaise` (own-money cost — 0 when externally funded), `fundedBy`, explanation, TTL (default 120 s).

### 4.4 Campaigns — finite caller-owned state
`FundedCampaign.remainingBudgetPaise` decrements on each release. Callers (API server, harness arms) own the array so budgets deplete **across sessions** exactly like real marketing budgets. This was a post-review bug fix: originally campaign money was infinite, which flattered conversion numbers.

## 5. Core algorithms

### 5.1 Buyer Gate (`src/core/buyer-gate.ts`) — pure function
Verdicts: `PASS_CAP` · `PASS_FLEX` (within cap+stretch AND ≥ required soft-criteria matches) · rejects `REJECT_OVER_STRETCH` / `REJECT_INSUFFICIENT_MATCHES` / `REJECT_NO_FLEX_RULE`; expired mandates always reject. Emits a full decision trace consumed by the UI and narration layer.

### 5.2 Merchant Gate (`src/core/merchant-gate.ts`) — pure function
Post-discount margin ≥ floor → daily release count/budget including proposed amount → per-user cooldown. Ledger passed in ⇒ gates compose correctly across concurrent sessions (proven by stress test, §8.4).

### 5.3 Funding waterfall (`src/merchant/engine.ts`)
Given the gap above cap: (1) brand-funded campaign (₹0 to merchant, budget-decrementing), (2) bank/network rail offer within buyer's allowed rails (₹0), (3) margin-neutral bundle swap, (4) minimum-sufficient direct price cut. First candidate passing the merchant gate wins. If no full-gap relief is profitable, a **partial-rescue round** targets `ceil(gap/2)` so pre-authorised buyer flex can cover residue — this creates the three-outcome space (pay / pause-for-human / abort). Fault-injection knob `offerTtlMs` enables reproducible expiry demos.

### 5.4 Session orchestration (`src/negotiation/session.ts`) — async, dependency-injected
1. Bind mandate + log consent hash → **cart-drift abort before any payment attempt**
2. Within cap → **cross-sell evaluation** (§5.5): offered/accepted events logged; acceptance triggers explicit `CART_RECONSENTED` with fresh hash (no silent drift), payable total grows but must stay ≤ cap
3. Over cap → `INTENT_BLOCKED(gap)` → waterfall → offer or graceful `ABORTED/NO_FITTING_OPTION`
4. Buyer decision brain: expiry check, rail-constraint check, then buyer gate
5. Reject + insufficient-matches → `PAUSED_FOR_HUMAN` (agent refuses to decide beyond its authority)
6. Payment ladder via injected **PaymentExecutor**: offered rail first, max 3 attempts, idempotency key = `sha256(sessionId|offerId|rail)`; failures cascade gracefully → `ABORTED/PAYMENT_DECLINED`
7. Own-money releases append to the shared release ledger (feeding cooldown/budget across sessions)
8. `finish()` seals both chains and, when signing keys are provided, **ed25519-signs each tip** (`tipSignatures` in outcome)

Executors (`src/payments/executor.ts`):
- `SimulatedExecutor` — deterministic rail-failure logic (default; keeps tests/E2E reproducible)
- `RazorpayExecutor` — creates one **real test-mode Order per settlement** via REST (`POST /v1/orders`, Basic auth, integer paise; `src/razorpay/client.ts`), reuses it across retry rails, records `order_id` into ledger events; instrument-level success/failure stays simulated because hosted-Checkout instruments resolve client-side only (documented split)
- `defaultExecutor()` picks by env presence

### 5.5 Cross-sell growth loop (`src/merchant/crosssell.ts` + `src/buyer/crosssell-decision.ts`)
Trigger: cart **within** cap (opposite of rescue). Suggester filters catalog by category adjacency (shoes→apparel/accessories…), excludes existing SKUs, enforces headroom strictly, **pre-filters by `mandate.attachmentCriteria` when present** (a "only from Nike" rule means only Nike items are ever offered — no bait-and-switch offers the buyer must reject), ranks by `(affinity-brand hit ? 100 : 0) + margin%`. Acceptance is deterministic and reads a **dedicated mandate field**: the suggestion's brand/category must appear in `mandate.attachmentCriteria` (the "extras only from…" clause) or in consented affinity top-K — the flex rule is never consulted for attachments, so a sentence like *"Extras only from Jockey"* authorises a Jockey attachment on a Nike-shoe cart without any ambiguity about the shoe itself. Otherwise the agent declines rather than upsells blindly (declination is itself audited). Max one suggestion; cap can never be exceeded.

### 5.6 Brand-affinity engine (`src/buyer/memory.ts`)
Event weights view=1/cart=2/purchase=4 with exponential recency decay; top-K above threshold become ranking/flex/cross-sell criteria. Strictly consent-scoped: no DPDP acceptance ⇒ memory invisible even internally; sharing off ⇒ merchant-facing share returns null; sharing on ⇒ coarse brand names only. External identity is pseudonymised (sha256 prefix).

### 5.7 Intent parsing (`src/buyer/parser.ts`)
Deterministic regex parser (budget/stretch/if-clause conditions/rails) drives all tests and offline demos; `parseWithLLM()` (OpenAI-compatible JSON mode) swaps in when keyed. Identical output shape; neither can move money.

### 5.8 Audit ledgers + signing (`src/audit/ledger.ts`, `src/audit/signing.ts`)
Append-only entries sealed by `sha256(canonicalJSON({previousHash, entry}))` (recursive key-sort ⇒ order-independent). `verify()` recomputes whole chains. Each session optionally ends with ed25519 signatures over both tips (`generateSigningKeyPair`/`signTip`/`verifyTipSignature`) — tamper-*evident* chains made tamper-*attributable*; production key custody documented as future work.

### 5.9 Post-hoc session receipt (`src/narrate/receipt.ts`)
Presentation-layer summary generated **after** settlement: LLM-written when keyed, deterministic template otherwise, returned as `receipt` alongside (never inside) the audit chain, rendered in the console under an explicit "post-hoc · outside audit chain" label.

## 6. Service surface (`src/server/api.ts`)

Node `http`, port 8787. Module-level state: payment executor, finite campaign budgets, process signing keypair.
- `GET /` → console · `GET /api/catalog` → products + offer registry (session whitelist)
- `GET /api/feed` → recent records + merchant-P&L aggregates (rescued revenue, own-cost discounts, externally-funded count, lost revenue)
- `POST /api/session` — token-bucket **rate limited** per IP (`src/server/ratelimit.ts`, capacity 10 burst / 60 per min refill → 429). Body accepts intentText, SKU whitelist-checked cart, failRails, policy overrides, waterfall disables, consent mode, fault injections (`offerTtlMs`, `forceDrift`). Response carries outcome, both ledgers, chain verification flags, tip signatures, `razorpayOrderId`, and the receipt.

## 7. Console UI (`public/index.html`)

Tabs: Live feed (rows show items + "+1 upsell" chip, mechanism + funding source, outcome chips; KPI cards) · Run session (NL intent, SKU picker, floor/budget inputs, fail-rail toggles, consent selector, fault-injection checkboxes) · Trace viewer (dual timelines, chain-verified badges, "ed25519 signed" badges, RZP order id in banner, receipt panel) · Policy explainer · Insights (consented data only). All server strings HTML-escaped (`esc()`); clean-fintech design system codified in `.agents/skills/settle-design-system/SKILL.md`.

## 8. Evidence of correctness

### 8.1 Unit tests — 72 (`tests/*.test.ts`, `node:test` via tsx)
Beyond the original matrix (money/hash/gates/waterfall/memory/parser/decisions/sessions/failure injections), the upgrade pass added: executor contract tests (one real-order creation per receipt reused across rails; order-failure → `RAZORPAY_ORDER_FAILED` without crash; simulated determinism preserved; env-fallback) · campaign-budget finitude (exhaustion falls through to next step) · cross-sell suite (adjacency/headroom/affinity ranking; acceptance bases; session-level cart growth with re-consent; declined-upsell pays base price) · signing (tamper detection; verifiable dual tips end-to-end) · idempotency replay (same key returns cached result, never double-charges) · rate limiter burst/refill semantics · **30-session concurrency stress** sharing one release ledger: aggregate own-cost never exceeds daily budget, every chain verifies, outcomes stay in the legal set.

### 8.2 Browser E2E — 5 scenarios (`tests/e2e/console.e2e.mjs`, Playwright Chromium)
Happy rescue (PAID + verified + signed badges) · all-rails-declined → bounded graceful abort · instant-offer-expiry → no payment + expiry narration · cart-drift toggle → pre-payment `CART_DRIFT` abort · consent-revoked → completes without affinity data. Page-error listener fails scenarios on any JS exception; screenshots in `e2e-artifacts/`.

### 8.3 A/B economics (`src/metrics/harness.ts`, `docs/metrics-report.json`)
120 shoppers, mulberry32 seed 42 (reproducible): budgets ±14% around price, 55% flex-carrying, independent Nike (40%) and Jockey (30%) preferences feeding consented affinity. Fairness control: flat-discount arm pushes offers through the **same buyer decision brain**.

**Primary table (floor 20%, finite campaign budgets):**

| Arm | Closes | Conv % | Revenue | Own-cost discount | Gross profit |
|---|---|---|---|---|---|
| no_rescue | 60 | 50% | ₹1,77,216 | ₹0 | ₹72,536 |
| flat_10_pct | 100 | 83.3% | ₹2,80,181 | ₹31,131 | ₹97,221 |
| **settle** | **114** | **95%** | **₹3,55,854** | **₹4,823 (+₹918 attached)** | **₹1,35,654** |

Headline: higher conversion than blanket discounting at **~6.5× less own-money spend**, plus consented cross-sell revenue. Four views coexist in the report: primary (above) · ceiling run @ floor 12 (labelled, near-identical shape) · floor sweep 12→30 with full waterfall (flat until floor 30 nudges closes up via emergent budget reallocation: rejecting marginal cuts preserves daily budget for later high-value rescues) · **own-money-only sweep** (external funding disabled): 68–69% conversion pinned at the ₹5,000 daily cap — i.e. Settle degrades honestly when its funding advantages are removed.

### 8.4 Security & robustness review (`docs/security-audit.md`)
Findings register incl. fixed XSS-pattern rendering; accepted demo-scope risks; **idempotent capture** (double-charge prevention, tested); **signed chain tips**; concurrency integrity proven under parallel load; consent scoping unit-tested; integer-paise-only arithmetic verified.

## 9. Honest limitations

1. **Real-vs-simulated split**: order creation is real Razorpay test-mode REST; *capture* is simulated (hosted-Checkout instruments resolve client-side only) and labelled everywhere; offers/campaign registry is sandbox data (third-party bank offers aren't creatable via public APIs).
2. Near-full conversion comes from externally-funded relief breadth, not margin generosity; remove external funding and conversion drops to 68–69% under a hard budget cap (§8.3 sweeps).
3. Chains are tamper-evident + tip-signed, but signing keys are process-local; production key custody/HSM is future work.
4. Single-process in-memory state (ledgers, rate-limit buckets); multi-instance deployments need shared stores.
5. Deterministic parser covers a constrained NL grammar; open-ended NL uses the optional LLM path, whose outputs still cannot move money.
6. Rate limiting is per-process, per-IP; no auth layer (demo-scope, documented).
7. The AI surface is deliberately narrow (intent parsing, receipts): thesis, not omission — see README "The AI thesis".
8. Campaign orchestration is reactive selection among live campaigns; proactive budget planning across campaigns is out of scope (stated in ARCHITECTURE.md scoresheet).

## 10. Suggested judging rubric (weight · probe · evidence)

| Dimension | Weight | Probe | Evidence |
|---|---|---|---|
| Track-bar compliance (explainable/bounded/gated/audit/failure) | 30% | Trace one rupee end-to-end; attempt to find an LLM path to authorization | §5 gates/session; E2E traces; signing |
| Merchant economics | 20% | Is discounting priced risk? Are external funds exploited first? Do budgets bind? | §5.3 waterfall + finite campaigns; §8.3 sweeps |
| Growth (not just rescue) | 10% | How does it expand orders without dark patterns? | §5.5 cross-sell; attached-revenue stat |
| Failure engineering | 15% | First-class outcomes vs swallowed exceptions; live fault injection | §5.4 ordering; E2E artifacts; pitch shot-list |
| Security/privacy/robustness | 10% | Consent scoping; tamper-evidence+signatures; idempotency; rate limits; concurrency | §5.6/§5.8; §8.1 stress test; security-audit.md |
| Measurement honesty | 10% | Seed reproducibility; fairness control; labelled ceiling; degradation views | §8.3 four-view report |
| Code quality & demo readiness | 5% | Pure separation, strict TS, zero runtime deps; one-command runs | repo layout; scripts |

Sharp questions a reviewer should ask — answered in `ARCHITECTURE.md` ("Sharp questions, pre-answered"): LLM spend authority (none, by construction), real-vs-Razorpay boundary (orders real, capture simulated), conversion credibility (95% headline; degradation sweeps), buyer gap forgery (impossible — computed server-side), tamper resistance (evident+signed), cross-sell ethics (consented, capped, audited declines).

## 11. Repository map

```
src/core/        money.ts hash.ts buyer-gate.ts merchant-gate.ts        ← trust spine (pure)
src/types/       mandate.ts policy.ts catalog.ts messages.ts             ← contracts
src/merchant/    data.ts engine.ts (waterfall) crosssell.ts              ← merchant brain
src/buyer/       memory.ts parser.ts agent.ts crosssell-decision.ts      ← buyer side
src/negotiation/ session.ts                                              ← orchestrator (async, DI)
src/payments/    simulate.ts executor.ts                                 ← executors + idempotency
src/razorpay/    client.ts                                               ← real test-mode REST
src/audit/       ledger.ts signing.ts                                    ← hash chains + ed25519
src/narrate/     receipt.ts                                              ← post-hoc summaries
src/server/      api.ts store.ts ratelimit.ts                            ← HTTP surface
public/          index.html                                              ← merchant console
src/metrics/     harness.ts run-report.ts                                ← A/B economics
scripts/         rzp-integration.ts                                      ← live order proof (keyed)
tests/           *.test.ts (72) e2e/console.e2e.mjs (browser ×5)
docs/            project-brief.md architecture→ ../ARCHITECTURE.md security-audit.md pitch-script.md metrics-report.json
.agents/skills/settle-design-system/SKILL.md                             ← UI design system
```

*End of brief.*
