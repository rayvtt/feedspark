# Monsoon — seasonal keyword themes, Oct 2026 → Feb 2027

**Asked for** (Ray, 14 Oct 2026): *"the client, especially Monsoon, won't have the marketing
calendar. Please auto-generate a keyword calendar targeting two themes per month for Monsoon from
now until February 2027 … Focus on the seasonality of the product, since they sell dresses and
catalogs, and also auto-select the product."*

So this is **FeedSpark's own plan**, like Superdry's — there is no client marketing calendar behind
it. Ten themes, two per **work** month, each with its product scope selected from the live feed.

## The read

One stream of the wired Monsoon GB Google Shopping XML (`DEFAULT_FEEDS.Monsoon.gb`), 14 Oct 2026,
feed generated 06:46 that morning.

| | |
|---|---|
| Rows (SKUs) | 9,930 |
| Products (distinct `g:item_group_id`) | 1,593 |
| Distinct primary `g:product_type` paths | 126 |
| SKUs carrying **no** extra `g:product_type` (unkeyworded) | **9,445 (95.1%)** |

Census: [`monsoon_gb_product_types_2026-10-14.json`](./monsoon_gb_product_types_2026-10-14.json) —
every path with its products / SKUs / unkeyworded count. It is deliberately **independent** of the
seed: `tools/test_kwcal_monsoon.mjs` builds its index out of the seed's own paths, so without this
file a mis-spelled path would resolve under its own mis-spelling and match nothing real.

## The finding, twice over

**1. The catalogue is essentially unkeyworded.** 95.1% of SKUs carry no keyword slot at all, so
every theme here is first-pass work rather than a refinement. (Superdry, for comparison, was 57.5%.)

**2. The titles describe the garment and never the occasion.** Counted over all 9,930 titles:

| Absent or near-absent | | Already stated | |
|---|---|---|---|
| `occasion` | **0** | `velvet` | 1,324 |
| `wedding guest` | **0** | `embellished` | 1,273 |
| `formal` | **0** | `midi` | 1,134 |
| `partywear` | **0** | `party` | 885 |
| `holiday` | **0** | `sequin` | 670 |
| `mother` | **0** | `lace` | 603 |
| `new year` | **0** | `cardigan` | 419 |
| `thermal` / `cosy` | **0** | `jumper` | 365 |
| `festive` | 1 | `christmas` | 319 |
| `flower girl` | 1 | `knit` | 312 |
| `puffer` | 3 | `prom` | 176 |
| `spring` 3 · `summer` 2 | | `padded` | 162 |
| `gift` | 5 | `swim` | 124 |
| `beach` | 6 | `sparkl` | 87 |
| `winter` | 14 | `communion` | 37 |

Monsoon says what a dress is **made of**; it rarely says what it is **for**. On an occasionwear
brand, `occasion` appearing in zero titles is the headline. The whole plan is one move: put the
occasion and the season into a feed that only states fabric and cut.

**And the catalogue is two shops.** Children's is the larger half — the biggest single path is
`Children > Clothing > Dresses` (891 SKUs), ahead of `Womens > Clothing > Dresses > Midi Dresses`
(773) — so four of the ten themes are kidswear or carry it, which is not how this account is
usually briefed. Kidswear is its own lane on the board for that reason.

## The ten themes

Dated on **live-by**; the board buckets by **brief-by** (live − `LEAD_DAYS` 21) because it is a work
schedule. Two per work month, Oct 2026 → Feb 2027, earliest brief 16 Oct (nothing born overdue).

| Work month | Live | Theme | Lane | Paths | Products | SKUs | Unkeyworded |
|---|---|---|---|---|---|---|---|
| Oct 26 | 6 Nov | Party & occasion dresses | Seasonal focus | 5 | 182 | 1,086 | 991 |
| Oct 26 | 17 Nov | Girls' party & occasionwear | Kidswear | 6 | 238 | 2,013 | 1,957 |
| Nov 26 | 27 Nov | Winter coats & outerwear | Seasonal focus | 4 | 137 | 822 | 794 |
| Nov 26 | 11 Dec | Festive gifting — accessories, bags & jewellery | Occasion & events | 9 | 214 | 576 | 537 |
| Dec 26 | 29 Dec | Winter sale — knitwear & cardigans | Promotion | 5 | 129 | 830 | 808 |
| Dec 26 | 12 Jan | Holiday shop — swimwear & beachwear | Seasonal focus | 3 | 40 | 225 | 187 |
| Jan 27 | 26 Jan | Spring layers — blouses, tops & shirts | Seasonal focus | 5 | 218 | 1,143 | 1,092 |
| Jan 27 | 9 Feb | Wedding guest & occasion | Occasion & events | 7 | 198 | 1,165 | 1,051 |
| Feb 27 | 24 Feb | Mother's Day gifting | Occasion & events | 5 | 86 | 331 | 319 |
| Feb 27 | 10 Mar | Flower girl, communion & spring occasion | Kidswear | 6 | 87 | 647 | 621 |

Season locks worth stating: Mothering Sunday 2027 is **7 March**, so Mother's Day goes live 24 Feb;
the winter sale opens on the Boxing Day window; the holiday shop lands in January because that is
when the holiday is booked, not when it is taken; wedding-guest search starts in February for a
summer wedding.

**Party dresses and Wedding guest share most of their dresses on purpose** — same products, a
different question, and the keyword slots hold both. The shoes are in the wedding-guest scope and
not the party one because a guest outfit is searched as an outfit.

## Not seeded, deliberately

Product-type splits this read turned up. PMAX listing groups key on the exact value, so these are a
**Product Type Guard** job, not a keyword theme — but a scope *containing* a split must carry both
spellings or it silently drops products (the girls-occasion scope carries both heeled-shoe paths,
and the harness asserts it):

- `Children > Heeled Shoes` (185 SKUs) vs `Children > Shoes & Accessories > Shoes > Heels` (238)
- `Children > Onesie` (21) vs `Children > Onesies` (14)
- `Children > Suits` (14) vs `Children > Clothing > Suits` (38)
- `Children > Shoes` (25) vs `Children > Shoes & Accessories > Shoes` (516)
- `Womens > Sling Backs` (18) sits at top level, outside the Shoes branch

Also unseeded: trousers & skirts, nightwear & pyjamas, tights & socks, general footwear. Ten themes
was the ask; these are the obvious next ones.

## Harness

`tools/test_kwcal_monsoon.mjs` (Playwright, in qa_gate / presync / validate) renders the real board
and asserts: ten cards, five working months of exactly two, the first being this month and the last
February 2027, every scope reading as *set but not yet measured* rather than "Set scope", Monsoon's
own lane words, every seeded path present in the independent census, every card's quoted figures
equal to what its own scope resolves to, and — on a second load with a stored index — each scope
resolving to the sum of its own paths. Planted regressions: mis-spelling one path fails 2
assertions; moving one theme a month fails the two-a-month count.
