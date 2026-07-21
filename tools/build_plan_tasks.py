#!/usr/bin/env python3
"""Consolidate parsed Project-Plan tabs into docs/plan_tasks.json for the FCC.

Reads the *_projectplan.csv files (leftmost-tab exports), parses each with
parse_projectplan, and emits per-brand:
  { score, total, done, open, hold, updated,
    cats: { cat: {total, done} },
    active: [ {desc, owner, cat, ns} ]  (open + hold, capped),
    recent: [ {desc, owner, cat} ]      (done, capped) }
Score = category-weighted completion (breadth × depth), 1..100.
"""
import json, os, sys
from collections import Counter, OrderedDict
from parse_projectplan import parse, summarise

HERE=os.path.dirname(os.path.abspath(__file__))
EXPORTS=os.path.join(HERE,"plan_exports")
OUT=sys.argv[1] if len(sys.argv)>1 else os.path.join(HERE,"..","docs","plan_tasks.json")

# csv file -> (brand(s)). A shared sheet (Monsoon/Accessorize) is split by MON/ACC lane tag.
PLANS=[
 ("reiss_projectplan.csv",      ["Reiss"]),
 ("schuh_projectplan.csv",      ["Schuh"]),
 ("monsoon_projectplan.csv",    ["Monsoon","Accessorize"]),
 ("superdry_projectplan.csv",   ["Superdry"]),
 ("yumove_projectplan.csv",     ["YuMOVE"]),
 ("hobbycraft_projectplan.csv", ["Hobbycraft"]),
 ("jomalone_projectplan.csv",   ["Jo Malone"]),
]
CORDER=["title","keyword","data","image","custom_label","product_type","technical","channel","test","account"]
CLBL={"title":"Titles","keyword":"Keywords","data":"Data fields","image":"Imagery","custom_label":"Custom labels",
      "product_type":"Product type","technical":"Feed & technical","channel":"Channels","test":"Testing",
      "account":"Account & strategy","opt":"Optimisation"}
_MON=["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
def pk_label(pk): return _MON[pk%100]+" "+("%02d"%(pk//100%100))
# curated category weights (feed-optimisation importance)
WEIGHT={"title":1.3,"keyword":1.3,"data":1.2,"image":1.0,"custom_label":1.0,
        "product_type":1.1,"technical":1.0,"channel":0.9,"test":1.1,"account":0.6,"opt":0.8}

def score_of(tasks):
    if not tasks: return 0
    cats=Counter(t["cat"] for t in tasks)
    num=den=0.0
    for c,n in cats.items():
        done=sum(1 for t in tasks if t["cat"]==c and t["ns"]=="done")
        w=WEIGHT.get(c,0.8)
        num += w*(done/n); den += w
    depth = num/den if den else 0            # weighted completion 0..1
    breadth = sum(1 for c in cats if any(t["cat"]==c and t["ns"]=="done" for t in tasks))/max(1,len(WEIGHT))
    return max(1, round(100*(0.75*depth + 0.25*min(1.0,breadth*1.4))))

def compact(t):
    return {"t":t["desc"][:150],"o":t["owner"][:40],"c":t["cat"],"s":t["status"][:24],"b":t.get("bk","open")}

def brand_payload(tasks, updated):
    s=summarise(tasks)
    cats={c:{"total":s["cats"][c],"done":s["catdone"][c]} for c in s["cats"]}
    # group by detected month period
    byp={}
    for t in tasks:
        if t.get("pk"): byp.setdefault(t["pk"],[]).append(t)
    pks=sorted(byp)
    if len(pks)>=2:
        volkind="month"
        vol=[]
        for k in pks[-9:]:
            ts=byp[k]; done=sum(1 for t in ts if t["bk"]=="done")
            vol.append({"l":pk_label(k),"d":done,"o":len(ts)-done})
        top=set(pks[-3:])
        latest=[compact(t) for t in tasks if t.get("pk") in top][:80]
    else:
        volkind="lane"
        vol=[]
        for c in CORDER:
            cc=cats.get(c)
            if cc and cc["total"]: vol.append({"l":CLBL.get(c,c),"d":cc["done"],"o":cc["total"]-cc["done"]})
        latest=[compact(t) for t in tasks if t["bk"]!="done"][:70]
    return dict(score=score_of(tasks), total=s["total"], done=s["done"],
                open=s["open"], hold=s["hold"], updated=updated,
                cats=cats, vol=vol, volkind=volkind, latest=latest)

def main():
    out=OrderedDict()
    for fn,brands in PLANS:
        p=os.path.join(EXPORTS,fn)
        if not os.path.exists(p):
            print(f"  skip (missing): {fn}"); continue
        tasks=parse(p)
        if not tasks:
            print(f"  skip (no tasks): {fn}"); continue
        if len(brands)>1:
            # shared Monsoon/Accessorize sheet: split by MON/ACC lane tag.
            # shared (untagged) tasks belong to both; MON-only -> Monsoon, ACC-only -> Accessorize.
            for b in brands:
                other = "acc" if b=="Monsoon" else "mon"
                bt=[t for t in tasks if not (t.get("lane","") or "").lower().startswith(other)]
                out[b]=brand_payload(bt, "2026-07")
                print(f"  {b}: {out[b]['total']} tasks, {out[b]['done']} done, score {out[b]['score']}")
        else:
            b=brands[0]
            out[b]=brand_payload(tasks, "2026-07")
            print(f"  {b}: {out[b]['total']} tasks, {out[b]['done']} done, score {out[b]['score']}")
    json.dump(out, open(OUT,"w",encoding="utf-8"), ensure_ascii=False)
    total=sum(v["total"] for v in out.values())
    print(f"\nwrote {OUT}  |  {len(out)} brands  |  {total} task-rows  |  {os.path.getsize(OUT)//1024} KB")
    splice(out)

def splice(out):
    """Inject window.PLANTASKS into every page that has <!-- PLANS:START/END --> markers."""
    import re
    payload='window.PLANTASKS='+json.dumps(out, ensure_ascii=False)+';'
    block='<!-- PLANS:START -->\n<script>'+payload+'</script>\n<!-- PLANS:END -->'
    for fn in ("FeedSpark_Command_Center.html","FeedSpark_Task_Library.html","FeedSpark_Readiness.html","FeedSpark_Leadership.html"):
        path=os.path.join(HERE,"..","docs",fn)
        if not os.path.exists(path): continue
        doc=open(path,encoding="utf-8").read()
        new,n=re.subn(r'<!-- PLANS:START -->.*?<!-- PLANS:END -->', lambda m: block, doc, count=1, flags=re.S)
        if not n:
            print(f"  ({fn}: PLANS markers not found; skipped)"); continue
        open(path,"w",encoding="utf-8").write(new)
        print(f"  spliced window.PLANTASKS into {fn} ({len(payload)//1024} KB)")

if __name__=="__main__": main()
