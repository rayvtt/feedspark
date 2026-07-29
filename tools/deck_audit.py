#!/usr/bin/env python3
"""Content-consistency audit for FeedSpark decks — the check that was missing.

deck_chapters.py verifies STRUCTURE (chapter count, nav, side-nav, agenda, markers all in
sync). That check passed on the Reiss deck at the exact moment the deck was badly broken:
after chapter 7 was deleted, AI Readiness and Planning still quoted 5.8% keyword coverage
against the surviving audit's 5.5%, still cited a 6.3% figure whose only source had just
been deleted, still said "the audit found" about an audit no longer in the deck, and still
pointed at "chapters 14-15" when the rollout had moved to 13-14. Structure was perfect.
Content was wrong. Nobody caught it but the client-facing reader.

This audits the layer structure can't see:

  1. cross-refs      every "chapter N" / "chapters N-M" resolves, and PRINTS the title it
                     resolves to, so a human can see at a glance that the pointer is not
                     just valid but correct
  2. anchors         every href="#cN" resolves to a real chapter
  3. numbers         the same metric quoted with two different values in different chapters
                     (this is what 5.8% vs 5.5% was) — grouped by the vocabulary around it
  4. back-refs       "the audit found", "as shown above", "see chapter N" and friends, so
                     every deferred claim can be checked against something that still exists
  5. orphan figures  a distinctive figure that appears exactly once but is phrased as though
                     it were established elsewhere

Findings are CANDIDATES for a human to adjudicate, not proofs — a metric legitimately
differing by market or period will show up here and should. The point is that it shows up
at all, instead of shipping.

Usage:
    python3 tools/deck_audit.py <deck.html> [--quiet]

Exit code is 1 if anything in the hard-failure classes (unresolved cross-reference, dead
anchor) is found, 0 otherwise. Soft findings (number disagreements, back-refs, orphans)
always print and never fail the run on their own — they need a human read.
"""
import re
import sys
from collections import defaultdict

from bs4 import BeautifulSoup, Comment, NavigableString

# vocabulary buckets — a figure is attributed to every bucket whose words appear near it.
# Deliberately coarse: over-grouping produces a candidate a human dismisses in two seconds,
# under-grouping produces the silent bug this file exists to stop.
METRIC_WORDS = {
    'keyword': ['keyword', 'keywords'],
    'description': ['description', 'descriptions', 'enrichment'],
    'title': ['title', 'titles', 'mask', 'duplicate', 'duplication', 'de-duplication'],
    'highlight': ['highlight', 'highlights'],
    'image': ['image', 'images', 'imagery'],
    'category': ['category', 'categorisation', 'gpc', 'taxonomy'],
    'attribute': ['attribute', 'attributes', 'conversational'],
    'market': ['market', 'markets', 'rollout'],
    'sku': ['sku', 'skus', 'catalogue', 'products'],
    'task': ['task', 'tasks', 'ticket', 'tickets', 'initiative', 'initiatives'],
    'hours': ['hour', 'hours', 'hrs', 'retainer'],
    'feed': ['feed', 'feeds'],
}

BACKREF_PATTERNS = [
    r'the audit found', r'the feed audit', r'as (?:shown|noted|set out) (?:above|below|in)',
    r'(?:detailed|covered|explained) (?:separately )?in', r'\bsee chapter\b',
    r'\bearlier in this deck\b', r'\bas established\b', r'\babove\b(?= in chapter)',
]


def chapter_index(soup):
    """[(num, id, title, text)] in document order, text = the chapter's own content block."""
    divs = soup.find_all('div', class_='chapter', id=re.compile(r'^c\d+$'))
    out = []
    for i, div in enumerate(divs):
        h2 = div.find('h2')
        title = h2.get_text(' ', strip=True) if h2 else '(untitled)'
        parts = [div.get_text(' ', strip=True)]
        sib = div.next_sibling
        stop = divs[i + 1] if i + 1 < len(divs) else None
        while sib is not None and sib is not stop:
            if isinstance(sib, Comment):
                pass
            elif isinstance(sib, NavigableString):
                parts.append(str(sib))
            else:
                parts.append(sib.get_text(' ', strip=True))
            sib = sib.next_sibling
        num = int(re.match(r'^c(\d+)$', div['id']).group(1))
        out.append({'num': num, 'id': div['id'], 'title': title,
                    'text': re.sub(r'\s+', ' ', ' '.join(parts))})
    return out


def check_crossrefs(chapters, full_text):
    """Every 'chapter N' / 'chapters N-M' resolves, printed with the title it points at."""
    by_num = {c['num']: c for c in chapters}
    findings, resolved = [], []
    singular = re.compile(r'\b[Cc]hapters?\s+0?(\d{1,2})\b')
    plural = re.compile(r'\b[Cc]hapters\s+0?(\d{1,2})\s*[–-]\s*0?(\d{1,2})\b')

    seen_spans = []
    for m in plural.finditer(full_text):
        seen_spans.append(m.span())
        lo, hi = int(m.group(1)), int(m.group(2))
        ctx = re.sub(r'\s+', ' ', full_text[max(0, m.start() - 90):m.end() + 40]).strip()
        for n in (lo, hi):
            if n not in by_num:
                findings.append(('DEAD RANGE ENDPOINT', 'chapter %d does not exist' % n, ctx))
        if lo in by_num and hi in by_num:
            if hi <= lo:
                findings.append(('BACKWARDS RANGE', '%d-%d' % (lo, hi), ctx))
            resolved.append(('chapters %d-%d' % (lo, hi),
                             '%s ... %s' % (by_num[lo]['title'], by_num[hi]['title']), ctx))

    for m in singular.finditer(full_text):
        if any(s <= m.start() < e for s, e in seen_spans):
            continue
        n = int(m.group(1))
        ctx = re.sub(r'\s+', ' ', full_text[max(0, m.start() - 90):m.end() + 40]).strip()
        if n not in by_num:
            findings.append(('DEAD CROSS-REFERENCE', 'chapter %d does not exist' % n, ctx))
        else:
            resolved.append(('chapter %d' % n, by_num[n]['title'], ctx))
    return findings, resolved


def check_anchors(soup, chapters):
    ids = {c['id'] for c in chapters}
    dead = []
    for a in soup.find_all('a', href=re.compile(r'^#c\d+$')):
        target = a['href'][1:]
        if target not in ids:
            dead.append(('DEAD ANCHOR', a['href'], a.get_text(' ', strip=True)))
    return dead


def figures(text):
    """Distinctive figures: percentages and thousands-separated integers, with context.

    Signed values (+8.0%, -4.6%) are recorded but marked: they are lifts and deltas, a
    different class from coverage/state percentages, and comparing the two produces pure
    noise (an +5.9% average impression lift is not in conflict with 5.8% keyword coverage).
    """
    out = []
    for m in re.finditer(r'(?<![\w.])([+\-–−]?)(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d)?%)(?![\w])',
                         text):
        lo, hi = max(0, m.start() - 110), m.end() + 110
        out.append({'value': m.group(2), 'signed': bool(m.group(1)),
                    'ctx': text[lo:hi], 'pos': m.start()})
    return out


def buckets_for(ctx):
    low = ctx.lower()
    return {name for name, words in METRIC_WORDS.items()
            if any(re.search(r'\b%s\b' % re.escape(w), low) for w in words)}


def check_numbers(chapters):
    """The 5.8%-vs-5.5% bug class: one metric, two values, two chapters.

    Tuned hard for signal. A pair is only raised when ALL of these hold, because the first
    cut of this check buried the one real conflict under a dozen lift-vs-coverage pairs that
    were never in tension, and a report nobody reads is worth nothing:
      - both values unsigned (lifts and deltas are a different class — see figures())
      - neither is 100% (a completeness statement, not a competing measurement)
      - within 8% of each other RELATIVELY (5.5 vs 5.8 yes; 0.1 vs 0.6 no)
      - they appear in different chapters (the same figure restated locally is fine)
      - their contexts share at least two metric buckets, not one (a single shared word like
        "market" pulls together sentences with nothing to do with each other)
    """
    hits = []  # (value, chapter_num, ctx, buckets)
    for ch in chapters:
        for f in figures(ch['text']):
            if f['signed'] or not f['value'].endswith('%') or f['value'] == '100%':
                continue
            ctx = re.sub(r'\s+', ' ', f['ctx']).strip()
            hits.append((f['value'], ch['num'], ctx, buckets_for(f['ctx'])))

    findings, raised = [], set()
    for i, (va, cha, ctxa, ba) in enumerate(hits):
        for vb, chb, ctxb, bb in hits[i + 1:]:
            if va == vb or cha == chb:
                continue
            da, db = float(va.rstrip('%')), float(vb.rstrip('%'))
            if not da or abs(da - db) / max(da, db) > 0.08:
                continue
            shared = ba & bb
            if len(shared) < 2:
                continue
            key = tuple(sorted([(va, cha), (vb, chb)]))
            if key in raised:
                continue
            raised.add(key)
            findings.append(('NUMBER CONFLICT?', '%s [ch%d] vs %s [ch%d] — both about %s' % (
                va, cha, vb, chb, '/'.join(sorted(shared))),
                '%s\n        %s' % (ctxa, ctxb)))
    return findings


STOPWORDS = set('the a an and or of in on to for with is are was were be been it its this '
                'that these those at by from as not no but if then than so out up now new '
                'more most all any each every one two both same other into over under '
                'chapter chapters see detail detailed separately alongside read'.split())


def significant(text):
    return {w for w in re.findall(r'[a-z]{4,}', text.lower()) if w not in STOPWORDS}


def check_crossref_aim(chapters, xref_ok):
    """Does a cross-reference point at the chapter its own sentence is describing?

    This is the check that would have caught the Reiss bug mechanically. "resourcing in
    chapters 14-15" resolved fine — 14 and 15 both existed — so no structural check could
    fail. But the word "resourcing" is literally in chapter 13's title ("Plan & Resourcing")
    and in neither of the chapters it pointed at. When the referring sentence matches some
    OTHER chapter's title strictly better than the one it names, say so.
    """
    titles = {c['num']: significant(c['title']) for c in chapters}
    out = []
    for ref, _, ctx in xref_ok:
        nums = [int(n) for n in re.findall(r'\d{1,2}', ref)]
        if len(nums) == 2:
            nums = list(range(nums[0], nums[1] + 1))
        words = significant(ctx) - set()
        scores = {n: len(words & t) for n, t in titles.items()}
        named = max((scores.get(n, 0) for n in nums), default=0)
        best = max(scores.values()) if scores else 0
        if best > named and best > 0:
            winners = [n for n, s in scores.items() if s == best and n not in nums]
            if winners:
                out.append(('CROSS-REF AIMED WRONG?',
                            '%s — but the sentence matches ch%s (%s) better' % (
                                ref, '/ch'.join(str(w) for w in winners),
                                '; '.join(next(c['title'] for c in chapters if c['num'] == w)
                                          for w in winners)),
                            ctx))
    return out


def check_backrefs(chapters):
    out = []
    pat = re.compile('|'.join(BACKREF_PATTERNS), re.I)
    for ch in chapters:
        for m in pat.finditer(ch['text']):
            ctx = re.sub(r'\s+', ' ', ch['text'][max(0, m.start() - 80):m.end() + 90]).strip()
            out.append(('DEFERRED CLAIM', 'ch%d: "%s"' % (ch['num'], m.group(0)), ctx))
    return out


def check_orphan_figures(chapters):
    """A distinctive figure quoted once, in a sentence that presents it as established."""
    counts = defaultdict(list)
    for ch in chapters:
        for f in figures(ch['text']):
            counts[f['value']].append((ch['num'], re.sub(r'\s+', ' ', f['ctx']).strip()))
    out = []
    established = re.compile(
        r'the audit|the feed audit|already|as (?:we )?(?:saw|showed)|established|found', re.I)
    for value, hits in counts.items():
        if len(hits) != 1:
            continue
        num, ctx = hits[0]
        if established.search(ctx):
            out.append(('ORPHAN FIGURE?', '%s appears once (ch%d) but reads as established'
                        % (value, num), ctx))
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    quiet = '--quiet' in sys.argv
    soup = BeautifulSoup(open(path, encoding='utf-8').read(), 'html.parser')
    chapters = chapter_index(soup)
    full_text = ' '.join(c['text'] for c in chapters)

    print('%s — %d chapters' % (path, len(chapters)))

    hard = []
    xref_bad, xref_ok = check_crossrefs(chapters, full_text)
    hard += xref_bad
    hard += check_anchors(soup, chapters)

    soft = (check_numbers(chapters) + check_crossref_aim(chapters, xref_ok)
            + check_backrefs(chapters) + check_orphan_figures(chapters))

    def show(title, items):
        if not items:
            return
        print('\n%s' % title)
        for kind, what, ctx in items:
            print('  [%s] %s' % (kind, what))
            for line in ctx.split('\n'):
                print('        ...%s...' % line.strip()[:200])

    show('✗ HARD FAILURES — these are wrong, not debatable:', hard)
    show('· REVIEW THESE — candidates, a human decides:', soft)

    if not quiet:
        print('\n· CROSS-REFERENCES, resolved (check each points where the prose means):')
        for ref, title, ctx in xref_ok:
            print('  %-18s -> %s' % (ref, title))
            print('        ...%s...' % ctx[:190])

    print('\n%s  %d hard, %d to review' % (
        '✗ FAILED' if hard else '✓ no hard failures', len(hard), len(soft)))
    sys.exit(1 if hard else 0)


if __name__ == '__main__':
    main()
