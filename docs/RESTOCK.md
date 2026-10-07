# Restock — demanded in Google Ads, not buyable

Ray, 7 Oct 2026: *"feedhero-reports have got By Products report - and 'Restock products' is interesting
to build as a module."*

Live at `/restock`. Module slug `restock` (grantable in the 👥 Access panel). Harness
`tools/test_restock.mjs` (node, qa_gate / presync / validate) + `tools/check_restock.js` (Playwright, presync).

## 1. What a restock product is, here

A product shoppers are **still asking for in Google Ads** — an impression, a click, a conversion in FeedHero's
trailing **30-day Ads Traffic** read — that **cannot be bought right now**, because the output feed either sends it
**out of stock** or **no longer carries it at all** (FeedHero's own *"Unlisted SKUs in Ads traffic"*).

Ranked by the conversion value the product carried in the window, so the top of the list is the demand the stock
position is costing the most. A second view lists products that **came back** in stock, so their ads can be
re-activated.

FeedHero's reports MCP exposes no "By Products" / "Restock products" tool (checked 7 Oct 2026: `roas_dashboard`
rejects the aggregation, the website is login-gated), so this is built from the two reads the MCP does expose and
the definition above is stated on the page. If FeedHero's own view differs, the page's columns can be aligned
to it.

## 2. Sources and scope

| | Where | How |
|---|---|---|
| **Demand** | FeedHero `ads_traffic` (the `FeedHero_reports` MCP, `ROAS_MCP_TOKEN`) | The Catalogue's per-product Ads lane, `catAdsRead(env, cmpid, fresh, period)`, read over `30_days` (`RESTOCK_PERIOD`). One record per company × period (`catads:<cmpid>:30_days`), a chunk a call, kept 12 h, restarted if FeedHero re-downloads the report mid-read (two reports are never spliced). |
| **Stock state** | The output feed, through `/api/feed/proxy` | Streamed **in the browser** through the Feed Lab parser (`FeedAudit.createXmlParser` / `createParser`); `docs/restock_engine.js` reads id, title, link, image, availability, price, the first `product_type` slot. |
| **Days unavailable** | KV `restock:<cmpid>` — the ledger | Written by the page's observation after each join (`PUT /api/restock/ledger`), see §4. |

- **Company id** is read off the **wired output feed's URL** (`catCmpid`), never the query. A sheet-backed feed has
  none → *"FeedHero holds no Ads Traffic report for it"*. A `-fb` market is refused (Google Ads is the Google
  feed's).
- **Scope** — `/api/restock/*` is scoped like `/api/catalog/*` (`accessOf` → `clientMatch`). The roster is every
  Google market this signin may open.
- **Nothing in git** — the Ads read and the ledger live in KV only. `tools/test_restock.mjs` fails on a committed
  `ads_traffic` payload or a roster company id in the stub.

## 3. The join (`docs/restock_engine.js`, UMD `FeedRestock`)

| State | Placed when |
|---|---|
| **Buyable** (`live`) | the feed carries the product in stock, pre-order or backorder |
| **Out of stock in feed** (`oos`) | the feed carries it with an out-of-stock word |
| **Not in feed** (`gone`) | no feed product has the id — FeedHero's "Unlisted SKUs in Ads traffic" |
| **Availability not stated** (`na`) | the feed carries it with no availability word, or one the vocabulary cannot read — its own bucket, **never** read either way |

- The key is the **product id, case-blind** (`adsKey`): Google lower-cases the Ads item id that stands in for a blank
  Product ID.
- **Availability vocabulary** (`availState`): in stock / instock / available / limited availability … → `in`;
  preorder / backorder → `pre`; out of stock / sold out / unavailable / discontinued … → `out`; anything else → `na`.
- **Nothing is joined against a feed that did not stream whole** — every product past a break would read "not in
  the feed". The page says so instead.
- **Money never crosses a currency.** `summary()` sums value and cost only when the read is one currency
  (`curMix:false`); a mixed read sums impressions, clicks and conversions and the page says why.
- **Where the lost demand sits** (`byCategory`): conversion value on unavailable products by the feed's top-level
  `product_type`; a product gone from the feed has none → *"No longer in the feed"*; past eight categories the tail
  folds into *Other (N more)* carrying its figures.

## 4. The ledger (`cloudflare/feedspark-deck/src/restock.js`)

FeedHero reports a **window**, never a day, and the feed says what is out of stock **now** — so "out of stock for
how long" exists nowhere until something writes it down.

- After each join the page reports what it saw: `{oos: [ids], gone: [ids], back: [ids], n, feedN}` — `back` = ids the
  ledger had as unavailable that are in stock in the feed now. `cleanObs` sanitises it (an id is one thing: out of
  stock beats gone beats back; lists capped; an observation with no lists at all is refused — a failed feed must
  never be written as "everything came back").
- `ledgerUpdate(prev, obs, now)` keeps one entry per product: `[first seen unavailable, last seen, state code
  (o|g), came back at|0]`. Still unavailable → the episode goes on (first seen **kept**); came back → stamped, kept
  `RESTOCK_BACK_KEEP_DAYS` (14) for the Back-in-stock view, then dropped; came back then went again → a **new**
  episode; unseen for `RESTOCK_STALE_DAYS` (45) → dropped (no longer demanded); `RESTOCK_CAP` (6,000) entries, the
  oldest-seen go first. KV TTL 120 days.
- **Tracking begins the first time a market is opened** and the page says so (*"Tracking since … · N readings"*;
  a product never recorded reads *first seen today*). It is never back-filled.
- The ledger is page-driven today (an AM opening the market keeps it current). Moving the observation onto the
  4×-daily xml-scan agent is the natural next step — the agent already streams every feed; it would need the
  availability word per id beside the id set it keeps.

## 5. Routes

```
GET /api/restock/roster                      → {period, keep, clients: {client: [{mkt, kind, cmpid, ads}]}}
GET /api/restock/ads?client=&market=[&fresh] → 503 no_token · 202 preparing · {ok, missing} · head{done:false} → call again · head + rows when done
GET /api/restock/ledger?client=&market=      → {ledger, summary {began, last, n, oos, gone, back, days}, keep, stale}
PUT /api/restock/ledger?client=&market=      → the observation merged; the ledger returned (ACT restock-ledger)
GET /restock/engine.js                       → docs/restock_engine.js verbatim
```

## 6. The page (`docs/FeedSpark_Restock.html`, on `/design/fcc.css`)

Brand select + market chips (a sheet-backed market dashed, *no Ads*) · ⚡ Re-read Google Ads · ⬇ CSV · ⧉ Copy IDs ·
→ Brief (Workflow, cat technical: *"Restock - demanded, not buyable - Brand MKT - MMYY"* / *"Re-activate ads - back
in stock …"*) · ↗ FeedHero (the Ads Traffic report on FeedHero's site, the MCP's own `web_url` shape) · status line
(feed · Ads window · tracking since) · six KPIs (products served · not buyable · out of stock in feed · not in the
feed · conversion value on them + spend still landing · back in stock) · the buyable / not split · where the lost
demand sits · the table (Restock · Back in stock · All demanded; sortable, filterable, 100 then Show all; image,
id + title, state, days unavailable, impressions, clicks, cost, conversions, conversion value, price, category, ↗
product page) · how it is read. Deep link `?brand=&market=&view=`. `window.__FCCRestock.state()` for the harness.
Phone: the KPI band is two tiles a row and the table pans in its frame.

## 7. Open questions for Ray

- FeedHero's own *Restock products* definition and columns — a screenshot aligns the page to it.
- Whether the observation should move onto the xml-scan agent (so days unavailable accrue without anyone opening
  the page) — see §4.
