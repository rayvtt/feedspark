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

echo "── validating: access scoping (per-user Workflow views)"
node tools/test_access.mjs >/dev/null
echo "   ✓ scoped views + the briefs tombstone trap hold"

echo "── validating: live deck editor (real browser)"
if NODE_PATH=$(npm root -g) node -e "require('playwright')" 2>/dev/null; then
  NODE_PATH=$(npm root -g) node tools/test_editor.mjs || {
    echo "✗ editor tests failed — the save/load guards are what stop edits landing on the wrong element"; exit 1; }
else
  echo "   · playwright unavailable, skipped (run tools/test_editor.mjs before shipping editor changes)"
fi

echo "── validating: shipped-feature markers (overwrite tripwire)"
node tools/check_markers.js >/dev/null
echo "   ✓ no shipped feature regressed"

echo "── validating: module-nav parity (the menu stays identical on every page)"
node tools/check_nav.js >/dev/null
echo "   ✓ nav identical across all app pages"

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

  # Shape diff. data-eid keys are positional, so adding/removing/re-chaptering an editable
  # element re-points every saved edit after it. The editor now recovers those by content key
  # and reports what it can't — but you should still know you are about to do it, and say so
  # to whoever is editing.
  for d in $DECKS_CHANGED; do
    [ -f "$d" ] || continue
    grep -q 'class="chapter" id="c' "$d" || continue
    git show "origin/main:$d" > "${TMPDIR:-/tmp}/presync-base.html" 2>/dev/null || continue
    python3 tools/deck_audit.py "${TMPDIR:-/tmp}/presync-base.html" --shape > "${TMPDIR:-/tmp}/presync-base.shape" 2>/dev/null || continue
    python3 tools/deck_audit.py "$d" --shape > "${TMPDIR:-/tmp}/presync-new.shape" 2>/dev/null || continue
    if ! diff -q "${TMPDIR:-/tmp}/presync-base.shape" "${TMPDIR:-/tmp}/presync-new.shape" >/dev/null; then
      echo "   ⚠ $d — editable-element shape CHANGED vs main:"
      diff "${TMPDIR:-/tmp}/presync-base.shape" "${TMPDIR:-/tmp}/presync-new.shape" | sed 's/^/       /' | head -20
      echo "       Saved live edits in these chapters shift position. The editor recovers them by"
      echo "       content and reports the rest — but tell Ray before pushing if he is mid-edit."
    fi
  done
else
  echo "   · no deck changed on this branch"
fi

echo "── checking overlap with other active claude/* branches"
bash tools/overlap.sh || true

# Deck files specifically are a HARD stop, not a warning. Two sessions editing worker.js
# resolve as a normal merge; two sessions editing the same deck produce a file that merges
# cleanly and is still wrong — and the last one to push silently defines the shape every live
# saved edit is keyed against. This already caused a mid-operation rebase collision.
if [ -n "$DECKS_CHANGED" ]; then
  CLASH=0
  for br in $(git for-each-ref --format='%(refname:short)' refs/remotes/origin/claude/ 2>/dev/null); do
    [ "$br" = "origin/$BRANCH" ] && continue
    for d in $DECKS_CHANGED; do
      if git diff --name-only "origin/main...$br" 2>/dev/null | grep -qx "$d"; then
        echo "✗ $d is also changed on $br"; CLASH=1
      fi
    done
  done
  if [ "$CLASH" = 1 ]; then
    echo "  Sequence deck edits — merge or close the other branch first, then re-run presync."
    echo "  (override deliberately with ALLOW_DECK_OVERLAP=1 if you have agreed the order)"
    [ "${ALLOW_DECK_OVERLAP:-0}" = "1" ] || exit 1
  fi
fi

echo "✓ presync clean — $BRANCH is synced with main and validates. Open/merge the PR."
