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
| `GET /api/roas/live?cmpid=&agg=Brand\|Gender\|Price_group&win=` | Google Ads' *segment*: FeedHero's other cuts of one market, read live (one MCP call), KV-cached 6 h, roster-only, scoped. `&fresh=1` bypasses the cache. |
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
  30 categories, **Segment** select (Category from the store; Brand / Gender / Price group live).
- **Phone** — the scorecard row scrolls sideways, the table pans inside its frame, nothing hides
  under a max-width rule (`tools/check_mobile.js`); multi-sentence explainers fold behind ⓘ.

## 5. Harness

- `tools/test_roas.mjs` — engine (parsing on real specimens, roster, rotation + budget, windows,
  history, idxEntry, catTree, rollups per currency, series, movers, the no-Total-row regression),
  worker wiring, page feature set, no-data-in-git. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/roas_stub.js` — a SYNTHETIC `/api/roas` payload the browser tripwires
  (`check_mobile.js`, `check_darkmode.js`) feed the page so its charts and table render under
  their rules.
