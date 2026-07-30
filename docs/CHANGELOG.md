# PRSFlo — Changelog (developer-facing)

**Audience: whoever maintains this codebase next — including future Claude sessions and any developer Eli hands this to.** Staff-facing release notes live in `public/sop.html` → `VERSIONS`; they are deliberately non-technical and are NOT a substitute for this file.

## How this file differs from the other docs

Four docs, four questions. Keeping them separate is the point — a single document that tried to answer all four would answer none of them well.

| Doc | Answers | Organised by |
|---|---|---|
| `docs/ONBOARDING.md` | "I'm new — what is this, how do I run it, what will bite me?" | Read once, front to back |
| `CLAUDE.md` | "What are the rules I must not break?" | Topic (locked conventions, architecture rules) |
| `docs/CHANGELOG.md` (this file) | "What changed in version X, and what should I watch out for?" | **Version** |
| `docs/PROJECT_LOG.md` | "Why is it like this? What did we try and reject?" | **Session**, chronological |
| `docs/PRSFlow-Tech-Stack.md` | "Where does X live? What is Y for?" | Subsystem |
| `public/sop.html` → `VERSIONS` | "What changed for me, the person using it?" | Version, plain English |

**Convention:** newest first. Every entry records **migrations** (because those are run by hand and are the most common source of a broken deploy), **watch-outs** (the thing that will bite the next person), and **files touched** where it aids navigation. Detail lives here; narrative and rejected alternatives live in PROJECT_LOG.

---

## v1.4.3 — Jul 29, 2026

**DEV page restructure + floating-panel fixes.**

- **Errors moved from Admin → DEV**, and gated to **Eli's accounts only** (`srv2129@gmail.com` / `eli@paramountrecording.com`), matching the CRM Campaigns gate. Deliberately narrower than the `app_errors` RLS policy, which still allows owner/manager — this only hides the surface. Raw stack traces in front of staff invite alarm about failures that are already handled, and it's a developer tool, not an operations one.
- DEV page rebuilt with a **left sidebar mirroring the Admin page**, so the two internal tool pages navigate identically. Sections: Feedback (any staff) · Testing (PIN) · Errors (Eli).
- **Floating tester: "Continue" always opened at item 1.** The positioning effect ran on batch-id change alone, at which point `results` was still empty because the fetch hadn't resolved — so "first untested" always computed as item 1. It now waits for `loading` to finish and fires once per batch via a ref, so it can't jump the tester mid-tap when a verdict lands.
- **The header counter looked stuck.** It showed `tested/total` (verdicts recorded), which reads as a position indicator that doesn't move with Prev/Next. Now shows both, labelled: `Item N of 38` and `N done`.

**Migrations:** none.
**Watch-outs:** conflating "where am I in the list" with "how many are done" is the kind of thing that reads as a bug even when the number is correct. Label counters.
**Files:** `app/(main)/feedback/page.tsx`, `app/(main)/admin/page.tsx`, `components/dev/TestingFloater.tsx`.

---

## v1.4.2 — Jul 29, 2026

**Testing tooling fixes + failure export.**

- `useTestResults` named its realtime channel `test-results-${batchId}`, but the hook mounts in **three** places simultaneously (a card per batch, the review view, the floating panel). Same batch → duplicate channel names on one table → the error boundary Eli hit. Each mount now appends a module-level sequence number.
- Removed two `!` non-null assertions on `TEST_BATCHES.find(...)`. A stale batch id in `sessionStorage` (or a batch removed in a later deploy) would have thrown and taken the whole page down.
- Floating tester: notes moved **above** the verdict and are always visible; the note now saves *with* the verdict. Previously "Save note" defaulted `status` to `'fail'`, writing a verdict nobody chose. Navigation is explicit Prev/Next, with **Next blocked until a verdict exists**; auto-advance removed so a tester can go back and change an answer. Note drafts are held per item so moving between items never loses typing.
- **Copy for Claude** on Admin → Errors, and **Copy failures + notes** on a test batch review. Claude has no database access, so without an export the diagnosis loop depends on retyping or screenshotting stack traces — which is where the URL, `meta.source` and exact message get dropped.

**Migrations:** none.
**Watch-outs:** the `status` column on `test_results` is NOT NULL, which is why a note can't be saved without a verdict. If a "note only, decide later" flow is ever wanted, that column has to become nullable first.
**Files:** `hooks/useTestResults.ts`, `components/dev/TestingFloater.tsx`, `components/dev/TestingSection.tsx`, `components/admin/ErrorsSection.tsx`.

---

## v1.4.0 – v1.4.1 — Jul 29, 2026

**DEV tab: staff feedback + PIN-gated test batches. Error checks across the runner WO.**

- Nav `Feedback` → **`DEV`**; route stays `/feedback` (renaming would break bookmarks for no gain). The page is a tab shell; the existing feedback board moved verbatim into a `FeedbackBoard` component.
- **Test batch definitions live in CODE** (`lib/testBatches.ts`), only verdicts in the database (`test_results`). A batch is authored in the same commit as the work it covers, so checklist and feature can't drift, and no migration is needed per batch. Item `id`s are **half the results key — never rename one after testing starts** or its verdict is orphaned.
- Testing lands on **batch cards** with status *derived* from results (Not started / N tested / Done · N broken), so it can't go stale. This replaced a planned "active/done flag" — derived state needed no flag.
- **Floating tester panel** in the `(main)` layout: one item at a time, draggable with a clamped position, minimises to a pill, position persisted. Deliberately **not on `/runner`** — runner testing happens on a phone with the checklist on a computer, so a panel there would only cover the UI under test. Being in `(main)` also keeps it off `/login`, `/register`, `/inquiry`. Items carry a Phone/Desktop badge (`deviceFor()`).
- **Runner WO error checks.** `handleSaveChanges` called `router.push` back to the studio hub **unconditionally with no writes checked** — a save that failed on flaky studio wifi bounced the runner away believing their shift was recorded. It now collects each write's error, reports once, and stays on the page. Also wrapped: session notes, equipment condition + notes, date reorder, and both needs-attention photo writes (previously `console.error` only, invisible on a phone).

**Migrations:** `20260729120000_test_results.sql` (one table, unique on `(batch_id, item_id)`).
**Watch-outs:** the testing PIN is a **soft gate, not security** — everything behind it is already readable by any signed-in staff under RLS. Don't let that pattern spread to anything that matters.
**Files:** `app/(main)/feedback/page.tsx`, `components/dev/*`, `hooks/useTestResults.ts`, `lib/testBatches.ts`, `app/runner/[studio]/wo/[id]/page.tsx`.

---

## v1.3.0 – v1.3.2 — Jul 29, 2026

**Runner WO readability, staff reassignment, admin batch edit.**

- Runner Studio Time table: type 9–10px → 11–12px, numbers off `--text2`, cells centred, **Date + Studio frozen** (`position: sticky`), **Studio column added** (it never existed — the cause of a false "duplicate rows" report), zebra **by day** not by row, **today-only default** with an `All N days` toggle. Filtering is render-only; the save loop iterates all rows so hidden-day edits still save.
- Runner staff reassignment: pill → **Change** → sheet with a role-filtered roster. **Single-day only** — bulk editing from a shared phone would rewrite days the runner can't see.
- Admin **Batch Edit** panel: scope *All days* or *Date range*; per-field checkboxes for room, times, rate + type, OT, staff, session info. **Unticked fields are never written.** Skips standalone staff rows and `admin_locked` rows. Routes through `updateStRow` so all derived billing recalculates through one path. Local-first — Cancel reverts the whole batch. Replaced per-cell fill-down arrows.
- Staff times now follow session times **unless independently set** (the test is whether the staff time still equals the session's previous time).

**Migrations:** none.
**Watch-outs:** sticky cell backgrounds **must be opaque** — passing the row's translucent tint let scrolling columns bleed through the frozen ones. They composite the tint over `var(--surface)`.
**Consolidations:** `getLocalToday` → `lib/time.ts` (was byte-identical in **five** files; timezone-sensitive date maths duplicated six ways). Runner table's `ST_GRID` column template defined once (was three copies, so header and body could drift out of alignment).

---

## v1.2.0 – v1.2.1 — Jul 28–29, 2026

**Staffing chosen on the lead; runner PIN provisioned.**

- `leads.staff_role` + `leads.staff_name`, `bookings.staff_mode`. Staffing is picked on the lead (Eng / Asst / **No Staff** + optional roster name, free text allowed) and seeds every WO studio-time row. **`leads.engineer_needed` is now vestigial** — backfilled, unread, drop in a later cleanup.
- `studio_time_rows.eng_role` default flipped to **`assistant`** — an engineer is the exception. Every default was flipped in step across seven places (`seedStudioTimeRows`, `normalizeStRow`, `addStRow`, `addEngRow`, `clearEngRow`, the Seed panel, `buildBookingProjection`).
- Runner PIN: the profile and `staff_pins` row existed but **`auth_user_id` was NULL**, and `set-staff-passwords.mjs` explicitly *skipped* rows without one — so re-running it could never fix the runner. The script now creates (or adopts) the auth account and links it. One PIN pad, role-aware landing: runners → `/runner`.
- Runner lockout: `AuthGuard` bounces `runner` sessions out of the internal app before render.

**Migrations:** `20260728210000_studio_time_rows_eng_role_default_assistant.sql`, `20260728220000_lead_and_booking_staffing.sql`.
**Watch-outs:** `bookings.staff_mode` is an **explicit column, not overloading `engineer_status`** — that column already defaults to `'not_needed'`, so a calendar-made booking and a deliberately unstaffed one would be indistinguishable. Also: `buildRowPayload` used to write `eng_role` only inside its `if (rate or name)` branch, silently dropping the role on the "engineer, TBD" case.
**Architecture decision:** ONE app, not a separate runner app/URL. RLS already grants the runner role nothing on `leads`/`clients`/`client_contacts`/`registration_tokens`/`engineers`/`qc_reports`/`srs_log`, so the CRM was never exposed. Forking would duplicate the WO's studio-time model, seeding and atomic RPCs — the highest-risk code in the repo.

---

## v1.1.0 – v1.1.1 — Jul 28, 2026

**CRM batch: shared Asst Mgr tasks, registrations database, lead date ranges, rename propagation.**

- **Asst Mgr tasks shared.** Root cause was RLS, not UI: the policy let an own-only role read only rows where `assigned_by`/`assigned_to` was their own profile, so Isaac could not SELECT a task assigned to Quinn *at the database level*. Added a peer clause via `is_task_peer(uuid)`. The client-side `.or()` filter was **removed** — it re-implemented the policy in narrower form and was what hid the teammate's task.
- New CRM **REGISTRATIONS** tab (search + date range + 25/page), pending-reg banner moved to CRM page level, **Copy Address** mailing block on registration records.
- `leads.session_end_date` for multi-day holds; the calendar seeds `bookings.end_date` from it.
- **Client renames propagate** (`lib/propagateClientRename.ts`) to `bookings` and `leads` by `client_id`, and to `bookings.ordered_by` by `anr_contact_id`. **Names only** — artist is per-session for a label, and contact details record who was reachable at booking time.
- **First/last are two separate fields anywhere a person's name is edited** (standing convention). Individual client profiles gained real First + Last fields; a combined-only name can't propagate without guessing where to split it.
- Start Booking restored to the lead detail; **the lead is marked booked when the SESSION IS SAVED**, not when the button is pressed, so opening a WO to check a rate and backing out doesn't close a lead out.
- Shared `clients` realtime channel (`hooks/useClientsVersion.ts`) — four consumers, one subscription.

**Migrations:** `20260728190000_leads_session_end_date.sql`, `20260728200000_dashboard_tasks_peer_role.sql`.
**Watch-outs:** don't re-add a client-side `assigned_to`/`assigned_by` filter to the own-only fetchers in `lib/tasks.ts`; those queries intentionally let RLS do the scoping. The lead→WO link is component state only, so an abandoned-then-reopened WO won't mark the lead — a durable `bookings.lead_id` is scoped into Step 9.

---

## Earlier

Before v1.1.0 the project wasn't version-numbered. See `docs/PROJECT_LOG.md` for the full session-by-session history, and `docs/PRSFlow-Tech-Stack.md` → Done table for the feature inventory.
