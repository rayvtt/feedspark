#!/usr/bin/env python3
"""Sync the ATRT Tracker into the FeedSpark Command Center.

Parses the ATRT Tracker export (Google Sheet -> markdown/pipe text), builds a compact data
record (docs/atrt_data.json) and splices three sections into docs/FeedSpark_Command_Center.html
between HTML markers:
    <!-- ATRT:LOG:START -->   ... live workload table ...   <!-- ATRT:LOG:END -->
    <!-- ATRT:TESTS:START --> ... tests running ...         <!-- ATRT:TESTS:END -->
    <!-- ATRT:PLANS:START --> ... accounts & plans ...       <!-- ATRT:PLANS:END -->

Re-sync: re-pull the sheet (Google Drive read_file_content), save as the source .txt, then
    python tools/sync_atrt.py <source.txt>
Only the marked regions change, so the rest of the hand-built page is untouched.

Usage: python tools/sync_atrt.py [source.txt]  (default: the committed docs/atrt_data.json render)
"""
import json, re, sys, html, os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FCC = os.path.join(ROOT, "docs", "FeedSpark_Command_Center.html")
DATA = os.path.join(ROOT, "docs", "atrt_data.json")
TRACKER_URL = "https://docs.google.com/spreadsheets/d/1p_cPSRjmK16CDpLryoOBaOUjG3ZvnL-k4ORHhaHI5AE/edit"

NAMES = {
    "ALLSAINTS": "AllSaints", "ALL SAINTS": "AllSaints", "REISS": "Reiss", "SCHUH": "Schuh",
    "SUPERDRY": "Superdry", "SUPERDRY&": "Superdry", "ACC": "Accessorize", "ACCESSORIZE": "Accessorize",
    "MON": "Monsoon", "MONSOON": "Monsoon", "HOBBYCRAFT": "Hobbycraft", "YUMOVE": "YuMOVE",
    "BOBBI BROWN": "Bobbi Brown", "REGATTA": "Regatta", "CRAGHOPPER": "Craghoppers",
    "CRAGHOPPERS": "Craghoppers", "CLINIQUE": "Clinique", "AMERICAN GOL": "American Golf",
    "AMERICAN GOLF": "American Golf", "HOB": "House of Bruar", "HOUSE OF BRUAR": "House of Bruar",
    "ESTEE": "Estée Lauder", "ESTEE LAUDER": "Estée Lauder", "ELC": "Estée Lauder",
    "ELC GROUP": "Estée Lauder", "DARE2B": "Dare2b", "JO MALONE": "Jo Malone", "JOMALONE": "Jo Malone",
    "BENEFIT": "Benefit", "BENEFIT COSMETIC": "Benefit", "MAC": "MAC", "MAC COSMETICS": "MAC",
    "AVEDA & BUMBLE": "Aveda & Bumble", "DAMSON": "Damson", "INTERNAL": "Internal",
}
ACTIVE = {"open", "with client", "in progress", "test running", "on hold"}
STATUS_CLASS = {"open": "open", "with client": "client", "in progress": "progress",
                "test running": "test", "on hold": "hold", "done": "done"}
STATUS_VOCAB = ["test running", "with client", "in progress", "on hold", "done", "open", "hide"]

def clean(c):
    return (c or "").replace("\\*", "*").replace("\\[", "[").replace("\\]", "]").replace("\\#", "#").replace("\\>", ">").replace("\\-", "-").strip()

def norm_client(c):
    u = re.sub(r"\s+", " ", (c or "").strip().upper()).strip()
    return NAMES.get(u, (c or "").strip().title() or "—")

def parse_due(s):
    s = (s or "").strip()
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if not m: return (9999, 99, 99, "")
    a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if a > 12:   d, mo = a, b           # d/m/y
    elif b > 12: mo, d = a, b           # m/d/y
    else:        mo, d = a, b           # ambiguous -> assume m/d/y
    disp = f"{d:02d} {['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mo] if 1<=mo<=12 else '?'} {y}"
    return (y, mo, d, disp)

def find_status(cells):
    for c in cells:
        cl = c.strip().lower()
        for v in STATUS_VOCAB:
            if cl == v: return v
    return ""

def find_action(cells):
    joined = " ".join(cells).lower()
    if "monthly call" in joined: return "monthly call"
    if "import" in joined: return "import"
    if "[atrt]" in joined or "atrt]" in joined: return "email"
    return ""

def test_type(task):
    t = task.lower()
    if "overlay" in t: return "Overlay / badge"
    if "title" in t or "mask" in t or "aot" in t: return "Title / MASK A/B"
    if "lia" in t or "click & collect" in t or "click and collect" in t: return "LIA / C&C"
    if "intent" in t or ("ai" in t and "title" in t): return "Search-intent / AI"
    if "keyword" in t or re.search(r"\bkw\b", t): return "Keyword"
    if "a/b" in t or re.search(r"\bab\b", t) or "test" in t: return "A/B (other)"
    return "Other"

def is_test(task):
    return bool(re.search(r"test|a/b|\bab\b|overlay|title|mask|keyword|\bkw\b|\blia\b|intent|click & collect", task, re.I))

def parse(src_path):
    rows = []
    for ln in open(src_path, encoding="utf-8"):
        if not ln.startswith("|"): continue
        rows.append([clean(c) for c in ln.strip().strip("|").split("|")])
    date_re = re.compile(r"^\d{1,2}[/.]\d{1,2}[/.]\d{4}")
    tasks, plans = [], []
    for r in rows:
        if not r: continue
        if date_re.match(r[0]) and len(r) > 3:              # tab 1 task row
            status = (r[11].strip().lower() if len(r) > 11 and r[11].strip().lower() in STATUS_VOCAB else find_status(r))
            y, mo, d, disp = parse_due(r[6] if len(r) > 6 else "")
            tasks.append({
                "client": norm_client(r[1]), "task": r[3], "am": r[4] if len(r) > 4 else "",
                "ae": r[5] if len(r) > 5 else "", "due": disp, "duekey": [y, mo, d],
                "status": status, "action": find_action(r), "is_test": is_test(r[3]),
            })
        elif any("Project Plan" in c or "Onboarding" in c for c in r) and r[0] and not date_re.match(r[0]):
            plan = next((c for c in r if "Project Plan" in c or "Onboarding" in c), "")
            plans.append({"client": r[0].strip(), "category": r[1].strip() if len(r) > 1 else "", "plan": plan})
    return tasks, plans

def esc(s): return html.escape(str(s), quote=True)

def render_log(tasks):
    active = [t for t in tasks if t["status"] in ACTIVE]
    active.sort(key=lambda t: (t["duekey"], t["client"]))
    rows = "".join(
        f'<tr><td><b>{esc(t["client"])}</b></td><td>{esc(t["task"][:96])}</td>'
        f'<td>{esc(t["ae"] or "—")}</td><td>{esc(t["due"] or "—")}</td>'
        f'<td><span class="tag tag-{STATUS_CLASS.get(t["status"],"hold")}">{esc(t["status"])}</span></td></tr>'
        for t in active)
    return (
        '<div class="panel">'
        '<h3>Live workload</h3>'
        f'<div class="sub">{len(active)} active tasks across the book · full history &amp; every logged interaction in the tracker</div>'
        '<div style="overflow-x:auto"><table class="logtable">'
        '<thead><tr><th>Account</th><th>Task</th><th>AE</th><th>Due</th><th>Status</th></tr></thead>'
        f'<tbody>{rows}</tbody></table></div>'
        f'<p class="note">Sourced from the <a href="{TRACKER_URL}" target="_blank" rel="noopener">ATRT Tracker</a> — '
        'tasks arriving by email (ad-hoc) or monthly call, per client, AM, AE and due date. Done items are archived in the tracker.</p>'
        '</div>')

def render_tests(tasks):
    tests = [t for t in tasks if t["is_test"]]
    by_type = Counter(test_type(t["task"]) for t in tests)
    chips = "".join(f'<span class="chip"><b>{v}</b> {esc(k)}</span>' for k, v in by_type.most_common())
    act = [t for t in tests if t["status"] in ACTIVE]
    act.sort(key=lambda t: (t["duekey"], t["client"]))
    rows = "".join(
        f'<tr><td><b>{esc(t["client"])}</b></td><td>{esc(t["task"][:92])}</td>'
        f'<td>{esc(test_type(t["task"]))}</td><td>{esc(t["due"] or "—")}</td>'
        f'<td><span class="tag tag-{STATUS_CLASS.get(t["status"],"hold")}">{esc(t["status"])}</span></td></tr>'
        for t in act)
    return (
        '<div class="panel">'
        f'<h3>Test book</h3><div class="sub">{len(tests)} tests logged all-time · by type</div>'
        f'<div class="chips" style="margin-bottom:18px">{chips}</div>'
        f'<h3 style="margin-top:8px">Active &amp; running tests</h3><div class="sub">{len(act)} live right now</div>'
        '<div style="overflow-x:auto"><table class="logtable">'
        '<thead><tr><th>Account</th><th>Test</th><th>Type</th><th>Due</th><th>Status</th></tr></thead>'
        f'<tbody>{rows}</tbody></table></div></div>')

def render_plans(plans):
    rows = "".join(
        f'<div class="planrow"><span class="nm">{esc(p["client"])}'
        f'<span style="color:var(--muted);font-weight:700"> · {esc(p["category"])}</span></span>'
        f'<span class="tag">{esc(p["plan"])}</span></div>'
        for p in plans)
    return (
        '<div class="panel">'
        f'<h3>All accounts &amp; project plans</h3><div class="sub">{len(plans)} accounts · plan links live on tab 2 of the tracker</div>'
        f'<div class="planlist">{rows}</div>'
        f'<p class="note" style="margin-top:14px"><a href="{TRACKER_URL}#gid=100171143" target="_blank" rel="noopener">Open the ATRT Tracker</a> — '
        'tab 1 = task log, tab 2 = accounts &amp; project-plan links.</p></div>')

def splice(text, name, frag):
    a, b = f"<!-- ATRT:{name}:START -->", f"<!-- ATRT:{name}:END -->"
    i, j = text.find(a), text.find(b)
    if i < 0 or j < 0:
        print(f"  WARN: markers {name} not found — skipped"); return text
    return text[:i + len(a)] + "\n" + frag + "\n" + text[j:]

def main(argv):
    src = argv[1] if len(argv) > 1 else None
    if src:
        tasks, plans = parse(src)
        json.dump({"tasks": tasks, "plans": plans}, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"parsed {len(tasks)} tasks, {len(plans)} plans -> {os.path.relpath(DATA, ROOT)}")
    else:
        d = json.load(open(DATA, encoding="utf-8")); tasks, plans = d["tasks"], d["plans"]
        print(f"loaded {len(tasks)} tasks, {len(plans)} plans from {os.path.relpath(DATA, ROOT)}")
    doc = open(FCC, encoding="utf-8").read()
    doc = splice(doc, "LOG", render_log(tasks))
    doc = splice(doc, "TESTS", render_tests(tasks))
    doc = splice(doc, "PLANS", render_plans(plans))
    open(FCC, "w", encoding="utf-8").write(doc)
    active = sum(1 for t in tasks if t["status"] in ACTIVE)
    tests = sum(1 for t in tasks if t["is_test"])
    print(f"spliced FCC: {active} active tasks, {tests} tests, {len(plans)} plans")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
