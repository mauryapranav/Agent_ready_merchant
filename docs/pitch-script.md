# Settle — 5-minute pitch script

## 0:00–0:40 · The gap
"AI buyers are going live on real rails — Razorpay itself powers agentic payments on Claude. But watch what happens when an AI buyer's budget doesn't match the cart: the journey just dies. That's an abandoned checkout with extra steps. AP2, ACP, UAP — they standardize how consent and money move. Nobody ships what the merchant does next. That's the layer Settle occupies."

## 0:40–1:20 · What Settle is
"Settle is a merchant-side settlement agent for AI-buyer traffic. The buyer arrives with a signed mandate — a hard cap, and stretch rules the human pre-approved. When they're over budget, Settle negotiates inside those bounds and rescues the sale — spending merchant money only as a last resort. When they're under budget, it grows the basket with exactly one rule-compliant attachment."

## 1:20–2:40 · Live demo (buyer side, then merchant side)
1. Open `/buyer`. Hit the mic: *"Get me running shoes under ₹4000, extras only from Jockey."* Transcript lands in the box → "Read my mandate back" → chips show Cap ₹4,000 · Extras only from Jockey · parser badge.
2. Run negotiation → step-by-step timeline: mandate bound → cart consented → over budget by ₹180 → counter-offer → gate verdict → paid via UPI. Then the bill: itemized lines, the rescue-relief line with **who funded it**, the merchant's own cost in plain text, and chain-verified badges.
3. Switch to merchant console `/`: same session in the live feed → trace viewer, dual ledgers, "counter-offer ed25519-signed" badge, real Razorpay order id.

## 2:40–3:10 · Failure handling on camera
1. Tick "Expire offers instantly" → re-run → graceful abort, narration explains the expiry.
2. Tick both fail-rail boxes → re-run → bounded retries → clean PAYMENT_DECLINED. The buyer page shows the same story from the buyer's side.

## 3:10–3:40 · The red-team proof
"Here's the part I'm proudest of. The negotiation path is 100% deterministic — LLMs parse and narrate, they never authorize spend. And the LLM's parse itself goes through a schema-validation gate with a deterministic fallback. Don't take my word: `npm run redteam` throws prompt injection, cap inflation, unbounded stretch and extras-smuggling attacks at the real gates. Six hostile sessions, one injection blocked at parse, **zero gate violations**. The report is committed at docs/redteam-report.json."

## 3:40–4:10 · Numbers (honest ones)
Show docs/metrics-report.json primary table (floor 20%): no-rescue 50% / flat-10% 83.3% @ ₹31,131 own-cost / **Settle 95% @ ₹4,823 own-cost** (+₹918 upsell). "Conversion stays high because relief is mostly externally funded — and with external funding off, Settle still closes 68.3% at the hard budget cap. Six-and-a-half-times cheaper discounting, graceful degradation."

## 4:10–4:50 · Trust architecture + protocol position
"Money math is integer paise in pure functions. Every decision lands in two hash-chained ledgers with ed25519-signed tips; every counter-offer is a signed artifact bound to the mandate id and cart hash. docs/protocol-map.md maps each artifact to its counterpart in UAP, AP2 and ACP — aligned, not certified, because those specs move monthly. When UAP lands, Settle's mandate *is* the permission scope it enforces."

## 4:50–5:00 · Close
"Protocols move the money. Settle closes the sale — inside the buyer's rules, inside the merchant's guardrails, with every rupee auditable. Every failure case you just saw was handled on camera."

## Fallback plan
If live demo fails: e2e-artifacts/*.png show all six scenarios; `npm run demo` prints the rescue story from audit ledgers; `npm run metrics` and `npm run redteam` regenerate their reports deterministically (seed 42); `npm run rzp:integration` proves real order creation when keys are set.

## Video shot list (fault-injection must be visible)
1. [Screen] `/buyer` → mic button → speak the intent → transcript appears (if mic unavailable on recording rig: type it live, same story).
2. [Screen] "Read my mandate back" → chips + parser badge; Run negotiation → timeline + itemized why-bill (hold on the relief line: who funded it).
3. [Screen] Console `/` → feed row → trace viewer: dual ledgers, chain-verified, ed25519 badges, RZP order id.
4. [Screen] Console: tick "Expire offers instantly" ON CAMERA → re-run → ABORTED + expiry narration.
5. [Screen] Console: tick both fail-rails → re-run → bounded retries → clean abort; cut back to `/buyer` showing the buyer-side view of the same abort.
6. [Terminal] `npm run redteam` → scroll to "GATE VIOLATIONS : 0".
7. [Terminal] `npm run metrics` output scrolling (primary table + sweeps).
8. [Optional, keys set] `npm run rzp:integration` → real order JSON; cut to Razorpay dashboard.
