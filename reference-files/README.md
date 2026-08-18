# reference-files/

Authoritative source PDFs and templates that govern FeedSpark deliverables. These are inputs,
not generated outputs — drop the real source files here.

## deck-templates/ — the deck template library

**All deck output is `.pptx` (HTML decks are no longer an output option — Ray, Aug 2026).**
`deck-templates/FeedSpark_Core_Deck_Template.pptx` is the governing reference for design,
elements, colour, text and voice on every new deck; Ray deposits further reference decks
(per deck type or per client) into the same folder. See `deck-templates/README.md` for the
convention and how the `/deck-generator` skill consumes them.

## Add these (referenced by CLAUDE.md but not included in the migration)

- **Reiss–Dentsu introduction PDF (Mar 2026)** — the *governing* design system: colours
  (orange `#F5A623`), Lato typography, white cards with `#E6E6E6` borders. Every design rule in
  `CLAUDE.md` derives from this file. Add it so new decks can be checked against the source.
- Client source decks / templates referenced in `CLAUDE.md` and `docs/CHAT_HISTORY.md`
  (e.g. the Superdry service-review PPTX, per-client project-plan exports).

> ⚠️ This folder was **empty** in the migration package — the design-system PDF was not included.
> Add it before producing new client materials so the design constraints can be verified.
