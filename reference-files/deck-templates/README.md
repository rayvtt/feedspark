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
