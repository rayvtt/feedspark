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

## 2026-09-24 — round 3 ("regenerate Agenda slide again? nicely")

### The agenda
- It was eleven identical run-together lines — `01  Review & project recap — 61 of 96 initiatives
  closed · 13 in the last six months` — poured into two body placeholders at one size. That defeats
  the only job a contents page has: being scanned. Nobody reads an agenda; they look for chapter
  seven.
- `Emitter.agenda()` now lays each entry out as the HTML deck does: the number in the **theme
  accent** (`accent1` = `F7941E`, so a re-theme re-colours it), the chapter name bold at 13.5pt
  beside it, the description under them at 10.5pt muted, hanging off the **name** rather than the
  number (a description starting under the number reads as a third column). Filled down the first
  column then the second — reading order — and **both columns sized at one scale**, since an odd
  count leaves the left column one entry longer and sizing each to its own content would render the
  two halves of one list a size apart.

### What the agenda exposed — 1,242 words missing from the decks
Looking at why the agenda subtitle read `Eleven chapters, two sources.` and nothing else: the
one-line strips (`Key Message`, `Subtitle`, …) hold ~121 / ~100 characters, and a paragraph poured
into one kept its **lead sentence and dropped the rest in silence**. On this deck that was twelve
slides, including the sentence stating which of two sources wins when they disagree — the whole
method of the review — plus *"the plan has not been dated past June"*, *"only 0.8% of UK SKUs carry a
third, readable keyword value"* and a market-by-market AI-readiness read.

Three fixes, in order of how general they are:
1. **`--audit` reports it** (`COPY CUT`, naming the slide and the lost sentence). Nothing should
   vanish from a client deck without the build saying so.
2. **A long `.note` is no longer cut.** `key_fits()` takes a trailing note as the Key Message only
   when the *whole* note fits; otherwise it stays in the block list and becomes its own statement
   slide, which holds a paragraph at full size. No rewriting, no loss.
3. **Four section subtitles shortened** — a section subtitle genuinely *is* a one-line strip, so
   that one is editorial. Each keeps one sentence and its point moved into a `.note`.

Measured across every deck in the repo, comparing exported text before and after: **zero tokens
lost, every deck gains copy** — Monsoon 3,718 → 4,053 words, YuMOVE 4,011 → 4,044, Superdry
4,203 → 4,524, Reiss FY25/26 4,567 → 4,952, Reiss Intro 2,345 → 2,513.

**And it caught a stale sentence of mine.** A chapter-7 note still read *"the two tests completed in
the current cycle are separate and neither carries a percentage"* — the pre-rework story, contradicting
the eleven quantified tests now in chapter 4. It had survived the round-1 sweep because it was being
truncated away before the em dash, so it never appeared in the exported deck to be read.

Schuh: 55 slides, `still over capacity: 0`, **`COPY CUT`: nothing**, `deck_audit.py` 0 hard failures.

### Did the skill need updating?
**Yes — done.** SKILL.md Step 6b now states the strips' real character budgets, the rule that a
`.note` should be written for what it says rather than to a budget, that a subtitle is the one case
that stays editorial, and that `--audit` must show `COPY CUT: nothing` as well as
`still over capacity: 0` before a deck ships.

## 2026-09-24 — round 4 (Ray's own edit becomes the Strategy Review template)

Ray sent back `Schuh_Strategy_Review_Sep26_rayreviewed.pptx` — the deck edited end to end, **55
slides down to 31** — and asked for it as the template, plus a review and an agenda that matches
the deck.

### Saved as the reference
- `reference-files/deck-templates/StrategyReview_Reference.pptx` — the deck-type reference every
  future Strategy Review reads before the core template.
- `docs/materials/Schuh_Strategy_Review_Sep26.pptx` replaced, so the dossier serves **his** deck.
- Listed in the Deck Generator's TEMPLATES panel and written up in the template README: what it
  teaches beyond the core template (eight chapters of a marker plus two to four slides; the FCC's
  own modules carrying the evidence; a live dissection as a named chapter; hours allocation as
  client-facing; cut hard).
- **Note the source of truth moved.** Ray's edits exist only in the `.pptx`, so
  `docs/Schuh_Strategy_Review_Sep26.html` is now the pre-review intermediate, not the deck.

### What the review found

**The chapter spine was broken.** Deleting two chapters (Look-back period, Value delivered) left
the markers reading one, two, **four**, five, six, seven, eight — a client counts a missing
chapter three — and Spark AI, which the agenda promised, had no marker at all. Resequenced to a
clean one-to-eight, a Section Marker added for Chapter eight, and the **six cross-references in
body copy repointed** (they still named the old numbers, so "read in full in chapter 04" pointed
at the wrong chapter).

**The agenda described a different deck.** It said "Eleven chapters", listed ten, including
`03 Look-back period` (deleted) and `09 Google conversational attributes` (a slide inside AI
readiness, not a chapter), and mentioned none of Ray's new material. Rebuilt as eight rows
matching the markers exactly, each description naming what the chapter now actually contains —
scheduled work and hours allocation under 01, the A/B archive under 03, the live dissection under
04. A harness assertion would not have caught this: the agenda and the markers were both
internally valid and simply described different decks.

**Copy hidden under a screenshot — three slides.** On 17, 18 and 19 the picture spans 6.5″–13.3″
while the Two-Card Grid's card 2 starts at 7.11″, so card 2 was in the file and invisible. On 18
and 19 it was a leftover heading over an empty body (removed). On **17 it was the real Germany
finding** — DE on a different title engine, IE inheriting UK titles on 99.2% — so that moved into
card 1 where it can be read. Now written into the template README as a rule.

**The A/B story contradicted itself.** Slides 13, 14 and 25 still told the pre-rework "two tests
completed, neither carries a percentage" story while slide 15 — Ray's own new archive screenshot —
says keyword optimisation consistently wins. Corrected to the archive's real read: eleven
quantified tests, keyword optimisation winning seven in nine, **both** title-placement tests
losing to control (−56.79% / −44.62%), which is also why the roadmap changes title *length* rather
than composition.

**Numbers and copy:** `43,492 Live SKUs` on slide 12 against `42,221` on slides 1 and 11 (the
breakdown 21,055 + 10,606 + 10,560 confirms 42,221); slide 19's headline read `53.2% completeness`
copied from slide 18 while its own key message said the content score is 91.6 / 100; `3 marktts`;
a truncated `Germa` column header; `optimisaton`; `roughy`; a stray leading full stop; spacing.

**One unfinished cell:** roadmap W5 read `Carry them on acros` — cut off mid-word. Completed as
"Carry the UK's 3–4-level depth across to DE and IE", consistent with W2 and W7, and flagged for
Ray to confirm or replace.

### Two traps in my own edit, both caught before shipping
1. A substring test (`'acros' in cell.text`) matched **"across"** in W3's workstream name and
   overwrote it. Restored, and every cell rewrite now matches the cell's whole text exactly.
2. Two typos were **split across text runs** (`['3 ', 'marktts']`, `['Germ', 'a']`) so a run-level
   replace changed nothing — and my helper logged "ok" on *finding the cell* rather than on
   changing it, so it reported a fix that had not happened. Fixed at cell level and re-verified by
   reading the saved file back.

### Left alone, deliberately — Ray's voice, not errors
"(let's dissect real-time!)" in the Chapter four title, "we're aiming to hit at least >85 before
Peak/26", "Explore SparkAI", and the `!` emphasis. These are presenter framing he chose; the
first is an in-meeting cue a client can reasonably see.
