# PRSFlow — Tech Stack & Roadmap

*Last updated: June 2, 2026*

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
| `components/shared/TimeInput.tsx` | Smart 12-hour time input with parse-on-blur. Accepts `8p`, `830a`, `1830`, `8` etc. Used in booking form and WO studio time table. |
| `components/shared/` | Reusable pickers: `ContactPicker`, `ArtistPicker`, `StudioSelect`, `TimeInput` |
| `lib/studios.ts` | `STUDIO_LOCATIONS` array + `parseLocation()` / `combineLocation()` for the "Venue · Studio" string format |
| `lib/roster.ts` | Label artist array helpers: `addArtistToLabel`, `removeArtistFromLabel`, `getArtistsForLabel` |
| `components/shared/RegViewModal.tsx` | Registration record view modal (used by CRM lead card + Clients profile). Fetches client data + signed ID photo URL on open; Export PDF button opens print route. |
| `components/calendar/WorkOrderPopup.tsx` | Full Work Order modal. Studio time table, equipment, rentals, payments, notes, signature. Writes to `work_orders` + `bookings` on Close & Save. Fires `onSaved` after all writes complete. |
| `app/register/view/[clientId]/page.tsx` | Print route for registration PDF. Server component; generates signed ID photo URL server-side. `PrintTrigger` fires `window.print()` after 800ms. |
| `app/(main)/sop/page.tsx` | SOP / Training tab — full-viewport iframe pointing to `/sop.html` |
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

### Next

| Priority | What's next |
|---|---|
| **High** | **Calendar drag-and-drop** — drag blocks to move sessions; option+drag to copy to new date |
| **High** | **Mic Inventory UI** — runner + admin UI for `mic_inventory` table (table exists, UI not built) |
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
