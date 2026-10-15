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
path, a number, a link, a list, free text, one value per product, or values. A repeated tag
(`g:product_highlight`, `(2)` … `(10)`; the keyword `product_type` slots) also offers ONE **all slots** field.

**Readings** — a view of the column, never a new one:

| Reading | For | What it does |
|---|---|---|
| Each value | every field | the value as the feed states it |
| Path to tier | category paths | cuts `Womens > Clothing > Dresses` to tier N |
| Length bands | text, values | 1–30 · 31–70 · 71–150 · 151–500 · 501+ characters |
| Number bands | numbers | 0–10 · 10–25 · 25–50 · 50–100 · 100–250 · 250–500 · 500–1000 · 1000+ (`not a number` said) |
| Split lists | lists, values, text | splits on `|||`, `|`, `;`, `, ` |

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
to tier 1. The panel is moved onto `<body>` on first open — the hero clips its overflow and its entrance
animation makes it the containing block of anything fixed inside it. It names no client and no currency.

## Harnesses

- `tools/test_breakdown.mjs` (qa_gate / presync / validate) — the engine through the REAL Feed Lab parsers, every
  reading, filters, the cross-tab, specs across feeds, CSV; the route, the registries, the nav on every page, the
  gates and the stub.
- `tools/check_breakdown.js` (Playwright, presync) — the real page on the synthetic Northwind feed
  (`tools/breakdown_stub.js`), every count against an independent regex count of the XML: the panes, the
  cross-filter, any field, all slots, the pivot and its cell click, Styles, CSV, folds, a saved view, a reload, the
  Meta market, 390px.
