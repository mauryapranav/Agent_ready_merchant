# Submission answers

---

## Project objectives — what does it solve?

**Agents are about to become a real share of checkout traffic, and merchant
infrastructure has no safe way to negotiate with them.**

A shopping agent arrives with a hard budget and machine-readable rules. When the
cart exceeds that budget, a merchant today has two options, and both are bad:

- **Lose the sale.** The agent will not pay over its cap; it simply leaves.
- **Discount blindly.** Fire a blanket percentage off and hope. On Indian retail
  margins that routinely sells below unit cost — a ₹4,500 shoe costing ₹2,700,
  discounted to ₹3,000, books revenue and loses ₹300 a unit.

Settle is the layer that closes that gap without giving away the margin.

**It solves four specific problems.**

**1. Spending other people's money first.** Most rescues do not need to cost the
merchant anything. Brand campaigns, bank and card-network rail offers, and swaps to
a comparable cheaper item are all funded by somebody else. Settle works down a fixed
waterfall — brand campaign, then rail offer, then bundle swap, then a direct price
cut — and stops at the first source a deterministic gate approves. Only the last
step touches merchant margin. Across a seeded 120-buyer run this closes **95% of
carts for ₹4,823** of the merchant's own money, against **₹31,131** for a blanket
10% off — the same job for **85% less**.

**2. Keeping the model out of the money path.** A language model reads the shopper's
intent and writes the explanations. It has no authority to move a rupee. Spend is
bound by a signed mandate with a hard cap, and every decision runs through two
deterministic gates — a buyer gate that compares totals against the cap
arithmetically, and a merchant gate that prices every candidate offer against real
unit cost and refuses anything under the floor margin. **A prompt injection cannot
become a payment instruction, because no model output is on the authorisation path.**

**3. Making refusal a first-class outcome.** A rescue that breaks the margin floor
is worse than a lost sale. When no funding source clears the gate, Settle stops and
says so. When an agent's stretch rule depends on a condition that is not met, the
session pauses for a human rather than guessing. In the live demo, 3 of 13 buyers
never close — and that is the system working, not failing.

**4. Making the whole thing auditable.** Buyer and merchant each keep an append-only
ledger where every entry hashes its predecessor, and the tip is signed with ed25519.
Counter-offers are signed artifacts. The public key set is published at
`/.well-known/jwks.json` so a counterparty can verify independently. Carts are
hashed at consent, so tampering before capture aborts the session. Payment attempts
carry deterministic idempotency keys and are bounded to the rails the buyer allowed.

There is also an agentic product feed at `/acp/feed` — every SKU with price,
accepted rails, and rescue/attachment eligibility — so a buying agent can discover
what the store sells before it ever opens a session.

**In one line:** Settle lets a merchant sell to autonomous buyers, spend other
people's budget before its own, and prove afterwards exactly what was decided and
why.

---

## Build challenges and technical obstacles

Development went smoothly until deployment. Nearly every real problem surfaced at
the boundary between a working local build and a running deployed service — and the
common thread was that **nothing in the project made its own behaviour visible**,
so failures stayed silent until something forced them into the open.

### 1. The whole front end was dead, and nothing said so

Both `index.html` and `buyer.html` had a JavaScript **syntax error committed to the
repo**. The `esc()` helper was written with HTML entities as its replacement values,
and at some point a formatting pass HTML-decoded them *inside* the `<script>` tag —
so `"&quot;"` became `"""`, which does not parse.

The consequence: no JavaScript ran on either page at all. The catalog never loaded,
buttons were dead, the scenario suite never executed. Because the pages still
*rendered*, this looked like a styling problem rather than a total failure.

**Fix:** restored the entity literals and added a parse check so a syntax error in a
page script fails loudly instead of silently disabling the page.

### 2. The engine and the API were reading two different catalogs

The negotiation engine imported products, rail offers and swap alternatives from a
static module, while the API served everything from Postgres. The two shared **2 of
12 SKUs**.

For the other ten, `productBySku()` returned `undefined`, cost fell back to `0`, and
the merchant gate therefore computed a **100% margin on every one of them** — so the
floor-margin check could never reject anything. I demonstrated it end to end: a
₹4,500 shoe costing ₹2,700 was approved for a ₹1,500 discount, selling ₹300 below
cost, with the gate reporting "PASS, margin 100%".

Two branches of the waterfall were also dead in production, because their swap
targets did not exist in the database. And `/api/catalog` advertised bank offers
(15% off, max ₹750) that the engine never used — it applied the module's 5%, max
₹250. **A number was on screen that the system did not act on.**

**Fix:** the engine now accepts products, rail offers and swaps as inputs (defaulting
to module data so the simulation stays self-consistent), and the API passes the same
data it used to price the cart.

### 3. Controls that looked enforced but never ran

`addReleaseLedgerEntry` existed and was never called. The merchant gate read the
release ledger to enforce a daily discount budget, a max-releases-per-day cap and a
per-buyer cooldown — against a table nothing ever wrote to. All three were inert.

Combined with the cost bug above, **all four merchant controls were decorative in
production** while the code read as though they were enforced.

**Fix:** persist release entries per session; the gate now binds. I also added a
guarded `UPDATE ... WHERE remaining_budget_paise >= $1` so a campaign budget cannot
be overdrawn by a concurrent draw.

### 4. Local passed, deployment 502'd — repeatedly

This was the hardest stretch, and the root cause was structural rather than any one
bug. The request handler was an inline `async` callback with **no try/catch and no
process-level guard**. In Node, an unhandled rejection terminates the process. So a
single failing query did not return a 500 — it killed the server, returned an empty
body, and every subsequent request 502'd.

That masked the actual defects. Once errors were made visible, they came out one at
a time:

- **`persistSession` had 21 columns against `$1..$20`.** Every session write failed.
  It had never surfaced because the pages that trigger a session had dead JavaScript,
  so nothing had ever called it.
- **`allowed_rails` is `TEXT[]`**, but the code passed `JSON.stringify(...)`, so
  Postgres received the literal `["upi","card"]` and rejected it as a malformed array
  literal.
- **A non-idempotent build.** `cp -r public dist/public` copies *into* the target
  when it already exists, so any rebuild over a cached `dist/` nested the assets one
  level deeper and the routes 404'd.

**Fixes:** the handler returns a 500 with the reason instead of dying; static routes
fail soft; the SQL is corrected; and I added a test that scans every `INSERT` in the
codebase for column/value mismatches and non-contiguous placeholders — verified to
fail on the exact bug when reintroduced.

### 5. No local database, so nothing could be reproduced

For most of the debugging I had no Postgres locally, which meant every fix was a
guess verified by a deploy — one bug per deploy cycle. Solving that was the single
highest-leverage step: I stood up Postgres in Docker matching the app's default
connection string, ran the real migrations and seed, and drove the entire flow
locally. **Every remaining bug fell out in one pass instead of five.**

The lesson: the fastest fix was not a code change, it was making the system
reproducible.

### 6. Invalid credentials failing invisibly

After rotating the Razorpay keys, every payment failed with `Authentication failed`
— each buyer retried three rails, so the run crawled and every session aborted. The
executor handled it correctly, but nothing said *why*.

Separately, the LLM parser caught **every** error and silently fell back to the
deterministic parser. A wrong model name or an expired key was indistinguishable
from "no LLM configured" — the UI just said "deterministic parser". The
`llama-3.1-70b-versatile` model in the deployment config has since been
decommissioned by Groq, which is exactly the failure that would have looked like
nothing at all.

**Fix:** the fallback now logs the real reason, and the demo surfaces which parser
actually ran.

### 7. Not being able to see the project working

The project had strong internals and no way to observe them. A session returned one
final object; the per-step waterfall detail existed but was flattened before it
reached the UI. There was no way to watch a negotiation happen.

That is what the control room solves: 13 scripted buyers run against the real API,
paced so a human can read each step, with the policy and campaign budgets draining
live beside them. Several features that were already built but **completely
invisible** are now on screen — the plain-English receipt, the ed25519 ledger
signatures, the agentic product feed, and a transaction history where any row
expands into its mandate, waterfall trace and settlement.

Two safeguards came directly out of getting burned:

- The page **warns before you present** if a previous run left campaign budget
  drained or the daily discount budget spent, because that silently removes the one
  buyer where the merchant pays.
- The rate limiter's capacity was raised once a full run became 13 sequential
  sessions — the old ceiling of 10 tripped partway through a demo.

### The pattern across all of it

Almost every problem was the same shape: **the system did something different from
what it appeared to do, and nothing surfaced the difference.** Dead JavaScript that
still rendered. A gate that reported 100% margin because cost was zero. Controls
reading a table nobody wrote to. A crash that looked like a network error. A
credential failure that looked like a configuration choice.

The fixes that mattered most were not clever — they were the ones that made the
system say what it was actually doing.
