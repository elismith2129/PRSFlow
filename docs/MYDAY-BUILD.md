# MY DAY — Build Brief (operational duties layer)
### Ruling 2026-08-10 (Eli + Fable session). This brief is the entry point for the build session. Read BUILD-HANDOFF.md first for the working mode; this file for WHAT to build.

## 0. Scope ruling — supersedes HR-SPEC's HR-only frame

My Day is the **full daily operations layer** for two roles — **manager** (Fernando)
and **billing** (a ROLE: Aaron is leaving; his successor inherits the card untouched) —
not just HR compliance. Timecards are simply one daily duty inside it. Hiring/training
stay OUT (occasional, still HR-SPEC Phase C). Punch corrections remain HR-SPEC §5,
unbuilt. Goal: Fernando and Billing run their whole day inside PRSFlo so Eli gets
eyes + analytics; the same data fills the Flo box briefing **computed, no AI yet**.

**Sources (verbatim inputs, do not re-derive):** `FD Daily Notes Template.pdf` +
Fernando's verbal explanation (in PROJECT_LOG Aug 10 entry) · `PRS Billing Coordinator
Procedures EDITED BY AARON.docx` §2–3. "Valley" = ARS/ERS/TRK satellites.

## 1. The triad — model everything as one of three kinds

1. **DUTIES** — recurring checkboxes with a cadence. Typed `point` (can't be done
   late) or `cumulative` (missed days accrue; one row with a backlog counter, never
   duplicates — HR-SPEC §2.2–2.3 rules apply verbatim).
2. **QUEUES** — lists COMPUTED from app data, never typed: sessions needing WOs,
   balances to collect, holds, today's sessions, open-hours blocks. Some queue rows
   carry small per-row step checklists (stored state).
3. **SCRATCHPAD** — free-text shift notes per role per day. Don't systematize.

## 2. Duty templates (seed data — the two role cards)

**MANAGER — daily:** Studio check-in × 4 (PRS/ARS/ERS/TRK; each `point`, with
`sub_items` jsonb: opener/closer confirmed · today's sessions reviewed · yesterday's
Slack read · check-in done; Encore adds "Mustard's start time", Track adds "cleaning
shift") · ADP runner timecards (`cumulative`, captures: exceptions cleared) ·
Deliverables/schedule (`point`) · Calendar look-ahead (`point`) · Staff tasks review
(`point`).
**MANAGER — weekly:** Office stock (Wed — manager's, NOT billing's; Aaron explicitly
deleted it from his doc) · Valley checks (Tue + Fri).

**BILLING — daily:** Approve Ramp transactions + chase missing receipts
(`cumulative`, captures: transactions cleared) · Collect + accuracy-check yesterday's
WOs (`cumulative`) · Update last night's invoices in QB per the Daily Invoice
Procedure (`cumulative`, captures: invoices updated) · Create WOs for today's
confirmed sessions (backed by the needs-WO queue) · COD invoicing + outstanding
follow-up (`cumulative`; captures the HR-SPEC §4 Phase-1 three numbers: COD
outstanding · chased today · 31+ past due — typed now, computed when QBO lands).
**BILLING — weekly (Mon):** Ramp weekly report · open/sent-invoice follow-up list
(rule: sent >14d AND last touch >7d — manual Phase 1).
**BILLING — monthly:** tenant rent (create 25th; follow up 5th).

## 3. Queues (computed — the "app logic" that fills Flo)

- **Needs WO:** bookings where `bookingShouldHaveWorkOrder()` true and no WO row.
- **Balances:** WOs where studio+rentals+eng total > payments sum (reuse
  lib/time + WO total math — never re-derive locally).
- **Holds:** bookings `status='tentative'`, with per-row step checklist
  (Email · Calendar · QB · Staff) — stored, checkable.
- **Booked pipeline:** recently confirmed, steps (Calendar · QB · WO).
- **Open hours:** blocks, steps (Log · Calendar).

## 4. Schema (migration FIRST, Eli runs SQL by hand, idempotent + GRANT + RLS + realtime publication)

- `myday_duties` — template: `role ('manager'|'billing')`, `label`, `cadence
  ('daily'|'weekly'|'monthly')`, `due_days int[]` (dow / day-of-month), `dtype
  ('point'|'cumulative')`, `captures text` (label of the count field, nullable),
  `sub_items jsonb`, `sort_order`, `is_active`. Seeded from §2 in the migration.
- `myday_entries` — one per duty per date: `duty_id`, `date`, `completed_at/by`,
  `captured_count numeric`, `sub_state jsonb`, `covers_from date` (cumulative
  backlog clear). UNIQUE(duty_id, date). Backlog days computed in TS, not stored.
- `myday_queue_steps` — `ref_type ('hold'|'booked'|'open_hours')`, `ref_id`
  (booking id), `step text`, `checked_at/by`. UNIQUE(ref_type, ref_id, step).
- `myday_notes` — `role`, `date`, `session_notes text`, `studio_notes text`.
  UNIQUE(role, date). Debounced autosave (800ms, checklist pattern).
- RLS: owner/manager/billing read all + write (coverage rule HR-SPEC §5.6 — any
  manager can work another's card; record who via `completed_by`); others none.
- **Never `.maybeSingle()`.** Realtime: add all four tables to the publication with
  REPLICA IDENTITY FULL; every surface subscribes (channels `myday-*`).

## 5. Briefing composer (lib/myday.ts — computed sentences, no AI)

Order: (1) RED — any cumulative duty with backlog ≥ 3 days, or missed yesterday
("Aaron missed the AR follow-up queue — covering 3 days"); (2) AMBER — queue
pressure: N sessions missing WOs, N balances outstanding ($ sum), COD outstanding
count; (3) GREEN — "Fernando cleared all N duties yesterday." Synopsis = one line,
template-based ("Quiet day — one thing needs you: X" / "All clear."). Dots use
status colours per spec §5. Per-viewer: Eli gets cross-role; manager/billing get
their own. This REPLACES `FLO_STATIC` in `app/(main)/page.tsx`.

**(4) LOOKAHEAD — added by RULING 2026-08-10.** A single neutral line,
`Tomorrow: Valley checks · Office stock`, last in the list.

Why it exists: day-dependent duties (valley checks Tue/Fri, office stock Wed,
tenant rent the 25th) render on the card **only on their own day** — Eli's
ruling, because "I don't want Friday's task cluttering Monday's list," and a
card that pads itself with other days' work is the failure HR-SPEC §2.2 rule 2
warns about. The cost is that you meet a weekly duty the morning it lands. This
tier buys the warning back in the one place a not-today item can sit without
being mistaken for today's work.

Rules: **daily duties are excluded** (a nightly "tomorrow: ADP timecards" is
exactly the noise the ruling prevents); a duty already named in the RED tier is
skipped rather than mentioned twice; the dot is `--c-st-dead` (driftglass), NOT
warm — warm is lead-temp/tentative only (spec §5, ruling 2026-07-31), and a
routine heads-up in orange teaches people to ignore orange. A lookahead line
never downgrades the synopsis from "All clear."

*(Superseded approach, for the record: `myday_duties.always_available` was added
on 2026-08-10 to show these duties every day so they could be ticked late, then
reversed the same day by this ruling. The column survives, unused —
migrations `20260810130000` / `20260810140000`. `dtype` stays `cumulative`:
that is the tracking, not the scheduling, and it is what makes a missed Tuesday
surface on Friday as "covering 2 days.")*

## 6. Surfaces

1. **Dashboard My Day card** — replace `MYDAY_STATIC`: viewer's role card (owner
   sees the view-as toggle's role), progress pill, Due-today pill, backlog callout,
   captured-count inline inputs on completion, collapses to one row when complete
   (HR-SPEC §2.6), stays expanded on 3+ backlog.
2. **Staff 14-day grid** — goes LIVE from `myday_entries` for manager + billing
   rows (green = all due duties done, red = missed, neutral = none due). Replaces
   `DGRID_STATIC`.
3. **`/my-day` workspace** (full page: duties + queues with step checklists +
   scratchpad). **UNDESIGNED — mock-first working method applies:** 2–3 layout
   options in docs/design-refs → Eli picks → ruling into spec → build. PROPOSED
   rail placement: top group, after Dashboard ("My Day") — confirm with Eli.
   Do NOT name it Daily Ops (name is taken — HR-SPEC §2.5a).

   > **DEFERRED 2026-08-10 — do not build this without asking Eli first.**
   > A richer model was proposed and explicitly cut the same day: the full page
   > would own the work, sub-steps would roll up so a multi-step duty completed
   > itself, and an override with a required reason would cover edge cases —
   > the reasoning being that a checkbox standing for four things gets ticked
   > without the four things happening. Eli's call: *"let's skip this and just
   > make it checkboxes on the dashboard. no logic. i got too much to build to
   > sort through bugs and special case scenarios here."*
   >
   > **Current shipped behaviour: the dashboard card is plain checkboxes, no
   > roll-up, no auto-completion, no override.** `sub_items` is populated in the
   > seed and rendered nowhere. The lazy-tick risk is accepted, knowingly.
   >
   > Already built and idle, available whenever this is picked up: every queue
   > in §3 (`fetchNeedsWoQueue`, `fetchBalancesQueue`, `fetchHoldsQueue`,
   > `fetchBookedQueue`, `fetchOpenHoursQueue`), the step-tick storage
   > (`myday_queue_steps` + `setQueueStep`), and the scratchpad
   > (`myday_notes` + `fetchNotes`/`saveNotes`). None of it is wired to a
   > surface; none of it costs anything sitting there.

## 7. Build order (commit-sized; tsc clean before every hand-off line)

1. Migration + seed (§4) — Eli runs SQL before any dependent push.
2. `lib/myday.ts` — duty fetch/complete/backlog, queue queries, briefing composer.
3. Dashboard card + Flo briefing wired (static content dies).
4. Staff grid live.
5. `/my-day` mocks → ruling → build.
6. Roster: nothing schema-side for Aaron's exit (role-keyed by design); offboard
   his `user_profiles` row when his successor is set up.

**Reminders:** soft skin (spec §7c) — new CSS goes BEFORE the soft block or targets
soft values directly; density law §2b; no borders (Law 1); glow is Flo's only;
stage by name, never `git add -A`; `git --no-optional-locks` for read-only git.
