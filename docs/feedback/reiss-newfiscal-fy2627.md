# Reiss — New fiscal FY26/27 deck: build log

## 2026-09-29 — round 0 (first build)

**Ask (Ray):** a cover and five slides for Reiss's new fiscal year —
1. field population and change per market, all markets on one slide (the Catalogue's
   "What FeedSpark did" card: master 22.5 · +1.1 populated · +12.0 optimised · +5.3 enriched);
2. Golden Score as a daily mechanism: content quality, population and AI-readiness;
3. managing many workstreams (project plans, emails, strategy sessions, calls) to the marketing
   calendar, with daily and weekly review and the keyword calendar;
4. carrying UK optimisation to the other markets through automation and an internal supplemental
   feed, traced and audited daily — "700 to 800 fields of data" across the markets;
5. a dedicated AM team for urgent and critical issues, with a Task Manager donut of urgent,
   technical and call work over five years.

**How each number was read (29 Sep 2026)** — nothing below is committed as raw data; the figures
live only in the deck.

- **Slide 1** — the FCC's own Catalogue engine (`docs/catalog_engine.js`, the code behind the
  "What FeedSpark did" card) run in node over each market's main Google Shopping output feed and
  its FeedHero master import (`import_feeds_ftp` gz from FeedHero's client list), joined exactly
  as `/catalog` joins them. GB reproduces the screenshot to the decimal (22.5 / 1.1 / 12.0 / 5.3,
  24,370 traced, 69%). 30 markets, 748,224 products. Israel (live 21 Sep 2026) and Qatar are in
  FeedHero but not yet in the FCC feed map.
- **Slide 2** — `labelguard.js` goldenScore + qualityScore and the Feed Lab audit (packAudit) on the
  same stream, under the default Fashion profile (brand-level waivers on /golden not applied).
- **Slide 3** — Task Manager (feedspark-reports MCP) for every Reiss market, 1 Oct 2025 – 29 Sep
  2026; the TM email-ticket queue; `docs/plan_tasks.json`; the Reiss seed on /kwcal; the ASPL
  schedule snapshot in `ops/schedule/`; the Silk read-out REIS-20260811-02.
- **Slide 4** — the GB "Internal Supplemental Feed (Only used this)" header; FeedHero client list
  (active rules) and output-feed report (active output feeds); 722 = the sum over 30 feeds of the
  fields each product carries a value in.
- **Slide 5** — Task Manager, 1 Oct 2021 – 29 Sep 2026, typed with `tools/reporthours.mjs`
  `classifyTask`, with Urgent & critical (disapprovals, Merchant Center account issues, urgent /
  SKU-drop / suspension / outage escalations) and Calls & strategy split out by title.

**Findings kept in the internal notes, not the slides:** description on only ~35% of products in
12 markets; colour absent in BE, GR, IT, PL, DK; SE and QA ship titles as supplied; 165 of 221
scheduled slots were Skip.

**Exporter:** `tools/deck_to_pptx.py` gained `barstack` / `colstack` / `donut`, `data-chart-ink`,
`data-chart-fmt` and `data-chart-side` for this deck — see `tools/README.md`.

**Skill change?** Yes — the new chart attributes are documented in the deck-generator skill's
chart section, since any future per-market or breakdown slide needs them.
