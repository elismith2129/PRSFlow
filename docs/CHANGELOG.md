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

## v1.5.1 — Jul 30, 2026

**Runner couldn't open work orders on multi-day sessions. Mobile WO sheet layout.**

- **The runner hit "Work order not yet created — contact office." on a WO that plainly existed.** The hub resolved a booking's WO by asking *which work order has `booking_id` = this booking*. Since the July 2026 rebuild that question has the wrong shape: a WO save writes **several booking projection cards** (one per consecutive same-room run) and they all carry `work_order_id`, but `work_orders.booking_id` names only **one** of them — the original. So the original card opened fine and every other card dead-ended. Any multi-day or multi-room session was affected. Both the hub's `woMap` and the WO page's resolver now read the card's own forward link (`bookings.work_order_id`) first, falling back to the old reverse lookup for pre-rebuild rows.
- **The nav painted through the middle of the mobile WO sheet.** Nav is `z-index: 99999` and deliberately above all modals, so a sheet starting at `top: 0` doesn't cover it — it gets covered. The desktop branch has always used `top: 52` for exactly this reason; the mobile branch never carried it over. Mobile now offsets 52 as well (the Nav is 52px tall on mobile too — the 44px is the hamburger button *inside* the bar), and the inner containers switched `100dvh` → `100%` so they don't overflow by the nav's height and push the footer buttons off-screen.
- **Removed a leftover per-studio accent** on the mobile WO header. It tinted the header's bottom border by venue, and mapped `ameraycan` → `var(--hot)` — the **lead-temperature red** used everywhere else for danger, errors and cancelled sessions. Every Ameraycan work order opened with a 3px red bar and read as broken. Per-studio colour coding had already been removed across the runner, admin, LocationStrip and dashboard; this survived because its comment claimed to mirror the Runner Hub header, which had itself moved to a neutral 1px border in that same pass. The comment was stale, not the design.

**Migrations:** none.
**Watch-outs:** `work_orders.booking_id` is now a **fallback**, not the primary link — it is still load-bearing for create-idempotency and must not be dropped outside the planned Step 9. When adding any new booking → WO lookup, read `bookings.work_order_id`. And don't reintroduce venue colours without reintroducing them everywhere; if you do, don't borrow a token that already carries meaning.
**Files:** `app/runner/[studio]/page.tsx`, `app/runner/[studio]/wo/[id]/page.tsx`, `components/calendar/WorkOrderPopup.tsx`.

---

## v1.5.0 — Jul 29, 2026

**Security: PIN login taken down after a distributed brute-force attempt.**

- **The incident.** `POST /api/auth/pin` took sustained guessing from **~50 distinct IPs** at roughly one attempt per second — spread deliberately so no single IP carried enough load to trip the per-IP lockout. Found by chance in the Vercel request log; nothing in the app reported it.
- **Why it was worth attacking.** `verify_staff_pin(p_pin)` takes **only the PIN** — no username, no email — and matches it against every staff row at once. With 4 digits (10,000 combinations) and ~10 provisioned accounts, **any random guess had roughly a 1-in-1,000 chance of hitting a real account.**
- **The bug that made it cheap.** The lockout wrote `fail_count: willLock ? 0 : nextCount` — **resetting the counter on lockout**. Five fails → 30s lock → counter back to zero, forever. ~600 attempts/hour/IP, and the escalation the code appeared to have was unreachable.
- **Fixed:** counter only ever climbs; lockout escalates `30s → 2m → 10m → 60m`; forgiveness is a **6-hour quiet period since the last failure** (`DECAY_MS`), not surviving a lockout. New append-only `pin_login_failures` (ip, user_agent, outcome) — `pin_login_attempts` holds one row per IP and is deleted on success, so it can never answer "what happened last night". Login countdown humanised (`3600s` → `60m`).
- **Then taken down entirely.** The app is not live yet (a handful of real users), which reverses the cost/benefit: all `staff_pins` rows deleted, all sessions revoked, everyone moved to email + password. `PIN_LOGIN_ENABLED = false` in `app/(auth)/login/page.tsx` hides the numpad and defaults the screen to email — with zero PIN rows the pad could only fail silently and look like a broken app.
- **`scripts/set-one-password.mjs`** — sets a known password on one account via the admin API, no email. Written because Supabase's built-in sender caps at ~2 messages/hour and that cap was reached with a manager locked out mid-shift. Refuses macOS **curly quotes**, which bash passes through as literal characters — the first real run set a password *including* the quote marks and login failed while `auth.users` looked perfectly healthy.
- **Also shipped:** the registration ID viewer no longer auto-downloads files (`isDoc = !isImagePath(...) || imgFailed` conflated "is a PDF" with "the image failed to load", so a failed `<img>` rendered an `<iframe>` at a format the browser can't display inline — which makes it download). Now `isPdf` gates the iframe, with an honest HEIC fallback panel. Client-facing forms (`/register/:token`, `/inquiry`) forced dark; `/register/view/:clientId` excluded as it's a white print sheet.

**Migrations:** `20260729140000_pin_login_failures.sql` — **run**. No insert policy by design: the route writes with the service-role key (which bypasses RLS), so nothing holding a browser token can flood or forge the log. SELECT is owner/manager only.

**Watch-outs:**
- **Staff Supabase passwords are random 32-char strings from `set-staff-passwords.mjs` that nobody knows.** Any design that throttles or disables PIN login *globally* therefore locks out the entire team with no recovery path. A global rate limit was proposed and withdrawn for exactly this reason.
- **Supabase silently falls back to the project Site URL** when a `redirectTo` isn't on the Redirect URLs allowlist. Reset emails were going to `http://localhost:3000` even though the code correctly hardcodes production. Fixed in the dashboard; would have hit every staff member.
- **Vercel Bot Protection is set to Challenge.** It challenges non-browser traffic — which the two Vercel Crons also are. Confirm `auto-demote` (09:00) and `reset-needs-action` (15:00) still run.
- The lockout cap is **60 minutes on purpose**. Staff at one studio share a public IP; an unbounded lock would let one runner's mistype take a room offline mid-session. Don't "harden" it without solving the shared-IP problem first.
- `PIN_LOGIN_ENABLED` is the single flip to bring PINs back. Nothing else needs changing — the PIN code paths are untouched.

**Files:** `app/api/auth/pin/route.ts`, `app/(auth)/login/page.tsx`, `scripts/set-one-password.mjs`, `components/shared/RegViewModal.tsx`, `app/layout.tsx`, `supabase/migrations/20260729140000_pin_login_failures.sql`.

---

## v1.4.3 — Jul 29, 2026

**DEV page restructure + floating-panel fixes.**

- **Errors moved from Admin → DEV**, and gated to **Eli's accounts only** (`srv2129@gmail.com` / `eli@paramountrecording.com`), matching the CRM Campaigns gate. Deliberately narrower than the `app_errors` RLS policy, which still allows owner/manager — this only hides the surface. Raw stack traces in front of staff invite alarm about failures that are already handled, and it's a developer tool, not an operations one.
- DEV page rebuilt with a **left sidebar mirroring the Admin page**, so the two internal tool pages navigate identically. Sections: Feedback (any staff) · Testing (PIN) · Errors (Eli).
- **Floating tester: "Continue" always opened at item 1.** The positioning effect ran on batch-id change alone, at which point `results` was still empty because the fetch hadn't resolved — so "first untested" always computed as item 1. It now waits for `loading` to finish and fires once per batch via a ref, so it can't jump the tester mid-tap when a verdict lands.
- **The header counter looked stuck.** It showed `tested/total` (verdicts recorded), which reads as a position indicator that doesn't move with Prev/Next. Now shows both, labelled: `Item N of 38` and `N done`.

- **Third-party error noise filtered.** `window.onerror` catches everything on the page, including browser extensions and iOS webviews probing for native bridges (`window.webkit.messageHandlers`). Those aren't our bugs and can't be acted on, and an error log nobody trusts is one nobody reads. `ErrorReporter` now drops a small allowlist of provably-external patterns: the webkit bridge probe, opaque cross-origin `Script error.`, and the benign `ResizeObserver loop` warning.

**Migrations:** none.
**Watch-outs:** conflating "where am I in the list" with "how many are done" is the kind of thing that reads as a bug even when the number is correct. Label counters. Only add to `IGNORED_ERROR_PATTERNS` for errors provably not ours — the filter is there to protect signal, not to hide failures.

**Confirmed from the live error log (Jul 29):** the error-boundary entry read `cannot add 'postgres_changes' callbacks for realtime:test-results-wo-runner-2026-07 after 'subscribe()'` — note the channel name with **no instance suffix**. This is the exact mechanism behind the duplicate-channel bug: supabase-js hands back the *same already-subscribed channel object* for a duplicate name, and calling `.on()` on it after `subscribe()` throws. The unique-name-per-mount fix in v1.4.2 addresses it directly.

**Files:** `app/(main)/feedback/page.tsx`, `app/(main)/admin/page.tsx`, `components/dev/TestingFloater.tsx`, `components/ErrorReporter.tsx`.

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
