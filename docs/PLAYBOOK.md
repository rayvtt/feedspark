# Playbook — the AM meeting copilot (Workflow's right-hand rail)

> **Moved, 16 Sep 2026.** The Playbook is no longer a module of its own. Ray: *"Let's elevate the
> workflow like a playbook. The playbook should be part of the workflow module, with an icon next
> to Build Log … Delete the separate playbook module and incorporate it into the workflow as the
> right-hand panel."* `docs/FeedSpark_Playbook.html` is gone; `/playbook` **301s to
> `/workflow?pb=1`**; the Playbook icon now sits beside Activity/Build Log in the module menu on
> every page and opens the rail in place. `GET /api/playbook` is unchanged and still feeds it, and
> the module is no longer separately grantable — it is reachable exactly when `workflow` is.

## The cockpit — two rails, one account

Workflow now opens onto an account cockpit. **Left rail = the retainer read-out**, docked rather
than hovering (Ray: *"right now when you hover over the retainer pop-up, it covers all the tasks
and brands in the workflow, making it less interactive and efficient. Show it only on the
left-hand panel for the workflow module"*) — `docs/hours_widget.html` renders its usual body into
`#fcc-hrs-dock` when a page mounts one, and once docked **hover opens nothing at all**; a click on
an hours dot loads that client into the panel. **Right rail = the Playbook.** Both rails PUSH the
page rather than sit on it; below 1360px only one is open at a time, and below 900px a rail is a
full-width sheet. Both follow the same account, and one client selected in Intake moves them.

Ray also asked that the two panels *"not be too text-heavy"*: every row is one line — a glyph, a
name, a bar and a number — each section carries exactly one muted sentence, and anything longer
lives behind the module link at the foot of the section.

## The three sections (Ray, 16 Sep 2026)

1. **Doing well · not doing.** The brand's plan tasks classified into the strategy taxonomy, split
   three ways: **Landing** (3+ finished and 80%+ through), **Stalling** (2+ tasks, under 60%
   through) and **Not on this account** — a play at least **two** peer brands actually run (2+
   tasks each) that this one carries nothing of. One peer with one task is somebody trying
   something once, not a practice; BAU admin (`tech`, `account`) is never cross-pollinated onto a
   client call. Each gap carries a **→ Brief**.
> **The right rail has two panels (17 Sep 2026).** Ray: *"bring the same new product volume data
> into the Workflow module as well and appears on the right (almost like Retainer) which doesn't
> cover any text of the Workflow module."* **🧭 Review** is the three-section account read below;
> **📦 New products** is the volume data given the whole rail — every wired Shopping feed, each
> market's product-type breakdown open, and the raises with their briefs. Both are the same rail,
> so both push the page and neither covers the board. The tab choice is per device
> (`fcc-ck-tab`).

### The raise — "a certain amount of time passes and a new product needs looking at"

A cohort is raised once products have **piled up past a threshold with no title or keyword work
since**. The obvious rule — age the last complete month's cohort — is a calendar artefact: that
cohort is between 0 and 30 days old *by definition*, so a 30-day threshold would fire on one day a
month and never again. So the raise measures the **backlog**: every arrival month after the month
of the brand's last title/keyword plan task, aged from the oldest of them.

- Default **21 days**, because that is the FCC's own keyword lead time (KWCal `LEAD_DAYS=21`) — a
  backlog older than one lead time has already missed the cycle it belonged in. Chips offer
  14 / 21 / 30 (`fcc-pb-raise`, per device).
- The **running month is never counted** — a part-month is not a finished one.
- Only the last **6 months** count; older than that is a catalogue rewrite, not new-product work,
  and calling it new would inflate the brief.
- A brand with **no plan read** is raised with *"none on record"*, never quietly assumed covered.
- A market can be **both** a collection landing and a backlog — different statements, so it keeps
  both marks.

Each raised market carries **→ Titles** and **→ Keywords**, which open the Workflow composer
prefilled with the cohort, its age and the product-type breakdown, and save through the ordinary
brief path into Intake and the client's Project Plan.

### Where they landed — the product-type breakdown

Per market, from the daily churn history (`volhist.cats`, the first chevron level of each product's
primary `g:product_type`). **This counts products *entering the feed*** — a wider measure than the
first-seen cohort, since a product returning to stock arrives too — so the panel labels it for what
it counts rather than borrowing the cohort's name. Top five plus `Other`; one `/api/volume` call
per market, on demand in Review and filled automatically in the New products panel.

### The two rails are independent

Ray, 17 Sep 2026: *"2 panels button should be independent of each other — when a tab is clicked on
Playbook the Retainer panel popped up again even though [I] clicked ✕ to close."*

`render()` refreshes the docked retainer's contents on every tab click, brand change and 120s poll.
The dock event that carries that refresh was being read as a **request to open**, so the rail
re-appeared each time — and `openRail` persisted it, so the ✕ was undone in the remembered state too.

The dock event now says which calls came from a **click on an hours dot** (`detail.user`), and only
those may open the rail. Everything else — the host re-rendering, the five-minute reload, a posture
save — is housekeeping. The contents still refresh while the rail is closed, so it is current the
moment it is opened again, and each rail keeps its own remembered state (`fcc-ck-l`, `fcc-ck-r`).

### One brand filter, written from both ends

Ray, 17 Sep 2026: *"when the playbook is surfaced, there's a brand filter on top. If the brand is
selected, can the filter also be applied in the intake and vice versa?"*

The **board → panel** direction already existed (`renderClientChips` dispatches `fcc-clients`; the
rail follows when exactly one client is selected). The **panel → board** direction now writes the
same `itState.clients` the chips and the ▾ menu write, through one named entry point
(`window.FCCFilterClient`) — so there is one client filter on the page, not a second that can
disagree with it. Two rules keep it from surprising anyone:

- **Only a real pick propagates.** The rail choosing its own default account when it opens, or
  following the board's own chips, never reaches round and re-filters the board behind the reader.
- **A brand the board does not carry is refused and named.** The filter control self-cleans an
  option that isn't there, so filtering to a brand with no Intake rows would quietly do nothing and
  read as broken; the panel's subtitle says **"not on the board"** instead.

### One way into the composer

Every **→ Brief** in the rail calls `window.FCCBrief` — the same function module deep links
(`/workflow?brief=`) land in. A brief raised here is a brief raised in Workflow: same draft, same
`[ibfcode]` tokens, same save, same row filed into Intake and the plan. (Reloading the page to hand
ourselves a query string would reach the identical function having thrown away the rail, the
board's filters and the scroll position.)

2. **New products.** Arrivals off each Shopping feed's `fs:date_of_birth` histogram
   (`/api/volume/arrivals`), as a share of the live catalogue. **10–20% is a collection landing**
   and is highlighted — Ray's rule verbatim; above 20% is the same signal louder ("major drop"),
   so it is highlighted too rather than falling off the top of the band. The month read is the
   last **complete** one: a part-month makes every account look like it fell off a cliff. A feed
   nobody has scanned says *not scanned* — never 0%.
3. **Golden Record — what is not working.** `/api/golden/estate` (`goldenidx`) per market:
   attributes **missing** from the feed and attributes **present but thin**, kept apart because
   they are different failures, ranked worst-first against Google's spec tiers (required < 99%,
   conditional < 90%, recommended < 60%). The six conversational AI attributes are supplemental by
   design and are never scored as a failure here.

Refresh while the rail is open is every 120s and on tab-visible — "in real time" for a call.

## ⚙ Tune

The strategy taxonomy stays editable (rename / teach it words your plans use / hide), and stays
the **team's**: it rides shared state `pbtax` through `/api/state`, mirrored to `localStorage`
`fcc-pb-tax`. Retiring the editor with the old page would have frozen everyone's categories.

## Harness

`tools/test_playbook_panel.mjs` (qa_gate / presync / validate) lifts the engine out of the page
between its `PBENGINE` markers and pins the judgements — what counts as landing, what "not doing"
is allowed to mean, the 10–20% band's exact edges, which month arrivals read, which attributes
count as not working — plus that the standalone module really went (page deleted, route
redirected, nav swapped on every page, grant folded away).

---

## Original spec (the standalone module, 11 Sep 2026)

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

## One modal at a time

Ray, 17 Sep 2026, on a ticket opened from the Brief ledger: *"what happened to brief ledger
view"*.

Nothing had happened to it. The ledger rendered correctly and the ticket opened correctly — what
Ray was looking at was **two overlays open at once**. The task-edit pop-up has to clear Focus
mode's full-screen overlay, so `.tle-scrim` sits at `z-index: 9500` while every other scrim is
`200`; open both and the 460px edit card paints straight across the middle of the ticket, with the
ticket's left and right edges still visible either side. That reads as a broken page, not as two
windows.

The equal-`z` pairs stack just as badly and less obviously — the later one in the DOM wins, and the
backdrop dims twice. So the rule is now general: **opening any overlay closes the others**.
`soloModal(keep)` sweeps `.scrim.on` rather than naming the overlays it knows about, so a scrim
added later is covered without anyone having to remember this file.

### The one exception, and why it is earned

`closeBrief()` drops the draft's email context (`__emailId`, `__emailIds`) and unpins the client.
Auto-closing the **composer** would therefore silently destroy a half-written brief — a real loss,
where the stacking it would prevent is only cosmetic. Every other overlay is a view of something
already stored and costs nothing to reopen.

So the composer is never closed for someone else, while opening it *does* clear the cheap views
behind it. The asymmetry is deliberate: closing a ticket is free, closing a draft is not.

### Tripwire

`tools/test_modalsolo.mjs` (qa_gate / presync / validate) reads the page and fails if any overlay
opener skips `soloModal`, or names the wrong overlay to keep — the way this bug comes back is a
*seventh* scrim added without the guard, not a regression in the six that have it. It also checks
the exception is still earned, by asserting `closeBrief()` really does discard that context.
