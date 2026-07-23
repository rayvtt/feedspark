# Ways of Working

Two parallel-work protocols in one doc:

1. **[Multi-session development](#multi-session-claude-code-development)** — how 4–5 Claude Code
   sessions build FCC features at the same time without clobbering each other.
2. **[Parallel editing](#parallel-editing--ray--claude-on-one-deck)** — how Ray (content) and
   Claude (template) edit the same deck at the same time.

---

# Multi-session Claude Code development

Ray runs several Claude Code sessions in parallel (different features, different times). The deploy
pipeline is deterministic (see [`DEPLOY_PROTOCOL.md`](./DEPLOY_PROTOCOL.md)), so the remaining risks
are **branch drift** (main moves under a stale branch) and **two sessions editing the same file**.
This protocol removes both.

## The model — trunk-based, one short-lived branch per task

- `main` is the single source of truth and always deployable (`validate.yml` gates every PR).
- Each session works on its **own** branch off the **latest** main: `claude/<module>-<slug>`
  (e.g. `claude/workflow-am-filter`, `claude/cmdcenter-ryobi`). **Never share a branch between
  sessions.**
- Small, single-purpose PRs, merged often, branch deleted after merge. After a session's PR merges,
  the session **restarts its branch from latest main** for its next task — that restart *is* the
  sync mechanism.

## Module partitioning — guideline, not law

Default each session to one module so parallel edits land in different files:

| Session lane | Owns (default) |
|---|---|
| Workflow | `docs/FeedSpark_Workflow.html` |
| Command Center | `docs/FeedSpark_Command_Center.html` (+ `atrt_data.json` via `sync_atrt.py`) |
| Deck Generator | `docs/FeedSpark_DeckBuilder.html`, deck templates, the deck-generator skill |
| Worker / API | `cloudflare/feedspark-deck/src/worker.js`, `wrangler.toml` |
| Other modules | Readiness / Leadership / Task Library / Roadmap / Templates pages |

Crossing lanes is allowed when the task needs it — the rule is only: **check what's in flight
first, and sequence rather than parallel-edit the same file** (one session merges, the other syncs,
then edits). Two sessions in different files ≈ zero conflicts.

## Coordination — the open-PR list is the board

Before starting work, a session checks **open PRs and remote `claude/*` branches** to see what's in
flight (`list_pull_requests` + `git ls-remote --heads origin 'claude/*'`). Prefix PR titles with the
module — `[Workflow] …`, `[CmdCenter] …`, `[Worker] …` — so the list is scannable at a glance.
No separate board/issue tracker to maintain.

## The session lifecycle (checklist)

1. **Start** — `git fetch origin main` → branch `claude/<module>-<slug>` off `origin/main` → scan
   open PRs/branches for overlap.
2. **Work** — small in-module changes; validate locally as you go
   (`npx wrangler@4 deploy --dry-run` + `node tools/check_inline_scripts.js`).
3. **Pre-merge** — run **`bash tools/presync.sh`**: it fetches + merges latest `main` into the
   branch and re-runs both validations. Resolve any conflict here, not in the PR.
4. **Merge** — small squash PR (module-prefixed title). Delete the branch.
5. **Verify LIVE** — per the CLAUDE.md rule: Deploy Action green → worker re-published →
   `/api/version` sha is your commit **or a later one containing it** (another session may have
   merged after you — fine) → the feature is actually present on the page.
6. **Next task** — restart the branch from latest `main`.

## Shared-file chokepoints (the few real ones)

- **`wrangler.toml` + DO migrations** — migration tags are **append-only and incrementing**
  (`v2` is taken). If two sessions need a migration, coordinate the tag; never reuse or reorder.
- **`worker.js`** — one session at a time; it's one file serving every module. Sequence.
- **`atrt_data.json` / Command Center ATRT regions** — regenerate via `tools/sync_atrt.py`, never
  hand-edit the spliced regions; sequence with any other Command Center work.
- **CLAUDE.md / this doc** — docs-only PRs, merge fast to minimise the window.

## Anti-patterns

- ❌ One branch shared across sessions (guaranteed force-push fights)
- ❌ Mega-PRs mixing modules (hard to review, blocks other lanes)
- ❌ Merging without `presync.sh` (drift lands as surprise conflicts or reverts)
- ❌ Two sessions live-editing the same monolith file in parallel
- ❌ Reporting "shipped" on a merge alone — always verify live (CLAUDE.md rule)

## Overlap safeguards — tooling + protocol (added after the 2026‑07‑23 near-misses)

Three real incidents on one day of 4–5 parallel sessions, all on shared files:

1. **Semantic clobber (the dangerous one).** PR #60 replaced the deck download block with a *new*
   block while another session was guarding the *old* one. The git merge was textually clean —
   and the feature was still broken on the live page (button back on the CC). **A clean merge is
   not an intact feature.**
2. **Competing implementations.** A per-deck Download-PDF button (ec200f6) was reverted (5a8044e)
   in favour of the universal exporter (9947cc1) — duplicated work, revert churn.
3. **Same-file doc races.** CLAUDE.md rewritten by two sessions ~30 min apart (#57, #58); merged
   luckily-clean.

The audit also confirmed **no shipped feature was actually lost** — but only manual inspection
caught #1, so the protocol now makes that inspection automatic:

### 1. Feature manifest — the overwrite tripwire (`docs/feature_manifest.json`)
Every shipped feature that lives in a **shared file** gets a one-line marker entry
(name → file → grep pattern; `forbidden: true` pins *retired* features so they stay gone).
`tools/check_markers.js` asserts every marker on every PR (validate.yml) and in `presync.sh`.
If your merge silently reverts another session's shipped work, **CI goes red with the PR number
that shipped it**. Duties:
- **Ship a feature in a shared file → add its marker in the same PR.**
- Never remove/weaken someone else's marker except in a PR that deliberately retires the feature.

### 2. Overlap detector (`tools/overlap.sh`)
Diffs your branch against every **active** `claude/*` branch (merged-into-main ones are skipped)
and lists common files, flagging 🔥 hot files (worker.js, wrangler.toml, CLAUDE.md, the app-page
monoliths, atrt_data.json). Runs automatically in `presync.sh`; run it standalone when you START
a task, before writing code. On a 🔥 hit: **sequence** — check the open-PR list, agree order,
wait for the other merge, then presync.

### 3. The semantic-integration rule (lesson of incident #1)
After `presync.sh` merges latest `main` into your branch, if the merge brought changes to a file
you're editing: **re-verify your feature *behaves*, not just that git merged.** Re-run your QA
against the merged tree and re-read the touching region — another session may have restructured
the code your change hooks into (new block, renamed function, moved anchor).

### 4. Known gap — FCC runtime data (KV last-write-wins)
`PUT /api/clients` (dossier edits) and `PUT /api/briefs` (Workflow pipeline) write the **whole
map** — two open browser tabs, or two people (Ray + Steven), can silently clobber each other's
saves. `/api/edits` merges per-key and is safe. Phase‑2 fix, deliberately not rushed: per-key
server-side merge with `updatedAt` per entry + tombstone timestamps (a naive merge would
resurrect deleted entries), or a `_rev` optimistic-concurrency check returning 409 → refetch +
merge client-side. Until it ships: one editor at a time per surface; refresh (`↻`) before a burst
of dossier/brief edits.

---

# Parallel Editing — Ray + Claude on one deck

How Ray and Claude edit the same FeedSpark HTML deck **at the same time** without clobbering each
other. The rule that makes it work: **separate the content layer from the template layer.**

| Layer | Owner | Lives in | Changed via |
|---|---|---|---|
| **Template** — structure, layout, CSS, the edit engine | **Claude** | git (`docs/*.html`) | Claude Code edits + commits |
| **Content edits** — the actual copy | **Ray** | a `data-eid` JSON patch (KV when live) | in-browser edit mode → *Export edits* |

Because Ray's edits are keyed to **stable `data-eid` anchors** (not line numbers or DOM position),
Claude can restructure the template — add sections, resize, restyle — and Ray's copy edits still
land on the right elements when merged.

---

## The one golden rule

> ### ❌ Never round-trip a deck through the browser's "↓ Download HTML".
> That button re-serialises the whole document (encoding `&` → `&amp;`, adding `class=""`, baking in
> JS inline styles) **and strips every `data-eid` key**. The result is a 600-line git diff of noise
> with the merge anchors gone. `Download HTML` is for **final client delivery only** — never for
> handing edits back.
>
> ### ✅ Hand edits back as a patch: click **"⤴ Export edits"** → paste the JSON (or let KV sync it).

`git` stays the source of truth for the template; the patch is the content.

---

## Mode A — git-native (no hosting needed)

1. **Ray** opens the deck locally, `✎ Edit mode`, edits copy, **⤴ Export edits** → sends the JSON.
2. **Claude** commits the JSON as `docs/<deck>.edits.json`, then merges it onto the current template:
   ```bash
   python tools/apply_edits.py docs/<deck>.html docs/<deck>.edits.json --in-place
   ```
   `apply_edits.py` splices **only** the edited text spans by `data-eid`, so the diff shows exactly
   what copy changed. Missed keys (element deleted/renamed) are reported, never dropped silently.
3. Claude's own structural changes and Ray's copy edits compose because they touch different things
   (Claude: tags/layout/CSS; Ray: inner text of `data-eid` elements).

## Mode B — live, hosted (Cloudflare Worker + KV)

The `cloudflare/feedspark-deck` worker serves the deck at one URL, behind Cloudflare Access:

- Ray's edits **auto-save to KV** (keyed by `data-eid`), debounced — no export/paste step.
- Claude edits the deck **in git** and pushes to `main`; Cloudflare rebuilds and the new deck is
  bundled into the worker. **KV content persists** and re-overlays on the next load. Both work on the
  same live URL, in parallel.
- `GET /api/edits` / `PUT /api/edits` / `DELETE /api/edits` manage the content layer.

This is Mode A with the patch handoff automated. Deploy: see `cloudflare/feedspark-deck/README.md`.

---

## Structural / visual edits — Claude Code in the loop (no API cost)

Text is Ray's layer; **structure and style are Claude Code's layer** — and "Claude Code" means
*this chat interface*, not a paid in-deck API. When Ray wants a box recoloured, a card resized, an
image added, or bullets turned into a grid, the deck's editor makes the hand-off one click:

1. In edit mode, click the element → the **◎ Element** panel shows its `data-eid` and tag.
2. **Copy for Claude Code** copies the element's `data-eid` + `outerHTML` with a ready-made prompt.
3. Paste it into the Claude Code chat and finish the sentence (*"…make this box orange"*).
4. Claude Code edits the **deck in git** and pushes to `main`; Cloudflare rebuilds and bundles the new
   deck. Ray's KV text edits re-overlay on top — nothing he typed is lost.

So the two of you edit in parallel with **zero API spend**: Ray on text (live, in KV), Claude Code
on structure (git → template push), reconciled by `data-eid`. Setup: `cloudflare/feedspark-deck/README.md`.

**PDF export is also universal, not per-deck.** Every deck gets a "Download PDF" button for free
via `getEditorScript()` in `worker.js` (client-side `window.print()` + a print stylesheet) — same
injection point as the edit widget above. Don't add a print button or print CSS to an individual
deck's HTML file; extend the shared implementation in `worker.js` instead.

---

## Git conventions for parallel work

- **Claude never edits a file Ray says he is "currently editing"** as a raw file — Claude works on
  the template and merges Ray's exported patch, rather than typing into the same bytes.
- Small, single-purpose commits so a divergence is a clean rebase, not a conflict.
- The template always keeps its `data-eid` attributes in git (they are the merge anchors). Only the
  *delivery* copy (via Download HTML) strips them.
- Decks served by the worker get the editor widget automatically (injected before `</body>`), so
  every hosted deck is parallel-edit-ready from day one. See `docs/FeedSpark_Deck_LiveEdit_Feature.md`
  for the element/CSS contract.
