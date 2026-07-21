# tools/ — FeedSpark build & edit tooling

Runnable helpers for building decks and doing parallel HTML editing **inside Claude Code**.

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
