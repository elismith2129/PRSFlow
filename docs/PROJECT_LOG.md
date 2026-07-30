# PRSFlo — Project Log

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
- **~~No RLS until Chunk 9~~ — SUPERSEDED July 2, 2026: RLS is now enforced on every table.** Kept for history. The app is no longer open — all access is keyed on `user_profiles.role` via `auth.uid()` (see the "Security hardening" subsection). The original office-vs-runner intent shipped as the staff+/mgr+/tech/runner tiers.
- **Frequent commits + branch-per-sub-chunk.** Each sub-chunk gets its own branch (e.g., `chunk-4-5`), commits happen after every meaningful piece of work, merge to main only when sub-chunk is confirmed working.
- **~~Email sending is deferred to Chunk 5~~ — SUPERSEDED July 20, 2026.** A first-party **email campaigns** feature shipped in CRM (`CAMPAIGNS` tab, Eli-only). Sends via Resend (`https://api.resend.com/emails`) from `studio@paramountrecording.com`. The `RESEND_API_KEY` env var must be set; the `/api/send-campaign` route returns a `503` until it is. Domain verification DNS records have been submitted to the DNS manager for `paramountrecording.com`; once propagated, Resend will verify the domain and the key can be generated and added to Vercel. `mailto:` links remain on individual contact action buttons (Call/Text/Email in lead and client detail).
- **No automated testing infrastructure for the foreseeable future.** No Playwright, Jest, Vitest, or any test framework. Manual browser testing only. If Claude suggests writing tests or adding a testing dependency, redirect back to manual verification.
- **~~Public registration uses an anon INSERT policy on `client-ids`~~ — SUPERSEDED July 2, 2026.** Registration now runs entirely through the service-role route `/api/register` (token validate/consume, client insert/update, ID upload). The former anon storage policies were dropped when the buckets went private. (Still 25MB / jpeg/png/heic/webp/pdf, still token-gated.)
- **Public routes use Next.js route groups to isolate from internal pages.** `app/(main)/` contains nav-bearing pages; `/register`, `/inquiry`, and the `(auth)` pages live outside it. **As of July 2, 2026 the real data boundary is RLS** — route groups + the client `AuthGuard` are now UX/organization only, no longer the sole protection.

### Auth, user profiles & task assignment (June 25, 2026)
- **Auth login is client-side guarded, not SSR-middleware gated.** The project has no `@supabase/ssr` and no `middleware.ts`, every page is `'use client'`, and `signInWithPassword` stores the session in **localStorage** (cookie-reading middleware would not see it). So route protection is a client guard — `components/auth/AuthGuard.tsx` wraps `app/(main)/layout.tsx`, checks `supabase.auth.getSession()`, redirects unauthenticated users to `/login`, subscribes to `onAuthStateChange`, and renders nothing until the session resolves. `app/(auth)/login/page.tsx` + `app/(auth)/reset-password/page.tsx` are the login / forgot-password / reset flows; the login page bounces already-authed users to `/`. **Only the internal `(main)` route group is client-guarded** — `/runner/*`, `/register`, `/inquiry`, and the `(auth)` pages stay public. When written this was **UX gating only**; **as of July 2, 2026 data security is enforced by RLS** (the anon key no longer has table access — see the "Security hardening" subsection). Nav has a Sign Out button (`signOut()` → `/login`).
- **`user_profiles` uses a surrogate PK, not the auth.users id.** The originally-requested DDL made `id` reference `auth.users(id)`, but the 6-row seed must insert **before** any auth accounts exist (a PK can't be null and a fabricated id violates the FK). Resolution (`supabase/user_profiles.sql`): `id uuid PK default gen_random_uuid()` (stable, what `dashboard_tasks.assigned_to/by` reference); `auth_user_id uuid unique references auth.users(id) on delete cascade` (nullable — backfilled after invites); `email text not null unique` (the temporary lookup key `useUserProfile` matches the session email against). RLS left disabled per instruction; GRANT to anon/authenticated. **Migrations are run manually in the Supabase SQL editor** (Claude has no DDL access — only the anon key locally; no service-role key / DB password / CLI / psql).
- **`user_profiles.role` set + roster changed after the migration.** The migration seed used `owner | manager | asst_manager | staff`; the live table now uses **`owner | manager | billing | asst_manager | tech | runner`** with roster: Eli & Adam-Mike (owner), Fernando (manager), Aaron (billing), Quinn & Isaac (asst_manager), Sierra & Tom (tech), and a shared **runner** login (added July 2, 2026 for the PIN system — `auth_user_id` NULL until that account is built). The TS `UserProfile['role']` union matches the new set (`+ 'runner'`, `+ sop_acknowledged?`).
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

### PWA — installable home-screen apps (June 27, 2026)
- **The PWA work is icons + web-app manifests only — there is NO service worker and NO offline caching.** `fe17795` makes the app installable to a phone home screen with proper branded icons and a standalone (chromeless) display mode; it does **not** add offline support, background sync, push notifications, or any caching layer. The app still requires a live network connection and talks to Supabase exactly as before. If offline/runtime-caching is ever wanted, that's a separate, larger piece of work (a service worker + a caching strategy) — it was deliberately not attempted here.
- **Two separate manifests + icon sets: main app vs. runner hub.** `public/manifest.json` (`name: "PRSFlo"`, `start_url: "/"`) and `public/runner-manifest.json` (`name: "PRSFlo Runner"`, `short_name: "Runner"`, `start_url: "/runner"`) are distinct so studio runners can install the **Runner hub as its own home-screen app** that launches straight into `/runner`, with a visually distinct icon (the runner icon adds a teal `RUNNER` badge under the PRS FLOW wordmark). Both use `display: standalone`, `background_color`/`theme_color` `#0d0f14`, and three icons (192, 512, 512-maskable).
- **Icons are wired via the Next.js Metadata API, NOT raw `<head>` link tags — this is what makes the per-route override work.** The instinct was to drop `<link rel="manifest">` / `<link rel="apple-touch-icon">` / `<meta name="theme-color">` into a `<head>` in the root layout. That is wrong here: the root layout (`app/layout.tsx`) wraps **every** route including `/runner/*`, so raw global head tags would leak onto `/runner` and produce **duplicate** `manifest` + `apple-touch-icon` tags there, with no clean way for the runner to override which one wins. The Metadata API does proper parent→child merge: a child segment's `manifest` and `icons` **replace** the parent's for that subtree. So the root layout exports `metadata.manifest = '/manifest.json'` + `metadata.icons` (favicon-16/32 + apple-touch-icon) and `viewport.themeColor = '#0d0f14'` (themeColor lives in the `viewport` export, not `metadata`, since Next 14+), and `app/runner/layout.tsx` exports `metadata.manifest = '/runner-manifest.json'` + `metadata.icons.apple = '/runner-apple-touch-icon.png'` + `appleWebApp` — which fully replace the root values for `/runner/*` only. Verified in the actually-rendered HTML: `/` serves one `manifest` (`/manifest.json`) + one `apple-touch-icon` (`/apple-touch-icon.png`); `/runner` serves one `manifest` (`/runner-manifest.json`) + one `apple-touch-icon` (`/runner-apple-touch-icon.png`) + the apple-web-app meta — no duplicates on either route.
- **`app/runner/layout.tsx` is a new server-component layout created specifically to carry the runner metadata.** `app/runner/page.tsx` is `'use client'`, and client components cannot `export const metadata`. So a server-component layout (`export default function RunnerLayout({children}) { return <>{children}</> }`) was added to wrap the whole `/runner/*` subtree and host the runner manifest/icon/`appleWebApp` metadata (`capable: true`, `statusBarStyle: 'black-translucent'`, `title: 'Runner'`). It renders a passthrough fragment — it exists only for metadata; it does not change runner layout/markup. Note this means the runner subtree's `icons` no longer includes the favicon-16/32 (the child `icons` object replaces the parent's wholesale) — acceptable, since the runner hub is a home-screen/standalone target, not a browser-tab surface.
- **Icons are generated, not hand-drawn, by a committed dev script.** `scripts/generate-icons.js` (plain Node, `require('sharp')`) holds two inline SVG sources (main + runner, both the PRS FLOW chrome wordmark on a `#0d0f14` metal-gradient rounded-rect; runner adds the teal RUNNER badge) and rasterizes them to 8 PNGs + writes the 2 SVGs into `public/`: main → `favicon-16x16`/`favicon-32x32`/`apple-touch-icon`(180)/`icon-192`/`icon-512` + `icon.svg`; runner → `runner-apple-touch-icon`(180)/`runner-icon-192`/`runner-icon-512` + `runner-icon.svg`. Re-run with `node scripts/generate-icons.js` to regenerate after editing the SVGs. `sharp` was added to **devDependencies** (`^0.35.2`) — it's a build-time-only tool, never imported by the app.
- **Adding `app/runner/layout.tsx` invalidates the stale `.next` typed-route validator.** Right after creating the runner layout, `tsc --noEmit` failed with errors in `.next/dev/types/validator.ts` (`Type '/runner' is not assignable to '/'`) — these come from Next's **auto-generated** route-type validator, which was stale (generated before the new `/runner` layout route existed). `.next` is gitignored and regenerates on the next dev/build; deleting `.next/dev/types` and re-running cleared it. The errors were never in source — `tsc --noEmit` is clean. If a future session sees phantom `validator.ts` route errors after adding/removing a layout, this is why.

### Brand identity — PRSFlo rename + wave icon + locked wordmark (June 27–30, 2026)
- **The product display name is "PRSFlo" (no "w"), renamed from "PRSFlow."** The rename covers UI display text (nav, login, reset-password, runner hub, welcome splash), metadata (page `<title>`, `manifest.json`/`runner-manifest.json` `name`/`short_name`), and prose in CLAUDE.md / PROJECT_LOG / PRSFlow-Tech-Stack. **Deliberately NOT renamed (out of scope, left as "prsflow"):** the GitHub repo, the local folder (`~/dev/prsflow`), the Vercel project, the domain `prsflow.paramountrecording.com`, the Supabase project, env-var names, `package.json` `"name"`, the `prsflow-backup-*.json` backup filename, and the `PRSFlow-Tech-Stack.md` doc filename. No code identifiers contained "PRSFlow" (nothing to rename there). (`f1fc649`)
- **The app/icon art is a single wave mark — this SUPERSEDES the "PRS FLOW chrome wordmark" icons described in the PWA entry above.** Three stacked sine waves (top teal-gradient `#5DCAA5→#0e5446` @0.6 opacity, middle lime-gradient `#e3f99c→#8ab030` @0.9, bottom solid white `#e8eaf0`), each with a subtle drop shadow, on a rounded-rect background. No text → no font-rendering issues (the previous text icons drifted on small sizes). The app-icon background is a **radial gradient** (`#1a1d24` center → `#0a0b0e` edge) for a lighter-center glow, not a flat fill. `scripts/generate-icons.js` was rewritten to this design; it now generates **5 main PNGs** (favicon-16/32, apple-touch-180, icon-192, icon-512) + `icon.svg`, and **3 runner PNGs** (runner-apple-touch-180, runner-icon-192/512) + `runner-icon.svg`. The runner set is identical except the **teal top wave is swapped for orange** (`#fbb86c→#c2540a`); lime + white waves unchanged. Re-run with `node scripts/generate-icons.js`. (`0680a84`, `f1fc649`, `bf6afb4` wave scale+glow, `6ceea3b` runner orange.)
- **`components/PRSFloIcon.tsx` is the bare wave mark for in-app use (nav + login/reset + runner hub + splash).** Same three-wave SVG (no rounded-square container — that square is app-icon-only), accepts a `size` prop, and sits on a centered teal radial glow (`radial-gradient(circle, rgba(93,202,165,0.12) 0%, rgba(0,0,0,0) 70%)`) sized 1.4× the icon that scales with `size`. Used at `size={38}` in the nav, `size={72}` on login/reset/splash, `size={32}` on the runner hub.
- **PRSFlo wordmark is locked and must be byte-for-byte identical everywhere — `components/layout/Nav.tsx` is the single source of truth.** Exact values: container `fontFamily: 'Syne'`, `fontWeight: 800`, `letterSpacing: -0.5`; `PRS` span `color: var(--accent)` (lime); `Flo` span `color: var(--text)` (grey), `opacity: 0.45`, `fontWeight: 500`. Only `fontSize` may differ per placement (20 nav, 18 runner-hub/splash-era, 48 login/reset). **Always copy these exact values; never recreate from description.** This rule was added because the login page once drifted to the wrong font (a rounded/script fallback) and wrong color (all-lime). Documented in CLAUDE.md → "Locked Design Conventions" so fresh sessions see it. (`23e5314`)
- **Stacked logo lockup spacing is `gap: 2` (icon directly above wordmark), site-wide.** Whenever the wave icon sits above the wordmark (login, reset-password, runner hub, and formerly the splash), the icon-to-wordmark gap is a tight `gap: 2` in a centered flex column, with ~`26` between the eyebrow/"PARAMOUNT RECORDING GROUP" and the icon. Established on the Runner Hub lockup, then back-ported to login + reset-password (`7b04203`, `4f1ff2b`). The **welcome splash** later dropped the wordmark entirely — it shows the `PRSFloIcon` alone at `size={72}` (matching the login icon) with `marginBottom: 26` to the greeting (`7446700`).

### WO day-rate `row_rate_type` — all seed paths must write it (June 29, 2026)
- **Every `studio_time_rows` seed/insert path must write `row_rate_type` AND `rate_daily`, not just `day_count`.** The bug: a day-rate session showed correctly on the admin WO but rendered as **hourly** on the runner WO, with the total multiplying the day rate by hours. Root cause — both the admin auto-seed/reconcile paths (`WorkOrderPopup.tsx`) and the runner seed (`app/runner/[studio]/wo/[id]/page.tsx`) set `day_count: 1` and put the daily amount in `rate`, but **omitted `row_rate_type` and `rate_daily`**. Since all display/total logic keys on `row_rate_type === 'day'` (strict, defaults to `'hour'`), a seeded day row defaulted to hourly. Fix: all five seed payloads now write `row_rate_type: isDay ? 'day' : 'hour'` and `rate_daily: isDay ? <dailyAmount> : null`. Admin rows were "fine" only because the admin **save** and the per-row Day/Hr **toggle** already persisted `row_rate_type`/`rate_daily`; the runner has no toggle and its save never wrote them, so a runner-seeded row stayed hourly forever. (`dda16b3`) Also surfaced a separate **two-vocabulary nuance**: `bookings.rate_type` stores `'day'|'hour'`, while the booking-form/`WOFormSync` `rate_type` uses `'hourly'|'daily'` — they are bridged by conversions at save (`'daily'→'day'`) and load (`'day'→'daily'`); a live query confirmed the DB only ever holds `'day'`/`'hour'`. `WOFormSync.rate_type` was tightened from plain `string` to the `'hourly' | 'daily'` union so a `=== 'day'` mistake on a form object becomes a compile error (`cfef95c`).

### Work-order creation centralized to booking-save (June 30, 2026)
- **`lib/createWorkOrder.ts` → `createWorkOrderForBooking(booking)` is the single, canonical creator — the ONLY code path in the app that inserts a `work_orders` row (and seeds its `studio_time_rows` + `equipment_condition_rows`).** It is called once, at booking-save, from `calendar/page.tsx handleSave`'s new-booking branch. The admin WorkOrderPopup and the runner WO page no longer contain their own create logic (see below). This ends the long-running duplicate-WO / "which surface seeds the rows" churn — the `.maybeSingle()` 300+-dupe bug, and the five divergent day-rate seed paths of the June 29 fix — by making exactly one place build a WO. Confirmed a preceding multi-session audit: **no server-side trigger / webhook / edge function / cron creates WOs** (bookings existed with zero WOs; WO-creation lag ran 2 s–20 h = human-driven WO-open, not a millisecond trigger), so lazy create-on-open was the real mechanism and its check-then-insert race had duplicated **27 of 44 booked WOs (61%)**. (`e2da7e8`)
- **A WO is created for Recording / Filming / Event-Playback sessions only — not Tech / Tour / Open Hours / cancelled.** The gate is the exported `bookingShouldHaveWorkOrder(booking)` predicate. **Data-model subtlety:** the three session types that get WOs are `session_type` values (`recording`/`filming`/`event_playback`), but the four exclusions are `status` values (`tour`/`tech`/`open_hours`/`cancelled`) — a `tech` booking still carries `session_type: 'recording'`. So the predicate necessarily gates on **status** (`!['tour','tech','open_hours','cancelled'].includes(status)`), not `session_type`, to actually exclude the non-session blocks.
- **Creation is idempotent + duplicate-proof.** `createWorkOrderForBooking` uses `upsert(payload, { onConflict: 'booking_id', ignoreDuplicates: true })` and only seeds rows when a *new* WO was inserted (a conflict adopts the existing WO and seeds nothing, so rows are never double-seeded). Backed by a new DB constraint — `ALTER TABLE work_orders ADD CONSTRAINT work_orders_booking_id_key UNIQUE (booking_id)` — run manually in the Supabase SQL editor after wiping test data (Claude has no DDL access). **The constraint is what makes `onConflict` legal**: the app upsert and the constraint are a coupled change — deploying the upsert without the constraint throws Postgres `42P10` ("no unique or exclusion constraint matching the ON CONFLICT specification") and breaks all WO creation. So the constraint must be live before the code deploys.
- **WO creation at save is non-blocking; the booking always wins.** `handleSave` inserts the booking first, then calls the creator inside its own try/catch — a WO failure is caught (not rethrown), so the booking save completes and the form closes. The error is surfaced (not swallowed) via a dismissible page banner (`woWarning`): *"Booking saved, but its work order could not be created… Reopen the booking to create it manually."* The booking is never rolled back (higher priority than the WO).
- **Admin WorkOrderPopup is adopt-first with a create fallback.** `initWO` adopts the booking's existing WO; if none exists it calls `createWorkOrderForBooking` (so admin has a real in-app retry path when save-time creation failed), then re-fetches and adopts. Its own `work_orders.insert`/seed block was deleted. A `woMissing` error state renders when the booking has no id, the type gets no WO, or creation fails. The existing "adopted WO has zero `studio_time_rows`" seed-fallback in `initWO` is kept as a safety net.
- **Runner WO page is strictly adopt-only — it never creates.** The old create-WO-on-open path and the runner-side `studio_time_rows` seed were both removed; the runner only reads and updates existing rows. If a booking has no WO yet it shows *"Work order not yet created — contact office."* Two defensive states were added: null `woData` (stale/deleted WO id → "Work order not found") and null `bkData` (orphan WO with no linked booking → "not linked to a booking") — so the page never blank-renders.
- **Runner hub `woMap` is deterministic earliest-wins.** The hub's booking→WO map now orders `work_orders` by `created_at` ascending and takes first-wins, so its badge points at the same WO the runner adopts when the card is tapped (robust against any legacy duplicates; moot once the constraint holds). `.in('booking_id', ids)` already excludes null-`booking_id` rows, so the `if (wo.booking_id)` guard is defensive only.
- **Disposition of the June 29 day-rate seed fixes (see the entry above):** FIX 1's day-rate column logic (`row_rate_type`/`rate_daily`) was **folded into** `createWorkOrderForBooking`, and the WorkOrderPopup create block it lived in was deleted. FIX 2 (the day-rate date-range sync in `calendar/page.tsx handleSave`'s *edit* branch, which reconciles rows when an existing booking's dates change) is a separate edit-time concern and was **retained**. FIX 3's `.upsert(onConflict: 'booking_id')` calls in WorkOrderPopup + the runner page were **deleted** — obsoleted by centralization (single creator) plus the DB unique constraint. The "all five seed paths must write row_rate_type/rate_daily" reality of the June 29 entry is therefore superseded: there is now effectively one seed path (the canonical creator) plus the retained edit-branch reconcile.

### Real-time everywhere — project-wide standard + publication migration (July 1, 2026)
- **Every page/component that reads from Supabase must pair the fetch with a `postgres_changes` subscription — one-time on-mount fetches are not acceptable.** The app runs as an installed PWA where users often can't/won't pull-to-refresh, so stale lists were a recurring complaint. This is now a **hard standing rule**, documented at the top of CLAUDE.md ("Standing Architecture Rules → Real-time data"). The reference pattern is `WebInquiryProvider` (a context exposing a `leadsVersion` counter that dependent views watch to re-fetch); the simpler pattern is a `useCallback` `load()` called on mount and again from the channel callback. Rules: unique descriptive channel names, always `return () => supabase.removeChannel(channel)` on unmount, never duplicate channels for the same table on a page.
- **`supabase/realtime-publication.sql` is the batch migration for the full pass** (`f882695`). It adds every list/detail table the app subscribes to — `flags`, `flag_comments`, `dashboard_tasks`, `dashboard_task_comments`, `checklists`, `daily_ops_submissions`, `petty_cash_entries`, `petty_cash_balances`, `mics`, `mic_checkins`, `mic_inventory_quantities`, `mic_inventory_submissions`, `rental_rows`, `payment_rows`, `clients`, `client_contacts`, `engineers`, `srs_log` — to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` on each (Postgres ships only PK columns by default, which breaks filtered subscriptions like `work_order_id=eq.X`). Run **once, manually** in the SQL editor (Claude has no DDL access), and it must be live **before** the subscribing code deploys — a channel on an unpublished table shows `SUBSCRIBED` but never fires. Already-published tables (`bookings`, `work_orders`, `studio_time_rows`, `equipment_condition_rows`, `equipment_condition_notes`, `leads`) are deliberately NOT re-added (`ADD TABLE` errors if already a member). `stock_items` and `mic_inventory` are intentionally omitted — they don't exist in this DB (verified via anon REST probe, PGRST205); the runner stock page falls back to `DEFAULT_ITEMS` and `mic_inventory` is legacy.

### Web Inquiry notifications + public inquiry form (July 1, 2026)
- **`/inquiry` is a public, unauthenticated lead-capture form** (`app/inquiry/page.tsx`, outside the `(main)` route group so no `AuthGuard`). It collects first/last/email/phone/notes and inserts a `leads` row with `status: 'uncontacted'`, `source: 'Web Inquiry'` using the browser anon key only (no service-role key). On success it swaps the form for an in-place thank-you screen (no redirect). Styled over a full-bleed studio photo (`public/inquiry-bg.jpg`) + dark gradient + frosted card + `paramount-logo.png`.
- **`'Web Inquiry'` is now a first-class `leads.source` value** that drives a three-layer notification system, all fed by ONE `leads` realtime channel via `WebInquiryProvider` (`components/notifications/WebInquiryProvider.tsx`), mounted once in `app/(main)/layout.tsx` inside `AuthGuard`: (1) a persistent pulse/glow on the dashboard Needs Action card for any unacknowledged inquiry, (2) a browser-tab title badge (`(N New) PRSFlo`), and (3) transient site-wide slide-in toasts (`WebInquiryToaster`). "Unacknowledged" = a `source='Web Inquiry'` lead still `status='uncontacted'`; it clears only when the status changes away from uncontacted (a realtime UPDATE), never on click/open. State **hydrates on mount** so overnight inquiries persist across refresh even before any realtime event fires. The provider also exposes a `leadsVersion` counter that bumps on every `leads` INSERT/UPDATE, so list views (dashboard Needs Action, CRM) re-fetch live off this single shared subscription instead of opening their own `leads` channels. Requires `supabase/leads-realtime.sql` (adds `leads` to the publication + `REPLICA IDENTITY FULL`) — until run, hydration still surfaces existing inquiries but live toasts won't fire.

### CRM tab logic, lead avatars & stored initials (July 1, 2026)
- **`leads` has a single `status` field — there is no separate "temperature" column.** `status` (`hot|warm|cold|uncontacted|booked|dead`) is both the pipeline stage and the heat. A recurring source of confusion; the CRM All-Leads bucket predicates were corrected so a never-contacted hot/warm lead no longer appears in BOTH Uncontacted and its heat tab: Uncontacted = `status === 'uncontacted'` only; Hot/Warm key on status and exclude uncontacted; Cold/Dead + Booked unchanged.
- **CRM All-Leads status tabs are independent multi-select toggles, not single-select** (`f410031`). Default active set = the active pipeline: Uncontacted + Hot + Warm ON (Cold/Dead + Booked OFF); the "All" tab was removed (all-on is equivalent). Empty set falls back to showing every status so the list is never blank. Count badges show per-status totals regardless of which tabs are active. Active set persists in `sessionStorage` (`crm_al_active`, JSON array).
- **Lead-list cards use a temperature-colored initials avatar, not left/right border "bookends"** (`4afe1e8`, `8564aa4`, `3c4113e`). The avatar is a 36px circle with a 2px colored ring + matching text, no fill (`LEAD_AVATAR_COLORS`, single color per status: hot `#EF4444`, warm `#F97316`, uncontacted `#7BA7BC` = the Uncontacted tab/pill blue, booked `#14B8A6`, cold/dead `#4B5563`). Selected-row highlight is neutral `rgba(255,255,255,0.04)` (was lime).
- **`user_profiles.initials` is the source of truth for staff initials, everywhere initials auto-populate** (`a7bb9c5`, migration `supabase/user_profiles-initials.sql`). Nullable text column, seeded by `display_name ILIKE` match (ES/FR/AA/AM/IH/QC/TD/SS). The app reads `profile?.initials || profileInitials(profile?.display_name)` (stored value first, computed fallback = first letter of first word + first letter of last word). Applied to authenticated (main) surfaces only — CRM contact-log prompts (Touch / Keep Hot / Keep Warm / Dead) and admin Mic Inventory editing — replacing manual initials inputs with read-only auto-filled displays. **Runner pages (`/runner/[studio]/mics`, `/checklist`) keep manual initials inputs by design** — they're public/no-auth and their submit is initials-gated, so auto-populating from a (nonexistent) profile would blank the field and break submission.

### Security hardening — real RLS, PIN login, SOP gate, tech role, rate limiting (July 2, 2026)
This session flipped the app from "UX gating, RLS off" to **enforced Row-Level Security**, and added a PIN login, a first-login SOP gate, a distinct `tech` role, and per-IP rate limiting on the two public/expensive endpoints. **This SUPERSEDES every "No RLS until Chunk 9 / anon key has full table access" note elsewhere in this doc.** All migrations are run manually in the Supabase SQL editor (Claude has no DDL access); each is a committed file under `supabase/migrations/`.

- **RLS is now enforced on every table, keyed on `user_profiles.role` via `auth.uid()`.** Migration `20260702161117_rls_security_hardening.sql` (`c24e4de`, fixed in `cea7fbd`). Two `SECURITY DEFINER` helpers with pinned `search_path`: `get_my_role()` (role for `auth.uid()`) and `get_my_profile_id()` (caller's `user_profiles.id`, for task ownership). The legacy open `"Public access" USING(true)` policies on leads/clients/work_orders/qc_reports/contact_log are dropped first, then per-command (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) policies added to ~32 tables. Tiers: **staff+** = asst_manager/billing/manager/owner; **mgr+** (delete) = manager/billing/owner; **owner** = owner; plus isolated **tech** and **runner** tiers. All role policies are `TO authenticated`; anon gets nothing except (initially) a constrained `leads` INSERT for `/inquiry`, later removed (see rate limiting).
- **Every table block is guarded with `IF EXISTS (SELECT FROM pg_tables …)`.** The first run failed with `ERROR 42P01: relation "expense_rows" does not exist` — the audit was doc-based and several *documented* tables aren't in the live DB. `cea7fbd` rewrote the migration so each table's `ENABLE RLS` + policies live inside a `DO $$ … IF EXISTS … END IF $$` block (direct DDL in PL/pgSQL), so a missing table is skipped instead of aborting. The whole file is wrapped in `BEGIN/COMMIT` (atomic). `stock_items` and legacy `mic_inventory` are among the absent-and-skipped.
- **The `role` set gained `runner`; `user_profiles` gained `sop_acknowledged`.** The role CHECK was widened to `owner|manager|billing|asst_manager|tech|staff|runner` (legacy values kept so the ALTER can't fail existing rows). `auth_user_id` is backfilled by joining `user_profiles.email` → `auth.users.email` (all staff must have auth accounts first). A shared **runner** profile is seeded (`runner@paramountrecording.com`, `auth_user_id` NULL until the PIN account is built — so `get_my_role()` returns nothing for it yet, and the whole runner subtree is effectively offline until then, an accepted interim). `UserProfile['role']` TS union gained `'runner'`; `UserProfile` gained `sop_acknowledged?`.
- **Registration writes moved server-side (`app/api/register/route.ts`, service role).** The public `/register/[token]` page formerly did all its writes (token validate/consume, client insert/update, lead link, ID upload to `client-ids`) with the anon key. Now a single service-role route does it (GET validates token + returns prefill; POST handles submit / use-existing / create-new incl. the email-conflict flow). `register/[token]/page.tsx` calls the route (no Supabase client left in it); `register/view/[clientId]/page.tsx` print route switched anon → service-role. Required because RLS now blocks anon writes to those tables.
- **`checklist-photos` is now a PRIVATE bucket; reads are signed on demand.** Was public (permanent `getPublicUrl`). Section 6a of the RLS migration sets `public=false`, drops the named live anon storage policies (`anon can upload client IDs`, `anon can generate signed URLs for client-ids`, `Allow anonymous uploads`, `Allow anonymous reads`) + a dynamic `%checklist%` drop, and adds authenticated-only `checklist_photos_{select,insert,update,delete}`. New `lib/photos.ts` (`signedPhotoUrl`/`signedPhotoUrls`/`toStoragePath`) + `components/shared/SignedImage.tsx`: **write sites store the storage PATH** (not a URL); **read sites mint a 1-hr signed URL at render**. `toStoragePath` strips the legacy `/checklist-photos/` prefix so old rows (full public URLs) still resolve without a data migration. All 7 upload sites + ~10 render sites converted. The dead `expenses` bucket's anon INSERT/SELECT policies were also dropped (Section 7).
- **Daily backup uses the service-role key.** `scripts/backup.mjs` + `.github/workflows/daily-backup.yml` switched `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `SUPABASE_SERVICE_ROLE_KEY` — with RLS on, the anon key can't read the tables, so the backup would silently return empty otherwise. **Manual step:** add `SUPABASE_SERVICE_ROLE_KEY` as a GitHub Actions secret.
- **PIN login is the primary login UI; email/password is a fallback link** (`4fdc400`, `1fd0a3f`). `app/(auth)/login/page.tsx` rewritten to a 4-dot numpad (auto-submits on the 4th digit, shake on wrong PIN, `localStorage 'pin_lockout'` 5-fails→30s UX lock) with a "sign in with email instead" toggle; the email form gained a `lucide-react` `Eye`/`EyeOff` show/hide toggle (**Tabler is NOT installed — `lucide-react` is the project's icon lib**). DB: `staff_pins` (bcrypt `pin_hash`, `20260702165838_staff_pins.sql`; **PINs seeded via a git-ignored `supabase/seed/staff_pins_seed.local.sql` — plaintext PINs must never enter git**), and `20260702170825_pin_auth.sql` = `pin_login_attempts` (server-side lockout) + `verify_staff_pin(text)` `SECURITY DEFINER` RPC granted to `service_role` ONLY. Route `app/api/auth/pin/route.ts` (service role): DB-backed per-IP 5-fails→30s lockout, bcrypt-verify via the RPC, then mints the session. **Originally (July 2)** this used `auth.admin.generateLink({type:'magiclink'})` → the browser `verifyOtp`'d the returned `hashed_token`; **as of July 8, 2026 (`1844257`)** it uses `auth.signInWithPassword` on a **dedicated anon-key client** (never the shared module-level `supabaseAdmin`, whose service-role session must not be replaced by a user session, or its later RLS-bypassing `.from()`/`.rpc()` calls would run as that user) → returns the session `access_token`/`refresh_token`, which the browser adopts via `supabase.auth.setSession()` (one call, no OTP exchange — removes the old ~3–4s delay). This requires `staff_pins.supabase_password` (a fully-random 32-char server-set secret per staff, NOT derived from the PIN, provisioned by `scripts/set-staff-passwords.mjs`; `verify_staff_pin` now also returns it — migration `20260708120000_staff_pins_supabase_password.sql`). Returns `403 no_account` for a matched PIN whose profile has no `auth_user_id` **or** no provisioned password (the runner today). **Accepted caveat:** 4-digit PINs + client + DB per-IP limiting isn't brute-force-proof under IP rotation; future hardening = 6-digit / escalating lockout. (PIN hashes were rehashed to **bcrypt cost 8** from 10 on July 8 to shave verify latency — `gen_salt('bf', 8)`, via git-ignored `supabase/seed/*.local.sql` run manually.)
- **First-login SOP gate** (`2595321`). `components/SopGate.tsx` mounted in `(main)/layout.tsx`: a full-screen, non-dismissable modal while `profile.sop_acknowledged` is false; the only exit is "Take me to the SOP" → `supabase.rpc('acknowledge_sop')` (a `SECURITY DEFINER` RPC — `user_profiles` UPDATE is mgr+-only, so non-managers couldn't self-set the flag) → `/sop`. z-index `99999` (below the welcome splash's `100000` so the splash wins on first login; above the Nav via DOM order). A local `dismissed` state stops it re-covering `/sop` after the click. Migration `20260702175211_sop_acknowledged.sql` = the column + the RPC.
- **Task visibility is now RLS-enforced, not tab-based trust.** `dashboard_tasks.is_private` (`20260702175212_dashboard_tasks_is_private.sql`) is auto-derived by a trigger: true when `assigned_by = assigned_to = Eli's user_profiles.id` (the addendum's `created_by`/`assignee_id` map to `assigned_by`/`assigned_to`, which store `user_profiles.id`, NOT `auth_user_id`). Migration `20260702175800_dashboard_tasks_visibility.sql` sets the tiers: **owner/manager/billing see all non-private; everyone sees their own (`assigned_by`/`assigned_to` = me); Eli's `is_private` tasks are visible only to Eli** — they're his self-tasks, so the "own" clause covers him and excludes even the other owner (Adam-Mike). asst_manager/tech/runner are own-only. Comments follow the task via an `EXISTS (SELECT 1 FROM dashboard_tasks …)` subquery that is itself subject to the task RLS (no duplicated logic). App side (`lib/tasks.ts`): `fetchMyTasks`/`fetchMyCompletedTasks`/`isOwnOnlyRole`; the dashboard panel and `/tasks` show a single **"My Tasks"** view for own-only tiers instead of the per-person tab row, and the Add-task Assign-to dropdown is now shown for them too (a "Me" default self-assigns via the `profile.id` fallback). **Post-launch note:** `ASSIGN_OPTIONS` can only target primaries (Asst Mgr→Quinn, Tech→Sierra), so Isaac/Tom aren't individually assignable.
- **`tech` is a restricted role, distinct from `staff+`** (`2595321`). Matrix: CRM / bookings / qc_reports / engineers / srs_log = **no access**; work_orders + its line-item tables + payment_rows = **read-only**; daily_ops / checklists / petty_cash / mic_checkins / quantities / submissions = read+write; `mics` catalog = read-only; flags/flag_comments = read+write; `user_profiles` = own row only; `dashboard_tasks` = own only. **Tech was then also granted read on `bookings` + `clients` + `client_contacts`** (`20260702183452_tech_read_bookings_clients.sql`, SELECT-only) so the **Calendar is usable** for them — a mid-session reversal of the original "no Bookings for tech". Nav hides only **CRM** for tech (Dashboard · Calendar · Admin · WO Hub · SOP stay). The Admin sidebar filters to **Ops Log / Flags / Mic Inventory** for tech (Engineers/SRS hidden; default bounced to Flags). `WorkOrderPopup` is **read-only for tech everywhere** (calendar / wo-hub / LocationStrip, gated by role inside the component): all write controls (footer Cancel/Complete/Close&Save, header cluster, add-row/rental/payment, delete-row, notes photo upload, signature pad) are hidden, leaving Export PDF + a plain Close; inline inputs stay visible but non-persisting (RLS also blocks tech writes). WO Hub itself has no create/edit buttons — they all live in `WorkOrderPopup`.
- **Per-IP rate limiting on `/inquiry` and `/api/ocr-receipt`** (`b780463`, `10e6957`). New `api_rate_limits` table (fixed-window, PK `(bucket, ip)`; `20260702193134_api_rate_limits.sql`) + `lib/rateLimit.ts` (`checkRateLimit`, service-role only; best-effort, documented). **`/inquiry` moved to a server route** (`app/api/inquiry/route.ts`, service role, **3/min per IP**; server forces `status:'uncontacted'`/`source:'Web Inquiry'`); the page now POSTs to it instead of the anon insert. To make the limit real, the anon `leads_ins_anon` policy is dropped in a **separate** migration (`20260702201353_drop_leads_anon_insert.sql`) that must run **AFTER** the route+page deploy — else the live form breaks in the gap — so the route becomes the only Web-Inquiry insert path. **`/api/ocr-receipt`** (was public + unauthenticated + unthrottled, and is currently UNUSED — zero callers) gained Bearer-token Supabase-session auth (`getUser(token)` → 401) + **10/min per IP**; auth runs before the limiter so unauth requests never touch it or Anthropic. When OCR is re-wired, the caller must send the session token (runners, anon until PIN, would get 401 — accepted).
- **SOP guide content edits** (`c302a87`, `public/sop.html` — the `/sop` iframe target): removed the "enter your initials" contact step (renumbered 1–5), reordered the status pills to **Uncontacted first** and recolored Uncontacted grey → steel blue `#7BA7BC` (pill + `STATUS_DATA`), and rewrote the priority language throughout from "Hot first, always" to **Uncontacted-first → escalate to management → then Hot** (intro line, the new UNCONTACTED summary card, and the CRM-steps card object).

### Supabase Policy Changes

As of May 30, 2026, any new table created in the public schema requires an explicit GRANT before it can be accessed via the Supabase Data API. After every `CREATE TABLE` statement, add:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON table_name TO anon, authenticated;
```

This applies to all new tables going forward. Existing tables are unaffected until October 30, 2026 when Supabase enforces this on all existing projects. **RLS is now enforced (July 2, 2026)** and layers on top of these GRANTs — the GRANT is table-level access, RLS is the row-level gate; both must permit an operation. New tables still need the GRANT **and** appropriate RLS policies.

### CRM — Needs Action & timers
- **Needs Action daily reset runs at 8am PST (cron: `0 15 * * *` UTC).** Hot/Warm leads reappear in Needs Action every day until their keep-hot timer expires (5 days Hot, 3 days Warm) or they are manually moved to Cold/Dead. The reset sets `needs_contact = true` so staff can't dismiss the same lead indefinitely without taking action or changing status.
- **Lead detail card uses 2-column layouts for space efficiency.** Contact section: Email/Phone on the left, Created/Last Contact on the right (gap 48px). Session & Quote section: Location·Studio + Session Date on the left, Quote/Rate + Start–End times on the right (gap 48px). Location and Studio dropdowns cascade — selecting a venue populates the studio options for that venue only.
- **Time inputs use 12-hour format with smart parsing.** Accepts `8p` → `8:00 PM`, `830a` → `8:30 AM`, `1830` → `6:30 PM` (24h converted), bare `8` → `8:00 AM`. Saves on Enter or Tab (blur). Legacy 24h values stored in DB are converted for display transparently.

### Runner Hub & Daily Ops
- **UTC → local date for all runner date queries.** `new Date().toISOString().slice(0, 10)` returns the UTC date — after 5 PM PDT this is already tomorrow. Every runner page now uses timezone-offset correction: `const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 10)`. This is also shared as `getLocalToday()` module helper where used across multiple effects. Same fix applied to `getYesterday` in LocationStrip (replaced entirely with `getLocalDateStr(offsetDays = 0)`).
- **Runner WO footer: Cancel / Save / Finish three-button layout.** Cancel navigates back without saving. Save persists current state and returns to studio hub (`router.push(/runner/[studio])`). Finish shows an inline confirmation dialog ("Are you sure this WO is complete?") before setting `runner_finished = true`, `runner_finished_at`, `status = 'submitted'`. WO remains fully editable after finishing — Finish is a status signal, not a lock. The confirmation dialog uses `showFinishConfirm` state; on confirm `handleFinish` fires.
- **Approved WOs stay visible in the Today panel until 8am the next day.** Previously, approving a WO immediately removed it from the LocationStrip Today column. The 8am operational-day cutoff (handled by `getLocalDateStr()`) already ages items off naturally when `today` advances. The immediate `activeSessions` filter (`!(wo?.admin_approved || wo?.status === 'approved')`) was removed — Today now shows all sessions for the current operational day regardless of approval state. SessionCard shows visual done-state via the Admin checkbox.
- **Needs Attention photos stored in the `checklist-photos` Supabase Storage bucket.** Both WO expense receipts and runner Needs Attention photos (plus dashboard-task/flag photos) live here. **As of July 2, 2026 this bucket is PRIVATE** (was public) — uploads store the storage **path** and reads mint a 1-hr signed URL via `lib/photos.ts` / `components/shared/SignedImage.tsx` (`toStoragePath` keeps legacy full-URL rows working). Authenticated-only storage policies; the old anon storage policies (and the dead `expenses` bucket's anon policies) were dropped. `supabase/storage-expenses-bucket.sql` remains only as a reference for a future isolated `expenses` bucket.
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
- **"Start Booking" replaces "Book Client" everywhere.** Always visible green button on lead detail cards and client profiles. On leads without a client record it opens ConfirmClientModal (creates client, navigates to `/clients?id=...`); on leads or clients that already have a client record it navigates directly to `/calendar?newBooking=1&clientId=...` with form pre-filled. "View Client" button was removed as redundant. **Temporarily replaced July 8, 2026 (`7332eb8`; see the July 8 session note) — reverts when the real booking form ships:** the lead-detail button is renamed **Confirm Client Account** and both flows now end in a modal with **no redirect** — new client → the unchanged `ConfirmClientModal` → a "Client Account Created" success modal (Done); returning client (has `client_id`) → a "Mark as Booked" confirm modal (Confirm) — each setting `leads.status='booked'`. Every added block is marked `// TEMPORARY: remove when booking form is live`. **[SUPERSEDED July 28, 2026 — v1.1.1:** Start Booking was restored and opens the WO; the confirm-client + mark-as-booked modals were **kept** (reachable from the status pill only) because marking a lead Booked is a distinct act from booking a session. The `// TEMPORARY` comments were rewritten accordingly — **do not delete those blocks.**]
- **`clients.artists[]` is the authoritative label roster.** It is the source of truth for artist autocomplete on the lead form (Label mode), booking form, and the "Artists" section on label client profiles. `client_contacts[*].artists[]` is the per-A&R subset ("which artists does this rep handle") — adding an artist via any surface writes to `clients.artists[]`; adding via an A&R card also writes to that contact's own array. The profile shows both: the flat roster under "Artists", and per-A&R lists under each A&R card in "Contacts (A&Rs)". `lib/roster.ts` owns `addArtistToLabel` / `removeArtistFromLabel`.
- **Autofill pickers (contacts, artists) are reusable components.** Built as standalone components in `components/clients/` or `components/shared/`, will be reused in the Calendar's New Session modal.
- **Public-facing forms use scrollable embedded legal text rather than external links or modals.** Keeps clients on the page, mobile-friendly, legally protective. T&Cs content lives in `lib/terms.ts` as a structured array (heading + body), easy to update without touching form logic.
- **All Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) must be configured for ALL THREE Vercel environments (Production, Preview, Development).** Preview deploys fail with "supabaseUrl is required" if missing from the Preview environment.
- **Lead detail card — Activity Log + Contact button (May 2026):** Activity Log section appears above Session Notes in the lead detail card. Fetches all `lead_activity` rows for the lead plus synthesizes synthetic events (Lead Created from `lead.created_at`; Reg Link Sent / Registration Returned from `registration_tokens.created_at/used_at`). Color-coded dots: Call=red, Text=orange, Email=sky-blue, Reg=accent/green, Created=gray. "Mark Touched" button renamed to "Contact" everywhere. When the Contact prompt opens, action link buttons (Call / Text / Email) appear at the top — tapping opens `tel:`, `sms:`, or `mailto:` and auto-selects the matching method in the form. No Answer / DNA button was removed entirely — it added noise without value.
- **Session Notes is purely freeform.** Activity (touches, keep-hot, etc.) is logged only to `lead_activity` — nothing is auto-appended to the notes field. Notes are seeded from the lead's original inquiry and are staff-editable only.
- **COD vs Label/Billing color convention:** COD = `#7BBFFF` (sky blue), Label/Billing = `#96A9FF` (periwinkle). Same brightness, distinct hues. Applied to lead names in CRM list and detail card header, client names in Clients list and profile header, billing pills everywhere, COD/Label-Billing toggle active state in New Lead form, and the Email button color. Lead name color is driven by `billing` field (`=== 'Billing'`), not `artist_name`.
- **RETIRED (June 27–29, 2026): the COD/Label blue/lavender convention is gone from the CRM lead detail, the booking form, and the WO modal.** `leadNameColor()` was flattened to return `var(--text)` (no payment tint); the booking-form hero title + CLIENT card name + badge + COD/Label toggle + A&R email button + search sub-line were all neutralized to white/grey (`var(--text)` names, `var(--text2)`/`#6B7280` secondary, neutral grey pills), and the dead `COLOR_COD`/`COLOR_LABEL` constants removed from `BookingForm.tsx` (`9accc20`). The two-vocabulary `billing` field is unchanged in the data — only the *coloring* was removed. The blue/lavender hexes now survive only where explicitly intended (e.g. the older Clients-profile COD treatment that wasn't in scope).
- **Action/CTA buttons in CRM, Clients, and the booking-form lockups use the "outlined dark pill" convention — NOT a lime fill.** `background: 'transparent'`, `color: '#e8eaf0'` (white), `border: '1px solid var(--border)'`. This replaced the old `var(--accent)` lime fill on Start Booking, + New Lead, + New Client, the CRM Contact buttons, the ClientProfile Add/Save/Add Contact/Add Admin buttons, and the login Sign In button (`d8c6b67`→`3e3d3e4`, `16cd055`/`a4495bd`, `7b04203`). **Important — this lime→outlined flip was done backwards twice** (first to a *white fill* with black text, then corrected to the transparent outline); the user's standing rule is **outlined dark, never white fill**. Heat-tied controls (Keep Hot/Warm, the status `<select>`, anything keyed on `lead.status`/`var(--hot)`/`var(--warm)`) are deliberately left in their status colors.
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

### Theming & typography (July 13–16, 2026)
- **Light/dark theme keys on `data-theme="light"` on `<html>`; default is light.** A blocking inline `<script>` in `app/layout.tsx` sets it before first paint unless `localStorage['prsflo-theme']==='dark'` (covers login/splash, which have no Nav); `Nav.tsx` re-applies on mount and owns `toggleTheme()` (persists to `localStorage['prsflo-theme']`). Dark is the *absence* of the attribute (`removeAttribute('data-theme')`), so all pre-existing dark styling is the default and light is the override layer — **light-mode rules must never leak into dark**, which is why they're all scoped under `[data-theme="light"]`.
- **Light mode overrides inline styles via attribute selectors, not per-component edits.** The app styles everything with inline `style={{}}`, which beats normal CSS. So light mode is a block of `[data-theme="light"] …` rules that either (a) redefine the CSS variables (`--surface`, `--accent`, etc. — most of the app follows automatically), or (b) match inline-style substrings / `data-*` markers with `!important` for the glass/gradient treatments (`[style*="background: var(--surface)"]`, `data-panel`, `data-modal-gradient`, `data-studio-card`, `data-session-card`, `data-ops-col`, `data-section-head`, `data-lead-content`, `data-eng-needed`, `data-login-key`, `data-splash`, …). When adding a new surface that needs a light-mode gradient, add a `data-*` marker + a rule rather than editing the component's inline style.
- **`--accent-rgb` is the theme-aware accent triple (dark `200,240,78` / light `59,130,246`).** Write accent tints as `rgba(var(--accent-rgb), a)` so they follow the theme (lime in dark, blue in light) — never hardcode the lime literal. Light mode's `--accent` is blue `#3b82f6` (lime is retired in light).
- **`PRSFloIcon` recolors itself in JS, not via CSS.** The wave mark is `'use client'` and watches `data-theme` with a `MutationObserver`, setting **solid strokes** in light mode instead of the dark SVG gradients. CSS `stroke` overrides were unreliable because the three waves reference gradient `url(#id)`s whose IDs duplicate across every icon instance on the page. Light strokes: two blues `#3b82f6` + a light blue `#93c5fd`; dark keeps the teal/lime gradients.
- **The app body font is Inter; DM Mono is reserved for code-like elements only.** *(July 15, 2026.)* Base `html, body` is `Inter` at `14px` (Google-Fonts `@import` in `globals.css`). Because ~728 elements set `fontFamily: 'DM Mono'` inline (which overrides the base rule), the switch required a mechanical inline sweep across 42 files — a CSS-only change would have been invisible. DM Mono is kept (via inline `fontFamily` or the new `.font-mono` utility) on: activity-log timestamps, avatar initials, invoice numbers / IDs, and the PIN numpad digits. Syne (wordmark/headings) and DM Serif Display are unaffected. **When adding new UI, default to Inter (i.e. don't set `fontFamily` unless it's Syne/DM Serif for a heading, or a deliberate code-like value).**
- **`leads.created_by` stores the `user_profiles` surrogate `id` (not `auth_user_id`).** *(July 15, 2026.)* New leads are attributed via `created_by: profile?.id` at insert; the reader resolves initials with `user_profiles.eq('id', created_by)`. This matches the `dashboard_tasks.assigned_to/by` convention. Web-inquiry leads (public `/api/inquiry`) have `created_by = null` and are attributed to "Inquiry" via the `source` check instead.
- **Studio short codes are display-only.** `StudioSelect`'s `shortCodes` prop swaps the venue name for a code (`PRS`/`ARS`/`ERS`/`TRK`) in the option label using a `STUDIO_CODES` map; the stored `Venue|Room` value and `parseLocation`/`combineLocation` are unchanged. Only the CRM lead detail opts in — the New-Lead modal and calendar still show full names.
- **Private `client-ids` photos are signed through a dedicated service-role route.** `app/api/client-id-photo/route.ts` (`GET ?storagePath=`, 60-min signed URL, legacy full-URL normalization) is the browser-safe way to view registration ID files from the private `client-ids` bucket — the anon key can't sign them, and `lib/photos.ts`'s `signedPhotoUrl` is scoped to `checklist-photos`, a different bucket. The registration modal embeds images inline (with an in-app lightbox) and PDFs via `<iframe>`.

### The unified Work Order (Booking = WO) rebuild — IN PROGRESS (July 21, 2026)
*Master plan: `docs/WO-SPEC.md` (read it before touching WO/booking/calendar code). This section captures the locked decisions; the dated session entry below records what shipped.*
- **The Work Order IS the booking — one form, one source of truth.** The old model had two forms (BookingForm seeds → WorkOrderPopup) that both wrote the same session data, which required brittle bidirectional sync (the "two sources of truth" pain). The rebuild collapses them: a lead converts straight into a **single Work Order** on the calendar. `BookingForm.tsx` is being deleted (Step 8). The `bookings` row survives only as a **denormalized calendar projection** written *from* the WO on save — the user never edits a booking row directly.
- **The link direction inverted: `bookings.work_order_id → work_orders(id)`, one WO to MANY cards.** Previously `work_orders.booking_id` (UNIQUE, 1:1). Now the WO is the spine and one WO can drive several calendar cards (one per room-run). The old `work_orders.booking_id` stays during the transition and is dropped in a later cleanup migration (Step 9). Migration `20260721120000_wo_number_and_booking_wo_link.sql`.
- **The WO top holds ONLY session-level fields; everything per-day lives in the Studio Time table.** Top = WO number, status bar (Confirmed/Tentative/Cancelled/Tour/Tech/Open Hours), session type, billing (invoice/PO/food), client panel, Booking Notes. The old flat header block (studio, rate, dates, times, engineer, assistant) was **removed** from the top — studios/dates/times/rates/OT/engineers now live *only* in `studio_time_rows`. This is what kills the redundancy: the table is the single home for the schedule. (Putting per-day fields both on top and in the table would recreate two-sources-of-truth inside one form.)
- **Session-level fields moved onto `work_orders` so the WO is self-contained.** Migration `20260721130000_work_orders_session_fields.sql` adds `session_status` (calendar status; distinct from `work_orders.status` = open/completed WO lifecycle), `session_type`, `client_id`, `is_srs`, `cod_method`, `anr_contact_id`, `anr_admin_contact_id` (backfilled from the linked booking). Plus `wo_number` (below) and `booking_notes` (`20260721140000_work_orders_booking_notes.sql`). Note: `bookings.anr_contact_id`/`anr_admin_contact_id` are **text**, the new WO columns are **uuid** — the backfill casts `nullif(b.x,'')::uuid`; `is_srs` is assigned directly (not coalesced) because the new NOT NULL DEFAULT false would mask the booking's value.
- **WO numbers: permanent `WO-####` from a Postgres sequence, assigned at creation.** `work_orders.wo_number` (unique, NOT NULL, default `'WO-' || nextval('wo_number_seq')`, sequence starts 1001). Distinct from `invoice_number` (set later at billing). Shown in the WO header and (per spec) on calendar cards. Existing 8 WOs backfilled oldest-first → WO-1001…WO-1008.
- **Notes taxonomy — four distinct surfaces, do not conflate:** `session_notes` = client-facing, **prints on the invoice/PDF**; `flags` = operations flag system (separate feature); `needs_attention_notes` = runner "needs attention" workflow (with photos); **`booking_notes`** (NEW) = internal/ops notes *about the booking* (arrival, payment, past experience) — never printed, lives in the WO top-left panel with an "INTERNAL ONLY" badge and `data-no-print`.
- **The Seed panel is an append-only row generator, never a second source of truth.** `lib/seedStudioTimeRows.ts` (`seedStudioTimeRows`, extracted from `createWorkOrderForBooking` so both share it) bulk-adds one `studio_time_rows` row per day for a date range; **dates that already have a row are skipped** (never overwrites). Exposed as a collapsible "+ Seed — add multiple days" panel above the Studio Time table so a 30-day session (or a +2-week extension) is one action, not N hand-built rows. After seeding, every day is edited individually in the table.
- **The client panel is a shared component (`components/shared/ClientPanel.tsx`).** Self-contained (owns its own search/roster/contact state), emits only the client-subset of session fields via `onChange`. Faithful port of the BookingForm right-column logic (SRS toggle, COD/Label toggle, client/A&R/artist search + autofill, inline add-contact, contact-update prompt, view-profile). Built fresh rather than surgically extracted because BookingForm is being deleted and the flow isn't live yet.
- **Calendar-card projection (Step 5): studio bare-letter → full room label.** `studio_time_rows.studio` stores `'X'`/`'A'` (or `'North'`/`'South'`); the calendar grid filters full room labels (`'Studio X'`, `'North'`). `roomLabelForVenue(venue, raw)` in `WorkOrderPopup.tsx` converts within the booking's venue. Step 5a (shipped) syncs studio + dates + times + `work_order_id` onto the single primary card and links the card at WO-creation; Step 5b (next) adds multi-room segment splitting (one card per consecutive-same-room run). Rooms "usually one per session, sometimes change" (Eli); runner hub is per **location** (not room), so room changes within a venue are invisible to runners and accuracy comes free from reading the same projected cards as the calendar.
- **Build discipline:** branch-per-step, `tsc --noEmit` clean before every hand-off (local `npm run dev` is broken since PIN login, so this is the pre-push check), migrations authored idempotent and run manually by Eli. Because this flow **isn't in production use yet**, safe/additive steps merge straight to main; visible/risky steps go on a branch for a Vercel preview first.

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

### Chunk 9 — Auth ✅ largely DELIVERED July 2, 2026
See the "Security hardening" Decisions Log subsection for what shipped. Original intent, now mostly done:
- **✅ RLS enforced across all tables**, keyed on `user_profiles.role`. Role-scoped: office roles (owner/manager/billing/asst_manager) get broad access; `tech` is restricted (read-only WOs, no CRM/bookings-write); `runner` is scoped to operational data.
- **✅ Storage anon policies replaced with auth-based policies** (`checklist-photos` private + signed URLs; `client-ids` reads via signed URLs; registration upload moved server-side).
- **⏳ Remaining:** the shared **runner PIN auth account** isn't created yet, so runner login/access is offline until then (the RLS `runner` tier + PIN infra exist and wait for it). Runner-write **per-studio** scoping is still interim (gated to `role='runner'` across all studios; tighten when PIN lands).

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

*Last updated: July 2, 2026 — Security hardening session: enforced RLS on every table (keyed on `user_profiles.role` via `auth.uid()`), PIN login (numpad primary, email fallback), first-login SOP gate, a distinct read-only `tech` role (reduced nav/admin, WO view-only) with Calendar read access, RLS-enforced task visibility (Eli's private self-tasks), a private `checklist-photos` bucket with signed reads, server-side registration + inquiry routes, and per-IP rate limiting on `/inquiry` (3/min) and `/api/ocr-receipt` (10/min, + Bearer auth). Backup switched to the service-role key. See the "Security hardening" Decisions Log subsection + the July 2 session note. — Prior, June 25, 2026 — Auth + user profiles + dashboard task rebuild. Shipped: Supabase Auth login / forgot-password / reset (`app/(auth)/*`) + a client-side `AuthGuard` on the `(main)` layout (no SSR middleware — localStorage sessions; UX gating only, RLS still off) + nav Sign Out button + nav clock upgrade; `user_profiles` table (surrogate PK + `auth_user_id` link + `email` lookup key; `supabase/user_profiles.sql`, run manually) and `dashboard_tasks.assigned_to`/`assigned_by`; `useUserProfile` hook + personalized greeting; dashboard task panel rebuilt to 6 per-user tabs (resolved by display_name, driven by `assigned_to`) with role-based visibility, a scrollable tab bar, a full add-task modal (flat Assign-to dropdown), and a redesigned task detail modal. **Open:** add-task photo "not saving" still being debugged (resume June 26) — save path verified healthy via probes; thumbnail preview + insert-error logging added. See the Decisions Log "Auth, user profiles & task assignment" subsection. — Prior, June 24, 2026 — UI polish pass (`ui-polish` branch, merged to `main`): new shared primitives `components/ui/StatusBadge.tsx` + `components/ui/SectionHeader.tsx` replacing ad-hoc status text and section headings app-wide; nav tabs restyled to a bottom-border underline treatment + the calendar tab count badge removed (`tentativeCount` state/fetch retained); dashboard room-grid cards get teal/orange state glow + 2px top bar; calendar booking chips recolored confirmed green `#22c55e`→teal `#14B8A6` and given a subtle glow (orange "open-WO" maps to the existing `tentative` signal — no WO data on those surfaces). The CRM lead-row card redesign was attempted (`f934716`) then reverted (`3df8016`) — not shipped. Earlier June 24 — Admin Mic Inventory admin editing: per-row inline-cell status editing (Status dropdown, per-studio Room dropdown, Qty, "Initials" field) + Manage Mics modal (master list edit/deactivate/reactivate + Add Mic); `mic_checkins` gained `source`/`amended_by`; qty always writes to `mic_inventory_quantities`. Also fixed the Engineers table actions column overlapping the Status pill (80px→180px). June 23 — Admin Mic Inventory tab (`components/admin/MicInventorySection.tsx`): read-only consolidated cross-studio view with missing-mic banner, horizontal studio tabs, status colors, per-tab Show History. Also backfilled the mic data model (the four live tables `mics`/`mic_checkins`/`mic_inventory_quantities`/`mic_inventory_submissions` were undocumented; legacy `mic_inventory` clarified). June 22 (later session) — A&R artist-persistence root cause (Clients page refetch select omitted `artists`/`contact_type`; corrected the prior "strip id/client_id fixed it" claim), and booking artist-search reworked to run through `client_contacts` with `.or('contact_type.eq.anr,contact_type.is.null')`. Earlier same day: WO→Calendar sync (schedule round-trip, studio-format bugfix, WO-owns-schedule gating), UnifiedSessionForm experimental build (owner-gated, inline WorkOrderPopup), booking-form artist search + A&R autoselect, dashboard room-grid → booking modal. Earlier: June 16 flags system + dashboard room grid.*

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

---

### June 27, 2026 — PWA: installable icons + manifests for the main app and runner hub

**Key commit:** `fe17795` (`feat: PWA icons and manifests for main app and runner hub`). Touches `app/layout.tsx` (+10), new `app/runner/layout.tsx` (+21), `package.json`/`package-lock.json` (`sharp` dev dep), new `scripts/generate-icons.js` (+92), and 12 new `public/` assets (8 PNG + 2 SVG + 2 JSON manifests). `tsc --noEmit` clean; verified against the running dev server (both routes 200, rendered head tags inspected). See the "PWA — installable home-screen apps" Decisions-Log entry for the rationale behind each choice.

Goal: let staff add PRSFlo to their phone home screen as a proper app (branded icon, chromeless standalone launch), and let runners install the **Runner hub as its own separate app** that opens straight to `/runner` with a distinct icon. **Scope is icons + manifests only — no service worker, no offline caching** (deliberate; offline is a separate future effort).

**What shipped:**
- **`sharp` installed** as a devDependency (`^0.35.2`) — build-time icon rasterizer, never imported by the app.
- **`scripts/generate-icons.js`** — plain Node script holding two inline SVG sources (main + runner; PRS FLOW chrome wordmark on a `#0d0f14` metal-gradient rounded-rect; runner adds a teal `RUNNER` badge under the wordmark). Rasterizes via `sharp` to 8 PNGs and writes the 2 SVG sources into `public/`. Re-run with `node scripts/generate-icons.js`.
- **`public/` assets generated:** main app → `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon.svg`; runner → `runner-apple-touch-icon.png` (180), `runner-icon-192.png`, `runner-icon-512.png`, `runner-icon.svg`.
- **`public/manifest.json`** (main) — `name "PRSFlo"`, `start_url "/"`, `display standalone`, `background_color`/`theme_color` `#0d0f14`, icons 192/512/512-maskable.
- **`public/runner-manifest.json`** (runner) — `name "PRSFlo Runner"`, `short_name "Runner"`, `start_url "/runner"`, same display/colors, runner icons 192/512/512-maskable.
- **`app/layout.tsx` (root)** — extended the existing Metadata API exports (the project already uses `metadata`/`viewport`, not raw head tags): `metadata.manifest = '/manifest.json'`, `metadata.icons` (favicon-32/16 + `apple: '/apple-touch-icon.png'`), `metadata.description`, and `viewport.themeColor = '#0d0f14'` (themeColor belongs in `viewport` since Next 14+). No raw `<head>` tags added — see why below.
- **`app/runner/layout.tsx` (new server component)** — `app/runner/page.tsx` is `'use client'` and can't export metadata, so a passthrough server-component layout (`return <>{children}</>`) was added to wrap the `/runner/*` subtree and host `metadata.manifest = '/runner-manifest.json'`, `metadata.icons.apple = '/runner-apple-touch-icon.png'`, and `appleWebApp` (`capable: true`, `statusBarStyle: 'black-translucent'`, `title: 'Runner'`).

**The one design decision worth remembering — Metadata API, not raw `<head>` tags.** The literal request was to add `<link rel="manifest">` / `<link rel="apple-touch-icon">` / `<meta name="theme-color">` to the head. That would have leaked the main app's manifest + apple-touch-icon onto `/runner` (the root layout wraps every route), producing duplicate tags there and breaking the runner override. Implementing via the Metadata API instead gives proper parent→child override: the runner layout's `manifest`/`icons.apple` cleanly replace the root's for `/runner/*` only. Confirmed in rendered HTML — `/` → `/manifest.json` + `/apple-touch-icon.png`; `/runner` → `/runner-manifest.json` + `/runner-apple-touch-icon.png`; exactly one of each, no duplicates.

**Gotcha hit + resolved:** adding the new `/runner` layout made `tsc --noEmit` momentarily fail inside Next's auto-generated `.next/dev/types/validator.ts` (stale typed-route union didn't know `/runner` yet). `.next` is gitignored and regenerates on dev/build; clearing `.next/dev/types` and re-running was clean. Not a source error.

**Still on the user (can't be automated here):** verify "Add to Home Screen" in iOS Safari on a real iPhone for both `/` (main icon) and `/runner` (RUNNER-badged icon) once deployed.

---

### June 27–30, 2026 — CRM LeadDetail redesign, button-color passes, Dashboard/Day-rate fixes, PRSFlo rebrand + wave icon

A long multi-part session. The CRM lead-detail view was rebuilt; a site-wide lime→outlined-dark button pass ran across CRM/Clients/booking; the day-rate WO bug was root-caused and fixed; and the whole brand was renamed **PRSFlow → PRSFlo** with a new no-text **wave** icon system. See the new Decisions-Log entries ("Brand identity", "WO day-rate `row_rate_type`") and the UI-patterns additions for the durable rules; this is the chronological detail.

#### CRM LeadDetail — unified identity + status strip + meta row (`243a884`, `47d76b0`, `a974724`)
- **Identity block rebuilt** (`243a884`): the old `Name + Pills` block and the 3-col `Contact` grid were replaced by a tight lockup. COD leads → `fname`/`lname` hero (DM Serif 22px); Label leads → `Label — Artist` hero with an `fname/lname` "A&R" sub-line; a single compact contact line (email + Email button · phone + Call/Text), no `CONTACT`/field labels, no `Created` field. The Label autocomplete dropdown was preserved on the hero label input. All inline-edit save behavior (`iStyle`/`focusedInput`/`onBlur save`) and the `emailRef`/`phoneRef` focus refs unchanged.
- **Status bar → inline strip + meta row** (`47d76b0`): the bordered "LEAD DETAILS · HOT · NEEDS CONTACT" box was replaced by a borderless inline strip (heat `<select>` pill, `● Needs Contact` dot, far-right teal `Keep hot/warm until …` with `marginLeft:auto`) separated from the identity block by a 1px `#1e2028` divider. The billing/session-type/source pills moved out of the name row into a quiet bottom **meta row** (`BILLING · RECORDING SESSION · INSTAGRAM`, muted `#6B7280` Syne 9px, `#2d3140` mid-dot separators, no pill backgrounds). The `★ First Time` pill and the booking-icon emoji were dropped. The Send Reg button moved into the identity block (see reg relocation below).
- **Phone auto-format + email alignment** (`a974724`): added `fmtPhone()` (10-digit → `(XXX) XXX-XXXX`, 11-digit leading-1 handled, anything else untouched); the phone input displays formatted when unfocused and reformats on blur. The email input got `paddingLeft: 0` so it lines up flush-left with the hero and meta row.

#### CRM reg button relocation (`5a127c1`)
- The Send Reg / Reg Sent / ✓ Registered button moved **inline into the hero row** (between the name and Start Booking), enlarged to `fontSize:10`/`padding:'5px 12px'`. The expandable reg-link panel was cut from its old spot (between the status strip and the missing-warning) and pasted **directly below the hero row** inside the identity block, so it expands next to the button that toggles it. The Copy Link button went white/black. All reg state-machine logic (`generateRegLink`/`refreshRegStatus`/`regPanelOpen`) unchanged.

#### CRM New Lead `client_id` persistence fix (`d58e99b`)
- **Root cause of "Send Reg shows on a lead that already has a registered client":** the New Lead modal's COD save only wrote `data.client_id = matchedClientId` when `temperature === 'booking'`. So a ★ Client match selected on a **Hot/Warm** lead held `matchedClientId` in state but never persisted it — the lead was inserted with `client_id = null`, and the LeadDetail reg-fetch effect (keyed on `[lead.id, lead.client_id]`) could only run step 1 → defaulted to Send Reg. Fix: persist `client_id` whenever a match is selected, regardless of temperature (mirroring label mode). The booking-only guard + `router.push` are unchanged. (Existing pre-fix leads with null `client_id` are not retroactively fixed — a backfill would be separate.)

#### CRM default view + Keep-Hot/Warm label fixes (`d595098`, `6a28a66`, `4802276`)
- Default CRM view changed `needs-action` → **`all-leads`**; the analytics→leads fallback now lands on `all-leads` too (`d595098`).
- The Needs Action Keep-Hot/Warm **button label** now keys off `l.status` (warm → "KEEP WARM?", hot → "KEEP HOT?") instead of the selected bucket tab; the color was already status-aware (`6a28a66`). The LeadDetail status-strip "Keep hot/warm until …" label likewise reflects `lead.status` (`4802276`).

#### Dashboard Needs Action aligned to CRM (`02bbfe4`, `0b369b6`)
- The dashboard's flat Needs Action filter was replaced with the CRM's exact bucket predicates — uncontacted / hot / warm / incomplete — using `isKhuDue`/`isParked`/`getMissing` helpers added to `app/(main)/page.tsx`, all gated on `needs_contact !== false`. Now sorted by `updated_at` desc (nulls last) and capped at **6** (was a flat filter capped at 5). Required adding `updated_at: string | null` to the `Lead` type in `lib/supabase.ts` (`0b369b6`) — it lived on `Client`/`Booking` but was missing on `Lead`, which broke the sort's typecheck.

#### ClientProfile changes (`16cd055`, `f5136d1`, `a4495bd`, `cdd5234`)
- Removed the **standalone label-roster "Artists" section** from `ClientProfile` (the per-A&R artist chips + editor inside each `ContactRow` stay, and the contact→`clients.artists` sync stays — the booking-form autocomplete still needs the roster) (`16cd055`); then removed the now-dead `rosterArtists`/`removingArtist`/`newArtistInput`/`addRosterArtist`/`removeRosterArtist` state + the `removeArtistFromLabel` import (`f5136d1`).
- Buttons flipped to the outlined-dark-pill convention (after a wrong white-fill pass) (`a4495bd`); `+ New Client` on the clients page too.
- A&R contact cards now show the **phone number text** alongside Call/Text, mirroring the email row (`cdd5234`).

#### WO day-rate fix + Calendar DayView notes (`dda16b3`, `cfef95c`, `f8558a0`)
- Day-rate seed paths now write `row_rate_type`/`rate_daily` (see the new Decisions-Log entry) (`dda16b3`); `WOFormSync.rate_type` tightened to the `'hourly' | 'daily'` union (`cfef95c`).
- `DayView` booking cards stopped rendering `b.notes` — mobile defaults to Day view (which showed notes) while the desktop grid block (`BookingBlock`) never did, so the two were inconsistent; the notes line was removed to match the desktop info set (`f8558a0`).

#### PRSFlo rebrand + wave icon system (`0680a84`, `f1fc649`, `bf6afb4`, `6ceea3b`, `7b0b638`, `1ee573d`, `89c3ea3`)
- App icon replaced with the no-text wave design; `generate-icons.js` rewritten (`0680a84`). Full **PRSFlow → PRSFlo** rename across UI/metadata/prose + new `PRSFloIcon.tsx` bare mark + nav/login/reset lockups (`f1fc649`). Bigger wave scale + radial-glow treatment on app icon and component (`bf6afb4`). Runner icon set regenerated as wave+glow with the orange top wave (`6ceea3b`). Runner Hub landing page got the icon+wordmark lockup (`7b0b638`). Favicon/PWA icons updated along the way (`1ee573d`, `89c3ea3`). See the "Brand identity" Decisions-Log entry for the locked rules.

#### Login/reset/splash polish + locked wordmark convention (`23e5314`, `7b04203`, `4f1ff2b`, `7446700`)
- Login wordmark corrected to byte-for-byte match `Nav.tsx` (it had drifted to a rounded/script fallback font + all-lime); login email/password inputs switched to the dark-theme tokens (`var(--surface)`/`var(--text)`/`var(--border)`) with a scoped `.auth-input` `::placeholder` + `:-webkit-autofill` rule in `globals.css` to defeat the browser's light-blue desktop autofill; the welcome splash got the lockup; **CLAUDE.md gained a "Locked Design Conventions" section** documenting the wordmark rule (`23e5314`).
- Login logo spacing aligned to the `gap: 2` convention; **Sign In button** restyled to the CRM/Clients outlined-dark secondary-button style (`7b04203`). Reset-password spacing aligned too (`4f1ff2b`). The welcome splash was then simplified to the **icon only** (no wordmark) at `size={72}` to match the login icon (`7446700`).

#### PWA installability audit (no code change)
- Audited desktop "Install App" (Chrome/Edge) against `manifest.json` + `app/layout.tsx` + the live site: manifest complete (name/short_name/start_url/`display:standalone`/192+512 icons incl. maskable/bg+theme color), HTTPS via Vercel (HSTS on), `<link rel="manifest">` present in rendered HTML and `/manifest.json` resolves `200 application/json`, icons valid non-zero PNGs at correct dimensions. **No service worker exists (intentional, documented)** — not required for desktop install. All checks pass; nothing to change.

---

### June 30, 2026 (late evening) — Work-order creation centralization + UI polish

Two threads: a structural refactor moving **all** work-order creation to booking-save behind one function + a DB constraint, and three small brand/UI polish tweaks. The refactor was preceded by a multi-session audit (verified against the live DB with read-only probes) that established: no server-side trigger/webhook/edge function/cron creates WOs; WOs were created lazily on human WO-open (admin popup `initWO` or the runner WO page); that check-then-insert pattern with no unique constraint had duplicated 27/44 booked WOs (61%); and several "runner edits invisible to admin"/"day-rate seeds wrong" symptoms traced to those lazy paths and to booking-vs-`studio_time_rows` read sources (calendar/hub/daily-ops read `bookings`, not `studio_time_rows`, so runner row edits are invisible to them by design). Full plan approved step-by-step by the user; test data wiped + the constraint added by the user before deploy.

#### Work-order creation centralization (`e2da7e8`)
See the Decisions Log entry "Work-order creation centralized to booking-save (June 30, 2026)" for the full rationale. In brief:
- **New `lib/createWorkOrder.ts`** — `createWorkOrderForBooking(booking)` (canonical creator: one `work_orders` row + `studio_time_rows` + `equipment_condition_rows`; idempotent `upsert(onConflict: 'booking_id', ignoreDuplicates: true)`; seeds rows only on a fresh insert) + `bookingShouldHaveWorkOrder(booking)` (session gate by `status`). Self-contained copies of `timeToMins`/`calcHours`/`calcCharge`/`dateRange`/`toStudioLetter`; equipment items `['Speakers','Microphone','Console']`. Not a true SQL transaction (anon REST can't wrap multi-statement) — sequential best-effort, errors thrown to the caller (documented in the file).
- **`calendar/page.tsx handleSave`** — new-booking branch calls the creator (gated via `bookingShouldHaveWorkOrder`), non-blocking with a dismissible warning banner (`woWarning`); the `editBooking` branch is untouched (FIX 2 stays there). `calendar/page.tsx:1264` is the app's only `bookings` insert, so this is a single choke point covering every entry path (Start Booking, dashboard empty-room, CRM Move-to-Booking, calendar).
- **`WorkOrderPopup.initWO`** — adopt-first, fallback to the canonical creator; own create/upsert + seed block deleted; `woMissing` error UI; single-day/seed fallbacks kept.
- **Runner WO page** — strictly adopt-only (create + `studio_time_rows` seed removed); "Work order not yet created — contact office." + null `woData`/`bkData` guards.
- **Runner hub `woMap`** — deterministic earliest-wins ordering.
- **DB** — `UNIQUE (booking_id)` constraint on `work_orders`, run manually by the user after wiping test data. The upsert's `onConflict` requires it (coupled change — see Decisions Log).
- FIX 1 folded into the creator; FIX 2 retained (edit-branch); FIX 3 upserts deleted. `tsc --noEmit` clean.

#### Nav / splash / glow polish (`4f65eb3`, `672e43d`)
- **Nav lockup** (`Nav.tsx`): icon→wordmark `gap: 12 → 4` so the PRSFloIcon + "PRSFlo" read as one tight unit (the icon's 1.4× glow already fills most of the old gap).
- **Splash name fade-in** (`app/(main)/page.tsx`): the name "cut in hard" because `nameVisible` flipped on a blind 300 ms timer while `profile.display_name` (async via `useUserProfile`) often hadn't loaded — so the 0.6 s opacity fade animated the empty `' '` placeholder and the real text popped in at full opacity when the profile resolved later. Replaced the blind timer with an effect that fires `setNameVisible(true)` (still after a 300 ms beat) once `showWelcome && profile?.display_name`, so the existing `transition: opacity 0.6s ease, transform 0.6s ease` animates the *real* name — symmetric with the 0.6 s overlay fade-out. The transition itself was already symmetric; only the trigger changed. This refines the June 26 `0050c76` splash-name-fade entry (the blind 300 ms timer it introduced is what raced the profile load).
- **Splash icon position continuity** (`app/(main)/page.tsx`): the icon sat ~54 px lower on the splash than on login. Both screens vertically center their column, but login's tall form pushes its icon ~117 px above viewport center vs the splash's ~63 px. Added `marginBottom: 108` to the splash name div — in a center-justified flex column, margin on the last flex child shifts the whole group up by half (~54 px), landing the splash icon at login's position so the login→splash transition no longer jumps down. Icon size (72) untouched; the absolute footer is unaffected.
- **PRSFloIcon glow falloff** (`components/PRSFloIcon.tsx`): the radial glow read as a defined circle; changed `radial-gradient(circle, rgba(93,202,165,0.12) 0%, rgba(0,0,0,0) 70%)` → `radial-gradient(circle, rgba(93,202,165,0.10) 0%, rgba(93,202,165,0.04) 30%, rgba(0,0,0,0) 55%)` — a midpoint stop + earlier 55% cutoff makes it dissipate fast as soft ambient light. Applies everywhere the icon renders (nav 38, login/reset/splash 72, runner hub 32).

### July 1, 2026 — Public inquiry form, Web Inquiry real-time notifications, full real-time pass, dashboard/color polish

A large batch spanning lead capture, a project-wide real-time overhaul, and design-token cleanup. See the Decisions Log entries "Real-time everywhere", "Web Inquiry notifications + public inquiry form" for the durable rationale.

#### Public inquiry form (`acd65f3`, `9857f6f`, `8e25593`)
- **New `app/inquiry/page.tsx`** — public, unauthenticated lead-capture form, deliberately **outside** the `(main)` route group so `AuthGuard` never gates it. First/last/email/phone required + optional notes; on submit inserts a `leads` row (`status: 'uncontacted'`, `source: 'Web Inquiry'`, `created_at` now) via the browser anon key only — no service-role key referenced. Success swaps the form for an in-place thank-you screen (no redirect). Styled over a full-bleed studio photo (`public/inquiry-bg.jpg`) + dark gradient overlay + frosted form card + `public/paramount-logo.png`; the PRSFlo wordmark was dropped from this page in favor of the Paramount logo.

#### Web Inquiry real-time notifications (`7cb7d70`, `fc6d03a`, `a1d7cd6`)
- **`components/notifications/WebInquiryProvider.tsx`** — a global context mounted once in `app/(main)/layout.tsx` (inside `AuthGuard`, wrapping `NavGate` + `main` + `WebInquiryToaster`). Subscribes to a single `leads` channel (`web-inquiry-leads`) and drives three notification layers off it: (1) persistent pulse/glow on the dashboard Needs Action lead card (`isUnacked(leadId)`), (2) browser-tab title badge (`document.title = '(N New) PRSFlo'`, restored to `PRSFlo` on unmount), (3) transient slide-in toasts (`toasts` + `dismissToast`, rendered by `components/notifications/WebInquiryToaster.tsx`). Unacknowledged = `source='Web Inquiry'` still `status='uncontacted'`; cleared only by a status-change UPDATE, never on click. Hydrates the unacked set on mount so overnight inquiries survive refresh even before realtime fires.
- **`leadsVersion` counter** — the provider increments it on every `leads` INSERT/UPDATE; the dashboard Needs Action module and CRM watch it and re-fetch, so new/changed leads appear live off this one shared subscription (no per-view `leads` channels). This is the reference implementation for the standing real-time rule.
- `a1d7cd6` raised the toast z-index above the nav and wired the dashboard Needs Action list to `leadsVersion` so it updates without refresh; `fc6d03a` added temporary `[WebInquiry]` console diagnostics (mount/hydrate/channel-status/INSERT/UPDATE) during bring-up.
- **`supabase/leads-realtime.sql`** — adds `leads` to `supabase_realtime` + `REPLICA IDENTITY FULL`. Manual, run-once. Until run, hydration still surfaces existing inquiries (pulse/badge work on load) but live pop-in toasts won't fire. Added a `webInquiryPulse` keyframe to `globals.css`.

#### Full real-time subscription pass (`f882695`, `5c30be7`)
- **Every remaining list/detail surface got a `postgres_changes` subscription paired with its fetch** — `clients` page, CRM, dashboard, runner checklist / mics / petty-cash, `DailyOpsLogSection`, `FlagsLogSection`, `MicInventorySection`, `DailyOpsModal`, `LocationStrip`, and the Nav (tentative-count badge). Each cleans up via `removeChannel` on unmount with unique channel names.
- **`supabase/realtime-publication.sql`** — the batch migration (18 tables → publication + `REPLICA IDENTITY FULL`; see the Decisions Log entry for the full table list and the already-published / intentionally-omitted notes). Manual, run-once, must precede the deploy.
- **`5c30be7`** codified this as a hard standing rule at the top of CLAUDE.md ("Standing Architecture Rules → Real-time data"), citing `WebInquiryProvider` as the reference pattern.

#### Dashboard polish + per-studio color removal (`c3f176d`, `aeda786`, `8dee19d`)
- `c3f176d` — dashboard header actions greyed; corrected Hot/Warm colors; task-tab tweaks; new-lead + flags shortcuts; small `SectionHeader`/`StatusBadge` adjustments.
- `aeda786` — **comprehensive removal of per-studio color coding**: every runner page (studio hub, checklist, mics, petty-cash, stock, WO), `DailyOpsLogSection`, `FlagsLogSection`, `MicInventorySection`, `LocationStrip`, and the dashboard were unified onto the design-system tokens instead of ad-hoc per-studio tints.
- `8dee19d` — dashboard room-grid studio/room names made more legible.

### July 1, 2026 — CRM overhaul: tab logic, lead avatars, stored initials, multi-select tabs, lead-profile redesign

See the Decisions Log entry "CRM tab logic, lead avatars & stored initials" for the durable rules. Session detail:

#### Tab logic + avatars + auto-initials (`4afe1e8`)
- **All-Leads Uncontacted bucket fixed** — was `status === 'uncontacted' || (!last_contact && not booked/dead)`, which double-listed never-contacted hot/warm leads in both Uncontacted and their heat tab. Now Uncontacted = `status === 'uncontacted'` only; Hot/Warm exclude uncontacted. (Needs Action tabs left as-is — they intentionally use touch-timer gating.)
- **Lead avatars replace bookend borders** — removed the colored left+right 6px bars on lead-list cards (Needs Action + All Leads); added a temperature-colored initials avatar (first letter fname + first letter lname) on the left, modeled on the engineers-list avatar (36px circle).
- **Auto-initials from profile** — CRM contact-log prompts (Touch / Keep Hot / Keep Warm / Dead) and admin `MicInventorySection` editing replaced manual initials `<input>`s with a read-only display of `profileInitials(profile?.display_name)` via `useUserProfile`. Runner mics/checklist left manual (public, initials-gated submit).

#### Stored initials column (`a7bb9c5`)
- **`user_profiles.initials`** text column added (`supabase/user_profiles-initials.sql`, manual, `display_name ILIKE` seed → ES/FR/AA/AM/IH/QC/TD/SS). `UserProfile` type gained `initials?: string | null`; `useUserProfile` already `select('*')` so it returns it. All call sites switched to `profile?.initials || profileInitials(profile?.display_name)` (stored first, computed fallback).

#### Avatar ring style + colors (`8564aa4`, `3c4113e`)
- Avatar switched from solid-filled circle to **transparent circle + 2px colored ring + matching text** (`LEAD_AVATAR_COLORS` collapsed to one color per status). Selected-row highlight changed lime `rgba(200,240,78,0.04)` → neutral `rgba(255,255,255,0.04)`. Uncontacted avatar color corrected grey `#6B7280` → the Uncontacted tab/pill blue `#7BA7BC`.

#### Multi-select status tabs (`f410031`)
- All-Leads status tabs became **independent toggles** backed by a `Set<StatusFilter>` (default `{uncontacted, hot, warm}`); "All" tab removed; empty set → show everything; badges still per-status; persisted to `sessionStorage` (`crm_al_active`). `leadStatusKey()` maps `cold`/`dead` → the `cold-dead` bucket.

#### Lead-profile panel redesign (`8ebae5b`, `9d8d797`, `c5fde75`)
- Removed the `FieldGroupLabel` section headers (Session & Quote / Activity Log / Session Notes); Keep Hot/Warm list-row buttons made neutral (transparent / `var(--border)` / `var(--text)`) regardless of prompt state — status pill unchanged; spacing tweaks (`marginTop: 16` before session + activity, notes textarea).
- Then two edge-to-edge contrast zones via `margin: '0 -16px'; padding: '12px 16px'` breakout with a single `var(--border)` divider between them: **Zone 1** (identity + contact) and **Zone 2** (session grid + Engineer Needed). Final colors: Zone 1 `#161920`, Zone 2 `#1c1f27` (`c5fde75`; note the initial `9d8d797` values were swapped and corrected). Compact session layout: studio capped `maxWidth: 200`, rate input inline with the /hr /day toggle (no longer stretched), Start–End as a tight fixed-width pair. Reordered to Engineer → Notes → Activity.

### July 1, 2026 — Login stagger animations + smooth crossfade to welcome splash (`e527f07`)

- **Login stagger-in** (`app/(auth)/login/page.tsx`): a `fadeUp` keyframe (opacity 0→1 + `translateY(10px→0)`) injected via an inline `<style>` tag; each element gets `fadeUpStyle(delay, duration)` = `{ opacity: 0, animation: 'fadeUp {dur}s ease {delay}s forwards' }`. Delays: icon 0.1s / wordmark 0.25s / PRG line 0.38s (all 0.4s dur); email 0.52s / password 0.64s / Sign In 0.76s / forgot-password 0.88s (all 0.35s). The "Paramount Recording Group" line was also **moved from above the icon to directly under the PRSFlo wordmark** (inside the icon+wordmark flex column, `marginTop: 6`).
- **Login → splash crossfade**: on successful `signInWithPassword`, the page sets `fadingOut` (outer container `opacity 0`, `transition 0.4s`) then `setTimeout(400)` before `router.replace('/')`. The dashboard splash's `welcomeFadeIn` was bumped `0.3s → 0.4s` to match; both backgrounds are `#0d0f14` so there's no flash.
- **Splash cleanup** (`app/(main)/page.tsx`): removed the `PARAMOUNT RECORDING GROUP` footer (the wordmark was already gone — icon-only since June); the icon→greeting gap set to `marginBottom: 2` to match the login icon→wordmark spacing so "Good Evening / [Name]" sits where the wordmark does on login.

### July 2, 2026 — Security hardening: RLS, PIN login, SOP gate, tech role, task visibility, rate limiting

The big one — the app went from "UX gating, RLS off" to enforced Row-Level Security, plus a PIN login, a first-login SOP gate, a distinct `tech` role, RLS-enforced task visibility, private photo storage, server-side public-write routes, and per-IP rate limiting. Full durable rationale is in the Decisions Log subsection **"Security hardening — real RLS, PIN login, SOP gate, tech role, rate limiting (July 2, 2026)"**; this note is the commit-by-commit map. Every migration is a committed file in `supabase/migrations/` and was run manually in the Supabase SQL editor.

#### RLS security hardening (`c24e4de`, fix `cea7fbd`)
- Migration `20260702161117_rls_security_hardening.sql`: `get_my_role()` + `get_my_profile_id()` `SECURITY DEFINER` helpers; drop legacy `"Public access"` policies; per-command RLS on ~32 tables; `checklist-photos` → private + authenticated storage policies + drop named anon policies; drop dead `expenses` anon policies; role CHECK widened (`+runner`); `auth_user_id` email backfill; seed runner profile.
- First run hit `42P01 expense_rows does not exist`; `cea7fbd` wrapped every table in a `pg_tables` `IF EXISTS` `DO` block (guarded, atomic).
- Companion code: `app/api/register/route.ts` (new service-role route) + `register/[token]/page.tsx` repointed + `register/view/[clientId]` → service role; `lib/photos.ts` + `components/shared/SignedImage.tsx` (store path / sign on read; 7 write + ~10 read sites); `scripts/backup.mjs` + `.github/workflows/daily-backup.yml` → service-role key; `lib/supabase.ts` `UserProfile` (`+runner`, `+sop_acknowledged?`).

#### PIN login (`4fdc400`, `1fd0a3f`)
- Migrations: `20260702165838_staff_pins.sql` (table; **seed in git-ignored `supabase/seed/staff_pins_seed.local.sql`**) + `20260702170825_pin_auth.sql` (`pin_login_attempts` + `verify_staff_pin` RPC, `service_role`-only).
- `app/api/auth/pin/route.ts` (magic-link token minting, DB per-IP 5/30s lockout, `403 no_account` for the runner). `app/(auth)/login/page.tsx` rewritten to a numpad (PIN primary, email fallback, `lucide-react` Eye/EyeOff on the password field — Tabler isn't installed). **(The magic-link mint + browser `verifyOtp` was replaced July 8, 2026 by `signInWithPassword` + browser `setSession` for a faster single round-trip — see the July 8 session note.)**

#### SOP gate + task visibility + tech role (`2595321`)
- Migrations: `20260702175211_sop_acknowledged.sql` (column + `acknowledge_sop()` RPC), `20260702175212_dashboard_tasks_is_private.sql` (column + Eli-self trigger), `20260702175800_dashboard_tasks_visibility.sql` (SELECT/UPDATE/DELETE tiers; comments follow task), `20260702183452_tech_read_bookings_clients.sql` (tech SELECT on bookings/clients/client_contacts).
- `components/SopGate.tsx` + `(main)/layout.tsx` mount; `lib/tasks.ts` (`fetchMyTasks`/`fetchMyCompletedTasks`/`isOwnOnlyRole`) + dashboard `page.tsx` + `/tasks` "My Tasks" for own-only tiers; `Nav.tsx` hides CRM for tech; `admin/page.tsx` tech tab filter; `WorkOrderPopup.tsx` read-only-for-tech gating.

#### SOP content edits (`c302a87`)
- `public/sop.html`: removed the initials step (renumbered 1–5); status pills reordered Uncontacted-first + recolored `#7BA7BC`; priority copy rewritten to Uncontacted-first → escalate → Hot (intro, new UNCONTACTED summary card, CRM-steps card object).

#### Rate limiting (`b780463`, `10e6957`)
- Migration `20260702193134_api_rate_limits.sql` (fixed-window table) + `lib/rateLimit.ts`. New `app/api/inquiry/route.ts` (3/min, service role) + `app/inquiry/page.tsx` repointed (no more anon insert). `app/api/ocr-receipt/route.ts` gained Bearer-token auth + 10/min. `20260702201353_drop_leads_anon_insert.sql` drops `leads_ins_anon` — **run AFTER the deploy** so the inquiry route is the only insert path.

#### Manual steps still outstanding (outside the repo)
- Add `SUPABASE_SERVICE_ROLE_KEY` as a **GitHub Actions secret** (daily backup).
- Run `20260702201353_drop_leads_anon_insert.sql` in Supabase **after** Vercel deploys the inquiry route/page.
- Build the **shared runner PIN auth account** (creates + links `auth_user_id` for the seeded runner profile) to bring the runner subtree back online.

---

### July 8, 2026 — Faster PIN login, keyboard numpad, SOP Tasks/Flags + sidebar, temporary Confirm Client Account flow

Seven commits (`1844257` → `af83cce`): PIN-login latency work, a SOP expansion (Tasks + Flags training sections behind a new left-sidebar nav), and a temporary CRM booking CTA that stands in until the real booking form is built.

#### Faster PIN login — `signInWithPassword` replaces `generateLink`/`verifyOtp` (`1844257`)
- The July 2 PIN flow (`auth.admin.generateLink({type:'magiclink'})` server-side → browser `verifyOtp`) added ~3–4s (three round-trips + bcrypt). Replaced with a single-round-trip mint: `app/api/auth/pin/route.ts` now calls `signInWithPassword({email, password})` on a **dedicated anon-key client** — **not** the shared module-level `supabaseAdmin`. Rationale: in supabase-js v2, `signInWithPassword` makes its client adopt the signed-in user's session, so a shared singleton would then send that user's JWT on later `.from()`/`.rpc()` calls across requests, breaking the service role's RLS bypass. The route returns the session `access_token`/`refresh_token`; the browser (`app/(auth)/login/page.tsx` `submitPin`) adopts it via `supabase.auth.setSession(...)` — no OTP exchange.
- Migration `20260708120000_staff_pins_supabase_password.sql`: adds `staff_pins.supabase_password` (a fully-random 32-char secret, NOT derived from the PIN) and DROP/CREATEs `verify_staff_pin(text)` to also return it (its `RETURNS TABLE` gained a column, so a plain `CREATE OR REPLACE` can't alter the output signature — it must be dropped and recreated). Same RLS as `pin_hash` (owner/manager only for authenticated reads; service role bypasses); the password is read server-side only and never sent to the browser. **Security tradeoff accepted:** it's a plaintext session-granting credential, but random, RLS-protected like the hash, and server-only.
- One-time script `scripts/set-staff-passwords.mjs` (`node --env-file=.env.local scripts/set-staff-passwords.mjs`): for each `staff_pins` row with an `auth_user_id`, generates `randomBytes(24).toString('base64url')` (32 chars), sets it on the Auth account via `supabase.auth.admin.updateUserById(authUserId, {password})`, and writes it to `staff_pins.supabase_password`. Rows without an `auth_user_id` (the shared runner) are skipped. (Note: the spec said `updateUserPassword()` — that method doesn't exist; the real admin method is `updateUserById(id, {password})`.)
- Route returns `403 no_account` when the matched PIN's profile has no `auth_user_id` **or** no provisioned `supabase_password`; the login UI shows "this account isn't set up yet."
- **Coupled deploy / rollout order:** run the SQL migration → run `set-staff-passwords.mjs` → deploy the route + login page. If the code deploys before the script runs, every PIN returns `403 no_account` until it does (email/password fallback still works).

#### PIN bcrypt cost lowered 10 → 8 (operational; git-ignored SQL)
- To shave verify latency, PIN hashes were rehashed at `gen_salt('bf', 8)`. Because plaintext PINs aren't stored, this can't be a blind SQL rehash, and a Node script using `@supabase/supabase-js` can't do it either: PostgREST `.update()` stores literal text, not an evaluated `crypt(...)`, and there's no `pg` driver or direct Postgres connection string in the env. Done instead in SQL run manually in the Supabase editor — `supabase/seed/rehash_pins_cost8.local.sql` (re-seeds all hashes at cost 8 from the known PINs), and `supabase/seed/staff_pins_seed.local.sql` was updated `gen_salt('bf')` → `gen_salt('bf', 8)` so future re-seeds default to cost 8. **Both files are git-ignored (`supabase/seed/*.local.sql`) — they contain plaintext PINs and must never be committed.** Marginal security change given the 4-digit space + per-IP limiting; the real defense remains the rate limiting, not the cost factor.

#### Keyboard input for the PIN numpad (`e6b4f31`)
- `app/(auth)/login/page.tsx` gained a PIN-mode `keydown` listener (a `useEffect` active only when `mode==='pin'`): `0–9` → `pressDigit`, `Backspace` → `pressBack`. Purely additive — the on-screen numpad still works, and every guard (lockout, submitting, 4-digit cap, error-clear) applies because it reuses the existing handlers. Inactive in email/password mode so it never intercepts those fields; removed on unmount.

#### SOP page — Tasks + Flags sections + left sidebar nav (`3e53158`; refinements `49c18a4`/`dd9b99b`/`af83cce`)
- `public/sop.html` gained a persistent **left sidebar nav** (CRM · Clients · Tasks · Flags; sticky full-height on desktop, collapses to a horizontal scrollable **pill row** ≤768px; lime `#c8f04e` active state). The old top tab bar was replaced; `switchTab` now toggles `.side-btn` (+ scroll-to-top). Added the file's **first** `@media(max-width:768px)` block (sidebar→pills + multi-column grids stack on mobile; desktop output unchanged). The existing CRM + Clients sections and all their JS (`STATUS_DATA` / `CRM_STEPS` / `CLIENT_STEPS`, `showStatus`/`buildSteps` accordions) are byte-for-byte unchanged.
- **Design-token note:** the file's `:root` still uses `--bg:#0d0d0d` / `--surface:#161616` (its own tokens), NOT the app's `#0d0f14` / `#161920`. Kept as-is deliberately to preserve the existing sections exactly; the new sidebar + sections are built on the CSS vars, so the whole page stays visually consistent. Accent already matches (`#c8f04e`). The nav logo text is still `PRSFlow` (untouched — not in scope).
- **Tasks section:** what tasks are / aren't, visibility rules, create flow (5 steps), complete flow (3 steps), golden rules. Visibility rules were simplified in `49c18a4` to **three** cards — You / Managers & Owners / Comments — **removing the initial draft's "Eli's private tasks" (warm-colored) card** and any mention of private tasks; card padding/gap/intro spacing normalized (16px / 12px / 12px). `dd9b99b` added `margin-top:22px` above the visibility section-label to match the rest of the page.
- **Flags section:** what flags are / aren't, the three categories (Facility/General · Gear/Equipment · Client/Billing), how runners report (checklist / Work Order / manual + a note-writing tip), how managers handle (5 steps incl. resolve details), why resolution details matter, search & filter, golden rules.
- **BOOKED status rewrite (`af83cce`):** `STATUS_DATA.booked` retitled "Payment received or label approval confirmed.", with New-client / Returning-client sub-sections (`.tip-box` callouts embedded in the data-driven `body`) and a new rule box — reflecting the app's real booked trigger (payment for COD / label approval + Confirm Client Account), replacing the old "send registration link" copy.

#### Temporary "Confirm Client Account" flow in CRM lead detail (`7332eb8`)
- **Explicitly temporary — reverts when the real booking form is built; every added block carries `// TEMPORARY: remove when booking form is live`.** **[SUPERSEDED July 28, 2026 — v1.1.1:** Start Booking was restored and opens the WO; the confirm-client + mark-as-booked modals were **kept** (reachable from the status pill only) because marking a lead Booked is a distinct act from booking a session. The `// TEMPORARY` comments were rewritten accordingly — **do not delete those blocks.**] In `app/(main)/crm/page.tsx` `LeadDetail`, the **"Start Booking"** button is renamed **"Confirm Client Account"** (same location/styling) and both flows now end in a modal with **no redirect** (the prior behavior pushed to `/calendar?newBooking=1&clientId=...`):
  - **FLOW 1 — new client** (no `client_id`): click → the existing `ConfirmClientModal` (**unchanged** — it still creates the client and writes `status:'booked'` at `crm/page.tsx:1966`) → a new **"Client Account Created"** success modal with a single **Done** button that closes it.
  - **FLOW 2 — returning client** (has `client_id`): click → a new **"Mark as Booked"** confirm modal with a single **Confirm** button that writes `leads.status='booked'` and updates the card immediately (existing `onUpdate` optimistic local update + the `leadsVersion` realtime refetch).
- **No duplicate-detection modal exists in this flow** (the spec assumed one) — the only modal is `ConfirmClientModal`; the "matched to existing client" UI at `crm/page.tsx` ~line 2603 lives in `NewLeadModal`, a different component. Registration creates the client profile upstream; `ConfirmClientModal` is the manual fallback for leads without registration. `leadRouter` is left declared (now unused, harmless under `strict:false` / no `noUnusedLocals`) so the revert is a clean delete of just the temporary blocks. Booking form / calendar / WO were **not** touched.

#### Still outstanding (manual, outside the repo)
- Run `20260708120000_staff_pins_supabase_password.sql`, then `scripts/set-staff-passwords.mjs`, before/with the deploy — else PIN login `403`s.
- Run `supabase/seed/rehash_pins_cost8.local.sql` (cost-8 rehash) in the Supabase SQL editor.
- Carried over from July 2: add the `SUPABASE_SERVICE_ROLE_KEY` GitHub Actions secret; run `20260702201353_drop_leads_anon_insert.sql` after the inquiry route/page deploy; build the shared runner PIN auth account.

### July 13, 2026 — CRM temperature pill dropdown + status-strip centering

Commits `0418ee3`, `e5de18c`, `a255fab`, `2d6be07`.

- **Temperature pill dropdown (`0418ee3`).** The CRM lead-detail status indicator (`LeadDetail`, `app/(main)/crm/page.tsx`) became a clickable pill + dropdown for changing the lead's temperature. The pill shows the current status colored via `LEAD_AVATAR_COLORS` (red Hot, orange Warm, steel-blue Uncontacted, grey Cold, etc.) with a chevron; clicking opens a dropdown over `uncontacted / hot / warm / cold / booked / dead`, each a colored dot + label. Selecting one calls `saveStatus(newStatus)` → immediate Supabase `update` + optimistic local state; the shared `leadsVersion` realtime signal keeps the list in sync. Closes on outside click. Replaced the prior inline heat `<select>`. **(Later, July 15, the `booked` option was re-wired to trigger the confirmation flow instead of writing status directly — see the July 15–16 entry.)**
- **Status-strip vertical centering (`e5de18c` → `2d6be07`).** Iterated on centering the pill + Keep-hot row within the header band; `a255fab` balanced the top/bottom gap via `paddingBottom`; `2d6be07` reverted the no-op alignment tweaks, keeping only the `paddingBottom` centering that actually changed layout.

### July 13, 2026 — Mobile flag-form fixes, FLAGS/Needs-Action restyle, temporary feedback board

- **Mobile flag-form fixes (`3857feb`, `dc4e726`, `d46fe8d`, `76de8d8`, `b73ce6c`, `a2eb003`).** Several rounds on the dashboard flag-creation form on mobile: X clears nav, sticky footer, iOS scroll lock (the `body.position=fixed` + `top=-scrollY` pattern), **photo upload on manually-created flags**, task-tab overflow ellipsis, keyboard avoidance via `visualViewport`, content-sizing vs full-screen — settling on a **full-screen opaque modal takeover on mobile for the dashboard modals** with a viewport-aware height. `a2eb003` added spacing below the photo field.
  - Migration `supabase/migrations/20260709120000_flags_photo_url.sql` — `alter table public.flags add column if not exists photo_url text` (nullable; stores the private `checklist-photos` storage path, read via signed URL, mirroring `flag_comments.photo_url`). **Run manually.**
- **FLAGS panel matched to TASKS (`26d3393`).** The dashboard FLAGS panel gained a "view all flags" header link + a dashed "+ add flag" footer, mirroring the TASKS panel.
- **Needs-Action cards match All-Leads layout (`6e4db1b`).** The Needs-Action lead rows were rebuilt to the All-Leads two-line card layout, keeping the bucket-specific meta text.
- **Temporary staff feedback board (`0a8bfbd`). ⏳ TEMPORARY — remove when the rollout period ends.** New `app_feedback` table + `/feedback` page (`app/(main)/feedback/page.tsx`) + a lime **Feedback** nav item (`components/layout/Nav.tsx`, marked `// TEMPORARY`). Migration `supabase/migrations/20260713120000_app_feedback_temporary.sql`: `app_feedback(id, created_at, author_name, type CHECK IN ('bug','suggestion','question'), note, resolved)`, RLS keyed on `get_my_role()` — any authenticated user SELECT + INSERT; owner/manager only for UPDATE (mark resolved) + DELETE; added to `supabase_realtime` + `REPLICA IDENTITY FULL` (the board subscribes for live updates). **Run manually.**

### July 13–16, 2026 — Light Mode theme system (feature/light-mode branch)

The largest chunk of this stretch — a full light/dark theme system defaulting to **light**, with glassmorphism in light mode and a Nav toggle. Built on branch `feature/light-mode` and merged to `main` July 16 (merge commit `fbed12c`).

- **Dark-theme depth, then walked back (`964ce32`, `0758782`, `975f6e9`).** Added dot grid + radial glow + nav gradient + input shadows to dark; then removed the dot grid and the inline `<body>` style that blocked the glow, keeping the radial glow (`:root:not([data-theme="light"]) body::before`) + nav gradient.
- **Theme mechanism.** `data-theme="light"` on `<html>` drives everything. A **blocking inline `<script>` in `app/layout.tsx`** sets `data-theme='light'` before first paint unless `localStorage['prsflo-theme'] === 'dark'` (so login/splash — which have no Nav — theme correctly with no flash). `components/layout/Nav.tsx` re-applies the saved theme on mount and owns `toggleTheme()` (Sun/Moon button, desktop + mobile dropdown), persisting to `localStorage['prsflo-theme']`. **Default is light.**
- **Light-mode CSS variables** (`styles/globals.css`, `[data-theme="light"]`): `--bg: transparent` (the `<html>` gradient shows through), `--surface:#ffffff`, `--surface2:#f1f5f9`, `--border:#cbd5e1`, `--text:#1e293b`, `--text2:#475569`, `--text3:#64748b`, `--accent:#3b82f6` (blue replaces lime), `--accent-rgb: 59,130,246`, `--accent2:#0ea5e9`, `--hot:#dc2626`, `--warm:#ea580c`, `--cold:#64748b`, `--booked:#0d9488`, `--uncontacted:#3b82f6`, `--dead:#94a3b8`. `html[data-theme="light"]` paints a `linear-gradient(135deg,#dbeafe 0%,#ffe4e6 100%)` page background.
- **`--accent-rgb` triple (dark `200,240,78` / light `59,130,246`)** so `rgba(var(--accent-rgb), a)` tints follow the theme (lime in dark, blue in light) instead of a hardcoded lime literal. **This is the canonical way to write theme-aware accent tints going forward.**
- **Glassmorphism + gradients via attribute-selector targeting of inline styles.** Because the app styles everything with inline `style={{}}`, light-mode overrides are CSS rules that match the inline strings / `data-*` markers: e.g. `[data-theme="light"] [style*="background: var(--surface)"]` → frosted white (`rgba(255,255,255,0.7)` + `backdrop-filter: blur(12px)`). Per-panel gradients via `data-panel` (blue `#dbeafe`→white / rose `#ffe4e6`→white, alternating), modal-card gradients via `data-modal-gradient` (`linear-gradient(160deg,#dbeafe,#fff 40%,#ffe4e6)`), plus `data-studio-card`/`data-studio-index`, `data-session-card`, `data-checklist-section`, `data-ops-col`, `data-ops-modal`, `data-section-head`, `data-lead-content`/`data-lead-name`/`data-selected`, `data-eng-needed`, `data-login-key`/`data-login-submit`, `data-splash`/`data-auth-hold`. A modal-opaque rule (`[data-theme="light"] [style*="position:fixed"] [style*="background:var(--surface)"]`) and the gradient rules coexist via specificity + declaration order (gradients declared later win at equal specificity).
- **Mechanical hex→var replacement (`11bbd9a`).** A sweep across ~37 files replaced hardcoded hex colors with the CSS vars so both themes cascade. **Gotcha (fixed):** the sweep over-reached into non-CSS contexts — `themeColor: 'var(--bg)'` (invalid in Next metadata), canvas `ctx.strokeStyle='var(--text)'` (×4), and SVG `stroke="var(--border)"` on the CRM DonutChart circles — all reverted/converted (themeColor back to `#0d0f14`, canvas strokes to a literal, DonutChart `stroke=` attrs → `style={{ stroke }}`).
- **Contrast + gradient passes (`0b789e3`, `a2c148f`, `f578ca9`, `b0861fd`, `20173d7`, `248cc7a`, `dd5c547`, `f5da432`, `b97d97c`, `ad8cc99`, `6129286`, `b3745fc`, `e79a712`).** Opaque nav + modals in light mode; input outlines/shadows; lime cleanup (accent tints via `--accent-rgb`); `--text3` darkening for readability; page background settled on the blue→rose two-color gradient; panel/studio-card/session-card/checklist/daily-ops gradients (both daily-ops columns settled on the rose gradient); CRM selected-row indicator (inset box-shadow, no layout shift); `ClientProfile` needed an explicit `data-panel` on its main container (the `replace_all` had matched only the loading-state indent); CRM lead-list contrast (bolded names + darkened metadata via a scoped `[data-lead-content]{--text2;--text3}`).
- **Light-mode login (`0ed1f1e`).**
- **Theme-aware `PRSFloIcon` wave (`6b644f9`, `014a47c`, `d0dec4b`, `4d91654`, `cb9d7c7`, final `ed302cb`).** The wave mark reads the theme (`'use client'` + `useState` + `MutationObserver` on `data-theme`) and sets **solid strokes** in light mode instead of the dark SVG gradients — required because duplicate gradient `url(#id)` IDs across icon instances made CSS `stroke` overrides unreliable. Final light-mode strokes: tallest + middle waves solid blue `#3b82f6` (opacity 1), flattest wave light blue `#93c5fd` (was grey `#cbd5e1`, opacity 0.4). Dark mode keeps the teal/lime gradients + `#e8eaf0`.

### July 15–16, 2026 — Booked confirmation flow, mobile CRM/nav polish, studio short codes, lead-creation attribution, Inter font, registration ID viewer, merge to main

Continues on `feature/light-mode`; all committed then merged to `main` (`fbed12c`).

- **Booked status → confirmation flow (`d8ba816`). ⏳ part of the TEMPORARY confirm-client flow.** In the temperature pill dropdown, selecting **Booked** now triggers the existing booking-confirmation flow instead of writing `status:'booked'` directly: returning client (`lead.client_id`) → "Mark as Booked" confirm modal; new client → `ConfirmClientModal` (QC) → success modal. All other statuses still update directly. The standalone "Confirm Client Account" button was removed (the pill's Booked option replaces it). All blocks stay tagged `// TEMPORARY: remove when booking form is live`. **[SUPERSEDED July 28, 2026 — v1.1.1:** Start Booking was restored and opens the WO; the confirm-client + mark-as-booked modals were **kept** (reachable from the status pill only) because marking a lead Booked is a distinct act from booking a session. The `// TEMPORARY` comments were rewritten accordingly — **do not delete those blocks.**]
- **Mobile CRM efficiency + nav (`a15756a`, `c24b08f`).** `+ New Lead` moved onto the CRM sub-nav tab row on mobile (nowrap; tab group flex-shrinks with internal horizontal scroll); All-Leads status pills forced to one line (nowrap + `overflow-x:auto`, `flexShrink:0`, 10px/`4px 8px`); Needs-Action tabs one line (tighter padding + scroll); dashboard Today's-Sessions date arrows vertically centered inside their 44px mobile tap targets; **mobile Nav** gained visible **CRM + Calendar** quick links beside the hamburger (`[logo] [CRM] [Calendar] [≡]`, CRM respects the tech-role hide) and the logo shifted to the 12px content gutter (`padding: isMobile ? '0 12px' : '0 32px'`); Today's-Sessions header row centered on mobile (`c24b08f`). Desktop output unchanged throughout (every change is an `isMobile ?` branch).
- **CRM lead-detail mobile layout (`e2d5a34`, `7ac93db`).** Email/phone contact line stacks into two rows on mobile (`·` separator hidden), inputs align to the name's left edge (`paddingLeft:0`), and Call/Text/Email sit next to their data (`justify-content:flex-start`, compact fixed input widths — email 190/phone 132). Inter-element gaps tightened to 6px (email↔phone, phone↔tags, tags↔session — Zone 1 bottom pad + Zone 2 top pad reduced to 6 on mobile). Header cleanup: dropped the stray `●` bullet on the Needs-Contact badge, recolored the `·` separator to `var(--text3)`. Removed the "Keep hot/warm until [date]" text everywhere (+ deleted the now-dead `khuDays`/`khuColor` locals). CRM detail Zone 1 background set to `transparent` so the panel gradient shows through the top contact section.
- **Session-date indent, studio short codes, lead-creation attribution (`2d4010f`, `a11e6e5`).** Session-date input `paddingLeft:0` (aligns to its label). **Studio short codes (display-only):** `StudioSelect` gained an opt-in `shortCodes` prop + `STUDIO_CODES` map (Paramount→PRS, Ameraycan→ARS, Encore→ERS, Track→TRK); the option label renders `PRS · Studio E` (dot separator, set `d2c60bd`) while the **stored value stays `Venue|Room`** — only the CRM lead detail passes `shortCodes` (New-Lead modal + calendar keep full names). **Activity-log lead-creation attribution:** the synthetic "Lead Created" entry was removed from the sorted list and rendered as a **dedicated always-last row** (Option B); label logic — `source==='Web Inquiry'` → `Inquiry · Lead Created`; else if a staff creator resolves → `{initials} · Lead Created`; else `Lead Created`. Added **`leads.created_by` (uuid, nullable)** to the `Lead` type; `createLead` inserts `created_by: profile?.id ?? null` (and `CrmPage` now calls `useUserProfile()`); the row's creator is resolved by `user_profiles.eq('id', created_by)` (surrogate PK, matching the `dashboard_tasks.assigned_to/by` convention). **DB note:** the `leads.created_by` column must exist (confirmed present); pre-existing leads have `created_by = null` and show the plain `Lead Created` label. `/inquiry` never sets `created_by` (server route), so web inquiries correctly read `Inquiry · Lead Created`.
- **Inter font migration (`cac0d1e`, `d2c60bd`).** The app body font switched from **DM Mono → Inter**. `styles/globals.css`: Inter (weights 400/500/600/700) added to the Google-Fonts `@import`; base `html, body` rule → `font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` and **`font-size: 13px → 14px`**; added `.font-mono { font-family: 'DM Mono', monospace }`. Because the app hardcodes `fontFamily` inline on almost every element, a CSS-only base-rule change wouldn't have flipped the UI — so a **mechanical sweep replaced all ~728 inline `fontFamily: 'DM Mono' / 'DM Mono, monospace' / "'DM Mono', monospace"` → `'Inter'` across 42 files**. DM Mono was then restored on the code-like keep-list: CRM **activity-log timestamps** (2 spans), **`LeadAvatar` initials**, **wo-hub invoice cell** + **WorkOrderPopup invoice `<input>`**, and the **login PIN numpad digits** (`numKeyStyle`). Syne (wordmark/headings) and DM Serif Display untouched. Booking IDs are never rendered as text, so nothing to keep there. The registration-PDF print route (`app/register/view/[clientId]/page.tsx`) uses CSS `font-family: 'DM Mono'` in a `<style>` block — left as-is (separate print document, out of the inline sweep).
- **Registration Record modal — gradient + private ID viewer (`d38aad2`, `31dbf42`, `7f44b05`).** `components/shared/RegViewModal.tsx` card gained `data-modal-gradient` (light-mode gradient). The Government-issued ID (private `client-ids` bucket) is signed via a **new service-role route** `app/api/client-id-photo/route.ts` — `GET ?storagePath=…`, Node runtime + `force-dynamic`, `createSignedUrl` on `client-ids` (**60-min** TTL), normalizes legacy full-URL values to a bare storage path, returns `{ signedUrl }` (400 missing / 404 sign-fail). The modal renders **inline** with an in-app **lightbox** (z 10004, above the modal): images show a thumbnail (click → lightbox `<img>`); **PDFs embed inline via `<iframe>`** (click Expand → lightbox iframe; + "open in new tab"). Image-ness is guessed by extension (`isImagePath`) with an `onError` fallback to the iframe embed, so extensionless images and genuine PDFs both display. **DB/env note:** the route needs `SUPABASE_SERVICE_ROLE_KEY` in the server env (already set for the other service-role routes). Not behind the `(main)` `AuthGuard` (it's outside the route group) but only referenced from the authed modal.
- **New Lead modal scrollbar (`ebd0bee`).** Converted the modal card to a fixed-header / scrollable-body / fixed-footer flex column (`overflow:hidden` on the card, `overflowY:auto; flex:1; minHeight:0` on the body) so the scrollbar lives only in the body and no longer runs over the rounded corners.
- **Merge to production (`fbed12c`, July 16).** `feature/light-mode` (40 commits, a strict linear descendant of `main` — no conflicts possible) merged into `main` with `--no-ff` and pushed. Two empty `chore: trigger Vercel redeploy` commits (`29094d3`, `e6b1ecc`) are in the history — Vercel had missed a webhook on a single push to the branch (a one-off; the fix is a Redeploy / empty-commit nudge, not code).

#### Still outstanding (manual, outside the repo)
- **Run the two migrations** in the Supabase SQL editor before relying on those features in production: `20260709120000_flags_photo_url.sql` (flag photo uploads) and `20260713120000_app_feedback_temporary.sql` (feedback board). Both are idempotent / single-tab.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel's server env for `/api/client-id-photo` (already required by the other service-role routes).
- ~~`leads.created_by` column: confirmed present; no action unless it's ever dropped.~~ **CORRECTION (2026-07-20):** This was wrong — the column was missing from the live DB when this entry was written. Every new-lead insert after `a11e6e5` was 400ing because `created_by` didn't exist yet. Hotfix `fa5ff77` removed the field from the insert to restore production (that commit was never pushed to `main` — it is a dangling commit). The column was added manually in the Supabase SQL editor on 2026-07-17 via `supabase/migrations/20260717120000_leads_created_by.sql` (`ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL`). **Column is now confirmed present as of 2026-07-20** (Eli verified via Supabase dashboard — uuid column exists, newer leads have UUIDs, older pre-feature leads have NULL as expected). The attribution feature is working.

### July 17, 2026 — "Dead" lead status displayed as "DNB"; Cold/Dead tab split (branch `crm-dnb-rename`)

**Display-only relabel — no DB / schema / type change.** The stored `leads.status` value stays `'dead'`; the UI now shows **"DNB" (Did Not Book)** for it, following the `type='individual'`→"COD" convention. `LeadStatus` keeps `'dead'`; no migration, no CHECK-constraint change. Two files only: `styles/globals.css` + `app/(main)/crm/page.tsx`. Left on the branch for the user to verify in-browser and merge (no push).

- **New token `--cold-lead`** (a dedicated lead "Cold" blue, distinct from the app's generic muted-gray `--cold` text color): dark `#5B8FB5`, light `#2563eb`. Added in both theme blocks in `globals.css`; `--cold` (used in ~40 places as muted-gray text) was NOT touched.
- **Display-label helper** (`crm/page.tsx`, after `LEAD_AVATAR_COLORS`): `const STATUS_LABELS: Record<string,string> = { dead: 'DNB' }` + `statusLabel(s) => STATUS_LABELS[s] || s`. Applied to the heat **pill** and the status **dropdown option** (the dropdown array still holds `'dead'` as the value — it just renders "DNB").
- **Avatar/pill colors:** `LEAD_AVATAR_COLORS.cold` → `var(--cold-lead)` (Cold rings/pills now blue); `dead` stays `var(--text3)` (DNB = gray).
- **All-Leads tabs split.** The single "Cold/Dead" tab became two: **Cold** (blue) and **DNB** (gray). `StatusFilter` union `'cold-dead'` → `'cold' | 'dnb'`; `leadStatusKey` maps `dead→'dnb'` and lets `cold` fall through to `'cold'`; `coldDeadLeads` split into `coldLeads`/`dnbLeads`; `filterMap`/`filterDefs`/`ALL_STATUS_FILTERS` updated. `DEFAULT_STATUS_FILTERS` unchanged (`uncontacted/hot/warm` — Cold and DNB both off by default, as before).
- **Persisted-filter migration.** The mount effect that restores `crm_al_active` from `sessionStorage` now expands a stored legacy `'cold-dead'` key into both `'cold'` + `'dnb'` and drops any unknown keys (preserving the empty-set = show-all semantics), so a saved filter set from before the split doesn't silently break.
- **Dead-code path consistency** (currently-unreachable `markDead`/`DeadLeadPrompt`): activity note `Marked Dead`→`Marked DNB`, prompt label `Mark dead?`→`Mark DNB?`. The unused `STATUS_COLORS` const was left alone.
- **Build note:** `npx tsc --noEmit` and the `next build` TypeScript phase both pass (no type errors from the `StatusFilter` change). A full local `next build` fails only at page-data collection for the unrelated `/api/client-id-photo` route because `SUPABASE_SERVICE_ROLE_KEY` isn't in local `.env.local` — a pre-existing local-env limitation, not from this change (Vercel builds fine). `npm run dev` browser verification is unaffected.

### July 17, 2026 — Fix broken translucent tints on CRM status pill / filter tabs / temperature selector (branch `crm-dnb-rename`, separate commit)

Fixed silently-dropped translucent backgrounds/borders in `app/(main)/crm/page.tsx`: the `${color}NN` hex-alpha trick is invalid when the color is a CSS `var()` (e.g. `var(--hot)22` is not valid CSS, so the browser discards the whole declaration). Converted the lead status **pill** fill, the All-Leads filter **tab** background/border/label, and the **temperature selector** button fill to `color-mix(in srgb, <color> N%, transparent)` — matching the pattern already used in this file (contact-method chips, ~lines 678/682) and in `components/clients/ClientList.tsx`. Alpha→% mapping preserved (0x22≈13%, 0x33≈20%, 0x80≈50%, 0xb3≈70%). Display-only; calendar/booking forms left for a separate pass.

### July 20, 2026 — CRM Analytics date-range filter now functional (branch `crm-analytics-date-filter`)

The AnalyticsView date-range `<select>` in `app/(main)/crm/page.tsx` was previously dead (a single hardcoded "All Time" option wired to nothing); every metric and chart was computed off the full unfiltered `leads` prop. Made it real: added a top-level `AnalyticsRangePreset` type + `getAnalyticsRange()` resolver (vanilla JS `Date`, no date-fns) + `ANALYTICS_RANGE_LABELS` map. AnalyticsView now holds `rangePreset`/`customStart`/`customEnd` in-memory state, derives `leadsInRange` by filtering on `lead.created_at`, and drives all three stat tiles + all six charts off it. Quick presets: All Time / This / Last Month / This / Last Quarter (calendar quarters) / This / Last Year, plus a Custom Range that reveals two `<input type="date">` fields (end-of-day inclusive). Stat sub-labels and chart subtitles reflect the active range. No sessionStorage persistence (intentionally scoped small).

### July 20, 2026 — CRM COD polish: artist name, reg panel fixes, contact button neutrals (commits `b4ea627`, `0bd7781`, `4f3b8b2`)

Small batch of CRM lead-detail and new-lead-modal polish before the larger tags work:

- **COD artist name field** (`b4ea627`): Added a dedicated "Artist Name" input in the COD new lead form (between First/Last and Email/Phone), and surfaced the stored `lead.artist_name` in the lead detail view (display-only, just below the hero name). The `artist_name` column already existed on `leads`; only the UI wiring was missing. Clients converted from a COD lead now carry the artist name through.
- **Stage name → Artist Name label** (`0bd7781`): Relabeled the COD artist name field from "Stage Name" to "Artist Name" for clarity/consistency.
- **Reg panel fixes** (`b4ea627`): The "Send Reg" button now only shows the "Reg Sent" confirmation state after an actual copy or email action (not on first render). Reg link copy and email buttons close the reg panel automatically after the action (auto-close). The reg link itself is displayed as a teal hyperlink (`color: var(--accent)`) rather than plain text.
- **Contact method buttons neutral** (`4f3b8b2`): Removed status-derived colors from the Call/Text/Email action buttons in the lead detail. Active state is now a neutral dark pill (same outlined-dark pattern as other action buttons) — the hot/warm/cold status no longer bleeds into the contact strip.

### July 20, 2026 — Tags on leads and clients; artist name sync (branch `crm-tags`, commits `f5886d1`, `e2169d4`, `cbab044`)

A tagging system for both leads and clients — flexible labels for A&R roles, genres, deal types, or anything else:

**Schema (migration `supabase/migrations/20260720130000_tags.sql` — run manually):**
```sql
alter table public.leads add column if not exists tags text[] not null default '{}';
alter table public.clients add column if not exists tags text[] not null default '{}';
```

**`lib/tags.ts`** — new file defining `STARTER_TAGS` (the shared quick-chip list used across all tag UIs):
```
'Label A&R', 'Artist Manager', 'Producer', 'Engineer',
'VO', 'Leasing', 'Location Scout / Filming', 'Content Creator',
'Brand Partnership', 'Event / Listening'
```

**Tag UI — lead detail (`app/(main)/crm/page.tsx`):** Collapsible TAGS section below the activity log. Shows applied tag chips (each with a `×` remove button) + a row of STARTER_TAGS quick-chips that haven't been applied yet. A small text input below lets the user type and press Enter to add a custom tag. Each add/remove calls `supabase.from('leads').update({ tags: [...] })` immediately.

**Tag UI — new lead modal (`app/(main)/crm/page.tsx`):** Tags section added below Notes in both the COD and Label new-lead forms. Starter chips + custom input. Tags are included in the `handleSave` payload on submit.

**Tag UI — client profile (`components/clients/ClientProfile.tsx`):** Same starter chips + custom input + applied chips UI, added before the profile footer. Reads/writes `client.tags`. Resets when the active client changes.

**Tag sync on lead → client conversion:** When a lead is converted to a client via the Confirm Client Account flow, the lead's `tags` array is included in the client insert so tags carry forward from the pipeline record.

**`lib/supabase.ts`:** `tags: string[]` added to both the `Lead` and `Client` interfaces.

### July 20, 2026 — Email campaigns: suppression flags, campaign history table, CAMPAIGNS tab (branch `email-campaigns`, commits `a4e2070`, `1f97023`, `25e19c1`)

A first-party email marketing feature built directly into CRM — compose, segment, and send campaigns to leads and clients.

**Schema (migration `supabase/migrations/20260720140000_email_campaigns.sql` — run manually by Eli in Supabase SQL editor):**
- `leads.email_opt_out boolean NOT NULL DEFAULT false` — suppression flag
- `clients.email_opt_out boolean NOT NULL DEFAULT false` — suppression flag
- `email_campaigns` table: `id uuid PK`, `subject text`, `body text`, `segment_tags text[]`, `segment_statuses text[]`, `segment_billing text | null`, `recipient_count int`, `sent_by text`, `sent_at timestamptz`, `results jsonb` (array of `{email, name, status, error?}` per recipient)
- RLS on `email_campaigns`: owner-only `SELECT` and `INSERT` (keyed on `user_profiles.role = 'owner'` via `auth.uid()`). No realtime subscription (history view, not a live surface).

**`lib/supabase.ts`:** Added `email_opt_out: boolean` to `Lead` and `Client` interfaces; new `CampaignResult` and `EmailCampaign` interfaces.

**CAMPAIGNS tab (`app/(main)/crm/page.tsx`):** A third tab next to LEADS and CLIENTS, gated to owner users with Eli's email addresses only (`profile?.role === 'owner' && (profile?.email === 'srv2129@gmail.com' || profile?.email === 'eli@paramountrecording.com')`). The dual-email gate is intentional — Eli logs in via PIN which is attached to `eli@paramountrecording.com`, not his Gmail address.

**`CampaignsPanel` component (inline in `crm/page.tsx`):** Three sections:
1. **Segment picker** — status multi-select (uncontacted/hot/warm/cold/DNB), billing (All/COD/Billing), and tag filter (any-of-selected-tags matching)
2. **Recipient preview** — live count + expandable list of matched leads/clients; excludes anyone with `email_opt_out=true` or a missing email; `dead` is excluded when no statuses are selected, included when explicitly selected
3. **Compose** — Subject line + body textarea with a `[First Name]` personalization note; Send button POSTs to `/api/send-campaign`; campaign history collapsible section below (loads from `email_campaigns`, most-recent first)

Status picker includes `{ value: 'dead', label: 'DNB' }` — see fix commit `25e19c1`.

**`/api/send-campaign` route (`app/api/send-campaign/route.ts`):**
- Returns `503` if `RESEND_API_KEY` is not set (the integration is pending Resend domain verification)
- Sends emails one at a time via Resend's REST API (`https://api.resend.com/emails`) with `[First Name]` substitution per recipient
- FROM address: **`Paramount Recording Studios <info@paramountrecording.com>`** (changed from `studio@…` in commit `2c199bd`, July 20–21, 2026 — domain verification covers any `@paramountrecording.com` sender, so this was a one-line code change, no DNS work).
- Logs the campaign to `email_campaigns` via the service-role Supabase client after all sends
- Returns `{ sent, failed, results }`

**Fix `1f97023`:** Campaigns tab was initially gated to `profile?.email === 'srv2129@gmail.com'` only. Eli logs in via PIN (attached to `eli@paramountrecording.com`), so the tab was invisible. Fixed to check both emails.

**Fix `25e19c1`:** `dead` status was absent from the STATUS_OPTIONS picker AND always filtered out of recipients. Fixed: added `{ value: 'dead', label: 'DNB' }` to STATUS_OPTIONS; changed recipient filtering so `dead` is only excluded when no statuses are selected (i.e., it only appears if explicitly chosen).

**Resend setup status (updated July 21, 2026):** Domain `paramountrecording.com` added in Resend. The management company added the DNS records on the **`send.paramountrecording.com`** subdomain — MX `feedback-smtp.us-east-1.amazonses.com` (pri 10) and SPF TXT `v=spf1 include:amazonses.com ~all` — with DKIM + DMARC already at the root domain (they apply to the subdomain). Both records **confirmed live via `dig`** (MX + SPF resolving through `dns{1,2,3}.pixelgate.net`). Return-Path/bounces route through `send.paramountrecording.com`; recipients still see `@paramountrecording.com`. **Remaining:** click "Verify DNS Records" in Resend, then add `RESEND_API_KEY` to Vercel (the `/api/send-campaign` route 503s until the key is set).

---

### July 21, 2026 — Unified Work Order rebuild, Steps 1–5a (spec, migrations, ClientPanel, seed helper, WO top, projection start)

Kicked off the big **Booking = WO** rebuild — collapsing the two-form (BookingForm + WorkOrderPopup) model into a single Work Order that is the source of truth, with the `bookings` row demoted to a calendar projection. Full plan + rationale in the new `docs/WO-SPEC.md` and the Decisions Log subsection "The unified Work Order (Booking = WO) rebuild". Design settled with Eli across the session; scheduling model confirmed (rooms usually one-per-session but can change per day; calendar keeps a connected multi-day card that will show per-day info; runner hub is per-location). Commits `3f64d95`, `9b71b0d`, `0af8fd7`, `5553d86`, `6a2a804`, `a915fd6`, `f5508f1`, `c540614`.

**Migrations (all run manually by Eli in Supabase, all idempotent/additive):**
- `20260721120000_wo_number_and_booking_wo_link.sql` — `work_orders.wo_number` (unique, NOT NULL, `'WO-'||nextval('wo_number_seq')`, seq starts 1001; existing 8 WOs backfilled oldest-first → WO-1001…WO-1008) + `bookings.work_order_id uuid → work_orders(id) on delete cascade` (the new link direction). Old `work_orders.booking_id` kept for now.
- `20260721130000_work_orders_session_fields.sql` — `session_status`, `session_type`, `client_id`, `is_srs`, `cod_method`, `anr_contact_id`, `anr_admin_contact_id` on `work_orders`, backfilled from the linked booking (anr ids cast text→uuid; `is_srs` assigned directly). First run hit `COALESCE uuid/text` mismatch → fixed with `nullif(b.x,'')::uuid`.
- `20260721140000_work_orders_booking_notes.sql` — `work_orders.booking_notes` (internal ops notes).
- Ad-hoc backfill (not a file): `update bookings b set work_order_id = w.id from work_orders w where w.booking_id = b.id and b.work_order_id is null;` — links the 8 existing bookings to their WOs.

**Step 1 — foundations (`9b71b0d`, `3f64d95`).** `docs/WO-SPEC.md` written from a full code audit (calendar, createWorkOrder, WorkOrderPopup, runner WO, runner hub, studios). wo_number + booking-link migration.

**Step 2 — `components/shared/ClientPanel.tsx` (`0af8fd7`).** Self-contained client identity/contact block (SRS toggle, COD/Label-Billing toggle, client/A&R/artist search + autofill, inline add-contact, contact-update prompt, view-full-profile). `value`/`onChange` interface emitting the client-subset of session fields. Faithful port of BookingForm's right column; BookingForm left untouched (it's deleted later, Step 8).

**Step 3 — `lib/seedStudioTimeRows.ts` (`9b71b0d`).** Extracted the row-generation out of `createWorkOrderForBooking` into a shared, **append-only** `seedStudioTimeRows()` (skips dates already present). `createWorkOrderForBooking` refactored to call it (byte-identical seeding). Also exports `dateRange`, `toStudioLetter`.

**Step 4 — WO top rebuild + Seed panel (`6a2a804`, `a915fd6`, `f5508f1`).** Replaced WorkOrderPopup's flat META header with: WO number in the header; **status bar** (colored per booking-form status — teal/orange/red/purple/blue/light, via `SESSION_STATUS_COLORS`); left **panel card** = Session Type + Invoice # + PO # + Food Budget + **Booking Notes** (internal-only badge, `data-no-print`); right = `<ClientPanel>`. Removed studio/rate/date/time/engineer/assistant from the top (now table-only). Added a collapsible **"+ Seed — add multiple days"** panel above the Studio Time table calling `seedStudioTimeRows`. Save persists all new session-level fields to `work_orders` and mirrors them to the booking. Mobile keeps its existing read-only SESSION INFO card (new editable top is desktop-only). Iterated on Eli's feedback: pill colors, tightened layout into a bordered left card, single Invoice # field, and the Booking Notes area (renamed from "Internal Notes" once the notes taxonomy was clarified). Verified on a Vercel preview (branch `wo-top-rebuild`) before merge.

**Step 5a — calendar-card projection start (`c540614`).** On WO save, sync `start_date`/`end_date`/`from_time`/`to_time` + **studio** (converted bare-letter→full room label via `roomLabelForVenue`, using `STUDIO_LOCATIONS`) + `work_order_id` onto the primary booking card. `createWorkOrderForBooking` now also sets `bookings.work_order_id` at creation. This replaces the old "don't sync studio" limitation and links every card to its WO (needed for Step 6). Covers the common single-room case.

**Where this stands / next session (Step 5b onward):**
- **Step 5b** — multi-room card splitting: one `bookings` card per consecutive-same-room segment of the WO's `studio_time_rows` (upsert keyed on `(work_order_id, studio, start_date)`, delete stale, keep the primary card stable). Needs careful handling of the `bookings` insert schema (NOT NULL columns).
- **Step 6** — calendar opens the Work Order **directly**: double-click a card → WO (no BookingForm, no "Work Order" button); double-click an empty day → create session + WO → open it. Uses `bookings.work_order_id`. *(This removes the extra click Eli flagged.)*
- **Step 7** — enrich the calendar card (per-day room/time/engineer, WO number on card) + per-day runner time.
- **Step 8** — delete `BookingForm.tsx` and its imports.
- **Step 9** — cleanup migration: drop `work_orders.booking_id` + its old `UNIQUE`.
- **Step 10** — verify every projection consumer (calendar, runner hub, LocationStrip, daily ops, dashboard grid) with one-WO-many-cards.

All Steps 1–5a are on `main` and pushed (HEAD `c540614`). `tsc --noEmit` clean.

---

### July 28, 2026 — WO rebuild 5b/6/7 + blocks, architecture audit, Phase 0 safety net, Phase 1 data integrity, Admin Errors tab

Massive session. The WO rebuild became feature-complete, then a full architecture audit was run and its two top phases shipped the same day.

**WO rebuild (continuing docs/WO-SPEC.md):**
- **Step 6 — calendar opens the WO directly.** Clicking any WO-bearing session, double-clicking an empty day (creates session+WO), and the lead Start Booking flow all land in the Work Order — no BookingForm intermediary. Non-WO legacy blocks fall back to the form. WO gained a header **Delete session** button (confirm → removes WO + line items + card(s)). `openNew` → `createBookingAndOpenWO()`; `buildBookingPayload()` extracted from `handleSave`.
- **Step 5b — multi-room card splitting.** `projectBookingCards()` in WorkOrderPopup: dated studio rows → segments (new segment on room change or date gap) → one `bookings` card per segment (primary updated in place; secondaries upserted/deleted, all sharing `work_order_id`). WO resolution now prefers the card's `work_order_id` link (secondary cards have no `booking_id` row of their own); `primaryBookingIdRef` keeps the projection writing the canonical primary regardless of which card opened the WO.
- **Non-session blocks (Tour/Tech/Open Hours).** Picking one of those statuses in the WO collapses it to a simple event editor — Title + start/end dates + from/to times — hiding all WO machinery (`isBlock`, `handleBlockSave`). Blocks with a `work_order_id` reopen into the same simple view. Fixes shipped en route: session status/type fall back to the booking on open (older WOs opened blank and **saving a blank status whitened the card / appeared not to save**); status writes now guarded (never write empty). Seed panel fixes: Day/Hr toggle (label-wrapper click bug), engineer Yes/No toggle + name + rate, delete-row confirm popover opens beside the ×, placeholder shadow-text removed.
- **Step 7 — WO number on cards.** `bookings.wo_number` denormalized (migration `20260728120000_bookings_wo_number.sql`, backfilled); written by the projection + `createWorkOrderForBooking`; rendered bottom-left on calendar chips.
- **Steps 8/9 deliberately deferred:** BookingForm still backs legacy blocks; `work_orders.booking_id` is load-bearing (WO create idempotency, runner hub resolution) — retiring it is its own migration project.

**Architecture audit — `docs/AUDIT-2026-07.md`.** Verdict: no rewrite; sound foundation (security, realtime discipline 24/24, lean deps, docs) with risk concentrated in (1) missing safety net, (2) monolith files + duplicated billing math. Hard numbers in the doc. Note: app is on **Next 16.2.6** (docs said 14).

**Phase 0 — safety net (all shipped):**
- **Local dev fixed.** Root cause: `/api/auth/pin` requires `SUPABASE_SERVICE_ROLE_KEY`, absent from `.env.local` — server booted, login always failed. Documented in `.env.local.example`; route now returns a clear 503 `server_config` instead of crashing.
- **Error boundaries:** `app/error.tsx` + `app/global-error.tsx` (styled recovery screens, auto-report).
- **First-party error monitoring:** `app_errors` table (migration `20260728130000_app_errors.sql`; RLS: service-role insert, owner/manager select) ← `/api/log-error` (rate-limited 30/min/IP) ← `lib/errlog.ts` (`logAppError`, sendBeacon, de-duped) ← `components/ErrorReporter.tsx` (window error + unhandledrejection listeners, mounted in root layout).
- **Visible save failures:** `components/ui/Toaster.tsx` (global toast via CustomEvent, mounted in root layout) + `lib/db.ts` `dbResult(label, error)` — checks a write's error, shows a red "NOT saved" toast, logs to app_errors. Adopted across the live CRM's critical writes (log contact, keep hot/warm, DNB, create lead, status changes, inline saves, tags).

**Phase 1 — data integrity (shipped):**
- **`lib/time.ts` + `lib/format.ts`** — canonical home for timeToMins/calcHours/calcCharge/dateRange/isNextDay/toStudioLetter and formatCurrency/stripCurrency/fmtTimestamp/fmtClock. All duplicate definitions deleted (WorkOrderPopup, runner WO, seedStudioTimeRows, calendar, dashboard, FlagsLog, DailyOpsLog, DailyOpsModal — the last four via alias `const fmtTime = fmtTimestamp/fmtClock`). **Behavioral fix:** canonical `calcHours` adopted the runner's NaN guard — the admin copies could produce phantom billable hours from unparseable time strings. Calendar keeps a deliberate local `timeToMins` (sort key needs 0, not NaN).
- **tsconfig:** `target` es5→es2020; **`noImplicitAny: true`** permanently (10 violations fixed). Full `strict` remains staged.
- **`.maybeSingle()` audit:** remaining uses are safe post-UNIQUE constraints; unguarded ones only in dead/dying files.
- **Deferred:** atomic Postgres RPCs for WO create/save — next-session work, needs real testing.

**Admin Errors tab + dead code:** `components/admin/ErrorsSection.tsx` wired as Admin sidebar "Errors" (owner/manager only, realtime via `20260728140000_app_errors_realtime.sql`, expandable stacks, load-more). **`components/unified/UnifiedSessionForm.tsx` deleted** (1,066 dead lines).

**Migrations this session (all run by Eli):** `20260728120000_bookings_wo_number.sql`, `20260728130000_app_errors.sql`, `20260728140000_app_errors_realtime.sql`. Env: Eli added `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`.

> **CORRECTION (July 29, 2026):** that last claim was WRONG. `.env.local` still contained only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — verified by key-name inspection when `scripts/set-staff-passwords.mjs` failed with "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY". The key is documented in `.env.local.example` and presumably set in Vercel (production PIN login works), but was never added locally. So **"local dev fixed" was never actually verified** — `npm run dev` PIN login and anything else needing the service role still fail locally until the key is added. Same failure mode as the `leads.created_by` incident (July 17): the log recorded an intended state as a completed one. Don't mark an env/DB change done without inspecting it.

**Post-test fixes (same day, from Eli's live test pass):**
- **Studio Time studio cell → venue+room dropdown** ("PRS A" / "ERS B" / "TRK North", any location). Kills a destructive bug: empty studio string is the eng-row encoding, so clearing the old free-text cell morphed a studio row into an engineer row irreversibly. New `studio_time_rows.location` column (`20260728150000`; NULL = booking's venue); projection segments on room OR venue change → true cross-venue cards.
- **Per-row engineer names** — `studio_time_rows.eng_name` (`20260728160000`), editable in the eng sub-row with an engineers-roster `<datalist>` (free text allowed), falls back to the WO-level engineer. Follow-up: runner WO page should display it.
- **Cards: WO number removed** (Eli preference; stays in the WO header). **Engineer initials restored** — the projection had been wiping `engineer_name` (the WO top no longer has an engineer field); cards now derive engineer per segment from row `eng_name` → WO engineer, and the write is omitted when empty so initials can never be blanked. Multi-room cards can show different initials per room-run.
- **Multi-room card projection confirmed working in production** (Eli's test).

---

### July 28, 2026 (session 2) — 1ST/2ND staff roles on studio time rows, runner per-day names, atomic WO RPCs

Eli's test results from the earlier session: **blocks (Tour/Tech/Open Hours) passed**, multi-room projection confirmed in production; **engineer initials on cards still missing**, plus a real gap — **no way to assign an assistant anywhere** in the rebuilt WO (both engineer + assistant fields died with the old BookingForm top). Eli's rule: **every session has an engineer OR an assistant** (1ST or 2ND). Local-dev PIN login and the error pipeline remain untested (low priority).

**Root causes found:**
1. The eng sub-row only rendered when `wo.engineer` or `r.eng_rate` was set — but the rebuilt WO top has no engineer field, so on new WOs there was literally **nowhere to type an engineer** → the projection had nothing to write → no card initials.
2. The projection wrote `assistant_name: wo.second_engineer || null` — always null now (no UI sets `second_engineer`), so it actively blanked assistants.

**Fix — per-row 1ST/2ND role toggle (Eli's pick, spec-conformant — staffing stays in the Studio Time table):**
- **`studio_time_rows.eng_role`** (`'engineer'|'assistant'`, default engineer) — migration `20260728170000_studio_time_rows_eng_role.sql` ⚠️ **not yet run**.
- The staff sub-row is now **always visible** (unless explicitly cleared via ×) and its "Eng" label is a **1ST/2ND toggle button** (1ST lime/accent = engineer, 2ND orange = assistant); name placeholder follows the role. Clearing the sub-row now also clears `eng_name` + resets the role (previously stale names survived a clear and kept projecting).
- **Projection**: each segment carries the first named staffer + role → writes `engineer_name` (1ST) or `assistant_name` (2ND) on the card; when a name is present the opposite column is cleared (role switch moves the initials); when no name exists both are omitted (never blanks). Legacy `wo.second_engineer` still honored as an assistant fallback. The old blanket `assistant_name: null` writes (projection + bkSync) are gone.
- **Seed panel**: "Engineer" → "Eng / Asst" with a 1ST/2ND role toggle + roster datalist on the name field; seeded rows get `eng_name`/`eng_role`. A named 1ST engineer still also sets the WO-level fallback; assistants are row-only.
- **`createWorkOrderForBooking` seed**: rows now seed `eng_name`/`eng_role` from the booking (engineer first, else assistant) so lead-converted sessions project initials from day one.
- **Runner WO page (queue item 2)**: per-day staff on each studio-time row — `r.eng_name` first, falling back to WO engineer (or booking assistant for 2ND rows); initials pill + popover show the role (`1ST · Name` / `2ND · Name`, orange for 2ND); SESSION INFO card gained an Assistant line; eng sub-row now renders/saves for rows with a per-row name even when no WO-level engineer exists.

**Atomic save RPCs (audit Phase 1 remainder) — migration `20260728180000_wo_atomic_rpcs.sql` ⚠️ not yet run, Eli reviews first:**
- Design rule honored: **no second copy of the seeding/business logic.** All values (rates, charges, OT, segments, card fields) are still computed in TypeScript by the existing single-source code; the Postgres functions are dumb all-or-nothing appliers of prebuilt jsonb payloads. Generic helpers (`app_private.apply_update/apply_insert/apply_upsert`, dynamic column lists from the payload keys, types cast by `jsonb_populate_record`) live in a new **`app_private` schema** so PostgREST never exposes them; the two entry points are `public`, SECURITY INVOKER (RLS applies exactly as before), revoked from anon.
- **`create_work_order_atomic(p_booking_id, p_wo, p_st_rows, p_equip)`** — WO insert idempotent on `booking_id` + booking link + both seeds, one transaction. `lib/createWorkOrder.ts` now builds payloads (new exported `buildSeedRowPayloads` in `lib/seedStudioTimeRows.ts` — same single-source row builder, no insert) and makes ONE `.rpc()` call; the old 4-step sequential path is gone. Adopt path (WO exists) seeds nothing, byte-for-byte the old semantics.
- **`save_work_order_atomic(p_wo_id, p_wo, p_primary_booking_id, p_primary_card, p_st_rows, p_rentals, p_payments, p_secondary_cards)`** — WO update + studio/rental/payment upserts (conflict on id) + the full card projection (primary update, secondary match-by-(studio,start_date)/insert, stale delete) in one transaction. Card writes are gated on `p_primary_card` being non-null (a WO without booking context can never delete cards). `WorkOrderPopup.handleClose` now builds all payloads (projection refactored to the pure `buildBookingProjection()`) and makes ONE `.rpc()` call; on failure **nothing** was written, a red `dbResult` toast shows, and the popup stays open so edits aren't lost. `rentIdsInDb`/`payIdsInDb` refs removed (upsert made them dead).
- `seedStudioTimeRows` (Seed panel path) unchanged — single insert statement, already atomic.

**⚠️ Deploy order (matters):** run `20260728170000` then `20260728180000` in the Supabase SQL editor **BEFORE `git push`** — the deployed code calls the RPCs and reads `eng_role`. Both are idempotent/additive; nothing breaks in prod until the push.

**Test list for Eli (after migrations + push):** (1) new WO from lead → card shows 1ST initials; (2) toggle a row to 2ND → card flips to 2ND-XX; (3) multi-room WO save → cards still split correctly (projection now runs inside the RPC); (4) Seed panel with 2ND role; (5) rentals/payments still save; (6) runner WO shows per-day names + Assistant line; (7) force a save failure (airplane mode) → red toast, popup stays open, nothing half-saved.

**Follow-up (same session, Eli's rule change):** sessions can need an engineer AND an assistant, and staffing must be fully custom. Table footer now has three always-available actions — **`+ Add Studio Time` / `+ Add Engineer` / `+ Add Assistant`** (standalone staff rows carry `eng_role`). Projection reworked: each segment collects **both** roles (studio-row sub-rows first-name-per-role wins, plus standalone staff rows folded in by date), so a card can show `1ST-XX` and `2ND-XX` together; when neither role is known both keys are omitted (never blanks), when at least one is known both are written explicitly (name or null) so removals/flips propagate. Seed panel still seeds one staffer (pick 1ST or 2ND); the other role is one `+ Add` away — dual-staff seeding is a possible future nicety. No new migration (uses `eng_role` from `20260728170000`).

**Live-test fixes (same evening, all confirmed working by Eli):**
- **RPC bug:** `save_work_order_atomic` failed with `operator does not exist: date = text` — `bookings.start_date` is a real `date` column (docs said text); secondary-card match now compares `start_date::text`. Silver lining: the failure surfaced as a red toast with a full rollback — the Phase 0/1 safety net working as designed. Fix is in the migration file AND was re-run in Supabase (`create or replace`).
- **`+ Add Studio Time` became an eng row:** it inherited `studio` from the last row overall — a standalone staff row has `studio: ''`, which IS the eng-row encoding. Now inherits from the last STUDIO row (→ booking's room → `'A'`), so a studio-time row can never be born with an empty studio.
- **Date-cell hit target:** the invisible `<input type=date>` overlay only opened the picker on the browser's calendar-icon zone. Both date cells (main row + staff sub-row) now call `showPicker()` on any click in the cell (try/catch for older Safari).
- Workflow note (STANDING RULE): the Cowork sandbox can't unlink files on the mount, so every git write strands a `.git/*.lock` file. **Claude edits files only; Eli runs all git commands — and Claude must ALWAYS hand Eli a complete copy-paste Terminal line for every commit/push (Eli is not a developer; never say "commit and push" without giving the exact command).** Also: don't use `rm -f .git/*.lock` in zsh when no locks exist — an unmatched glob aborts the whole chain; name the files explicitly or skip the rm.

**Step 8 — BookingForm deleted (same evening).** Everything opens the Work Order now:
- **Legacy WO-less blocks** (Tour/Tech/Open-Hours/cancelled made pre-rebuild): `WorkOrderPopup.initWO` no longer dead-ends on `bookingShouldHaveWorkOrder` — it opens the simple block editor against the booking alone (synthetic `wo`, `woIdRef` null; `handleBlockSave` already guarded its `work_orders` write). Flipping a legacy block to a real session status **promotes** it: `handleClose` creates the WO via `createWorkOrderForBooking` (atomic RPC) and falls through to the normal save.
- **Calendar:** `openEdit` always opens the WO; deleted `openEditForm`, `handleSave` (the whole woOwnsSchedule/day-rate-reconciliation branch — the WO owns all of that now), `handleDelete`, the `cal_form_draft` restore, form state, and the `<BookingForm>` render.
- **Dashboard:** booked room-grid cards open `WorkOrderPopup` directly; `handleDashSave` + form state deleted; delete goes through the shared helper.
- **New `lib/deleteSession.ts`** — `deleteSessionAndWO(b)`: WO + line items + SRS log + ALL cards (resolves WO by `work_order_id` link AND legacy `booking_id`; used by calendar + dashboard).
- **New `components/calendar/sessionFormData.ts`** — `FormData`/`emptyForm`/`bookingToForm` extracted (still power `createBookingAndOpenWO`/`buildBookingPayload`); `components/calendar/BookingForm.tsx` (1,675 lines) removed via `git rm` (sandbox can't unlink on the mount). `tsc --noEmit` verified clean with the file absent.

**Step 8 verified in production (Eli):** legacy blocks open + save in the WO block editor, dashboard cards open the WO, delete removes all cards. The atomic RPCs + 1ST/2ND staffing tests all passed the same evening.

**Step 9 — scoped, NOT started (next session's project).** Full inventory of `work_orders.booking_id` readers that must invert to `bookings.work_order_id` first: runner hub `/runner/[studio]` (woMap), runner WO page (`?booking_id=` adopt path + realtime handler), `/wo-hub` (list join), `DailyOpsLogSection` (`.in('booking_id', …)`), `LocationStrip` (3 query sites: submitted badge + today/yesterday WO maps), `WorkOrderPopup.initWO` legacy fallback + `primaryBookingIdRef`, `lib/deleteSession.ts`, `createWorkOrderForBooking` payload. The create RPC must re-key idempotency from `on conflict (booking_id)` to a `select … from bookings where id = p_booking_id for update` row-lock + adopt-existing-link check, and stop inserting the column. Only after all of that is deployed + verified does the drop migration run (re-run the `work_order_id` backfill first, then drop the UNIQUE + column). Seven nightly-used surfaces — deliberately not stacked onto this session.

**Carried into Step 9 (added July 28, session 3 — do NOT lose these):**
1. **`bookings.lead_id`** — a durable link from a session back to the CRM lead that produced it. Today that link lives only in `calendar/page.tsx` component state (`woLeadId`) for the lifetime of one WO session, so abandoning a WO and reopening it later loses it and that save won't mark the lead booked. Step 9 is already reshaping the booking↔WO columns, so add it there rather than bolting on a second ad-hoc column. Once it exists, `WorkOrderPopup` should read the lead from the booking instead of taking a `leadId` prop.
2. **Typed A&R / Admin names must become real contacts.** In `ClientPanel`, the A&R and Admin fields are search boxes over `client_contacts`; picking a match links a real record by id, but typing a name that matches nothing saves the raw string to `bookings.ordered_by` and it never becomes a contact — no first/last, no record, unreachable from the client profile. Fix: typing a new name offers to create a `client_contacts` row (first + last, on the linked client) and links it. **Standing convention (Eli, July 28): a person's name is ALWAYS two separate fields anywhere it's edited** — see CLAUDE.md → Data model → `clients`. The CRM is fully compliant as of v1.1.0; the WO is the remaining gap. Note the Artist field (a stage name) and the signature "Print Name" lines (legal, full name by convention) are deliberately single fields and are NOT part of this.

**UI redo Phase 2** remains queued after Steps 8/9 settle.

---

### July 28, 2026 (session 3) — CRM batch: shared Asst Mgr tasks, registrations database, lead date ranges, client-rename propagation

Nine CRM fixes from Eli's list. No WO work; Step 9 deliberately untouched.

**Migrations (both run by Eli before the push):**
- `20260728190000_leads_session_end_date.sql` — `leads.session_end_date text` (nullable). Additive.
- `20260728200000_dashboard_tasks_peer_role.sql` — new `is_task_peer(uuid)` SECURITY DEFINER helper + widened `dashboard_tasks` SELECT/UPDATE policies.

**1. Asst Mgr tasks now shared between Quinn and Isaac (and Tech between Sierra and Tom).** Root cause was at the DB layer, not the UI: the "Asst Mgr" assign option writes `assigned_to` = the primary member's id (Quinn), and the visibility policy from `20260702175800` let an own-only role read a row only when `assigned_by`/`assigned_to` was their own profile id. Isaac could not SELECT Quinn's task at all. Fix: a **peer clause** — a user holding a PAIRED role (`asst_manager`, `tech`) may read and update any NON-private task assigned to someone with that same role. `is_private` stays guarded so Eli's private self-tasks remain Eli-only; DELETE was deliberately not widened (the dashboard `×` is a soft delete via UPDATE, already covered). Client side, `fetchMyTasks`/`fetchMyCompletedTasks` **dropped their `.or(assigned_to.eq.X, assigned_by.eq.X)` filter entirely** — it was a narrower client-side re-implementation of the policy, which is exactly what hid the teammate's task. RLS is the authority; a paired role also can't resolve its peers' ids client-side anyway (tech/runner can only read their own `user_profiles` row).

**2. Copy Billing Address.** `RegViewModal`'s address fields are now one bordered block with a **Copy Address** button; exported `buildMailingBlock()` builds `Name / Street / Street 2 / City, ST ZIP`, dropping blank pieces so a partial address never pastes stray commas or empty lines. Clipboard failures surface as an error toast rather than a fake "Copied".

**3. Label clients from a company name alone.** The New Client modal's `valid` gate required an email or phone for every type; a label now validates on the company name alone (A&R name + contact details optional — labels get opened before the A&R is known). A&R fields relabelled "(optional)". **Duplicate detection extended to the company field for labels** — otherwise the one field a label-only entry fills was the one field never checked, and a second "Interscope" could be created silently.

**4. Lead date ranges.** `leads.session_end_date` (nullable; NULL = single-day). Optional End Date in both the New Lead modal and the lead detail (`min` bound to the start), `fmtSessionLine` renders "Aug 4–Aug 9", and the calendar's lead→session conversion seeds `end_date` from it — so a week-long ask opens the WO on the full week instead of collapsing to one day. Blank end dates persist as NULL, never `''`.

**5. REGISTRATIONS tab (new).** `components/crm/RegistrationsView.tsx` — a third CRM tab listing every client with a `registered_at`, newest first: Name · Email · Phone · City/State · Submitted · ID badge. Search (name/email/phone) + submitted-date range + **25 per page** with a pager; a row opens the existing `RegViewModal`, so there is still exactly one registration-detail UI. Filtering/paging are client-side by design (small row count, instant search, one plain re-fetch signal). Previously a registration was only visible in the transient 30-day review banner and unreachable afterwards.

**6. Registration banner moved to the CRM.** Extracted from `ClientsPageInner` into `components/clients/RegistrationBanner.tsx` (banner + review modal + its own data) and mounted at CRM page level, above the tab bar — it used to appear only once you were already on the CLIENTS tab, so returned registrations went unseen by anyone working leads. Confirming a registration now switches the CRM to the CLIENTS tab and selects the new profile via `initialClientId`. `ClientsPageInner`'s auto-select was reworked around an `appliedTargetRef` so a *later* `initialClientId` change still applies (the old once-only guard had already fired), while a realtime refresh can't yank the user off a row they picked themselves. Both writes in the moved code now go through `dbResult` — a failed confirm no longer removes the registration from the banner while leaving it unconfirmed in the database.

**7. Web inquiries flash in the CRM lead lists.** The dashboard's `isUnacked` pulse now also runs on CRM rows in **both** Needs Action and All Leads. Their two byte-identical inline row-style objects were collapsed into one `leadRowStyle()` helper (they had already drifted apart once by construction). The `webInquiryPulse` keyframe was changed from the hardcoded lime `rgba(200,240,78,…)` to `rgba(var(--accent-rgb),…)` — it had been flashing lime over the blue light theme.

**8. Incomplete tab removed from Needs Action.** Genuinely redundant: its filter was `['hot','warm','uncontacted'].includes(status) && getMissing().length > 0`, so every lead it showed was already in one of the other three tabs — and the header total added them a second time, overstating the queue. Removed the tab, the bucket, the `type: 'touch' | 'incomplete'` discriminator, and the duplicated count on the CRM page. The `sessionStorage` restore is now validated against the live tab list, so a session saved before this change can't select a bucket that no longer exists.

**9. Client renames propagate — and individual clients now have real First/Last fields.** The client profile only ever exposed one combined `name` field, while `leads` keep first and last in separate columns. That made a COD rename un-propagatable without guessing where to split the string. **Eli's call (standing convention): first and last are two separate fields anywhere a person's name appears in the app.** So the profile header now edits **First + Last** for individual clients (labels keep the single company-name field — a label name is one field everywhere), committing `fname`, `lname` and the combined `name` in a single write so they can't drift. Fields pre-fill from the stored columns, falling back to splitting `name` for older/registration-created clients whose first/last were never populated. `propagateClientRename` keeps a name-only split as a fallback for legacy callers, but the normal path now passes both halves verbatim — no heuristic. **Follow-up: the WO's `ClientPanel` still surfaces a combined client name — bring it in line during Phase 2.**

New `lib/propagateClientRename.ts`. `bookings` and `leads` denormalize client-facing names, so fixing a spelling on the profile used to leave the old spelling on every calendar chip, WO and lead. On client save, `propagateClientRename` rewrites `bookings.label`/`client_name` and `leads.label`/`fname`/`lname` for everything linked by `client_id` (label vs individual mapped separately — a label's `name` is the label, its fname/lname the primary A&R). On A&R contact save, `propagateContactRename` rewrites `bookings.client_name`/`ordered_by` and the lead names for rows linked by `anr_contact_id`. **Only name fields propagate** — artist is per-session for a label and email/phone record who was reachable when the booking was made; overwriting either would destroy real data. Work orders need no pass of their own (they read the client through the booking). Every write is `dbResult`-checked and reports how many records changed.

**Realtime consolidation (fell out of 5/6).** Three CRM surfaces now need `clients` changes, which would have meant three subscriptions on one table — against the standing rule and three re-fetches per change. New **`hooks/useClientsVersion.ts`**: one module-level `clients-shared` channel, opened on the first subscriber and torn down after the last leaves, exposing a version counter — the same shape as `WebInquiryProvider`'s `leadsVersion` minus the context. The registration banner, REGISTRATIONS list, `ClientsPageInner`, and the **Nav reg badge** all watch it; `ClientsPageInner` keeps a local `client_contacts` channel (single consumer). Net: the app went from two `clients` subscriptions to one, while gaining two consumers.

**Verification:** `npx tsc --noEmit` clean. `next build` can't run in the Cowork sandbox (Linux ARM SWC binary absent, no registry access) — not a code issue; live-URL testing as usual. New light-mode rule added for `[data-panel="crm-registrations"]` to match the existing CRM panel gradients.

**v1.1.1 — Start Booking restored to the lead detail (same day, after v1.1.0 was pushed).** The button was swapped out on July 8 for the temporary Confirm-Client flow (`7332eb8`) because there was no booking form to send anyone to; the WO is that destination now, so this is the documented revert. It sits back in the lead hero row next to the reg button and calls `startBooking()`: a lead **with** a `client_id` goes straight to `/calendar?newBooking=1&clientId=…&leadId=…` (which opens a WO seeded from the lead — dates, times, rate, studio, client); a lead **without** one gets the confirm-client step first, then the same redirect, so a session is never created without a real client link (that link is what makes rename propagation work).

Key subtlety: `ConfirmClientModal` is shared by Start Booking AND the status pill's Booked option, so a new **`confirmIntent: 'book' | 'status'`** state records why it opened. `'book'` redirects into the WO; `'status'` keeps the existing success modal and stays put. Without it, flipping a lead to Booked would have flung the user to the calendar.

**When the lead becomes Booked (Eli's call).** The first cut was inconsistent — a lead WITH a client went to the WO with its status untouched, while a lead WITHOUT one got marked booked on the way through `ConfirmClientModal`. Same button, two behaviours. And nothing ever wrote back from the calendar, so a linked lead stayed Hot forever even after its session was saved. Resolved as: **the lead is marked booked when the SESSION IS SAVED, never when Start Booking is pressed** — opening a WO to check a rate and backing out must not close a lead out of the pipeline.
- `WorkOrderPopup` takes an optional **`leadId`** prop; `handleClose` marks that lead `booked` (+ clears `keep_hot_until`) after the atomic save succeeds, skipping it when `session_status === 'cancelled'`.
- **Deliberately a separate write, NOT folded into `save_work_order_atomic`.** The RPC's all-or-nothing unit is the WO + line items + booking cards; a CRM status change isn't part of that unit, and a failure updating the lead must not roll back a saved session. It's `dbResult`-checked and reports without blocking.
- `calendar/page.tsx` holds `woLeadId`, set only on the lead→WO path and **cleared in `openNew`, `openEdit` and `onClose`** so an unrelated save can never mark a stale lead booked. The other four `<WorkOrderPopup>` mount sites (dashboard, wo-hub, LocationStrip, DailyOpsLogSection) pass nothing, so the guard skips.
- `ConfirmClientModal` gained **`markBooked`** (default true): true from the status pill, false from Start Booking. Its lead write is now `dbResult`-checked (it was silent).
- **Known limitation:** the lead link lives in component state for the duration of the WO session. Abandon the WO and reopen it later and the link is gone, so that save won't mark the lead — it stays in the pipeline, which is the safe failure direction. A durable fix is a `bookings.lead_id` column; deliberately not added here since Step 9 is already reshaping booking↔WO columns.

**Marking a lead Booked is deliberately NOT the same act as booking a session** — a deal often closes before dates are settled. The status-pill flow (both confirm modals) is therefore **kept**, and its three `// TEMPORARY: remove when booking form is live` comments were rewritten to say so, since they now describe permanent behaviour and a future session would otherwise delete them. The dead `showBookingToast` ("Navigate to Calendar to book this client") — declared and rendered but never set true — was removed.

**Not done / follow-ups:**
- Task detail still labels a shared task "Assigned to: Quinn" even though Isaac sees and owns it equally — accurate to the row, potentially confusing. Could render the role name for paired assignees.
- `LeadDetail`'s missing-fields warning is now the only surface for incomplete leads (that was already true; the removed tab was duplicative).
- The Seed panel still seeds one staffer (unchanged from session 2).

---

### July 28, 2026 (session 3, cont.) — v1.2.0 Part A: staff rows default to ASSISTANT

Eli's rule: most sessions run with an assistant. An engineer is the exception, asked for up front. Staff were having to downgrade 1ST → 2ND on the majority of sessions.

**Migration `20260728210000_studio_time_rows_eng_role_default_assistant.sql`** — flips the `eng_role` column DEFAULT to `'assistant'`. **DEFAULT only: no existing row is rewritten**, and every app insert sets the role explicitly, so this is purely the belt-and-braces case.

**The lead's Engineer Needed flag now actually does something.** `leads.engineer_needed` was editable in the CRM and then read by *nothing* — the calendar's lead→session conversion never selected it. It now maps to `bookings.engineer_status = 'hold'`, which is the single signal `createWorkOrderForBooking` reads when deciding the seeded role. (Reusing the existing semantic column, not a new one — new bookings already default it to `'not_needed'`, so the calendar's own "new booking" path lands on assistant with no extra work.)

**Role precedence in `createWorkOrderForBooking`:** a named engineer → 1ST; a named assistant → 2ND; nobody named but `engineer_status <> 'not_needed'` → 1ST; otherwise → **2ND**.

**Defaults flipped to assistant across every path** so the WO can't disagree with itself: `seedStudioTimeRows.buildRowPayload`, `normalizeStRow`'s fallback, `addStRow` (still inherits from the row above first — a session staffed with engineers keeps adding engineers), `addEngRow`'s default parameter, the Seed panel's role toggle, and `clearEngRow` (which previously reset a cleared row back to *engineer*, silently promoting it). The four `eng_role || 'engineer'` fallbacks in `buildBookingProjection` were flipped too — unreachable in practice, but a null role would otherwise have written the name into the 1ST card column.

**Unchanged:** the 1ST/2ND toggle still switches any row by hand, and existing WOs keep the roles they were saved with.

---

### July 28, 2026 (session 3, cont.) — v1.2.0: staffing chosen at the lead, seeded into the WO

Two related changes, shipped together because the second superseded part of the first before it was ever run.

**Part B — staffing is picked on the LEAD and auto-populates the Work Order.** `leads.engineer_needed` was a bare boolean that **nothing outside the CRM ever read** — the calendar's lead→session conversion never selected it. Staff were typing an engineer or assistant onto every studio-time row by hand.
- **Migration `20260728220000_lead_and_booking_staffing.sql`**: `leads.staff_role` + `leads.staff_name`; `bookings.staff_mode` (NOT NULL, default `'assistant'`, CHECK'd). Backfills `staff_role` from `engineer_needed`, and infers `staff_mode` for existing bookings that already name an engineer. **`engineer_needed` is now VESTIGIAL** — backfilled, unread, drop in a later cleanup.
- **Three states, because sessions have three:** `engineer` (1ST) · `assistant` (2ND, the default) · `none` (unstaffed — seeds the rows with the staff sub-row *hidden*, not blank).
- **The name is OPTIONAL.** "Engineer, TBD" is a normal state — sessions get booked before staffing settles. The role still seeds so the row reads 1ST and the rate lines are right.
- **New `components/shared/StaffPicker.tsx`** — Eng / Asst / No Staff + an optional person, used by BOTH the lead detail and the new-lead modal (one component so they can't drift). The list is the `engineers` roster filtered to the relevant pool (`role` is `Engineer | Assistant | Both`, so **Both appears in either**), but **free text is allowed** — a new hire or one-off freelancer shouldn't force an Admin detour mid-call. Roster is cached at module level (small, unchanging reference data, two mount points). Switching role **clears the name deliberately**: the previous person came from the other pool.
- **`bookings.staff_mode` is an explicit column, not more overloading.** Part A originally read the lead's flag through `engineer_status <> 'not_needed'`; that can't express "no staff", because `engineer_status` already defaults to `'not_needed'` and a calendar-made booking would be indistinguishable from a deliberately unstaffed one. `createWorkOrderForBooking` now reads `staff_mode` directly.
- **Bug found while wiring this up:** `buildRowPayload` only wrote `eng_role` inside its `if (rate or name)` block, so Part A's role choice was **silently dropped whenever nobody was named** — exactly the "engineer, TBD" case. The role is now written whenever one was asked for, independent of name/rate.
- The old `[data-eng-needed]` light-mode rule became `[data-staff-mode-on]`; "No Staff" stays neutral when active (it's the absence of a choice).

**SOP → Version History tab (same session).** `public/sop.html` gained a fifth sidebar section: the staff-facing release log. Driven by a `VERSIONS` array (newest first) rendered by `buildVersions()` into the existing step accordion — version number in the step-num slot, date as the tag, plain-English change list, and a "What this means for you" box per release. Seeded with v1.0.0 → v1.2.0. A why-grid up top explains the numbering (middle = new things, last = fixes, first = rare and big).

**Versioning scheme (Eli's call — deliberately NOT tied to the phase plan):** middle number = visible new features; last number = fixes only; first number reserved for a change big enough that staff must relearn something. What was live before this session is v1.0.0.

**Process note for future sessions: add a `VERSIONS` entry at the top of that array on every release, written for staff, not developers.** Recorded in CLAUDE.md → What's Built → SOP tab.

---

### July 29, 2026 — v1.2.1: runner PIN login provisioned + role-aware landing

**Diagnosis (from a read-only query Eli ran).** The `Studio Runner` profile existed (`role='runner'`, `runner@paramountrecording.com`) and its `staff_pins` row existed, but `auth_user_id` was **NULL** and `supabase_password` was **NULL**. One missing link, two symptoms: `/api/auth/pin` returns `no_account` (403) when either is absent, and **`scripts/set-staff-passwords.mjs` explicitly SKIPPED rows with no `auth_user_id`** — with a comment naming the shared runner as that case. So re-running the script could never fix it. The runner hub has been unreachable since PIN login shipped (July 2) for this reason.

**Fix 1 — the script now provisions, not just rotates.** `set-staff-passwords.mjs` gained a step 1: when a PIN row's profile has no `auth_user_id`, it **adopts an existing auth user with that email** (via a paged `admin.listUsers` scan — supabase-js v2 has no `getUserByEmail`; case-insensitive, since Auth lowercases emails) or **creates one** (`email_confirm: true` — a shared account has no inbox to verify), then writes `auth_user_id` back onto `user_profiles`. Only a profile with no email is now genuinely skippable. Idempotent; still the way to rotate passwords.

**Fix 2 — one PIN pad, role-aware destination** (Eli's spec: one app, one PIN screen, runners share a PIN and land on the runner page).
- `/api/auth/pin` now returns `role` alongside the tokens, read server-side with the service-role client so the browser needs no extra round trip.
- Login redirects to `/runner` for `role==='runner'`, `/` for everyone else, and **skips arming the welcome splash for runners** (the splash lives on the dashboard).
- New `landingForSession()` helper resolves the destination from `user_profiles` and is used by **all three** paths, not just the PIN one: the already-authenticated redirect (**the runner's normal daily path — reopening the installed PWA with a live session**, which would otherwise dump them on the dashboard) and the email/password fallback. Runners can read their own profile row under RLS, which is all it needs.

**Note for testing:** the runner routes have **no AuthGuard and no role gate** — access is decided purely by RLS. So an owner/manager can reach `/runner/[studio]` directly while logged in normally; the PIN is only needed for runners on the shared device. This unblocked WO testing independently of the PIN fix.

**Runner lockout (done, same session — Eli: "I def don't want any way for them to get into the main app").** `AuthGuard` now resolves the session's role and bounces `runner` to `/runner`, checked **before** authorizing render so an internal page never flashes on a runner's screen; `Nav` renders no items for `runner` as belt-and-braces for the moment before the redirect lands.

**Runner UX pass (from Eli's first real device test of the rebuilt WO):**
- **Session Notes sheet was invisible.** It was a `38vh` card pinned to `bottom:16` — precisely where the iOS keyboard appears. `autoFocus` opened the keyboard, the keyboard overlaid the sheet, and the runner saw nothing ("opens very far down… you don't see it"). Now **full-screen** (`inset: 0`) with the title and a **duplicated Save button in the header**, since the footer buttons also sit behind the keyboard. Textarea bumped to 16px (below 16px iOS zooms the page on focus).
- **Studio-time staff sub-row re-columned (Eli's layout call).** Column 1 now repeats the **date** — so a staff row still says which day it belongs to once the table is scrolled sideways and its parent row is off screen — and the **1ST/2ND initials pill moved to column 2**, the same column as the row's Notes button, so everything identifying a line sits under one heading. Pill went full-width to match the Notes button.
- **Studio name is now the hero** on the runner-hub session cards AND the dashboard daily-ops cards (`LocationStrip`): DM Serif 22/19px "Studio X" on top, artist/client demoted to the sub-line, and the duplicate "Studio X" removed from the small meta row on both. "Which room" is the first thing anyone reads off these cards and it was buried next to the times.
- **"Duplicate studio time and engineer rows" — NOT duplicated data.** Diagnosed from a live query before touching anything (a delete would have destroyed real staffing). The WO's rows were `sort_order` 0–4: studio `X` (times/rate, `eng_visible=false`), **studio `''`** (`eng_name='Liz Robson'`), studio `A` (times/rate, `eng_visible=false`), **studio `''`** (`eng_name='Kahlil Vellani'`), studio `A` (times/rate + `Sam Lorimore`, assistant). A duplicate-check query returned **zero** rows. Two independent runner-view display bugs stacked to fake it:
  1. **A blank `studio` IS the encoding for a standalone staff row** (the WO's `+ Add Engineer` / `+ Add Assistant`, added July 28 session 2). The runner table predates them and rendered each as a full studio-time line — a row of dashes directly under the real day, reading as a duplicate. Now `isStaffOnlyRow` suppresses the main row and renders the staff line alone.
  2. **The runner ignored `eng_visible`.** `rowStaffName` falls back to the WO-level engineer, so rows explicitly cleared (`eng_visible=false`) still grew a staff line — hence the same initials twice per day. Now gated on `eng_visible !== false`, matching the admin table.
- **Still open:** the studio-time table is "hard to read" generally (Eli). The column swap only dents it — 11 columns of ~9px text on a phone is the real problem. **Recommendation on record: rebuild the runner studio-time section as stacked per-day cards, not a table** (room + date as the card header, which also removes the ambiguity behind the fake-duplicate report). Awaiting confirmation of which fields a runner actually edits vs. reads.

**Architecture decision — ONE app, not a separate runner app/URL.** Verified from the RLS migration what a runner can actually reach: exactly the runner-hub tables (`bookings` read; `work_orders`/`studio_time_rows`/`rental_rows`/`payment_rows`/`expense_rows`/`equipment_condition_*` read+write; `checklists`/`daily_ops_submissions`/`petty_cash_*`/`stock_items`/`mic_*` read+write; `mics` read; `flags` insert) and **nothing** on `leads`, `clients`, `client_contacts`, `registration_tokens`, `engineers`, `qc_reports`, `srs_log`. So the CRM was never exposed — a runner hitting `/crm` got an empty page, not hidden data. The gap was cosmetic, and the fix above closes it.

Splitting into a second app was considered and **rejected**: the runner WO page and the admin `WorkOrderPopup` share the studio-time-row model, the seeding helpers and the atomic save RPCs. Forking that means duplicating the highest-risk code in the repo — exactly the defect class the July audit flagged (the drifted `calcHours` copies were producing phantom billable hours) — plus two deploys and two PWAs, to solve a UI problem. A `runner.` subdomain pointing at the same app remains available as pure DNS if the *appearance* of separation is ever wanted; it is not a security measure on its own.

