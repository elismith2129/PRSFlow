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
- **WO→Booking sync writes to both tables; does NOT remount the booking form.** Close & Save writes synced fields to both `work_orders` and `bookings`. `onSaved` is set to `{undefined}` in the calendar page — the booking form is NOT remounted from the DB after WO save. This preserves any unsaved booking form edits (changed dates, rate, etc.) that the user made while the WO was open. WO status updates flow back via the `onStatusChange` prop. *(The earlier approach — `onSaved` refetched the booking by ID and reopened the form with fresh data — was wiping unsaved form state. Changed in `7d676c7`, June 4, 2026.)*
- **`initWO` uses `.order('created_at', { ascending: false }).limit(1)` instead of `.maybeSingle()`.** `.maybeSingle()` silently returns `null` when multiple rows match — it was causing `initWO` to always hit the "create new WO" branch, accumulating hundreds of duplicate work_orders per booking. The `.limit(1)` approach tolerates duplicates and always picks the most recent row. 299 duplicate WO rows were cleaned up via REST API batch delete (June 2, 2026).
- **`liveForm` is memoized in `BookingForm` with `useMemo`.** Passing an inline object literal `liveForm={{ ... }}` to `WorkOrderPopup` caused a new reference on every parent render, which remounted `WorkOrderPopup` (and re-ran `initWO`) constantly. `useMemo` with all form field dependencies prevents spurious remounts.
- **Engineer edit-in-place uses a ref (`engEditingRef`) alongside state (`engEditing`).** React `useState` has stale closure issues in blur `setTimeout` callbacks — the `onBlur` handler captures `engEditing` from the render it was created in, not the latest value. `engEditingRef.current` is always current in the closure. The Escape handler sets `engApplied.current = true` (not `engEditingRef = false`) so the subsequent blur from unmount skips calling `applyEng` — the blur handler is the single place that clears `engEditingRef`.
- **WO print: `document.title` sets the default Save as PDF filename.** Before `window.print()`, `document.title` is set to `CLIENT_INV#` (COD) or `LABEL_ARTIST_INV#` (Billing), then restored after. This controls the filename the browser pre-fills in the Save as PDF dialog. All three print buttons use `printWithFilename()` helper. If no invoice number exists, `_INV#` literal is appended as a placeholder.
- **Per-row rate type replaces booking-level rate type in the Studio Time table.** `studio_time_rows` gained two columns: `row_rate_type text DEFAULT 'hour'` and `rate_daily text`. Each row independently toggles between `'hour'` and `'day'` billing. `toggleRowRateType(id)` converts: hour→day sets `rate_daily = rate × 10`; day→hour sets `rate = rate_daily ÷ 10`. This decouples individual rows from the booking-level `rate_type` and eliminated the booking-level rate-sync `useEffect` in WorkOrderPopup and the post-save rate sync block in `calendar/page.tsx`. `normalizeStRow` branches on `row_rate_type`: day rows use `rate_daily` flat; hourly rows derive charge from `totalHours × rate`.
- **Unified 9-column Studio Time table replaces two separate layouts.** Column order: Date | Session Info | From | To | Hrs | Type | Rate | OT Rate | Total. The Type cell shows Day/Hr inline toggle buttons in admin (editable) or a display label in runner (read-only). This replaced the separate day-rate compact layout and hourly layout that existed previously in both admin WorkOrderPopup and runner WO page.
- **`TimeInput` is now a `<select>` with 48 pre-built options (every 30 min, 12-hour AM/PM).** The previous smart-parse text `<input>` (accepting `8p`, `830a`, `1830`, etc.) was replaced with a controlled select dropdown. This eliminates ambiguous input and parse-on-blur edge cases. Used in booking form, WO Studio Time table From/To cells, and engineer sub-row From/To cells.
- **iOS Safari scroll lock pattern.** `document.body.style.overflow = 'hidden'` does NOT lock scroll on iOS Safari — the page still scrolls behind overlays. Correct pattern: on open, read `scrollY`, then set `document.body.style.top = -\`${scrollY}px\`; position = 'fixed'; width = '100%'`. On close, clear all three properties, then call `window.scrollTo({ top: savedScrollY, behavior: 'instant' })`. Applied to the runner WO notes bottom sheet.
- **Runner WO notes bottom sheet (floating card, not full overlay).** The notes edit view is a `position: fixed` floating card: `bottom: 16, left: 12, right: 12; borderRadius: 12; boxShadow: '0 -4px 24px rgba(0,0,0,0.4)'`. No background dim. Uses explicit `paddingLeft/paddingRight` longhand on all child elements (shorthand padding can be overridden by global resets on iOS). Root containers on all runner pages have `maxWidth: '100vw', overflowX: 'hidden'` to prevent horizontal overflow on devices with scrollbars.
- **Runner WO viewport fixes.** Next.js `Viewport` export in `app/layout.tsx` sets `maximumScale: 1, userScalable: false` — prevents iOS Safari pinch-zoom from breaking the layout. Runner page root containers use `left: 0, right: 0` instead of `width: 100vw` to avoid triggering horizontal overflow on devices where `100vw` includes the scrollbar width.
- **PDF session notes revealed via `data-si-print` span.** Inside the Studio Time table Session Info cell, a `<span data-si-print>` wraps the full session notes text. `@media print` CSS in `globals.css` reveals this span (it is hidden in screen view). This puts session notes inside the cell in the printed/PDF WO without adding a visible element to the on-screen table.
- **Admin session info popover in Studio Time table.** Clicking the Session Info cell in the admin WO Studio Time table opens a 280px `position: fixed` popover with an editable textarea for session notes and Save/Close buttons. Allows admin to edit per-row session notes without opening a separate modal.

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

*Last updated: June 8, 2026 — Studio Time table bugfix series (OT auto-calc, native date picker overlay, insert fixes, session notes restored, column widths); confirmed sessions filter; WO status cycling per studio_time_row (in_progress/submitted/approved); multi-day booking date range queries; LocationStrip badge driven by stRow status; approved sessions drop from drawer.*

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
