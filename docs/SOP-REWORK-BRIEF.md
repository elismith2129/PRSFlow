# SOP rework — brief (Eli, 2026-08-16)

*Captured verbatim-in-spirit from Eli at the end of the Aug 16 session, so the
build session starts from his words, not a reconstruction. This supersedes
nothing yet — `public/sop.html` stays live until the replacements ship.*

## What Eli asked for

The current SOP is one HTML file (`public/sop.html`, iframed at `/sop`). It
needs to be reworked and properly built into the site, as **separate manuals**:

1. **RUNNER SOP** — its own document, served to runner accounts. Runners must
   NOT be able to see the admin SOP. (Gate on `user_profiles.role` — the
   individual runner accounts being created make this possible.)
2. **ADMIN SOP** — one manual for all admin staff, but with **focused tracks**
   for the two roles the operation was recently split into:
   - **STUDIO MANAGER** — owns the building. Daily-ops morning review
     ("did last night go right"), flags, studio tasks, shift logs,
     checklist/mic/petty-cash oversight.
   - **BILLING COORDINATOR** — owns the money. Billing hub pipelines and
     buckets, work-order review → complete → invoice → sent → paid, COD vs
     Billing, payments, AR.
   The split is recent and "really helps us understand the daily operations —
   the two duties split between these two people." The manuals must be
   **very distinct** per role.

## The two constraints that shape the writing

- **This is all completely new to the readers.** Thorough but READABLE —
  plain English, easy to understand, not technical.
- **The billing coordinator is leaving at the end of next week.** The billing
  SOP must work for someone walking in brand new. Priority one. Eli's plan:
  ship ASAP → test and debug the manual WITH the current coordinator while
  she's still here → hand over. Expect revisions; write for revisability.

## What the new-hire reader specifically needs to understand

Eli named these explicitly:
- **The dashboard** — what it shows, what's theirs on it.
- **My Day** — how it works: duties by cadence, the role card, checking
  things off, what overdue looks like.
- **The Flo briefing — "the logic of the Flo briefing, specifically."**
  A reader must come away knowing WHY items appear there, what the lookahead
  is, and what clearing something means.

## Build sequencing (proposed, not yet ruled)

1. **Billing SOP first** — draft fast, review with the departing coordinator,
   revise. The deadline is her last day.
2. Studio manager SOP.
3. Runner SOP — gated to runner role; ships alongside individual runner
   accounts.
4. Serving: rebuild `/sop` to pick the right manual by role (runner sees only
   theirs; admin sees the shared core + their track). The existing VERSIONS
   release-notes mechanism must survive wherever it lands.

## Source material for the writing session

- Spec §19 (two worlds: Billing / Operations / My Day) + the Aug 14
  PROJECT_LOG entry (the redundancy test: one item, one home).
- `docs/MYDAY-BUILD.md` + `lib/myday.ts` (duty cadences, queues, Flo logic).
- `lib/billing.ts` header (the invoice lifecycle — steps, buckets, the one
  next-action rule).
- `lib/dailyOps.ts` (the morning review queue + sweep).
- `public/sop.html` (existing CRM/Clients/Tasks/Flags sections — reusable
  content; the accordion + VERSIONS machinery).
