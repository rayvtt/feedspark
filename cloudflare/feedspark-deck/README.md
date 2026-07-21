# feedspark-deck — live deck worker

Serves a FeedSpark HTML deck at one URL with **parallel editing** and **no per-edit cost**:

- **Ray** edits copy in the browser (edit mode → `contenteditable`). Edits auto-save to KV, keyed by
  a stable `data-eid` per element.
- **Claude Code** (the chat interface) makes structural / visual changes to the **template** and
  pushes it with `PUT /api/template`. Ray's KV edits persist and re-merge on top.
- The two layers never collide: **template = git / Claude Code**, **content = KV / Ray**.

There is **no Anthropic API key and no paid API call** — structural edits are done by asking Claude
Code in chat, not by an in-deck model. The editor's **Copy for Claude Code** button hands over the
exact element (`data-eid` + `outerHTML`) so the request is unambiguous.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve the deck (template + injected editor widget) |
| GET | `/api/edits` | Saved edits as JSON, keyed by `data-eid` |
| PUT | `/api/edits` | Merge an edit patch (the widget calls this on auto-save) |
| DELETE | `/api/edits` | Clear all saved edits |
| GET | `/api/template` | Current template version timestamp |
| PUT | `/api/template` | Replace the template HTML (Claude Code pushes new versions) |

## Deploy

```bash
cd cloudflare/feedspark-deck
npx wrangler deploy            # creates feedspark-deck.<subdomain>.workers.dev
```

`wrangler.toml` binds the KV namespace `EDITS` (id `d93b5ac576c74f0d8a315c5b92dc8e16`). Then push a
template:

```bash
curl -X PUT --data-binary @../../docs/YuMOVE_Strategy_Review_Jul26.html \
  https://feedspark-deck.<subdomain>.workers.dev/api/template
```

## Gate it — Cloudflare Access (required)

The deck holds confidential commercial data. In the Cloudflare dashboard → **Zero Trust → Access →
Applications**, add a self-hosted app for the worker hostname and allow only your team's emails.
Everything (`/` and the `/api/*` routes) then sits behind email auth. Do this before sharing the URL.

## The editor (injected into every served deck)

- **✎ Edit** — toggle edit mode. Editable elements get stable `data-eid`s (by DOM order) and become
  `contenteditable`; changes auto-save to KV.
- **◎ Element** — click any element, then **Copy for Claude Code** to copy its `data-eid` +
  `outerHTML` with a ready-made prompt. Paste into the Claude Code chat and finish the sentence.
- **⤴ Export edits** — copy the whole content layer as JSON (for the git flow: `tools/apply_edits.py`).

Full element/CSS contract: `docs/FeedSpark_Deck_LiveEdit_Feature.md`. Workflow: `docs/WAYS_OF_WORKING.md`.
