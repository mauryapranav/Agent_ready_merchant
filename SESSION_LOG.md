# Settle — Session Log

> Resume file. Read the latest entry's "Resume from" section to continue where we left off.

---

## 2026-08-24 — Session 1 (ended ~20:17, power cut)

**Goal:** decouple cross-sell attachments from the stretch rule — a buyer saying "extras only from Jockey" must authorise attachments via a dedicated mandate field, never the flex rule.

**Done:**
- `src/types/mandate.ts` — new `attachmentCriteria: SoftCriterion[]` field on `Mandate`
- `src/buyer/parser.ts` — new grammar: `extras (only) from/by …` clause fills `attachmentCriteria`; learned "accessories"/"electronics" as category words; stretch (`can stretch by N if …`) and extras are fully separate sentences
- `src/buyer/crosssell-decision.ts` — acceptance reads the extras rule or consented affinity, **never** the stretch rule; decline text: "outside your extras rule"
- `src/payments/executor.ts` — fixed latent bug surfaced by tsconfig change: `charge()`'s 2nd arg now optional
- `public/index.html` — default intent is the natural sentence; grammar hint under the box
- Tests: +4 parser, +1 cross-sell → **76/76**, typecheck clean, **5/5 E2E**
- Docs: `docs/project-brief.md` §4.1 + §5.5, `ARCHITECTURE.md` cross-sell row

**Ended:** power cut mid-session, right after the final verification message. No work lost (all writes had completed).

---

## 2026-08-24 — Session 2 (recovery + cross-sell bug fix)

**Recovery:** state verified intact post-power-cut (76/76, typecheck clean).

**Bug reported (screenshot):** intent *"Get me running shoes under ₹6000 and spend extra stuff only if they're from nike"* → engine offered **Jockey socks**, buyer declined. Two root causes:
1. **Parser** (`src/buyer/parser.ts:63`): extras grammar only matched the literal word `extras … from …`. The natural phrasing "spend extra stuff only if they're from X" didn't match → `attachmentCriteria` came back empty.
2. **Suggester** (`src/merchant/crosssell.ts`): ranked candidates by affinity + margin only, never saw the mandate's criteria. Jockey socks beat the Nike tee on margin (60.8% vs 53.7%) whenever headroom allowed both. (Old test only passed by coincidence — ₹820 headroom meant socks were the only item that fit.)

**Fixed:**
- Parser regex now accepts `extras | extra stuff/items/things/ones` + `only` + `from | by | if they're (from)` → the screenshot sentence parses to `{brand: Nike}`
- `suggestCrossSell()` takes `attachmentCriteria` and **pre-filters candidates** — a "only from X" rule means only X items are ever offered; nothing matches → no offer at all (no bait offers)
- Reason text for criteria-matched offers: "Fits your extras rule — Nike apparel"
- LLM parser path: prompt now extracts `extras_brands` / `extras_categories` → `attachmentCriteria`
- `public/index.html` hint mentions the natural phrasing
- Tests: +3 parser, +2 suggester, +1 session-level replica of the screenshot case → **82/82**, typecheck clean, **5/5 E2E**
- Docs: brief §4.1/§5.5 + `ARCHITECTURE.md` updated

**User verified live:** Nike Pegasus cart ₹4,180, cap ₹6,000 → `CROSS_SELL_OFFERED → nike-dri-tee` → `CROSS_SELL_ACCEPTED (basis: declared_criteria)` → `CART_RECONSENTED` → **real Razorpay test-mode order** `order_TTezXpiy6llCg` for ₹5,475 incl. the ₹1,295 attachment. Confirmed working.

---

## 2026-08-26 — Session 3 (v2 hardening: correctness first)

**Goal:** make the live server match what the tests already proved — and wire every advertised-but-dormant AI path before the pitch video.

**What broke (the 2 AM class of bug):**
- **Fresh release ledger per HTTP request** (`src/server/api.ts`): `runSession` got a brand-new `releaseLedger` array on every POST, so daily budget + cooldown guardrails only bound *within* one request. Tests proved the guarantee with a shared ledger; production silently didn't have it. A judge running two sessions could have watched the daily budget reset every time.
  - *Fix:* module-level shared ledger + regression test (`tests/server.test.ts`) that spins the real HTTP server on an ephemeral port, runs two sequential sessions against a ₹200 budget cap, and asserts own-money spend across BOTH sessions stays ≤ cap. First session rescues; second must not.

**Also fixed:**
- Receipts now persisted into `SessionRecord` → clicking any old feed row replays its full receipt (previously only the just-run session had one)
- Dead branch `if (oldest === false || true)` in `computeMetrics` removed
- LLM intent parser finally wired into the live path — behind a validation gate: schema-checked, caps bounded (₹1–₹100k), unknown brands/categories/rails dropped, `requireSoftMatches` recomputed deterministically; ANY failure falls back to the regex parser and the trace banner shows which one ran (`parsed-by llm(validated)` / `deterministic`)
- Insights tab no longer string-matches item labels ignoring consent — aggregates only `anonymized_topk` mandates via SKU→product lookup (fixes Jockey miss too)
- Deleted dead code: orphaned `src/payments/simulate.ts`, unused `NegotiationMessage` union + `CONSENT_REVOKED` block reason, renamed lying helper `cartDrifted()` → `cartHashMatches()`
- Doc drift sweep: pitch script was quoting stale metrics (52.5%/87.5%/₹34k) vs the actual report (50%/83.3%/95% @ ₹31,131/₹4,823); test counts de-hardcoded

**Verification:** 91/91 unit · typecheck clean · stale fail-screenshots purged from e2e-artifacts.

---

## Status after today

- **v2 hardening Phase 0 (correctness + honest AI) COMPLETE** — shared ledger, LLM parser gated+wired, receipts replayable, insights consent-scoped, dead code gone.
- **Next phases:** buyer dashboard with voice input (`/buyer`), AP2-shaped mandate/counter-offer signing, LLM red-team harness, pitch refresh.
- 91 unit tests · typecheck clean · 5/5 E2E · metrics reproducible (`npm run metrics`, seed 42).

## Resume from (next session)

Phase 1 — buyer dashboard at `/buyer`: Web Speech API intent input → parsed-intent chips → live negotiation timeline → itemized "why" settlement bill. Merchant console stays the single home of fault injection; `/buyer` mirrors outcomes via `/api/feed`.
