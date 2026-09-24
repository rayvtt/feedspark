# Schuh deck — feedback log

Deck: `docs/Schuh_Strategy_Review_Sep26.html` → `docs/materials/Schuh_Strategy_Review_Sep26.pptx`
(Strategy Review, Sep 2026; 11 chapters; look-back Apr–Sep 2026; markets UK / Germany / Ireland.)

## 2026-09-24 — round 1 (first build, three notes in one pass)

### Chapters 01–02 — "merged slide 5, 6, 7 to be more compact and not wasting space"
- Correct. Chapter 1 spent a whole slide on four numbers (96 tracked / 61 closed / 34 open /
  1 on hold) and the next two on the table those numbers describe — three slides for one fact
  set.
- Fixed generally, not by hand: `tools/deck_to_pptx.py` gains `kpi_line()`. A `.stats` KPI card
  row sitting immediately before a table or bar block, where that block carries no subtitle of
  its own, is folded into the block's subtitle
  (`61 Closed to date · 34 Open · 1 On hold · 96 Tracked initiatives`). Guarded: at least three
  cards, short headings (≤12 chars), single-line bodies (≤34 chars), and only where it is not
  displacing a real subtitle. Chapter 1: three content slides → two.
- Second fix this exposed: a block-level `.note` was emitted on **every** continuation slide of a
  split table or card grid. It now rides the **last** chunk only (`table`, `bars`, `emit_cards`).

### Chapter 03 — "slide [New Products] take chart from volume module on FCC — shown in for all markets of that client"
- The chapter read one market. Rebuilt as a months × markets table — Apr–Sep 2026 down the rows,
  UK / Germany / Ireland / All markets across, then Live catalogue, ≈ per month, ≈ per quarter,
  ≈ per year — with a KPI subtitle
  (`43,492 Live SKUs · 2,353 New per month · 7,060 New per quarter · 28,240 New per year`).
- Read on the **same basis `/volume` uses** so the deck and the module can never quote two
  different rates: survivors-only by `fs_date_of_birth`, last 12 **complete** months ÷ 12
  (× 3, × 12), running month excluded. Checked against the module's own estate table in Ray's
  screenshot — DE ≈560/mo vs its ≈560, IE ≈557/mo vs its ≈557.

### Chapter 04 — "slide [number of wins] — why dont you take the screenshot from AB Test Archive and details out a little bit (all in 1 page)"
- **My error, not a preference.** The chapter said *"No quantified uplift figure exists anywhere in
  Schuh's plan or task log"*, and carried an `.int-note` saying so. That was true of the project
  plan and **wrong about the account** — the FCC's A/B Test Archive holds eleven quantified tests
  for Schuh. I had read one source and generalised from it.
- Rebuilt around the archive: one 11-row table (nine keyword tests plus a combined title-placement
  row) with the metric, the market and the read, then three cards — seven wins in nine keyword
  tests, median **+14.0%** impressions; sandals at 25% off at **+632%**, flagged as compounding with
  a discount and never to be quoted as typical; **both title tests lost** to control
  (−56.79%, −44.62%).
- Fitting all eleven rows on one page needed the third export fix: table capacity is now
  subtitle-aware (`TB_T_NOSUB = 1.52` vs `TB_T = 2.02`), so a table with no subtitle fits ten rows
  rather than eight.
- Four downstream contradictions the rewrite left behind, all corrected in the same pass: the
  agenda row for 04, the chapter 7 opener, chapter 7's closing card, and the W9 roadmap row —
  each still telling the old "two tests, no quantified read" story.

### Figures
Every feed number refreshed against a fresh 24-Sep pull (GB 21,718 / DE 10,886 / IE 10,888 =
43,492 live SKUs), followed by an explicit stale-figure grep sweep — clean.
`deck_audit.py`: **0 hard failures**, 12 review candidates, all adjudicated as false positives
(GTIN 95.9% vs highlights-absent 90.1% are different measures; every cross-reference points where
the prose means). One wording nit taken: *"chapter 05 changes title length"* → *"points at"*, since
chapter 5 measures the MASK band rather than changing anything.

### Did the skill need updating?
**Yes — done.** All three export fixes generalise and are in `tools/deck_to_pptx.py`, so every
future deck gets them with no per-deck work:
1. `kpi_line()` — a KPI row folds into the following table's subtitle instead of taking a slide.
2. Notes on the last continuation chunk only.
3. Subtitle-aware table capacity (10 rows without a subtitle, 8 with).

The fourth lesson is a **source rule**, added to the generator skill: *a claim that no evidence
exists must be read across every source the FCC holds for that account — the project plan, the
task log AND the A/B Test Archive — never generalised from one.* This is the second time a
"nothing here" statement has been the defect rather than the finding.

## 2026-09-24 — round 2 ("i still dont see screenshots nicely done from FCC in the deck?")

- **Correct, and the cause was structural, not an oversight in this deck.** `deck_to_pptx.py` had
  **no chart component at all**: every `.bars` block and every hand-built chart panel was read for
  its numbers and emitted through `em.table`. So both round-1 asks — the Volume module chart and the
  A/B archive — could only ever come out as tables of the same numbers, in this deck and in every
  deck before it. I should have said so at the time instead of shipping tables against a request for
  charts.
- Built `Emitter.chart()`: a **native PowerPoint chart** (`add_chart`, own embedded worksheet,
  clickable / editable / restylable), placed in the same column the native tables occupy. Not a
  breach of "never add a shape" — that rule forbids faking a layout out of rectangles and textboxes;
  a chart is data, not a text frame, and no placeholder can hold one.
- Opt-in lives **on the table** (`data-chart`, `-series`, `-cats`, `-pct`, `-table`, plus
  `data-chart-skip` / `data-chart-cat` per row), so the chart is built from the table's own cells and
  the two can never disagree.
- Schuh now carries two real charts:
  · **ch3** — clustered columns, six months × UK / Germany / Ireland, KPI strip as the subtitle, the
    running month labelled "Sep (part month)" the way `/volume` flags it. Run-rate and live-catalogue
    rows stay in the table and out of the plot: they are derived from the months above them, so
    plotting them alongside would draw the same products twice at two scales.
  · **ch4** — horizontal bars, the nine keyword tests by impressions uplift, direct value labels.
    The two title tests are `data-chart-skip` — a different intervention on a different field, so
    they are not plotted on an axis labelled "keyword optimisation"; they stay in the table and keep
    their own card.

### Three bugs this surfaced, each fixed and each older than this round
1. **The real minus sign.** The decks write U+2212, not a hyphen, so a naive `startswith("-")` would
   have plotted every loss as a win. Normalised before parsing.
2. **A section-level `<h3>`/`<h4>` was silently dropped** by the parser — it matched neither
   `classify` nor the descend-into test — which is why a chart could not be named and inherited the
   chapter title with "(cont.)" after it. Now emitted as a `heading` block, deliberately a different
   kind from `subhead`: a component's own lead label (a bars chart's caption) has always titled its
   slide and is the better title, so a heading never displaces it, and on a section's first slide the
   heading becomes the subtitle rather than taking the title that appears in the agenda and the nav.
3. **A `subhead` swallowed the note after it.** The trailing-note-becomes-Key-Message rule ran before
   the kind was known, and a subhead emits no slide — so the note was consumed and then dropped. A
   YuMOVE spec note disappeared exactly this way, found by diffing every existing deck's export
   before and after the change.

Regression check: Monsoon, Superdry and Reiss (×2) export **byte-identical** slide text; YuMOVE and
Reiss FY25/26 each gain one subtitle that was previously being thrown away. Nothing displaced,
nothing lost. Schuh: 45 slides, `still over capacity: 0`, `deck_audit.py` 0 hard failures.

### Did the skill need updating?
**Yes — done.** The chart component, its attributes, the three judgement rules it exists to let you
exercise (never plot a total beside its own parts, never mix two interventions on one axis, full name
in the table and a short label on the axis) and the heading rule are all in SKILL.md Step 6b.
