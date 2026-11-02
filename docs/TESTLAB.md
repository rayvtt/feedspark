# Test Lab — the Playbook's test proposals, and the competitor read behind them

Ray, 14 Oct 2026: *"I think the playbook and the workflow should be a bit smarter. For example,
there should be more proactive information about testing proposals, with specifics. One specific
could be: 'How about we test A/B testing image position this month?' because I have seen other
brands achieve a certain uplift over the last three months. So be specific about the type of
actions as well. Also consider competitors for the brands and how they are performing in ad and
visual displays on Google Shopping and Meta. Let's be super innovative in testing, because the
current top three actions are based only on existing data, which isn't aggressive enough for our
clients."*

The Top 3 actions read one account's own data and say what it costs to ignore. The Test Lab
sits under them on the Playbook rail (Workflow › right-hand panel) and says what to **try next**,
with three things the Top 3 could not say.

## 1. A specific test

`src/testlab.js › TESTS` is a library of 24 named A/B tests. Each one carries:

| | |
|---|---|
| `surf` | Google Shopping, Meta, or both — Google forbids promotional overlays on the main image, so every overlay test is Meta-only |
| `field` | the feed field the test changes (`g:image_link`, `g:product_highlight`, `image_link` on the Meta feed …) |
| `hyp` | the hypothesis, in a sentence a client can argue with |
| `how` | the design: the split, what the test side gets, the duration |
| `metric` | the primary metric, and the one that follows it |
| `fam` | the archive words that make an earlier test evidence FOR this one |
| `need` | what the feed has to carry for the test to run (below) |
| `src` | the platform page the idea rests on |

The proposal is a question — *"How about we A/B test lifestyle main image this month?"* — with
the evidence, the line to say on the call, the design with its field and metric, and → Brief.

## 2. What the book has proved

`evidenceBook(book, kw, now)` reads **every** brand's A/B test archive (the `abtests:<brand>`
cache the dossier route writes) and every keyword-result round (`kwresults`) into one table by
test family:

- a row's family is read off its archive `type` + `batch` through each test's `fam` words (a
  title test also through the parser's own `title` flag); a row no family claims is nothing;
- a **win** is a positive verdict or the test group winning, carrying its best up-is-good figure
  (CTR, clicks, conversions, revenue, CVR, impressions) — the figure is one the archive recorded,
  never derived, never invented;
- a win inside `TL_WINDOW_DAYS` (92 — "the last three months") is **recent**, the rest **older**;
  a run that did not win is counted as a run so "nobody has tried this" stays true.

So a proposal to one brand reads *"a Footwear account +12.4% CTR (Aug 2026) · 2 wins across the
book in 3 months"*.

### A peer is an industry, never a name — on the rail as well as in the brief

Ray, 23 Oct 2026, over the Playbook: *"ok on playbook, some other brand name would need to be
annonimize"*. The brief body had named the industry since 8 Oct because a client reads it, while
the rail named the brand outright as an AM tool — but the rail is open **on** the client call, and
⧉ Copy proposals lifts those exact strings into an email, so its screen is as public as the
document.

`peerWord(r, opts)` is the ONE writer for both surfaces, so they can never drift apart again:

| what is on record | the rail | client copy (the brief) |
|---|---|---|
| the peer's industry | `a Fashion account` | `a Fashion account` |
| no industry | `another account in our book` | `a FeedSpark account` |

The evidence keeps everything that argues the case — the figure, the metric, the month, the
industry — and loses only the one word that identifies another client. The **market** goes with
the name: a brand + market pair narrows it to a single account. The account's own result still
reads *"You"*, and `best` is always a peer anyway (every list it comes from filters this brand
out). `/api/testlab` carries no peer name either: `peers` and `evidence[].best` are industry +
figure, `book` is industries, and only `cold` still names brands, because that is the list the
page warms **by name** through `/api/abtests`.

The **competitor** block is a different fact and keeps its names — those are the client's own
rivals off the public Google Shopping results and off their own Auction Insights report, which is
the whole point of reading them. The Review tab's "Not on this account" rows were already counts
only (*"N other accounts in the book run it"*); the peer it sorts on is never printed.

A brand whose archive nobody has opened is not an empty archive: the route names it **cold**, and
the rail warms it once per session through `/api/abtests?client=` and re-reads, so the evidence
reads the whole book rather than whichever dossiers were opened this week.

## 3. What competitors are doing on Google Shopping

`POST /api/compwatch {client, market, force}` reads the Google Shopping results for the brand's own
category queries through SerpApi (`engine=google_shopping`, the `SERPAPI_KEY` AI Visibility uses,
the market's own `gl`/`hl`):

- `compQueries` takes the biggest leaves of the Product Type Guard snapshot, department-prefixed
  ("womens dresses", "mens jackets"), six of them — one SerpApi search each; no snapshot → the
  read is refused with the fix (scan the feed on PT Guard first);
- `normShopping` keeps only the rows: merchant, title, price, old price, sale, rating, reviews,
  thumbnail, link, sponsored — nothing else of the page; `cleanRead` checks the record whole on
  the way into KV `compwatch:<client>:<mkt>` (60-day TTL); one read per market per day unless
  forced; a money throttle (40 per 10 minutes) and the Workflow module grant guard it;
- `compSummary` = the merchants by presence (share, top-3 count, sale-badge %, star %, product-
  type-first title %, median price and title length), **our own line apart** (share, median
  position, price, our pictures), their pictures beside ours, and the **signals** — specific
  tests the read promotes, each with the figures behind it:

| they … | we … | → test |
|---|---|---|
| badge a sale on ≥25% | <10% | Sale price with strike-through |
| show stars on ≥40% | <15% | Product ratings feed |
| lead ≥60% of titles with the product type | lead with the brand | Product type first vs brand first |
| run titles 15+ characters longer | | MASK title structure |
| | are absent from our own category results | Seasonal keyword injection |

No signal under ten competitor rows. **Meta**: ad creatives are not readable without a Meta Ad
Library token (EU ads only under the DSA) — the rail says so, and nothing is mocked up.

## 3b. Auction Insights — the competitor read with no API

Ray, 14 Oct 2026: *"is there a way to bypass the competitor mapping without API?"* → *"i think Google
Ads Auction insight"*. The Shopping read above spends SerpApi credit; the Auction Insights report
costs nothing and is Google's own statement of who you bid against.

- The AM downloads the report from the Google Ads UI (a Shopping or Performance Max campaign →
  Auction insights → download, CSV or Excel) and drops it on **⇪ Upload** beside the market on the
  rail. The file is read **in the browser** (`/xlsx/engine.js`, loaded on first use: `.xlsx` through
  its reader, a CSV through its CSV reader, a tab-separated or UTF-16 export decoded by its
  byte-order mark) and only the ROWS reach the worker — `PUT /api/compwatch/auction {client,
  market, rows}` (≤400 rows, cells cut at 200 characters).
- `parseAuction` finds the header (Display URL domain beside Impression share — the Shopping shape;
  Search's Position above / Top of page / Abs. top of page columns ride along when present), reads
  the date range off the line before it, folds a segmented export (a Campaign / Ad group / Device
  column) per domain keeping the strongest figure and the row count, keeps **You** apart and sorts
  the competitors by impression share. **The report's own figures, never re-derived**: `< 10%` is
  kept as the floor it is (`isLt`) and drawn as `<10%`; `--` is null, never 0; an Excel cell holding
  `0.4523` is the same 45.23%. A file with no Auction Insights header is refused with the fix, never
  read as empty data.
- `cleanAuction` checks the record whole (0–100, ≤60 domains) on the way into KV
  `compauction:<client>:<mkt>` (120-day TTL), stamped by whom and when; `GET` serves it, `DELETE`
  forgets it (✕ on the rail). Writing needs the Workflow grant and the client scope; no money is
  spent, so no throttle.
- `auctionSignals` promotes the tests that move what the report measures — **eligibility and
  bidding**, never a creative test the report cannot see:

| the report says | → test |
|---|---|
| the leading domain is 5+ points ahead of you on impression share | Seasonal keyword injection, MASK title structure |
| you outrank a domain under 40% of the time where you overlap 20%+ | Performance-tier custom label |
| your impression share is under 20% among 3+ competitors | Sale price with strike-through |

`/api/testlab` carries the report on its market (`comp.markets[m].auction`, with or without a
Shopping read beside it) and unions its signals into `comp.signals` marked `src: 'auction'`, so the
proposals wear them like the Shopping read's. The rail draws You first, then the domains by
impression share on a bar each, overlap and outranking beside them, the range and the upload date.

## 3c. Merchant Center visibility — Google's own competitor read

Ray, 2 Nov 2026: *"You can now start importing competitors on Google Shopping via the new data from
Google Merchant Center. Inside [FeedHero] MCP, you can see GMC visibility and bring in whatever is
necessary."*

FeedHero's reports server gained `gmc_visibility`: the Merchant API's competitive-visibility report,
refreshed daily, a **28-day average ending 3 days ago** (never live). Per client it returns one row per
market — country × Google product category — with the client's rank, the share of its visibility that
is paid, the **one** most visible competitor (its rank, how much more visible it is, how often it shows
above the client, on how many of the same pages) and a count of the rest. Three traffic sources: all,
Shopping ads, and free listings (organic). Free listings rank on the feed itself, which is why they are
read apart.

**What the source is, read off it on 2 Nov 2026, and how the module reads it:**

1. **Per Merchant Center account, not per feed.** All 30 Reiss markets return the same rows (GB, AU,
   US), and the same for Damson Madder and American Golf. So a market's view is the account's rows
   **filtered to its own country**. A market the account reports nothing for says so, naming the
   countries it does report ("Merchant Center reports no DE market for this account (it reports GB, AU,
   US)"). EU has no single country and reads nothing.
2. **One competitor per market, not a list.** The block names that one competitor, with the count of
   the rest in the row's tooltip.
3. **The rank looks capped at 5.** Almost every market reads "your rank 5" against a competitor at 1,
   so 5 is read as **"5 or lower"**, never as an exact fifth place. Worth confirming with FeedHero.

**The pull** (`gmcPull`, worker): the `10,40` ROAS firing opens ONE MCP session and hands it to both
the ROAS rotation and `GMC_PULLS` (2) companies' visibility reads, three calls each, stalest first.
A company read inside `GMC_STALE_MS` (20 h) is never re-read, so every roster company is read about
once a day. The whole store is ONE KV key, `gmcvis` = `{cmpid: record}`: one get and one put a
firing, one get for the Test Lab. A company that answers nothing is stored with the source's own
reason ("No visibility data from Google for this account"), never as "no competitors". A rules firing
never carries the GMC read. Competitor domains are client data, so they live in KV only.

**On the rail** (between the Shopping read and Auction Insights, per market): 🛒 Merchant Center
visibility · last 28 days · FeedHero checked …, then All traffic and Free listings (Shopping ads too
when it has rows), each category one row: your rank, the competitor and its rank, "over 11× as
visible" / "25% more visible" / "about as visible as you", above you %, same pages %, and on all
traffic the share of yours that is paid.

**Signals** (`gmcSignals`, filed as `src: 'gmc'` beside the Shopping and Auction Insights ones):

| Signal | When | Test it promotes |
|---|---|---|
| A competitor at least twice as visible on ≥30% of the same pages | `kw_theme` | eligibility — keywords |
| A competitor above you on ≥50% of the pages you share (overlap ≥10%) | `cl_perf` | performance-tier label |
| ≥90% of your visibility in a category is paid | `title_mask` | free listings read the feed, the title first |

The paid signal adds "the free listings report no X market of yours at all" only when the
free-listings read returned rows. An empty read is not evidence.

## The ranking — aggressive by design, honest by design

`proposeTests(brand, ctx, ev)` scores every test:

| | |
|---|---|
| a same-industry peer won it inside three months | 40 |
| any peer won it inside three months | 30 |
| a peer won it, longer ago | 15 |
| **nobody in the book has run it** | 22, and the *first in the book* badge |
| a competitor signal names it | +20 |
| the feed can carry it (readiness) | +25 |
| this brand has never run it | +6 |

Then: a test this brand ran inside `TL_RECENT_DAYS` (183) reads **ran**; one already briefed
(a `cat: test` ticket, or any 'A/B Test - …' task) reads **briefed** with its ticket; one the feed
cannot carry reads **not yet** with what unblocks it — none of those reaches the three. The
three are the best-scored ready tests, and **one of them is always a first for the book** when a
ready first exists — "based only on existing data" is exactly the trap this replaces. The rest
fold behind *N more ideas*, each with its state.

Readiness (`NEEDS`) reads the brand's feeds as the route assembles them from `goldenidx`
(coverage per attribute), `overlayidx` (an overlay already on the Meta feed), `voldobidx`
(arrivals), the wired `-fb` feeds and the market's language: *no Meta catalogue feed is wired*,
*fewer than 40% of products carry a second image*, *no market carries sale prices on 5% of
products*, *the brand already carries conversational attributes*, *every market is
English-speaking*, *no new-product arrivals read yet*.

## → Brief

Raised through the page's one composer entry (`window.FCCBrief`) as a **Testing** brief: task
`A/B Test - <name> - <Brand> - MMYY`, scope = test · field · hypothesis · design · primary metric ·
success rule (95% confidence, losers revert, winners roll out) · evidence (industry, figure,
month) · the competitor read where there is one · source · markets wired. It files into Intake and
the Project Plan like every other brief.

## Routes

| | |
|---|---|
| `GET /api/testlab?client=` | scoped per signin; the three, the rest, the counts, the evidence by family, the book (brands with an archive read), the cold brands, the brand's feeds, the competitor block |
| `GET /api/compwatch?client=&market=` | the stored read + its summary |
| `POST /api/compwatch` | `{client, market, force}` — read it now (money route) |
| `GET\|PUT\|DELETE /api/compwatch/auction` | the uploaded Auction Insights report per market: stored / `{client, market, rows}` from the downloaded file / forget it |
| `GET /api/gmcvis` | status across the roster (read, fresh, empty); `?client=` = every roster market of the brand, each its own country's rows + signals (scoped); `?pull=N` = OWNER-ONLY read now (≤4 companies a call), `&cmpid=` one company |

## Harness

- `tools/test_testlab.mjs` (qa_gate / presync / validate): the library's shape; the family read;
  the figures (both keyword-line shapes, direction words, a cost line never counted); the evidence
  window; the competitor normalisation (a second pass through `cleanRead` changes nothing), the
  summary and the signals; the ranking rules; industry-not-peer in the brief; both routes lifted
  out of `worker.js` against a stub KV and a stub SerpApi (scope, the grant, no key, no snapshot,
  the day cache, force, Meta refused, nothing of the key or the raw page stored); the Auction
  Insights parser on Google's own export shapes (title + range lines, `< 10%`, `--`, a segmented
  Excel export with fractions), the sanitiser's idempotence, the signals, the upload route (scope,
  grant, a file with no header refused, nothing of the file stored, DELETE); the wiring.
  Every fixture is invented — Northwind, Harbour, Linden.
- `tools/test_gmcvis.mjs` (qa_gate / presync / validate): the visibility words (`>+1,000%` a floor,
  `Within 2.5%` level), the rank ceiling, per-country views and the unreported country, the plan
  (never-read first, a fresh read never repeated), the three signals, `gmcPull` and `/api/gmcvis`
  lifted out of `worker.js` against a stub MCP + KV (one put a firing, the shared session, a failure
  mid-firing keeping what was read, a refused token, owner-only read now, scope), the wiring, and that
  no competitor domain read off a live account is committed.
- `tools/check_testlab.js` (Playwright, presync): the real Workflow rail — the three with their
  evidence, line and design; the badge; the surface pills; the folded rest with its states; the
  competitor block (merchants, our line, pictures, the signal, ⚡ Read now → one POST + a re-read);
  the Auction Insights block drawn from a stored report and a real CSV dropped on ⇪ Upload through
  the page's own file input — read into rows in the browser, one PUT, a re-read, ✕ → DELETE;
  the Merchant Center block drawn before Auction Insights — the 28-day head, the sources apart, the
  rank as a ceiling, the competitor in words, a level one as level, the signal, and DE saying what
  the account does report;
  → Brief filling the composer as a test naming the industry, never the peer; the phone.
