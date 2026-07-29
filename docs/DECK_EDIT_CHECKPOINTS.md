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

## Complication register — to fix one by one

Ordered by how much damage each one has actually caused.

### C5 · Overlay carries no template-version stamp — *root cause*
`edits:<slug>` records no indication of which template revision its keys were computed
against, so nothing can detect that an overlay has gone stale. Every other complication
here is a symptom of this one.
**Fix:** stamp each overlay write with the template's build sha (already exposed at
`/api/version`). On load, compare; if they differ, don't blind-apply — verify per key.

### C2 · `data-eid` is positional, so any structural push re-maps keys
Insert, delete, reorder, or fill a previously-empty element inside a chapter and every
later key in that chapter points at a different element.
**Fix:** move to content-derived keys (a hash of the element's normalised text + tag +
chapter), with the positional key kept as a fallback for one migration cycle. Content keys
survive insertion and reordering, which is exactly what positional keys can't do.

### C6 · Only deletions are signature-guarded; text and style edits apply blind
`sig` is written on tombstones (:2026, :2067) and nowhere else, so a mis-mapped text patch
silently overwrites the wrong paragraph — the failure mode with no banner.
**Fix:** write `sig` on every patch, validate on replay, report mismatches in the same
banner the tombstone guard already uses.

### C1 · Edits typed in the last 0.6–1.2s die with the tab
`backupLocal()` is called inside `flush()`, not inside `queueSave()`, and there is **no**
`beforeunload`/`pagehide` handler anywhere in the file.
**Fix:** two lines, independently valuable — mirror to localStorage at `queueSave` time,
and flush on `pagehide` (`visibilitychange` → hidden, which fires reliably on mobile too).

### C9 · Live edits never flow back to git
The template and the overlay diverge permanently, so every Code push is authored against a
version of the deck nobody is actually looking at. "Download HTML" is a manual, lossy
bridge that only goes one way.
**Fix:** a `tools/pull_overlay.py` that fetches `edits:<slug>`, applies it to the template,
and writes the result back to `docs/`, so a structural change can start from what Ray sees.

### C10 · Deploy replaces the template with zero coordination
Nothing checks whether an overlay exists, nothing warns the open tab, nothing pauses editing.
**Fix:** deploy-time check — if `edits:<slug>` is non-empty and the deck file changed in
this push, fail the run unless the commit says the overlay was considered.

### C3 · No optimistic concurrency on `/api/edits`
Shallow last-writer-wins. Two tabs, or Ray plus a restore script, silently clobber.
**Fix:** the `X-Sync-Base` pattern already used by `/api/briefs` and `/api/clients`.

### C13 · Reset is all-or-nothing
Clearing 14 stale tombstones means destroying 122 good edits. That's why the banner keeps
coming back — the safe action is too expensive to take.
**Fix:** "clear just the skipped keys" button next to the banner, which already knows
exactly which keys were skipped.

### C7 · `__order:` replayed without validating the sibling set
A stale `__order:top-g0` re-appends every listed chapter to the end of `<body>`, which is
what stacked all the chapter dividers at the bottom of the page.
**Fix:** replay only when the listed rids are exactly the current sibling set; otherwise
skip and report, same as tombstones.

### C17 · The audit checks the template, not what the client sees
`deck_audit.py` reads `docs/<Deck>.html`. The presented deck is template **+ overlay**. So
the audit does not currently cover the artefact that actually goes in front of a client.
**Fix:** `--overlay <slug>` mode that fetches the overlay, applies it, and audits the
composite. Depends on C9's puller.

### C11 · Undo stack is `sessionStorage`, tab-scoped
Closing the tab discards every undo step. Undo after a template push also restores an
overlay authored against the old shape.
**Fix:** stack in KV alongside the backups; refuse to restore across a version-stamp change.

### C8 · `__added:` blocks replayed by parent `tid` with no signature
If the parent tid moves or disappears, the block lands wrong or vanishes silently.
**Fix:** same signature treatment as C6.

### C12 · `edits-bak:` grows unbounded and unlabelled
No reason recorded, no pruning, no retention policy.
**Fix:** store `{reason, sha, ts}`; prune beyond ~50 per slug.

### C18 · A downloaded HTML file is a fork with no path back
**Fix:** stamp the export with slug + sha + timestamp so a returned file can be diffed
against the version it came from.

### C14 · Multiple Code sessions on one deck file
`overlap.sh` warns, doesn't block; this already caused a mid-operation rebase collision.
**Fix:** make hot-file overlap on a deck a hard presync failure, not a warning.

### C16 · `top` namespace mixes hero content with chapter-level block groups
Everything before chapter 1 shares the `top-*` namespace with the body-level draggable
group that contains the chapter divs.
**Fix:** separate the structural group namespace from the content namespace.

---

## Suggested order

1. **C1** — smallest change, stops silent loss today, no dependencies.
2. **C5 + C6** — the version stamp and universal signatures. Together these turn every
   silent mis-landing into a reported one. This is the fix that would have prevented the
   Reiss episode.
3. **C13** — makes the reported state cheap to clear, so the banner stops being noise.
4. **C9 → C17** — pull the overlay back to git, then audit what the client actually sees.
5. **C10, C3, C7, C14** — coordination and concurrency hardening.
6. The rest as they surface.
