# AI Mode — the conversational attributes, priced by data source

*A card inside the Quote generator (`/aiquote`). Ray, 17 Sep 2026: "mirror this artifact to import
inside the quote generator for AI, using the exact same calculation logic — I'd like this module and
interface better as well but adapt to our FCC colour thematic & text & branding & emoji."*

---

## What it is, and why it is not the catalogue above it

The rest of `/aiquote` prices optimisations **per SKU**: pick a field, pick a rate, multiply by the
volume in scope. That model says nothing about *where the data comes from*, which for Google's
conversational attributes is the whole commercial question — a `question_and_answer` we generate
with Tachyon and a `question_and_answer` the client already has in their PIM cost completely
different amounts to deliver.

So AI Mode prices by **route**. Each of the seven attributes is sent to one of four places, and each
route has its own cost shape:

| Route | One-off | Monthly |
|---|---|---|
| **⊞ Add to master feed** | hours to configure the field | — |
| **⇩ Scrape** | hours to configure the scrape | **one** scrape run, covering every scraped field |
| **✦ Tachyon AI** | set-up days for the field **+** £/product across the whole range | £/product on the new products |
| **⚙ FeedHero rule** | hours to build the rule | — |

Then a floor: if the AI months come to less than the minimum, the shortfall is added as **its own
line**, not buried inside a field's charge.

Two rules in there are easy to get wrong and are pinned by the harness:

- **The scrape run is charged once.** A second scraped field adds configuration time and nothing
  monthly. We do a full pass over the catalogue and then the new products — we do not re-scrape
  every product every day.
- **The minimum is an AI minimum.** It is measured across the AI fields only. Reading it as a floor
  on the whole card would swallow the scrape run and undercharge by £100 a month.

### The routes each attribute can honestly take

`question_and_answer`, `item_group_title` and `product_highlight` can be AI-generated. The other
four cannot: AI cannot invent a `document_link`, a `related_product` or a `variant_option`, and
`popularity_rank` is computed in FeedHero from the brand's own Google Ads performance and nowhere
else. Impossible routes are not offered, and the row says why.

---

## The numbers

Defaults (`AIM_RATE_DEFAULT`), editable per user and saved to the shared rate card:

| | |
|---|---|
| Day rate | £695 |
| Hours in a day | 8 → **£86.875/hour** |
| Hours to add a feed field | 2 |
| Hours per scraped field | 2 |
| Scrape run | £100 / month |
| AI set-up | 2 days per field |
| AI cost per field | £0.10 |
| Hours for a FeedHero rule | 2 |
| AI minimum | £100 / month |
| Volume buffer | 10% |
| Fallback newness | 10.5% a year |

Money is held **unrounded** and rounded only for display. The FCC shows pence (the CFO rework's
rule — `"£"#,##0` prints £446.25 as "£446", so a block total reads as if it does not add up); the
per-line explanation sentences keep the builder's own rounding, so they read exactly as it wrote
them.

---

## Where the volumes come from

**The catalogue in scope** is the page's own product scope (the ⚙ product-type picker) — one scope
per quote, never a second picker that can disagree with the first.

**The unit is this card's own.** AI generation is normally charged per **item group**: one set of
values shared by every variant. That is not the SKU rule the catalogue above runs on (Ray, 10 Sep
2026), so the card carries its own toggle and states which it used. A feed with no `g:item_group_id`
has no groups to charge per, so the toggle is refused rather than faked.

**New products a month** — three reads, strongest first, and the card always names the one it used:

1. **The Monthly update — new products card** above it (Ray, 17 Sep 2026: *"only thing to keep is
   our monthly update - new products view, it looks better"*). That card already reads the feed's
   own `fs:date_of_birth` arrivals, so AI Mode does not import the builder's own newness step. Its
   figure is for the whole market in SKUs, so it is taken down to this card's scope and unit by the
   scope's share of the feed.
2. **The feed's own first-seen dates**, read on the same stream as the product-type pull: how much
   of the catalogue in scope was first seen in the last twelve months, as a share of the items
   carrying a usable date. Undated items are left out of **both** sides — counting them as old
   would make a feed that dates half its rows report half the newness it has. At item-group level a
   parent is dated by its first row, which is the row a per-group charge covers.
3. **FeedSpark's 10.5% working estimate**, when the feed has no dates and the card has no figure.

A number typed into the card beats all three. Whatever the read, the volume buffer goes on top and
the result is rounded **up** — a part product is a whole product.

### The chart, and what the bars are

Ray, 18 Sep 2026: *"why don't you bring the new product volume arrival bar chart that looks really
beautiful over to this section too?"* — so the card draws it, through the Monthly update card's own
`updBars` off **one** shared series builder (`updMonthRows`). Same validated blue, same value
labels, same translucent running month, same calendar walk. There is no second bar renderer and no
second series, so the quote, the Monthly update card and `/volume` cannot draw one feed three ways.

What the bars *are* is stated under them, because the chart is the whole market's arrivals while the
card may be pricing a product-type subset at item-group level:

| Scope and unit | The caption says |
|---|---|
| whole catalogue, per product ID | "This card prices on these products." |
| anything narrower, or per item group | "These are the whole market; the rows below take them down to this scope and unit." |
| no feed pulled yet | "…pull the feed and the rows below take them down to this scope and unit." |

The chart does **not** need the feed pull — arrivals come from `/api/volume`, so the evidence is
there on open. The three scoped rows underneath do need it, and until it happens they read a dash
rather than the market figure: printing "1,534 / month **at this scope**" under "**0** products in
scope" is the card contradicting itself on screen, which is what Ray screenshotted. The **⟳ Pull
live feed** button therefore sits in the card itself — it was only in the hero, several screens up,
so the card was giving an instruction with no action beside it. It calls the hero's own `pullFeed()`.

One trap worth naming: the arrivals fetch resolves once and **both** cards read that record, so both
are redrawn when it lands. Redrawing only the Monthly update card left AI Mode sitting on its
"Reading this feed's arrivals history…" placeholder while the card above it already had twelve bars.

---

## Where it lands on the quote

AI Mode is a quote **type** (`aim`), so it rides the same rails as systems, feeds and retainer
hours: its own section, the shared totals, the tracker, the client email and the brief.

In the Finance workbook it splits across **three bands**, because its three costs are three
different things:

| Band | What goes there |
|---|---|
| **MONTHLY RECURRING COSTS** → System / Platform Costs | the scrape run, the monthly AI generation, the minimum top-up |
| **ONE OFF OPTIONAL COSTS: PERFORMANCE BOOSTER PACK** | the per-product AI generation over the range |
| **ONE-OFF COSTS: SET-UP & CONFIGURATION** | every route's configuration hours, as days at the `Dayrate` |

Writing the whole card into one band would put set-up back inside the monthly cost, which is the
exact thing the CFO asked us to stop doing.

**The discount** follows the workbook's own header. `Discount % (Exc Man Power)` means the
configuration hours are not discounted unless "+ man power" is ticked for the quote; the
per-product AI generation is not man power, so it always is. Each line carries `man` and `gen` apart
for exactly this.

**A saved quote freezes its routes**, so `✎ Edit` reproduces the quote finance signed off. The rates
on the snapshot are deliberately *not* written back over the rate card — that is a shared figure for
the whole book, and editing an old quote must not move it.

---

## Two bugs this work surfaced

Both were live on the page before AI Mode existed, and both are pinned in the manifest:

- **`.qp` is a shared pill *look*, not a scope button.** The scope quick-pick handler had no
  `data-qp` guard, so the quote-type buttons and the market chips fell through to its `else` branch
  and set `scope={mode:'manual',manual:NaN}` — **picking a quote type silently zeroed the product
  scope and every SKU count with it.**
- **The summary grid's track count must match the longest column.** The three summary tiles share
  one set of subgrid row tracks; a row added to a tile without adding a track lands on top of the
  one below it.

---

## Harness

`tools/test_aimode.mjs` (100 assertions, in `qa_gate` / `presync` / `validate.yml`) lifts the engine
verbatim out of the page between its `AIMODE:ENGINE` markers and runs it in a bare sandbox — which
also pins that the block stays free of page globals, since anything it reached for would throw.

It exists because the model arrived from a builder Ray had already signed off on: the numbers it
produces are the contract, and a later tidy-up must not quietly move a rate, drop the scrape-once
rule, lose the AI floor or start rounding mid-calculation.
