# PRSFlow — Tech Stack & Roadmap

*Last updated: May 19, 2026*

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
| `components/shared/` | Reusable pickers: `ContactPicker`, `ArtistPicker` |
| `schema.sql` | Full database schema — run in Supabase SQL editor to recreate |

---

## Environment variables

All four must be set for **all three Vercel environments** (Production, Preview, Development):

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron endpoint (server-side) |
| `CRON_SECRET` | Cron endpoint auth header |

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

| Sub-chunk | What shipped |
|---|---|
| 4.1 | CRM core: Needs Action tabs (Hot/Warm/Cold/Uncontacted), All Leads with date separators + filters, touch logging, inline editing |
| 4.2 | Park feature: "Park until [date]" removes lead from Needs Action |
| 4.3 | Auto-cool: 7-day review prompt, auto-demotion via Vercel Cron |
| 4.4 | Clients list page: two-column layout, filter chips, search, sort, pagination |
| 4.5 | Client detail panel: inline editing for label + COD views, contacts (A&Rs), artist chips, booking history, notes |
| 4.6 | Book Client modal: three-path flow (new/existing/label), registration token generation, `ContactPicker` + `ArtistPicker` reusable components |
| 4.6 | Public registration form at `/register/[token]`: token validation, all fields + inline validation, ID upload to Supabase Storage, client creation + lead backfill, route group isolation |
| 4.6b | Registration form improvements: `capture="environment"` for iOS camera on ID upload; scrollable embedded T&Cs with iOS Safari overflow fix (`height` + `-webkit-overflow-scrolling: touch`) |

### Next

| Priority | What's next |
|---|---|
| High | **4.7 — Polish:** Registration QC notification on Clients page, file upload preview, empty states, confirm dialogs, basic mobile responsiveness |
| High | **Book Client UX expansion:** Allow converting Hot/Warm leads directly without manually promoting to Booked first — small sub-chunk between 4.7 and Chunk 6 |
| High | **Chunk 6 — Calendar:** Session scheduling, bookings table, studio room assignment, two-entry-point new session modal, reuses `ContactPicker` + `ArtistPicker` |

### Deprioritized

| Chunk | Reason |
|---|---|
| Chunk 5 — Webhooks (Squarespace → leads) | Calendar is higher value; revisit after Chunk 6 ships |

### Future (not yet sequenced)

- **Chunk 7 — Work Orders:** Structured bookings table, invoicing, payment tracking
- **Chunk 8 — Admin settings:** Studio configuration, room definitions, rate management
- **Chunk 9 — Auth + RLS:** Supabase Auth, role-based access (office vs runner), enable RLS across all tables in one migration
- **Chunk 10 — Dashboard:** Unified ops view, session calendar widget, recent registrations
