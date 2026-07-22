#!/usr/bin/env python3
"""Convert the header module nav (tb-modules) from word links to icon links with hover
labels, and add a collapse toggle. Idempotent (guarded by data-lbl). Shared CSS + the
collapse/scroll-restore JS live in apply_theme.py's FCC-THEME block."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")
PAGES = ["FeedSpark_Command_Center.html","FeedSpark_Workflow.html","FeedSpark_Readiness.html",
         "FeedSpark_Leadership.html","FeedSpark_Task_Library.html","FeedSpark_DeckBuilder.html",
         "FeedSpark_Templates.html","FeedSpark_Roadmap.html"]

def I(d):  # 20x20 stroked feather-style icon body
    return ('<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+d+'</svg>')

ICONS = {
 "/":            I('<path d="M3 10.7 12 3l9 7.7"/><path d="M5 9.5V21h14V9.5"/>'),
 "/workflow":    I('<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9 3.5V6h6V3.5M9 11h6M9 15h4"/>'),
 "/readiness":   I('<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4.5-4.5"/><path d="M4 16h.01M20 16h-.01"/>'),
 "/leadership":  I('<rect x="4" y="12" width="3.4" height="8" rx="1"/><rect x="10.3" y="6" width="3.4" height="14" rx="1"/><rect x="16.6" y="9" width="3.4" height="11" rx="1"/>'),
 "/library":     I('<path d="M5 4.5h10a2 2 0 0 1 2 2V21H7a2 2 0 0 1-2-2Z"/><path d="M17 6.5h2v12.8M9 8.5h4M9 12h4"/>'),
 "/deck-builder":I('<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M12 16.5V20M8.5 20h7"/>'),
 "/templates":   I('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
 "/roadmap":     I('<path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20Z"/><path d="M9 4v13.5M15 6.5V20"/>'),
}
LBL = {"/":"Command center","/workflow":"Workflow","/readiness":"Readiness","/leadership":"Leadership",
       "/library":"Task library","/deck-builder":"Deck generator","/templates":"Templates","/roadmap":"Build roadmap"}

CHEV = ('<button class="nav-collapse" id="nav-collapse" type="button" aria-label="Collapse menu" title="Collapse menu">'
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>')

NAV_RE = re.compile(r'<nav class="tb-nav tb-modules"[^>]*>(.*?)</nav>', re.S)
A_RE = re.compile(r'<a\s+href="([^"]+)"([^>]*)>(.*?)</a>', re.S)

def convert(inner):
    out = []
    for href, attrs, _label in A_RE.findall(inner):
        on = ' on' if 'class="on"' in attrs or "class='on'" in attrs else ''
        icon = ICONS.get(href, LBL.get(href, ''))
        lbl = LBL.get(href, href)
        out.append(f'<a href="{href}" class="tbm{on}" data-lbl="{lbl}" title="{lbl}" aria-label="{lbl}">{icon}</a>')
    return CHEV + '<nav class="tb-nav tb-modules" id="tb-modules">' + ''.join(out) + '</nav>'

def apply(path):
    doc = open(path, encoding="utf-8").read()
    if 'data-lbl=' in doc and 'tb-modules' in doc and 'class="tbm' in doc:
        return "skip (already icons)"
    m = NAV_RE.search(doc)
    if not m:
        return "!! nav not found"
    doc = doc[:m.start()] + convert(m.group(1)) + doc[m.end():]
    open(path, "w", encoding="utf-8").write(doc)
    return "iconified"

if __name__ == "__main__":
    for fn in PAGES:
        p = os.path.join(DOCS, fn)
        print(f"  {fn}: {apply(p) if os.path.exists(p) else 'missing'}")
