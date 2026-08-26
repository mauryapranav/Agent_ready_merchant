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

**Phases 1–3 (same day):**
- **Phase 1 — buyer dashboard `/buyer`:** Web Speech API intent input (typed fallback), mandate-readback chips with parser badge, step-by-step negotiation timeline, itemized **why-bill** (relief line shows who funded it + merchant's own cost), trust badges. New `/api/parse` endpoint. E2E scenario 06 added → **6/6**.
- **Phase 2 — protocol alignment:** every released counter-offer is now an ed25519-signed `settle.counter_offer.v1` artifact (mandate id + cart hash bound, signer key id) — verifiable, badge in both UIs; `/acp/feed` machine-readable catalog; `docs/protocol-map.md` maps every artifact to its UAP/AP2/ACP counterpart (aligned-not-certified stance). +2 signing tests.
- **Phase 3 — red-team harness:** `npm run redteam` runs prompt-injection / cap-inflation / unbounded-stretch / extras-smuggling / junk-rail attacks through the real gates; invariants (cap ceiling, allowed rails, extras scope) checked per session. Deterministic corpus: 6 hostile sessions + 1 injection blocked at parse → **0 violations** (`docs/redteam-report.json`). LLM arm generates extra hostile intents when a key is present. +2 tests.
- **Final state: 95/95 unit · typecheck clean · 6/6 E2E · red-team 0 violations.**

---

## Status after today

- **v2 COMPLETE: correctness + buyer dashboard + protocol alignment + red-team proof.**
- 95 unit tests · typecheck clean · 6/6 E2E · red-team 0 violations · metrics reproducible (seed 42).
- Remaining before Sept 5: record the 5-min pitch video per `docs/pitch-script.md` shot list; optional LLM-key demo of live parser + LLM red-team arm.

## Resume from (next session)

Recording day. Rehearse `docs/pitch-script.md` once end-to-end, then shoot the 8-shot list. If the LLM key is set, capture the `parsed-by llm(validated)` badge live; otherwise the deterministic badge story is equally honest.
