# Overlay Design Studio

> Ray, 7 Oct 2026: *"within image overlays — build a design module to see if client's images would
> look like with our FeedSpark smart overlay (giving a variety of different overlay designs such as
> promotional messages (sale … % off, x units left, x clicks over past 30 days) — pulling in
> messaging based on feeds & adwords data using a module to summon fields and make it techy"*

Lives inside `/overlays` as the **🎨 Design studio** card. Where the rest of that page reads what
overlay is **already live** on a feed (`overlay_engine.js` decoding the image-creator URL), the
studio answers the other question: **what this feed could say, and what it would look like saying
it** — on the client's own product photography, with the client's own numbers.

Engine: `docs/overlay_studio_engine.js` (UMD `FeedOverlayStudio`, served at `/overlays/studio.js`).
Harnesses: `tools/test_ovstudio.mjs` (engine, 64 checks) and `tools/check_ovstudio.js` (the real
page in Chromium, 68 checks) — both in `qa_gate` / `presync` / `validate.yml`.

---

## 1. What the data actually supports

Measured on the live estate, 7 Oct 2026 (FeedHero reports MCP + the FeedHero-hosted output feeds).
Ray named three messages; two are real and one is not in the feeds at all:

| Message | Source | Verdict |
|---|---|---|
| `sale … % off` | `g:price` + `g:sale_price` | **Real**, and thin — `g:sale_price` fills **11/60** of Schuh GB and **22/60** of Monsoon GB |
| `x clicks over past 30 days` | `/api/catalog/ads` (FeedHero `ads_traffic`), per product id | **Real**, Google markets only. The shared lane was 7 days; the studio adds a **7 / 30-day picker** and prints the window it actually got |
| `x units left` | **in no output feed in the estate** — it is in the MASTERS (`stock_quantity`, `stockquantity`, `inventory_quantity`) | **Blocked**: a FeedHero rule must map it into the output feed before a scarcity overlay could ship |

That third row is the finding, and the studio reports it rather than papering over it — it previews
the design with the product's **real** figure read from the master through `/api/catalog/master/row`,
and the readiness panel says in words what would have to happen before it could go live. A `→ Brief
this overlay` on such a design carries the blocker into the ticket.

## 2. Why a field SUMMONER and not a field map

The client masters do not agree with each other, and two of them mean **opposite things by the same
column names**:

| | live price | reference price | stock | image |
|---|---|---|---|---|
| Monsoon UK master | `g:price` £30.00 | `g:was_price` (mostly blank) | `stock_quantity` | `g:image_link` |
| Schuh UK master | `sale_price` 15.99 | **`price` 38** | `stockquantity` | `image1URL` |
| YuMOVE UK master | `price` 18.57 | `compare_at_price` | `inventory_quantity` **5044** | `image_link` |
| any output feed | `g:sale_price` | `g:price` (Google's spec) | — | `g:image_link` |

A name list would print a **wrong discount on half the estate**, and a wrong discount on a client's
own product image is the worst thing this module could do. So `pricePair()` resolves it **by value**:
whichever column is consistently the higher is the reference price, and the reading carries its own
evidence (*"`price` is the higher on 20 of 20 rows carrying both"*), because a resolution nobody can
check is a resolution nobody should trust. Values beat names even when the names are wrong — a column
called `sale_price` holding the higher figure is read as the reference, which is the only way to
avoid printing a negative discount.

Where two columns rarely co-occur (Monsoon's `g:was_price` on a quarter of rows) the fill rate is
stated too, because *only those products can carry a discount* is the decision-relevant number.
Where they genuinely cannot be told apart, the studio says so and asks for a look before a client
sees it. It never falls back to column order.

## 3. Three honesty rules, each measured

1. **A fact states its coverage.** "% OFF" on Monsoon GB covers a third of the catalogue; the chip on
   the design card reads `33% OF THE FEED` and the rail draws the bar. A message on a third of a
   catalogue is a third of a campaign.
2. **A fact not in the feed is not mocked up.** See the stock row above.
3. **A number that would read as nonsense is refused.** YuMOVE's `inventory_quantity` is 5,044 —
   "Only 5044 left" is not scarcity, so `SCARCITY_MAX` (25) stands the message down **and says why**.
   `SALE_MIN_PCT` (5) does the same for a 3%-off flash.

### The Ads window

Ray asked for 30 days; `/api/catalog/ads` (shared with the Catalogue module) was hardcoded to 7.
The record was already keyed by its period, so both now live side by side and the route takes
`?period=7_days|30_days`, validated against an allowlist. **7 days stays the default** — 30 is a
second full read of the account (Schuh UK is 22,283 rows), so the caller asks for it.

Changing the picker after a read **drops the figures on screen** rather than relabelling them: the
numbers belong to the window they were read over, and a card quietly claiming a month of traffic off
a week of numbers is exactly the kind of wrong number this module exists not to print.

## 4. The designs

Fourteen, each a declarative set of zones mapping onto a **real FeedSpark image-creator script** —
the same ones `overlay_engine.js` decodes off feeds already running, so the studio's output is a
brief rather than a mock-up:

- `image_process_engine` — corner flash, pill badge, diagonal ribbon, starburst, urgency strip,
  selling-fast pill, social-proof bar, proof stack, branded frame, everything-on (a stress case,
  deliberately not shippable)
- `image_process_subscription_v1` — price tag, was/now pair (`show_price`, `tags_bg_color`,
  `tags_font_color`, `tags_img_type=round_dpa`)
- `image_process_products_lifestyle` — product × lifestyle split (`img_url_left` / `img_url_right`)
- no overlay — the control every design is judged against

A zone whose fact does not resolve is **dropped and says why**; a design whose every message is
missing reads *"nothing to say on this product"* rather than being drawn blank.

## 5. The geometry is pure, and tested

`layout()` returns boxes in image pixels and takes no DOM — the painting is the page's. That split
is deliberate: an overlay bug is almost always a box off the edge, two boxes on top of each other,
or a line too long for its box, and all three are assertable. Pinned for **every design at five
aspect ratios**: nothing leaves the image, nothing overlaps, every box fits its words.

Two bugs the harness caught while it was being written, both pinned:

- **A full-width band now reserves its edge.** With the corners placed independently, the
  social-proof bar drew straight over the price tag at every size.
- **A stack adds the heights it has**, never this box's height times its row index — the price tag
  stacks a large NOW under a small WAS, and multiplying by the wrong one put them on top of each
  other.

Text that cannot fit its shape is **set smaller** (to 55% of the requested cap height) and only then
cut with an ellipsis against a limit the layout measures — because "1,267 clicks in Last 7 Days
(30/09/2026 - 06/10/2026)" ran off both edges of a corner pill. The Ads **window** is therefore
shortened for overlay text (`in 7 days`) while the panel keeps FeedHero's full range.

## 6. Pixels, and why the canvas is same-origin

The preview composites on a `<canvas>`, so the image has to be readable: it is fetched through
`/api/catalog/img`, the host-allowlisted proxy the Catalogue module already uses (the URL's host must
be one this feed's own image links use). A feed whose host the proxy refuses still shows **every
design**, drawn on a plain plate, saying so — the designs are still the point.

On a feed that **already** carries an overlay (Monsoon's Meta feed), `image_link` is a composite, so
the studio decodes the **source** image out of it via `classifyOverlay().sources` and composites on
that. The estate's overlay URLs carry their sources raw; a feed that percent-encoded them instead is
handled by a decode fallback rather than silently compositing on top of a composite.

`tools/check_ovstudio.js` therefore serves the page over **http, not `file://`** — an opaque origin
taints the canvas, so a `file://` harness would test a different program from the one that ships.

## 7. The exits

- **⬇ PNG** — the composite, named `feedspark-<client>-<market>-<design>-<product>.png`. The market
  keeps its channel: `gb` and `gb-fb` composites of one product must not overwrite each other.
- **⧉ Copy the recipe** — engine, project, every parameter with its note, the URL, and anything the
  product could not supply.
- **→ Brief this overlay** — the Workflow composer, prefilled with the design, the drawn messages,
  the coverage verdict, the real parameters, and the blocker where one applies.

Editing a message in the composer redraws the preview but **never** changes the recipe URL: the
parameters stay per-product tokens (`{discount_pct}% OFF`), because a hand-typed preview frozen into
a feed rule is a wrong number on every other product.
