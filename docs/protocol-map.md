# Settle × the 2026 agentic-commerce protocol stack

**Position: aligned, not certified.** UAP is still being drafted by NPCI, AP2 is maturing inside the FIDO Alliance, and ACP is versioned monthly by OpenAI and Stripe. Settle does not claim conformance with any of them. What it does claim: every artifact Settle emits has a named counterpart in the emerging stack, so the commercial layer drops onto whichever protocol wins without redesign.

## The layer model

| Layer | Protocols | Job |
|---|---|---|
| Authorization | NPCI **UAP**, Google **AP2** | Prove a human pre-approved what the agent is doing, within what limits |
| Commerce / checkout | OpenAI+Stripe **ACP**, Google+Shopify **UCP** | Discovery, cart assembly, checkout session between agent and merchant |
| Settlement | **Razorpay Orders API**, UPI (UPI Reserve Pay / Circle delegation), x402 / MPP elsewhere | Move the money |

Protocols standardize transport and consent. **Nobody ships the commercial intelligence layer** — what a merchant does when an authorized agent's budget doesn't fit the cart. That is the layer Settle occupies, and it is protocol-agnostic by construction.

## Artifact mapping

| Settle artifact | Closest protocol concept | Status here |
|---|---|---|
| Buyer mandate — hard cap, declared flex rule, extras rule, 15-min expiry, DPDP consent | AP2 **Intent Mandate** constraints · UAP user-defined permissions (per-transaction limit, permitted circumstances) | `src/types/mandate.ts` — semantics aligned; buyer-side cryptographic signature is future work (in this demo the mandate arrives over trusted transport) |
| `cartHashAtConsent` binding (sha256 over canonical cart) | AP2 **Cart Mandate** `checkout_hash` binding — prevents paying for anything but the consented cart | Implemented; verified pre-payment (`cartHashMatches`), drift aborts the session |
| `settle.counter_offer.v1` — ed25519-signed offer artifact (offer, mandate id, cart hash, signer key id) | AP2 merchant-signed **Checkout JWT → Checkout Receipt**; ACP checkout session responses | Implemented in `src/negotiation/session.ts` + `src/audit/signing.ts`; signature is embedded in the merchant ledger event. AP2 specifies SD-JWT/ECDSA — a format delta, not a model delta |
| Dual append-only hash-chained ledgers + per-session ed25519-signed tips | AP2's non-repudiable mandate chain for **dispute resolution** | Implemented; tamper-evident + tamper-**attributable**; verified live in both UIs |
| `GET /acp/feed` — machine-readable catalog with rails + negotiation metadata | ACP **product feed** | Inspired subset; enough for an agent to discover the store is transactable |
| Accepted settlements → `POST /v1/orders` (test mode) | Settlement rail | Real Razorpay REST; order ids recorded inside the audit ledgers |
| Consent-scoped affinity memory (`anonymized_topk`) | UAP authorization scope · DPDP consent framing | Implemented at mandate level; non-consented sessions never enter merchant insights |

## What UAP adds on top (and where Settle plugs in)

NPCI's proposed UAP is a **registry-verify-authorize** trust fabric over unchanged UPI rails, built on UPI Circle delegation: agents register, are verified per transaction category, and operate inside user-granted permission scopes. Settle is the merchant-side consumer of that world:

- The mandate Settle negotiates inside **is** the permission scope UAP enforces — same shape (caps, categories, circumstances).
- Settle's guardrails (floor margin, daily budget, cooldown) are the merchant's mirror of UAP's buyer-side limits.
- The signed ledgers give NPCI-style auditability at the commercial layer — who offered what, funded by whom, accepted by whom.

## Deliberate non-goals

- **No protocol certification claims** — the specs move monthly; the mapping table is the honest artifact.
- **No SD-JWT/ECDSA** — ed25519 over canonical JSON is the same trust model with a simpler format; swapping formats touches one file.
- **No stablecoin rails** (x402/MPP) — out of scope for an INR merchant demo; the waterfall is rail-agnostic by design.
