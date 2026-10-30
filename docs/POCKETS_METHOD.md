# The Pockets method — spend analysis, one and two attributes at a time

The house method behind `Superdry_Pockets_and_Attributes_v1` (Matt Rogers, 29 Oct 2026),
written up so it can be run for any client and, where the FCC can already do a step,
pointing at the module that does it. **No client figures are recorded here** — the method
is the IP, the numbers live in the client's own deck.

Already run at this shape on three accounts (the thresholds are stated as "the same
proportions as" the earlier two), so it is a house standard, not a one-off.

---

## 1. What the analysis actually is

A Google Ads SKU-level export joined to the client's **output feed** and **master feed**, so
every pound of spend sits next to the attributes of the product that spent it. Then the
catalogue is cut by those attributes and each resulting cell is judged.

Three vocabulary terms do all the work and are worth keeping verbatim:

| Term | Definition |
|---|---|
| **A cut** | The pair of attributes the SKUs are split by (Category × Colour). The grid is the cut. |
| **A pocket** | One cell — every SKU sharing one category and one colour. |
| **Minimums** | ≥25 SKUs and ≥£150 spend before a pocket is judged. Below that, one sale flips the ROAS. |

The deck's structure is then mechanical: Part 1 one attribute at a time, Part 2 two at a
time, Part 3 what to set up in FeedHero. 44 slides, and every one of them answers
"where does spend work and where does it leak".

## 2. The thresholds — the generalisable rule

Everything is **indexed to the account**, never stated raw. That is what lets one template
serve any client and any metric:

| Band | Rule | Worked example: an 1100% / 3.2% account |
|---|---|---|
| Wasted spend | ROAS < **0.65 ×** account | under 750% |
| Star | ROAS > **1.5 ×** account | over 1700% |
| Poor converter | CR < **0.65 ×** account | under 2% |
| Strong converter | CR > **1.5 ×** account | over 5% |
| Too small to judge | under the minimums | — |

`0.65×` and `1.5×` are the house proportions. Set them once, and the bands move with
whatever account you point them at.

## 3. The two-metric thesis — the reason the deck works

> Revenue ROAS is flat across the account. Target-ROAS bidding has evened it out.
> Conversion rate is where the structure is.

This is the single best idea in the deck and it generalises to every account running
smart bidding. The bidder's job is to equalise ROAS, so **ROAS is where the bidder has
already acted and conversion is where it has not**. Consequence: every cut gets *two*
slides, a ROAS view and a CR/CPA view, and the CR view is usually the one that finds
something. Never ship one without the other.

The companion graphic is the **ROAS band histogram** (share of pocket spend per 100-point
band, with the single bid target marked). One picture, and it says: the bidder averages
the account, it does not stop the left tail spending.

## 4. The attribute library — the real IP

Only about half of these are feed columns. The rest are **derived**, and the derivations
are what make the analysis deep rather than obvious:

| From the feed directly | Derived |
|---|---|
| Category (`product_type` department › type › style) | **Markdown depth** (sale vs price, banded) |
| Colour, size, size type | **Margin band** (needs cost; master feed) |
| Material, pattern | **Price band** |
| Price, sale price | **Size availability (SWA)** — share of a style's sizes live |
| | **Product age** from `fs:date_of_birth` |
| | **Season** |
| | **Outlet vs mainline** — read off the link |
| | **Stock units**, **variants per style** (master feed) |
| | **Review rating** (master feed) |
| | **Feed status** — live / excluded / delisted |

**The join is three-way and that matters.** Ads IDs → output feed → master feed. A SKU that
spent money but has since been excluded or delisted still carries attributes from the
master. Roughly a quarter of spend over 90 days went to items no longer live; drop them and
the analysis silently excludes the thing most worth knowing about.

## 5. The two summary graphics worth stealing

**The gap heatmap** (attribute × scope, cell = best option − worst option in index points).
It is a *navigation* slide: it tells the reader which of the twelve attribute slides are
worth turning to, before they turn to any of them. Dark = a wide gap = go and look.

**The indexed bar card.** Account = 1.00; each option a bar with its index and, in grey,
its share of spend. Because everything is indexed, attributes measured on totally
different scales sit on one card and can be compared by eye — and the grey share stops a
reader getting excited about a 1.77 index on 0.4% of spend.

## 6. The output — what the analysis is *for*

Part 3 converts findings into configuration, which is why the deck lands:

- **Spend Optimiser orders** — depth-2 cuts with the floors and bands attached
- **Classifications** to add — each "a plain AND of fields already in the feed"
- **ROAS dashboard aggregations and columns** to add — the cuts that earned a place
- An explicit note on what was tested and found **mild**, so it can stay a filter not an aggregation

That last one is the honesty that makes the rest credible.

---

## 7. What the FCC already does, and the gap

`/breakdown` (docs/BREAKDOWN.md) is most of Part 2 already: any field × any field pivot,
Measure = Google Ads spend / conv. value / ROAS / clicks / impressions / conversions,
Layer and Layer 2, Split by, and an opportunity spotter over every short field.

Four concrete gaps between it and this method:

1. **Window.** `CAT_ADS_PERIODS` is `7_days` and `30_days`. This analysis runs on **90 days**.
   Add `90_days` to the allow-list (the Ads Traffic report is already keyed by period).
2. **The join drops delisted SKUs.** `adsJoin` matches the live feed and keeps unmatched
   spend apart but unattributed. It should fall back to the **master feed** so a delisted
   SKU keeps its attributes — about a quarter of 90-day spend.
3. **The spotter's bands are share-based, not ratio-to-account.** Add the Pockets bands
   (0.65× / 1.5×, floors ≥25 products and ≥ a spend minimum) as a named mode, so a flagged
   cell reads "wasted spend" / "star" in the client's own vocabulary.
4. **No auto-ranked cut scan.** Slide 5 scans *every* pair and ranks them by how much each
   finds. That is the step that turns a pivot tool into an analysis. `spot()` already walks
   the short fields; ranking whole *pairs* by pocket-spend-found is a small extension and
   the highest-value one.

## 8. Where to push the method further

Five things the current version does not do, in the order I would add them:

1. **Floor on conversions, not spend.** £150 is a proxy; in a low-CR pocket it can be three
   orders. Floor on expected conversions and the "too small to judge" state gets sharper.
2. **A third state between judged and too-small.** "Directional" — past the floor, inside
   the noise. Today a pocket is either judged or discarded.
3. **Test whether a two-way pocket is a proxy.** Black men's jackets may be one sub-style.
   When a pocket is flagged, automatically check whether a third attribute explains it,
   and say so. This is the Simpson's-paradox guard the method currently lacks.
4. **State the recovery, not just the leak.** "£Xk of spend at Y% ROAS" is the loss; what a reader
   wants is what that budget returns at the qualifying median. One number, and the whole
   deck becomes a business case.
5. **Split the window in half.** A pocket bad in month one and fixed by month three reads
   as mediocre across 90 days. Flagging movement separates structurally bad from recently
   fixed — and gives the next deck its before/after.

## 9. Design notes

Theme is the **core deck template** exactly (Inter; slate `#0F172A`; orange `#F7941E`), so
anything built this way drops into the standard deck without re-skinning.

The data palette in use, which is worth keeping as the house convention for this analysis:

| Colour | Means |
|---|---|
| `#3B82F6` blue (tints `#EFF6FF` `#BFDBFE` `#60A5FA`) | the data — magnitude, the heatmap ramp |
| `#FFF4E5` orange tint | wasted spend / caution |
| `#059669` green, `#ECFDF5` tint | star / good |
| `#F1F5F9` grey | too small to judge |
| `#F7941E` orange | accent only — never a data colour |
| `#64748B` | muted supporting text, share-of-spend greys |

Slides are **drawn shapes, not placeholders** (200+ shapes on an attribute slide), so they
do not come out of `tools/deck_to_pptx.py`, which populates layouts and never draws. A
generator for this family needs its own python-pptx drawing pass on the same grid:
title `L0.67 T0.42 W12.00`, subtitle `T1.08`, content from `T1.55`, attribute card
`3.90in` wide three-up, row pitch `0.19in`, heatmap cell `1.92 × 0.21` on a `0.27in` pitch.

Every slide carries a **Key message** line in the client's own numbers. That is the rule
worth enforcing above all the others: 44 slides, 44 sentences, each one a finding.
