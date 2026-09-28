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
| `GET /api/rules/stock` | `matrix`, `cutoffs`, `findings`, `markets[]` with `stock` rows and the plain-words `sentence`. |
| `GET /api/rules?pull=1` | Owner-only sync-now (≤ 6 markets a call). |

## 6. Harness

- `tools/test_rules.mjs` — the classifier on real rule-name shapes (counts and dates invented), the
  findings, `rulesStore` + `rulesPull` lifted from `worker.js` and run against a stub MCP
  (pagination, the cmpid guard, rotation, no_token / unauthorized / unreachable), the wiring, both
  pages, and that no `rule_report` payload is committed. In `qa_gate.sh`, `presync.sh`, `validate.yml`.
- `tools/rules_stub.js` — a synthetic rule list pushed through the real engine for `check_mobile.js` /
  `check_darkmode.js`, which also inline `/design/fcc.css` for pages that link it.
