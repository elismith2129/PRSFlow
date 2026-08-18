# PRSFlo — Changelog (developer-facing)

**Audience: whoever maintains this codebase next — including future Claude sessions and any developer Eli hands this to.** Staff-facing release notes live in `public/sop.html` → `VERSIONS`; they are deliberately non-technical and are NOT a substitute for this file.

## How this file differs from the other docs

Four docs, four questions. Keeping them separate is the point — a single document that tried to answer all four would answer none of them well.

| Doc | Answers | Organised by |
|---|---|---|
| `docs/ONBOARDING.md` | "I'm new — what is this, how do I run it, what will bite me?" | Read once, front to back |
| `CLAUDE.md` | "What are the rules I must not break?" | Topic (locked conventions, architecture rules) |
| `docs/CHANGELOG.md` (this file) | "What changed in version X, and what should I watch out for?" | **Version** |
| `docs/PROJECT_LOG.md` | "Why is it like this? What did we try and reject?" | **Session**, chronological |
| `docs/PRSFlow-Tech-Stack.md` | "Where does X live? What is Y for?" | Subsystem |
| `public/sop.html` → `VERSIONS` | "What changed for me, the person using it?" | Version, plain English |

**Convention:** newest first. Every entry records **migrations** (because those are run by hand and are the most common source of a broken deploy), **watch-outs** (the thing that will bite the next person), and **files touched** where it aids navigation. Detail lives here; narrative and rejected alternatives live in PROJECT_LOG.

---

## v1.13.0 — UNRELEASED (branch `redesign/carved`) — Aug 17, 2026

**Launch prep: SOPs, app-wide hints, Settings, Engineers, day-not-night.**

**Migrations: none.** Two hand-run SQL artifacts exist (NOT schema
migrations): `supabase/launch_reset_20260817.sql` — the one-shot operational
wipe at go-live (keeps CRM untouched; re-anchors `myday_duties.created_at` so
Flo starts with zero history-based red; built-in before/after verification
that must show all ✓) — and a one-liner renaming the "last night's invoices"
duty label (in PROJECT_LOG). `scripts/create-runners.mjs` creates the 10
individual runner accounts (adopt-or-create auth, role `runner`, readable
passwords, prints credentials, **emails nothing**; re-running rotates).

- **Helpful hints** — `components/ui/Hint.tsx` (`Hint`, `useHints`,
  `setHintsEnabled`) + `.c-hint`/`.c-hint-tip` in globals.css. Coach marks
  app-wide, default ON, persisted to `localStorage['prsflo-hints']`; seeded ×9
  (dashboard ×2, billing ×2, daily-ops ×2, runner hub ×2 + engineers).
- **Rail**: foot collapsed into a **Settings** disclosure (SOP, DEV, hints,
  theme, Sign Out). **Admin de-nav'd** (route alive for bookmarks; rebuild is
  a later phase). **Engineers** rebuilt at `/engineers` under Operations —
  soft skin, realtime channel `engineers-page`, `dbResult` on writes (the
  Admin copy had neither). Roster only; session history stays in Admin.
- **Runner app SOP** at `/runner/sop` (iframe over `public/runner-sop.html`);
  hub quiet register gains a live "App guide" row. The Runners-manual slot
  stays Coming soon — that's Eli's separate JOB manual, digitized later.
- **SOP design mocks**: `docs/design-refs/billing-sop.html` +
  `manager-sop.html` — chaptered, flow-first, real Flo box port (ring
  animation), real WO click-through walkthrough (billing ch. 03), oversight
  chapters (billing-from-where-you-sit, the runner's day). Ruling: all admin
  manuals visible to all admin staff; runners see only theirs.
- **Daily Ops**: queue paginated (`QUEUE_PAGE = 10`, pager only on overflow);
  sweep leads with a date hero + ‹ ›/touch-swipe day paging (replaces the
  retired ops log). Hero copy "Last night" → "Yesterday".
- **Terminology ruling: day, never night** (24/7 operation) — applied to
  daily-ops copy, `lib/dailyOps.ts` queue sub, and all three SOPs.
- **Go-live removals**: `app/(main)/preview/` + `components/dev/DeviceToggle.tsx`
  deleted; rail Runner Hub reverted to `/runner`.
- SOP `VERSIONS` updated: v1.10.0–v1.13.0 entries added (the owed set).
- **`scripts/selftest.mjs`** — run before every hand-off (CLAUDE.md →
  Commands): tsc, service-key-in-client-code, tracked env files, VERSIONS
  parse, optional `--build` (works in the Claude sandbox), plus landmine
  WARN counters with baselines (`.maybeSingle()` 25 · dead engineer_rate
  reads 2 · no-dbResult writers 23, as of 2026-08-17). Judge the delta.

**⚠ Watch-outs**

- **The launch-reset SQL wipes ALL bookings + work orders** (Eli's ruling:
  everything is test data). It is all-or-nothing; if it errors, nothing was
  deleted. Verify the end-state SELECT before letting anyone in.
- **Hints stop propagation** — a `<Hint>` inside a clickable row is safe, but
  don't wrap one in an element that needs the click to bubble.
- The duty label rename (DB seed) must be run or the My Day card and the
  manuals disagree on "last night's" vs "yesterday's".
- `/engineers` and Admin's engineers tab now coexist — edits in either are
  fine (both write `engineers`; the new page is realtime), but Admin's copy
  is scheduled to die in the Phase-B rebuild.

**Files:** `components/ui/Hint.tsx`, `styles/globals.css`,
`components/layout/Rail.tsx`, `app/(main)/{page,billing/page,daily-ops/page,engineers/page,layout}.tsx`,
`app/runner/[studio]/page.tsx`, `app/runner/sop/page.tsx`, `public/runner-sop.html`,
`public/sop.html`, `lib/dailyOps.ts`, `lib/testBatches.ts`,
`scripts/create-runners.mjs`, `supabase/launch_reset_20260817.sql`,
`docs/design-refs/{billing-sop,manager-sop}.html`,
`docs/sop-drafts/{BILLING-SOP-DRAFT,LAUNCH-ANNOUNCEMENT}.md`.
Deleted: `app/(main)/preview/`, `components/dev/DeviceToggle.tsx`.

---

## v1.12.0 — UNRELEASED (branch `redesign/carved`) — Aug 16, 2026 (second sitting)

**Day sheet final + OT-from-the-clock + the open work order goes LIVE.**
Mock-approved redesign (pair blocks, big type-or-dropdown time wells, swipe
between days), OT derived as time-beyond-agreement, and a two-way live-merge
so admin and runner see each other's saves inside the open popup.

**Migrations: none.** (`20260816120000_studio_time_rows_status.sql` is a
record of a column verified already present — running it is a no-op.)

**Day sheet (mock `runner-wo-day-sheet-final.html`, partially superseded note
in-file):** pair blocks — studio + each staffer same shape, staff times
auto-follow studio's until edited; wells accept typed times or a half-hour
▾ dropdown that opens AT the shown time; hours chip per row; >14h AM/PM
warning (warn-only, both studio + staff); swipe/chevrons between days
(approved days open 👁 view-only); billing block = flat itemized list, OT its
own line only when present, staff rate wells (office inputs, runner text).
Runner always defaults to cards; phone list inputs scoped to 30px min-height.

**OT model:** hourly runner time edits recompute `ot_hours` = actual − booked
hours (from `booking.from_time/to_time`); day-rate keeps auto past-12h.
Runner never types OT. Admin list view stays manual. The pre-approval flag
and Extend&collect from the option mocks were dropped by ruling — not built.

**Live-merge:** `wo-live-<id>` channel on work_orders + studio_time_rows +
equipment rows/notes + rental_rows + payment_rows → debounced
`refreshFromDb()`. Merge rule: adopt remote per field UNLESS the local field
differs from the load-time original (your unsaved edits win). Rentals/
payments adopt only while untouched vs snapshot. Foreground-return refreshes.
Hub pill now shows Not submitted / Submitted / Approved (Completed outranks);
hub listens to studio_time_rows.

**⚠ Watch-outs**

- **The live-merge callbacks read ref mirrors** (`dirtyFieldsRef`,
  `openNoteKeyRef`, `loadingRef`) because the channel closes over
  first-render state. If you add state the merge must respect, mirror it —
  reading the state var directly will silently use a stale value.
- **`originalStRowsRef` is the merge baseline.** Anything that mutates
  stRows outside updateStRow must leave it coherent, or per-field "dirty"
  detection lies. After every successful save it is re-baselined along with
  `paySnapRef`/`rentSnapRef`.
- **Runner OT auto-derive keys off `booking.from_time/to_time`** — live, not
  snapshotted. An office schedule edit moves the OT baseline for later runner
  edits. Accepted for v1; per-row included-hours is the upgrade if it bites.
- Same field edited both sides before either saves: last save wins (stated
  to Eli, accepted).
- **Files:** `components/calendar/WorkOrderPopup.tsx`,
  `app/runner/[studio]/page.tsx`, `hooks/useReloadOnReturn.ts` (+5 runner
  pages), `lib/format.ts` (`longDate`), mocks ×3, `docs/SOP-REWORK-BRIEF.md`.

---

## v1.11.0 — UNRELEASED (branch `redesign/carved`) — Aug 16, 2026

**The runner work order IS the admin work order.** `WorkOrderPopup` gains
`mode="runner"` (field-level locks, Submit as the terminal act) and a
list ⇄ cards view toggle for everyone; the 1,595-line runner WO page becomes a
136-line wrapper. Runner-facing copy now tracks the clock (24/7 operation).

**Migrations: none.** But **verify `studio_time_rows.status` exists in the
live DB** (`select status from studio_time_rows limit 1;`) — Submit writes it.
The column shipped with the old Finish flow and is documented in CLAUDE.md,
but per the July 17 / Aug 14 lesson, verify the end state before trusting it.

**What runner mode does** (spec §15 + Eli's corrections; mock
`docs/design-refs/runner-wo-views.html`):

- Forces the phone layout (`isMobile = raw || runner`); overlay starts at
  `top: 0` (runner routes have no Nav).
- Session Info card = the locked top ("Set by the office") + A&R `tel:` pill +
  "Balance due" chip. The editable META/client panel never renders.
- Rates are read-only TEXT (list cells, eng sub-row, sheet billing block);
  `updateStRow` also strips `rate`/`rate_daily`/`ot_rate`/`eng_rate`/
  `row_rate_type` in runner mode as defence in depth.
- `admin_locked` rows render inert (`pointerEvents: none` — note the lock and
  delete cells' own `pointerEvents: 'auto'` had to be runner-gated or they
  punch through the parent's `none`).
- Hidden for runners: batch edit, seed panel, add/delete rows, date pickers,
  lock toggles, Complete WO. Present: times, staff (name + 1ST/2ND), OT
  hours, equipment pills, song titles, payments, rentals, both notes, NA
  photos (upload ported — immediate write), COD signature, totals.
- **Submit footer**: same atomic save (`handleClose(false)`), then today's
  dated rows → `status='submitted'`. Re-opens stay editable; the button
  becomes "Update submission". Only office approval locks a day.
- Flag sync (needs-attention note ⇄ `wo_flag` raise/update/resolve) runs
  inside every successful runner save, not just Submit.
- Runner mode is **adopt-only** in `initWO` — the create-fallback is gated.
- Live missing-times warning (warn-only) ported from the old page; the
  eng-rate and duplicate-staff warnings are hidden in runner mode (rates are
  locked there — a banner naming an unfixable problem trains people to
  ignore banners).

**View toggle (both modes):** list = the §16/§18 day blocks, unchanged;
cards = one day per card, tap → bottom day sheet (start / end / OT /
engineer / song title / equipment; admin gets rate inputs in the sheet).
Defaults decided once per open: phones cards ≤3 distinct days else list;
desktop always list.

**24/7 copy:** `dayPart`/`dayPartLabel`/`dayPartPossessive` added to
`lib/time.ts` (4–12 morning · 12–17 day · else night). Used by
`app/runner/page.tsx` ("Where are you this morning?"), the hub's duties
label, shift-notes headings, and the punch form's shift button.

**⚠ Watch-outs**

- **`StRow.status` is state-only.** It is deliberately NOT in `stPayloads`,
  so the atomic save can never clobber a submitted/approved status. If you
  add fields to the save payload, do not add `status`.
- **Old runner-WO deep links still work** (`/runner/[studio]/wo/[id]` and
  `?booking_id=` both resolve), but the page no longer has its own realtime
  re-fetch — it inherits the popup's LOCAL-FIRST model (subscribes to
  `work_orders` status only). That is the standing WO-popup exception to the
  realtime rule, now covering the runner too.
- **Runner saves ride `save_work_order_atomic` + the booking projection** —
  the deliberate unification. A runner's Save/Submit now writes booking
  cards. The Aug 16 test batch exists to shake this path down.
- The Aug 14 claim that expenses/receipt OCR would make the shared component
  grow was stale — nothing references `expense_rows` or the OCR route
  anywhere; they were already gone from the runner page.
- SOP `VERSIONS` owed at merge now covers v1.9.1 + v1.10.0 + v1.11.0.

**Files:** `components/calendar/WorkOrderPopup.tsx` (+~700),
`app/runner/[studio]/wo/[id]/page.tsx` (1,595 → 136), `lib/time.ts`,
`app/runner/page.tsx`, `app/runner/[studio]/page.tsx`,
`app/runner/[studio]/shift-notes/page.tsx`, `app/runner/punch/page.tsx`,
`lib/testBatches.ts`, mock `docs/design-refs/runner-wo-views.html`.

---

## v1.10.0 — UNRELEASED (branch `redesign/carved`) — Aug 14, 2026

The runner subtree becomes a real product (tasks, punches, shift logs, one
landing, whole-surface port), `/daily-ops` lands as the studio manager's
morning, and **the July 2 RLS lockdown is made real** — it had never actually
taken effect in the live database.

**Migrations — run by hand, in order:**

| File | What |
|---|---|
| `20260814120000_studio_tasks.sql` | `studio_tasks` — per-STUDIO tasks (no assignment; runners rotate). RLS any-authenticated, realtime. |
| `20260814130000_drop_legacy_open_policies.sql` | **The important one.** Dynamically drops every `public` policy whose `qual`/`with_check` is literally `true`, except a five-table allowlist. Then **re-run `20260702161117_rls_security_hardening.sql` in full** (idempotent) and verify with the query in the file header. |
| `20260814150000_punch_correction_requests.sql` | HR-SPEC §5 punch table + `set_punch_report_class()` trigger (same-day vs late is derived server-side, never client-chosen). No DELETE policy — it is a legal record. |
| `20260814160000_shift_logs_and_reviews.sql` | `shift_log_entries` (append-only; no UPDATE/DELETE policies by design) + `daily_ops_reviews` ((date, item_key) "seen" markers). |

**⚠ Watch-outs**

- **RLS was not in effect before this release.** `20260702161117` created the
  tiered policies but only dropped the five legacy `Public access` ones it
  named; ~40 older open policies survived, including `user_profiles` open to
  **anon**. Policies are PERMISSIVE and OR together, so one open policy voids
  the whole model. After running the drop migration, **re-run the July 2
  hardening and then verify against `pg_policies`** — a migration having run
  is not evidence it achieved its goal.
- **The five deliberately-open tables** are `app_feedback`,
  `dashboard_task_comments`, `studio_tasks`, `test_results`,
  `venue_open_items`. Anything else appearing in the verify query is a
  regression.
- **`SessionCardBody` gained a `large` prop.** Opt-in only — omit it and
  calendar/dashboard output is byte-identical. Do not make it the default.
- **`daily_ops_reviews` item keys are load-bearing** (`missing:<studio>:<duty>`,
  `mic:<studio>:<id>`, `note:<id>`). Renaming one orphans its cleared state.
  Flags are NOT marked here — a flag item clears by acknowledging the flag.
- **Punch form and shift-log authorship still take typed identity** while the
  shared runner login exists. The punch form refuses that login outright
  rather than filing an unattributable record; it self-enables when individual
  runner accounts are created.
- **TEMPORARY, remove at go-live:** `app/(main)/preview/`,
  `components/dev/DeviceToggle.tsx`, and the rail's Runner Hub entry pointing
  at `/preview?path=/runner&device=phone` (revert to `/runner`).

### What shipped

- **Runner hub additions (spec §15b, option A):** `studio_tasks` section above
  sessions with tap-to-complete; quiet bottom register (punch, manual).
  Session cards now render the SHARED `SessionCardBody` — same status colours,
  COD strip, invoice and staff tags as the calendar, at `large` size.
- **Missed punches (HR-SPEC §5):** `/runner/punch` (form + personal 90-day
  record, colour-banded) and `/punches` for managers — queue with
  approve/adjust/reject, an "Enter in ADP" list with the auto-composed comment
  + copy, and per-person counts (**counts, not points**; percentages wait for
  scheduling). Shared helpers in `lib/punches.ts`.
- **Shift logs:** `/runner/[studio]/shift-notes` — append-only entries per
  studio per night, multiple authors, replaces the Slack post.
- **`/daily-ops` (spec §19):** queue left (flags, absences, missing mics,
  notes; tap to clear; "Yesterday is done" when empty) + studio-task manager
  beneath; 2×2 studio sweep right with shift-log popup; night pager. Data
  layer `lib/dailyOps.ts`.
- **One-landing `/runner`:** remembered studio skips the picker, header
  switcher pills, `?choose=1` returns and un-remembers. Picker ported to soft
  skin.
- **Soft-skin port of the remaining runner pages** (checklists, mics, petty
  cash, stock) — surface only; queries, `dirtyRef` realtime guards, instant
  saves and flag-raising untouched.
- **Office-only `AdminReturn` bar** across `/runner/*` so admins can use the
  hub and get back; renders nothing for runners and the public.
- **Rail regrouped:** Dashboard · Calendar · My Day, then Business, then
  **Operations** (Daily Ops, Runner Hub, Mic Inventory, Tasks, Flags,
  Nadine's). "Studio" group retired.
- **Fixes:** dashboard room cards no longer change height with content (booked
  120 / empty 76 → uniform); day nav moved onto the sessions title row; CRM
  lead-panel double padding trimmed and date inputs unpinned from `width: 92`
  (they were clipping inside an already-wide well).

**Files:** `app/runner/page.tsx`, `app/runner/[studio]/{page,shift-notes,mics,petty-cash,stock,checklist/[type]}/…`,
`app/runner/punch/page.tsx`, `app/runner/layout.tsx`, `components/runner/AdminReturn.tsx`,
`app/(main)/{daily-ops,punches,preview}/page.tsx`, `app/(main)/page.tsx`, `app/(main)/crm/page.tsx`,
`app/(main)/layout.tsx`, `components/layout/Rail.tsx`, `components/calendar/SessionCard.tsx`,
`components/dev/DeviceToggle.tsx`, `lib/{punches,dailyOps}.ts`, four migrations,
`docs/PRSFLO-DESIGN-SPEC.md` (§15b, §19), `docs/design-refs/{runner-hub-additions,admin-runner-hub-options,daily-ops-final}.html`.

---

## v1.9.1 — UNRELEASED (branch `redesign/carved`) — Aug 13, 2026

**The work order PDF becomes the work order**, v1.9.0's flagged open item. Plus a
blank fillable form, five real bugs found by tracing the admin workflow end to
end, and the first rulings of the runner redesign.

**Migrations — run by hand, in order:**

| File | What |
|---|---|
| `20260813120000_wipe_stale_packages.sql` | Nulls `invoice_package_path` on every work order. The snapshots taken before the PDF rebuild are faithful copies of a document we replaced. **Run AFTER deploying**, or a download in the gap writes a fresh stale one. |
| `20260813130000_dedupe_staff_rows.sql` | One-off clean-up: standalone staff rows duplicating a studio row's staff on the same day. Step 1 lists, step 2 deletes. |

**⚠ Storage files cannot be deleted from SQL.** Supabase's `storage.protect_delete()`
trigger rejects `delete from storage.objects` (42501). The wipe migration clears
POINTERS only; the orphaned objects stay in the private `invoices` bucket,
unreferenced and unreachable. Removing them needs the Storage API.

### What shipped

- **`lib/woPdf.ts` rebuilt as a section-by-section replica of the WO screen** —
  same twelve studio-time columns, engineer sub-rows, rentals, session notes,
  payments, six totals, COD terms + signature. Verified by rendering and
  inspecting, not by compiling: that caught engineer sub-rows never drawing,
  clipped columns, and every table's header rule striking through its first row.
- **Session Info WRAPS and grows the row, with no line limit.** The one place the
  PDF deliberately differs from the screen, and it differs by showing MORE — the
  screen truncates into a popover, and paper has no popover.
- **Internal fields are STRIPPED from the record before drawing** (`INTERNAL_ONLY`),
  not merely omitted from the layout. Booking Notes and Needs Attention can no
  longer leak by someone adding a field to a section.
- **Blank work order** — `/api/wo-package?blank=1`, behind a page-level `⋯` on
  `/billing`. 188 real AcroForm fields, so it can be typed into or printed and
  filled by hand. Creates nothing, stores nothing.
- **Invoice pages come FIRST, work order behind** — AP opens it to pay a bill.
- **Studio column prints `PRS A` / `TRS North`**, from the new shared
  `lib/studios.STUDIO_SHORT` + `roomCode()`. Track is **TRS**, not TRK; three
  private copies of that map were deleted.

### Bugs found by tracing the workflow

- **A drifted invoice could never be approved.** Approving set `approved` (step 3);
  `deriveStep` immediately demoted it to 2 because `invoice_total` still held the
  old figure. The button appeared dead forever. `approveInvoice` now re-snapshots
  `invoice_total` — which is what approval means.
- **Complete WO never saved or closed**, despite a comment claiming it did since
  Aug 11. It now saves, stamps, closes — and will NOT stamp if the save failed
  (`handleClose` returns a boolean now).
- **Four fields never marked the WO dirty** (session notes, print name, needs
  attention, signature), so Complete WO stayed greyed after editing them.
- **Equipment condition only worked on day one.** Rows are seeded at WO creation
  for the dates the booking had THEN; later days had no row and the buttons were
  gated on `row &&`. First tap now creates it. That write was also unchecked.
- **Double-clicking a row button opened the work order** behind it.
- A billing row whose booking was deleted did nothing on double-click, silently.
- Mobile still offered `Re-open WO`, removed on desktop in v1.9.0.

### Two new warnings on the work order

- **Engineer line with hours and no rate** → will bill $0. **Engineers only** —
  assistants are never rated, and warning on them would fire on most sessions.
- **The same person on two lines for one day** → will be charged twice. Found in
  live data (WO-1018, 29–30 July, both at the retired $55). `+ Add Engineer`
  pre-fills the previous staff line, so pressing it on an already-staffed session
  makes an exact duplicate.

### Design rulings (spec)

- **§15 Runner hub = Day card.** Built: `/runner/[studio]` ported to soft skin.
  The work order page is NOT built yet.
- **§16 Studio Time = day blocks**, zebra retired. **§16c table chrome is TEXT,
  not bars** — headers and footers lose their fill, subtotals get a result chip,
  only entries are filled and rounded. §16b (round every strip) is superseded,
  kept for its reasoning.
- **§17 the pipeline IS the title** on `/billing` — Billing and COD both live in
  the heading with live counts; COD's goes hot on a balance. The top-right pill
  switch and `.c-bsegdot` are gone.
- **§18 equipment condition lives IN the studio day** — a third line per day
  block, one pill per item, **tap cycles blank → OK → Not OK → OK …** and never
  returns to blank (blank means nobody has answered; a third tap must not
  destroy that). The separate date-column table is DELETED.

### Later the same day — the design pass

- **Section headers are text app-wide.** `.c-lozenge` lost its fill. Three rules
  depended on that fill and broke silently: the count badge inverted against it
  (so it vanished), the action link took the bar's contrast colour, and
  `SectionHeader` also carries `.c-anchor`, whose drop shadow became a smudge
  under bare text. All three fixed in the same change.
- **WO meta row:** PO # widened and moved beside Inv #; the "PO req'd Yes/No"
  segment is gone — **the PO field answers its own question** with a `Not req'd`
  chip inside the well. Food stopped being a Yes/No that reveals a box and is
  now just an amount; `food_budget` is derived from it.
- **The WO header stays put while the body scrolls.** `position: sticky` was
  already on it and could never work: `.c-sheet` carries `overflow: hidden`, so
  the SHEET was the sticky scrollport. The sheet is a flex column with an
  overflowing body now, matching what mobile already did.
- **One action bar** — Cancel · Complete WO · Save. The title bar's Cancel/Close
  pair is gone (it sat directly above a second row with the same two words), and
  `Close` is renamed `Save`. `Save & download` stays only on read-only WOs.
- Column headers now match section headers (Inter 800, `--c-fg` at 45%).
- Billing: list header shows a COUNT ONLY; the package window's Work order /
  Invoice toggle is centred; the search bar matches `.c-input` geometry.

### Watch-outs from the design pass

- **`.c-sheet button:not(…)` / `.c-panel button:not(…)` will eat a new pill.**
  Those scoped defaults give any raw `<button>` carved padding, its own
  background and a raised shadow, and they out-specify a plain class. `.c-eqpill`
  and `.c-poreq` rendered oversized with no status colour until they were added
  to the `:not()` list — **any new in-sheet control must be added there too.**
- **An unclassed `<input>` inherits a sunken box** from the global input rule
  (`input:not(.c-input)` gets an inset shadow). That produced both the "box in a
  bubble" on the billing search and the pale field boxes in `ClientPanel`. A
  wrapper-styled field needs `box-shadow: none` or the `.c-tin` class.
- **Studio Time is a scroll box, not paginated** (`maxHeight: 420`). With
  equipment the day block is ~86px, so ~5 days are visible; Eli wants ~8, which
  means ~690px. **Not changed** — it also decides how much screen the table takes
  before rentals and payments.
- `fmtDate` and `sessionDates` were deleted with the equipment table.

### Watch-outs

- **`bookings.engineer_rate` is DEAD. Do not read it.** Nothing writes it since
  the booking form was deleted. Five surfaces still did, so the WO screen showed
  engineer charges that billing and the invoice would never bill. All removed,
  and `woTotals.fallbackEngRate` is gone.
- **The blank PDF is safe while it is a FORM.** If one gets filled in for real
  paid work, that job never enters AR. That is the signal it needs a real session.
- `lib/woPdf.ts` and the WO screen remain two descriptions of one layout. A new
  PRINTABLE section must be added to both; a `data-no-print` one to neither.
- `/wo/[id]/print` is **actually deleted** now. CLAUDE.md had claimed so since June
  while the route still shipped.
- `.claude/worktrees/` is an abandoned June copy of the app — gitignored, skipped
  by tsc (dot-folder), harmless where it sits, but it pollutes every grep. See
  ONBOARDING §5.

**Files:** `lib/woPdf.ts`, `lib/billing.ts`, `lib/woTotals.ts`, `lib/woValidation.ts`,
`lib/studios.ts`, `app/api/wo-package/route.ts`, `app/(main)/billing/page.tsx`,
`app/(main)/page.tsx`, `components/calendar/WorkOrderPopup.tsx`,
`components/shared/StudioSelect.tsx`, `app/runner/[studio]/page.tsx`,
`app/runner/[studio]/wo/[id]/page.tsx`, `styles/globals.css`, `CLAUDE.md`,
`docs/ONBOARDING.md`, `docs/PRSFLO-DESIGN-SPEC.md`, three new files in
`docs/design-refs/`. Deleted: `app/wo/[id]/print/`.

---

## v1.9.0 — UNRELEASED (branch `redesign/carved`) — Aug 11–12, 2026

**THE BILLING HUB replaces `/wo-hub` AND the Dropbox invoice-filing system**, and the
work order becomes a real generated PDF. Designed in `docs/design-refs/billing-hub-v2.html`
(v2 — `billing-hub-final.html` is STALE and carries a banner saying so; do not port from it).

**Migrations — run by hand, in order:**

| File | What |
|---|---|
| `20260811120000_billing_hub.sql` | Invoice lifecycle on `work_orders` (`invoice_state`, closed/approved/sent/paid stamps, `invoice_doc_path`), private `invoices` bucket + policies, owners-only `enforce_invoice_approver` trigger |
| `20260811130000_billing_needs_invoice.sql` | Widens the `invoice_state` CHECK to include `needs_invoice` |
| `20260811140000_billing_invoiced_total.sql` | `invoice_total` — the snapshot that makes drift detectable |
| `20260811150000_billing_no_po_needed.sql` | `no_po_needed` on the WORK ORDER. Supersedes `clients.requires_po`, which is now DORMANT (kept, commented, unread) |
| `20260811160000_billing_downloaded_at.sql` | `invoice_downloaded_at` — download and send became two acts |
| `20260811170000_billing_package_snapshot.sql` | `invoice_package_path` — the merged PDF exactly as it went out |

**New dependency:** `pdf-lib` (creates AND merges; no headless browser). In `package.json`
and the lockfile, so Vercel installs it — nothing to run by hand.

### What shipped

- **Two pipelines, not one.** `Billing` (assemble → approve → send → chase → paid) and
  `COD` (money is in → check it → done) get a toggle. Four tabs / three tabs, replacing v1's
  nine. COD's side leads with **Balance due**, and the toggle carries a hot dot whenever one
  exists so a missed collection is visible from the billing side.
- **Three derived lights per row** — `Reviewed › Invoiced › Approved` (COD shows two).
  The rungs v1 modelled as four separate tabs are one package being assembled.
- **Drag a QuickBooks PDF onto a row** to attach it; the work order routes itself.
- **Approval is owners-only** (UI + Postgres trigger) and is GATED: reviewed + invoiced +
  PO sorted. A blocked Approve renders greyed with `AWAITING PO` in the flag column.
- **Awaiting-PO is DERIVED**, from the work order's `po_number` / `no_po_needed`. It was a
  stored state in v1.
- **Download and Mark sent are two acts.** PRSFlo builds the file; a person emails it. A
  package built but not marked sent for 2 days goes hot on the row AND on the tab count.
- **`/api/wo-package`** draws the work order as a black-and-white PDF (`lib/woPdf.ts`) and
  staples the invoice's pages on. Accepts an image attachment as a page. Stores the exact
  bytes it served so the package window can show the ARTIFACT, not a re-render.
- **`window.print()` and the ~90-line print stylesheet are DELETED.** One generator, so the
  work order's layout is described in one place.
- **Work order footer:** `Close & Save` → `Close` (prompts only when something changed);
  `Complete WO` saves and closes and greys out until there IS a change; `Print` gone;
  `Export PDF` → `Save & download`. **`Re-open WO` was removed.**
- **Editing an approved package voids the approval** (derived, not written) — but NOT once
  sent, where the drift flag plus a deliberate Pull it back is the honest path.
- Double-click a row to open it. Date range + rooms on the line. 20 per page on In progress.

### Watch-outs

- **The PDF layout is NOT finished.** It is a generic invoice, not a replica of the work
  order screen. Eli's ruling: two versions only — the digital WO and a flat black-and-white
  exact representation. **Rebuilding `lib/woPdf.ts` against the WO screen is the next job,
  and any `invoice_package_path` snapshots taken before it ships must be wiped**, or a test
  download will masquerade as a record of what a client received.
- **`lib/woPdf.ts` and the WO screen are two descriptions of one layout.** Row data flows
  through automatically; a whole NEW SECTION added to the screen will silently not appear in
  the PDF. Add it in both.
- Approving cannot be bypassed client-side — the trigger fires on ANY change to
  `invoice_approved_at`/`_by`, in either direction, so billing cannot strip an approval.
- `/api/wo-package` verifies the caller's token AND role before the service-role client
  reads anything. A work order id alone must never be enough.
- The route needs `SUPABASE_SERVICE_ROLE_KEY` in **Preview** as well as Production.
- Blocks (Tour/Tech/Open Hours) and tentative/cancelled sessions are filtered out
  **only before the pipeline** — once a WO has an `invoice_state` it stays visible, so
  cancelling a session can never make a sent invoice vanish from AR.
- **Do not do text-range surgery on `app/(main)/billing/page.tsx`.** Two edits this session
  cut more than intended (the PO removal deleted the package and ⋯ modal render blocks).

**Files:** `lib/billing.ts`, `lib/woPdf.ts`, `lib/woTotals.ts`, `lib/woValidation.ts`,
`app/(main)/billing/page.tsx`, `app/api/wo-package/route.ts`,
`components/calendar/WorkOrderPopup.tsx`, `components/layout/Rail.tsx`, `styles/globals.css`,
`docs/design-refs/billing-hub-v2.html`, `docs/AR-SCOPING.md`.

---

## v1.8.0 — UNRELEASED (branch `redesign/carved`) — Aug 10, 2026

**MY DAY — the operational duties layer goes live.** Built from `docs/MYDAY-BUILD.md`.
Replaces the `FLO_STATIC` / `MYDAY_STATIC` / `DGRID_STATIC` placeholders the v1.7.0 frame
shipped with. Also two extractions from the work-order screen that were prerequisites.

**Migrations — run by hand, in order:**

| File | What |
|---|---|
| `20260810120000_myday.sql` | The four tables + seed: `myday_duties`, `myday_entries`, `myday_queue_steps`, `myday_notes`. RLS, explicit GRANTs, replica identity, publication. |
| `20260810130000_myday_anyday_duties.sql` | Adds `always_available`; valley checks + office stock → `cumulative`. |
| `20260810140000_myday_day_scoped_duties.sql` | Reverses `always_available` for those two (same day). |
| `20260810150000_myday_retire_create_wos.sql` | Retires `bil_create_wos`. |
| `20260810160000_myday_retire_calendar_lookahead.sql` | Retires `mgr_calendar_lookahead`. |
| `20260810170000_myday_srs_roundup.sql` | Adds the monthly SRS round-up for billing. |

**What shipped**

1. **`lib/myday.ts`** — duty fetch/complete, backlog, the five computed queues, the
   14-day grid, and `composeBriefing` (template sentences over real numbers, **no AI**).
2. **Dashboard** — My Day card, Flo briefing and staff grid all live. View-as gained a
   third option: `eli | fernando | aaron`, where **`eli` is oversight and has no duty
   card** (duties are scoped to manager + billing). Toggle labels come from the roster.
3. **`/my-day`** — the Workbench page (`docs/design-refs/my-day-final.html`). Rail entry
   under Dashboard, gated to owner/manager/billing.
4. **`lib/woTotals.ts`** — WO money math extracted from `WorkOrderPopup`'s derived-totals
   block so the balances queue can reuse it. Behaviour-preserving.
5. **`lib/woValidation.ts`** — session + staff times required before **Complete WO**
   (admin, blocks) and warned about on the runner WO page (**warns, never blocks**).
   Staff times now mirror session times on newly added rows.

**WATCH-OUTS**

- **Seed migrations rewrite themselves on every run.** `20260810120000` upserts with
  `ON CONFLICT DO UPDATE`, so any hand-tweak to a seeded duty MUST also be written back
  into that file or a future replay silently reverts it. This bit twice in one session.
  `is_active` is deliberately excluded from the update list — that is what makes
  "retired" survive a replay.
- **Retire duties, never delete them.** `myday_entries` FK to `myday_duties`; a delete
  cascades the completion history away. Set `is_active = false`.
- **`captured` is jsonb, not the specced `captured_count numeric`** — the billing COD duty
  captures three figures. Single-capture duties are a one-key object.
- **Monthly duties are STICKY** (`STICKY_CADENCES` in `lib/myday.ts`): they stay on the
  card past their due date and escalate, and they **skip the backlog tally** — the 30-day
  scan can only reach one prior monthly occurrence, so the count was arbitrary.
- **Every retrospective judgement is bounded by `duty.created_at`** (`dutyExistedOn`).
  Without it, day one of My Day reports a month of misses for everyone.
- **`fetchBillingBrief().paymentsReceived` counts PRSFlo payments only.** Anything zeroed
  straight into QuickBooks never touches `payment_rows`. The UI carries a footnote saying
  so; remove it only when QBO lands.
- **Staffing derives from `studio_time_rows.eng_name`, not `bookings.engineer_name`** —
  the booking columns are a projection and can be seeded while no real name is on a line.
- **Do not name an inline-`onclick` handler after a DOM property.** A mock's toggle named
  `role()` silently read the button's ARIA `role` instead. Cost 20 minutes.

**Files:** `lib/myday.ts` · `lib/woTotals.ts` · `lib/woValidation.ts` ·
`app/(main)/my-day/page.tsx` · `app/(main)/page.tsx` · `app/runner/[studio]/wo/[id]/page.tsx` ·
`components/calendar/WorkOrderPopup.tsx` · `components/layout/Rail.tsx` · `styles/globals.css` ·
`docs/MYDAY-BUILD.md` · `docs/AR-SCOPING.md` (new) · `docs/design-refs/my-day-options.html`,
`my-day-final.html` (new) · six migrations above.

**Known-not-done:** `quarterly` cadence (needs a month+day `due_days` shape — add with the
first real quarterly duty). Backup does not cover Supabase storage — see
`docs/AR-SCOPING.md` §6, a prerequisite for the AR work.

---

## v1.7.0 — UNRELEASED (branch `redesign/carved`) — Aug 7–10, 2026

**The §14 frame + the SOFT skin.** One working session (Cowork, single chat — the F/O
relay is retired per BUILD-HANDOFF). Six pieces:

1. **Side nav rail replaces the top nav app-wide** (`components/layout/Rail.tsx`, slimmed
   to 176px; `NavGate` now renders it; `app/(main)/layout.tsx` wraps everything in
   `.c-frame`). Mobile = 52px top bar + hamburger drawer. Theme toggle + Sign Out live in
   the rail foot. `Nav.tsx` is dead but not deleted.
2. **Placeholder pages** so every rail link resolves: `/daily-ops`, `/punches`, `/hiring`,
   `/training` (`PlaceholderPage.tsx`); `/flags` + `/mic-inventory` are thin hosts for the
   existing admin sections.
3. **Command-row dashboard** (`app/(main)/page.tsx` rebuilt): PIPELINE indicator (count +
   heat breakdown + solid-hot pulsing "N NEW INQUIRIES" bar) + 4 studio cards with session
   counts · console = Flo box (static briefing, Aurora ring — the app's only glow) → My Day
   (static stub) side-by-side with My Tasks (LIVE, personal — name tabs shelved, logic kept
   in `lib/tasks.ts`) · staff 14-day grid (static stub) + Flags indicator · 12-room
   sessions pane (incl. PRS · Nadine's, display-only). **LocationStrip retired** — its
   drawer (ops approvals) is only in Admin until the Phase B Daily Ops page.
4. **Density law (spec §2b):** compact primitives site-wide (wells 32px, rows one-line,
   trimmed paddings), CRM lead rows single-line with metadata right, lead profile fits one
   viewport, page gutter/panel padding trimmed.
5. **SOFT SKIN replaces carved (spec §7c):** one override block at the END of
   `globals.css` — surfaces are flat raised (`--c-srf` + `--c-softsh`), holders are wash
   fills, no inset anywhere. **Delete that block and carved returns.** Flo ring untouched.
6. Polish: WO tables get wash gutters + `.c-tin-show` persistent field chips on
   rentals/payments; client card fields bare + bigger; COD lead card packs like billing;
   session grid auto-stacks on narrow panels; calendar `height` → `maxHeight` (kills the
   dead black slab below the last row — stale top-nav math).

**Migrations:** none. **Watch-outs:** (a) the soft block must stay LAST in `globals.css` —
anything appended after it can re-fight the input-in-well specificity war (see the "NO
BUBBLES IN BUBBLES" comment); (b) dashboard My Day / Flo briefing / staff grid are FAKE
static content until the HR layer — don't let staff read them as real; (c) `--bg`-era
`.c-nav*` CSS and `Nav.tsx` are dead law awaiting deletion; (d) `useIsMobile` is
desktop-first, so phones paint the desktop rail for one frame.

**Files:** `styles/globals.css`, `components/layout/{Rail,NavGate,PlaceholderPage}.tsx`,
`app/(main)/{layout,page}.tsx`, `app/(main)/{daily-ops,punches,hiring,training,flags,mic-inventory}/page.tsx`,
`app/(main)/{crm,calendar}/page.tsx`, `components/calendar/WorkOrderPopup.tsx`,
`components/shared/ClientPanel.tsx`, `docs/PRSFLO-DESIGN-SPEC.md`, mocks in `docs/design-refs/`.

---

## v1.6.2 — HOTFIX to `main` — Aug 6, 2026

**New-inquiry email alert.** `lib/sendMail.ts` (new) + `app/api/inquiry/route.ts` +
`app/api/send-campaign/route.ts`. The inquiry form used to live on Squarespace and emailed
the team, so a new lead arrived as a phone notification. Moving it into PRSFlo removed that
— the lead lands in the CRM and nothing tells anyone. Every web inquiry now also emails
`info@paramountrecording.com`, with `reply_to` set to the customer.

Plain `fetch` to the Resend REST API — no npm dependency. The verified sender was a private
const inside `/api/send-campaign`; it is now `MAIL_FROM_DEFAULT` in `lib/sendMail.ts` and the
campaign route imports it.

Cherry-picked from `redesign/carved` (`2061487`) to `main` as `95dfe98`.

**Migrations:** none.

**Env:** `RESEND_API_KEY` (required — **was never actually set in Vercel until now**, so
email campaigns had never worked either). `MAIL_FROM` and `INQUIRY_ALERT_TO` are optional
overrides; both default in code.

**Watch-outs:**
- **The send is after the insert and its result is deliberately ignored.** A lead that saved
  without an email is a missed notification; a lead lost because mail was down is a lost
  customer. Do not make the mail result gate the response.
- **It is `await`ed, not fire-and-forget.** A serverless function can be frozen the moment it
  returns, so a dangling promise may never run.
- `sendMail` returns `{ok:false}` rather than throwing when `RESEND_API_KEY` is absent, so
  local dev and preview deployments keep working with mail simply skipped.
- Resend requires the sending domain to be **verified**, which is a DNS step outside this
  repo. An unverified domain fails with 403.

---

## v1.6.1 — HOTFIX to `main` — Aug 6, 2026

**Runner sign out.** `app/runner/page.tsx`. The PIN login mints a real Supabase session, but
`/runner/*` sits outside the nav by design and `Nav.tsx` was the **only** place in the app
that called `supabase.auth.signOut()`. A phone signed into the Runner PWA was signed in
permanently: the installed app starts at `/runner`, and `/login` redirects already-authenticated
users to `/`, so there was no route out. Sign Out now sits under the studio cards on the
Runner Hub landing — reachable from anywhere in the subtree via the ← on a studio hub.

Cherry-picked from `redesign/carved` (`84a2ceb`) to `main` as `4b74ae2`. **The only commit
from the redesign branch that has gone to production.**

**Migrations:** none. **Watch-out:** this only surfaced because Eli got stuck on his own
phone. The runner subtree is worth auditing for other things that assume nav chrome exists.

---

## v1.6.0 — UNRELEASED (branch `redesign/carved`) — Jul 30 – Aug 6, 2026

**"Carved" design system: real token + primitive layer replacing the light-mode patch layer. Dashboard, nav, login and Daily Ops migrated. Nothing merged to `main`.**

Spec: `docs/PRSFLO-DESIGN-SPEC.md` + `prsflo-final-mock.html` (the mock is the visual source of truth). Read those before touching any of this.

- **New token set, permanently `--c-` prefixed.** `--c-bg/-fg/-wash/-wash2/-chip-ink`, six `--c-st-*` status colours, `--c-ivory`, `--c-hot-text`, and two muted ink steps `--c-fg-2`/`--c-fg-3` added during migration. **The prefix is permanent — there is no planned sweep to reclaim the bare names.** `--bg` already existed meaning something incompatible (`#0d0f14` dark / `transparent` light, with the page gradient and ~66 override rules depending on it), so reusing the name would have broken the app on contact. One prefix also makes the whole new system greppable.
- **Theme polarity is INVERTED from the spec, and must stay that way.** The spec and mock put light on `:root` and dark on `[data-theme="dark"]`. This app is the opposite: dark is the *absence* of the attribute (`Nav.tsx` calls `removeAttribute`, `app/layout.tsx` only ever sets `"light"`), so `[data-theme="dark"]` matches nothing here. Dark values live on `:root`, light overrides follow in `[data-theme="light"]` — **equal specificity, so the light block must stay after the root block.**
- **Primitives** in `components/carved/index.tsx` — Button, SoftButton, Input, Panel, StatusPill, StatusDot, Count, RoomCard, EventChip, Row, Table, Modal, NewLeadPulse, plus `toCarvedStatus`/`statusFillClass`. Class-driven, zero inline style objects. `SectionHeader` and `StatusBadge` were **extended** with a `carved` prop rather than duplicated; default `false`, so every existing caller renders unchanged.
- **`/dev-style`** — style guide at `app/(main)/dev-style/page.tsx`: every primitive and state, with a theme toggle. Auth-gated, no nav link (type the path).
- **Wordmark is now a component**, `components/layout/Wordmark.tsx` — Archivo Black, `PRS` full + `FLO` at .45, tracking −.02em, monochrome in both themes. Rendered by nav, login, reset-password, runner hub and the SOP gate. **The locked rule in `CLAUDE.md` changed shape**: it used to say "copy these exact spans out of `Nav.tsx`", which had already failed once and was being enforced by hand across five files. `PRSFloIcon` went monochrome (three `currentColor` waves at .35/.6/1), lost its teal glow, and **dropped `'use client'`** — CSS handles the theme, so it no longer needs a `MutationObserver`.
- **Surfaces migrated:** dashboard (panels, 11-room grid as carved status pools, tasks, flags, all seven modals), `LocationStrip` + its daily-ops drawer, `DailyOpsModal`, nav chrome, login, reset-password.
- **31 legacy light-mode override rules deleted** as their markup migrated — the four dashboard `data-panel` gradients, `data-room-cell`, `data-session-active`, `data-studio-card`, four `data-studio-index` gradients, four nav rules, three login rules, `data-ops-modal`, two `data-ops-col`, two `data-session-card`, `data-checklist-section`.
- **Scrollbars and native widget chrome** were still painting legacy `--border` (`#2a2e3d` / `#cbd5e1` — both desaturated blue), which read as a stray blue bar down every scrolling surface once the ground went warm. Retargeted to carved ink with a transparent track. `select`/`input[type=date]` got a light `color-scheme` so the OS stops drawing dark native panels on light paper.

### Aug 6 — calendar frozen, Work Order migrated

- **Calendar is FROZEN by ruling.** Grid, cards, COD strips, per-day staffing, long-bar payload, hover card, month rail. No further calendar work.
- **One session card, four surfaces** — `components/calendar/SessionCard.tsx`. Calendar grid, day view, studio view and the dashboard room grid each had their own copy and had already drifted (different fonts on the client line, staff stacked vs inline, invoice shown in two of four). Byte-identical copies of `fmtTime`/`initials` folded in.
- **Card anatomy (spec §10b):** payload → footer band (invoice# left, staff right) → COD strip. Billing renders **no** payment element; silence is the billing signal. Tour/Tech/Open Hours render none either — they're occupancy, not billable work.
- **Content ladder is by HEIGHT, never width.** A narrow column ellipsises; it never hides (F-18/F-19). Stacked sessions split a fixed cell, so a short card sheds footer → client line → times, and the COD bar shrinks to a 4px sliver rather than leaving.
- **`sessionFillClass()` is the only status→colour decision in the app.** The dashboard was using `status === 'tentative' ? amber : green`, sending tech, tour, open hours **and cancelled** down the green branch.
- **`--c-st-tech` added** (orchid `#b5a3ef`). Tech, tour and open hours are now three distinct statuses. **This makes seven status colours where spec §3 lists six — the spec needs updating.**
- **Continuous horizontal zoom** replaces Week / 2 Wks / Month (three fixed column widths wearing names). Trackpad pinch, `[`/`]`, and a `− 14d +` control; persisted to `localStorage['prsflo-cal-colzoom']`. **Pinching anywhere on the calendar page no longer zooms the browser** — that's the trade.
- **Row height is two modes, not a ladder.** 'Fit' and the 80px step looked identical because the fit calculation was floored at one card's height and never actually squeezed. Now `Card` (fixed) and `All rooms` (divide the viewport, no floor).
- **Sticky month rail** — segments derive from the same `days` array the grid renders from, so an infinite-scroll re-anchor re-renders them for free. Tint alternates on the **absolute month number**, not array index.
- **Work Order popup migrated end to end** — shell, header, footer, body, meta, client panel, all four tables.
- **IdWell (spec §8):** short identifier fields carry their label inside the well and share rows. Invoice #, PO # and Food went from three full-width rows to one line; Booking Notes absorbed the height.
- **Segmented controls (spec §8):** one raised housing, options transparent inside it, selected pressed + filled. Status selector fills with its own status colour. Applied to status, session type, food, client COD/Billing, and three pairs in the batch panel.
- **TABLE EXEMPTION (spec §8):** no wells or carving inside data tables. Bare transparent inputs, zebra rows, wash on hover/focus, one `TCELL_X = 6` inset shared by headers, text cells and inputs. Money columns right-align header *and* value.
- **WO print** was blank since `2e67ec0` un-portaled the popup (the CSS required `body > [data-wo-portal]`) — now isolated by visibility, which works at any depth. The flatten rule matches on the `c-` prefix instead of a hand-written class list that went stale the moment the body migrated.
- **Entered-value weight raised to 500** app-wide on the WO (`.c-tin`, `.c-well` children, `.c-input`, `.c-area`, computed cells). Placeholders stay 400 — that difference is now what separates a value from a hint. 500 not 600 because DM Mono only ships 400/500.

- **Default theme is now DARK.** The pre-paint script in `app/layout.tsx` sets `light` only when explicitly saved; `Nav.tsx`'s mount effect matches. **These two must always agree or the page paints one theme and flips on hydration.** Existing preferences are kept; only fresh devices change. PWA `theme_color` in both manifests and in metadata moved off the legacy `#0d0f14` to `#1b1a17` — it was flashing the old ground on every app launch.
- **Welcome splash fixed.** It was never unmigrated — a legacy rule painted `[data-splash]` and `[data-auth-hold]` with the retired blue→rose gradient `!important`, so light mode showed the old app's colours full-screen on the way into the new one. The AuthGuard hold moved from `var(--bg)` (transparent in light, which is why the override existed) to `var(--c-bg)`, and the rule was **deleted** — last consumer migrated. Legacy light rules: 23 → 21.

**`[style*=` substring-matcher count (spec §11 metric): 32 → 30.** Three dead
`[style*="position:fixed"]` selectors deleted — React writes inline styles through the CSSOM
and the browser serialises the attribute *with* a space, so the no-space variants could never
match anything this app renders.

**Migrations:** none. This is presentation only — no schema, no queries, no handlers.

**Watch-outs:**
- **SPECIFICITY — the single most expensive thing in this branch.** `.c-sheet button:not(…)×6` is **(0,7,1)** and `.c-sheet input:not([type="file"]):not(.c-input)` is **(0,3,1)**. Three separate features were written against them and lost silently: segmented options rendered as individual raised pills ("bubbles in bubbles") and never received their status fills; inputs inside wells got a second carved box with its own padding, which clipped the first character of the email field; and bare table cells had no effect at all. **Any new recipe targeting an element inside `.c-sheet`/`.c-panel` must either be added to that rule's `:not()` exclusion list or be written to deliberately outrank it — and the arithmetic must be checked, not estimated.** A first attempt at the `.c-tin` override was (0,4,0), which still loses to (0,4,1) on element count.
- **`.c-mono` sets `font-size: 12.5px`, not just a typeface.** Anything wearing it renders at 12.5 regardless of its container's font-size. This silently oversized the card footer through two attempted fixes. A guard now pins it to `inherit` inside `.c-ev-foot`.
- **`overflow: hidden` on an ancestor kills a sticky descendant** — the clipping box becomes its scroll container, so it gets zero sticky range. Cost the month rail one commit, and it is the reason CSS sticky could never have worked for the long-bar chip payload. Sticky is already clamped to its containing block; a clip is not needed for push-out behaviour.
- **`[data-theme="light"] [style*="position: fixed"] input {…!important}` is still live** and still needed by `/admin`, `/wo-hub`, `/tasks`, `/clients`, the runner pages, `DailyOpsModal` and `LocationStrip`. It is scoped to exclude carved classes. **Delete it when the last of those migrates, not before.**
- **A carved recipe that paints a shadow needs an explicit light-side rule.** Dark-first recipes get captured by the legacy light overrides. Scripted check: every `.c-` rule with a non-`none` `box-shadow` must have a matching `[data-theme="light"]` rule. Two were found this way (`.c-control:active`, `.c-row.c-selected`).
- **`.c-sheet` gives raw `<button>`/`<input>`/`<textarea>` carved defaults.** This is a deliberate compromise for ~38 one-off controls inside migrated modals, and it is *not* the pattern being retired: the old layer matched inline-style **substrings across the whole document**; these are component-scoped element selectors visible from the markup. **Prefer primitives in new code.** Those controls had their inline `background` stripped so the scoped rules win without `!important` — don't re-add inline backgrounds there.
- **The `[style*=` metric recommended earlier was wrong.** 38 of the 54 occurrences are inside `@media print` (the WO print stylesheet) and have nothing to do with theming. **Track the legacy override layer instead: `[data-theme="light"]` selectors that do NOT contain `.c-` — 27 remaining as of Aug 1, down from ~66.**
- **`DailyOpsModal` lost its required `color` prop** and `TwoCheckbox` lost its optional one — per-studio colour is retired. `LocationStrip`'s `SectionLabel` still *accepts* `orange` but **ignores it**; clean up or restore deliberately.
- **A scripted token-swap is not a migration.** The first pass over the dashboard modals swapped tokens, fonts and borders by regex — which strips legacy styling but cannot *add* carved structure, producing "typography arrived, physics didn't". Daily Ops had to be redone applying recipes by hand. Migrate surfaces by applying recipes, not by find-and-replace.
- **Still un-migrated as of Aug 1:** admin, WO Hub, **WorkOrderPopup** (2,835 lines — the largest remaining piece), runner, `/tasks`, the welcome splash. The nav paints carved ground on *every* route, so those pages show a warm bar over the old ground until they migrate. (CRM and the calendar were completed Jul 31 – Aug 1; `webInquiryPulse` went with the CRM pass.)
- **`public/sop.html` was deliberately NOT updated**, though the end-of-session ritual in `CLAUDE.md` requires it: spec §1 explicitly fences that file off as a separate project. Staff notes for this work are owed once it merges.

**Added Jul 31 – Aug 1 (CRM, calendar, references):**

- **CRM migrated in full** — lead list, detail panel, clients, registrations, every modal, and the **seven shared components CRM renders** (`StaffPicker`, `StudioSelect`, `ClientPanel`, `RegViewModal`, `ContactPicker`, `ArtistPicker`, `PhoneInput`). *A page is not a surface; it is the page plus everything it renders* — the accent survived a "finished" CRM because those seven were missed.
- **Lead profile ported to `docs/design-refs/lead-profile-final.html`** — meta-line identity (`COD · source · age`), bare-Archivo name with focus-only affordance, `aka` well, CONTACT/SESSION/NOTES bands (flat wash, zero depth), one well recipe, segmented housings, calcline, Activity/Tags folds, footer delete.
- **V3 recipes added:** `.c-well`, `.c-band`, `.c-seg`, `.c-mini`, `.c-fold`, `.c-metaline`, `.c-artist-sub`, `.c-calcline`, `.c-returning`, `.c-danger`, `.c-nc-toggle`, `.c-pressed`.
- **Field geometry radius 14 / height 40 app-wide** (supersedes §7 "inputs 99px"; mock wins).
- **`--c-st-warm` violet → amber `#ffa94d`** — one token edit propagated to all 25 consumers with zero hardcoded literals, which is the first proof the token layer works.
- **Returning badge** on approved email-OR-phone match against `clients`, counting DISTINCT engagements from `bookings`.
- **Calendar** — status-fill chips, grid restored per the §10 exemption (row separators, day ticks, heavier week/month ticks), full-width location bars, chip payload in chip-ink, staffing bottom-right, **per-day staffing read from `studio_time_rows`**, long-bar tape labels.
- **Design references committed** — `docs/PRSFLO-DESIGN-SPEC.md` and `docs/design-refs/` were session-only and are now in the repo.

**Watch-outs added this period:**
- **The `[style*=` metric is WRONG and is retired.** 38 of 54 occurrences are in `@media print`. Track `[data-theme="light"]` selectors without `.c-` — **27 left, from ~66.**
- **Theme rules need the `[data-theme="light"]` prefix on EVERY selector in a comma group.** One missing prefix applied a 70%-white shadow in dark mode.
- **`:not()` chains inflate specificity** — a scoped default at (0,6,1) silently outranks a targeted rule at (0,1,1). Use explicit opt-out classes, not source order.
- **`clients.phone` holds MIXED formats** — `ClientProfile` writes digits-only, `/api/register` writes raw as typed. Any phone matching must normalise both sides; PostgREST can't, so narrow on the last 4 digits and compare exactly in JS.
- **Calendar per-day staffing is a §10 behavioural exception**, display-only, Eli-approved. Do not "fix" it by splitting runs in `projectBookingCards` — that edits the atomic WO save path.
- **A scripted token-swap is not a migration.** Regex retires legacy values; it cannot add carved structure. Apply recipes surface by surface.

**Files (added):** `app/(main)/crm/page.tsx`, `app/(main)/calendar/page.tsx`, `components/clients/*`, `components/crm/*`, `components/shared/{StaffPicker,StudioSelect,ClientPanel,RegViewModal,ContactPicker,ArtistPicker,PhoneInput}.tsx`, `docs/PRSFLO-DESIGN-SPEC.md`, `docs/design-refs/*`.

**Files:** `styles/globals.css`, `components/carved/index.tsx`, `components/layout/Wordmark.tsx`, `components/layout/Nav.tsx`, `components/PRSFloIcon.tsx`, `components/ui/SectionHeader.tsx`, `components/ui/StatusBadge.tsx`, `components/SopGate.tsx`, `components/dashboard/LocationStrip.tsx`, `components/dashboard/DailyOpsModal.tsx`, `app/(main)/page.tsx`, `app/(main)/dev-style/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/runner/page.tsx`, `docs/working-conventions.md`, `CLAUDE.md`.

---

## v1.5.1 — Jul 30, 2026

**Runner couldn't open work orders on multi-day sessions. Mobile WO sheet layout.**

- **The runner hit "Work order not yet created — contact office." on a WO that plainly existed.** The hub resolved a booking's WO by asking *which work order has `booking_id` = this booking*. Since the July 2026 rebuild that question has the wrong shape: a WO save writes **several booking projection cards** (one per consecutive same-room run) and they all carry `work_order_id`, but `work_orders.booking_id` names only **one** of them — the original. So the original card opened fine and every other card dead-ended. Any multi-day or multi-room session was affected. Both the hub's `woMap` and the WO page's resolver now read the card's own forward link (`bookings.work_order_id`) first, falling back to the old reverse lookup for pre-rebuild rows.
- **The nav painted through the middle of the mobile WO sheet.** Nav is `z-index: 99999` and deliberately above all modals, so a sheet starting at `top: 0` doesn't cover it — it gets covered. The desktop branch has always used `top: 52` for exactly this reason; the mobile branch never carried it over. Mobile now offsets 52 as well (the Nav is 52px tall on mobile too — the 44px is the hamburger button *inside* the bar), and the inner containers switched `100dvh` → `100%` so they don't overflow by the nav's height and push the footer buttons off-screen.
- **Removed a leftover per-studio accent** on the mobile WO header. It tinted the header's bottom border by venue, and mapped `ameraycan` → `var(--hot)` — the **lead-temperature red** used everywhere else for danger, errors and cancelled sessions. Every Ameraycan work order opened with a 3px red bar and read as broken. Per-studio colour coding had already been removed across the runner, admin, LocationStrip and dashboard; this survived because its comment claimed to mirror the Runner Hub header, which had itself moved to a neutral 1px border in that same pass. The comment was stale, not the design.

**Migrations:** none.
**Watch-outs:** `work_orders.booking_id` is now a **fallback**, not the primary link — it is still load-bearing for create-idempotency and must not be dropped outside the planned Step 9. When adding any new booking → WO lookup, read `bookings.work_order_id`. And don't reintroduce venue colours without reintroducing them everywhere; if you do, don't borrow a token that already carries meaning.
**Files:** `app/runner/[studio]/page.tsx`, `app/runner/[studio]/wo/[id]/page.tsx`, `components/calendar/WorkOrderPopup.tsx`.

---

## v1.5.0 — Jul 29, 2026

**Security: PIN login taken down after a distributed brute-force attempt.**

- **The incident.** `POST /api/auth/pin` took sustained guessing from **~50 distinct IPs** at roughly one attempt per second — spread deliberately so no single IP carried enough load to trip the per-IP lockout. Found by chance in the Vercel request log; nothing in the app reported it.
- **Why it was worth attacking.** `verify_staff_pin(p_pin)` takes **only the PIN** — no username, no email — and matches it against every staff row at once. With 4 digits (10,000 combinations) and ~10 provisioned accounts, **any random guess had roughly a 1-in-1,000 chance of hitting a real account.**
- **The bug that made it cheap.** The lockout wrote `fail_count: willLock ? 0 : nextCount` — **resetting the counter on lockout**. Five fails → 30s lock → counter back to zero, forever. ~600 attempts/hour/IP, and the escalation the code appeared to have was unreachable.
- **Fixed:** counter only ever climbs; lockout escalates `30s → 2m → 10m → 60m`; forgiveness is a **6-hour quiet period since the last failure** (`DECAY_MS`), not surviving a lockout. New append-only `pin_login_failures` (ip, user_agent, outcome) — `pin_login_attempts` holds one row per IP and is deleted on success, so it can never answer "what happened last night". Login countdown humanised (`3600s` → `60m`).
- **Then taken down entirely.** The app is not live yet (a handful of real users), which reverses the cost/benefit: all `staff_pins` rows deleted, all sessions revoked, everyone moved to email + password. `PIN_LOGIN_ENABLED = false` in `app/(auth)/login/page.tsx` hides the numpad and defaults the screen to email — with zero PIN rows the pad could only fail silently and look like a broken app.
- **`scripts/set-one-password.mjs`** — sets a known password on one account via the admin API, no email. Written because Supabase's built-in sender caps at ~2 messages/hour and that cap was reached with a manager locked out mid-shift. Refuses macOS **curly quotes**, which bash passes through as literal characters — the first real run set a password *including* the quote marks and login failed while `auth.users` looked perfectly healthy.
- **Also shipped:** the registration ID viewer no longer auto-downloads files (`isDoc = !isImagePath(...) || imgFailed` conflated "is a PDF" with "the image failed to load", so a failed `<img>` rendered an `<iframe>` at a format the browser can't display inline — which makes it download). Now `isPdf` gates the iframe, with an honest HEIC fallback panel. Client-facing forms (`/register/:token`, `/inquiry`) forced dark; `/register/view/:clientId` excluded as it's a white print sheet.

**Migrations:** `20260729140000_pin_login_failures.sql` — **run**. No insert policy by design: the route writes with the service-role key (which bypasses RLS), so nothing holding a browser token can flood or forge the log. SELECT is owner/manager only.

**Watch-outs:**
- **Staff Supabase passwords are random 32-char strings from `set-staff-passwords.mjs` that nobody knows.** Any design that throttles or disables PIN login *globally* therefore locks out the entire team with no recovery path. A global rate limit was proposed and withdrawn for exactly this reason.
- **Supabase silently falls back to the project Site URL** when a `redirectTo` isn't on the Redirect URLs allowlist. Reset emails were going to `http://localhost:3000` even though the code correctly hardcodes production. Fixed in the dashboard; would have hit every staff member.
- **Vercel Bot Protection is set to Challenge.** It challenges non-browser traffic — which the two Vercel Crons also are. Confirm `auto-demote` (09:00) and `reset-needs-action` (15:00) still run.
- The lockout cap is **60 minutes on purpose**. Staff at one studio share a public IP; an unbounded lock would let one runner's mistype take a room offline mid-session. Don't "harden" it without solving the shared-IP problem first.
- `PIN_LOGIN_ENABLED` is the single flip to bring PINs back. Nothing else needs changing — the PIN code paths are untouched.

**Files:** `app/api/auth/pin/route.ts`, `app/(auth)/login/page.tsx`, `scripts/set-one-password.mjs`, `components/shared/RegViewModal.tsx`, `app/layout.tsx`, `supabase/migrations/20260729140000_pin_login_failures.sql`.

---

## v1.4.3 — Jul 29, 2026

**DEV page restructure + floating-panel fixes.**

- **Errors moved from Admin → DEV**, and gated to **Eli's accounts only** (`srv2129@gmail.com` / `eli@paramountrecording.com`), matching the CRM Campaigns gate. Deliberately narrower than the `app_errors` RLS policy, which still allows owner/manager — this only hides the surface. Raw stack traces in front of staff invite alarm about failures that are already handled, and it's a developer tool, not an operations one.
- DEV page rebuilt with a **left sidebar mirroring the Admin page**, so the two internal tool pages navigate identically. Sections: Feedback (any staff) · Testing (PIN) · Errors (Eli).
- **Floating tester: "Continue" always opened at item 1.** The positioning effect ran on batch-id change alone, at which point `results` was still empty because the fetch hadn't resolved — so "first untested" always computed as item 1. It now waits for `loading` to finish and fires once per batch via a ref, so it can't jump the tester mid-tap when a verdict lands.
- **The header counter looked stuck.** It showed `tested/total` (verdicts recorded), which reads as a position indicator that doesn't move with Prev/Next. Now shows both, labelled: `Item N of 38` and `N done`.

- **Third-party error noise filtered.** `window.onerror` catches everything on the page, including browser extensions and iOS webviews probing for native bridges (`window.webkit.messageHandlers`). Those aren't our bugs and can't be acted on, and an error log nobody trusts is one nobody reads. `ErrorReporter` now drops a small allowlist of provably-external patterns: the webkit bridge probe, opaque cross-origin `Script error.`, and the benign `ResizeObserver loop` warning.

**Migrations:** none.
**Watch-outs:** conflating "where am I in the list" with "how many are done" is the kind of thing that reads as a bug even when the number is correct. Label counters. Only add to `IGNORED_ERROR_PATTERNS` for errors provably not ours — the filter is there to protect signal, not to hide failures.

**Confirmed from the live error log (Jul 29):** the error-boundary entry read `cannot add 'postgres_changes' callbacks for realtime:test-results-wo-runner-2026-07 after 'subscribe()'` — note the channel name with **no instance suffix**. This is the exact mechanism behind the duplicate-channel bug: supabase-js hands back the *same already-subscribed channel object* for a duplicate name, and calling `.on()` on it after `subscribe()` throws. The unique-name-per-mount fix in v1.4.2 addresses it directly.

**Files:** `app/(main)/feedback/page.tsx`, `app/(main)/admin/page.tsx`, `components/dev/TestingFloater.tsx`, `components/ErrorReporter.tsx`.

---

## v1.4.2 — Jul 29, 2026

**Testing tooling fixes + failure export.**

- `useTestResults` named its realtime channel `test-results-${batchId}`, but the hook mounts in **three** places simultaneously (a card per batch, the review view, the floating panel). Same batch → duplicate channel names on one table → the error boundary Eli hit. Each mount now appends a module-level sequence number.
- Removed two `!` non-null assertions on `TEST_BATCHES.find(...)`. A stale batch id in `sessionStorage` (or a batch removed in a later deploy) would have thrown and taken the whole page down.
- Floating tester: notes moved **above** the verdict and are always visible; the note now saves *with* the verdict. Previously "Save note" defaulted `status` to `'fail'`, writing a verdict nobody chose. Navigation is explicit Prev/Next, with **Next blocked until a verdict exists**; auto-advance removed so a tester can go back and change an answer. Note drafts are held per item so moving between items never loses typing.
- **Copy for Claude** on Admin → Errors, and **Copy failures + notes** on a test batch review. Claude has no database access, so without an export the diagnosis loop depends on retyping or screenshotting stack traces — which is where the URL, `meta.source` and exact message get dropped.

**Migrations:** none.
**Watch-outs:** the `status` column on `test_results` is NOT NULL, which is why a note can't be saved without a verdict. If a "note only, decide later" flow is ever wanted, that column has to become nullable first.
**Files:** `hooks/useTestResults.ts`, `components/dev/TestingFloater.tsx`, `components/dev/TestingSection.tsx`, `components/admin/ErrorsSection.tsx`.

---

## v1.4.0 – v1.4.1 — Jul 29, 2026

**DEV tab: staff feedback + PIN-gated test batches. Error checks across the runner WO.**

- Nav `Feedback` → **`DEV`**; route stays `/feedback` (renaming would break bookmarks for no gain). The page is a tab shell; the existing feedback board moved verbatim into a `FeedbackBoard` component.
- **Test batch definitions live in CODE** (`lib/testBatches.ts`), only verdicts in the database (`test_results`). A batch is authored in the same commit as the work it covers, so checklist and feature can't drift, and no migration is needed per batch. Item `id`s are **half the results key — never rename one after testing starts** or its verdict is orphaned.
- Testing lands on **batch cards** with status *derived* from results (Not started / N tested / Done · N broken), so it can't go stale. This replaced a planned "active/done flag" — derived state needed no flag.
- **Floating tester panel** in the `(main)` layout: one item at a time, draggable with a clamped position, minimises to a pill, position persisted. Deliberately **not on `/runner`** — runner testing happens on a phone with the checklist on a computer, so a panel there would only cover the UI under test. Being in `(main)` also keeps it off `/login`, `/register`, `/inquiry`. Items carry a Phone/Desktop badge (`deviceFor()`).
- **Runner WO error checks.** `handleSaveChanges` called `router.push` back to the studio hub **unconditionally with no writes checked** — a save that failed on flaky studio wifi bounced the runner away believing their shift was recorded. It now collects each write's error, reports once, and stays on the page. Also wrapped: session notes, equipment condition + notes, date reorder, and both needs-attention photo writes (previously `console.error` only, invisible on a phone).

**Migrations:** `20260729120000_test_results.sql` (one table, unique on `(batch_id, item_id)`).
**Watch-outs:** the testing PIN is a **soft gate, not security** — everything behind it is already readable by any signed-in staff under RLS. Don't let that pattern spread to anything that matters.
**Files:** `app/(main)/feedback/page.tsx`, `components/dev/*`, `hooks/useTestResults.ts`, `lib/testBatches.ts`, `app/runner/[studio]/wo/[id]/page.tsx`.

---

## v1.3.0 – v1.3.2 — Jul 29, 2026

**Runner WO readability, staff reassignment, admin batch edit.**

- Runner Studio Time table: type 9–10px → 11–12px, numbers off `--text2`, cells centred, **Date + Studio frozen** (`position: sticky`), **Studio column added** (it never existed — the cause of a false "duplicate rows" report), zebra **by day** not by row, **today-only default** with an `All N days` toggle. Filtering is render-only; the save loop iterates all rows so hidden-day edits still save.
- Runner staff reassignment: pill → **Change** → sheet with a role-filtered roster. **Single-day only** — bulk editing from a shared phone would rewrite days the runner can't see.
- Admin **Batch Edit** panel: scope *All days* or *Date range*; per-field checkboxes for room, times, rate + type, OT, staff, session info. **Unticked fields are never written.** Skips standalone staff rows and `admin_locked` rows. Routes through `updateStRow` so all derived billing recalculates through one path. Local-first — Cancel reverts the whole batch. Replaced per-cell fill-down arrows.
- Staff times now follow session times **unless independently set** (the test is whether the staff time still equals the session's previous time).

**Migrations:** none.
**Watch-outs:** sticky cell backgrounds **must be opaque** — passing the row's translucent tint let scrolling columns bleed through the frozen ones. They composite the tint over `var(--surface)`.
**Consolidations:** `getLocalToday` → `lib/time.ts` (was byte-identical in **five** files; timezone-sensitive date maths duplicated six ways). Runner table's `ST_GRID` column template defined once (was three copies, so header and body could drift out of alignment).

---

## v1.2.0 – v1.2.1 — Jul 28–29, 2026

**Staffing chosen on the lead; runner PIN provisioned.**

- `leads.staff_role` + `leads.staff_name`, `bookings.staff_mode`. Staffing is picked on the lead (Eng / Asst / **No Staff** + optional roster name, free text allowed) and seeds every WO studio-time row. **`leads.engineer_needed` is now vestigial** — backfilled, unread, drop in a later cleanup.
- `studio_time_rows.eng_role` default flipped to **`assistant`** — an engineer is the exception. Every default was flipped in step across seven places (`seedStudioTimeRows`, `normalizeStRow`, `addStRow`, `addEngRow`, `clearEngRow`, the Seed panel, `buildBookingProjection`).
- Runner PIN: the profile and `staff_pins` row existed but **`auth_user_id` was NULL**, and `set-staff-passwords.mjs` explicitly *skipped* rows without one — so re-running it could never fix the runner. The script now creates (or adopts) the auth account and links it. One PIN pad, role-aware landing: runners → `/runner`.
- Runner lockout: `AuthGuard` bounces `runner` sessions out of the internal app before render.

**Migrations:** `20260728210000_studio_time_rows_eng_role_default_assistant.sql`, `20260728220000_lead_and_booking_staffing.sql`.
**Watch-outs:** `bookings.staff_mode` is an **explicit column, not overloading `engineer_status`** — that column already defaults to `'not_needed'`, so a calendar-made booking and a deliberately unstaffed one would be indistinguishable. Also: `buildRowPayload` used to write `eng_role` only inside its `if (rate or name)` branch, silently dropping the role on the "engineer, TBD" case.
**Architecture decision:** ONE app, not a separate runner app/URL. RLS already grants the runner role nothing on `leads`/`clients`/`client_contacts`/`registration_tokens`/`engineers`/`qc_reports`/`srs_log`, so the CRM was never exposed. Forking would duplicate the WO's studio-time model, seeding and atomic RPCs — the highest-risk code in the repo.

---

## v1.1.0 – v1.1.1 — Jul 28, 2026

**CRM batch: shared Asst Mgr tasks, registrations database, lead date ranges, rename propagation.**

- **Asst Mgr tasks shared.** Root cause was RLS, not UI: the policy let an own-only role read only rows where `assigned_by`/`assigned_to` was their own profile, so Isaac could not SELECT a task assigned to Quinn *at the database level*. Added a peer clause via `is_task_peer(uuid)`. The client-side `.or()` filter was **removed** — it re-implemented the policy in narrower form and was what hid the teammate's task.
- New CRM **REGISTRATIONS** tab (search + date range + 25/page), pending-reg banner moved to CRM page level, **Copy Address** mailing block on registration records.
- `leads.session_end_date` for multi-day holds; the calendar seeds `bookings.end_date` from it.
- **Client renames propagate** (`lib/propagateClientRename.ts`) to `bookings` and `leads` by `client_id`, and to `bookings.ordered_by` by `anr_contact_id`. **Names only** — artist is per-session for a label, and contact details record who was reachable at booking time.
- **First/last are two separate fields anywhere a person's name is edited** (standing convention). Individual client profiles gained real First + Last fields; a combined-only name can't propagate without guessing where to split it.
- Start Booking restored to the lead detail; **the lead is marked booked when the SESSION IS SAVED**, not when the button is pressed, so opening a WO to check a rate and backing out doesn't close a lead out.
- Shared `clients` realtime channel (`hooks/useClientsVersion.ts`) — four consumers, one subscription.

**Migrations:** `20260728190000_leads_session_end_date.sql`, `20260728200000_dashboard_tasks_peer_role.sql`.
**Watch-outs:** don't re-add a client-side `assigned_to`/`assigned_by` filter to the own-only fetchers in `lib/tasks.ts`; those queries intentionally let RLS do the scoping. The lead→WO link is component state only, so an abandoned-then-reopened WO won't mark the lead — a durable `bookings.lead_id` is scoped into Step 9.

---

## Earlier

Before v1.1.0 the project wasn't version-numbered. See `docs/PROJECT_LOG.md` for the full session-by-session history, and `docs/PRSFlow-Tech-Stack.md` → Done table for the feature inventory.
