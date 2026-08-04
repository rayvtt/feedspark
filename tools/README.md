# tools/ — FeedSpark build & edit tooling

Runnable helpers for building decks and doing parallel HTML editing **inside Claude Code**.

## HTML deck → PowerPoint (`deck_to_pptx.py`)

Exports any live FeedSpark HTML deck as a themed, **editable** 16:9 `.pptx`.

```bash
pip install python-pptx pillow lxml                                   # one-time
python tools/deck_to_pptx.py docs/Superdry_Strategy_Review_AllTime.html superdry.pptx
python tools/preview_tmpl.py superdry.pptx /tmp/qa                    # must print "no overflow warnings"
```

> **Why not a direct conversion?** The HTML decks are continuous-scroll documents with
> variable-height sections; PPTX is a fixed 13.333in × 7.5in canvas with no reflow. Mapping the
> DOM straight onto slides runs tall sections off the slide edge — the "cropping" problem.
> Screenshot/print-to-image exports avoid that only by making the text uneditable.

Instead it **re-flows semantically**: it reads the deck's own component vocabulary
(`.stats`/`.card`/`.tbl-wrap`/`.bars`/`.sc-grid`/`.tiers`/`.road`/`.callout`/`.note`/`.agenda`),
turns each into a *measured* renderable, then flows those onto as many slides as they need —
splitting card grids, table rows and bar lists rather than overflowing them. Because every deck
is built from the same component library, one tool covers all of them (verified against Superdry,
Reiss, YuMOVE and the template: 0 overflow warnings each).

- **Chapter dividers** become dark full-bleed slides with the ghost numeral; a section continuing
  onto another slide repeats its title with an "(cont.)" eyebrow.
- **Widow control**: a table never starts unless its header plus ~2 rows fit.
- **Status becomes colour, not glyphs.** `✓ ⚑ ✦ ◆` exist in neither Liberation Sans nor Lato, so
  PowerPoint would font-fall-back per glyph (inconsistent across Win/Mac/Slides). They're stripped
  and status text is colour-coded instead (green done · orange in-flight/parked · grey open).
- **`--keep-checks`** retains the `?` data-check badges. They're dropped by default: the web deck
  has a toggle to hide them, a `.pptx` does not.

### Measurement must mirror the previewer exactly
Height/wrap is measured with Pillow using the *same* metrics `preview_tmpl.py` renders with —
Liberation Sans, `SC = 120` px/inch, and a wrap width of `shape_width_px - 4`. Approximating any
of those (e.g. measuring at 96 dpi, or with a percentage fudge factor) makes borderline labels
measure as one line and render as two. Two related rules, both of which caused real bugs here:
**measure the string you actually draw** (uppercase when the textbox uses `caps=True` — capitals
are wider) and **measure at the width you actually draw into** (not the untrimmed column width).

## Deck previewers (PPTX → PNG QA)

> **Why these exist:** the `pptxgenjs → LibreOffice (soffice) → pdftoppm` pipeline in older
> notes **does not run in the Claude Code environment** — `soffice` fails to load any file and
> `pdftoppm` is absent. These previewers render a `.pptx` to PNGs directly with `python-pptx` +
> Pillow, so slides can be QA'd for overflow, wrapping and layout without LibreOffice.

Build decks with **`python-pptx`** (native, editable output), then QA with a previewer:

```bash
pip install python-pptx pillow          # one-time
python tools/preview_tmpl.py deck.pptx  /tmp/qa      # → /tmp/qa_1.png, _2.png, …
```

- **`preview_tmpl.py`** — template-aware. Composites layout chrome (cards, accent bars, gradient
  bars) *under* each slide's own placeholders, resolves inherited `defRPr` styling, and renders
  real tables. Use this for decks built on a themed layout/shell. Prints **overflow warnings**
  `(slide, text, text_h_px, box_h_px)` so you catch text that spills its box.
- **`preview_simple.py`** — lighter previewer (hanging-indent aware) for decks without a
  templated layout.

Fonts: renders with Liberation Sans (Arial-metric-compatible) so wrap/overflow closely match
PowerPoint. A `sc = 120` px/inch constant controls resolution.

### Deck build gotchas (python-pptx)
- Multi-line text: split on `\n` into real paragraphs — a single run with `\n` does **not** line-break.
- `RGBColor(0x1A,0x36,0x5D)` form only — never packed hex, never `#`, never 8 digits.
- Set slide size before adding slides; remove unused placeholders (`idx==1`) when drawing custom content.
- Draw bar charts / funnels as native shapes (rectangles) — they render in both the previewer and PowerPoint; native pptx *charts* don't render in the previewer.
- Triangle/arrow glyphs (`▲ ▼`) render in both; drawn triangles (`ISOCELES_TRIANGLE`) do **not** in the previewer.

## Parallel HTML editing

- **`apply_edits.py`** — apply a `data-eid`-keyed JSON edit patch onto an HTML deck template.
  This is the git-native half of the parallel-editing workflow (see `../docs/WAYS_OF_WORKING.md`).

  ```bash
  python tools/apply_edits.py docs/YuMOVE_Strategy_Review_Jul26.html edits.json  out.html
  ```
