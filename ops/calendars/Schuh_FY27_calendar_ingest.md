# Schuh — Customer Marketing Calendar FY27 ingest
**Source:** `Customer_Marketing_Calendar_FY27.xlsx` · tab `FY27` · 28 Dec 2025 – 30 Jan 2027
**For:** Keyword Calendar (`/kwcal`) · Schuh · GB (and IE — see §5)
**Prepared:** 22 September 2026 · FeedSpark · Private & Confidential
**Ask:** Ray — *"Schuh's marketing calendar - import anyhting from Aug/26 onwards"*

---

## 1. What the workbook is

Two tabs.

**`FY27`** is the merchandising calendar and the only one imported. It is a **day-column grid**:
column B is Sunday 28 Dec 2025 and every column after it is one more day, out to 30 Jan 2027
(399 columns). Down the left are ~20 stacked lanes — pay days, buyer trends, brand and category
search forecasts, headlines, promotions, Schuh's own campaigns, brand partnerships, new brands,
events, retail takeovers, staff incentives and the shoot schedule. **Each activity is a merged
block** spanning the days it runs.

**`SM Content Calender`** is the social team's content log — cultural dates with the Instagram and
TikTok posts made against them. Not imported (§6).

## 2. The date mapping is the sheet's own, and it checks out

Column → date was derived once (col B = 2025-12-28, +1 day per column) and then **verified against
the sheet itself**:

| check | result |
|---|---|
| all 57 `W/C SUNDAY` dates in row 3 | 57/57 agree, 0 mismatches |
| all 399 day letters in row 4 (S M T W T F S) | 399/399 agree |
| the 23 weekdays cells state in words ("Monday, 27th July", "Ends: Sat. 12th Dec.") | **22/23** agree with the real 2026/27 calendar |

The one exception is an **end** date, not a start: the Jan-2027 student promo says *"Ends: Sun.
25th Jan."* but 25 Jan 2027 is a Monday and the grid block ends Sat 24 Jan. It is flagged on
`sch_refresher` and it does not move that moment, whose start (Fri 15 Jan) is stated and correct.

**This is a genuine 2026 calendar** — unlike the Accessorize workbook, whose key-dates row turned
out to be carried over from 2024. Nothing here needed correcting.

## 3. Where a cell names its own date, that date wins

The merged block is a content window drawn to fit the row; several cells also name the launch
outright ("20.8", "7.10", "16th Sept."). The named date is what the merchandiser wrote, so it is
the moment's date and the block is reported in the note. Five differ by more than a day:

| moment | cell says | grid block | used |
|---|---|---|---|
| Nike Kids — Moto & P-6000 | 27.7 | 5 Jul – 1 Aug | **27 Jul** |
| Converse RS Crush | 6.8 (embargo) | 11 – 22 Aug | **6 Aug** |
| UGG Evelina Clog launch | 20.8 | 23 Aug – 10 Sep | **20 Aug** |
| Student Nights | 16th Sept. – 8th Oct. | 17 Sep – 8 Oct | **16 Sep** |
| New Balance Abzorb 2010 | 26.10 | 25 Oct – 21 Nov | **26 Oct** |

## 4. What was imported — 40 moments, four lanes, four row-groups

The rule: **everything whose block touches 1 Aug 2026 or later**, dated at its own start. A moment
that opened earlier (both Back to School campaigns, the bundling offer, Nike Kids, Kickers) is kept
rather than dropped for starting in July, and its note says so.

| lane | workbook rows | n | what it is |
|---|---|---|---|
| `sale` → **Promotion** | PROMOTIONS (17–18) | 9 | BTS bundling, Student 20%, Student Nights, MSS, 30% off selected, Black Friday, B1G£10, Winter Sale, Student Re-fresher |
| `campaign` → **Schuh campaign** | SCHUH CAMPAIGNS · Full Price (21–22) | 4 | BTS Scotland, BTS Rest of UK & ROI, AW'26, Festive Peak |
| `studio` → **Brand launch** | BRAND PARTNERSHIP CAMPAIGNS (26–32) + NEW BRANDS (33) | 20 | Nike, Kickers, Converse, Keen, UGG ×2, adidas ×3, Dr. Martens, Crocs, Timberland, Vans ×2, New Balance + Sperry ×2, Blundstone, Caterpillar |
| `location` → **Search peak** | BRAND SEARCHES (10–12) + CATEGORY SEARCH TERMS (13) | 7 | the calendar's own weekly demand forecast, one moment per week rather than one per brand word |

Seven are `brandwide` (the catalogue-wide offers). Two sale moments are deliberately **not**
brandwide: BTS Bundling is scoped to the school range, and "up to 30% off selected lines" is left
unscoped because the calendar never says which lines — better an unset scope the AM must fill than
a brand-wide count that overstates it.

The four lane keys are unchanged; only their **display names** are Schuh's (`LANE_NAMES` in
`docs/FeedSpark_KWCal.html`), because "a studio moment" is the wrong phrase for a Nike drop.

## 5. The finding: the demand forecast is out of phase with the launches

The `location` lane is a **forecast, not a commitment** — it is what Schuh's own calendar predicts
people will search, and it mostly does not line up with when the brand is actually being pushed:

- **Crocs** peaks w/c 9 Aug; the Crocs campaign opens **23 Sep** — six weeks later.
- **Dr. Martens** peaks w/c 16 Aug *and* w/c 27 Sep; Dr. Martens Buzz runs 7–22 Sep, between them.
- **Timberland** peaks w/c 20 Sep; the A/W campaign opens **7 Oct**.
- **UGG** peaks w/c 20 Sep; the Heritage Pack lands **19 Oct**.
- **Puma** peaks w/c 30 Aug and carries **no activity anywhere in FY27**.
- Only **Converse** (peak w/c 2 Aug, embargo 6 Aug) and the **clogs second peak** (w/c 23 Aug, UGG
  Evelina 20 Aug) are in step.

Feed keyword work does not need the campaign to be live, so these weeks are briefable on their own.

**Markets:** this is a **UK & ROI** calendar — £/€ pricing, ROI bank holidays, "Rest of the UK &
ROI". Nothing in it is German. No moment pins a market, so they all follow the board; **do not
brief Schuh DE off this calendar.** The board shows GB / DE / IE and notes the 3 Meta feeds it
excludes (keywords land in numbered `g:product_type` slots, which the Meta spec has no room for).

## 6. What was NOT imported, and why

| left out | reason |
|---|---|
| GENERAL CALENDAR DATES (pay days, bank holidays, half-term) | not marketing moments |
| DO MORE GOOD (Ambitious about Autism BTS, Future You, Black History Month, Disability History Month, Do More Good Wrapped) | purpose and charity activity, no product scope |
| EVENTS / ACTIVATIONS (Keen x Common Ground, Last Dance of Summer, LFW appointments, AW26 Sonderhaus, adidas relaunch, Say It With Your Chess, Future You, NB 2010 Abzorb, Converse Xmas, Leeds WR store openings) | physical retail; the feed-facing half of the Keen one **is** imported as its content roll-out |
| SCHUH CAMPAIGNS row 23 — Manchester Community Window installs 3–6 | a physical store window |
| EXTERNAL / INTERNAL SHOOTS (Peak pre-production and shoot, Nike Kids shoot, AW shoot) | production schedule |
| "NB ALWAYS ON S2" (row 32) | the cell itself states NO FIXED LAUNCH DATE — nothing to schedule against |
| "Proud Trust" (row 26, 21–24 Dec) | a charity partnership, not a product launch |
| Summer Sale (row 17) | opened 17 Jun, closed 2 Aug; all seven of its markdown phases are dated June or July |
| tab `SM Content Calender` | the social team's log. Its Aug-2026-onward rows are bare cultural dates — A-level (20 Aug) and GCSE (27 Aug) results days, Reading & Leeds, Notting Hill Carnival, Halloween, Bonfire Night, Cyber Monday — with no content planned against them. Several are real footwear demand moments; say the word and they go on the board. |

Rows 7–9 (buyer trends, predicted trends), 14–16 (secondary category terms, headlines), 19–20,
25, 36–43 (retail takeovers, staff incentives) and 45–51 carry **nothing** dated Aug 2026 or later.

## 7. How to load it

Already seeded in the page — `SEED.Schuh` in `docs/FeedSpark_KWCal.html`, applied by `applySeeds()`
when KV has no Schuh record, exactly like Reiss, Accessorize and YuMOVE. `Schuh_FY27_kwcal_import.json`
beside this file is the same 40 moments in the ✎ Edit calendar → Import shape, for a re-import or
for loading onto another board.
