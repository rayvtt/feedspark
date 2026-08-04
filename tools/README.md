# tools/ — FeedSpark build & edit tooling

Runnable helpers for building decks and doing parallel HTML editing **inside Claude Code**.

## HTML deck → PowerPoint (`deck_to_pptx.py`)

Exports any live FeedSpark HTML deck as a themed, **genuinely editable** 16:9 `.pptx`.

```bash
pip install python-pptx pillow lxml                                   # one-time
python tools/deck_to_pptx.py docs/Superdry_Strategy_Review_AllTime.html superdry.pptx --audit
```

### It populates a template — it does not draw slides

This is the load-bearing idea, and the thing an earlier version of this tool got wrong.

`tools/templates/feedspark_deck.pptx` is a real PowerPoint template: a theme (Inter,
6 scheme colours), a slide master, and **18 named layouts**. Every visual element — the card
panels, the accent bars, the decorative circles, the gradient footer bar, the wordmark — lives
on those layouts as ordinary shapes. **Slides carry text in placeholders and nothing else.**

That is what makes the output editable in the way a client means it: they can restyle globally,
swap the theme, re-order, or drop a slide onto a different layout and have it re-flow. The
earlier renderer painted `add_shape` rectangles and `add_textbox` calls at absolute inch
coordinates onto the **blank** layout. It *looked* right and was a picture of a deck: no
layouts, no placeholders, no theme, no native tables, and nothing that survives an edit.

> **Two rules.** Never add a shape — if something has no layout, add a layout to the template.
> Never shrink text below `MIN_OK` (82%) to make it fit — re-lay it out instead. 7pt is not a fit.

### The layouts

`Title Slide` · `Section Marker` · `Title and Content` · `Two Content` · `Image Left/Right` ·
`Two-` through `Six-Card Grid` · `Big Stats` · `Numbered Steps` · `Pricing / Tiers` · `Table` ·
`Quote / Statement` · `Closing` · `Blank`.

Blocks map onto them semantically: `.stats`×3 → Big Stats, `.tiers`×3 → Pricing / Tiers,
`.road`×3 → Numbered Steps, `.agenda` → Two Content, `.callout` → Quote / Statement,
`.tbl-wrap` → Table + a **native PowerPoint table** (not drawn rectangles) carrying the
template's own table style, and card/scorecard grids → the N-Card Grid that fits.

### Fitting is layout, not shrinking

PPTX does **not** clip an over-long text frame — it spills the text outside the shape, straight
over the neighbouring card panel. So the failure mode to design against is *overlap*, not
truncation, and the fix is not to cut copy:

1. **Shrink** in steps to `MIN_OK` (82%), setting the run size explicitly. `normAutofit` alone
   is not enough — PowerPoint recomputes `fontScale` on open, LibreOffice and Google Slides do
   not, and a deck that only fits in one renderer is not shippable. Size is the *sole* override;
   family and colour stay inherited so the layout still drives a global restyle.
2. **Re-lay out** if that is not enough: `pick_grid()` steps down to a layout with fewer, bigger
   panels (six small cards → two slides of three) and `balanced()` splits 4-at-3 as 2+2, not 3+1.
3. **Trim to the lead sentence** for the one-line strips (`Subtitle`, `Key Message`, …), which
   are designed for one punchy line rather than a paragraph.

`--audit` is the QA loop — it prints the layouts used, everything shrunk, and anything still
over capacity. **Ship when it says `still over capacity: 0`.** Verified across Superdry (54
slides), Reiss (66), YuMOVE (49) and the template (46), 0 drops each.

### Other behaviour worth knowing

- **The Key Message strip is a layout shape**, so leaving it unfilled renders a stray coloured
  bar. `finish()` always fills it or deletes the placeholder — and deletes every other empty
  placeholder too, so PowerPoint shows no "Click to edit" prompts.
- **Slides rename their placeholders on clone** ("Text Placeholder 4"), so a slide-side lookup
  by name fails. Names are resolved to `idx` against the *layout*, then used on the slide.
  (The two image layouts ship with a duplicate `idx=1`; they're unused for that reason.)
- **A bar list has no column names**, so it renders as a *headerless* table (`firstRow="0"`)
  rather than a table with an empty coloured header band that reads as a bug.
- **Status becomes colour, not glyphs.** `✓ ⚑ ✦ ◆` exist in neither Liberation Sans nor Inter, so
  PowerPoint would font-fall-back per glyph (inconsistent across Win/Mac/Slides). They're stripped
  and status text is colour-coded instead (green done · orange in-flight/parked · grey open).
- **A long hero lede is a pull-quote**, not a subtitle — it gets its own Quote slide rather than
  being shrunk into a one-line strip.
- **Sections without their own `.sec-title`** inherit the chapter title, so continuation slides
  never render as a bare " (cont.)".
- **`--keep-checks`** retains the `?` data-check badges. Dropped by default: the web deck has a
  toggle to hide them, a `.pptx` does not.

### Measuring capacity
Wrap/height is measured with Pillow against each placeholder's *real* geometry and its own
`lstStyle` font size, read from the layout — not hard-coded. Measurement uses Liberation Sans
while the deck renders in Inter, so `SAFETY = 0.96` demands slightly more room than measured
rather than landing on the boundary. **Measure the string you actually draw** (uppercase is
wider) and **at the width you actually draw into** — both caused real bugs here.

### Regenerating the template
The template is the stripped shell of a reference deck (slides removed, master + layouts + theme
kept). To change how *every* export looks, edit `tools/templates/feedspark_deck.pptx` in
PowerPoint — a layout edit re-themes every deck built from it. Adding a component means adding a
layout there plus a branch in `emit_blocks()`.

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
