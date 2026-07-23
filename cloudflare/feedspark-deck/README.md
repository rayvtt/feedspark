# feedspark — live deck worker

Serves the FeedSpark YuMOVE deck at one URL with **parallel editing** and **no per-edit cost**:

- **Ray** edits copy in the browser (edit mode → `contenteditable`). Edits auto-save to KV, keyed by
  a stable `data-eid` per element.
- **Claude Code** (the chat interface) makes structural / visual changes to the **deck in git** and
  pushes to `main`. Cloudflare rebuilds and the new deck is bundled into the worker. Ray's KV edits
  persist and re-overlay on top.
- The two layers never collide: **template = git (bundled at build time)**, **content = KV / Ray**.

There is **no Anthropic API key and no paid API call** — structural edits are done by asking Claude
Code in chat, not by an in-deck model. The editor's **Copy for Claude Code** button hands over the
exact element (`data-eid` + `outerHTML`) so the request is unambiguous.

The deck HTML (`docs/YuMOVE_Strategy_Review_Jul26.html`) is imported into the worker as a **Text
module** (see `rules` in the repo-root `wrangler.toml`), so it ships *inside* the Worker — there is
no separate template-upload step.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve the deck (git-bundled template + injected editor widget) |
| GET | `/api/edits` | Saved edits as JSON, keyed by `data-eid` (returns `X-Store-Rev` header) |
| GET | `/api/edits?since=<rev>` | Delta since a revision: `{rev, set:{key:val}, del:[key]}` (live sync) |
| PUT | `/api/edits` | Upsert an edit patch (auto-save). Whole map = upsert; `{__del:[...]}` to remove |
| DELETE | `/api/edits` | Clear all saved edits |
| GET | `/api/template` | Info only — the template is git-bundled; push to `main` to change it |

There is **no `PUT /api/template`** on purpose: git is the single source of truth for the template.

## Multi-session safety (no overwrites, live stack-in)

Every mutable store (`/api/edits`, `/api/feedback`, `/api/briefs`, `/api/tests`, `/api/carryover`,
`/api/clients`) is backed by a **`Store` Durable Object** — one instance per store name. Because a
Durable Object runs **single-threaded**, concurrent writes from two sessions *serialize* instead of
racing, so nothing is silently lost (plain KV has no atomic read-modify-write and would clobber).

- **PUT upserts, never implicit-deletes.** A session posting its whole (possibly stale) map only
  ever adds/updates *its* keys — it can't erase a brief/test/client another session just added.
  Deletes are explicit: `PUT {__del:[id,...]}` or `DELETE` (clear all).
- **Monotonic revision + deltas.** Each store carries a `rev` (returned in `X-Store-Rev`). Open tabs
  poll `GET ?since=<rev>` every few seconds and merge other sessions' changes in live — no reload,
  and never over the element/field the local user is mid-edit in.
- **Zero-migration cutover.** On first touch each Store imports its old KV key (`briefs`,
  `edits:<slug>`, …) once, so everything already saved carries over. KV stays bound as the seed source.

Binding + migration live in the repo-root `wrangler.toml` (`[[durable_objects.bindings]]` +
`new_sqlite_classes = ["Store"]`) — SQLite-backed, so it runs on the same plan the worker already uses.

## Deploy

`wrangler.toml` lives at the **repo root** (so Cloudflare's default build finds it) and declares the
worker name `feedspark`, the deck Text-module rule, and the KV binding — so a single deploy also
**binds KV and enables the `workers.dev` URL**. No dashboard clicks needed.

```bash
# from the repo root
npx wrangler login            # once, if not already authed
npx wrangler deploy           # → https://feedspark.ray-vtt.workers.dev
```

Verify the bundle first without deploying (no auth needed):

```bash
npx wrangler deploy --dry-run --outdir /tmp/out   # should report ~97 KiB upload + the EDITS binding
```

### Git push-to-deploy (recommended)

The `feedspark` worker is already connected to `rayvtt/feedspark` in the dashboard. Because
`wrangler.toml` is now at the repo root, the **default** build settings work — leave **Root
directory** blank (repo root) and the deploy command as `npx wrangler deploy`. Every push to `main`
then rebuilds and redeploys, deck included. (The earlier build failed only because the config used to
live in this subdirectory.)

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
