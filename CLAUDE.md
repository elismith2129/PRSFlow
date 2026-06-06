
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
- `/` — Dashboard: `LocationStrip` (4 studio cards → drawer with Yesterday/Today sessions + daily ops), `TodoModule`, `QCHomeWidget`
- `/crm` — Leads + Clients unified page. LEADS tab: Needs Action, All Leads, Analytics. CLIENTS tab: client list + editable profile panel. Toggle at top of page, defaults to LEADS on every load.
- `/clients` — Redirects to `/crm` (stub for backward-compat; do not delete)
- `/calendar` — Week/2-week multi-studio grid calendar with booking form + work order popup
- `/admin` — Daily ops admin view (WO approval, staff submissions)

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
- `daily_ops_submissions` — one row per studio+date+category. Tracks `submitted_at`, `admin_approved_at`, `needs_attention`. UNIQUE(studio, date, category)
- `checklists` — actual item check data. `items` is jsonb `[{item, checked}]`. One row per studio+type+date
- `petty_cash_entries` — in/out transactions per studio+date
- `petty_cash_balances` — opening balance per studio+date. UNIQUE(studio, date)
- `stock_items` — per-studio stock with qty + low bool
- `mic_inventory` — global mic list with condition (good/fair/damaged)
- `expense_rows` — WO expense line items with receipt_url
- `bookings.engineer_rate` — text column; hourly rate for the session engineer (no default — field starts blank)
- `studio_time_rows.eng_hours` — numeric; hours worked by engineer on that row (auto-populated from `total_hours` or `calcHours(from_time, to_time)` when null on WO open)
- `studio_time_rows.eng_rate` — text; engineer rate override for that row (blank until set; inherits from `booking.engineer_rate` display-side only, not DB default)
- `studio_time_rows.eng_charge` — numeric; computed eng_hours × eng_rate

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
- **z-index ladder:** Nav = 9999. LocationStrip dialog = 10001. DailyOpsModal = 10002. RegViewModal = 10003. All modals must sit above 9999
- **Runner pages** use `minHeight: '100dvh'`, `paddingBottom: 120` for the fixed footer, no nav import
- **Real-time checklist saves:** Items save on tap via `clIdRef` + `creatingRef` pattern. Notes debounce 800ms. Needs-attention upserts `daily_ops_submissions` without `submitted_at` immediately for dashboard badge
- **`TimeInput` is a `<select>` with 48 options (every 30 min, 12-hour AM/PM format).** The previous smart-parse text input was replaced. Used in booking form and WO Studio Time From/To cells.
- **iOS Safari scroll lock: use `body.position=fixed` + `top=-scrollY`, not `overflow:hidden`.** `overflow:hidden` on body does not block scroll on iOS. Correct pattern: save `scrollY`, set `body.style.top=\`-${scrollY}px\`, position=fixed, width=100%` on open; clear all three and call `window.scrollTo({ top: savedScrollY, behavior: 'instant' })` on close.

## What's Built (as of June 5, 2026)

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

## What's Next

- **Calendar drag-and-drop** — drag to move sessions; option+drag to copy to new date
- **Mic Inventory UI** — runner + admin UI for mic_inventory table (tables exist, UI not built)
- **Needs Action rebuild (4.8)** — redesign what "needs action" means vs overdue
- **Email/webhooks (Chunk 5)** — Squarespace → lead auto-create
- **Auth (Chunk 9)** — office vs runner roles, RLS
- **Supabase Realtime on new tables** — any new table added going forward needs `ALTER PUBLICATION supabase_realtime ADD TABLE <name>` + `ALTER TABLE <name> REPLICA IDENTITY FULL` before subscriptions will fire

## Environment Variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for cron endpoints)
- `CRON_SECRET` (for cron auth)
- `ANTHROPIC_API_KEY` (for /api/ocr-receipt)
- `NEXT_PUBLIC_BASE_URL` (e.g. `https://prs-flow.vercel.app`) — used to construct registration links sent to clients. Falls back to `window.location.origin` if unset (produces localhost URLs in dev).

All must be set in Vercel for Production, Preview, and Development environments.
