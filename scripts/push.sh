#!/usr/bin/env bash
# Clear the stale git locks a sandboxed Cowork session leaves behind, then push.
#
#   ./scripts/push.sh
#
# WHY THIS EXISTS: a Cowork/Claude session works on ~/dev/prsflow through a FUSE
# mount. `git commit` succeeds there, but git's .lock files cannot be unlinked
# from inside the sandbox, so the NEXT git command fails with "cannot lock ref
# 'HEAD'". The session also has no GitHub credentials, so it can never push.
# Both are documented in docs/working-conventions.md — this script is that
# knowledge made runnable.
#
# ⚠ THIS SCRIPT DELIBERATELY DOES NOT COMMIT (changed 2026-09-08).
# It used to take a message and run `git commit -m "$1"`, which can only produce
# a ONE-LINE commit. Eli noticed the log had gone thin and traced it here: the
# tool was enforcing exactly the habit it should have prevented. This repo's
# value is in the recorded *why* — a subject-only commit throws that away, and
# `git blame` is where the next person actually looks.
#
# So: Claude commits (with a real body, in the sandbox), this script pushes.
# If there is nothing to push, it says so rather than inventing a commit.
set -u

cd "$(dirname "$0")/.." || exit 1

rm -f .git/HEAD.lock .git/index.lock 2>/dev/null

if [ "$#" -ge 1 ]; then
  echo "This script no longer takes a commit message — it only pushes."
  echo "A one-line -m is what made the log thin; ask Claude to commit with a"
  echo "proper body, then run ./scripts/push.sh with no arguments."
  echo
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠ Uncommitted changes are present. They will NOT be pushed:"
  git status --short
  echo
fi

AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
if [ "$AHEAD" = "0" ]; then
  echo "Already up to date with origin — nothing to push."
  exit 0
fi

echo "Pushing $AHEAD commit(s):"
git log --oneline @{u}..HEAD
echo
git push
