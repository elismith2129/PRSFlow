# Build Session Handoff — Carved Redesign, Phase 2
### Written 2026-08-05 by the outgoing design session (Fable). THIS IS THE ENTRY POINT for the incoming session. Read it fully before touching anything.

## THE NEW WORKING MODE (changed 2026-08-05 — supersedes the F/O relay)

**ONE chat now does everything: design, code, and commit lines.** The old system — a
design chat (F-n messages) relaying through Eli to an Opus implementation chat (O-n
messages) — is RETIRED. Both chats grew too large. An F-27 message was drafted but
**never sent and is VOID**; do not reference F/O numbers, there is no other session.

How this chat works:
- **You design AND build.** You have direct file access to the repo (Cowork folder).
  For pages without an approved design, you mock first (see "Working method" below).
  For approved designs, you write the app code directly.
- **Eli runs ALL git.** You NEVER run git commands — not from any shell, ever
  (a sandbox git run corrupted `.git` on 2026-07-30; see `docs/working-conventions.md`).
  After each chunk of work, hand Eli ONE copy-paste line in a code block:
  `git add <files by name> && git commit -m "..." && git push` — **never `git add -A`**.
- **Eli does all visual verification** — localhost / Vercel preview URLs, both themes.
  You verify at source level: `npx tsc --noEmit` must be clean before every commit line.
- **Eli is a non-developer** ("monkey brain" — his words). Explain anything technical
  in plain language. Anything he must paste goes in a copy-button code block.
- Nothing merges to `main` until Eli says so. Staff-testing rule: nothing to main.

## REQUIRED READING, in order
1. `CLAUDE.md` — repo law: realtime-subscription rule, error handling (`dbResult`),
   shared helpers (`lib/time.ts`, `lib/format.ts`), Wordmark component rule,
   end-of-session five-doc ritual, z-index ladder, auth/RLS model.
2. `docs/PRSFLO-DESIGN-SPEC.md` — the design LAW. Especially:
   §2 five laws · §3 tokens (`--c-` prefix; polarity warning) · §5 status colours ·
   §6 two registers · §7 carved recipes (+ Flo glow exception) · §8 primitives,
   IdWell, TABLE EXEMPTION, segmented housings · §10/§10b calendar (FROZEN) ·
   **§14 dashboard + side nav + Flo box (the next thing to BUILD)**.
3. `docs/design-refs/dashboard-final.html` — the approved dashboard/nav/Flo reference.
   PORT PROTOCOL: copy its markup/CSS verbatim (tokens + polarity translated), never
   rebuild from prose. Mock polarity is INVERTED vs the app (mock: dark is
   `data-theme="dark"`; app: dark is the absence of `data-theme`). Values are truth.
4. `docs/HR-SPEC.md` — product spec for the HR layer (My Day, staff grid, punches,
   hiring, training). Binding decisions in §2.5a–2.8 and §12.9–11. Do not re-litigate.
5. `docs/design-refs/DESIGN-SESSION-HANDOFF.md` — the old handoff; still useful for
   protocol history and the hard-won lessons list (repeated below).
6. `docs/design-refs/lead-profile-final.html` — law for the lead profile (already built).

## STATE OF THE MIGRATION

**Built & approved (Carved, live in app code):** tokens/primitives, dashboard (old
top-nav version), daily ops modal, CRM list + lead profile, calendar (COMPLETE &
FROZEN — do not touch, §10/§10b), WO popup (IdWell meta, segmented housings, flat
studio-time table per TABLE EXEMPTION).

**Designed & approved, NOT built:** the §14 package — side nav rail, console
dashboard, Flo box. Reference: `dashboard-final.html`. **This is build item #1.**

**Built & WORKING in the app, but still in the OLD skin (redesign the layout +
surface; the functionality, data flow, and realtime wiring already exist — do NOT
rebuild the logic):**
- Runner hub + runner pages (phone-first)
- Mic inventory (admin section)
- Flags (admin Flags log; the dashboard Flags panel is already Carved)
- Tasks page (`/tasks`)
- WO Hub
- Daily Ops (the per-studio daily ops surfaces + Daily Ops Log / Admin sections)
Eli explicitly wants these pages' LAYOUTS rethought too (2026-08-06), via the
mock-first working method — see Phase B.

**Neither designed nor built — DESIGN + BUILD from scratch:**
- **HR pages: Punches, Hiring, Training** — HR-SPEC defines what they DO; nobody has
  drawn what they LOOK like, and no code exists. The rail ships with these as stubs
  until designed. Full working method applies: mock → Eli picks → spec ruling → build.
- SOP page — **FENCED. `public/sop.html` is its own future project. Do not touch.**

## BUILD ORDER (agreed with Eli)

**Phase A — the frame first.** Build §14: rail replaces top nav app-wide, new
dashboard, Flo box (static briefing content, "Ask Flo →" dead for now; My Day duties
static/stub — no backend yet; Tasks wired to the real `dashboard_tasks` system).
HR nav items = stubs. Propose mobile rail behavior to Eli before building it.
One commit per coherent chunk; Eli reviews on preview before anything merges.

**Phase B — redesign the existing pages into the new frame, one at a time:** WO Hub,
Tasks, Flags log, Mic inventory, Daily Ops, Runner hub. These WORK today — the data
flow, realtime wiring, and features stay untouched, but **Eli wants their LAYOUTS
rethought, not just repainted** (decided 2026-08-06 — this supersedes the older
"layout is Eli's, surface is yours" restriction for these pages). Use the working
method: mock 2–4 layout options per page, Eli picks, ruling into spec, build. Apply
the dashboard lessons: packing law, console thinking, information you need first
goes first. The calendar remains FROZEN regardless.

**Phase C — HR pages (design + build from nothing):** mock per working method below,
then build per HR-SPEC.

## WORKING METHOD for undesigned pages (proven all project)
2–4 self-contained HTML mockup options in `docs/design-refs/` → Eli picks (often with
tweaks; iterate) → write the ruling into the spec THAT MOMENT → build from the
reference file via port protocol. Files are truth; prose gets lost.

## HARD-WON LESSONS (do not relearn)
1. A stale/wrong spec gets faithfully implemented. Update the spec the moment a
   ruling happens — before building.
2. Port protocol beats prose: copy reference markup/CSS verbatim, translate
   tokens/polarity. Re-describing a pattern has failed twice before.
3. Theme polarity: app dark = absence of `data-theme`; mocks are the opposite.
4. Calendar and data tables are EXEMPT from the no-lines law. Grids are structure.
5. Field width follows content (IdWell). Raised elements never nest. Segmented
   controls: one raised housing, selected option pressed-in.
6. Colour = status only. Hot doubles as critical/destructive. Warm is never a warning.
   Glow = Flo exclusively (§7/§14) — nothing else may ever glow.
7. Packing law: panes hug content; never inflate small info to fill a big box.
8. When one edge case misbehaves, fix the edge case — don't redesign the population.
9. Eli's feedback loop is screenshots. If a change can't be seen, say what to look at.
10. The end-of-session ritual in CLAUDE.md (PROJECT_LOG, CHANGELOG, Tech-Stack,
    sop VERSIONS, testBatches) applies to build sessions. Do all five when Eli wraps.
