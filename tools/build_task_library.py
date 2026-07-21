#!/usr/bin/env python3
"""Build the FeedSpark Task Library page — categorise every task type FeedSpark handles,
counted from the ATRT Tracker. Re-run to refresh counts:
    python tools/build_task_library.py <atrt_source.txt>
Writes docs/FeedSpark_Task_Library.html (editable in place via the worker editor).
"""
import re, sys, os, html
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "FeedSpark_Task_Library.html")

# category -> [ (type, match-regex, description) ]  — first match wins, in this order
TAXONOMY = [
 ("Feed &amp; technical", [
   ("Scraping", r"scrap", "Harvest data from client sites — nodes, categories, promo roundels, new hobby/product URLs — to build or enrich the feed."),
   ("Feed migration", r"migrat|sfcc|swapover|market swap", "Move a feed between platforms or markets (e.g. SFCC), or migrate URLs / market structure."),
   ("CSS switching", r"\bcss\b", "Comparison Shopping Service work — switch or split-test CSS, restructure CSS campaigns."),
   ("Custom labels", r"custom label|\bcl\d|cl restructure|\blabel", "Build and restructure custom labels (CL0–CL4) for bidding and segmentation."),
   ("Data fields &amp; structure", r"data ?field|\bgmc\b|structure|convention|\bnode", "Populate and localise data fields; fix taxonomy/structure and naming conventions."),
   ("Image &amp; pixel fixes", r"pixel|text on image|disapprov|image ?link|image ?url|zoom", "Resolve image/pixel issues — disapprovals, broken image links, zoomed-image bugs."),
   ("Supplemental feeds", r"supp feed|supplemental|item.?group", "Layer a supplemental feed on the primary — titles, AOT, item groups, conversational attributes."),
   ("Exclusions &amp; cleanup", r"exclusion|zombie|remov|cleaning|\bclean", "Park or remove low-value SKUs — low-stock exclusions, zombie resets, label cleanup."),
 ]),
 ("Optimisation", [
   ("AI titles / search intent", r"ai ?title|search intent|\bintent\b", "Generate titles from search intent with AI — aligned to how buyers actually search."),
   ("Title optimisation (MASK)", r"title|mask|\baot\b", "Rewrite titles to MASK structure (Brand + Material + Fit + Colour + Use-case); AOT queues; brand inclusion."),
   ("Keyword optimisation", r"keyword|\bkw\b|gifting|xmas|black friday|\bbf\b|v-?day|seasonal", "Inject and expand keywords — planner batches, seasonal (BF/XMAS/gifting/V-Day), brand terms."),
   ("Search terms", r"search term|high.?volume", "Fold high-volume search terms into the feed to widen matched queries."),
   ("Visual enrichment", r"visual|enrich|main image|\bbox\b", "Enrich product imagery — visual attribute harvest, main-image selection, box shots."),
   ("Image overlay / badges", r"overlay|roundel|badge|selling fast|trending|limited edition|dynamic ?%|bestseller|sticker", "Overlay badges/roundels — sale, low-stock, bestseller, [Selling Fast] / [Trending Now] / [New]."),
   ("Localisation", r"localis|local language|translation|\bll\b|multi.?language|multiple region", "Localise titles and data fields across markets; local-language vs EN feeds."),
 ]),
 ("Testing", [
   ("A/B &amp; split tests", r"a/b|\bab test|split test|\btest\b", "Controlled A/B tests — titles, overlays, keywords — via a supplemental feed and a randomised split."),
   ("Product experiments", r"experiment|pmax|monetate", "Google product experiments / PMax feed tests; Monetate rule validation."),
   ("Testing roadmap", r"roadmap|test plan", "Plan and sequence the test backlog per client, prioritised by expected uplift."),
 ]),
 ("Creative, PPC &amp; channels", [
   ("DPA creative", r"\bdpa\b", "Dynamic Product Ads creative — overlays, roundels, DPA feed for Meta / social."),
   ("Image cyclers", r"cycler|cycling", "Always-on image cycling — rotate hero/lifestyle imagery (dress cycler, always-on cycler)."),
   ("PPC overlays / restructure", r"\bppc\b|campaign|weighted|bidding|margin", "PPC-side work — image overlays, campaign restructure, weighted/margin bidding."),
   ("LIA / Click &amp; Collect", r"\blia\b|click ?& ?collect|store.?front|local inventory", "Local Inventory Ads and Click &amp; Collect — light-LIA, bid tests, store-front feeds."),
   ("Social feeds", r"social|tiktok|partnerize|reddit|snapchat|meta", "Social commerce feeds — Meta, TikTok, Partnerize, Reddit, Snapchat."),
 ]),
 ("Account &amp; strategy", [
   ("Strategy review / QBR", r"strategy review|\bqbr\b|\breview", "Quarterly strategy and business reviews — results, roadmap, next quarter."),
   ("Proposals &amp; quotes", r"proposal|quote|pitch|estimate", "Scoping and commercials — proposals, quotes, time estimates, re-pitches."),
   ("Audits", r"audit|account review", "Feed/account audits — Golden Record baseline, hours &amp; feed review."),
   ("Onboarding", r"onboard|\bintro\b|kickoff|setup plan|project plan", "New-client onboarding — audit, quick wins, plan and team setup."),
 ]),
]

def clean(c):
    return c.replace("\\*","*").replace("\\[","[").replace("\\]","]").replace("\\>",">").replace("\\-","-").strip()

def norm(c):
    u=re.sub(r"\s+"," ",(c or "").strip().upper())
    m={"MON":"Monsoon","ACC":"Accessorize","HOB":"House of Bruar","ALLSAINTS":"AllSaints","ALL SAINTS":"AllSaints",
       "AMERICAN GOL":"American Golf","ESTEE":"Estée Lauder","ELC":"Estée Lauder","YUMOVE":"YuMOVE","JOMALONE":"Jo Malone"}
    return m.get(u, (c or "").strip().title())

def parse(src):
    tasks=[]
    dre=re.compile(r"^\d{1,2}[/.]\d{1,2}[/.]\d{4}")
    for ln in open(src,encoding="utf-8"):
        if not ln.startswith("|"): continue
        r=[clean(c) for c in ln.strip().strip("|").split("|")]
        if r and dre.match(r[0]) and len(r)>3:
            tasks.append((norm(r[1]), r[3]))
    return tasks

def classify(task):
    t=task.lower()
    for cat, types in TAXONOMY:
        for name, rx, desc in types:
            if re.search(rx, t): return cat, name
    return None, None

def esc(s): return html.escape(str(s), quote=True)

def build(tasks):
    counts=defaultdict(int); examples=defaultdict(list); clients=defaultdict(set); total_cls=0
    for cl, task in tasks:
        cat, name = classify(task)
        if not name: continue
        key=(cat,name); counts[key]+=1; clients[key].add(cl)
        if len(examples[key])<3 and task not in examples[key]: examples[key].append(task)
    matched=sum(counts.values())
    cards_by_cat={}
    for cat, types in TAXONOMY:
        blocks=[]
        for name, rx, desc in types:
            k=(cat,name); n=counts[k]
            ex="".join(f'<li>{esc(e[:88])}</li>' for e in examples[k]) or '<li class="muted">No examples logged yet</li>'
            cls=sorted(clients[k])[:6]
            chips="".join(f'<span class="mini">{esc(c)}</span>' for c in cls)
            cl_html=f'<div class="tt-cl">{chips}</div>' if chips else ""
            blocks.append(
                f'<div class="tt"><div class="tt-h"><h4>{name}</h4><span class="tt-n">{n}<small>×</small></span></div>'
                f'<p class="tt-d">{desc}</p>'
                f'<div class="tt-ex"><div class="tt-lbl">Recent examples</div><ul>{ex}</ul></div>'
                f'{cl_html}</div>')
        cards_by_cat[cat]=blocks
    return cards_by_cat, matched, len(TAXONOMY)

def page(cards_by_cat, matched, ncats):
    ntypes=sum(len(t) for _,t in TAXONOMY)
    nav="".join(f'<a href="#c{i}">{re.sub("&amp;","&",cat)}</a>' for i,(cat,_) in enumerate(TAXONOMY))
    secs=[]
    for i,(cat,types) in enumerate(TAXONOMY):
        cards="".join(cards_by_cat[cat])
        secs.append(
            f'<section id="c{i}" class="cat"><div class="wrap"><div class="cat-h"><span class="k">{i+1:02d}</span>'
            f'<h2>{cat}</h2><span class="cat-n">{len(types)} types</span></div>'
            f'<div class="tt-grid">{cards}</div></div></section>')
    body="\n".join(secs)
    return f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FeedSpark · Task Library</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  :root{{--orange:#F5A623;--orange-deep:#ED6F0B;--orange-ink:#B1550A;--ink:#333;--ink-2:#5b6470;--muted:#8a94a0;
    --line:#E6E6E6;--paper:#fff;--wash:#F7F7F5;--wash-2:#F1F1EE;--navy:#1A365D;--good:#15803D;
    --shadow:0 1px 2px rgba(16,24,40,.04),0 6px 20px rgba(16,24,40,.06);--radius:14px;}}
  *{{box-sizing:border-box}} html{{scroll-behavior:smooth}}
  body{{margin:0;font-family:Lato,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--paper);line-height:1.5}}
  a{{color:var(--orange-ink);text-decoration:none}} a:hover{{text-decoration:underline}}
  .wrap{{max-width:1120px;margin:0 auto;padding:0 28px}}
  .topbar{{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}}
  .topbar-in{{max-width:1120px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}}
  .brand{{font-weight:900;font-size:19px}} .brand span{{color:var(--orange-deep)}}
  .tb-tag{{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);border-left:1px solid var(--line);padding-left:14px}}
  .tb-nav{{margin-left:auto;display:flex;gap:18px;flex-wrap:wrap}} .tb-nav a{{font-size:13px;font-weight:700;color:var(--ink-2)}}
  .tb-back{{font-size:13px;font-weight:700;color:var(--ink-2);border-left:1px solid var(--line);padding-left:16px}}
  .hero{{padding:46px 0 30px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#fff,var(--wash))}}
  .eyebrow{{font-size:12px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:var(--orange-deep)}}
  .hero h1{{font-size:36px;line-height:1.1;margin:12px 0 0;font-weight:900;letter-spacing:-.02em}}
  .hero p{{font-size:16px;color:var(--ink-2);max-width:70ch;margin:14px 0 0}}
  .stat3{{display:flex;gap:34px;margin-top:26px}} .stat3 .n{{font-size:28px;font-weight:900}} .stat3 .l{{font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.02em}}
  .cat{{padding:44px 0;border-top:1px solid var(--line)}}
  .cat-h{{display:flex;align-items:baseline;gap:14px;margin-bottom:22px}}
  .cat-h .k{{font-size:12px;font-weight:900;color:var(--orange);letter-spacing:.12em}}
  .cat-h h2{{font-size:22px;font-weight:900;margin:0;letter-spacing:-.01em}}
  .cat-h .cat-n{{font-size:12.5px;color:var(--muted);font-weight:700;margin-left:auto}}
  .tt-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}}
  .tt{{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px}}
  .tt-h{{display:flex;align-items:center;justify-content:space-between;gap:10px}}
  .tt-h h4{{margin:0;font-size:16px;font-weight:900}}
  .tt-n{{font-size:15px;font-weight:900;color:var(--orange-deep);background:#FCF1E3;border:1px solid #F3D9B8;border-radius:100px;padding:3px 11px;white-space:nowrap}}
  .tt-n small{{font-size:11px;color:var(--muted);font-weight:700}}
  .tt-d{{font-size:13.5px;color:var(--ink-2);margin:10px 0 12px;line-height:1.5}}
  .tt-lbl{{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:900;margin-bottom:4px}}
  .tt-ex ul{{margin:0;padding-left:16px}} .tt-ex li{{font-size:12.5px;color:var(--ink-2);margin-bottom:3px}}
  .tt-ex li.muted{{color:var(--muted);font-style:italic;list-style:none;margin-left:-16px}}
  .tt-cl{{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px;border-top:1px solid var(--line);padding-top:11px}}
  .mini{{font-size:11px;font-weight:800;color:var(--ink-2);background:var(--wash);border:1px solid var(--line);border-radius:6px;padding:2px 7px}}
  .footmark{{border-top:1px solid var(--line);color:var(--muted);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;padding:20px 0}}
  @media(max-width:560px){{.hero h1{{font-size:27px}}.stat3{{gap:22px}}}}
</style></head><body>
<div class="topbar"><div class="topbar-in"><div class="brand">Feed<span>Spark</span></div><div class="tb-tag">Task Library</div>
<nav class="tb-nav">{nav}</nav><a class="tb-back" href="/">← Command center</a></div></div>
<header class="hero"><div class="wrap"><div class="eyebrow">Private &amp; Confidential · categorised from the ATRT Tracker</div>
<h1>Task library</h1>
<p>Every type of work FeedSpark handles, grouped and defined — from technical (scraping, CSS, migrations) to
optimisation (titles, keywords, AI, visual enrichment, overlays, AOT). Counts are drawn from the ATRT Tracker.
This is the base taxonomy: incoming tasks map to a type here, so briefs, hours and reporting stay consistent. Editable in place (⌘/Ctrl+Shift+E).</p>
<div class="stat3"><div><div class="n">{ntypes}</div><div class="l">Task types</div></div>
<div><div class="n">{ncats}</div><div class="l">Categories</div></div>
<div><div class="n">{matched}</div><div class="l">Tasks classified</div></div></div></div></header>
{body}
<div class="footmark"><div class="wrap">FeedSpark · Private &amp; Confidential · Task Library</div></div>
</body></html>'''

def main(argv):
    if len(argv)<2:
        print("usage: build_task_library.py <atrt_source.txt>"); return 1
    tasks=parse(argv[1])
    cards, matched, ncats=build(tasks)
    open(OUT,"w",encoding="utf-8").write(page(cards,matched,ncats))
    print(f"parsed {len(tasks)} tasks, classified {matched} -> {os.path.relpath(OUT,ROOT)}")
    return 0

if __name__=="__main__":
    sys.exit(main(sys.argv))
