#!/usr/bin/env python3
"""Sync the ATRT Tracker into the FeedSpark Command Center.

Parses the ATRT Tracker export (Google Sheet -> markdown/pipe text), builds a compact data
record (docs/atrt_data.json) and splices sections into docs/FeedSpark_Command_Center.html
between HTML markers (KPI, LOG, TESTS, PLANS, GLOBAL). Only marked regions change.

Re-sync: re-pull the sheet (Google Drive read_file_content), save as a source .txt, then
    python tools/sync_atrt.py <source.txt>
Without an arg it re-renders from the committed docs/atrt_data.json.
"""
import json, re, sys, html, os, datetime
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FCC = os.path.join(ROOT, "docs", "FeedSpark_Command_Center.html")
DATA = os.path.join(ROOT, "docs", "atrt_data.json")
TRACKER = "https://docs.google.com/spreadsheets/d/1p_cPSRjmK16CDpLryoOBaOUjG3ZvnL-k4ORHhaHI5AE/edit"
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

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

# brand -> category (for benchmarks)
CATEGORY = {
    "AllSaints": "Fashion", "Reiss": "Fashion", "Superdry": "Fashion", "Monsoon": "Fashion",
    "Accessorize": "Fashion", "Schuh": "Footwear", "YuMOVE": "Health & supplements",
    "Hobbycraft": "Hobby & crafts", "Estée Lauder": "Beauty", "Bobbi Brown": "Beauty",
    "Benefit": "Beauty", "Jo Malone": "Beauty", "MAC": "Beauty", "Clinique": "Beauty",
    "Craghoppers": "Outdoor", "Regatta": "Outdoor", "Dare2b": "Outdoor",
    "House of Bruar": "Country & luxury", "American Golf": "Golf retail",
}
# FeedSpark feed-optimisation criteria: (dimension, weight, task-match regex, next-step suggestion)
DIMS = [
    ("Data & Golden Record", 20, r"migrat|feed|data ?field|scrape|custom label|golden|cleaning|master ?feed|supp feed|exclusion|node", "Run a Golden Record audit and close attribute gaps against the 99.9% target"),
    ("Titles & MASK", 18, r"title|mask|\baot\b", "Restructure titles to MASK format and A/B test them"),
    ("Conversational attributes", 16, r"q&a|question|variant|related|item.?group|attribute|conversational|popularity|document", "Build conversational attributes (Q&A, variant_option, related_product) via a supplemental feed"),
    ("Testing cadence", 15, r"test|a/b|\bab\b|split|experiment|roadmap", "Stand up a recurring A/B testing cadence on titles and overlays"),
    ("Creative & overlays", 12, r"overlay|roundel|\bdpa\b|image|cycler|badge|creative|social", "Add DPA / overlay creative — badges, roundels, image cycling"),
    ("Keywords & localisation", 11, r"keyword|\bkw\b|localis|local language|\bmarket|translation|\blia\b|\bppc\b", "Expand keyword coverage and localise data fields across markets"),
    ("AI-readiness", 8, r"ai |search intent|intent|ai mode|chatgpt|agentic|perplexity|reddit", "Prepare AI-Ready feeds: search-intent titles and AI-surface tracking"),
]

def compute_scores(tasks):
    from collections import defaultdict, Counter
    per = defaultdict(lambda: [0] * len(DIMS))
    for t in tasks:
        txt = t["task"].lower()
        for i, (nm, w, rx, ns) in enumerate(DIMS):
            if re.search(rx, txt):
                per[t["client"]][i] += 1
    scores = {}
    for brand, counts in per.items():
        dims, num, den = [], 0, 0
        for i, (nm, w, rx, ns) in enumerate(DIMS):
            s = min(100, counts[i] * 25)            # 4+ tasks in a dimension = maxed
            dims.append({"n": nm, "s": s, "w": w})
            num += s * w; den += w
        total = round(num / den) if den else 0
        cand = [d for d in dims if d["w"] >= 11]     # next step = weakest important dimension
        nxt = min(cand, key=lambda d: (d["s"], -d["w"]))
        ns_text = next(ns for (nm, w, rx, ns) in DIMS if nm == nxt["n"])
        scores[brand] = {"total": total, "cat": CATEGORY.get(brand, "Other"),
                         "dims": dims, "next": ns_text, "nextdim": nxt["n"]}
    catv = defaultdict(list)
    for b, s in scores.items():
        catv[s["cat"]].append(s["total"])
    bench = {c: round(sum(v) / len(v)) for c, v in catv.items()}
    return scores, bench

def clean(c):
    return (c or "").replace("\\*", "*").replace("\\[", "[").replace("\\]", "]").replace("\\#", "#").replace("\\>", ">").replace("\\-", "-").replace("\\_", "_").strip()

def norm_client(c):
    u = re.sub(r"\s+", " ", (c or "").strip().upper()).strip()
    return NAMES.get(u, (c or "").strip().title() or "—")

def norm_ae(a):
    a = (a or "").strip()
    m = re.search(r"invalid (?:ae|am)\s*\(([^)]+)\)", a, re.I)
    if m: a = m.group(1).strip()
    a = a.replace("❓", "").strip()
    if not a or a.lower() in ("please fill in due date",): return "Unassigned"
    return {"aspl": "ASPL", "slt": "SLT", "edzi": "Ezgi", "ezgi": "Ezgi", "michel": "Michel"}.get(a.lower(), a.title() if a.islower() else a)

def parse_due(s):
    s = (s or "").strip()
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})", s)
    if not m: return (9999, 99, 99), ""
    a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if a > 12: d, mo = a, b
    else:      mo, d = a, b
    if not (1 <= mo <= 12): mo = 1
    return (y, mo, min(d, 31)), f"{d:02d} {MONTHS[mo]} {y}"

def find_status(cells):
    for c in cells:
        cl = c.strip().lower()
        if cl in STATUS_VOCAB: return cl
    return ""

def find_action(cells):
    j = " ".join(cells).lower()
    if "monthly call" in j: return "monthly call"
    if "import" in j: return "import"
    if "[atrt]" in j or "atrt]" in j: return "email"
    return "other"

def find_thread(cells):
    for c in cells:
        m = re.search(r"https?://mail\.google\.com/\S+", c)
        if m: return m.group(0).rstrip("|").strip()
    return ""

# tab-2 activity cells = the project-plan task lists (the source of truth for analysis/scores)
_PLAN_STOP = {"done", "yes", "no", "eta", "large", "medium", "small", "1st", "2nd", "fm",
              "covered", "n/a", "na", "tbd", "collect later", "in tracker (tab 2)", "new agency"}
def is_plan_task(c):
    s = (c or "").strip(); cl = s.lower()
    if len(s) < 6 or " " not in s: return False
    if "project plan" in cl or "onboarding" in cl or cl in _PLAN_STOP: return False
    if re.match(r"^[\d.,%£$/ +-]+$", s): return False
    if not re.search(r"[a-z]", cl): return False
    return True

def test_type(t):
    t = t.lower()
    if "overlay" in t: return "Overlay / badge"
    if "title" in t or "mask" in t or "aot" in t: return "Title / MASK A/B"
    if "lia" in t or "click & collect" in t or "click and collect" in t: return "LIA / C&C"
    if "intent" in t or ("ai" in t and "title" in t): return "Search-intent / AI"
    if "keyword" in t or re.search(r"\bkw\b", t): return "Keyword"
    if "a/b" in t or re.search(r"\bab\b", t) or "test" in t: return "A/B (other)"
    return "Other"

def is_test(t):
    return bool(re.search(r"test|a/b|\bab\b|overlay|title|mask|keyword|\bkw\b|\blia\b|intent|click & collect", t, re.I))

def parse(src):
    rows = []
    for ln in open(src, encoding="utf-8"):
        if ln.startswith("|"): rows.append([clean(c) for c in ln.strip().strip("|").split("|")])
    dre = re.compile(r"^\d{1,2}[/.]\d{1,2}[/.]\d{4}")
    tasks, plans, plan_tasks = [], [], []
    for r in rows:
        if not r: continue
        if dre.match(r[0]) and len(r) > 3:
            status = r[11].strip().lower() if len(r) > 11 and r[11].strip().lower() in STATUS_VOCAB else find_status(r)
            key, disp = parse_due(r[6] if len(r) > 6 else "")
            tasks.append({"client": norm_client(r[1]), "task": r[3], "am": r[4] if len(r) > 4 else "",
                          "ae": norm_ae(r[5] if len(r) > 5 else ""), "due": disp, "duekey": list(key),
                          "status": status, "action": find_action(r), "thread": find_thread(r),
                          "is_test": is_test(r[3]),
                          "header": r[7] if len(r) > 7 else "", "recv": parse_due(r[0])[1]})
        elif r[0] and not dre.match(r[0]) and any("Project Plan" in c or "Onboarding" in c for c in r):
            plan = next((c for c in r if "Project Plan" in c or "Onboarding" in c), "")
            plans.append({"client": r[0].strip(), "category": r[1].strip() if len(r) > 1 else "", "plan": plan})
            cli = norm_client(r[0])                       # tab-2 activity cells = this client's project-plan tasks
            for c in r:
                if is_plan_task(c): plan_tasks.append({"client": cli, "task": c})
    return tasks, plans, plan_tasks

def esc(s): return html.escape(str(s), quote=True)

def today_key():
    t = datetime.date.today()
    return (t.year, t.month, t.day), t

def is_overdue(t, tk):
    # actively open and past due — on-hold is parked, not overdue
    return t["status"] in ACTIVE and t["status"] != "on hold" and t["duekey"][0] < 9999 and tuple(t["duekey"]) < tk

def due_within(t, tk, tk2):
    return t["status"] in ACTIVE and tk <= tuple(t["duekey"]) <= tk2

def render_kpi(tasks, plans):
    tk, td = today_key()
    tk2 = (lambda d: (d.year, d.month, d.day))(td + datetime.timedelta(days=7))
    active = [t for t in tasks if t["status"] in ACTIVE]
    overdue = sum(1 for t in active if is_overdue(t, tk))
    week = sum(1 for t in active if due_within(t, tk, tk2))
    running = sum(1 for t in active if t["is_test"])
    accts = len({t["client"] for t in tasks} | {p["client"] for p in plans})
    def s(n, l, cls=""):
        return f'<div class="s"><div class="n {cls}">{n}</div><div class="l">{l}</div></div>'
    return (s(len(active), "Active tasks") + s(overdue, "Overdue", "danger" if overdue else "") +
            s(week, "Due next 7 days") + s(running, "Tests running") + s(accts, "Accounts"))

def render_log(tasks):
    tk, _ = today_key()
    active = [t for t in tasks if t["status"] in ACTIVE]
    active.sort(key=lambda t: (t["duekey"], t["client"]))
    trs = []
    for t in active:
        od = is_overdue(t, tk)
        thread = f' <a class="thread" href="{esc(t["thread"])}" target="_blank" rel="noopener" title="Open email thread">✉</a>' if t.get("thread") else ""
        due = f'<span class="od">⚠ {esc(t["due"])}</span>' if od else esc(t["due"] or "—")
        trs.append(
            f'<tr data-account="{esc(t["client"])}" data-status="{esc(t["status"])}" data-od="{1 if od else 0}">'
            f'<td><b>{esc(t["client"])}</b></td><td>{esc(t["task"][:96])}{thread}</td>'
            f'<td>{esc(t["ae"])}</td><td>{due}</td>'
            f'<td><span class="tag tag-{STATUS_CLASS.get(t["status"],"hold")}">{esc(t["status"])}</span></td></tr>')
    ae = Counter(t["ae"] for t in active)
    src = Counter(t["action"] for t in active)
    src_lbl = {"import": "AM project plan", "monthly call": "Monthly call", "email": "Email / ad-hoc", "other": "Other"}
    ae_rows = "".join(f'<div class="planrow"><span class="nm">{esc(k)}</span><span class="tag">{v} active</span></div>'
                      for k, v in ae.most_common(8))
    src_rows = "".join(f'<div class="planrow"><span class="nm">{esc(src_lbl.get(k,k))}</span><span class="tag">{v}</span></div>'
                       for k, v in src.most_common())
    return (
        '<div class="panel">'
        '<h3>Live workload</h3>'
        f'<div class="sub">{len(active)} active tasks · filter by account or status · full history in the tracker</div>'
        '<div id="wl-filter" class="wl-filter"></div>'
        '<div style="overflow-x:auto"><table class="logtable wl" id="wl-table">'
        '<thead><tr><th>Account</th><th>Task</th><th>AE</th><th>Due</th><th>Status</th></tr></thead>'
        f'<tbody>{"".join(trs)}</tbody></table></div>'
        f'<p class="note" id="wl-empty" style="display:none">No tasks match — <button class="linkish" id="wl-clear">clear filters</button>.</p>'
        f'<p class="note">Sourced from the <a href="{TRACKER}" target="_blank" rel="noopener">ATRT Tracker</a> — '
        'tasks arriving by email (ad-hoc) or monthly call, per client, AM, AE and due date. ✉ opens the email thread.</p>'
        '</div>'
        '<div class="grid-2" style="margin-top:18px">'
        f'<div class="panel"><h3>Load by account executive</h3><div class="sub">Active tasks per AE</div><div class="planlist">{ae_rows}</div></div>'
        f'<div class="panel"><h3>How work arrives</h3><div class="sub">Active tasks by source</div><div class="planlist">{src_rows}</div></div>'
        '</div>')

def render_tests(tasks):
    tk, _ = today_key()
    tests = [t for t in tasks if t["is_test"]]
    by = Counter(test_type(t["task"]) for t in tests)
    chips = "".join(f'<span class="chip"><b>{v}</b> {esc(k)}</span>' for k, v in by.most_common())
    act = sorted([t for t in tests if t["status"] in ACTIVE], key=lambda t: (t["duekey"], t["client"]))
    trs = []
    for t in act:
        dc = f'<span class="od">⚠ {esc(t["due"])}</span>' if is_overdue(t, tk) else (esc(t["due"]) or "—")
        trs.append(
            f'<tr><td><b>{esc(t["client"])}</b></td><td>{esc(t["task"][:92])}</td><td>{esc(test_type(t["task"]))}</td>'
            f'<td>{dc}</td>'
            f'<td><span class="tag tag-{STATUS_CLASS.get(t["status"],"hold")}">{esc(t["status"])}</span></td></tr>')
    rows = "".join(trs)
    return (
        '<div class="panel">'
        f'<h3>Test book</h3><div class="sub">{len(tests)} tests logged all-time · by type</div>'
        f'<div class="chips" style="margin-bottom:18px">{chips}</div>'
        f'<h3 style="margin-top:8px">Active &amp; running tests</h3><div class="sub">{len(act)} live right now</div>'
        '<div style="overflow-x:auto"><table class="logtable"><thead><tr><th>Account</th><th>Test</th><th>Type</th><th>Due</th><th>Status</th></tr></thead>'
        f'<tbody>{rows}</tbody></table></div></div>')

def render_plans(plans):
    rows = "".join(
        f'<div class="planrow"><span class="nm">{esc(p["client"])}<span style="color:var(--muted);font-weight:700"> · {esc(p["category"])}</span></span>'
        f'<span class="tag">{esc(p["plan"])}</span></div>' for p in plans)
    return (
        '<div class="panel">'
        f'<h3>All accounts &amp; project plans</h3><div class="sub">{len(plans)} accounts · plan links live on tab 2 of the tracker</div>'
        f'<div class="planlist">{rows}</div>'
        f'<p class="note" style="margin-top:14px"><a href="{TRACKER}#gid=100171143" target="_blank" rel="noopener">Open the ATRT Tracker</a> — '
        'tab 1 = task log, tab 2 = accounts &amp; project-plan links.</p></div>')

def render_global(tasks, plan_tasks):
    tk, td = today_key()
    active = [t for t in tasks if t["status"] in ACTIVE]
    counts = Counter(t["client"] for t in active)
    od = Counter(t["client"] for t in active if is_overdue(t, tk))
    brands = {}
    for t in active:
        item = {"t": t["task"][:88], "ae": t["ae"], "d": t["due"], "s": t["status"],
                "od": 1 if is_overdue(t, tk) else 0, "x": 1 if t["is_test"] else 0}
        if t.get("thread"): item["u"] = t["thread"]
        brands.setdefault(t["client"], []).append(item)
    scores, bench = compute_scores(plan_tasks)   # source of truth = project-plan tasks (tab 2)
    payload = {"active": dict(counts), "overdue": dict(od), "brands": brands,
               "scores": scores, "benchmarks": bench,
               "synced": f'{td.day:02d} {MONTHS[td.month]} {td.year}'}
    return f'<script>window.ATRT={json.dumps(payload, ensure_ascii=False)};</script>'

def render_bench(plan_tasks):
    from collections import Counter
    scores, bench = compute_scores(plan_tasks)
    items = sorted(bench.items(), key=lambda kv: -kv[1])
    bars = "".join(
        f'<div class="bmk-row"><span class="bmk-cat">{esc(c)}</span>'
        f'<span class="bmk-track"><span class="bmk-fill" style="width:{max(v,2)}%"></span></span>'
        f'<span class="bmk-val">{v}</span></div>' for c, v in items)
    ranked = sorted(scores.items(), key=lambda kv: -kv[1]["total"])
    lead = "".join(
        f'<div class="planrow"><span class="nm">{esc(b)}<span style="color:var(--muted);font-weight:700"> · {esc(s["cat"])}</span></span>'
        f'<span class="tag" style="background:{"#EBF7EF" if s["total"]>=66 else "#FCF1E3" if s["total"]>=40 else "#FBEBEB"};'
        f'color:{"var(--good)" if s["total"]>=66 else "var(--orange-ink)" if s["total"]>=40 else "var(--risk)"}">'
        f'{s["total"]}/100</span></div>' for b, s in ranked[:12])
    catc = Counter(s["cat"] for s in scores.values())
    comp = "".join(f'<span class="chip"><b>{v}</b> {esc(c)}</span>' for c, v in catc.most_common())
    avg = round(sum(s["total"] for s in scores.values()) / len(scores)) if scores else 0
    return (
        '<div class="grid-2">'
        '<div class="panel"><h3>Feed-optimisation score by category</h3>'
        f'<div class="sub">Book average {avg}/100 · scored from the project-plan tasks against FeedSpark criteria</div>'
        f'<div class="bmk">{bars}</div></div>'
        '<div class="panel"><h3>Portfolio leaderboard</h3>'
        f'<div class="sub">{len(scores)} accounts scored · furthest along on feed optimisation</div>'
        f'<div class="planlist">{lead}</div></div>'
        '</div>'
        '<div class="panel" style="margin-top:18px"><h3>Portfolio composition</h3>'
        '<div class="sub">Accounts by category</div>'
        f'<div class="chips">{comp}</div>'
        '<p class="note">Scores are computed from each client\'s <b>project-plan tasks</b> (the source of truth), against seven FeedSpark criteria — '
        'Data &amp; Golden Record, Titles &amp; MASK, conversational attributes, testing cadence, creative/overlays, keywords/localisation and AI-readiness. '
        'Weights are tunable in <code>tools/sync_atrt.py</code>.</p></div>')

def render_comms(tasks):
    comms = [t for t in tasks if t.get("thread")]
    comms = list(reversed(comms))[:20]  # source is roughly chronological; show most-recent
    rows = "".join(
        f'<tr><td><b>{esc(t["client"])}</b></td>'
        f'<td>{esc((t.get("header") or t["task"])[:82])}</td>'
        f'<td>{esc(t.get("recv") or "—")}</td>'
        f'<td><span class="tag tag-{STATUS_CLASS.get(t["status"],"hold")}">{esc(t["status"])}</span></td>'
        f'<td><a class="thread" href="{esc(t["thread"])}" target="_blank" rel="noopener">Open ✉</a></td></tr>'
        for t in comms)
    return (
        '<div class="panel">'
        f'<h3>Client comms — from email</h3><div class="sub">{len(comms)} recent client threads the tracker captured from email · linked to Gmail</div>'
        '<div style="overflow-x:auto"><table class="logtable"><thead><tr><th>Account</th><th>Subject / task</th><th>Received</th><th>Status</th><th>Thread</th></tr></thead>'
        f'<tbody>{rows}</tbody></table></div>'
        '<p class="note"><b>MVP:</b> these are the client emails (from ray@feedspark.com) the ATRT Tracker logged as tasks, linked back to the Gmail thread. '
        'A live inbox pull is the next step — it needs the FeedSpark work account connected (the current integration points at the personal inbox).</p></div>')

def splice(text, name, frag):
    a, b = f"<!-- ATRT:{name}:START -->", f"<!-- ATRT:{name}:END -->"
    i, j = text.find(a), text.find(b)
    if i < 0 or j < 0:
        print(f"  WARN: markers {name} not found"); return text
    return text[:i + len(a)] + "\n" + frag + "\n" + text[j:]

def main(argv):
    if len(argv) > 1:
        tasks, plans, plan_tasks = parse(argv[1])
        json.dump({"tasks": tasks, "plans": plans, "plan_tasks": plan_tasks}, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"parsed {len(tasks)} tasks, {len(plans)} plans, {len(plan_tasks)} project-plan tasks -> {os.path.relpath(DATA, ROOT)}")
    else:
        d = json.load(open(DATA, encoding="utf-8")); tasks, plans, plan_tasks = d["tasks"], d["plans"], d.get("plan_tasks", [])
        print(f"loaded {len(tasks)} tasks, {len(plans)} plans, {len(plan_tasks)} project-plan tasks")
    doc = open(FCC, encoding="utf-8").read()
    for name, frag in [("KPI", render_kpi(tasks, plans)), ("LOG", render_log(tasks)),
                       ("TESTS", render_tests(tasks)),
                       ("PLANS", render_plans(plans)), ("BENCH", render_bench(plan_tasks)),
                       ("GLOBAL", render_global(tasks, plan_tasks))]:
        doc = splice(doc, name, frag)
    open(FCC, "w", encoding="utf-8").write(doc)
    tk, _ = today_key()
    active = [t for t in tasks if t["status"] in ACTIVE]
    print(f"spliced: {len(active)} active, {sum(1 for t in active if is_overdue(t,tk))} overdue, "
          f"{sum(1 for t in tasks if t['is_test'])} tests, {len(plans)} plans")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
