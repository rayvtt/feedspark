# Hobbycraft — generic keyword theme calendar, Oct 2026 → Feb 2027

**Ask** (Ray, 19 Oct 2026): *"generate a generic keyword theme calendar for [Hobbycraft] in this
industry from now until February next year — because they have not sent the marketing calendar
yet."*

So this is FeedSpark's own plan, not an ingest of a client document — the second of its kind after
Superdry and Monsoon. Nothing here came from Hobbycraft; everything came from one live read of the
brand's own feed and from how craft retail is actually searched.

## The read

One stream of the wired Hobbycraft GB Google Shopping XML (`DEFAULT_FEEDS.Hobbycraft.gb`,
FeedHero), 19 Oct 2026:

| | |
|---|---|
| SKUs (feed rows) | 25,483 |
| Products (distinct `g:item_group_id`) | 17,509 |
| Primary `g:product_type` paths | 786 |
| SKUs carrying no keyword at all | **12,823 (50.3%)** |

Saturation is read through `labelguard.js kwValueKind`, never "any slot filled" — FeedHero writes a
32-character hex id into `g:product_type(2)` on this feed, so a naive count reads ~100%.

Census committed as `ops/calendars/hobbycraft_gb_product_types_2026-10-19.json`, deliberately
independent of the seed: the harnesses build their index out of the seed's own paths, so a
mis-spelled path must fail against something the seed cannot influence.

## The finding

**The titles say what a product IS and never what it is FOR or who it is for.** On 25,483 titles:

| in ZERO titles | barely there | everywhere |
|---|---|---|
| gifting · xmas · secret santa · new year · wellbeing · bulk · sale | easter 1 · valentine 1 · personalise 5 · beginner 16 · handmade 25 · how-to 18 · wedding 10 · stocking 14 · festive 19 | kit 1,715 · set 1,117 · kids 882 · mini 516 · christmas 233 · large 231 · party 177 |

"gift" appears in 104 titles — **0.4%** — on a catalogue whose model kits, 1000-piece puzzles, board
games and brick sets are bought as presents far more often than as supplies. Craft retail is bought
by **occasion**, by **recipient** and by **skill level**; this catalogue is written by **material**.

## The themes

Ten, **two per WORK month** (the board buckets by brief-by = live − `LEAD_DAYS` 21), GB only.

| brief by | live | theme | lane | scope |
|---|---|---|---|---|
| 21 Oct | 11 Nov | Christmas crafting & card making | Seasonal focus | 12 paths · 643 SKUs |
| 29 Oct | 19 Nov | Advent, stocking fillers & small gifts | Gifting & occasions | 10 paths · 243 SKUs |
| 6 Nov | 27 Nov | Black Friday & value language | Promotion | **whole catalogue** |
| 20 Nov | 11 Dec | Gifting language — the craft kit as a present | Gifting & occasions | 12 paths · 1,179 SKUs |
| 4 Dec | 25 Dec | New year, new hobby — beginner & starter language | Seasonal focus | 12 paths · 1,345 SKUs |
| 18 Dec | 8 Jan | Cosy season — knitting, crochet & yarn | Seasonal focus | 14 paths · 1,781 SKUs |
| 8 Jan | 29 Jan | Valentine's & handmade cards | Gifting & occasions | 12 paths · 778 SKUs |
| 22 Jan | 12 Feb | Dressmaking & the spring make | Seasonal focus | 14 paths · 1,943 SKUs |
| 5 Feb | 26 Feb | Mother's Day — handmade & personalised | Gifting & occasions | 12 paths · 1,063 SKUs |
| 19 Feb | 12 Mar | Easter & spring crafts for kids | Kids & families | 14 paths · 1,256 SKUs |

112 exact primary paths across the nine scoped themes. Each card quotes the count **its own scope**
resolves to, never the larger department total.

**Season locks are real dates**: Black Friday 2026 is Fri 27 Nov; Mothering Sunday 2027 is 7 Mar, so
Mother's Day goes live 26 Feb; Easter Sunday 2027 is 28 Mar. "New year, new hobby" goes live on
25 December on purpose — beginner-craft search starts the day the shops close, not in January.

**One theme is brand-wide and says why.** Black Friday is the whole shop, and a brand-wide scope is
a scope decision too (`brandwide:1`, so the card reads "whole catalogue · sync to measure" rather
than "Set scope").

**Kids is its own lane.** 2,626 SKUs is a second shop inside the catalogue, bought by a parent
searching the school holiday rather than the product — the same reason Monsoon's kidswear has one.
`LANE_NAMES.Hobbycraft` = Seasonal focus / Gifting & occasions / Kids & families / Promotion
(display only; keys, colours, stored events and tie-matching never move).

## Not seeded, deliberately

The product-type splits this read turned up are a **Product Type Guard** job, not a keyword theme —
but a scope containing one must carry both spellings or it silently drops products:

- `Hobbies > Model Making > …` **and** `Hobbies & Games > Model Making Kits > …` — the same
  model-making categories under two top-level branches (2,166 vs 2,441 SKUs)
- `Halloween` **and** `Halloween & Autumn`
- `Knitting & Crochet` **and** a lower-case `knitting & crochet`
- `Hobbies > Jigsaw Puzzles` **and** `Hobbies & Games > Jigsaw Puzzles`

One path is a bare 32-character hex string sitting at the top level — a single SKU whose primary
`g:product_type` is an id, which the Product Type Guard should also see.

No `txsm` (text filters) or `cndm` (attribute conditions) are seeded: `volOf` reads a condition's
own stored `uni` count and a text filter's `n`, both measured in the browser, so a seeded one would
draw "0 products". Only `pts` sums honestly off the synced index.

## Harnesses

- `tools/test_kwcal_hobbycraft.mjs` — renders the real board: ten cards, five working months of
  exactly two, no scope reading "Set scope" before anyone syncs, the brand-wide moment saying so,
  the lane words, every seeded path against the census, every quoted count recomputed, and the
  scopes resolving against a stored index.
- the census-parity block in `tools/test_kwcal_tie.mjs` — Hobbycraft joins the four brands whose
  every seeded path is checked against a census the seed cannot influence.

Both in `qa_gate` / `presync` / `validate`.
