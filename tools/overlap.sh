#!/usr/bin/env bash
# Overlap detector (multi-session WoW): shows which OTHER active claude/* branches touch
# the same files as your branch, so same-file work gets sequenced BEFORE it collides.
#   bash tools/overlap.sh            # warn only (exit 0)
#   bash tools/overlap.sh --strict   # exit 1 on hot-file overlap (for hooks/CI)
# Hot files (one session at a time): worker.js, wrangler.toml, CLAUDE.md, the app-page
# monoliths. See docs/WAYS_OF_WORKING.md → "Shared-file chokepoints".
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

STRICT=0; [ "${1:-}" = "--strict" ] && STRICT=1
HOT='cloudflare/feedspark-deck/src/worker.js|wrangler.toml|CLAUDE.md|docs/FeedSpark_Command_Center.html|docs/FeedSpark_Workflow.html|docs/atrt_data.json'

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin main --quiet
git fetch origin '+refs/heads/claude/*:refs/remotes/origin/claude/*' --prune --quiet 2>/dev/null || true

# my changed files: committed vs merge-base with main, plus anything uncommitted
MINE=$( { git diff --name-only "$(git merge-base HEAD origin/main)"...HEAD 2>/dev/null; git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null; } | sort -u | grep -v '^$' || true)
if [ -z "$MINE" ]; then echo "── overlap: no changes on $BRANCH yet — nothing to compare"; exit 0; fi

echo "── overlap: $BRANCH changes $(echo "$MINE" | wc -l | tr -d ' ') file(s)"
FOUND=0; HOTHIT=0
for REF in $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/claude/*'); do
  B=${REF#origin/}
  [ "$B" = "$BRANCH" ] && continue
  # skip branches fully merged into main (stale leftovers)
  if git merge-base --is-ancestor "$REF" origin/main 2>/dev/null; then continue; fi
  THEIRS=$(git diff --name-only "$(git merge-base "$REF" origin/main)".."$REF" 2>/dev/null | sort -u || true)
  [ -z "$THEIRS" ] && continue
  COMMON=$(comm -12 <(echo "$MINE") <(echo "$THEIRS") || true)
  [ -z "$COMMON" ] && continue
  FOUND=1
  echo "⚠ overlap with active branch $B:"
  while IFS= read -r f; do
    if echo "$f" | grep -qE "^($HOT)$"; then HOTHIT=1; echo "   🔥 $f   (HOT file — one session at a time; sequence this)"; else echo "   ·  $f"; fi
  done <<< "$COMMON"
done

if [ "$FOUND" = 0 ]; then echo "✓ no file overlap with any active claude/* branch"; exit 0; fi
echo ""
echo "Sequence, don't parallel-edit: check the open-PR list, agree order, and re-run presync"
echo "after the other branch merges. (docs/WAYS_OF_WORKING.md → Overlap safeguards)"
[ "$STRICT" = 1 ] && [ "$HOTHIT" = 1 ] && exit 1 || exit 0
