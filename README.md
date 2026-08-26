# Settle — an offer-aware settlement agent for AI-buyer checkouts

**Razorpay AI Buildathon · Track 1: AI Growth & Agentic Commerce**

When an AI buyer hits a merchant's checkout and the cart busts its spending mandate, most agentic journeys die right there. **Settle is the merchant-side engine that rescues that sale** — negotiating within pre-declared buyer rules, funding relief in the cheapest possible order, refusing any discount that breaks merchant guardrails, and sealing every decision into a tamper-evident, signed audit trail. When the cart is *under* budget, Settle grows the basket instead — one criteria-matched attachment, accepted only via the buyer's own declared extras rule.

> On 120 synthetic shoppers at a realistic 20% floor margin: blanket-10%-off converts 83.3% while burning ₹31,131 of merchant money.
> **Settle converts 95% while spending ₹4,823 of merchant money (−84.5%)** — plus ₹918 of attached upsell revenue. Brand-funded campaigns, bank-funded rail offers and margin-neutral swaps are tried before a single rupee of direct discount, and campaign budgets deplete like real budgets do.

## The AI thesis, stated up front

**The negotiation and settlement path is 100% deterministic and auditable by design. LLMs are confined to natural-language interpretation — parsing intent, narrating decisions — never to spend authorization.** Every rupee crosses two pure-function gates (`buyer-gate.ts`, `merchant-gate.ts`) that an LLM cannot influence. Trustworthy money-movement beats a flashy autonomous agent in a payments track.

## Razorpay integration — what's real vs simulated

| Component | Status |
|---|---|
| Order creation | **Real** — `POST https://api.razorpay.com/v1/orders` via zero-dep `fetch` + Basic-auth test keys (`src/razorpay/client.ts`). Accepted settlements create real test-mode orders visible in the dashboard; `order_id`s are recorded in the audit ledgers. |
| Payment capture | Simulated, honestly — headless capture needs hosted-Checkout instruments (`success@razorpay` / `failure@razorpay`), which resolve client-side only. Deterministic rail-failure logic stands in (brief §9). |
| Offers/campaigns registry | Simulated by necessity — third-party bank offers can't be created via public sandbox APIs. Campaign budgets are finite caller-owned state that depletes across sessions (`docs/project-brief.md` §8.3). |

Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in `.env` to activate; without keys everything runs on the deterministic simulator. Verify with `npm run rzp:integration`.

## Why now

NPCI's UAP and the ACP/AP2/x402 race make agent-to-agent commerce the open problem of the year; Razorpay's in-app agentic pilots are already live. Protocols standardize *transport and consent* — nobody ships the *commercial intelligence* layer for agent checkouts. That's the gap Settle occupies.

## Architecture

```
Human ──NL──▶ Buyer Agent ──mandate──▶ Session ──gap──▶ Waterfall ──counter──▶ Buyer Gate
        (parser.ts)  │                                              │                │
                     ▼                                              ▼                ▼
               BUYER LEDGER ◀── hash chain + ed25519 tips ──▶ MERCHANT GATE    accept/pause/abort
                                                                    │
                                                       Razorpay Orders API (real, test mode)
```

The waterfall spends merchant money last:

1. **Brand campaign** (brand-funded → costs ₹0)
2. **Rail offer** (bank/network-funded → costs ₹0)
3. **Bundle swap** (margin-neutral equivalent SKU)
4. **Direct price cut** (own money — minimum sufficient, floor-margin gated)

Guardrails on every release: floor margin %, daily discount budget, per-user cooldown.
Partial-rescue round: if full-gap relief is unprofitable, a half-gap offer lets pre-authorised buyer flex cover the rest.

**Growth loop (within-cap carts):** the suggester pre-filters the catalog by category adjacency *and* the buyer's declared `attachmentCriteria` ("extras only from Nike" → only Nike items are ever offered), ranks by affinity + margin, and offers at most one attachment. Acceptance requires the dedicated extras rule or consented affinity — never the stretch rule — and triggers an audited cart re-consent before payment.

## The trust spine (the track bar)

| Track requirement | Where it lives |
|---|---|
| Every money action explainable | Buyer-gate traces + narrated rounds; trace viewer shows both ledgers side-by-side |
| Bounded | Mandate hard cap + declared flex rule + pre-declared attachment criteria; max-3 payment rails; hunt-time budget; finite campaign budgets; daily discount budget |
| Gated | `buyer-gate.ts` & `merchant-gate.ts` pure functions; LLM never computes money |
| Audit trail | Dual append-only hash chains + per-session ed25519-signed tips, verified live in the console |
| Failure handled gracefully ×4 | Offer expiry mid-round · all-rails declined · cart drift after consent · consent revoked — all E2E-proven in Chromium (`npm run e2e`) |

## Quickstart

```bash
npm install
npm run typecheck && npm test     # unit suite (parser gates, ledger concurrency, tamper detection)
npm run demo                      # one rescue story from both audit ledgers
npm run metrics                   # 120-shopper A/B report → docs/metrics-report.json
npm run e2e                       # browser-proof all failure cases (needs npx playwright install chromium)
npm run dev                       # console at http://localhost:8787
npm run rzp:integration           # real test-mode order proof (needs keys in .env)
```

Optional: set `LLM_API_KEY` (+ optional `LLM_BASE_URL`, `LLM_MODEL`, see `.env.example`) to enable the LLM intent parser; without it the deterministic parser drives everything.

## Results

`docs/metrics-report.json` (seed 42, 120 shoppers, reproducible) carries four views — read together, they are the honesty story:

- **Primary (floor 20%)**: no-rescue 50% · flat-10% 83.3% @ ₹31,131 own-cost · **Settle 95% @ ₹4,823 own-cost + ₹918 attached upsell** (+11.7pp conversion, −84.5% own-cost vs flat discounting). Conversion stays high because external funding (finite campaigns + rail offers) covers most gaps.
- **Ceiling (floor 12%)**: identical shape; retained as an explicitly-labelled ceiling run, not the claim.
- **Floor sweep 12→30%** with full waterfall: barely moves — floors don't bind when relief is externally funded.
- **Own-money-only sweep**: when campaigns/rail offers are disabled, Settle still closes 68.3% at the hard daily budget cap (~₹5,000) vs flat-10%'s 83.3% at ₹31,131 — **~6× cheaper discounting for somewhat lower conversion**, and degradation is graceful, not catastrophic.

## Honest limitations

- Catalog/offers are simulated (test-mode scope); Razorpay live offers APIs aren't public in test mode.
- Payment capture is simulated (hosted-Checkout instruments resolve client-side only); order creation is real REST.
- Audit chains are tamper-*evident* with ed25519-signed per-session tips; production key management is documented future work.
- Cross-sell is capped at one attachment per session by design — growth never overrides the mandate.

## Stack

TypeScript (NodeNext), zero runtime dependencies, Node built-in HTTP, vanilla console UI, Playwright E2E, tsx toolchain.
