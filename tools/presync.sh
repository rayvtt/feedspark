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

echo "── checking overlap with other active claude/* branches"
bash tools/overlap.sh || true

echo "✓ presync clean — $BRANCH is synced with main and validates. Open/merge the PR."
