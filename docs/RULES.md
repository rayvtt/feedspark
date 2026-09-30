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
page never calls a product "excluded" on their strength):

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
than dropped: the 80 biggest product types per market (`tx` counts the rest), 30 sizes per type,
400 run patterns per type (`patx` counts the styles in rarer ones).

**Product types and sizes.** A type is the brand's own path to two levels (a generic "Clothing"
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
2. the BRAND it follows (another roster brand's own entry for the same type);
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
  and line under it sit at one height. A tile that summarises a card jumps to it.
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
before this change, 26 of its 38 checks fail.

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
| `GET /api/rules/stock` | `matrix`, `cutoffs`, `heroRuns` (every hero-mechanism rule, in run order — §3c), `findings`, `sv` (scenarios + window), `markets[]` via `stockView` (each with `wk`, its wired Google / Meta market keys, for the held-back download — §3f): `stock` rows each carrying `hb` (what the rule holds back), the plain-words `sentence`, `ads` (the market's price for traffic — spend/clicks/CPC off `roasidx`, the SKU denominator off `voldobidx`'s feed-row read — §3b — null when either is unread), and `av` (master / Google / Meta stock counts off `masteravail` + `feedavail`, with which feeds the market has wired — §3d). Feeds are found by the cmpid (`feedKeys`), never the roster label. |
| `POST /api/gmail/push {masterfile: cmpid}` | Key-gated (the xml-scan key). A roster company's master, streamed as bytes, or `{unchanged}` when the stored reading is of this import. §3d. |
| `POST /api/gmail/push {masterstock: […]}` | Key-gated. The master agent's counts → `masteravail`, one write per post; a tally that does not add up is refused. `szv` + `sz` mark a stored census (§3e). |
| `POST /api/gmail/push {mastersize: […]}` | Key-gated. One market's size census → `mastersize:<cmpid>`, validated whole by `HERO.sanitizeCensus` (§3e). |
| `GET /api/rules/hero[?brand=&market=]` | The guide store (every example + the in-scope brands' guides), each brand's guide status, and — for one brand (the first with a census when none is asked) — its roster markets and one market's census. §3e. |
| `PUT /api/rules/hero` | A partial map of `g:` / `m:` / `x:` keys (+ `_deleted`), every key checked (`sanitizeHeroPut`), merged with a read-stamp (`X-Sync-Base`), stamped by / at here. §3e. |
| `GET /stock/engine.js` | `docs/herosize_engine.js`, verbatim. |
| `GET /api/rules?pull=1` | Owner-only sync-now (≤ 6 markets a call). |

## 6. Harness

- `tools/check_stockeven.js` — `/stock` rendered and measured (§3g): the six-tile band at 1440 /
  1100 / 390px and beside the forecast panel, tile rows that fill their card, one ad-spend row height,
  a market named once, equal matrix columns, one chip width, one-line findings and setup summaries,
  the phone search row; with a negative control. Presync.
- `tools/test_rules.mjs` — the classifier on real rule-name shapes (counts and dates invented), the
  findings, `rulesStore` + `rulesPull` lifted from `worker.js` and run against a stub MCP
  (pagination, the cmpid guard, rotation, no_token / unauthorized / unreachable), the wiring, both
  pages, and that no `rule_report` payload is committed. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
  Availability (§3d): the cmpid join on every wired feed (and that no roster label is a scan-index
  key), the engine, one word table through both counters, `stockTally`, the agent's reader on a zipped
  CSV / Windows-1252 TSV / XML built in-process, the collector on a synthetic Google and Meta feed,
  `sanitizeAvail` lifted from the worker, both push lanes, the route, and the page twin `avBook`.
- `tools/test_herosize.mjs` — the hero-size engine (size keys, departments, product types, the census on
  synthetic CSV / XML masters, the measure, core, every example rule, the guide resolution, the document
  import + export), the worker's half (`src/herosizes.js`: the census it stores, the edits a signin may
  make), the held-back join (`feedIndex` + `heldBack`), the agent's census on an in-process zip, the
  route, the page, the stub, and that no census or guide is committed. In `qa_gate.sh`, `presync.sh`,
  `validate.yml`.
- `tools/rules_stub.js` — a synthetic rule list pushed through the real engine for `check_mobile.js` /
  `check_darkmode.js`, which also inline `/design/fcc.css` for pages that link it.
