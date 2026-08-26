# Settle — 5-minute pitch script

## 0:00–0:40 · The gap
"AI buyers are going live on real rails — Razorpay itself powers agentic payments on Claude. But watch what happens when an AI buyer's budget doesn't match the cart: the journey just dies. That's an abandoned checkout with extra steps. Protocols move the money; nobody helps the merchant close the sale."

## 0:40–1:20 · What Settle is
"Settle is a merchant-side settlement agent for AI-buyer traffic. The buyer arrives with a signed mandate — a hard cap, and stretch rules the human pre-approved. When they're over budget, Settle negotiates inside those bounds and rescues the sale — spending merchant money only as a last resort."

## 1:20–2:20 · Live demo (console)
1. Run default session → shoes ₹4,180 vs ₹4,000 cap → Nike campaign covers ₹300 → PAID ₹3,880. Point at feed row: mechanism = funded_campaign, merchant cost ₹0.
2. Open trace viewer: buyer ledger left, merchant ledger right, chain-verified badges.
3. Flip "Expire offers instantly", re-run → graceful abort, narration says the offer expired before payment.
4. Check both fail-rail boxes → every rail declines → bounded retries → clean ABORTED.

## 2:20–3:00 · Why merchants trust it
"The waterfall tries brand-funded campaigns, then bank-funded rail offers, then margin-neutral swaps — direct price cuts are last. Even those pass a floor margin, daily budget and cooldown gate first. And the settlement path is 100% deterministic by design: LLMs parse intent and narrate — they never authorize spend; the LLM's parse itself is validated against a schema before it can touch a mandate, with a deterministic fallback. Blanket discounting burns ₹31k of merchant money per 120 buyers; Settle spends under ₹5k."

## 3:00–3:40 · Numbers (honest ones)
Show docs/metrics-report.json primary table (floor 20%): no-rescue 50% / flat-10% 83.3% @ ₹31,131 own-cost / Settle 95% @ ₹4,823 own-cost (+₹918 upsell). "Conversion stays high because relief is mostly externally funded — and when we switch external funding off, Settle still closes 68.3% at the hard budget cap versus blanket's 83.3% at ₹31k. Six-and-a-half-times cheaper discounting, with degradation that is graceful, not catastrophic."

## 3:40–4:20 · Trust architecture
"LLMs propose; deterministic gates dispose. Money math is integer paise in pure functions. Every decision lands in two hash-chained ledgers — tamper any entry and verification breaks loudly. Buyer affinity data is DPDP-consented at the mandate level; non-consented sessions never enter merchant insights, proven in E2E."

## 4:20–5:00 · Close
"This maps one-to-one onto where UAP is heading: agent identity, spend limits, tamper-evident logs. Accepted settlements already create real Razorpay test-mode orders — the order IDs sit in those ledgers. Settle is the commercial layer merchants will want on top of that protocol stack. Every failure case you just saw was handled on camera."

## Fallback plan
If live demo fails: e2e-artifacts/*.png show all five scenarios; `npm run demo` prints the rescue story from audit ledgers; `npm run metrics` regenerates numbers deterministically (seed 42); `npm run rzp:integration` proves real order creation when keys are set.

## Video shot list (fault-injection must be visible)
1. [Screen] Console → Run session → default happy rescue; zoom feed row (funded_campaign, ₹0 cost).
2. [Screen] Trace viewer dual ledgers + "chain verified" badges (hold 3 s).
3. [Screen] Tick "Expire offers instantly" ON CAMERA → re-run → ABORTED banner + expiry narration in trace.
4. [Screen] Tick both fail-rail boxes → re-run → bounded retries → clean PAYMENT_DECLINED abort.
5. [Terminal] `npm run metrics` output scrolling (primary table + sweeps).
6. [Optional, keys set] Terminal: `npm run rzp:integration` → real order JSON; cut to Razorpay dashboard showing the order.
7. [Optional, LLM key set] Session receipt button → natural-language receipt paragraph.
