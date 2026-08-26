# Settle — Security Audit (pre-submission pass)

Scope: money-handling paths (gates, negotiation, ledgers), API surface, console UI.
Method: Cloudflare security-audit checklist adapted to this codebase; manual source→sink tracing.

## Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Medium | Console rendered server-derived strings (`itemsLabel`, ledger event JSON, session IDs) via `innerHTML` without escaping → stored-XSS pattern if any upstream field ever carried markup. | **Fixed** — `esc()` helper applied to all interpolated server strings (`public/index.html`). E2E suite re-run green. |
| 2 | Low | `/api/session` has no rate limiting or auth. | Accepted risk for offline demo scope. Documented here; production would gate per API key + IP. |
| 3 | Low | Offer-expiry race: buyer validates expiry at decision timestamp; a real deployment must re-validate at the acquirer at capture time. | Mitigated by design: Policy Gate re-checks offer validity inside `runSession` before payment; noted as production TODO. |
| 4 | Info | Deterministic parser uses regex on free text; no shell/SQL sinks exist downstream, so injection surface is nil by construction. LLM parse path returns structured JSON only and never executes. | No action |
| 5 | Info | All money arithmetic in integer paise; no float money anywhere in settlement paths. | Verified by tests |
| 6 | Info | Audit ledgers are hash-chained from genesis; any historical edit breaks `verify()` for all subsequent entries (tamper-evident, not tamper-proof — no signing key yet). | Future work: sign chain tips with merchant key |

## Verified properties

- Buyer hard cap is enforced by pure function `evaluateBuyerGate`; stretch only fires with pre-declared soft-criteria matches (unit-tested adversarial cases).
- Merchant floor margin / daily budget / cooldown enforced by `evaluateMerchantGate` before any release (unit-tested).
- Cart-drift abort occurs before any payment attempt (E2E scenario 04).
- Payment retries bounded (max 3 rails) then human-visible abort (E2E scenario 02).
- Consent revocation removes affinity data from both ranking and merchant sharing (unit-tested).
- No secrets committed; `.env` gitignored, `.env.example` documents optional LLM keys.
