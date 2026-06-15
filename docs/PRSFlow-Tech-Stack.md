# PRSFlow — Tech Stack & Roadmap

*Last updated: June 10, 2026*

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | `"next": "^16.2.6"` in package.json; all pages are `'use client'` |
| Database | Supabase (Postgres) | Direct browser queries via anon key; no API layer |
| Storage | Supabase Storage | Private `client-ids` bucket for ID file uploads |
| Auth | Deferred to Chunk 9 | No RLS yet; tables are open with public access policies |
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
| `app/(main)/` | Route group for internal nav-bearing pages |
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
| `components/calendar/WorkOrderPopup.tsx` | Full Work Order modal. Studio time table, equipment, rentals, payments, notes, signature. Writes to `work_orders` + `bookings` on Close & Save. Fires `onSaved` after all writes complete. |
| `app/register/view/[clientId]/page.tsx` | Print route for registration PDF. Server component; generates signed ID photo URL server-side. `PrintTrigger` fires `window.print()` after 800ms. |
| `app/(main)/sop/page.tsx` | SOP / Training tab — full-viewport iframe pointing to `/sop.html` |
| `app/(main)/daily-ops-log/page.tsx` | Daily Ops Log route — wraps `DailyOpsLogSection`; also embedded as Admin sidebar tab |
| `app/runner/[studio]/wo/[id]/page.tsx` | Runner WO form — studio time table, equipment condition, expenses, eng hours, receipt OCR, canvas signature pad (COD-only), payment rows (editable), Save/Finish footer |
| `app/(main)/wo-hub/page.tsx` | WO Hub — all work orders list, filterable by studio/date/status; linked from nav |
| `components/admin/DailyOpsLogSection.tsx` | Approved WOs + ops submissions log; studio/type/date filters + search; click-to-open WO or ops modal |
| `components/dashboard/LocationStrip.tsx` | 4-studio dashboard strip; drawer with Yesterday/Today sessions + daily ops rows; real-time subscriptions |
| `lib/checklist-items.ts` | Per-studio opening/closing checklist items; `CHECKLISTS[studio][type]`, `getChecklistSections()`, `flattenSections()` |
| `public/sop.html` | Self-contained interactive training guide. Replace file to update content; no code change needed. |
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
| dashboard-tasks-migration | `dashboard_tasks` table: `assigned_role` CHECK ('admin','studio_manager','asst_manager','billing'), `source` CHECK ('manual','runner_flag','wo_flag'), soft delete via `deleted_at`, `set_updated_at()` trigger, RLS enabled with placeholder `USING (true)` on INSERT/UPDATE/DELETE until Chunk 9 auth; SELECT filters `deleted_at IS NULL`; GRANT to `authenticated` |

### Next

| Priority | What's next |
|---|---|
| **High** | **Calendar drag-and-drop** — drag blocks to move sessions; option+drag to copy to new date |
| **High** | **Dashboard tasks UI** — connect `dashboard_tasks` table to the dashboard `TodoModule` |
| Medium | **Needs Action rebuild (4.8)** — redesign what "needs action" means vs overdue |
| Medium | **4.9b — Duplicate merge flow:** UI to merge two client profiles discovered post-import |

### Deprioritized

| Chunk | Reason |
|---|---|
| Chunk 5 — Webhooks (Squarespace → leads) | Calendar is higher value; revisit after Chunk 6 ships |

### Future (not yet sequenced)

- **Chunk 8 — Admin settings:** Studio configuration, room definitions, rate management
- **Chunk 9 — Auth + RLS:** Supabase Auth, role-based access (office vs runner), enable RLS across all tables in one migration
- **Chunk 10 — Dashboard:** Unified ops view, session calendar widget, recent registrations
