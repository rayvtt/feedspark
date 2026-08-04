---
name: presync
description: Merge latest main into the current feature branch and run the full FCC validation gauntlet (worker dry-run build, inline-script parse, shipped-feature marker tripwire, deck content audit, overlap scan). Run this before opening ANY pull request in this repo, and suggest it proactively whenever a session is about to open a PR. Also useful at task start to surface branch overlap early.
allowed-tools: Bash(bash tools/presync.sh*), Bash(bash tools/overlap.sh*), Bash(node tools/check_markers.js*), Bash(git status*), Bash(git diff*), Bash(git log*)
---

# /presync — sync with main + validate before a PR

Run the pre-merge gauntlet. All tool calls this needs are pre-approved — no permission
prompts, so it also works unattended.

## Run it

```bash
bash tools/presync.sh > /tmp/presync.log 2>&1 && echo PRESYNC_OK || { echo PRESYNC_FAILED; tail -25 /tmp/presync.log; }
```

**Never pipe presync through `tail`/`head` inside a `&&` chain** — exit-masking once
shipped committed conflict markers to main. Always the log-file pattern above.

## If it fails

- **Merge conflict** — resolve, commit the merge, re-run. For
  `docs/feature_manifest.json` use the parse-level union: load both sides from the
  merge stages (`git show :2:docs/feature_manifest.json`, `git show :3:...`), union the
  `markers` arrays deduped by `(file, pattern, forbidden)`, write valid JSON, then
  `node tools/check_markers.js` before concluding the merge. Never text-union a JSON file.
- **Marker regression** — you (or the merge) clobbered a shipped feature. Restore it;
  never weaken someone else's manifest entry outside a deliberate retirement PR.
- **Deck audit hard-fail** — fix the deck content (stale numbers, dangling chapter
  references) before the PR; the audit exists because a client-facing reader once
  caught what the structural checks missed.
- **Uncommitted changes block the merge** — commit your work first, then re-run.

## After a clean run

If presync's merge touched a file you were editing, re-run your QA suite — a clean git
merge is not an intact feature. Then open the PR.
