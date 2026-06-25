# PRSFlow — Tech Stack & Roadmap

*Last updated: June 25, 2026*

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | `"next": "^16.2.6"` in package.json; all pages are `'use client'` |
| Database | Supabase (Postgres) | Direct browser queries via anon key; no API layer |
| Storage | Supabase Storage | Private `client-ids` bucket for ID file uploads |
| Auth | Supabase Auth (login live June 25, 2026); RLS deferred to Chunk 9 | Login + client-side `AuthGuard` on `(main)` routes. **UX gating only** — no RLS yet, anon key keeps full table access. Sessions in localStorage (no SSR middleware). |
| Hosting | Vercel | Auto-deploys from GitHub `main`; Vercel Cron for auto-demotion job |
| Language | TypeScript | `strict: false`, `target: es5` |
| Styling | Plain CSS + CSS variables | No Tailwind (installed but unused); all inline `style={{}}` JSX |
| Fonts | Google Fonts via CSS `@import` | Syne (headings), DM Serif Display (display), DM Mono (body/data) |

---

## Quick Mental Model

If you're not deep in the code day-to-day, here's the 30-second version of how everything connects.

**The code lives in two places:**
- **Your laptop** — where you edit files in VS Code. Nothing here affects the live site until you push.
- **GitHub** — the cloud copy and source of truth. Every `git push` sends your local changes here.

**Vercel watches GitHub.** The moment you push to the `main` branch, Vercel automatically builds and deploys the new version. The live site at `prs-flow.vercel.app` is updated in about 60 seconds — no manual deploy step needed.

**The app talks to Supabase for all data.** Supabase is the database. It holds leads, clients, registration tokens — everything. The app running in the browser queries it directly. Supabase lives in the cloud independently of Vercel.

**The full edit loop looks like this:**

```
Edit file in VS Code
       ↓
localhost:3000 updates instantly (npm run dev is running)
       ↓
git push origin main
       ↓
Vercel detects the push → builds → deploys (~60 seconds)
       ↓
prs-flow.vercel.app is live with your changes
```

**Preview URLs** work the same way but for non-main branches. Push a branch like `chunk-4-6b` and Vercel builds a separate preview URL — useful for testing on your phone without touching the live site.

---

## Local Development Setup

When you sit down to work on PRSFlow, here's what should be running:

**VS Code**
Open the project folder (`~/Desktop/PRS/PRSFlow/prsflow`). All file editing happens here. The built-in terminal panel at the bottom is where you run commands — you can have multiple terminals open as tabs.

**Terminal 1 — the dev server**
```
npm run dev
```
This starts a local version of the app at `http://localhost:3000`. It stays running the whole time you're working. Every time you save a file, it automatically refreshes the browser — no manual reload needed.

You'll see a stream of `GET /` and `GET /crm` log lines while you use the app. That's normal — it means the server is responding to your browser. It's not stuck; it's working.

**Terminal 2 — Claude Code**
```
claude
```
The AI coding assistant. Open this in a second terminal tab so it runs alongside the dev server. You can switch between terminals by clicking the tabs in VS Code's terminal panel (bottom right of the screen).

**Browser**
- `localhost:3000` — for testing your current changes locally
- Vercel preview URLs (e.g. `prsflow-git-chunk-4-6b-....vercel.app`) — for testing on your phone or sharing with others before merging

You don't need to restart `npm run dev` when you edit files — it hot-reloads automatically. You only need to restart it if you change something in `next.config.js`, install a new package, or if it crashes.

---

## Troubleshooting Quick Reference

| Symptom | Fix |
|---|---|
| **White screen, no styles** | Check that `globals.css` is imported in `app/layout.tsx`. Try restarting `npm run dev`. |
| **Data not loading / blank lists** | Open browser DevTools → Console tab. Look for red errors. Most likely: `.env.local` is missing the Supabase API keys. |
| **Vercel deploy failed** | Open Vercel dashboard → click the failed deployment → Build Logs. Most common cause: a missing environment variable. Remember env vars must be set for **all three environments** (Production, Preview, Development) — not just Production. |
| **`git push` rejected** | Run `git pull --rebase origin main` first to pull in any changes you don't have locally, then push again. Or ask Claude Code: "resolve this push rejection." |
| **Merge conflict** | Don't panic. Ask Claude Code to resolve it — paste the conflict and it'll fix the file. |
| **Claude Code hung / waiting for permission** | Press `Esc` to cancel the pending action. For routine read/write commands you trust, choose "Yes, and don't ask again for this session" to stop being prompted repeatedly. |
| **`BEGIN`/`COMMIT` not working in Supabase SQL editor** | The SQL editor uses a separate connection per browser tab. Multi-statement transactions must be run in the same tab, in one execution. |
| **iOS Safari looks different from desktop** | Almost certainly an overflow/height issue. Add explicit `height` (not just `max-height`) and `-webkit-overflow-scrolling: touch` to the scrollable container. See the iOS Safari entry in PROJECT_LOG.md → Decisions Log. |
| **Phone can't reach `localhost:3000`** | `localhost` only works on the same machine. Use a Vercel preview URL to test on your phone, or configure the dev server to expose itself on your local network (`npm run dev -- --hostname 0.0.0.0` and use your laptop's local IP). |

---

## Key files

| Path | Purpose |
|---|---|
| `app/layout.tsx` | Root layout; font loading, global CSS |
| `app/(main)/` | Route group for internal nav-bearing pages (gated by `AuthGuard`) |
| `app/(auth)/login/page.tsx` | Styled login — `signInWithPassword`; "Forgot password?" → `resetPasswordForEmail` |
| `app/(auth)/reset-password/page.tsx` | New-password page — `updateUser({ password })` |
| `components/auth/AuthGuard.tsx` | Client-side route guard wrapping `app/(main)/layout.tsx`; redirects unauthenticated users to `/login` (localStorage sessions; no SSR middleware) |
| `hooks/useUserProfile.ts` | `{ profile, loading }` — resolves the logged-in user's `user_profiles` row by session email. Single source of profile-fetch logic |
| `supabase/user_profiles.sql` | Migration: `user_profiles` table + seed (run manually in Supabase SQL editor) |
| `supabase/dashboard-tasks-assignment.sql` | Migration: `dashboard_tasks.assigned_to` / `assigned_by` uuid FK → `user_profiles.id` |
| `app/crm/page.tsx` | CRM — canonical pattern reference for all new pages |
| `app/clients/page.tsx` | Clients list + detail panel |
| `app/register/[token]/page.tsx` | Public registration form (no nav) |
| `app/api/cron/auto-demote/route.ts` | Vercel Cron endpoint — demotes Hot/Warm leads daily at 9am |
| `lib/supabase.ts` | Supabase client + all entity types (`Lead`, `Client`, etc.) |
| `lib/settings.ts` | Timer constants (COOL_DOWN_DAYS, TOUCH_INTERVAL_DAYS) |
| `lib/terms.ts` | T&Cs content as structured array — update here without touching form |
| `styles/globals.css` | CSS variable definitions + Google Fonts import |
| `components/layout/Nav.tsx` | App nav (only renders inside `(main)` route group) |
| `components/shared/StudioSelect.tsx` | Single flat dropdown for "Venue · Studio" selection; used across CRM and calendar |
| `components/shared/TimeInput.tsx` | Smart-parse text `<input>` with auto-format on blur. Accepts `10a`→`10:00 AM`, `930p`→`9:30 PM`, `1430`→`2:30 PM`, bare `8`→`8:00 AM`. Enter commits. Used in booking form and WO Studio Time From/To cells. (Was briefly a 30-min `<select>` June 5–10, 2026 — reverted; select was harder to use on mobile.) |
| `components/shared/` | Reusable pickers: `ContactPicker`, `ArtistPicker`, `StudioSelect`, `TimeInput` |
| `lib/studios.ts` | `STUDIO_LOCATIONS` array + `parseLocation()` / `combineLocation()` for the "Venue · Studio" string format |
| `lib/roster.ts` | Label artist array helpers: `addArtistToLabel`, `removeArtistFromLabel`, `getArtistsForLabel` |
| `components/shared/RegViewModal.tsx` | Registration record view modal (used by CRM lead card + Clients profile). Fetches client data + signed ID photo URL on open; Export PDF button opens print route. |
| `components/calendar/WorkOrderPopup.tsx` | Full Work Order modal. Studio time table, equipment, rentals, payments, notes, signature. Writes to `work_orders` + `bookings` on Close & Save (syncs `start_date`/`end_date`/`from_time`/`to_time` from dated `studio_time_rows`; does NOT sync `studio`). Fires `onSaved` after all writes complete. Accepts an `inline?: boolean` prop — when set, renders in normal document flow (no fixed overlay/backdrop) for embedding inside `UnifiedSessionForm`. |
| `components/unified/UnifiedSessionForm.tsx` | **Experimental** single-surface session form (client card + Work Order in one natural-flow modal); renders `WorkOrderPopup` inline. Owner-gated via a temp "⚡ USF" Nav button (`localStorage.userRole === 'owner'`). Parallel to — not a replacement for — the production `BookingForm` + portaled `WorkOrderPopup` flow. |
| `app/register/view/[clientId]/page.tsx` | Print route for registration PDF. Server component; generates signed ID photo URL server-side. `PrintTrigger` fires `window.print()` after 800ms. |
| `app/(main)/sop/page.tsx` | SOP / Training tab — full-viewport iframe pointing to `/sop.html` |
| `app/(main)/daily-ops-log/page.tsx` | Daily Ops Log route — wraps `DailyOpsLogSection`; also embedded as Admin sidebar tab |
| `app/runner/[studio]/wo/[id]/page.tsx` | Runner WO form — studio time table, equipment condition, expenses, eng hours, receipt OCR, canvas signature pad (COD-only), payment rows (editable), Save/Finish footer |
| `app/(main)/wo-hub/page.tsx` | WO Hub — all work orders list, filterable by studio/date/status; linked from nav |
| `components/admin/DailyOpsLogSection.tsx` | Date-based historical ops log per studio; studio tabs, date list with status dots, day modal (WO cards + 5 checklist rows with Runner/Admin checkboxes); click WO card → WorkOrderPopup |
| `components/admin/MicInventorySection.tsx` | Admin "Mic Inventory" sidebar tab. Consolidated cross-studio mic view: full-width missing-mic banner, horizontal studio tabs (Paramount/Ameraycan/Encore/Track/Floating Gear), status-colored table (Here/Room/Missing), per-tab Show History (last 7 nights). **Admin editing (June 24):** per-row `✎` turns the row's cells into in-place inputs (Status dropdown, per-studio Room dropdown, Qty, "Initials" field) → upserts `mic_checkins` with `source:'admin'`/`amended_by`; a changed Qty upserts `mic_inventory_quantities`. **Manage Mics modal:** Master Mic List (search, inline edit name/studio/category/qty, deactivate/reactivate) + Add Mic; mic catalog writes to `mics`, qty to `mic_inventory_quantities`. Reads `mics`/`mic_checkins`/`mic_inventory_quantities`/`mic_inventory_submissions`, reduced client-side to latest-per-(studio,mic). |
| `app/runner/[studio]/mics/page.tsx` | Runner mic inventory — collapsible sections (home/other/floating/odds & ends), Here/Room/Missing per mic with room picker, qty steppers for odds & ends, Save (progress) + Submit (initials-gated) writing `mic_checkins`/`mic_inventory_quantities`/`mic_inventory_submissions` + `daily_ops_submissions` |
| `components/dashboard/LocationStrip.tsx` | 4-studio dashboard strip; drawer with Yesterday/Today sessions + daily ops rows; real-time subscriptions |
| `lib/checklist-items.ts` | Per-studio opening/closing checklist items; `CHECKLISTS[studio][type]`, `getChecklistSections()`, `flattenSections()` |
| `public/sop.html` | Self-contained interactive training guide. Replace file to update content; no code change needed. |
| `components/ui/StatusBadge.tsx` | Unified status pill (5px dot + uppercase label, translucent tinted bg/border). Canonical renderer for record statuses. Color map: gray (uncontacted/open/dead), orange (hot/pending/tentative), yellow (warm), blue (cold), teal (booked/completed/resolved/confirmed), lime (needs_action/in_progress), red (cancelled); unknown→gray. |
| `components/ui/SectionHeader.tsx` | Unified section heading: uppercase DM Mono 11px title (`#9ca3af`) + optional count pill (`lime`/`orange`/`teal`) + optional right-aligned action link (`{label, href?\|onClick?}`), `margin-bottom: 12`. For section/panel headings only — not page titles, tabs, or field-group labels. |
| `schema.sql` | Full database schema — run in Supabase SQL editor to recreate |

---

## Environment variables

All must be set for **all three Vercel environments** (Production, Preview, Development):

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron endpoint (server-side) |
| `CRON_SECRET` | Cron endpoint auth header |
| `NEXT_PUBLIC_BASE_URL` | Registration link URL base (e.g. `https://prs-flow.vercel.app`). Falls back to `window.location.origin` if unset, which produces `localhost` URLs in dev — fine for testing but wrong for links sent to clients. Set this in Production and Preview. |
| `ANTHROPIC_API_KEY` | `/api/ocr-receipt` receipt OCR (server-side) |

---

## Design system tokens

Defined in `styles/globals.css`:

```
--bg           #0d0f14        Page background
--surface                     Slightly lighter than bg; input/card backgrounds
--surface2                    Active nav, panel backgrounds, checkbox containers
--border                      Subtle dividers and input borders
--text                        Primary text
--text2                       Secondary text
--text3                       Muted/tertiary text, section labels
--accent       #c8f04e        Yellow-green; buttons, highlights, active states
--hot          #f04e7a        Pink-red; Hot status, validation errors
--warm         #f0a24e        Orange; Warm status
--cold         #4e8ff0        Blue; Cold status
--booked       #4ef0a2        Green; Booked status
--uncontacted  #4ef0db        Cyan; Uncontacted status
```

---

## Roadmap

### Done

| Chunk | What shipped |
|---|---|
| **Chunks 1–4 complete ✅** | **CRM + Clients — production-ready** |
| 1–3 | CRM core: Needs Action (Hot/Warm/Cold/Uncontacted tabs), All Leads with date separators + filters, touch logging, Keep Hot/Warm timers, Park feature, auto-demotion via Vercel Cron |
| 4.3 | Clients list page: two-column layout, filter chips, search, sort, pagination |
| 4.4 | Client detail panel: inline editing for label + COD views, contacts (A&Rs), artist chips, booking history, notes |
| 4.5 | Book Client modal: three-path flow (new/existing/label), registration token generation, `ContactPicker` + `ArtistPicker` reusable components |
| 4.6 | Public registration form at `/register/[token]`: token validation, all fields + inline validation, ID upload to Supabase Storage, client creation + lead backfill, route group isolation |
| 4.6b | Registration form improvements: iOS camera capture, scrollable T&Cs with iOS Safari overflow fix |
| 4.7 | Polish: registration QC notification banner on Clients page, empty states, confirm dialogs, mobile responsiveness |
| 4.9 | Detail card redesign: 2-col Contact + Session grids, cascading Location/Studio dropdowns, 12h TimeInput, editable Last Contact, session date picker, pills inline with name, Clients nav badge for pending registrations, Needs Action daily reset cron |
| **Chunk 6 calendar polish ✅** | **View switching, zoom, StudioView, scroll correctness** |
| 6-polish | Dynamic colW per view (week/2wks/month show correct date ranges), view-switch snaps to current Sunday, rAF shiftingRef guard fixes scroll race on column-width change, useLayoutEffect for initial grid measurement, StudioView blocks styled to match main calendar (black bg + status top bar, never truncates), zoom floor = Fit (removed 44px level), no post-scroll snapping |
| **CRM & Booking polish ✅** | **StudioSelect, label roster, A&R Admin, booking form improvements** |
| crm-polish-1 | New lead form: Source + Studio/Location dropdowns (replacing free text), Notes placeholder, COD mode hides Company/Label fields |
| crm-polish-2 | `lib/studios.ts` + `StudioSelect` component (flat "Venue · Studio" dropdown); `rate_daily` toggle on CRM and booking forms; booking form wired to StudioSelect + lead pre-fill |
| crm-polish-3 | `lib/roster.ts` — shared write gateway for `clients.artists[]`; roster-backed A&R + artist dropdowns on lead form, booking form, and client profile; Artists roster section on client profiles |
| crm-polish-4 | StudioSelect redesigned as true flat dropdown; lead form field order; "Move to Booking" navigates to `/calendar` |
| anr-admin-d1 | Admins section on label client profiles; `bookings.anr_contact_id` + `anr_admin_contact_id` FK columns added to schema |
| anr-admin-d2 | Admin dropdown in booking form; FK IDs saved on every booking write; contact popovers (A&R + Admin names → email/phone + action links) |
| anr-admin-d2b | Label booking card field order: Artist → A&R → Admin; name-as-popover-trigger; artist tiles in A&R card headers |
| label-card-inline | Inline A&R/Admin email/phone with Email/Call/Text buttons in booking card; underline `hasInfo` indicator; remove Edit/× from card header |
| **Registration status + view ✅** | **3-state reg button, view modal, PDF print route, multiple bug fixes** |
| chunk-crm-reg-view | 3-state registration button (Send Reg / Reg Sent / ✓ Registered); three-step token lookup on lead open; `generateRegLink()` stores `client_id` on token; `refreshRegStatus()` detects completion on Reg Sent click without page refresh; reg button hidden for Label/Billing leads |
| reg-view-modal | `RegViewModal` shared component (CRM + Clients profile); full registration record display with ID photo + Export PDF; `/register/view/[clientId]` print route with Paramount header |
| reg-fixes | 4 bug fixes: reg staying on Send Reg after completion, Use & Link not reflecting status, leads with client_id showing wrong state, re-query on click for real-time update |
| **Contact action buttons ✅** | **Call/Text/Email `<a>` links on all contact surfaces** |
| contact-actions | Lead detail card, COD client profile, A&R card headers, Admin card headers — all surfaces now have inline tel:/sms:/mailto: action links when field has a value |
| **SOP / Training tab ✅** | **Static training guide in nav** |
| sop-tab | `/sop` route + iframe; `public/sop.html` served statically; replace file to update guide with no code changes |
| **Global select styling ✅** | **`appearance: none` on all select elements** |
| select-styling | `styles/globals.css` global select rule strips native OS chrome so inline styles fully control appearance across all browsers and views |
| **WO save/sync overhaul ✅** | **Close & Save writes to work_orders + bookings; onSaved refetches + reopens form** |
| wo-sync | `handleClose` writes synced fields to both `work_orders` and `bookings`; `onSaved` prop refetches booking by ID and reopens form with fresh data; `initWO` query fixed from `.maybeSingle()` to `.limit(1)` (was creating hundreds of duplicate WOs); `liveForm` memoized to prevent spurious remounts |
| wo-time-table | FROM/TO removed from WO meta grid (redundant); studio time rows use `TimeInput`; single-day sessions seed stRow times from `liveForm` on open |
| wo-print | `@media print` CSS overhauled: centered full-width, `@page` 0.5cm margins, no scale transform, signature section stays on page; PDF filename via `document.title` |
| **Booking form polish ✅** | **Engineer edit-in-place, TBD button, multi-day label** |
| booking-polish | Engineer name clickable to reopen search pre-filled (ref-based to avoid stale closures); TBD button grey until active; multi-day sessions show "Edit times in WO" instead of FROM/TO inputs |
| **WO & daily ops amendment ✅** | **Runner Finish flow, NA photos, approval loop, Ops Log** |
| wo-daily-ops-amendment | `runner_finished` + `admin_approved` fields on `work_orders`; runner Finish button + confirmation dialog (WO stays editable after finish); NA notes + photo upload to `checklist-photos`; admin NA thumbnails in WorkOrderPopup; admin approve WO inline from LocationStrip drawer; WO z-index raised to 10010 above drawer |
| daily-ops-log | `/daily-ops-log` route + `DailyOpsLogSection` component; embedded as Ops Log tab in Admin sidebar alongside Engineers and SRS Log; shows approved WOs + ops submissions; click WO → WorkOrderPopup; click ops → DailyOpsModal |
| runner-post-amendment | UTC→local date fix on LocationStrip and all runner pages (`getLocalDateStr()`); runner WO footer redesigned (Cancel / Save / Finish three-button layout); NA photo `getPublicUrl()` + delete button; session card full-card tap target; approved WO 8am rule (stays in Today until operational day advances) |
| runner-session-info | Runner WO session info reads from live booking record (fetches booking after getting `booking_id` from WO); Label/A&R field shows `"LabelName / ContactName"`; artist card tap target; non-cancelled filter matches admin view |
| **Runner real-time ✅** | **`postgres_changes` subscriptions across all runner pages** |
| runner-realtime | `postgres_changes` on `bookings` + `work_orders` across runner hub, studio page, and WO page; session counts + WO badges update live; requires `ALTER PUBLICATION supabase_realtime ADD TABLE` + `REPLICA IDENTITY FULL` per table |
| **Day-rate WO ✅** | **Two-layout Studio Time table, charge fix, multi-day reconciliation** |
| day-rate-wo | Studio Time table has two layouts: day-rate (compact Date/Room/Hours/Rate/Charge) vs. hourly (multi-row time ranges); correct charge calculation; multi-day day-rate reconciles missing `studio_time_rows` on WO open; duplicate rows eliminated via upsert-by-sort_order |
| **Equipment Condition ✅** | **Horizontal scroll, sticky col, Not OK popup, PDF exclusion** |
| equip-condition | Equipment Condition table: horizontal scroll + sticky first column; Not OK cell opens inline popup for notes + photo upload; section excluded from WO PDF print |
| **WO live sync fixes ✅** | **Stale reads, form revert, post-save rate sync** |
| wo-live-sync | `isDayRate` reads from `liveForm` not stale `booking.*`; `wo?.id` added to reactive effect dep arrays so they re-run after `initWO`; post-save rate/date sync runs on every booking save (not day-rate only); `onSaved={undefined}` stops WO Close & Save from remounting booking form (preserves unsaved edits) |
| **Real-time project standard ✅** | **All four surfaces: runner WO stRows, admin WO popup, LocationStrip, calendar** |
| realtime-project-wide | Runner WO: `studio_time_rows` channel by WO id. Admin WorkOrderPopup: `studio_time_rows` + `work_orders` channels via `resolvedWoId` state. LocationStrip: `fetchDrawerData()` split from `openDrawer()` for silent refresh; `selectedLocRef` for callbacks. Calendar: `loadRef.current = load` pattern for stable subscription without re-subscribing |
| **Engineer in WO ✅** | **`bookings.engineer_rate`, eng sub-row in Studio Time, Engineer Total, runner compact table, auto-seed** |
| engineer-in-wo | `bookings.engineer_rate` text field (blank default); engineer sub-row in Studio Time on admin WO popup + runner WO page, both day-rate and hourly layouts; Col 1 blank, Col 2 eng name, eng_hours editable (rate locked on runner); `eng_charge = eng_hours × eng_rate`; Engineer Total in WO totals block; post-save rate sync from `bookings.engineer_rate` to `studio_time_rows.eng_rate`; runner compact table replaces stacked card view; auto-seed `studio_time_rows` from booking on WO open when none exist |
| **Ops Log search + nav cleanup ✅** | **Search bar in DailyOpsLogSection; Ops Log removed from top nav** |
| ops-log-search | Case-insensitive live filter in DailyOpsLogSection by client, artist, studio, engineer, invoice number; Ops Log nav item removed from top nav (accessible only from Admin sidebar tab) |
| **Runner session hero ✅** | **Artist name as primary headline on runner session cards** |
| runner-session-hero | Runner studio page session cards: `b.artist || b.client_name` as large hero; client name as smaller secondary text only when both present; matches admin SessionCard in LocationStrip drawer |
| **WO eng UX fixes ✅** | **eng hours default, $55 removed everywhere, date reconciliation for hourly, RT sync** |
| wo-eng-fixes | `normalizeStRow` defaults `eng_hours` from `total_hours` → `calcHours` when null; `eng_charge` recomputed on normalize when both `eng_hours` + `eng_rate` available; $55 default removed from booking form, runner WO, and admin WO `engRateDisplay`; Eng subtotal line added to Studio Time inline footer; live date range sync `useEffect` runs for both day-rate and hourly (no `isDayRate` guard); runner RT accepts admin-set `eng_hours` without overwriting runner-typed values; `bkData` fallback to URL `bookingId` param when `woData.booking_id` is null |
| **Per-row rate type + unified Studio Time table ✅** | **Architecture: each row toggles day/hour independently; single 9-col table replaces dual layouts** |
| per-row-rate-type | `studio_time_rows.row_rate_type` + `row_rate_daily` columns; `toggleRowRateType()` converts rate on toggle; booking-level rate-sync effects deleted; `normalizeStRow` branches on `row_rate_type`; unified Date\|SessionInfo\|From\|To\|Hrs\|Type\|Rate\|OT\|Total table in admin WorkOrderPopup + runner WO page; Type cell has Day/Hr inline toggle (admin) or display label (runner); `TimeInput` changed to 30-min `<select>` with 48 options; OT rate auto-populates from hourly rate; `shortDate()` helper for `M-D` date format; admin cell dividers removed; runner compact 444px table |
| **Runner WO UX polish ✅** | **Notes bottom sheet, iOS Safari scroll lock, viewport fixes, eng initials popover, PDF session notes** |
| runner-wo-ux | Notes bottom sheet: `position: fixed` floating card (`bottom:16, left:12, right:12, borderRadius:12`); iOS scroll lock via `body.position=fixed + top=-scrollY` pattern (not `overflow:hidden`); `Viewport` export in `app/layout.tsx` sets `maximumScale:1, userScalable:false`; runner root containers `maxWidth:100vw, overflowX:hidden`; eng name → initials pill with tap-to-expand fixed popover; `<span data-si-print>` reveals session notes in `@media print`; admin session info cell opens 280px popover with editable textarea |
| **Studio Time bugfixes ✅** | **Post-unification fixes: OT auto-calc, native date picker overlay, insert fixes, session notes restored, mobile column widths** |
| studio-time-fixes | 12-col admin / 11-col runner tables finalized; Session Info column restored (admin popover); OT auto-calc from `max(0,hours-12)`; OT Rate auto-seeded; new row auto-populates from previous; date cell → transparent `<input type="date">` overlay with auto-save + auto-sort on pick; all `upsert(onConflict)` → `insert()` (constraint never existed); removed invalid `booking_id` from runner insert; stripped `$`/`,` from `ot_rate` before write; `wo?.id` removed from date-range sync effect deps to fix initWO race; runner mobile column widths corrected |
| **WO status cycling ✅** | **`studio_time_rows.status`: in_progress → submitted → approved; runner Finish and admin Approve scoped to today's rows; status dots in Date cell** |
| wo-status-cycling | `status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','approved'))` column on `studio_time_rows`; runner Finish submits today's rows; admin Approve approves today's rows; orange dot `#fb923c` = submitted, lime dot `#c8f04e` = approved in Date cell top-right; all insert sites seed `status:'in_progress'`; dots render based on `r.status` for all rows regardless of date |
| **Confirmed sessions + multi-day ✅** | **Daily Ops + runner hub filter to confirmed only; lte/gte date range for multi-day; badge driven by stRow status; RT channel for stRows** |
| confirmed-multiday | `.eq('status','confirmed')` on all booking queries; `.lte('start_date',today).gte('end_date',today)` for multi-day support; `pendingCount` badge derived from `studio_time_rows.status='submitted'` cross-referenced to WO ids; third LocationStrip RT channel on `studio_time_rows` UPDATE; approved sessions drop from Today drawer column |
| **WO Hub + WO status simplification ✅** | **`/wo-hub` route; WO status is `open`/`completed` only** |
| wo-hub | New `/wo-hub` page listing all WOs filterable by studio/date/status; WO status simplified to `open`/`completed`; "Complete WO" button toggles without locking popup; runner_finished flow removed (stRow status is the granular mechanism) |
| **Studio Time local-first ✅** | **All edits held in state, single DB commit on Save; Cancel fully reverts** |
| studio-time-local-first | All Studio Time cell edits (times, rate, type, date, add/delete row, eng clear) queued in React state; written to DB in batch on Close & Save; Cancel deletes pending inserts + restores pending deletes; WorkOrderPopup real-time subscription on `studio_time_rows` removed while popup is open |
| **`eng_visible` + `admin_locked` columns ✅** | **Eng sub-row visibility + row lock state persisted to DB** |
| eng-visible | `studio_time_rows.eng_visible boolean DEFAULT false` and `admin_locked boolean DEFAULT false`; eng sub-row shows/hides based on persisted DB value; locked rows read-only for runner; replaces ephemeral `autoEngRows`/`clearedEngRows` React state |
| **TimeInput rewrite ✅** | **Smart-parse text input replaces 30-min select** |
| timeinput-rewrite | `components/shared/TimeInput.tsx` rewritten to smart-parse text `<input>`; `parseTime()` handles AM/PM suffix, 24h numeric, colon format, already-normalized values; reverted from the June 5 `<select>` for mobile usability |
| **Runner WO bottom sections ✅** | **Rebuilt notes, equip, expenses; Session QC removed from nav** |
| runner-wo-bottom | Notes floating card (`position:fixed, bottom:16`); equipment horizontal scroll + sticky col; expenses inline add/remove; Session QC nav item removed |
| **Canvas signature pad + payment improvements ✅** | **COD-only legal section; payment type dropdown + memo + last_four; currency auto-format** |
| canvas-signature | `work_orders.print_name` + `work_orders.signature_data` (base64 PNG) replace `legal_signature/legal_name/legal_date`; COD-only guard; `touchAction:none` on canvas; `initialSigRef` pattern for reloading existing sig; both admin WO + runner WO aligned |
| payment-improvements | Payment type dropdown (Cash/Zelle/Credit Card/Debit Card/Check/Other); `memo` text field; `last_four` text field (Credit/Debit only); `× remove` per row; runner payment section now editable; `formatCurrency`/`stripCurrency` helpers; `$`/`,` stripped before DB write |
| **Mic Inventory UI ✅** | **Runner mic inventory page with collapsible sections, Here/Room/Missing status, qty steppers, submit flow** |
| mic-inventory-ui | `/runner/[studio]/mics` page built; collapsible sections per mic category; Here/Room/Missing condition tracking; qty steppers; submit flow; appears in Yesterday checklists (`liveDoc: false` fix) |
| **dashboard_tasks table ✅** | **Supabase migration: per-role task system table** |
| dashboard-tasks-migration | `dashboard_tasks` table: `assigned_role` CHECK ('admin','studio_manager','asst_manager','billing'), `source` CHECK ('manual','runner_flag','wo_flag'), `photo_url text`, soft delete via `deleted_at`, `set_updated_at()` trigger, RLS enabled with placeholder `USING (true)` on INSERT/UPDATE/DELETE until Chunk 9 auth; SELECT filters `deleted_at IS NULL`; GRANT to `authenticated` + `anon` (anon grant added Session 3a — app uses anon key pre-auth) |
| **Dashboard rebuild ✅** | **3-column dashboard layout: Needs Action, Today's Sessions, Tasks placeholder** |
| dashboard-rebuild | `app/(main)/page.tsx` rewritten; `TodoModule` + `QCHomeWidget` removed; 3-col grid (`1fr 2fr 1fr`). Col 1: Needs Action — top 5 hot/warm/uncontacted leads (`needs_contact=true`, excludes cold/dead/booked), status badge, "View all in CRM →". Col 2: Today's Sessions — confirmed (#14B8A6) + tentative (#F97316) sections with colored left-border rows, `b.artist\|\|b.client_name`, session_type badge, time + location. Col 3: Tasks placeholder (replaced by live Tasks panel in Session 3a). Cold leads exclusion fix in follow-up commit. |
| **Dashboard Tasks panel ✅** | **Session 3a: live ticket-style task system wired to dashboard Col 3** |
| dashboard-tasks-session-3a | `dashboard_task_comments` table (per-task comment thread, append-only, anon+authenticated INSERT/SELECT). `dashboard_tasks.photo_url` column added. Tab→role mapping: Me=admin, Mgr=studio_manager, Asst=asst_manager, Billing=billing. Task list fetches by role, rows clickable. Inline add task form with optional photo (to `checklist-photos` bucket). Task modal: title, task photo, comment thread with photos + timestamps, textarea + attach photo, Comment + Complete buttons. `created_by_name` from `supabase.auth.getUser()`, falls back to `'Staff'`. `DashboardTaskComment` type + `DashboardTask.photo_url` added to `lib/supabase.ts`. |
| **Yesterday checklist rows ✅** | **Color-coded state, approve flow, 8am reset** |
| yesterday-checklist-rows | LocationStrip drawer Yesterday ops rows always render (grey when no submission). Color states: green=approved, orange=submitted, grey=in-progress. Approve button on each row updates `admin_approved_at` + removes row from Yesterday column immediately. |
| **Dashboard Tasks panel polish ✅** | **Card-row layout, count badge, history modal, runner flag accent** |
| dashboard-tasks-polish | Task rows restyled as cards with border + source pills. Count badge on tab header. "X completed →" history link opens completed-tasks modal with search. History rows clickable → read-only ticket modal. Runner flag orange left-border accent on auto-generated tasks. Dot colors: orange = open, teal = completed in history. |
| **Runner quick action card submitted state ✅** | **Green border when submitted today; fixed submitted state queries** |
| runner-quick-action-state | Quick action tiles on runner studio hub show green `#4ef0a2` left border when submitted today. Submitted state queries both `checklists.completed_at` (checklist types) and `daily_ops_submissions.submitted_at` (all categories). Stock page now writes to `daily_ops_submissions` on save. All runner pages auto-navigate to hub after Save or Submit. |
| **Runner Save + Submit pattern ✅** | **Save preserves progress; Submit marks complete; initials required hint** |
| runner-save-submit | Checklist and mics pages: Save persists to `checklists`/`mic_checkins`/`mic_inventory_quantities` without writing `submitted_at`; Submit writes `submitted_at` to `daily_ops_submissions`. Mics page restores prior checkin/quantity from DB on load. Red "Required to submit" hint anchored below initials input on Submit with empty field. |
| **Runner daily ops submission fixes ✅** | **Local date, OPS_CATS key, immutable save, column schema** |
| runner-daily-ops-fixes | UTC→local date fix on checklist, stock, petty-cash `daily_ops_submissions` writes. LocationStrip OPS_CATS `'stock_list'` → `'stock'` key fix. Immutable save pattern for stock and petty-cash (eliminates duplicate inserts from direct React state mutation). Removed non-existent columns from checklist `daily_ops_submissions` upsert that were causing silent 400 errors. |
| **Daily ops Today/Yesterday view fixes ✅** | **Approved items and completed WOs no longer disappear from wrong column** |
| daily-ops-view-fixes | Today column no longer filters out approved ops rows (approval doesn't hide them until the day advances). Yesterday column no longer filters out completed WOs — `pastRetentionWindow` guard scoped to Today's `activeTodayBkgs` only. |
| **Petty cash running ledger ✅** | **All-time ledger, most-recent balance, In/Out toggle, admin always visible** |
| petty-cash-ledger | Loads all prior entries for the studio (not just today); most-recent `petty_cash_balances` row for opening balance; In/Out tap-to-toggle replaces `<select>`; save errors surfaced inline; admin balance view unblocked from runner submission state. |
| **Daily Ops Log rebuilt ✅** | **Date-based historical view with studio tabs, status dots, day modal — replaces flat mixed table** |
| daily-ops-log-rebuild | Studio tabs (Paramount/Encore/Ameraycan/Track); date list sorted most-recent first with teal/amber/grey status dots; Load More (25 at a time); day modal shows WO cards + 5 checklist rows with Runner/Admin checkboxes; WO card click opens WorkOrderPopup. |
| **Flags system ✅** | **Structured issues log: dashboard panel, flag modal, acknowledge/resolve, runner/WO auto-flag, Admin log** |
| flags-system | `flags` table (id, studio, source manual/runner_flag/wo_flag, runner_note, category facility_general/gear_equipment/client_billing, status pending/acknowledged/resolved, deleted_at soft delete). `flag_comments` table (flag_id FK CASCADE, text, photo_url, created_by_name, created_at; append-only). `Flag` + `FlagComment` types in `lib/supabase.ts`. Dashboard panel: 4 cards, studio pill, category badge, runner note snippet, lime "View all flags →". Flag modal: comment thread, Acknowledge (+ category reassignment dropdown), Resolve sub-modal (resolution note / vendor / cost → appended as flag_comment + status=resolved). Soft delete with inline confirmation on card (×) and inside modal. Runner checklist NA submissions and WO NA submissions auto-insert flags with source=runner_flag/wo_flag respectively. Admin Flags Log tab (searchable by note/studio/category, per-row soft delete). |
| **Dashboard room grid ✅** | **Col 2 replaced with fixed 11-room grid and day navigation** |
| dashboard-room-grid | `ROOMS` constant (11 rooms: Paramount A/B/C/E/X, Ameraycan A/B, Encore A/B, Track North/South). `calDate` state + `‹`/`›` prev/next day buttons in panel header. `useEffect` dep `[calDate]`, bookings fetch uses `new Date(calDate)`. Grid: `gridTemplateColumns: '1fr 1fr 1fr'`, `gap: 4`, panel `height: 556`. Room match: `b.location === room.venue && b.studio === room.studio` (booking.location = bare venue name, not combined string). Booked card: teal `#14B8A6` or orange `#F97316` top border, DM Serif artist name (`var(--text)`), label sub-line (DM Mono, muted), compact time via `fmtSessionTime()`, `1ST-XX`/`2ND-XX` engineer+assistant initials bottom-right (teal=confirmed, amber=hold). Module-level helpers: `engInitials(name)` + `fmtSessionTime(t)`. |

| **Dashboard room grid → booking modal ✅** | **Booked cards open the booking form from the dashboard** |
| dashboard-room-grid-modal | Booked cards in the dashboard 11-room grid are clickable → open the booking form modal directly. Nav z-index reaffirmed (99999) above the modal. |
| **Booking form artist search + A&R autoselect ✅** | **Search matches artist names; picking one auto-resolves the A&R** |
| booking-artist-search | Client search returns client/label name, A&R name, and artist-name matches. Artist pick auto-selects the A&R, filling `ordered_by`/`anr_contact_id`/email/phone. `ClientProfile.saveContact` strips `id`+`client_id` from the `client_contacts` update payload. **Note:** the artist-match source and A&R filter were reworked the same day — see `artist-search-thru-contacts` below. |
| **UnifiedSessionForm (experimental) 🧪** | **Parallel single-surface session form; owner-gated** |
| unified-session-form | `components/unified/UnifiedSessionForm.tsx` combines client card + Work Order in one natural-flow modal (header → status chips → client card → work order). Renders the real `WorkOrderPopup` inline via a new `inline?: boolean` prop (normal flow, no fixed overlay/backdrop). Launched only from a temp "⚡ USF" Nav button shown when `localStorage.userRole === 'owner'` (no auth yet — Chunk 9). Does NOT replace the production `BookingForm` + portaled `WorkOrderPopup`; both coexist. First scaffold reverted, rebuilt as v2 against the real WorkOrderPopup. |
| **WO → Calendar sync ✅** | **Schedule round-trips WO↔booking; WO owns dates/times once it has real data** |
| wo-calendar-sync | WO Close & Save (`WorkOrderPopup.handleClose`) syncs `start_date`/`end_date` (earliest/latest dated `studio_time_row`) + `from_time`/`to_time` (earliest dated row) back to `bookings`. Calendar refetches via `onSaved={() => { loadRef.current(); setReloadKey(k+1) }}` (2wk/week grid reads `bookings`; DayView/StudioView read `reloadKey`). **Bugfix:** stopped syncing `studio` — `studio_time_rows.studio` is a bare letter (`'A'`) while the calendar filters full labels (`'Studio A'`), so synced bookings matched no room and blocks vanished (`3361fdb`); also removed stray `WorkOrderPopup 2.tsx`. **Ownership gating (`ce3194d`):** `calendar/page.tsx handleSave` strips the four schedule fields from the `bookings` update and skips day-rate stRow reconciliation when the booking's WO has ≥1 dated row (`woOwnsSchedule`) — the WO becomes the sole authoritative schedule writer; no-WO/empty-WO bookings still own + bootstrap. |
| **A&R artist persistence + artist-search rework ✅** | **Found the real persistence bug; routed artist search through A&R contacts** |
| ar-artist-persistence | **(`af957e8`)** A&R `client_contacts.artists[]` weren't persisting. Real cause: `app/(main)/clients/page.tsx` `load()` refetched `client_contacts` without `artists`/`contact_type`, so `onRefresh()` reset `ContactRow.localArtists` to `[]` (UI reverted) and the next save wrote `[]` back (DB wiped). Fix: added `artists, contact_type` to the select. DB write path was always healthy (direct PATCH persists, 204). Also repaired the A&R/Admin filter split that depends on `contact_type`. Corrects the earlier "strip `id`/`client_id` fixed the save" framing — the strip is correct practice but was not the persistence fix. |
| artist-search-thru-contacts | **(`d7c8e82`)** Booking-form artist search reworked: the third parallel query now fetches `client_contacts` (each A&R's own `artists[]` + `contact_type` + joined parent `clients`), pre-filtered `.neq('artists','{}')`, matched client-side — instead of scanning the label record's `clients.artists[]`. Result `record` is the parent client + `_artistMatch`; admins excluded via `ct.contact_type === 'admin'` continue (null-type kept). The `_artistMatch` autofill re-query changed from `.neq('contact_type','admin')` to `.or('contact_type.eq.anr,contact_type.is.null')` because PostgREST `.neq` drops NULL-type rows (most A&Rs). |
| **Admin Mic Inventory tab ✅** | **Read-only consolidated cross-studio mic view with missing-mic alerts** |
| admin-mic-inventory | **(`8529b8b`, `eefd6c1`)** `components/admin/MicInventorySection.tsx` added as a fifth Admin sidebar tab (`mic_inventory`). Full-width dismissable missing-mic banner (every mic whose latest checkin across any studio is `missing`). Horizontal studio tabs (Paramount/Ameraycan/Encore/Track/Floating Gear) with mic count + red missing badge + active-tab color underline. Table: Mic Name \| Status \| Room \| Qty \| Last Submitted By \| Date; Here `#14B8A6` / Room `#F97316` / Missing `#ef4444`; missing rows red left border + tint; sort missing→room→here→none then `sort_order`. Per-tab Show History (last 7 checkin nights per mic). Reads `mics`/`mic_checkins`/`mic_inventory_quantities`/`mic_inventory_submissions`, reduced client-side to latest-per-(studio,mic); studio tabs resolve by home studio, Floating + banner resolve across any studio. No new tables, read-only. Tab started as collapsible vertical sections (`8529b8b`), refactored to horizontal tabs (`eefd6c1`). |
| **Admin Mic Inventory editing ✅** | **Inline-cell status editing + Manage Mics modal; `mic_checkins.source`/`amended_by`** |
| admin-mic-editing | **(`6dfb4d6`, `e8d234c`, `b091758`, `fdecc26`, `65d2cda`)** Migration: `mic_checkins` + `source text NOT NULL DEFAULT 'runner'`, `amended_by text`. Per-row `✎` turns the row's own cells into in-place inputs (single shared `GRID_COLS` so they align under headers; lime tint on the editing row): Status dropdown, per-studio Room dropdown (`STUDIO_ROOMS`, status=Room only), Qty numeric, Last-Submitted-By with greyed "Initials" placeholder. Save upserts `mic_checkins` (`onConflict mic_id,studio,date`, overwrites that day's row) with `source:'admin'`/`amended_by`; changed Qty also upserts `mic_inventory_quantities`. Teal ADMIN badge on admin-sourced rows (main/history/banner). Manage Mics modal: Master Mic List (search, inline edit, deactivate/reactivate — qty→`mic_inventory_quantities`) + Add Mic (→ `mics`, `sort_order=max+1`). Component now loads ALL mics, derives active-only for display, reloads after every write. |
| **Engineers table actions fix ✅** | **Edit/Deactivate no longer overlap the Status pill** |
| engineers-actions-col | **(`898ecb0`)** Admin Engineers table actions column was 80px but holds Edit + Deactivate (~150px); `flex-end` overflow spilled left over the 80px Status pill. Widened the actions column 80px→180px in both header and row grid templates. |
| **UI polish pass ✅** | **Shared StatusBadge + SectionHeader primitives, nav tab underline, room-grid/chip glow** |
| ui-polish | **(`052819d`, `288947b`, `62ad623`, `d628449`, `1810e53`)** `components/ui/StatusBadge.tsx` + `components/ui/SectionHeader.tsx` replace ad-hoc status text and section headings across dashboard, CRM, admin, wo-hub, flags, and WorkOrderPopup (CRM's local `SectionHeader` field-label helper renamed `FieldGroupLabel`). Nav tabs restyled to a bottom-border underline (active 2px `#c8f04e` + `#e8eaf0`, inactive `#6B7280`/hover `#9ca3af`, full-height DM Mono 11px tabs); calendar tab count badge removed (`tentativeCount` state/fetch kept). Dashboard room-grid cards get teal/orange state glow + 2px top bar; calendar booking chips recolored confirmed `#22c55e`→`#14B8A6` (all three `STATUS_TOP_COLORS` maps) + subtle glow on BookingBlock/DayView/StudioView — "open-WO" orange maps to the existing `tentative` signal (no WO data fetched on those surfaces). CRM lead-row card redesign (`f934716`) was reverted (`3df8016`), not shipped. |

| **Auth — login + route protection ✅** | **Supabase Auth login, forgot/reset password, client-side guard** |
| auth-login | `app/(auth)/login` (`signInWithPassword` → `/`; `resetPasswordForEmail`) + `app/(auth)/reset-password` (`updateUser`); `components/auth/AuthGuard.tsx` wraps `(main)` layout (checks `getSession`, redirects to `/login`, `onAuthStateChange`); login bounces authed users to `/`. Client guard (no `@supabase/ssr`/middleware; localStorage sessions); `(main)` routes only — runner/register/auth public. Nav Sign Out button. UX gating, not data security (RLS off). Also: nav clock upgraded (12px/`#e8eaf0`/500) + redundant dashboard date/time block removed. |
| **Schema — user_profiles + task assignment ✅** | **`user_profiles` table + `dashboard_tasks.assigned_to`/`assigned_by`** |
| user-profiles | `supabase/user_profiles.sql` (surrogate `id` PK, nullable `auth_user_id` FK→auth.users, `email` unique lookup key, role `owner/manager/billing/asst_manager/tech`, soft delete; seed 6→8 staff; run manually in SQL editor — Claude has no DDL access). `supabase/dashboard-tasks-assignment.sql` adds `assigned_to`/`assigned_by` uuid FK→`user_profiles.id`. Role set + roster changed in the live DB after the migration. |
| **Personalized greeting + task panel rebuild ✅** | **`useUserProfile` hook; 6 per-user task tabs; add-task + detail modals** |
| task-panel-rebuild | `hooks/useUserProfile.ts` (resolve profile by session email); greeting shows `display_name`. Dashboard task tabs rebuilt to 6 per-user tabs (Eli/Adam-Mike/Fernando/Aaron/Asst Mgr/Tech) resolved by display_name (no hardcoded UUIDs), driven by `assigned_to`; visibility by role (owner/manager/billing all; asst_manager→Asst Mgr; tech→Tech); horizontally scrollable tab bar (`.hide-scrollbar`). Full add-task modal with flat Assign-to dropdown (Asst Mgr→Quinn's id, Tech→Sierra's id; owner/manager/billing only). Task detail modal redesigned (Complete header button; description + assigned meta + UPDATES thread + comment Submit; footer Delete[canAssign]/Cancel/Save&Close); task rows single-line truncated. `assigned_role` vestigial (new tasks set `'admin'`). |
| **Add-task photo 🚧** | **"Photo not saving" — under investigation (resume June 26, 2026)** |
| add-task-photo | Probes confirm `dashboard_tasks.photo_url` exists, insert persists it, `uploadPhoto` returns a valid URL — recent NULL rows were tasks saved without a photo attached. Added thumbnail preview (`URL.createObjectURL`) + `.select()` insert-error logging (`056aa79`). Next: reproduce, read console error, check bucket anon INSERT policy + filename sanitization. |

### Next

| Priority | What's next |
|---|---|
| **🚧 In progress** | **Add-task photo not saving** — finish debugging (June 26): reproduce with the new thumbnail preview, capture any console error, check `checklist-photos` bucket anon INSERT policy + filename sanitization |
| Medium | **Activity log on session form and WO** — per-booking/per-WO feed of field changes, status transitions, runner submissions, admin approvals |
| Medium | **Combine WOs** — merge multiple work orders for a single booking into one consolidated WO |
| Medium | **Mobile pass** — full mobile UX review and fixes across non-runner pages (calendar, CRM, admin) |
| Horizon | **TV display** — read-only studio status board for wall-mounted screen; shows today's sessions per room in real time |
| Horizon | **Dashboard activity log** — recent studio activity feed (session starts, WO completions, task completions) |

### Deprioritized

| Chunk | Reason |
|---|---|
| Chunk 5 — Webhooks (Squarespace → leads) | Calendar is higher value; revisit after Chunk 6 ships |

### Future (not yet sequenced)

- **Chunk 8 — Admin settings:** Studio configuration, room definitions, rate management
- **Chunk 9 — Auth + RLS:** Supabase Auth, role-based access (office vs runner), enable RLS across all tables in one migration
- **Chunk 10 — Dashboard:** Unified ops view, session calendar widget, recent registrations
