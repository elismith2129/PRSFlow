
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

To (re)create the database, run `schema.sql` in the Supabase SQL editor.

## Architecture

PRSFlow is a single-tenant studio operations app for Paramount Recording Studios. It is a Next.js 14 App Router project (`"next": "^16.2.6"` in package.json, but `eslint-config-next` and patterns are 14-style) with **client-rendered pages that talk directly to Supabase from the browser** using the anon key. There is no Next.js API layer, no server actions, and no server-side auth — every page is `'use client'` and queries `supabase` directly.

### Data model (schema.sql)

Five tables, all with `Public access` RLS policies (auth is explicitly deferred):

- `leads` — sales pipeline. `status` is one of `hot | warm | cold | uncontacted | booked | dead` (see `LeadStatus` in `lib/supabase.ts`). A `booked` lead is the source for creating a `client`.
- `clients` — booked customers. `clients.lead_id` references the originating lead. `artists` is a jsonb array.
- `work_orders` — invoices/session paperwork. References `clients`. Many fields are jsonb arrays (`studio_rows`, `rental_rows`, `payment_rows`) because they represent variable-length line items.
- `qc_reports` — post-session quality checks. `id` is a text primary key (not bigserial), so the app generates it client-side.
- `contact_log` — used by the dashboard TODO module to compute cooldowns ("when was this lead last contacted?").

Most date/time-ish fields (`session_date`, `last_contact`, `from_time`, etc.) are stored as `text`, not `timestamptz` — parsing/formatting happens in the components. Money fields (`total`, `deposit`, `balance`, `quote`) are also `text`.

### Routes and modules

The nav (`components/layout/Nav.tsx`) defines five top-level routes, but only three are implemented:

- `/` — Dashboard (`app/page.tsx`): loads leads + clients + qc_reports in parallel, renders `TodoModule` (the main work-queue widget), `LocationStrip`, and `QCHomeWidget`.
- `/crm` — Pipeline + analytics view over `leads`, with status tabs (hot/warm/cold/uncontacted/closed).
- `/clients` — Client list + profile + create/edit modal. Can be pre-filled from a booked lead.
- `/qc` and `/admin` — linked in the nav but not yet built.

### Conventions

- Path alias `@/*` maps to repo root (see `tsconfig.json`). Import as `@/lib/supabase`, `@/components/...`.
- TypeScript is `"strict": false` and `target: "es5"` — entity types live in `lib/supabase.ts` (`Lead`, `Client`, `WorkOrder`, `QCReport`, plus `LeadStatus | BillingType | BookingType | ClientType` string unions).
- **Styling is inline `style={{ ... }}` JSX, not Tailwind classes**, despite Tailwind being installed. The design system is a set of CSS variables defined in `styles/globals.css` (`--bg`, `--surface`, `--surface2`, `--border`, `--text`/`--text2`/`--text3`, `--accent`, plus per-status colors `--hot`/`--warm`/`--cold`/`--booked`/`--uncontacted`/`--dead`). Reuse these tokens rather than hardcoding hex values. The theme is loaded via `import '@/styles/globals.css'` in `app/layout.tsx`.
- Fonts (DM Serif Display, DM Mono, Syne) are loaded via a Google Fonts `@import` in `styles/globals.css` and referenced by name in inline styles.
- Pages follow a consistent shape: top-level `'use client'`, `useState` for entities, a `useCallback`'d `load()` that calls `supabase.from(...).select(...)`, and a single `useEffect` to invoke it. Mutations call `supabase.from(...).update/insert/delete` directly from event handlers and then re-run `load()`.
markdown# PRSFlow - Project Context

## What This Is
Studio management app for Paramount Recording Studios
Stack: Next.js 14 + Supabase + Vercel

## What's Built
- CRM with Needs Action (Uncontacted/Hot/Warm/Incomplete)
- All Leads with chronological view + date separators
- Touch logging, Keep Hot/Warm buttons
- Auto-demotion cron (runs daily at 9am)
- Analytics with pie charts

## Database Tables
- leads: inquiry tracking
- lead_activity: touch logs

## Key Files
- app/crm/page.tsx - main CRM
- lib/supabase.ts - DB types
- lib/settings.ts - timers

## Current Status
CRM complete. Next: Clients page (Chunk 4)

## Patterns to Follow
- Color scheme: #c8f04e (accent), #0d0f14 (bg)
- Fonts: Syne, DM Mono, DM Serif Display
- Always use condensed spacing in detail cards
When starting Claude Code:
bashclaude
Then say: "Read CLAUDE.md for context. I want to build [feature]."
Option B: Quick Context Drop
Every time you start Claude Code, paste a short context block:
Context: PRSFlow (Next.js + Supabase). CRM is done (leads, touch logging, Keep Hot/Warm, cron). Now building: Clients page. Follow existing patterns in app/crm/page.tsx.
My Recommendation:
Use CLAUDE.md + Memory combo:

Keep CLAUDE.md updated with what's built (update it every few chunks)
Use Memory with me (Claude chat) for planning and specs
When you start Claude Code, just say "Read CLAUDE.md, then [task]"

Want me to generate a starter CLAUDE.md for you right now based on everything we've built?You said: yup.yup.3:04 PMClaude responded: id: uuid (primary key)markdown# PRSFlow - Project Context for Claude Code

## Project Overview
Studio management app for Paramount Recording Studios
- **Stack:** Next.js 14, Supabase (PostgreSQL + Storage), Vercel
- **Location:** ~/Desktop/PRS/PRSFlow/prsflow
- **Live URL:** prsflow.vercel.app

## What's Built (Completed Chunks)

### Chunk 1: CRM (Complete)
**Needs Action Section:**
- Four tabs: Uncontacted | Hot | Warm | Incomplete
- Uncontacted: leads never touched (`last_contact IS NULL`)
- Hot: status='hot' AND 5+ days since contact
- Warm: status='warm' AND 8+ days since contact
- Incomplete: missing fname/lname/email/phone/quote (only hot/warm/uncontacted)
- Notification badge shows total task count

**All Leads Section:**
- Default view: chronological (newest first) with date separators
- Date separators: "Today", "Yesterday", "May 17, 2026"
- Filter buttons: All | Uncontacted | Hot | Warm | Cold/Dead | Booked
- Color-coded filters (always visible, brighter when selected)
- Pagination: 25 per page

**Analytics Tab:**
- Pie charts: Total Leads, Booked, Conversion Rate
- Charts: COD vs Billing, Booking Type, Inquiry Source, Bookings by Label

**Touch Logging:**
- Format: `[5/19 2:45pm] ES - Call - optional notes`
- Updates `last_contact` timestamp
- Logs to `lead_activity` table
- Appends to lead's `notes` field

**Keep Hot/Warm Buttons:**
- "Keep Hot" shows for hot leads 5+ days old
- "Keep Warm" shows for warm leads 8+ days old
- Resets `keep_hot_until` timer (+5 days for hot, +3 days for warm)
- Logs activity with initials + method + notes

**Detail Card:**
- Condensed spacing (12px between sections, 8px between fields)
- All fields editable inline (auto-save on blur)
- Autofill: Label and Company fields show dropdown suggestions
- Pills: Status (color-coded), COD/Billing, Booking Type
- Missing info alert at top
- "Keep Hot Until" field (read-only, color-coded by urgency)

**New Lead Modal:**
- Name-based autofill from leads + clients tables
- Shows: "★ Previous client (Recording Session, 5/12/26)"
- Autofills: name, email, phone, company, label, source, COD/billing, booking
- Label/Company fields: autocomplete from existing values
- Status dropdown for Uncontacted leads (Hot/Warm/Cold/Booked/Dead)

**Auto-Demotion Cron:**
- Runs daily at 9am via Vercel Cron
- Hot → Warm after 5 days (gives 3 more days)
- Warm → Cold after 8 days total
- Endpoint: `/api/cron/auto-demote`
- Uses `keep_hot_until` field (separate from `last_contact`)

## Database Schema

### leads table
```sql
id: uuid (primary key)
fname: text
lname: text
email: text
phone: text
company: text
label: text
source: text
status: text (hot/warm/cold/uncontacted/booked/dead)
booking: text
quote: text
notes: text
last_contact: timestamp
keep_hot_until: timestamp
parked_until: timestamp
billing_type: text
created_at: timestamp
```

### lead_activity table
```sql
id: uuid (primary key)
lead_id: uuid (foreign key)
type: text (e.g., "Call", "Email", "Text")
note: text
created_at: timestamp
```

## Design System

### Colors
- Background: `#0d0f14`
- Accent: `#c8f04e` (yellow-green)
- Hot: `#f04e7a` (pink)
- Warm: `#f0a24e` (orange)
- Cold: `#4e8ff0` (blue)
- Booked: `#4ef0a2` (green)
- Uncontacted: `#4ef0db` (cyan/teal)
- Text: `#e8eaf2`
- Secondary text: `#8b90a8`
- Border: `#2a2e3d`

### Typography
- Headings: Syne
- Body: DM Mono
- Display: DM Serif Display

### Spacing Patterns
- Section margins: 12px
- Field gaps: 8px
- Section headers: 8px margin-bottom
- Detail cards: condensed, no scrolling needed

## Key Files & Patterns

### Important Files
- `app/crm/page.tsx` - Main CRM (refer to for patterns)
- `app/layout.tsx` - Root layout with nav
- `styles/globals.css` - Design tokens
- `lib/supabase.ts` - DB client + Lead type
- `lib/settings.ts` - COOL_DOWN_DAYS, TOUCH_INTERVAL_DAYS
- `app/api/cron/auto-demote/route.ts` - Cron job

### Code Patterns to Follow
- Use Supabase client from `lib/supabase.ts`
- Auto-save on blur (no save buttons)
- Inline editing for all fields
- Color-code status everywhere (pills, badges, filters)
- Condensed spacing in detail views
- Always paginate lists (25 per page)
- Use DM Mono for dates/times
- Show "last contact X days ago" format

### Nav Structure
- Dashboard (not built yet)
- CRM (complete)
- Clients (next to build)
- Session QC (not built)
- Admin (not built)

## Environment Variables (Vercel)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (for cron)
- `CRON_SECRET` (for cron auth)

## Git Workflow
```bash
git add .
git commit -m "descriptive message"
git push
```
Vercel auto-deploys from GitHub

## What's Next
**Chunk 4: Clients Page** (current priority)
- Client list view
- Client detail page (contact, bookings, files, notes)
- Upload client IDs to Supabase Storage
- Link clients to leads (one client can have multiple inquiries)

## Notes for Claude Code
- Always read this file first for context
- Follow existing patterns in `app/crm/page.tsx`
- Keep spacing condensed (users hate scrolling)
- Test after each change
- If build breaks, revert immediately with `git reset --hard HEAD`
- Never change files not related to current task