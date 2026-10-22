# Ask Flo — the help bubble (build brief)

*Eli, 2026-10-22: "the AI chat bot that lives in the bottom right corner on the
desktop app for admin where they can ask questions… based on all the logic and
rules we've created." Scoped here before building. Not started.*

## What it is

A small round button in the bottom-right corner of every admin page. Tap it and
a panel opens: one text box, "Ask Flo." Type a question in your own words
("how do I remove one day from a hold", "why is this row orange", "what does
Reopened mean") and get a short answer **taken only from the staff guides**,
with a link that opens the guide at the step it came from. If the guides don't
cover it, it says so and points at Eli, instead of guessing.

It is Flo, not a second assistant: it wears the Flo ring (glow = AI, the one
sanctioned glow, spec §14c), and it is the same voice as the morning briefing.

## What it is NOT (the three rules)

1. **It answers only from the documents.** No general knowledge, no inventing.
   The prompt says: answer from the guide text provided, cite the step, or say
   "that's not in the guide — ask Eli." Tested against a list of 30 real
   questions before it ships, including ten it should refuse.
2. **It reads nothing live.** No work orders, no clients, no money. "Where is
   WO-1214" gets "I can't see work orders — the billing hub search can." The
   live-data version is a separate, later decision (tool calls under the
   asker's RLS; real risk of a confident wrong answer about money).
3. **It writes nothing.** No actions, no tasks, no ticks. The only row it ever
   writes is its own log.

## Who sees it

Owner, manager, billing, asst_manager. Not runners (their guide is the phone
walkthrough, and the bubble would sit on top of the day sheet). Not tech, for
now.

## What it reads (the corpus)

Built at build time from the same sources the guides are built from, so it
can never drift from what staff see:

| Source | Why | Size |
|---|---|---|
| `docs/sop-build/content.py` (Billing SOP, 198 steps) | step title · body · why | 36 KB |
| `docs/sop-build/content_runner.py` (Runner guide, 172 steps) | so the office can answer a runner's question | 39 KB |
| `public/sop.html` data: `STATUS_DATA`, the CRM / Clients / Tasks / Flags step arrays | the main app guide | ~60 KB |
| `public/sop.html` → `VERSIONS` (staff-facing release notes, `dev` arrays stripped) | "what changed" questions | ~40 KB |

Roughly 50–60k tokens. One prompt, cached (Anthropic prompt caching on the
corpus block), so each question costs the question and the answer, not the
corpus. **Excluded on purpose:** CLAUDE.md, CHANGELOG, PROJECT_LOG, the design
spec — developer voice, full of superseded rulings; feeding them in raw is how
it would start telling Lori about RLS policies.

`scripts/build-ask-corpus.mjs` writes `lib/server/askCorpus.generated.ts`;
runs in `npm run build` (and `selftest --build`). The file is committed so a
cold deploy has it.

## How it works

- **Panel:** `components/ask/AskFlo.tsx`, mounted once in `app/(main)/layout.tsx`
  inside `AuthGuard`. Bottom-right 44px round button with the ribbon; opens a
  360×480 sheet (phone: full-screen). Thread of the current session only — no
  history across reloads. Answer renders as text plus up to three "Open the
  guide →" chips.
- **Route:** `app/api/ask/route.ts` (service role for the log write; the
  caller's session is verified first, same shape as `/api/wo-package`). Role
  gate on the server, not just the button. Per-user rate limit, 20/hour.
- **Model:** Haiku 4.5 (Flo's briefing uses Sonnet because it reasons over
  numbers; this is lookup-and-rephrase, and Haiku's speed matters more in a
  chat box). `max_tokens` 600. Temperature 0.
- **Prompt:** system = the three rules + "you are Flo, the PRSFlo help; answer
  in 2–5 sentences, plain words, then cite steps as `[guide:step-key]`". The
  corpus block carries `cache_control`. The user turn is the question, with
  the last three exchanges for follow-ups.
- **Citations:** each step in the corpus carries its guide + key; the route
  turns `[billing:remove-hold-3]` into a link `/billing-sop#remove-hold-3`
  (the guides already open at `location.hash`, engine.js line 259).
- **Log:** table `ask_log` — `id, asked_by, role, question, answer, cited
  (text[]), answered (bool: did it cite anything), latency_ms, created_at`.
  RLS: insert by the route only (service role); select owner. **A tiny
  Admin → Ask log page**: every question, newest first, with an "unanswered"
  filter. This is the point of the whole thing after week one — the
  unanswered questions are the SOP gaps.

## Mock first (per the design workflow)

One mock, three options for the panel only: A dock sheet (the bubble opens a
sheet anchored bottom-right, like Intercom), B the Flo box itself grows a
question line (no new surface — the dashboard's Flo box gets an input;
elsewhere the bubble opens the same box), C a command-palette (⌘K-style
centered box, no bubble). Eli picks before any code.

## Time, honestly

Two Cowork sessions.

- **Session 1 (a half-day):** mock → pick. Then the corpus builder, the route,
  the panel, the `ask_log` migration, mounted and answering.
- **Session 2 (a half-day):** the 30-question check (20 it must answer with
  the right step, 10 it must refuse), fixes to the prompt from that, the
  Admin → Ask log page, wrap-up docs, SOP note, test batch.

Plus Eli's time: pick the mock (5 min), run one migration, push twice, and
read the question log after two weeks. Calendar: two sittings, could be the
same day. Running cost: at Haiku prices with the corpus cached, well under
$5/month at any realistic volume.

## What would make it slip

- If the main guide's step data in `sop.html` turns out to be harder to
  extract cleanly than the two Python content modules (it is hand-written JS
  arrays, not a build). Worst case the builder parses them with a regex and
  the Session 1 estimate grows by an hour.
- If answers come back citing the wrong step more than rarely, the fix is
  better step keys in the corpus, not a bigger model — but that is a second
  pass over the content files.

## Later, if the log earns it

- Live data under RLS ("where is WO-1214"), read-only, with the answer
  showing the rows it read.
- A runner version inside the phone guide.
- Pushing an unanswered question straight into a TODO line.
