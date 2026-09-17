# FeedSpark FCC — Feed Lab

How the Feed Lab module (`/feedlab`) turns a client's **live Google-Sheet shopping feed** into an
animated in-browser audit, an AI-readiness score, and briefable recommendations — and how to keep
it boring. Integration layer landed in `d26bd0f`; engine + page follow in the paired commit.

---

## 1. What Feed Lab is

An FCC module that dissects a client's **live** shopping feed (a link-shared Google Sheet, refreshed
daily upstream). The flow:

1. Browser streams the sheet's CSV export through `GET /api/feed/proxy?client=X` — the worker
   **pipes bytes only, zero parsing**.
2. The page parses chunk-by-chunk with `FeedAudit` (`docs/feedlab_engine.js`), animating the scan
   as rows stream in (sample cap: 8,000 rows; row total estimated from Content-Length when capped).
3. The engine emits a small audit JSON — score, 8 pillars, title anatomy, attribute matrix, issues,
   recommendations (each with a `brief` object that deep-links `/workflow?brief=<b64url>`).
4. Page `PUT`s the audit to `/api/feed/audit?client=X` → KV cache + score history.

**Refresh model:** on load, the cached audit renders instantly (animations replay from JSON). If the
cache is **older than 20h** — or Ray hits "↻ Re-scan live feed" — the page re-streams and recomputes.
Feeds change daily upstream; the 20h window keeps the score at most one refresh behind.

Wired out of the box via `DEFAULT_FEEDS` — the committed **master feed-market map**, imported from
Ray's sheet (`1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak`, one row per client+country feed):
**44 feeds × 9 brands (all sheets)** — Google channel: Schuh gb/de/ie · YuMOVE · Monsoon · Accessorize ·
Hobbycraft gb · Superdry gb/ie/de/fr/nl · House of Bruar gb/us/eu · American Golf (API-fed sheet) ·
Reiss gb/us/ie/de/nl/au/ca/eu/fr/uae. **Meta channel (`<mkt>-fb`, imported from the sheet's "Meta" tab
gid 908873996, col B):** Schuh gb/de/ie · Monsoon gb · Accessorize gb · Hobbycraft gb ·
Superdry gb/ie/de/fr/nl · House of Bruar gb/us · Reiss gb/ca/de/ie/us — every Meta feed is a
link-shared Google Sheet, so Label Guard monitors them too (Reiss gb-fb was FeedHero XML; the
sheet from the Meta tab replaced it).
(Reiss FR isn't in the master sheet's Google tab yet — add its row so the sheet stays the source
of truth; the sheet's EU row still shows a truncated URL). New rows in the sheet get
re-imported into `DEFAULT_FEEDS` (ask a Code session); ad-hoc feeds attach from the CC dossier and
**override** the wired entry per market. `/api/feed/clients` serves the roster (wired ∪ attached)
to the Feed Lab selector and the CC dossier in one call.

---

## 2. Architecture

```
 Google Sheet (link-shared, daily-refreshed feed export)
        │  /export?format=csv&gid=<gid>
        ▼
 ┌──────────────────────────┐
 │ worker: /api/feed/proxy  │  pipes the byte stream UNTOUCHED
 │  ?client=X               │  (no CSV parsing — CPU budget)
 └──────────┬───────────────┘
            │  streamed CSV chunks (fetch().body.getReader())
            ▼
 ┌──────────────────────────┐
 │ browser: FeedAudit engine│  createParser → normKey → audit()
 │ (/feedlab/engine.js)     │  parses + scores, animates the scan
 └──────────┬───────────────┘
            │  small audit JSON (~<400KB)
            ▼
 ┌──────────────────────────┐       KV (FEEDSPARK_DECK_EDITS)
 │ PUT /api/feed/audit      │──────▶ feedaudit:<client>        (latest audit)
 │  ?client=X               │──────▶ feedaudit:hist:<client>   (last 90 {t,total,tier,rows})
 └──────────────────────────┘
            ▲
 GET /api/feed/audit?client=X[&hist=1]  ← instant load for everyone else
```

Not an open proxy: the sheet id **never comes from the query** — only clients whose feed is in the
dossier (or `DEFAULT_FEEDS`) resolve. Audit PUTs are activity-logged (`feed-audit`) per Access user.

---

## 3. Onboarding a new brand's feed

1. In Google Sheets, make the feed sheet **link-viewable** ("Anyone with the link → Viewer").
   The worker fetches the CSV export unauthenticated — a private sheet 302s to a login page → 502.
2. Command Center → the brand's dossier → **edit mode** → **⚡ Attach feed sheet** → paste the full
   sheet URL. The worker extracts `/d/<id>/` and honours a `gid=` in the URL (`#gid=` or `?gid=`);
   no gid → tab 0. Stored as the dossier `feed` field.
3. Open `/feedlab?client=<Brand>` (or the dossier's **Feed Lab ⚡** link in view mode) → first scan
   streams live, scores, and caches.
4. No dossier entry needed for the 8 master-map brands — `DEFAULT_FEEDS` in the worker wires their
   sheets (see §1) until/unless a dossier `feed` overrides them. A dossier `feed` always wins per
   market. For a **permanent** new feed, prefer adding the row to Ray's master sheet and re-importing
   into `DEFAULT_FEEDS` so the wiring is committed, not KV-only.

### 3a. XML feeds (Meta/Facebook channel — FeedHero-hosted)

A feed source can also be a **FeedHero-hosted XML product feed** (RSS 2.0, `g:` namespace — the
Meta channel export). No wired feed uses this any more — the Aug 2026 Meta-tab import supplied
sheets for every Meta feed, replacing Reiss `gb-fb`'s XML source — but ad-hoc ⚡ attaches still
resolve XML URLs. How an XML source differs from a sheet:

- **Source shape**: `{ xml: 'https://s2.feedhero.net/…/latest.xml' }` instead of `{ id, gid }`.
  The proxy only accepts `https://*.feedhero.net/**.xml` (host allowlist — never an open relay).
  Pasting a FeedHero XML URL into the dossier's ⚡ attach works too (`feedRef()` resolves both).
- **Realtime**: FeedHero URLs serve the live output — every re-scan audits the current state
  (sheets refresh daily upstream; XML is always current, so it doubles as the source of truth).
- **Parsing**: the browser engine sniffs the first streamed bytes — `<` → `createXmlParser`
  (streaming `<item>` extraction; repeated tags like `additional_image_link` become `(2)`, `(3)`…
  matching the sheets' `|||N` columns), anything else → the CSV parser. Same audit either way.
- **Channel-as-market**: wired under a `<mkt>-fb` market code (e.g. `gb-fb`) so it gets its own
  chip, league card and heatmap row next to the Google feed for the same country.
- **Channel-aware title scoring** (engine v1.2.0): `-fb` markets audit with `channel:'meta'` —
  full length credit at **25–65 chars** (Meta truncates ~65; over the cut = half credit), title
  weights .5 length / .3 MASK / .2 hygiene (five MASK slots can't fit in 65 chars), and the
  title issue/rec copy speaks Meta ("recompose into the ≤65 window"), never the 80–120 MASK
  window. Google feeds are scored exactly as before — the bands/buckets labels follow the channel.
- **Label Guard skips XML feeds** — its pivots run on Google's gviz endpoint, which only exists
  for sheets. XML feeds don't appear on `/labels` and cron rotation slots are not spent on them.

---

## 3b. Multi-market (the portal)

A brand can carry one live feed **per market** — Superdry ~8, Reiss up to ~50:

- **Attach**: CC dossier edit mode → ⚡ Feed markets → market code (`gb`, `de`, `fr`…) + sheet URL.
  The legacy single `feed` field doubles as `gb`. Stored as `feeds:{mkt:url}` in the dossier.
- **Portal** (renders whenever a brand has 2+ markets): league cards (score ring, tier, SKU count,
  top gap — click to dissect that market below), estate insights (SKU-weighted estate score,
  leader vs laggard, widest pillar drift, markets 15+ pts behind), and a markets × 8-pillars
  heatmap. **⚡ Scan all** sweeps the estate sequentially, skipping audits fresher than 20h.
- **API**: `/api/feed/proxy?client=X&market=de` · `/api/feed/audit?client=X&market=de` (GET/PUT)
  → KV `feedaudit:<client>:<mkt>` (+ `:hist`); `GET /api/feed/markets?client=X` returns every
  attached market with its cached summary from the compact index `feedmkt:<client>` — the portal
  boots from ONE read however many markets exist. Pre-multi-market audits are served as `gb`.
- Briefs drafted from a multi-market brand carry the market in the task name (`… · DE`).

## 4. Audit JSON + the engine

**Engine:** `docs/feedlab_engine.js` — UMD, no imports; attaches `FeedAudit` to `globalThis` AND
`module.exports`. Bundled as a wrangler Text module, served **verbatim** at `/feedlab/engine.js`,
and unit-tested in node — **page and tests run the exact same file.** API:

- `createParser(onRow)` → `{push(chunk), end()}` — incremental RFC-4180 CSV parser
- `normKey(header)` → canonical key (strips `g:`/`c:`, ` type=""string""`; `…|||3` → `…(3)`)
- `audit(header, rows, {client, sheetId, gid, rowTotalEstimate})` → the audit JSON
- `VERSION`

**Contract (v1) — page renders EXACTLY this, engine emits EXACTLY this.** Top-level keys:
`v, client, sheetId, gid, fetchedAt, rowCount, sampled` + `score {total, tier, tierLabel,
pillars[8]}` + `attributes[]`, `titles {avg/min/max/dup/allCaps, buckets, mask, samples}`,
`descriptions`, `media`, `highlights`, `labels[]`, `taxonomy`, `pipeline {feedhero, cols}`,
`issues[] {sev, code, title, detail, count}`, `recs[] {impact, effort, service, tachyon, title,
detail, evidence, brief}`, `dissect[]`. All numbers **computed from data, never hardcoded**;
every rec's `evidence` carries real counts and its `brief` powers the "→ Brief this" button.
Full shape + field-by-field example: the build contract (scratchpad `feedlab_contract.md`) and the
engine's own comments. Worker-side validation on PUT: must have `score.pillars`, ≤400KB.

---

## 5. Scoring pillars + tier ladder

`total` = weighted mean of 8 pillar scores (0–100 each):

| Pillar | Weight | Measures |
|---|---|---|
| **Conversational attributes** | **2.4** | mean COVERAGE of Google's six — `question_and_answer`, `document_link`, `related_product`, `item_group_title`, `variant_option`, `popularity_rank`. The variant pair is dropped from the denominator on a feed with no `item_group_id` |
| Title anatomy | **1.6** | 0.40 length (full credit 70–150 chars, half 30–69 — Google's own edges) + 0.40 MASK coverage + 0.20 hygiene (dups/ALL-CAPS) |
| Attribute completeness | 1.5 | weighted coverage — color/size/item_group_id ×1.2, material/gender/age_group ×1, pattern ×0.8 — under the industry profile |
| Identity & trust | 1.4 | id, link, brand, gtin\|mpn, price, availability coverage (condition measured, not scored — optional for new goods) |
| Descriptions | 1.3 | 0.5 coverage + 0.3 length credit (0 under 160 chars, linear to full at 500 — Google's "first 160–500 characters") + 0.2 uniqueness |
| Taxonomy depth | 1.2 | 0.5 mean GPC credit (numeric ID / 3+ levels / a 2-level branch Google's taxonomy ends at = 1, other 2-level = ½, 1 level = ¼, missing 0) + 0.5 mean PRIMARY product_type depth credit (3+ = 1, 2 = ½, 1 = ¼) — `pathDepth`, the same read as content quality and PT Guard |
| Structured detail | 1.2 | 0.4 highlights min(avg/4, 1) + 0.3 product_detail coverage + 0.3 description length credit — product_type depth is NOT read here (Taxonomy owns it) |
| Media richness | 1.0 | 0.5 image coverage + 0.5 min(addl imgs/3, 1) — https measured, not scored |
| ~~Label architecture~~ | **0 — measured, not scored** | still read and returned as `labelArchitecture`, and owned in full by Label Guard |

### Every pillar vetted against the published specs (Ray, 17 Sep 2026)

*"The scoring and logic between content quality and AI readiness that I have spotted is still not
consistent. For example, taking Schuh GB. product type is after scan for content quality; it says
average 3.3 level depth while AI readiness in structured detail tiles only says product type 2.2
level depth … Please also continue to vet every single tile of AI readiness against what the
current industry or high-authoritative platforms such as Google, ChatGPT, or Claude recommend, and
remove all the subtext underneath."*

- **One depth, everywhere.** The tile's "product_type 2.2 levels deep" was a count of FILLED
  KEYWORD SLOTS (`product_type(2..10)` — FeedSpark keyword injection), averaged over every row, and
  the category column itself had been dropped: `slots()` started at `(1)`, and the XML parser names
  the first repeat of a tag bare, so on every FeedHero XML feed the primary `g:product_type` was
  not in the slot list at all. The engine now resolves the PRIMARY product_type exactly as
  labelguard's `KEY_ALIASES` does (bare `product_type`, else `product_type(1)`) and counts its
  chevron depth with `pathDepth` ported verbatim — `tools/test_feedlab.mjs` runs the same rows
  through `qualityCollector` and `audit()` and asserts `avgDepth === taxonomy.ptDepthAvg` for both
  product_type and GPC. Keyword assignments are still reported (`taxonomy.ptSlotsAvg`), named as
  assignments.
- **Slot one is the bare column** — the same bug had Monsoon GB's four repeated
  `<g:product_highlight>` read as three and dropped the first `additional_image_link` on every
  XML feed. Bare and `(1)` are one slot, never both.
- **GPC credit knows Google's taxonomy.** A numeric ID or a two-level branch Google's own export
  ends at (the 52-entry `GPC_LEAF2`, identical in both engines and asserted so) is "the most
  specific category possible" ([answer 6324436](https://support.google.com/merchants/answer/6324436)).
  Previously `Apparel & Accessories > Shoes` earned half credit on the tile while passing the
  content-quality "too broad" rule.
- **`condition` left Identity & trust; `link` joined it.** Google
  ([answer 7052112](https://support.google.com/merchants/answer/7052112)) requires condition only
  for used/refurbished goods and the OpenAI feed spec lists it optional — a feed of new products
  was docked a sixth of the pillar for an attribute neither platform asks of it. `link` is
  required by both.
- **https left Media richness.** Google's image_link page
  ([answer 6324350](https://support.google.com/merchants/answer/6324350)) accepts "http or https";
  the `img-http` finding is gone and `media.httpsPct` stays as a reading.
- **`product_detail` joined Structured detail.** Google names it beside highlights as what AI
  surfaces read ([answer 9218260](https://support.google.com/merchants/answer/9218260): so customers
  "discover information about your products across AI-driven surfaces"); product_type depth left the
  pillar so nothing is counted twice.
- **Description length is Google's 160–500** ([answer 6324468](https://support.google.com/merchants/answer/6324468)),
  not a house 300: no credit under 160 (the content-quality "thin" rule fires at the same line),
  linear to full at 500. **Title length is Google's 30 / 70 / 150** ([answer 6324415](https://support.google.com/merchants/answer/6324415)):
  the MASK 80–120 window stays as the house target on the histogram, labelled as such.
- **The subtext is gone; the logic is a click away.** Every pillar tile on `/feedlab` and `/golden`
  is a name, a number, a bar and its weight; clicking it opens the scoring pop-up — the formula
  (`FeedAudit.BASIS[key].f`), this feed's live components (`pillar.reads`, stored with the
  analysis and allow-listed by the worker), the published sources (`BASIS[key].src` — Google
  answer pages, the [OpenAI product feed spec](https://developers.openai.com/commerce/specs/feed),
  Anthropic's [anatomy of effective commerce agents](https://claude.com/blog/the-anatomy-of-effective-commerce-agents))
  and, where a threshold is FeedSpark's own rather than a platform's, a box saying so. One
  object in the engine, so the two pages cannot drift.

### Why this model (Ray, 16 Sep 2026)

*"Label architecture that involves custom labels is not necessarily usable for AI, so I don't know
what's in there … include the most important factor for AI readiness, probably the conversational
attribute that Google mentioned — when you fix this, obviously fix Feed Lab as well."*

- **Custom labels left the score.** Google's specification for `[custom_label_0-4]`
  ([answer 6324473](https://support.google.com/merchants/answer/6324473)) says they exist to
  "create specific filters to use in your Performance Max, Shopping, or Demand Gen campaigns …
  for reporting and bidding", and states plainly: **"The information you include in this attribute
  won't be shown to customers."** A field no surface ever reads cannot be evidence of readiness for
  those surfaces. The reading is not lost — it still comes back on `labelArchitecture`, both pages
  print it as *measured, not scored* with the reason, and `/labels` owns the detail.
- **Conversational attributes became the heaviest pillar.** They are the only fields in the spec
  whose stated purpose is AI comprehension: Google ships them
  ([answer 17085370](https://support.google.com/merchants/answer/17085370)) so "customers discover
  information about your products across AI-driven surfaces, like AI Mode in Search". They are
  optional, never affect approval, and go in via a supplemental data source or the Merchant API.
  Search Engine Land's reporting on
  [AI shopping and the feed](https://searchengineland.com/ai-shopping-product-feed-page-484060)
  puts the same set alongside the non-negotiable basics (valid GTIN, accurate title, price and
  availability matching the live site, clean image, brand, correct category) — which is why
  identity and taxonomy went up too.
- **Scored on coverage, not presence.** `question_and_answer` on 3% of the catalogue is a pilot,
  not a capability.
- **The ceiling is deliberate.** At ×2.4 the rest of the model tops out at **79.3**, so a feed
  carrying none of the attributes Google built for agentic surfaces cannot read as *Agentic-ready*.
- **No double counting.** The old "Agentic readiness" pillar folded the conversational six in
  alongside identity and MASK, which both diluted them and counted other pillars twice. It is now
  "Structured detail" and reads only highlights, product_type depth and description depth.

Measured on live feeds the day it shipped: Superdry GB 73 → **59** (Tier 3 → Tier 2), Monsoon GB
68 → **56** — both at 0/6 conversational attributes. The drop is the finding, not a regression.
Harness: `tools/test_feedlab.mjs` (in qa_gate / presync / validate) pins the weighting, the
coverage rule, the variant exclusion, the ceiling, and that emptying every custom label moves the
headline by exactly nothing.

| Total | Tier | Label |
|---|---|---|
| < 40 | T1 | Foundational |
| 40–59 | T2 | Structured |
| 60–79 | T3 | Enriched |
| 80+ | T4 | Agentic-ready |

This is the FeedSpark AI-Readiness ladder — same language as the Readiness module and client decks.
FeedHero working columns (`c:base_title`, `c:auto_optimised_title`…) detected → positive
"pipeline live" issue entry + before/after title recs.

### Attribute completeness follows the industry best-practice profile

Ray, 17 Sep 2026 (screenshot, YuMOVE/Pet Care — the "Attribute completeness" pillar scoring 30/100
on "color 0%, material 0%, gender 0%, age_group 0%, pattern 0%, rest strong"): *"make sure all
scoring (AI readiness, content quality) always refer back to the industry best practice that had
been set."* This pillar checked every brand against the apparel five (`color`, `size`,
`item_group_id`, `material`, `gender`, `age_group`, `pattern`) with no awareness of the SAME
industry scoring profile `goldenScore` already consults (`INDUSTRY_PROFILES`/`profileFor` in
`labelguard.js` — see `LABELGUARD.md` §Industry scoring profiles) — a Pet Care brand read as
incomplete for lacking attributes Golden Record itself never expects from it.

`audit(header, rows, opts)` now takes two optional attribute-key arrays mirroring
`profileFor()`'s own shape, `opts.expected` and `opts.waived`, and applies the SAME two rules
`goldenScore` applies:
- `color` / `size` / `gender` / `age_group` / `item_group_id` are ATTR_SPEC **cond**-tier — counted
  only when the column is present, or absent but named in `opts.expected` (an apparel-five gap is
  real for Fashion/Footwear, who expect it by default; a Pet Care feed carrying none of them is not
  incomplete, no waiving needed).
- `material` / `pattern` are ATTR_SPEC **rec**-tier — always counted (the optimisation surface)
  unless the industry profile explicitly names them in `opts.waived` (Pet Care's own default
  profile waives `pattern` only; `material` still counts everywhere — it stays a genuine
  cross-industry opportunity, not an apparel-only field).

The engine stays industry-agnostic — it only ever reads the two arrays it's handed. The caller
resolves the actual profile: `/golden`'s nested reading passes `profileForC(client)` (the page's
own mirror of `profileFor`) into the same `FA.audit()` call that produces `snap.ai`, and `/feedlab`
itself fetches `/api/golden/profile` directly (`profileForFL()`) so the front-door reading can
never disagree with the one nested inside a Golden Record scorecard — "ONE engine, so /feedlab and
/golden move together" holds for the industry profile too, not just the scoring code. Live effect
on the YuMOVE scenario above: "Attribute completeness" 40 → **100**, "all core attributes strong".
Harness: the profile-consistency block in `tools/test_feedlab.mjs` (cond-tier exclusion, rec-tier
waiving, material deliberately NOT exempted, an industry that `expected`s the apparel five still
marking its absence as a real gap).

---

## 6. Troubleshooting (runbook)

| Symptom | Cause | Fix |
|---|---|---|
| Proxy returns **404** | No feed linked for that client (no dossier `feed`, not in `DEFAULT_FEEDS`) | Attach the sheet in the brand dossier (§3) — check the client name matches the dossier key exactly |
| Proxy returns **502** | Sheet not link-shared — Google served a login redirect / non-200 | Sheet → Share → "Anyone with the link → Viewer", re-scan |
| Wrong tab audited | `gid` missing from the pasted URL | Re-paste the URL **with** `#gid=<n>` of the feed tab (default is gid 0) |
| Audit looks stale | Cache older than 20h | Nothing to do — the page auto re-scans past 20h; "↻ Re-scan live feed" forces it now |
| Brand shows markets it doesn't have (phantom chips) | TWO stacked causes, both fixed Aug 2026: ① worker merged stale `feedmkt:` scan-index entries back into `/api/feed/markets` as `detached` markets; ② the chip row's `.mkt-row{display:flex}` CSS overrode the `hidden` attribute (author rules beat the UA's `[hidden]{display:none}`), so single-market brands kept the PREVIOUS brand's chips painted after a toggle | Fixed — markets = wired ∪ dossier-attached only, audit PUTs for unattached markets rejected, and the page now forces `[hidden]{display:none!important}`; hard-refresh to pick up the deploy |
| PUT rejected 400/413 | Payload missing `score.pillars` / over 400KB | Engine/page version skew — hard-refresh so page + `/feedlab/engine.js` come from the same deploy |
| Worker CPU errors on scan | Someone "optimised" parsing into the worker | **Never.** The worker never parses the CSV — a 50MB parse blows the CPU budget. Proxy pipes bytes; parsing stays in the browser (and node tests) |
| Score history empty | `hist=1` not passed / no scans yet | `GET /api/feed/audit?client=X&hist=1` → `{audit, hist}`; history appends per PUT, capped at 90 entries |
