/* FeedSpark — Keyword Calendar engine (UMD), served at /kwcal/engine.js
 *
 * Ray, 14 Oct 2026: "each theme requires briefing action, so bring the briefing action into the
 * workflows as well … so the account manager can remember when to brief rather than flip to the
 * keyword calendar module. So centralize every action on the workflow module … when hitting
 * brief, button in Workflow, that action is flipped back into the keyword calendar module and
 * then saved in the brief workflow as usual. Do not duplicate the task."
 *
 * Two surfaces now answer "what still needs briefing?" — the calendar and the Workflow board —
 * and they must answer it IDENTICALLY, because the whole point is that the AM stops flipping
 * between them. So the tie (which ticket belongs to which moment) and the brief payload live
 * HERE, once, and both pages call in. Not a copy checked for drift: one implementation with two
 * callers, so there is nothing to drift.
 *
 * Everything is PURE and takes the KWCal store explicitly — no page globals, no DOM, no fetch.
 * That is what makes it loadable by Workflow, which has no calendar state of its own: every
 * input the brief needs (the moments, their scope, each market's product-type index) is already
 * in the /api/kwcal record.
 *
 * Bodies are the calendar's own, moved rather than rewritten: FeedSpark_KWCal.html now holds
 * one-line adapters at the same names, so every call site there is untouched and the behaviour
 * these functions had on 14 Oct 2026 is the behaviour both pages get.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeedKwCal = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEAD_DAYS = 21;              // keyword optimisation lands ~3 weeks before the moment
  var STALE_DAYS = 20;             // a brief-by this far past is a wrong date, not a late task
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmt(n){ n=+n; return isFinite(n)?n.toLocaleString('en-GB'):'0'; }
  function normTask(s){ return String(s||'').toLowerCase().replace(/[‐-―−]/g,'-').replace(/\s+/g,' ').trim(); }

  /* ---- dates. e.date is the day the moment goes LIVE; the brief is due LEAD_DAYS earlier, and
     that is the date the board schedules work by. ---- */
  function schedDate(e){ var d=new Date(e.date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-LEAD_DAYS); return d; }
  function dLbl(e){ var d=new Date(e.date+'T12:00:00Z'); return (e.wc?'w/c ':'')+d.getUTCDate()+' '+MON[d.getUTCMonth()]; }
  function bLbl(e){ var d=schedDate(e); return d.getUTCDate()+' '+MON[d.getUTCMonth()]; }
  /* A TICKET CARRIES ITS OWN DUE DATE (Ray, 15 Oct 2026: "when writting brief - changes due date
     is not reflected btw - this ticket should be 1610 instead of the default 2610"). The composer
     proposes a date off the moment and the AM changes it; that date is what reaches ASPL in the
     subject's ibfdue token and what the Intake row then shows — so a briefed row that prints the
     moment's live date is showing the figure the AM overrode. Workflow stores it DD/MM/YYYY. */
  function dueIso(b){ var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String((b&&b.due)||'').trim());
    if(!m)return ''; var d=+m[1], mo=+m[2], y=+m[3];
    if(mo<1||mo>12||d<1||d>31)return '';                       // a day the calendar does not have
    var t=new Date(Date.UTC(y,mo-1,d,12));
    if(t.getUTCDate()!==d||t.getUTCMonth()!==mo-1)return '';    // 31/02 is not a date, never rolled
    return t.toISOString().slice(0,10); }
  function dueLbl(iso){ if(!iso)return ''; var d=new Date(iso+'T12:00:00Z');
    return d.getUTCDate()+' '+MON[d.getUTCMonth()]; }

  /* ---- the store. A record is STORE[brand] = {events:[…], ptidx:{mkt:{map,__total,sat}}}. ---- */
  function recOf(store,brand){ return (store&&store[brand])||{}; }
  function evsOf(store,brand){
    return (recOf(store,brand).events||[]).slice()
      .sort(function(a,b){ return String(a.date).localeCompare(String(b.date)); });
  }
  function ptidxFor(store,brand,mkt){ var r=recOf(store,brand); return (r.ptidx&&r.ptidx[mkt||'gb'])||null; }
  function evMkt(e,fallback){ return e.mkt||fallback||'gb'; }   // a pinned market wins; else the caller's
  function ptsOf(e,mkt){ if(e.ptsm&&e.ptsm[mkt])return e.ptsm[mkt]; if(mkt==='gb')return e.pts||[]; return []; }
  function txOf(e,mkt){ var t=e.txsm&&e.txsm[mkt]; return (t&&t.qs&&t.qs.length)?t:null; }
  function cndOf(e,mkt){ var c=e.cndm&&e.cndm[mkt]; return (c&&c.conds&&c.conds.length)?c:null; }
  /* A CONDITION EITHER LAYERS ONTO WHAT IS ABOVE IT OR STANDS ON ITS OWN (Ray, 16 Oct 2026:
     "This shouldn't be a condition based on the previous condition, but should continue to have a
     separate future. So either conditional layers conditions or a separate condition"). Every
     condition AND-narrowed whatever came before it, so a condition could only ever take products
     away — the Accessorize Halloween moment's colour condition could not contribute the black and
     orange products the text filter had missed. A condition now carries `join`: 'and' narrows the
     chain above it (the old behaviour, and what a stored condition with no join reads as, so no
     saved scope's count moves), 'or' STARTS A NEW CHAIN that stands alone. The scope is the UNION
     of the chains: chain 0 is (PT ∪ text) narrowed by its own conditions, and every later chain is
     the whole catalogue narrowed by its own. A chain with neither a base nor a condition is not a
     chain — it would be the whole catalogue and swallow every other. */
  function condChains(conds,hasBase){
    var out=[{base:!!hasBase,conds:[]}], i;
    for(i=0;i<(conds||[]).length;i++){
      var c=conds[i];
      if(c&&c.join==='or')out.push({base:false,conds:[c]});
      else out[out.length-1].conds.push(c);
    }
    // chain indices stay as written (condChainOf lines up with them); a chain with neither a base
    // nor a condition is marked dead rather than dropped
    for(i=0;i<out.length;i++)out[i].live=!!(out[i].base||out[i].conds.length);
    return out;
  }
  function condChainOf(conds,i){ // which chain the condition at index i belongs to (0 = the PT/text chain)
    var n=0,k; for(k=0;k<=i&&k<(conds||[]).length;k++){ if(conds[k]&&conds[k].join==='or')n++; } return n; }
  // a scope can be SET and not yet measurable — volOf needs the market's product-type index and
  // returns null without one; an unread index is never a zero
  function hasScope(e,mkt){ return !!(ptsOf(e,mkt).length || txOf(e,mkt) || cndOf(e,mkt)); }

  function volOf(store,brand,e,mkt){
    mkt = mkt || evMkt(e,'gb');
    var idx=ptidxFor(store,brand,mkt); if(!idx)return null;
    if(e.brandwide)return {vol:idx.__total||0,pct:100,wide:1};
    var ps=ptsOf(e,mkt), tx=txOf(e,mkt), cnd=cndOf(e,mkt);
    if(!ps.length&&!tx&&!cnd)return {unset:1};
    var v;
    if(cnd){ v=(cnd.uni!=null)?cnd.uni:0; }
    else { v=0; ps.forEach(function(pt){ v+=idx.map[pt]||0; });
      if(tx)v=(tx.uni!=null)?tx.uni:v+tx.qs.reduce(function(s,q){return s+(q.n||0)},0); }
    var o={vol:v,pct:idx.__total?Math.round(v/idx.__total*1000)/10:0};
    if(tx)o.tx=tx.qs.length; if(ps.length)o.npts=ps.length; if(cnd)o.cnd=cnd.conds.length;
    return o;
  }

  // keyword-generation rule of thumb: 500→4h · 1500→6h · 4000→8h · 10000→10h
  function kwHours(n){ n=Math.max(0,Math.round(+n||0)); if(!n)return 0; if(n<=500)return 4;
    var p=[[500,4],[1500,6],[4000,8],[10000,10]],i;
    for(i=1;i<p.length;i++){ if(n<=p[i][0]){ var a=p[i-1],b=p[i]; return a[1]+(n-a[0])/(b[0]-a[0])*(b[1]-a[1]); } }
    var L=p[p.length-1],P=p[p.length-2],rate=(L[1]-P[1])/(L[0]-P[0]); return L[1]+(n-L[0])*rate; }

  // the house task-name format — details live in the brief SCOPE, not the title
  function kwTask(brand,e,mkt){
    var bmkt=evMkt(e,mkt||'gb'), d=new Date(e.date+'T12:00:00Z');
    var mmyy=('0'+(d.getUTCMonth()+1)).slice(-2)+String(d.getUTCFullYear()).slice(2);
    return 'Keywords Optimisation - '+e.name+' - Marketing Planner - '+mmyy+(bmkt!=='gb'?' - '+bmkt.toUpperCase():'');
  }

  /* ---- THE BRIEF. One builder, so a brief raised from the Workflow band is the same brief,
     word for word, as one raised from the calendar card — same task name, same scope lines, and
     the same `kw` stamp, which is what makes the calendar read it as briefed and what stops a
     second ticket ever being raised for the moment. ---- */
  function briefPayload(store,brand,e,mkt){
    var bmkt=evMkt(e,mkt||'gb');
    var v=volOf(store,brand,e,bmkt)||{}, ps=ptsOf(e,bmkt), idx=ptidxFor(store,brand,bmkt);
    var lines=['Moment: '+e.name+' — lands '+dLbl(e)+' ('+bmkt.toUpperCase()+') · brief by '+bLbl(e),
      'Keyword themes: '+((e.terms||[]).join(', ')||'TBC')];
    var tx=txOf(e,bmkt), cn=cndOf(e,bmkt);
    if(e.brandwide){ lines.push('Categories: brand-wide — whole '+bmkt.toUpperCase()+' catalogue'+(v.vol?' ('+fmt(v.vol)+' SKUs)':'')); }
    else if(ps.length||tx||cn){
      if(ps.length){ lines.push('Categories in scope:');
        ps.forEach(function(pt){ lines.push('  • '+pt+(idx?' — '+fmt(idx.map[pt]||0)+' SKUs':'')); }); }
      if(tx){ lines.push('Text filters (title/description contains):');
        tx.qs.forEach(function(q){ lines.push('  • “'+q.q+'” — '+(q.n!=null?fmt(q.n)+' SKUs':'count pending sync')); }); }
      if(cn){ lines.push('Attribute conditions:');
        cn.conds.forEach(function(c,ci){ lines.push('  • '+((ci&&c.join==='or')?'OR (its own set) ':(ci?'AND ':''))
          +c.attr+' = '+((c.vals||[]).join(', ')||'TBC')); }); }
      if(v&&v.vol!=null)lines.push('Total: '+fmt(v.vol)+' SKUs'+((ps.length?1:0)+(tx?1:0)+(cn?1:0)>1?' unique':'')+' ('+v.pct+'% of the live feed)');
    } else lines.push('Categories: TBC — set the scope on the Keyword Calendar');
    var sat=idx&&idx.sat, sm=e.satm&&e.satm[bmkt];
    if(sat&&idx.__total){
      var cur=Math.round(sat.n/idx.__total*1000)/10;
      var sl='Keyword saturation ('+bmkt.toUpperCase()+'): '+cur+'% of the live feed already keyworded (g:product_type2–10)';
      if(e.brandwide){ var rem=idx.__total-sat.n; if(rem>0)sl+=' — brand-wide window: '+fmt(rem)+' SKUs to take the brand to 100%'; }
      else if(sm&&sm.unsat!=null){
        if(!sm.unsat)sl+=' — every in-scope SKU already carries keywords';
        else sl+=' — '+fmt(sm.unsat)+' in-scope SKUs still to keyword; landing this brief lifts the brand to ~'+(Math.round((sat.n+sm.unsat)/idx.__total*1000)/10)+'%'; }
      lines.push(sl);
    }
    return {client:brand,task:kwTask(brand,e,bmkt),cat:'keyword',scope:lines.join('\n'),kw:e.id};
  }

  /* ---- THE TIE: which Workflow ticket belongs to which moment. Resolved strongest-evidence
     first over the whole brand in one pass, so a brief is claimed by AT MOST ONE moment and an
     early moment cannot greedily take a ticket a later one owns. A ticket two moments fit
     equally well is claimed by NEITHER — a confidently wrong tie is worse than an honest gap. ---- */
  var TASK_STOP={the:1,and:1,a:1,an:1,of:1,for:1,to:1,in:1,on:1,at:1,with:1,from:1,
    keyword:1,keywords:1,kw:1,optimisation:1,optimization:1,optimise:1,optimize:1,ai:1,opt:1,
    marketing:1,planner:1,calendar:1,brief:1,briefing:1,task:1,feed:1,test:1,update:1,new:1,fix:1};
  function taskWords(s){ return normTask(s).split(/[^a-z0-9]+/).filter(Boolean); }
  function sigWords(s,drop){
    var out=[], seen={};
    taskWords(s).forEach(function(w){ if(w.length<3||/^\d+$/.test(w)||TASK_STOP[w]||(drop&&drop[w])||seen[w])return;
      seen[w]=1; out.push(w); });
    return out;
  }
  function nameScore(mw,tw){
    if(!mw.length||!tw.length)return 0;
    var set={}; tw.forEach(function(w){ set[w]=1; });
    var hit=0; mw.forEach(function(w){ if(set[w])hit++; });
    if(!hit)return 0;
    var mom=hit/mw.length, tick=hit/tw.length;
    return 2*mom*tick/(mom+tick);
  }
  /* ---- WHOSE COURT a pipeline stage sits in. This lived in FeedSpark_KWCal.html alone; the
     Workflow band answers the same question about the same tickets, and two copies of a
     stage map is how one surface starts calling a stage the other has never heard of. The
     calendar keeps its own name for it (var COURTM = KWE.COURT) so no call site there moved. ---- */
  var COURT={intake:'AM',briefed:'ASPL',progress:'ASPL',blocked:'AM',done:'Client',
    running:'AM',analysis:'AM',confirmed:''};

  function isKwTicket(b){ return String(b.cat||'')==='keyword'||/keyword|optimis|optimiz/i.test(String(b.task||'')); }

  function tieBuild(events,briefs,brand,mkt){
    var E=events||[], mine=[], out={}, taken={}, done={};
    Object.keys(briefs||{}).forEach(function(k){ var b=briefs[k]; if(b&&b.client===brand&&b.id)mine.push(b); });
    mine.sort(function(a,b){ return (b.updated||b.created||0)-(a.updated||a.created||0); });
    function newer(a,b){ return (!a||(b.updated||b.created||0)>(a.updated||a.created||0))?b:a; }
    function assign(e,b,how){ out[e.id]={b:b,how:how}; taken[b.id]=1; done[e.id]=1; }

    // 0 — linked BY HAND: decisive, and it survives any rename on either side
    E.forEach(function(e){ if(!e.wf)return;
      for(var i=0;i<mine.length;i++) if(mine[i].id===e.wf&&!taken[mine[i].id]){ assign(e,mine[i],'linked'); return; } });

    // 1-3 — the calendar's own evidence, strongest first, every moment before the next rung
    [['kw',   function(e,b){ return b.kw&&String(b.kw)===String(e.id); }],
     ['task', function(e,b){ return normTask(b.task)===normTask(kwTask(brand,e,mkt)); }],
     ['name', function(e,b){ var tk=normTask(b.task),
         p1=normTask('Keywords Optimisation - '+e.name), p2=normTask('AI Keyword Optimisation - '+e.name);
         return tk===p1||tk===p2||tk.indexOf(p1+' - ')===0||tk.indexOf(p2+' - ')===0; }]
    ].forEach(function(rung){
      E.forEach(function(e){ if(done[e.id])return; var best=null;
        mine.forEach(function(b){ if(taken[b.id])return; if(rung[1](e,b))best=newer(best,b); });
        if(best)assign(e,best,rung[0]); });
    });

    // 4 — the WORDS of a ticket someone raised by hand, newest first. A ticket that doesn't read
    // as keyword work must name the moment OUTRIGHT, so a Feed Fix or Golden Record ticket can
    // never drift onto a moment on one shared word.
    var drop={}; taskWords(brand).forEach(function(w){ drop[w]=1; });
    var sig={}; E.forEach(function(e){ sig[e.id]=sigWords(e.name,drop); });
    var near={};
    mine.forEach(function(b){ if(taken[b.id])return;
      var tw=sigWords(b.task,drop);
      var top=null, topS=0, second=0;
      E.forEach(function(e){ if(done[e.id])return;
        var sc=nameScore(sig[e.id]||[],tw);
        if(sc>topS){ second=topS; topS=sc; top=e; } else if(sc>second) second=sc; });
      near[b.id]=topS;
      var floor=isKwTicket(b)?0.5:1;
      if(top&&topS>=floor&&topS>second) assign(top,b,'words'); });

    return { map:out, loose:mine.filter(function(b){ return !taken[b.id]; })
      .map(function(b){ return {b:b, near:near[b.id]||0}; }) };
  }

  /* ---- WHAT STILL NEEDS BRIEFING, for the Workflow band. A moment is DUE when no ticket
     claims it — the same tie the calendar draws, so the two surfaces can never disagree about
     whether something has been briefed, which is exactly how a second ticket would get raised.
     Sorted by the date the brief is due, soonest first; an overdue one leads. ---- */
  function dueList(store,briefs,opts){
    opts=opts||{};
    var now=opts.now?new Date(opts.now):new Date();
    var today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
    var horizon=opts.days==null?60:+opts.days;      // how far ahead to look; null/0- = everything
    // ...and how far BEHIND. Ray, 14 Oct 2026, over a band led by five Accessorize moments
    // 41-63 days late: "only backdated the task for anything less than 20 days late ... anything
    // else above that should just be removed from this view". A moment whose brief-by went past
    // weeks ago is not a nag, it is a DATE that is wrong: its window has gone, so briefing it
    // today would land work after the moment it was for. It leaves the band (the calendar still
    // holds it, and re-dating it there brings it back); the count of what was dropped rides on
    // the result so the band can say so rather than quietly shortening.
    var stale=opts.stale==null?STALE_DAYS:+opts.stale;
    var only=opts.clients&&opts.clients.length?opts.clients:null;
    var rows=[], nStale=0;
    Object.keys(store||{}).forEach(function(brand){
      if(brand.charAt(0)==='_')return;
      if(only&&only.indexOf(brand)<0)return;
      var E=evsOf(store,brand); if(!E.length)return;
      var tie=tieBuild(E,briefs,brand,opts.mkt);
      E.forEach(function(e){
        if(tie.map[e.id])return;                     // already has a ticket — never offered twice
        var bd=schedDate(e), by=Date.UTC(bd.getUTCFullYear(),bd.getUTCMonth(),bd.getUTCDate());
        var inDays=Math.round((by-today)/86400000);
        if(horizon>0&&inDays>horizon)return;         // beyond the window the AM is working to
        if(stale>0&&inDays<-stale){ nStale++; return; }  // its window has gone — re-date it, don't brief it
        var mkt=evMkt(e,opts.mkt||'gb');
        var v=volOf(store,brand,e,mkt);
        rows.push({ client:brand, id:e.id, name:e.name, mkt:mkt, lane:e.lane||'',
          live:e.date, liveLbl:dLbl(e), briefBy:bd.toISOString().slice(0,10), briefLbl:bLbl(e),
          inDays:inDays, overdue:inDays<0, terms:(e.terms||[]).slice(),
          brandwide:!!e.brandwide, scoped:!!e.brandwide||hasScope(e,mkt),
          vol:(v&&!v.unset)?v.vol:null, hours:(v&&!v.unset)?kwHours(v.vol||0):null });
      });
    });
    rows.sort(function(a,b){ return a.inDays-b.inDays || String(a.client).localeCompare(b.client); });
    rows.stale=nStale;
    return rows;
  }

  /* ---- AND WHAT HAS BEEN BRIEFED, with where it has got to (Ray, 15 Oct 2026: "with keywords
     calendar, also shown the briefed events (and status)"). The band listed only what still
     needs raising, which is right for an action list and leaves an AM no way to see that the
     rest of the month IS under way without opening the calendar.

     This is the OTHER HALF of the same tie — the moments tieBuild DID claim — so it can never
     disagree with the to-brief list above it: a moment appears in exactly one of the two, and
     the instant a ticket exists it moves across. Still no second record of the work: a row here
     is a TICKET that already exists, so it offers a link to it and never a brief button.

     The stage is the ticket's own, as Workflow holds it, and the court is the one map above —
     the calendar's chip reads the same two words off the same record. Sorted by how far along
     the work is (earliest stage first, so what is waiting on somebody leads), then by brief-by.
     No staleness window: a brief raised two months ago is not a wrong date, it is work. ---- */
  var STAGE_ORDER=['intake','briefed','progress','blocked','running','analysis','done','confirmed'];
  function briefedList(store,briefs,opts){
    opts=opts||{};
    var only=opts.clients&&opts.clients.length?opts.clients:null;
    var rows=[];
    Object.keys(store||{}).forEach(function(brand){
      if(brand.charAt(0)==='_')return;
      if(only&&only.indexOf(brand)<0)return;
      var E=evsOf(store,brand); if(!E.length)return;
      var tie=tieBuild(E,briefs,brand,opts.mkt);
      E.forEach(function(e){
        var hit=tie.map[e.id]; if(!hit||!hit.b)return;
        // a brief carries its stage on b.status (b.st is the legacy name the calendar's own
        // stOf still falls back to) — reading b.stage badged every row "undefined" once before
        var b=hit.b, st=String(b.status||b.st||'intake');
        var ord=STAGE_ORDER.indexOf(st);
        rows.push({ client:brand, id:e.id, name:e.name, mkt:evMkt(e,opts.mkt||'gb'),
          live:e.date, liveLbl:dLbl(e), briefBy:schedDate(e).toISOString().slice(0,10), briefLbl:bLbl(e),
          ticket:b.id, task:b.task||'', by:b.by||'', how:hit.how,
          due:dueIso(b), dueLbl:dueLbl(dueIso(b)),   // what the AM set; '' when the ticket carries none
          stage:st, court:COURT[st]||'', order:ord<0?STAGE_ORDER.length:ord,
          done:st==='done'||st==='confirmed', terms:(e.terms||[]).slice() });
      });
    });
    rows.sort(function(a,b){ return a.order-b.order
      || String(a.briefBy).localeCompare(String(b.briefBy))
      || String(a.client).localeCompare(String(b.client)); });
    return rows;
  }

  return { LEAD_DAYS:LEAD_DAYS, STALE_DAYS:STALE_DAYS, MON:MON, fmt:fmt, normTask:normTask,
    schedDate:schedDate, dLbl:dLbl, bLbl:bLbl,
    evsOf:evsOf, ptidxFor:ptidxFor, evMkt:evMkt, ptsOf:ptsOf, txOf:txOf, cndOf:cndOf,
    condChains:condChains, condChainOf:condChainOf,
    hasScope:hasScope, volOf:volOf, kwHours:kwHours, kwTask:kwTask, briefPayload:briefPayload,
    taskWords:taskWords, sigWords:sigWords, nameScore:nameScore, isKwTicket:isKwTicket,
    tieBuild:tieBuild, dueList:dueList, briefedList:briefedList, dueIso:dueIso, dueLbl:dueLbl,
    COURT:COURT, STAGE_ORDER:STAGE_ORDER };
}));
