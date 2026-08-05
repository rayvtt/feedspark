# Materials bank — client collateral in the Brand dossier

A per-client bank of *finished* collateral — strategy decks, review packs, one-pagers — filed
against the brand and surfaced in the Brand dossier at `/#accounts`. The point is that when Ray
opens a brand months later, the history of what was actually sent to that client is attached to
the brand, instead of living in a SharePoint folder or an email thread.

Materials are grouped by **occasion** (e.g. "Account Review Aug-26") and tagged with a
**category** (marketing, commercial, technical…).

## Two storage tiers, on purpose

| | Seeds | KV uploads |
|---|---|---|
| Where | `docs/materials/*`, git-bundled as binary Data modules | KV blob `matblob:<id>` + `materials` index |
| Added by | a commit (import + one `SEED_MATERIALS` entry) | the dossier's **+ Add material** button |
| Live when | the deploy goes green | immediately |
| Cost | **its full size on every worker deploy** | none to the bundle |
| Use for | flagship, client-facing pieces | everything else |

The split exists for a concrete reason: **a Claude Code session cannot write a blob to live KV.**
Cloudflare Access blocks unauthenticated HTTP writes (any such request returns the login page
with HTTP 200 — see CLAUDE.md), and the Cloudflare MCP exposes namespace-level tools only, with
no key-level write. So the only way for a session to publish a file is to commit it and let the
deploy carry it. Anything a human uploads through the browser should go to KV and keep the
bundle flat.

> **Keep `SEED_MATERIALS` short.** The Superdry Strategy Review alone adds ~1.4 MB to every
> deploy (bundle went 532 KB → 1.81 MB gzip; the Workers limit is 10 MB). A handful of these is
> fine. A bank of them is not — that is what the KV tier is for.

## API

```
GET    /api/materials?client=Superdry     list (seeds ∪ KV), newest first
POST   /api/materials                     multipart upload: file, client, title, cat, occasion
GET    /api/materials/file?id=<id>[&dl=1] serve the blob (dl=1 forces download)
DELETE /api/materials?id=<id>             delete a KV material; tombstone a seed
```

Index shape (KV key `materials`): `{ "<id>": { client, title, cat, occasion, file, mime, size,
at, by } }`, plus `_deleted: []` for tombstones. `by` is the Access-verified email, so the bank
records who filed what. Uploads are capped at 24 MB — KV's value ceiling is 25 MB, and a
truncated deck is worse than a refused one, so the API returns 413 rather than storing a stub.

A seed is code, not data: `DELETE` can only tombstone it (hiding it from the dossier). To remove
one properly, drop the import, the `SEED_MATERIALS` entry and the file, in one commit.

## Adding a seed

1. Drop the file in `docs/materials/`.
2. `import MAT_<KEY> from "../../../docs/materials/<file>";` in `worker.js`.
3. Add a `SEED_MATERIALS` entry (`id`, `client`, `title`, `cat`, `occasion`, `file`, `mime`,
   `at`, `body`).
4. Extensions beyond `.pptx`/`.pdf`/`.xlsx` need adding to the `Data` rule in `wrangler.toml`.

## Testing it

`wrangler dev` does not stay up in the Code sandbox (`ERR_IPC_CHANNEL_CLOSED`). Exercise the real
handler by bundling for Node instead — note the `binary` loader emits `Uint8Array.fromBase64`,
which needs a polyfill on Node < 24:

```bash
npx esbuild cloudflare/feedspark-deck/src/worker.js --bundle --format=esm --outfile=/tmp/w.mjs \
  --loader:.html=text --loader:.txt=text --loader:.pptx=binary --loader:.pdf=binary --loader:.xlsx=binary
# then import it with a stub env.EDITS (Map-backed get/put/delete) and call mod.fetch(...)
```
