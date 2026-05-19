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
