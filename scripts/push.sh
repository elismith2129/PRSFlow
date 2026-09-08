#!/usr/bin/env bash
# Commit + push everything, clearing the stale git locks a sandboxed Cowork
# session leaves behind.
#
# WHY THIS EXISTS: a Cowork/Claude session works on ~/dev/prsflow through a FUSE
# mount. `git commit` succeeds there, but git's .lock files cannot be unlinked
# from inside the sandbox, so the NEXT git command fails with "cannot lock ref
# 'HEAD'". The session also has no GitHub credentials, so it can never push.
# Both are documented in docs/working-conventions.md — this script is that
# knowledge made runnable, so it isn't re-explained every session.
#
#   ./scripts/push.sh "commit message"     — stage all, commit, push
#   ./scripts/push.sh                      — just clear locks and push what's committed
set -u

cd "$(dirname "$0")/.." || exit 1

rm -f .git/HEAD.lock .git/index.lock 2>/dev/null

if [ "$#" -ge 1 ] && [ -n "${1:-}" ]; then
  git add -A || exit 1
  # Nothing staged is not an error — the session may have already committed.
  if git diff --cached --quiet; then
    echo "Nothing new to commit; pushing what's already committed."
  else
    git commit -m "$1" || exit 1
  fi
fi

AHEAD=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
if [ "$AHEAD" = "0" ]; then
  echo "Already up to date with origin — nothing to push."
  exit 0
fi

echo "Pushing $AHEAD commit(s)…"
git push
