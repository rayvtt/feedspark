# Playbook — the AM meeting copilot (`/playbook`)

Ray, 11 Sep 2026: *"a module for AMs to use during meetings … assimilate and assess all tasks
across every brand for multiple clients from multiple industries … if there is an overlay BAU
task on Accessorize, they can suggest it to Hobbycraft … a search bar on a blank canvas: 'What
should I do for Accessorize?' → a checklist of tasks completed for that brand over the last
month, 3 months, 6 months, or a year."*

One read across **every client's project plan**, classified into feed-optimisation strategies,
so an AM can — mid-meeting — see what's been done for a brand and bring the plays that are
working elsewhere in the book to the brands that haven't had them yet.

## The two jobs
1. **Retrospective — "what's been done for brand X".** A search bar on a calm canvas resolves a
   brand (plain or meeting phrasing: *"what should I do for Accessorize"* → Accessorize). The
   panel shows completed work grouped by strategy category, with a **1m / 3m / 6m / 12m / all**
   window toggle and an expandable ✓ checklist per category, plus an in-flight strip.
2. **Prospective — cross-pollination.** For the same brand, the right column surfaces plays that
   are **proven on comparable brands but this one hasn't run** (or is thin on) — ranked by how
   widespread they are across the book, each naming the peer brands + example tasks, with a
   **→ Brief** button that opens the Workflow composer prefilled (`/workflow?brief=`) so the
   suggestion files straight into the client's plan and rides Intake → Project Plan → pipeline.

## Data
- **Instant:** the baked `window.PLANTASKS` snapshot (`tools/build_plan_tasks.py`, spliced via the
  `<!-- PLANS:START/END -->` markers — the Playbook page is in the splice list). Gives category
  windows (`catsw`) + a recent task tail for the active brands the moment the page loads.
- **Live + complete + scoped:** `GET /api/playbook` — a server-side crawl that reads the
  cron-warmed `planlive:<id>` caches for every `PLAN_SHEETS` brand **in the caller's access
  scope** (`clientMatch(acc.clients, …)` — a client-scoped signin sees only their brands, the
  owner the full book), deduped by sheet id (shared workbooks flagged). No cold Sheets fetch, so
  it stays fast however many clients are wired. Tasks come back compacted to `{t,o,b,d}`; the
  page reclassifies the text in-browser and merges the full live lists over the baked snapshot
  (shared-workbook brands keep their per-brand baked split).

## The classifier (taxonomy)
The plans carry no category column, and the worker's coarse `classifyCat` (11 buckets) hides
most strategy work in a catch-all `opt`. The Playbook ships its **own richer taxonomy** (16
meeting-facing categories — Custom Labels, Image & Overlays, Titles, Keyword Optimisation,
Descriptions & Highlights, Attributes & Golden Record, Product Type & Taxonomy, Stock & Range,
A/B Testing, Events & Seasonal, Search Intent & Demand, AI-Ready & Conversational, Competitor &
Market Intel, Channels & Markets, Feed Health & Technical, Account & Strategy) with keyword bags
calibrated against the real plan vocabulary (`roundel`, `image cycler`, `hero sizes`, `range
completion`, `OOS`, `EOSS`, `conversational`, `CL0–5`, `bestseller`, `GEO intent`, `AB test`…).
`classify(text)` scores each category by rare-token-weighted keyword hits and picks the top; A/B
tasks get a title/keyword/description flavour where the text says so. `classifyCat` is left
untouched so no other module drifts.

**Editable in-page (⚙ Tune categories):** rename a category, add keywords, or hide one — persisted
to `localStorage` (`fcc-pb-tax`) and applied instantly. (Team-shared KV sync is the fast-follow,
mirroring the Feed Chat question bank.)

## The completion-date caveat (stated on the page)
Project plans carry **no explicit completion timestamp** — the only date is the plan **month
section** a task is filed under (or its Due value). Recency for the 1/3/6/12-month windows is
therefore *by plan date*, the honest best-effort, not a click-date. Lane-based sheets (no month
sections, e.g. Superdry) show all-time only. History has no backfill.

## Cross-pollination logic
An index counts each brand's tasks per category. For the viewed brand, a category surfaces as a
suggestion when **≥2 peer brands** each carry ≥2 tasks in it **and** the viewed brand is absent
or below ~⅓ of the peer average — ranked by peer count × peer volume. Example plays are pulled
from the most-active peer (done first). Only *proposable* categories cross-pollinate (BAU admin —
Account, Feed Health, General — does not).

## Wiring
- Page `docs/FeedSpark_Playbook.html` → imported as a Text module + `'/playbook'` in the worker
  `PAGES` map. Nav link on every nav-bearing page (parity tripwire; canonical =
  `FeedSpark_Workflow.html`). Deep link `/playbook?b=<Brand>` opens straight to a brand.
- Extend the roster by adding the client to `PLAN_SHEETS` (worker) — it then crawls live; add its
  CSV to `tools/plan_exports/` + the `build_plan_tasks.py` list to bake a snapshot too.

## QA
`scratchpad/qa_playbook.js` (Playwright, file:// + `window.fetch` stub — `page.route` does not
intercept file:// fetches): book render, meeting-phrasing search, retrospective checklist +
window toggle, prospective suggestions + → Brief deep-links, taxonomy tuner, live roster union.
Scope filtering rides the shared `clientMatch` (pinned by `tools/test_access.mjs`).
