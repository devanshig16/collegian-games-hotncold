#!/usr/bin/env bash
# Commit any tracked changes in the repo with a timestamped message.
# Use from cron or launchd, or run manually: ./scripts/auto-commit.sh
#
# Optional: AUTO_COMMIT_PUSH=1 to also git push after commit.
# Optional: AUTO_COMMIT_BRANCH=main (default: current branch)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: $ROOT" >&2
  exit 1
fi

BRANCH="${AUTO_COMMIT_BRANCH:-$(git branch --show-current)}"
if [[ -n "$BRANCH" ]] && [[ "$(git branch --show-current)" != "$BRANCH" ]]; then
  git checkout "$BRANCH"
fi

if git diff --quiet && git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi

MSG="chore: auto-commit $(date -u +"%Y-%m-%dT%H:%MZ")"
git add -A
git commit -m "$MSG"

if [[ "${AUTO_COMMIT_PUSH:-0}" == "1" ]]; then
  git push
fi

echo "Committed: $MSG"
