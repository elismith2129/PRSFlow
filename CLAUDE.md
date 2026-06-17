
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Next.js dev server at http://localhost:3000
- `npm run build` — production build
- `npm run start` — run the production build
- `npx next lint` — lint (eslint-config-next is configured but no `lint` script exists in package.json)

There is no test runner configured.

## Environment

The Supabase client in `lib/supabase.ts` reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `.env.local` (see `.env.local.example`). The `!` non-null assertions mean the app will crash at import time if these are missing — set them before running `dev` or `build`.

OCR receipt endpoint (`/api/ocr-receipt`) requires `ANTHROPIC_API_KEY`.

To (re)create the database, run `schema.sql` in the Supabase SQL editor, then the runner hub migration SQL (see docs/PROJECT_LOG.md for the table definitions).

## Architecture

PRSFlow is a single-tenant studio operations app for Paramount Recording Studios. It is a Next.js 14 App Router project with **client-rendered pages that talk directly to Supabase from the browser** using the anon key. There is no Next.js API layer (except `/api/ocr-receipt` which needs the Anthropic API key server-side), no server actions, and no server-side auth — every page is `'use client'` and queries `supabase` directly.

### Route structure

**Internal (nav-bearing) routes under `app/(main)/`:**
- `/` — Dashboard: `LocationStrip` (4 studio cards → drawer with Yesterday/Today sessions + daily ops), 3-col grid (Needs Action panel, Today's Sessions panel, Tasks placeholder with Me/Mgr/Billing/Asst tabs)
- `/crm` — Leads + Clients unified page. LEADS tab: Needs Action, All Leads, Analytics. CLIENTS tab: client list + editable profile panel. Toggle at top of page, defaults to LEADS on every load.
- `/clients` — Redirects to `/crm` (stub for backward-compat; do not delete)
- `/calendar` — Week/2-week multi-studio grid calendar with booking form + work order popup
- `/admin` — Daily ops admin view (WO approval, staff submissions)
- `/wo-hub` — All work orders list, filterable by studio/date/status

**Runner routes (phone-first, no nav):**
- `/runner` — Studio select landing
- `/runner/[studio]` — Per-studio daily ops hub (sessions + quick-action tiles)
- `/runner/[studio]/wo/[id]` — Work order form (condition, expenses, receipt OCR, submit)
- `/runner/[studio]/checklist/[type]` — Opening/closing checklist (tap-to-check, real-time saves)
- `/runner/[studio]/petty-cash` — Petty cash entry
- `/runner/[studio]/stock` — Stock list with low/OK flags
- `/runner/[studio]/mics` — Mic inventory with condition per mic

**Utility:**
- `/wo/[id]/print` — (deleted) Print/PDF now handled by `window.print()` directly inside WorkOrderPopup with `@media print` CSS
- `/api/ocr-receipt` — Anthropic claude-haiku-4-5 receipt OCR (base64 image → vendor/amount/item)

### Data model

Tables in use (all with public RLS — auth deferred to Chunk 9):

**Core:**
- `leads` — sales pipeline. Status: `hot | warm | cold | uncontacted | booked | dead`
- `clients` — booked customers. `clients.lead_id` refs originating lead. `artists` is a jsonb array
- `work_orders` — invoices. References `clients`. `studio_rows`, `rental_rows`, `payment_rows` are jsonb arrays
- `qc_reports` — post-session quality checks. `id` is text (generated client-side)
- `contact_log` — cooldown tracking for CRM touch prompts
- `lead_activity` — touch log entries per lead
- `bookings` — calendar sessions. `start_date`, `from_time`, `to_time`, `location`, `status`, `rate_daily`. FK fields: `anr_contact_id` (A&R who ordered), `anr_admin_contact_id` (admin contact)
- `client_contacts` — A&R contacts for label clients
- `registration_tokens` — public client registration flow

**Runner Hub / Daily Ops (added via migration):**
- `daily_ops_submissions` — one row per studio+date+category. Tracks `submitted_at`, `admin_approved_at`. Columns `needs_attention`, `attention_notes`, `photo_urls` do NOT exist on this table — those live on `checklists`. UNIQUE(studio, date, category)
- `checklists` — actual item check data. `items` is jsonb `[{item, checked}]`. One row per studio+type+date
- `petty_cash_entries` — in/out transactions per studio+date
- `petty_cash_balances` — opening balance per studio+date. UNIQUE(studio, date)
- `stock_items` — per-studio stock with qty + low bool
- `mic_inventory` — global mic list with condition (good/fair/damaged)
- `expense_rows` — WO expense line items with receipt_url
- `dashboard_tasks` — per-role task system for the dashboard. `assigned_role` in ('admin','studio_manager','asst_manager','billing'). `source` in ('manual','runner_flag','wo_flag'). `photo_url text` for optional task attachment. Soft delete via `deleted_at`. RLS enabled (placeholder `USING (true)` on INSERT/UPDATE/DELETE until Chunk 9 auth lands; SELECT filters `deleted_at IS NULL`). `set_updated_at()` trigger auto-updates `updated_at`. Anon key access granted (required since app uses anon key pre-auth).
- `dashboard_task_comments` — per-task comment/update thread. `task_id` FK → `dashboard_tasks` (CASCADE). `text`, `photo_url`, `created_by_name`, `created_at`. RLS: anon + authenticated SELECT + INSERT (open). No update/delete policies — comments are append-only.
- `bookings.engineer_rate` — text column; hourly rate for the session engineer (no default — field starts blank)
- `studio_time_rows.eng_hours` — numeric; hours worked by engineer on that row (auto-populated from `total_hours` or `calcHours(from_time, to_time)` when null on WO open)
- `studio_time_rows.eng_rate` — text; engineer rate override for that row (blank until set; inherits from `booking.engineer_rate` display-side only, not DB default)
- `studio_time_rows.eng_charge` — numeric; computed eng_hours × eng_rate
- `studio_time_rows.status` — text NOT NULL DEFAULT 'in_progress'; CHECK IN ('in_progress','submitted','approved'). Runner Finish → today's rows set to 'submitted'. Admin Approve → today's rows set to 'approved'. Status dot in Date cell top-right: orange #fb923c = submitted, lime #c8f04e = approved, none = in_progress.

Most date/time fields stored as `text`. Money fields stored as `text`.

### Key shared libraries

- `lib/supabase.ts` — Supabase client + all entity types (`Lead`, `Client`, `WorkOrder`, `Booking`, etc.)
- `lib/studios.ts` — `STUDIO_LOCATIONS` array + `parseLocation()` / `combineLocation()` for the "Venue · Studio" string stored in `leads.location` / `bookings.location`
- `lib/roster.ts` — Label artist array helpers (`addArtistToLabel`, `removeArtistFromLabel`, `getArtistsForLabel`). Always use these — never write `clients.artists` directly.
- `lib/checklist-items.ts` — Per-studio opening/closing checklist items (shared between runner page and admin modal). `CHECKLISTS[studio][type]`, `getChecklistSections()`, `flattenSections()`
- `lib/settings.ts` — Timer constants (COOL_DOWN_DAYS, TOUCH_INTERVAL_DAYS)

### Conventions

- Path alias `@/*` maps to repo root. Import as `@/lib/supabase`, `@/components/...`
- TypeScript `"strict": false` and `target: "es5"`
- **Styling is inline `style={{ ... }}` JSX, not Tailwind.** CSS variables from `styles/globals.css`: `--bg`, `--surface`, `--surface2`, `--border`, `--text`/`--text2`/`--text3`, `--accent`, `--hot`/`--warm`/`--cold`/`--booked`/`--uncontacted`/`--dead`
- Fonts (DM Serif Display, DM Mono, Syne) loaded via Google Fonts `@import` in `styles/globals.css`
- **z-index ladder:** Nav = 99999 (always topmost — above all modals). LocationStrip dialog = 10001. DailyOpsModal = 10002. RegViewModal = 10003. BookingForm overlay = 1000. Modals sit below Nav.
- **Runner pages** use `minHeight: '100dvh'`, `paddingBottom: 120` for the fixed footer, no nav import
- **Real-time checklist saves:** Items save on tap via `clIdRef` + `creatingRef` pattern. Notes debounce 800ms. Needs-attention upserts `daily_ops_submissions` without `submitted_at` immediately for dashboard badge
- **`TimeInput` is a smart-parse text `<input>` with auto-format on blur.** Accepts `10a`→`10:00 AM`, `930p`→`9:30 PM`, `1430`→`2:30 PM` (24h), bare `8`→`8:00 AM`. Enter commits. Click/focus selects all. Used in booking form and WO Studio Time From/To cells. (Was briefly a 30-min `<select>` June 5–10, 2026 — reverted for mobile usability.)
- **iOS Safari scroll lock: use `body.position=fixed` + `top=-scrollY`, not `overflow:hidden`.** `overflow:hidden` on body does not block scroll on iOS. Correct pattern: save `scrollY`, set `body.style.top=\`-${scrollY}px\`, position=fixed, width=100%` on open; clear all three and call `window.scrollTo({ top: savedScrollY, behavior: 'instant' })` on close.

## What's Built (as of June 16, 2026)

| Chunk | Feature | Status |
|-------|---------|--------|
| 1 | CRM — Needs Action, All Leads, touch logging, Keep Hot/Warm, auto-demotion cron | ✅ Complete |
| 4 | Clients page — list + profile + contacts + artists + registration flow | ✅ Complete |
| 6 | Calendar — multi-studio grid, booking form, WO popup, COD hero | ✅ Complete |
| 7 | Runner Hub — /runner routes, WO form, receipt OCR, daily ops checklists | ✅ Complete |
| 7b | Dashboard daily ops — LocationStrip drawer, Yesterday/Today, DailyOpsModal | ✅ Complete |
| CRM polish | StudioSelect component, rate_daily toggle, label roster (`lib/roster.ts`), new lead form dropdowns, Move to Booking nav | ✅ Complete |
| A&R Admin | Admins section on label profiles; `anr_contact_id`/`anr_admin_contact_id` on bookings; contact popovers + inline fields in booking card | ✅ Complete |
| Registration status | 3-state reg button (Send Reg / Reg Sent / ✓ Registered), view modal with all fields + ID photo, Export PDF print route, COD-only guard | ✅ Complete |
| Contact actions | Call (`tel:`), Text (`sms:`), Email (`mailto:`) inline buttons on lead cards, client profiles, A&R + Admin card headers | ✅ Complete |
| SOP tab | `/sop` route + iframe serving `public/sop.html`; update guide by replacing the file | ✅ Complete |
| CRM+Clients merge | LEADS/CLIENTS toggle on `/crm`; `ClientsPageInner` embedded under CLIENTS tab; Clients removed from nav; `/clients` redirects to `/crm`; reg badge moved to CRM nav item | ✅ Complete |
| WO save/sync overhaul | Close & Save writes to both `work_orders` and `bookings`; `initWO` query fixed for multiple-WO-per-booking tolerance; studio time rows use TimeInput; FROM/TO removed from WO top meta; single-day sessions seed stRows from liveForm times on open | ✅ Complete |
| WO print | `@media print` CSS overhauled: centered full-width, `@page` 0.5cm margins, no transform scale, signature section stays on page; PDF filename set via `document.title` (`CLIENT_INV#` or `LABEL_ARTIST_INV#`) | ✅ Complete |
| Booking form polish | Engineer name clickable to reopen search pre-filled (Escape/blur reverts, ref-based to avoid stale closure); TBD button grey until active; multi-day sessions show "Edit times in WO" instead of FROM/TO inputs | ✅ Complete |
| WO & daily ops amendment | `needs_attention_notes`/`runner_finished`/`admin_approved` on work_orders; Finish button + confirmation dialog; Cancel/Save/Finish footer (WO stays editable after finish); NA photo upload to `checklist-photos` bucket; admin sees NA thumbnails in WorkOrderPopup; admin approves WO inline from LocationStrip drawer | ✅ Complete |
| Daily Ops Log | `/daily-ops-log` route + `components/admin/DailyOpsLogSection.tsx`; embedded as Ops Log tab in Admin sidebar; shows approved WOs + ops submissions; filterable by studio/type/date; click WO → WorkOrderPopup; click ops → DailyOpsModal | ✅ Complete |
| Runner real-time | Supabase `postgres_changes` subscriptions on `bookings` + `work_orders` across all runner pages; session counts and WO badges update live; requires `ALTER PUBLICATION supabase_realtime ADD TABLE` + `REPLICA IDENTITY FULL` per table | ✅ Complete |
| Runner WO improvements | Session Info reads from live booking record; Label/A&R field shows "LabelName / ContactName"; artist card tap target; UTC→local date fix on all runner pages | ✅ Complete |
| Day-rate WO | Studio Time table has two layouts: day-rate (compact Date/Room/Hours/Rate/Charge) vs. hourly; correct charge calculation; multi-day reconciles missing rows on open; duplicate rows eliminated | ✅ Complete |
| Equipment Condition | Horizontal scroll + sticky first column on admin popup and runner page; Not OK cell opens notes+photo popup; section excluded from PDF print | ✅ Complete |
| WO live sync fixes | `isDayRate` reads from `liveForm` not stale `booking.*`; `wo?.id` dep on reactive effects so they re-run after `initWO`; post-save rate sync on all booking saves; `onSaved={undefined}` prevents form revert on WO close | ✅ Complete |
| Real-time project standard | `postgres_changes` on all four surfaces: runner WO (`studio_time_rows`), admin WO popup (`studio_time_rows` + `work_orders`), LocationStrip (`bookings` + `work_orders` silent refresh), calendar (`bookings` via `loadRef` pattern) | ✅ Complete |
| Engineer in WO | `bookings.engineer_rate` field (blank default); eng sub-row in Studio Time table on admin + runner (rate locked on runner); Engineer Total in WO totals; booking save syncs eng_rate to existing stRows (only if null/empty) | ✅ Complete |
| Ops Log search | Search bar in DailyOpsLogSection filters by client, artist, studio, engineer, invoice number; case-insensitive live filter; Ops Log removed from top nav (admin sidebar only) | ✅ Complete |
| Runner session hero | Artist name is the large hero on runner session cards; client name is the secondary sub-text below | ✅ Complete |
| WO eng UX fixes | `normalizeStRow` defaults eng_hours from total_hours → calcHours when null; $55 removed everywhere; Eng subtotal in Studio Time inline footer; date reconciliation applies to both day-rate and hourly (no isDayRate guard); runner RT accepts admin-set eng_hours without overwriting runner-typed values; bkData fallback for non-standard WO URLs; runner compact table layout for hourly; auto-seed stRows from booking on WO open | ✅ Complete |
| Per-row rate type + unified Studio Time | `studio_time_rows.row_rate_type` + `rate_daily` columns; each row toggles Day/Hr independently; `toggleRowRateType()` converts rate; unified 9-col table (Date\|SessionInfo\|From\|To\|Hrs\|Type\|Rate\|OT\|Total) replaces dual layouts in admin + runner; `TimeInput` → 30-min `<select>` with 48 options; `shortDate()` date format; OT rate auto-populated for hourly rows; admin cell dividers removed | ✅ Complete |
| Runner WO UX polish | Notes bottom sheet: floating card (`position:fixed, bottom:16, left:12, right:12, borderRadius:12`); iOS Safari scroll lock via `body.position=fixed+top=-scrollY` (not `overflow:hidden`); `Viewport` export sets `maximumScale:1, userScalable:false`; runner root containers `maxWidth:100vw, overflowX:hidden`; eng initials pill with tap-to-expand popover; `<span data-si-print>` reveals notes in PDF; admin session info cell opens editable popover | ✅ Complete |
| Studio Time table bugfixes | 12-col admin / 11-col runner tables; Session Info column restored; OT auto-calc; native date picker overlay (transparent `<input type="date">`) with auto-save + auto-sort; all `upsert(onConflict)` → `insert()` (constraint never existed); `booking_id` removed from runner insert; `$`/`,` stripped from `ot_rate`; `wo?.id` removed from date-range sync effect deps; runner mobile column widths corrected | ✅ Complete |
| WO status cycling | `studio_time_rows.status`: in_progress/submitted/approved; runner Finish submits today's rows; admin Approve approves today's rows; status dots in Date cell; all inserts seed `status:'in_progress'`; dots render for all rows regardless of date; `handleFinish` and `handleApprove` scoped to `date === getLocalToday()` | ✅ Complete |
| Confirmed sessions + multi-day | Daily Ops cards and runner hub filter to `status='confirmed'`; booking queries use `lte('start_date',today).gte('end_date',today)` for multi-day; LocationStrip badge driven by `studio_time_rows.status='submitted'`; third RT channel on LocationStrip for stRows; approved sessions drop from Today drawer | ✅ Complete |
| WO Hub | `/wo-hub` nav page listing all WOs, filterable by studio/date/status | ✅ Complete |
| WO status simplified | `work_orders.status` is `open`/`completed` only; "Complete WO" toggles without locking; `runner_finished` flow removed | ✅ Complete |
| Studio Time local-first | All stRow edits queued in state, single DB commit on Save; Cancel fully reverts; RT subscription removed while popup is open | ✅ Complete |
| `eng_visible` + `admin_locked` | `studio_time_rows.eng_visible` persists eng sub-row visibility; `admin_locked` persists row lock; replaces ephemeral React state | ✅ Complete |
| TimeInput rewrite | Smart-parse text `<input>` replaces 30-min `<select>`; `parseTime()` for AM/PM + 24h input | ✅ Complete |
| Runner WO bottom sections | Notes floating card, equipment horizontal scroll, expenses inline; Session QC removed from nav | ✅ Complete |
| Canvas signature pad | COD-only canvas finger-draw pad in runner WO + admin WO; `work_orders.print_name` + `signature_data`; replaces `legal_signature/legal_name/legal_date` | ✅ Complete |
| Payment improvements | Type dropdown (Cash/Zelle/CC/Debit/Check/Other); `memo` field; `last_four` (CC/Debit only); `× remove`; runner payments now editable; `$1,234.56` currency auto-format | ✅ Complete |
| Mic Inventory UI | Runner mic inventory page (`/runner/[studio]/mics`): collapsible sections, Here/Room/Missing status, qty steppers, submit flow; appears in Yesterday checklists | ✅ Complete |
| dashboard_tasks table | Supabase migration: per-role task system table with soft delete, `set_updated_at()` trigger, RLS (placeholder until Chunk 9) | ✅ Complete |
| Dashboard rebuild | 3-col layout: Needs Action (hot/warm/uncontacted, excludes cold/dead/booked, top 5), Today's Sessions (confirmed + tentative with colored left-border rows), Tasks placeholder (Me/Mgr/Billing/Asst tabs, `activeTaskTab` state wired). Removed `TodoModule`, `QCHomeWidget`, `clients` + `qc_reports` fetches. | ✅ Complete |
| dashboard_task_comments table | New table: per-task comment thread. `task_id` FK → `dashboard_tasks` CASCADE. `text`, `photo_url`, `created_by_name`, `created_at`. Anon + authenticated SELECT + INSERT RLS. Append-only (no update/delete policies). | ✅ Complete |
| Dashboard Tasks panel (Session 3a) | Col 3 Tasks column live: fetch by tab role (Me=admin, Mgr=studio_manager, Asst=asst_manager, Billing=billing). Task rows clickable → ticket modal; `×` soft-deletes. Inline add task form with optional photo. Task modal: Syne title, task photo, comment thread, textarea + photo attach, Comment + Complete buttons. Photos to `checklist-photos` bucket at `dashboard-tasks/` prefix. `created_by_name` from `supabase.auth.getUser()`, falls back to `'Staff'`. `DashboardTask.photo_url` + `DashboardTaskComment` type added to `lib/supabase.ts`. | ✅ Complete |
| Daily ops Today/Yesterday view fixes | Approved checklist items no longer disappear from Today column; completed WOs no longer disappear from Yesterday column; `pastRetentionWindow` guard scoped to Today only | ✅ Complete |
| Petty cash running ledger | All-time entry ledger with most-recent balance; In/Out tap-to-toggle button; admin view unblocked from submission state; save errors surfaced inline | ✅ Complete |
| Daily Ops Log rebuilt | `DailyOpsLogSection` rebuilt as date-based historical view: studio tabs (Paramount/Encore/Ameraycan/Track), date list with status dots (teal/amber/grey), Load More pagination, day modal (WO cards + 5 checklist rows with Runner/Admin checkboxes); replaces old flat mixed table | ✅ Complete |
| Flags system | `flags` + `flag_comments` tables. Dashboard panel (4 cards, studio pill, category badge, runner note, lime "View all" link). Flag modal: comment thread, Acknowledge (+ category reassignment), Resolve sub-modal (resolution note / vendor / cost), soft-delete with confirmation. Runner checklist NA + WO NA submissions auto-insert `runner_flag`/`wo_flag` rows. Admin Flags Log tab (searchable, per-row delete). | ✅ Complete |
| Dashboard room grid | Col 2 replaced with fixed 11-room grid (`ROOMS` constant). `calDate` state + `‹`/`›` day navigation. 3-col grid (`1fr 1fr 1fr`), `height: 556`. Room matched via `b.location === venue && b.studio === room`. Booked card: teal/orange top border, DM Serif artist name (`var(--text)`), label sub-line, compact time, `1ST-XX`/`2ND-XX` initials (teal=confirmed, amber=hold). `engInitials()` + `fmtSessionTime()` helpers. | ✅ Complete |

## What's Next

- **WO → Calendar sync** — audit and harden the WO Close & Save → booking field sync path; ensure all fields round-trip correctly when WO is edited after booking form has unsaved changes
- **Activity log on session form and WO** — per-booking/per-WO activity feed showing field changes, status transitions, runner submissions, and admin approvals
- **Combine WOs** — merge multiple work orders for a single booking into one consolidated WO
- **Mobile pass** — full mobile UX review and fixes across all non-runner pages (calendar, CRM, admin)
- **TV display** — read-only studio status board for wall-mounted screen; shows today's sessions per room in real time (last)

**Horizon / ideas (not yet sequenced):**
- **Dashboard activity log** — recent studio activity feed (session starts, WO completions, runner checklist submissions, task completions) as a fourth panel or sidebar widget

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for cron endpoints)
- `CRON_SECRET` (for cron auth)
- `ANTHROPIC_API_KEY` (for /api/ocr-receipt)
- `NEXT_PUBLIC_BASE_URL` (e.g. `https://prs-flow.vercel.app`) — used to construct registration links sent to clients. Falls back to `window.location.origin` if unset (produces localhost URLs in dev).

All must be set in Vercel for Production, Preview, and Development environments.
