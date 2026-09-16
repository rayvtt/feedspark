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

echo "── validating: brief recovery from the brief email"
node tools/test_briefrecover.mjs >/dev/null
echo "   ✓ an emailed brief rebuilds its missing ticket, and never touches a live one"

echo "── validating: shared working state (one team, one store)"
node tools/test_sharedstate.mjs >/dev/null
echo "   ✓ scoped views + the partial-save wipe trap hold on /api/state"

echo "── validating: overlay engine (URL-string classification + collector)"
node tools/test_overlays.mjs >/dev/null
echo "   ✓ overlay types read off the image_link URL"

echo "── validating: KWCal event ⇄ ticket tie + result-window join"
node tools/test_kwcal_tie.mjs >/dev/null
echo "   ✓ stamped-id precedence + the half-month result join hold"

echo "── validating: product-volume churn (running close-to-close baseline)"
node tools/test_volume.mjs >/dev/null
echo "   ✓ intraday movement lands in the day's in/out; baseline rolls at midnight"

echo "── validating: new-product arrivals (first-seen dates → forecast)"
node tools/test_arrivals.mjs >/dev/null
echo "   ✓ engine maths + collector capture + worker store hold"

echo "── validating: Golden Record PDP harvest (extraction + allowlist + sampler)"
node tools/test_pdpharvest.mjs >/dev/null
echo "   ✓ details-text rules, variant-only identifiers + the proxy allowlist hold"

echo "── validating: Vietnamese UI toggle (engine + seed + owner gating)"
node tools/test_i18n.mjs >/dev/null
echo "   ✓ skip / keep rules, number templating, seed integrity, owner-only route + injection hold"

echo "── validating: phone layer (bar, sheets, mirror rules, pan sweep, wiring)"
node tools/test_mobile.mjs >/dev/null
echo "   ✓ bottom bar, sheets, mirror rules, pan sweep + wiring hold"

echo "── validating: Scheduled Work (sheet → skip cadence per brand)"
node tools/test_schedule.mjs >/dev/null
echo "   ✓ header layouts, DDMM tab dating, the AM's word + month streaks hold"

echo "── validating: work volumes (every workstream bucketed by month)"
node tools/test_volumes.mjs >/dev/null
echo "   ✓ six date shapes, the fixed window, labelled dims + hour sums hold"

echo "── validating: live deck editor (real browser)"
if NODE_PATH=$(npm root -g) node -e "require('playwright')" 2>/dev/null; then
  NODE_PATH=$(npm root -g) node tools/test_editor.mjs || {
    echo "✗ editor tests failed — the save/load guards are what stop edits landing on the wrong element"; exit 1; }
  echo "── validating: brand one-pager (the client-facing sheet — real numbers, no leaks)"
  NODE_PATH=$(npm root -g) node tools/test_onepager.mjs || {
    echo "✗ one-pager tests failed — this is the sheet that leaves the building; a wrong number or an internal word on it is a client-facing error"; exit 1; }
  echo "── validating: one team, one board (two real browsers on the same pipeline)"
  NODE_PATH=$(npm root -g) node tools/test_teamsync.mjs || {
    echo "✗ team-sync tests failed — this is the class of bug where one person's briefs, intake rows or plan writes stay invisible to everyone else"; exit 1; }
  echo "── validating: dark view (every app page rendered dark — no light islands)"
  NODE_PATH=$(npm root -g) node tools/check_darkmode.js || {
    echo "✗ dark-view tripwire failed — a hard-coded light background slipped past the page's [data-theme=dark] block"; exit 1; }
  echo "── validating: phone layout (every app page at 390px — one-row header, module bar, no overflow, desktop parity)"
  NODE_PATH=$(npm root -g) node tools/check_mobile.js || {
    echo "✗ phone tripwire failed — a page overflows sideways, hides a desktop control or lost its module bar"; exit 1; }
else
  echo "   · playwright unavailable, skipped (run tools/test_editor.mjs before shipping editor changes)"
fi

echo "── validating: shipped-feature markers (overwrite tripwire)"
node tools/check_markers.js >/dev/null
echo "   ✓ no shipped feature regressed"

echo "── validating: module-nav parity (the menu stays identical on every page)"
node tools/check_nav.js >/dev/null
echo "   ✓ nav identical across all app pages"

echo "── validating: labelguard browser-engine copy (served /labels/engine.js = src)"
node tools/test_replyclass.mjs >/dev/null
echo "   ✓ reply classifier agrees across worker + page"

node tools/test_running_stage.mjs >/dev/null
echo "   ✓ Test running ⏱ stage: worker lane matches the page"

node tools/check_lgcopy.js >/dev/null
echo "   ✓ docs/labelguard_engine.js in sync"

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
