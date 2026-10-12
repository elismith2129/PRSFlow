# Drawn-screen brief — PRSFlo RUNNER guide (walkthrough edition)

You are drawing STATIC HTML replicas of real PHONE screens of a production web
app (PRSFlo, a recording-studio booking + billing tool: Next.js + Supabase).
They go into the RUNNER training guide. Runners are the studio's front-desk /
night staff; they use PRSFlo ONLY on their phones. The guide shows a drawn
phone screen, lights up one part at a time, and tells the runner in one short
line what to tap and one short line WHY. The owner's words: "show the actual
app pages and highlight the boxes and then explain it… this one needs to be
SOOOOO idiot proof. short copy, exact walkthrough and explanation of 'why' we
do things."

So two things matter above all:
1. FIDELITY. Same regions, same order, same wording on every label / button /
   chip / placeholder, same colours and shapes as the real PHONE screen for the
   `runner` role. Simplify only by showing fewer rows of sample data. Never
   invent UI that is not in the code. Never draw the desktop layout.
2. THE WHY. The code is full of comments explaining why each thing exists,
   often quoting the owner (Eli) with a date. For every part you key, find that
   reason and report it (see "What to send back").

## Source of truth
Read-only copies of the code are under /mnt/user-data/uploads/prsflow/ (paths
in your task). `styles/globals.css` there is the app's stylesheet (`c-*`
classes). Do NOT edit anything under /mnt/user-data/uploads.

## What to produce
One file per screen: /tmp/claude-0/-home-claude/3e6e0566-1dbe-515e-a8e2-84317e9ad18a/scratchpad/sop2/runner/screens/<name>.html
Each file is a FRAGMENT (no <html>/<head>/<body>), exactly:

    <style> ...every selector starts with .scr-<name> ... </style>
    <div class="scr scr-<name>"> ...the drawn phone screen... </div>

Rules:
1. All CSS scoped under `.scr-<name>` (many fragments are pasted into one page;
   unscoped rules collide — and do not rely on bare element selectors or class
   names outside your scope). No `<script>`, no external files, no images, no
   web requests. Inline SVG is fine for icons. Style every `<button>`,
   `<input>` etc. you draw fully yourself (or use `<span>`/`<div>`): the host
   page applies NO reset to them.
2. Colours ONLY through these variables (they swap for a light theme): --c-bg
   --c-fg --c-fg-2 --c-fg-3 --c-wash --c-wash2 --c-srf --c-softsh --c-ctlsh
   --c-ivory --c-chip-ink --c-hot-text --c-st-hot --c-st-warm --c-st-booked
   --c-st-cold --c-st-uncon --c-st-tech --c-st-dead --c-st-tenant. No
   hard-coded hex except where the app hard-codes one (e.g. #1b1a17 ink on an
   ivory button). You may copy rules from globals.css, re-scoped.
3. Fonts: 'Archivo Black' (display, `.c-arch`), 'Inter' (body), 'DM Mono'
   (mono), 'Bebas Neue' where the app uses it. They will NOT load in your
   sandbox (no network) — expected; always give fallbacks.
4. PHONE GEOMETRY. The stage is a phone: 390px wide (must also work at 360px
   with NO horizontal overflow anywhere — not even inside the fragment). Draw
   the page as it scrolls on a phone: full width, natural height (a long page
   may be 900–1800px tall; that is fine). Do not draw a phone bezel, status
   bar or browser chrome. Do not shrink text below the app's real sizes. If
   the real screen has a bar pinned to the bottom of the viewport (e.g. a
   Submit bar), draw it as the LAST block of the fragment, full width, not
   `position: fixed/sticky` (nothing in a fragment may be fixed or sticky).
   A bottom sheet / modal that covers the screen: draw it in place over a
   dimmed copy of the page, or — when your task asks for it as a STATE — show
   it instead of the page for that state.
5. Mark every explainable part with `data-k="<key>"` (kebab-case). Your task
   lists the keys I need; add more where the screen has parts a runner must
   understand. Several elements may share a key; an element may carry several
   keys, space-separated. Keyed elements must be real boxes (block /
   inline-block / flex / grid), not bare inline text.
6. STATES: the guide sets `data-state="<state>"` on the root `.scr` element.
   Show / hide parts with CSS like
   `.scr-x:not([data-state="done"]) .only-done{display:none}`. The default (no
   attribute) must be a complete, sensible screen.
7. Sample data is FICTIONAL and must agree across screens:
   the runner reading is "Terren L." (initials TL), on shift at PARAMOUNT
   (studio key `paramount`, short code PRS) on the night of Thu Oct 8, 2026.
   Tonight's sessions at Paramount: Studio B — Hitline Records / KAYA B
   (label, Billing), 12:00 PM – 12:00 AM, WO-1310; Studio A — Dante Hollis
   (COD, session total $410.00), 6:00 PM – 2:00 AM, WO-1312. Other staff who
   may appear: Lori (billing), Eli and Adam-Mike (owners), Fernando (manager),
   engineer "M. Torres", another runner "Mika S.". No real client names,
   emails, phone numbers.
8. Static only: draw open / filled / error states as they would look. No
   animation.

## Checking your work (required)
    cd /tmp/claude-0/-home-claude/3e6e0566-1dbe-515e-a8e2-84317e9ad18a/scratchpad/sop2
    python3 render.py runner/screens/<name>.html runner/shots/<name>.png dark 390 "" 430
    python3 render.py runner/screens/<name>.html runner/shots/<name>-light.png light 390 "" 430
    python3 render.py runner/screens/<name>.html runner/shots/<name>-360.png dark 360 "" 380
    python3 render.py runner/screens/<name>.html runner/shots/<name>-<state>.png dark 390 <state> 430   # per state
(arguments: fragment, out.png, theme, stage width, state, viewport width.)
Then LOOK at each PNG with the Read tool and fix what is wrong: overlapping or
clipped text, unreadable contrast in light theme, `overflow-x: True` in the
script output (a failure), missing keys, anything that does not read as a
clean, believable phone screenshot of the app. Iterate until it does.

## What to send back (your final message)
For each screen file, a list of its `data-k` keys, and for EACH key:
- DOES: one or two plain sentences — what the runner taps / types there and
  what happens (what saves instantly vs needs a button, what it can never do).
  Exact, from the code.
- WHY: one sentence — the reason this exists or is done this way, taken from
  the code comments / the owner's quoted rulings (give the quote or its gist
  and the date if there is one). If the code gives no reason, say
  "WHY: not stated in code" — do not invent one.
- Mark anything you could not confirm as UNCONFIRMED.
Then: the states each screen supports; and a short list of GOTCHAS — the ways
a runner can get this screen wrong and what the app does about it (blocks,
warns, lets it through), with the exact wording of any message the app shows.
Keep it tight: facts, not a description of your process.
