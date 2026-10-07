# Hobbycraft deck — feedback log

Deck: `docs/Hobbycraft_Strategy_Review_Sep26.html` → `docs/materials/Hobbycraft_Strategy_Review_Sep26.pptx`
(Strategy Review, Sep 2026; 11 chapters; look-back Oct 2025 – Sep 2026; market UK.)

Built on `reference-files/deck-templates/StrategyReview_Reference.pptx` — the same eleven
chapters, in the same order, as the Schuh deck Ray edited and approved on 24 Sep 2026.

## 2026-09-24 — round 0 (first build)

### Sources actually read, and why each mattered

Per the skill's "no evidence of X exists" rule, every source was read before any sentence of
the form "there is no…" was written. Four of the five produced something the others did not.

| Source | What it gave |
| --- | --- |
| `docs/plan_tasks.json` | 222 tracked initiatives, 146 done / 75 open / 1 hold, score 73, eleven lane splits |
| `tools/plan_exports/hobbycraft_projectplan.csv` | Six years of line items (May 2020 →), eight quantified 2020–23 keyword results, the LIA launch step list, the Shopping/Social custom-label architecture |
| **A/B Test Archive tab** (Drive, plan sheet `1oHdo…861fg`) | **Ten measured tests, Jul 2025 – Jan 2026, with impressions and clicks per test.** Reachable via `read_file_content` on the whole workbook and parsing the archive block out of the export — the named-tab limitation did not bite here |
| `docs/reports_hours.json` | 357 tasks, 437.5 h (260 billable / 177.5 absorbed), the monthly shape, the top-20 task mix |
| FeedHero MCP (`client_list`, `audit_issues`, `roas_dashboard`) | 7 live feeds + 153 rules + 4 scrapes; the live audit refreshed the same morning; a year and a 30-day window of Google Ads performance |
| Live GB XML feed (24,464 SKUs, 108 MB, generated 07:30) | Every attribute claim in chapters 05, 06 and 11 |

`search_terms` has no Hobbycraft data (the MCP's client list does not carry the account), so
nothing in the deck claims a search-term read.

### The two traps this account sets, and how the deck handles them

1. **Keyword saturation reads 0% and is wrong.** Optimised keywords land as *repeated*
   `<g:product_type>` elements, not in the numbered `product_type2..10` slots — those are empty
   across the whole feed. 12,266 SKUs (50.1%) carry a readable keyword string; 11,942 carry only
   a 32-character reference code. FeedHero's own audit independently reports 14,151 products
   (52%) with no keywords attached, which agrees. The feed's `fs_data_opti` process flag says
   26.0% and counts something different (products touched by a keyword *batch*). All three
   numbers are in chapter 05, with what each one counts.
2. **Two custom-label slots carry 2018 and 2020 data.** `custom_label_1` and `custom_label_3` are
   rule-driven and sit at 100%. `custom_label_2` (Best Seller, *manual*) reaches 0.5% carrying
   `Bestsellers_Jul20`; `custom_label_4` reaches 3.5% carrying `2018 Priority Lines`. Plan task
   7.2 (Custom Label restructure) is still Open, and the blocker is named in the plan itself —
   GA access to extract the bestseller threshold, open since May. Finding, cause and ask all
   line up, so it is roadmap ask #1 rather than a criticism.

### Judgement calls worth remembering

- **46.1% of titles are byte-identical to the source title — and that is the rule working.**
  The first read looked like "half the catalogue is untouched". Checking the identical cases
  showed 11,223 of 11,267 are branded-supplier products whose source title already leads with
  the brand, so the prepend rule correctly leaves them alone; only 44 own-brand titles are
  unchanged. The deck states the real headroom (length: 1.2% in the 80–120 band at a 47.8-char
  mean), not a false one.
- **The two Christmas tests read −46% and did not lose.** Both were single-group before/after
  reads running 12 Dec → 22 Jan, through the steepest demand drop of the year, with no control.
  Reported as recorded, with the methodology named, and the controlled A/B median (+6.3%
  impressions) given as the number to plan against.
- **Do not quote the dashboard's 1-year ROAS (462%).** Annual spend is consistent with the
  30-day rate; annual conversion value is not (£6.27m against a £1.38m/30-day run), which points
  at the attribution window. The deck uses the 30-day block (£1,375,637 on £127,674, 1,077%) and
  quotes the year for spend and impressions only. Flagged in an `.int-note`.
- **Highlights: 45.7% in the feed vs 19% "zero highlights" in the audit.** The live output feed
  is the headline (13,278 SKUs carry none). The audit reads the product database behind it and
  disagrees, which most likely means the scrape holds highlights the Google feed is not
  emitting — a rule change rather than new scraping work. Flagged to confirm before sending;
  if it holds, roadmap item W2 gets cheaper.

### Exporter fixes this build forced

- **`Emitter.table()` / `Emitter.chart()` ignored `TB_T_NOSUB`.** `rows_per_slide()` measures
  capacity from 1.52in when a slide carries no subtitle, but both emitters drew from 2.02in
  regardless — so the splitter filled the taller box and the emitter drew it in the shorter one.
  Ten body rows ran 0.47in past `TB_BOT` and through the Key Message strip on four slides, with
  `--audit` reporting nothing (it measures text fit, not table geometry). Both now take
  `has_sub` and read one top. A defensive clamp keeps a too-tall table tight rather than over
  the footer.
- **`tools/preview_tmpl.py` crashed on any theme-coloured run.** `r.font.color.type is not None`
  is true for an `MSO_THEME_COLOR`, which then raises on `.rgb` — so the agenda renderer's
  `ACCENT_1` number killed the whole render. `safe_rgb()` falls back to the inherited colour.

### Known previewer limitations (not deck defects)

Table header rows render white-on-white in the PNG preview (the previewer does not apply the
table style's first-row fill) and native charts render as empty space. Both verified correct in
the `.pptx` itself by reading the shapes back.
