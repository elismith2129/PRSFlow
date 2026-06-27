# PRSFlow — Project Log

*Living document. Update as decisions are made.*
*This file is read by every Claude session for context — keep it current.*

---

## 1. Decisions Log
*Why we built things the way we did. Reference this before second-guessing past choices.*

### Data model
- **Labels are clients, A&Rs are contacts, artists are a text array.** When a label books, the *client* is the label, the *ordered by* is the A&R (lives in `client_contacts`), the *artist* is who's recording (lives in `clients.artists[]`). For COD/individual clients, all three collapse into one row. *(Decided in Chunk 4 planning, May 2026.)*
- **Label divisions are separate clients.** Sony General ≠ Sony Latin ≠ UMG General ≠ UM Latino. Don't merge them.
- **"Individual" is the database value, "COD" is the display label.** Schema uses `type='individual'`, UI shows "COD" everywhere.
- **23 labels is our effective max.** After 40 years, every label that will book with us is already in our system. Going forward, label *clients* don't get created — only label *contacts* and *artists* get added.
- **Bookings track A&R and Admin as foreign keys.** `bookings.anr_contact_id` refs the A&R from `client_contacts` who ordered the session; `bookings.anr_admin_contact_id` refs the admin contact handling logistics. Both are nullable — COD bookings typically have neither. Added in chunk-anr-admin-d1 (May 2026).

### Migration approach
- **Migrate clients/contacts only — no historical bookings.** The clients table has 615 clients migrated from 1,638 booked leads. We did NOT migrate historical bookings or create a "needs review" backlog. Original leads remain untouched in the leads table as historical reference.
- **Messy migrated data was skipped, not flagged.** 401 booked leads have no `client_id` because their names were too messy to import. They'll be re-created naturally when those clients book again. Don't try to "fix" these in bulk.
- **All label artist arrays were wiped clean after migration.** The migration auto-populated artist names from clean fname+lname matches, which incorrectly included A&Rs. Manually wiped to empty arrays — artists get added one at a time through real bookings.

### Architecture
- **No RLS until Chunk 9 (Auth).** Tables are open like the leads table. Will add RLS + role policies (office vs runner) when auth is built.
- **Frequent commits + branch-per-sub-chunk.** Each sub-chunk gets its own branch (e.g., `chunk-4-5`), commits happen after every meaningful piece of work, merge to main only when sub-chunk is confirmed working.
- **Email sending is deferred to Chunk 5.** Any "send email" button in the meantime uses `mailto:` to open the user's default mail client. No SendGrid/Resend integration yet.
- **No automated testing infrastructure for the foreseeable future.** No Playwright, Jest, Vitest, or any test framework. Manual browser testing only. If Claude suggests writing tests or adding a testing dependency, redirect back to manual verification.
- **Public registration form uses anon INSERT policy on private `client-ids` storage bucket** with 25MB size limit and restricted MIME types (jpeg/png/heic/webp/pdf). Token-gated in app code — the token must exist, be unexpired, and unused before the form renders.
- **Public routes use Next.js route groups to isolate from internal pages.** `app/(main)/` contains nav-bearing pages (CRM, Clients, Dashboard, etc.); `/register` and any future public routes live outside it. Until Chunk 9 adds auth, this is the only mechanism preventing public visitors from accessing internal data.

### Auth, user profiles & task assignment (June 25, 2026)
- **Auth login is client-side guarded, not SSR-middleware gated.** The project has no `@supabase/ssr` and no `middleware.ts`, every page is `'use client'`, and `signInWithPassword` stores the session in **localStorage** (cookie-reading middleware would not see it). So route protection is a client guard — `components/auth/AuthGuard.tsx` wraps `app/(main)/layout.tsx`, checks `supabase.auth.getSession()`, redirects unauthenticated users to `/login`, subscribes to `onAuthStateChange`, and renders nothing until the session resolves. `app/(auth)/login/page.tsx` + `app/(auth)/reset-password/page.tsx` are the login / forgot-password / reset flows; the login page bounces already-authed users to `/`. **Only the internal `(main)` route group is gated** — `/runner/*`, `/register`, and the `(auth)` pages stay public. This is **UX gating, not data security**: RLS is still off (Chunk 9), so the anon key keeps full table access. Nav has a Sign Out button (`signOut()` → `/login`).
- **`user_profiles` uses a surrogate PK, not the auth.users id.** The originally-requested DDL made `id` reference `auth.users(id)`, but the 6-row seed must insert **before** any auth accounts exist (a PK can't be null and a fabricated id violates the FK). Resolution (`supabase/user_profiles.sql`): `id uuid PK default gen_random_uuid()` (stable, what `dashboard_tasks.assigned_to/by` reference); `auth_user_id uuid unique references auth.users(id) on delete cascade` (nullable — backfilled after invites); `email text not null unique` (the temporary lookup key `useUserProfile` matches the session email against). RLS left disabled per instruction; GRANT to anon/authenticated. **Migrations are run manually in the Supabase SQL editor** (Claude has no DDL access — only the anon key locally; no service-role key / DB password / CLI / psql).
- **`user_profiles.role` set + roster changed after the migration.** The migration seed used `owner | manager | asst_manager | staff`; the live table now uses **`owner | manager | billing | asst_manager | tech`** with roster: Eli & Adam-Mike (owner), Fernando (manager), Aaron (billing), Quinn & Isaac (asst_manager), Sierra & Tom (tech). The TS `UserProfile['role']` union matches the new set.
- **Dashboard task tabs are driven by `assigned_to`, not `assigned_role`.** Six per-user tabs (Eli / Adam-Mike / Fernando / Aaron / Asst Mgr / Tech) resolve `user_profiles` ids **by display_name at runtime — no hardcoded UUIDs**; each tab queries `dashboard_tasks` by `assigned_to IN (member ids)`. Asst Mgr = Quinn+Isaac, Tech = Sierra+Tom. Tab visibility by role: owner/manager/billing see all 6 and can assign to anyone; asst_manager sees only Asst Mgr; tech sees only Tech. The add-task "Assign to" dropdown is a **flat** list (Adam-Mike, Eli, Fernando, Aaron, Asst Mgr, Tech) — the two role options assign to the **primary member's id** (Asst Mgr → Quinn, Tech → Sierra) so they route to the member-based tabs with no tab-query logic change. `assigned_role` is now vestigial: new manual tasks set it to the constant `'admin'` (its CHECK set — `admin/studio_manager/asst_manager/billing` — doesn't include `'tech'`, so that value can't be stored there anyway). asst_manager/tech users auto-assign new tasks to themselves; `assigned_by` is always the creating user.
- **Add-task photo "not saving" — RESOLVED June 26, 2026 (was never a defect).** Symptom was: files reached storage (`checklist-photos/dashboard-tasks/`) but some recent `dashboard_tasks` rows had `photo_url = NULL`. Anon-key probes proved the save path is healthy: the `photo_url` column exists, an insert with a `photo_url` value reads back correctly, and `uploadPhoto` (upload + `getPublicUrl`) returns a valid URL. The NULL rows were test tasks ("fernando test 1/2", "asst manage test 1") saved **without a photo attached**. The fix shipped was clarity, not a code repair: a thumbnail preview (`URL.createObjectURL`, shown on file select) + `.select()` insert-error logging in the add-task modal (`056aa79`), and the **same preview in the task-detail comment section** (`6211d17` — `pickCommentPhoto`/`clearCommentPhoto` create+revoke the object URL, all reset paths revoke via `clearCommentPhoto`). With attachment state now visible at pick time, the "missing photo" disappears as a confusion. Closed — no bucket-policy or sanitization change was needed.

### Tasks page, dashboard deep-links & WO line-item tables (June 25–26, 2026)
- **Task tab/roster logic is extracted to `lib/tasks.ts` — single source of truth for the dashboard panel AND the `/tasks` page.** When the full `/tasks` page was added, the helper set (`TAB_DEFS`, `ASSIGN_OPTIONS`, `resolveAssignTo`, `nameForId`, `visibleTabsForRole`, `idsForTab`, `fetchTasks`, plus new `fetchCompletedTasks`, `fmtTaskTime`, `uploadTaskPhoto`) was pulled out of `app/(main)/page.tsx` into `lib/tasks.ts` and imported by both surfaces, so the roster encoding can't drift between them. The dashboard page kept its **local** `fmtTime` and `uploadPhoto` copies untouched because the flags code also calls them — swapping those would have touched six unrelated flag call sites. The dashboard's old completed-tasks "history" modal is now superseded by `/tasks` and unreachable (nothing sets `showHistory`); it was left in place rather than ripped out, to keep the change scoped.
- **`/tasks` is a deliberately nav-less, dashboard-only page.** Reached solely via the Tasks panel's "show all tasks →" link (which replaced the old "history →"). The dashboard panel caps its visible list at 9 with a muted "+ N more" link; `/tasks` shows everything: Active (incomplete) + a Completed section that is **collapsed by default** (header toggles `COMPLETED (n) ▼`/`▲`). A "Search tasks…" box filters both sections, and a non-empty query **overrides the collapse** so search always reaches completed tasks. (The search box wasn't in the original ask but its exception + verify step required one to exist, so it was added.)
- **Dashboard deep-links read query params with `window.location.search`, not `useSearchParams`.** The Needs Action lead rows link to `/crm?lead=<id>`; CRM resolves it in a mount effect, mirroring the page's existing `?clientId=`/`?id=` handling. This was a deliberate choice over `useSearchParams`, which in a page-level client component forces wrapping the default export in a `<Suspense>` boundary or the static build fails — a larger structural change. The lead-param effect also sets `hasAutoSelected.current = true` so the default Needs Action auto-select doesn't override the deep-linked lead, and nudges the view off `analytics` (the detail panel only renders in a list view).
- **Dashboard empty-room booking reuses the calendar's `openNew`, it does not duplicate the form/save.** Empty room-grid cards navigate to `/calendar?newBooking=1&location=&studio=&date=`; the calendar gained an effect that fires when `newBooking` is present **without** a `clientId` (so it never collides with the client-based "Start Booking" flow) and calls the existing `openNew(location, studio, date)` — reusing the real `BookingForm` and its `handleSave` insert path. **Occupied cards stay clickable (open their booking)** — the original spec said make them non-clickable, but that would have regressed the shipped "dashboard room grid → booking modal" feature, so on an explicit decision the existing behavior was preserved.
- **`work_orders` line items are separate tables keyed by `work_order_id`, not jsonb arrays.** The legacy `WorkOrderLegacy` type stored `studio_rows`/`rental_rows`/`payment_rows` as jsonb on the WO row; the live `WorkOrder` type (`lib/supabase.ts`) has none of those columns. `studio_time_rows`, `rental_rows`, and `payment_rows` are their own tables (queried by `WorkOrderPopup`, the runner WO page, and `/wo/[id]/print`). This was surfaced while building the backup script — CLAUDE.md's data-model "jsonb arrays" line was stale and has been corrected.

### Automated backups (Google Drive via GitHub Actions, June 26, 2026)
- **The backup runs on GitHub Actions, not Vercel, and talks to Supabase over REST with `fetch()` — never `@supabase/supabase-js`.** The JS client initializes a realtime WebSocket client that throws "Node.js 20 detected without native WebSocket support" in CI unless `ws` is installed. `scripts/backup.mjs` hits PostgREST directly (`${SUPABASE_URL}/rest/v1/<table>?select=*&deleted_at=is.null&limit=1000&offset=N`, anon key as `apikey` + bearer), paginating by `offset` until a short page. Tables without a `deleted_at` column return PostgREST `42703`; the script detects that on the first page and transparently retries without the filter, so those tables still back up fully.
- **17 tables, names verified against live `.from()` usage.** Several names the task originally specified were wrong or partial; greps for `.from('…')` corrected them: `mic_inventory` → `mic_inventory_quantities`, `srs_referrals` → `srs_log`, `daily_ops_log` → `daily_ops_submissions`. Added `dashboard_task_comments`, `flag_comments`, `studio_time_rows`, `rental_rows`, `payment_rows`, `petty_cash_entries`. A wrong/missing table name is non-fatal — it's logged in an `errors` array and skipped; only a Drive **upload** failure exits non-zero.
- **Drive auth + failure UX.** Authenticates from the `GOOGLE_SERVICE_ACCOUNT_JSON` GitHub secret (parsed at runtime), uploads `prsflow-backup-YYYY-MM-DD.json` with `supportsAllDrives: true` (Shared Drive support). A 404 on upload prints "Check that the Drive folder is shared with the service account email" plus the `client_email`, because that's the usual cause — and because a service account has **no Drive storage quota of its own**, the target must be a Shared Drive (service account added as a member) or a folder owned by a real user and shared to the service account. The folder ID went through several corrections (`…45JWG` → `11pu8jRYh9…` → `1SjhWdOP9…`); the final value is the Shared Drive folder.
- **`.github/workflows/` pushes need a `workflow`-scoped token.** The first backup commit was rejected by GitHub because the local PAT lacked the `workflow` scope (required to create/update anything under `.github/workflows/`). Once the token had the scope, the workflow file pushed. Commits that don't touch `.github/workflows/` are unaffected. The workflow uses Node 24 and `npm ci` (so `package-lock.json` must stay in sync — `googleapis` was added via `npm install`, which updated the lockfile).

### Mobile responsiveness (June 26, 2026)
- **`useIsMobile()` is the single mobile breakpoint, desktop-first.** `hooks/useIsMobile.ts` returns `matchMedia('(max-width: 768px)').matches`, defaulting to `false` on first render so server/first-paint always emit the desktop layout (no hydration mismatch), then flips on mount. Every responsive surface gates layout on it (dashboard, Nav, CRM, calendar, BookingForm, WorkOrderPopup, LocationStrip). The rule across the whole mobile pass: **desktop output must be byte-for-byte unchanged** — mobile is always an `isMobile ?` branch (or `@media (max-width: 768px)` in `globals.css`) whose desktop side is the original, never a rewrite.
- **Two global mobile CSS rules live in `styles/globals.css` under `@media (max-width: 768px)`:** `html, body { overflow-x: hidden; max-width: 100vw }` (defensive against any element forcing horizontal scroll) and `.page-main { padding: 16px 12px !important }` (tightens the shared `(main)` gutter; `!important` is required to beat the inline `padding: 24px 32px` on `<main>`). `app/(main)/layout.tsx` adds `className="page-main"` to `<main>`.
- **Full-screen modals/sheets on mobile use `100dvh` + `borderRadius 0`, never a centered card.** The dashboard's `fullscreenCardOnMobile(isMobile)` helper, the CRM detail view, the calendar BookingForm/WorkOrderPopup, and the day-view all follow this. Full-screen sheets are flex columns — fixed header (`flexShrink: 0`), scrollable body (`flex: 1; overflow-y: auto; **minHeight: 0**`), fixed footer (`flexShrink: 0`). The `minHeight: 0` is mandatory: without it a flex body grows to content height and the whole sheet scrolls (header included) instead of just the body.
- **The WorkOrderPopup mobile view is modeled on the Runner Hub WO page** (`app/runner/[studio]/wo/[id]/page.tsx`) as the canonical visual template: `#0d0f14` page / `#161920` section cards / `1px #2a2e3d` borders / radius 12, 10px-700-0.12em-uppercase-`#8b90a8` section labels, DM Mono data rows. Booking-form fields that don't belong in a WO view are `display:none` on mobile (kept in the DOM so desktop + save logic are untouched), replaced by a read-only SESSION INFO card; the footer is reduced to Cancel + Save with Complete WO moved into the body.
- **The calendar defaults to Day view on mobile and has no swipe navigation.** Swipe was tried three ways and removed — touch handlers on the scroll container fight native vertical scroll and displace the sticky room-label column, and there's no clean way to reconcile them with the infinite-scroll grid. Mobile navigation is the arrow buttons + a tappable native date-input overlay on the range label. The grid's booking blocks are filtered to the rendered window (`load()` fetches a ±2-week buffer that mobile doesn't render, so off-window blocks must be excluded or they clamp to slivers at the left edge).
- **Booking chip text is white/muted, not payment-type-colored.** Chip name `#e8eaf0`, label/company `#9ca3af`, time + engineer initials `#6B7280` — the old COD-blue (`#7BBFFF`) / label-purple (`#96A9FF`) name tint and the green/orange engineer-status tint were dropped from chips. Chip background/border/glow/status-top-bar still encode status; only text changed.
- **Fresh-login welcome splash is sessionStorage-flag driven with a multi-layer no-flash hold.** `login` sets `sessionStorage 'showWelcome'`; the dashboard consumes + clears it on mount (so refresh never re-triggers), shows a one-time splash above the Nav (`zIndex 100000`), then dispatches a `welcomeDone` event. To avoid any frame of dashboard/nav showing first: `AuthGuard` holds a full-screen `#0d0f14` div while the session resolves when the flag is present, and `components/layout/NavGate.tsx` (wrapping `<Nav>`) hides the nav on first paint and reveals it on `welcomeDone` (3s fallback). An earlier inline-`<script>` pre-hide approach was abandoned for the AuthGuard dark-hold.
- **The live clock lives in the dashboard hero (desktop only), not the Nav.** It was removed from `Nav.tsx` and rendered bottom-aligned with the dashboard `<h1>` in DM Serif Display (date `#c8f04e` + time `#e8eaf0`, one line), hidden on mobile. Supersedes the earlier nav-clock arrangement.
- **The experimental UnifiedSessionForm (USF) is no longer reachable from the UI.** The owner-gated "⚡ USF" Nav button (and its `localStorage.userRole === 'owner'` gate) were removed (`9e65fcb`). `components/unified/UnifiedSessionForm.tsx` and `WorkOrderPopup`'s `inline` prop remain in the repo but are dead — nothing launches USF. The production flow is the standard `BookingForm` + portaled `WorkOrderPopup`.

### Supabase Policy Changes

As of May 30, 2026, any new table created in the public schema requires an explicit GRANT before it can be accessed via the Supabase Data API. After every `CREATE TABLE` statement, add:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON table_name TO anon, authenticated;
```

This applies to all new tables going forward. Existing tables are unaffected until October 30, 2026 when Supabase enforces this on all existing projects. RLS (Chunk 9) will supersede this when auth is implemented.

### CRM — Needs Action & timers
- **Needs Action daily reset runs at 8am PST (cron: `0 15 * * *` UTC).** Hot/Warm leads reappear in Needs Action every day until their keep-hot timer expires (5 days Hot, 3 days Warm) or they are manually moved to Cold/Dead. The reset sets `needs_contact = true` so staff can't dismiss the same lead indefinitely without taking action or changing status.
- **Lead detail card uses 2-column layouts for space efficiency.** Contact section: Email/Phone on the left, Created/Last Contact on the right (gap 48px). Session & Quote section: Location·Studio + Session Date on the left, Quote/Rate + Start–End times on the right (gap 48px). Location and Studio dropdowns cascade — selecting a venue populates the studio options for that venue only.
- **Time inputs use 12-hour format with smart parsing.** Accepts `8p` → `8:00 PM`, `830a` → `8:30 AM`, `1830` → `6:30 PM` (24h converted), bare `8` → `8:00 AM`. Saves on Enter or Tab (blur). Legacy 24h values stored in DB are converted for display transparently.

### Runner Hub & Daily Ops
- **UTC → local date for all runner date queries.** `new Date().toISOString().slice(0, 10)` returns the UTC date — after 5 PM PDT this is already tomorrow. Every runner page now uses timezone-offset correction: `const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 10)`. This is also shared as `getLocalToday()` module helper where used across multiple effects. Same fix applied to `getYesterday` in LocationStrip (replaced entirely with `getLocalDateStr(offsetDays = 0)`).
- **Runner WO footer: Cancel / Save / Finish three-button layout.** Cancel navigates back without saving. Save persists current state and returns to studio hub (`router.push(/runner/[studio])`). Finish shows an inline confirmation dialog ("Are you sure this WO is complete?") before setting `runner_finished = true`, `runner_finished_at`, `status = 'submitted'`. WO remains fully editable after finishing — Finish is a status signal, not a lock. The confirmation dialog uses `showFinishConfirm` state; on confirm `handleFinish` fires.
- **Approved WOs stay visible in the Today panel until 8am the next day.** Previously, approving a WO immediately removed it from the LocationStrip Today column. The 8am operational-day cutoff (handled by `getLocalDateStr()`) already ages items off naturally when `today` advances. The immediate `activeSessions` filter (`!(wo?.admin_approved || wo?.status === 'approved')`) was removed — Today now shows all sessions for the current operational day regardless of approval state. SessionCard shows visual done-state via the Admin checkbox.
- **Needs Attention photos stored in `checklist-photos` Supabase Storage bucket.** There is no separate `expenses` bucket — that bucket was never created. Both WO expense receipts and runner Needs Attention photos upload to the `checklist-photos` public bucket (`upsert: true`, `getPublicUrl()`). A migration SQL file at `supabase/storage-expenses-bucket.sql` is provided for creating a private `expenses` bucket if isolation is needed in the future.
- **Supabase Realtime: tables must be added to the publication + REPLICA IDENTITY FULL.** `postgres_changes` subscriptions connect (show `SUBSCRIBED` status) but events don't fire unless the table is both in the `supabase_realtime` publication AND has `REPLICA IDENTITY FULL` set. Without `FULL`, filtered subscriptions (e.g. `id=eq.xxx`) don't match because Postgres only includes PK columns in the WAL by default. Required SQL: `ALTER PUBLICATION supabase_realtime ADD TABLE bookings; ... REPLICA IDENTITY FULL`. Tables currently enabled: `bookings`, `work_orders`, `studio_time_rows`, `equipment_condition_rows`.
- **Real-time subscription pattern — project-wide standard (all four surfaces).** `postgres_changes` subscriptions on all data surfaces, not just runner pages. Cleanup via `return () => { supabase.removeChannel(channel) }` on every effect.
  - **Runner pages** (hub, studio, WO): `useCallback` for stable `load`; subscription deps on `resolvedWoId` or today's date. Runner studio: two channels — `bookings` (any change) + `work_orders` (UPDATE by session_date). Runner WO: `work_orders` by ID triggers full re-fetch of WO + booking + stRows; runner-owned state (`sessionNotes`, `needsAttentionNotes`, `needsAttentionPhotos`, `equipConds`) kept in separate vars and not overwritten.
  - **Admin WorkOrderPopup**: uses `resolvedWoId` state (set after `initWO` resolves) to gate subscription setup. Two channels: `studio_time_rows` filtered by `work_order_id` (any event → refetch + normalize all rows); `work_orders` by ID (UPDATE → patch `status` only). Channel names: `admin-wo-strows-{id}`, `admin-wo-status-{id}`.
  - **LocationStrip**: `fetchDrawerData(loc)` extracted from `openDrawer()` — all fetch/setState logic, no loading state. Subscription callbacks call `fetchDrawerData(selectedLocRef.current)` silently (no spinner). `selectedLocRef` tracks current open location. Two channels: `bookings` (any change) + `work_orders` (any change).
  - **Calendar page**: `loadRef.current = load` pattern — `loadRef` is set in a separate `useEffect([load])` so the mount-time subscription always calls the latest `load` version without re-subscribing. Channel: `calendar-bookings` on `bookings` table.
- **Runner studio page and Daily Ops cards show confirmed sessions only.** Both filter to `.eq('status', 'confirmed')`. A prior change used `.not('status', 'eq', 'cancelled')` to show all non-cancelled statuses — reverted in June 2026 because tentative and other statuses shouldn't surface in daily runner ops.
- **Multi-day bookings require `lte/gte` date range queries.** `.eq('start_date', today)` only matches Day 1 of a multi-day session. Any query surfacing sessions "active today" uses `.lte('start_date', today).gte('end_date', today)`. Applies to: `loadSummaries()`, `fetchDrawerData()`, and runner hub `load()`. Supabase Realtime filter strings cannot express compound AND conditions — RT callbacks trigger a full JS-side reload without a date filter.
- **Daily Ops Log is an admin sidebar tab.** The standalone `/daily-ops-log` route is kept for direct linking but the component (`components/admin/DailyOpsLogSection.tsx`) is also embedded as a tab in the Admin page sidebar alongside Engineers and SRS Log. The component re-fetches fresh on every tab switch (conditional render means it mounts/unmounts each time). Fetches `work_orders` with `admin_approved=true OR status=approved` and `daily_ops_submissions` with `admin_approved_at != null`.
- **WO card in admin daily ops drawer: artist name is the hero.** SessionCard hero line is `b.artist || b.client_name || '—'`. Label/client name appears smaller underneath only when both are present. This matches how calendar blocks display sessions.
- **Runner WO Session Info block reads from live booking record.** On init, the runner WO page first fetches the `work_orders` row (to get `booking_id`), then in parallel fetches the linked `bookings` row + studio time rows + equipment condition rows + expense rows. The `booking` state is the source of truth for client name, artist, engineer, date, time, studio — the `wo` snapshot fields are fallbacks. This means admin changes to the booking are always reflected when the runner opens the WO.
- **Label/A&R field on runner WO shows "Label / A&R: Interscope / Stephen Baynes".** For billing bookings, the Session Info field label is `"Label / A&R"` (not `"Client"`). The value combines `booking?.label || wo?.label` (label name) with `booking?.client_name || wo?.client` (A&R contact name) separated by ` / `. If only one is present, that alone is shown.
- **Engineer hours live in studio_time_rows, not work_orders.** `studio_time_rows` has three new columns: `eng_hours numeric`, `eng_rate text`, `eng_charge numeric`. The Studio Time table shows a compact engineer sub-row below each day's row whenever `booking.engineer_name` (or `wo.engineer`) is set. Admin can edit both eng_hours and eng_rate; runner can only edit eng_hours (rate is locked/display-only). `eng_charge = eng_hours × eng_rate` computed on change. Engineer Total appears in the WO totals block (above Rentals). Grand total = stTotal + engTotal + rentTotal.
- **`bookings.engineer_rate` is the source of truth for the session rate.** Set on booking save; the field starts blank (no default — the `$55` default that existed briefly was removed June 5, 2026). On booking save, the post-save rate sync block propagates `engineer_rate` to any existing `studio_time_rows.eng_rate` — but only if `eng_rate` is currently null/empty (so manually changed rates are never overwritten). Runner WO page reads eng_rate from `r.eng_rate || booking.engineer_rate || ''` for display.
- **Ops Log search bar filters DailyOpsLogSection by client, artist, studio, engineer, invoice number.** Case-insensitive, live as-you-type. `LogRow` now carries `artistName`, `engineerName`, `invoiceNum` (populated from joined booking rows). `hasFilters` includes `!!searchQuery.trim()`. Search input is the leftmost element in the filter bar.
- **Runner session cards: artist is the hero name.** `b.artist || b.client_name || '—'` for the primary headline. `b.client_name` appears as secondary sub-text only when both artist AND client_name are set. Matches admin SessionCard in LocationStrip drawer.
- **`normalizeStRow` defaults `eng_hours` when null on WO open.** `WorkOrderPopup`'s `normalizeStRow` function defaults `eng_hours` to `total_hours` (for hourly rows) or `calcHours(from_time, to_time)` (for day-rate rows where `total_hours` is null) when the DB value is null. `eng_charge` is also recomputed from the defaulted value × `eng_rate` if both are available and `eng_charge` was null. This means the eng sub-row always shows a meaningful hours value on first open without requiring manual admin input.
- **Live date range sync runs for both day-rate and hourly sessions.** The `useEffect` in `WorkOrderPopup` that reconciles `studio_time_rows` when `start_date`/`end_date` changes has no day-rate guard — both delete (rows for dates removed from range) and insert (rows for new dates) run regardless of rate type. Hourly inserts seed `total_hours` from `calcHours(from_time, to_time)` and `charge` from `calcCharge`; day-rate inserts keep `day_count = 1` with OT rate seeding.
- **Runner RT eng_hours: accept admin changes without overwriting runner input.** When the runner WO real-time subscription fires and a row's `eng_hours` becomes non-null (admin set it via the admin popup), the runner's `engHoursMap` entry is updated — but only if the runner's current value still equals the auto-computed default (`total_hours → calcHours`, ignoring the DB `eng_hours` field). If the runner has typed a custom value different from that default, it is preserved.
- **`studio_time_rows.status` cycles: `in_progress` → `submitted` → `approved`.** Column: `status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'approved'))`. Every new row insert seeds `status: 'in_progress'`. Runner Finish sets today's stRows to `submitted`. Admin Approve button (WorkOrderPopup footer) sets today's stRows to `approved`. Rows remain fully editable regardless of status. Status dots in the Date cell top-right: no dot = in_progress; orange `#fb923c` 6px circle = submitted; lime `#c8f04e` = approved. Dots render based on `r.status` for every row regardless of date — past-date rows with submitted/approved status show dots correctly.
- **`handleFinish()` and `handleApprove()` scope to today's rows only.** `handleFinish()` (runner WO) updates rows where `date === getLocalToday()`. `handleApprove()` (admin WorkOrderPopup) updates rows where `date === getLocalToday() && status !== 'approved'`. Future-date rows are never prematurely submitted or approved. The Approve button's `disabled` prop only gates on the `approving` in-flight state — it is always clickable (no count-based gate).
- **Dashboard badge (`pendingCount`) driven by `studio_time_rows.status`.** `loadSummaries()` in LocationStrip adds a fifth parallel query for today's stRows with `status = 'submitted'`, maps them to WO IDs, and counts matching WOs per studio. A third RT channel (`daily-ops-strows`, UPDATE on `studio_time_rows`) keeps the badge live when runner submits or admin approves. `studio_time_rows` must be in the `supabase_realtime` publication with `REPLICA IDENTITY FULL` for these events to fire.
- **Approved sessions drop from the Today drawer column.** `fetchDrawerData()` queries today's stRow statuses after loading WOs; bookings where all today's stRows are `approved` are excluded from `activeTodayBkgs` and disappear from the drawer without a page refresh.
- **Runner checklist pages: Save vs Submit distinction.** `handleSave()` persists checklist item state and notes to the `checklists` table (and mic_checkins + quantities for mics) WITHOUT writing `submitted_at` to `daily_ops_submissions`. `handleSubmit()` writes `submitted_at` to `daily_ops_submissions` and marks the shift complete for the admin view. Runners can tap Save to preserve progress between sessions without flagging the task as done. Mics page also restores prior checkin/quantity state from DB on load.
- **`daily_ops_submissions` table columns — canonical list.** The table has exactly these columns: `id, studio, date, category, staff_name, notes, submitted_at, admin_approved_at, admin_approved_by, created_at`. Columns `attention_notes`, `needs_attention`, and `photo_urls` do NOT exist on this table — those fields live on `checklists` rows. Any upsert to `daily_ops_submissions` must only include the correct columns; sending extra columns causes a silent 400 Bad Request from Supabase.
- **OPS_CATS `category` key values must match DB writes exactly.** LocationStrip's `OPS_CATS` array maps display labels to category keys used to look up `daily_ops_submissions` rows. Keys must match exactly what runner pages write as the `category` field. Correct values: `opening_checklist`, `closing_checklist`, `petty_cash`, `stock`, `mic_inventory`. The stock page writes `category: 'stock'` — not `'stock_list'`. Mismatch causes the Runner checkmark to never show for that row.

### UI patterns
- **Clients page = unified two-column view.** List on left, full editable profile in right panel. No separate `/clients/[id]` route. URL uses query param `/clients?id=<uuid>` for shareability.
- **"Start Booking" replaces "Book Client" everywhere.** Always visible green button on lead detail cards and client profiles. On leads without a client record it opens ConfirmClientModal (creates client, navigates to `/clients?id=...`); on leads or clients that already have a client record it navigates directly to `/calendar?newBooking=1&clientId=...` with form pre-filled. "View Client" button was removed as redundant.
- **`clients.artists[]` is the authoritative label roster.** It is the source of truth for artist autocomplete on the lead form (Label mode), booking form, and the "Artists" section on label client profiles. `client_contacts[*].artists[]` is the per-A&R subset ("which artists does this rep handle") — adding an artist via any surface writes to `clients.artists[]`; adding via an A&R card also writes to that contact's own array. The profile shows both: the flat roster under "Artists", and per-A&R lists under each A&R card in "Contacts (A&Rs)". `lib/roster.ts` owns `addArtistToLabel` / `removeArtistFromLabel`.
- **Autofill pickers (contacts, artists) are reusable components.** Built as standalone components in `components/clients/` or `components/shared/`, will be reused in the Calendar's New Session modal.
- **Public-facing forms use scrollable embedded legal text rather than external links or modals.** Keeps clients on the page, mobile-friendly, legally protective. T&Cs content lives in `lib/terms.ts` as a structured array (heading + body), easy to update without touching form logic.
- **All Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) must be configured for ALL THREE Vercel environments (Production, Preview, Development).** Preview deploys fail with "supabaseUrl is required" if missing from the Preview environment.
- **Lead detail card — Activity Log + Contact button (May 2026):** Activity Log section appears above Session Notes in the lead detail card. Fetches all `lead_activity` rows for the lead plus synthesizes synthetic events (Lead Created from `lead.created_at`; Reg Link Sent / Registration Returned from `registration_tokens.created_at/used_at`). Color-coded dots: Call=red, Text=orange, Email=sky-blue, Reg=accent/green, Created=gray. "Mark Touched" button renamed to "Contact" everywhere. When the Contact prompt opens, action link buttons (Call / Text / Email) appear at the top — tapping opens `tel:`, `sms:`, or `mailto:` and auto-selects the matching method in the form. No Answer / DNA button was removed entirely — it added noise without value.
- **Session Notes is purely freeform.** Activity (touches, keep-hot, etc.) is logged only to `lead_activity` — nothing is auto-appended to the notes field. Notes are seeded from the lead's original inquiry and are staff-editable only.
- **COD vs Label/Billing color convention:** COD = `#7BBFFF` (sky blue), Label/Billing = `#96A9FF` (periwinkle). Same brightness, distinct hues. Applied to lead names in CRM list and detail card header, client names in Clients list and profile header, billing pills everywhere, COD/Label-Billing toggle active state in New Lead form, and the Email button color. Lead name color is driven by `billing` field (`=== 'Billing'`), not `artist_name`.
- **iOS Safari requires explicit `height` (not just `max-height`) plus `-webkit-overflow-scrolling: touch` for scrollable containers.** `max-height` alone works on desktop but renders as a full-height block on iOS. Apply this pattern to any future scrollable embeds.
- **`StudioSelect` is the canonical studio picker across all forms.** Single flat dropdown showing "Venue · Studio" (e.g. "Paramount · Studio A"). Lives in `components/shared/StudioSelect.tsx`; room data in `lib/studios.ts` (`STUDIO_LOCATIONS`). Replaced two-cascade (venue then studio) dropdowns everywhere — CRM new lead form, lead detail card, booking form. `lib/studios.ts` also exports `parseLocation()` / `combineLocation()` for splitting/joining the "Venue · Studio" string stored in `leads.location`.
- **`lib/roster.ts` is the only write path for label artist arrays.** `addArtistToLabel` / `removeArtistFromLabel` / `getArtistsForLabel` are the sole entry points for modifying `clients.artists[]`. Never write `clients.artists` directly. Artist adds from A&R card saves also write to that contact's own `artists[]` subset.
- **A&R and Admin are saved as FK IDs on each booking, with contact popovers in the booking card.** `bookings.anr_contact_id` + `bookings.anr_admin_contact_id` are written on every booking save. In label booking cards, the A&R and Admin names are clickable popover triggers — an underline indicator shows when the contact has info stored. The popover shows email/phone with Call/Text/Email action links. Inline view (no Edit button) always shows email/phone with action links directly in the card.
- **Label booking card field order: Artist → A&R → Admin.** This matches the booking chain: who's recording, who ordered it, who manages logistics.
- **Registration button only shows for COD leads.** Labels never receive registration links — they have a staffed booking relationship. Guard is `lead.billing !== 'Billing'` wrapping the entire reg button slot.
- **Registration status uses a three-step lookup on lead open.** (1) Query `registration_tokens` by `lead_id` — covers the primary flow where a token was sent from this lead. (2) If not found and `lead.client_id` is set, query tokens by `client_id` — covers returning clients and tokens created after the fix where `client_id` is stored on the token. (3) Fall back to `clients.registered_at` — covers the "Use & Link this Profile" path where `used_at` is set but `clients.registered_at` may not be updated. `generateRegLink()` now also writes `client_id` on the token so step 2 finds it on future loads.
- **`NEXT_PUBLIC_BASE_URL` must be set in Vercel for production registration links.** Falls back to `window.location.origin` if unset (produces `localhost` URLs in local dev — fine for testing, wrong for links sent to clients). Set to `https://prs-flow.vercel.app` in Vercel Production + Preview environments. Also add to `.env.local` for local dev to produce production-correct links.
- **Call/Text/Email action buttons use `<a>` tags with `tel:`, `sms:`, `mailto:` hrefs.** Style defined as `aBtnStyle(color)` — DM Mono 9px, transparent background, `var(--border)` border, no decoration. Colors: Email = `#7BBFFF`, Call = `var(--booked)`, Text = `var(--warm)`. Buttons only render when the field has a value. Applied to: lead detail card contact section, client profile COD contact section, A&R card headers, Admin card headers. `e.stopPropagation()` on card-header links prevents accidental expand/collapse.
- **SOP/Training tab serves a static HTML file.** `/sop.html` lives in `public/` and is served directly by Next.js static file hosting. The `/sop` route renders a full-viewport `<iframe src="/sop.html">`. No nav-gating — visible to all roles. To update the guide, replace `public/sop.html`; no code change needed.
- **RegViewModal is a shared component.** Lives at `components/shared/RegViewModal.tsx`. Used by both the CRM lead card (✓ Registered button) and the Clients page profile (REGISTERED header badge + Verification section). Fetches the full client record and generates a 1-hour signed URL for the ID photo on open.
- **Registration print route at `/register/view/[clientId]`.** Server component (uses anon key). Fetches client data + generates signed ID photo URL server-side. `PrintTrigger` client component fires `window.print()` after 800ms so images load before the dialog opens. Layout: Paramount header, client name in Syne display type, all fields, ID photo, confidential footer.
- **WO→Booking sync writes to both tables; does NOT remount the booking form.** Close & Save writes synced fields to both `work_orders` and `bookings`. The booking form is NOT remounted/reopened from the DB after WO save, which preserves any unsaved booking form edits (changed rate, etc.) that the user made while the WO was open. WO status updates flow back via the `onStatusChange` prop. *(The earlier approach — `onSaved` refetched the booking by ID and reopened the form with fresh data — was wiping unsaved form state. Changed in `7d676c7`, June 4, 2026.)*
  - **Update (June 22, 2026):** `onSaved` is no longer `{undefined}`. The calendar page now passes `onSaved={() => { loadRef.current(); setReloadKey(k => k + 1) }}` — this refetches the `bookings` array (so the 2-week/week grid blocks repaint) and bumps `reloadKey` (so DayView/StudioView re-fetch). It refreshes the *underlying calendar data*, not the open form — the form is still never remounted. See the June 16–22 session note for the WO→Calendar sync work and the two bugs fixed along the way (bare-letter studio mismatch; WO-owns-schedule gating).
- **The Work Order owns the booking's schedule once it has real data (June 22, 2026).** A WO "owns" `start_date` / `end_date` / `from_time` / `to_time` as soon as it has **at least one `studio_time_row` with a non-null, non-empty `date`**. While that's true: (1) WO Close & Save (`WorkOrderPopup.handleClose`) syncs `start_date`/`end_date` (earliest/latest dated stRow) and `from_time`/`to_time` (earliest dated stRow) back to `bookings`; and (2) the booking form's `handleSave` (`calendar/page.tsx`) strips those four fields from its `bookings` update **and** skips the day-rate stRow date-range reconciliation — so the form can no longer clobber WO-edited times/dates. Bookings with no WO, or a WO that has no dated rows yet, still own and *bootstrap* their schedule normally (the form seeds the WO's rows). This makes the WO the single authoritative writer of the schedule once it holds real data, and resolves the round-trip corruption where reopening the booking form overwrote WO times.
- **`bookings.studio` is authoritative from the booking form and is NEVER synced from `studio_time_rows`.** `studio_time_rows.studio` stores the **bare letter** (`'A'`, `'B'`, …) via `toStudioLetter()`, while the calendar grid filters rooms on the **full label** (`'Studio A'`). An earlier WO→booking sync wrote `stRows[0].studio` (a bare letter) into `bookings.studio`, after which the booking matched no room and its calendar block vanished. The sync no longer touches `studio` (commit `3361fdb`, June 22, 2026). The `StudioSelect`-backed booking form is the only writer of `bookings.studio`. *(Track's `'North'`/`'South'` were unaffected because `toStudioLetter` returns them unchanged.)*
- **`UnifiedSessionForm` (USF) is a parallel, owner-gated experimental build — it does NOT replace the existing booking flow.** `components/unified/UnifiedSessionForm.tsx` is a single full-screen modal combining the booking/client card and the Work Order in one natural-flow document (header → status chips → client card → work order). It renders the real `WorkOrderPopup` **inline** (in normal flow, no fixed overlay / no backdrop-dismiss) via a new `inline?: boolean` prop on `WorkOrderPopup`. It's launched only from a temp "⚡ USF" button in the Nav, shown when `localStorage.getItem('userRole') === 'owner'` (no auth yet — Chunk 9). The legacy `BookingForm` + portaled `WorkOrderPopup` flow remains the production path; both coexist. First scaffold was reverted, then rebuilt as v2 against the real WorkOrderPopup.
- **Booking form client search matches artist names *through A&R contacts* and auto-selects the A&R.** The client search in `BookingForm` (and USF) returns three match kinds: client/label name, A&R contact name, and **artist name**. *(Updated June 22, 2026 — commit `d7c8e82`.)* Artist matches now come from `client_contacts` directly: the third parallel query fetches `client_contacts` rows (with each contact's own `artists[]`, `contact_type`, and the joined parent `clients(id,name,type,srs_client)`), pre-filtered server-side to non-empty arrays via `.neq('artists','{}')`, then matched client-side against the query. Admins are excluded with `if (ct.contact_type === 'admin') continue` (the equality check is true only for the literal `'admin'`, so **null-type contacts are included**); the result `record` is the parent client plus `_artistMatch`. Picking an artist match auto-resolves the A&R: it re-queries `client_contacts` for that label with `.or('contact_type.eq.anr,contact_type.is.null')`, finds the contact whose `artists[]` contains the artist (case-insensitive), and populates `ordered_by` / `anr_contact_id` / email / phone. *(Earlier this entry described searching the label record's `clients.artists[]` and a `contact_type !== 'admin'` re-query filter — both superseded: the prior approach matched the label but couldn't identify which A&R holds the artist, and PostgREST's `.neq('contact_type','admin')` silently drops null-type rows, which is most A&Rs.)*
- **The `client_contacts` artist-persistence bug was the refetch SELECT, not the update payload.** *(Resolved June 22, 2026 — commit `af957e8`.)* `ClientProfile.saveContact` does strip the PK/FK from the update body (`const { id: _id, client_id: _cid, ...updateData } = data` before `.update(updateData)`, commit `4d36b27`) and that is correct practice — but it was **not** what made A&R artists fail to persist. The real cause: the Clients page `load()` (passed as `onRefresh`) fetched `client_contacts` with a column list that **omitted `artists` and `contact_type`** (`app/(main)/clients/page.tsx`). After a save, `onRefresh()` re-fetched contacts without those columns, so `ContactRow`'s `useEffect([contact])` reset `localArtists` to `[]` — the UI reverted (looked unsaved) and, worse, the *next* save of that contact wrote `artists: []` back, wiping the row. The DB write path itself was always healthy (verified: a direct `PATCH {"artists":[…]}` returns 204 and persists). **Fix:** added `artists, contact_type` to that select. The same omission had also broken the A&R/Admin split (every contact read as A&R, Admins section empty) since `contacts.filter(c => c.contact_type !== 'admin')` had no `contact_type` to test.
- **`initWO` uses `.order('created_at', { ascending: false }).limit(1)` instead of `.maybeSingle()`.** `.maybeSingle()` silently returns `null` when multiple rows match — it was causing `initWO` to always hit the "create new WO" branch, accumulating hundreds of duplicate work_orders per booking. The `.limit(1)` approach tolerates duplicates and always picks the most recent row. 299 duplicate WO rows were cleaned up via REST API batch delete (June 2, 2026).
- **`liveForm` is memoized in `BookingForm` with `useMemo`.** Passing an inline object literal `liveForm={{ ... }}` to `WorkOrderPopup` caused a new reference on every parent render, which remounted `WorkOrderPopup` (and re-ran `initWO`) constantly. `useMemo` with all form field dependencies prevents spurious remounts.
- **Engineer edit-in-place uses a ref (`engEditingRef`) alongside state (`engEditing`).** React `useState` has stale closure issues in blur `setTimeout` callbacks — the `onBlur` handler captures `engEditing` from the render it was created in, not the latest value. `engEditingRef.current` is always current in the closure. The Escape handler sets `engApplied.current = true` (not `engEditingRef = false`) so the subsequent blur from unmount skips calling `applyEng` — the blur handler is the single place that clears `engEditingRef`.
- **WO print: `document.title` sets the default Save as PDF filename.** Before `window.print()`, `document.title` is set to `CLIENT_INV#` (COD) or `LABEL_ARTIST_INV#` (Billing), then restored after. This controls the filename the browser pre-fills in the Save as PDF dialog. All three print buttons use `printWithFilename()` helper. If no invoice number exists, `_INV#` literal is appended as a placeholder.
- **Per-row rate type replaces booking-level rate type in the Studio Time table.** `studio_time_rows` gained two columns: `row_rate_type text DEFAULT 'hour'` and `rate_daily text`. Each row independently toggles between `'hour'` and `'day'` billing. `toggleRowRateType(id)` converts: hour→day sets `rate_daily = rate × 10`; day→hour sets `rate = rate_daily ÷ 10`. This decouples individual rows from the booking-level `rate_type` and eliminated the booking-level rate-sync `useEffect` in WorkOrderPopup and the post-save rate sync block in `calendar/page.tsx`. `normalizeStRow` branches on `row_rate_type`: day rows use `rate_daily` flat; hourly rows derive charge from `totalHours × rate`.
- **Unified 9-column Studio Time table replaces two separate layouts.** Column order: Date | Session Info | From | To | Hrs | Type | Rate | OT Rate | Total. The Type cell shows Day/Hr inline toggle buttons in admin (editable) or a display label in runner (read-only). This replaced the separate day-rate compact layout and hourly layout that existed previously in both admin WorkOrderPopup and runner WO page.
- **`TimeInput` is a smart-parse text `<input>` with auto-format on blur.** Accepts: `10a`→`10:00 AM`, `930p`→`9:30 PM`, `1430`→`2:30 PM` (24h auto-converted), bare `8`→`8:00 AM`. Enter key triggers blur/commit. Click/focus selects all text so typing immediately replaces the existing value. Blank is valid (shows placeholder `—`). Drop-in for the same `value`/`onChange`/`disabled` props as any input. *(History: the original smart-parse text input was replaced by a 30-min `<select>` in the per-row rate type session on June 5, 2026, then reverted back to text input on June 10, 2026 — the select was harder to use on mobile.)*
- **iOS Safari scroll lock pattern.** `document.body.style.overflow = 'hidden'` does NOT lock scroll on iOS Safari — the page still scrolls behind overlays. Correct pattern: on open, read `scrollY`, then set `document.body.style.top = -\`${scrollY}px\`; position = 'fixed'; width = '100%'`. On close, clear all three properties, then call `window.scrollTo({ top: savedScrollY, behavior: 'instant' })`. Applied to the runner WO notes bottom sheet.
- **Runner WO notes bottom sheet (floating card, not full overlay).** The notes edit view is a `position: fixed` floating card: `bottom: 16, left: 12, right: 12; borderRadius: 12; boxShadow: '0 -4px 24px rgba(0,0,0,0.4)'`. No background dim. Uses explicit `paddingLeft/paddingRight` longhand on all child elements (shorthand padding can be overridden by global resets on iOS). Root containers on all runner pages have `maxWidth: '100vw', overflowX: 'hidden'` to prevent horizontal overflow on devices with scrollbars.
- **Runner WO viewport fixes.** Next.js `Viewport` export in `app/layout.tsx` sets `maximumScale: 1, userScalable: false` — prevents iOS Safari pinch-zoom from breaking the layout. Runner page root containers use `left: 0, right: 0` instead of `width: 100vw` to avoid triggering horizontal overflow on devices where `100vw` includes the scrollbar width.
- **PDF session notes revealed via `data-si-print` span.** Inside the Studio Time table Session Info cell, a `<span data-si-print>` wraps the full session notes text. `@media print` CSS in `globals.css` reveals this span (it is hidden in screen view). This puts session notes inside the cell in the printed/PDF WO without adding a visible element to the on-screen table.
- **Admin session info popover in Studio Time table.** Clicking the Session Info cell in the admin WO Studio Time table opens a 280px `position: fixed` popover with an editable textarea for session notes and Save/Close buttons. Allows admin to edit per-row session notes without opening a separate modal.
- **WO status is `open` or `completed` only.** The work_orders-level `status` column has two values: `open` (default) and `completed`. The previous multi-value model (`draft`, `submitted`, `approved` at the WO level) was removed in June 2026. Row-level approval lives on `studio_time_rows.status` (in_progress/submitted/approved). "Complete WO" toggles `open` ↔ `completed` without locking the popup for editing. Runner submit flow (`runner_finished`) was removed at the same time — the stRow status cycle is the granular approval mechanism.
- **Studio Time table is local-first: all edits commit on Save.** Every Studio Time edit (time fields, rate, type, date, add row, delete row, clear eng) is held in React state and written to DB in a single batch when the user clicks Save/Close. Previously, changes wrote to DB on every cell blur, causing 409 conflicts on rapid edits and race conditions with RT subscriptions. Real-time subscription was removed from WorkOrderPopup as a result. Cancel fully reverts: deletes new rows from DB, restores deleted rows, resets all edits.
- **`studio_time_rows.admin_locked` controls per-row edit permissions.** `admin_locked boolean DEFAULT false`. Admin can lock any row. Locked rows are visually distinguished with a lock pill; runner sees locked rows as read-only.
- **`studio_time_rows.eng_visible` drives eng sub-row visibility.** `eng_visible boolean DEFAULT false`. Set to `true` when admin opens a row's eng sub-row; set to `false` when admin clears eng hours/rate. Replaces the previous `autoEngRows`/`clearedEngRows` React state approach which caused visibility to reset on WO reopen.
- **`work_orders.print_name` and `work_orders.signature_data` replace legacy legal columns.** Previous columns `legal_signature`, `legal_name`, `legal_date` are no longer written to from the UI (columns remain in DB for historical data). Both admin WO popup and runner WO page write to `print_name` (text) and `signature_data` (base64 PNG from canvas). The legal section is **COD-only** — hidden for Billing sessions. Date is auto-filled to today (read-only, not saved to DB). Canvas signature pad uses `touchAction: none` for iOS drawing without scroll interference; existing sigs load back into the canvas on WO open.
- **`payment_rows` extended with `memo text` and `last_four text`.** Payment type is now a dropdown (Cash, Zelle, Credit Card, Debit Card, Check, Other) instead of free text. `last_four` only shows when type is Credit Card or Debit Card. Payment amounts display as `$1,234.56` formatted; `$`/`,` stripped before writing to DB as numeric. Both admin WO and runner WO share this behavior; runner WO payment section is now editable (was previously read-only display).
- **Session QC removed from nav.** The `/qc` nav item was removed — Session QC was never fully built; the nav link was just dead weight.
- **Shared UI primitives live in `components/ui/`.** *(UI-polish pass, June 24, 2026.)* `StatusBadge` (dot + tinted pill) and `SectionHeader` (uppercase DM Mono title + optional count pill + optional action link) are the canonical way to render record statuses and section headings — replace ad-hoc inline status text / Syne heading divs with them rather than re-styling per surface. `StatusBadge`'s color map and `SectionHeader`'s props are documented in CLAUDE.md → Key shared libraries. Note: CRM already had a *local* `SectionHeader({label, mt})` for in-card field-group labels — that was renamed `FieldGroupLabel` (different concept: field labels, not section headings), so don't confuse the two.
- **Status/booking color convention is teal-forward.** Confirmed/booked = teal `#14B8A6`; attention/tentative/open-WO = orange `#F97316`; the old confirmed-green `#22c55e` was retired across the calendar `STATUS_TOP_COLORS` maps (calendar page, BookingForm, UnifiedSessionForm). Engineer/assistant status green (`#4ef0a2`) and the WO-print equipment-OK green (`#16a34a`) are a *different* concept and were left alone.
- **"Open WO" glow on the dashboard room grid + calendar chips maps to the existing `tentative` signal, not real WO status.** *(June 24, 2026.)* Neither the dashboard room grid nor the calendar chips fetch work-order data (both query `bookings` only), so the orange "attention / open-WO" treatment is driven off `status === 'tentative'` — the closest available signal and what already colored those surfaces orange. If true WO-open coloring is ever wanted, it requires joining WO status into those queries (a data change).
- **Occupied/booked cards glow with an `inset` box-shadow, never an outer halo.** *(June 26, 2026 — supersedes the `0 0 8px` outer glow added in the June 24 UI-polish pass.)* The canonical "occupied" glow is `inset 0 0 18px rgba(20, 184, 166, 0.06)` (teal) / `rgba(249, 115, 22, 0.06)` (orange) — the same value the dashboard room grid already used — applied directly on a card/chip whose background is `#0d0f14` with text-only children, so the glow diffuses inward from the edges. The earlier calendar chips used an **outer** `0 0 8px` shadow that haloed outward into the surrounding surface and read as a ring around the block; all booking chips (`BookingBlock` in the week/2-week grid, `StudioView` cells, and `DayView` chips) were switched to the inset value so the calendar matches the dashboard. **Gotcha:** an inset shadow on an outer container is invisible if opaque children cover it — the calendar Day-view *studio card* (which contains a `var(--surface2)` header + opaque chips) needed the glow painted on a transparent absolute overlay layered **on top** of the content (`position:absolute; inset:0; pointerEvents:none; zIndex above the chips`), not on the card itself. The Day-view studio card keeps a subtle `rgba(20,184,166,0.2)` border + a 2px teal top bar as its container-level occupied signal; the actual glow lives on the chips.
- **The Day-view studio-card name is muted white `#9ca3af`, not the lime accent.** *(June 26, 2026.)* The `{venue} {room}` header on each Day-view studio card was the lime `#c8f04e` accent; changed to `#9ca3af` to match the app's muted section-label convention. The lime accent stays on genuinely active UI (StudioView header, day-cell selection) — it's not used for passive labels.
- **The lead-form (NewLeadModal) Label-mode client search is a single universal field, mirroring the booking form.** *(June 26, 2026.)* Label mode used to have a label-only search (LABEL field), a gated A&R field ("Select a label first"), and a plain-text ARTIST field. It now leads with one "Search client name…" field that searches **label name, A&R/rep name, and artist name simultaneously** — the same three-parallel-query pattern as `BookingForm` (`clients` by name for labels; `client_contacts` by `fname`/`lname` for A&Rs; `client_contacts` with non-empty `artists[]` matched client-side for artists; admins excluded via `contact_type === 'admin'`). Each result row shows **Artist (bold) · Label · A&R**; picking one autofills LABEL (+ links `labelClientId` so Move-to-Booking still works), A&R/REP (+ `anr_contact_id`/email/phone), and ARTIST. The three fields below are now plain **editable** inputs (LABEL is no longer a search; A&R lost its disable gate so free text always works), so an un-matched lead can still be typed by hand. The old label-search code (`selectLabelClient`, `handleLabelKeyDown`, `labelClientSuggestions`/`showLabelClientDD`/`labelHighlight` state) was removed; a `UniSuggestion` type was added.

### Mic inventory data model
- **The live mic inventory uses four tables, not the legacy `mic_inventory` table.** *(Built June 8, 2026 with the runner mics page; never formally added to the data model until June 23.)* `mics` is the catalog/source of truth (`id`, `name`, `home_studio`, `category`, `sort_order`, `is_active`) for ~271 mics & gear. `mic_checkins` holds per-mic Here/Room/Missing status per night (`mic_id`, `studio`, `date`, `status`, `room`; UNIQUE(mic_id, studio, date)). `mic_inventory_quantities` holds per-mic counts per night for odds & ends (UNIQUE(mic_id, studio, date)). `mic_inventory_submissions` is one row per studio+date (`submitted_at`, `submitted_by`; UNIQUE(studio, date)) — **the per-mic submitter/date is resolved by matching a checkin's `(studio, date)` to a submission row; there is no submitter column on `mic_checkins`.** The older `mic_inventory` table (global list, condition good/fair/damaged) is **legacy** — still read by `DailyOpsModal` only; do not build new features against it. `mic_checkins.studio` and `mics.home_studio` both use the lowercase runner keys (`paramount`/`ameraycan`/`encore`/`track`, plus `floating` for home_studio).
- **Admin Mic Inventory tab resolves status by home studio, banner by any studio.** *(June 23, 2026.)* `components/admin/MicInventorySection.tsx` reduces newest-first checkin/quantity rows to "latest per (studio, mic)" client-side (no SQL join — browser-query app). In the four studio tabs, a mic's current status comes from its latest checkin **at its home studio**; the Floating Gear catch-all group (and the missing banner) resolve from each mic's latest checkin **across any studio**, so a mic flagged missing or found stray anywhere still surfaces. Sort within a tab is missing→room→here→none then `sort_order`.
- **Admin can amend mic status; `mic_checkins.source`/`amended_by` track it.** *(June 24, 2026.)* `mic_checkins` gained `source text NOT NULL DEFAULT 'runner'` + `amended_by text` (migration run manually in the Supabase SQL editor; `ADD COLUMN` inherits existing anon/authenticated grants). Admin inline edits in `MicInventorySection` upsert the row — because of UNIQUE(`mic_id,studio,date`) an admin edit **overwrites that day's runner submission for that mic, by design** — with `source:'admin'` and `amended_by` = the typed initials (falls back to the `supabase.auth.getUser()` email / `'Admin'` until Chunk 9 auth). The data-model rule "source of truth per mic per studio = the most recent `mic_checkins` row regardless of `source`" still holds; admin-sourced rows render a teal ADMIN badge (main row, history, banner). Editing happens **in the row's own cells** (no sub-row panel): the editing and non-editing rows must use the SAME grid template — a separate wider template for editing shrank the `1fr` name column and shoved every input left of its header (fixed `fdecc26` by widening the shared action column to 124px instead). Room is a **per-studio dropdown** (`STUDIO_ROOMS`, the same room lists as the runner mics page), not free text.
- **Manage Mics edits the `mics` catalog, but Qty always writes to `mic_inventory_quantities`.** *(June 24, 2026.)* The Manage Mics modal (button in the `MicInventorySection` header) edits `mics` for name/studio/category and toggles `is_active` (Deactivate/Reactivate), and Add Mic inserts a `mics` row (`is_active=true`, `sort_order=max+1`). **`mics` has no quantity column** — quantity is per-night per-studio in `mic_inventory_quantities` — so every qty field (inline list edit AND Add Mic) upserts `mic_inventory_quantities` for today under the mic's home studio, never `mics`. The section now fetches ALL mics (not just `is_active`) and derives `activeMics` for the display so the modal can show + reactivate inactive ones; all writes trigger an internal `loadData()` reload.

---

## 2. Future Considerations
*Things to think about when we get to a specific chunk. Don't build now, but don't forget.*

### Chunk 6 — Calendar (in progress)
- **Calendar is live at `/calendar`.** Week/2-week view with all 11 studio rooms visible by default. Lane assignment for overlapping same-day bookings. Block always reserves click zone at the bottom to add new bookings.
- **Booking form** supports: client search, session type, status, payment type (COD/Billing), engineer + assistant (search or free-text), rate hourly/daily toggle, notes.
- **COD sessions get hero treatment** at top of booking panel: large DM Serif Display name in `#7BBFFF`. Label sessions in `#96A9FF`.
- **Filming and Event/Playback blocks** have a full border all the way around; Recording has top bar only.
- **Rate is either/or.** `rate` for hourly, `rate_daily` for daily. DB column `rate_daily text` added manually.
- **Start Booking cross-page flow** uses `?newBooking=1&clientId=xxx`. Calendar detects on mount, clears URL, fetches client, auto-opens pre-filled form.
- **Vertical zoom:** Keyboard +/-/0 and Cmd+trackpad scroll. `ZOOM_FIXED = [60, 80, 88, 110, 132]`, level 0 = fit-all (floor; no level below fit). Fit-all computed via `useLayoutEffect` on grid container (synchronous, before scroll effect fires).
- **Individual room collapse** persisted to `localStorage` key `cal_collapsed_rooms`. Location-level collapse persisted to `cal_collapsed_locs`. Both initialized as empty Sets on server render, restored from localStorage in `useEffect([])` to avoid hydration mismatch.
- **Endless horizontal scroll:** Grid renders `BUFFER_WEEKS=2` (14 days) of buffer on each side for ALL views (week, 2wks, month). Column width is dynamic per view: `usableW/7` (week), `usableW/14` (2wks), `usableW/totalDays` (month). When scroll approaches edge, `startDate` shifts ±7 days and `scrollCorrectionRef` corrects scroll position seamlessly. Studio labels are `position: sticky, left: 0`. No post-scroll snapping.
- **View switching always snaps to Sunday of the current real-world week.** `getSunday(new Date())` is always the anchor regardless of what was scrolled. Switching between views sets `shiftingRef.current = true` before the rAF to block transitional scroll events (DOM reflow from column-width change) from falsely triggering infinite scroll — resets to `false` after `scrollLeft` is applied.
- **Initial grid measurement via `useLayoutEffect`** (synchronous, fires before `useEffect`) so `gridW` is correct when the `[startDate, view]` scroll effect runs on mount. Prevents scroll position being computed from the default 1200px fallback width.
- **Visual week/month breaks:** Monday columns get `boxShadow: 'inset 2px 0 0 rgba(255,255,255,0.35)'`. Month-start columns get `boxShadow: 'inset 2px 0 0 var(--accent)'` plus a small month label (e.g. "MAY") in the top-left of that header cell. Same dividers appear in room cell backgrounds via inset box-shadow.
- **Nav always accessible over modals:** Nav `zIndex` raised to `9999`. All modal backdrops changed from `inset: 0` to `top: 52, left: 0, right: 0, bottom: 0` so they sit below the nav.
- **Draft/state persistence across tab navigation:** Booking form draft saved to `sessionStorage` key `cal_form_draft`, restored on mount. CRM: selected lead, view, tab, filter, search all persisted to sessionStorage. Clients: new-client modal draft persisted to `clients_new_draft`.
- **Bookings can exist before registration completes.** Future: "PENDING REGISTRATION" visual treatment on holds without client profiles.
- **Bookings link to either lead OR client.** Future: schema should allow both nullable but enforce one present.
- **Reuse contact and artist pickers from 4.5.** Don't rebuild them inside the calendar modal.

### Chunk 4.7 — Polish
- **"Registration returned" notification area on Clients page.** Small panel/box showing recent registrations that need QC. Query `registration_tokens` where `used_at` is recent and the resulting client hasn't been reviewed yet.
- **File upload edge cases.** ID files can be large; consider a 10MB cap. Accepted formats: PDF, JPEG, PNG, HEIC (iPhone photos). Show preview before upload completes.

### Phone & duplicate cleanup
- **Phone normalization migration:** One-time script to normalize existing phone data in `clients` and `client_contacts` tables to a consistent format (e.g., `(310) 555-1234`). Currently a mix of formats from manual entry and Jotform import.
- **Manual duplicate merge flow (4.9b):** UI to merge two existing client profiles when duplicates are discovered post-import. Needs a merge strategy (which record wins per field), re-points any linked leads/tokens to the surviving record, and deletes the duplicate. Slot as a small standalone sub-chunk.

### Chunk 5 — Webhooks (deprioritized)
- Originally planned right after Chunk 4. Now lower priority — Calendar (Chunk 6) is the higher-value next step.
- When we do build this, Squarespace inquiries auto-create leads, Jotform is retired in favor of our in-app registration form (Chunk 4.6).

### Chunk 9 — Auth
- **Office role gets everything. Runner role doesn't access Clients page at all.** Runners only see scoped info — today's sessions, basic client name. No billing, no full profiles.
- Single migration enables RLS across all tables at once: leads, clients, client_contacts, registration_tokens, lead_activity, bookings (once built).
- Storage buckets currently have blanket anon INSERT policy with size/MIME limits (25MB max, image + PDF only). When RLS is enabled in Chunk 9, replace with proper auth-based policy.
- Once auth is enabled, route group separation can be revisited — internal pages will be login-gated regardless of layout structure. Still good UX to keep public pages chrome-free (no nav on registration, future public-facing pages, etc.).

### Chunk 4.8 — Needs Action rebuild (priority: HIGH)
- **Staff is hitting the Needs Action display bug repeatedly during testing. Slot as sub-chunk 4.8 immediately after 4.7 ships, before Chunk 6.** Priority bumped based on testing feedback.
- Current Needs Action only shows leads whose `keep_hot_until` timer has expired — which means a freshly-touched lead disappears and won't reappear for 5–8 days. Staff loses visibility on actively-engaged leads.
- Needs design pass on what "needs action" should actually mean vs. "is overdue."

### CRM — Auto-match leads to clients at creation
- **When a new lead is created (manually or via Squarespace webhook), check against existing clients by email/phone/name. If matched, link lead → client immediately**, pre-fill the CRM card with client data (editable), and hide all "create client account" UI. "Start Booking" becomes the single CTA regardless of new vs. returning. Eliminates the Book Client modal (new/returning/label flow).
- Needs design pass: match criteria, fuzzy matching threshold, ambiguous-match UX (what if two clients match?).
- **Slot as standalone sub-chunk between Chunk 4 and Chunk 6.**
- Once auto-matching is in place, reconsider whether "Confirm Client Account & Start Booking" is still the right CTA. Likely collapses to just "Start Booking" for matched leads and "Create Client Profile → Start Booking" for unmatched.

### Book Client UX
- **"Book Client" button currently only appears on `status = 'booked'` leads.** During 4.5 testing, the preference emerged to be able to convert directly from Hot/Warm leads without manually promoting status first. Options discussed: a separate "Book it!" button that promotes status AND opens the modal in one action, OR show Book Client everywhere and auto-promote. Both are small changes. Deferred — revisit as a small standalone sub-chunk between 4.7 and Chunk 6.

### Vercel Settings
- **Vercel preview protection should be DISABLED for the prs-flow project.** Public-facing flows (registration, future client-facing pages) need to be testable on preview URLs without authentication. Real security comes from token gating + Supabase RLS (Chunk 9), not preview URL obscurity. Toggle in Vercel Settings → Deployment Protection.

---

## 3. Glossary / Domain Rules
*Business-specific knowledge that isn't obvious from the code.*

- **PRS** = Paramount Recording Studios.
- **A&R** = Artist & Repertoire — the person at a label who books studio time on behalf of an artist. Often different from the artist actually recording.
- **"Ordered by"** = our internal term for the A&R or rep who placed the booking. Used in the UI for clarity vs the artist field.
- **COD** = Cash on Delivery — individual clients who pay per session, vs label clients who get invoiced. Internally stored as `type='individual'`.
- **Booking types:** Recording Session, Filming, Event/Playback. (Stored in `leads.booking` for migrated data; will move to a proper `bookings.type` column in Chunk 6.)
- **Studio rooms:** *(TBD — add when defined for Chunk 6 Calendar.)*
- **Status values for leads:** uncontacted, hot, warm, cold, dead, booked, incomplete, unconnected. ("unconnected" appears in the data — confirm meaning when relevant.)
- **Hot/Warm/Cold timers:** Hot expires after 5 days, Warm after 8, Cold review at 11. Auto-demotion via Vercel cron.
- **Park feature:** Leads can be parked-until a future date, removing them from Needs Action.

---

*Last updated: June 25, 2026 — Auth + user profiles + dashboard task rebuild. Shipped: Supabase Auth login / forgot-password / reset (`app/(auth)/*`) + a client-side `AuthGuard` on the `(main)` layout (no SSR middleware — localStorage sessions; UX gating only, RLS still off) + nav Sign Out button + nav clock upgrade; `user_profiles` table (surrogate PK + `auth_user_id` link + `email` lookup key; `supabase/user_profiles.sql`, run manually) and `dashboard_tasks.assigned_to`/`assigned_by`; `useUserProfile` hook + personalized greeting; dashboard task panel rebuilt to 6 per-user tabs (resolved by display_name, driven by `assigned_to`) with role-based visibility, a scrollable tab bar, a full add-task modal (flat Assign-to dropdown), and a redesigned task detail modal. **Open:** add-task photo "not saving" still being debugged (resume June 26) — save path verified healthy via probes; thumbnail preview + insert-error logging added. See the Decisions Log "Auth, user profiles & task assignment" subsection. — Prior, June 24, 2026 — UI polish pass (`ui-polish` branch, merged to `main`): new shared primitives `components/ui/StatusBadge.tsx` + `components/ui/SectionHeader.tsx` replacing ad-hoc status text and section headings app-wide; nav tabs restyled to a bottom-border underline treatment + the calendar tab count badge removed (`tentativeCount` state/fetch retained); dashboard room-grid cards get teal/orange state glow + 2px top bar; calendar booking chips recolored confirmed green `#22c55e`→teal `#14B8A6` and given a subtle glow (orange "open-WO" maps to the existing `tentative` signal — no WO data on those surfaces). The CRM lead-row card redesign was attempted (`f934716`) then reverted (`3df8016`) — not shipped. Earlier June 24 — Admin Mic Inventory admin editing: per-row inline-cell status editing (Status dropdown, per-studio Room dropdown, Qty, "Initials" field) + Manage Mics modal (master list edit/deactivate/reactivate + Add Mic); `mic_checkins` gained `source`/`amended_by`; qty always writes to `mic_inventory_quantities`. Also fixed the Engineers table actions column overlapping the Status pill (80px→180px). June 23 — Admin Mic Inventory tab (`components/admin/MicInventorySection.tsx`): read-only consolidated cross-studio view with missing-mic banner, horizontal studio tabs, status colors, per-tab Show History. Also backfilled the mic data model (the four live tables `mics`/`mic_checkins`/`mic_inventory_quantities`/`mic_inventory_submissions` were undocumented; legacy `mic_inventory` clarified). June 22 (later session) — A&R artist-persistence root cause (Clients page refetch select omitted `artists`/`contact_type`; corrected the prior "strip id/client_id fixed it" claim), and booking artist-search reworked to run through `client_contacts` with `.or('contact_type.eq.anr,contact_type.is.null')`. Earlier same day: WO→Calendar sync (schedule round-trip, studio-format bugfix, WO-owns-schedule gating), UnifiedSessionForm experimental build (owner-gated, inline WorkOrderPopup), booking-form artist search + A&R autoselect, dashboard room-grid → booking modal. Earlier: June 16 flags system + dashboard room grid.*

---

## 4. Session Notes

### May 22, 2026 — Calendar Polish
Added: vertical zoom (fit-all + 6 fixed levels), individual room collapse, endless horizontal scroll with buffer weeks, today-centering with post-scroll snap, visual week/month breaks, nav always accessible over modals, draft/state persistence across tab navigation (calendar, CRM, clients), hydration error fixed (localStorage out of useState initializer).

### May 22, 2026 — Runner Hub + Daily Ops Checklists (this session)

**What was built:**

Runner Hub routes (phone-first, no nav):
- `/runner` — studio select landing with today's session count per studio
- `/runner/[studio]` — per-studio daily ops hub: today's sessions + WO status + quick-action tiles (Opening Checklist, Closing Checklist, Petty Cash, Stock, Mics)
- `/runner/[studio]/wo/[id]` — WO review form: equipment condition, notes, expenses + receipt OCR via Anthropic claude-haiku-4-5, submit → sets status=submitted
- `/runner/[studio]/checklist/[opening|closing]` — tap-to-check lists, real-time saves on every tap (no gate), loads existing data on mount, Submit marks shift complete but form stays editable
- `/runner/[studio]/petty-cash`, `/runner/[studio]/stock`, `/runner/[studio]/mics`
- `/wo/[id]/print` — print-ready WO PDF view
- `/api/ocr-receipt` — server-side OCR endpoint (ANTHROPIC_API_KEY required)

Dashboard integration (LocationStrip + DailyOpsModal):
- LocationStrip studio cards always clickable → centered dialog (zIndex 10001)
- Dialog shows Yesterday section (only when unapproved items exist, orange header) + Today section
- Session cards with Runner/Admin two-checkbox approval pattern
- Daily ops rows: Opening Checklist, Closing Checklist, Petty Cash, Stock List, Mic Inventory — all clickable → DailyOpsModal (zIndex 10002)
- Checklist rows show live "14/32 checked" progress counter (fetched from `checklists` table)
- Orange ⚠ badge on rows where `needs_attention=true` (even before submission)
- DailyOpsModal: checklists always show live progress (no "awaiting runner" gate), status badge shows Not Started / In Progress / Submitted / Approved
- Admin approve button at bottom after runner submission

Real-time checklist behavior:
- Each tap saves immediately to `checklists` table (creates row on first tap via clIdRef + creatingRef pattern)
- Notes debounce 800ms (only after user edits, guarded by notesUserEdited ref)
- Needs Attention toggle: immediately upserts `daily_ops_submissions` without `submitted_at` → dashboard badge shows without waiting for Submit
- Submit marks shift complete (sets `submitted_at`), footer changes to "✓ Shift complete · X/Y" + Back button
- Form stays fully editable after Submit

Per-studio checklist items in `lib/checklist-items.ts`:
- Paramount (opening: Building, Control Rooms, Kitchen, Runs, Other, Before you leave; closing: Control Rooms, Building, Bathrooms, Kitchen, Paperwork, Before you leave)
- Ameraycan, Encore, Track with their own item sets
- Shared between runner page and DailyOpsModal admin view

New DB tables required (run in Supabase SQL editor):
```sql
CREATE TABLE IF NOT EXISTS daily_ops_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text NOT NULL, date text NOT NULL, category text NOT NULL,
  staff_name text, submitted_at timestamptz, admin_approved_at timestamptz, admin_approved_by text,
  needs_attention boolean DEFAULT false, attention_notes text, photo_urls jsonb,
  UNIQUE(studio, date, category)
);
CREATE TABLE IF NOT EXISTS checklists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text NOT NULL, type text NOT NULL, date text NOT NULL,
  staff_name text, items jsonb, completed_at timestamptz,
  notes text, photo_urls jsonb, needs_attention boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, date text, description text, amount numeric, type text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS petty_cash_balances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, date text, amount numeric, UNIQUE(studio, date)
);
CREATE TABLE IF NOT EXISTS stock_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, item text, qty int, notes text, low boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS mic_inventory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio text, name text, serial text, location text, condition text, notes text
);
CREATE TABLE IF NOT EXISTS expense_rows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id uuid, vendor text, item text, amount numeric,
  receipt_url text, submitted_by text, created_at timestamptz DEFAULT now()
);
```

Also requires `checklist-photos` Supabase Storage bucket (public) for photo uploads from checklist forms.

### May 28, 2026 — Calendar View Polish

**What was fixed:**

- **"All" location pill** now returns to `2wks` view (was incorrectly returning to `day`).
- **StudioView booking blocks** restyled to match main calendar: black `#0d0f14` background + 3px status-color top bar (was showing full-block color). Border treatment matches (accent left border for non-recording sessions, dim border otherwise).
- **StudioView cells never truncate.** Grid rows changed from fixed `1fr` (equal height, overflow hidden) to `minmax(80px, auto)` with `alignContent: 'start'`. All session info always fully visible regardless of how many bookings are in a cell.
- **StudioView booking blocks show full info:** client name (color-coded COD/Billing), time range, COD method (CC/ZELLE/CASH), engineer initials (1ST-XX), assistant initials (2ND-XX). Engineer/assistant color-coded by status (confirmed=green, hold=orange, unconfirmed=dim).
- **ResizeObserver vertical shrink glitch fixed.** Observer was firing mid-paint with a stale tiny height, causing rows to collapse. Added `requestAnimationFrame` debounce so height/width are only set from stable measurements.
- **Week/2wks/month views all showed same ~10-day range** because `COL_W` was a fixed constant. Changed to dynamic `colW` computed per view: `usableW/7`, `usableW/14`, `usableW/totalDays`. Each view now shows the correct date range.
- **Removed all post-scroll snapping.** The 80ms debounce snap-to-today was removed entirely from `handleGridScroll`.
- **View switching snaps to Sunday of current real-world week.** Clicking any view button always calls `setStartDate(getSunday(new Date()))` regardless of what was scrolled. Works correctly for all views.
- **Fixed 2wks/month not snapping after switching from week view.** Root cause: when switching from week (wide columns) to 2wks/month (narrow columns), the DOM reflow causes the grid's `scrollWidth` to shrink. This fires a `scroll` event before the `requestAnimationFrame` could set the correct position, and `handleGridScroll` saw `scrollLeft` at the old (large) position — past the right-edge threshold — and advanced `startDate` by 7 days. Fix: set `shiftingRef.current = true` before scheduling the rAF (blocking the scroll handler during the transition window), reset inside the rAF after `scrollLeft` is applied.
- **Initial grid measurement via `useLayoutEffect`** ensures `gridW` is correct on first render. Previously the `[startDate, view]` scroll effect fired with `gridW = 1200` (default state) before the ResizeObserver updated the real width, causing `colW` to be wrong and scroll position slightly off on initial load.
- **Zoom: removed redundant 44px level.** `ZOOM_FIXED` changed from `[44, 60, 80, 88, 110, 132]` to `[60, 80, 88, 110, 132]`. Fit-all is level 0 (the floor); `+` goes up from there. 44px was visually identical to Fit on most screens.

---

### May 29, 2026 — CRM Polish + Label Roster + A&R Admin

**CRM new lead form polish (chunk-crm-polish-1):**
- Source field changed from free text to dropdown
- Studio/Location replaced with `StudioSelect` component
- Notes field: placeholder text added
- Company + Label fields hidden automatically in COD mode

**StudioSelect + rate_daily + lead pre-fill (chunk-crm-polish-2):**
- `lib/studios.ts`: `STUDIO_LOCATIONS` constant + `parseLocation()` / `combineLocation()` helpers
- `components/shared/StudioSelect.tsx`: single flat dropdown in "Venue · Studio" format, shared across CRM and calendar
- `leads.rate_daily` (text) added to Lead type for hourly/daily rate toggle on both forms
- Calendar booking form wired to `StudioSelect` and to lead pre-fill from CRM "Start Booking" flow

**Label roster (chunk-crm-polish-3):**
- `lib/roster.ts`: `getArtistsForLabel()`, `addArtistToLabel()`, `removeArtistFromLabel()` — shared write gateway for `clients.artists[]`
- Lead form (Label mode): roster-backed A&R dropdown + artist dropdown
- Booking form: A&R autocomplete backed by `client_contacts` + roster-backed artist dropdown
- Client profile: Artists roster section reads `clients.artists[]`; syncs on every A&R card artist save
- `clients.artists[]` is the authoritative label roster (see Decisions Log)

**StudioSelect flat + field order (chunk-crm-polish-4):**
- `StudioSelect` redesigned as a true flat dropdown (previous version still had two-step cascade internally)
- Lead form field order corrected
- "Move to Booking" button on lead detail card navigates to `/calendar`

**Fixes (May 29):**
- Artist name not persisting to lead record from lead form
- A&R contact info not pre-filling in booking form when launched from a lead
- Hydration error on CRM All Leads filter buttons (localStorage read during SSR)
- Label client search now also matches A&R contact names (not only client name)

**A&R Admin D1 (chunk-anr-admin-d1):**
- Admins section added to label client profiles — separate list of admin/logistics contacts, distinct from A&Rs
- `bookings.anr_contact_id` + `bookings.anr_admin_contact_id` columns documented in `lib/supabase.ts` `Booking` interface

**A&R Admin D2 (chunk-anr-admin-d2):**
- Booking form: admin selection dropdown added for label bookings; `anr_contact_id` + `anr_admin_contact_id` written on every save
- `FormData` and `bookingToForm()` in the booking form updated to include both FK fields
- Contact popovers: A&R + Admin names in booking card are clickable → popover shows email/phone with Call/Text/Email links

**A&R Admin D2b (chunk-anr-admin-d2b):**
- Label booking card field order: Artist → A&R → Admin
- A&R and Admin names act as the popover trigger (underline indicator when info is present); no separate button
- Artist names in A&R card headers shown as small tiles instead of a comma-separated text row

---

### June 1, 2026 — A&R/Admin inline fields, WO signature pad, import script

**Label card inline (chunk-label-card-inline):**
- A&R and Admin fields in label booking card now show email/phone inline with Email/Call/Text action buttons — always visible, no popover required for basic contact info
- `hasInfo` guard: underline indicator on name only when the contact has stored email or phone
- Edit/× buttons removed from client card header — always-visible inline layout

**WO form + print view:**
- WO review form: static signature/print-name fields replaced with interactive legal name input + canvas-based signature pad
- WO print view: signature/print-name section removed (not needed for print-only flow)

**Other June 1 changes:**
- Lead detail card: Last Contact and Time fields removed (Activity Log already captures this)
- Nav: CRM and Calendar order swapped — Calendar now appears before CRM
- WO hub button: orange for draft/in-progress, green for submitted/approved
- Fix: lead `session_notes` now pre-fills into booking form when launched from a lead
- Fix: WO itemized row math corrected
- Fix: client delete now clears all FK references (`work_orders`, `leads`, `registration_tokens`) before deleting the client row — prevents FK constraint errors
- `scripts/importCalendar.mjs`: one-time historical bookings import from `paramount_import_2024.xml` (Supabase Storage). Parses XML, decodes rate codes via WALKTHEDOG cipher (`W=1 A=2 L=3 K=4 T=5 H=6 E=7 D=8 O=9 G=0`), maps studio names to DB IDs, upserts to `bookings` in batches of 100. Header comment: "Run once only. Delete after import is confirmed."
- Calendar booking form: A&R/Admin email+phone state now set inline at contact assignment (two `useEffect` watchers removed — eliminates extra render cycle)

---

### June 2, 2026 — WO bug fixes (second pass)

**Fix 1 — Print / Export PDF (scrap the route):**
- Deleted `app/wo/[id]/print/page.tsx` and `app/wo/[id]/print/PrintTrigger.tsx` entirely. The route was 404ing because the server-side Supabase query couldn't reliably find the WO record.
- Both Export PDF and Print buttons now call `window.print()` directly from inside the WO modal. The browser's native Save as PDF handles the download.
- Added `@media print` block to `styles/globals.css` that activates only when `[data-wo-portal]` is in the DOM (i.e., when the WO is open):
  - `body > * { display: none }` hides all body children (nav, calendar, booking form)
  - `body > [data-wo-portal]` is shown (more specific selector wins)
  - All inner backgrounds overridden to white/transparent, all text to `#111`
  - All buttons hidden
  - Sticky header made static
  - Input/textarea styled with thin underline only
- Added `data-wo-portal=""` attribute to the outermost portal backdrop div.
- Footer Export PDF button also changed to `window.print()` (was conditionally guarded on `woId`, guard removed since no ID is needed for direct print).

**Fix 2 — Sync missing fields:**
- Added `notes?: string` and `engineer_status?: string` to `WOFormSync` type.
- Added to `onFormSync` call in `handleClose`:
  - `notes: wo.session_notes` → `form.notes`
  - `rate: stRows[0]?.rate ?? ''` → `form.rate` (first studio row rate; WO has no global rate field)
  - `rate_daily: stRows[0]?.rate ?? ''` → `form.rate_daily` (same value; form's `rate_type` toggle determines which is shown)
  - `engineer_status: booking.engineer_status ?? ''` → `form.engineer_status` (WO doesn't edit status; pass booking's stored value through unchanged)

**Fix 3 — WO button color:**
- Changed `const woInProgress = woStatus === 'draft'` → `const woInProgress = woStatus === 'draft' && !!bookingId`
- A draft WO on an UNSAVED booking (no `bookingId`) now shows lime green (`#c8f04e`) instead of orange — opening the WO mid-form-fill no longer flips the button.
- A draft WO on an ALREADY-SAVED booking still shows orange (expected: WO exists but not submitted).

---

### June 2, 2026 — WO bug fixes (follow-up)

**Fix 1 — WO→Booking form sync on Close & Save:**
- Root cause: `onFormSync` was called after multiple `await` chains inside `handleClose`. Stale React closure risk after async DB writes meant the booking form might not receive the latest `wo` state.
- Fix: moved `onFormSync` call to the TOP of `handleClose`, synchronously after `setSaving(true)`, before any DB `await` operations. This guarantees it fires with the `wo` captured at click time with no async batching risk. The duplicate call at the bottom of `handleClose` was removed.

**Fix 2 — Export PDF + Print 404:**
- Root cause: `app/wo/[id]/print/page.tsx` Supabase client was using the anon key. `schema.sql` shows `work_orders` has RLS enabled (`alter table work_orders enable row level security`). If the anon SELECT policy is missing from the actual DB, the query returns null → `notFound()` → 404.
- Fix: print page now uses `SUPABASE_SERVICE_ROLE_KEY` (already in env) when available, falling back to anon key. Service role bypasses RLS unconditionally on the server. Also fixed misplaced `import PrintTrigger` (was after a `const` declaration; moved to top of file).

**Fix 3 — Engineer box color visibility:**
- Root cause: rgba tints `rgba(78,240,162,0.08)` and `rgba(240,162,78,0.08)` were too low-opacity to be visible against the dark WO background (`#13161d`).
- Fix: changed to solid dark hex colors — confirmed = `#14532d` (dark green), hold = `#7c2d12` (dark orange/brick). Text remains `#f0f0f0` / `#8a8fa0` which is readable against both.

---

### June 2, 2026 — WO modal improvements

**Export PDF + Print (Item 1):**
- Both buttons live in the WO sticky header alongside the existing action buttons.
- **Export PDF** (existing): opens `/wo/{id}/print` in a new tab — clean white-background layout, user manually saves as PDF via browser.
- **Print** (new): opens `/wo/{id}/print?autoprint=1` — same print route, but `PrintTrigger` client component auto-fires `window.print()` 800ms after mount. No new library installed; uses the existing print route's `@media print` CSS (already hides buttons and chrome).
- `app/wo/[id]/print/PrintTrigger.tsx` — new client component (same pattern as `register/view/.../PrintTrigger.tsx`).
- `app/wo/[id]/print/page.tsx` — accepts `searchParams.autoprint`; renders `<PrintTrigger />` when `=== '1'`.

**Close & Save + Cancel buttons (Item 2):**
- Removed the X close button from the sticky header.
- Added **Cancel** (calls `onClose()`, no save) and **Close & Save** (calls `handleClose()`, saves then closes) to both the sticky header and the bottom footer.
- Cancel: ghost style (`rgba(255,255,255,0.12)` border, `#8a8fa0` text). Close & Save header: outlined accent (`rgba(200,240,78,0.12)` bg). Close & Save footer: full accent (`#c8f04e` bg) — unchanged.

**Engineer box colors (Item 3):**
- Engineer row in WO meta grid now shows a subtle background tint based on `booking.engineer_status`:
  - `confirmed` → `rgba(78,240,162,0.08)` (green tint)
  - `hold` → `rgba(240,162,78,0.08)` (orange tint)
  - Otherwise → no change (default transparent)
- Reads `booking.engineer_status` directly from the `booking` prop (already typed as `EngineerStatus` on `Booking`). No new props added.

**Sync on save only (Item 4):**
- Removed `applyLiveForm()` function and `liveForm?: WOFormSync` prop from `WorkOrderPopup`.
- WO now reads only from DB on open — no unsaved booking form state bleeds in.
- WO → booking form sync on Close & Save via `onFormSync` is unchanged.
- Removed `liveForm={...}` from the calendar page's `<WorkOrderPopup>` render.
- `WOFormSync` type and `onFormSync` prop are kept (still used for WO→booking sync on save).

---

### June 2, 2026 — CRM + Clients merge

**What changed:**

- **LEADS / CLIENTS toggle** added to `/crm` above the existing Needs Action / All Leads / Analytics sub-nav. Underline style using `var(--accent)` for active tab. Defaults to LEADS on every page load (no persistence).
- **Clients page embedded** under the CLIENTS tab. `ClientsPageInner` exported from `app/(main)/clients/page.tsx` and rendered with `<Suspense>` inside the CRM page when CLIENTS is active. All existing client list + profile logic is unchanged.
- **Cross-page nav preserved.** CRM page reads `?clientId=` or `?id=` from URL on mount and auto-switches to the CLIENTS tab with the matching client pre-selected. This preserves the "Start Booking → Confirm Client → /clients?id=..." flow — URLs now land on `/crm?clientId=...` instead.
- **Clients nav item removed** from `components/layout/Nav.tsx`. Unreviewed registration badge moved from `/clients` to `/crm`.
- **`/clients` stub redirect** — the default export of `app/(main)/clients/page.tsx` now redirects to `/crm` via `router.replace`. File kept so saved bookmarks don't 404.
- `app/(main)/clients/page.tsx` changes: export `ClientsPageInner`; add `initialClientId` + `embedded` optional props; `embedded` switches outer div from fixed viewport-height to `flex: 1 / minHeight: 0` for correct layout when hosted inside CRM; `router.replace('/clients?id=...')` changed to `router.replace('/crm?clientId=...')`.

### June 1, 2026 (continued) — Registration Status, Contact Actions, SOP Tab

**Fixes applied earlier in the day:**
- CRM hydration mismatch: `view` and `selectedId` state were reading sessionStorage inside `useState` lazy initializers, which run on the client before hydration and differ from the server's catch-branch defaults. Fixed to stable defaults (`'needs-action'`, `null`) with a single `useEffect` restore — same pattern already used in `AllLeadsSection`.
- Registration links were using `localhost:3000` because `window.location.origin` was hardcoded. Fixed with `NEXT_PUBLIC_BASE_URL || window.location.origin`. Add `NEXT_PUBLIC_BASE_URL=https://prs-flow.vercel.app` to `.env.local` for local dev and to Vercel for production.

**chunk-crm-reg-view — Registration status 3-state button:**

Three states replace the old `lead.client_id + existingTokenStr` binary logic:
- **Send Reg** — no token exists; generates token, auto-opens link panel with Copy / Email / Resend
- **Reg Sent** (orange, clickable) — token exists but `used_at` is null; clicking re-queries the DB first (catches completion without page refresh), then toggles an expand panel with Copy Link / Email / Resend
- **✓ Registered** (green, clickable) — token `used_at` is set OR `clients.registered_at` is set; opens registration view modal

Token lookup uses a three-step query on every lead open (see Decisions Log). `generateRegLink()` now stores `client_id` on the token when the lead has one, making step-2 lookups work for future tokens.

Registration button is hidden entirely for Label/Billing leads (`lead.billing !== 'Billing'` guard).

**Registration view modal (`components/shared/RegViewModal.tsx`):**
- Displays full registration submission: name, contact, address, Instagram, how heard, terms accepted badge, ID photo (signed URL, 1hr expiry)
- **Export PDF** button opens `/register/view/[clientId]` in a new tab
- Shared between CRM lead card and Clients page profile — both surfaces open the same modal
- z-index 10003 (above all existing modals)

**`/register/view/[clientId]` print route:**
- Server component: fetches client data + generates 1-hr signed ID photo URL
- Clean letter-sized print layout: Paramount header, client name in Syne display type, all fields, ID photo, confidential footer
- `PrintTrigger` client component fires `window.print()` 800ms after mount

**Registration bug fixes (applied across multiple commits):**
- Reg Sent button staying grey after client completes registration: `refreshRegStatus()` re-queries DB on click; if `used_at` is now set, transitions to ✓ Registered without page refresh
- Leads with `client_id` showing Send Reg after page load: three-step lookup replaces single `lead_id` query
- Use & Link path: token `used_at` is set but `clients.registered_at` may not be updated by that path — handled by step 3 fallback

**Call / Text / Email action buttons:**

Added to every contact surface in the app:
- **Lead detail card** (crm/page.tsx): Email (`mailto:`) inline next to email input; Call (`tel:`) + Text (`sms:`) inline next to phone input
- **Client profile COD contact section**: Email / Call+Text below the InlineField components when values are present
- **A&R contact card headers**: Email inline with email text; Call + Text below when phone present
- **Admin contact card headers**: same pattern as A&R

Style: `aBtnStyle(color)` — DM Mono 9px, transparent bg, `var(--border)` border, no underline. Email=`#7BBFFF`, Call=`var(--booked)`, Text=`var(--warm)`. `e.stopPropagation()` on card-header links.

**Select dropdown styling:**
- `styles/globals.css`: global `select` rule expanded with `-webkit-appearance: none; appearance: none; outline: none` — strips native OS chrome from all select elements so inline styles fully control appearance across all views and browsers.

**SOP / Training tab:**
- Nav item `{ href: '/sop', label: 'SOP' }` added as the last entry in `navItems`
- `app/(main)/sop/page.tsx`: full-viewport iframe (`height: calc(100vh - 52px)`) pointing to `/sop.html`
- `public/sop.html`: static training guide served directly by Next.js; update the guide by replacing this file with no code changes needed

---

### June 2, 2026 — WO Save/Sync Overhaul + Booking Form Polish

**Root cause fixed: `.maybeSingle()` bug accumulated 300+ duplicate WOs**

`initWO` was querying `work_orders` with `.maybeSingle()`, which returns `null` when multiple rows match (rather than throwing). Because the WO modal was remounting on every parent re-render (due to an inline `liveForm` object creating a new reference each time), `initWO` ran constantly. Each run found multiple rows, returned `null`, and created yet another WO. Over time this produced 160+ duplicate `work_orders` rows for one booking_id. **Fix:** Changed query to `.order('created_at', { ascending: false }).limit(1)` and used `data?.[0]`. 299 duplicate rows cleaned up via REST API batch delete. `liveForm` memoized with `useMemo` in `BookingForm` to prevent spurious `WorkOrderPopup` remounts.

**WO Close & Save — DB write + form reopen (replaces onFormSync)**

Previous approach: `handleClose` fired `onFormSync` to push WO values into booking form's React state. This was brittle due to shadow state variables (`anrQuery`, `engOn`, etc.) and React stale closure issues in blur handlers. New approach:
- `handleClose` writes to BOTH `work_orders` AND `bookings` (syncing `from_time`, `to_time`, `client_name`, `engineer_name`, `assistant_name`, `producer`, `phone`, `email`, `notes`, `invoice_num`, `ordered_by`, `payment_type`)
- New `onSaved` prop on `WorkOrderPopup` fires after all DB writes complete
- `onSaved` (defined in calendar page where `setFormOpen`/`openEdit` are in scope) refetches the booking from `bookings` by ID, closes the booking form, and reopens it with fresh data after 50ms
- `onFormSync` prop retained but no longer used from the calendar page

**Studio time table improvements**

- FROM/TO fields removed from WO meta grid top section — redundant with the per-row times in the studio time table
- Studio time table FROM/TO cells upgraded from plain `<input>` to `<TimeInput>` — typing `6p` → `6:00 PM` on blur
- `TimeInput` bug fixed: the early-return path for already-normalized values (`H:MM am/pm`) was returning original case unchanged. Fixed: `s.slice(0, -2) + s.slice(-2).toUpperCase()` ensures AM/PM always uppercase
- Single-day sessions: on WO open (`initWO`), if `booking.start_date === booking.end_date`, `liveForm.from_time`/`liveForm.to_time` are applied to `stRows[0]` before `setStRows` — so the WO reflects the current booking form times even before the user has saved

**WO print overhaul**

- `@media print` CSS completely rewritten in `styles/globals.css`
- `@page { margin: 0.5cm }` added as top-level rule (controls browser print margins)
- Removed `transform: scale(0.72) / transform-origin: top left` (was causing left-shift). WO card now uses `width: 100%; max-width: none` — fills printable width at 10px font
- `page-break-inside: avoid` on the bottom two-column section (notes + signature + payments) — signature block never orphaned on page 2
- All dark backgrounds, `rgba(...)` fills, and accent colors normalized to transparent/`#111`
- `button`, `input[type="radio"]`, `input[type="checkbox"]` hidden
- `textarea` capped at `max-height: 60px` to prevent notes overflow
- PDF filename: `printWithFilename()` helper sets `document.title` to `CLIENT_INV#` (COD) or `LABEL_ARTIST_INV#` (Billing) before `window.print()`, restores after. `_INV#` literal appended when no invoice number exists

**Booking form polish**

- **Engineer edit-in-place:** Clicking the `● EngineerName` button opens the search input pre-filled with the current name. Escape or blur-without-selection reverts to original name + status. Implementation uses `engEditingRef` (a ref) alongside `engEditing` state — refs are always current in blur `setTimeout` closures, avoiding the stale closure issue that caused status to reset to 'hold'. The Escape handler sets `engApplied.current = true` (not `engEditingRef = false`) so the subsequent blur from unmount skips `applyEng`. Blur is the single place that clears `engEditingRef`.
- **TBD button:** Inactive state now fully grey (`var(--text3)` text, `var(--border)` outline). Turns red only when active.
- **Multi-day sessions:** FROM/TO time inputs replaced with static `"Edit times in WO"` label (grayed out). Staff know per-day times are edited in the studio time table rows inside the WO.

---

### June 3, 2026 — WO & Daily Ops Amendment (Steps 1–9)

Large session touching runner WO form, dashboard daily ops, checklists, and adding the Daily Ops Log page.

**Schema additions (run in Supabase SQL editor):**
- `work_orders`: added `needs_attention_notes TEXT`, `runner_finished BOOLEAN DEFAULT false`, `runner_finished_at TIMESTAMPTZ`, `admin_approved BOOLEAN DEFAULT false`, `admin_approved_at TIMESTAMPTZ`, `needs_attention_photos JSONB`
- `checklists`: added `needs_attention_notes TEXT`, `needs_attention_photos JSONB`
- `tasks` table: new — for flagging attention items linked to submissions on submit

**Runner WO page (`app/runner/[studio]/wo/[id]/page.tsx`):**
- Submit button → Finish button. On click: `runner_finished = true`, `runner_finished_at = now()`, `status = 'submitted'`. Confirmation dialog ("Are you sure this WO is complete?") guards accidental finish. WO remains fully editable after finishing (no lock).
- Save Changes button persists session notes + NA fields without finishing; navigates back to studio hub on save.
- Needs Attention section: textarea for internal notes (never printed — `data-no-print` attribute), photo upload via `checklist-photos` storage bucket, photo thumbnails with ✕ delete button. Admin sees thumbnails read-only in WorkOrderPopup.
- Cancel button navigates back without saving (all three footer buttons always visible).
- Session Info block fetches the linked `bookings` row on load for live data; shows "Label / A&R: LabelName / ContactName" for billing bookings.
- Real-time subscription on `work_orders` (filtered by `id=eq.${resolvedWoId}`): on UPDATE, full re-fetch of WO + booking + studio time rows; runner's edited fields (session notes, NA, equip conditions) are separate state vars and are not overwritten.

**Dashboard LocationStrip (`components/dashboard/LocationStrip.tsx`):**
- `getYesterday(today: string)` replaced with `getLocalDateStr(offsetDays = 0)` — uses local time components to avoid UTC date rollover bug after 5 PM PDT.
- Two-column drawer: Yesterday (unapproved items only; "All clear" empty state) / Today (all sessions regardless of approval status).
- Approved WOs and ops submissions disappear from Yesterday automatically once approved. Today shows everything until the operational day (8am) advances.
- Orange ⚠ Needs Attention badge on SessionCard when `runner_finished = true` AND `needs_attention_notes` is present; hidden once admin approves.
- View/Edit button on SessionCard opens WorkOrderPopup inline. `onSaved` refetches the drawer. Both the runner WO page and admin WorkOrderPopup write the same `work_orders` row — single source of truth.
- Real-time subscriptions: `bookings` (filtered `start_date=eq.${today}`) + `work_orders` (filtered `session_date=eq.${today}`, UPDATE only). Both call `load()` on any event.

**Checklists (`app/runner/[studio]/checklist/[type]/page.tsx`):**
- Needs Attention now auto-flags from content rather than a manual toggle — `needs_attention` on the submission is set when `notes` or `photos` are present.
- Notes + photos debounce combined into a single `useEffect` so they always save together.
- On Submit: if attention content is present, inserts a row in `tasks` table linking the submission.
- DailyOpsModal reads `needs_attention_notes` column directly for display.

**Daily Ops Log page (`app/(main)/daily-ops-log/page.tsx` + `components/admin/DailyOpsLogSection.tsx`):**
- New route `/daily-ops-log` added to nav (between Admin and SOP).
- Shows all approved WOs (`admin_approved=true OR status=approved`) + all approved ops submissions (`admin_approved_at != null`), sorted by approval time descending.
- Filter controls: studio, type (Work Order / checklist categories), date range.
- Clicking a WO row opens WorkOrderPopup. Clicking an ops row opens DailyOpsModal.
- Component extracted to `components/admin/DailyOpsLogSection.tsx` and embedded as a tab in the Admin sidebar alongside Engineers and SRS Log.

---

### June 3, 2026 — Runner hub and WO fixes (post-amendment)

**UTC → local date fix (`e9d8a71`):**
- `getYesterday(today)` in LocationStrip replaced with `getLocalDateStr(offsetDays)` (local time components, no UTC rollover).
- Runner studio page `load()` date computation changed from `toISOString().slice(0,10)` to local-time construction using `getTimezoneOffset()`.

**Four runner fixes (`344c915`):**
- Runner WO footer redesigned: Cancel (back, no save) | Save (saves + navigates to studio hub) | Finish (confirmation dialog → sets `runner_finished`). Always three buttons, WO stays editable after finish.
- Needs Attention photo thumbnails: upload to `checklist-photos` public bucket; `getPublicUrl()` replaces signed URLs; thumbnails shown with ✕ delete button; photos saved to `work_orders.needs_attention_photos` immediately on upload.
- Runner hub session cards: entire card is the tap target (`onClick` on outer div); Open WO button removed; `cursor: pointer` + `WebkitTapHighlightColor: transparent` for clean iPhone tap.
- Approved WOs 8am rule: removed `activeSessions` filter that was hiding approved WOs from Today column immediately; they now stay until the operational day advances (via `getLocalDateStr()`).

**NA photo storage bucket fix (`9a619e3`):**
- `expenses` bucket never existed. Switched both WO expense receipts and NA photos to `checklist-photos` (public, confirmed working). `supabase/storage-expenses-bucket.sql` added for future private bucket if needed.

**WO z-index fix (`9085861`):**
- WorkOrderPopup `zIndex` raised from `10000` → `10010` so it renders above the LocationStrip drawer (`10001`). Both the loading portal and main portal updated.

**Artist field fixes for label bookings (`5a79d59`, `bb9f43e`):**
- `applyClientAutofill`: for label clients (`labelName` truthy), `artist` field is now set to `''` instead of pre-filling from the roster's first entry.
- Client suggestion dropdown: `sub` (subtitle under label name) no longer shows the first roster artist — just empty, consistent with not pre-filling.
- Booking form `openEdit` path: when navigating from "Start Booking" with a label client, `initial.artist` only pre-fills for non-billing clients (`if (!isBilling)`).

**WO card artist hero layout + NA note snippet (`bcfed21`, `5a79d59`):**
- SessionCard in LocationStrip: artist name is now the hero (large, bold); client/label name appears smaller underneath when both exist. Fallback to client name if no artist.
- NA note text snippet removed from SessionCard — only the ⚠ badge shows; note text was cluttering the card.

**Ops Log moved to Admin sidebar (`b6efd77`):**
- `DailyOpsLogSection` extracted to `components/admin/DailyOpsLogSection.tsx`.
- Admin sidebar: new "Ops Log" tab alongside Engineers and SRS Log. `AdminSection` type extended to `'engineers' | 'srs_log' | 'daily_ops_log'`.
- Standalone `/daily-ops-log` route simplified to wrap the component.

**Runner WO Session Info sync and Label/A&R field (`10ca3f5`, `07c1d91`, `cac21f2`):**
- WO page init: fetches WO first (to get `booking_id`), then in parallel fetches linked booking + rows. `booking` state is source of truth for session info.
- "Label / A&R" label replaces "Client" for billing bookings. Value combines label name + A&R contact name as `"Interscope / Stephen Baynes"` (` / ` separator); falls back gracefully if either is missing.

**Real-time subscriptions across runner pages (`12e1ce2`, `93276e5`, `3f862a4`, `c13524a`, `b6dc2e9`, `dd2a19c`):**
- Runner hub (`/runner`): `bookings` subscription filtered by `start_date=eq.${today}`; session counts per studio update live.
- Runner studio page (`/runner/[studio]`): `bookings` + `work_orders` subscriptions for today. WO status badges update live when admin approves.
- Runner WO page: `work_orders` subscription by ID triggers full re-fetch (WO + booking + studio time rows).
- All runner pages: filter changed from `.eq('status', 'confirmed')` to `.not('status', 'eq', 'cancelled')` to match the admin view.
- `console.log` debug statements added to each subscription: subscribe/status/event/unsubscribe. Confirmed subscriptions connect (SUBSCRIBED) but events don't fire without `ALTER PUBLICATION supabase_realtime ADD TABLE` + `REPLICA IDENTITY FULL` on each table.

---

### June 4, 2026 — Day-rate WO, Equipment Condition, WO live sync fixes, real-time project standard

Covers commits `358974d` through `aa682d2`.

**React hydration fix (`358974d`):**
- Hydration error from server/client date mismatch fixed; date state initialized to a stable server-safe default and computed client-side in `useEffect`.

**Day-rate WO improvements (`0f22ca0`, `1eadb5d`, `9ffd2ae`, `460d2e8`):**
- Studio Time table in WorkOrderPopup now has two layout modes: day-rate (compact — Date | Room | Hours | Rate | Charge) vs. hourly (existing multi-row time ranges with FROM/TO).
- Day-rate charge calculation fixed — was showing $0. Correct formula: `rate_daily / 8 * hours` for partial days, or `rate_daily` for a full 8-hour day.
- Multi-day day-rate: on WO open, reconciles missing `studio_time_rows` — if the booking was extended after the WO was created (more days than rows in DB), missing rows are upserted before rendering.
- Duplicate `studio_time_rows` eliminated: rows upserted by `(work_order_id, sort_order)` key; re-opening a booking no longer accumulates duplicate rows.
- Same two-layout compact table added to runner WO page.

**Equipment Condition improvements (`e85c5a3`, `bc0eb1a`):**
- Horizontal scroll enabled on the Equipment Condition table in both admin WorkOrderPopup and runner WO page; first column (equipment name) is `position: sticky, left: 0`.
- "Not OK" cells: clicking opens an inline popup for entering condition notes + uploading a photo (to `checklist-photos` bucket).
- Equipment condition section excluded from WO PDF print via `data-no-print` attribute.

**WO live sync fixes (`293a272`, `a53b5d7`, `e33d431`, `7d676c7`):**
- `isDayRate` in WorkOrderPopup was reading from `booking.rate_type` (a stale DB snapshot from WO open time). Fixed to `liveForm.rate_type === 'daily' || !!liveForm.rate_daily` — uses the live booking form state. This caused wrong table layout and $0 charge on day-rate sessions when the rate was set after WO was opened.
- Both reactive `useEffect` hooks that sync booking dates and rate into `stRows` had `wo?.id` added to their dep arrays. They were firing on mount before `initWO` resolved, then not re-running because the primitive deps hadn't changed. Adding `wo?.id` causes both effects to re-run when `initWO` first sets `wo`.
- `rateRaw` in the rate sync effect now reads `liveForm.rate_daily || liveForm.rate` instead of falling back to `booking.rate_daily` — eliminates the stale DB rate read.
- Post-save rate/date sync in `handleSave` (calendar page): WO id query hoisted outside the `if (rate_type === 'day')` guard block. Rate now syncs to all `studio_time_rows` on every booking save, not just day-rate saves.
- `onSaved={undefined}` in calendar page: WO Close & Save no longer remounts BookingForm from the DB snapshot. Prevents unsaved booking form edits (changed date range, rate) from being wiped when the WO closes. Status updates flow via `onStatusChange` prop.

**Real-time subscriptions — project-wide standard (`ff002f2`, `aa682d2`):**
- All four data surfaces now use `postgres_changes` subscriptions:
  1. **Runner WO page** — `studio_time_rows` channel filtered by `work_order_id`; full row re-fetch + OT hours map update on any change. Channel: `runner-wo-strows-{id}`. (In addition to existing `runner-wo-{id}` on `work_orders`.)
  2. **Admin WorkOrderPopup** — two channels: `studio_time_rows` by `work_order_id` (any event → refetch + normalize all rows); `work_orders` by ID (UPDATE → patch `status` only). Both gated on `resolvedWoId` state (set after `initWO` resolves, not just `woIdRef` which is a ref). Channel names: `admin-wo-strows-{id}`, `admin-wo-status-{id}`.
  3. **LocationStrip** — `fetchDrawerData(loc)` extracted from `openDrawer()` for silent refresh without loading spinner. `selectedLocRef` tracks the current open location in subscription callbacks. Two channels: `daily-ops-bookings` on `bookings`, `daily-ops-wos` on `work_orders`.
  4. **Calendar page** — `bookings` channel. `loadRef.current = load` pattern: a separate `useEffect([load])` keeps the ref current so the mount-time subscription always calls the latest `load` without re-subscribing. Channel: `calendar-bookings`.
- Diagnostic `[WO sync]` console.logs stripped from `handleSave` WO sync block (`aa682d2`).
- `equipment_condition_notes` table added to `supabase_realtime` publication (SQL run directly in Supabase; no code commit). Supabase realtime tables now: `bookings`, `work_orders`, `studio_time_rows`, `equipment_condition_rows`.

---

### June 5, 2026 — Engineer hours/rate in WO, Ops Log search, Runner session hero

**Commits: `89c2fe3`, `188b989`**

**Engineer sub-row in Studio Time (`89c2fe3`):**
- `bookings.engineer_rate` text column added to schema; starts blank (no default value)
- Admin WorkOrderPopup Studio Time table shows a compact engineer sub-row below each day's row whenever `booking.engineer_name` is set — both day-rate and hourly layouts. Col 1 blank, Col 2 engineer name (italic), Col 3 eng_hours input, Col 4 eng_rate input, Col 7/last eng_charge display. `eng_charge = eng_hours × eng_rate` computed on each change
- Engineer Total appears in WO totals block (between Studio Total and Rentals). Grand total = stTotal + engTotal + rentTotal
- Runner WO page updated to match: compact single-row table for both day-rate and hourly (replacing the previous stacked card view); engineer sub-row in both layouts with eng_hours editable and eng_rate display-only
- `bookings.engineer_rate` set on booking save; post-save sync propagates to `studio_time_rows.eng_rate` for existing rows if currently null/empty
- `handleSaveChanges` on runner WO page saves `eng_hours` + `eng_rate` + `eng_charge` for every stRow

**Ops Log search (`89c2fe3`):**
- Search bar added to `DailyOpsLogSection` filter row as leftmost element
- Case-insensitive live filter on all log rows by client name, artist name, studio, engineer name, invoice number
- `LogRow` type extended with `artistName`, `engineerName`, `invoiceNum` fields populated from joined booking rows

**Runner session hero (`89c2fe3`):**
- Runner studio page session cards: artist name (`b.artist || b.client_name || '—'`) is now the large primary headline
- Client/label name appears as smaller secondary text below only when both artist AND client_name are present
- Matches admin SessionCard in LocationStrip drawer

---

### June 5, 2026 — WO engineer UX polish (three-part fix series)

**Commits: `3c09ce2`, `31d78bb`, `f69c134`**

**Part 1 — Five focused fixes (`3c09ce2`):**
1. **Ops Log removed from top nav** — `{ href: '/daily-ops-log', label: 'Ops Log' }` removed from `navItems` in `Nav.tsx`. Ops Log accessible only from Admin sidebar tab.
2. **Engineer sub-row in admin WO** — both day-rate and hourly layouts show eng sub-row; `eng_hours`/`eng_rate` written to DB on `handleClose`; Engineer Total in WO totals block.
3. **$55 default removed everywhere** — `applyEng` in booking form no longer sets `engineer_rate = '$55'`; booking form eng_rate placeholder cleared; runner WO `handleSaveChanges` no longer falls back to rate `55`.
4. **Runner WO compact table** — replaced stacked card layout with compact single-row table for both day-rate and hourly; engineer sub-rows in both; Col 1 blank (not "Eng" text), engineer name in Col 2 italic.
5. **Auto-seed studio_time_rows** — on WO init, if `stRows` is empty after fetching, seeds rows from booking date range; uses correct `isDayRate` branching for rate/charge/day_count; inserts to DB; initializes `engHoursMap` via `defaultEngHrs`.

**Part 2 — Runner WO UX refinements (`31d78bb`):**
1. **`defaultEngHrs(r)` helper** — returns `r.eng_hours` if set, else `r.total_hours`, else `calcHours(from_time, to_time)`, else `''`. Applied when initializing `engHoursMap` after init and auto-seed.
2. **$55 fully removed from runner** — all occurrences of `|| '$55'`, `|| '55'`, placeholder `"$55"` removed from runner WO page (`engRateForRow`, `engTotal`, `handleSaveChanges`).
3. **Subtotal labels** — runner WO subtotal footer shows `"Studio: $X"` and `"Eng: $X"`. Admin WO totals block shows `"Eng Total"`.
4. **Eng sub-row column alignment** — Col 1 blank in both day-rate and hourly eng rows; engineer name in Col 2 with italic; consistent across both layouts.
5. **`bkData` fallback for non-standard WO URLs** — runner WO `init()` fetches booking by `woData?.booking_id || bookingId` (URL param fallback). Fixes the case where `woData.booking_id` is null.

**Part 3 — Admin WO eng defaults + date reconciliation (`f69c134`):**
1. **`normalizeStRow` eng_hours default** — defaults `eng_hours` to `total_hours` then `calcHours(from_time, to_time)` when DB value is null. Recomputes `eng_charge` from defaulted value × `eng_rate` when `eng_charge` is null and `eng_rate` is set.
2. **$55 removed from admin WO** — `engRateDisplay` fallback chain changed from `|| '$55'` to `|| ''` in both day-rate and hourly sections of WorkOrderPopup.
3. **Eng subtotal in Studio Time footer** — inline footer below the Studio Time table shows `"Eng: $X"` when `engTotal > 0`, above the existing `"Total: $X"` line.
4. **Date reconciliation for hourly** — live date range sync `useEffect` had `if (!isDayRate) return` guard; guard removed. Deletes stale rows and inserts new-date rows for both day-rate and hourly. Hourly inserts use `total_hours = calcHours(from_time, to_time)`, `charge = calcCharge(...)`, `day_count = null`.
5. **Runner RT accepts admin-set eng_hours** — `setEngHoursMap` in the runner WO RT subscription: when an existing row's `eng_hours` becomes non-null (admin set it), update the runner's map entry — but only if the runner's current value equals the auto-computed default (i.e., runner hasn't typed a custom override).

---

### June 5, 2026 — Per-row rate type architecture + unified Studio Time table

**Commits: `d7dcf71` through `9b4b8a4`, `af6b46c`, `3f25b0c`–`3e90378`**

**Architecture change — per-row rate type (`9b4b8a4`):**
- `studio_time_rows` gained two new columns: `row_rate_type text DEFAULT 'hour'` and `rate_daily text`
- Each row independently toggles between `'hour'` and `'day'` billing — decouples rows from booking-level `rate_type`
- `toggleRowRateType(id)`: hour→day sets `rate_daily = rate × 10`; day→hour sets `rate = rate_daily ÷ 10`
- Booking-level rate-sync `useEffect` in WorkOrderPopup deleted; post-save rate sync block in `calendar/page.tsx` deleted
- `normalizeStRow` branches on `row_rate_type`: day rows use `rate_daily` flat; hourly rows derive charge from `totalHours × rate`

**Unified 9-column Studio Time table (admin + runner):**
- Columns: Date | Session Info | From | To | Hrs | Type | Rate | OT Rate | Total
- Type cell shows Day/Hr toggle buttons (admin, `display: flex, flexDirection: row`) or display-only label (runner)
- Replaces the previous dual-layout (separate compact day-rate table vs. full hourly table) in both `WorkOrderPopup` and runner WO page
- `TimeInput` component changed from smart-parse text `<input>` to `<select>` with 48 options (every 30 min, 12-hour AM/PM)
- Eng sub-row From/To inputs linked to parent studio row's `from_time`/`to_time`
- Day-rate rows: Days column removed; From + To `TimeInput` selects added per row (`af6b46c`)
- Multi-day booking form: FROM/TO inputs restored (no longer hidden for multi-day sessions — `d7dcf71`)

**Bug fixes in this session:**
- `normalizeStRow` charge fix (`3f25b0c`): always derive charge from `totalHours × rateNum` for hourly rows (was using raw DB value when rate empty)
- `engTotal` on admin WO: fallback reads `liveForm?.engineer_rate || booking?.engineer_rate` when no stRow has eng_rate set (`fe9c54c`)
- `TimeInput` changed to 30-min select (`fe9c54c`)
- Runner Hrs column display and admin stale charge fixed (`0b26b5b`, `6b1c5c8`)
- Dedup stRows on init: prevents duplicate rows when WO opened multiple times (`1a3859e`)
- Admin Studio Time footer subtotals shown even when only eng data is present (`1a3859e`)
- Raw insert path in date-range reconciliation correctly writes `total_hours` + `charge` (`d7b571d`)
- OT Rate for hourly rows auto-populates from hourly rate in `normalizeStRow` (`6f42ee6`)

**Studio Time visual cleanup (`3e90378`):**
- Admin: cell dividers removed; date format changed to `M-D` (e.g. `6-5`) via `shortDate()` helper; reduced cell padding; vertically centered cells
- Runner: compact 444px table width; Session Notes → "Notes" pill that opens a bottom sheet; engineer name → two-letter initials pill that opens a fixed-position popover showing full name

---

### June 5, 2026 — Runner WO UX polish series (notes bottom sheet + iOS fixes)

**Commits: `c3467b3` through `271a75f`**

**Notes bottom sheet (`c3467b3`, `110466b`):**
- Replaced full-screen modal with `position: fixed` bottom sheet: `bottom: 0, left: 0, right: 0; maxHeight: 38vh`; `3px solid #c8f04e` accent top border; no background dim; autoFocus textarea; Save + Cancel with iOS safe-area padding
- Admin session info popover: clicking Session Info cell in admin WO Studio Time opens a 280px fixed popover with editable textarea + Save/Close

**PDF session notes (`c3467b3`):**
- `<span data-si-print>` wraps full session notes inside the Session Info cell; hidden on screen, revealed in `@media print` CSS in `globals.css`
- Notes appear inline in the Studio Time table in the printed/PDF WO

**Eng initials popover (`c3467b3`):**
- Engineer name in runner Studio Time table shows as two-letter initials pill
- Tap opens a `position: fixed` popover above the pill showing the full engineer name
- Transparent backdrop closes on tap

**Runner viewport and overflow fixes (`1f6de3e`, `110466b`, `e212b4a`–`271a75f`):**
- All runner page root containers: `maxWidth: '100vw', overflowX: 'hidden'`
- Bottom sheet wrapper uses `left: 0, right: 0` instead of `width: 100vw` (avoids horizontal overflow on devices with scrollbars)
- All child elements of the bottom sheet use explicit `paddingLeft/paddingRight: 16` longhand (avoids global reset overrides on iOS)
- Next.js `Viewport` export in `app/layout.tsx`: `maximumScale: 1, userScalable: false` — prevents iOS Safari pinch-zoom

**iOS Safari scroll lock pattern (`271a75f`):**
- `document.body.style.overflow = 'hidden'` does not work on iOS — page still scrolls behind fixed overlays
- Correct pattern: on open, save `scrollY`, then `body.style.top = \`-${scrollY}px\`; body.style.position = 'fixed'; body.style.width = '100%'`
- On close (Save, Cancel, or any exit path): clear all three properties, then `window.scrollTo({ top: savedScrollY, behavior: 'instant' })`

**Bottom sheet redesigned as floating card (`5bcf18a`):**
- Changed from full-width bottom-anchored overlay to floating card: `bottom: 16, left: 12, right: 12`; `borderRadius: 12`; `border: '1px solid #2a2e3d'`; `boxShadow: '0 -4px 24px rgba(0,0,0,0.4)'`; accent top border removed

---

### June 8, 2026 — Studio Time table bugfix series (post-unification)

**Commits: `8ad111c` through `752be11`**

Bug fixes and refinements after the per-row rate type / unified Studio Time table architecture landed in the previous session.

**Table structure finalized (`7f22409`, `5a63b36`):**
- Admin WO popup: 12-column layout — Studio | Date | Session Info | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total. Session Info column (click-to-edit 280px fixed popover) was dropped in the initial unification and is now restored.
- Runner WO page: 11-column layout — Date | Notes | From | To | Hrs | Type | Rate | OT Hrs | OT Rate | OT Chg | Total. Studio column removed (redundant on mobile); Notes pill column added between Date and From to open the session notes bottom sheet.
- OT auto-calc: day-rate rows auto-compute OT hours from `max(0, total_hours - 12)` + OT charge; hourly rows expose an editable OT Hrs input with OT Rate display and derived OT charge.
- OT Rate auto-seeded from `rate_daily × 0.10` (day-rate) or `rate` value (hourly) when not overridden.
- New row auto-populate: adding a row copies From, To, Rate Type, Rate, OT Rate from the previous row (date left blank).
- `initWO` cleanup now preserves rows with a blank date — fixes manually-added rows being deleted on WO reopen.

**Date cell redesigned (`8ad111c`, `9399a51`, `aa45230`):**
- Transparent `<input type="date">` overlay sits over the `shortDate()` display text in the Date cell. Clicking opens the native OS date picker directly.
- Date auto-saves and rows re-sort by date on pick — no separate Save step needed.
- Rows auto-sort by date when the date input loses focus.

**Studio time rows not creating — insert/upsert root cause fixes (`e4008ad`, `2db8e5d`, `91a21c8`):**
- All insert sites used `upsert(onConflict: 'work_order_id,date')` which requires a `UNIQUE(work_order_id, date)` DB constraint that was never added. Without it, every insert returned 400 and no rows were ever created. Fix: changed to plain `insert()` at all five sites in `WorkOrderPopup.tsx` and `calendar/page.tsx`. Pre-checks already filter existing dates before inserting, so plain insert is safe.
- Runner WO seed insert had `booking_id` in the payload — `booking_id` is not a column on `studio_time_rows`. Removed.
- `ot_rate` is a numeric DB column but received raw rate strings like `"$145"`. Added `/[^0-9.]/` strip at all `ot_rate` write sites. Also removed `ot_hours`/`ot_charge` from day-rate INSERT payloads (columns don't exist in the DB schema).

**Studio time rows not appearing on admin popup after the fix:**
- Root cause: `wo?.id` in the live date-range sync `useEffect` dep array caused the effect to fire on initial WO load, racing with `initWO`'s row seeding. The effect inserted rows first; `initWO`'s subsequent fetch returned the just-inserted rows but `setStRows([])` wiped them when the upsert's `data` was empty. Fix: removed `wo?.id` from the effect's deps — it now only fires on actual date changes.

**Runner WO column width fixes (`0dd79e3`, `45fbc44`, `752be11`):**
- FROM/TO columns widened on mobile so "8:00 AM" doesn't truncate.
- TYPE/RATE cell separator and table `overflow-x` behavior corrected for narrow screens.

---

### June 8, 2026 — Confirmed sessions filter, WO status cycling, Daily Ops improvements

**Commits: `94481d9` through `ba99025`**

**Confirmed sessions filter (`94481d9`):**
Daily Ops card (LocationStrip) and runner hub reverted to `status = 'confirmed'` only. The prior `.not('status', 'eq', 'cancelled')` change (which showed all non-cancelled statuses) was rolled back — tentative, hold, and other statuses shouldn't appear in daily runner ops.

**WO status cycling per `studio_time_row` (`6f1c818`):**

New `status` column: `text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'approved'))`. Migration run directly in Supabase SQL editor before this commit.

Three-state lifecycle:
- `in_progress` — default on row creation; no dot in the Studio Time Date cell
- `submitted` — runner taps Finish → today's rows updated to `submitted`; orange dot (`#fb923c`, 6px) appears in Date cell top-right
- `approved` — admin clicks Approve → today's rows updated to `approved`; lime dot (`#c8f04e`) appears in Date cell top-right

All new row insert sites (date-range reconciliation, auto-seed, date picker save, addStRow) include `status: 'in_progress'` in the payload. `normalizeStRow` falls back to `'in_progress'` when the DB value is null. Dot renders based on `r.status` for every row regardless of date — past-day rows with submitted or approved status show the appropriate dot.

Dashboard badge: `pendingCount` on LocationStrip studio cards is now driven by stRow status. `loadSummaries()` adds a fifth parallel query for today's stRows with `status = 'submitted'`, maps them to WO IDs, and counts per studio. A third RT channel on LocationStrip (`daily-ops-strows`, UPDATE on `studio_time_rows`) keeps the badge live.

Approved sessions drop from the Today column: after loading today's WOs, `fetchDrawerData()` queries stRow statuses; bookings where all today's stRows are `approved` are excluded from `activeTodayBkgs` without a page refresh.

**Fix series (`81151a2` → `ba99025`):**
- `81151a2`: TypeScript build error — `getLocalToday` called but not defined in runner WO `handleFinish`. Fixed with an inline IIFE.
- `3650e74`: Three post-cycling fixes — (1) Yesterday section removed from runner hub (today's sessions only); (2) badge queries today's stRows only (not yesterday's); (3) approved sessions drop from drawer via stRow status cross-reference.
- `f89c035`: Multi-day session support — `loadSummaries()`, `fetchDrawerData()`, and runner hub `load()` all changed from `.eq('start_date', today)` to `.lte('start_date', today).gte('end_date', today)`. Admin Approve button `disabled` prop scoped to `approving` in-flight state only.
- `3f04978` / `ba99025`: Scope correction. An over-broad fix had made `handleApprove()` and `handleFinish()` target ALL rows in the WO (future-date rows would be prematurely submitted/approved). Corrected: `handleFinish()` submits rows where `date === getLocalToday()`; `handleApprove()` approves rows where `date === today && status !== 'approved'`. Dot rendering was already correct (no date restriction) and unchanged.

---

### June 8–10, 2026 — WO Hub, Studio Time local-first, eng visibility, WO toggle

**Commits: `071d2c5` through `f73ca01`**

**WO Hub (`071d2c5`–`8ff4e5d`):**
- New route `/wo-hub` (`app/(main)/wo-hub/`) — standalone page listing all work orders, filterable by studio, date, status. Separate from the calendar/booking view.
- Added to nav between Admin and SOP.

**WO status simplification — open/completed only (`1996053`, `acf3809`):**
- `work_orders.status` simplified to two values: `open` (default) and `completed`. The multi-value runner submit/approve model at the WO level was removed.
- "Complete WO" button in WorkOrderPopup footer toggles between `open` and `completed` — WO stays fully editable in either state.
- `runner_finished` / `runner_finished_at` columns and the runner Finish confirmation dialog removed. The stRow-level status cycle (`in_progress → submitted → approved`) is now the sole granular mechanism.

**Studio Time local-first refactor (`d909dc1`, `e9fafa1`, `3c95f2e`):**
- All Studio Time edits (time inputs, rate, type, date, add/delete row, eng clear) now held in React state and written to DB in a single batch on Close & Save.
- Eliminated all per-blur DB writes to `studio_time_rows` — previously caused 409 conflicts and real-time subscription races.
- Cancel fully reverts: deletes new rows from DB, restores deleted rows, resets all edits to what was in the DB at open time. WorkOrderPopup real-time subscription on `studio_time_rows` removed (local state is authoritative while the popup is open).
- `pendingDeletes`, `pendingInserts`, and `dirtyRows` tracked in refs so Cancel/Save knows exactly what to undo or commit.

**Eng sub-row visibility system — `studio_time_rows.eng_visible` (`1d1d178`–`4d6dda2`):**
- New column `eng_visible boolean DEFAULT false` on `studio_time_rows`. Controls whether the eng sub-row shows for each row.
- Set to `true` when admin opens/activates the eng sub-row; set to `false` when admin clears eng hours and rate (both blank). Persisted to DB, so eng rows are stable on WO reopen.
- `admin_locked boolean DEFAULT false` column added simultaneously — admin can lock individual rows; runner sees locked rows as read-only; lock state persisted per row.
- Replaced `autoEngRows` / `clearedEngRows` React state approach which reset on every WO reopen.

**WO complete toggles `open`/`completed` + 9am Today retention rule (`f73ca01`):**
- "Complete WO" footer button now toggles: if `status === 'open'` → set `completed`; if `status === 'completed'` → set `open`. Button label reflects current state.
- Today panel (LocationStrip drawer) retains all sessions until 9am the following operational day regardless of WO complete status. Previously, completed WOs disappeared immediately.

---

### June 10, 2026 — TimeInput rewrite, daily ops card polish, runner WO bottom sections

**Commits: `cb39bb0`, `37b3891`, `56ebd91`, `bf32eb7`, `f4dfd6d`, `fceb6cb`**

**TimeInput rewrite — smart-parse text input (`cb39bb0`, `37b3891`, `56ebd91`):**
- `components/shared/TimeInput.tsx` rewritten from a 30-min `<select>` (48 options) back to a smart-parse text `<input>`.
- Accepts: `10a`→`10:00 AM`, `930p`→`9:30 PM`, `1430`→`2:30 PM` (24h auto-converted), bare `8`→`8:00 AM`. Enter key commits. Click/focus selects all text.
- Reason: the select was harder to use on mobile — users had to scroll through 48 options instead of typing.
- `parseTime()` handles: already-normalized `H:MM AM/PM`, AM/PM suffix strings, pure numeric 3–4 digit (24h), colon format without AM/PM. AM/PM normalized to uppercase.

**Daily ops card UI polish (`bf32eb7`, `f4dfd6d`):**
- LocationStrip drawer session cards: layout tightened; status indicators refined; approved session visual treatment added.
- DailyOpsModal: item status display cleaned up; NA thumbnail sizing corrected.

**Runner WO bottom sections + Session QC nav removal (`fceb6cb`):**
- Runner WO page (`app/runner/[studio]/wo/[id]/page.tsx`) bottom sections rebuilt:
  - Session notes: floating card (`position: fixed, bottom: 16, left: 12, right: 12, borderRadius: 12`) — previously inline textarea.
  - Equipment condition: horizontal scroll with sticky first column.
  - Expenses section: inline add/remove with receipt upload.
  - Footer: Cancel | Save | Finish (Finish triggers stRow status submit for today's rows).
- Session QC (`/qc`) removed from nav — never fully built.

---

### June 10, 2026 — Canvas signature pad, payment improvements

**Commits: `fdca542`, `7960be4`, `9a8c341`, `a55a6e8`**

**Canvas signature pad on runner WO (`fdca542`):**
- Legal / signature section added to runner WO page — COD sessions only (`isCOD` guard based on `booking.payment_type` or `wo.payment_status`).
- HTML5 `<canvas>` (700×200 logical px, `width: 100%, height: 100px` display) with mouse + touch drawing. `touchAction: 'none'` on the canvas prevents scroll during signing (no passive listener warnings).
- `getCanvasPos()` normalizes `MouseEvent` + `TouchEvent` using `'touches' in e` check; `changedTouches` fallback for `touchend`.
- On `endDraw`: `canvas.toDataURL('image/png')` stored in `signatureData` state. Existing signature reloaded via `Image.onload → ctx.drawImage` using `initialSigRef` pattern (set synchronously before state updates; read in `useEffect([loading])`).
- Print Name text input, read-only date display (today's date, not saved to DB), Clear button.
- Saves to: `work_orders.print_name` (text) and `work_orders.signature_data` (base64 PNG).

**Payment type dropdown + memo + last four (`7960be4`):**
- Payment type changed from free-text input to dropdown: Cash, Zelle, Credit Card, Debit Card, Check, Other.
- `memo` text field added per payment row.
- `last_four` text field (4-digit, numeric-only, `maxLength: 4`) added — only visible when type is Credit Card or Debit Card.
- Runner WO payment section is now fully editable (was previously read-only).
- `× remove` button on each payment row.
- New payment rows: `+ Add payment` button adds `{ id: crypto.randomUUID(), payment_type: '', amount: '', memo: '', last_four: '' }`.
- Schema: `ALTER TABLE payment_rows ADD COLUMN memo text; ALTER TABLE payment_rows ADD COLUMN last_four text;` run in Supabase.

**Admin WO signature alignment (`9a8c341`):**
- Admin WorkOrderPopup updated to match runner signature implementation.
- WO type had `legal_signature`, `legal_name`, `legal_date` — replaced with `print_name: string` and `signature_data: string`.
- `normalizeWO` maps `d.print_name ?? ''` and `d.signature_data ?? ''`.
- Save payload: removed `legal_signature/legal_name/legal_date`, added `print_name: wo.print_name || null, signature_data: wo.signature_data || null`.
- Canvas drawing functions: `getAdminCanvasPos`, `startAdminDraw`, `continueAdminDraw`, `endAdminDraw`, `clearAdminSignature` (same pattern as runner).
- COD detection: `wo.payment_status === 'COD'` guards the legal section in admin popup.
- `adminInitialSigRef` set in both `initWO` paths (seededExisting + seededNew) for correct canvas reload.

**Payment amount currency auto-format (`a55a6e8`):**
- `formatCurrency(val)`: on blur, formats numeric input to `$1,234.56` using `toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
- `stripCurrency(val)`: strips `$` and `,` before writing to DB; returns `null` for empty/non-numeric.
- `totalPaid` computed as `payRows.reduce((s, p) => s + (stripCurrency(p.amount) ?? 0), 0)`.
- Applied to both admin WorkOrderPopup and runner WO page.

---

*Last updated: June 15, 2026 — Daily ops Today/Yesterday view fixes, petty cash running ledger, Daily Ops Log rebuilt as date-based historical view per studio (commits 315aa98 through e4ed5c5).*

---

### June 14, 2026 — Mic Inventory UI, dashboard_tasks migration, CRM fixes

**Mic Inventory UI (confirmed complete):**
- `/runner/[studio]/mics` page was built but not yet reflected in the docs. Features: collapsible sections per mic category, Here/Room/Missing condition tracking, qty steppers, submit flow.
- `liveDoc: false` fix: `stock_list` and `mic_inventory` now appear correctly in Yesterday checklists.

**dashboard_tasks migration (run in Supabase SQL editor):**

```sql
CREATE TABLE IF NOT EXISTS dashboard_tasks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  text           text        NOT NULL,
  assigned_role  text        NOT NULL CHECK (assigned_role IN ('admin', 'studio_manager', 'asst_manager', 'billing')),
  completed      boolean     NOT NULL DEFAULT false,
  completed_at   timestamptz,
  completed_note text,
  created_by     uuid        REFERENCES auth.users(id),
  source         text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'runner_flag', 'wo_flag')),
  source_id      uuid,
  source_label   text,
  due_date       date,
  sort_order     integer     NOT NULL DEFAULT 0,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_tasks TO authenticated;
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dashboard_tasks_set_updated_at
  BEFORE UPDATE ON dashboard_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE dashboard_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dashboard_tasks: authenticated read" ON dashboard_tasks FOR SELECT TO authenticated USING (deleted_at IS NULL);
CREATE POLICY "dashboard_tasks: authenticated insert" ON dashboard_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "dashboard_tasks: authenticated update" ON dashboard_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "dashboard_tasks: authenticated delete" ON dashboard_tasks FOR DELETE TO authenticated USING (true);
```

RLS INSERT/UPDATE/DELETE use placeholder `USING (true)` — will be tightened to `auth.jwt() ->> 'app_role'` claims when Chunk 9 auth lands.

**CRM fixes:**
- Added `Long Term/Leasing` as a session type option to both booking type dropdowns in the lead card (`crm/page.tsx` lines 2399 + 2516). Not added to the emoji map.
- Fixed Keep Hot button not appearing in Needs Action tab: condition was checking `activeBucket.key === 'hot'` instead of `l.status === 'hot'` — bucket key is never 'hot' in the Needs Action view.

---

### June 14, 2026 — Dashboard UI rebuild

**Commits: `d148815`, `2e9388a`**

**`app/(main)/page.tsx` rewritten from scratch.** Removed `TodoModule`, `QCHomeWidget`, `clients` fetch, and `qc_reports` fetch entirely.

**New 3-column grid layout (`gridTemplateColumns: '1fr 2fr 1fr'`, `gap: 14`):**

**Col 1 — Needs Action:**
- Fetches all leads, filters to `needs_contact === true` excluding `dead`, `booked`, and `cold` statuses, shows top 5.
- Per-row: name, reason string (Follow up now / Follow up due / Never contacted / Needs attention), status badge in `var(--hot)` / `var(--warm)` / `var(--text3)`.
- Footer: "View all in CRM →" navigates to `/crm`.
- `cold` exclusion added in follow-up commit `2e9388a` — cold leads were incorrectly appearing in the panel.

**Col 2 — Today's Sessions:**
- Fetches today's bookings via local-time date correction (`getTimezoneOffset()`) + `lte('start_date', today).gte('end_date', today)`.
- Confirmed section: `#14B8A6` label + `2px solid #14B8A6` left border + `rgba(20,184,166,0.05)` tint per row.
- Tentative section: `#F97316` label + matching border/tint.
- Each row: `b.artist || b.client_name`, `b.session_type` badge, `b.from_time – b.to_time · b.location`.
- Sections only render when they have items.

**Col 3 — Tasks (placeholder at time of rebuild; wired to live data in Session 3a — see below):**
- Me / Mgr / Billing / Asst tab row; active tab `#c8f04e` bg / `#0d0f14` text.
- Body: "Tasks coming in next build" (placeholder only — replaced in Session 3a).
- Footer: dashed `+ Add task` button (non-functional placeholder — replaced in Session 3a).
- Wired to `activeTaskTab` state; tab switching was live from this commit.

---

### June 14, 2026 — Session 3a: Dashboard Tasks Panel

**Commit: `350d7fa`**

**Schema additions applied in Supabase SQL editor:**

`dashboard_tasks.photo_url`:
```sql
ALTER TABLE dashboard_tasks ADD COLUMN IF NOT EXISTS photo_url text;
```

`dashboard_task_comments` (new table):
```sql
CREATE TABLE IF NOT EXISTS dashboard_task_comments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid        NOT NULL REFERENCES dashboard_tasks(id) ON DELETE CASCADE,
  text            text,
  photo_url       text,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON dashboard_task_comments TO anon;
GRANT SELECT, INSERT ON dashboard_task_comments TO authenticated;
ALTER TABLE dashboard_task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_comments: anon read" ON dashboard_task_comments FOR SELECT TO anon USING (true);
CREATE POLICY "task_comments: anon insert" ON dashboard_task_comments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "task_comments: authenticated read" ON dashboard_task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments: authenticated insert" ON dashboard_task_comments FOR INSERT TO authenticated WITH CHECK (true);
```

Anon access also added to `dashboard_tasks` (was `authenticated`-only, but app uses anon key pre-auth):
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_tasks TO anon;
CREATE POLICY "dashboard_tasks: anon read" ON dashboard_tasks FOR SELECT TO anon USING (deleted_at IS NULL);
```

**Tab → role mapping (hardcoded pre-auth, permanent mapping):**
- Me → `admin`, Mgr → `studio_manager`, Asst → `asst_manager`, Billing → `billing`
- Defined as `TAB_ROLE` constant above the component in `app/(main)/page.tsx`.

**Tasks panel — Col 3 of dashboard grid (live):**
- `fetchTasks(role)` defined outside component; called by `useEffect([activeTaskTab])` and by `reloadTasks()` after mutations.
- Task list: `completed = false`, `deleted_at IS NULL`, ordered `sort_order asc` then `created_at asc`.
- Rows: truncated task text, optional due date + source label below. Entire row opens modal on click. `×` button calls `handleDeleteTask` (optimistic removal + `UPDATE deleted_at = now()`). `e.stopPropagation()` prevents modal open on `×` click.
- Empty state: "No tasks". Loading state: "Loading…".

**Add task inline form:**
- `+ Add task` dashed button expands to: text input (autoFocus, Enter submits) + `+ Photo` label wrapping hidden file input + Cancel + Save buttons.
- Save: uploads photo to `checklist-photos` bucket at `dashboard-tasks/{timestamp}-{filename}` → inserts row (`text`, `assigned_role`, `source: 'manual'`, `photo_url`) → `reloadTasks()` → collapses form.
- Cancel: collapses form, clears inputs.

**Task modal (ticket-style):**
- Overlay: `position: fixed, inset: 0, rgba(0,0,0,0.6), zIndex: 10000`. Click outside card dismisses.
- Card: `background: var(--surface), borderRadius: 12, maxWidth: 480, maxHeight: 85vh, flex column`.
- **Header**: task title (Syne 800, 15px), task `photo_url` image if present (`maxHeight: 200`, `borderRadius: 8`, `objectFit: cover`), source label (muted, DM Mono) if `source !== 'manual'`, due date (muted, DM Mono) if present. `×` close button top-right.
- **Comment thread** (`flex: 1, overflowY: auto`): fetched from `dashboard_task_comments` on `handleOpenTask`. Per-comment: text, photo (`maxHeight: 200`), `created_by_name · fmtTime(created_at)`. Empty: "No updates yet".
- **Input area**: `<textarea rows={2}` placeholder "Add a note…", `+ Attach photo` label/input (shows filename when selected). Two buttons: Comment (outline) + Complete (accent `#c8f04e`).
- **Comment action**: uploads photo if selected → `INSERT dashboard_task_comments` → clears inputs → `loadComments()`.
- **Complete action**: uploads photo → inserts comment if text/photo present → `UPDATE dashboard_tasks SET completed=true, completed_at=now()` → removes task from local list (optimistic) → closes modal.
- `taskSubmitting` flag gates both buttons during async operations; Complete button shows "Saving…" while in flight.

**`created_by_name` pattern:**
- `supabase.auth.getUser()` called on mount in a `useEffect([], [])`. Sets `currentUserEmail` state if `data.user.email` is present. Falls back to `'Staff'` (initial state) until Chunk 9 auth lands.

**`lib/supabase.ts` additions:**
- `DashboardTask.photo_url: string | null` added to interface.
- New `DashboardTaskComment` interface: `{ id, task_id, text, photo_url, created_by_name, created_at }`.

**`fmtTime(iso)` helper:** Formats `created_at` timestamps as `"Jun 14 · 02:30 PM"` using `toLocaleDateString` + `toLocaleTimeString`. Defined at module level (outside component).

---

### June 14, 2026 — Yesterday Checklist Rows + Site Color Pass

**Commits: `dcbee2a`, `5837182`, `9eeae65`**

**Yesterday checklist rows in LocationStrip drawer (`dcbee2a`, `5837182`):**
- Yesterday ops rows now always render in the drawer even when no submission exists for a category (previously rows were missing if the runner hadn't started them).
- Rows with no submission show grey state (no checkmark, no progress).
- Rows with a submission show color-coded state: green = approved, orange = submitted (awaiting admin), grey = in-progress.
- Approve button on each Yesterday ops row triggers `admin_approved_at` update on `daily_ops_submissions` and refetches; approved rows disappear from the Yesterday column immediately.
- 8am reset rule: Yesterday section only shows for the operational-day window (before 8am, "Yesterday" shows the prior day; after 8am, it clears). Driven by `getLocalDateStr(-1)`.
- All ops submission rows are fetched and shown, not just those with `needs_attention`.

**Site-wide color system pass (`9eeae65`):**
- CSS variable color audit across all pages. Ensured consistent use of `var(--hot)`, `var(--warm)`, `var(--booked)`, `var(--accent)`, `var(--text3)` etc. rather than hardcoded hex values in non-runner pages.

---

### June 14, 2026 — Dashboard Tasks Panel Polish

**Commits: `5119412`, `695eef3`, `111fd0a`, `2415332`, `1831a68`, `fc7a72d`**

**Tasks panel restyled — card-row layout (`695eef3`):**
- Task list rows changed from plain text to styled cards — each row has a subtle border, task text, optional `source_label` + `due_date` pills below.
- Count badge: task tab header shows active (incomplete, non-deleted) task count as a pill.
- History link: `"X completed →"` at the bottom of the panel navigates to the history modal.
- Runner flag accent: tasks with `source = 'runner_flag'` or `source = 'wo_flag'` display a colored left-border accent to visually distinguish auto-generated tasks from manual ones.

**Completed tasks history modal (`111fd0a`, `fc7a72d`):**
- Clicking the history link opens a full-screen modal showing all completed tasks for the current role tab.
- Search bar: case-insensitive live filter by task text, source label, or completed date.
- History rows are clickable and open the task modal in a read-only view (no comment input, no Complete button — view only since the task is already done).

**Dot color fixes (`2415332`, `1831a68`):**
- Task list: open (incomplete) tasks show an orange dot `#fb923c`.
- History modal: completed tasks show a teal dot `#14B8A6`.
- Consistent with the status dot convention used elsewhere (orange = pending, teal/green = done).

---

### June 14–15, 2026 — Runner Quick Action Card Submitted State

**Commits: `5fe5735`, `e81769c`, `69cbe66`, `c9c131b`**

**Green border on submitted quick action cards (`5fe5735`):**
- Quick action tiles on the runner studio hub (`/runner/[studio]`) now show a green `#4ef0a2` left border when that category has been submitted today.
- Visual cue lets runners quickly see which daily ops tasks are done without opening each one.

**Submitted state query fixes (`e81769c`, `69cbe66`):**
- Initial implementation queried only `daily_ops_submissions` for submitted state. But checklists only write to `daily_ops_submissions` on full Submit; in-progress saves don't write there. Fix: quick action cards now query BOTH `checklists` (for opening/closing checklist types — checks `completed_at IS NOT NULL`) AND `daily_ops_submissions` (for all categories — checks `submitted_at IS NOT NULL`). Both sources are merged to determine the green-border state.

**Auto-navigate after save/submit + stock daily_ops_submissions (`c9c131b`):**
- All runner pages (checklist, mics, stock, petty-cash) now navigate to the studio hub immediately on both Save and Submit.
- Stock page (`/runner/[studio]/stock`) was not writing to `daily_ops_submissions` on save. Added the same upsert pattern as petty-cash — writes `category: 'stock'`, `submitted_at` on save.

---

### June 15, 2026 — Runner Save + Submit Pattern + Daily Ops Fixes

**Commits: `c3c4d48`, `92579b6`, `80aad84`, `e81a015`, `64d375c`, `79f0632`**

**Save + Submit pattern on checklists and mics (`c3c4d48`):**
- Both `/runner/[studio]/checklist/[type]` and `/runner/[studio]/mics` pages gained a Save button alongside the existing Submit button.
- **Save** persists progress to the `checklists` table (or `mic_checkins` + `mic_inventory_quantities` for mics) without writing `submitted_at` to `daily_ops_submissions`. Navigation returns to studio hub.
- **Submit** writes `submitted_at` to `daily_ops_submissions`, marking the category done for the admin view, then navigates to hub.
- Mics page now fetches and restores prior checkin status and quantity from DB on load — runners can leave and return without losing progress.

**Initials required hint on submit (`92579b6`):**
- Both checklist and mic pages show `"Required to submit"` in red (`#ef4444`, 9px) immediately below the initials input when Submit is tapped with an empty initials field.
- Hint clears when the user starts typing. Submit button color is disabled-state grey until initials are present.
- Uses `showInitialsHint` state; `position: absolute; top: 100%` anchors it below the input without shifting layout.

**Admin Runner checkmark regression fix — local date (`80aad84`):**
- Root cause: checklist `handleSubmit` was using `new Date().toISOString().slice(0, 10)` (UTC date) to write the `date` field to `daily_ops_submissions`. LocationStrip queries using `getLocalDateStr()` (local timezone). After 5 PM PDT these diverge — the runner submits for "tomorrow's" UTC date, LocationStrip looks for today's local date, and the submission is never found.
- Fix: replaced with the local timezone IIFE: `(() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()`.
- Same fix applied earlier to stock and petty-cash pages.

**Stock list OPS_CATS key mismatch + save mutation bug (`e81a015`):**
- **Key mismatch**: LocationStrip `OPS_CATS` array had `key: 'stock_list'` but the stock runner page writes `category: 'stock'` to `daily_ops_submissions`. Fixed key to `'stock'`.
- **Save mutation bug**: The `save()` function in `stock/page.tsx` was looping over `items` with a `for...of` loop and doing `it.id = data.id` after insert — mutating React state objects directly without calling `setItems`. On a second save, the already-inserted items still showed `id: undefined`, causing duplicate DB inserts. Fixed with an immutable pattern: `const updated = items.map(it => ({ ...it }))` + index-based ID assignment + `setItems(updated)` after the loop.

**Local date fix and ID mutation fix for stock and petty-cash (`64d375c`):**
- Both `stock/page.tsx` and `petty-cash/page.tsx` had the same UTC-vs-local date bug (using `toISOString().slice(0,10)` instead of local IIFE). Fixed both.
- `petty-cash/page.tsx` had the same `for...of` + direct mutation bug in its entries save loop. Fixed with the same immutable pattern.

**Remove non-existent columns from daily_ops_submissions upsert (`79f0632`):**
- The checklist `handleSubmit` was sending `attention_notes`, `needs_attention`, and `photo_urls` in the `daily_ops_submissions` upsert. These columns don't exist in that table — they live on `checklists` rows. The upsert was silently returning a 400 Bad Request from Supabase, meaning the submission was never recorded.
- Fix: removed the three non-existent columns. Now only sends `studio, date, category, staff_name, submitted_at, notes` (all valid columns).
- Root cause: the table schema was drafted with those columns in the initial briefing but they were never created in the actual DB migration.

---

### June 15, 2026 — Daily ops view fixes, petty cash ledger, Daily Ops Log rebuild

**Commits: `315aa98`, `7ee137c`, `02724ce`, `03a9f28`, `49253ca`, `e4ed5c5`**

**Approved checklist items no longer disappear from Today view (`315aa98`):**
- Checklist rows with `admin_approved_at` set were being filtered out of the Today column in the LocationStrip drawer immediately on approval. The approved-state filter was incorrectly hiding approved ops rows from the current-day view alongside the Yesterday view.
- Fix: Today ops rows now show all submissions regardless of approval state. Only the Yesterday column drops approved items.

**Completed WOs no longer disappear from Yesterday view (`7ee137c`):**
- Work orders with `status = 'completed'` were being dropped from the Yesterday session list in the LocationStrip drawer. The `pastRetentionWindow` guard that hides completed WOs from Today after 9am was incorrectly applying to Yesterday as well.
- Fix: `pastRetentionWindow` guard applied only to the Today column's `activeTodayBkgs` filter. Yesterday always shows all sessions regardless of WO status.

**Petty cash converted to running ledger (`02724ce`, `03a9f28`, `49253ca`):**
- `/runner/[studio]/petty-cash` page rebuilt from scratch:
  - **Running ledger** — page loads ALL prior petty cash entries for the studio (not just today's), sorted chronologically. Each entry shows description, amount, In/Out indicator, and timestamp.
  - **Most-recent balance** — opening balance fetched as the most recent `petty_cash_balances` row for the studio (was previously date-keyed to today only, so historical balance never appeared when returning on a new day).
  - **In/Out tap-to-toggle** — type selector changed from a `<select>` dropdown to a tap-toggle button cycling between In and Out. Cleaner on mobile.
  - **Save error surfacing** — Supabase insert errors now surface inline rather than failing silently.
  - **Admin view unblocked** — admin balance/entries view was previously gated behind `submitted_at` being set on the day's submission. Gate removed; admin view always shows current data regardless of runner submission state.

**Daily Ops Log rebuilt as date-based historical view (`e4ed5c5`):**
- `components/admin/DailyOpsLogSection.tsx` completely rewritten. The old flat mixed table (WOs + submissions, search/filter row) is replaced by a date-based historical log per studio.
- **Studio tabs** — Paramount | Encore | Ameraycan | Track. Switching resets the date list and refetches.
- **Date list** — all dates with any confirmed booking, checklist, or ops submission activity for the selected studio, sorted most-recent first. Status dot per date: teal = all 5 OPS_CATS admin-approved, amber = at least one runner-submitted awaiting approval, grey = no ops activity.
- **Load More** — dates paginate 25 at a time with a "Load More (N remaining)" button.
- **Day modal** — clicking a date opens a modal styled identically to the LocationStrip daily ops drawer: session/WO cards on top (completed teal border, needs-attention orange border, open grey), 5 checklist rows below with Runner/Admin checkboxes, staff name and submitted time per row. WO card click opens `WorkOrderPopup`.
- Old search bar and studio/type/date filter controls removed entirely. Status dot on each date row replaces the old per-row approved indicator.

---

### June 16, 2026 — Flags system + Dashboard room grid

**Key commits:** `a4465f9`, `10c1f6a`, `27a1818`, `9a7f3b5`, `7770d08`, `5888b16`, `981cac3`, `49874c5`, `488c3f5`, `60d613a`

---

#### Flags system

A structured issues log surfacing studio problems flagged by runners, WO submissions, or managers. Replaces the tentative Session 3b runner-flag-auto-generation concept — flags feed a dedicated panel and Admin log rather than `dashboard_tasks`.

**New database tables:**

`flags`:
- `id` (uuid), `studio` (text), `source` (`manual` / `runner_flag` / `wo_flag`), `runner_note` (text), `category` (`facility_general` / `gear_equipment` / `client_billing`), `status` (`pending` / `acknowledged` / `resolved`), `deleted_at` (timestamptz, soft delete), `created_at` (timestamptz)
- RLS: GRANT SELECT/INSERT/UPDATE/DELETE to `anon` + `authenticated` (app uses anon key pre-auth)

`flag_comments`:
- `id` (uuid), `flag_id` FK → `flags` (CASCADE), `text` (text), `photo_url` (text), `created_by_name` (text), `created_at` (timestamptz)
- Append-only — no UPDATE/DELETE policies. Anon + authenticated SELECT + INSERT.

`Flag` + `FlagComment` types added to `lib/supabase.ts`.

**Dashboard flags panel (`app/(main)/page.tsx`):**
- Fetches flags with `status IN ('pending','acknowledged')` and `deleted_at IS NULL`, ordered newest-first, limited to 4 cards.
- Card layout: studio pill, category badge (facility_general = grey, gear_equipment = amber, client_billing = hot/red), runner note snippet, created time.
- "View all flags →" link (lime `#c8f04e`) navigates to Admin flags log tab.
- Manual flag creation form below cards: studio picker (defaults to `paramount`), category dropdown (required), freetext note, outlined Submit button.
- `handleCreateFlag` and initial fetch both limited to 4.

**Flag modal:**
- Opens on card click. Shows full runner note, runner photo (when `source = 'runner_flag'` and a photo was attached), and a `flag_comments` thread.
- New comments via textarea + Send button; Enter key also submits. Photo attach supported. Thread appends optimistically.
- **Acknowledge**: sets `status = 'acknowledged'`. Acknowledged flags show a category reassignment dropdown in the modal so category can be corrected after review.
- **Resolve sub-modal**: inline modal with Resolution Note (textarea), Vendor (text input), Cost (text input). On confirm: sets `status = 'resolved'` and appends a `flag_comments` entry with the resolution details. Resolved flags disappear from the dashboard panel.
- **Delete**: soft-delete button with inline confirmation dialog; writes `deleted_at = now()` to DB. Available on flag cards (× button) and inside the modal. Debugging note: initial implementation failed silently because `error` was not captured from the Supabase response — fixed by destructuring `const { error } = await supabase...` and adding `console.log('handleDeleteFlag:', { id, error })`.
- Enter/Send shortcut in the comment textarea (Shift+Enter for newline).

**Flags log in Admin (`components/admin/FlagsLogSection.tsx`):**
- Tab in the Admin sidebar alongside Ops Log.
- Shows all non-deleted flags, searchable by runner note / studio / category. Soft-delete button on each log row.

**Runner/WO auto-flag generation:**
- Checklist submissions with `needs_attention = true` auto-insert a `flags` row with `source = 'runner_flag'`, the attention notes as `runner_note`, and the runner's submitted photo URL.
- WO-level Needs Attention submissions auto-insert with `source = 'wo_flag'`.
- Auto-generated flags appear alongside manually created ones in the dashboard panel and Admin log.

---

#### Dashboard room grid

**Col 2 (Today's Sessions) replaced with a fixed 11-room grid showing every studio room.**

**`ROOMS` constant (module-level in `app/(main)/page.tsx`):**
```ts
const ROOMS = [
  { venue: 'Paramount', studio: 'Studio A', label: 'Paramount A' },
  { venue: 'Paramount', studio: 'Studio B', label: 'Paramount B' },
  { venue: 'Paramount', studio: 'Studio C', label: 'Paramount C' },
  { venue: 'Paramount', studio: 'Studio E', label: 'Paramount E' },
  { venue: 'Paramount', studio: 'Studio X', label: 'Paramount X' },
  { venue: 'Ameraycan', studio: 'Studio A', label: 'Ameraycan A' },
  { venue: 'Ameraycan', studio: 'Studio B', label: 'Ameraycan B' },
  { venue: 'Encore', studio: 'Studio A', label: 'Encore A' },
  { venue: 'Encore', studio: 'Studio B', label: 'Encore B' },
  { venue: 'Track', studio: 'North', label: 'Track North' },
  { venue: 'Track', studio: 'South', label: 'Track South' },
]
```

**`calDate` state + day navigation:**
- `const [calDate, setCalDate] = useState(new Date())` added to `DashboardPage`.
- Panel header shows `‹` / `›` arrow buttons alongside `calDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })`.
- Arrow handlers advance/retreat `calDate` by one day via `setDate(n.getDate() ± 1)`.
- `useEffect` dep array changed from `[]` to `[calDate]`; bookings fetch uses `new Date(calDate)`.

**Grid layout:**
- `gridTemplateColumns: '1fr 1fr 1fr'`, `gap: 4`, `padding: 8`.
- Panel fixed `height: 556px` (header ~48px + 4 rows × 120px cards + 3 × 4px gaps + 16px padding).

**Room matching:** `b.location === room.venue && b.studio === room.studio` — direct field comparison. `booking.location` stores the bare venue name (`'Paramount'`, `'Encore'`, etc.); `booking.studio` stores the room name (`'Studio A'`, `'North'`, etc.). The combined `'Venue · Studio'` string only appears in `leads.location`; `parseLocation()` is NOT used here.

**Booked room card:**
- Top border: `2px solid #14B8A6` (confirmed) or `2px solid #F97316` (tentative).
- Background: `#0d0f14` (booked); `rgba(0,0,0,0.2)` (empty).
- Primary name (DM Serif Display 13px, `var(--text)`): billing session → `artist || label || client_name`; COD → `client_name`.
- Label sub-line (DM Mono 9px, `rgba(255,255,255,0.45)`) shown only on billing sessions when label differs from primary name.
- Time string (DM Mono 9px, `rgba(255,255,255,0.75)`) formatted via `fmtSessionTime()`.
- Engineer `1ST-XX` + assistant `2ND-XX` initials stacked bottom-right; teal `#4ef0a2` if confirmed, amber `#f0a24e` if hold.

**Module-level helpers added:**
- `engInitials(name)` — mirrors calendar's `initials()`: first+last initials, or first 2 chars for a single-word name.
- `fmtSessionTime(t)` — compact time format matching calendar's `fmtTime()`: `10A`, `2:30P`.

---

### June 16–22, 2026 — Dashboard room-grid modal, booking-form artist search, UnifiedSessionForm (experimental), WO→Calendar sync

**Key commits:** `f19e740` (room-grid modal), `2d01302` `0445476` `c82fa27` `5270c43` (booking-form artist search + A&R autoselect), `4d36b27` (client_contacts update fix), `e12322e` `271411b` `6acae60` `4524cda` `2e67ec0` `f76949b` `412fcc9` (UnifiedSessionForm), `8d67d6b` `3248232` `763e749` `3361fdb` `ce3194d` (WO→Calendar sync)

This note covers everything committed after the June 16 docs commit (`7c51cbf`). Pure `debug:` commits (`3bdc9b6`, `268d824`, `311c0b7`) and the trivial `next-env.d.ts` chore (`e79a9ca`) are folded in below rather than listed.

---

#### Dashboard room grid → booking form modal (`f19e740`)

- The booked room cards in the dashboard's 11-room grid (Col 2) are now clickable and open the booking form modal directly from the dashboard (previously read-only).
- Nav `zIndex` reaffirmed at `99999` so it stays above the booking modal opened from the dashboard.

---

#### Booking form client search — artist matches + A&R autoselect (`2d01302`, `0445476`, `c82fa27`, `5270c43`)

- **Client search now returns three match kinds** in `BookingForm` (and `UnifiedSessionForm`): client/label name, A&R contact name, and **artist name**. Artist matches are produced by fetching all label clients and filtering those whose `clients.artists[]` includes the query (matched client-side, case-insensitive). Each artist suggestion carries `record._artistMatch` and shows the label as its sub-line.
- **Auto-select A&R on artist pick (`applyClientAutofill`):** when an artist match is chosen, the form queries `client_contacts` for that label where `contact_type !== 'admin'`, finds the contact whose `artists[]` contains the matched artist (case-insensitive `===`), and sets `client_name` / `ordered_by` / `anr_contact_id` / `email` / `phone` from that A&R. Payment type flips to `billing` for label picks.
- **contact_type filter convention (resolved after churn):** A&Rs = `contact_type !== 'admin'`; admins = `contact_type === 'admin'`. `c82fa27` briefly scoped the artist→A&R lookup to `contact_type = 'anr'`, which dropped legacy rows that have a null `contact_type`; `5270c43` reverted it to `!= 'admin'` so those rows are included.
- **Cleanup (June 22, 2026):** the debug `console.log('artist lookup', …)` inside the artist→A&R lookup was removed.
- **⚠ Superseded later the same day (June 22, 2026 — `d7c8e82`):** the artist-match query was reworked to run over `client_contacts` (each A&R's own `artists[]`, joined to the parent client) instead of the label record's `clients.artists[]`, and the auto-select re-query was changed from `.neq('contact_type','admin')` to `.or('contact_type.eq.anr,contact_type.is.null')` because `.neq` silently excludes null-type rows. See the "Booking form client search matches artist names *through A&R contacts*" Decisions Log entry and the June 22 (later) session note below.

---

#### `client_contacts` update payload fix (`4d36b27`)

- `ClientProfile.saveContact` now strips the primary key and foreign key from the update body: `const { id: _id, client_id: _cid, ...updateData } = data` before `supabase.from('client_contacts').update(updateData).eq('id', contactId)`. Sending `id`/`client_id` in the UPDATE was causing the contact save to fail.
- **Cleanup (June 22, 2026):** the debug `console.log` calls in `saveContact` were removed; the Supabase response is now checked for `error` and surfaced via `console.error` on failure (matches the project's error-surfacing convention).
- **⚠ Note (June 22, 2026 — `af957e8`):** this payload strip was *not* the cause of A&R artists failing to persist, despite earlier framing. The real cause was the Clients page refetch select omitting `artists`/`contact_type`, which reverted the UI and wiped the row on the next save. See the corrected "The `client_contacts` artist-persistence bug was the refetch SELECT" Decisions Log entry and the June 22 (later) session note below.

---

#### UnifiedSessionForm (USF) — parallel experimental build (`e12322e`, `271411b`, `6acae60`, `4524cda`, `2e67ec0`, `f76949b`, `412fcc9`)

A new single-surface "session form" that merges the booking/client card and the Work Order into one full-screen, natural-flow modal. **This is a parallel experiment — it does not replace the existing `BookingForm` + portaled `WorkOrderPopup` production flow. Both coexist.**

- **File:** `components/unified/UnifiedSessionForm.tsx` (~1,060 lines). Layout flows top-to-bottom: header → status chips → client card → work order. Reuses the booking-form client-search/autofill logic (including the artist-match + A&R autoselect above) and a `ClientProfilePopup` overlay.
- **Renders the real `WorkOrderPopup` inline.** A new `inline?: boolean` prop on `WorkOrderPopup` makes it render in normal document flow — no `position: fixed` overlay, no backdrop, and backdrop click-to-close is disabled (`onClick={inline ? undefined : …}`). USF passes `inline` and mounts it below the client card; `onSaved={onClose}`.
- **Owner-gated launch.** `Nav.tsx` reads `localStorage.getItem('userRole') === 'owner'` into `isOwner` (no auth yet — Chunk 9) and, when true, renders a temp "⚡ USF" button that opens `<UnifiedSessionForm bookingId={null} … />`. Not in the main nav item list.
- **History:** the first scaffold (`e12322e`, `271411b`, with a temp nav button) was reverted wholesale (`6acae60`), then rebuilt as "v2" (`4524cda`) wired to the real WorkOrderPopup, refactored from a `document.body` portal to inline rendering (`2e67ec0`, `f76949b`), and finalized with the `inline` prop (`412fcc9`).

---

#### WO → Calendar sync (`8d67d6b`, `3248232`, `763e749`, `3361fdb`, `ce3194d`)

Hardening the "What's Next: WO → Calendar sync" item so a WO edited after the booking form has unsaved changes round-trips correctly.

- **`8d67d6b` — WO Close & Save syncs schedule back to `bookings`.** In `WorkOrderPopup.handleClose`, after writing WO rows, an additive block writes `start_date`/`end_date` (earliest/latest dated `studio_time_row`) and `from_time`/`to_time` (earliest dated row) to the booking. *(This commit also wrote `studio` — removed two commits later; see below.)*
- **`3248232` + `763e749` — calendar refetches after WO save.** The calendar passes `onSaved={() => { loadRef.current(); setReloadKey(k => k + 1) }}`. `loadRef.current()` refetches the `bookings` array that drives the 2-week/week grid; `setReloadKey` bumps the `reloadKey` prop that `DayView` and `StudioView` depend on, so all three calendar views repaint with the synced data.
- **`3361fdb` — BUG: calendar block vanishes after WO save (studio format mismatch).** The sync from `8d67d6b` wrote `stRows[0].studio` into `bookings.studio`. `studio_time_rows.studio` stores a **bare letter** (`'A'`) via `toStudioLetter()`, but the calendar grid filters rooms on the **full label** (`bookings.filter(b => b.studio === 'Studio A')`). After a save the booking matched no room and its block disappeared — even though the grid state held the correct record. **Fix:** removed `studio` from the WO→booking sync; the `StudioSelect`-backed booking form is the authoritative writer of `bookings.studio`. Also deleted a stray `components/calendar/WorkOrderPopup 2.tsx` duplicate. *(Diagnosed via temporary `[CAL load]` / `[CAL renderGrid]` instrumentation, since removed — the data was correct in render but the room filter excluded it. Track's `'North'`/`'South'` were never affected.)*
- **`ce3194d` — booking form stops overwriting dates/times once a WO owns the schedule.** `calendar/page.tsx handleSave` now looks up the booking's newest WO and checks whether it has **≥1 `studio_time_row` with a non-null, non-empty `date`** (`woOwnsSchedule`). When true: `start_date`/`end_date`/`from_time`/`to_time` are deleted from the `bookings` update payload, **and** the day-rate stRow date-range reconciliation block is skipped (now gated `if (woId && !woOwnsSchedule && rate_type === 'day')`, reusing the single WO lookup). No-WO / empty-WO bookings still own and bootstrap their schedule. This makes the WO the sole authoritative writer once it holds real data. See the Decisions Log entries "The Work Order owns the booking's schedule…" and "`bookings.studio` is authoritative…".

| Booking state | Form writes dates/times to `bookings`? | Form seeds/reshapes WO rows? |
|---|---|---|
| No WO, or WO with no dated rows | Yes (form owns + bootstraps) | Yes (day-rate) |
| WO with ≥1 dated `studio_time_row` | No — WO is authoritative | No |

---

### June 22, 2026 (later session) — A&R artist persistence root-cause + artist-search rework

**Key commits:** `af957e8` (A&R contact artists array now saves correctly), `d7c8e82` (booking artist search runs through A&R contacts, includes null-type contacts).

A focused debugging session that found the *actual* cause of the long-standing "A&R artist arrays don't persist" bug and corrected two earlier doc claims (see the two updated Decisions Log entries above). The DB write path was proven healthy throughout — a direct `PATCH {"artists":[…]}` against `client_contacts` returns 204 and persists, and two contacts in the live DB still held artists.

#### Artists persistence — real root cause (`af957e8`)

- **One-line fix:** `app/(main)/clients/page.tsx` — the `load()` refetch selected `client_contacts` as `'id, client_id, fname, lname, email, phone, instagram, role, notes'`, **omitting `artists` and `contact_type`**. Added both columns.
- **Failure mechanism:** save writes artists to the DB (204) → `saveContact` calls `onRefresh()` = `load()` → contacts come back without `artists` → `ContactRow`'s `useEffect([contact])` runs `setLocalArtists(contact.artists || [])` and resets the chips to `[]`. The UI looks like it reverted; then any subsequent save of that contact sends `artists: []` (the reset value) and **wipes the DB row** — which is why nearly every `client_contacts` row read `[]` while the write path worked fine.
- **Secondary bug fixed by the same line:** with `contact_type` missing from the fetch, `contacts.filter(c => c.contact_type !== 'admin')` (A&Rs) vs `=== 'admin'` (Admins) had nothing to test — every contact was treated as an A&R and the Admins section on label profiles never populated. Now repaired.

#### Booking artist search — through A&R contacts, null-type inclusive (`d7c8e82`)

- **Third parallel query in `BookingForm` search** changed from "fetch all `type='label'` clients and scan `clients.artists[]`" to "fetch `client_contacts` (with `artists`, `contact_type`, and joined parent `clients(id,name,type,srs_client)`), pre-filtered `.neq('artists','{}')`, matched client-side." This routes artist search through the A&R who actually holds the artist rather than the label record.
- **Result-builder** now iterates contacts: skips rows with no parent and `if (ct.contact_type === 'admin') continue` (keeps null-type), pushes `{ id: parentClient.id, label: artistName, sub: parentClient.name, isLabel: parentClient.type === 'label', record: { ...parentClient, _artistMatch: artistName } }`. Keyed by `artist-${ct.id}-${artistName}`. The downstream `applyClientAutofill` is unchanged in shape because `record` is still the parent client + `_artistMatch`.
- **`_artistMatch` autofill re-query** filter changed from `.neq('contact_type', 'admin')` to `.or('contact_type.eq.anr,contact_type.is.null')` — PostgREST excludes NULLs from `!=`, so the old filter dropped legacy null-type A&Rs (the majority) and the auto-select frequently found no A&R. The new filter includes both explicit `anr` and null-type contacts while still excluding admins.

---

### June 23, 2026 — Admin Mic Inventory tab + mic data-model backfill

**Key commits:** `8529b8b` (admin mic inventory view with missing mic alerts), `eefd6c1` (horizontal studio tabs instead of collapsible sections).

#### Admin Mic Inventory tab (`8529b8b`)

- **New component `components/admin/MicInventorySection.tsx`**, wired into the Admin page as a fifth sidebar tab (`mic_inventory`, label "Mic Inventory") alongside Engineers / SRS Log / Ops Log / Flags. Wiring follows the existing extracted-section pattern: add the key to the `AdminSection` union, an entry to `ADMIN_NAV`, and a `{section === 'mic_inventory' && <MicInventorySection />}` conditional render (mounts/unmounts on tab switch, so it re-fetches fresh each open).
- **Read-only, no new tables.** Four parallel Supabase fetches: `mics` (active, ordered by `sort_order`), `mic_checkins` and `mic_inventory_quantities` (both ordered `date` desc then `created_at` desc), and `mic_inventory_submissions`. Reduced client-side to "latest per (studio, mic)" (first-seen-wins on the newest-first arrays) plus a "latest per mic across any studio" map and a `(studio,date) → submitter` lookup. No SQL join — this is a browser-query app.
- **Missing-mic banner** (full width, top, dismissable per session): lists every mic whose latest checkin **across any studio** is `missing`, each as name · studio · last-seen date · submitter. Styled `#7f1d1d` border / `rgba(127,29,29,0.18)` bg / `#ef4444` text per the spec.
- **Consolidated table** grouped into the four studios + a Floating Gear / Odds & Ends catch-all (so all ~271 mics appear). Columns: Mic Name | Status | Room | Qty | Last Submitted By | Date. Status colors Here `#14B8A6` / Room `#F97316` / Missing `#ef4444`; missing rows get a red left border + tint. Sort within a group: missing → room → here → none, then `sort_order`. Studio groups resolve status from the mic's latest checkin **at its home studio**; the Floating group resolves across any studio.
- **Show History** toggle reveals, per mic (studio groups only), the last 7 checkin nights as compact sub-rows (date · status dot+label · room · submitter initials).

#### Horizontal studio tabs (`eefd6c1`)

- Replaced the vertical stack of collapsible studio sections with a **horizontal tab bar**: `Paramount | Ameraycan | Encore | Track | Floating Gear`. Each tab shows its mic count and a red missing-count badge when > 0; the active tab gets a 2px bottom border in the studio's color. Clicking a tab renders only that studio's table below.
- State changes: `openSections`/`historyOn` maps replaced by a single `activeTab` (defaults to Paramount) and a single `showHistory` boolean that applies to the active tab and persists across tab switches. "Show History" moved to a toolbar above the table (studio tabs only; hidden on Floating Gear). All data logic, status colors, sort order, missing banner, and history sub-rows are unchanged from `8529b8b`. The Floating group label was shortened from "Floating Gear / Odds & Ends" to "Floating Gear" to match the tab spec.

#### Documentation backfill (this session)

- The four live mic tables (`mics`, `mic_checkins`, `mic_inventory_quantities`, `mic_inventory_submissions`) were introduced June 8, 2026 with the runner mics page but were never formally added to the data model — CLAUDE.md only documented the legacy `mic_inventory` table. Added all four to CLAUDE.md's data-model section and marked `mic_inventory` legacy (still read by `DailyOpsModal` only). Added two Decisions Log entries (mic data model; admin tab resolution rules).
- **Note on the repo's `.claude/worktrees/agent-ab5b0d2d510b094ef` gitlink:** it was committed as a tracked sub-checkout in `e12322e` and perpetually shows as dirty (its own `.next` build output etc.). Staging it is a no-op — the recorded SHA never changes — so it produces no committable project change. It is agent scratch, not project code; ignore it in `git status`.

---

### June 24, 2026 — Admin Mic Inventory editing + Manage Mics + Engineers table fix

**Key commits:** `6dfb4d6` (inline editing + Manage Mics modal), `e8d234c` (sub-row panel → in-place cell editing), `b091758` (per-studio room dropdown), `fdecc26` (single grid template alignment), `65d2cda` ("Initials" placeholder), `898ecb0` (engineers actions column width).

**Migration.** `mic_checkins` gained `source text NOT NULL DEFAULT 'runner'` and `amended_by text` (run manually in the Supabase SQL editor; `ADD COLUMN` inherits the table's existing anon/authenticated grants).

**Inline admin status editing (`MicInventorySection.tsx`).** Each mic row in the admin tab has a `✎` pencil that turns the row's own cells into in-place inputs (the first pass used a sub-row panel; replaced because it read as a disconnected mini-form). Editing and non-editing rows share ONE grid template (`GRID_COLS`, action column widened to 124px) so inputs stay aligned under their headers; the editing row gets a lime tint + left accent. Cells: Status dropdown (Here/Room/Missing); Room is a **per-studio room dropdown** (`STUDIO_ROOMS`, same lists as the runner mics page; shown only when status=Room; text-input fallback for unknown/floating studios); Qty numeric; Last-Submitted-By text with a greyed "Initials" placeholder (starts empty so it's obviously fillable; prefills only when a real prior admin initials value exists). Save upserts `mic_checkins` (`onConflict mic_id,studio,date`) with `source:'admin'`, `amended_by`=initials (falls back to current user / `'Admin'`); a changed Qty also upserts `mic_inventory_quantities` (today, same studio). Admin-sourced checkins render a teal ADMIN badge in the main row, history sub-rows, and the missing banner.

**Manage Mics modal.** "Manage Mics" button in the section header opens a two-tab modal. *Master Mic List:* search by name/studio, inline edit (name / studio-select / category / qty), Deactivate (`is_active=false`, greyed at bottom) + Reactivate; **qty edits write to `mic_inventory_quantities`, never to `mics`**. *Add Mic:* name (required) / studio / category / qty → inserts `mics` (`is_active=true`, `sort_order=max+1`), plus a `mic_inventory_quantities` row when qty>0. The component now loads ALL mics and derives active-only for the display; every write calls an internal `loadData()` reload.

**Engineers table fix (`app/(main)/admin/page.tsx`).** The Engineers table actions column was 80px but holds Edit + Deactivate (~150px); `justify-content: flex-end` overflow spilled left and clipped the green Status pill ("Active" → "Activ" with Edit on top). Widened the actions column 80px→180px in both the header and row grid templates (`'44px 1fr 100px 140px 140px 80px 80px'` → `…80px 180px'`).

---

### June 25–26, 2026 — Task comment photo preview, `/tasks` page, dashboard deep-links, automated Google Drive backup

**Key commits:** `6211d17` (comment-section photo thumbnail preview), `f999fd4` (task panel cap at 9 + show-all + `/tasks` page), `e102447d` (completed collapsed by default + search), `8260fd4` (dashboard lead → CRM), `418ebfb` (dashboard empty room → booking modal), `295401f` (daily backup feature), `2d78713` / `12bad5b` / `2623d88` / `d933fce` / `c18b983` / `a6a027f` / `ca8038a` (backup fixes).

This session continued the dashboard/task work from June 25 and then built the automated backup system end to end. The add-task "photo not saving" item from the prior session was closed as **not a defect** (see the resolved Decisions Log entry) — the save path was always healthy; the work shipped was a thumbnail preview in the comment section to make attachment state obvious.

#### Task comment photo preview (`6211d17`)

- Task-detail modal comment section now shows an `<img>` thumbnail the instant a photo is picked (max-height 80, 4px radius, `display:block`, `margin-bottom:8`), above the "+ Attach photo" link — mirroring the add-task modal.
- Added `commentPhotoPreview` state + `pickCommentPhoto`/`clearCommentPhoto` helpers (create via `URL.createObjectURL`, revoke the prior URL on change/clear). Replaced the five repeated `setCommentPhoto(null)` + ref-reset blocks (open / comment / complete / cancel / save&close / delete) with `clearCommentPhoto()` so the object URL is revoked on every close/clear.

#### Task panel cap + `/tasks` full page (`f999fd4`)

- **Dashboard Tasks panel** caps the rendered list at 9 (`tasks.slice(0, 9)`) with a muted "+ N more" link (10px `#6B7280`) that routes to `/tasks`; the header action changed `history →` → `show all tasks →` (→ `/tasks`).
- **New `app/(main)/tasks/page.tsx`:** same 6 per-user tabs + role-visibility rules (resolved from `user_profiles` by display_name), Active (incomplete, no cap) + Completed sections each with a count-pilled `SectionHeader`, wider rows showing `assigned_by` + `created_at` on the right, and a replicated task-detail modal (Complete hidden on already-completed tasks). Page is **not in the nav** — only reachable from the dashboard.
- **`lib/tasks.ts` extraction:** moved the task tab/roster helpers out of `page.tsx` into a shared module imported by both surfaces (single source of truth — see Decisions Log). The dashboard kept local `fmtTime`/`uploadPhoto` (also used by flags) untouched. The dashboard's old completed-tasks history modal is now dead/unreachable, left in place to keep the diff scoped.

#### `/tasks` completed collapsed + search (`e102447d`)

- Completed section collapsed by default (`showCompleted=false`); the header is a click toggle rendering `COMPLETED (n) ▼` collapsed / `▲` expanded.
- Added a "Search tasks…" input filtering both Active and Completed (case-insensitive on `text`). A non-empty query forces `completedVisible` true so search always reaches completed matches regardless of collapse. (The search box was added because the spec's search exception + verify step required one to exist; the literal `(n)` format meant dropping Completed's count pill in favor of an inline count.)

#### Dashboard lead → CRM deep-link (`8260fd4`)

- Needs Action lead rows on the dashboard are clickable (`cursor:pointer`) → `router.push('/crm?lead=<id>')`. No conflicting handlers on that row (the StatusBadge is non-interactive; no CONTACT button on the dashboard variant).
- CRM reads the `lead` param in a mount effect via `new URLSearchParams(window.location.search)` (matching its existing `?clientId=`/`?id=` handling — chosen over `useSearchParams` to avoid a page-level `<Suspense>` restructure that the static build would otherwise demand). It selects the lead, switches off `analytics` to a list view, and sets `hasAutoSelected.current = true` so the default Needs Action auto-select doesn't override the deep-link.

#### Dashboard empty room → booking modal (`418ebfb`)

- Empty room-grid cards: clickable, pointer cursor, lime border tint `rgba(200,240,78,0.2)` on hover (via `onMouseEnter`/`onMouseLeave` + a `hoverRoom` state), no added label/text. Click → `/calendar?newBooking=1&location=<venue>&studio=<studio>&date=<viewed day>`.
- The calendar gained an effect that fires when `newBooking` is present **without** a `clientId` (so it never collides with the client-based Start Booking flow) and calls the existing `openNew(location, studio, date)` — reusing the real `BookingForm` + `handleSave` insert with zero duplication.
- **Occupied cards were deliberately kept clickable** (they open their booking) — the spec asked to make them non-clickable, but that would regress the shipped "dashboard room grid → booking modal" feature, so on an explicit decision the existing behavior was preserved.

#### Daily Google Drive backup (`295401f` + the fix series)

- **`scripts/backup.mjs`** (Node ESM, no Next/React) + **`.github/workflows/daily-backup.yml`** (cron `0 8 * * *` + `workflow_dispatch`, Node 24, `checkout → npm ci → node scripts/backup.mjs`, three secrets as env). `googleapis` added to dependencies (`npm install` updated `package-lock.json` for `npm ci`).
- The first version used `@supabase/supabase-js` and crashed in CI ("Node.js 20 detected without native WebSocket support") because the JS client spins up a realtime WebSocket. Rewrote (`2d78713`) to hit PostgREST directly with `fetch()`: `…/rest/v1/<table>?select=*&deleted_at=is.null&limit=1000&offset=N`, anon key as `apikey` + bearer, paginating by `offset`; tables lacking `deleted_at` (PostgREST `42703`) auto-retry without the filter.
- **Table names corrected against live `.from()` usage** (`12bad5b`, `2623d88`): `mic_inventory`→`mic_inventory_quantities`, `srs_referrals`→`srs_log`, `daily_ops_log`→`daily_ops_submissions`; added `dashboard_task_comments`, `flag_comments`, `studio_time_rows`, `rental_rows`, `payment_rows`, `petty_cash_entries` (17 tables total). Confirmed `rental_rows`/`payment_rows` are real tables (queried by `work_order_id`), not jsonb on `work_orders`.
- **Drive:** uploads `prsflow-backup-YYYY-MM-DD.json` via `googleapis`, auth from `GOOGLE_SERVICE_ACCOUNT_JSON`, `supportsAllDrives: true`. A 404 prints a "share the folder with the service account email" message + the `client_email` (`12bad5b`). Folder ID corrected twice (`d933fce`, `c18b983`) to the final Shared Drive folder. Per-table success/failure logged; failed table noted + skipped; `process.exit(1)` only on upload failure.
- **GitHub gotcha:** pushing the workflow file initially failed because the local PAT lacked the `workflow` scope (required for `.github/workflows/`); it pushed once the token had the scope. Node bumped 20→24 in the workflow (`a6a027f`, `ca8038a`).
- **Operational prerequisites (outside the repo):** the three GitHub secrets must be set, and the Drive target must be a Shared Drive with the service account as a member (service accounts have no personal Drive quota). Trigger the workflow manually once to confirm end-to-end before trusting the schedule.

### June 26, 2026 (evening) — Mobile responsiveness pass, welcome splash, dashboard hero clock, nav hamburger + USF removal

**Key commits (in order):** `898f34c` (dashboard mobile layout), `a794517` (smaller room cards on mobile), `a32c8e7` (mobile hamburger nav), `d2bdedc` + `c6d7e51` (compact task rows / logo links home), `8ecf9dc` (hero title one line on mobile), `4c0d2a0` (welcome splash), `47f333f` / `dbf1229` / `372c7f4` / `08e57f3` (splash flash-prevention fixes), `ae908d5` / `8ade55f` / `45beda2` (dashboard hero clock), `8e2c25e` (CRM mobile single-panel), `4120cda` / `b913832` / `41ea3cf` / `35af433` / `eb9011e` / `48b07a4` / `2eba354` (calendar mobile series), `9e65fcb` (remove USF button from nav), `f90ca0c` / `c51680a` / `ef284a3` / `0a047d1` (WO popup + booking form mobile), `3395f27` (calendar chip text color).

A full mobile-responsiveness initiative across every internal surface (dashboard, CRM, calendar, Work Order popup, booking form, nav), plus a fresh-login welcome splash, a relocated dashboard hero clock, and removal of the experimental USF nav button. **Every layout change is gated behind `useIsMobile()` (or `@media (max-width: 768px)`), so desktop is unchanged throughout.** This closes most of the "Mobile pass" roadmap item.

#### Shared responsive infrastructure (`hooks/useIsMobile.ts`, `styles/globals.css`)

- **`hooks/useIsMobile.ts`** — `useIsMobile(breakpoint = 768)`: a `matchMedia('(max-width: <bp>px)')` hook that returns `false` on first render (SSR-safe / desktop-first), then flips on mount. Single source of the breakpoint across the app. Used by the dashboard, Nav, CRM, calendar, BookingForm, WorkOrderPopup, and LocationStrip.
- **`styles/globals.css`** — added a `@media (max-width: 768px)` block: `html, body { overflow-x: hidden; max-width: 100vw }` (kills accidental horizontal scroll) and `.page-main { padding: 16px 12px !important }` (tightens the shared `(main)` gutter; `!important` beats the inline `padding: 24px 32px` on `<main>`). Added a `welcomeFadeIn` keyframe for the splash. `app/(main)/layout.tsx` now puts `className="page-main"` on `<main>`.

#### Dashboard mobile (`898f34c`, `a794517`, `d2bdedc`, `c6d7e51`, `8ecf9dc`)

- 3-column grid (`1fr 2fr 1fr`) collapses to a single column on mobile, **reordered** via CSS `order`: Today's Sessions (`order 1`) leads, then Needs Action (`order 2`), then Tasks (`order 3`) — so the most-used panel is first on a phone. Room grid `height: 556` becomes `auto` on mobile.
- Room-grid cards shrink on mobile (2-column grid instead of 3, smaller min-heights, tighter padding, larger touch fonts). Task rows get a compact mobile variant (smaller padding, single-line). Hero `<h1>` forced to one line (`whiteSpace: nowrap`, `fontSize 26` vs 32) and the greeting/title block stacks.
- **`fullscreenCardOnMobile(isMobile)`** helper added: returns `{ width: 100vw, maxWidth: 100vw, height: 100dvh, maxHeight: 100dvh, margin: 0, borderRadius: 0 }` on mobile, `{}` on desktop — spread into every dashboard modal card (task ticket, add-task, flag modal, etc.) so they go full-screen on a phone.
- Logo in the nav now links to `/` (Dashboard) — shipped with the task-row commit (`c6d7e51`).

#### Welcome splash on login (`4c0d2a0` + flash fixes `47f333f`/`dbf1229`/`372c7f4`/`08e57f3`)

- **Flow:** `app/(auth)/login/page.tsx` sets `sessionStorage 'showWelcome' = 'true'` on a successful `signInWithPassword` before `router.replace('/')`. The dashboard reads it on mount, **removes it immediately** (so refresh/navigation never re-triggers), shows a one-time full-screen splash (greeting + `profile.display_name` in Syne 800 + "PARAMOUNT RECORDING GROUP" footer), fades after 2s, then dispatches a `welcomeDone` window event.
- **No-flash hardening (the bulk of the fixes):** the splash overlay sits at `zIndex 100000` (above the Nav's 99999). To prevent a frame of dashboard/nav showing before the splash:
  - **`AuthGuard`** reads `showWelcome` synchronously into `pendingWelcome` and, while the session is still resolving, renders a full-screen `#0d0f14` hold (`zIndex 100001`) instead of `null` — the screen stays dark from page load until the splash mounts. It only reads the flag (never clears it; the dashboard does).
  - **`components/layout/NavGate.tsx`** (new) wraps `<Nav>`: reads `showWelcome` synchronously to hide the nav on the very first paint (`hiddenForWelcome` prop → `opacity 0` + `pointerEvents none` on the nav), and reveals it on the `welcomeDone` event with a 3s fallback timer so the nav can never get stuck hidden. `layout.tsx` renders `<NavGate />` instead of `<Nav />`.
  - The dashboard content wrapper is `opacity 0` until `contentReady && !showWelcome`, fading in over 0.3s. (An earlier attempt used an inline `<script>` in the layout to pre-hide; that approach was dropped — `08e57f3` removed the script-tag error — in favor of the AuthGuard dark-hold.)

#### Dashboard hero clock (`ae908d5`, `8ade55f`, `45beda2`)

- The live clock was **removed from the Nav** and moved to the **dashboard hero** (desktop only — hidden on mobile). It renders bottom-aligned with the page `<h1>`: date (`#c8f04e`) + time (`#e8eaf0`) inline on one line, in **DM Serif Display** (the heading font, 28px) to match the title weight. Ticks every second via a `clockNow` state + 1s interval. This supersedes the prior "Nav clock + sign out" arrangement — the nav no longer shows a clock.

#### Nav: hamburger menu + USF removal (`a32c8e7`, `9e65fcb`)

- **Mobile hamburger:** below 768px the nav collapses to logo + a 44×44 `≡` button (far right). Tapping toggles a full-width dropdown (`position absolute, top 100%`) listing the nav items + a red Sign Out, with a transparent outside-tap overlay to dismiss. The STUDIO OS badge and the desktop tab row / Sign-Out are hidden on mobile. Active item gets a 2px lime left border.
- **USF button removed (`9e65fcb`):** the experimental "⚡ USF" owner-gated Nav button and its `UnifiedSessionForm` import/launch were deleted from `Nav.tsx`. The `components/unified/UnifiedSessionForm.tsx` component and `WorkOrderPopup`'s `inline` prop still exist in the repo but are now **unreachable from the UI** (nothing launches USF). The `localStorage.userRole === 'owner'` gate and the nav-level `isOwner`/`showUSF` state were also removed.

#### CRM mobile single-panel (`8e2c25e`)

- CRM's two-panel (list + detail) layout becomes single-panel on mobile: the list shows full-width by default; tapping a lead swaps to a full-screen detail view with a "← Leads" back button (clears `selectedId`). The detail panel is hidden until a lead is selected; the list is hidden once one is.
- The default auto-select-first-lead effect and the Needs Action tab-change auto-select are **suppressed on mobile** so the list stays the default surface (the `?lead=` deep-link still opens detail). Sub-nav wraps; "+ New Lead" gets a 44px tap target. All via `display: contents`-style conditionals — desktop grid unchanged.

#### Calendar mobile (`4120cda` → `2eba354`, a multi-step series)

The calendar went through several iterations on touch handling before landing on a clean final state. **Final state:**
- **Defaults to Day view on mobile** (`2eba354`) — set via a lazy `useState` initializer reading `matchMedia` (the page is client-only behind `Suspense` + `useSearchParams`, so this is hydration-safe), with a backup effect for late breakpoint resolution. `DayView` was made phone-usable: the 216px mini-calendar sidebar is hidden, studio cards become a single column (all 11 rooms as vertically-scrollable rows), and the header date uses a compact format so the prev/Today/next arrows don't clip.
- **Controls bar** stacks into two rows on mobile via `display: contents` wrappers (inert on desktop): row 1 = date range + prev/today/next; row 2 = location filter + view toggles. Zoom controls hidden. "+ New Booking" becomes a full-width lime button below the bar.
- **Grid view** polish (still available via the view toggle): room-label column narrows to 80px with trimmed padding so "Studio A" fits; week columns shrink to fit the viewport; booking chips get a 56px row height / 44px min-height / 11px truncated name; a month abbreviation ("JUN", DM Mono 10px/600/`#6B7280`) sits in the top-left corner cell (both mobile + desktop); the date-range text is a tappable native `<input type="date">` overlay (works on iOS by direct tap, no `.click()`) that jumps to the picked date's week.
- **Location header codes on mobile:** Paramount/Ameraycan/Encore/Track → PRS/ARS/ERS/TRS.
- **Swipe navigation was added and then fully removed.** It went grid-wide → header-only (to dodge scroll conflicts) → grid-wide-simple → removed entirely (`48b07a4`, `2eba354`) because touch handlers fought native vertical scroll and dragged the sticky room-label column. The final calendar has **no swipe handlers** — navigation is the arrow buttons + the date-picker overlay. `48b07a4` also fixed booking blocks rendering as slivers stuck at the left edge: `load()` fetches a ±2-week buffer but mobile renders only the visible window (`bufDays = 0`), so off-window bookings clamped to `left:0/width≤0`; the fix filters `roomBookings` to those overlapping the rendered window (a no-op on desktop where the rendered window equals the fetch range).

#### WorkOrderPopup + BookingForm mobile (`f90ca0c`, `c51680a`, `ef284a3`, `0a047d1`)

- **Both go full-screen on mobile** (`100vw × 100dvh`, `borderRadius 0`, flex column: fixed header, scrollable body, fixed footer). The WO popup's `minWidth: 780` (which caused horizontal overflow on a phone) is dropped on mobile. The WO popup's mobile treatment is suppressed when rendered `inline` (the dead USF embed path): `isMobile = useIsMobile() && !inline`.
- **WO popup styled to match the Runner Hub WO page** (`app/runner/[studio]/wo/[id]/page.tsx`) as the visual template:
  - Header mirrors the runner: `#161920` bar with a 3px studio-color bottom border (a local `STUDIO_COLORS` map keyed by `booking.location`, default lime), a `←` back button, "Work Order" title + `client · date` subtitle. Page/card background `#0d0f14`.
  - Each body section is a runner-style card (`#161920` surface, `1px #2a2e3d` border, radius 12, 14px padding): a new **read-only SESSION INFO card** (Client/Label·A&R, Artist, Engineer, Date, Time, Studio — muted-label/value rows), Studio Time, Equipment Condition, Session Notes, Rentals, Payments/Totals, and an orange-bordered Needs Attention card.
  - **Hidden on mobile but kept in the DOM** (so desktop + save logic are untouched): the META section (all raw booking-form fields — Session Date, Engineer, Studios selector, Payment toggle, Food Budget, Client/Artist/Label inputs), the BRANDING letterhead, and the footer's Export PDF + Complete WO buttons.
  - **Footer** reduced to two full-width buttons on mobile — Cancel (`flex 1`, dark) + Close & Save (`flex 2`, lime). **Complete WO** relocated to a full-width secondary action inside the body.
  - Studio Time and Rentals tables scroll horizontally on mobile (`overflow-x: auto` + `min-width`) so their fixed columns stay reachable inside the padded card. All inputs get a 44px min tap height via a scoped `<style>`.
- **BookingForm:** the existing flex-column card (header + status chips + body + footer) was already structured correctly; the bug was the body missing `minHeight: 0`, so a flex item grew to content height and the whole sheet scrolled (header included). Adding `minHeight: 0` (mobile) makes only the body scroll — the title/status-chips/× header stays at top, Cancel/Save stays at the bottom. Field grids collapse to a single column; inputs get 44px min height; footer buttons go full-width.

#### Calendar chip text color (`3395f27`)

- Booking-chip text was tinted blue (COD `#7BBFFF`) and purple (label `#96A9FF`) by payment type. Made all chip text white/muted regardless of type, across `BookingBlock`, `DayView` cards, and `StudioView` cells: artist/client name `#e8eaf0`, label/company line `#9ca3af`, time `#6B7280`, engineer/assistant initials `#6B7280` (previously status-tinted green/orange). Removed the now-unused `COLOR_COD`/`COLOR_LABEL` constants. Chip backgrounds, borders, glow, status top-bar, and session-border accents were untouched — text only.

### June 26, 2026 (late) — Calendar inner-glow rework, splash name fade-in, lead-form universal client search

**Key commits (in order):** `893679c` (day-view studio name → muted white), `965b8b4` / `cf7ca70` / `4fba14c` / `477fa9f` (day-view card inner-glow iteration), `5f4e24c` (day-view chips inner glow), `8ed375c` (BookingBlock + StudioView chips inner glow), `0050c76` (splash name fade-in + smoother fade-out), `535eaab` (lead-form universal client search). All in `app/(main)/calendar/page.tsx`, `app/(main)/page.tsx`, and `app/(main)/crm/page.tsx`. Desktop-and-mobile (the calendar/CRM changes share one code path; no `isMobile` branch needed). `tsc --noEmit` clean on every commit.

#### Calendar inner-glow rework (`893679c` → `8ed375c`)

Follow-on polish to the June 24 glow work: the calendar's occupied/booked surfaces were halo-ing **outward** instead of glowing **inward** like the dashboard room grid. Final state:
- **Day-view studio-card name** recolored from the lime accent `#c8f04e` to muted white `#9ca3af` (`893679c`) — matches the app's section-label convention. (See the matching Decisions-Log entry.)
- **Day-view studio cards** (the per-room containers, with a name header + stacked booking chips) iterated through several glow attempts (`965b8b4` border 0.35 + `inset 0 0 18px 0.06` + 2px top bar; `cf7ca70` bumped to 0.5 / `inset 0 0 24px 0.12`; `4fba14c` true inner glow border 0.2 / `inset 0 0 30px 0.15` + gradient). **The key fix was `477fa9f`:** an `inset` shadow on the outer card is **hidden** because the card's children (a `var(--surface2)` header + opaque `#0d0f14` chips) cover it — so the glow was only visible as a thin ring at the border, which read as "outer." The glow was moved to a transparent absolute overlay (`position:absolute; inset:0; pointerEvents:none; zIndex:2`) layered on **top** of the content so the inset diffuses over the chips; clicks still pass through to the chips. The 2px teal top bar moved above it (`zIndex:3`).
- **Booking chips are the real glow surface (`5f4e24c`, `8ed375c`).** Each chip has a `#0d0f14` background with text-only children — exactly the dashboard room-card structure — so the chip itself takes the inset glow cleanly. All three chip renderers were switched from the outer `0 0 8px rgba(…,0.15)` shadow to `inset 0 0 18px rgba(20,184,166,0.06)` (teal) / `rgba(249,115,22,0.06)` (orange): `DayView` chips (`5f4e24c`), and `BookingBlock` (week/2-week grid) + `StudioView` cells (`8ed375c`). With the chips now glowing, the redundant heavy overlay on the Day-view studio card was removed in `5f4e24c` — the card keeps only a subtle `rgba(20,184,166,0.2)` border + the 2px teal top bar as its container-level occupied signal. **Net:** the calendar now matches the dashboard byte-for-byte on the glow value, and nothing halos outward anymore.

#### Splash screen name fade-in + smoother fade-out (`0050c76`)

- The fresh-login welcome splash (`app/(main)/page.tsx`) now animates the `display_name` in: a new `nameVisible` state flips `true` 300ms after the splash mounts (added alongside the existing 2s/2.5s timers in the welcome effect). The name `<div>` gets `opacity: nameVisible ? 1 : 0`, `transform: nameVisible ? 'translateY(0)' : 'translateY(8px)'`, `transition: 'opacity 0.6s ease, transform 0.6s ease'` — so it fades in with a slight upward drift while the greeting and "PARAMOUNT RECORDING GROUP" footer (no per-element animation) appear immediately with the splash.
- The whole-overlay fade-out `transition` was bumped `0.5s` → `0.6s ease`. Because the fade-out is on the parent overlay (`opacity: welcomeFading ? 0 : 1`), it covers all children together — the name never disappears before the rest.

#### Lead-form universal client search (`535eaab`)

- Reworked `NewLeadModal`'s **Label mode** (`app/(main)/crm/page.tsx`) to match the booking form's "Search client…" field. See the Decisions-Log entry for the full behavior. In short: one `Search client name…` field runs three parallel queries (`clients` label names, `client_contacts` A&R names, `client_contacts.artists[]` artist names) and shows **Artist (bold) · Label · A&R** rows; picking one autofills + links LABEL, A&R/REP (with email/phone), and ARTIST. The three fields below became plain **editable** inputs (LABEL is no longer its own search; A&R lost the "Select a label first" disable gate), so free text works for un-matched leads. Removed the dead label-only-search code (`selectLabelClient`, `handleLabelKeyDown`, `labelClientSuggestions`/`showLabelClientDD`/`labelHighlight`/`labelDebounce`/`skipLabelSearch`); added a `UniSuggestion` type. COD mode, the COD/Label toggle, EMAIL/PHONE, and all other lead fields are untouched.
