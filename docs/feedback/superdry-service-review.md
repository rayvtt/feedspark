# Superdry — Service Review, Sep 2026

Deck: `docs/Superdry_Service_Review_Sep26.html` → `docs/materials/Superdry_Service_Review_Sep26.pptx`

## What Ray asked for

> "the deck needs to be more succinct and more honorable at the Q&A head level. Imagine this is
> more on the marketing side … condensed into seven or eight slides only, to really demonstrate
> value for money"

…then five numbered points: (1) confirm the validity of the existing service, pushing how much
hands-on work is needed to offset assumed AI savings from Matt R, how happy they are, and what
they would take over internally; (2) what we proposed to cut and whether they agreed, and the
impact of losing it; (3) new services — budget, cost to deploy, upside against the savings;
(4) what we are measured on with Matt Roper, whether the DM team have issued KPIs, what the
numbers show and where they can push back; (5) the overall cost/benefit and net impact.

## What shipped

**Eight slides.** Title, six content slides, close. No chapter dividers — a divider costs a whole
slide, and at this length that is a quarter of the deck spent on signposting.

| # | Slide | Ray's point |
|---|---|---|
| 1 | Title | — |
| 2 | The work behind the retainer | 1 — the hands-on argument |
| 3 | What comes out, and what you take on | 1c + 2 — the cut list |
| 4 | What we would add, and what it is worth | 3 — new services |
| 5 | The number we should be judged on | 4 — measurement |
| 6 | The six hardest questions, asked for you | 4b — where they push back |
| 7 | The net position | 5 — cost / benefit |
| 8 | Questions | — |

Export is clean: `still over capacity: 0`, nothing shrunk, no copy cut, no overflow in the
rendered QA pass, `tools/deck_audit.py` green.

## The three arguments the deck rests on

1. **Hands-on work, against the AI-savings assumption.** The eight largest lanes — 2,225 of the
   3,793 hours since June 2022 — each stated with what the task actually is and where a model
   helps versus where it cannot. Category mapping is taxonomy matching, not generation. Data
   field population has no source values to generate from. Rule engineering is engineering
   against a live revenue channel. The one lane named as genuinely reducible is account
   management, which is also the largest cut on the next slide — conceding it is what makes the
   rest of the column credible.
2. **Value for money, stated as a ratio.** 42 hours a month are sold; 84.9 hours a month have
   been delivered for two years (2,036.75 h against 1,008 h contracted, 648 of them never
   charged). It is the subtitle of the net-position slide because it is the strongest number in
   the deck.
3. **Conceding the revenue argument on purpose.** The 966% ROAS is Google Ads' own last-click
   figure and it credits the channel, not the feed — so the deck stops claiming it and proposes
   being measured on controlled A/B (median +9.42% impressions over 13 tests, with a control
   group), catalogue activation and search-term coverage instead. That is the "honorable at
   Q&A-head level" register Ray asked for, and it is the argument Matt Roper's team can
   otherwise win.

## What only Ray can fill in — flagged in `.int-note` panels, stripped from the .pptx

Four of the five points turn on commercial facts no source here holds. Nothing was invented.

- **Slide 3** — how happy Superdry actually is with delivery, what they said they would give up,
  and whether any of the six proposals has already been put to them and answered. No
  satisfaction read or cut proposal exists in the plan, the task log, the reports database or
  the test archive, so the slide is written as *our* proposal, not an agreed position.
- **Slide 4** — no prices and no deploy hours. Nothing reachable holds a Superdry ratecard, a fee
  for any of the five new services, or an answer on budget (CLAUDE.md: defer to Ray on
  commercial variables).
- **Slide 5** — the DM team's KPIs, whether they signed anything, and the exact objection to the
  revenue calculation. The objection is written as the standard attribution one; the panel says
  so and asks Ray to confirm before it goes out. It also flags that offering a holdout test will
  produce a smaller number than 966%, and that cannot be taken back.
- **Slide 7** — the four To scope / To quote cells and their subtotals are the whole commercial
  ask, deliberately empty. The panel also asks Ray to sanity-check the two figures that are
  mine: the **12.5 hours a month** (built from 51-month averages — 388.25 unfunded hours, 443.0
  account-management hours, 74.75 disapproval hours — and assuming reporting cadence halves; if
  it does not, the honest number is nearer 8.5), and the **84.9 hours a month**, which is the
  number most likely to be challenged.

## Sources, all read 29 Sep 2026

Six live output feeds (the before/after is inside the feed: `c:fs_data_original_title` against
`title` — same products, same moment, 29.1 → 83.1 characters on 100% of the UK catalogue),
the FeedSpark reports database over 19 markets (2,846 tasks, 3,793.00 h, lifetime and windowed
client-side because the source ignores its own `from_date`), FeedHero's ROAS dashboard, rule
report, audit and search-term list, the plan workbook's A/B Test Archive (40 tests) and Image
Cycler tab, and `docs/plan_tasks.json`.

## Tooling fixed on the way past

- `tools/preview_tmpl.py` drew every table cell as one unwrapped line, so prose tables rendered
  as overlapping columns running off the slide while the real .pptx was fine — table QA was
  reading a defect that did not exist and could not see one that did. Cells now wrap the way
  `draw_textframe` does, the header band is painted (its fill comes from the table style, which
  python-pptx cannot read back, so white header text was rendering on white), and a cell whose
  wrapped text is taller than its own row is now reported.
- `wrap()` threw `ValueError: can't measure length of multiline text` on any run containing a
  newline, which killed the whole render — reproducible on the shipped Schuh deck. A whitespace
  token carrying a newline is now treated as the line break it is.
- `tools/deck_audit.py` resolved nav anchors against the chapter list only, so a deck with no
  chapter dividers had every one of its anchors reported dead. It now resolves against any
  element id.

**Found by the fixed previewer, not fixed here** (pre-existing, other decks): table cells taller
than their rows in `Hobbycraft_Strategy_Review_Sep26.pptx` and `FCC_Business_Case_Sep26.pptx`,
and three Key Message strips overflowing in `Schuh_Strategy_Review_Sep26.pptx`.
