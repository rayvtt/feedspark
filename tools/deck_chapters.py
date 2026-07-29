#!/usr/bin/env python3
"""Structural chapter editor for FeedSpark decks — delete / move-up / move-down / list.

Formalises the manual renumbering procedure in SKILL.md Step 7 (which was done by hand,
repeatedly, and got wrong more than once on the Reiss deck today — a double-shift bug, a
missed capitalised cross-reference, a stale agenda preview) into a single reliable script.
DOM-based (BeautifulSoup), not regex-on-raw-HTML — every renumbered surface (chapter div,
topbar nav, side-nav incl. its group dividers, agenda preview, prose cross-references) is
derived from the same one list of surviving chapters, so they cannot drift out of sync with
each other the way hand-editing them one at a time did.

Usage:
    python3 tools/deck_chapters.py <deck.html> list
    python3 tools/deck_chapters.py <deck.html> delete <chapter_id>          [--write]
    python3 tools/deck_chapters.py <deck.html> move <chapter_id> up|down    [--write]

Without --write, prints a dry-run plan (old -> new chapter numbers, any prose
cross-references it can't safely resolve) and does not touch the file. This is deliberate —
a structural change to a live deck should be reviewed before it ships, the same as every
other deck change this session went through PR review for.
"""
import re
import sys
from bs4 import BeautifulSoup, NavigableString

ORDINALS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
            'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
            'seventeen', 'eighteen', 'nineteen', 'twenty']


def ordinal_word(n):
    if n < len(ORDINALS):
        return ORDINALS[n]
    raise ValueError('need more ordinal words for chapter %d' % n)


def find_chapters(soup):
    """Chapter dividers in document order, each paired with its content block (every
    sibling up to, not including, the next chapter divider)."""
    divs = soup.find_all('div', class_='chapter', id=re.compile(r'^c\d+$'))
    chapters = []
    for i, div in enumerate(divs):
        content = []
        sib = div.next_sibling
        stop_id = divs[i + 1] if i + 1 < len(divs) else None
        while sib is not None and sib is not stop_id:
            nxt = sib.next_sibling
            content.append(sib)
            sib = nxt
        chapters.append({'id': div.get('id'), 'div': div, 'content': content})
    return chapters


def chapter_num(cid):
    return int(cid[1:])


def ch_title_text(div):
    h2 = div.find('h2')
    return h2.get_text(strip=True) if h2 else ''


def rebuild(soup, chapters, deleted_id=None, moved=None):
    """chapters: the FINAL, already-reordered list of surviving chapter dicts (in the
    order they should appear). Renumbers everything derived from that order and returns
    a report dict for the dry-run summary."""
    old_to_new = {}
    for new_i, ch in enumerate(chapters, start=1):
        old_to_new[chapter_num(ch['id'])] = new_i
    if deleted_id:
        old_to_new[chapter_num(deleted_id)] = None  # explicitly gone — flag any reference

    # 1. chapter divs themselves: id, .ch-num, .eyebrow text
    for new_i, ch in enumerate(chapters, start=1):
        div = ch['div']
        old_id = div.get('id')
        div['id'] = 'c%d' % new_i
        chnum = div.find('div', class_='ch-num')
        if chnum:
            chnum.string = '%02d' % new_i
        eyebrow = div.find('div', class_='eyebrow')
        if eyebrow:
            eyebrow.string = 'Chapter ' + ordinal_word(new_i)
        ch['old_id'] = old_id
        ch['new_id'] = 'c%d' % new_i

    # 2. topbar nav (.tb-nav a) — rebuild in the new order, keep each surviving chapter's
    #    own label text (e.g. "Scope"), only the leading number + href change
    tb = soup.find('nav', class_='tb-nav')
    if tb:
        old_links = {a['href'].lstrip('#'): a for a in tb.find_all('a', href=True)}
        new_links = []
        for ch in chapters:
            a = old_links.get(ch['old_id'])
            if a is None:
                continue
            label = re.sub(r'^\d+\s*', '', a.get_text(strip=True))
            a['href'] = '#' + ch['new_id']
            a.string = '%02d %s' % (chapter_num(ch['new_id']), label)
            new_links.append(a.extract())
        tb.clear()
        for a in new_links:
            tb.append(a)
            tb.append('\n')

    # 3. side-nav (.side-nav a + .side-grp dividers) — a divider is "attached" to whichever
    #    chapter it immediately preceded; carry that attachment through the reorder instead
    #    of a raw position, so a group boundary (e.g. "Market Rollout") stays correct even
    #    when a chapter before it is deleted and everything shifts up.
    sn = soup.find('nav', class_='side-nav')
    if sn:
        divider_before = {}  # old_chapter_id -> divider tag
        pending_divider = None
        for child in sn.children:
            if getattr(child, 'name', None) == 'div' and 'side-grp' in (child.get('class') or []):
                pending_divider = child
            elif getattr(child, 'name', None) == 'a' and child.get('href', '').startswith('#c'):
                if pending_divider is not None:
                    divider_before[child['href'].lstrip('#')] = pending_divider
                    pending_divider = None
        old_links = {a['href'].lstrip('#'): a for a in sn.find_all('a', href=True)}
        new_children = []
        for ch in chapters:
            a = old_links.get(ch['old_id'])
            if a is None:
                continue
            if ch['old_id'] in divider_before:
                new_children.append(divider_before[ch['old_id']].extract())
            num_span = a.find('span', class_='num')
            if num_span:
                num_span.string = '%02d' % chapter_num(ch['new_id'])
            a['href'] = '#' + ch['new_id']
            new_children.append(a.extract())
        sn.clear()
        for c in new_children:
            sn.append(c)
            sn.append('\n')

    # 4. agenda preview grid (.ag-row .ag-num) — same principle, keep title/desc text
    for row in soup.find_all('div', class_='ag-row'):
        pass  # handled via full rebuild below, since ag-rows can be reordered by column
    agenda = soup.find('div', class_='agenda')
    if agenda:
        old_rows = {}
        for row in agenda.find_all('div', class_='ag-row'):
            link_num = row.find('div', class_='ag-num')
            # ag-rows don't carry an href; match by original position in the chapters list
            old_rows[len(old_rows) + 1] = row
        used_positions = set()
        new_rows = []
        for new_i, ch in enumerate(chapters, start=1):
            old_n = chapter_num(ch['old_id'])
            row = old_rows.get(old_n)
            if row is None:
                continue
            used_positions.add(old_n)
            numdiv = row.find('div', class_='ag-num')
            if numdiv:
                numdiv.string = '%02d' % new_i
            new_rows.append(row.extract())
        # a row whose chapter was deleted (not just reordered) is never claimed above —
        # it would otherwise sit orphaned at its original DOM position while every other
        # row gets extracted and re-appended around it (a real bug caught in testing:
        # the orphaned row ended up first, duplicated, with a stale number)
        for pos, row in old_rows.items():
            if pos not in used_positions:
                row.decompose()
        # preserve the grid's two-column interleaving by just appending in new order;
        # the CSS grid re-flows automatically, no column-index bookkeeping needed
        for r in new_rows:
            agenda.append(r)
            agenda.append('\n')

    # 5. `<!-- ===== CH NN — TITLE ===== -->` boundary comments — cosmetic (don't affect
    #    rendering) but a real source of confusion if left stale: caught on the Reiss deck
    #    right after a chapter-7 deletion, where the marker still read "CH 07 — LIVE
    #    FEEDHERO AUDIT" sitting directly above what had become the new chapter 7 (a
    #    completely different chapter). BeautifulSoup's default find_all doesn't return
    #    Comment nodes from a plain string/tag search, so this needs its own walk.
    from bs4 import Comment
    marker_re = re.compile(r'^(\s*=+\s*CH\s+)(\d+)(\s*—.*=+\s*)$')
    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        m = marker_re.match(str(c))
        if not m:
            continue
        old_n = int(m.group(2))
        new_n = old_to_new.get(old_n)
        if new_n is None:
            # marks the deleted chapter itself. It's a PRECEDING sibling of that chapter's
            # own div, so it's outside `content` (which only walks forward) and main()'s
            # delete branch never reaches it — decompose it here instead of leaving a stale,
            # orphaned comment behind (inert, but exactly the kind of thing this tool exists
            # to stop from accumulating).
            c.extract()
            continue
        # rebuild the whole marker from the chapter's ACTUAL current title, not just the
        # number — a title can also be stale after a move, and only trusting the number
        # would silently perpetuate that
        ch = next((c2 for c2 in chapters if chapter_num(c2['new_id']) == new_n), None)
        title = ch_title_text(ch['div']).upper() if ch else m.group(0)
        # Comment is itself a NavigableString subclass — replace_with(plain_str) here would
        # silently drop the <!-- --> wrapper and turn the marker into VISIBLE PAGE TEXT (a
        # real bug caught in testing: "CH 01 — SERVICE SCOPE..." rendered as literal body
        # text). Must construct a new Comment, not a str, to replace a Comment with.
        c.replace_with(Comment(' ================= CH %02d — %s ================= ' % (new_n, title)))

    # 6. prose cross-references — "chapter N" / "Chapter N" anywhere in remaining text,
    #    remapped via old_to_new. Anything referencing the deleted chapter's own number is
    #    left untouched and reported, not guessed at.
    pattern = re.compile(r'\b([Cc])hapter\s+0?(\d{1,2})\b')
    unresolved = []
    for text_node in soup.find_all(string=pattern):
        if isinstance(text_node, NavigableString):
            def repl(m):
                cap, num = m.group(1), int(m.group(2))
                new_num = old_to_new.get(num)
                if new_num is None:
                    unresolved.append((num, str(text_node)[:80]))
                    return m.group(0)
                return '%shapter %d' % (cap, new_num)
            new_text = pattern.sub(repl, str(text_node))
            if new_text != str(text_node):
                text_node.replace_with(new_text)

    return {'old_to_new': old_to_new, 'unresolved': unresolved}


def verify(soup, expected_count):
    chs = soup.find_all('div', class_='chapter', id=re.compile(r'^c\d+$'))
    ids = [c['id'] for c in chs]
    expected_ids = ['c%d' % i for i in range(1, expected_count + 1)]
    problems = []
    if ids != expected_ids:
        problems.append('chapter id sequence is %s, expected %s' % (ids, expected_ids))
    tb = soup.find('nav', class_='tb-nav')
    tb_hrefs = [a['href'] for a in tb.find_all('a', href=True)] if tb else []
    if tb_hrefs != ['#' + i for i in expected_ids]:
        problems.append('topbar nav hrefs are %s' % tb_hrefs)
    sn = soup.find('nav', class_='side-nav')
    sn_hrefs = [a['href'] for a in sn.find_all('a', href=True)] if sn else []
    if sn_hrefs != ['#' + i for i in expected_ids]:
        problems.append('side-nav hrefs are %s' % sn_hrefs)
    agenda = soup.find('div', class_='agenda')
    ag_nums = [d.get_text(strip=True) for d in agenda.find_all('div', class_='ag-num')] if agenda else []
    if ag_nums != ['%02d' % i for i in range(1, expected_count + 1)]:
        problems.append('agenda ag-num sequence is %s' % ag_nums)
    return problems


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    path, op = sys.argv[1], sys.argv[2]
    write = '--write' in sys.argv
    html = open(path, encoding='utf-8').read()
    soup = BeautifulSoup(html, 'html.parser')
    chapters = find_chapters(soup)

    if op == 'list':
        for ch in chapters:
            print(ch['id'], '-', ch_title_text(ch['div']))
        return

    if op == 'delete':
        target = sys.argv[3]
        idx = next((i for i, c in enumerate(chapters) if c['id'] == target), None)
        if idx is None:
            print('no chapter with id', target); sys.exit(1)
        removed = chapters[idx]
        print('Deleting %s (%s)' % (removed['id'], ch_title_text(removed['div'])))
        remaining = chapters[:idx] + chapters[idx + 1:]
        report = rebuild(soup, remaining, deleted_id=target)
        # actually remove the deleted chapter's nodes from the tree now that everything
        # else has been re-derived from `remaining` (which never included it)
        removed['div'].decompose()
        for node in removed['content']:
            if hasattr(node, 'decompose'):
                node.decompose()
            elif isinstance(node, NavigableString):
                node.extract()
        expected_count = len(remaining)

    elif op == 'move':
        target, direction = sys.argv[3], sys.argv[4]
        idx = next((i for i, c in enumerate(chapters) if c['id'] == target), None)
        if idx is None:
            print('no chapter with id', target); sys.exit(1)
        swap_with = idx - 1 if direction == 'up' else idx + 1
        if swap_with < 0 or swap_with >= len(chapters):
            print('cannot move %s %s — already at the edge' % (target, direction)); sys.exit(1)
        reordered = chapters[:]
        reordered[idx], reordered[swap_with] = reordered[swap_with], reordered[idx]
        print('Swapping %s <-> %s' % (chapters[idx]['id'], chapters[swap_with]['id']))
        # physically move the DOM nodes: reinsert in the new order right before the first
        # chapter's original div position, then rebuild renumbers everything
        anchor = chapters[min(idx, swap_with)]['div']
        all_nodes = []
        for ch in reordered:
            all_nodes.append(ch['div'])
            all_nodes.extend(ch['content'])
        insert_point = anchor
        for n in all_nodes:
            n.extract()
        for n in all_nodes:
            insert_point.insert_before(n) if insert_point else None
        report = rebuild(soup, reordered)
        expected_count = len(reordered)

    else:
        print(__doc__); sys.exit(1)

    print('Renumbering: %s' % report['old_to_new'])
    if report['unresolved']:
        print('\n⚠ UNRESOLVED cross-references (mention the deleted chapter by its old number — fix by hand):')
        for num, ctx in report['unresolved']:
            print('  chapter %d: ...%s...' % (num, ctx))

    problems = verify(soup, expected_count)
    if problems:
        print('\n✗ VERIFICATION FAILED:')
        for p in problems:
            print(' -', p)
        sys.exit(1)
    print('\n✓ verified: %d chapters, nav/side-nav/agenda all in sync' % expected_count)

    if write:
        open(path, 'w', encoding='utf-8').write(str(soup))
        print('written to', path)
    else:
        print('\n(dry run — pass --write to save)')


if __name__ == '__main__':
    main()
