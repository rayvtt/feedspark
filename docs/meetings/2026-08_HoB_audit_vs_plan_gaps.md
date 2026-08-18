# House of Bruar — audit recommendations vs project plan

**Sources.** Audit: `House_of_Bruar_Audit_March_2026_Draft.pdf` (34 pages, text extracted in full).
Plan: Google Sheet `1lgO-SrzWtHmsvKRXg2Xgzq3d7fCwv5V2Fauu6pJgYOA` — "House of Bruar - Project Plan/
Onboarding Plan - FH", read via Drive on 18 Aug 2026.

## What the plan already covers

| Plan task | Status | Audit rec it answers |
|---|---|---|
| Main MASK — `[Brand] [Material] [Pattern] [Item Type], [BColor]/[SColor], in [Size:]` | In Progress, 24/08 | Title optimisation (99% un-optimised), size/colour in title |
| UK A/B Title Test — `[Brand]` position, initial vs end | In Progress, 26/08 | Title structure testing |
| Keywords Optimisation (Knitwear) → filter using PT | Briefed, 10/08 | Exact-match keyword gaps |
| Keywords Optimisation (Accessories > Bags) → filter using PT | Done, 10/08 | Exact-match keyword gaps |
| Keyword Optimisation (standing) | to set-up | Exact-match keyword gaps |
| Data field and title optimisation | to set-up, 21/08 | Attribute enrichment (generic — see gaps) |
| PT value monitoring from source feed | Done | Product-type drift (monitoring only, not restructure) |
| Disapprovals | Done | GMC disapprovals (generic — see gaps) |
| UK CL0 (Sale) / CL1 (gender) / CL3 (brand) | Done | — **this is the structure the audit says to replace** |
| List of exclusion logic from HoB | Done | Stock/range exclusion |
| Onboarding: grant GMC+Ads access, set up US feed, filter out-of-stock, connect master feed, tech deep dive | mixed | Audit "Technical Onboarding, weeks 1–2" |
| Item Group ID — colours | **Open, footwear only** | Variant grouping (partial) |
| Account monitoring / general AM / client call | to set-up | — |

## Gaps — recommended in the audit, no task in the plan

### A. Categories & identifiers (highest impact, nothing scheduled)

1. **Product Type / GPC restructure.** Audit: 100% of product types require optimisation; split,
   shallow and inconsistent categorisation; p8 shows the target mapping (`Ladies' Knitwear` →
   `Clothing & Accessories > Clothing > Outerwear > Coats & Jackets`). Plan only *monitors* PT
   values — there is no restructure task.
2. **GTIN population** for third-party brands (98% missing) — audit p34.
3. **MPN uniqueness per variant** (97% duplicated) — audit p34.
4. **Brand mapping to actual manufacturer** for third-party items — audit p34.

### B. Attribute enrichment (plan has one generic "data field" line covering all of this)

5. **Product highlights** — 100% missing.
6. **Pattern** — 98% missing.
7. **Colour normalisation** — non-standard values (`Apple`, `Summer Blooms`, `Black Leather`).
   Also the root cause of the GMC "missing colour" disapprovals on p15.
8. **Material normalisation** — inconsistent/overly descriptive (`Organic, 100% Linen Fit: Slim`).
9. **Size → real dimensions** — replace generic sizes with `25L`, `18.5 inches`, `9x10.5x8.5cm`.
10. **age_group / gender correction** — audit p31, products misclassified.

### C. Variants

11. **Variant-level URL signals** — all sizes/colours share one URL, so Google cannot differentiate.
12. **Missing variants not in the feed.**
13. **Duplicate titles across SKUs** (93%) — the MASK may resolve this, but nothing verifies it.
14. **Item Group ID beyond footwear** — the plan's Item Group ID row is Open and scoped to
    Footwear (Women/Children/Men) only.

### D. Custom labels — the largest single gap

15. **Full CL restructure.** The audit dedicates two slides (p14, p33) to replacing the current
    setup with six strategies: **Lifecycle** (New-in/Bestseller/Clearance), **Margin Tier**,
    **Promo** (Full Price/On Sale/Discount), **Seasonal** (A/W, S/S, All-Year), **Product
    Priority** (Hero/Support/Long Tail), **Delivery Tier**. The plan's CL work is Done as
    gender/brand/sale — precisely the structure p33 criticises as "too simplistic" and
    "overlapping". No restructure task exists.

### E. Imagery (nothing in the plan)

16. **Image cycling strategy** — portrait images being cropped by Google, repetitive image types,
    missing product-only / on-model / additional images.
17. **Image A/B testing for HoB.** The plan's "Image Testing" tab holds *schuh* results
    (`Notes (schuh)`), not HoB tests.
18. **Google dynamic image overlays** — audit p12, quoted +20% CR.
19. **Meta DPA overlays** — audit p13, quoted +77% ROAS / +93% revenue.

### F. Localisation

20. **US localisation** — mixed UK/US terminology (`Pants vs Trousers`, `Sneakers vs Trainers`).
21. **DE feed localisation** — currently *entirely in English*.
22. **Market coverage mismatch.** Audit names 6 live GMC markets — UK, US, CA, **NZ**, AU, **DE**.
    The plan's market table lists UK, US, Australia, Canada, **EU**. NZ and DE appear nowhere in
    the plan; "EU" is not a market the audit recognises. Worth reconciling before either document
    goes to the client.

### G. GMC technical issues named on p15 but not scheduled

23. **Policy flags** — Prescription Drugs, Guns & Parts.
24. **Price mismatch** between website and feed.
25. **Product pages unavailable / not crawlable.**
26. **Product highlights exceeding character limits.**

(The plan's single "Disapprovals" line is marked Done and set up as monitoring — it does not
address these specific structural causes.)

### H. Commercial / growth recommendations with no plan entry

27. **Zombie SKU activation** — 33.6% of own-brand SKUs not contributing; 40–47% zombie SKUs
    across brands (audit p7). This is the audit's own "largest untapped opportunity" and has no
    corresponding task.
28. **Organic / free listings + AI-driven Shopping readiness** — audit p6.
29. **Weekly product reporting** — audit p24.
30. **Landing page optimisation** — audit p24.
31. **AI enrichment pipeline** — the audit's four-stage AI approach (p19: AI setup → controlled-volume
    optimisation → human validation → global localisation) has no representation in the plan.

## Two things to fix in the audit itself before it goes out

- **p20 pricing slide is an unfilled template**: `£` blanks, "(inc. **?** Feeds)", "**?** Days x
  Managed Service Days", "**?** x Days Performance Booster: Enrich **x, y & z**". Only the £498
  set-up fee is populated.
- **Market list contradicts the plan** (see gap 22).
