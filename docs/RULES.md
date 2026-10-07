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
| Range completion | writes range completion, RC %, colour depth, quantity rank |
| **Hero sizes** | writes a `hero_size` field, or the name says "hero size" — split from range completion (§3c) |
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
a unit or two left. What those clicks would have cost is **the market's own price for traffic** —
CPC, 30-day spend and clicks read from FeedHero's Google Ads report (the ROAS index, `roasidx`; one
more KV get on the stock route, never a second MCP call), divided by the market's **real catalogue
size, read off the live output feed itself**:

```
spend per product per day = 30-day spend ÷ products in the LIVE OUTPUT FEED ÷ 30
                          = clicks per product per day × CPC          (the same number, both shown)
kept off                  = products held back × spend per product per day × share × days
```

**THE SKU DENOMINATOR IS THE OUTPUT FEED, NEVER FEEDHERO'S ADS-TRAFFIC FIGURE** (Ray, 28 Sep 2026,
on Reiss GB's forecast panel: *"spend per product per day should be base on the volume of output
feeds (the feed URLs rather than the products impacted number in the rule) — Reiss GB Shopping
should have 22,657 SKUs instead of 60,235"*): the original build read `skus` straight off FeedHero's
`roas_dashboard` Total row — but that figure is **Ads traffic**, not the catalogue (§2's "Unlisted
SKUs in Ads traffic" row is the same phenomenon: real spend on SKUs the feed does not currently
hold), and it disagreed with Reiss GB's live feed by more than double. The denominator is now the
**same row count the Product Volume module already keeps per feed** — `voldobidx` (the 4x-daily
xml-scan agent's own read of the feed URL, Shopping feeds only), one more KV get on the stock route,
never a second scan. **It is found by the FeedHero company id, never by the market's label**
(`feedKeys` in `src/rules.js`): the scan indexes key a feed as it is WIRED — `Reiss|gb`,
`Superdry|befr`, `Reiss|gb-fb` — while the roster names the market `GB` / `BE-FR`, and the first cut
of this route looked up `Reiss|GB` and found nothing on any market. Every FeedHero output lives at
`/output_feeds/<cc>/<cmpid>/<hash>/<file>` (the Catalogue's `catCmpid` reads the same), and a Meta feed
sits under its Google market's cmpid, so one id names both; 45 of the 57 roster markets have a wired
Google feed, 16 a Meta one, and the rest say "no feed wired" rather than borrow another market's. `adsBasis(roasEntry, feed)` takes the feed's `{n, t}`
as a second argument and returns `null` — no basis at all — when either read is missing; `stockView`
threads it through as `feedIdx` (the `voldobidx` entry). A rule's own `impacted`/`of` figures were
never the source (they say what a RULE touched, not the feed's real size) and still aren't.

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
| No Google Ads read, or no feed-row read | FeedHero has no 30-day read for the market yet, or its live output feed has not been scanned yet (`voldobidx`); it is sized once both have synced |

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

## 3c. Hero sizes — split from range completion, and the runs table (`/stock`)

Ray, 28 Sep 2026: *"At least add hero sizes in the stock control for each market and runs table as
well, because it's different from range completion … add icons that relate to stock heroes now and
then to make things more interesting."*

Hero sizes used to be folded into `range` ("size-curve completeness, hero sizes and colour depth"),
so a coverage cell or a market's plain-English setup sentence could not tell a rule protecting hero
sizes apart from one measuring range completion. `hero` is now its own entry in `MECHANISMS`, read
the same way every mechanism here is: the **field** first (`is_hero_size` / any `hero_size` field),
then the **name** ("hero size") as a fallback. Because the coverage matrix, the mechanism filter
chips, "How a rule is placed" and `stockSentence` all already iterate `MECHANISMS` generically
rather than naming mechanisms by hand, the split reaches every one of those surfaces for free.
`heldBack` gates on `r.sk === 'hero'` too — a rule that only *writes* the hero-size flag still
resolves `calc` (the blocking happens in the rule that *reads* the flag, exactly like a
range-completion-percentage rule), and the brand-level "gap" and cut-off findings treat `hero` as an
ordinary mechanism.

**The runs table.** "Runs" is FeedHero's own word for a rule's position — every table on these two
pages already prints "#N in run order". `heroRuns(markets)` (same shape and sort as `stockCutoffs`:
client, then market, then run order) flattens every hero-mechanism rule across the roster; served on
`/api/rules/stock` and rendered as its own card on `/stock`, **"Hero sizes — the rules that run, per
market"**, directly under the coverage matrix — one row per rule: the market (named once per run of
rows, §3g), the rule with its run order, channel and batch under it, the impacted count and the last
change. It is never mixed into Cut-offs (which lists a
*cut-off value* a name states, on any mechanism) or the full per-market rule list. A KPI tile
("Markets with hero sizes") gives the per-market coverage headline without opening the table.

**The icon.** A small crown (`heroIcon()` — one inline SVG in the nav's own stroke language) shows
**only** next to the Hero sizes mechanism itself, never on every row: a shared `mechTag(sk)` helper
decorates the mechanism tag identically wherever it renders (Cut-offs, the ad-spend sized table,
each market's rule list), plus the coverage-matrix column header, the mechanism filter chip and the
"How a rule is placed" row. The badge keeps its plain colour — orange already means temporary / A/B
/ campaign on this page — so the icon alone is the accent, read as identification rather than
another flag.

## 3d. In stock — master feed → output feeds (`/stock`)

Ray, 30 Sep 2026: *"In the stock management module, bring in the availability ratio between master
feed and output feeds as well. (instock & outofstock)"*. The rules say what a market's stock setup
IS; this is what it DOES — the client sends a catalogue that is, say, half in stock, and the feed
Google receives is all in stock. Three counts per market, each a count of products by the stock it
states, kept whole and never joined or inferred (two counts cannot say WHICH products moved, so the
page never calls a product "excluded" on their strength — the join that can is §3i):

| Side | Counted by | Stored |
|---|---|---|
| **Master feed** — FeedHero's latest import, as the client sent it | `tools/master_stock.mjs` (`.github/workflows/master-stock.yml`, 07:40 / 13:40 / 19:40 UTC) with `docs/catalog_engine.js › stockTally` | KV `masteravail` (cmpid → counts) |
| **Google Shopping** output feed | the 4x-daily xml-scan stream (and every live rescan), `labelguard.js › xmlCollector` → `vol.av` | KV `feedavail` (`client\|mkt` → counts) |
| **Meta** output feed (`-fb`) | the same stream | the same index |

**Five buckets, one word table.** `in` (in stock) · `pre` (pre-order, backorder, "available for
order" — sellable, not on the shelf) · `out` (out of stock, sold out, discontinued, not available) ·
`none` (nothing stated) · `other` (a word nobody recognises — counted, never guessed into a bucket).
The master's counter and the feed's counter each carry an `availBucket`, and `tools/test_rules.mjs`
runs one word table through both, so a master and its feed can never bucket a word apart
(`IN_STOCK`, `in_stock`, `https://schema.org/InStock` are all `in`). **A master row's stock** is its
availability word first and its quantity only where it states no word (Superdry's `NOT_AVAILABLE`
with stock on hand is out); neither is `none`. Only a *word* is ever recorded as unread — a malformed
row that spills description text into the column (Schuh's master has 16) is counted as `other` and
the text is dropped. A tally whose buckets do not add up to its product count is refused by the
worker (`sanitizeAvail`).

**The master read.** The agent asks the worker for each ROSTER company's master (`{masterfile:
cmpid}` on `/api/gmail/push`, the xml-scan key and bypass). The worker resolves it with the
Catalogue's `catMasterInfo` and streams the file back untouched — FeedHero's backup URL never leaves
the server — or answers `unchanged` when the stored reading is already of this import, which makes
the later firings one small request per market. The agent unzips it, decodes it (UTF-8, falling back
to Windows-1252 for Schuh), sniffs XML / TSV / CSV and parses it with the Catalogue's own readers;
only counts go back (`{masterstock}`), nothing of a row. Checked on the live masters on 30 Sep 2026:
Superdry GB, Monsoon UK, Schuh UK and Reiss GB all parsed to exactly FeedHero's own row count.

**The card** (first under the KPIs): one row per market — master · Google Shopping · Meta — each a
bar in stock / pre-order / out / not stated with the in-stock and out-of-stock shares, the product
count under it and the exact counts in the hover. An unread side says why — *not counted yet*,
*no feed wired*, *no Meta feed*, *not scanned yet* — never an empty bar. **A book figure pairs like
with like** (`availBook`, the page twin `avBook` held equal to it): a market counts only where its
master AND that channel's feed are both counted, so the summary tile per channel never compares one
set of markets' masters with another set's feeds. The KPI band leads with what Google receives
("In stock in the Google feed", the master beside it). ⬇ CSV on the card exports the counts.

## 3e. Hero sizes by product type (`/stock`)

Ray, 30 Sep 2026: *"bring in hero size mapping per brand as well and later allow cross industry
"guildlines" - (this is a document per brand or they can follow examples) - sit within stock
management - breakdown by their product type"*.

**Why the FCC holds the map.** FeedHero's rules decide which sizes are hero — "Set Hero size values"
on ten Superdry markets, "Set hero sizes" on Accessorize, "Include Hero size low RC" on Monsoon — but
the rule report never carries a rule's conditions and no output feed exports the flag (checked on the
Google, generic CSV and Wunderkind outputs). So each brand's list lives here, per product type,
where a person can see and change it.

**The size census.** The master-stock agent (§3d) reads every roster master once a day; on the SAME
pass as its availability count it now builds a SIZE CENSUS with `docs/herosize_engine.js › census`
(reading rows with the Catalogue's own column plan and stock reading): per product type, every size
the type is made in with its rows, in stock and out, and each style's size run as a PATTERN — one
character per size: `0` not made in it · `1` out of stock · `2` in stock · `3` stock not stated (a size
a style carries in two colours is in stock when either is). Posted per market as `{mastersize}` into
KV `mastersize:<cmpid>`; the tally that follows carries `szv` only when its census was stored, and the
worker answers `unchanged` only when both the counts and the census are of this import and this
census shape (`CENSUS_V`, held equal in the engine and `src/herosizes.js`). Caps, each counted rather
than dropped: 600 product types per market at their finest level (past it the smallest fold into their
parent — §3h), 30 sizes per type, 400 run patterns per type (`patx` counts the styles in rarer ones).

**Product types and sizes.** Where the market's Google Shopping feed is read, the types are the FEED's
own product_type tree and the master's words below only place the rows the feed never sends (§3h);
without a feed they are the types. A master type is the brand's own path to two levels (a generic "Clothing"
middle level stepped over), prefixed with the department from the gender / age columns only when
the path names none — Superdry's bare "T-Shirts" + `mens` → "Men > T-Shirts", Reiss's "Womenswear >
Dresses" as it is. A category id, a bare department word ("Womens") or a merchandising bucket ("View
All", "Campaign 3", and their translations — "Alles Anzeigen", "Kampagne 3", "Voir tout" …) is not a
type; the next product-type column is read. **Every roster language**: Superdry DE's gender column
says "Damen" / "Herren", FR "Femme" / "Homme", FI "Naiset" / "Miehet" — the department words are read
in each, and the prefix keeps the brand's own word ("Damen > Jacken"; GB's English "mens" still reads
"Men"); a gender word nobody placed still SEPARATES the types, and a child's age group wins over the
gender word (a girls' dress is not a women's dress). Census shape 2 (`CENSUS_V`) — the first census
of 30 Sep 2026 merged men's and women's types in every non-English market. A size is keyed lightly so
two spellings of one size meet: a conversion in brackets goes ("UK 7 (EU 40½)" → "UK 7"), so does a
fit / leg letter ("14R" → "14"), a waist/leg pair ("30/32" → "30"), a leading zero, a written-out alpha
("Medium" → "M", "2XL" → "XXL"), one-size words in six languages, ages to "n YRS" / "n MTHS". A run of
half sizes is FOOTWEAR even when the type's words never say so (Schuh's categories); a type with no
gender and a run of ages is KIDS (Monsoon).

**Where a type's hero sizes come from, strongest first** (`heroFor`):
1. the brand's OWN entry — ticked by hand on the card, or imported from the brand's document (a
   sheet of product types and hero sizes; ⬇ Sheet exports the current map as the template);
   — then the brand's own DOCUMENT as written, category × gender, read by words (§3j) — then a list the
   brand set for a coarser tier (§3h);
2. the BRAND it follows (another roster brand's own entry for the same type, then its document);
3. the EXAMPLE it follows — FeedSpark's cross-industry starting points (Fashion · UK & IE sizing,
   Fashion · EU sizing, Footwear, Core of each run) or one the team saved from a brand's guide.
   An example row fits by department, by footwear (a shoe type NEVER takes a clothing row, a clothing
   type never a footwear one) and by words (denim, toddler / junior / youth); only the sizes the type
   is actually made in count. Examples are labelled on every surface as starting points to adapt,
   not a published standard.

A type nothing reaches reads **not mapped** — never a guessed list. A person can also record that a
type has **no hero sizes** (a decision, counted as mapped).

**The measure** (`measure`), per type and summed for the market: **hero sizes in stock** = the
hero-size variants' rows in stock of rows; **styles with every hero size in stock** = styles carrying
at least one hero size whose every hero size they carry is in stock (a style never made in a hero
size is a range decision, not a stock gap, and is not counted against it; stock not stated is its
own state, never read as out).

**The store.** KV `heroguide`, ONE shared map in the kvmerge envelope with a key per decision so two
people editing different types never collide: `g:<Brand>` (the document link, the example or brand
it follows), `m:<Brand>|<type>` (one type's list, its source, who and when — stamped by the worker),
`x:<id>` (an example saved from a brand's guide; FeedSpark's own `fs-*` are read-only, saving one
needs the `stock` grant, and its words must pass a fragment check before any browser compiles them).
Deletions only through `_deleted` (explicit tombstones), so a partial view never deletes. Scoped per
signin: a scoped signin reads and writes its own brands' guides; the examples are shared.

**The card** (after the hero-size runs table): a brand row while the page is on All brands (the
first brand with a census is shown), the guide row (📄 the brand's document — link + ⇪ Import — and
⧉ what it follows), four tiles (types mapped · hero sizes in stock · styles with every hero size in
stock · which master and when), then one row per product type: its run as size chips (hero = orange
with the crown; a thin line under each size = its products in stock; the tooltip gives the counts;
each KIND of size on its own line — alpha, numeric, ages — never wrapped together, Ray 30 Sep 2026),
the two measures, and where the list came from. ✎ Edit makes the chips toggles and adds ✦ core of the
run · ↺ back to the guide · ∅ no hero sizes; an edit stays on screen until the server confirms it.

## 3f. Held-back products — the list behind the count (`/stock`)

Ray, 30 Sep 2026: *"download list of Range Completion > held back product IDs and Titles and Sizes and
availablity (basically they should be products that are in stock in masterfeed but not appear in
output feeds due to range completion held back rule)"*.

The forecast (§3b) sizes a hold from FeedHero's impacted count; **⬇ List** under a market's held-back
number (once per market) and in the forecast panel NAMES the products. On a click the page reads the
market's Google feed (`/api/feed/proxy`) and its master (`/api/catalog/master/file` — the Catalogue's
own path: the file is streamed through the worker, FeedHero's URL never reaches the browser), joins
them by product id in the engine (`docs/catalog_engine.js › feedIndex` + `heldBack`: the master column
carrying the feed's `fs_data_original_id` or `g:id`, found on the first 4,000 rows as the Catalogue
finds it) and downloads a CSV of every product **the master states in stock that the feed does not
carry live** — absent, or sent out of stock (pre-order counts as live). Each row: product id, title,
size, the master's own availability word and quantity, the style (item group), the style's sizes in
stock of sizes made and its **range completion %** — the column that tells a range-completion hold
from any other exclusion, since the report never says which rule held a product. Lowest range
completion first. Nothing is stored; a master whose columns carry none of the feed's ids is refused,
never joined on a guess. Checked on the live Superdry GB feeds in-session (nothing committed): 3,754
held back against the "Range Completion by Availability" rule's own 3,735, 3,734 of them from a style
under 75% range completion.

## 3g. Laid out for a client screen (`/stock`)

Ray, 30 Sep 2026: *"Please ensure the presentation of the data is not too cluttered and is evenly
spaced, so it is not troublesome to use with clients live."* Nothing here changes a figure; every
change is to where it sits, and each was measured on the rendered page, not eyeballed.

- **The KPI band is six tiles, not nine.** The shared `.kpis` grid (auto-fit, 170px) put nine tiles
  7 + 2 at 1440px. Availability rules now ride the Stock rules line ("3 of 3 markets · 9 on
  availability"), idle rules the Act now line, and local inventory is the coverage matrix's own
  column. The six sit on a count that divides them — 6 across, 3 × 2 under 1180px, beside the docked
  forecast panel and on a phone — and every label has the same two-line slot, so each number, label
  and line under it sit at one height. A tile that summarises a card jumps to it. *(Removed 6 Oct 2026 —
  every figure it carried was already on a card below it; §3m.)*
- **Every row of summary tiles fills its card** (in stock, ad spend, hero sizes) as equal tiles; on a
  phone they pair, and an odd one out spans the row rather than leaving a gap. The in-stock tiles lay
  their in / out lines side by side across the wider tile.
- **One row height.** ⬇ List sits beside the held-back number rather than under it, so a row carrying
  it is no taller than one without.
- **A market is named once** on a table grouped by market (ad spend, the rules not sized, cut-offs,
  hero-size runs): the first row of a run carries the name, the rows continuing it are divided by a
  dashed line (`grp` / `gcls` / `mkCell`). The ad-spend rows are ordered so a market's rules sit
  together — the markets by their largest rule, each currency apart.
- **The coverage matrix gives every stock control one column width** and centres its count.
- **Hero sizes by product type:** one chip width for every short size (48px — a crown and two
  characters in any font), so a size run lines up row under row; heads cut to *Sizes · Hero in stock ·
  Full hero runs · Source*, the full question in each head's tooltip; the Source column names the kind
  (📄 Document · ⧉ Example · ⧉ a brand · ✎ a person), the example's name in its tooltip rather than on
  every row; the example's note moved from a line of prose into the follow select's tooltip; the
  legend and the footnote share one row.
- **A finding is one line until opened** — badge · title · where, the badge column one width so every
  title starts at one x; the reason opens with the rules. The findings and cut-offs cards stand one
  height side by side.
- **A market's setup summary is one line** (count · market · when read); its plain-words sentence and
  the FeedHero link open with its rules. The field code (`stock_status`) moved from under the field
  label into its tooltip, the batch rides under the channel (the Batch column read *all* down every
  row), the last change stays on two lines, and a driver tag that only repeats the rule's own stock
  control ("range completion" on a range-completion rule) is not printed.
- **On a phone the search field has a row of its own** — in the flex row it shrank to its first two
  letters ("Se"); the same fix on `/rules`, which shares the component.

Tripwire: `tools/check_stockeven.js` (Playwright, presync) measures all of it on the synthetic rule
list, and carries a negative control — the shared auto-fit grid forced back onto the band wraps the
six tiles 5 + 1 at 1100px, and the even-row measure must fail on it. Against the page as it was
before this change, 26 of its 38 checks fail. *(Since §3m there is no band: the negative control
forces the in-stock tiles 3 + 1 instead.)*

## 3h. Hero sizes at the tier of PT you pick (`/stock`)

Ray, 30 Sep 2026, circling the PRODUCT TYPE head of the hero-size card: *"can you allow tier 2, tier 3 of
PT to be chosen too ? sometimes no need too much granulartiy"*.

**Why the master alone could not.** A master names its types its own way. Superdry's reads a category
for most rows and a leaf type for the rows whose category is a merchandising bucket, so "Women ›
Jumpers" and "Women › V-Neck Jumper" sat side by side; Monsoon's is one flat word; Reiss's and Schuh's go
to two levels. There was no tier 2 or tier 3 to offer. The tree the FCC calls PT is the Google Shopping
feed's: `g:product_type` slot 1, the path Product Type Guard reads.

**Census shape 3.** Before each master, the agent streams that market's Google Shopping feed (the wired
FeedHero XML — 45 of the 57 roster markets have one) into `treeIndex`: each product's path by `g:id`, by
original id and by item group, paths only. The census then places every master row on that tree:

1. by product id (the column carrying the feed's ids, found on the first 4,000 rows as the Catalogue
   finds it), else by its style;
2. a product the feed never sends — the very styles a hero-size gap hides in — where 80%+ of its master
   type's SENT products sit, and no deeper than they agree (`commonPath`, never on fewer than five).
   Every product-type column of the row is a reading, so Superdry's sub-brand category "Bench" is still
   placed by its type "Puffer Jacket". Since census 4 (§3k): a merchandising bucket is no reading, a tie
   goes to the surer reading, a place sized on another scale is refused, and the master's word refines
   the place only where that reading's sent products agree;
3. else by the master's own word, where the tree has exactly one type of that name in the row's
   department (`wordPlace`), and only where that reading's sent products agree (§3k). A word a
   children's and a women's branch both use goes by the run: ages to the kids' branch, 10 to the
   women's (Monsoon's master names no gender);
4. else under the feed's word for its department, or `Master only`, marked `m` — the master's own word,
   shown on the card as **master type**.

**One spelling per type.** A feed can write one type two ways: Superdry FR sends "Homme > T-Shirts"
AND "Homme > t-shirts", "Sweats A Capuche" AND "Sweats à Capuche". PMAX keys each spelling apart, but to
a hero list (and to the guide's keys, which are case-blind) they are one type. So `treeIndex` reads
spellings that differ only in case or accents as one, under the spelling most of its products carry
(`fold` counts the paths re-spelled; the card's note says how many). Without it, the sent products of
one master type split across two spellings, the 80% agreement failed, and 15% of Superdry FR's master
could only be placed at the root; with it, 2.2%. What stays at the root is a genuine split the rule
refuses to guess: Superdry DE's feed names hoodies two ways at tier 2 ("Hoodies Und Sweatshirts" and
"Hoodies", 74/26), and Reiss's master calls its children's range unisex while the feed splits it Girls /
Unisex (62/38). Those rows read **no finer type**.

Types are kept at their finest level (up to 600 per market; past that the smallest fold into their
parent, so every coarser tier stays complete). A market with no Google feed, or a feed the agent could
not read, keeps the master's own types and says so (`src: 'master'`). An unchanged import is read again
once a day all the same (`CENSUS_FRESH_MS`), because the feed's tree moves on its own.

Measured 30 Sep 2026 in session (nothing committed):

| Market | Placed on the tree | Tiers (types at each) |
|---|---|---|
| Superdry GB | 100% — 67% by id or style, 33% by master type | 4 · 14 · 95 · 326 |
| Reiss GB | 99.8% | 5 · 41 · 118 · 368 · 575 |
| Schuh GB | 99.8% | 7 · 41 · 377 · 557 |
| Superdry DE | 99.9% | 37 · 138 · 525 |
| Monsoon GB | 96.5% — the rest are master words the feed has no type for ("Bridal Dresses", "Utility Jackets") | 3 · 86 · 110 · 187 |
| Superdry FR | 99.9% (97.8% below the root once one type's two spellings are read as one) | 38 · 133 · 503 |

**The tiers.** `tiers(cen)` offers a tier when at least 1% of the products reach it, numbered as the tree
numbers them. `tierTypes` rolls the finest types up: counts added, the runs laid on one ladder, each
style's pattern re-read onto it, so a rolled-up type measures exactly as its types added up. The card
opens on the finest tier at which 90% of the sized products sit in at most 40 types (`defaultTier` —
tier 3 for Superdry GB, Reiss and Monsoon; tier 2 for Schuh and Superdry DE). A pick is remembered per
brand on the device (`fcc-stock-hmtier`): a screen preference, never shared state.

**A list set at a tier.** It is written as that tier's key (`m:<Brand>|<path at that tier>`) and read by
every finer type under it that sets none of its own, shown as **⤴ Tier N** with where it came from in the
tooltip. It reaches a finer type only when it names a size that type is made in, so a women's-clothing
list of S–L and 10–14 never becomes the jeans' list, or when it records that the whole branch has no hero
sizes. The resolution is now: the type's own entry → the nearest coarser tier the brand set → the brand
it follows (the same two steps) → the example it follows → not mapped. An entry keyed on a path of this
tree is placed EXACTLY, never leaf-matched onto another branch's type of the same name; any other entry
(a document's rows, a list saved before the tree) still meets its type by its leaf.

**The figures.** A row's hero stock is its finest types added up, each measured on the list that reaches
IT. A coarse row, the tiles and every other tier therefore agree, and the hero-stock headline does not
move with the tier. On the card:

- a row whose types below it set their own list says how many ("2 types under it set their own");
- a name several rows share leads with its department ("Women › Clothing", "Men › Clothing");
- a master-only type is badged **master type**;
- a type filed shallower than the tier, beside finer types of its branch, says **no finer type**.

The ⇪ Import matches a document's rows against every tier's types, and ⬇ Sheet exports the tier on
screen.

## 3i. Held back from Google, the range-completion line, and the ad spend — one card (`/stock`)

Ray, 1 Oct 2026, over the in-stock card: *"add in how many instock I have been excluded from Masterfeed to
Google Shopping as well, and indicate what the current range completion percentage is that I have created.
Then merge the Adspend kept off section into this interface as wel - makes sense that it should be there"*.

**The count.** §3d keeps the three readings whole because two counts cannot say WHICH products moved. A
join can, and the master-stock agent already reads both halves: since §3h it streams each market's Google
Shopping feed for its product_type tree. On that SAME read it now builds the Catalogue's feed index
(`docs/catalog_engine.js › feedIndex` — every product by `g:id` and `fs_data_original_id` with its
availability), and on the SAME master pass it runs `heldBack` — the join §3f's ⬇ List runs in the
browser. Each market's tally carries `hb`: how many products the master states **in stock** that the Google
feed does not carry live (not in the feed, or sent out of stock), against how many the master holds in
stock, joined product by product. Counts only — no id, title or size leaves the agent
(`tools/master_stock.mjs › heldRecord`).

**The range-completion line — read off the products.** The rule report never carries a rule's conditions,
and the rules that hold products back on range completion rarely state their cut-off in their name
(Superdry's is "Range Completion by Availability"; Reiss's "Range completion level"). So `heldBack` also
counts every in-stock product by its style's range completion (sizes in stock of sizes made, in the
master), held and live apart (`rcH`), and `src/rules.js › rcLine` finds the cut that puts the most products
on their own side. A line is claimed only when it explains at least 90% of the held AND 90% of the live
(`RC_LINE_SHARE`, with at least 20 of each — `RC_LINE_MIN`); the figure stated is the roundest one in the
gap between the highest held level and the lowest live one (`roundIn` — a person sets 36%, not 35.8%), and
the gap itself is in the tooltip, because no style sits inside it and the products cannot tell its values
apart. Measured on the live masters and feeds on 1 Oct 2026, in session, nothing committed:

| Market | In stock, not live in Google | The line |
|---|---|---|
| Superdry GB | 3,863 of 29,780 (13.0%) | ≈ 36% — styles at 35.3% or under held, 36.4% or over live (3,836 of the 3,863 under it; 25,887 of 25,917 live above it) |
| Superdry DE | 1,595 of 29,818 (5.3%) | ≈ 21% — 20% or under held, 22.2% or over live |
| Monsoon UK | 2,998 of 16,271 (18.4%) | none — the held spread across every level |
| Reiss GB | 2,162 of 24,409 (8.9%) | none |
| Schuh UK | 181 of 22,594 (0.8%) | none |
| Accessorize UK | 483 of 5,481 (8.8%) | none (accessories — 189 held carry no style) |

Where the data draws no line, a market whose stock rules STATE a range-completion cut-off in their name
(`rcStated` — e.g. "Empty < 0.26 RC Products" → RC < 26%) shows that, labelled *in a rule name*; otherwise
*no line in the data*, with the reason in the tooltip: the held-back products are spread across every
level, so they are held for something else and no figure is put on what no rule does. (§3f's first live
check called Superdry GB's held products "under 75% range completion" — true, but loose: the line the data
draws is ≈ 36%, and the ⬇ List's message now reads the line instead of an assumed 75%.)

**Stored and re-read.** The worker checks the record whole (`RULES.sanitizeHeld` — parts that add up,
the join one of the two, a histogram whose held add up to the count) and stores it on the market's
`masteravail` entry with `hbv` = `RULES.HELD_V`. The agent sets `hbv` only once the count is settled —
counted, or no Google feed wired to count against; a feed it could not read leaves it unset — and the
worker answers `unchanged` only when the count is of this shape too, so a missed count is taken on the next
run. `GET /api/rules/stock` serves each market's `av.held` (`RULES.heldView`): `state` — `ok` · `nofeed` ·
`unread` · `nojoin` · `nostock` — the count, its share, the join, the line and the stated cut-offs; never
the histogram.

**One card.** The ad-spend card (§3b) is merged into the in-stock card. A market reads left to right:
**Master feed · Google Shopping · Meta** (each in stock on top, the bar, out of stock beside the product
count), then under *Held back from Google*: **In stock, not live** (the count, its share of the master's
in stock, ⬇ List beside it — §3f), **Range completion** (≈ the line *in the data*, or a rule name's cut-off
*in a rule name*, or why there is none), and **Ad spend kept off** (the market's largest stock rule at the
scenario and period — the same `svFloor` × `svCalc` as §3b; hovering it opens that rule's working). The
scenario and period controls sit in the card's header; the summary tiles are each channel, then held back
from Google, then the ad-spend book (hover for its working); the rule-by-rule table and the rules that are
not sized fold under *Rule by rule*. The forecast panel adds what was **measured** beside the rule's own
count — the forecast stays on the rule's count (it is attributable to a stock rule; the measured count is
every in-stock product Google is not sent, for any reason). ⬇ CSV is one row per market: every feed's
counts, the held back, the line, the stated cut-offs and the ad spend at the scenario on screen. The KPI
"In stock in the Google feed" names the held back beside its master.

## 3j. A brand's own hero-size document, as written — Superdry's table (`/stock`)

Ray, 5 Oct 2026, sending Superdry's hero sizes as a table (Category · Gender · Hero Sizes · FeedSpark's
note): *"can you follow this to implement hero sizes mapping in FCC for Superdry ?"*

**Why it is not a list of product types.** A brand writes its hero sizes by garment CATEGORY and who it
is for — "Jeans|Trousers · Male · M,L,30,32" — not by the feed's product types, and the feed's tree is
not the same in every market (Superdry DE's is German: "Herren > Hosen", "Damen > Kleider"). Fixing the
table onto one market's types at import would lose it everywhere else, and lose it again whenever the
tree moves. So the table is kept **as written** — KV `heroguide` key `d:<Brand>`
`{name, mk, rows: [{c, g, s, n}], by, at}` — and each row is read against whatever market and tier the
card is on (`docs/herosize_engine.js › docRules / docRowFor / fromDoc`):

- **Words.** A row's category, each alternative split on `|` `/` `;` or a comma, meets a product type
  when its words are a run of the type's own words at one level of its path. No case, no accents;
  `&` = "and"; a one-letter prefix joins ("T-Shirts" = "Tshirts"); singular and plural are one word
  ("Sport bras" meets "Sports Bra", "hoodies" meets "Hoodies and Sweatshirts", "Trousers" meets
  "Trouser") **except** where the singular is another word — *shorts* is not "Short Sleeve Polo
  Shirt", *jeans* is not "Jean Jacket".
- **Which row wins.** A row naming a level OUTRIGHT (every word of it but an "and") beats one whose word
  only sits inside a level's name — the brand's categories are the feed's category levels, and a deeper
  level is usually a product's own name: *Men > Swimwear > Swim Shorts* is Swimwear, not Shorts; *Women
  > Clothing > Dresses > Shirt Dress* is Dresses, not Shirts. Among outright names the deeper wins (Jeans
  over a catch-all "Clothing" row), then the document's order.
- **Department.** Male / Female / Men / Women / Kids / Unisex, read as the gender column is; a row naming
  none meets every department. A footwear row (trainers, boots …) meets footwear types only, and the
  other way round — the rule the examples follow (§3e).
- **Sizes.** Only those the type is made in count; a two-size label carries both ("10-12" and "6-8" are
  hero when 8 or 10 is; "S/M" when S is); a bare "8" meets "UK 8".
  - When **none** of a row's sizes is made in the type, the row still speaks for it — **📄 Doesn't fit**,
    nothing measured, not counted as mapped — and nothing else (no example) is put in its place.
  - When the kinds of size it names reach **under half** the type's run, it reaches **📄 Part · n%** (S,
    M, L against women's T-shirts sold 6–20 with a handful in L).
  - A row with no sizes is an **open question**.
- **Markets.** A document is written in ONE size system and applies only on the markets it names (`mk`).
  Superdry's is UK-sized. **Checked on the live masters, 5 Oct 2026, in session (nothing committed):**
  - **GB and IE** sell women's 6–20 the UK way, so the document is written for them.
  - **US** sells 2–16, where US 8 = UK 12, so "8, 10, 12, 14" would mark the wrong garments as hero.
  - **DE** sells 34–48.
  - A market is added or dropped on the card (a chip per roster market); a new document is written for the
    market it was imported on.

**Its place in the resolution** (`heroFor` → `answer`): the type's own list (set by hand, or a per-type
import) → **the document's row** → a list set for a coarser tier → the brand it follows (the same
steps, its document included where it covers the market) → the example. A coarser list that fits wins
over a row that doesn't, and the row under it says the document disagreed.

**Superdry's table is seeded** (`src/herosizes.js › DOC_SEEDS`). It holds the 19 rows exactly as Ray sent
them, and FeedSpark's note to the client on men's jackets ("also comes in numeric size, do you have heros
?"). It is written for GB and IE.
- **Written once.** `applySeeds` writes it into the store on the first read after it ships, stamped "from
  Ray's table".
- **Never written again** once its key has existed. If the team edits, replaces or deletes the document,
  even the tombstone of a delete keeps it from coming back.
- **Why it lives in the repo.** A hero-size table is sizes and category words, not a figure.

**On Superdry GB's live census** (tier 3, census v4 — §3k — measured in session, nothing committed):
- **Mapped.** 28 of 64 sized product types mapped, all from the document. Hero sizes in stock 67% (9,429
  of 14,081 variants).
- **Doesn't fit (8 types, and the sports bras inside Tops).** Women's swimwear (five types), briefs, the
  feed's separate "Hoodies" level and the alpha-sized mini skirt. The master sizes them in a run the
  document names no hero for: the table says S, M, L where GB sells 6–20.
- **Part (3 types).** Women's T-shirts (0.6%), hoodies and sweatshirts (4.3%) and shirts (11.2%) reach
  only their few S/M/L products. With the 8 above, the 11 the "Document doesn't fit" filter lists.
- **No product type in GB.** *trainers · Male* (GB sells no men's trainers today).
- **Not in the table.** Jumpers, tops, fleece, playsuits and accessories read **not mapped**, not guessed.

**The card.**
- **The guide row** names the document, its rows and the markets it is written for.
- **⊞ Rows** opens it row by row against this market. Each row shows:
  - the category and gender as written;
  - its sizes;
  - what it reaches here: types, products, hero stock; how many only in part and in what other sizes; where
    it doesn't fit and what the types are made in; where a person's own list won; "no product type here";
  - FeedSpark's note.
- **Each type** carries its tag — 📄 Document / Part / Doesn't fit / Open question — with the row named in
  the tooltip, and the note under it.
- **The "Document doesn't fit" filter** lists every type the document can't measure.
- **⇪ Import** reads a sheet in this layout (any sheet with a Gender — or a Department beside a Category —
  column) as the brand's document. It previews how many rows reach a type in this market, and replaces
  the document whole.
- **⬇ Sheet** leads with a Document tab in the same layout, with each row's fit here. ⇪ Import reads a workbook's first sheet, so the file that comes back replaces the document.

## 3k. The catalogue check — a type is made in the sizes the brand makes it in (census v4)

Ray, 5 Oct 2026, on the hero card's **Sizes made in**: *"double check [Sizes made in] are actually
presentation of Superdry catalogue"*.

**How it was checked** (in session, nothing committed).
- Every master row was joined to its market's Google feed by its own id (the feed's `fs_data_original_id`).
  That gives the exact place of every product the feed sends.
- The census was rebuilt on six live markets — Superdry GB and DE, Reiss GB, Monsoon UK, Accessorize UK,
  Schuh UK — and each type's run was read against the rows behind it.
- **Most extra sizes are real.** The GB feed sends only in-stock variants, so a type's XXS, XS, XXXL, 18 and
  20 are usually the out-of-stock sizes of the same styles. They are part of the catalogue, and exactly
  where a hero-size gap hides. So are Superdry's L/XL/XXL women's T-shirts (its oversized tees) and its
  36–40 women's trousers (parachute pants).

**What was wrong, and the rule that holds now** (`docs/herosize_engine.js › census`, CENSUS_V 4 — the
master-stock agent re-reads every market's census on its next run, whether or not the import moved):
1. **A merchandising bucket placed products.** Superdry's `category_id` is a "/" path ("outlet/mens/view
   all", "womens/campaign 3"), and the census took it as a reading. Men's trunks the feed never sends learned
   the jeans that bucket mostly holds. **Rule:** a reading made only of departments and merchandising
   buckets is no product type, however many levels it has (`usableType` › `bareLevel`). One that names a
   product on the way ("Mens > Shirts > New In") still names it. Of the roster's masters, only Superdry's
   carry such readings.
2. **A product learned a place sized on another scale.**
   - Superdry GB's skis and snowboards (149–184 cm; the feed sends none) learned "Men > Clothing" from the ski
     jackets their category sends — a ski length in a run of S–XXL and 28–40.
   - Monsoon's adult trainers and flip-flops (EU 37–41) learned the children's shoes (1–13). Monsoon names no
     gender, and its "Trainers" type's sent products are children's.
   - A women's hoodie type learned the men's hoodies.

   **Rule:** a LEARNED place is refused when the run shares no scale with what the feed sends there
   (`sizedLike`). Sizes are read as spans (`szSpan`): the letter ladder, numbers (a dual's two halves, any
   system) and ages in months. So a trainer's 6 still meets a slider's 6-7. The next reading's place is tried,
   then the master's own word, then its own type. A place the master's own WORD names is not tested — a "Ski
   and Snowboard" level is the brand's word for what it holds.
3. **A word may refine a place only where its reading agrees** (`fits`). Under a learned place, the master's
   own word may name a finer level of the feed's tree. It is used only where 80%+ of that reading's sent
   products sit on that level's line (at it, under it, or filed short of it):
   - Reiss's "Menswear > Suit Trousers" are refined to "… > Trousers > Suit Trousers". The feed files some of
     them one level short.
   - Superdry's master type "Mini dress" stays at "Dresses". The feed files its sent mini dresses by occasion
     (Day, Summer, Cami, Party …), almost none under the feed's own "Mini Dress" level.
   - Two words naming two different places refine nothing. The same test now guards a word placing a type the
     feed never sends: Accessorize's rings, split by the feed between "Jewellery > Rings", "Sterling Silver" and
     "Z Edition", read as the master's own type rather than the largest of the three.
4. **A tie went to the first reading.** Superdry's midi and maxi skirts the feed doesn't send learned "Mini
   Skirt" from their category (Skirts: mostly mini among those sent), though their own type agreed on Midi /
   Maxi at the same depth. Cargo shorts were read as Denim Shorts the same way. **Rule:** at one depth, the
   surer reading wins (`agreed` returns the share).
5. **Collars.** "155" was read as a collar 15½ everywhere — on Superdry's 155 cm skis as on Reiss's shirts.
   **Rule:** it reads as a collar only in a type whose run carries whole collar sizes beside it (14, 15, 16 …;
   `collarRun`, applied per type when the census finishes). Reiss's shirts still run 14.5 · 15 · 15.5 · 16 …;
   a ski stays 155.

**What moved** (rows placed differently, census v3 → v4, on the live masters 5 Oct 2026):
- Superdry GB: 371 of 59,608.
- Reiss GB: 198 — 162 of them the suit trousers refined.
- Superdry DE: 136 — mostly campaign-bucket rows read at the coarser place their own type agrees on.
- Monsoon UK: 73.
- Accessorize UK: 47 — to "Master only".
- Schuh UK: 8.

Superdry's document map on GB moved by one type each way: the skis are their own unmapped type, and a women's
low-top trainer type joined *trainers · Female* (§3j).

## 3l. Stock levers — BAU ↔ SALE (`/stock`)

Ray, 5 Oct 2026: *"summarise a stock management dashboard for Superdry (specifically) eahc of those markets have got
quite aan interesting mix of stock levers : 1 . Range Completion (20-40%, currently at 35%) - 2. Stock unit exclusion
for Everest (previously >5 units per size, now N/A) - 3. Hero Sizes (current activated, follow the mapping above) -
build an facilitor interface to action BAU vs. SALE perido"*.

**What a lever is.** A lever is a stock control a brand moves between business as usual and a sale period. There are
three (`docs/stocklevers_engine.js › LEVERS`):
- **Range completion** — the line a style is held back under (a %, inside the brand's band).
- **Stock unit exclusion** — a minimum of units per size, scoped to a range (Superdry's Everest), or N/A.
- **Hero sizes** — hero-size protection, on or off.

**The FCC changes no FeedHero rule.** The rule report is read-only, so the card is a FACILITATOR. It:
- reads what each market runs today off its own rules;
- holds the brand's BAU and SALE value for each lever, and a market's own where it differs;
- plans the sale periods;
- turns each switch into the exact list of rules to change, in which markets — to brief, to copy and to mark done.

The whole team sees which markets are in which mode.

**What each market runs** (`reading`), on the Google Shopping side only (a Meta or affiliate rule, or a label that only
names a level, is not the lever):
- **Range completion.** Every rule whose name names range completion, plus the range mechanism. The rules engine files
  most of these under *availability* (the field they write), so the name is what finds them. The value read is, in order:
  1. the line MEASURED from the products the Google feed is not sent (§3i);
  2. else a cut-off a rule name states (`Range Completion < 0.21` → 21%);
  3. else a percentage a name states (`Range Completion (BAU & Peak) - 20%`);
  4. else "runs, no stated line" — never a guessed number.
- **Stock unit exclusion.** A threshold / exclusion / availability rule naming the lever's scope ("Everest") with a units
  cut-off in its name. None reads **N/A**.
- **Hero sizes.** A rule that sets them (`is_hero_size`), one that keeps them live (the inclusion rule) or one that pauses
  them:
  - **on** when a rule sets them;
  - **part** when a rule keeps hero sizes live but none sets them;
  - **paused** when a pausing rule is active;
  - **none** otherwise.

**Off plan** (`drift`). A market reads off plan when what it runs differs from the value it is held to in its current
mode:
- **Range completion** — more than 2 points away (a line nobody can state is never called off plan).
- **Units** — any rule running against N/A, or none running against a cut-off.
- **Hero** — anything but on against on.

**Modes and periods.**
- A **sale period** names its dates and markets. Each switch (→ SALE at its start, → BAU at its end) is
  planned → briefed → done; who and when are stamped by the server.
- A market is in **SALE** once its period's switch to SALE is marked done and the switch back is not.
- When the date says otherwise, the row says **due → SALE / BAU**. A period that ended with its switch to SALE
  never made reads **missed**, never "0 days late".
- Each cell names where the target IN FORCE comes from: **own** when the market's own value for the current mode
  applies, **plan** when the brand's does. A market with its own BAU is still held to the brand's SALE value during
  a sale, so it reads plan there (`tgtOwn`, beside `own` — the market has a value of its own for this lever at all).

**The switch list** (`switchList`, `briefLines`).
- Markets making the same change sit on one line ("Range completion 35% → 20% — GB, FR"), each with its own rules and a ↗
  to each rule on FeedHero.
- A lever whose value for the mode is not set is a **blocker**, never assumed.
- **→ Brief** marks the switch briefed, then opens the Workflow composer with the switch as a technical brief. The
  mark is sent and confirmed BEFORE the page leaves: a save already in flight is waited for (every caller of a
  flush is answered only once nothing is left to send, `lvDone`), and a mark the server refuses is said in a
  confirm — open the brief anyway, or stay — never lost behind the navigation.
- **⧉ Copy** gives the same text; **✓ Switched** marks it made.

**A SALE value to consider** (`suggest`) is only what the brand's own rules or plan say, and only applied on a click:
- **Range completion:** the line a market's rule names for a peak ("“Range Completion (BAU & Peak) - 20%” in NL, IT"),
  else the band's floor.
- **Units:** what the lever ran at before.
- **Hero sizes:** nothing — no rule says which way a sale should take them.

**Keep as it runs** (`adopt`) makes what a market runs today its own BAU — the decision that its mix is the plan. Its own
SALE value is kept. "Keep N markets as they run" does it for every off-plan market at once, and ↺ Brand plan drops a
market's own values.

**⧉ Copy summary** (`summaryText`) is the dashboard in words: each lever's plan, then the markets grouped by what they
run, named — then who is off plan and each period's next step.

**Superdry's plan is seeded** (`src/stocklevers.js › LEVER_SEEDS`), exactly as Ray stated it:
- range completion band 20–40%, BAU 35%;
- Everest units BAU N/A (was > 5 units per size);
- hero sizes BAU on.

Every SALE value is left unset. `applyLeverSeeds` writes it once, on the first read after it ships, and never again once
the key has existed (a tombstone counts).

**Superdry, read live 5 Oct 2026 (in session, nothing committed):**
- **Range completion.**
  - GB's line measures ≈36%, on its 35% plan.
  - DE's line measures ≈21% (its rule name says `< 0.2`).
  - Twelve markets' rule names state 21% (`Range Completion < 0.21`); BE-FR and BE-NL state 20%.
  - IT and NL also run `Range Completion (BAU & Peak) - 20%`.
  - NO, PL and SE state no line.

  So against a 35% plan, 15 of 19 markets read off plan on range completion (NO, PL and SE state no line, so they are
  never called off it). That is the mix Ray described, and the card's one-click "keep as it runs" is how a market's own
  line becomes its plan.
- **Units · Everest.** No market runs one (N/A), matching the plan.
- **Hero sizes.**
  - On in ten markets (GB, IE, DE, FR, NL, ES, DK, BE-FR, BE-NL, US).
  - CA-EN and CA-FR keep hero sizes live but no rule sets them.
  - CH-DE, CH-FR, IT, NO, PL, SE and FI run no hero-size rule.

**The store.** KV `stocklevers`: ONE kvmerge map, a key per decision. Deletions only through `_deleted`.
- `p:<Brand>` — the plan.
- `m:<Brand>|<MKT>` — a market's own values.
- `e:<Brand>|<id>` — a sale period.

It is scoped per signin, and writing needs the `stock` module.
- `GET /api/rules/levers` — the in-scope store and the brands with a plan.
- `PUT /api/rules/levers` — a partial map.

The engine is served verbatim at `/stock/levers.js`.

## 3m. Cleaned up — no KPI band, the levers as a matrix, and a record kept by hand (`/stock`)

Ray, 6 Oct 2026, a red cross over the six-tile band at the top of `/stock`: *"clean up stock section alittle bit, i was
thining the lst should be table/ matrix for overview review (something like this blue screenshot)"* — the screenshot was
the coverage matrix (*Which stock controls each market runs*). Then, mid-build: *"maybe there should be a manual table as
well to keep record of it"*.

**The KPI band is gone.** Every figure it carried already stood on a card below it, so the band was the page saying
everything twice:

| The band's tile | Where it still is |
|---|---|
| Ad spend kept off | the in-stock card's book tile (`#av-sum [data-sv="book"]`) — hovering it still opens the working |
| In stock in the Google feed | the in-stock card's Google tile, beside its master |
| Stock rules | the coverage matrix, its Total column |
| Markets with hero sizes | the coverage matrix's hero column and the hero-size runs card |
| Cut-offs stated | the cut-offs card |
| Act now | the findings card |

The page now opens on its first card. A forbidden marker keeps the band out.

**The levers' market list is a matrix**, in the coverage matrix's own shape:
- the market named once, its product count under it;
- a lever per column, all one width, with **the plan in the column head** (`BAU 35% · SALE not set`);
- **one short value per cell** — `≈36%` measured, `21%` from a rule name, `runs` (no stated line), `N/A`, `on`,
  `kept live`, `paused`, `—`;
- **blue** where a rule runs the lever on plan, **orange with a dot** where it is off plan (so it is never colour
  alone), **muted** where no rule runs it;
- an **Off plan** count per market (`✓` when none);
- the detail in the cell's tooltip: what runs, why, the target it is held to and whose (its own or the brand's, BAU or
  SALE), why it is off plan, the rules behind it (in run order), and the latest record.

The matrix sits **above** the plan tiles: overview first, then the plan (now headed *Brand plan*), the sale periods and
the record. A market's own values open in a row **under** it (✎ toggles it), with *Keep as it runs* and *↺ Brand plan*
in that row.

**The record, kept by hand.** The matrix says what the rules read; the record says what a person set in FeedHero, on
which day, where and why. It never moves a reading.
- A row is: the day, the markets, the lever, BAU or SALE, what it was set to (from → to), a note, and who recorded it.
  Newest first; the newest eight, then *Show all*.
- **＋ Add a record**, ✎ to edit, 🗑 to delete (after asking), ⬇ CSV.
- **＋ Record it** on a switch marked made writes that switch's changes into the record in one click, dated that day:
  each change, in the mode switched to, from → to, naming the period (`switchRecords`). The step then reads
  *✓ recorded*, so a second click cannot double it. The records are **frozen when written** — a plan edited later
  never rewrites what was recorded.
- The latest record for a market × lever is in that matrix cell's tooltip; ⧉ Copy summary ends with the newest five.
- Store: KV `stocklevers`, key `r:<Brand>|<id>` → `{d, mk, k, mode, v, was?, note, src?, by, at, ed?}`. The worker
  checks every field (a real day, a lever, a value of that lever's kind, the brand's markets). **Who recorded it is
  the server's word, and it stays with the record through every edit** — an editor is stamped apart as `ed`, so an
  edit can never rewrite who said so.

**One fix found on the way.** The page shell's `.sc` class (the ROAS scorecards it was cloned from) takes
`flex-basis:170px` under 820px. The levers card used `.sc` for its small captions, so on a phone a one-line lever note
stood 170px tall inside its tile. The card's captions are now `.lvc`. A forbidden marker keeps `.sc` off the lever note.

## 3n. One rule per lever — connected in one market, read in every market (`/stock`)

Ray, 6 Oct 2026: *"the same rules (same rule name) will be applied/ copied across all different markets. Each individual
stock lever will be connected to one rule, and that rule could be spotted or aggregated across different markets. For
example, with Superdry UK and range completion, there are currently two overlapping logics rule on the dashboard; there
should be only one that makes sense at any time. Allow a connection between a lever and a rule in a specific market, and
then that same rule can be spotted or monitored across the remaining markets, to ensure monitoring between 30 markets is
accurate."*

**Before a rule is connected**, a lever reads every rule that looks like it (§3l): range completion by its mechanism or
its name, units by the lever's scope on a stock field, hero sizes by mechanism or name. Where **more than one** rule reads
as a lever in a market, the matrix cell is **dashed**, its tooltip counts them, and the plan tile says where they overlap
("not connected — more than one rule reads as it in GB, DE").

**Connecting.** *⛓ Connect a rule* on a plan tile opens the picker:
- a market (the first one read, or the one the rule was last picked in);
- the rules that market runs that read as the lever — **the name the most markets carry first** (that is the rule that
  was copied), then FeedHero's run order — each with its run position, the field it writes, what it touched and **in how
  many markets the same name is found**;
- *Every stock rule in GB* lists the rest too, each marked "does not read as this lever".

*Connect* saves the plan: the lever carries `rule: {n, mk, d}` — the rule's name, the market it was picked in and the
field it writes. Nothing else in the plan moves. *Change* re-opens the picker; *✕* disconnects.

**Once connected, every market reads that one rule** (`docs/stocklevers_engine.js › bound`, `findRule`):
- **Which rule is "that rule" in another market** (Ray, 6 Oct 2026, pointing at Superdry FR's "Range Completion based
  Availability": *"i see this rule in … (FR) market - but system is not picking it up"*). The copies drift in name while
  their job never moves. Read live that day, Superdry's hold rule is "Range Completion by Availability" in GB, ES and
  BE-NL, "Range Completion based Availability" in FR, DE, DK, FI and nine more, "Availability by Range completion" in IE,
  and "Range Completion (BAU & Peak) - 20%" in IT and NL — and every one of them writes Availability. NO and PL even carry
  one name on two rules (one writes Availability, the other RC Availability). So a market's copy is, in order:
  1. the **same name on the same field** (the name compared as FeedHero copies it — case, spacing, typographic quotes and
     dashes set aside, every word kept: `nameKey`; "Range Completion < 0.21" and "Range Completion < 0.2" stay different);
  2. else the rule **doing the same job** — reading as the lever and writing the same field, the closest name first when
     more than one does (`nameSim`: the share of words in common, joining words such as "by" / "based" set aside); a
     rule picked from *every stock rule* finds its copy among rules on the same field with a near name;
  3. else **missing**.

  A lever connected before the field was stored has it read off the market it was picked in (`resolved`), never written
  back. Run on the live names: the hold rule connected in GB is found in all 19 markets (3 by name, 16 under another
  name); the RC-flag rule connected in FR in all 19, each with its own stated cut-off (21% in most, 20% in DE and BE).
- **Found:** the lever reads that rule alone (the tooltip says when the market runs it under another name) — range completion still takes the line measured from the products first,
  then the cut-off the connected rule's own name states; units take the rule's cut-off; hero sizes read *on*, or
  *paused* when the connected rule pauses them. Other rules that would read as the lever are set aside and named in the
  tooltip ("Also reads as range completion here, not connected"). A connected rule that touched no product on its last
  run says so.
- **Missing:** the market does not run a rule of that name. The cell reads **missing** (red) — never another rule's value
  in its place — and its tooltip names what the market runs instead. Against a set plan that is off plan, with the reason
  "The connected rule “…” is not in this market". A units lever missing its rule reads N/A, which is on plan when the plan
  is N/A.
- The **column head** names the rule and *found / total* (red when it is missing anywhere); the **plan tile** names it,
  "in N of M markets", how many run it under another name (the names in its tooltip), and where it is missing. The
  **picker** counts the markets where each rule would be found, and how many of those run it under another name.
- The **switch list** names each market's own copy of the connected rule (its own name), and keeps a market without it on the
  list, flagged: "⚠ The connected rule “…” is not in DE — copy it there first" (the brief says the same).
- **⧉ Copy summary** names each lever's rule, where it is found and where it is missing, or "no rule connected".

Store: the plan key `p:<Brand>`; the worker checks the rule's name (≤160 characters), that the market it was picked in
is one of the brand's, and keeps the field only as a database name (`sanitizeLeverKey`).

## 3o. Four levers for every brand, markets that read the same in one row, and every card folds (`/stock`)

Ray, 7 Oct 2026: *"i thin the system on stock is still not optimised for view yet (especilly multi markets client) -
every client should have these stock levers: 1. range completion 2. hero sizes 3. stock quantity threshold 4. stock
based exclusion"* — then, mid-build, over the in-stock card's header switches: *"in section - these button doesnt apply/
make sense"*; over the coverage matrix: *"this is good actually ! should be pushed to top"*; and *"each module info on
Stock Management is collapsible pls - too many at once"*.

**Four levers, every brand, in Ray's order** (`docs/stocklevers_engine.js › LEVERS`, the worker's `LEVER_KINDS` held
equal by the harness). Each reads the rules of ONE stock mechanism, so a lever and its column in *Which stock controls
each market runs* can never be read off different rules:

| lever | kind | reads | said as |
|---|---|---|---|
| Range completion | % in the brand's band | `range`, or a name saying range completion | the measured line, else a stated cut-off |
| Hero sizes | on / off | `hero`, or a name saying hero | on · kept live · paused |
| Stock quantity threshold | units, or N/A | `threshold`, or an availability rule whose name states a stock cut-off | "< N units" — out of stock below N |
| Stock-based exclusion | units, or N/A | `excl` (an exclusion *by* range completion is range completion's) | "> N units per size" — kept only above N |

- **A brand with no plan still reads all four off its rules.** `planLevers(plan)` returns the four in order whether or
  not a plan was saved; every value nobody set reads *not set*, and the first edit writes the plan. All brands lists
  **every** brand in scope (the worker's `leverBrands`), each with *N of 4 planned* or *no plan yet*.
- **The stored `units` lever is the stock-based exclusion.** Superdry's "Stock unit exclusion for Everest" (5 Oct) was
  saved under the key `units`; the engine reads that key as `excl` everywhere (plan, a market's own values, records) and
  the worker stores any save carrying it under `excl`. Nothing in KV had to be migrated by hand. The seed is
  re-ordered (range completion, hero sizes, the Everest exclusion); the threshold Ray did not state is not seeded — it
  reads off the rules with no plan value.
- **What a threshold is.** A rule on a stock field counts only when it HOLDS stock back (the rules engine's own
  `heldBack` kind, else the same reading of its field and name — `holdKind`). Three shapes are set aside and **named in
  the cell's tooltip**, never silently dropped: a rule that only *works out a figure* other rules act on (Schuh's
  "Calculate stock count details"), one that *restates* a state ("Not available to Zero" — every Superdry market runs
  it, which is why the coverage matrix counts a stock threshold everywhere while the lever reads N/A) and one that *lets
  products back in*. Read live 7 Oct 2026 (in session, nothing committed): Monsoon UK's "Stock < 11 -> OOS" reads
  < 11; Accessorize UK's "Removing products with quantity with 3 or less" is an exclusion at ≤ 3; Superdry runs neither
  (both N/A); Reiss's and Schuh's threshold-field rules are calculations.
- **One setting, said two ways.** A name states the held-back side ("< 11", "≤ 3") or the kept side ("> 5"); the plan
  states the lever's way. Both reduce to the units a product needs to stay live (`mlOf` / `planMl`), so a name's
  "≤ 3" and a plan's "< 4" are one setting and never read as off plan. The cell prints the rule's own words.
- **A range's own rule reads under its scoped lever only.** A units lever scoped to a range (the Everest exclusion) reads
  the rules naming that range on any stock-holding field; the other units lever leaves those rules to it (`sibbed`, in
  the model and the switch list), so one rule never reads as two levers.
- **A lever nobody plans is not part of a switch** — no change, no blocker. *Keep as it runs* writes a market's own BAU
  for what it runs; a lever it does not run that nobody plans stays out (absence is not a decision).

**Markets that read the same share a row** (`lvGroups`, `lvGroupRow`). Superdry's nineteen markets read as eight mixes
(FR, US, ES and DK all "21% · on · N/A · N/A"), so a brand with **8 or more markets opens grouped**: one row per mix —
the number of markets, each a chip that opens ITS own values in a row under the group — biggest mix first, then the
roster's order, markets not read yet last. A market joins a row only when **every cell is drawn the same** (value,
colour, dot, dashed, missing), it is **held to the same targets from the same source** and it is **in the same mode**,
so nothing its own row would say is lost; a market alone reads exactly as before. A group's cell names its markets and
the rule each runs (a copy's name can drift). *By market · Grouped · N mixes* in the matrix toolbar, remembered per
device (`fcc-stock-lvgrp`); hidden when every market reads differently. *Off plan* narrows first, then groups.

**The coverage matrix is first on the page**, and **the in-stock card's header carries no scenario or period switch**:
there they read as controls for the whole card (the availability bars too) and on a brand with nothing sized they
changed nothing. They live in the forecast panel only, where the figure is worked out; the *Ad spend kept off* column
head names the forecast shown ("conservative 5% · a month").

**Every card folds.** Each card's title is one button — a chevron, the title and, folded, a line that survives the fold
(the in-stock card: markets, Google in stock, held back, the spend kept off; the hero map: product types mapped, hero in
stock; findings; cut-offs; …). A folded card is one row (~52px), its tools and subtitle away. On a device that has
never chosen, the overview and the levers are open and the rest folded; what a person folds or opens by hand is kept
per device (`fcc-stock-fold`, never shared state). A link or a jump opens what it points at **for the visit**, without
rewriting that choice: `?mech=` opens the market setups, a `#hash` the card it names (or sits in), a click on a coverage
cell the setups at that market. *⊕ Expand all / ⊖ Collapse all* in the page header names the action still available.
Side by side, a folded card does not stretch to its open neighbour. On the phone the skim view
(`docs/digest_widget.html`) leaves these headings to the page — an `[aria-expanded]` heading is the page's own — so one
fold serves both screens.

Harness: `tools/test_stocklevers.mjs` (162: the four levers, the legacy key, the threshold and exclusion readings on
real rule-name shapes with invented counts, the set-aside kinds, ml, sibbed in the model, adopt, the brands list, the
seed, the page's grouping and fold sources); `tools/check_stocklevers.js` (103 — a nine-market stub, `rules_stub.js
build({ many: true })`, for the grouped view); `tools/check_stockfold.js` (Playwright, presync, 29 — the fold as a
person uses it, desktop and phone; fails on the page before); `tools/test_rules.mjs` (cards in order, every card a fold
button and a folded line).

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
| `GET /api/rules/stock` | `matrix`, `cutoffs`, `heroRuns` (every hero-mechanism rule, in run order — §3c), `findings`, `sv` (scenarios + window), `markets[]` via `stockView` (each with `wk`, its wired Google / Meta market keys, for the held-back download — §3f): `stock` rows each carrying `hb` (what the rule holds back), the plain-words `sentence`, `ads` (the market's price for traffic — spend/clicks/CPC off `roasidx`, the SKU denominator off `voldobidx`'s feed-row read — §3b — null when either is unread), and `av` (master / Google / Meta stock counts off `masteravail` + `feedavail`, with which feeds the market has wired — §3d — and `av.held`, the in-stock products not live in Google with the range-completion line read off the products — §3i). Feeds are found by the cmpid (`feedKeys`), never the roster label. |
| `POST /api/gmail/push {masterfile: cmpid}` | Key-gated (the xml-scan key). A roster company's master, streamed as bytes, or `{unchanged}` when the stored reading is of this import. §3d. |
| `POST /api/gmail/push {masterstock: […]}` | Key-gated. The master agent's counts → `masteravail`, one write per post; a tally that does not add up is refused. `szv` + `sz` mark a stored census (§3e); `hbv` + `hb` the held-back count and its range-completion histogram, checked whole by `RULES.sanitizeHeld` (§3i). |
| `POST /api/gmail/push {mastersize: […]}` | Key-gated. One market's size census → `mastersize:<cmpid>`, validated whole by `HERO.sanitizeCensus` (§3e). |
| `GET /api/rules/hero[?brand=&market=]` | The guide store (every example + the in-scope brands' guides), each brand's guide status, and — for one brand (the first with a census when none is asked) — its roster markets and one market's census. §3e. |
| `PUT /api/rules/hero` | A partial map of `g:` / `m:` / `x:` keys (+ `_deleted`), every key checked (`sanitizeHeroPut`), merged with a read-stamp (`X-Sync-Base`), stamped by / at here. §3e. |
| `GET /stock/engine.js` | `docs/herosize_engine.js`, verbatim. |
| `GET /api/rules/levers` | The stock-lever store in scope (`p:` plan · `m:` a market's own values · `e:` sale periods · `r:` the record kept by hand) + the brands with a plan; Superdry's plan seeded once (`applyLeverSeeds`). §3l, §3m. |
| `PUT /api/rules/levers` | A partial map of `p:` (each lever's BAU / SALE and, §3n, its connected rule) / `m:` / `e:` / `r:` keys (+ `_deleted`), every key checked (`sanitizeLeverPut`), merged with a read-stamp (`X-Sync-Base`), switch steps and records stamped by / at here (a record keeps its first recorder through every edit). Needs the `stock` module. §3l, §3m. |
| `GET /stock/levers.js` | `docs/stocklevers_engine.js`, verbatim. |
| `GET /api/rules?pull=1` | Owner-only sync-now (≤ 6 markets a call). |

## 6. Harness

- `tools/check_stockeven.js` — `/stock` rendered and measured (§3g): no KPI band (§3m — the page opens on a card,
  and every figure the band carried is on one), tile rows that fill their card at 1440 / 1100px and beside the
  forecast panel, a market named once,
  equal matrix columns, one chip width, one-line findings and setup summaries, the phone search row; with
  a negative control. The one in-stock card (§3i): no ad-spend card, its controls in the card's header,
  seven columns fitting the card at 1440px with no header or cell clipped, the three feeds one width,
  every market row one height with or without ⬇ List, every held-back / range-completion state drawn, a
  market's ad spend opening its rule's working, the folded rule-by-rule table, and the table panning in
  its own frame on a phone — five of these fail on the page before. Presync.
- `tools/check_herotier.js` — the hero card driven at the tier of PT picked (§3h): every tier with its
  count, the default tier, a pick listing exactly that tier's types (negative control: two tiers list
  different rows), a shared name led by its department, the pick remembered per brand, a save at tier 2
  writing that tier's key and the tier-3 types under it reading "⤴ Tier 2", the headline not moving with
  the tier, the phone. Fails on the page as it was before. Presync. The brand's own document (§3j): the
  guide row naming it and its markets, ⊞ Rows row by row (part, doesn't fit and what the type is made in,
  no type here, the note), the "Document doesn't fit" filter listing exactly the types it can't measure,
  a market chip saving the document with that market added, the panel panning on a phone.
- `tools/test_rules.mjs` — the classifier on real rule-name shapes (counts and dates invented), the
  findings, `rulesStore` + `rulesPull` lifted from `worker.js` and run against a stub MCP
  (pagination, the cmpid guard, rotation, no_token / unauthorized / unreachable), the wiring, both
  pages, and that no `rule_report` payload is committed. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
  Availability (§3d): the cmpid join on every wired feed (and that no roster label is a scan-index
  key), the engine, one word table through both counters, `stockTally`, the agent's reader on a zipped
  CSV / Windows-1252 TSV / XML built in-process, the collector on a synthetic Google and Meta feed,
  `sanitizeAvail` lifted from the worker, both push lanes, the route, and the page twin `avBook`.
  Held back + the line (§3i): `rcLine` on histograms shaped like the live reads (the line, the gap, the
  90%-of-both-sides rule, no line for a spread, too few, everything on one side), `roundIn`,
  `sanitizeHeld`, every `heldView` state, `heldBook` + its page twin, the agent's join on an in-process
  feed and master (counts only out of the process), the worker's store and its `unchanged` gate, and the
  merged card's markup.
- `tools/test_herosize.mjs` — the hero-size engine (size keys, departments, product types, the census on
  synthetic CSV / XML masters, the measure, core, every example rule, the guide resolution, the document
  import + export), the worker's half (`src/herosizes.js`: the census it stores, the edits a signin may
  make), the held-back join (`feedIndex` + `heldBack`), the agent's census on an in-process zip, the
  route, the page, the stub, and that no census or guide is committed. The brand's own document (§3j): Ray's
  table cell for cell through `parseDoc` (and the seed held equal to it), the word rules (T-Shirts = Tshirts,
  shorts ≠ Short Sleeve, jeans ≠ Jean Jacket, Trouser = Trousers), which row wins (outright before inside a
  name, then deeper, then order), department and footwear, dual sizes, doesn't fit / part / open, the
  markets (GB + IE yes, US no), the precedence against own and coarser lists and a followed brand, the row
  summary, the export, the worker's `d:` key and `applySeeds` (once, never over a tombstone), and the
  Document tab round-tripped through the real sheet reader. Tiers (§3h): `treeIndex` on a
  synthetic feed, every placement rule (id, style, master type, word, the run telling kids from women,
  master only), `commonPath`, the fold past the cap, `tiers` / `defaultTier` / `tierTypes` (a rolled-up
  type measures as its types added up), inheritance (own → coarser tier → followed brand → example, a
  coarser list that names none of a type's sizes skipped, a branch's "no hero sizes", exact-only tree
  keys), the tier-independent headline, and the agent placing its census on a feed. The catalogue check
  (§3k): `szSpan` / `sameScale`, the bucket rule, `agreed`, `collarRun`, and one invented census built to
  hold every distortion found live (trunks in a bucket, skis beside ski jackets, a skirt tie, suit trousers
  filed one level short, a mini dress the feed files by occasion, collar sizes). Each fails on the census
  before it. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/test_stocklevers.mjs` — the stock levers (§3l) on rules pushed through the REAL classifier (`normRules`
  → `stockRow`, the rows `/api/rules/stock` serves; rule names in the live shapes, every count invented): what each
  market runs (the measured line, a name's cut-off, a name's %, a Meta rule and a label left out, Everest's units
  by scope, hero on / part / paused / none), off plan, the target's source, modes and periods (late, missed — in
  the summary too), the switch list and its brief, the suggestions, keep-as-it-runs, the summary; then the worker's
  half (`src/stocklevers.js`: what a signin may store, the stamps, the scope, the seed once and never over a
  tombstone), the route, the page and the stub. And §3m: the record (newest first, the latest per market × lever,
  a switch as frozen records, the summary's foot; the worker's checks and the first recorder kept through an edit),
  the matrix wiring, no KPI band. And §3n: a rule name matched as FeedHero copies it, a connected lever reading one rule
  (found / missing / paused / idle, the others named), the overlap flag when none is connected, the picker's order and
  its markets, where each rule is found, the switch list and brief flagging a market without it, the summary line; the
  worker's check of the rule. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/check_stocklevers.js` — the card driven in Chromium on the stub (served from an http origin so → Brief's
  navigation lands): All brands, the tiles and lever tiles one size, every roster market a row, off plan marked and
  filtered, keep-as-it-runs / a market's own values / ✎ Edit / "Use it" each saving their key, a period planned and
  switched (the markets reading SALE, held to the brand's SALE and saying plan), ⧉ Copy summary, → Brief carrying
  the switch — and marking it briefed first, read from a record kept OUTSIDE the page (the navigation takes the
  page's own with it) — → Brief while another save is in flight, a refused mark said before leaving, the phone.
  Four fail on the page before. Since §3m: the matrix (overview first, the plan in each head, one short value a
  cell in its state, the tooltip, one width per lever, the editor row under its market and ✎ toggling it), the
  record (add / edit / delete each saving their key, the first recorder kept, a switch recorded in one click and
  then saying so, the latest record in the cell's tooltip) and the phone's one-line note — run on main's page the
  matrix checks fail. Since §3n: one rule per lever in its own page — the overlap dashed, the picker (the rules that
  read as the lever, every stock rule, another market), Connect saving the rule on the plan, the overlap gone, a
  GB-only rule reading missing in DE, the switch list's "copy it there first", the summary, ✕ disconnecting. Presync.
- `tools/rules_stub.js` — a synthetic rule list pushed through the real engine for `check_mobile.js` /
  `check_darkmode.js`, which also inline `/design/fcc.css` for pages that link it.
