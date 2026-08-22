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

## 2b. Density law (RULING 2026-08-07)

Born on the CRM after the carved migration: the recipes were right but the scale drifted
big — 40px wells, three-line list rows, a lead profile that scrolled its whole length.
Eli's ruling, **app-wide**:

- **Compact is the default.** Nothing may be so big that routine information needs
  scrolling. A list surface shows **at least ~10 rows** on a laptop; a detail panel
  (lead profile: contact, session, notes, activity, delete) fits in **one viewport**.
- **List rows are ONE line:** identity on the left, metadata trailing to the RIGHT on
  the same line (muted, ellipsised), then the row's actions. Sub-lines under the name
  are retired on desktop (mobile may stack — narrow screens are exempt).
- **Compact scale (the new primitive values, single source in globals.css):**
  wells/inputs 32px high (was 40), area min-height 64 (was 110), band padding 10×12
  (was 14×15), row padding 6×12 (was 13×16), avatar 26 (was 36), profile hero 22
  (was 28), lozenge 7×14 (was 10×18). Buttons/pills drop ~1–2px of padding.
- Field width still follows content (IdWell law §8); grids that share a row use
  `minmax(0,1fr)` columns and modest gaps so content can never push a sibling out
  of the panel (the session-date/quote overflow this ruling fixed).
- This extends the packing law (§14b): panes hug content AND the content itself
  stays small. When porting mocks, treat mock sizes as the CEILING, not the floor.

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

**CASING AMENDED (RULING 2026-08-22):** the second segment is `Flo` — capital F,
lowercase l-o, the original casing restored — not `FLO`. Face and treatment unchanged
(Archivo Black, .45 opacity, −.02em). Eli auditioned Archivo Black against Syne, Inter
and DM Mono on `docs/design-refs/brand-mark-options.html` and re-confirmed Archivo.
`components/layout/Wordmark.tsx` is the single source; it renders `PRS` + `Flo`.

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
**ONE exception (RULING 2026-08-05): the Flo box (§14).** Glow means AI presence,
app-wide. Flo's ring + halo are the only glow in the system — which is exactly why
nothing else may glow: the signal only works if it's exclusive.

Geometry: panels/cards 40px; room cards 26px; calendar rows 26px; list rows and
section-header lozenges 99px (capsules); inputs 99px; buttons/pills 99px; calendar
chips 14px; count badges 99px. Everything rounded; nothing square.

Interaction transitions: `transition: transform .16s ease, box-shadow .16s ease` on
controls; hover may lift 1–2px. Respect `prefers-reduced-motion`.

---

## 7c. SOFT SKIN (RULING 2026-08-07 — SUPERSEDES §7's carved recipes app-wide)

Eli lived with carved and found the depth distracting. Reference:
`docs/design-refs/dashboard-flat-skins.html`, option **C · Soft** — chosen over
wash (A) and hairline (B). The carved recipes are RETIRED everywhere:

- **Containers are flat raised surfaces:** `--c-srf` (light `#ffffff` / dark
  `#242320`) with the faint drop shadow `--c-softsh`. No inset carving anywhere.
- **Second-level holders** (wells, inputs, textareas, list/task rows, empty room
  cards) are flat `--c-wash` fills; focus stays a fill change (`--c-wash2`).
- **Controls** keep their raised MEANING with a flat treatment: small drop shadow
  `--c-ctlsh`; press = translateY(1px) + wash2 fill — no inset press.
- **Selected states are fills, not carves** (selected row = wash2; selected
  segment = ink/ivory fill, shadowless; status-filled segments keep §8's rule).
- **Status pools** keep their alpha fills, shadowless.
- Law 1 (no lines) STILL STANDS. Law 2's carve-in/raise-out language is
  superseded by this section. §7's recipe block is dead law kept for history.
- The Flo ring + halo (§14c) are untouched — glow = AI, in every skin.
- **Implementation:** one `SOFT SKIN` override block at the END of globals.css
  (cascade beats the carved rules above it) — reviewable, reversible. New
  surfaces should target the soft values directly.

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

**Segmented controls (RULING 2026-08-05):** A segmented control is ONE raised housing
containing its options; the selected option is pressed-in + filled. Options are NEVER
individual raised elements. Raised elements never nest inside other raised elements —
containment depth is panel → control, nothing between.
(Failure this fixes: every option group on the WO popup was built as separate raised pills
sitting inside a raised box — "bubbles in bubbles". The housing is what says "these are the
choices for one field"; loose pills say "here are several unrelated buttons".)
Where the field IS status, the pressed segment fills with its STATUS colour rather than
ink/ivory — sanctioned under §5, because there the colour is the meaning.

**TABLE EXEMPTION (RULING 2026-08-03):** data tables (studio time, rentals, payments,
equipment condition, and any row-per-record editing grid) are FLAT — no wells, no carving,
no per-cell bubbles, no borders. The grid is the container; cells are bare text/inputs.
Construction: header = capsule lozenge as now; rows delineated by alternating wash zebra
(no rules); editable cells are transparent inputs, mono where numeric/time, that show a
wash fill on hover/focus only; column widths follow content (times must fit "10:00 PM"
uncut); tiny controls (Day/Hr segment, ✓, ×) stay as-is. Same both themes.
**AMENDMENT (2026-08-07): data-entry tables whose rows start EMPTY (rentals,
payments) use `.c-tin-show` — a persistent wash2 chip on every input, all
states — because a blank transparent row reads as one long bar and nothing
says "five fields live here." Tables that render existing records (studio
time) keep the hover/focus-only rule.**

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

**Month orientation (RULING 2026-08-03):** a sticky month rail sits above the day header —
each month a segment as wide as its days, name in Archivo pinned `position:sticky; left`
so it stays at the viewport's left edge while its days are visible and is pushed out by
the next month's label at the boundary. Alternating months additionally get a whisper of
ground tint on their columns, and month boundaries keep the heavier tick. Reference:
docs/design-refs/calendar-month-orientation.html (option A).

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
- No borders/outlines/dividers (Law 1). No fog/glow/halos (§7) — except the Flo box (§14),
  the single sanctioned glow.
- No new blinking/pulsing elements beyond `.newpulse` and the Flo Aurora ring (§14).
- No touching `public/sop.html`, no `git add -A`, nothing to `main` until Eli says.
  (This overrides the older standing CC-prompt rule that ended prompts with
  `git add -A && git commit && git push` — that rule predates multiple chats sharing
  this repo. Stage by name, always.)
- No wordmark/`Nav.tsx` changes without Eli's explicit go (§4).
- No layout redesigns anywhere — this project restyles existing layouts. Layout is
  Eli's, surface is yours. (The dashboard + side nav are the sanctioned exception:
  Eli designed that layout himself across seven mockup rounds — §14 IS the layout.)
- Do not migrate the whole app before the style guide and the single proof surface
  are approved on preview URLs.

---

## 14. Dashboard, side nav & the Flo box (RULING 2026-08-05)

**Reference law: `docs/design-refs/dashboard-final.html`.** Approved after seven mockup
rounds; Eli designed the console architecture himself. Copy values from the file, never
from this prose. HR context lives in `docs/HR-SPEC.md` (side nav = §2.5a; My Day vs
Tasks = §2.6–2.8, §12.9–11).

### 14a. Side nav (replaces the top nav app-wide)

176px fixed left rail (RULING 2026-08-07: slimmed from the mock's 212px under the
§2b density law — less real estate; link padding/font trimmed to match), wash fill,
full height. Structure top→bottom: wordmark →
ungrouped trio (Dashboard, Calendar, Daily Ops) → BUSINESS group (CRM, WO Hub, Tasks,
Flags) → STUDIO group (Mic Inventory, Runner Hub, Nadine's) → HR group (Punches,
Hiring, Training) → foot pinned to bottom (Admin, SOP, DEV dimmed). Group labels are
the standard uppercase micro-label. Active item = filled pill (ink-on-paper light /
ivory-on-charcoal dark, raised shadow) — the same treatment as every selected control.
Badges are functional counts only, right-aligned: hot = needs-you-now (red),
warm = attention (orange), dim wash = neutral count. No badge without a real count
behind it. The wordmark renders per §4 (component, never re-implemented).
Existing routes keep working — the rail replaces `Nav.tsx`'s tab row as the app frame;
mobile behavior TBD in implementation (propose, don't invent silently).

### 14b. Dashboard — the console layout

Solo padded header: greeting micro-label over "Paramount Recording Studios" (Archivo,
28px), then flex-grow, view-as toggle (segmented housing per §8), datechip anchor.
Nothing else lives in the header.

**LAYOUT SUPERSEDED (RULING 2026-08-07 — "COMMAND ROW", Eli picked option A of
`docs/design-refs/dashboard-console-v2-options.html`; that file is the reference):**

- **COMMAND ROW (full-width strip under the header):** the PIPELINE block +
  the four studio cards.
  - **Pipeline** (renamed from Needs Action — it is an INDICATOR, not a list; you
    deal with leads in the CRM): big Archivo count of leads needing action, sub-line
    `N hot · N warm · N uncontacted`, "CRM →". Below it, THE LOUD BAR: a solid
    `--c-st-hot` bar with the pulse dot — `N NEW INQUIRIES` — unmissable, present
    only when unacked web inquiries exist (quiet wash line otherwise). Sanctioned
    under hot-as-needs-you-now. The name list is gone from the dashboard.
  - **Studio cards** (the daily-ops cards return): PRS/ARS/ERS/TRK, venue name,
    big session count for the viewed day, "N live" chip when confirmed sessions
    exist. Route to Daily Ops.
- **BELOW, two columns `1.35fr 1fr`:**
  - LEFT: THE CONSOLE — Flo box on top, then **My Day and My Tasks SIDE BY SIDE**
    (two stacked to-do lists bury the bottom one — ruling). Tasks are personal
    (name-tabs shelved; roster logic kept in lib/tasks, unrendered; assign lives
    in the add modal), capped (never grows the pane). Under the console: staff
    14-day grid + a compact Flags indicator (count + latest, "All →" to /flags,
    "+ add" keeps quick reporting).
  - RIGHT: Today's Sessions — rooms 2-wide, 12 rooms, day nav kept. The header
    loc-count chips are DROPPED (the studio cards now carry the counts).
- Everything is capped; nothing on the page can grow or rearrange.

**Rooms are 12, in this order:** PRS A, B, C, E, X, Nadine's → ARS A, B → ERS A, B →
TRK N, S. Nadine's is PRS's sixth room.

View-as (Eli/Fernando) swaps: greeting, briefing bullets + synopsis, My Day contents,
default task tab, and hides the staff grid for non-Eli. My Day ≠ Tasks: duties are
fixed per role and reset daily; tasks are add-able to-dos. Never merge them.

**Packing law (app-wide, born here):** every pane hugs its content — blocks are their
honest size, layout is packing, not inflating. Never stretch a small piece of
information to fill a big box. If a column ends short, it ends short.

### 14c. The Flo box — the AI surface

Flo is the branded AI assistant; this box opens the console and is the app's single
AI mouthpiece (briefings now, chat/actions later — "Ask Flo →" is the door).

Recipe (copy from dashboard-final.html):
- **Flat surface. No inset carving in either theme.** Flo is a presence outlined in
  light, never a hole in the material. This is deliberate contrast with Law 2 —
  and permitted only here.
- `--flo-ink` token: `42,39,34` light / `213,208,194` dark (bare RGB triplet, consumed
  via `rgba(var(--flo-ink), a)`).
- Ring: `.ringwrap` (radius 15px, `overflow:hidden`, `padding:1.5px`, faint halo
  `0 0 16px 3px rgba(var(--flo-ink),.045)`) + spinning `::before` (`inset:-120%`,
  conic-gradient Aurora band: `.06 → .32 @90deg → .06 @200deg`, `8s linear infinite`)
  + `.inner` painting `var(--bg)` back at radius 13.5px, leaving the 1.5px live edge.
- Header: the PRSFlo wave mark + "Flo" (Archivo 14px) + micro-tag "· Your briefing ·
  {date}". (RULING 2026-08-07: Flo's mark IS `components/PRSFloIcon.tsx` — the brand
  icon, not the mock's placeholder squiggle. One mark, brand and AI.)
- Body: status-dotted bullets (dots use §5 status colours; alert line takes hot ink),
  italic one-line synopsis, "Ask Flo →" affordance.
- `prefers-reduced-motion`: animation off, static ring stays.

**Glow = AI, exclusively.** The ring + halo are the only glow in the app (§7 exception).
No other element may ever glow, breathe, or orbit — the moment something else glows,
Flo stops meaning anything. (Motion candidates comet/twin-orbit/heartbeat/ripple/ember
were evaluated and rejected; Aurora at the dialed values won. Faster/brighter variants
exist in design-refs history if a "Flo is actively thinking" state is wanted later.)

## 16. Studio Time — DAY BLOCK (RULING 2026-08-13)

Eli picked **option A · Day block** from `docs/design-refs/studio-time-grouping.html`
(B spine, C indent, D end-bubble rejected). Applies to the Studio Time table on
the work order screen.

**The diagnosis, which is the part worth keeping:** the zebra banding grouped by
DAY, but the question the eye is actually asking at a row is *"who was on this?"*
— and the staff line answered it from a band that said nothing about belonging.
A studio line and its staff lines are ONE fact and must look like one.

- **A day and every staff line under it sit in one soft `--c-wash` block**,
  radius 12, with a gap between days. The gap does the separating the zebra
  stripe used to, so **`c-trow-alt` zebra is retired from this table**.
- Grouping is by **date**, not by row: a standalone staff row (studio `''`)
  joins the block of the day it belongs to. A row with no date sits alone.
- Still under the TABLE EXEMPTION (§8): grouping comes from FILL and SPACE
  only. No borders, no per-cell bubbles, no wells, no rules. If you are about
  to type `border:` to divide days, you have the wrong solution.
- Per-line totals STAY. (That was option D's trade and Eli did not take it.)
- Cost accepted: a long work order is taller than it was. If that becomes a
  problem the answer is a shorter row, not a return to zebra.

## 18. Equipment condition lives IN the studio day (RULING 2026-08-13)

Eli picked option **A · Third line** from
`docs/design-refs/eq-in-studio-day-options.html`. B/C/D rejected.

**What it replaces:** a separate table under Studio Time with equipment down the
side and ONE COLUMN PER SESSION DATE across the top, scrolling sideways. The date
is what joins it to the studio time above, and that join was invisible — on a
30-day work order it was a 30-column horizontal scroll with no relationship on
screen to the day you were just editing.

- **Each day block gains a third line**, under the staff line: `EQUIPMENT` then
  one pill per item. Same law as §16 — a day, its staff and its condition are
  one fact, so they share one block.
- **The pill cycles on tap: blank → OK → Not OK → OK → Not OK …** It NEVER
  returns to blank. Blank means *nobody has answered yet*, which is information;
  a third tap must not be able to destroy it. This also keeps "not checked"
  honestly distinct from "checked and fine".
- **Not OK opens the note field** inline beneath, as now, and raises the flag.
- Colour is status only (§5): OK is `--c-st-booked`, Not OK is `--c-st-hot`,
  unanswered is wash at low opacity.
- The old `data-no-print` exclusion still applies — **equipment condition is
  internal and never prints** (it is not in `lib/woPdf.ts`, and must not be).
- **Accepted cost:** the day block grows to ~86px, so about 8 days are visible
  before the studio-time box scrolls (Eli's stated preference). A 30-day work
  order is a long inner scroll. If that becomes the problem, shorten the row —
  do not go back to a separate table.

## 17. Billing / COD — THE PIPELINE IS THE TITLE (RULING 2026-08-13)

Eli: *"I don't want staff to forget about COD."* Reference:
`docs/design-refs/cod-visibility-options.html` (option A — counts on the switch)
placed per `docs/design-refs/cod-toggle-placement.html` (option A — it is the
title). B/C/D rejected in both files.

**The diagnosis:** a toggle shows you the side you are ON and says nothing about
the side you are not on. The only cross-pipeline signal was a hot dot — binary,
and silent about ordinary COD work. And the risk is asymmetric: a forgotten
billing invoice is late; a forgotten COD balance is money that was supposed to be
collected at the desk and never will be, because nobody knows.

- **The two pipelines ARE the page heading**, rendered in Archivo at title scale.
  The active one is full strength; the other sits beside it at ~28% opacity.
  Both are always readable, so the page cannot be read without reading "COD".
- **Each carries a live count** — work outstanding in that pipeline (everything
  not paid and not closed). **COD's count goes HOT (`--c-st-hot` fill) whenever a
  balance due exists**, which is sanctioned under hot-as-needs-you-now (§5).
- The `⋯` page menu stays at the far right. The old top-right pill switch is
  removed — it was in the conventional home for a view control and the
  least-read corner of the screen, which under-stated a control that changes
  what the entire page is about.
- **Accepted cost:** the page appears to rename itself, so "Billing" stops being
  a fixed landmark in the rail-to-heading path. Judged worth it — the rail entry
  still says Billing, so the landmark survives where navigation actually happens.

### 16c. TABLE CHROME IS TEXT, NOT BARS (RULING 2026-08-13 — supersedes §16b)

Eli, after seeing §16b built: *"looks like headers and footers are half round and
half square… maybe for the headers and footers, there are no bars or pills, just
text. that way entries have the rounded bubbles."*

He is right and §16b was chasing the symptom. Two filled bars sandwiching filled
row-blocks means three fills competing for one edge, and some corner is always
wrong — round the header's bottom and you get a pill floating over square-topped
blocks; the corner only moves. Option **B** of
`docs/design-refs/table-chrome-options.html` (text chrome + result chip).

- **Column headers have NO fill.** They are the standard uppercase micro-label,
  sitting above the rows on the same grid. A header holds nothing, so it is not
  an object and takes no surface.
- **Footers have no fill either.** `+ Add …` controls are plain text on the
  left; the subtotal sits on the right in a **small wash2 chip, radius 99** —
  the one filled thing down there, because it is a RESULT and the controls
  beside it are not.
- **Only ENTRIES are filled and rounded** (radius 12). One radius per surface,
  so there is no seam to get right.
- **Group along the axis of the fact.** Studio Time bubbles a DAY (a day and its
  staff are one fact). Equipment bubbles a PIECE OF GEAR across every night
  (one mic is one fact). Equipment looked worst under §16b precisely because it
  had borrowed Studio Time's axis. **Zebra is retired from equipment too.**
- A sticky first column still needs an OPAQUE fill or cells scroll under it:
  it takes its row's bubble fill (`--c-wash`), and the sticky HEADER cell takes
  `--c-bg`. That is the one place a fill is structural rather than decorative.
- §16b's "round every strip" instruction is dead — there are no strips left to
  round. Kept below only so the reasoning is legible.

### 16b. Table geometry — nothing square at an edge (RULING 2026-08-13, SUPERSEDED by §16c)

The day blocks exposed an older violation rather than causing one. §7 already
ends "Everything rounded; nothing square", but every table on the work order had
a SQUARE header strip and a SQUARE footer bar sitting inside a rounded container
— so a curved row ended against a hard corner and the edges read as ragged.
Eli: *"the ends of each table rows around and then totals, bottoms, headers are
square… the ends look messy."*

The rule for every data table (studio time, equipment, rentals, payments,
totals):

- **Radius 12 everywhere in the stack.** Container 12, day blocks 12, and —
  this is the part that was missing — the strips round their OWN corners:
  header `12px 12px 0 0`, footer/add-row bar `0 0 12px 12px`.
- A container's `overflow: hidden` is NOT sufficient, because these containers
  carry side padding, so an inner strip never reaches the parent's curve and
  keeps its own square corners inside the padding.
- A sticky first column rounds with the strip it sits in (equipment's
  `borderTopLeftRadius`), or it prints a hard corner over a curved one.
- Strips that sit BETWEEN rows (the locked-row notice, the delete-confirm bar,
  an equipment note) stay square on purpose — they are clipped by the block
  they live inside, and rounding them would read as a floating card.

## 15. Runner hub — DAY CARD (RULING 2026-08-13)

Eli picked **option A · Day card** from `docs/design-refs/runner-hub-options.html`.
Port from that file. B (job strip) and C (tap-to-sheet) are rejected.

- **The work order's twelve-column table is gone on the phone.** One DAY is one
  CARD, with a day pager above it. No horizontal scrolling anywhere on `/runner`.
- **Rates, OT rates and day totals are READ-ONLY text** in a wash block labelled
  "Billing · set by the office". The runner owns times, staff hours, equipment
  condition, payments taken at the desk and notes — nothing else is an input.
  This is the whole reason the phone screen is not the admin screen.
- The hub keeps today's sessions as cards and the ops tiles; both move to the
  soft skin, `--c-` tokens, no borders, Archivo for the room name (Syne and DM
  Serif Display are retired, §4). Tap targets ≥ 44px.
- **The runner's terminal act is SUBMIT (today's rows → `submitted`), never
  "Complete WO".** Completing is the admin act that starts the billing pipeline
  (`enterInvoicePipeline`); it must not appear on a runner surface.
- Data flow, realtime wiring and features are UNCHANGED — this is layout and
  surface only. Do not rebuild the logic.

## 15b. Runner hub — ADDITIONS (RULING 2026-08-14)

Eli picked **option A · Sections** from `docs/design-refs/runner-hub-additions.html`.
Port from that file. B (tiles) and C (task banner) rejected — B gave "blow the
parking lot" the same visual weight as the stock list; C buried the punch report
two taps deep, and same-day reports are the ones that protect the runner.

**Standing context this ruling encodes (Eli, 2026-08-14, verbal):** the hub's
shape is RIGHT and must not be rebuilt — four studios, pick yours, work
tonight's sessions and duties. **Nothing is assigned to a runner.** Runners
rotate between studios; everything is scoped to STUDIO + SHIFT, never to a
person. Do not reuse the dashboard_tasks person/tab system here.

- **Studio tasks are a SECTION at the very top of the hub** — above sessions —
  because the opener's first question walking in is "anything waiting for me".
  A studio with no open tasks skips the section entirely. Each task shows who
  left it and when; checking it off records done + time. Per-studio, per-nobody.
- **Punch-miss and the runners manual are the QUIET register** — full-width rows
  at the bottom, always in the same place, never competing with tonight's work.
  The manual row ships as a "coming soon" slot; the AI/chat surface later joins
  or replaces it. Quiet ≠ hidden: one tap, always visible.
- **The punch form is HR-SPEC §5 verbatim** (date/shift, punch type, correct
  time, optional note → `punch_correction_requests`, classification by server
  trigger). It is the legal written confirmation; it goes to the manager queue.
- **RESOLVED (Eli, 2026-08-14): runners get INDIVIDUAL logins.** The shared
  runner PIN is retired once per-runner accounts exist. This kills the
  "who are you" picker — the punch form takes `staff_id` from the session,
  exactly like every other staff surface, and the mock's picker card is NOT
  built. Also the foundation for runner scheduling (later). Mechanics are
  already per-person (`staff_pins` + `user_profiles` role `runner` + the
  AuthGuard runner bounce); rollout is one profile row + one PIN per runner
  via the existing scripts. Until those accounts exist the punch quiet-row
  stays "coming soon" — do not ship it against the shared login.
- The three registers on the hub are now fixed vocabulary: **sections** (tasks,
  sessions), **tiles** (tonight's duties), **quiet rows** (everything that
  isn't tonight's work). New hub features must join one of these, not invent
  a fourth.

## 19. TWO WORLDS + the Daily Ops page (RULING 2026-08-14)

Eli's architecture ruling, made while untangling "what happened yesterday":
**the app is two worlds plus one personal layer.** Reference mock:
`docs/design-refs/daily-ops-final.html` (single refined layout; the earlier
`admin-runner-hub-options.html` A/B/C round fed into it and is superseded).

- **BILLING (billing coordinator).** Everything money: payments, rentals,
  AR/AP, COD chasing, and **work-order review — the Billing hub's "review"
  bucket owns runner-submitted WOs.** Nothing new was built for this world;
  it was already complete.
- **OPERATIONS (studio manager) → the `/daily-ops` page.** "Did last night go
  right." Layout: **queue LEFT** (exceptions — flags, missing submissions,
  missing mics; tap to clear, empty = "Yesterday is done"; studio-tasks
  manager beneath it, so the queue's column has room to grow on a bad
  morning), **sweep RIGHT** (2×2 studio cards: opening/closing times, mics,
  petty cash, stock, who worked, shift-log preview). **No work orders, no
  punches, no live-tonight** — those live in Billing, HR, and the dashboard
  respectively.
- **MY DAY** is the personal cadence layer on top of both. It LINKS (the
  manager's review duty opens /daily-ops; billing duties open the hub) and
  never copies. One copy of every item, everywhere, always.

**Shift logs replace the Slack shift-notes post.** Real notes run 15+ bullets
with mid-shift handoffs (see Mathew's 5/20 ERS example), so this is a LOG,
not a text box: `shift_log_entries` — append-only, per studio per night,
multiple authors, each entry stamped who + when. Runners write from
`/runner/[studio]/shift-notes`; the sweep card shows a collapsed preview and
the full night opens in a popup. Entries are never edited or deleted.

**Clearing the queue persists via `daily_ops_reviews`** — a generic
(date, item_key) "seen" marker, one row per cleared item, so the queue state
is shared across every manager and morning. Flags clear by ACKNOWLEDGING the
flag itself (status → acknowledged), not via a review row — the flag system
stays the record.

**Retirement path (do not rebuild these):** the dashboard's four ops cards
are already gone (§14b); Admin → Ops Log and `/daily-ops-log` are absorbed by
this page over time; `/wo-hub` stays denav'd (Billing replaced it). The
`/flags` page remains the standing categorized record — the queue is the
morning door, Flags is the filing cabinet.

## 20. THE RIBBON — the brand mark carries colour (RULING 2026-08-22)

Eli, after living with the monochrome mark: *"when we ditched the colors it now
looks a little bland"* → *"take the logo and just fill it in. one color."*
Reference: `docs/design-refs/brand-mark-options.html` — colour direction **A ·
Lagoon** narrowed to construction **G1 · Ribbon** in **sea green `#43dfae`**.
(B Heritage, C one-live-line, D gradient, E paper icon rejected; G2 heavy line
and G3 three-lines rejected.)

- **The mark is ONE solid shape in ONE flat colour.** The fill is the space
  between the old mark's tallest and flattest wave; the lines cross mid-mark, so
  it reads as a twisted ribbon. Path lives in `components/PRSFloIcon.tsx` and
  `scripts/generate-icons.js` — identical in both, always.
- **Sea green `#43dfae` (`--c-st-booked`), fixed in BOTH themes.** This is the
  second sanctioned exception to Law 3, the same shape of exception the Flo glow
  is to §7's no-glow rule: the brand mark is the one place non-status colour
  exists, and that only works if it stays the ONLY place. Nothing else inherits
  this permission.
- **Still flat.** No gradients, no glow, no drop shadows — the old icon's
  radial-glow treatment does not return. Colour is the richness, not atmosphere.
- **App icon** = the ribbon on the charcoal ground `#1b1a17`, rounded-rect
  rx 44/200. Regenerate with `node scripts/generate-icons.js` (10 assets).
  **Runner set** keeps its historical orange identity via warm amber `#ffa94d`
  (`--c-st-warm`) — same ribbon, same ground.
- The three-wave monochrome mark (currentColor at .35/.6/1, 2026-07-30) is
  retired. Do not reintroduce it, and do not render the ribbon in currentColor.
- The Flo box header (§14c) renders the same `PRSFloIcon` — one mark, brand and
  AI; it now carries the sea green there too.

### 14d. Sequencing

The rail + dashboard land FIRST, as the new app frame. The un-migrated pages (admin,
WO hub, runner, /tasks, SOP) are deliberately parked until this frame exists — do not
restyle them inside the old top-nav frame.
