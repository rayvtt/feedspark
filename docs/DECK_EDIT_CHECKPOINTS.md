# Deck generation & editing — checkpoint register

Every action that can touch a live deck, what actually happens underneath, and where two
actions can collide. Written after the Reiss FY25/26 episode, where a chapter deletion
pushed from Code silently invalidated a live editing session and cost two days of
round-trips.

Everything in **How the machine actually works** was read out of
`cloudflare/feedspark-deck/src/worker.js` at the line numbers given, not recalled.

---

## How the machine actually works

A rendered deck is **git template + KV overlay**. Neither alone is what the client sees.

| Piece | Lives in | Source of truth for |
|---|---|---|
| Template | `docs/<Deck>.html`, imported into the worker as a Text module | structure, and any copy never edited live |
| Overlay | KV `edits:<slug>` | every edit Ray has made in the browser |
| Unsaved queue | JS `dirty{}` in the open tab | edits typed in the last 0.6–1.2s |
| Unsent mirror | `localStorage['de-unsaved-<slug>']` | patches that reached `flush()` but the server rejected |
| Undo stack | `sessionStorage` (`slice(-20)`) | pre-change overlay snapshots, **dies with the tab** |
| Reset/replace backups | KV `edits-bak:<slug>:<ts>` | pre-wipe overlay copies |

### Key assignment — the thing everything else hinges on

`assignEids()` (worker.js:1761) runs **at load, for every viewer** (:2473), before
`loadEdits()` (:2487). For each element matching `SEL` (:1419) it assigns:

```
data-eid = <chapterKey> + '-e' + <index within that chapter, document order>
```

- `chapterKey` is the nearest preceding `.chapter[id]`, else `top` (`chapterKeyFor`, :1752).
- `editable()` (:1737) **skips elements whose trimmed text is empty**, so an empty element
  does not consume an index.
- Design-mode blocks and groups get `data-eid …-b<i>` / `data-tid …-g<i>` the same way
  (`assignBlockIds`, :1900).

**The overlay is therefore keyed to a snapshot of the template's shape.** Nothing records
which shape. This single fact causes most of the register below.

### Save path

`queueSave` (:1887) → debounce **1200ms** (style: **600ms**, :1896) → `flush()` (:2253) →
`backupLocal(patch)` → `PUT /api/edits?page=<slug>` → on success `clearBackup()`, on failure
the patch is put **back** on `dirty` and the "not saved" banner shows.

Server-side `PUT` (:172) is a shallow merge — `{...existing, ...incoming}` — with **no**
optimistic-concurrency check. (`/api/briefs` and `/api/clients` do use `kvmerge` +
`X-Sync-Base`; `/api/edits` does not.)

### Load path

`loadEdits()` (:1784): `__added:` blocks replayed first → `__order:` reorders → per-eid
patches → delete tombstones, each validated against `sigOf(el)` (normalised `textContent`,
:1782). A tombstone whose signature no longer matches is **skipped and counted**, never
applied — that is the red "N saved deletions were skipped" banner.

---

## Checkpoint register

### A — Generating a new deck

| # | Checkpoint | Status |
|---|---|---|
| A1 | Build from the brief; wire into `PAGES` + `PLAN_SHEETS` | covered by SKILL.md Steps 3–4 |
| A2 | `deck_audit.py` clean (0 hard) | **enforced** in `presync.sh` |
| A3 | Read every chapter before calling it final | required by SKILL.md Step 5 |
| A4 | Verify live: green Deploy run + bundle grep + `/api/version` | required by CLAUDE.md |
| A5 | No overlay exists yet, so no collision risk | — |

A new deck is the safe case. Everything below is about decks that already have an overlay.

### B — Ray editing live, no Code activity

| # | Checkpoint | Status |
|---|---|---|
| B1 | Edit lands in `dirty{}` | in memory only for up to 1.2s |
| B2 | Debounce fires, `backupLocal` writes localStorage | only reached if the tab survives 1.2s → **C1** |
| B3 | PUT merges into `edits:<slug>` | last-writer-wins, no version check → **C3** |
| B4 | Access session expires mid-edit | handled — `deJSON` (:1462) rejects the login page as `not-json`, patch re-queued |
| B5 | Undo | `sessionStorage`, tab-scoped → **C11** |
| B6 | Reset | atomic `PUT ?replace=1`, backed up first → recoverable |

### C — Ray editing **while a Code session pushes the template**

This is the dangerous quadrant. Every row here is a live gap.

| # | What happens | Result |
|---|---|---|
| C-a | Ray's tab holds the pre-push DOM and pre-push eids | his new patches key to the **old** shape → **C4** |
| C-b | Push changes element count in a chapter | every later `c<N>-e<i>` in that chapter re-maps → **C2** |
| C-c | Push adds text to a previously-empty element | that element now consumes an index; everything after shifts → **C2** |
| C-d | Push deletes/moves a chapter | the whole `c<N>-*` namespace shifts or orphans → **C2** |
| C-e | Ray reloads after the push | text patches apply silently to whatever now sits at that key → **C6** |
| C-f | Deletion tombstones | *protected* — sig-guarded, skipped, reported |
| C-g | `__order:` keys | replayed unconditionally → **C7** |

**Note the asymmetry (C6):** deletions are signature-guarded, text and style edits are not.
The one class that shouts is the one that was already safe.

### D — Ray's edit not saved / tab closed

| # | Scenario | Current behaviour |
|---|---|---|
| D1 | Tab closed >1.2s after last keystroke, save succeeded | safe |
| D2 | Tab closed **within** the debounce window | **lost with no trace** → **C1** |
| D3 | Save failed (network/Access), tab stays open | patch re-queued, banner shown, mirrored in localStorage |
| D4 | Save failed, then tab closed | recoverable — `offerRestore()` (:1769) prompts on next load |
| D5 | Browser crash mid-edit | same as D2 |
| D6 | Editing in `?raw=1` | `flush()` refuses (:2258), `dirty` kept — but a reload still loses it → **C1** |

### E — Structural change from Code (delete / move / insert a chapter)

| # | Checkpoint | Status |
|---|---|---|
| E1 | `deck_chapters.py` renumbers divs, navs, agenda, markers, cross-refs | covered |
| E2 | Self-verify chapter/nav/agenda sequence | covered |
| E3 | `deck_audit.py` — refs resolve, no orphan numbers, no internal copy | covered |
| E4 | Full read of every **surviving** chapter | required by SKILL.md Step 5 |
| E5 | **Check whether a live overlay exists before pushing** | **missing** → **C10** |
| E6 | **Migrate or invalidate the overlay's keys** | **missing** → **C5** |
| E7 | Tell Ray to stop editing / land his work first | **missing, manual** → **C10** |

### F — Export / present

| # | Scenario | Risk |
|---|---|---|
| F1 | Present from `/deck/<slug>` | live, correct |
| F2 | "Download HTML" then present from the file | file is a **third source of truth**, no path back → **C18** |
| F3 | Edits made after the download | download is stale, silently |

---

## Complication register — status

All sixteen addressed. `tools/test_editor.mjs` runs the editor in a real Chromium against the
real deck with a stubbed KV; every guard below has a test that fails without the fix. It runs
in `presync.sh`.

| # | Complication | Status |
|---|---|---|
| C1 | Edits typed in the last 0.6–1.2s died with the tab | **fixed** — mirrored to localStorage at `queueSave`, `sendBeacon` on `pagehide`/`visibilitychange` |
| C2 | `data-eid` is positional, so structural pushes re-map keys | **fixed** — content index (`data-ck`); an edit follows its content instead of being skipped |
| C3 | No concurrency control on `/api/edits` | **detected** — per-tab writer id; "another session edited this deck N min ago" |
| C5 | Overlay had no template-version stamp | **fixed** — shape fingerprint on every write, compared on load |
| C6 | Only deletions were signature-guarded | **fixed** — every patch carries and validates a signature |
| C7 | `__order:` replayed without validating the sibling set | **fixed** — replayed only when the list is exactly the current set |
| C8 | `__added:` blocks vanished silently when their group went | **fixed** — counted and reported |
| C9 | Live edits never flowed back to git | **covered** — Download HTML → `tools/apply_edits.py` splices edits into the template |
| C10 | Deploy replaced the template with no coordination | **fixed** — presync diffs the editable-element shape against main and prints which chapters shift |
| C11 | Undo stack died with the tab | **fixed** — `localStorage`, and refuses to restore across a shape change |
| C12 | Backups unbounded and unlabelled | **fixed** — `__reason` recorded, pruned to the newest 50 |
| C13 | Reset was all-or-nothing | **fixed** — banner button drops exactly the stale keys (`?drop=`), backed up first |
| C14 | Two sessions on one deck file | **fixed** — hard presync failure (`ALLOW_DECK_OVERLAP=1` to override deliberately) |
| C16 | `top` namespace mixes hero content with the chapter group | **mitigated, not renamed** — C7's validation removes the failure this caused; renaming the namespace would invalidate live keys for no further gain |
| C17 | The audit checked the template, not what the client sees | **fixed** — run `deck_audit.py` on a Download-HTML export; that file *is* the composite |
| C18 | A downloaded file was a fork with no path back | **fixed** — `<meta name="fs-export">` provenance + date-stamped filename |

### What C17 found on the deck that was actually presented

Running the audit against `docs/archive/Reiss_Strategy_Review_AS_PRESENTED_2026-07-28.html`:

```
✗ 10 hard failures
  [DEAD ANCHOR] #c7, #c10, #c11  (×2 each — topbar and side-nav)
  [DEAD CROSS-REFERENCE] chapter 7 does not exist  (×2, one written "ch.07")
  [DEAD RANGE ENDPOINT] chapter 10 does not exist
  [INTERNAL COPY IN CLIENT DECK] "need Ray to confirm"
```

Six of those are nav links that did nothing when clicked, in front of the client. That is the
class of defect none of the previous checks could see, and it is now a one-command check on
any exported file.

---

## Working rules that follow

1. **Before a structural push:** run presync, read the shape diff, and say so to whoever is
   editing. The editor now recovers what it can and reports the rest, but the courtesy is the
   point.
2. **Before calling any deck final:** `deck_audit.py` on the template *and* on a fresh
   Download-HTML export. The export is what the client gets.
3. **Never two sessions on one deck file.** Presync enforces it.
4. **A red banner is information, not damage.** Every guard skips and reports; none of them
   destroys anything. The Clear button removes only what it names, after a backup.
