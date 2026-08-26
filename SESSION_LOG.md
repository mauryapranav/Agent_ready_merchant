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

## Status after today

- **Build phase: COMPLETE.** All track-bar items green (explainable / bounded / gated / audited / 4 failure cases E2E-proven).
- 82 unit tests · typecheck clean · 5/5 E2E · metrics reproducible (`npm run metrics`, seed 42).
- Part A (build + guided verification) fully done.

## Resume from (next session)

**Part B — code-reading in execution order + written answers.** Coach mode: if an answer is wrong/vague, don't reveal the correct one — ask a follow-up pointing at the relevant file.

**B1. Read in this exact order** (re-read the matching `docs/project-brief.md` section first, then the file):
1. `src/negotiation/session.ts` — the conductor
2. `src/core/buyer-gate.ts` + `src/core/merchant-gate.ts` — the two pure-function decision-makers
3. `src/merchant/engine.ts` — discount offer assembly (over-budget carts)
4. `src/merchant/crosssell.ts` — attachment suggestion assembly (within-cap carts)
5. `src/audit/ledger.ts` + `src/audit/signing.ts` — hash chains + ed25519 tips

**B2. The five questions — answer in writing FIRST (2–3 plain sentences each), then compare against `ARCHITECTURE.md`:**
1. Why is order *creation* real (actual Razorpay) but payment *capture* simulated? The actual technical reason, not "it's a limitation".
2. What was the campaign-budget bug, and why did it make the old conversion numbers misleading?
3. What does signing the ledger with ed25519 add that the hash chain alone didn't?
4. Could a buyer's agent lie about how much money it's short by, to get a bigger discount? Why or why not?
5. Why does the LLM only ever write explanations and never decide whether to approve money — what would break if it could?

Checkboxes: [ ] wrote all 5 answers first [ ] compared against ARCHITECTURE.md [ ] can say all 5 out loud, unprompted, correctly.
