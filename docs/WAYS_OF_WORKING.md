# Ways of Working — Parallel Editing

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
