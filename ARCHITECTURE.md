# Settle — Architecture & Evaluation Guide

*For panelists: this is the 2-minute version. Deep dive lives in `docs/project-brief.md`; numbers in `docs/metrics-report.json`.*

## The one paragraph

AI buyers are arriving at merchant checkouts with hard spending mandates. When cart > cap, the sale dies — nobody negotiates on the merchant's behalf. **Settle is a merchant-side settlement engine for agentic checkout traffic**: it detects blocked AI buyers, assembles relief through a *funding waterfall* (brand-funded campaign → bank-funded rail offer → margin-neutral swap → own-money price cut last), validates every step against merchant guardrails and buyer mandate rules with pure-function gates, executes via real Razorpay test-mode orders, and seals both parties' decisions into hash-chained, ed25519-signed audit ledgers.

## Track bar → implementation map

| Requirement | Where |
|---|---|
| Money actions explainable | Gate traces (`buyer-gate.ts`), narrated rounds, dual-ledger trace viewer in console |
| Bounded | Mandate hard cap + pre-declared flex; max 3 payment rails; finite campaign budgets; daily discount budget |
| Gated | Two pure functions guard every rupee; LLM cannot reach them |
| Audit trail | Dual append-only hash chains + per-session ed25519 tip signatures, verified live in UI |
| Failure handled gracefully | 4 proven cases: offer expiry · all rails declined · cart drift post-consent · consent revoked (E2E in Chromium, `npm run e2e`) |

## Razorpay's example directions — scoresheet

| Direction | Status | How |
|---|---|---|
| Agent-readable catalog | ✅ strong | `GET /api/catalog` structured products+offers; doubles as session whitelist |
| Conversational checkout | ✅ partial→full | NL intent box (deterministic parser default, LLM optional); negotiation is structured by design |
| Upsell/cross-sell agent | ✅ built | Affinity-ranked attachments on within-cap carts, pre-filtered to and accepted only via the mandate's dedicated "extras only from…" rule (natural phrasings like "extra stuff only if they're from X" parse identically) or consented affinity — never the stretch rule; audited re-consent (`crosssell.ts`) |
| Campaign orchestrator | ⚠️ selection only | Engine selects among live campaigns reactively; budget *planning* is out of scope |

## Data flow

```
Human ──NL──▶ Buyer Agent ──mandate──▶ Session ──gap──▶ Waterfall ──counter──▶ Buyer Gate
                     │                                              │                │
                     ▼                                              ▼                ▼
              BUYER LEDGER ◀── hash chain + ed25519 tips ──▶ MERCHANT GATE    accept/pause/abort
                                                                     │
                                                        Razorpay Orders API (real, test mode)
```

## Numbers (seed 42, 120 shoppers, reproducible)

| Arm | Conv % | Own-cost discount | Note |
|---|---|---|---|
| No rescue | 50% | ₹0 | baseline abandonment |
| Flat 10% off | 83.3% | ₹31,131 | blanket discounting |
| **Settle** | **95%** | **₹4,823 (+₹918 upsell)** | **6.5× cheaper discounting, higher conversion** |

Degradation is honest too: with external funding switched off, Settle still closes 68–69% at a hard-capped ₹5,000 discount budget.

## Sharp questions, pre-answered

1. **"Can the LLM spend money?"** No. Gates are pure synchronous functions; the LLM's surface is intent parsing + narration text only. This is the thesis, not an omission.
2. **"What's actually real vs Razorpay?"** Order creation is real REST (`/v1/orders`, Basic auth, no SDK). Capture needs hosted Checkout instruments, so the capture leg is simulated and labelled everywhere.
3. **"100%-conversion demos are fake — yours?"** Primary run is 95%. Near-full conversion comes from externally-funded relief breadth; switch funding off and it degrades to 68–69% under a hard budget cap (sweeps in metrics-report.json).
4. **"What if the buyer lies about being over budget?"** It can't — the gap is computed server-side from cart total minus mandate cap.
5. **"Tamper-proof?"** Tamper-*evident* chains plus ed25519-signed tips; key management for production is documented future work.
6. **"Cross-sell = dark pattern?"** Attachments require consented affinity or declared criteria, must fit inside the existing cap, and declining is itself audited.

## Run it

```bash
npm install && npm test          # unit tests
npm run e2e                      # browser-proof failure cases
npm run demo                     # one rescue story from audit ledgers
npm run metrics                  # regenerate all numbers deterministically
npm run dev                      # merchant console @ :8787
RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… npm run rzp:integration   # real order proof
```
