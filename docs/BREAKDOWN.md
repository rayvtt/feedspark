# Field breakdown — `/breakdown`

> Ray, 15 Oct 2026: "build another module that similar to custom label and PT — basically having the ability to
> breakdown in pivot table like this for any fields is super helpful … can we build a custom 'breakdown' fields
> module to breakdown in pivot with any fields in any feeds?"

Label Guard breaks the five custom labels down (value · SKUs · share) and PT Guard the primary product_type. This
module does the same for **any field of any wired feed**, Google Shopping or Meta, and sets any two fields against
each other in a pivot.

## What it reads

- **The feed**: the market's wired output feed, streamed through `/api/feed/proxy` and parsed in the browser by the
  Feed Lab parser (XML or a sheet's CSV). Nothing is sampled and nothing is stored; ⟳ Re-read feed reads it again.
- **The roster**: `GET /api/breakdown/roster` lists every client × market the signin may open (scoped like the
  other feed modules), Google **and** Meta (`meta: true` on a `-fb` market).

## The engine — `docs/breakdown_engine.js` (UMD `FeedBreakdown`, served at `/breakdown/engine.js`)

One feed is held **column by column**: each column is a dictionary of the distinct values it carries plus one
`Uint32` per product pointing into it (0 = blank). The XML parser grows its header as new tags appear, so a column met
late reads blank on the products before it. A 25,000-product feed of 150 columns is ~15 MB, and every breakdown after
the read is arithmetic over integers.

**What a field reads as** is judged off its values, never its name (a sheet feed's names say nothing): a category
path, a number, a date, a link, a list, free text, one value per product, or values. NEWNESS (Ray, 19 Oct 2026: "add newness to both columns and rows … just do it based on quarter, from the latest quarter to the previous quarter"): a date column (ISO or DD/MM/YYYY on 80%+ of its values — FeedHero's `fs_date_of_birth`) leads every field picker under **Newness · by quarter** and opens read by quarter on a pane, the pivot's rows or its columns; the quarters count back from the one we are in (UTC), so a band means the same thing all quarter. A repeated tag
(`g:product_highlight`, `(2)` … `(10)`; the keyword `product_type` slots) also offers ONE **all slots** field.

**Readings** — a view of the column, never a new one:

| Reading | For | What it does |
|---|---|---|
| Each value | every field | the value as the feed states it |
| Path to tier | category paths | cuts `Womens > Clothing > Dresses` to tier N |
| Length bands | text, values | 1–30 · 31–70 · 71–150 · 151–500 · 501+ characters |
| Number bands | numbers | 0–10 · 10–25 · 25–50 · 50–100 · 100–250 · 250–500 · 500–1000 · 1000+ (`not a number` said) |
| Split lists | lists, values, text | splits on `|||`, `|`, `;`, `, ` |
| Newness by quarter | dates (`fs_date_of_birth`) | the calendar quarter a product first appeared in, newest first: `Q4 2026`, `Q3 2026`, then six more quarters, the rest in one `Before …` band; a quarter nothing arrived in is a 0 on an unbroken ladder; an unreadable date is said |

**Four rules**, because these tables go in front of clients:

1. A blank is a value, `(blank)`, counted and listed last.
2. A product carrying several values (all slots, a split list) is counted once in **each** — those shares add to more
   than 100%, and the table says so ("counted in each value").
3. A reading never changes the column underneath; the mode is part of the field's spec `{f, m, k}`.
4. Nothing is sampled.

**Styles**: counting by item group counts each `item_group_id` once per value (a product with no group is its own).
A feed with no `item_group_id` cannot count styles and the button says so.

## The page — `docs/FeedSpark_Breakdown.html`

- **Breakdown** — a pane per field: the field, how it is read (and the tier), value · products · share, sortable,
  top 50 then Show all, ⤓ CSV per pane. Clicking a value **filters every other table** and the filter bar — never
  its own (the value stays highlighted, its siblings still listed). Filters are AND across fields, OR within one.
  🔍 finds a value in every table.
- **Pivot** — Rows × Columns, each any field and reading; Count · % of row · % of column · % of total; top 25/50/100/
  all rows (the rest counted, never dropped); columns past the twelfth fold into one **Other** column that keeps its
  count; a cell click filters the page to its row and column; ⤓ CSV carries EVERY row and EVERY column — the
  Other fold and the top-N cut are for the screen only.
- A pane is as wide as its longest value, up to the row; a value longer than that wraps, never cut short.
  Its width is also the reader's to set: drag the handle on its right edge (← → step 20px), double-click or Enter
  gives it back its own width; kept per device with the layout (`w` on the pane in `fcc-bd-layout`).
- **Every field in this feed** — how full each field is, what it reads as, how many values, a sample, and
  ＋ Break down / Rows / Columns.
- **Saved views** — a view is the fields and how they are read, **never the brand**, so one view opens on any feed;
  a field a feed names another way (`g:brand` ↔ `brand`) is found by its bare name, one it does not carry says so.
  The layout and the views are this device's (`fcc-bd-layout`, `fcc-bd-views`); the filters reset with the feed.
- Every section folds (`fcc-bd-fold`; a fresh device opens Breakdown + Pivot), ⊕ Open all / ⊖ Fold all, a `#hash`
  opens its section.

## 📖 Guidebook — how to read a feed (Ray, 15 Oct 2026)

A floating button in the bottom-right corner — the one the Feed Chat bubble held until it was removed from the FCC (Ray, 15 Oct 2026); on a phone it rides above the module bar and the Shipped handle. Hover opens it (keyboard focus too); a click pins it; Esc, ✕ or a click
outside closes it; under 760px it is a bottom sheet. It holds the breakdowns worth showing a client — each
recipe a pivot (rows × columns), what to look for in it, the action it leads to and the KPI that action moves:

| Group | Recipes |
|---|---|
| Spend efficiency | price bands × category · custom label 0 × category · availability × category |
| Visibility | title length × category · product type depth (tier 3) · keyword strings (product_type, all slots) · brand gaps |
| Conversion & AI readiness | apparel attributes · highlights per product · material · images per product |
| Commercial mix | on sale × category · brand × availability |
| Governance | Google against Meta · the same view every month |

Three views worth saving close it (bidding readiness, search coverage, AI readiness). **▶ Try it** sets the
pivot on the feed in front of you through `B.resolve`, so a field another feed names differently is still
found; a field the feed does not carry is NAMED in a toast and never set. Category = `g:product_type`, read
to tier 1. **The field with more values goes on the rows** (Ray, 16 Oct 2026: "fields with more values on row
<> less on column"): a recipe is written rows × columns, but which field carries more distinct values is a
fact about the feed in front of you, so ▶ Try it counts both (the pivot's own rows, blank included) and puts
the longer list down the page — two availability words across forty categories reads as a tall table, never
one the reader scrolls sideways. A tie keeps the recipe's own order; a recipe with no column field has nothing
to turn; the toast says when it turned them and the two counts. The panel is moved onto `<body>` on first open — the hero clips its overflow and its entrance
animation makes it the containing block of anything fixed inside it. It names no client and no currency.

## Harnesses

- `tools/test_breakdown.mjs` (qa_gate / presync / validate) — the engine through the REAL Feed Lab parsers, every
  reading, filters, the cross-tab, specs across feeds, CSV; the route, the registries, the nav on every page, the
  gates and the stub.
- `tools/check_breakdown.js` (Playwright, presync) — the real page on the synthetic Northwind feed
  (`tools/breakdown_stub.js`), every count against an independent regex count of the XML: the panes, the
  cross-filter, any field, all slots, the pivot and its cell click, Styles, CSV, folds, a saved view, a reload, the
  Meta market, 390px.

## Google Ads in the pivot (Ray, 19 Oct 2026)

> "Is there a way to bring AdWords and ROAS data into these breakdowns as well? For example, it would be interesting to
> see how much spend in the past 30 days each group of custom labels has received, in contrast with the total spend."

**Measure** beside Show: *Products* (the count) or a Google Ads figure for the last 30 days, which are *Spend*,
*Conv. value*, *ROAS*, *Clicks*, *Impressions* and *Conversions*.

- **The read.** `GET /api/breakdown/ads?client=&market=` serves the same 30-day Ads Traffic read the Restock module uses
  (`catAdsRead`, one record per company × period, a chunk a call, 202 while FeedHero prepares it). It is scoped like
  the roster.
  - A **Meta** market reads its **Google** market's report. Google Ads belongs to the Google feed, and the page says so.
- **The join.** `adsJoin` joins on product id, case-blind, on whichever of `g:id` / `c:fs_data_original_id` carries
  more of the report's ids.
  - Spend on ids the feed no longer carries is **kept apart**. It is named on the line above the table and is in no row.
  - A product with no ads traffic counts as 0.
- **The sums.** `pivot` / `cross` take `opts.w` (and `opts.w2`). Each cell sums its products' figures instead of
  counting them.
  - Every row and column also carries `p`, the number of products in it.
  - A weighted table never counts item groups, because spend belongs to a product.
  - Rows sort by the measure.
- **The contrast.** Beside a sum sits **% of products**. With *Show → % of total*, each group reads its share of the
  spend against its share of the catalogue in one line.
- **ROAS** is conversion value ÷ spend from each group's own sums, never an average of ratios.
  - Spend sits beside it.
  - The % views are switched off, because a ratio is not a share.
  - A cell with value but no spend reads `—`.
- The CSV names the measure and currency and keeps the extra column.
- Harnesses:
  - `tools/test_breakdown.mjs`: the join, the sums, the ratio and the route.
  - `tools/check_breakdown.js`: every row total against a count made in the test from the stub's synthetic Ads rows,
    the out-of-feed id kept apart, % of total, ROAS and the CSV.


## Columns that fit, widths you set, and spend · value · ROAS together (19 Oct 2026)

Ray: "remove notion of this quarter and last quarter - make column always fit - also, allow width adjustment too across Pivot", then "can I see spend, conversion value, and ROAS together on one dashboard? … keep it as a bar chart on a specific segment".

- A quarter is named by itself (`Q4 2026`), never "this quarter" / "last quarter" / "ahead" — the ladder and its order are unchanged.
- The pivot is a fixed-layout table at 100% of its card: the columns share the width, a heading WRAPS rather than being cut, so at 1440px nothing scrolls sideways (a phone still pans — 64px a column is the floor).
- Every column heading carries a grip: drag it to set that column's width, double-click or Enter for the default, ← → step 20px. Widths are remembered on this device by what the column IS (`rh`, `tot`, `ps`, `c:<value>`) in `fcc-bd-layout` › `pivot.w` (60 kept), so a value's column keeps its width when it comes back.
- **Spend · conversion value · ROAS** sits under the pivot: one row per value of the pivot's rows field (or its columns field, `by`), spend and conversion value as two bars on ONE money scale, ROAS (conversion value ÷ spend from that segment's own sums) on its own scale with the whole selection's ROAS marked. Sort by spend / value / ROAS, top 15 then Show all, a row click filters the page. It reads the same 30-day Google Ads join as the Measure picker; before Ads is read it offers ⚡ Read Google Ads. Segments with no spend and no value are counted, not drawn.

## Two readings in one table — the Layer (19 Oct 2026)

Ray: "in the same pivot table … see 2 data points together to compare — within this split — volume of product (in count) and ROAS avg … is there a way to layering 2 data … in the same table?"

- **Layer** beside Measure: Nothing · Products · Spend · Conv. value · ROAS · Clicks · Impressions · Conversions (never the measure itself).
- Every cell, row total and column total then reads TWO things: the measure as the number (orange shade, as before) and the layer under it in small type with a blue bar on the layer's OWN scale — two readings never share one axis.
- The engine sums the layer on the SAME rows and columns (`pivot` / `cross` take `opts.lw` — `1` counts products — and `opts.lw2` for a ratio), so a ROAS layer is conversion value ÷ spend from that cell's own products.
- A Google Ads layer waits for the Ads read (and says so); the CSV carries the layer as a second block; the layer is part of the layout and a ★ view.
