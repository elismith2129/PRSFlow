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

The current light mode is a pile of `[data-theme="light"]` override rules in
`styles/globals.css` (**verified baseline: 66 rules** as of `main@4c9f252` — this is the
number §11 tracks), ~20 of which match on inline-style substrings, over 2,720 inline
`style={{}}` objects. It is
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

**Naming (LOCKED, decided during implementation kickoff):** the live app already defines
`--bg` (dark `#0d0f14`; light `transparent` — the html gradient shows through) with 66
override rules plus the splash/AuthGuard depending on it. New tokens therefore carry a
**permanent `--c-` prefix** — including names that don't collide, so `--c-` greps the
entire new system. Legacy tokens keep their names and die individually with their last
consumer. There will be **no end-of-project rename sweep** to reclaim clean names.

```css
:root{                                /* LIGHT — warm paper, soft charcoal ink */
  --c-bg:      #f5f3ee;
  --c-fg:      #2a2722;
  --c-wash:    rgba(42,39,34,.05);    /* grouping fill, level 1 */
  --c-wash2:   rgba(42,39,34,.095);   /* grouping fill, level 2 */
  --c-chip-ink:#1c2626;               /* text ON status fills */
  /* status — Lagoon (bright register) */
  --c-st-hot:    #ff5a4d;             /* signal red — pale text #fff4f2 on hot fills */
  --c-st-warm:   #ffa94d;             /* amber-orange (changed from violet #9d8cff, 2026-07-31) */
  --c-st-cold:   #5fc9e8;             /* lagoon   */
  --c-st-booked: #43dfae;             /* sea green — confirmed/booked/live */
  --c-st-uncon:  #7fb2e5;             /* harbor — uncontacted/tour */
  --c-st-dead:   #cfd6d4;             /* driftglass — DNB/tech/open */
}
[data-theme="dark"]{                  /* DARK — the dim room */
  --c-bg:      #1b1a17;
  --c-fg:      #d9d6cd;               /* warm ivory, NOT white */
  --c-wash:    rgba(217,214,205,.07);
  --c-wash2:   rgba(217,214,205,.13);
  /* status values unchanged — dimming is a rule, not a second palette (§6) */
}
```

Also define semantic aliases so components never reference raw slots:
`--c-ivory:#d5d0c2` (dark-mode small accents), `--c-hot-text:#fff4f2`.

(All other CSS in this spec is written with unprefixed names for readability — in the
app, every token reference is the `--c-` version. The mock uses unprefixed names; the
mock is visual truth, not naming truth.)

**⚠ THEME POLARITY — the app is inverted from this spec and the mock.** In the live app,
dark mode is the ABSENCE of `data-theme` (`Nav.tsx` calls `removeAttribute`);
`[data-theme="dark"]` is never set and would match nothing. Therefore in the app: dark
values live on `:root`, light values live on `[data-theme="light"]` overrides after it.
Every `[data-theme="dark"]` block in this spec and the mock must be read as "the `:root`
defaults" and every unmarked `:root` block as "the `[data-theme="light"]` overrides."
This was discovered and handled correctly in step 1 (2026-07-30); the comment header in
`globals.css` documents it at the token block.

**Fonts:** Archivo Black is NOT currently loaded (the `@import` has DM Serif, DM Mono,
Inter, Syne). Add Archivo Black to the import in the same change set as the tokens.

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
| Critical / destructive (RULING 2026-07-31) | `--st-hot` | missing-info banners, Delete buttons — hot is formally dual-purpose. `--st-warm` is lead-temp/tentative ONLY, never warnings |

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
[data-theme="dark"] .chip-tent   { background: rgba(255,169,77,.68); }
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

**`IdWell` (RULING 2026-08-02):** short identifier fields (invoice #, PO #, WO #, and any
field whose content is ~a handful of characters) render as wells with the label INSIDE as
a micro-caps prefix ("INV # ___"), and they SHARE rows at natural widths — never a full-width
row each. General law: **field width follows content width; short fields share rows.**
Reference: docs/design-refs/wo-meta-compact.html (option B, plus A's food-budget toggle).
Conditional reveal pattern: a segmented No/Yes control may reveal an adjacent amount/detail
well when Yes; the well hides (value preserved, not cleared) when toggled back to No.

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
Eli built it intentionally.

**GRID EXEMPTION (RULING 2026-08-01):** the calendar is exempt from Law 1. Position is
information on this surface, and the grid that encodes it is functional, not decorative.
Required: visible row separators (1px, `--c-fg` at ~10–14% light / ~14–18% dark),
day-column ticks at every day boundary with a heavier tick at week boundaries and the
month boundary, and full-width location header bars (ink light / wash2+fg dark) — not
floating lozenges. Row heights stay at the old calendar's density; the redesign may not
cost vertical compactness. Event chips keep the full info payload: Archivo artist, client
line, mono times, mono engineer tags — all in `--c-chip-ink` (secondary lines at ~70%
opacity of chip-ink, never grey). Multi-day bars must render their title (pinned at the
bar's start). Everything else on the surface (toolbar, view segments, buttons) follows
the standard system rules. When migrating the calendar
surface, change classes/styles only — if a layout change ever seems necessary, stop
and ask Eli.

---

## 10b. Calendar card — final anatomy (RULING 2026-08-02)

Fill = session status (continuity with the WordPress wall: blue→`--st-booked` confirmed,
gold→`--st-warm` tentative; staff instincts preserved). Card anatomy, top to bottom:
1. Payload (slides as one unit on long bars): Archivo artist/label · client line · mono
   times, left-aligned.
2. Footer band (darker overlay strip inside the chip): WO# / invoice# (mono, left) ·
   engineer tags 1ST-XX · 2ND-XX (right).
3. COD strip: full-width `--st-hot` bar with `--hot-text`, bottom edge of the chip,
   ONLY when payment is COD (+ method: "COD ZELLE" etc.). Billing = no payment element
   at all — silence means billing. Sanctioned under hot-as-critical (§5).
All fields render at 60px column width and up (no tiers, ellipsis allowed). Hover card
carries the long tail: full staff names, WO# + INV#, payment pill, status pill. No rates
or amounts anywhere on calendar or hover.

## 13. TV display mode (`/display/[room-slug]`) — design decisions, build later

Roadmap project (after calendar module ships), decisions locked now:
- Same card DNA as §10b — the card is already hover-independent by design (everything
  visible). No hover-only information may ever exist on calendar cards for this reason.
- Frame: traditional fixed month-grid per room, no zoom, no interaction, read-only,
  auto-refreshing (realtime standard), no login (matches current WordPress-wall practice,
  incl. visible COD/eng/WO# — Eli-accepted).
- Ten-foot minimums: artist ≥ 15px equivalent at TV resolution, times/mono ≥ 12px,
  COD strip full-width and unmissable. Dark register only (the wall runs dark).

## 11. Verification per handoff

- `npx tsc --noEmit` clean.
- Both themes checked on the preview URL, including: no `border` rules introduced; no
  large bright surfaces in dark; status colour appearing nowhere outside §5 scope;
  controls raised / containers carved (spot-check any new component against Law 2);
  only `.newpulse` animates.
- Grep check before each merge-up: the metric is the count of `[style*=` substring-matcher
  rules in globals.css — the actual fragile layer — and it must be monotonically
  decreasing across the migration. **Baseline: 58** (verified at `main@4c9f252`).
  (Superseded metric: raw `[data-theme="light"]` rule count — it counts legitimate
  light-token blocks too and moved 66→68 just from adding the inert token set. The
  63/65/66 figures in older docs all counted slightly different things; ignore them.)
- One copy-paste git line for Eli, staging files by name.

## 12. What NOT to do

- No accent colour, ever. No lime, no teal — they're retired.
- No borders/outlines/dividers (Law 1). No fog/glow/halos (§7).
- No new blinking/pulsing elements beyond `.newpulse`.
- No touching `public/sop.html`, no `git add -A`, nothing to `main` until Eli says.
  (This overrides the older standing CC-prompt rule that ended prompts with
  `git add -A && git commit && git push` — that rule predates multiple chats sharing
  this repo. Stage by name, always.)
- No wordmark/`Nav.tsx` changes without Eli's explicit go (§4).
- No layout redesigns anywhere — this project restyles existing layouts. Layout is
  Eli's, surface is yours.
- Do not migrate the whole app before the style guide and the single proof surface
  are approved on preview URLs.
