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

The worker is named `feedspark` (matches the worker already created in the dashboard). Deploying from
this directory reads `wrangler.toml`, so it also **binds the KV namespace and enables the
`workers.dev` URL** in one shot — no separate dashboard clicks:

```bash
cd cloudflare/feedspark-deck
npx wrangler login            # once, if not already authed
npx wrangler deploy           # → https://feedspark.ray-vtt.workers.dev
```

`wrangler.toml` binds the KV namespace `EDITS` (id `d93b5ac576c74f0d8a315c5b92dc8e16` =
`FEEDSPARK_DECK_EDITS`). Then push the YuMOVE deck as the template:

```bash
curl -X PUT --data-binary @../../docs/YuMOVE_Strategy_Review_Jul26.html \
  https://feedspark.ray-vtt.workers.dev/api/template
```

> Do the template push **before** you gate the worker with Access (below) — Access will block an
> unauthenticated `PUT`. Or push it any time from a browser session that's already signed in to Access.

### Alt: git push-to-deploy (dashboard)

The `feedspark` worker is already connected to `rayvtt/feedspark` in the dashboard, but its build
failed because the config lives in a subdirectory. In the worker's **Settings → Build**, set
**Root directory** to `cloudflare/feedspark-deck` (deploy command stays `npx wrangler deploy`). Every
push to `main` then auto-deploys.

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
