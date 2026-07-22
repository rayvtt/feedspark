#!/usr/bin/env python3
"""Add a light/dark theme (no-flash init + topbar toggle + dark overrides) to every FCC app page.
Idempotent: guarded by the /* FCC-THEME */ marker. Client decks are left light on purpose."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")
PAGES = ["FeedSpark_Command_Center.html","FeedSpark_Workflow.html","FeedSpark_Readiness.html",
         "FeedSpark_Leadership.html","FeedSpark_Task_Library.html","FeedSpark_DeckBuilder.html",
         "FeedSpark_Templates.html","FeedSpark_Roadmap.html"]

INIT = """<script>/* FCC-THEME */(function(){var d=document.documentElement;
try{var t=localStorage.getItem('fcc-theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';}d.setAttribute('data-theme',t);}catch(e){d.setAttribute('data-theme','light');}
try{if(localStorage.getItem('fcc-nav-collapsed')==='1')d.classList.add('nav-collapsed');}catch(e){}
var moon='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>';
var sun='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
var SK='fcc-scroll:'+location.pathname;
function restore(){try{var y=sessionStorage.getItem(SK);if(y!=null)window.scrollTo(0,parseInt(y,10)||0);}catch(e){}}
function ic(){return d.getAttribute('data-theme')==='dark'?sun:moon;}
function mk(){
  if(!document.getElementById('theme-tgl')){var tb=document.querySelector('.topbar-in');
    var b=document.createElement('button');b.id='theme-tgl';b.type='button';b.setAttribute('aria-label','Toggle light or dark theme');b.title='Toggle light / dark';b.innerHTML=ic();
    b.onclick=function(){var n=d.getAttribute('data-theme')==='dark'?'light':'dark';d.setAttribute('data-theme',n);try{localStorage.setItem('fcc-theme',n);}catch(e){}b.innerHTML=ic();};
    if(tb)tb.appendChild(b);else{b.style.cssText+=';position:fixed;top:12px;right:14px;z-index:60';document.body.appendChild(b);}}
  var cc=document.getElementById('nav-collapse');
  if(cc&&!cc.__w){cc.__w=1;cc.onclick=function(){var c=d.classList.toggle('nav-collapsed');try{localStorage.setItem('fcc-nav-collapsed',c?'1':'0');}catch(e){}};}
  restore();
}
var _st;window.addEventListener('scroll',function(){if(_st)cancelAnimationFrame(_st);_st=requestAnimationFrame(function(){try{sessionStorage.setItem(SK,window.scrollY);}catch(e){}});},{passive:true});
if(document.readyState!=='loading')mk();else document.addEventListener('DOMContentLoaded',mk);
window.addEventListener('load',restore);
})();</script>"""

DARK = """<style>/* FCC-THEME */
#theme-tgl{margin-left:10px;flex:none;width:34px;height:34px;border-radius:9px;border:1px solid var(--line,#E6E6E6);background:transparent;color:var(--ink-2,#4a4a4a);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s,border-color .15s}
#theme-tgl:hover{border-color:var(--orange,#F5A623);color:var(--orange-deep,#ED6F0B)}
/* icon module nav + collapse */
.nav-collapse{border:none;background:none;cursor:pointer;color:var(--muted,#8a94a0);padding:5px;border-radius:8px;display:inline-flex;align-items:center;flex:none;margin-left:auto}
.nav-collapse:hover{color:var(--orange-deep,#ED6F0B)}
.tb-modules{margin-left:8px!important;display:flex;gap:3px;align-items:center;flex-wrap:wrap}
.tb-modules a.tbm{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;color:var(--ink-2,#4a4a4a);text-decoration:none;transition:background .15s,color .15s}
.tb-modules a.tbm:hover{background:var(--wash,#F7F7F5);color:var(--orange-deep,#ED6F0B)}
.tb-modules a.tbm.on{background:rgba(245,166,35,.14);color:var(--orange-deep,#ED6F0B)}
.tb-modules a.tbm::after{content:attr(data-lbl);position:absolute;top:calc(100% + 7px);left:50%;transform:translateX(-50%);background:#1A365D;color:#fff;font-size:11px;font-weight:800;letter-spacing:.02em;white-space:nowrap;padding:4px 8px;border-radius:6px;opacity:0;pointer-events:none;transition:opacity .15s;z-index:70}
.tb-modules a.tbm:hover::after{opacity:1}
.nav-collapsed .tb-modules{display:none}
[data-theme=dark] .tb-modules a.tbm:hover{background:#20242E}
[data-theme=dark] .tb-modules a.tbm.on{background:rgba(245,166,35,.16)}
[data-theme=dark] .tb-modules a.tbm::after{background:#0B0D12}
[data-theme=dark] .nav-collapse:hover{color:var(--orange-ink)}
:root[data-theme=light]{color-scheme:light}
:root[data-theme=dark]{color-scheme:dark;
  --ink:#E7E9ED;--ink-2:#B9BEC7;--muted:#828D9C;--line:#2C3039;--paper:#1C1F27;--wash:#101218;
  --navy:#5B82BE;--orange-ink:#F0A44E;--good:#48D07E;--risk:#F1707A;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.42)}
[data-theme=dark] body{background:var(--wash);color:var(--ink)}
[data-theme=dark] .topbar{background:rgba(18,20,26,.9)}
[data-theme=dark] a{color:var(--orange-ink)}
/* card surfaces */
[data-theme=dark] .kpi,[data-theme=dark] .panel,[data-theme=dark] .card,[data-theme=dark] .modal,[data-theme=dark] .modal-card,[data-theme=dark] .modal-content,[data-theme=dark] .tik,[data-theme=dark] .itk,[data-theme=dark] .cm-card,[data-theme=dark] .rd-card,[data-theme=dark] .pm-card,[data-theme=dark] .ai-card,[data-theme=dark] .ev,[data-theme=dark] .tab,[data-theme=dark] .mc-panel,[data-theme=dark] .dz-item,[data-theme=dark] .dz-detail,[data-theme=dark] .dz-list,[data-theme=dark] .dz-logo,[data-theme=dark] .row,[data-theme=dark] .tt,[data-theme=dark] .en-card,[data-theme=dark] .tier,[data-theme=dark] .callout,[data-theme=dark] .note,[data-theme=dark] .stat,[data-theme=dark] .statstrip,[data-theme=dark] .planrow,[data-theme=dark] .col,[data-theme=dark] .before,[data-theme=dark] .after,[data-theme=dark] .sc-cell,[data-theme=dark] .mo,[data-theme=dark] .pipe-card,[data-theme=dark] .proto,[data-theme=dark] .flow-step,[data-theme=dark] .ask,[data-theme=dark] .pm-card,[data-theme=dark] .brand-logo,[data-theme=dark] .dg-bar,[data-theme=dark] .ct,[data-theme=dark] .chip{background:var(--paper);border-color:var(--line)}
/* washes / tracks / insets */
[data-theme=dark] .lane,[data-theme=dark] .prev-subj,[data-theme=dark] .rd-play,[data-theme=dark] .rd-dv,[data-theme=dark] .m-pill,[data-theme=dark] .m-sec,[data-theme=dark] .ptrack,[data-theme=dark] .cm-bar,[data-theme=dark] .addc select,[data-theme=dark] .lc-cell.lc-0,[data-theme=dark] .de-pop,[data-theme=dark] .lc-ctl select,[data-theme=dark] .live-sub{background:#181B22;border-color:var(--line)}
[data-theme=dark] pre.brief{background:#0E1016;border-color:var(--line);color:var(--ink-2)}
[data-theme=dark] pre.brief .tok{background:rgba(245,166,35,.16)}
/* inputs & neutral controls */
[data-theme=dark] input,[data-theme=dark] select,[data-theme=dark] textarea{background:#161922;color:var(--ink);border-color:var(--line)}
[data-theme=dark] .fchip,[data-theme=dark] .fsel,[data-theme=dark] .btn,[data-theme=dark] .ghost,[data-theme=dark] .btn-ghost,[data-theme=dark] .cm-rep,[data-theme=dark] .sent-seg,[data-theme=dark] .stat-seg button,[data-theme=dark] .itk-more,[data-theme=dark] .lc-star{background:#20242E;color:var(--ink-2);border-color:var(--line)}
[data-theme=dark] .btn.pri,[data-theme=dark] .btn.navy,[data-theme=dark] .btn-primary,[data-theme=dark] .fchip.on,[data-theme=dark] .stat-seg button.on{color:#fff}
/* gradients / hero washes back to flat dark */
[data-theme=dark] .hero,[data-theme=dark] .glive,[data-theme=dark] .wf-cta,[data-theme=dark] .toolbar{background:transparent}
[data-theme=dark] .glive,[data-theme=dark] .wf-cta{background:rgba(245,166,35,.09);border-color:rgba(245,166,35,.28)}
/* semantic tint pills — green */
[data-theme=dark] .built,[data-theme=dark] .atrt-badge,[data-theme=dark] .cm-pill.ok,[data-theme=dark] .rd-band.b0,[data-theme=dark] .scan-hit,[data-theme=dark] .tag-open,[data-theme=dark] .card.on,[data-theme=dark] .card.shipped,[data-theme=dark] .wl-test{background:rgba(72,208,126,.14)!important;border-color:rgba(72,208,126,.3)!important;color:#6FE0A0!important}
/* orange */
[data-theme=dark] .mchip.imp-med,[data-theme=dark] .cm-pill.warn,[data-theme=dark] .rd-band.b2,[data-theme=dark] .due.soon,[data-theme=dark] .tag-hold,[data-theme=dark] .top10,[data-theme=dark] .top,[data-theme=dark] .rd-band.b1{background:rgba(245,166,35,.15)!important;border-color:rgba(245,166,35,.32)!important;color:#F0A44E!important}
/* red */
[data-theme=dark] .mchip.imp-high,[data-theme=dark] .cm-pill.risk,[data-theme=dark] .rd-band.b3,[data-theme=dark] .due.over,[data-theme=dark] .atrt-badge.danger,[data-theme=dark] .tag-risk,[data-theme=dark] .row.attn,[data-theme=dark] .rd-card.crit{background:rgba(241,112,122,.13)!important;border-color:rgba(241,112,122,.3)!important;color:#F3868F!important}
/* navy/blue */
[data-theme=dark] .mchip.eff,[data-theme=dark] .who-chip,[data-theme=dark] .tag-progress,[data-theme=dark] .tag-client{background:rgba(91,130,190,.18)!important;border-color:rgba(91,130,190,.36)!important;color:#93B4E0!important}
/* neutral chips */
[data-theme=dark] .mchip,[data-theme=dark] .mini,[data-theme=dark] .mchip.ch,[data-theme=dark] .tag,[data-theme=dark] .pill,[data-theme=dark] .cm-pill.na,[data-theme=dark] .m-pill{background:#20242E;border-color:var(--line);color:var(--ink-2)}
[data-theme=dark] .lc-cell.lc-0 .lc-dim{color:var(--muted)}
/* meter tracks + score-ring insets */
[data-theme=dark] .vbar-track,[data-theme=dark] .tbar-track,[data-theme=dark] .ptrack,[data-theme=dark] .bar,[data-theme=dark] .dg-track,[data-theme=dark] .track,[data-theme=dark] .cm-bar{background:#191C24;border-color:var(--line)}
[data-theme=dark] .score-ring::before,[data-theme=dark] .dg-ring::before,[data-theme=dark] .s-ring::before,[data-theme=dark] .sc::before,[data-theme=dark] .rd-ring::before,[data-theme=dark] .ring::before{background:var(--paper)}
[data-theme=dark] ::-webkit-scrollbar-thumb{background:#2C3039}
</style>"""

def apply(path):
    doc = open(path, encoding="utf-8").read()
    # refresh in place: strip any prior FCC-THEME blocks so the tool stays the source of truth
    doc = re.sub(r'\n?<script>/\* FCC-THEME \*/.*?</script>', '', doc, flags=re.S)
    doc = re.sub(r'\n?<style>/\* FCC-THEME \*/.*?</style>', '', doc, flags=re.S)
    # 1) init script right after the charset meta (as early as possible → no flash)
    m = re.search(r'<meta charset="[^"]*">', doc)
    if not m:
        return "!! no charset meta"
    doc = doc[:m.end()] + "\n" + INIT + doc[m.end():]
    # 2) dark override block right before the first </style>
    i = doc.find("</style>")
    if i == -1:
        return "!! no </style>"
    doc = doc[:i+len("</style>")] + "\n" + DARK + doc[i+len("</style>"):]
    open(path, "w", encoding="utf-8").write(doc)
    return "themed"

if __name__ == "__main__":
    for fn in PAGES:
        p = os.path.join(DOCS, fn)
        if not os.path.exists(p):
            print(f"  {fn}: missing"); continue
        print(f"  {fn}: {apply(p)}")
