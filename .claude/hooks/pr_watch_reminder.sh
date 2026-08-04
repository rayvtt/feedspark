#!/bin/bash
# PostToolUse hook on mcp__github__create_pull_request (.claude/settings.json).
# Every PR a session opens should be watched — CI failures and review comments arrive
# as webhook events instead of anyone polling or remembering to ask for babysitting.
# Hooks can't call MCP tools themselves, so this injects an instruction into the
# model's context (hookSpecificOutput.additionalContext) to subscribe immediately.
set -uo pipefail
IN=$(cat 2>/dev/null || echo '{}')
python3 - "$IN" <<'PY' 2>/dev/null || exit 0
import json, re, sys
raw = sys.argv[1] if len(sys.argv) > 1 else '{}'
m = re.search(r'https://github\.com/([\w.-]+)/([\w.-]+)/pull/(\d+)', raw)
if not m:
    sys.exit(0)  # no PR URL in the payload — nothing to subscribe to
owner, repo, num = m.group(1), m.group(2), m.group(3)
ctx = (f"A pull request was just created: https://github.com/{owner}/{repo}/pull/{num} . "
       f"Per WAYS_OF_WORKING, subscribe this session to its activity NOW so CI failures and "
       f"review comments arrive as events: call subscribe_pr_activity with "
       f"owner={owner}, repo={repo}, pullNumber={num}. If this session just subscribed to this "
       f"exact PR, skip (the call is idempotent — resubscribing is harmless).")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": ctx}}))
PY
exit 0
