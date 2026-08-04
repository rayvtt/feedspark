#!/usr/bin/env python3
"""Convert a FeedSpark HTML deck into a themed, editable 16:9 PowerPoint deck.

The HTML decks are continuous-scroll documents with variable-height sections;
PPTX is a fixed 13.333in x 7.5in canvas with no reflow. A direct DOM->slide
mapping therefore runs tall sections off the slide edge (the "crop" problem).

This tool instead re-flows semantically: it parses the deck's own component
vocabulary (.stats/.card/.tbl-wrap/.bars/.sc-grid/.tiers/.road/.callout/.note/
.agenda/.contacts), turns each into a measured renderable, then flows those
renderables onto as many slides as they need -- splitting card grids, table
rows and bar lists across slides rather than overflowing them.

Because every FeedSpark deck is built from the same component library, this
works on any of them (Superdry, Reiss, YuMOVE, Monsoon, ...), not just one.

    pip install python-pptx pillow lxml
    python tools/deck_to_pptx.py docs/Superdry_Strategy_Review_AllTime.html out.pptx
    python tools/preview_tmpl.py out.pptx /tmp/qa      # -> overflow warnings

QA loop: generate -> preview -> fix overflow -> repeat until the previewer
prints "no overflow warnings".
"""
import re, sys, os, argparse
from lxml import html as LH
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from PIL import ImageFont

# ---------------------------------------------------------------- design system
INK        = RGBColor(0x1A, 0x1A, 0x1A)
INK2       = RGBColor(0x33, 0x33, 0x33)
MUTED      = RGBColor(0x76, 0x76, 0x76)
LINE       = RGBColor(0xE6, 0xE6, 0xE6)
PAPER      = RGBColor(0xFF, 0xFF, 0xFF)
PAPER2     = RGBColor(0xF7, 0xF7, 0xF5)
ORANGE     = RGBColor(0xF5, 0xA6, 0x23)
ORANGE_DP  = RGBColor(0xED, 0x6F, 0x0B)
DARK       = RGBColor(0x1C, 0x1C, 0x1C)
GREEN      = RGBColor(0x2E, 0x7D, 0x32)
RED        = RGBColor(0xC6, 0x28, 0x28)
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
FONT       = "Lato"

SLIDE_W, SLIDE_H = 13.333, 7.5
MARGIN     = 0.62
CONTENT_W  = SLIDE_W - 2 * MARGIN
FOOT_Y     = SLIDE_H - 0.42
BODY_TOP   = 1.62          # first content y when a section head is present
BODY_TOP_C = 0.78          # first content y on a "continued" slide
BODY_BOT   = SLIDE_H - 0.62
GAP        = 0.17

# Pillow metrics mirror preview_tmpl.py (Liberation Sans ~ Arial metrics), so
# heights measured here match what the QA previewer will measure.
LIB = "/usr/share/fonts/truetype/liberation/"
# Must match preview_tmpl.py's SC exactly: it rasterises at 120 px/inch, and the
# integer rounding of the pixel font size differs enough between 96 and 120 that
# a borderline label measured as one line here renders as two there.
SC = 120.0
# preview_tmpl.draw_textframe() wraps at `max(4, shape_width_px - 4)`; mirror that
# exactly rather than approximating, or borderline labels measure 1 line and render 2.
PAD_PX = 4.0
_fc = {}
def _font(pt_size, bold=False):
    key = (round(pt_size, 1), bold)
    if key in _fc: return _fc[key]
    path = LIB + ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf")
    _fc[key] = ImageFont.truetype(path, max(6, int(round(pt_size * SC / 72.0))))
    return _fc[key]

def wrap_lines(text, pt_size, width_in, bold=False):
    """Wrap `text` to `width_in` inches at `pt_size`; return the line list."""
    f = _font(pt_size, bold)
    limit = max(4.0, width_in * SC - PAD_PX)
    out = []
    for para in (text or "").split("\n"):
        words, cur = para.split(), ""
        if not words:
            out.append("")
            continue
        for w in words:
            trial = (cur + " " + w).strip()
            if f.getlength(trial) <= limit or not cur:
                cur = trial
            else:
                out.append(cur); cur = w
        if cur: out.append(cur)
    return out

def text_h(text, pt_size, width_in, bold=False, leading=1.30, caps=False):
    """Height in inches that `text` needs when wrapped to `width_in`.

    `caps` must mirror the textbox() call: uppercase is measurably wider, so
    measuring the un-uppercased string silently under-counts lines."""
    t = (text or "").upper() if caps else text
    n = max(1, len(wrap_lines(t, pt_size, width_in, bold)))
    return n * pt_size * leading / 72.0

# ---------------------------------------------------------------- html parsing
# Liberation Sans (and Lato) carry none of these; PowerPoint would have to
# font-fall-back per glyph, which is inconsistent across Win/Mac/Slides. Status
# meaning is carried by colour in the renderer instead -- see status_col().
GLYPH_SUB = {"\u2713": "", "\u2691": "", "\u2715": "", "\u25c6": "", "\u2726": ""}

def safe_glyphs(s):
    for k, v in GLYPH_SUB.items():
        s = s.replace(k, v)
    return re.sub(r"\s{2,}", " ", s).strip()

def norm(s):
    """Collapse whitespace AND drop glyphs no common PowerPoint font carries."""
    return safe_glyphs(re.sub(r"\s+", " ", (s or "")).replace("\xa0", " ").strip())

def cls(el):
    return (el.get("class") or "")

def has(el, name):
    return name in cls(el).split()

def first(el, xp):
    """First xpath match or None -- .find() only speaks limited ElementPath."""
    if el is None: return None
    r = el.xpath(xp)
    return r[0] if r else None

def txt(el, strip_chk=True):
    """Visible text of an element, optionally dropping the `?` data-check badges."""
    if el is None: return ""
    c = LH.fromstring(LH.tostring(el))
    if strip_chk:
        for b in c.xpath("//span[contains(@class,'chk')]"):
            p = b.getparent()
            if p is not None: p.remove(b)
    for br in c.xpath("//br"):            # <br> is a real line break, not a space
        br.tail = "\ue000" + (br.tail or "")
    parts = [safe_glyphs(norm(x)) for x in c.text_content().split("\ue000")]
    return "\n".join([x for x in parts if x])

class Blocks:
    """Semantic block list parsed out of a FeedSpark deck's <body>."""
    def __init__(self):
        self.hero = None
        self.items = []          # (kind, payload) in document order
        self.close = None

def parse_deck(path, keep_checks=False):
    doc = LH.parse(path).getroot()
    body = doc.body
    B = Blocks()
    sc = (lambda e: txt(e, not keep_checks))

    hero = body.find(".//header[@class='hero']")
    if hero is None:
        for h in body.iter("header"):
            if has(h, "hero"): hero = h; break
    if hero is not None:
        meta = []
        for m in hero.xpath(".//div[@class='hero-meta']/div"):
            b = m.find("b")
            lab = norm(m.text or "")
            meta.append((lab, sc(b) if b is not None else ""))
        B.hero = dict(
            eyebrow=sc(hero.find(".//div[@class='eyebrow on-dark']")),
            title=sc(hero.find(".//h1")),
            lede=sc(hero.find(".//p[@class='lede']")),
            meta=meta,
        )

    close = None
    for f in body.iter("footer"):
        if has(f, "close"): close = f; break
    if close is not None:
        cts = []
        for c in close.xpath(".//div[@class='ct']"):
            b, s, a = c.find("b"), c.find("span"), c.find("a")
            cts.append((sc(b), sc(s), sc(a)))
        B.close = dict(title=sc(close.find(".//h2")),
                       eyebrow=sc(first(close, ".//div[contains(@class,'eyebrow')]")),
                       contacts=cts)

    for el in body:
        tag = el.tag
        if tag == "div" and has(el, "chapter"):
            B.items.append(("chapter", dict(
                num=sc(el.find(".//div[@class='ch-num']")),
                eyebrow=sc(first(el, ".//div[contains(@class,'eyebrow')]")),
                title=sc(el.find(".//h2")),
                sub=sc(el.find(".//p")),
            )))
        elif tag == "section":
            B.items.append(("section", parse_section(el, sc)))
    return B

def parse_section(sec, sc):
    """One <section> -> {head, blocks[]} in document order."""
    wrap = sec.find("div[@class='wrap']")
    root = wrap if wrap is not None else sec
    head = dict(eyebrow="", title="", sub="")
    blocks = []

    # NB: no id()-keyed "seen" set here. lxml builds a fresh Python proxy on each
    # element access, so a garbage-collected proxy's id() gets recycled and would
    # make unrelated elements look already-visited -- which silently dropped whole
    # sections. A plain single-visit tree walk needs no such set.
    def walk(node):
        for el in node:
            k = cls(el)
            if el.tag == "div" and "eyebrow" in k and not head["eyebrow"] and not head["title"]:
                head["eyebrow"] = sc(el); continue
            if el.tag == "h2" and "sec-title" in k and not head["title"]:
                head["title"] = sc(el); continue
            if el.tag == "p" and "sec-sub" in k and not head["sub"]:
                head["sub"] = sc(el); continue
            bs = classify(el, sc)
            if bs:
                blocks.extend(bs)
                continue
            if el.tag in ("div", "section"):
                walk(el)
    walk(root)
    return dict(head=head, blocks=blocks)

def bars_of(el):
    """Bar rows inside `el`, detected STRUCTURALLY (a .fill[data-w] under a .track).

    Class-based detection is not enough: the standard component uses .bar-row, but
    hand-built charts (e.g. the A/B test chart) use inline-styled divs with the same
    .track/.fill[data-w] skeleton. Both carry real numbers, so both must be read."""
    rows = []
    for fill in el.xpath(".//div[contains(@class,'fill')][@data-w]"):
        track = fill.getparent()
        row = track.getparent() if track is not None else None
        if row is None: continue
        spans = row.xpath(".//span")
        lab = norm(spans[0].text_content()) if spans else ""
        val = norm(spans[1].text_content()) if len(spans) > 1 else ""
        try: w = float(fill.get("data-w") or 0)
        except ValueError: w = 0
        fk = cls(fill).split()
        if lab or val:
            rows.append((lab, val, w, "green" in fk, "grey" in fk))
    return rows

def card_body(c, sc):
    paras = [sc(p) for p in c.xpath(".//p")]
    lis = [sc(li) for li in c.xpath(".//li")]
    chips = [sc(i) for i in c.xpath(".//div[contains(@style,'background:var(--paper-2)')]")]
    return "\n".join([p for p in paras if p] + [("- " + l) for l in lis] + [x for x in chips if x])

def classify(el, sc):
    """Map one element onto a LIST of renderable blocks, or None to descend into it."""
    k = cls(el).split()
    if el.tag not in ("div", "table"): return None

    if "stats" in k:
        cells = []
        for s in el.xpath("./div[contains(@class,'stat')]"):
            cells.append((sc(first(s, "div[@class='n']")), sc(first(s, "div[@class='l']"))))
        return [("stats", cells)] if cells else None

    if "agenda" in k:
        rows = []
        for r in el.xpath(".//div[@class='ag-row']"):
            rows.append((sc(first(r, "div[@class='ag-num']")),
                         sc(first(r, ".//div[@class='ag-t']")),
                         sc(first(r, ".//div[@class='ag-d']"))))
        return [("agenda", rows)] if rows else None

    if "tbl-wrap" in k or el.tag == "table":
        t = el if el.tag == "table" else first(el, ".//table")
        if t is None: return None
        heads = [sc(th) for th in t.xpath(".//thead//th")]
        rows = [[sc(td) for td in tr.xpath("./td")] for tr in t.xpath(".//tbody/tr")]
        return [("table", dict(heads=heads, rows=rows))] if rows else None

    if "sc-grid" in k:
        cells = []
        for c in el.xpath("./div[@class='sc-cell']"):
            tgt = first(c, "div[@class='sc-tgt']"); warn = first(c, "div[@class='sc-warn']")
            cells.append(dict(pct=sc(first(c, ".//div[@class='sc-pct']")),
                              label=sc(first(c, "div[@class='sc-label']")),
                              note=sc(first(c, "div[@class='sc-note']")),
                              foot=sc(tgt) if tgt is not None else sc(warn),
                              bad=warn is not None))
        return [("scorecard", cells)] if cells else None

    if "tiers" in k:
        out = []
        for t in el.xpath("./div[contains(@class,'tier')]"):
            tk = cls(t).split()
            out.append(dict(tn=sc(first(t, "div[@class='tn']")), title=sc(first(t, "h4")),
                            sub=sc(first(t, "div[@class='ts']")),
                            items=[sc(li) for li in t.xpath(".//li")],
                            here="here" in tk, done="done" in tk))
        return [("tiers", out)] if out else None

    if "road" in k:
        out = []
        for m in el.xpath("./div[contains(@class,'mo')]"):
            out.append(dict(month=sc(first(m, "div[@class='mo-m']")),
                            state=sc(first(m, ".//div[contains(@class,'mo-s')]")),
                            title=sc(first(m, "h4")),
                            items=[sc(li) for li in m.xpath(".//li")],
                            peak="peak" in cls(m).split()))
        return [("roadmap", out)] if out else None

    if "callout" in k:
        return [("callout", dict(title=sc(first(el, "h4")), body=sc(first(el, "p"))))]

    if "note" in k and "sc-note" not in k and "attr-note" not in k:
        return [("note", sc(el))]

    if "bars" in k:
        rows = bars_of(el)
        return [("bars", rows)] if rows else None

    is_grid = any(g in k for g in ("grid-2", "grid-3", "grid-4", "pipe", "flow"))
    if is_grid or "card" in k:
        cols = 2
        if "grid-3" in k or "pipe" in k: cols = 3
        if "grid-4" in k or "flow" in k: cols = 4
        kids = [c for c in el if c.tag == "div"] if is_grid else [el]
        # A card carrying a bar chart cannot render as a boxed text card without
        # losing its numbers -- decompose it into heading + full-width bars instead.
        if any(bars_of(c) for c in kids):
            out = []
            for c in kids:
                h4 = first(c, ".//h4")
                title = sc(h4) if h4 is not None else ""
                br = bars_of(c)
                if title: out.append(("subhead", title))
                if br: out.append(("bars", br))
                body = card_body(c, sc)
                if body and not br: out.append(("cards", dict(cols=1, cards=[("", body)])))
                elif body and br:
                    tail = [x for x in body.split("\n") if x.strip()]
                    if tail: out.append(("note", " ".join(tail)))
            return out or None
        cards = []
        for c in kids:
            h4 = first(c, ".//h4")
            title = sc(h4) if h4 is not None else ""
            body = card_body(c, sc)
            if not title:
                big = c.xpath("./div[contains(@style,'font-size:44px')]")
                if big:
                    title = sc(big[0])
                    lab = c.xpath("./div[contains(@style,'letter-spacing')]")
                    if lab: body = sc(lab[0])
            if title or body: cards.append((title, body))
        return [("cards", dict(cols=cols, cards=cards))] if cards else None

    # a hand-built chart panel: no component class, but real .track/.fill bars inside
    br = bars_of(el)
    if br:
        out = []
        lead = el.xpath(".//div[contains(@style,'letter-spacing')]")
        if lead:
            t = sc(lead[0])
            if t: out.append(("subhead", t))
        out.append(("bars", br))
        return out
    return None

_STATUS = [
    (r"\b(done|automated|complete|live|approved)\b", GREEN),
    (r"\b(parked|blocked|awaiting|on hold|held)\b", ORANGE_DP),
    (r"\b(in flight|in progress|semi-auto|wip|building)\b", ORANGE_DP),
    (r"^(open|scoped|to do)$", MUTED),
    (r"^high$", GREEN), (r"^medium$", ORANGE_DP), (r"^low$", MUTED),
]
def status_col(t):
    """Colour for a short status-pill cell, or None for ordinary prose."""
    v = (t or "").strip().lower()
    if not v or len(v) > 26: return None      # a sentence, not a pill
    for rx, c in _STATUS:
        if re.search(rx, v): return c
    return None

# ---------------------------------------------------------------- pptx helpers
def add_slide(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])   # blank
    return s

def rect(slide, x, y, w, h, fill=None, line=None, lw=0.75):
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.shadow.inherit = False
    if fill is None:
        sh.fill.background()
    else:
        sh.fill.solid(); sh.fill.fore_color.rgb = fill
    if line is None:
        sh.line.fill.background()
    else:
        sh.line.color.rgb = line; sh.line.width = Pt(lw)
    sh.text_frame.word_wrap = True
    return sh

def textbox(slide, x, y, w, h, text, size=11, color=INK2, bold=False, align=PP_ALIGN.LEFT,
            leading=1.30, caps=False, space_after=0):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    lines = (text or "").split("\n")
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = leading
        if space_after: p.space_after = Pt(space_after)
        r = p.add_run(); r.text = ln.upper() if caps else ln
        r.font.size = Pt(size); r.font.bold = bold; r.font.name = FONT
        r.font.color.rgb = color
    return tb

def footer(slide, page):
    textbox(slide, MARGIN, FOOT_Y, 6.0, 0.24, "FeedSpark · Private & Confidential",
            size=8, color=MUTED, bold=True, caps=True)
    textbox(slide, SLIDE_W - MARGIN - 1.2, FOOT_Y, 1.2, 0.24, str(page),
            size=8, color=MUTED, bold=True, align=PP_ALIGN.RIGHT)

# ---------------------------------------------------------------- renderables
# Each renderable = (height_inches, draw(slide, y)) so the flow engine can
# measure before it commits, and split instead of overflowing.

def r_stats(cells):
    n = max(1, len(cells))
    per_row = 5 if n >= 5 else n
    rows = [cells[i:i + per_row] for i in range(0, n, per_row)]
    cw = (CONTENT_W - (per_row - 1) * 0.10) / per_row
    lab_h = max(text_h(c[1], 8.5, cw - 0.34, bold=True, caps=True, leading=1.22) for c in cells)
    num_h = text_h("0", 25, cw - 0.34, bold=True)
    h_row = 0.16 + num_h + 0.12 + lab_h + 0.20
    def draw(slide, y):
        yy = y
        for row in rows:
            for i, (num, lab) in enumerate(row):
                x = MARGIN + i * (cw + 0.10)
                rect(slide, x, yy, cw, h_row, fill=PAPER, line=LINE)
                textbox(slide, x + 0.17, yy + 0.16, cw - 0.34, num_h, num, size=25, color=INK, bold=True)
                textbox(slide, x + 0.17, yy + 0.16 + num_h + 0.12, cw - 0.34, lab_h, lab,
                        size=8.5, color=MUTED, bold=True, caps=True, leading=1.22)
            yy += h_row + 0.10
        return yy - y
    return (len(rows) * (h_row + 0.10) - 0.10, draw)

def r_cards_row(cards, cols):
    cw = (CONTENT_W - (cols - 1) * 0.22) / cols
    inner = cw - 0.44
    hs = []
    for t, b in cards:
        h = 0.30
        if t: h += text_h(t, 12, inner, bold=True) + 0.10
        if b: h += text_h(b, 10, inner, leading=1.34)
        hs.append(h + 0.30)
    H = max(hs)
    def draw(slide, y):
        for i, (t, b) in enumerate(cards):
            x = MARGIN + i * (cw + 0.22)
            rect(slide, x, y, cw, H, fill=PAPER, line=LINE)
            rect(slide, x, y, 0.035, H, fill=ORANGE, line=None)
            yy = y + 0.22
            if t:
                th = text_h(t, 12, inner, bold=True)
                textbox(slide, x + 0.22, yy, inner, th, t, size=12, color=INK, bold=True, leading=1.24)
                yy += th + 0.10
            if b:
                textbox(slide, x + 0.22, yy, inner, text_h(b, 10, inner, leading=1.34), b,
                        size=10, color=INK2, leading=1.34)
        return H
    return (H, draw)

def r_table_rows(heads, rows, widths):
    """Header + data rows as separate renderables so a long table can split."""
    out = []
    cw = [w * CONTENT_W for w in widths]
    def mk_head():
        h = max(0.34, max((text_h(x, 8.5, c - 0.24, bold=True, caps=True, leading=1.18) for x, c in zip(heads, cw)), default=0.2) + 0.20)
        def draw(slide, y):
            x = MARGIN
            for i, hd in enumerate(heads):
                rect(slide, x, y, cw[i], h, fill=DARK, line=DARK)
                textbox(slide, x + 0.12, y + 0.10, cw[i] - 0.24, h - 0.16, hd,
                        size=8.5, color=WHITE, bold=True, caps=True, leading=1.18)
                x += cw[i]
            return h
        return (h, draw)
    if heads: out.append(mk_head())
    for ri, row in enumerate(rows):
        cells = list(row) + [""] * (len(cw) - len(row))
        h = max(0.30, max((text_h(c, 9.5, w - 0.24, leading=1.26) for c, w in zip(cells, cw)), default=0.2) + 0.22)
        def draw(slide, y, cells=cells, h=h, ri=ri):
            x = MARGIN
            bg = PAPER2 if ri % 2 else PAPER
            for i, c in enumerate(cells):
                rect(slide, x, y, cw[i], h, fill=bg, line=LINE, lw=0.5)
                sc_ = status_col(c)
                textbox(slide, x + 0.12, y + 0.11, cw[i] - 0.24, h - 0.22, c,
                        size=9.5, color=sc_ or INK2, bold=bool(sc_), leading=1.26)
                x += cw[i]
            return h
        out.append((h, draw))
    return out, mk_head if heads else None

def r_bars(rows):
    out = []
    for lab, val, w, green, grey in rows:
        lw = CONTENT_W * 0.62
        lh = max(text_h(lab, 10, lw, bold=True), 0.18)
        h = lh + 0.26
        def draw(slide, y, lab=lab, val=val, w=w, green=green, grey=grey, lh=lh):
            textbox(slide, MARGIN, y, CONTENT_W * 0.62, lh, lab, size=10, color=INK, bold=True)
            textbox(slide, MARGIN + CONTENT_W * 0.63, y, CONTENT_W * 0.37, lh, val,
                    size=10, color=MUTED, align=PP_ALIGN.RIGHT)
            ty = y + lh + 0.06
            rect(slide, MARGIN, ty, CONTENT_W, 0.11, fill=PAPER2, line=LINE, lw=0.5)
            fw = max(0.02, CONTENT_W * (w / 100.0))
            col = GREEN if green else (RGBColor(0xC9, 0xC9, 0xC9) if grey else ORANGE)
            rect(slide, MARGIN, ty, fw, 0.11, fill=col, line=None)
            return lh + 0.26
        out.append((h, draw))
    return out

def r_scorecard_row(cells):
    cols = len(cells)
    cw = (CONTENT_W - (cols - 1) * 0.10) / cols
    inner = cw - 0.36
    hs = []
    for c in cells:
        h = 0.42 + text_h(c["label"], 11, inner, bold=True) + 0.06 + text_h(c["note"], 9, inner, leading=1.30)
        if c["foot"]: h += 0.06 + text_h(c["foot"], 8.5, inner, bold=True, leading=1.26)
        hs.append(h + 0.44)
    H = max(hs)
    def draw(slide, y):
        for i, c in enumerate(cells):
            x = MARGIN + i * (cw + 0.10)
            rect(slide, x, y, cw, H, fill=PAPER, line=LINE)
            yy = y + 0.20
            pc = c["pct"]
            col = GREEN if pc.rstrip("%").isdigit() and int(pc.rstrip("%") or 0) >= 85 else (
                RED if pc.rstrip("%").isdigit() and int(pc.rstrip("%") or 0) <= 25 else ORANGE_DP)
            textbox(slide, x + 0.18, yy, inner, 0.40, pc, size=22, color=col, bold=True)
            yy += 0.46
            lh = text_h(c["label"], 11, inner, bold=True)
            textbox(slide, x + 0.18, yy, inner, lh, c["label"], size=11, color=INK, bold=True)
            yy += lh + 0.06
            nh = text_h(c["note"], 9, inner, leading=1.30)
            textbox(slide, x + 0.18, yy, inner, nh, c["note"], size=9, color=MUTED, leading=1.30)
            yy += nh + 0.06
            if c["foot"]:
                textbox(slide, x + 0.18, yy, inner, text_h(c["foot"], 8.5, inner, bold=True, leading=1.26),
                        c["foot"], size=8.5, color=RED if c["bad"] else GREEN, bold=True, leading=1.26)
        return H
    return (H, draw)

def r_coldcards(items, kind):
    """tiers / roadmap columns -- same visual family, different labels."""
    cols = len(items)
    cw = (CONTENT_W - (cols - 1) * 0.18) / cols
    inner = cw - 0.36
    hs = []
    for it in items:
        h = 0.24
        h += text_h(it.get("tn") or it.get("month", ""), 8.5, inner, bold=True, caps=True) + 0.08
        if kind == "roadmap" and it.get("state"):
            h += text_h(it["state"], 8, inner - 0.12, bold=True, caps=True) + 0.30
        h += text_h(it.get("title", ""), 12, inner, bold=True) + 0.06
        if it.get("sub"): h += text_h(it["sub"], 9, inner) + 0.08
        for li in it.get("items", []):
            h += text_h("• " + li, 9.5, inner - 0.10, leading=1.30) + 0.06
        hs.append(h + 0.28)
    H = max(hs)
    def draw(slide, y):
        for i, it in enumerate(items):
            x = MARGIN + i * (cw + 0.18)
            hi = it.get("here") or it.get("peak")
            rect(slide, x, y, cw, H, fill=PAPER, line=ORANGE if hi else LINE, lw=1.6 if hi else 0.75)
            yy = y + 0.20
            tn = it.get("tn") or it.get("month", "")
            if tn:
                th = text_h(tn, 8.5, inner, bold=True, caps=True)
                textbox(slide, x + 0.18, yy, inner, th, tn, size=8.5, color=ORANGE_DP, bold=True, caps=True)
                yy += th + 0.08
            if kind == "roadmap" and it.get("state"):
                sh = text_h(it["state"], 8, inner - 0.12, bold=True, caps=True)
                rect(slide, x + 0.18, yy - 0.03, inner, sh + 0.12,
                     fill=ORANGE if it.get("peak") else PAPER2, line=None)
                textbox(slide, x + 0.24, yy + 0.02, inner - 0.12, sh, it["state"],
                        size=8, color=WHITE if it.get("peak") else MUTED, bold=True, caps=True)
                yy += sh + 0.20
            ti = it.get("title", "")
            if ti:
                th = text_h(ti, 12, inner, bold=True)
                textbox(slide, x + 0.18, yy, inner, th, ti, size=12, color=INK, bold=True, leading=1.22)
                yy += th + 0.06
            if it.get("sub"):
                sh = text_h(it["sub"], 9, inner)
                textbox(slide, x + 0.18, yy, inner, sh, it["sub"], size=9, color=MUTED)
                yy += sh + 0.08
            for li in it.get("items", []):
                lh = text_h("• " + li, 9.5, inner - 0.10, leading=1.30)
                textbox(slide, x + 0.18, yy, inner - 0.10, lh, "• " + li, size=9.5, color=INK2, leading=1.30)
                yy += lh + 0.06
        return H
    return (H, draw)

def r_callout(c):
    inner = CONTENT_W - 0.60
    h = 0.34 + (text_h(c["title"], 12.5, inner, bold=True) + 0.08 if c["title"] else 0) \
        + text_h(c["body"], 10.5, inner, leading=1.34) + 0.34
    def draw(slide, y):
        rect(slide, MARGIN, y, CONTENT_W, h, fill=ORANGE, line=None)
        yy = y + 0.26
        if c["title"]:
            th = text_h(c["title"], 12.5, inner, bold=True)
            textbox(slide, MARGIN + 0.30, yy, inner, th, c["title"], size=12.5, color=WHITE, bold=True)
            yy += th + 0.08
        textbox(slide, MARGIN + 0.30, yy, inner, text_h(c["body"], 10.5, inner, leading=1.34),
                c["body"], size=10.5, color=WHITE, leading=1.34)
        return h
    return (h, draw)

def r_subhead(t):
    h = text_h(t, 13, CONTENT_W, bold=True) + 0.10
    def draw(slide, y):
        textbox(slide, MARGIN, y, CONTENT_W, h - 0.10, t, size=13, color=INK, bold=True)
        return h
    return (h, draw)

def r_note(t):
    inner = CONTENT_W - 0.54
    h = text_h(t, 10, inner, leading=1.34) + 0.42
    def draw(slide, y):
        rect(slide, MARGIN, y, CONTENT_W, h, fill=PAPER2, line=LINE, lw=0.5)
        rect(slide, MARGIN, y, 0.035, h, fill=ORANGE, line=None)
        textbox(slide, MARGIN + 0.28, y + 0.21, inner, h - 0.42, t, size=10, color=INK2, leading=1.34)
        return h
    return (h, draw)

def r_agenda_row(num, title, desc):
    tw = CONTENT_W - 0.75
    h = max(text_h(title, 11.5, tw, bold=True) + text_h(desc, 9.5, tw) + 0.06, 0.34) + 0.20
    def draw(slide, y):
        textbox(slide, MARGIN, y + 0.02, 0.55, 0.24, num, size=10, color=ORANGE, bold=True)
        th = text_h(title, 11.5, tw, bold=True)
        textbox(slide, MARGIN + 0.62, y, tw, th, title, size=11.5, color=INK, bold=True)
        textbox(slide, MARGIN + 0.62, y + th + 0.04, tw, text_h(desc, 9.5, tw), desc, size=9.5, color=MUTED)
        rect(slide, MARGIN, y + h - 0.06, CONTENT_W, 0.012, fill=LINE, line=None)
        return h
    return (h, draw)

# ---------------------------------------------------------------- flow engine
class Deck:
    def __init__(self, prs):
        self.prs = prs
        self.page = 0
        self.slide = None
        self.y = 0.0
        self.head = None          # (eyebrow, title) reprinted on continuation

    def new_slide(self, head=None, cont=False):
        self.slide = add_slide(self.prs)
        self.page += 1
        footer(self.slide, self.page)
        self.y = BODY_TOP_C
        if head and (head[0] or head[1]):
            eb, ti, sub = head
            y = 0.60
            if eb:
                ebt = eb + (" (cont.)" if cont else "")
                ebh = text_h(ebt, 9.5, CONTENT_W, bold=True, caps=True)
                textbox(self.slide, MARGIN, y, CONTENT_W, ebh, ebt,
                        size=9.5, color=ORANGE_DP, bold=True, caps=True)
                y += ebh + 0.10
            if ti:
                th = text_h(ti, 24, CONTENT_W, bold=True)
                textbox(self.slide, MARGIN, y, CONTENT_W, th, ti, size=24, color=INK, bold=True, leading=1.16)
                y += th + 0.10
            if sub and not cont:
                sh = text_h(sub, 11, CONTENT_W * 0.82, leading=1.34)
                textbox(self.slide, MARGIN, y, CONTENT_W * 0.82, sh, sub, size=11, color=MUTED, leading=1.34)
                y += sh + 0.10
            self.y = y + 0.16
        return self.slide

    def place(self, item, head=None):
        """Place one renderable, starting a fresh slide if it will not fit."""
        h, draw = item
        if self.slide is None:
            self.new_slide(head)
        if self.y + h > BODY_BOT:
            avail = BODY_BOT - BODY_TOP_C
            self.new_slide(head, cont=True)
            if h > avail:
                # single renderable taller than a whole slide: place it and let the
                # QA previewer flag it rather than silently cropping mid-content.
                pass
        used = draw(self.slide, self.y)
        self.y += (used or h) + GAP

def chapter_slide(prs, deck, ch):
    s = add_slide(prs)
    deck.page += 1
    deck.slide = None
    bg = rect(s, 0, 0, SLIDE_W, SLIDE_H, fill=DARK, line=None)
    rect(s, 0, 0, 1.15, 0.10, fill=ORANGE, line=None)
    num = ch["num"] or ""
    if num:
        tb = textbox(s, SLIDE_W - 3.6, 1.35, 3.2, 4.4, num, size=150,
                     color=RGBColor(0x33, 0x2A, 0x1A), bold=True, align=PP_ALIGN.RIGHT)
    rect(s, MARGIN, 2.55, 0.50, 0.035, fill=ORANGE, line=None)
    y = 2.80
    if ch["eyebrow"]:
        textbox(s, MARGIN, y, 6.0, 0.24, ch["eyebrow"], size=10, color=ORANGE, bold=True, caps=True)
        y += 0.34
    th = text_h(ch["title"], 34, 8.6, bold=True)
    textbox(s, MARGIN, y, 8.6, th, ch["title"], size=34, color=WHITE, bold=True, leading=1.14)
    y += th + 0.16
    if ch["sub"]:
        textbox(s, MARGIN, y, 7.6, text_h(ch["sub"], 12, 7.6, leading=1.36), ch["sub"],
                size=12, color=RGBColor(0xB8, 0xB8, 0xB8), leading=1.36)
    textbox(s, MARGIN, FOOT_Y, 6.0, 0.24, "FeedSpark · Private & Confidential",
            size=8, color=RGBColor(0x8A, 0x8A, 0x8A), bold=True, caps=True)
    textbox(s, SLIDE_W - MARGIN - 1.2, FOOT_Y, 1.2, 0.24, str(deck.page),
            size=8, color=RGBColor(0x8A, 0x8A, 0x8A), bold=True, align=PP_ALIGN.RIGHT)

def hero_slide(prs, deck, hero):
    s = add_slide(prs)
    deck.page += 1
    rect(s, 0, 0, SLIDE_W, SLIDE_H, fill=DARK, line=None)
    rect(s, 0, 0, 1.55, 0.12, fill=ORANGE, line=None)
    y = 1.35
    if hero["eyebrow"]:
        textbox(s, MARGIN, y, 9.0, 0.26, hero["eyebrow"], size=10.5, color=ORANGE, bold=True, caps=True)
        y += 0.42
    th = text_h(hero["title"], 52, 9.0, bold=True)
    textbox(s, MARGIN, y, 9.0, th, hero["title"], size=52, color=WHITE, bold=True, leading=1.10)
    y += th + 0.24
    rect(s, MARGIN, y, 0.66, 0.035, fill=ORANGE, line=None)
    y += 0.30
    if hero["lede"]:
        lh = text_h(hero["lede"], 11.5, 8.4, leading=1.42)
        textbox(s, MARGIN, y, 8.4, lh, hero["lede"], size=11.5,
                color=RGBColor(0xC4, 0xC4, 0xC4), leading=1.42)
        y += lh + 0.34
    x = MARGIN
    for lab, val in hero["meta"]:
        textbox(s, x, y, 3.0, 0.20, lab, size=8.5, color=RGBColor(0x9A, 0x9A, 0x9A), bold=True, caps=True)
        textbox(s, x, y + 0.24, 3.0, 0.26, val, size=12, color=WHITE, bold=True)
        x += 3.3
    textbox(s, MARGIN, FOOT_Y, 6.0, 0.24, "FeedSpark · Private & Confidential",
            size=8, color=RGBColor(0x8A, 0x8A, 0x8A), bold=True, caps=True)

def close_slide(prs, deck, close):
    s = add_slide(prs)
    deck.page += 1
    rect(s, 0, 0, SLIDE_W, SLIDE_H, fill=DARK, line=None)
    rect(s, 0, 0, 1.15, 0.10, fill=ORANGE, line=None)
    textbox(s, MARGIN, 2.05, 6.0, 0.26, close["eyebrow"] or "Thank you",
            size=10.5, color=ORANGE, bold=True, caps=True)
    textbox(s, MARGIN, 2.45, 9.0, 0.80, close["title"] or "Questions?",
            size=40, color=WHITE, bold=True)
    rect(s, MARGIN, 3.45, 0.66, 0.035, fill=ORANGE, line=None)
    x = MARGIN
    cw = (CONTENT_W - 2 * 0.30) / max(1, len(close["contacts"]))
    for name, role, mail in close["contacts"]:
        rect(s, x, 3.95, min(cw, 3.4), 0.035, fill=ORANGE, line=None)
        textbox(s, x, 4.12, min(cw, 3.4), 0.28, name, size=13, color=WHITE, bold=True)
        textbox(s, x, 4.42, min(cw, 3.4), 0.24, role, size=9.5, color=RGBColor(0x9A, 0x9A, 0x9A))
        textbox(s, x, 4.70, min(cw, 3.4), 0.24, mail, size=10, color=ORANGE)
        x += cw + 0.30
    textbox(s, MARGIN, FOOT_Y, 6.0, 0.24, "FeedSpark · Private & Confidential",
            size=8, color=RGBColor(0x8A, 0x8A, 0x8A), bold=True, caps=True)

# ---------------------------------------------------------------- table widths
def table_widths(heads, rows):
    n = len(heads) if heads else max(len(r) for r in rows)
    scores = []
    for i in range(n):
        vals = [len(heads[i]) if heads and i < len(heads) else 0]
        vals += [len(r[i]) for r in rows if i < len(r)]
        scores.append(max(6, sum(vals) / max(1, len(vals))))
    tot = sum(scores)
    w = [max(0.07, s / tot) for s in scores]
    tot = sum(w)
    return [x / tot for x in w]

# ---------------------------------------------------------------- main render
def build(blocks, out, title="FeedSpark deck"):
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(SLIDE_W), Inches(SLIDE_H)
    deck = Deck(prs)

    if blocks.hero:
        hero_slide(prs, deck, blocks.hero)

    for kind, payload in blocks.items:
        if kind == "chapter":
            chapter_slide(prs, deck, payload)
            continue
        head = (payload["head"]["eyebrow"], payload["head"]["title"], payload["head"]["sub"])
        deck.slide = None
        first = True
        for bkind, bp in payload["blocks"]:
            h = head if first else head
            if bkind == "stats":
                deck.place(r_stats(bp), h)
            elif bkind == "cards":
                cols, cards = bp["cols"], bp["cards"]
                for i in range(0, len(cards), cols):
                    deck.place(r_cards_row(cards[i:i + cols], min(cols, len(cards) - i)), h)
            elif bkind == "table":
                widths = table_widths(bp["heads"], bp["rows"])
                items, mkhead = r_table_rows(bp["heads"], bp["rows"], widths)
                head_item = items[0] if bp["heads"] else None
                body_items = items[1:] if bp["heads"] else items
                # widow control: never strand a header (or a single row) at the foot
                # of a slide -- start the table on a fresh one instead.
                need = (head_item[0] if head_item else 0) + sum(r[0] for r in body_items[:2])
                if deck.slide is not None and deck.y + need > BODY_BOT:
                    deck.new_slide(h, cont=True)
                if head_item:
                    deck.place(head_item, h)
                for it in body_items:
                    if deck.slide is not None and deck.y + it[0] > BODY_BOT:
                        deck.new_slide(h, cont=True)
                        if mkhead: deck.place(mkhead(), h)
                    deck.place(it, h)
            elif bkind == "bars":
                for it in r_bars(bp):
                    deck.place(it, h)
            elif bkind == "scorecard":
                per = 3
                for i in range(0, len(bp), per):
                    deck.place(r_scorecard_row(bp[i:i + per]), h)
            elif bkind == "tiers":
                deck.place(r_coldcards(bp, "tiers"), h)
            elif bkind == "roadmap":
                grp = bp if len(bp) <= 5 else bp[:5]
                deck.place(r_coldcards(grp, "roadmap"), h)
                if len(bp) > 5:
                    deck.place(r_coldcards(bp[5:], "roadmap"), h)
            elif bkind == "callout":
                deck.place(r_callout(bp), h)
            elif bkind == "note":
                deck.place(r_note(bp), h)
            elif bkind == "subhead":
                deck.place(r_subhead(bp), h)
            elif bkind == "agenda":
                for num, t, d in bp:
                    deck.place(r_agenda_row(num, t, d), h)
            first = False

    if blocks.close:
        close_slide(prs, deck, blocks.close)

    prs.save(out)
    return deck.page

def main():
    ap = argparse.ArgumentParser(description="FeedSpark HTML deck -> themed 16:9 PPTX")
    ap.add_argument("html")
    ap.add_argument("out")
    ap.add_argument("--keep-checks", action="store_true",
                    help="keep the '?' data-check badges (stripped by default: the "
                         "PPTX has no toggle to hide them like the web deck does)")
    a = ap.parse_args()
    blocks = parse_deck(a.html, keep_checks=a.keep_checks)
    n = build(blocks, a.out)
    print(f"{a.html} -> {a.out}")
    print(f"  {len(blocks.items)} top-level blocks -> {n} slides")

if __name__ == "__main__":
    main()
