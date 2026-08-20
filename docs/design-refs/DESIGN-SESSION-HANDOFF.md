# Design Session Handoff — Carved Redesign
### ⚠️ SUPERSEDED 2026-08-05: the F/O two-chat relay is RETIRED. The entry point is now `docs/BUILD-HANDOFF.md` (one chat designs + builds; Eli runs git). This file stays for protocol history and lessons.
### Written 2026-08-05 by the outgoing design session (Fable). Read this + `docs/PRSFLO-DESIGN-SPEC.md` first.

## Roles & protocol (how this project runs)
- **Two Claude sessions, Eli relays between them.** A DESIGN session (mockups, rulings,
  spec ownership) and an IMPLEMENTATION session (Opus — code). They never talk directly.
- **Numbered relay:** design messages are F-n, implementation messages are O-n; every
  message opens by acking the last number received. A sequence gap = re-paste before
  acting. Last state at handoff: design side sent **F-26** (studio-time table exemption);
  implementation had been reporting O-teens (exact last O known to Eli's Opus chat).
- **Files are truth, chat is coordination.** Anything defining layout/components ships as
  a file in `docs/design-refs/`; the spec (`docs/PRSFLO-DESIGN-SPEC.md`) is law and every
  ruling gets written into it. Prose that never became a file has been lost before.
- **The design session writes ONLY** `docs/PRSFLO-DESIGN-SPEC.md` and `docs/design-refs/`
  — never code, never shared files, **NEVER git** (sandbox shells corrupt `.git` — see
  `docs/working-conventions.md`, 2026-07-30 incident). Eli runs every git command via
  copy-paste one-liners provided by the implementation session.
- **Verification split:** implementation session produces source-level parity tables (it
  has no browser); **Eli does all visual verification** on Vercel preview URLs and relays
  screenshots. Anything for Eli to paste (Opus messages, terminal lines) goes in a
  copy-button code block.

## State of the migration at handoff
- **Done & Eli-shaped:** tokens (`--c-` prefix, permanent), primitives, dashboard, daily
  ops modal, CRM list + lead profile (reference: `lead-profile-final.html`), calendar
  (COMPLETE & FROZEN: grid restored per §10 exemption, card anatomy §10b w/ footer band +
  red COD strip, per-day staffing via studio_time_rows [Option B], long-bar payload slide,
  hover card, sticky month rail). WO popup: meta section (IdWell), segmented housings,
  light-theme well regression fixed (F-25), studio-time table going FLAT per the TABLE
  EXEMPTION ruling (F-26 — verify landed).
- **Pending:** Eli's full visual sweep (calendar + lead profile + WO, both themes) has
  been repeatedly deferred — it gates nothing now but should happen.
- **Not yet migrated:** Admin page, SOP page (**fenced** — `public/sop.html` is its own
  future project, do not touch), WO Hub, runner pages, `/tasks`.

## Nav + dashboard: DESIGN COMPLETE (2026-08-05) — implementation is the open chapter

The redesign described below is DONE on the design side. Outcome:
- **Reference law: `dashboard-final.html`** (this folder) = side nav rail + console
  dashboard + the Flo AI box with Aurora ring. Spec ruling: **§14** (14a rail,
  14b console layout + 12-room order + packing law, 14c Flo recipe + glow-means-AI
  law, 14d sequencing: rail+dashboard land first, parked pages after).
- Iteration history (context only, superseded): dashboard-sidenav-v1…v7,
  flo-console-options/final, flo-motion-options(-2), flo-aurora-final. v7 was the
  blessed layout; Aurora-dialed won the motion bake-off.
- §7 no-fog law now carries its single exception (Flo); §12 don'ts updated to match.
- Next design-side act: relay the F-message to Opus (Eli has it) and field O-side
  questions — mobile rail behavior is explicitly left for Opus to propose.

## Next phase: nav + dashboard redesign (HR-driven) — [COMPLETED, kept for context]

**REQUIRED READING for the incoming design session: `docs/HR-SPEC.md`** (v2.0, "My Day &
HR Layer") — it is thorough and already contains binding design decisions. Do not
re-litigate them. The ones that shape the nav/dashboard work:
- **§2.5a — SIDE NAV IS DECIDED** (Aug 2026): left side nav replaces the top nav; grouped
  sections with count badges (badges are functional, not decoration — pending punch
  count is how Fernando knows to open the queue). HR destinations = one grouped **HR**
  section, likely an "HR Hub" with tabs (punches · hiring · training) mirroring WO Hub.
- **§2.6 — My Day card** sits at the TOP of each person's dashboard, collapses to one
  confirmation row when complete; 3+ day backlog keeps it expanded.
- **§2.7 — Eli's dashboard** gets the 14-day staff grid (rows=people, cols=days,
  green/red/neutral) in that slot instead.
- **§2.8 — morning briefing** renders directly under the existing "Good evening Eli —
  here's your briefing" greeting line (which currently has no briefing beneath it).
- **§12 decisions 9–11**: side nav confirmed; the duties surface is named **"My Day"**
  ("Daily Ops" is TAKEN by the session/room view — do not reuse); My Day sits in the
  right column above Tasks, reusing the role-tab pattern.
- Also read `docs/hr/README.md` + the PRG protocol docs in `docs/hr/` for context, and
  note HR-SPEC's queue-position warning: the HR BUILD waits behind WO stability — but
  nav/dashboard DESIGN work (mockups, rulings) is exactly what the incoming session is
  for. Eli additionally has a dashboard mockup image from his HR chat as input.

Sequencing decision (Eli, 2026-08-05): redesign nav + dashboard FIRST; the unmigrated
pages above get restyled after, under the new side-nav frame — restyling them now would
be wasted work. Working method that succeeded all project: 2–4 options as self-contained
HTML mockups in design-refs, Eli picks, ruling goes into the spec, F-message to Opus with
the reference file. Any nav redesign must also respect existing spec law (Carved
affordances, colour=status, IdWell, table exemption, two registers) — the side nav is a
new frame, not a new design language.

## Hard-won lessons (do not relearn these)
1. Opus follows the spec literally — a stale/wrong spec gets faithfully implemented.
   Keep the repo spec current the moment a ruling happens.
2. Port protocol beats prose: when a pattern misses twice, make Opus copy markup/CSS from
   the reference file verbatim (tokens/polarity translated) instead of re-describing it.
3. Theme polarity: app dark = absence of `data-theme` (`:root` is dark; light is the
   override). The mocks are the opposite. Values are truth; naming/polarity are not.
4. The calendar and data tables are exempt from the no-lines law — grids ARE structure.
5. Field width follows content width (IdWell). Raised elements never nest.
6. Colour = status only; hot doubles as critical/destructive; warm is never warnings.
7. When one edge case misbehaves, fix the edge case — don't redesign the population.
