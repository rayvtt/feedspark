# Superdry — 16 keyword focus themes, Oct 2026 → Jan 2027

**Ray, 30 Sep 2026:** *"look at superdry product types and create 4 focus themes for each month from
now till january"*

Seeded as `SEED.Superdry` in `docs/FeedSpark_KWCal.html`. **Unlike every other brand on that board,
nothing here came from the client.** Reiss, Accessorize, YuMOVE and Schuh were each ingested from a
marketing calendar the brand supplied; these sixteen are FeedSpark's own optimisation plan, derived
from two live sources read on **30 Sep 2026**.

---

## Sources

| Source | What was read |
|---|---|
| **Superdry GB Google Shopping output feed** — the FeedHero XML wired in `DEFAULT_FEEDS` (`s2.feedhero.net/output_feeds/gb/superdry_gb/…`), feed generated 2026-09-30 09:48:03 | 88.9 MB, **25,695 live SKUs across 5,726 products** (`g:item_group_id`). Primary `g:product_type`, the repeated `g:product_type` keyword slots, `c:fs_data_opti`, `c:fs_date_of_birth`, `g:custom_label_0`, price/sale price, gender |
| **FeedHero Search Terms report** (`client=superdry_gb`) | 3,105 terms, 4,245,987 traffic, with each term's match against product name / category / description / keywords |
| FeedHero Client List | Superdry is 19 markets; GB is the flagship — 7 live feeds, 221 active rules, `image_optimisation: Yes` |

The full primary-`g:product_type` census is committed beside this file as
**`superdry_gb_product_types_2026-09-30.json`** — 305 distinct paths with products / SKUs /
unkeyworded per path. `tools/test_kwcal_superdry.mjs` asserts every seeded path exists in it and
that every note quotes the count its own scope resolves to. That census is **deliberately an
independent record**: the harness's later section builds a product-type index out of the seed's own
paths, so a mis-spelled path would be looked up under its own mis-spelling and still resolve. The
census is the only thing in the chain the seed cannot influence.

> ⚠️ Note the output feed is **much smaller than the master feed**: `master_feed` reports 58,825
> rows for `superdry_gb`, the Shopping output carries 25,695 SKUs. The output is the one that matters
> here — it is what Google sees, and what Feed Lab, Label Guard and PT Guard all read.

---

## The finding

`c:fs_data_opti` states, per product, what FeedSpark has already done:

| Flag | Y | N |
|---|---|---|
| `T` (title) | 5,726 — 100% | 0 |
| `Cat` (category) | 5,726 — 100% | 0 |
| `IMG` | 5,724 — 100% | 2 |
| **`Keywords`** | **2,245 — 39.2%** | **3,481 — 60.8%** |
| `D` (description) | 0 | 5,726 — 100% |
| `ID` | 0 | 5,726 — 100% |

The keyword slots agree independently: **57.5% of products (3,291) carry no extra
`g:product_type` value at all**, which is 14,738 of 25,695 SKUs. Titles, categories and images are
done; **keywords are the gap**, and that is what these sixteen themes exist to close.

And the demand is not for products Superdry lacks — it is in **words Superdry does not write**:

| Word | Titles containing it (of 5,726) | Demand behind it |
|---|---|---|
| `sweater` | **0** | "cable knit sweater" 3,780/mo · "knit sweater cable" 1,900 · "mens cable knit sweater" 1,300 — **all zero hits**, against 57 real Cable Knit Jumper products |
| `zipper` / `zipped` | **0** | "hoodies zipper for men" 3,600 · "hoodie zipper womens" 1,600 · "ladies zipped hoodie" 1,300 — **all zero hits**, against 150 Zip Hoodies |
| `longline` | **0** (36 products carry it in `product_type`) | "longline puffer coat" 6,120 at 100% title miss · "long line puffer coat" 1,600 zero hits |
| `overcoat` | **0** | "long overcoat womens" 3,600 — zero hits |
| `letterman` | **0** | "letterman jacket ladies" 1,600 · "mens varsity letterman jacket" 3,600 at 100% title miss |
| `christmas` / `festive` / `fair isle` | **0** | "mens christmas jumpers" 1,900 — zero hits (and the taxonomy already has a *Fairisle Jumper* type) |
| `winter` | **35** (0.6%) | "mens winter jackets" 15,000 · "winter coat" 14,800 · "winter jacket" 9,900 |
| `warm` | 4 | "warm jackets for men" 2,400 — zero hits |
| `waterproof` | 6 | "jacket womens waterproof" 4,400 |
| `thermal`, `windproof`, `parker` | **0** | "parker coat" 1,900 + "parker jacket" 1,470 — zero hits (a misspelling of *parka*, which is in 61 titles) |

Search-terms report buckets: **313 terms return zero hits (31%)**, 578 are absent from the titles
(58%), 729 have no exact match (73%), 235 are "mis-titled products".

The other systemic gap is **phrasing**. `"jackets for men"` alone is 14,800/mo at **100% title
miss**; so are `"jumpers for men"` 4,540, `"mens jackets uk"` 4,400, `"mens coats uk"` 4,400,
`"mens casual jackets"` 4,400. The informal registers return nothing at all: `guys`, `male`,
`female`, `ladies`.

---

## The sixteen themes

**How they are dated.** `date` is the **live-by** date; the board buckets a moment by its
**brief-by** date (live − `LEAD_DAYS`, 21 days), because KWCal is a *work* schedule — it answers
"what do we raise this month". So "four a month" is **four per work month: Oct 2026 → Jan 2027**,
the earliest briefing on 1 Oct and nothing born overdue. Dated on live-by alone, three October
themes fell into the September column with their brief-by already in the past. The four
season-locked themes still go live in their own season and simply brief a month ahead, which is
correct: Christmas jumpers live 5 Nov, Black Friday language 20 Nov (the day itself is Fri 27 Nov),
gifting 30 Nov, the end-of-season sale on Boxing Day.

Scope figures are the seeded product-type paths' own totals, from the census.

### Briefed in October 2026 — the season turns; outerwear demand is at its peak
| # | Theme | Lane | Brief | Live | Scope | Unkeyworded |
|---|---|---|---|---|---|---|
| 1 | Winter outerwear intent | Seasonal focus | 1 Oct | 22 Oct | 40 paths · 956 products | 366 (38%) |
| 2 | "Jackets for men" — phrasing sweep | Catalogue sweep | 8 Oct | 29 Oct | whole catalogue | 3,291 (57.5%) |
| 3 | Festive knitwear — Christmas jumpers | Seasonal focus | 15 Oct | 5 Nov | 9 paths · 301 | 252 (84%) |
| 4 | Black Friday — sale discoverability | Promotion | 30 Oct | 20 Nov | whole catalogue | 1,314 of 2,716 SALE |

### Briefed in November 2026 — knitwear, gifting, the cold snap
| # | Theme | Lane | Brief | Live | Scope | Unkeyworded |
|---|---|---|---|---|---|---|
| 5 | Knitwear — the "sweater" gap | Vocabulary gap | 2 Nov | 23 Nov | 15 paths · 500 | 443 (89%) |
| 6 | Gifting & stocking fillers | Seasonal focus | 9 Nov | 30 Nov | 20 paths · 417 | 319 (76%) |
| 7 | Longline, puffer & padded length | Vocabulary gap | 16 Nov | 7 Dec | 8 paths · 325 | 103 (32%) |
| 8 | Winter accessories — beanies, gloves, scarves | Seasonal focus | 23 Nov | 14 Dec | 9 paths · 196 | 140 (71%) |

### Briefed in December 2026 — the biggest gap, then the sale
| # | Theme | Lane | Brief | Live | Scope | Unkeyworded |
|---|---|---|---|---|---|---|
| 9 | Hoodie vocabulary — zipper, zipped, oversized | Vocabulary gap | 1 Dec | 22 Dec | 15 paths · 766 | **693 (90%)** |
| 10 | End-of-season sale | Promotion | 5 Dec | 26 Dec | whole catalogue | — |
| 11 | Fleece, borg & sherpa warmth | Seasonal focus | 14 Dec | 4 Jan | 3 paths · 80 | 56 (70%) |
| 12 | Loungewear & joggers | Vocabulary gap | 21 Dec | 11 Jan | 31 paths · 339 | 173 (51%) |

### Briefed in January 2027 — new season, and the backlog
| # | Theme | Lane | Brief | Live | Scope | Unkeyworded |
|---|---|---|---|---|---|---|
| 13 | New-in backlog — everything since July | Catalogue sweep | 4 Jan | 25 Jan | *set from the Playbook* | 899 of 970 (93%) |
| 14 | Layering — long sleeve, checked & overshirts | Catalogue sweep | 11 Jan | 1 Feb | 18 paths · 457 | 368 (81%) |
| 15 | Varsity, letterman & baseball | Vocabulary gap | 18 Jan | 8 Feb | 7 paths · 147 | 48 (33%) |
| 16 | Fit vocabulary — oversized, relaxed, baggy | Vocabulary gap | 25 Jan | 15 Feb | *set with text filters* | — |

**Lanes are renamed for this brand** (`LANE_NAMES.Superdry`). These are not marketing moments, so
the lane says what *kind* of work a theme is: Seasonal focus / Vocabulary gap / Catalogue sweep /
Promotion. The lane **keys** are untouched, so colours, stored events and ticket-matching are
unaffected.

**Order of play.** The two biggest wins lead: winter outerwear intent (the largest demand cluster
in the account, against a word in 0.6% of titles) and the phrasing sweep (~45k/mo of traffic at
100% title miss). The hoodie gap — the single worst-covered category, 693 of 766 products — sits in
December because it is the largest *body* of work, not the most urgent.

## Judgement calls

- **Scope is seeded, and it is GB only.** Eleven themes carry the exact primary `g:product_type`
  paths read off the live GB feed, so a theme arrives measurable rather than empty. The analysis was
  GB, so **no other market is scoped** — switching the board to DE or FR shows no scope rather than
  a borrowed one. No theme pins a market (`e.mkt`) and none carries a `ptsm` map.
- **Paths under 3 products are left out of a scope.** 138 distinct paths are seeded; the excluded
  tail inside those categories is **85 paths / 125 products** — long-tail one-offs whose inclusion
  would triple the picker's list for ~2% more volume. This is why each note quotes its *scope's*
  figure (956) rather than its category's (984); a card contradicting its own button is worse than a
  slightly smaller number.
- **Two themes are deliberately left unscoped**, and each says why. *New-in backlog* is an arrival
  cohort and KWCal scopes on product types, not dates — it is set from the Playbook's New products
  panel (→ Keywords), which reads the same `fs:date_of_birth` cohort. *Fit vocabulary* cuts across
  every category, so it wants the picker's **text** filters; a product-type scope would either miss
  most of it or swallow the catalogue.
- **Three themes are brand-wide** — the two sale windows and the phrasing sweep — because each
  genuinely applies to the whole catalogue.
- **Out of window, deliberately:** the search-terms report carries real spring/summer demand
  ("hawaiian shirts for men" 2,900, "ladies tropical shirts" 1,600, "cargo shorts mens" 5,400,
  "mens bathing shorts" 1,300, "baggy jeans female" 1,900, "white midriff top" 1,900). None of it
  belongs in an Oct–Jan plan; it is the obvious start for Feb–Apr.
- **Excluded as not product demand:** store-locator queries with real traffic — "gatwick north"
  3,600, "stores in gatwick north terminal" 2,400, "gatwick north terminal stores" 1,600, "shops in
  leamington spa" 1,600, "outlet york" 1,300, "grays lakeside" 1,300. A feed cannot answer these.
- **Biggest categories left out of all sixteen:** T-Shirts (only 18% unkeyworded — largely done
  already), Vest/Cami Tops, Dresses and Skirts (20% unkeyworded), Swimwear, Shorts. Not neglect:
  they are either already covered or out of season.

---

## Product_type data quality — a separate finding, NOT a keyword theme

The census turned up splits in the primary `g:product_type` values. **PMAX listing groups key on
the exact value**, so these split one type into two groups:

| Split | Counts |
|---|---|
| `Half Zip Sweats` vs `Half zip Sweats` (case) | 22 vs 19 products, across three branches — Men's Jumpers, Men's and Women's Hoodies and Sweatshirts |
| `Trousers` vs `Trouser` (level 2) | 196 vs 7 |
| `Graphic T-Shirt` vs `Graphic T-Shirts` | 374 vs 5 |
| `Sweatshirt` vs `Sweatshirts` | 266 vs 5 |

Also worth a look: `Women > Clothing > Jumpers > Sweatshirt` (5 products) files a sweatshirt under
Jumpers, and `Classic Joggers` appears under both `Joggers` and `Trousers`.

**This is a Product Type Guard job, not a keyword theme**, so nothing here was seeded for it. But
the two scopes that *contain* a split path carry **both spellings** — otherwise the scope silently
drops products — and `tools/test_kwcal_superdry.mjs` asserts that.

Other feed observations, for whoever picks these up:
- **Depth:** 87.1% of products sit at 4-level paths, 12.7% at 3 — a healthy tree, well above the
  30–40%-at-5-levels standard PT Guard measures against, though nothing reaches 5.
- **Sale mix:** 47.4% of the catalogue is `custom_label_0: SALE` on 30 Sep — before Black Friday.
- **Arrivals:** 438 products first seen in Sep 2026, 249 in Aug, 283 in Jul. **85% of everything
  that arrived in the last six months is unkeyworded** — new product is the one cohort guaranteed to
  be uncovered, because nothing has been run over it yet.
- `Fairisle Jumper` exists as a product type (3 products) while "fair isle" appears in no title —
  the festive vocabulary is already in the taxonomy and missing from the copy.
