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

*(~260 words)*

Development was smooth until deployment. Almost every real problem lived at the
local-versus-deployed boundary, and they shared one cause: **nothing made its own
behaviour visible**, so failures stayed silent.

**The front end was completely dead.** Both pages had a JavaScript syntax error
committed to the repo — HTML entities inside the `esc()` helper had been decoded
within the `<script>` tag, so `"&quot;"` became `"""`. No JavaScript ran at all.
Because the pages still rendered, it looked cosmetic.

**The engine and API read different catalogs.** The engine used a static module, the
API served Postgres, and they shared 2 of 12 SKUs. For the rest, cost resolved to
`0` — so the merchant gate computed a **100% margin on everything** and the floor
check could never reject. A ₹4,500 shoe was approved for a ₹1,500 discount, ₹300
below cost, with the gate reporting "PASS".

**Deployment 502'd repeatedly.** The request handler had no try/catch and no process
guard, and in Node an unhandled rejection kills the process — so one failing query
returned an empty body and every later request 502'd. That masked the real defects:
`persistSession` had 21 columns against `$1..$20`, and `allowed_rails` is `TEXT[]`
but was sent a JSON string. Neither had ever surfaced, because the pages that would
have triggered them had dead JavaScript.

**The highest-leverage fix wasn't code.** With no local database every fix cost a
deploy cycle. Standing up Postgres in Docker against the real migrations let me run
the whole flow locally, and the remaining bugs fell out in one pass.

**And I couldn't see it working.** The engine was strong but unobservable. The
control room fixes that — 13 buyers against the real API, paced to be read, with
budgets draining live.
