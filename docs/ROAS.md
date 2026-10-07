# ROAS — Google Ads return on ad spend, read from FeedHero (working name)

Ray, 23 Sep 2026: *"Build a new module for FCC. We can call it something else, not ROS, but let's
start with ROS for now."* Then, 24 Sep 2026, on the v1 table: *"i can see ROAS now mirror
exactly features like AdWords but futuristic design pls."*

Live at `/roas`. Module slug `roas` (grantable in the 👥 Access panel like every other module).

## 1. Source and scope

- **Source** — the `FeedHero_reports` MCP (`https://mcp.feedhero.net/mcp`), tool `roas_dashboard`.
  A DIFFERENT server from the `feedspark-reports` Task Manager MCP `/api/tm` reads. Google Ads
  impressions / clicks / conversions / revenue / spend per client × category, plus SKUs, zombie %
  and FeedHero's own Strong / Steady / Weak / Losing band.
- **Scope** — FeedHero's `client_list` carries 112 clients, most of them not FeedSpark's.
  `ROAS_ROSTER` (`src/roas.js`) is the seven brands Ray named — Superdry, Reiss, Schuh, Monsoon,
  Accessorize, YuMOVE, Hobbycraft — resolved to FeedHero's own `cmpid` per market (57 markets).
  A cmpid outside the map is never pulled, stored or shown.
- **Auth** — Worker secret `ROAS_MCP_TOKEN` (`Authorization: Bearer`; `ROAS_MCP_AUTH` names another
  header, `ROAS_MCP_URL` overrides the endpoint). Set by Ray in the Cloudflare dashboard, 24 Sep 2026.
- **Nothing in git** — every figure lives in KV (`roasidx`, `roas:<cmpid>`, `roaslive:*`,
  `roasstatus`). `tools/test_roas.mjs` fails on a committed snapshot or seed.

## 2. What the sync stores (v2)

FeedHero reports **trailing windows only** — never a day's own figure. So:

- **Three reads per market**, one per window (`ROAS_WINDOWS`: `7_days` → `w7`, `30_days` → `w30`
  (default), `90_days` → `w90`). Switching the period on the page switches the READ, it does not
  re-cut the same rows. Category rows kept: 200 by spend on `w30`, 80 on the other two.
- **History = the trailing figure as read each day.** `histAdd` writes one point per market per
  UTC day (a re-read the same day replaces it); `ROAS_HIST_DAYS` (400) on the record,
  `ROAS_SPARK_DAYS` (60) on the index entry as `spark`. A point is
  `{d, cur, w7:[sp,rv,cv,ck,im,sk,zb], w30:[…], w90:[…]}` (`HIST_COLS`).
- **The tree is a 30-day fact.** Confirmed 28 Sep 2026 on Superdry GB, Reiss GB and Monsoon UK:
  FeedHero breaks the category tree down for the 30-day window ONLY — a 7- or 90-day read carries
  the Total and an "Unlisted SKUs in Ads traffic" row (Ads traffic on SKUs not in the feed it
  holds; real spend, `isUnlisted`, tagged *not in feed* on the page) and nothing else. The live
  Brand / Gender / Price group cuts work on every period. The page says so on a 7/90-day market
  instead of showing an empty tree; `ROAS_TREE_WIN` names the window.
- **Delta "vs 7 days ago"** (`backPoint` / `deltaPct`, `ROAS_DELTA_BACK`) compares the latest
  trailing figure with the one read ≥7 days earlier — the same comparison Google Ads' own
  previous-period chip makes. Null (the page prints "no history yet") until the record is old
  enough; never a day-level figure re-derived from window differences.
- **Index entry** (`idxEntry`): the v1 flat shape kept (the 30-day Total's fields at the top
  level) + `w7 / w30 / w90` + `spark` + `day` + `sig`. `sig` excludes updated/day/spark, so an
  unchanged reading on the same day costs no KV write; a new day always writes (its point).
- **Budget** — a firing has ~50 subrequests; each market is 3 MCP calls + 4 KV ops, so
  `ROAS_PULLS` = 5 (asserted: `5 × 7 + 5 ≤ 50`). Cron `10,40 * * * *` (its own firing, never the
  TM one). The roster turns over roughly every 6 hours; FeedHero's figures move ~daily.
- **Currency** — nothing ever sums money across symbols. Rollups keep `{cur: amount}` maps and
  `byCur` per-currency populations (n, sums, derived rates, band tally); a blended ROAS exists
  only inside one currency.

## 3. Routes

| Route | What |
|---|---|
| `GET /api/roas` | The book off ONE KV get: `wins`, `brands{w7,w30,w90}`, `book{…}`, `markets[]` (`marketView`: totals per window + spark), `series{win}{cur | '*'}` (per-currency daily sums; `'*'` = every market, money nulled), `movers{win}`, `curs`, `rosterBrands`, `status`. `?brand=&market=` narrows the SAME shape (scope-checked). Scoped per signin. |
| `GET /api/roas?client=&market=&win=` | One market's category **tree** (`catTree`) for that window + its Total + last 60 history points. `?client=` alone = every market's totals + history (the dossier's v1 shape). |
| `GET /api/roas/live?cmpid=&agg=<cut>&win=` | Google Ads' *segment*: any of FeedHero's eighteen cuts of one market (§4a), read live (one MCP call, one FeedHero page of up to 200 rows, the biggest spenders; `of` = FeedHero's own row count), KV-cached 6 h, roster-only, scoped. `&fresh=1` bypasses the cache. |
| `GET /api/roas?pull=1` | Owner-only sync-now: one firing's rotation (capped at 6 markets). The page's ⚡ Sync now loops it `ceil(roster / per-call)` times — `status.read` is every market EVER read, so it can never be the stop condition. |

## 4. The page (`docs/FeedSpark_ROAS.html`)

Google Ads' reporting feature set on the FCC's own design language (the Command Center's aurora
hero + travelling edge + count-up figures; glass-edged cards; the validated chart pair
`#2563EB / #ED6F0B`, dark `#4C82E0 / #C67B28`):

- **Header** — `<select id="brand">` (the hours badge follows it), market chips, the 7 / 30 / 90-day
  segmented control, the **currency select** (every scorecard, chart, total and blended ROAS on
  the page runs on ONE currency's markets — the select names how many each covers), ⚡ Sync now,
  ⬇ CSV, ★ Views (per device, `fcc-roas-views`), a live status pip. Deep link:
  `?brand=&market=&win=&cur=&m=sp,rv&seg=&q=`.
- **Scorecards** — the twelve metrics (spend, revenue, ROAS, conversions, clicks, impressions,
  CTR, CPC, cost/conv, conv. rate, AOV, zombie %), each a count-up value, a ▲/▼ delta chip vs 7
  days ago coloured by the metric's good direction (spend is neutral), a sparkline. Click to plot.
- **Trend** — up to two metrics as two stacked panels on one calendar, each on its own axis
  (**never a dual axis**), crosshair across both, tooltip following the hovered panel. Captioned as
  what it is: the trailing window's total as read each day.
- **Movers** — markets rising / falling by revenue vs 7 days earlier, band beside each.
- **Performance table** — Brand → Market → Category (each level FeedHero's own aggregate), sticky
  header + name column, sortable columns, text filter (`/` focuses), band chips, ⊞ Columns
  chooser (`fcc-roas-cols`), per-currency Total rows, inline share-of-parent bars, "Show all" past
  30 categories, **Segment** select (Category from the store; every other cut live — §4a).
- **Picking a segment shows it** (Ray, 28 Sep 2026: *"in Roas module - segment doesnt populate
  properly"*). A cut is read per market, so choosing one used to change nothing until a market was
  opened by hand. Now:
  - **Picking a segment opens the markets in view** (under an open brand, passing the search),
    busiest first by clicks. A click count is currency-free, so no £ and € are compared. The cap is
    `SEG_AUTO` = 8, so one choice can never fire a live FeedHero read for every market on the
    roster. Past the cap, the footer names how many it opened.
  - **With no brand open**, it says to open one, and reads nothing.
  - **A deep link or saved view carrying a segment** lands populated.
  - **Typing a brand's name opens that brand.**
  - **Chevrons toggle on the first click.** A chevron opened by default or by the search closes on
    the first click (the old toggle took two).
- **The band filter never hides markets silently.** It hides a market by the market's own band, so
  "No activity" left a brand whose markets all have spend standing over nothing. The open brand now
  carries a line naming how many markets the filter hid, with a **Show them** link, and the footer
  says the same. This is what Ray's screenshot showed: `1 brand · 0 markets shown` under Schuh.
- **Price group is not set up in FeedHero** for any of the seven roster brands (checked live on
  28 Sep 2026: *"Reports not found for Price group"* on every one; Brand and Gender cut every market
  on every period).
  - `ROAS.segMissing` reads that answer as **not set up**. The worker returns
    `{ok:true, rows:[], missing:true}` and caches it like a read (`ROAS_SEG_MISSING_TTL`, a day).
  - The market says *"FeedHero has no price group report set up for this market"* instead of a red
    error on every open.
  - Any other failure still 502s.
- **Every cut FeedHero offers** — see §4a.
- **Phone** — the scorecard row scrolls sideways, the table pans inside its frame, nothing hides
  under a max-width rule (`tools/check_mobile.js`); multi-sentence explainers fold behind ⓘ.

## 4a. Every segment FeedHero offers (30 Sep 2026)

Ray: *"add more segment type inside ROAS dashboard module"*. The select offered four of FeedHero's
cuts. Asked for a cut it does not know, the MCP lists its own **eighteen**, and the select now
offers all of them, grouped by what the cut answers:

| Group | Cuts (FeedHero key) |
|---|---|
| Product | Category · Brand · Colour · Gender · Age group (`Age_group`) · Google product category (`Google_product_category`) |
| Price | Price type (`Price_type`) · Price group (`Price_group`) |
| Lifecycle | Product age (`Product_age`) |
| FeedSpark work | Title optimisation · Keyword optimisation · Data-field review (the three `*_optimisation_status`) · Batch (`Batch_id`) |
| Custom labels | Custom label 0–4 |

- **One list** (`SEGS` in the page) feeds the select, the column head, the footer and every
  sentence about a cut, so a cut is never named two ways — the old sentences built the name off the
  key and read "title optimisation_status". The worker's allow-list is the same eighteen, and
  `tools/test_roas.mjs` holds the two lists equal to FeedHero's own.
- **A cut with no values says so.** When every product in a market sits in FeedHero's
  **Unsorted** bucket (checked live 30 Sep 2026: Batch id on Superdry GB; Monsoon's custom labels),
  the market reads *"Every product in this market sits in Unsorted — the … field is empty in the feed
  FeedHero reads"* rather than showing one big segment. An Unsorted row in a populated cut carries a
  **no value** tag, beside the unlisted row's **not in feed**.
- **A long cut says it is a page.** A read is one FeedHero page of up to 200 rows (its ceiling),
  biggest spenders first; Colour on Monsoon UK runs to 144. When FeedHero reports more than the page
  holds, a note leads the market's rows: *"The 200 biggest-spending of N … values"*.
- **Product age is a ladder.** Sorted by name it reads Brand new → New → This season → Last season
  → This year → Perennial, never alphabetically.
- **An unknown cut in a link or saved view** lands on Category and reads nothing live.
- Price group is still not set up in FeedHero for any roster brand; that answer is unchanged
  (§4, "not set up").

## 4b. The dashboard, modular — and every piece of it exportable (30 Sep 2026)

Ray: *"make roas dashboard modularised also pls, allow exports"*. The Catalogue's own pattern, on the
same book the page already reads — **no second fetch, no figure the table does not already hold**.

**Eight modules, one card size.** A 3-column grid driven by a *container* query on `main` (so it
re-flows 3 → 2 → 1 with the column it sits in, never the window width), every card the same height,
Trend two columns wide:

| Module | What it reads (the chosen currency's markets, the chosen period) |
|---|---|
| Trend | the two metrics picked on the scorecards, day by day — now drawn at the card's own pixel width, so both panels fit the card |
| Movers | markets rising / falling by revenue vs 7 days earlier (top 5 each) |
| ROAS bands | markets and spend under each of FeedHero's bands — click a band to filter the table |
| Spend vs revenue share | each brand's (or, with a brand picked, each market's) share of the spend against its share of the revenue, ▲/▼ the gap in points — click a brand to open it |
| ROAS by market | every market ranked, a dashed line at the blended ROAS of those markets |
| Cost per conversion | spend ÷ conversions, most expensive first, CPC beside it, the blended figure as a line; a market with no conversions says so, never 0 |
| Zombie SKUs | SKUs × FeedHero's zombie share per market, biggest first, the SKU-weighted total in the foot |
| Data freshness | every roster market in scope by how long since it was read (under 12 h … over 3 days, never read) — the one module that is not money, so it covers every currency and says so |

**⊞ Modules** shows, hides and reorders them, remembered **on this device** (`fcc-roas-mods`) — how one
screen reads the book, never shared state. A hidden module is `display:none` (a `[hidden]` attribute
alone loses to the card's own `display:flex`, the trap the tripwire reads off the paint).

**Exports.** Each module has ONE model that feeds its card, its CSV and its Excel tab, so the three can
never disagree:

- **⬇ on a card → PNG** — the card as drawn at its natural height (a scrolled card would clip the
  rows under its fold), captioned *ROAS · module · scope · date · FeedSpark · Private & Confidential*,
  for a deck. **→ CSV** — every row behind the card, not only those that fit it.
- **⬇ Export → Excel workbook** — About (scope, source, status, the currency rule), Scorecards, every
  module *shown* in its order, and the table as on screen, a tab each, through the FCC's own typed
  xlsx writer (`/xlsx/engine.js`, loaded on first use): figures are numbers, percentages are
  percentages, and money sits beside a **Currency** column rather than text with a symbol glued on.
- **⬇ Export → PDF of the dashboard** — the screen as one continuous A4-landscape-wide page, headed
  with its scope. **→ Table as CSV** — unchanged.

PNG and PDF rasterise with html2canvas + jsPDF from cdnjs under the same SRI hashes `/golden` and
`/kwcal` pin; an unreachable CDN falls back to the print dialog for the PDF and says so for a PNG,
never remembered as a permanent failure. Nothing leaves the browser: every file is built on the page.

## 4c. ◐ Heat — a colour scale per column, trough to peak (30 Sep 2026)

Ray: *"can you allow option to highlight column cells color in gradiant to find peak and trough too,
selected columns individually"*. Excel's colour scale on the Performance table, switched on **column by
column** from **◐ Heat** beside ⊞ Columns (it lists the columns on screen; Band and Updated have no
peak and are never offered; All / Clear; the button counts the columns on).

Three rules, each because the obvious version would mislead:

1. **One level at a time.** Brands are scaled against brands, markets against markets, categories (or
   a segment's rows) against the others at the same depth. A brand's total beside one of its own
   categories is not a comparison. With every brand open, the markets are ranked across the whole view.
2. **Money within one currency.** Spend, revenue, CPC, cost/conv., AOV and avg. price are scaled only
   against rows in the same currency (a brand row by the currency its cell shows). A lone € market has
   no scale to sit on and stays plain. Ratios and counts (ROAS, CTR, conv. rate, zombie %, clicks,
   impressions, conversions, SKUs) compare across currencies.
3. **The midpoint is the median, not the middle of the range.** Spend is skewed: on a midrange scale
   one big market paints every other market orange. Around the median, orange means below the
   typical row and blue means above it. Both deepen toward the trough ▼ and the peak ▲, and the
   median row is left untinted.

The tint is the chart pair's own steps (light `#ED6F0B` / `#2563EB`, dark `#C67B28` / `#4C82E0`),
under ink text, so every figure keeps its contrast. The colour means **high or low, not good or bad**:
a peak CPC is a peak too, and the menu says so. Each tinted cell's tooltip names the peak, the trough
or its rank (*"2nd highest ROAS of the 3 markets shown"*). The header carries a trough → peak bar, and
the footer names the columns on. The Total rows are never on the scale.

The chosen columns are saved **on this device** (`fcc-roas-heat`) and inside a ★ saved view. The
setting describes how one screen reads the table, so it is never shared state.

**A phone fix found on the way.** Every menu on the page hangs off its button's right edge, so at 390px
⊞ Columns, ★ Views and ⬇ Export opened half off the left of the screen. The new menu did the same.
`fitPop` now nudges any menu back inside the screen (8px from either edge), and CSS caps its width.

## 5. Harness

- `tools/test_roas.mjs` — engine (parsing on real specimens, roster, rotation + budget, windows,
  history, idxEntry, catTree, rollups per currency, series, movers, the no-Total-row regression),
  worker wiring, page feature set, no-data-in-git. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/check_roasmods.js` — Playwright, in presync: the eight cards even (one height, three rows,
  Trend two wide, both trend panels inside their card), every card's figure against a count made in
  the test, the currency switch, a band / brand click leading somewhere, ⊞ Modules hide / reorder /
  reload / reset read off the paint, and the exports — a module CSV (every row, currency in its own
  column), a module PNG (that card, captioned, full height, the ⬇ left out, put back after), the
  Excel workbook opened and its tabs read (a hidden module left out), the PDF, the table CSV; then
  390px. Two negative controls were run at build: without the `[hidden]` rule a hidden card still
  paints, without the capture rule a long card is clipped — both fail it.
  ◐ Heat block: nothing tinted until a column is picked; the menu lists exactly the columns shown bar
  Band/Updated and stays open across ticks; the peak / trough brand (counted in the test) blue ▲ /
  orange ▼; only the picked column coloured, header + footer naming it, Total rows never; with every
  brand open, markets ranked against markets across currencies for a ratio, the median market
  untinted with its rank in the tooltip, the lone € market off the £ spend scale; reload keeps it,
  Clear clears it, a saved view restores it; on a dozen £ markets the tint deepens monotonically away
  from the median, one hue each side, one ▲ and one ▼; dark mode in the dark pair; every menu inside
  a 390px screen. Negative control at build: dropping the per-currency grouping fails four of them.
- `tools/check_roasseg.js` — Playwright, in presync. It drives the real page on the synthetic
  stub:
  - the search opens a brand;
  - a picked segment populates its market, with one live read and nothing beyond the search;
  - the band-filter line, and **Show them** clearing it;
  - Price group reading as "not set up";
  - all eighteen cuts offered once each in five groups; a FeedSpark-work cut naming itself in the
    head and footer; an all-Unsorted cut and a longer-than-a-page cut each saying so, the note first;
    product age sorting as a ladder; an unknown linked cut falling back to Category;
  - a first-click close;
  - nothing open → a hint and no read;
  - every brand open → one read per market;
  - a `?seg=` deep link landing populated.
- `tools/roas_stub.js` — a SYNTHETIC `/api/roas` payload the browser tripwires
  (`check_mobile.js`, `check_darkmode.js`) feed the page so its charts and table render under
  their rules.
