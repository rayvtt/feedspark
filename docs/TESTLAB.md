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

So a proposal to one brand reads *"Reiss GB +12.4% CTR (Aug 2026) · 2 wins across the book in 3
months"*. The rail names the peer — it is the AM's tool. The **brief** (a document a client may
read) names the industry: *"a Fashion account saw +12.4% CTR"* — Ray's rule from the Golden
Record documents, never a peer brand in client copy.

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

## Harness

- `tools/test_testlab.mjs` (qa_gate / presync / validate): the library's shape; the family read;
  the figures (both keyword-line shapes, direction words, a cost line never counted); the evidence
  window; the competitor normalisation (a second pass through `cleanRead` changes nothing), the
  summary and the signals; the ranking rules; industry-not-peer in the brief; both routes lifted
  out of `worker.js` against a stub KV and a stub SerpApi (scope, the grant, no key, no snapshot,
  the day cache, force, Meta refused, nothing of the key or the raw page stored); the wiring.
  Every fixture is invented — Northwind, Harbour, Linden.
- `tools/check_testlab.js` (Playwright, presync): the real Workflow rail — the three with their
  evidence, line and design; the badge; the surface pills; the folded rest with its states; the
  competitor block (merchants, our line, pictures, the signal, ⚡ Read now → one POST + a re-read);
  → Brief filling the composer as a test naming the industry, never the peer; the phone.
