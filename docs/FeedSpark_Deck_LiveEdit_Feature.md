# FeedSpark Deck — Live Edit & Sync Feature

## Overview
All future FeedSpark HTML strategy decks and landing pages should include the inline editing and JSON patch sync system. This allows Ray (or any account manager) to edit copy directly in the browser while Claude handles structural/content changes in parallel — then merge cleanly.

---

## Feature set

### 1. Edit mode toggle
- Button: `✎ Edit mode` (bottom-right edit bar)
- Toggles `contenteditable` on all text elements (headings, paragraphs, table cells, stat values, card copy, notes, callouts, code blocks, pills, before/after examples)
- Orange dashed outlines show editable regions; solid orange on focus
- Excludes nav chrome, edit bar, footer bar, interactive controls

### 2. JSON patch export/import
- **⤴ Export edits** — diffs current text state against the original snapshot, outputs a JSON blob with only changed elements (each keyed by `data-eid`, with a human-readable `preview` field). Copies to clipboard.
- **⤵ Import edits** — paste a JSON blob to apply edits from another session. Reports applied vs missed count.
- Elements are assigned stable `data-eid` attributes (`e0`, `e1`, ...) on first edit-mode activation. These survive structural changes (new sections added around them) so text edits land correctly on merge.

### 3. Download HTML
- **↓ Download HTML** — exports the full document with all edits baked in. Strips `contenteditable`, `spellcheck`, and `data-eid` attributes for a clean presentation-ready file.

### 4. Data-check flags
- **⚑ Data checks** toggle — shows/hides `<span class="chk">?</span>` markers on unverified figures. Toggle off before presenting to client.

---

## Workflow: parallel editing

### Ray edits copy
1. Open HTML in browser
2. Click `✎ Edit mode`
3. Click any text, type to change
4. Hit `⤴ Export edits` → JSON copied to clipboard
5. Paste JSON to Claude in chat

### Claude edits structure
1. Receive Ray's JSON patch
2. Apply structural changes (new sections, reordered content, updated data)
3. Import Ray's JSON edits on top
4. Re-export merged HTML

### Merge rules
- Ray's text edits take priority over Claude's text for the same element
- Claude's structural additions (new sections/cards) don't conflict with Ray's edits to existing elements
- If Claude deletes a section Ray edited, import reports it as "missed" — nothing fails silently

---

## Planned upgrade: Cloudflare Pages + KV

For decks containing confidential commercial data, deploy to Cloudflare Pages with:
- **Cloudflare Access** — email-gated, no public URL
- **KV store** — text edits auto-save to KV, keyed by `data-eid`
- **Template/content separation** — Claude pushes new HTML template versions, KV content persists independently
- Both Ray and Claude work on the same live URL

---

## CSS classes reference

| Class | Purpose |
|---|---|
| `body.editing` | Applied when edit mode is on |
| `[contenteditable]` | Applied to all editable text elements |
| `[data-eid="eN"]` | Stable element ID for JSON patch keying |
| `.chk` | Data-check flag marker |
| `body.hide-checks .chk` | Hidden when data-check toggle is off |
| `.edit-bar` | Fixed bottom-right toolbar |
| `.saved` | Flash confirmation message |

## Editable element selector

```
h1, h2, h3, h4, p, td, .lede, .sec-sub, .ag-t, .ag-d, .hero-meta b,
.stat .n, .stat .l, .sc-pct, .sc-label, .sc-note, .sc-tgt, .sc-warn,
.tier li, .mo li, .mo h4, .mo-m, .ask h4, .ask p, .card p, .card h4,
.note, .callout h4, .callout p, .proto li, .proto h4, .proto .desc, .proto .tag,
.pipe-card li, .pipe-card h4, .pipe-card .sub, .flow-step h4, .flow-step p, .fs-num,
.en-card h4, .en-card .before, .en-card .after, .attr-note,
.eyebrow, .ct b, .ct span, .q, .bar-row .bl, .pill,
thead th, tbody td, .feedrow, .sec-title
```

## Design system (from Reiss-Dentsu)
- **Colours:** Orange `#F5A623`, deep orange `#ED6F0B`, charcoal `#333333`, white `#FFFFFF`, light grey `#F7F7F5`
- **Font:** Lato (Google Fonts)
- **Prohibited:** No FeedSpark logo, no page number circles, no decorative lines in body
- **Footer:** "FeedSpark · Private & Confidential" left-aligned

---

*This feature spec applies to all future FeedSpark HTML decks and strategy review pages.*
