# Drawn-screen brief (PRSFlo Billing SOP, walkthrough edition)

You are drawing STATIC HTML replicas of real screens of a production web app
(PRSFlo, a recording-studio booking + billing tool: Next.js + Supabase). They go
into a staff training manual. The manual shows a drawn screen, lights up one
part at a time, and explains it in one or two sentences. The owner's words:
"show the actual app pages and highlight the boxes and then explain it."
So FIDELITY to the real screen is the whole job: same regions, same order, same
wording on every label/button/chip, same colours and shapes. Simplify only by
showing fewer rows of sample data, never by inventing UI that is not in the code.

## Source of truth
Read-only copies of the code are under the repo root (paths
given in your task). `styles/globals.css` there is the app's stylesheet (the
`c-*` classes). Read what the component renders for a desktop screen and the
role named in your task. Do NOT edit anything under /mnt/user-data/uploads.

## What to produce
One file per screen: docs/sop-build/screens/<name>.html
Each file is a FRAGMENT (no <html>/<head>/<body>), exactly:

    <style> ...every selector starts with .scr-<name> ... </style>
    <div class="scr scr-<name>"> ...the drawn screen... </div>

Rules:
1. All CSS scoped under `.scr-<name>` (several fragments are pasted into one
   page; unscoped rules will collide). No `<script>`, no external files, no
   images, no web requests. Inline SVG is fine for small icons.
2. Colours ONLY through these variables (they swap for a light theme, so no
   hard-coded hex except where the app itself hard-codes one, e.g. #1b1a17 ink
   on an ivory button): --c-bg --c-fg --c-fg-2 --c-fg-3 --c-wash --c-wash2
   --c-srf --c-softsh --c-ctlsh --c-ivory --c-chip-ink --c-hot-text
   --c-st-hot --c-st-warm --c-st-booked --c-st-cold --c-st-uncon --c-st-tech
   --c-st-dead --c-st-tenant. You may copy rules from globals.css (re-scoped).
3. Fonts: 'Archivo Black' (display/headings, `.c-arch`), 'Inter' (body),
   'DM Mono' (mono). They will not load in your sandbox (no network) — that is
   expected; always give fallbacks (system-ui / ui-monospace).
4. Mark every explainable region with `data-k="<key>"` (kebab-case). Your task
   lists the keys I need; add more if the screen has parts worth explaining.
   Several elements may share a key (e.g. every status badge: data-k="badge").
   An element may carry several keys, space-separated. Keyed elements should be
   real boxes (block / inline-block / flex / grid) so a ring can be drawn round them.
5. If your task asks for STATES: the manual sets `data-state="<state>"` on the
   root `.scr` element. Show/hide parts with CSS like
   `.scr-x:not([data-state="tentative"]) .only-tentative{display:none}`. The
   default (no attribute) must be a sensible screen on its own.
6. Layout: the screen sits in a stage 900–1000px wide on desktop. It must look
   right at 1000px and must not overflow horizontally at 1000px. At 360px
   (phone) it may reflow to a single column or scroll horizontally INSIDE the
   fragment root (give the root `overflow-x:auto` and an inner min-width) —
   the page itself must never scroll sideways.
7. Sample data is FICTIONAL. Use these so all screens agree:
   clients/artists: "Hitline Records — KAYA B" (label, WO-1310, PRS B, Oct 2–4),
   "Vantage Music Group — DECOY" (WO-1307), "Northside Ent. — J. RIVAS"
   (WO-1302), "Crest Label Group — MARA" (WO-1298), COD: "Dante Hollis"
   (WO-1312), "Lena Ortiz" (WO-1309). Staff names that may appear: Lori
   (billing), Eli and Adam-Mike (owners), Fernando (manager), runner
   "Terren L." (initials TL). Rooms: PRS A/B/C (Paramount), ARS A/B
   (Ameraycan), ERS A/B (Encore). Dates in early October 2026. No real client
   names, emails, phone numbers or invoice files.
8. Static only: draw hover/open states as they would look if open when the
   task asks for them. No animation.

## Checking your work (required)
    cd docs/sop-build
    python3 render.py screens/<name>.html shots/<name>.png dark 1000
    python3 render.py screens/<name>.html shots/<name>-light.png light 1000
    python3 render.py screens/<name>.html shots/<name>-m.png dark 360 "" 390
    python3 render.py screens/<name>.html shots/<name>-<state>.png dark 1000 <state>   # per state
Then LOOK at each PNG with the Read tool and fix what is wrong: overlapping
text, clipped labels, unreadable contrast in light theme, horizontal page
overflow (`overflow-x: True` in the script output is a failure), missing keys.
Iterate until it reads as a clean, believable screenshot of the app.

## What to send back (your final message)
For each screen file:
- the file name, and its `data-k` keys — for EACH key one or two plain
  sentences stating what that part IS and DOES, taken from the code (who can
  use it, what it changes, what it never does). These become the manual's
  captions, so be exact and do not guess. Mark anything you could not confirm
  in the code as UNCONFIRMED.
- the states it supports.
- anything in the code that contradicts the "known facts" in your task.
Keep it tight: facts, not description of your process.
