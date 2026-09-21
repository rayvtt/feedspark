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

---

## Quote options — 1, 2, 3, 4

> Ray, 21 Sep 2026: *"each piece of quote presented should be selectable as an option (1,2,3...).
> When asking a client to buy a service, you need to provide one, two, three, or four options …
> after the quote summary section, if the proposal has three options, showcase the three lines of
> options after each generated quote. AM can continue to build different quote as additional
> options … especially in the saved quote / finance tracker, highlight which option the client has
> chosen and approved. and use that data for future analysis."*

**An option is a quote.** Nothing new was invented to hold one: a saved quote carries
`prop {id, n, label}`, and a proposal is simply every live quote sharing that id. So an option keeps
its own reference, its own lines, its own client email, its own brief and its own place on the
finance rail — and ✎ Edit still versions it, because a v2 of option 2 is an ordinary thing to want.
The superseded version leaves the proposal as an *earlier version*, and its replacement **inherits**
the option number, so an edited option is counted once rather than twice.

### Building them

**＋ Add option** on any tracker row loads that quote into the builder and makes the next Save a
**sibling** — deliberately not ✎ Edit's mode, which would version it. A standalone quote becomes
option 1 the moment a second one is wanted, and the next free number is taken.

| mode | what Save does |
|---|---|
| ✎ Edit | a new **version** of this quote |
| ＋ Add option | a new **option** beside it |

### The strip

Right after the quote summary, as asked: one line per option — glyph, label, reference, what it
includes, one-off and monthly — plus the build in progress. It **stays up after a save**, because
the moment you have just added an option is the moment you want to read the set.

The proposal shown is the one *in play*: being added to, under ✎ Edit, or just saved this session.
Never inferred from the client — a strip that appeared because a proposal exists somewhere for this
brand would turn up on unrelated quotes. Every write to the saved store redraws it, or it renders
one option behind (a save-while-editing paints mid-flight, before the new option is in the store).

### The choice

It lives on the winner, and the **newest stamp wins on read** — two AMs can each click before their
stores merge, and resolving by time settles the board on one answer instead of showing two chosen
options. Choosing un-chooses the siblings, and it is a toggle, because a client may change their
mind and that should not need the quote rebuilding.

**Not taken is not Declined.** Declined is finance's word for a quote they turned down; not taken is
the client picking a sibling. Different facts about different people — so the choice is its own
field and the stage rail is left exactly as it was.

### The money

Three options at £5k each are one £5k opportunity, not £15k. `countedIds` gives every figure on the
rail exactly **one quote per proposal**: the chosen option, or the lowest-numbered one until the
client picks. The board states the rule under its KPIs. Without it the pipeline would have read as
three deals the day the feature shipped.

Two consequences follow: an option the client did not buy is never auto-delivered by the ASPL
ticket match, and an earlier version offers no ✓ Chosen — it is out of the proposal already, so the
button would silently do nothing.

### What the options teach us

A line under the KPIs reads proposals decided against still open, which option **number** is chosen
most often, and the chosen value against the top option of each. It is computed from the quotes
themselves, so it can never drift from what the tracker shows.

### For the client

**⧉ Options** copies every option as one document — what each one *includes*, not just a price, ex
VAT with the validity, on the same footing as every other client-facing exit on this card.

## The new-product bundle: a typed band price, and the quote says so

Ray, 21 Sep 2026, reading QT261571: *"i think this feature is not smart yet, also, i dont understand —
at which point the new-product updates for this quote gets to 15,100/ month ?"*

**Nothing computed it.** The Monthly update bundle is a flat monthly charge read off a band table on
the rate card — `totals()` does `monSub += updGBP()` and `updGBP()` is whatever sits in the band box.
The `~570 / mo` arrivals figure only picks *which* band applies; it never multiplies the price. The
FeedSpark band for "up to 1,000" is £100.

**How £15,100 got there.** The band box is pre-filled with `100`. Click into it and type `15` without
clearing and the box reads `15100` — saved on the keystroke, with no ceiling, into a 58px box too narrow
to show five digits, onto a rate card that is `mapStoreRoute('aiquote')`: **shared across every client
and every colleague**. One slip re-priced the bundle on every quote in the house, and the quote total
printed the number with nothing about where it came from.

What changed (none of it arithmetic):

- **The total line names the figure** — `up to 1,000 band · £100.00/mo band price · ~570 new SKUs/mo`, the
  tooltip stating it is a flat charge typed on the shared rate card and that the SKU count picks the
  band, never multiplies it. `updInfo()` now carries `band / frozen / off / def` for every surface.
- **The prepend trap is closed** — the band boxes (and the estimate) select their value on focus so the
  first keystroke replaces. Focus alone is not enough: a click is mousedown → focus → mouseup and the
  mouseup collapses the selection to a caret again, so the mouseup that completes the focusing click is
  swallowed. A second click in an already-focused box places the caret normally.
- **Off-scale is flagged, not silent** — a band priced at more than 5× its FeedSpark default rings the
  chip orange, prints `⚠ was £100 ↺` on it, warns under the bands naming the default, and puts ⚠ on the
  quote-total row. `↺` puts the default back through `setBandGBP`, the one writer every band edit uses.
- **A saved quote reproduces its own price.** `loadSaved` restored the band *index* and trusted the
  rate card to still hold the same £ — so ✎ Edit on a signed-off quote silently re-priced it at today's
  band. The snapshot's `upd.gbp` is now frozen onto the record (`updFrozen`) and wins; pinning another
  band, ↺ auto, editing a band price or moving the estimate thaws it (`updThaw`) — those are new
  decisions — and the card says "Frozen at £X … the band costs £Y today" when they differ.
- **"draft prices" means what it says** — it used to read "the rate card has no tiers key", so editing
  one band retired the badge for the four untouched placeholders. Now: no band priced yet. Each edited
  band carries its own "was £X".
- **The blur must not eat the click.** Snapping the box to the stored (floor-clamped) price on blur must
  not rebuild the card: blur fires as part of the click that moved the focus, and rebuilding `#upd-body`
  destroys the ↺ button or band chip under the pointer. `paintTiers()` repaints classes and the "was"
  marker in place.

Two neighbours fixed in the same pass:

- **A discount that discounts nothing says why.** The same screenshot had 100% typed in and £0 taken
  off — scope "selected lines", no line ticked — and the row said "not on one-off" in grey, which reads
  like a rule of the template. `discNil(side, t)` now prints `⚠ £0.00 · no line ticked` / `man power
  only` / `nothing to discount` when the scope covers the side, and stays quiet when the scope simply
  excludes it (that one *is* the setting). The value cell stays short; the full reason is the tooltip.
- **The quote-total tiles could not shrink** — pre-existing, verified on pristine `main`: each `.qs-col`
  is a subgrid whose single implicit column sized to max-content, so every row was ~10px wider than its
  tile and the longest clipped at the right edge. `grid-template-columns:minmax(0,1fr)` + `min-width:0`,
  and the `.tot` row (whose label is deliberately nowrap) drops its figure onto its own line rather than
  overlapping. `.pt-act` was scoped to the product-type picker, so the bundle card's own small buttons
  were bare browser chrome — styled.

Harness: `tools/test_aimode.mjs` (27 new assertions). Browser-level QA (scratchpad, not CI): 30
assertions across the trap, the flag, ↺, the freeze/thaw, the discount wording.

## The AI feed generation button is gone

Ray, 21 Sep 2026: *"remove AI feed generation Quoting button -- we have Spark AI now."*

The per-SKU Tachyon field catalogue was the original module; Spark AI is the AI quote now, so the
"What are you quoting?" picker offers **New system · New feed · Retainer hours · Spark AI** and a fresh
client record opens on Spark AI. The type itself survives as **legacy** so nothing already saved goes
dark: a client record, or a ✎ Edit'd snapshot, that still carries `types.ai` shows its fields card and
gets the button back — dashed, labelled *Legacy — per-SKU Tachyon fields, superseded by Spark AI* —
until it is unticked, after which it never returns. A pre-11-Sep snapshot with no `types` at all is
still read as an AI-only quote (`{ai:true}`), because its field lines are the quote.

Two cards used to ride the `ai` type and now list every type they belong to (`data-tp="ai aim"`,
shown while any is on): the **product-type scope** card, since Spark AI prices on the same scope, and
the **Monthly update — new products** bundle, the view Ray asked on the 17th to keep. The "Fields
selected" / "SKUs quoted" KPIs show only with the legacy type on — a Spark AI quote never reads
"0 SKUs quoted". The hero copy leads with Spark AI.

## The finance tracker declutters

Ray, 21 Sep 2026, sending the tracker: *"the saved quotes getting super cluttered - expand horizontally
if needed, buttons should be presented cleaner - maybe in a different format to save space."*

Every row was ~150px tall: seven stage word-pills wrapped onto two lines, and six action pills
stacked down the right. Each row is now one line (~48px):

- **The stage rail is a stepper.** The current stage is the only word; the stages behind it are
  filled green dots, the ones ahead hollow, Declined is the ✕ at the end (red only when it is the
  stage). Every stage is still one click and named in its tooltip and `aria-label`; the header
  reads *Stage — click a dot to move it*.
- **The actions are one row of 26px icons** — ✉ draft email · → intake · ✓ chosen · ＋ add option ·
  ❐ compare options · ✎ edit — with the full label and state in each tooltip. A **done** state is the
  icon in green (the drafted / filed date and who sits in its tooltip, exactly what the old text
  said); the three proposal actions sit in one segmented group; the six icons never wrap, only the
  live 🎫 ticket chip may drop a line (it keeps its words — it is a read-out of Workflow's state, not
  a button). A legend under the table names every icon once. The "↻ newer version" notice moved
  under the ref beside "v2 of …".
- **Dates are compact** (day · then time · who; the full timestamp in the tooltip), the Scope cell
  drops "· 0 fields" on a Spark AI quote, and **"ex VAT" is said once in the Total header** rather
  than on every row (every figure on the page is ex VAT — Ray, 16 Sep). The table fits the 1280px
  column without a scrollbar, and on a screen wider than 1400px the tracker card steps out of the
  column to the viewport gutter — "expand horizontally if needed", taken literally, for that card
  only.

**A field collision fixed on the way (the "Invalid Date Invalid Date" row).** The snapshot keeps the
new-products bundle on `q.upd`; `stamp()` was writing the last-update TIME onto the same field. So
the tracker printed `+bundleObject` as a date on any quote carrying the bundle, and — worse — every
stage move, owner change or → Intake on such a quote **overwrote its bundle record with a number**
(the detail row then read "undefined new SKUs", ✎ Edit restored a bundle with no estimate and no
frozen price). The stamp is now `q.lu`; `tkLast(q)` reads `lu`, then a legacy numeric `upd`, then
the save time; `qUpd(q)` is the one reader of the bundle and only ever returns an object. A quote
whose bundle was already clobbered keeps its frozen `monGross` — the money was never wrong, only the
record of what it was for.

## What sets each option apart

Ray, 21 Sep 2026: *"the summaries below each option should be clearer - to easier identify - ensure
AI writing here to provide both details (delta changes between option) but not too cluttered."*

Two lines under every option in the strip, both **written by the page off the frozen snapshots and
never by Tachyon** — a difference stated here must be one the quotes actually carry, and the strip
reads the same with the API key absent:

- **Line one — what it includes**, one compact clause per thing: `Spark AI ×6 (2 Tachyon AI · 1
  scrape · 2 feed · 1 FeedHero rule) · monthly new products (up to 1,000) · arrivals since Aug 26 ·
  per product · 10% discount · whole catalogue · 9,859 SKUs`.
- **Line two — what changed against the option before it**: attributes added (`+ Popularity rank`,
  green), dropped (`− monthly new products`, deep orange) or re-routed (`~ Question and answer:
  Tachyon AI → scrape`, navy); the bundle on/off or its band; the scope by **shape** (whole / N
  product types / headline) with the SKU count compared only when both sides know it — a build whose
  feed is not pulled yet reads 0, and "0 SKUs (was 9,859)" would be the strip inventing a difference;
  the cohort; the unit; the discount; then the £ movement, one-off and monthly apart. Four clauses
  on screen, the rest behind `+N more` with the full list in the tooltip; `same lines` when nothing
  differs, because a duplicate option is a finding, not a blank.

Options read as a **ladder**, so each is compared with its predecessor rather than every one with
option 1 — the third line then says only what the third step adds. The build in progress is compared
with the last saved option, so the AM sees what the next step adds while still assembling it. ⧉
Options (the client comparison) carries the same line: `Compared with option 1: − monthly new
products · −£752.60 one-off`.

## A hidden card never prices

Ray, 21 Sep 2026, a fresh Reiss quote reading £1,818.14 one-off + £260.31 a month with nothing ticked
on screen: *"a fresh Reiss quote still have these numbers - refresh it?"*

The per-SKU field lines are summed wherever `fields[id].on` is set, and until #467 that always matched
the fields card being on screen, because every record opened with the legacy type on. A client
record from before the quote types existed now opens on Spark AI — the card is gone but its ticked
lines (and the maintenance hours on them) were still in the total. `fOn(id)` is now gated on
`typeOn('ai')`: a line is ON only while its quote type is; the record keeps its ticks (✎ Edit of an
old snapshot brings the type and the card back together), the figure follows the screen.

**↺ Start fresh** in the hero puts the client record back to blank — scope, lines, Spark AI routes,
bundle, discount, setup — behind a confirm; the market and the pulled feed index are kept, and the
saved quotes on the tracker and the shared rate card are never touched.

### The scope column says what was quoted

Ray, 21 Sep 2026, liking the new tracker: *"can scope be more details (should be market + quote type
'Spark AI + New dashboard + new feed.. etc from selection)"*. The column read "whole catalogue · 20,128
SKUs" for every quote — the product scope and nothing about the service. Line one now names the quote
types on the snapshot, read off the frozen lines (`qTypesWord`): `Spark AI ×6 · New dashboard ×2 · New
feed · LIA feed · Retainer 10h/mo · New products bundle · Setup fee`; line two is the market and the
product scope, printed only when a line is priced on products (a retainer alone has no catalogue to
name). The full includes line (route mix, cohort, discount) is the cell's tooltip. The orange type chips
under the client name said the same in fewer words and are gone; header reads *Quoted · scope*.

## One tab per option in the Excel export

Ray, 21 Sep 2026: *"when export quote - export Option on seperate tab in the same excel."*

⇩ Export quote on a build that belongs to a proposal writes **one workbook with one tab per option** —
`Option 1 · QT261571`, `Option 2 · QT261571-2`, … — each tab the full Finance-format cost detail for that
option, plus `Option N · this build` when an option is being added and not yet saved. A quote outside a
proposal exports as it always did (one tab, `<Client> - Cost Detail`).

The sheet builder reads the live builder, so each option's tab is produced by `withSnap(q, fn)`: the
option's snapshot is read into a temporary client record through the same `applySnap` mapping ✎ Edit
uses, `quoteSheet({ref, at})` renders it with the option's own reference and save date, and the live
record, client, market and edit state come back exactly as they were — no render, no save, no toast.
The option under ✎ Edit is rendered off the live builder with its saved ref. As with ✎ Edit, routes,
lines, the frozen bundle price and the block rate are the snapshot's; Spark AI rates are today's rate
card. `xlsxBytes(tabs)` renders every sheet against one style table before `styles.xml` is written,
gives each sheet its own wordmark drawing, and defines `Dayrate` per sheet (`localSheetId`) since two
options can carry two block rates. Tab names are Excel-safe (31 chars, no `[]:*?/\`).

