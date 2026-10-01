# Catalogue — every product, master → feed

Ray, 28 Sep 2026: *"a module to browse / view / track / deep dive product catalogs — take example of
Google Merchant Center or Shopify interface … product ID first: image, title, price, sale price if it
exists, availability … almost looks like an Excel format, but in a nicer, cleaner and more interactive
module … Include ROAS with a blue bar chart similar to new arrivals … when you hover over an image or
product, you should have access to what we call a master feed source in FeedHero report MCP. That is
the product data before FeedSpark optimization … a smooth transition of (before and after) between
pre-optimization, update population, data optimization, and data enrichment … which field existed
vs. didn't, which field is structured vs. didn't, which field is enriched vs didn't."*

Live at `/catalog`. Module slug `catalog` (grantable in the 👥 Access panel). Engine
`docs/catalog_engine.js` (UMD `window.FeedCatalog`, served at `/catalog/engine.js`, node-tested).

## 1. Three sources, one product

| Source | What it is | How the page gets it |
|---|---|---|
| **The feed** | FeedHero's OUTPUT feed — what Google receives, every FeedSpark stamp on it | `/api/feed/proxy` (the stream every feed module reads), parsed in the browser by the Feed Lab parser |
| **The master** | the client's own file, as FeedHero last IMPORTED it — the product data *before* FeedSpark | `/api/catalog/master` (one `master_feed` MCP call: file, headings, rows, last import; KV `catmaster:<cmpid>` 20 min) then `/api/catalog/master/file` (the file itself, streamed untouched — zip / XML / CSV / TSV) |
| **Google Ads** | FeedHero's ROAS read for the market (30 days) | `/api/roas?client=&market=` (the category tree) + `/api/roas/live?cmpid=&agg=` (any other cut, KV 6 h) |

- **The company id** (`cmpid`) is read off the wired output feed's own URL
  (`/output_feeds/<cc>/<cmpid>/<hash>/…`), never from the query. A Meta (`-fb`) feed carries its
  Google market's company. A sheet-backed feed has none — no master, and the page says so.
- **The master file** is fetched only from `https://*.feedhero.net/import_feeds/<cmpid>/…`
  (`catFileOk`); FeedHero's backup URLs never reach the browser, and the file is served as bytes
  (`application/octet-stream`, `nosniff`, a download) — never with FeedHero's content-type on our
  origin.
- **Scope** — every `/api/catalog/*` route is scoped like `/api/roas`: the owner, or a signin whose
  client scope matches (403 otherwise). The roster lists only the clients the signin may browse.
- **Nothing in git.** The master, the feed and the ROAS figures are read live (KV caches only).
  `tools/test_catalog.mjs` fails on a committed master file or a FeedHero import URL with its hash.

## 2. The join — read off the data, never assumed

The output stamps every product with `c:fs_data_original_id` (the master row it was built from) and
`c:fs_data_original_title`. `detectJoin` tries every master column against both the output's `g:id`
and its `fs_data_original_id` on a sample, and takes the column that carries the most ids — so a
Shopify master's parent `product_id` (a decoy: many variants share it) loses to its row `id`. No
column carrying the ids = no join, never a guess. A duplicate master id keeps the LAST row (a later
row is FeedHero's newer read). Master rows the feed never sends are listed under **Not in feed**.

Real data, 28 Sep 2026: Accessorize GB — 4,221 of 4,221 products joined on `g:id ↔
fs_data_original_id`, 1,283 master-only, XML master, traced in ~3 s.

Known gap: `source_url` is the NEWEST import. When FeedHero re-imports between the output build and
the read (Schuh: 3.5 h), a handful of ids the output still carries are gone from the master — those
products read *No master row*, never a false "populated".

## 3. What happened to each field — the four stages

`lineage(product, masterCells, plan)` reads every attribute (42 of them, in nine groups: Identity ·
Content · Offer · Taxonomy · Attributes · Media · Links · AI-ready · Campaign) into ONE status:

| Status | Meaning | Stage |
|---|---|---|
| **Kept** | the master value, sent as is | Master |
| **Structured** | the same information, put into Google's form — `format` (HTML stripped, `IN_STOCK` → `in stock`, `Navy (NAV)` → `Navy`), `remap` (a price from `was_price`), or `lift` (read out of another master column: material from `composition`, gender from the title or tags) | Populated / Optimised |
| **Populated** | a core field the master never had, filled | Populated |
| **Optimised** | rewritten: a title, a restructured product type, a reprice, an image overlay | Optimised |
| **Enriched** | new data added: a highlight, a keyword slot, the conversational six — or a list added to (`+2` more images) | Enriched |
| **Dropped** | in the master, not sent (a sale price equal to the price says so) | — |
| **Missing** | on neither side | — |

EXISTED / STRUCTURED / ENRICHED are the three questions Ray asked, answered per field: `ex` (the
master had it), `spec` (the value sent is in Google's format — GTIN check digit, price `76.00 GBP`,
the availability vocabulary, a GPC path, title length, no HTML), `en` (FeedSpark added it).

Rules the engine holds, each measured on real masters:

- **Price is a model, not a column.** Base = `price`; a NOW column below it is the sale price
  (YuMOVE's bundles); otherwise a WAS column above it makes the base the sale price (Monsoon's
  `g:price £76` beside `was_price £95`); a was-only column BELOW the base is ignored (American Golf's
  `mrrp`).
- **Text compares without whitespace, entities or tags** — a description that only lost its HTML is
  *structured*, not *optimised*.
- **The column that belongs to an attribute is read first** when lifting (material from
  `composition` before the title that also says "Linen").
- **The main image is not a "more images" entry**, wherever the master put it; an image promoted to
  the main slot has moved, it is not lost. A FeedSpark overlay reads *Optimised · overlay* with its
  source image decoded off the URL.
- **md5 keyword slots** (a 32-hex hash in `product_type(2)`) are not keywords.
- **Encoding**: the master is decoded as strict UTF-8, switching to Windows-1252 at the first byte
  that is not (Schuh).
- **Apparel** is read off the category (or a stated gender / age), never off a size — a tub of
  supplements has a size.

Completeness before → after = the share of what Google asks of THIS product that is filled,
weighted like the Golden Record (required ×3, conditional ×2, recommended ×1), gtin/mpn counted
once. The audit legend (`auditBand`: <70 red · 70–85 orange · 85–95 yellow · 95+ green) is the one
every audit surface uses.

## 4. Google Ads — which segment a product sits in

Measured 28 Sep 2026 against the six clients FeedHero reports on (1,992 SKUs over 19
category-filtered reads). A segment row is a VALUE of one FeedHero column, grouped
case-insensitively; an empty column is "Unsorted".

| Cut | Placed by |
|---|---|
| Category | `g:product_type` slot 1, on its **FULL path only** |
| Brand · Colour · Gender · Age group · GPC | the raw `g:` value (GPC compared as a path; duplicate display names merged) |
| Price type | a rule — sale price below price |
| Price band | FeedHero's **Price group** cut, placed on a price RANGE read off each band's label ("£0 - £25", "Under £20", "£100+"); which price it bands on — the list price or what the shopper pays — is read off the data (the basis whose counts per band sit closest to FeedHero's own SKU counts), and a cut whose bands are named in words stays segment totals |
| Title / keyword optimisation | FeedSpark's own `fs_data_opti` T / Keywords flags |
| Product age | a rule on the item **GROUP's** first-seen date |
| Custom labels | only where FeedHero's report reads the column (not every row "Unsorted") |
| Data-field review · Batch | FeedHero workflow states no feed carries — segment totals only, never placed |

- **No ancestor fallback.** FeedHero's report still files a re-typed product under its OLD path
  until the next read (Superdry's "Men > Swimwear" sits under "Menswear", not "Men"), so a
  nearest-ancestor row would claim the product for a segment it is not counted in. A product whose
  full path is not in the tree reads **"not in the ROAS tree yet"** (a dashed box in the table).
- **Product age**: ≤7 days *Brand new*, ≤30 days *New*, then calendar QUARTERS — this quarter *This
  season*, the one before *Last season*, the two before that *This year*, older or undated
  *Perennial* — on the earliest `c:fs_date_of_birth` across the product's item group, counted at
  the ROAS read (a colour added last week to a 2025 style is filed with its style: 99.45% placed
  this way, 97.34% on the variant's own date). Re-test after a quarter rolls.
- **"Unlisted SKUs in Ads traffic"** belongs to no feed product. **ROAS SKU counts are master SKUs**
  — the feed is a subset, so a segment's product list is ≤ its `skus`.
- Accessorize has no ROAS report. **Price band** (Ray, 29 Sep 2026: *"add price band to this Roas option list"*) is on the
  list, but FeedHero's `Price_group` report is not set up for any roster brand yet (checked 29 Sep 2026 on Schuh UK,
  Superdry GB, Monsoon UK, Reiss GB, YuMOVE and Hobbycraft — each answers "Reports not found for Price group"). The
  card says so in one line, the inspector lists it under *Not set up in FeedHero for this market* (apart from a column
  FeedHero reads as empty), and it fills in on its own the day FeedHero has price groups for the client — the worker
  re-asks a not-set-up cut after a day. The label shape is unseen, so the parser refuses anything that is not a price
  range rather than guessing.
- Every figure is the SEGMENT's ROAS — the products this one sits with — and the page says so.

## 5. The page

- **Hero** — brand, Google / Meta, market chips, ↗ ROAS / ↗ Golden Record, and three source pills
  (feed · master · Google Ads) with live progress.
- **KPI band** — products (matched to the master · not in feed), in stock, on sale, new in 30 days,
  titles optimised, completeness master → feed, ROAS.
- **The dashboard — twelve modules of one size** (Ray, 29 Sep 2026: *"make it modularised / evenly spaced also, and
  generate 4-5 more interesting views"*): every card the same height on a 3-column grid that follows the page's own
  width (a container query, so the inspector pushing the page re-flows it to 2 and then 1), the KPI band one row of
  equal tiles each carrying its own mini bar, and ⊞ Modules to hide / reorder them per device (`fcc-cat-mods`).
  Every bar in every module is a filter on the table below. The six new views:
  - **Data FeedSpark added** — per attribute, the share of products carrying it in the master → the feed (a
    dumbbell), biggest additions first; custom labels and identifier_exists left out as plumbing.
  - **Google format issues** — per attribute, the products sending a value not in Google's format (recorded per
    product while tracing).
  - **Price bands** — what the shopper pays, full price and on sale stacked, bands chosen from the catalogue's own
    5th–95th percentile on a round-number ladder.
  - **Size-run health** — item groups with 2+ variants by the share of their variants in stock (all · 75%+ ·
    50–75% · under half · none): a broken run is spend on a page the shopper cannot finish on. **The run is read
    off the MASTER** (Ray, 30 Sep 2026: "i think this size-run health module is not accurate"): a feed whose stock
    rules drop out-of-stock sizes carries only the sizes in stock, so read off the feed every group was "all in
    stock" by construction — Superdry GB sends 25,695 products, every one in stock, and group 278158 reads 3 of 3
    where the master holds 7 sizes with 3 in stock. Every master row joins its item group's run (`E.runAdd`, stock
    from the availability word — `NOT_AVAILABLE` is out — or, with none, the quantity; neither = no guess), used
    only when half the feed's groups are found there; the card, its filter and the Variants column read ONE count
    (`grpC`), the footer names the out-of-stock sizes left out of the feed, and an all-in-stock feed with no master
    says it cannot show a broken run rather than printing 100%.
  - **Catalogue mix** — the biggest groups by brand / top or sub-category / colour / gender / age group / custom
    label, each with its on-sale share (brand by default on a multi-brand feed).
  - **Content depth** — images, highlights, title length, description length or keyword slots per product,
    bucketed against Google's own ranges.
  *What FeedSpark did* also names the three attributes each stage worked on most, each a link to its products; a
  path cut in *ROAS by* (GPC, category) names its leaf rather than a truncated root.
- **Three cards** — *New arrivals* (the Volume module's own bars, off `fs:date_of_birth`), *ROAS by*
  any cut (blue — `var(--chart-1)` is ROAS's alone; click a bar to list its products), *What
  FeedSpark did* (fields per product by the stage that set them).
- **The table** — virtualised (a 60k catalogue scrolls like 60 rows): ID, image, title pinned;
  price, sale, availability, a lineage strip (one cell per attribute, coloured by status, hatched =
  structured), completeness, FeedSpark's stamps, ROAS; ⊞ Columns (20 more, remembered per device), S/M/L rows,
  Table/Grid. Tabs: All · In stock · On sale · New · Changed by FeedSpark · Needs attention · Not in
  feed. Quick chips per status. Search grammar: `field:value`, a comma list ORs (`colour:navy,black`),
  `-` negates, "quotes" for a phrase; `/` focuses. Exits: ⬇ CSV (the view, lineage codes included),
  ⧉ IDs, → Brief (Workflow composer).
- **The inspector** — HOVER a row (a dwell of 380 ms to open, 150 ms to follow; it follows REAL
  pointer movement only, so a row scrolled under a still cursor never moves it — the /stock lesson),
  or click / Space. Docked beside the table (the page is pushed ≥1100 px, a bottom sheet on a phone).
  Before/after image slider, the offer, the **four-stage scrubber** (▶ Replay, ← →), completeness /
  fields / AI-ready, every field as a row with its four-node rail — click one for the word diff, the
  master column it came from, its status and Google's format. Then FeedSpark's stamps, the Google Ads
  segments, the raw master row, feed metadata, ↗ FeedHero master. ↑ ↓ move, P pins, Esc closes.
- **Field lineage** — every attribute × every product as one stacked bar; click a segment to list
  those products.

## 6. Harness

- `tools/test_catalog.mjs` (qa_gate / presync / validate) — header keys, value normalisation, the
  real Feed Lab parser, a zip built in-process, the join, every status on synthetic fixtures shaped
  like the real feeds, stages, completeness, spec, the word diff, the segment rules (age quarters,
  group birth, "Unsorted" cuts, merged names, mojibake), the worker helpers LIFTED by name against a
  stub MCP + KV, route scope and headers, registry, nav, page wiring, no client data in git.
- `tools/check_catalog.js` (presync, Playwright) — drives the real page on the synthetic Northwind set
  (`tools/catalog_stub.js`): the join, a real hover, the dock, the pointer guard (incl. Gecko's
  same-coordinate mousemove), the stages and the diff, exact category placement, the style's age,
  the "not read" cut, facets / search / matrix against an independent count, the phone sheet. Four
  assertions fail on a page with the guard removed and an ancestor fallback put back.
- `tools/catalog_stub.js` also feeds `check_mobile` / `check_darkmode`, behind a guard on the page's
  file name so no other page is served an engine it never asked for.

## Stock control (29 Sep 2026)

Ray: *"add stock control in the catalog modules as well, pull from stock management module"*. Three modules
read ONE `GET /api/rules/stock?brand=` — the route and engine output `/stock` draws — and pick the market whose
FeedHero company id is the wired feed's own:

- **Availability** — the feed's own availability word; every bar filters the table.
- **Stock controls** — `/stock`'s coverage matrix for this market (Ray: *"i wanna see this instead"*): one line per
  stock mechanism in `/stock`'s column order, the rule count in a cell shaded in `/stock`'s one hue, `—` where the
  market runs none, a total, the legend, and **Split by channel** (per device). The row tooltip names the rules; a
  click opens `/stock` on that market and mechanism.
- **Ad spend kept off** — `/stock`'s forecast: the market's largest blocking rule (counted once — "at least") ×
  spend per product per day × 5% / 10% / the 100% ceiling, over 30 days. No Google Ads read, or nothing held back,
  is said in words — never a guessed figure.

## Google Ads, this product's own — last 7 days (29 Sep 2026)

Ray: *"catalog module - bring in adwords data 7days in these columns option too"*, then *"isn't it in Ads Traffic
from feedhero reports? (you can then match by product ID)"*. FeedHero's reports server now carries **`ads_traffic`**
(added 29 Sep 2026): one row per advertised product as Google Ads returns it — Product ID (the client's own id; blank
when no product matches, when the lower-cased Ads item id stands in), impressions, clicks, cost, conversions,
conversion value, currency.

- **⊞ Columns → "Google Ads · this product · 7 days"**: Impr., Clicks, CTR, Cost, Avg. CPC, Conv., Conv. value, ROAS,
  Conv. rate, Cost / conv. — all off by default; turning one on reads the market's report. Every rate is worked out
  from the product's own sums and is blank — never 0% — where there is nothing under it (a product with impressions
  and no clicks has no CPC). Sortable, and in ⬇ CSV (a served product's counts; one the whole read did not list reads 0).
- **The join is the product ID, case-blind.** Checked 29 Sep 2026: 6 of the first 10 Schuh UK rows are in its live
  feed (the other 4 were served this week and have since left it), and Superdry GB's ids match exactly.
- **Only products with an impression are listed** (sorted by impressions the smallest is 1), so once a read is WHOLE a
  feed product missing from it had none — the cell reads "—" with that tooltip. The Google Ads pill says how many feed
  products were served and how many served products are no longer in the feed.
- **The inspector** opens on the product's own 7-day line (a 3 × 3 block) above the segments it sits in — a button reads
  the report when no column has.
- **The read** (`GET /api/catalog/ads?client=&market=`, worker `catAdsRead`): a big account is 100+ pages of 200 (Schuh UK
  22,283 rows, Superdry GB 26,673, Reiss GB 24,541), so the worker reads **24 pages a call, 4 at a time**, keeps where it
  got to in KV `catads:<cmpid>:7_days`, and the page calls again until the read is whole; only the whole read carries
  the rows (`{id: [impr, clicks, cost, conv, value]}`). Sorted by the Ads item id so pages hold their order across
  calls; FeedHero keeps a report an hour and then re-downloads it, so a read that meets a different window or row
  count **starts again** rather than splicing two reports. A whole read is kept 12 h. The first read of a market makes
  FeedHero download from Google Ads ("still being prepared" → 202, the page retries every 8 s). An account Google Ads
  returns nothing for (Accessorize UK: "No Ads Traffic data found") is an answer, kept a day. A Meta market is refused.
  The company is read off the wired feed, like the master. Nothing in git.
- **Harness**: `tools/test_catalog.mjs` (the engine's join and rates; `catAdsRow` + `catAdsRead` LIFTED against a stub MCP —
  the chunk, carrying on, the KV hit, fresh, the restart, preparing, missing, no token; the route and page wiring) and
  `tools/check_catalog.js` (the picker group, nothing read until a column is on, a two-call read, a served product's
  cells, the case-blind join, a blank CPC, "—" for an unserved product, sort, the pill, the inspector).


## The commercial view — for a buyer choosing between feed vendors (29 Sep 2026)

Ray, 29 Sep 2026: *"create more modules for Catalog Dashboard - that can be viewed for let's say a
brand procurement head not too close with FeedSpark day-to-day but understanding thing from a
commercial perspective, choosing between different feed vendor"*.

Six modules, read off THIS feed and never a claim. The dashboard is now eighteen modules in six even
rows.

| Module | The buyer's question | Read from |
|---|---|---|
| **Optimised vs not** | Does the work pay? | FeedHero's own Google Ads cut by FeedSpark's title (or keyword) optimisation stamp: share of products, share of revenue, **revenue per product**, ROAS, click-through, conversion |
| **Before and after FeedSpark** | What was our data worth without them? | Master → feed completeness (Golden Record weighting); products given a Google-required field their master lacked; values added and rewritten; the AI-shopping six carried; what is **still** missing |
| **Where the ad budget goes** | Is our spend earning? | 30 days of Google Ads spend by top-level category, bucketed by each category's own return: losing money (ROAS < 100%), below the market's ROAS, at or above it |
| **What the service does** | What would another vendor have to match? | Capabilities with their evidence in this feed: titles, keywords, categories and images (FeedSpark's stamps), missing data filled, AI-shopping fields, stock controls, rules maintained, per-product ad reporting |
| **The service in numbers** | How big is the job? | Products managed, feeds run for the brand (Google / Meta), values set per product, FeedHero rules running, new products taken in, values maintained |
| **Fee check** | What does it cost in the units we buy in? | The buyer types a monthly fee (and another vendor's to compare): per product, per value maintained, against Google Ads revenue and spend, the revenue lift that pays for it, the difference a year |

**Three rules keep it honest.**
1. **Optimised vs not is a comparison, not a controlled test.** Which products get optimised first is
   a choice, so the card says so in its footer. Controlled results live in the brand's A/B test
   archive.
2. **A capability the page cannot read is not a zero.** If the feed has no FeedSpark stamps, no master
   is joined, or the stock rules have not been read, the row says so (`·`); `—` means the feed shows
   no sign of it.
3. **No figure is invented.** The fee check is empty until a fee is typed. The figures are the
   buyer's own, kept on the device (`fcc-cat-fee`) and never sent. Revenue and spend are the market's
   last 30 days of Google Ads, as FeedHero read them.

**👔 Procurement view** is a one-click preset of the same per-device module state (`fcc-cat-mods`,
`v:'proc'`). It shows the six commercial modules first, then Ad spend kept off, Data FeedSpark added
and ROAS; the operational modules are put away. ⊞ Modules still tunes it, and a second click restores
all eighteen. The link `/catalog?view=procurement` opens it directly, for an AM to send to a buyer's
team.

A trap caught in the render: the page already had a `.cmp` class (the completeness bar, a flex row),
so the comparison table is `.vs`. The harness pins that.

Harness:
- `tools/check_catalog.js` (Playwright) drives the preset and checks each new card against an
  independent count from the stub's own data: revenue per product and ROAS, the budget buckets adding
  up to the category spend, the stamp share, completeness before and after, and the fee arithmetic.
- `tools/test_catalog.mjs` covers the optimised/not word matching (FeedHero writes "Optimized" /
  "Non Optimized"), the registry, the preset and deep link, the fee never leaving the device, and the
  class collision.

## Column filters (30 Sep 2026)

Ray: *"in catalog - allow filtering by column values as well"*.

Every filterable column header carries a **▾** that opens a filter, as in a spreadsheet:

- **Values.** Brand, availability, product type, colour, size, gender, custom labels, FeedSpark stamps, first-seen
  month and so on list their values, each with how many products carry it. Untick to hide, **find** narrows the
  list, and **Select all** / **Clear** act on what the find box shows.
- **A number range** for price, sale price, completeness, ROAS, variants, image count, title length and the Google
  Ads columns. Once a bound is set, a product with no value is left out.
- **Text** (contains, doesn't contain, has a value, is blank) for ID, title, GTIN, MPN and item group, where nearly
  every value is unique.

A column's list is counted from what the **other** filters leave, never its own. Ticking Navy under Colour never
hides Colour's other values from the list, which is how Excel behaves.

Filters combine with the tab, the quick chips, a module facet and the search. Each one is a chip beside the search
with its own ✕, and **Clear column filters** appears when there are two or more. The CSV, the ID copy and → Brief
take the filtered view, and their description line names every filter. Filters reset when the market changes.

The pop-up is fixed to the window and follows its ▾ when the table scrolls. A click that scrolls a column into view
must not close it. Each filterable column is 18px wider so the ▾ never pushes its label into an ellipsis.

Harness: the column-filter block in `tools/check_catalog.js`. The value counts are checked against an independent
count, a filter against the rows it leaves, and a range combined with text.

## Completeness is Google-ready as sent (30 Sep 2026)

Ray: *"i think these scoreding of masterfeed is too generous across the board"*.

He was right. A field scored in full the moment the master held it **in any form**: "NOT_AVAILABLE", a price
with no currency, "womens" as a gender, HTML in a description. Google takes none of those as they stand, so
FeedSpark's restructuring was being credited to the master.

A value now scores what Google would make of it **as is** (`E.credit`):

- in Google's format = full weight
- present but not in Google's format = **half** (it is there, but needs work before it can be sent)
- absent, or only buried in another column's text = nothing

The **same rule scores the feed**, so the two numbers stay comparable and the gap between them is the work done.
The inspector's stage scrubber uses the same credit.

**Superdry GB**, measured on the real files of 30 Sep 2026 (first 3,000 products):

| | Before | After |
|---|---|---|
| Master | 76 | 63 |
| Feed | 95 | 95 |

The master's points went on HTML descriptions, prices without a currency, all-caps colours and "womens".

**Fixed alongside:** the format check required `https://` for a link and an image, but Google accepts `http` or
`https` (Feed Lab dropped the same finding). It no longer flags them.

The procurement card **Before and after FeedSpark** gains a row, *Required values put into Google's format*, and
its footer now says how the score is read.
