---
name: settle-design-system
description: Visual and interaction rules for Settle's UI - a clean, trustworthy fintech console. Use when building or styling any UI surface in this project (merchant console, trace viewer, demo pages).
---

# Settle Design System — "clean fintech"

## Personality
Calm, precise, trustworthy. The product proves money is handled safely; the UI must feel like a bank-grade instrument, not a startup landing page. Whitespace is a feature.

## Color
- Background: near-white `#FAFAF9`; panels/cards pure white `#FFFFFF`
- Ink/text: `#1C1917` primary, `#78716C` secondary
- Accent (brand, links, focus): deep teal `#0F766E`
- Semantic: success `#15803D`, warning `#B45309`, danger `#B91C1C`, info `#1D4ED8`
- Audit/gate events use semantic colors ONLY — never decorative color on money actions
- Dark mode: invert to `#0C0A09` bg, `#F5F5F4` ink, keep accent/semantic hues

## Type
- Sans: Inter or system stack (`-apple-system, Segoe UI, Roboto`)
- Mono: JetBrains Mono / ui-monospace — ALL amounts, IDs, hashes, API payloads
- Scale: 12/13/14/16/20/28. Body 14. Page titles 20 semibold. No display sizes.
- Amounts: tabular-nums, always `₹1,234.00` format, never rounded silently

## Layout & spacing
- 4px base grid; card padding 16–24; section gaps 32
- Max content width 1200px; dense data tables may go full-width
- Three-zone console: left nav (200px) · main work area · right context panel (320px) when needed

## Components
- Cards: 8px radius, 1px `#E7E5E4` border, shadow only on hover/focus
- Buttons: primary = accent fill; destructive = danger fill w/ confirm step; all money-touching actions get a disabled-until-confirmed state
- Status chips: dot + label (`GATED`, `RESCUED`, `ABORTED`, `PAUSED_FOR_HUMAN`)
- Tables: sticky header, zebra-free, row hover `#F5F5F4`, numeric columns right-aligned mono
- Timeline (audit trail): vertical rail, event dots colored by semantics, timestamps mono, expandable payload rows

## Interaction rules
- Every money action requires explicit confirm; show amount + counterparty before commit
- Loading: skeleton screens, never spinners alone; optimistic UI forbidden on payment states
- Errors: inline near trigger + toast copy that says WHAT failed and WHAT happens next
- Empty states explain why they're empty and what action creates data

## Copy voice
Plain sentences. Name the actor: "Buyer agent paused: coupon expired during settlement." Never blame users; never say "oops."

## Demo hygiene (pitch video)
- 1440x900 viewport, browser zoom 100%, no console errors visible
- Trace viewer must read top-to-bottom as a story: intent → block → negotiation → gate → receipt
