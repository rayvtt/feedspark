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
#   3. access scoping: per-user Workflow views  (tools/test_access.mjs)
#   4. shipped-feature markers intact           (tools/check_markers.js)
#   5. module-nav parity across app pages       (tools/check_nav.js)
#   6. no bracket placeholders in changed pages ([TBC] / [TODO] / [XXX] / [INSERT …] …)
#   7. changed decks pass the content audit     (tools/deck_audit.py)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FAIL=0

echo "── qa-gate 1/7: worker dry-run build"
if npx --yes wrangler@4 deploy --dry-run --outdir "${TMPDIR:-/tmp}/fcc-qagate-out" >/dev/null 2>&1; then
  echo "   ✓ worker bundles"
else
  echo "   ✗ worker dry-run build FAILED (re-run without redirects to see why)"; FAIL=1
fi

echo "── qa-gate 2/7: dashboard inline scripts"
if node tools/check_inline_scripts.js >/dev/null 2>&1; then
  echo "   ✓ inline scripts parse"
else
  echo "   ✗ inline-script check FAILED"; FAIL=1
fi

echo "── qa-gate 3/7: access scoping (per-user Workflow views)"
if node tools/test_access.mjs >/dev/null 2>&1; then
  echo "   ✓ scoped views + the briefs tombstone trap hold"
else
  echo "   ✗ access-scoping harness FAILED — see node tools/test_access.mjs"; FAIL=1
fi

echo "── qa-gate 3a/7: shared working state (one team, one store)"
if node tools/test_sharedstate.mjs >/dev/null 2>&1; then
  echo "   ✓ scoped views + the partial-save wipe trap hold on /api/state"
else
  echo "   ✗ shared-state harness FAILED — see node tools/test_sharedstate.mjs"; FAIL=1
fi

echo "── qa-gate 3a2/7: brief recovery from the brief email"
if node tools/test_briefrecover.mjs >/dev/null 2>&1; then
  echo "   ✓ an emailed brief rebuilds its missing ticket, and never touches a live one"
else
  echo "   ✗ brief-recovery harness FAILED — see node tools/test_briefrecover.mjs"; FAIL=1
fi

echo "── qa-gate 3b/7: keyword-result parsing + verdict"
if node tools/test_kwresult.mjs >/dev/null 2>&1; then
  echo "   ✓ subject shape, verdict direction + inverted cost metrics hold"
else
  echo "   ✗ kwresult harness FAILED — see node tools/test_kwresult.mjs"; FAIL=1
fi

echo "── qa-gate 3c/7: call-notes client attribution"
if node tools/test_callclient.mjs >/dev/null 2>&1; then
  echo "   ✓ calls attribute from title / subject / estate roster"
else
  echo "   ✗ call-client harness FAILED — see node tools/test_callclient.mjs"; FAIL=1
fi

echo "── qa-gate 3d/7: A/B test archive parsing"
if node tools/test_abtests.mjs >/dev/null 2>&1; then
  echo "   ✓ merged cells, unsigned prose + fail-closed tab resolution hold"
else
  echo "   ✗ abtests harness FAILED — see node tools/test_abtests.mjs"; FAIL=1
fi

echo "── qa-gate 3d2/7: FS Task Manager (search grammar, billable split, page/engine parity)"
if node tools/test_reporttasks.mjs >/dev/null 2>&1; then
  echo "   ✓ field prefixes, bill:yes/no on a part-billed row + the snapshot reconcile"
else
  echo "   ✗ task-manager harness FAILED — see node tools/test_reporttasks.mjs"; FAIL=1
fi

echo "── qa-gate 3d2d/7: shipped panel (the build log as a right-hand slide-over)"
if node tools/test_shipped.mjs >/dev/null 2>&1; then
  echo "   ✓ first run silent, announces only what is new, names the branch to close"
else
  echo "   ✗ shipped-panel harness FAILED — see node tools/test_shipped.mjs"; FAIL=1
fi

echo "── qa-gate 3d2c/7: Excel exports (the XLSX writer + the Task Manager's three tabs)"
if node tools/test_xlsx.mjs >/dev/null 2>&1; then
  echo "   ✓ the ZIP parts, typed cells, absent-is-absent and the three tab exports hold"
else
  echo "   ✗ xlsx harness FAILED — see node tools/test_xlsx.mjs"; FAIL=1
fi

echo "── qa-gate 3d2b/7: FCC hours badge (trail maths, posture states, widget/engine parity)"
if node tools/test_hoursbadge.mjs >/dev/null 2>&1; then
  echo "   ✓ the partial month is flagged, a served negative is not an alarm, the twin agrees"
else
  echo "   ✗ hours-badge harness FAILED — see node tools/test_hoursbadge.mjs"; FAIL=1
fi

echo "── qa-gate 3d3/7: retainer-hours classification (optimisation vs technical vs feature vs account)"
if node tools/test_reporthours.mjs >/dev/null 2>&1; then
  echo "   ✓ precedence traps hold; the baked snapshot reconciles"
else
  echo "   ✗ reporthours harness FAILED — see node tools/test_reporthours.mjs"; FAIL=1
fi

echo "── qa-gate 3d4/7: dossier live work (running tests read from the pipeline, not just the plan)"
if node tools/test_dossierlive.mjs >/dev/null 2>&1; then
  echo "   ✓ pipeline tickets surface; stage vocabulary agrees with Workflow"
else
  echo "   ✗ dossier-live harness FAILED — see node tools/test_dossierlive.mjs"; FAIL=1
fi

echo "── qa-gate 3e/7: overlay engine (URL-string classification + feed collector)"
if node tools/test_overlays.mjs >/dev/null 2>&1; then
  echo "   ✓ overlay types read off the image_link URL; collector counts hold"
else
  echo "   ✗ overlay harness FAILED — see node tools/test_overlays.mjs"; FAIL=1
fi

echo "── qa-gate 3f/7: KWCal event ⇄ ticket tie + result-window join"
if node tools/test_kwcal_tie.mjs >/dev/null 2>&1; then
  echo "   ✓ stamped-id precedence, the name-collision guard and the half-month join hold"
else
  echo "   ✗ KWCal tie harness FAILED — see node tools/test_kwcal_tie.mjs"; FAIL=1
fi
echo "── qa-gate 3g/7: product-volume churn (running close-to-close baseline)"
if node tools/test_volume.mjs >/dev/null 2>&1; then
  echo "   ✓ intraday movement lands in the day's in/out; baseline rolls at midnight; truncation stays rows-only"
else
  echo "   ✗ volume harness FAILED — see node tools/test_volume.mjs"; FAIL=1
fi

echo "── qa-gate 3g′/7: new-product arrivals (first-seen dates → month / quarter / year + forecast)"
if node tools/test_arrivals.mjs >/dev/null 2>&1; then
  echo "   ✓ engine maths, the collector's capture (Shopping feeds only) and the worker store hold"
else
  echo "   ✗ arrivals harness FAILED — see node tools/test_arrivals.mjs"; FAIL=1
fi

echo "── qa-gate 3h/7: Golden Record PDP harvest (page extraction + host allowlist + sampler)"
if node tools/test_pdpharvest.mjs >/dev/null 2>&1; then
  echo "   ✓ details-text rules, variant-only identifiers, evidence-gated AI merge + the proxy allowlist hold"
else
  echo "   ✗ PDP harvest harness FAILED — see node tools/test_pdpharvest.mjs"; FAIL=1
fi

echo "── qa-gate 3h2/7: Vietnamese UI toggle (engine rules + seed integrity + owner gating)"
if node tools/test_i18n.mjs >/dev/null 2>&1; then
  echo "   ✓ skip / keep rules, number templating, seed integrity, owner-only route + injection hold"
else
  echo "   ✗ i18n harness FAILED — see node tools/test_i18n.mjs"; FAIL=1
fi

echo "── qa-gate 3h4/7: Task Manager integration (parser, agent, worker store, mapping)"
if node tools/test_tm.mjs >/dev/null 2>&1; then
  echo "   ✓ column resolver, hours/date parsing, tmpush store + scoped read, Leadership overlay hold"
else
  echo "   ✗ Task Manager harness FAILED — see node tools/test_tm.mjs"; FAIL=1
fi

echo "── qa-gate 3h5/7: Task Manager AUTOMATIC sync (MCP transport, rotation, ticket hours, lifted tmPull)"
if node tools/test_tmmcp.mjs >/dev/null 2>&1; then
  echo "   ✓ JSON/SSE parsing, auth modes, market rotation, ibfref hours, cron pull vs stub MCP + page wiring hold"
else
  echo "   ✗ Task Manager sync harness FAILED — see node tools/test_tmmcp.mjs"; FAIL=1
fi

echo "── qa-gate 3h3/7: phone layer (the module bar, mirror rules, pan sweep, wiring)"
if node tools/test_mobile.mjs >/dev/null 2>&1; then
  echo "   ✓ bottom bar, sheets, mirror rules, pan sweep + worker/tripwire wiring hold"
else
  echo "   ✗ phone-layer harness FAILED — see node tools/test_mobile.mjs"; FAIL=1
fi

echo "── qa-gate 3i/7: Scheduled Work (the content team's sheet → skip cadence per brand)"
if node tools/test_schedule.mjs >/dev/null 2>&1; then
  echo "   ✓ header layouts, DDMM tab dating, the AM's word + month streaks hold; the snapshot still reads"
else
  echo "   ✗ schedule harness FAILED — see node tools/test_schedule.mjs"; FAIL=1
fi

echo "── qa-gate 3j/7: work volumes (every workstream bucketed by month)"
if node tools/test_volumes.mjs >/dev/null 2>&1; then
  echo "   ✓ six date shapes, the fixed window, labelled dims + hour sums hold"
else
  echo "   ✗ volumes harness FAILED — see node tools/test_volumes.mjs"; FAIL=1
fi

echo "── qa-gate 4/7: shipped-feature markers"
if node tools/check_markers.js >/dev/null 2>&1; then
  echo "   ✓ no shipped feature regressed"
else
  echo "   ✗ marker tripwire FAILED (a shipped feature is missing — see node tools/check_markers.js)"; FAIL=1
fi

echo "── qa-gate 5/7: module-nav parity (identical menu on every page)"
if node tools/check_nav.js >/dev/null 2>&1; then
  echo "   ✓ nav identical across all app pages"
else
  echo "   ✗ nav parity FAILED (the module menu drifted — see node tools/check_nav.js)"; FAIL=1
fi

if node tools/test_replyclass.mjs >/dev/null 2>&1; then
  echo "   ✓ reply classifier agrees across worker + page"
else
  echo "   ✗ reply classifier FAILED (node tools/test_replyclass.mjs)"; FAIL=1
fi

if node tools/test_running_stage.mjs >/dev/null 2>&1; then
  echo "   ✓ Test running ⏱ stage: worker lane matches the page"
else
  echo "   ✗ test-running stage FAILED (node tools/test_running_stage.mjs)"; FAIL=1
fi

if node tools/check_lgcopy.js >/dev/null 2>&1; then
  echo "   ✓ labelguard browser copy in sync"
else
  echo "   ✗ labelguard engine copy DRIFTED (cp cloudflare/feedspark-deck/src/labelguard.js docs/labelguard_engine.js)"; FAIL=1
fi

echo "── qa-gate 6/7: bracket placeholders in changed pages"
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

echo "── qa-gate 7/7: deck content audit (changed decks only)"
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
