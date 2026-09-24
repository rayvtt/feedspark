# deck-templates/ — the FeedSpark deck template library

Reference `.pptx` files that govern how every new FeedSpark deck is built. **All deck output
is PowerPoint (`.pptx`) — HTML decks are no longer an output option** (Ray, Aug 2026). A
deck request ("intro for Hobbycraft new agency", "Q2–Q3 review for House of Bruar") is built
by referencing the files in this folder, not from scratch.

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
are picked up automatically — the skill lists the folder every run; also add a line to the
table in the Deck Generator module (`docs/FeedSpark_DeckBuilder.html`, `TEMPLATE LIBRARY`
marker) so the FCC page shows it.
