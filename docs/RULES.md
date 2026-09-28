# Rules + Stock management — FeedHero's Rule Manager, made readable

Ray, 28 Sep 2026: *"Besides ROAS, let's try to bring other data points from FeedHero reports MCPs as
well. For example, 'Rules' … There's a ton of rules for each client of mine, and each rule is
intended towards a certain type optimization or a feature setup. I'm most interested in stock
management related rules, so can you please try and bring it in and make sense of it? The new
module can be called rules and another is stock management - taking into consideration from rules."*

Live at `/rules` and `/stock`. Module slugs `rules` and `stock` (grantable in the 👥 Access panel).

## 1. Source and scope

- **Source** — the `FeedHero_reports` MCP (`https://mcp.feedhero.net/mcp`), tool `rule_report`: the
  Rule Manager's own list per client — rule name, target field (label + database name), System/User,
  batch, run time, impacted items ("N of M"), created / modified on and by, status, and the issues
  FeedHero's cron flagged (*Not impacting any items*, *Target column missing*, *Dependent column
  missing*). Active rules only, **in the order they run**.
- **Same server, same token as ROAS** — the worker reuses `roasMcp` and `ROAS_MCP_TOKEN`; there is no
  second FeedHero credential.
- **Scope** — `ROAS_ROSTER` (the seven brands, 57 markets). Only rows whose `cmpid` IS the market
  being read are kept, so FeedHero's company filter (which matches by id *or* name) can never let a
  client outside the roster in.
- **Nothing in git** — KV only: `rules:<cmpid>` (the full normalised list), `rulesidx` (one entry per
  market: summary, stock rows, the market's findings), `rulesstatus`. `tools/test_rules.mjs` fails
  on a committed `rule_report` payload.

## 2. The sync

- **Cron** — the `10,40 * * * *` firing. Its `:40` half goes to `rulesPull` while any roster market's
  rules are older than `RULES_STALE_MS` (20 h); once every market is fresh, `:40` goes back to ROAS.
  A failed rules firing backs off `RULES_BACKOFF_MS` (3 h) so an error can never starve ROAS.
- **Budget** — `RULES_PULLS` = 8 markets a firing, each ≤ `RULES_MAX_PAGES` (3) pages of 200 + 2 KV
  writes: `8 × 5 + 5 ≤ 50` (asserted). The roster turns over in about eight `:40` firings.
- **Pages** — FeedHero's page ceiling is 200; a market is read page by page to 600. A market with
  more says so (`capped`, "first N of M rules listed").
- **Sync now** — `GET /api/rules?pull=1`, owner-only, ≤ 6 markets a call; the pages loop it.

## 3. How a rule is read

The report does **not** carry a rule's conditions. So each rule is placed by:

1. **The field it writes** (`target_db`) — stable, machine-named. This decides its **family**:
   titles · descriptions & highlights · product type & category · attributes · identifiers · custom
   labels & bidding · pricing & promotions · stock & availability · exclusions · images & overlays ·
   links & tracking · keywords · shipping · performance & ranking · other (listed, never hidden).
2. **Its channel** — `fb_` / `social_` / `meta_` → Meta, `awin_` / `olapic_` → affiliates, `tik_tok_`
   → TikTok, `gb_` / pickup → Google, a base field (`stock_status`) → every channel.
3. **What its name says** — the team's own words: which data it reads (range completion, stock
   quantity, hero sizes, a scrape, a manual list, dates), whether it is temporary (the NAME only — a
   `*_temp` target is a working column), an A/B test, on a review cadence ("review weekly"), or a
   dated campaign (and the year it names).

### Stock mechanisms (`/stock`)

| Control | Placed when |
|---|---|
| Availability | writes `stock_status` / `availability` / a channel's `*_availability` |
| Stock thresholds | writes `stock_quantity` / `product_stock` / `stock_num` |
| Range completion | writes range completion, RC %, hero size, colour depth, quantity rank |
| Stock labels | a custom label whose field or NAME says stock / quantity / availability / RC |
| Stock exclusions | an exclusion field whose field or NAME says stock / quantity / RC |
| Local inventory | pickup method / SLA, store-coded links, LIA |
| Lifecycle | new-in, older-than, pre-season, clearance (field or name) |

**Cut-offs** are read out of a name only where it states one — "Stock < 11 -> OOS" → *stock < 11*,
"Empty < 0.26 RC" → *RC < 26%*, "…quantity with 3 or less" → *stock ≤ 3* — and always shown beside
the name they came from, never as the rule's logic.

## 3a. The rule inside FeedHero (↗)

Ray, 28 Sep 2026: *"For all rules-related info, can you also add a button to pop out to see the
actual rule inside FeedHero, please?"*

Every rule the two pages show carries a **↗** button that opens it on FeedHero's own site in a new
tab: the market's rule list, chains (each rule, plus the whole chain in run order), findings (each
rule, and each field a chain finding names), the 30-day log, the markets table, the stock setup
tables, the cut-offs table, and a whole-market link on the market header and each stock setup. The
CSVs carry the same link per row.

- **Where it lands** — the report carries no link to the Rule Manager's own editor, and a guessed
  editor URL could send people to a page that does not exist. What FeedHero does publish is its
  report's web view, and the MCP's own `web_url` states the shape exactly:
  `https://mcp.feedhero.net/reports/rule-report?company=<cmpid>&f[rule_name]=<name>&f[target_field]=<field>`
  (every filter "contains", form-encoded). A rule opens as its own row there, narrowed by name AND
  field since a name alone can match a longer sibling; a field alone opens every rule writing it;
  neither opens the market's whole report.
- **Login** — the site is FeedHero-login gated and returns the reader to the exact view after
  sign-in, so the link works for anyone with a FeedHero account.
- **One builder, twice** — `feedheroUrl` in `src/rules.js` and the page twin `fhUrl` are held equal by
  `tools/test_rules.mjs`, and both equal, byte for byte, the two `web_url`s FeedHero's MCP returned on
  28 Sep 2026. A click on the ↗ inside a clickable row opens only the tab, never the row.
- **Straight into the editor** — if FeedHero's Rule Manager has a stable per-rule address (the rule
  id is `rule_id` in the report), send it and the button can go there instead.

## 3b. Ad spend kept off low-stock products (`/stock`)

Ray, 28 Sep 2026: *"Stock management … is going to be a key feature to actually sell to clients …
focus on stock threshold and range completion … pull AdWords data based on impressions, clicks, CPC …
calculate, when I hover over each of these stock features, how much that would save clients in ad
spend … Use a forecast method — 5 %, 10 %, conservative or aggressive — probably based on CPC, per
day or per month … Let that panel appear on the right-hand side when hovered; it should stay there
and display the number dynamically."*

**The model.** A stock rule that holds a product back (sets it out of stock, excludes it, empties
the label a campaign bids on) stops that product buying clicks it could not convert: sizes missing,
a unit or two left. What those clicks would have cost is **the market's own price for traffic**,
read from FeedHero's Google Ads report for the same market over 30 days (the ROAS index, `roasidx`;
one more KV get on the stock route, never a second MCP call):

```
spend per product per day = 30-day spend ÷ products in Google Ads ÷ 30
                          = clicks per product per day × CPC          (the same number, both shown)
kept off                  = products held back × spend per product per day × share × days
```

- **Share.** The share of held-back products assumed to have drawn the market's average traffic had
  they stayed live: **Conservative 5 %**, **Aggressive 10 %** (Ray's two), plus a custom slider from 1
  to 50 %. It is a share and not a multiplier, because a low-stock product would not out-earn an
  average one. The ceiling (100 %) is printed as the ceiling, never as the forecast.
- **Period.** Per day, or per month (30 days, the window the figures are read over).
- **Held back** = the products FeedHero says the rule changed on its last run (`impacted N of M`).
  That count can include products that were already out of stock, which is one more reason the share
  is kept low and the figure is called a forecast.

**Which rules are sized** (`heldBack` in `src/rules.js`): stock thresholds, range completion and the
stock exclusions driven by either. Everything else is listed with its reason and is **never** given a
guessed number:

| Kind | Why it is not sized |
|---|---|
| Lets products back in | an inclusion or exception ("Include Hero size low RC", "[inclusion]") keeps products live, so it is not a saving |
| Writes every product | impacted N of N: it sets each product in or out, and the count is what it wrote, not what it held back |
| Works out a value | RC %, hero-size flags and stock counts; the rule that acts on the value is the one holding products back |
| Restates a state | "Not available to Zero" writes 0 stock onto products already unavailable, which were not advertised either way |
| Another channel | a Meta / affiliate / TikTok rule; Google Ads' price for a click is not that channel's |
| Holding nothing back | a blocking rule that touched nothing on its last run |
| No Google Ads read | FeedHero has no 30-day read for the market yet; it is sized once ROAS syncs it |

**A market counts once.** Two stock rules can hold back the same product (a threshold AND a
range-completion exclusion often do), and the report says how many each changed, not which. So a
market's figure is its **largest** blocking rule, and the book (`svBook`) adds markets, never rules.
It reads "at least". **Money never crosses a currency:** each currency is its own figure.

**The panel.** It docks on the right. Hovering any stock rule opens it: the card's rows, each
market's setup table, the cut-offs table, and the KPI tile (the book). It **stays** until ✕ or Esc,
and hovering another rule redraws it, with the headline counting up. It shows the scenario ladder,
the working line by line, this rule's own formula, and links to the rule in FeedHero and to the
market's ROAS page. It follows **real pointer movement only**: opening it pushes the page (≥1100px),
and a push or a scroll slides a different row under a cursor that has not moved, which would
otherwise re-target it. On a phone, a tap opens it as a bottom sheet. The scenario and period are
kept on the device (`fcc-stock-sv`).

**Harness.** `tools/test_rules.mjs` covers the classifier on the real rule-name shapes (with
invented counts), the arithmetic, the floor, the per-currency book, `stockView`, the page twins
(`svCalc` / `svFloor` / `svBook`, lifted by name and run on the same table as the engine), the
worker wiring and the panel's behaviour rules. No client figure is committed: the real Monsoon read
the model was checked against stays in KV.

## 4. Findings

Every finding names the market and the rules.

**Rules (`/rules`)** — *Act now*: writing a column the feed does not have; a review the rule's own
name asks for, overdue by twice its cadence. *Review*: a campaign rule touching nothing; a past
year's campaign still labelling products; a "temporary" rule older than 30 days. *Worth knowing*: A/B
tests unchanged for 90 days; 3+ rules not impacting any items; the same name twice on one field; a
field written by 6+ rules (the last to run wins).

**Stock (`/stock`)** — the same broken / overdue-review / idle / temporary checks on stock rules;
thresholds, range and exclusion rules unchanged for a year; a **gap** — a control at least two and at
least half of a brand's read markets run that this market does not (local inventory: confirm stores
first); a **cut-off** set to different values across a brand's markets.

## 5. Routes

| Route | What |
|---|---|
| `GET /api/rules` | The book off ONE KV get: `markets[]` (summary per market), `estate`, `brands`, `findings`, `families`, `unread`, `rosterBrands`, `status`. `?brand=` narrows. Scoped per signin. |
| `GET /api/rules?client=&market=` | One market's full rule list in run order + its `chains` + `findings` + `stockFindings`. |
| `GET /api/rules/stock` | `matrix`, `cutoffs`, `findings`, `sv` (scenarios + window), `markets[]` via `stockView`: `stock` rows each carrying `hb` (what the rule holds back), the plain-words `sentence`, and `ads` (the market's price for traffic off `roasidx`, null when unread). |
| `GET /api/rules?pull=1` | Owner-only sync-now (≤ 6 markets a call). |

## 6. Harness

- `tools/test_rules.mjs` — the classifier on real rule-name shapes (counts and dates invented), the
  findings, `rulesStore` + `rulesPull` lifted from `worker.js` and run against a stub MCP
  (pagination, the cmpid guard, rotation, no_token / unauthorized / unreachable), the wiring, both
  pages, and that no `rule_report` payload is committed. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/rules_stub.js` — a synthetic rule list pushed through the real engine for `check_mobile.js` /
  `check_darkmode.js`, which also inline `/design/fcc.css` for pages that link it.
