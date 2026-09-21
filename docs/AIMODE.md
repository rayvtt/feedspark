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

---

## Saving an AI Mode quote

> Ray, 18 Sep 2026: *"i cannot save AI Mode quote btw"*

The save guard asked two questions — are any Tachyon catalogue fields ticked (`t.inc`), and are
there any system / feed / retainer lines (`t.x`)? Those were the only two line types the day it was
written. A quote made **entirely** of routed AI Mode attributes is neither, so it counted as empty:
the save refused, and the refusal told Ray to add a line he had already added. A quote carrying only
the monthly new-product bundle failed in exactly the same way.

`qLineN(t)` now counts every line type in one place:

| counted | what it is |
|---|---|
| `t.inc` | ticked Tachyon catalogue fields |
| `t.x.length` | systems, feeds, retainer hours |
| `t.aim.lines.length` | routed AI Mode attributes (the shared scrape run included) |
| `t.upd ? 1 : 0` | the monthly new-product bundle |

Two deliberate choices. It is asked in **lines, never in money** — a £0 line is still a line
somebody put on the quote, and an unpriced quote is allowed to be saved (it already says "rates
incomplete" everywhere it appears). And it is **one function**, so a fifth line type cannot be
forgotten here again; the refusal on a genuinely empty quote names every way to fill it.

## Rewording the card

> Ray, same message: *"also allows all text can be edited please"*

The injected editor is the FCC's own text rail: `✎ Edit` makes copy contenteditable, keys each
element, and saves the patch to KV per page. Its default selector is written for the decks —
`h1-h5, p, li, td, th, .lede, .callout, .note …` — and **every explanation on this page is a `.ch`
block under a card heading**, which that list does not name. The one thing Ray reads before showing
a quote to a client was the one thing he could not reword.

Two rules govern the fix.

**The selector is declared per page, not widened globally.** `window.DECK_EDITOR_SELECTOR` on this
page is the default plus `.card > .ch, .qs-h, .aim-note, .aim-lbl`. The editor's keys are
*positional*, so broadening the shared default would renumber every deck's saved edits at once.

**Only prose is listed.** No line that carries a live figure joins it — not `#aim-srcline`, not
`#aim-word`, not the `.hint` counts, not the `b` values beside the labels. An edited sentence
freezes the number inside it, and a frozen number on a client quote is a wrong figure. The row
*labels* are editable; the numbers beside them are not.

And because the editor keys each element **once at load**, copy that a render redraws could never
hold an edit — it would be wiped by the next keystroke on a rate box. So the card's prose moved into
the template: the scrape note, both box headings and all ten foot row labels are now markup, and

- `aimFoot(q)` writes only the **structural** choices — which newness row applies, the chart, the
  buffer figure inside its own span — and leaves the newness input alone while it has the cursor;
- `aimNums(q)` writes every **figure** by id, one writer that both the full render and the
  numbers-only refresh call.

The per-row route sentences (`.aim-why`) are deliberately *not* in the selector: they are drawn per
attribute by the render, so a key given to them at load would attach to an element the next render
replaces — listing them would offer an edit that quietly does not stick.

## Delivered

> Ray, 18 Sep 2026: *"Can we also put in a button for 'Delivered' meaning work delivered — And
> obviously, if it had been added to the plan, then it can follow the tracking of the whole workflow
> intake, right? When you have a confirmation from ASPL, you know this work has been delivered."*

A stage between **In action** and **Billed** — the real order: the work lands, then it is invoiced.
Anyone can press it, and where the quote has a ticket it moves itself.

**The tie.** `→ Intake` writes a plan task titled `AI Field Quote — <REF> — <Brand> <MKT> — …` and
the Workflow composer saves a brief with that same task, so the quote's own ref is already in the
ticket. `loadQBriefs()` matches on that machine-shaped **token** and nothing else — the same rule
`briefmatch.js`'s `ibfcode` follows for unattended matching; no wording is read. Refs nest, so the
**longest** ref that fits claims the ticket (`QT500-2` is never taken for `QT500`), a foreign
`b.client` breaks the match outright, and the newest ticket wins when a quote has been briefed twice.

**What counts as delivered.** `WF_DELIVERED` = `done`, `running`, `analysis`, `confirmed`. ASPL have
confirmed the work from *Done — ASPL* onwards, and Test running / Analysis / Client confirmed all
come after it, so each of them means the work landed too.

**Why it only ever moves once.** A finance stage is a person's record. `autoDeliver()` stamps
`q.aspl = {id, status, by, t, from}` the first time the pipeline has its say, and then stands down —
so a human who moves the quote back afterwards is not overruled on the next poll. It never touches a
quote already **Billed** (ASPL finishing does not un-bill an invoice) or **Declined** (it is not a
vote on a quote finance turned down), and never moves one backwards.

The row wears a live `.t-wf` chip — the ticket's stage and **whose court** it sits in, linking to
`/workflow`, because the stage moves there and never on this page — or an honest `🎫 no ticket yet`
on a filed quote nothing matches. Finance gets the figure the rail exists for: **Delivered · not
billed**. The pipeline is re-read every 120s and on tab-visible.

---

## The run-rate is a year, divided by twelve

> Ray, 18 Sep 2026: *"The logic for new products a month is not accurate. For example, Monsoon had
> 10,298 divided by 12. It's not 1,534. Let's use the logic of the current calendar year, looking
> back one year and divide by 12."*

It was the **mean of the last 3 complete months**, which reads whatever the catalogue did most
recently rather than what it does in a year. Monsoon GB's July and August (1,741 and 2,221 new
products) run three to five times its spring months, so × 12 forecast **18,408 arrivals a year onto
a 10,298-product catalogue** — the whole shop arriving twice over, on a figure that goes to a client
in a quote. Twelve months average the seasonality out, which is what a quote needs. The same feed
now reads **604 a month**.

**Divided by 12 whenever there is a year to look back on.** A feed monitored for five months has no
year, and dividing those five by 12 would under-read by more than half — so it divides by the months
actually observed and the basis says how many. *Short of a year* is stated, never padded out with
months of zeros. An empty month **inside** the window is a real zero and is divided by.

`m3` and `m6` are still reported, and `/volume` prints the 3-month average beside the run-rate,
because a recent burst is worth *seeing* — it just is not what the year is priced on.

It is **one engine** (`docs/arrivals_engine.js`), so `/volume`, the Monthly update card, the AI Quote
and the Playbook cannot quote two different rates. `tools/test_arrivals.mjs` pins it on Ray's exact
Monsoon numbers: the 3-month mean still computes to the 1,534 he screenshotted, and the forecast
reads 604.

## Nothing annual, on any quote

> Ray, 18 Sep 2026: *"move annual cost lines or anything related to annual cost (pro-rata) not
> neccessary (Across all quotes)"*

A **Year-1 total adds a one-off to twelve months** — re-mixing exactly what the CFO rework pulled
apart (*"it's mixing set-up costs with monthly costs so it's hard to easily see the initial one-off
costs vs the ongoing costs"*). Every annual and pro-rated **cost** figure is gone:

| surface | what went |
|---|---|
| AI Mode card | the **Year one** row |
| Quote total tile | **Annual (× 12)** |
| bottom line | the **Year 1 ·** span and the *(x a year)* hint beside the monthly |
| ⧉ Copy text | *· x a year* and *Year 1 total* |
| client email | the same two |
| brief | *— x a year* |
| finance tracker | the *· x a year* hint and the **Year 1** row |
| finance workbook, BAND 4 | **Total Annual**, **Pro-rated**, **Year 1 Total** and the notes line |

`year1` left the engine too, so no surface can quietly print one again — a forbidden marker and a
harness assertion pin that nothing multiplies a monthly figure by twelve.

Two notes. The pro-rated row **assumed a January contract year-end**, so on any client whose year
ends elsewhere it printed a figure nobody had agreed; there is no reason to keep guessing it. And
what survives is **new products a year** — that is a count of products, not a cost.

### A flex row ignores `hidden`

Found while checking the card on screen rather than in the code. The UA's `[hidden]{display:none}`
loses to any class that sets `display`, so `el.hidden = true` on a `.aim-r` or `.qs-r` left the row
**on screen with an empty value in it**. Two rows were affected: the newness pair, where the shell
shows whichever read applies and so drew *both* ("Arrivals run-rate 0 / month" above the typed %
box), and the quote summary's AI Mode rows, which had been showing empty since they shipped.
`.aim-r[hidden],.qs-r[hidden]{display:none}` states it once, for every such row.

---

## It is called Spark AI

> Ray, 21 Sep 2026: *"can you rename the section into Spark AI"*

Every label follows: the card heading, the quote-type button, both quote-summary rows, the KPI,
⧉ Copy text, the client email, the brief and the workbook's row names.

**The record key is untouched.** `types.aim`, `q.aim`, `data-tp="aim"`, `AIM_*` and the `aim`
namespace all stay exactly as they were — renaming a label must never rename a record, or every
quote finance has already signed off would read as empty. A `forbidden` marker keeps the old label
from creeping back into the page.

## Generate for — the arrival cohort

> Ray, same message: *"within the charge per product ID, allow selection — for example, if clients
> only want to optimize for new collections … add manual selection of products to be generated,
> optimized based on date of birth as well. For example, any product that arrives after August
> 2026."*

**CHARGED PER** answers what *one unit* is — an item group or a product. Which of them we actually
generate is a different question, so it gets its own control, and it applies **on top of** the
product-type scope rather than replacing it.

`GENERATE FOR` is one select, because it is one decision. The months come from the feed's own
`fs:date_of_birth`, and each option carries what picking it would leave in scope:

```
Every product in scope
Arrived since Sep 2026 — 60
Arrived since Aug 2026 — 180
Arrived since Jun 2025 — 360
```

A month the catalogue does not reach cannot be picked. Where the control cannot be offered at all —
no feed pulled, no first-seen column, or a typed headline figure that carries no dates — it says
which, rather than sitting dead.

### How it is counted

The pull already read first-seen dates, but only as one fixed twelve-month count, which answers one
question. It now also buckets them by **month** — `rowsM` (SKUs), `parsM` (item groups) and `ptM`
(per product type) — the same shape `/volume`'s arrivals engine keeps, bounded by the months the
feed spans rather than by its row count. `aimCoSeries()` builds the month series **once** for the
current unit + product-type scope, and the options *and* the selected figure both read it, so the
list can never disagree with the number it produces. The cutoff is a `YYYY-MM` string compare —
never a timestamp, so never a timezone.

### Three rules that keep the quote honest

**1. A cohort narrows the one-off, never the monthly.** The range is generated once, so a cohort
makes it smaller. But every product that arrives *next* month is in the cohort by definition, so the
ongoing figure is the full flow into the product-type scope:

| | reads |
|---|---|
| `aimUnits()` — what is generated once | the cohort |
| `aimScopeUnits()` — what flows in monthly | the product-type scope alone |

Scaling the ongoing figure down by the cohort's share would undercharge the part of the service that
never ends. The card states this on screen, because a reader would reasonably expect both sides to
shrink together.

**2. An undated product is not in the cohort.** It cannot be *shown* to have arrived after the
cutoff, so it is left out — and the hint names how many, the same rule the newness read follows.
Silently counting them in would sell work on products nobody selected.

**3. A selection is never silently cleared.** Narrowing to a product type the cohort does not reach
keeps the month in the list, reading 0. A select showing "Every product in scope" while a cohort of
0 is applied would be the card lying about what it priced; 0 is a true answer, and the choice stays
with the reader.

### Where it travels

A cohort quote is a different deliverable from a whole-catalogue one, so it goes wherever the
figures go: the saved snapshot (and back through ✎ Edit), ⧉ Copy text, the client email, the brief,
and the finance workbook's notes — there especially, because the quantity on a line does not say
*which* products it covers. The monthly block deliberately does not carry it.
