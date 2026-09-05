# Settle — 5-minute demo video

Flow, shot list and spoken script. Timings assume a single continuous screen
recording with voice-over. Total target **4:50**, leaving buffer under 5:00.

---

## Before you hit record

A checklist, in order. Skipping any of these costs you the demo.

1. **Reset the merchant.** This is the single most important step — a drained daily
   budget silently removes Priya, the only buyer where the merchant pays. Run against Neon:
   ```sql
   DELETE FROM release_ledger WHERE merchant_id = 'merchant_settle_demo';
   UPDATE campaigns SET remaining_budget_paise = total_budget_paise WHERE merchant_id = 'merchant_settle_demo';
   UPDATE inventory_reservations SET status = 'released' WHERE status = 'pending';
   UPDATE inventory SET reserved_qty = 0 WHERE merchant_id = 'merchant_settle_demo';
   ```
   Without this the Nike campaign is already drained and buyers 1–3 all fall to the
   rail offer — the single most important beat in the video disappears.

2. **Confirm the page agrees.** Load `/`. If an orange banner says *"State left
   over from a previous run"*, the reset did not take. Fix before recording.

3. **Razorpay keys.** Either valid test keys on Render, or **delete both env vars**
   so the simulated executor runs. Invalid keys make every buyer abort.

4. **Warm the service.** Load the page once and let it settle — a cold Render
   instance plus a sleeping Neon can take 30s on the first request.

5. **Window at 1440×900**, browser zoom 100%, dark or light theme (dark reads
   better on projectors). Close other tabs; the tab bar is in frame.

6. **Do one silent rehearsal**, then reset again. Rehearsing burns campaign budget.

---

## Shot list

| # | Time | Screen | Purpose |
|---|------|--------|---------|
| 1 | 0:00–0:35 | Hero | The claim and the problem |
| 2 | 0:35–1:05 | Waterfall section | The mechanism, in four columns |
| 3 | 1:05–2:35 | Live run | The proof — narrate 1-3, 5, 6; fast-forward the rest |
| 4 | 2:35–3:00 | Refusal section | Restraint as a feature |
| 5 | 3:00–3:50 | Analytics | The economics |
| 6 | 3:50–4:20 | Protocol + history | Interop and auditability |
| 7 | 4:20–4:50 | Try it / Governance | Extensibility and close |

---

## Script

### 1 — Hero · 0:00–0:35

> **[On screen: the landing page. Don't scroll yet.]**

"An AI agent is about to buy something from your store. It has a budget, it has
rules, and it is not going to negotiate the way a human does.
>
> **[Point at the policy panel on the right.]**
>
> This is Settle. A language model reads the shopper's intent and writes the
explanation — but it never touches the money. Every rupee moves through
deterministic gates the model cannot argue with.
>
> **[Scroll slowly to the figures band.]**
>
> Across a seeded run of a hundred and twenty buyers: ninety-five percent of carts
closed, and the merchant spent four thousand eight hundred rupees of its own margin
doing it. That's eighty-five percent less than a blanket ten-percent discount.
>
> The number on the right is the one that matters. Zero. That's how many payments a
language model can authorise."

*Note: read the figures off the screen — they are pulled live from the simulation,
not hardcoded, so they will match whatever is rendered.*

---

### 2 — The problem and the waterfall · 0:35–1:05

> **[Scroll to section 01, pause ~2s, then to section 02.]**

"The naive answer to an over-budget cart is to cut the price until it fits. On
Indian retail margins that quietly destroys the contribution it was meant to
protect — a four-and-a-half-thousand-rupee shoe that costs you two-seven, discounted
to three thousand, books revenue and loses you three hundred a unit.
>
> **[Now on the waterfall — four columns.]**
>
> So Settle works down four funding sources in a fixed order. A brand campaign
first, because that's the brand's money. Then a bank or card-network rail offer —
also not yours. Then a swap to a comparable cheaper item, which costs nobody.
>
> **[Point at column four.]**
>
> Only the last step spends your margin. And it's the only one that can be refused
outright by the floor."

---

### 3 — The live run · 1:05–2:35 — *the core of the video*

> **[Click "Watch 13 AI buyers negotiate". The page scrolls to the control room.]**

"Thirteen AI buyers, arriving one at a time, against a real database and real payment
rails. Nothing here is pre-recorded — and they share one campaign budget, which is
why they have to run in sequence. The first seven walk every funding source; the
rest put the same engine under adverse conditions.

**Buyer 1 — Ananya.** *(let the beats play, ~8s)*

> Her mandate is parsed to a hard cap of three thousand seven hundred. The cart is
four-one-eight-zero. The agent stops — it cannot authorise this on its own. The
merchant is asked to close a four-hundred-and-eighty-rupee gap, and the Nike
campaign covers it. Cost to the merchant: zero.

> **[Press Space. Point at the campaign meter on the left.]**

**Buyer 2 — Rohit.** Same shoe, same intent, same rescue — and watch the Nike
campaign budget on the left drop to zero.

> **[Press Space.]**

**Buyer 3 — Meera.** *(pause — let this beat land)*

> Identical instruction. Identical shoe. But look —
>
> **[Read the skipped-step beat aloud.]**
>
> *'Brand campaign — skipped. Nike Summer Sale would have covered this, but the
budget is spent.'*
>
> So it falls through to the bank rail offer. Different funding, same close, still
zero cost to the merchant. That is the waterfall doing its job under contention."

> **[Press Space. Buyer 4 swaps to a cheaper equal. Press Space again.]**

**Buyer 5 — Priya.** *(name this one out loud)*

> No campaign fits, no rail offer covers it, nothing comparable to swap to. So the
waterfall reaches its last step and the merchant pays — eight hundred rupees straight
out of margin, charged against the daily release budget. This is the only step that
costs you anything, and the only one the floor can refuse outright.

> **[Press Space.]**

**Buyers 6 and 7 — Kavya and Rhea.** Both are already under budget, so there is
nothing to rescue. Kavya declared *extras only from Jockey*, so the attachment is
accepted and the cart re-consented. Rhea declared no such rule — so the same gate
declines the upsell rather than quietly padding her basket.

> **[Click "Play the remaining 6 without stopping".]**

"The last six are the engine under stress — UPI declining then card succeeding, every
rail declining, an offer expiring before acceptance, a cart tampered with after
consent, and two refusals."

---

### 4 — Refusal · 2:35–3:00

> **[The run lands on analytics. Don't dwell — scroll back to section 04 first,
> or narrate over the analytics tiles.]**

"Three of the thirteen never closed, and that is the system working.
>
> Arjun: the only discount big enough would have pushed margin under the twelve
percent floor. The gate returned REJECT_FLOOR, offered a half-sized rescue instead,
and his cap refused it. No sale.
>
> Dev: his mandate allows a stretch, but only on a genuine Nike match. The offer was
an Adidas hoodie, so the condition wasn't met and the session paused for a human
rather than guess.
>
> A rescue that breaks the floor is worse than a lost sale."

---

### 5 — Analytics · 3:00–3:50

> **[On the analytics view. Point at the four tiles, then scroll to the
> counterfactual card.]**

"Every figure here comes out of the audit ledger.
>
> Revenue by buyer, coloured by which funding source closed it. Gross profit priced
against real unit cost from the catalog — not modelled.
>
> **[Point at the counterfactual card.]**
>
> This is the one I'd look at. Same cohort, three policies. No rescue at all. A
blanket ten percent off — which earns *less*, because it converts more but gives away
margin on carts that would have closed anyway. And Settle, clear of both.
>
> Read the three figures straight off the card; they are computed from this run.
>
> **[Point at "When the merchant does pay".]**
>
> And here's the honest part — one session actually cost the merchant money. Eight
hundred rupees, Priya's price cut. Everything else was somebody else's budget."

*If asked in Q&A: the counterfactual compares list price against each buyer's hard
cap and ignores the stretch rule, which flatters the blanket arm — so the real gap
is wider than shown.*

---

### 6 — History and audit · 3:50–4:20

> **[Exit analytics. Section 09 — Protocol — then section 10, History.]**

"Two endpoints, fetched live in the browser, not mocked. `/acp/feed` is the agentic
product feed — every SKU with price, the rails it accepts, and whether it is eligible
for rescue or attachment. That is what a buying agent reads before it ever opens a
session.

> And `/.well-known/jwks.json` is the ed25519 public key set. Counter-offers and both
ledger tips are signed; this is how a counterparty verifies them without trusting us.

> **[Scroll to section 10.]**

"Every session is on the record — settlements and refusals alike, read back from the
sessions table, so it survives a restart.
>
> **[Click a row to expand it.]**
>
> Any row opens into the mandate it was bound to, the cart hash taken at consent,
the full waterfall trace with each gate verdict, and the settlement.
>
> Both sides keep an append-only ledger where every entry hashes its predecessor,
and the tip is signed. If anyone tampers with a record, verification fails."

---

### 7 — Try it, governance, close · 4:20–4:50

> **[Jump to section 07. Type a fresh instruction — keep it short.]**

"And it isn't scripted. Type your own mandate —
>
> **[Type: `Get me a fitness band under 2500`. Click Read the intent, then
> Negotiate.]**
>
> — the parser turns it into a mandate, picks a matching item, and runs the same
negotiation, with the same full trace.
>
> **[Scroll to governance, section 06.]**
>
> Mandate-bound spend. A margin floor priced on real cost. A daily release budget
and a per-buyer cooldown. Hash-chained audit. Idempotent, bounded retries.
Cart-drift detection.
>
> The model reads intent and writes explanations. It is nowhere in the authorisation
path.
>
> **[Back to hero.]**
>
> Let agents buy. Keep the margin."

---

## Fallbacks if something breaks on the day

| Symptom | Cause | What to do on camera |
|---|---|---|
| Every buyer aborts, "payment declined" | Razorpay keys invalid on Render | Say "running on the simulated executor" and continue — the negotiation logic is identical |
| Buyers 1–3 all get rail offers | Campaign budget not reset | Skip the Meera beat; narrate the swap and price-cut cases instead |
| Orange stale-state banner | Reset didn't run | Stop, reset, re-record |
| Page slow on first load | Render cold start | Warm it before recording |
| "Handed back"/"No deal" look like bugs | They aren't | Lean in — this is section 04, refusal is the feature |

## Numbers worth memorising

- **95%** carts closed, 120-buyer seeded run (seed 42, `npm run metrics`)
- **₹4,823** merchant's own discount spend, vs **₹31,131** for a blanket 10%
- **85% less** own-cost for **11.7 points more** conversion
- **0** payments a language model can authorise
- Live cohort: **4 of 5** rescues funded by someone other than the merchant
