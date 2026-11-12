# Title Lab (`/titles`)

Ray, 12 Nov 2026: "a new module just for the title. The audit will compare the master feed to the output feed,
showing the state of the title and how the title mask looks. It will pick any attribute — brand, item type,
pattern, material, color, size, age group, gender — that exists in either the master or the shopping feed. The
comparison can be side by side, either for a single product or multiple products, because I want to showcase to
clients that we are changing titles systematically and automatically. The data can be scanned; for example, if
material appears in the title, it must also appear in the material field … then provide a summary of what we
have done so far."

## What it reads

Nothing is stored. Three reads, all existing lanes, all scoped per signin:

| Read | Route | What for |
|---|---|---|
| The roster | `GET /api/catalog/roster` | every client × market with a wired feed |
| The shopping feed | `GET /api/feed/proxy` | the title Google receives, and every attribute field |
| The master feed | `GET /api/catalog/master` + `/master/file` | the client's own title and source columns |

The feed and the master are joined in the browser by the Catalogue's engine (`docs/catalog_engine.js`): the master
column carrying the most of the feed's IDs is the join, the last duplicate row wins. Titles are read by
`docs/titlelab_engine.js` (UMD `FeedTitles`, served at `/titles/engine.js`).

**Before** is the master feed's title for the product. Where no master row joins (a sheet-backed feed, a master
FeedHero cannot serve, no ID column in common) it falls back to `c:fs_data_original_title`, the title FeedSpark
stamps on each item it rewrites, and every surface says so. A product with neither has no before and is never
counted as rewritten.

## How a title is read

1. **The product's own values first.** Brand, colour, material, pattern, size and the last level of the product
   type are looked for in the title as whole-word runs, singular or plural. The shopping feed's field is tried
   first on the shopping title, the master's on the master title.
2. **Then the feed's own vocabulary.** A value at least three products carry in that field (three words at most)
   is recognised in any title, plus a short base list of colours, materials and patterns. A brand's words are
   never read as a colour or a material.
3. **Gender and age group** are read from their usual words (women's, mens, girls, kids, baby).
4. **Size** needs a marker ("Size 12"), or to be the field's own value.
5. Anything else is the **product name**.

The **mask** is the attributes in the order the title says them. Two titles with the same mask were built the
same way; the share of titles on the three biggest masks is "systematic" as a number.

## The title-against-field check

For each attribute a title names:

| Result | Meaning |
|---|---|
| Agrees | the field holds the same value |
| Not in field | the title names it and the field is empty — Ray's example: material in the title, no `g:material` |
| Differs | the field says something else |
| Field only | the field holds a value the title leaves out — a choice, not a fault |

A child word in a title ("Girls") agrees with any child age band and differs only from `adult`. Nothing is
corrected by the page; **→ Brief** files `Title Fix - <Attribute> in title, not in field - <Brand> <MKT> - MMYY`
into Workflow in a new tab, with the counts and ten example products.

## Teaching it (auto-learn)

Ray, 12 Nov 2026: "is there a way for the whole dashboard to auto-learn, so that when I start switching or adding
comments and saving feedback, it applies across the brands and the feed? … the algorithm is picking 'youth' as the
item type … the item type should be 'shoe'."

Two things changed. First the reading itself: the item type is looked for at every level of the product type from
the leaf up (three at most), with gender and age words set aside — so a tree whose leaf is the brand
(`Kids > Girls > Shoes > Geox`) reads "Shoes", a level like "Girls Youth" is nobody's item type, and "Youth" is the
age group.

Second, a person's correction is a **rule** that holds for every title it fits:

| Rule | Made by | Effect |
|---|---|---|
| `{w, a}` — this word or phrase is this attribute (or part of the product name) | clicking any word on a Side by side card | read first, before any field, on every title |
| `{ok, a, t, f}` — a title saying *t* while the field says *f* is not a gap | "not a gap?" under a check, or on a Most common gaps row | that pair reads as agreeing |

Each is saved for **this brand** (every market of it) or **every brand**. Stores: shared state `titleteach`
(`<Brand>|<rule id>`, client-scoped like every Workflow route) and `titleteachall` (house-wide). Every brand's rules
apply first and the brand's own win over them. Saving re-reads every title at once; a save the server refuses says
so and holds on that screen only. "What it has been taught" lists the rules that apply to the feed on screen, each
with Forget. A taught span wears a double underline on the card.

Not learned automatically: nothing is inferred from a correction beyond the rule itself — one click teaches one word
or one pair, for the scope chosen.

## Before → after

Each product is one of: unchanged, attributes added, re-ordered, reworded, attributes removed, no master title.
"Re-ordered" compares the attribute order with the name's words set aside, so adding name words is a rewording.
Each found attribute also carries where its value came from: the client's own data (its master column, or its
words anywhere in the master row — values under three characters never count, a size "M" would match an ID),
populated by FeedSpark (the feed's field holds it, the master does not), or in the title only.

## The page

Six folding sections (per device, `fcc-tl-fold`; a fresh device opens the first two):

1. **What we have done** — six tiles and the summary in words (⧉ Copy summary puts the same words on the clipboard).
2. **Side by side** — one product or up to twelve: before and after with every attribute marked where it sits, both
   masks (ringed chips are attributes the title gained), character counts against Google's 150, and one row per
   attribute: master value and column, shopping field, in the title before, after, and the check. Opens on the
   clearest examples, one per distinct master title.
3. **The title mask** — masks ranked by share, shopping feed or master feed; share of titles naming each attribute
   before → after. A mask opens its titles in the list.
4. **Title against the fields** — the four results per attribute; a count opens those titles.
5. **Every title** — All / Rewritten / Unchanged / To look at, a word filter, ⬇ CSV. A row adds the product to Side by side.
6. **How it is read.**

Deep link: `/titles?brand=&market=&id=<id>[,<id>]`.

## Limits

- A word no field in the feed has ever held is read as part of the name, so a genuinely new attribute value is
  under-counted until a field carries it.
- The master is FeedHero's newest import; a product dropped from it since the output was built has no before.
- Text only: nothing here looks at the image.

## Harnesses

- `tools/test_titles.mjs` (qa_gate / presync / validate) — the engine on hand-made titles, the whole synthetic set
  through the real Feed Lab parser and Catalogue join, and the wiring.
- `tools/check_titles.js` (Playwright, presync) — the real page on the synthetic set of `tools/titles_stub.js`, every
  count against the stub's own rules.
