#!/bin/bash
# FCC multi-session WoW — session-start sync + overlap report.
# Registered as a SessionStart hook in .claude/settings.json: every session opens with
# fresh origin/main, the active claude/* branch picture, and the overlap scan already
# in context — the two WAYS_OF_WORKING.md steps nobody should have to remember.
# stdout is injected into the session's context. MUST NEVER block a session: no -e,
# every step degrades to a note.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

echo "── FCC session sync (auto: .claude/hooks/session_sync.sh)"

if git fetch origin main --quiet 2>/dev/null; then :; else
  echo "· git fetch failed (offline / no credentials) — branch picture may be stale"
fi
git fetch origin '+refs/heads/claude/*:refs/remotes/origin/claude/*' --prune --quiet 2>/dev/null || true

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
echo "· on $BRANCH — behind origin/main by $BEHIND commit(s)"

# other in-flight claude/* branches (not yet merged into main) = parallel sessions
ACTIVE=0
for REF in $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/claude/*' 2>/dev/null); do
  B=${REF#origin/}
  [ "$B" = "$BRANCH" ] && continue
  git merge-base --is-ancestor "$REF" origin/main 2>/dev/null && continue
  ACTIVE=$((ACTIVE+1))
  echo "· in-flight: $B — $(git log -1 --format='%s (%cr)' "$REF" 2>/dev/null || echo '?')"
done
[ "$ACTIVE" = 0 ] && echo "· no other in-flight claude/* branches"

# overlap scan, warn mode (never fails the hook)
bash tools/overlap.sh 2>/dev/null || echo "· overlap scan unavailable"

echo "── WoW defaults: sequence 🔥 hot-file overlap; check open PRs (mcp__github__list_pull_requests)"
echo "── before opening a PR: /presync (or bash tools/presync.sh > /tmp/presync.log 2>&1)"
exit 0
