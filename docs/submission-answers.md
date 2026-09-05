# Submission answers

Short versions for form fields. Longer supporting detail is in `ARCHITECTURE.md`
and `docs/project-brief.md`.

---

## Project objectives — what does it solve?

*(~250 words)*

AI shopping agents arrive with a hard budget. When the cart exceeds it, a merchant
today either loses the sale or discounts blindly — and on Indian retail margins a
blanket discount routinely sells below cost. A ₹4,500 shoe costing ₹2,700, cut to
₹3,000, books revenue and loses ₹300 a unit.

Settle closes that gap without giving away the margin.

**It spends other people's money first.** A fixed waterfall — brand campaign, bank
rail offer, bundle swap, and only then a direct price cut — stopping at the first
source a deterministic gate approves. Most rescues cost the merchant nothing. Across
a seeded 120-buyer run: **95% of carts closed for ₹4,823** of the merchant's own
money, versus **₹31,131** for a blanket 10% off. The same job for 85% less.

**It keeps the model out of the money path.** An LLM reads the shopper's intent and
writes the explanations. It has no authority to move a rupee. Spend is bound by a
signed mandate, and two deterministic gates — a buyer cap check and a merchant floor
margin priced on real unit cost — decide everything. A prompt injection cannot become
a payment instruction.

**It treats refusal as a valid outcome.** A rescue that breaks the margin floor is
worse than a lost sale. When nothing clears the gate the agent stops and says so;
when a stretch condition is unmet it hands back to a human. Every decision is
recorded in a hash-chained, ed25519-signed audit ledger either side can verify.

---

## Build challenges — what went wrong, and how it was solved

*(~160 words)*

Development was smooth until deployment. Nearly every real problem lived at the
local-versus-deployed boundary, and they shared one cause: **nothing made its own
behaviour visible**, so failures stayed silent.

**The front end was completely dead** — both pages had a JavaScript syntax error
committed to the repo, so no script ran at all. Because the pages still rendered, it
looked cosmetic.

**The engine and API read different catalogs.** They shared 2 of 12 SKUs, so unit
cost resolved to zero and the merchant gate reported a 100% margin on everything —
the floor check could never reject. A ₹4,500 shoe was approved for a ₹1,500 discount,
₹300 below cost.

**Deployment 502ʼd repeatedly.** The request handler had no error guard, and in Node
an unhandled rejection kills the process — so one failing query took down the service
and masked two SQL bugs beneath it.

**The biggest fix was not code.** With no local database, every attempt cost a deploy
cycle. Running Postgres in Docker against the real migrations let me reproduce
everything locally, and the rest fell out in one pass — including the fact that I
simply could not *see* the engine working, which is what the live control room now
solves.
