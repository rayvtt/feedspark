# Spend Lens — where a market's Google Ads money sits against what it returns

> Ray, 19 Oct 2026, sending the Field Breakdown pivot for Reiss UK: *"can you bring in Playbook - a
> few interesting RoAS improvement or spend optiimser tactics from field breakdown ? - let's take an
> example of Reiss UK here - (you can see on RoAS avg: Textured, Striped, Checked, Colourblock) has
> way better ROAS compared to Plain where most Spend is at"*

## 1. What it is

A section on the **Playbook rail** (`/workflow?pb=1` → 🧭 Review, under the Top 3 actions and the
Test Lab) that reads how an account's Google Ads spend is split across its own catalogue, and names
what is wrong with the split.

The finding Ray is pointing at is not about patterns. It is a **shape**: most of the money on the
value that returns least, while several values of the same field return far more on very little.
That shape is readable on any cut of the catalogue, so the engine takes a cut and says what is wrong
with how the money sits in it.

## 2. Where the figures come from — and where they do not

`/breakdown` answers Ray's exact question by streaming the **whole feed** into the browser and
joining Google Ads onto it per product. That is the right instrument for a field nobody anticipated
— `g:pattern` among them — and far too heavy for a rail that has to open in a moment.

So the rail reads **FeedHero's own cuts**: the same `roas_dashboard` aggregations `/roas`'s Segment
select reads, through the same `roaslive:<cmpid>:<agg>:w30` records, which means the rail and the
ROAS module can never disagree about a value's spend or return. Eight cuts (`SL_CUTS`): product
category, brand, colour, gender, age group, price type, product age, custom label 0.

A field FeedHero does not cut stays `/breakdown`'s to answer, and the section says so with a link
rather than passing its eight cuts off as the whole feed.

## 3. What costs money, and what does not

| | |
|---|---|
| `GET /api/spendlens?client=` | reads **only what is already stored** — one KV get for the index, then the cached cut records of the three biggest-spending markets (`SL_MARKETS`). No MCP call, nothing spent. The panel opens on what is known. |
| `POST /api/spendlens?client=&market=` | the ⚡ on a market: reads its missing cuts through the MCP and writes the **same** `roaslive:` keys, so `/roas` gains them too. A cut read inside its six hours is skipped. |

Reiss runs 28 markets; reading every cut of every one of them would be 200+ reads for a panel, with
the money nowhere near them. The three biggest are read; the rest are **counted and named**, as are
the markets that carried no spend in the window.

## 4. The three rules a figure here rests on

- **Money never crosses a currency.** A cut is one market, so one currency; a cut whose spending
  rows carry two is refused with the reason, never blended.
- **Every rate is computed from the rows shown** (revenue ÷ spend), never read off a field, so the
  blended figure and the rows a reader compares against it always add up.
- **A return read on too little traffic is not a finding.** A value needs `SL_MIN_CLICKS` (100)
  clicks and `SL_MIN_SHARE` (0.2%) of the cut's spend before its ROAS proposes anything. What falls
  under that is **counted and named**, never dropped silently and never ranked.

Two more that only show up on real data:

- **The category cut is a tree.** FeedHero gives every level its own aggregate row, so `Women` and
  `Women > Dresses` both appear and adding them up counts the dresses twice. Only the top level
  partitions the catalogue, so only the top level is compared, and the page is told how many rows
  that left out.
- **A laggard is judged against the rest of its field, not against a blend it dominates.** The whole
  point of that finding is a value carrying most of the money — which drags the blended figure onto
  itself. On Ray's own screenshot the biggest value holds 86% of the spend, so "below the field"
  could almost never fire against exactly the case worth raising. The evidence line states the rest
  of the field's return **beside** the field's own.

## 5. The tactics (`SL_TACTICS`)

A finite, named set. Each either produces a finding off this market's own figures or produces
nothing — there is no tactic here that can be proposed without evidence.

| | |
|---|---|
| 📈 **starved** | Values returning ≥ `SL_WIN` (1.35×) what the field returns, on ≤ `SL_SMALL` (8%) of its spend. Ranked by what the gap is worth: spend × how far the return runs ahead. |
| 💸 **laggard** | The biggest-spending value, carrying ≥ `SL_BIG` (20%) of the spend, returning ≤ `SL_LAG` (0.92×) what the rest of the field returns. |
| 🧊 **dead** | Values carrying real spend and no revenue at all over the window. |
| 🚫 **unlisted** | FeedHero's own "Unlisted SKUs in Ads traffic" — Google Ads still serving products the market's feed does not hold. The market's own finding, raised once however many cuts have been read; never a value of any cut. |

**The swing** shown under a starved finding is stated as what it is: a tenth (`SL_MOVE`) of the
laggard's spend earning the winner's own return instead of the laggard's. Both numbers are on the
screen. It is arithmetic on two readings and the line says so — it is not a forecast.

One finding of a kind per market leads; the same shape read on four cuts of the same catalogue is
one thing to do, not four, so the rest fold behind *"N more on other cuts"*.

## 6. → Brief

Every finding carries → Brief, which goes through the page's **own** composer (`window.FCCBrief`) —
the same function every module deep link lands in, so a brief raised here is a brief raised in
Workflow: same draft, same `[ibfcode]`, same save into the pipeline and the same row filed into
Intake and the client's Project Plan. The task is `Spend Lens - <tactic> - <Brand> <MKT>`, category
`account` (`technical` for unlisted spend), and the scope carries the finding's evidence verbatim.

## 7. Harnesses

| | |
|---|---|
| `tools/test_spendlens.mjs` | the engine on a fixture shaped like Ray's screenshot with **invented figures** — the currency refusal, the tree trim, the thin-traffic floor, the laggard's basis, the swing, honest-empty, the brief, and the route/rail wiring. No client spend or revenue is committed anywhere in this feature. |
| `tools/check_spendlens.js` | the real rail in Chromium: the findings drawn in the route's own words, every unread cut named, ⚡ posting one market and the panel re-reading, → Brief filling the composer, the fold, and 390px. |

Both in `qa_gate` / `presync` / `validate.yml`.
