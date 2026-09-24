# Image Library (`/images`)

> Ray, 15 Sep 2026 — *"let's build a new module to manage the client's images (from all the media
> assets across these fields image_link, additional_image_link 1,2,3,4… it should have up to 10)
> and we'll find a way to tag / categorise it. Now there's a problem with brands: they can't
> define which images are flat-lay and which are on-model / upper-body for example — we can use
> this module to AI tag or manual tag it."*

## The problem, and the lever

A feed carries up to eleven images per product (`image_link` plus `additional_image_link` 1–10)
and says nothing about what any of them show. The brand usually cannot tell you either: the
shot type lives in the studio's naming convention, not in the feed.

But that convention is *already in the URLs* — it is just never labelled. Within one product
every image shares a long common stem (the SKU, the CDN path, the size suffix) and differs by a
short fragment:

| Brand | Two of one product's images | The fragment |
|---|---|---|
| Monsoon | `01_20001600003_1.jpg` · `21_20001600003_1.jpg` | `01` / `21` |
| Accessorize | `01_30005360022_1.jpg` · `05_30005360022_5.jpg` | `01` / `05` |
| Schuh | `8341007080_zm.jpg` · `8341007080m4_zm.jpg` | `zm` / `m4_zm` |
| Reiss | `Y76182s.jpg` · `Y76182s3.jpg` | `·` / `3` |
| Superdry | `upload9223368955666524368.jpg` | — none |

That fragment is the **shot code**, and the same handful of codes repeats across the whole
catalogue. So tagging a code tags every image carrying it. On the real feeds (15 Sep 2026):

| Feed | Products | Images | Shot codes | Codes covering every image |
|---|---|---|---|---|
| Schuh GB | 21,322 | 85,288 | 6 | 6 → 100% |
| Reiss GB | 20,588 | 121,831 | 15 | 7 → 100% |
| Monsoon GB | 10,162 | 41,634 | 16 | 11 → 100% |
| Accessorize GB | 4,199 | 15,390 | 16 | 11 → 100% |
| Superdry GB | 26,615 | 53,226 | 60+ | **unpatterned** |

Eleven decisions name forty thousand images. That is the module.

## How the code is derived

`docs/image_engine.js` (UMD, served at `/images/engine.js`) — the same file runs in all three
lanes: the 4×-daily `tools/xml_scan.mjs` agent, the page's ⚡ live in-browser scan, and the node
harness `tools/test_images.mjs`.

1. **`fileStem(url)`** — last path segment, extension and query stripped. The query carries
   cache-busters (`?v=141025`) and render params (`&width=658`) that move independently of the
   shot, so they never decide anything.
2. **`commonStem(stems)`** — the longest substring (≥4 chars) present in *all* of one product's
   filenames. Bounded by design: at most 11 short strings per product.
3. **`snapStem(common)`** — when the stem contains a separator it is trimmed back to
   segment edges. Without this the greedy common substring swallows a digit of the prefix on
   a product with only two images (both ending `_1`), so the same photograph came back as `0`
   on one product and `01` on the next — one shot, two codes, purely because of how deep that
   product's gallery is. A stem with *no* separator (Schuh's `8341007080`, Reiss's `Y76182s`,
   Superdry's hash) is left exactly as it is: there is no edge to snap to and trimming would
   leak the SKU itself into the code.
4. **`residue(stem, common)`** — what is left once the stem is masked, tidied to a stable key.
   Pieces either side are joined with `|`; an image that *is* the stem yields `·` (the primary).
5. **head vs full grouping** — Monsoon's `01|1` and `01|5` are the same shot code with a
   drifting image index, so the collector builds both groupings and keeps whichever explains as
   much of the feed with fewer codes. Almost always `head`.
6. **the learnable verdict** — supported codes (≥0.5% of products) must cover ≥60% of images,
   number **≤20**, and the vocabulary must not have overflowed the 60-code cap. Anything else is
   reported as `learnable:false` and the page says *unpatterned* rather than inventing a
   taxonomy. Overflow is tracked **per grouping**: the full-token bag routinely overflows on a
   feed whose head vocabulary is small and clean, and that says nothing about the grouping the
   page uses.

Nothing is hardcoded per brand. A retailer never scanned before yields its own codes on the
first pass, and an unreadable one is refused honestly.

## Tagging

Three lanes, and a manual tag always wins:

- **✦ AI tag** — the code's own sample images go to Claude (`claude-opus-5`) as image content
  blocks through `/api/claude`, with the client's taxonomy in the system prompt and a demand for
  strict JSON: `{tag, conf, note}`. The verdict lands on the *code*, not on one photograph, and
  the note (what the model says it actually saw) is shown under the tag. ✦ AI tag every shot code
  walks every untagged, non-rare code in turn.
- **Manual** — a dropdown on every code card.
- **Per-image override** — `tags.img['<id>#<slot>']` beats its code's rule (`tagFor`).

Tags are stored **per client** (`imgtags:<client>`), not per market: one studio convention runs
across a brand's markets, so tagging Reiss GB answers Reiss DE. The store is merged per key, so
two AMs tagging different codes never clobber each other.

The **taxonomy** itself is the client's. It ships with the thirteen shot types brands actually
brief (packshot/flat-lay, ghost mannequin, on-model full/upper/lower body, back, side, detail,
lifestyle, styled, swatch, infographic, other) and ⚙ Edit renames, adds or removes any of them
against that client.

**"Check the examples"** — a code sitting in four or more image slots with no dominant one is
not being used as a fixed position in the shot list (Monsoon's `01` is a packshot on footwear and
an on-model shot on dresses). The card carries a quiet chip saying so, with the reasoning in its
tooltip, so nobody tags four thousand images on trust.

## Storage

| Key | What |
|---|---|
| `image:<client>:<mkt>` | the whole capture — counts, slot fill, hosts, formats, every shot code with up to 24 sample images |
| `imagehist:<client>:<mkt>` | counts per scan (≤120) |
| `imageidx` | one-read estate index for the board |
| `imgtags:<client>` | the tag store: taxonomy + one rule per code + per-image overrides |

The capture rides only **confirmed** scans (`applyPushedSnapshot`) — a half-read feed would
otherwise fake an image drop-off. Tags live apart from the capture so they survive every rescan.

## Routes

```
GET  /images                     the page
GET  /images/engine.js           the engine, served verbatim
GET  /api/images                 estate roster ∪ scanned index (never-scanned feeds listed honestly)
GET  /api/images?client=&market= one feed's capture + history + the brand's tags
GET|PUT /api/images/tags?client= the tag store (PUT merges per key; `clear` removes a rule)
POST /api/images/scanpush?client=&market=   the page's ⚡ live scan posts its computed capture
```

Module slug `images`, grantable in the access directory like every other module.

## Serving the engine

`docs/image_engine.js` is served verbatim at `/images/engine.js`, which only works because
`wrangler.toml`'s `rules` marks it as a **Text** module. That list used to name each engine by
filename and `image_engine.js` was missing from it, so esbuild bundled the file as an ES module,
`IMAGE_ENGINE_SRC` resolved to `undefined`, and the route answered **200 with an empty body** — a
`<script>` tag loads that without firing `onerror` and without a parse error, so the page saw no
global and no failure, and the live scan failed with "engines not ready".

The glob is now a pattern (`**/*_engine.js`) and `tools/check_textmodules.js` fails the build if
any `docs/*.js` the worker imports escapes it. `.json` is deliberately exempt: it has a real
parsed default export and `docs/i18n/vi.json` is correctly served with `JSON.stringify`.

## Harness

`node tools/test_images.mjs` — 61 assertions over the real URL shapes of all five brands: the
token differencing (prefix, suffix, trailing index, both-ends), the slot model including
`|||N` and `(N)` header forms, a mid-stream header growth, the grouping choice, the honest
refusal on opaque filenames, the per-grouping overflow regression, tag precedence and coverage.
Wired into `qa_gate.sh`, `presync.sh` and `validate.yml`.
`IMAGE_FIXTURE=/path/to/feed.xml node tools/test_images.mjs` streams a real export and prints
its summary.

`tools/check_images.js` (presync) drives the real page in Chromium and lets its own
`<script src>` tags fetch both engines, so the serving path is exercised rather than stubbed —
the gap that let the empty-body bug reach the live site. Point `IMG_FIXTURES` at a directory
holding `probe_monsoon_gb.xml` + `probe_superdry_gb.xml`; without them it skips.
