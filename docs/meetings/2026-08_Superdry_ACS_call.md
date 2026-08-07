# Superdry — account call with Emily (Aug 2026)

Source tag: **ACS**. Parsed from Ray's call note; task rows in
[`2026-08_Superdry_ACS_tasks.tsv`](./2026-08_Superdry_ACS_tasks.tsv), ATRT column order.

## The through-line

"The feed is dead" is a provocation, not the argument — the point is that this is **basic
fundamentals**, done properly. Titles have to be right, and retailers have to be pushed to
**product data excellence**.

The reason it matters now is distribution. The feed loaded into Google also powers **ChatGPT**
(which scrapes Google) and **Copilot** (via Bing Merchant Center, usually synced from GMC). Every
channel hangs off the same artefact, so **the feed is the central hub** — one source, many
surfaces.

What that demands:

- **Categorisation and structure** so channels know what a product is and where it belongs.
- **Custom labels** as the lever over which products show, when and where.
- **The new AI fields populated** — primarily for Google, but ChatGPT carries real consumer weight.
- **Our own platform's data intelligence**, which most customers don't know exists and aren't
  using. Getting them up to speed is a joint job with the client's agency.

## Review & project recap

- Advanced ad-hoc project plan on a shared Google Sheet: **260 direct tasks over two years**,
  scheduled monthly. **~1,200 tasks completed** across markets.
- In flight: **IV test**, **FAQ AI description**.
- **Monthly catch-ups** needed to prioritise.

## Look-back

- **38 tests** completed over two years, each with uplift detailed.
- Several **brand launches** supported; ready to roll new in-package optimisations for new brands.
- **Hero-size rule**: products flagged hero size (value 1) were excluded from range-completion.
  Later treated hero sizes as regular sizes so inventory isn't blocked — especially in sale.

## Performance

| Metric | Value |
|---|---|
| Hours, 2yr | 1,700 — 65% billable / 35% non-billable (technical, disapprovals, category mapping, data-field updates) |
| Tasks completed | 1,294 |
| A/B tests | 36 run; 75% of optimised keywords winning |
| Keyword saturation | 60–70% of feed, target 80–90% |
| Title length | 80–120 chars benchmark, pushing longer and intent-rich |
| Description length | 58% over 100 chars; "500% over 500 chars" — see conflicts below |

## Custom labels & catalogue mapping

- New process to **auto-populate missing custom_label_2** values.
- Catalogue → Google taxonomy mapping is critical. **Gender must not go in GPC**, but may sit in
  **product_type** for brands like Superdry.

## AI readiness

- Moved off legacy title fields onto the **description enhancer**.
- **FAQ description test** launches next week — drafts shared for approval, then live 3 weeks.
- Coming: **image analysis** and **conversational attributes** (item_group_title, variant
  matching, popularity ranking).

## Future optimisation

- **Tachyon AI** — rewrite titles and descriptions at scale, enriched from image data.
- **ROAS intelligence** — analyse spend by category, price range and other dimensions; move budget
  off low performers.
- **Landing-page optimisation** — route to category pages: longer dwell, better conversion, lower
  remarketing cost.
- **Image overlays** (social + PPC) — surface promotions without touching price visibility.
  **Testing in September.**

## LLM optimisation

- New Google attributes for **Q&As, related products, relative importance** — mostly AI-populated.
- **Product-level variants** (e.g. width) can now be submitted separately.

## Spend reallocation — worked example

Cutting the **bottom 10% of spend (ROAS 5.3)** and redistributing lifts overall ROAS **6.2 → 7.3**
and adds **~1,500 conversions/month**. Needs human oversight for seasonality and market shifts.

## Roadmap

- **Q3–Q4**: AI-oriented optimisation, onboarding tests, spend optimiser live **before peak**.
- Further calls with the agency and **Matt** to finalise priorities and onboard the dashboard.

## Next steps

1. Share the deck and FAQ description samples **next week**.
2. Follow-up call in **two weeks** — overlays and beta features.
3. Provide any further prep materials.

---

## ⚠ Conflicts to resolve before any of this is quoted to the client

These are contradictions **inside the note itself**, or against the delivered Strategy Review.
None are resolved here — they need Ray's call.

| # | Conflict |
|---|---|
| 1 | **Test count: 38 vs 36.** Look-back says 38 tests; Performance says 36 A/B tests. The Strategy Review deck says 36. |
| 2 | **"500% over 500 characters"** is impossible. The deck's live GB feed audit found **100% of SKUs carry a description** and **58% clear the 500-char AI target** — so the note's "58% over 100 / 500% over 500" looks like a transposition of that pair. |
| 3 | **Hours: 1,700 vs 1,746.** The deck reports 1,746 hours over two years. |
| 4 | **Tasks: "~1,200 completed" vs 1,294.** Both appear in the same note; the deck says 1,294 delivered. |
| 5 | **"260 direct tasks"** matches the plan's 260 tracked — but the deck now records **251 done / 4 open / 5 parked**, not the older 169/86 split. `docs/plan_tasks.json` still carries the *old* Superdry figures (score 70, done 169, open 86) and feeds the FCC, so the dossier and the deck still disagree. Unchanged since it was first flagged. |
| 6 | **"75% of optimised keywords had a winning rate"** conflates test win-rate with keyword coverage. Worth restating precisely before it reaches a client. |
