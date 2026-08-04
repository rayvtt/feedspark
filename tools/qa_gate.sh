#!/usr/bin/env bash
# The unattended-build QA gate — validation half of presync.sh, with NO merge step.
# Exit 0 = the working tree is genuinely shippable; anything else = not done yet.
#
# Built as the stop condition for auto-mode sessions (deck builds, feature builds):
#   /goal Done when `bash tools/qa_gate.sh` exits 0 and the change is committed & pushed.
# A session that "thinks" it finished has to prove it against the same checks presync
# and CI run — instead of guessing.
#
# Checks (mirrors presync.sh's validation, plus the bracket-placeholder sweep):
#   1. worker dry-run build bundles
#   2. dashboard inline scripts parse           (tools/check_inline_scripts.js)
#   3. shipped-feature markers intact           (tools/check_markers.js)
#   4. no bracket placeholders in changed pages ([TBC] / [TODO] / [XXX] / [INSERT …] …)
#   5. changed decks pass the content audit     (tools/deck_audit.py)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FAIL=0

echo "── qa-gate 1/5: worker dry-run build"
if npx --yes wrangler@4 deploy --dry-run --outdir "${TMPDIR:-/tmp}/fcc-qagate-out" >/dev/null 2>&1; then
  echo "   ✓ worker bundles"
else
  echo "   ✗ worker dry-run build FAILED (re-run without redirects to see why)"; FAIL=1
fi

echo "── qa-gate 2/5: dashboard inline scripts"
if node tools/check_inline_scripts.js >/dev/null 2>&1; then
  echo "   ✓ inline scripts parse"
else
  echo "   ✗ inline-script check FAILED"; FAIL=1
fi

echo "── qa-gate 3/5: shipped-feature markers"
if node tools/check_markers.js >/dev/null 2>&1; then
  echo "   ✓ no shipped feature regressed"
else
  echo "   ✗ marker tripwire FAILED (a shipped feature is missing — see node tools/check_markers.js)"; FAIL=1
fi

echo "── qa-gate 4/5: bracket placeholders in changed pages"
git fetch origin main --quiet 2>/dev/null || true
CHANGED=$(git diff --name-only origin/main -- 'docs/*.html' 2>/dev/null | grep -v '^docs/archive/' || true)
PLACE=0
if [ -n "$CHANGED" ]; then
  for f in $CHANGED; do
    [ -f "$f" ] || continue
    HITS=$(grep -nE '\[(TBC|TBD|TODO|TKTK?|XXX+|PLACEHOLDER|FILL ?IN|INSERT [A-Z])' "$f" || true)
    if [ -n "$HITS" ]; then PLACE=1; echo "   ✗ $f still carries placeholders:"; echo "$HITS" | sed 's/^/      /' | head -6; fi
  done
fi
if [ "$PLACE" = 0 ]; then echo "   ✓ no bracket placeholders"; else FAIL=1; fi

echo "── qa-gate 5/5: deck content audit (changed decks only)"
DECK_FAIL=0; AUDITED=0
if [ -n "$CHANGED" ]; then
  for d in $CHANGED; do
    [ -f "$d" ] || continue
    grep -q 'class="chapter" id="c' "$d" || continue
    AUDITED=$((AUDITED+1))
    python3 tools/deck_audit.py "$d" --quiet || DECK_FAIL=1
  done
fi
if [ "$DECK_FAIL" = 1 ]; then echo "   ✗ deck audit found hard failures"; FAIL=1
elif [ "$AUDITED" = 0 ]; then echo "   · no deck changed"; else echo "   ✓ $AUDITED deck(s) audited clean"; fi

if [ "$FAIL" = 0 ]; then
  echo "✓ qa-gate CLEAN — the working tree validates end to end"
  exit 0
fi
echo "✗ qa-gate FAILED — the build is NOT done; fix the ✗ items above"
exit 1
