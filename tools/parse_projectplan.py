#!/usr/bin/env python3
"""Parse a FeedSpark 'Project Plan' tab CSV (leftmost-tab export) into clean tasks.

Plans share the same STRUCTURE (a task tracker: description / owner / status /
priority, grouped by optimisation lane) but the exact COLUMN OFFSETS differ per
sheet (merged/leading cells). So we detect the columns dynamically from the
header row that contains 'TASK OWNER' + 'STATUS' (+ usually 'Areas to optimised').

A genuine task = a row with a description AND (an owner OR a status). Section /
month sub-headers, repeated 'Owner/Status' header rows, and blank rows are skipped.
"""
import csv, re, json, sys
from collections import Counter, OrderedDict

DONE   = ("done","complete","launch","closed","live","resolved","implemented","approved")
HOLD   = ("parked","hold","paused","blocked","cancel")
MONTHS = ("jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec")

def g(r,i): return (r[i].strip() if 0<=i<len(r) else "")

STATUS_VOCAB = ("done","open","parked","on hold","in progress","in-progress","wip","scheduled",
                "live","complete","completed","launched","closed","resolved","approved","implemented",
                "not started","to start","ongoing","eta")
def is_status_token(v):
    """Strict: is this cell a status value (not a name/priority/time/percentage)?"""
    if not v: return False
    lv=v.lower().strip()
    if lv in ("n/a","na","-","/","tbc","tbd"): return False
    if "%" in lv or "hour" in lv or "hr" in lv: return False
    if lv in STATUS_VOCAB: return True
    if any(w in lv for w in ("done","parked","hold","in progress","in-progress","launch","complete","live","scheduled")): return True
    # bare date  5/28/2026 | 11-Mar | 24th March | Apr-26
    if re.fullmatch(r'\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?', lv): return True
    if re.fullmatch(r'\d{1,2}(st|nd|rd|th)?[ -][a-z]{3,9}', lv): return True
    if re.fullmatch(r'[a-z]{3}-\d{2}', lv): return True
    return False

def norm_status(v):
    lv=(v or "").lower().strip()
    if not lv: return "open"
    if any(w in lv for w in HOLD): return "hold"
    if any(w in lv for w in DONE): return "done"
    if lv=="eta" or lv=="scheduled": return "open"
    if re.match(r'^\d{1,2}[/-]\d', lv) or re.fullmatch(r'[a-z]{3}-\d{2}', lv) or \
       re.fullmatch(r'\d{1,2}(st|nd|rd|th)?[ -][a-z]{3,9}', lv): return "done"
    return "open"

def bucket(raw):
    """Coarse status bucket for the dossier filter: open / progress / hold / done."""
    lv=(raw or "").lower().strip()
    if not lv: return "open"
    if any(w in lv for w in ("done","complete","launch","live","closed","set live","resolved","result")): return "done"
    if re.match(r'^\d{1,2}[/-]\d', lv) or re.fullmatch(r"[a-z]{3}-\d{2}", lv): return "done"
    if "progress" in lv or lv=="wip": return "progress"
    if any(w in lv for w in ("hold","parked","postpon","await","with client","paused","block")): return "hold"
    return "open"

_MONTHNUM={m:i+1 for i,m in enumerate(("jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"))}
def parse_period(text):
    """Detect a month/quarter section header -> (label, sortkey YYYYMM). Else None."""
    tl=(text or "").lower()
    m=re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-/]*'?(\d{2,4})\b", tl)
    if m:
        mo=_MONTHNUM[m.group(1)[:3]]; yr=int(m.group(2)); yr+= 2000 if yr<100 else 0
        return (text.strip()[:26], yr*100+mo)
    q=re.search(r"\bq([1-4])[ /\-]*'?(\d{2,4})\b", tl)
    if q:
        yr=int(q.group(2)); yr+= 2000 if yr<100 else 0
        return (text.strip()[:26], yr*100+(int(q.group(1))-1)*3+1)
    return None

def scan_status(r, scol, ocol, dcol):
    """Find the row's status: mapped STATUS column first, then a window near owner."""
    order=[]
    if scol>=0: order.append(scol)
    order += list(range(ocol+1, ocol+9)) if ocol>=0 else []
    order += [dcol+2, dcol+3, dcol+4]
    seen=set()
    for ci in order:
        if ci in seen or ci<0: continue
        seen.add(ci)
        v=g(r,ci)
        if is_status_token(v): return v
    return ""

# task-category classification by description keywords (aligned to FeedSpark task library)
CATS = [
 ("title",        r"title|mask|naming|\bt-?shirt title\b"),
 ("keyword",      r"keyword|search ?term|\bsqr\b|query|embedding|\bintent\b|linelist|line list"),
 ("image",        r"image|cycler|hero|visual|roundel|photo|carousel|primary image"),
 ("custom_label", r"custom label|\bcl\d\b|\bcl\b|best ?seller|labels|new arrival"),
 ("product_type", r"product type|\bpt\b|gpc|category map|taxonomy|realign"),
 ("test",         r"a/b|ab test|\btest\b|experiment|trial|retest"),
 ("data",         r"data field|attribute|tagging|structured|\bspec\b|gtin|material|pattern|highlight|disapproval"),
 ("technical",    r"scrape|scraping|\bcss\b|feedhero|feed ?hero|migration|\bxml\b|integration|\bapi\b|rules|range completion|dashboard|monetate|partnerize|sftp|masterfeed|switchover|feed import|refresh frequency"),
 ("channel",      r"facebook|\bfb\b|meta|instagram|\big\b|shopping|pmax|\bdpa\b|social|awin|affiliate|silvertip|\blia\b|overlay|campaign"),
 ("account",      r"\bqbr\b|review|\bcall\b|report|invoice|billing|proposal|deck|alert|monitor|follow up|recommend|audit|workshop|intro|demo|catch ?up|access|score ?card|margin"),
]
def task_cat(d):
    dl=(d or "").lower()
    for name,pat in CATS:
        if re.search(pat, dl): return name
    return "opt"

SKIP_EXACT = {"areas to optimised","areas to optimize","task owner","owner","status","priority",
              "ad hoc tasks","ad-hoc tasks","scheduled tasks","outside scheduled monthly tasks",
              "scheduled monthly tasks","client account:","account manager","start of the month",
              "feedspark (aroxo)","agency","feedhero demo - requests"}
def is_skiptext(d):
    dl=d.lower().strip()
    if dl in SKIP_EXACT: return True
    if re.fullmatch(r'(catch ?up|catchup)\s*[-–].*', dl): return True   # 'Catch up - October'
    if re.fullmatch(r'[a-z]{3}-\d{2}', dl): return True                  # 'Apr-25'
    if re.fullmatch(r'\d{1,2}(st|nd|rd|th)?\s+[a-z]+\s+\d{4}', dl): return True  # '11th May 2023'
    if re.fullmatch(r'\d{1,2}[./]\d{1,2}[./]\d{2,4}', dl): return True   # '26.01.2023'
    return False

def find_header(rows):
    for i,r in enumerate(rows):
        low=[c.strip().lower() for c in r]
        if any("task owner" in c for c in low) and any(c=="status" for c in low):
            return i
    # fallback: first row containing 'areas to optimised'
    for i,r in enumerate(rows):
        if any("areas to optimis" in c.strip().lower() for c in r): return i
    return None

def col_map(header):
    low=[c.strip().lower() for c in header]
    def find(*names):
        for n in names:
            for j,c in enumerate(low):
                if c==n: return j
        for n in names:
            for j,c in enumerate(low):
                if n in c: return j
        return -1
    owner=find("task owner","owner")
    status=find("status")
    prio=find("priority","prio (w/c)","prio")
    desc=find("areas to optimised","areas to optimize","areas to optimis")
    if desc<0: desc=(owner-1) if owner>0 else 2
    return dict(desc=desc, owner=owner, status=status, prio=prio)

def parse(path):
    rows=list(csv.reader(open(path, encoding="utf-8")))
    hi=find_header(rows)
    if hi is None: return []
    cm=col_map(rows[hi])
    dcol,ocol,scol=cm["desc"],cm["owner"],cm["status"]
    tasks=[]; lane=None; period=""; pk=0
    for r in rows[hi+1:]:
        desc=g(r,dcol); owner=g(r,ocol); status=scan_status(r,scol,ocol,dcol)
        # lane/section tag often sits just left of desc
        tag=g(r,dcol-1) if dcol-1>=0 else ""
        if not desc: continue
        # month/quarter section header (owner-less) -> advance the current period
        if not owner:
            per=parse_period(desc)
            if per: period,pk=per; continue
        if is_skiptext(desc):
            continue
        # section header: a title with no owner & no status (e.g. '1  Data Fields & Titles')
        if not owner and not status:
            # keep as lane label if it's short & titley
            if len(desc)<=40 and not desc.lower().startswith(("fs ","reiss","schuh","share","confirm","review","add ")):
                lane=desc
            continue
        if len(desc)<4: continue
        raw=status.strip()
        tasks.append(dict(lane=(tag or lane or ""), desc=desc, owner=owner,
                          status=raw, ns=norm_status(raw), bk=bucket(raw),
                          period=period, pk=pk, cat=task_cat(desc)))
    return tasks

def summarise(tasks):
    done=sum(1 for t in tasks if t["ns"]=="done")
    hold=sum(1 for t in tasks if t["ns"]=="hold")
    openn=sum(1 for t in tasks if t["ns"]=="open")
    cats=Counter(t["cat"] for t in tasks)
    catdone={c:sum(1 for t in tasks if t["cat"]==c and t["ns"]=="done") for c in cats}
    return dict(total=len(tasks), done=done, open=openn, hold=hold,
                cats=dict(cats), catdone=catdone)

if __name__=="__main__":
    path=sys.argv[1]
    tasks=parse(path)
    s=summarise(tasks)
    print(f"TOTAL {s['total']} | done {s['done']} | open {s['open']} | hold {s['hold']}")
    print("categories:", ", ".join(f"{k}={v}(done {s['catdone'][k]})" for k,v in sorted(s['cats'].items(), key=lambda x:-x[1])))
    print("\nsample tasks:")
    for t in tasks[:12]:
        print(f"  [{t['cat']:>12}] {t['ns']:>4}  {t['desc'][:60]:<60}  ({t['owner']})")
