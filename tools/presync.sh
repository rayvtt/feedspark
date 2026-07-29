#!/usr/bin/env bash
# Pre-merge sync + validation for FCC feature branches (multi-session WoW).
# Run from anywhere inside the repo, on your feature branch, BEFORE opening/merging a PR:
#   bash tools/presync.sh
# It: fetches latest main -> merges it into the current branch -> dry-run-builds the
# worker -> syntax-checks the dashboard pages. Green here = safe to open/merge the PR.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "✗ You are on main — presync runs on a feature branch." >&2
  exit 1
fi

echo "── presync: $BRANCH"
git fetch origin main --quiet
BEHIND=$(git rev-list --count HEAD..origin/main)
echo "── behind origin/main by $BEHIND commit(s)"

if [ "$BEHIND" -gt 0 ]; then
  echo "── merging origin/main into $BRANCH"
  # a conflict stops the script here (exit != 0) — resolve, commit, re-run
  git merge --no-edit origin/main
fi

echo "── validating: worker dry-run build"
npx --yes wrangler@4 deploy --dry-run --outdir "${TMPDIR:-/tmp}/fcc-presync-out" >/dev/null
echo "   ✓ worker bundles"

echo "── validating: dashboard inline scripts"
node tools/check_inline_scripts.js >/dev/null
echo "   ✓ inline scripts parse"

echo "── validating: shipped-feature markers (overwrite tripwire)"
node tools/check_markers.js >/dev/null
echo "   ✓ no shipped feature regressed"

echo "── auditing: deck content consistency (changed decks only)"
# Structural validation is not enough. The Reiss deck once passed every structural check
# while quoting two different values for the same metric, citing a figure whose source
# chapter had just been deleted, and pointing "chapters 14-15" at the wrong chapters. That
# shipped, and the client-facing reader found it. Any deck touched on this branch gets
# content-audited here, before the PR, not after someone spots it.
# working tree vs origin/main, NOT origin/main...HEAD — the three-dot form ignores
# uncommitted edits, which is exactly the state a deck is in when you most want the audit
DECKS_CHANGED=$(git diff --name-only origin/main -- 'docs/*.html' | grep -v '^docs/archive/' || true)
if [ -n "$DECKS_CHANGED" ]; then
  DECK_FAIL=0
  for d in $DECKS_CHANGED; do
    [ -f "$d" ] || continue
    grep -q 'class="chapter" id="c' "$d" || continue
    python3 tools/deck_audit.py "$d" --quiet || DECK_FAIL=1
  done
  [ "$DECK_FAIL" = 0 ] || { echo "✗ deck audit found hard failures — fix before opening the PR"; exit 1; }
  echo "   ✓ decks audited (read the REVIEW list above before you confirm anything as final)"
else
  echo "   · no deck changed on this branch"
fi

echo "── checking overlap with other active claude/* branches"
bash tools/overlap.sh || true

echo "✓ presync clean — $BRANCH is synced with main and validates. Open/merge the PR."
