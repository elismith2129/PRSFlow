# PRSFlo Design System — Implementation Spec
### "Carved" · approved 2026-07-30 · handoff to implementing Claude (Opus 5)

**Companion file: `prsflo-final-mock.html`** — a self-contained mock of the approved system
with a light/dark toggle. It is the visual source of truth. When this document and the mock
disagree, the mock wins; tell Eli about the discrepancy.

This spec is the result of a full-day design exploration with Eli. Every value in here was
chosen deliberately, usually after seeing 3–5 alternatives. Do not "improve" values. Do not
substitute similar colors, radii, or shadows. Where you need something this spec doesn't
define, derive it from the laws below and flag it in your handoff notes.

---

## 0. Context — what this replaces and why

The current light mode is 63 `[data-theme="light"]` override rules in `styles/globals.css`,
20 of which match on inline-style substrings, over 2,720 inline `style={{}}` objects. It is
a patch layer over a dark-only design. This project replaces it with a real token +
primitive system, both themes designed first-class. The goal state: the substring-matching
override rules can eventually be **deleted**, not added to.

**Read before writing any code:** `docs/ONBOARDING.md` (§5 Landmines), `CLAUDE.md` (locked
conventions + architecture rules), `docs/AUDIT-2026-07.md` item 10, `docs/CHANGELOG.md`.

---

## 1. Workflow — non-negotiable

- Eli is not a developer. You edit files; he runs git/SQL only when he must. After every
  change set, hand him ONE complete copy-paste terminal line. Never say "commit and push"
  without the exact command.
- `npx tsc --noEmit` passes before every handoff. `noImplicitAny` is on.
- **Everything on a branch.** Suggested: `redesign/carved`. Nothing reaches `main` until
  Eli says staff testing is finished. Every push → Vercel preview URL; that is how Eli
  reviews. He cannot run a local dev server.
- **NEVER `git add -A`.** Stage only your own files by name. Other chats are open on this
  repo. Shared/contested files — tell Eli before touching: `Nav.tsx`,
  `app/(main)/layout.tsx`, `CLAUDE.md`, `docs/PROJECT_LOG.md`, `docs/CHANGELOG.md`,
  `docs/PRSFlow-Tech-Stack.md`, `public/sop.html`.
- **Do NOT touch `public/sop.html`** — standalone iframe HTML, separate roadmap project.
- **Mobile rule:** desktop output stays byte-for-byte unchanged; mobile is always an
  `isMobile ?` branch (`hooks/useIsMobile`, 768px) whose desktop side is the original.
- Order of work (do not skip ahead):
  1. Token set in `globals.css` (new tokens alongside old — nothing breaks).
  2. Primitives (see §8) consuming tokens only.
  3. **Style guide page** at `/dev-style` (or a DEV-tab section): every primitive and
     state, both themes, side-by-side toggle. Eli approves this on a preview URL first.
  4. ONE real surface as proof — Dashboard or CRM lead list (Eli's pick). Approval again.
  5. Only then migrate remaining surfaces one at a time, deleting inline-style forests
     and their matching override rules as you go.

---

## 2. The five laws (memorize these)

1. **No lines.** No borders, outlines, hairlines, or dividers anywhere. Grouping comes
   from wash fills and carved depth. If you are about to type `border:`, stop (exceptions:
   `border-radius`, and nothing else).
2. **Carved affordance.** Everything that HOLDS content is carved IN (inset shadows):
   panels, cards, inputs, list rows, calendar rows, room cards. Everything you PRESS
   sticks OUT (raised shadows): buttons, pills, toggles, filter chips, calendar event
   chips. A pressed control depresses INTO the surface on `:active`. Display anchors
   (date chip, totals, section-header lozenges) rest ON the surface with a slight lift —
   objects, not holes, not pressable.
3. **Colour is status, nothing else.** The chromatic palette (§5) may appear ONLY as:
   CRM lead temperature, calendar/session status (including dashboard room cards and
   their pools), and analytics charts/stat accents (they chart lead status). Everything
   else is ink, paper, and wash. No accent colour exists in this system.
4. **Two registers.** Light mode runs the status palette at full brightness. Dark mode
   is a dim room: same palette values, dimmed by rule (§6) — never a second palette.
5. **Dark mode has no large bright surfaces.** In dark, big surfaces use wash elevation
   with light text. Only SMALL elements (buttons, counts, today-pill, active nav pill)
   may be ivory `#d5d0c2` with dark text.

---

## 3. Tokens — both themes first-class

```css
:root{                                /* LIGHT — warm paper, soft charcoal ink */
  --bg:      #f5f3ee;
  --fg:      #2a2722;
  --wash:    rgba(42,39,34,.05);      /* grouping fill, level 1 */
  --wash2:   rgba(42,39,34,.095);     /* grouping fill, level 2 */
  --chip-ink:#1c2626;                 /* text ON status fills */
  /* status — Lagoon (bright register) */
  --st-hot:    #ff5a4d;               /* signal red — pale text #fff4f2 on hot fills */
  --st-warm:   #9d8cff;               /* violet   */
  --st-cold:   #5fc9e8;               /* lagoon   */
  --st-booked: #43dfae;               /* sea green — confirmed/booked/live */
  --st-uncon:  #7fb2e5;               /* harbor — uncontacted/tour */
  --st-dead:   #cfd6d4;               /* driftglass — DNB/tech/open */
}
[data-theme="dark"]{                  /* DARK — the dim room */
  --bg:      #1b1a17;
  --fg:      #d9d6cd;                 /* warm ivory, NOT white */
  --wash:    rgba(217,214,205,.07);
  --wash2:   rgba(217,214,205,.13);
  /* status values unchanged — dimming is a rule, not a second palette (§6) */
}
```

Also define semantic aliases so components never reference raw slots:
`--ivory:#d5d0c2` (dark-mode small accents), `--hot-text:#fff4f2`.

Legacy tokens (`--surface`, `--accent`, `--accent-rgb`, etc.) remain until their last
consumer is migrated, then die. The lime/teal accent system is retired: **there is no
accent colour**. (Historical rule "accent tints must be rgba(var(--accent-rgb),a)" becomes
moot; do not reintroduce an accent.)

---

## 4. Typography

- **Archivo Black** (Google Fonts) — display only, always `font-weight:400`, never bolded.
  Page greetings, big numbers, artist names on room cards/calendar chips, stat numerals,
  brand line. Display sizes use negative tracking (−.01em to −.03em).
- **Inter** (already loaded) — body/UI. Weights 400/700/800 only.
- **DM Mono** (already loaded) — code-like things only: timestamps, invoice/WO numbers,
  times, initials, PIN pad. (Mock uses ui-monospace; in-app use DM Mono.)
- **Labels:** 9–10.5px, weight 800, letter-spacing .06–.14em, uppercase, reduced opacity.
  The scale gap is the style: big display with negative tracking, tiny tracked-out labels,
  little in between.
- Greeting/heads are **mixed case** (e.g., "Paramount Recording Studios") — the all-caps
  shout was deliberately retired for comfort. Small labels stay uppercase.
- Syne and DM Serif Display are retired from the app UI by this redesign.

**Wordmark — ASK FIRST.** The mock reinterprets the wordmark as Archivo Black
`PRS` (full) + `FLO` (opacity .45), tracking −.02em. This CONFLICTS with the locked
Syne wordmark in `CLAUDE.md` / `Nav.tsx` (also a shared file). Eli approved this
direction in exploration, but before touching `Nav.tsx` or the locked rule: confirm with
Eli explicitly, and coordinate because other chats may be mid-edit in that file.

---

## 5. Status system — the only colour

Scope (Law 3): lead temps, session/calendar status, analytics. Mapping:

| Meaning | Token | Notes |
|---|---|---|
| Hot lead / urgent | `--st-hot` | text on hot fills is `#fff4f2`, all other chips use `--chip-ink` |
| Warm lead / tentative session | `--st-warm` | |
| Cold lead | `--st-cold` | |
| Booked lead / confirmed session / live room | `--st-booked` | |
| Uncontacted lead / tour | `--st-uncon` | |
| DNB / tech / open hours | `--st-dead` | |
| Cancelled session | `--st-hot` fill + line-through title | |

Presentation: status is always a **solid fill** (pill, chip, dot, or room pool) with
`--chip-ink` text — never colored text on paper, never an outline. Calendar event chips
are solid fills with Archivo titles. Dashboard room cards with sessions are colored pools
**carved into** the surface (see §7 recipes) — they are calendar status and therefore
colored; this was an explicit decision.

Analytics: donut segments and stat-card fills draw from this palette only; chart text
stays ink.

---

## 6. The two registers (light bright / dark dim)

Dark mode dims the SAME palette by rule:

```css
/* pills & filter chips */
[data-theme="dark"] .status-pill { filter: saturate(.82) brightness(.88); }
/* calendar chips — alpha fills instead of solid */
[data-theme="dark"] .chip-booked { background: rgba(67,223,174,.72); }
[data-theme="dark"] .chip-tent   { background: rgba(157,140,255,.68); }
[data-theme="dark"] .chip-tour   { background: rgba(127,178,229,.68); }
[data-theme="dark"] .chip-dead   { background: rgba(204,209,207,.5);  }
/* room pools */
[data-theme="dark"] .room-booked { background: rgba(67,223,174,.18); color: var(--fg); }
```

Dark surface law (Law 5): section headers, table heads, date chip, totals bar, selected
rows, stat blocks → `--wash2` background + `--fg` text in dark. Small accents only
(primary buttons, count badges, today pill, active nav) → `--ivory` bg + `#1b1a17` text.

---

## 7. Carved depth — exact recipes

Light source is top-left, always, both themes. Content (text, chips) never receives blur.

```css
/* CONTAINERS — carved in */
.panel{ background:var(--bg); border-radius:40px;
  box-shadow: inset 5px 5px 14px rgba(42,39,34,.08),
              inset -5px -5px 14px rgba(255,255,255,.7); }
[data-theme="dark"] .panel{
  box-shadow: inset 5px 5px 15px rgba(0,0,0,.4),
              inset -5px -5px 15px rgba(255,255,255,.03); }

/* second-level cuts: inputs, empty room cards, tasks, alternating calendar rows */
.inset-2{ background:var(--bg);
  box-shadow: inset 3px 3px 8px rgba(42,39,34,.07),
              inset -3px -3px 8px rgba(255,255,255,.65); }
[data-theme="dark"] .inset-2{
  box-shadow: inset 3px 3px 9px rgba(0,0,0,.34),
              inset -3px -3px 9px rgba(255,255,255,.03); }

/* colored pools (booked/tentative room cards): status fill + carved in */
.pool{ background:var(--st-booked); color:var(--chip-ink);
  box-shadow: inset 3px 3px 8px rgba(0,0,0,.16),
              inset -2px -2px 6px rgba(255,255,255,.25); }
[data-theme="dark"] .pool{
  box-shadow: inset 3px 3px 9px rgba(0,0,0,.35),
              inset -2px -2px 6px rgba(255,255,255,.06); }

/* CONTROLS — raised, always */
.raised{ box-shadow: 2px 2px 6px rgba(42,39,34,.09),
                     -2px -2px 6px rgba(255,255,255,.7); }
.raised-primary{ box-shadow: 3px 3px 9px rgba(42,39,34,.28),
                             -2px -2px 6px rgba(255,255,255,.5); }
.raised-chip{ box-shadow: 2.5px 2.5px 7px rgba(42,39,34,.2),
                          -1px -1px 4px rgba(255,255,255,.35); }
/* dark: shade rgba(0,0,0,.38–.55), highlight rgba(255,255,255,.035–.05) */

/* THE PRESS — any control while held */
.control:active{ transform: translateY(1px);
  box-shadow: inset 3px 3px 7px rgba(0,0,0,.28); }

/* DISPLAY ANCHORS — rest on the surface */
.anchor{ box-shadow: 2px 2px 7px rgba(42,39,34,.22); }
[data-theme="dark"] .anchor{ box-shadow: 2px 2px 8px rgba(0,0,0,.5); }
```

**No fog.** Eli evaluated fog/glow at four levels and chose zero. Do not add glows,
outer halos, or blur-based atmosphere. (Grain/vignette/breath experiments were also
not adopted — only the new-lead pulse below carries motion.)

Geometry: panels/cards 40px; room cards 26px; calendar rows 26px; list rows and
section-header lozenges 99px (capsules); inputs 99px; buttons/pills 99px; calendar
chips 14px; count badges 99px. Everything rounded; nothing square.

Interaction transitions: `transition: transform .16s ease, box-shadow .16s ease` on
controls; hover may lift 1–2px. Respect `prefers-reduced-motion`.

---

## 8. Primitives to build (consume tokens only — zero inline styles)

`Button` (raised; primary = ink fill light / ivory dark; press-in on active),
`SoftButton/Pill` (wash raised; `.on` = ink/ivory fill, still raised),
`Input` (carved in, 99px, wash focus → wash2, no outline — focus is depth change; if an
a11y focus indicator is required use a soft outer shadow ring, never `outline`/border),
`Card/Panel` (carved container + capsule header lozenge: ink bar light / wash2 dark),
`StatusPill` (solid status fill + chip-ink; hot gets `--hot-text`),
`StatusDot`, `RoomCard` (empty = inset-2 dim; session = pool),
`EventChip` (raised, solid status, Archivo title, mono engineer tag),
`Badge/Count` (ink light / ivory dark),
`Table` (header = capsule lozenge, rows = spacing + alternating carved rows, no rules),
`Modal` (carved panel floating: use a soft drop shadow — the one permitted outer shadow
besides raised controls), `SectionHeader` (extend the existing component, don't duplicate),
`NewLeadPulse` (§9).

Existing `SectionHeader` and `StatusBadge` components: extend, never duplicate.

---

## 9. New-lead pulse (approved)

New/unactioned leads get a pulsing dot — **no new colour**, the system's own ink:

```css
.newpulse{ width:9px; height:9px; border-radius:50%; flex-shrink:0;
  background:rgba(42,39,34,.85);            /* light: shade of ink */
  animation:newpulse 1.6s ease-in-out infinite; }
[data-theme="dark"] .newpulse{ background:#f0ede4; }  /* dark: soft white */
@keyframes newpulse{ 0%,100%{opacity:.25} 50%{opacity:1} }
@media (prefers-reduced-motion: reduce){ .newpulse{ animation:none; opacity:1 } }
```

Placement: leading position in the lead row (dashboard Needs-Action and CRM list),
next to the name. It marks "new/never contacted", alongside — not replacing — the
uncontacted status pill. This is the ONLY blinking element in the app. Nothing else
may pulse.

---

## 10. Calendar — FENCED OFF

The calendar **layout** is untouched and locked: 11 studios stacked as rows grouped by
location, days sliding horizontally, spanning multi-day bars, location group headers.
Eli built it intentionally. This redesign restyles ONLY: solid status-fill chips
(§5/§6), alternating carved rows, capsule location lozenges, no grid lines, legend as
dots + labels. Zero structural or behavioral changes. When migrating the calendar
surface, change classes/styles only — if a layout change ever seems necessary, stop
and ask Eli.

---

## 11. Verification per handoff

- `npx tsc --noEmit` clean.
- Both themes checked on the preview URL, including: no `border` rules introduced; no
  large bright surfaces in dark; status colour appearing nowhere outside §5 scope;
  controls raised / containers carved (spot-check any new component against Law 2);
  only `.newpulse` animates.
- Grep check before each merge-up: count of `[data-theme="light"]` substring-override
  rules in globals.css must be monotonically decreasing across the migration.
- One copy-paste git line for Eli, staging files by name.

## 12. What NOT to do

- No accent colour, ever. No lime, no teal — they're retired.
- No borders/outlines/dividers (Law 1). No fog/glow/halos (§7).
- No new blinking/pulsing elements beyond `.newpulse`.
- No touching `public/sop.html`, no `git add -A`, nothing to `main` until Eli says.
- No wordmark/`Nav.tsx` changes without Eli's explicit go (§4).
- No layout redesigns anywhere — this project restyles existing layouts. Layout is
  Eli's, surface is yours.
- Do not migrate the whole app before the style guide and the single proof surface
  are approved on preview URLs.
