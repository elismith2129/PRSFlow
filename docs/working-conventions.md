# PRSFlo — How Eli works on this repo

*Last corrected 2026-07-30. If this document and observed reality disagree, tell Eli
rather than working around it — this file has drifted twice before and both times a
session wasted effort on a workflow that no longer existed.*

---

## 1. The current workflow (read this first)

**Eli works directly in Claude with this repo mounted. Claude edits files. Eli runs git.**

That's the whole loop:

1. Claude edits files in `/Users/elismith/dev/prsflow` using its file tools.
2. Claude ends every change set with **ONE complete copy-paste terminal line** for Eli:
   ```
   cd /Users/elismith/dev/prsflow && git add <files by name> && git commit -m "<message>" && git push
   ```
3. Eli pastes it. Vercel builds a preview for the branch.
4. Eli reviews on the **preview URL** — not localhost, not a diff.

Eli is not a developer. He does not read diffs and does not compose git commands. The
one line must be complete, correct, and safe to paste blind.

### Hard rules

- **Claude NEVER runs `git add`, `git commit`, or `git push` from a sandbox shell.**
  Read-only git (`git status`, `git log`, `git diff`, `git branch`, `git ls-remote`) is
  fine and useful. Write operations are Eli's, always. See the 2026-07-30 incident below
  for what happens otherwise.
- **NEVER `git add -A`.** Stage files by name. Multiple Claude sessions share this repo
  and `-A` sweeps up another session's in-flight work. This supersedes the older standing
  prompt rule that ended every task with `git add -A && git commit && git push` — that
  rule predates multi-session work and is retired.
- **`npm run dev` does not work locally** (broken since PIN login landed). There is no
  local verification. Preview URL or nothing.
- **Everything happens on a branch.** Nothing reaches `main` until Eli says so.
- **Migrations are run by hand** by Eli in the Supabase SQL editor, *before* the code
  depending on them is pushed. Write them idempotent (`add column if not exists`).
  Claude has no DDL access. A migration file in the repo is **not** proof it was applied.
- **No automated testing** — manual browser testing via live URL. Confirmed decision;
  don't propose a test framework.

---

## 2. Session start check

Before doing anything else, confirm two separate things. They can disagree.

**A. Can you edit the repo?** You should be able to read and write
`/Users/elismith/dev/prsflow` directly, at that exact path. If you had to clone the repo
to reach it, you are not working on Eli's actual files — stop and tell him.

**B. Is your shell sandboxed?** Almost certainly yes. Claude's shell typically runs in an
isolated Linux VM with the repo *mounted*, which means:

- it has **no GitHub credentials** (the Mac keychain helper is invisible to it), and
- it **cannot delete files** in `.git/`.

Both are normal. Neither is a problem *as long as the shell never performs a git write.*
Check A passing does not imply the shell can push — that mistake is exactly what the
2026-07-30 incident was.

---

## 3. Incident: sandbox git writes leave the repo wedged (2026-07-30)

**What happened.** At the start of the carved-redesign project, Claude followed the
then-current version of this document, which described the retired Claude-Code-in-VS-Code
era and implied the session should commit and push itself. Claude cut a branch and made
one empty commit from its sandbox shell to test push access.

**What broke.**

- The push failed with `fatal: could not read Username for 'https://github.com'` — no
  credentials in the sandbox. Note this is **not** the old cloud-proxy 403; network
  access was fine (`git ls-remote` read the remote refs successfully moments before).
- Every sandbox git write left stale lock files it had no permission to delete —
  `.git/index.lock`, `.git/HEAD.lock`, and `tmp_obj_*` files under `.git/objects`.
  **A stale `index.lock` wedges git for every process on the machine**, including Eli's
  own terminal and any other Claude session on the repo, with
  "Another git process seems to be running."
- 63 orphaned `tmp_obj_*` files were already present, so this had been silently
  accumulating across earlier sessions.

**Recovery.** Eli cleared the locks and pushed by hand:
```
cd /Users/elismith/dev/prsflow && rm -f .git/index.lock .git/HEAD.lock && git push -u origin <branch>
```

**The fix, and why the rule is absolute.** Claude does not run git write operations. The
cost of one sandbox commit is a wedged repo for everyone; the benefit is zero, because
the push can't succeed anyway. If a future session finds stale locks, the line above
clears them — but a session should never be creating them.

---

## 4. Canonical logs — read these first, every session

Ground your work in these. Don't infer from memory when the log has the answer.

- **`CLAUDE.md`** (repo root) — locked design conventions + standing architecture rules
  (real-time subscriptions required, wordmark locked, WO-is-the-booking, error handling).
- **`docs/ONBOARDING.md`** — entry point for a cold session. §5 Landmines especially.
- **`docs/PROJECT_LOG.md`** — living log. Section 1 is the **Decisions Log**: why things
  are the way they are. Read it before second-guessing a design.
- **`docs/CHANGELOG.md`** — what changed per version, with migrations and watch-outs.
- **`docs/PRSFlow-Tech-Stack.md`** — where things live.
- **`docs/AUDIT-2026-07.md`** — known debt, with a phased plan.

Note the path: `CLAUDE.md` is at the **repo root**, not `docs/CLAUDE.md`. Asking for the
latter makes a session report the file missing.

---

## 5. Repo facts

- Local path: `/Users/elismith/dev/prsflow`
- Remote: `https://github.com/elismith2129/PRSFlow.git`
- Default branch: `main`
- Production: `prsflow.paramountrecording.com` (Vercel, auto-deploys from `main`)
- Preview deployments build for **every branch** — that's how Eli reviews.

---

## 6. Historical — the Claude Code / VS Code era (retired)

*Kept for context only. None of this describes current practice; do not act on it.*

Through roughly mid-2026, work ran through Claude Code in a separate VS Code terminal.
In that era CC did the edits **and** the commits and pushes itself, and Eli's role was to
paste findings between chats. Standing prompt rules from that period — notably "end every
prompt with `git add -A && git commit && git push`" — belong to that setup and are now
actively harmful, because several Claude sessions share this working tree.

A related, narrower episode: when a Cowork session ran **in the cloud** rather than on
Eli's machine, `git push` failed with a proxy 403 on CONNECT to GitHub. That is a
different failure from the 2026-07-30 credential failure above, and both are now moot —
Claude doesn't push at all.

---

## 7. Incident: leads.created_by 400 (2026-07-17) — RESOLVED

- **Root cause:** `leads.created_by` was missing in prod even though PROJECT_LOG recorded
  it as "confirmed present." Lead-creation attribution 400'd on every insert.
- **Fix:** migration run by hand in the Supabase SQL editor on 2026-07-17. Column
  verified present in the live DB on 2026-07-20.
- **The lesson, which generalizes:** a migration file in the repo is not evidence it ran.
  Verify against the live database before trusting it.
