# deck-templates/ — the FeedSpark deck template library

Reference `.pptx` files that govern how every new FeedSpark deck is built. **All deck output
is PowerPoint (`.pptx`) — HTML decks are no longer an output option** (Ray, Aug 2026). A
deck request ("intro for Hobbycraft new agency", "Q2–Q3 review for Schuh") is built
by referencing the files in this folder, not from scratch.

## The bank at a glance

Every reference here is a Ray-approved deck that shipped. Read the **core template** always,
then the row whose **deck type** matches what you are building; a client exemplar beats a
generic one only when the client is the same.

| Reference | Deck type | What to reach for it for |
|---|---|---|
| `FeedSpark_Core_Deck_Template.pptx` | — (governs all) | Design, elements, colour, type and voice. 18 named layouts fully populated. Never skip it. |
| `StrategyReview_Reference.pptx` | Strategy Review | Chapter spine, proportion, and how much to cut. The FCC's own modules as the evidence. |
| `KeywordsReport_Reference.pptx` | Keyword optimisation report | A short monthly client read-out: what shipped, what moved in the feed, what each test returned. Dense data slides built by hand. |

Depositing a new one is three steps — attach the `.pptx`, say it is a deck reference, and the
session files it under the naming convention below and adds its row to this table. The table
IS the index: a reference with no row here is one nobody will know to read.

## The core template

**`FeedSpark_Core_Deck_Template.pptx`** — the governing reference for design, elements,
colour, text and voice on every FeedSpark deck. It is the Ray-approved Superdry Strategy
Review 2024–2026 (46 slides), built on the machine template
`tools/templates/feedspark_deck.pptx` and saved back from PowerPoint. Treat it as the
worked exemplar: what every layout looks like fully populated, and how FeedSpark copy
sounds when it is done right.

Design system it carries (also lives in the machine template's theme):

- **Typeface:** Inter, all weights
- **Ink:** slate `#0F172A` / `#1E293B` on white `#FFFFFF`; wash `#F8FAFC`
- **Accent:** FeedSpark orange `#F7941E` (purposeful use only)
- **Chart accents:** blue `#3B82F6`, green `#10B981`, violet `#8B5CF6`, pink `#EC4899`,
  muted slate `#94A3B8`
- **18 named layouts:** Title Slide, Section Marker, Title and Content, Two Content,
  Image Left/Right, Two–Six-Card Grids, Big Stats, Numbered Steps, Pricing / Tiers,
  Table, Quote / Statement, Closing, Blank
- Footer "Private & Confidential" convention; no logo, no decoration for its own sake

## The Strategy Review reference

**`StrategyReview_Reference.pptx`** — the shape a **Strategy Review** takes, deposited by Ray
on 24 Sep 2026: the Schuh Sep-2026 review after he edited it end to end (55 slides down to 32).
Read this one before any Strategy Review; it overrides the core template on *structure and
proportion*, never on design.

What it teaches that the core template does not:

- **Eight chapters, each a Section Marker plus two to four content slides.** The marker's
  subtitle is a one-sentence CLAIM the slides after it then have to support. Chapter count is
  the deck's spine — an agenda that disagrees with the markers is the defect (see below).
- **The FCC's own modules carry the evidence.** Ray pasted screenshots straight from
  `/schedule` (paused scheduled work), `/tasks` (hours by type — billable vs technical),
  `/golden` (required / recommended / content quality, the Golden Score dial) and `/volume`
  (new-product arrivals). A Strategy Review is largely a guided read of the client's own live
  data, not prose about it.
- **A live dissection is a named chapter.** "Feed optimisation score (let's dissect
  real-time!)" is an in-meeting demo of `/golden`, not a static slide.
- **Hours allocation is client-facing.** Where the retainer went, with the displacement
  finding stated plainly ("~20% of hours are going into Technical work — there's an
  opportunity for automation here").
- **Cut hard.** Ray removed two whole chapters (Look-back period, Value delivered) and every
  slide whose only job was to restate a number another slide already carried.

**A screenshot sized past the right-hand card hides that card.** On three slides here the
picture spans 6.5″–13.3″ while the Two-Card Grid's card 2 starts at 7.11″, so the card's text
was in the file and invisible on screen. Either drop card 2 on a picture slide or keep the
picture inside the right column — never leave copy underneath it.

## The Keyword optimisation report reference

**`KeywordsReport_Reference.pptx`** — the shape a **monthly keyword read-out** takes, deposited
by Ray on 19 Nov 2026: Superdry GB, November 2026, five slides. Read it before any keyword or
optimisation-results deck; like the Strategy Review it overrides the core template on
*structure and proportion*, never on design.

**Five slides, and that is the point.** Cover · what shipped and when · what changed in the
feed · the result test by test · thank you. A monthly read-out is not a review: there is one
claim per slide and no slide restates another's number.

What it teaches that the other two do not:

- **Every headline is a CLAIM, not a label.** "Knitwear went from 11% to 63% keyworded",
  "Every keyword test since October 2025 lifted impressions" — the slide beneath then has to
  support it. An eyebrow in caps above it says which deck section you are in; a quiet line
  under it states the basis ("Share of products carrying at least one keyword phrase, since
  30th Sept.").
- **The client's own data is the artwork.** The cover's right-hand card is real keyword slots
  under real product-type paths (`Women › Jumpers › Patterned Jumper` with its chips), not a
  stock image. Every chart is drawn from shapes — dumbbells for before→after, a month-axis
  timeline with brief-due and goes-live dots, inline bars in the results table.
- **A right-hand rail carries the summary.** Slides 03 and 04 split at ~8.8″ behind a hairline
  rule: the table on the left, the "across the 14 tests" / "what a keyword slot carries"
  reading on the right. It is where the so-what lives.
- **State the test method on the slide that shows results.** The footnote defines A/B against
  before/after and says the bar is capped past +100% (`›`). A figure whose basis is unstated
  is a figure a client cannot check.
- **Say what is not known yet.** "Read-outs still to come — coats & jackets, knitwear and
  loungewear are in analysis." Honest gaps beat a padded table.
- **Closing slide is a real sign-off**: Thank you, a line inviting the next thing
  ("a theme to add to the calendar"), then name, role and address.

Geometry worth copying (13.33″ × 7.5″, every slide on the **Blank** layout, shapes placed by
hand rather than in placeholders):

- Cover and closing carry a full-height orange spine at `x=0`, `0.18″` wide; content starts at
  `0.87″`. Content slides use a `0.67″` left margin with a small orange tick at `0.67, 0.40`.
- Slide number top-right at `x=12.10` — **cover and closing are unnumbered, content runs 01+**.
- Footer hairline at `y=6.62`, "FeedSpark · Private & Confidential" at `y=7.18`, every slide.
- Type runs small and dense: body 7.5–8pt, labels 7pt caps, headline 17–26pt, hero stat 40pt.
- Palette beyond the core: rules `#E2E8F0`, muted text `#64748B`, washes `#F1F5F9` / `#EFF6FF`,
  blue ramp `#3B82F6` / `#60A5FA` / `#BFDBFE`, green `#059669`, amber `#F59E0B`.

## Two files, two jobs

| File | Job |
|---|---|
| `tools/templates/feedspark_deck.pptx` | The **machine template** the exporter populates — theme, master, 18 named layouts. Slides carry text in placeholders only. |
| `reference-files/deck-templates/*.pptx` | The **reference library** — Ray-approved exemplars showing what finished decks look and sound like. Read before building; never edited by a build. |

## Depositing new references (Ray)

Attach a `.pptx` in any Claude Code session (or ask for one to be filed from the FCC) and say
it's a deck reference — the session commits it here. Name it for what it teaches:

- `FeedSpark_Core_Deck_Template.pptx` — the one governing reference (replace only on Ray's
  explicit say-so; keep the same filename so every pointer stays valid)
- `<DeckType>_Reference.pptx` (e.g. `Intro_Reference.pptx`, `Onboarding_Reference.pptx`) —
  how a specific deck type is structured
- `<Client>_<DeckType>_<Period>.pptx` — a client-specific exemplar worth reusing

When a deck build starts, the `/deck-generator` skill reads this folder and uses the closest
matching reference (deck type first, then client) on top of the core template. New deposits
are picked up automatically — the skill lists the folder every run. Add the reference's row to
**The bank at a glance** above in the same commit; that table is the only index. (The FCC's
Deck Generator page carried a copy of this list until it was retired on 12 Nov 2026 — there is
no page to update any more.)
