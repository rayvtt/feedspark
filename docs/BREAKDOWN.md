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
  count; a cell click filters the page to its row and column; ⤓ CSV.
- **Every field in this feed** — how full each field is, what it reads as, how many values, a sample, and
  ＋ Break down / Rows / Columns.
- **Saved views** — a view is the fields and how they are read, **never the brand**, so one view opens on any feed;
  a field a feed names another way (`g:brand` ↔ `brand`) is found by its bare name, one it does not carry says so.
  The layout and the views are this device's (`fcc-bd-layout`, `fcc-bd-views`); the filters reset with the feed.
- Every section folds (`fcc-bd-fold`; a fresh device opens Breakdown + Pivot), ⊕ Open all / ⊖ Fold all, a `#hash`
  opens its section.

## Harnesses

- `tools/test_breakdown.mjs` (qa_gate / presync / validate) — the engine through the REAL Feed Lab parsers, every
  reading, filters, the cross-tab, specs across feeds, CSV; the route, the registries, the nav on every page, the
  gates and the stub.
- `tools/check_breakdown.js` (Playwright, presync) — the real page on the synthetic Northwind feed
  (`tools/breakdown_stub.js`), every count against an independent regex count of the XML: the panes, the
  cross-filter, any field, all slots, the pivot and its cell click, Styles, CSV, folds, a saved view, a reload, the
  Meta market, 390px.
