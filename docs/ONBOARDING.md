# PRSFlo — Onboarding & Architecture

**Read this first.** It exists so someone who has never seen this codebase can pick it up cold — a new developer, a future Claude session, or whoever is holding the bag if Eli isn't available.

It is deliberately opinionated about what will surprise you, because most of the cost of taking over a system is discovering the non-obvious decisions the hard way.

---

## 1. What this is

**PRSFlo** is a single-tenant studio operations app for **Paramount Recording Group (PRG)** in Los Angeles — four studio locations: Paramount (PRS), Ameraycan (ARS), Encore (ERS), Track (TRK).

It replaces a pile of fragmented tools (a WordPress calendar, QuickBooks, Gmail, spreadsheets) with one system covering: sales pipeline (CRM), client records, bookings/calendar, **work orders** (the billing document), daily studio operations, a phone-first runner hub, mic inventory, staff tasks and maintenance flags.

**Who uses it:** ~9 staff. Owners (Eli, Adam-Mike), a manager, billing, two assistant managers, two techs, and a shared **runner** account used on studio devices.

**Eli is not a developer.** He specifies in plain English, reviews on a live URL, and runs the git and SQL commands he's given. Design decisions and implementation are expected to come from whoever is doing the building. He is, however, the domain expert — when his account of how the studio works conflicts with an inference from the code, **he is right**.

---

## 2. Stack and where it runs

| Thing | Value |
|---|---|
| Framework | **Next.js 16** (App Router), React 18, TypeScript |
| Data | **Supabase** (Postgres + Auth + Storage + Realtime), project `spdiovhicftbzsopynfo` |
| Hosting | **Vercel**, auto-deploys from `main` |
| Production | `prsflow.paramountrecording.com` |
| Repo | `github.com/elismith2129/PRSFlow` (local: `~/dev/prsflow`) |
| Node | 22.x (`--env-file` support is assumed by the scripts) |
| Cron | Vercel Cron → `/api/cron/auto-demote` (09:00), `/api/cron/reset-needs-action` (15:00) |
| Backups | GitHub Action, daily 08:00 UTC → Google Shared Drive, 7 rotating files |

**Nine production dependencies.** That's deliberate. Don't add one without a reason you'd defend out loud.

**Tailwind is installed but essentially unused.** Styling is **inline `style={{}}` objects** using CSS variables from `styles/globals.css`. Do not "modernise" this without reading §5 first — there is a specific reason it's dangerous.

**Playwright is in devDependencies but there are no tests.** See §6.

---

## 3. Getting it running

```bash
git clone https://github.com/elismith2129/PRSFlow.git
cd PRSFlow
npm install
cp .env.local.example .env.local   # then fill it in — see below
npm run dev                        # http://localhost:3000
```

`.env.local` needs:

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page, **secret**. Without it PIN login fails locally — see the trap below |
| `ANTHROPIC_API_KEY` | only for `/api/ocr-receipt` |
| `CRON_SECRET` | only for the cron routes |
| `NEXT_PUBLIC_BASE_URL` | registration links; falls back to `window.location.origin` |
| `RESEND_API_KEY` | email campaigns; absent → the route returns 503 |

> **Trap that cost weeks:** local dev appeared "broken" for a long stretch because `/api/auth/pin` requires `SUPABASE_SERVICE_ROLE_KEY` and it was missing from `.env.local`. The server booted fine and login just always failed. The route now returns a clear `503 server_config` instead of failing opaquely. Vercel has the key set for Production and Preview — **those are separate stores; Vercel's values never reach your machine**, and sensitive values can't be read back out of Vercel. Get it from Supabase.

**Vercel builds a preview deployment for every branch push**, which is how Eli reviews work without a local dev server.

---

## 4. The mental model — read before touching code

These are the decisions that will confuse you if you don't know them. `CLAUDE.md` has the full, binding list; these are the four that matter most.

### The Work Order IS the booking
Not "a booking has a work order". The **WO is the source of truth** after creation. `bookings` rows are **projection cards** written *by* the WO on save (one card per consecutive-same-room run, all sharing `work_order_id`). Never treat a booking row as user-editable truth. All per-day schedule data — studios, dates, times, rates, staffing — lives **only** in `studio_time_rows`. There used to be two forms that fought each other; that was the worst structural flaw in the app and removing it was a multi-session rebuild. Don't re-add fields to the WO "top".

WO create and WO save+projection go through **atomic Postgres RPCs** (`create_work_order_atomic`, `save_work_order_atomic`). All values are computed in TypeScript; the RPCs are dumb all-or-nothing appliers of prebuilt JSON. **Never put business logic in them, and never bypass them with multi-step client writes on those paths.**

### RLS is the security boundary
Every table has Row Level Security keyed on `user_profiles.role` via `auth.uid()`. The client-side `AuthGuard` is UX only. Roles: `owner | manager | billing | asst_manager | tech | runner`. The `runner` role is granted only the runner-hub tables — it has **no access at all** to leads, clients, contacts, registrations, engineers, QC or SRS. If you're wondering "can a runner see the CRM?", the answer is no, at the database.

Privileged/public-write work goes through **service-role API routes**: `/api/register`, `/api/inquiry`, `/api/auth/pin`, `/api/ocr-receipt`, `/api/client-id-photo`, `/api/log-error`, `/api/send-campaign`, and the crons.

### Every fetch pairs with a realtime subscription
The app is used as an installed PWA where staff can't easily refresh. A one-time on-mount fetch with no `supabase.channel()` subscription is not acceptable. Channel names must be **globally unique** — duplicating one has already caused a crash. Where several surfaces need the same table, use a shared version-counter hook (`hooks/useClientsVersion.ts`, or `WebInquiryProvider`'s `leadsVersion`) rather than opening another channel.

### `/nadines` is a venue build-out tracker, not a studio feature
If you found a page about a Hollywood event venue inside a recording-studio app and assumed it was dead code or a mistake: it isn't. **Nadine's** is a multi-use performance and event venue at 6249 W Santa Monica Blvd that Paramount is building out (LADBS permit `26016-10000-03929`, A-2 assembly, 230 occupant load). It is a **separate property from the four studios** — it is *not* in `STUDIO_LOCATIONS`, has no rooms in the calendar, and generates no bookings or work orders. Nothing on it touches the CRM, calendar, WO or runner code paths.

It exists in PRSFlo because the build-out needs the thing PRSFlo already provides: staff logins, roles, realtime and RLS. Phase 1 (this) is the permit spec, the room's configurations, the tracked open items and the render plates. Phases 2+ are build-out checklists, cost/materials line items and a contractor directory — the tabs on the page are the seam they hang off.

Two things to know before editing it:
- **The spec numbers live in code, not the database** (`lib/nadines.ts`). They're a transcription of a stamped drawing, so a revision is a commit, not a form submission — the same reasoning that keeps test batches in `lib/testBatches.ts`. Only the *status* of the open items is data (`venue_open_items`, keyed by `item_key`). Never rename an `item_key` after a status has been recorded against it, or the history is orphaned.
- **Three open items must not be quoted externally until they close** — rigging capacity (1947 bowstring trusses, no point-load determination yet), courtyard capacity (the 230 load is interior only; the courtyard is a separate entitlement question) and alcohol (not entitled, active 500-ft school zone). The page flags these; the flags are there so the figures don't get lifted onto a rate sheet or sponsor deck by someone who never read the venue brief.

The page and its nav item are currently gated to **Eli's accounts only** (`srv2129@gmail.com` / `eli@paramountrecording.com`), the same gate CRM Campaigns and DEV → Errors use. That hides the surface; it is not a data boundary — `venue_open_items` RLS still allows any authenticated read.

### Money and dates are stored as text
`rate`, `food_amount`, `engineer_rate` and most dates are `text` columns. It works day to day and becomes a tax the moment you want reporting or a QuickBooks integration. Migrate when that gets close, not before. Time and currency maths must come from `lib/time.ts` and `lib/format.ts` — **never define it locally**. Duplicated copies of `calcHours` once drifted and produced phantom billable hours.

---

## 5. Landmines

Things that look safe and aren't.

- **Light mode is CSS that matches on inline-style substrings.** `styles/globals.css` has a block of `[data-theme="light"]` rules targeting things like `[style*="background: var(--surface)"]`. Change an inline style string and you can silently break light mode somewhere unrelated. **Always check both themes.** This is also why a wholesale restyle is riskier than it looks. *(Being replaced — see the next two entries.)*
- **Dark is the ABSENCE of `data-theme`, not `data-theme="dark"`.** `Nav.tsx` calls `removeAttribute`; `app/layout.tsx` only ever sets `"light"`. **A `[data-theme="dark"]` selector matches nothing in this app and fails silently** — it just never applies, so you get "my dark styles do nothing" with no error. Write dark values on `:root` and light overrides in `[data-theme="light"]`, in that order (equal specificity, so source order decides). This is inverted from how `docs/PRSFLO-DESIGN-SPEC.md` prints its CSS examples, so mentally flip every one of them.
- **Two design systems are live at once (July 30, 2026 →).** The legacy tokens (`--bg`, `--surface`, `--text`, `--accent`…) and the carved `--c-` set coexist while surfaces migrate one at a time. They are not interchangeable: `--bg` is `transparent` in the legacy light theme, `--c-bg` is warm paper. **New work uses `--c-`;** legacy tokens die individually as their last consumer moves. A page that looks "half old" is expected mid-migration — check `docs/CHANGELOG.md` v1.6.0 for which surfaces are done before reporting it as a bug.
- **Migrations are run by hand** in the Supabase SQL editor, by Eli, *before* the code that depends on them is pushed. Write them idempotent (`add column if not exists`, `create or replace`). There are 31 of them in `supabase/migrations/`; the directory is a record, not an automated pipeline. **A migration in the repo is not necessarily applied** — verify against the live DB before trusting it. This has bitten before (`leads.created_by` was recorded as present when it wasn't).
- **`.maybeSingle()` returns null when MULTIPLE rows match**, rather than erroring. This produced 299 duplicate work orders once. Use `.order('created_at').limit(1)` for single-record fetches.
- **New Supabase tables need explicit GRANTs.** Tables created before 2026-05-30 are grandfathered; new ones aren't.
- **Every important write must be checked** via `dbResult(label, error)` from `lib/db.ts` — it shows a red "NOT saved" toast and logs to `app_errors`. The July 2026 audit found ~80% of writes unchecked; silent save failure was the #1 defect class. Don't add an unchecked write.
- **Mic inventory must never be pre-filled from the previous night.** Physical eyes on every mic, every night. Pre-filling masks theft. This is a business rule, not a UI preference.
- **Day rate is a flat charge**, never multiplied by hours.
- **Tech, Tour and Open Hours sessions never generate work orders**, invoice numbers, or appear in daily ops.
- `bookings.studio` holds full room labels (`"Studio X"`, `"North"`); `studio_time_rows.studio` holds bare letters (`"X"`). They are deliberately not synced. Don't prefix `"Studio "` onto `bookings.studio` — you'll get "Studio Studio X".

---

## 6. Testing

**There is no automated test suite, by decision.** Verification is manual, on a live URL (preview deploy or production). Playwright is in devDependencies as a leftover — nothing uses it. Don't propose adding a framework without making the case explicitly; it's been considered and declined.

What exists instead:

- **`app_errors`** — first-party error sink. Crashes, unhandled rejections and failed saves land in **Admin → Errors**, which has a "Copy for Claude" export.
- **DEV → Testing** — PIN-gated (`4321`) manual test batches. Batch definitions live in **code** (`lib/testBatches.ts`), only verdicts in the DB (`test_results`), so a batch ships in the same commit as the work it covers. One batch per working session. Item ids are half the results key — **never rename one after testing starts**.
- **Error boundaries** — `app/error.tsx` and `app/global-error.tsx` catch render errors and auto-report instead of showing a white page.

---

## 7. Where to read next

| Doc | For |
|---|---|
| `CLAUDE.md` | The binding rules. Locked conventions + standing architecture rules. Read fully before your first change. |
| `docs/CHANGELOG.md` | What changed per version, with migrations and watch-outs. |
| `docs/PROJECT_LOG.md` | Why things are the way they are, and what was tried and rejected. Long, but it's the reasoning archive. Start with the Decisions Log at the top. |
| `docs/PRSFlow-Tech-Stack.md` | Where things live; feature inventory; key files table. |
| `docs/WO-SPEC.md` | The work-order model in detail. Read before touching the WO. |
| `docs/AUDIT-2026-07.md` | Independent assessment: what's sound, what's risky, the phased plan. Honest about the weak spots. |
| `public/sop.html` | Staff training guide + plain-English version history. Also what staff are told the app does. |

---

## 8. Operational access (the bus-factor section)

**No secrets in this file.** This is a map of where things are and who controls them.

| System | Where / who |
|---|---|
| **Credentials** | 🔴 **A single locked note in Eli's Mac Notes app — one copy.** This is the single point of failure for everything below. See the OPEN ITEM in §9. |
| Supabase | Project `spdiovhicftbzsopynfo`. Pro plan with PITR (point-in-time recovery). |
| Vercel | Deploys from `main`; env vars set per-environment (Production / Preview / Development are separate). |
| GitHub | `elismith2129/PRSFlow`. Actions secrets are separate from Vercel's env vars — the daily backup uses them. |
| Domain | `paramountrecording.com` — registrar Tucows/OpenSRS **via Pixelgate** (contact: Eli at Pixelgate; accounting: Evan). Direct access at `manage.opensrs.net`. |
| Backups | GitHub Action → Google Workspace **Shared Drive** (Paramount), service account `prsflow-backup@dogwood-baton-498222-r0.iam.gserviceaccount.com`. A service account has no personal Drive quota, so the target must be a Shared Drive with that account as a member. |
| Email | Resend, sending from `info@paramountrecording.com` (domain records on `send.paramountrecording.com`). |
| Payments/finance | Ramp (AP, cards, ACH contractor payments); QuickBooks (accounting, integration planned not built). |

**If you inherit this cold, in order:** get into Supabase (the data is the business), confirm the daily backup is actually running, then Vercel, then GitHub, then the domain.

---

## 9. Known unfinished work

### 🔴 OPEN — credential single point of failure (not code, highest value)

Every login for this system lives in **one locked note on one laptop**. If that machine or Eli is unavailable, the app keeps running — Vercel and Supabase don't need anyone — but **nobody can deploy, fix a bug, restore a backup, or renew the domain.** This document tells a successor exactly what to do; it cannot give them access.

**Fix:** a password manager with an emergency-contact / delayed-access feature (1Password, Bitwarden — a nominated person gains access only after an unanswered request window, so nothing changes day to day), or at minimum a shared vault with a second owner. A printed sealed copy in the studio safe is a worthwhile second channel because it survives things software doesn't. **Do not** solve it by emailing it to yourself or dropping it unencrypted in Drive.

**Related check:** if Supabase and Vercel are owned by a personal email rather than an organisation, account recovery depends on that email too — another link in the same chain. Moving to org ownership with two admins is a bigger job but removes it.

### Other open work

Live at the time of writing — check `docs/CHANGELOG.md` and the "What's Next" section of the Tech-Stack doc for the current state.

- **Step 9 of the WO rebuild:** retire `work_orders.booking_id` in favour of `bookings.work_order_id`. Seven nightly-used surfaces read the old link and must be inverted first. Fully scoped in PROJECT_LOG. Carries two extra items: a durable `bookings.lead_id`, and making a typed A&R name create a real contact record.
- `/admin` and `/wo-hub` have never had a mobile pass.
- The daily backup has never been verified end-to-end.
- `leads.engineer_needed` is a dead column awaiting removal.
- Full TypeScript `strict` is a staged goal; `noImplicitAny` is on and must stay passing (`npx tsc --noEmit`).
