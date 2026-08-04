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
**25 feeds × 8 brands (24 sheets + 1 Meta XML)** — Schuh gb/de/ie · YuMOVE · Monsoon · Accessorize ·
Superdry gb/ie/de/fr/nl · House of Bruar gb/us/eu · American Golf (API-fed sheet) ·
Reiss gb/us/ie/de/nl/au/ca/eu/fr **+ gb-fb (Meta channel)**
(FR isn't in the master sheet yet — add its row so the sheet stays the source of truth;
the sheet's EU row still shows a truncated URL). New rows in the sheet get
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
Meta channel export), e.g. Reiss `gb-fb`. How it differs from a sheet:

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
| Identity & trust | 1.2 | id, brand, gtin\|mpn, price, availability, condition coverage |
| Title anatomy | **1.6** | 0.40 length (full credit 80–150 chars) + 0.40 MASK coverage + 0.20 hygiene (dups/ALL-CAPS) |
| Descriptions | 1.3 | 0.5 coverage + 0.3 depth (≥300 chars) + 0.2 uniqueness |
| Attribute completeness | 1.5 | weighted coverage — color/size/item_group_id ×1.2, material/gender/age_group ×1, pattern ×0.8 |
| Taxonomy depth | 1.0 | 0.5 GPC (coverage × depth/4) + 0.5 product_type (coverage × depth ≥3 share) |
| Media richness | 1.0 | 0.4 image coverage + 0.4 min(addl imgs/3, 1) + 0.2 https |
| Label architecture | 0.9 | labels 0–4 coverage with diversity sanity (one value on 100% of rows scores low) |
| Agentic readiness | **1.5** | 0.30 conversational attrs + 0.25 desc depth + 0.20 structured richness + 0.15 identity + 0.10 MASK — **the headline gap pillar** |

| Total | Tier | Label |
|---|---|---|
| < 40 | T1 | Foundational |
| 40–59 | T2 | Structured |
| 60–79 | T3 | Enriched |
| 80+ | T4 | Agentic-ready |

This is the FeedSpark AI-Readiness ladder — same language as the Readiness module and client decks.
FeedHero working columns (`c:base_title`, `c:auto_optimised_title`…) detected → positive
"pipeline live" issue entry + before/after title recs.

---

## 6. Troubleshooting (runbook)

| Symptom | Cause | Fix |
|---|---|---|
| Proxy returns **404** | No feed linked for that client (no dossier `feed`, not in `DEFAULT_FEEDS`) | Attach the sheet in the brand dossier (§3) — check the client name matches the dossier key exactly |
| Proxy returns **502** | Sheet not link-shared — Google served a login redirect / non-200 | Sheet → Share → "Anyone with the link → Viewer", re-scan |
| Wrong tab audited | `gid` missing from the pasted URL | Re-paste the URL **with** `#gid=<n>` of the feed tab (default is gid 0) |
| Audit looks stale | Cache older than 20h | Nothing to do — the page auto re-scans past 20h; "↻ Re-scan live feed" forces it now |
| Brand shows markets it doesn't have (phantom chips) | Pre-Aug-2026 worker merged stale `feedmkt:` scan-index entries back into `/api/feed/markets` as `detached` markets | Fixed — markets = wired ∪ dossier-attached only, and audit PUTs for unattached markets are rejected; hard-refresh to pick up the deploy |
| PUT rejected 400/413 | Payload missing `score.pillars` / over 400KB | Engine/page version skew — hard-refresh so page + `/feedlab/engine.js` come from the same deploy |
| Worker CPU errors on scan | Someone "optimised" parsing into the worker | **Never.** The worker never parses the CSV — a 50MB parse blows the CPU budget. Proxy pipes bytes; parsing stays in the browser (and node tests) |
| Score history empty | `hist=1` not passed / no scans yet | `GET /api/feed/audit?client=X&hist=1` → `{audit, hist}`; history appends per PUT, capped at 90 entries |
