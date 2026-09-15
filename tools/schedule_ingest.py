#!/usr/bin/env python3
"""Scheduled Work — ingest the content team's "Scheduled Title and Keyword Optimisation" sheet
(Google Sheet 16yYMQ50__qv-9V-mtIebm8Ih0-2huE452bgRz3f70Tw) from an .xlsx export into the
committed snapshot the worker serves until the sheet is shared with the service account
(and as the fallback whenever the live read fails).

    python3 tools/schedule_ingest.py <export.xlsx> [ops/schedule/scheduled_work_YYYY-MM-DD.json]

Why an xlsx and not the Drive text export: the text export flattens every tab into one table
and LOSES the tab names — and for the hidden weekly tabs ("KWs 1906", "Titles 0201") the tab
name is the only place the week's date lives. The xlsx keeps names + hidden flags.

The snapshot keeps the SAME shape the Sheets values API returns ({title, hidden, values[][]})
so the worker parses live and snapshot data through one function (src/schedwork.js
parseWorkbook). Columns the parser never reads (batch names, CDB counts, server, the notes
columns) are blanked — not removed, so header positions stay real — to keep the bundle small.
Dates are written as ISO strings; the parser also accepts Sheets serial numbers (live reads).
"""
import sys, os, json, datetime, re

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

KEEP = re.compile(r'^(clients?|task name|task type|time schedule|time|days left|batch size|dates?|primary am|'
                  r'aspl comment|zoe/xiaoli|xiaoli note|am confirmation|am comment|am status|final status|reason)', re.I)


def cell(v):
    if v is None:
        return ''
    if isinstance(v, datetime.datetime):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, datetime.date):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (int, float)):
        return v
    s = str(v).replace('\r', ' ').strip()
    return s


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    today = datetime.date.today().strftime('%Y-%m-%d')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join('ops', 'schedule', 'scheduled_work_%s.json' % today)
    wb = openpyxl.load_workbook(src, data_only=True)
    tabs = []
    total = 0
    for ws in wb.worksheets:
        rows = [[cell(v) for v in r] for r in ws.iter_rows(values_only=True)]
        rows = [r for r in rows if any(v not in ('', None) for v in r)]
        if not rows:
            continue
        # header row = first row carrying Client(s)
        hi = next((i for i, r in enumerate(rows[:8]) if any(str(v).strip().lower() in ('client', 'clients') for v in r)), None)
        if hi is None:
            continue
        hdr = [str(v).strip() for v in rows[hi]]
        keep = [bool(KEEP.match(h)) for h in hdr]
        # the consolidated tab's column I header is a URL — keep the header text short
        hdr = [h if len(h) < 60 else h[:20] + '…' for h in hdr]
        values = rows[:hi] + [hdr]
        for r in rows[hi + 1:]:
            rr = [(v if (i < len(keep) and keep[i]) else '') for i, v in enumerate(r)]
            while rr and rr[-1] in ('', None):
                rr.pop()
            if any(v not in ('', None) for v in rr):
                values.append(rr)
        tabs.append({'title': ws.title, 'hidden': ws.sheet_state != 'visible', 'values': values})
        total += len(values) - hi - 1
    snap = {
        'sheet': '16yYMQ50__qv-9V-mtIebm8Ih0-2huE452bgRz3f70Tw',
        'title': 'Scheduled Title and Keyword Optimisation',
        'at': today,
        'source': os.path.basename(src),
        'tabs': tabs,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(snap, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote %s — %d tabs (%d hidden), %d rows, %d bytes' % (
        out, len(tabs), sum(1 for t in tabs if t['hidden']), total, os.path.getsize(out)))


if __name__ == '__main__':
    main()
