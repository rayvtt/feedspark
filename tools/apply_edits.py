#!/usr/bin/env python3
"""Apply a data-eid-keyed JSON edit patch onto an HTML deck template — surgically.

Only the inner text of each patched element is spliced; every other byte of the template is
left untouched, so git diffs show exactly the copy that changed (unlike a browser "Download
HTML", which re-serialises the whole document and strips the data-eid keys).

Patch format (as produced by the deck's "Export edits" button):
    { "e0": {"html": "new <b>copy</b>", "style": "...", "preview": "..."}, "e3": "plain copy", ... }
Value resolution per element:
    - object with "html"  -> spliced as raw HTML (markup preserved; this is what Export emits)
    - object with "text"  -> HTML-escaped, then spliced (safe plain-text convenience)
    - bare string         -> HTML-escaped, then spliced (plain-text convenience)

Usage:
    python tools/apply_edits.py template.html edits.json out.html
    python tools/apply_edits.py template.html edits.json --in-place
"""
import json, sys, html
from html.parser import HTMLParser


class _EidSpans(HTMLParser):
    """Records the (start, end) byte offsets of each data-eid element's inner content."""
    def __init__(self, src):
        super().__init__(convert_charrefs=False)
        self.src = src
        # offset of the first char of each 1-indexed line
        self._line_off = [0]
        for line in src.splitlines(keepends=True):
            self._line_off.append(self._line_off[-1] + len(line))
        self.stack = []      # (tag, content_start_offset, eid_or_None)
        self.spans = {}      # eid -> (content_start, content_end)

    def _off(self):
        line, col = self.getpos()
        return self._line_off[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start_text = self.get_starttag_text() or ""
        content_start = self._off() + len(start_text)
        eid = dict(attrs).get("data-eid")
        # void elements never have inner content / a close tag
        if tag in ("br", "img", "hr", "input", "meta", "link", "source", "col"):
            return
        self.stack.append((tag, content_start, eid))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                _, content_start, eid = self.stack.pop(i)
                if eid is not None:
                    self.spans[eid] = (content_start, self._off())
                del self.stack[i:]   # discard any unclosed nested tags
                return


def apply_edits(src: str, patch: dict) -> tuple[str, list, list]:
    spans = _EidSpans(src)
    spans.feed(src)
    applied, missed = [], []
    edits = []
    for eid, val in patch.items():
        if isinstance(val, dict):
            if val.get("html") is not None:
                replacement = str(val["html"])                      # raw HTML (Export format)
            elif val.get("text") is not None:
                replacement = html.escape(str(val["text"]), quote=False)
            else:
                continue
        else:
            replacement = html.escape(str(val), quote=False)        # bare string = plain text
        if eid not in spans.spans:
            missed.append(eid)
            continue
        s, e = spans.spans[eid]
        edits.append((s, e, replacement))
        applied.append(eid)
    # splice from the end so earlier offsets stay valid
    for s, e, text in sorted(edits, key=lambda t: t[0], reverse=True):
        src = src[:s] + text + src[e:]
    return src, applied, missed


def main(argv):
    if len(argv) < 3:
        print(__doc__); return 1
    template, patch_path = argv[1], argv[2]
    with open(template, encoding="utf-8") as f:
        src = f.read()
    with open(patch_path, encoding="utf-8") as f:
        patch = json.load(f)
    out, applied, missed = apply_edits(src, patch)
    if "--in-place" in argv:
        dest = template
    else:
        dest = argv[3] if len(argv) > 3 else "out.html"
    with open(dest, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"applied {len(applied)} edit(s) → {dest}")
    if missed:
        print(f"MISSED {len(missed)} (data-eid not found — nothing failed silently): {missed}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
