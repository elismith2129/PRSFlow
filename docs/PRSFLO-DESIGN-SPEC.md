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

Thirds grid `1.05fr 1fr 1fr`:
- **LEFT — THE CONSOLE (one pane):** Flo box (briefing) → My Day duties (progress pill,
  Due-today pill, backlog callout when behind) → Tasks (staff tabs + add row).
  Flags pane sits below the console, separate.
- **MIDDLE:** Needs Action (leads, new-lead pulse) + staff 14-day grid (Eli view only).
- **RIGHT:** Today's Sessions — location counts as chips in the pane header (the old
  location strip is retired), rooms 2-wide, room-card DNA from the existing dashboard
  ruling (status pool fills, Archivo artist, mono eng initials).

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
- Header: wave SVG mark + "Flo" (Archivo 14px) + micro-tag "· Your briefing · {date}".
- Body: status-dotted bullets (dots use §5 status colours; alert line takes hot ink),
  italic one-line synopsis, "Ask Flo →" affordance.
- `prefers-reduced-motion`: animation off, static ring stays.

**Glow = AI, exclusively.** The ring + halo are the only glow in the app (§7 exception).
No other element may ever glow, breathe, or orbit — the moment something else glows,
Flo stops meaning anything. (Motion candidates comet/twin-orbit/heartbeat/ripple/ember
were evaluated and rejected; Aurora at the dialed values won. Faster/brighter variants
exist in design-refs history if a "Flo is actively thinking" state is wanted later.)

### 14d. Sequencing

The rail + dashboard land FIRST, as the new app frame. The un-migrated pages (admin,
WO hub, runner, /tasks, SOP) are deliberately parked until this frame exists — do not
restyle them inside the old top-nav frame.
