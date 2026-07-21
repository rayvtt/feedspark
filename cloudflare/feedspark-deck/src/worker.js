/**
 * FeedSpark Command Center Worker
 * Serves the command center + strategy decks with parallel live editing — no paid API, no cost:
 *   - Ray edits copy in-browser (contenteditable) -> auto-saved to KV by data-eid (per page)
 *   - Claude Code (the chat interface) makes structural/visual edits to the page templates
 *     in git and pushes to main; Cloudflare rebuilds and the new pages are bundled in.
 *     Ray's KV edits persist and re-overlay on top.
 *   - The editor's "Copy for Claude Code" button hands Claude the exact element to change
 *
 * The two layers never collide: template = git (bundled at build time), content = KV / Ray.
 *
 * Routes:
 *   GET  /                 -> command center landing page (+ injected editor widget)
 *   GET  /deck/yumove      -> YuMOVE strategy deck (+ injected editor widget)
 *   GET  /api/edits?page=  -> a page's saved edits as JSON (keyed by data-eid)
 *   PUT  /api/edits?page=  -> merge an edit patch for a page
 *   DELETE /api/edits?page=-> clear a page's saved edits
 *   GET  /api/template     -> info: pages are git-bundled (push to main to change them)
 *
 * Gate the whole worker behind Cloudflare Access — the deck holds confidential
 * commercial data.
 */

// Pages are bundled from git at build time as Text modules. Editing structure/layout means
// editing the .html in git and pushing to main; Cloudflare rebuilds and redeploys.
// (wrangler.toml declares rules = [{ type = "Text", globs = ["**/*.html"] }].)
import LANDING from "../../../docs/FeedSpark_Command_Center.html";
import DECK_YUMOVE from "../../../docs/YuMOVE_Strategy_Review_Jul26.html";
import TEMPLATES from "../../../docs/FeedSpark_Templates.html";
import TASKLIB from "../../../docs/FeedSpark_Task_Library.html";

// path -> { html, slug }. slug namespaces each page's KV edit layer (KV key: edits:<slug>),
// so edits on the landing page and each deck never collide. Add a page = add a line here.
const PAGES = {
  '/':            { html: LANDING,     slug: 'home' },
  '/index.html':  { html: LANDING,     slug: 'home' },
  '/templates':   { html: TEMPLATES,   slug: 'templates' },
  '/library':     { html: TASKLIB,     slug: 'library' },
  '/deck/yumove': { html: DECK_YUMOVE, slug: 'yumove' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ---- edits (content layer: Ray, in-browser) — namespaced per page by ?page=<slug> ----
    if (path === '/api/edits') {
      const slug = (url.searchParams.get('page') || 'home').replace(/[^a-z0-9_-]/gi, '');
      const key = 'edits:' + slug;
      if (request.method === 'GET') {
        const edits = await env.EDITS.get(key, 'json');
        return json(edits || {});
      }
      if (request.method === 'PUT') {
        const incoming = await request.json();
        const existing = (await env.EDITS.get(key, 'json')) || {};
        const merged = { ...existing, ...incoming };
        await env.EDITS.put(key, JSON.stringify(merged));
        return json({ ok: true, page: slug, count: Object.keys(merged).length });
      }
      if (request.method === 'DELETE') {
        await env.EDITS.delete(key);
        return json({ ok: true, page: slug, cleared: true });
      }
    }

    // ---- client store (dossier data layer: add / delete / link-sheet / edit-text persist here) ----
    // A single JSON object: per-brand overrides/additions to the git profiles, plus a _deleted list.
    if (path === '/api/clients') {
      if (request.method === 'GET') {
        const store = await env.EDITS.get('clients', 'json');
        return json(store || {});
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('clients', JSON.stringify(body));
        return json({ ok: true, count: Object.keys(body).length });
      }
    }

    // ---- template info (structure layer: bundled from git, not KV) ----
    // To change structure/layout, edit the page's .html in git and push to main — Cloudflare
    // rebuilds and the new page is bundled in. No PUT on purpose: git is the source of truth.
    if (path === '/api/template' && request.method === 'GET') {
      return json({ source: 'git', pages: Object.keys(PAGES), note: 'pages are git-bundled at build time; push to main to update them' });
    }

    // ---- serve a git-bundled page + inject the editor widget for its slug ----
    const page = PAGES[path];
    if (page) {
      const html = page.html.replace('</body>', getEditorScript(page.slug) + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store, must-revalidate', ...CORS } });
    }

    return new Response('Not found', { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// Injected before </body>. Self-contained editor:
//   - Edit mode: contenteditable text with stable data-eid keys, auto-saved to KV.
//   - Selected-element inspector: "Copy for Claude Code" copies the element's data-eid
//     + outerHTML so Ray can paste it here and ask Claude Code to restructure it.
//   - "Export edits": copies the full KV patch as JSON (for the git / apply_edits.py flow).
// Written with literal unicode chars and no backslash escapes so it stays valid inside
// this template literal.
function getEditorScript(slug) {
  return `
<script>
(function(){
  var API = window.DECK_EDITOR_API || '';
  var PAGE = ${JSON.stringify(slug)};
  var SEL = window.DECK_EDITOR_SELECTOR ||
    'h1,h2,h3,h4,h5,p,li,td,th,blockquote,figcaption,.lede,.sec-sub,.stat,.callout,.card h4,.card p,.note,.pill,.q';
  var editing=false, lastSel=null, dirty={}, saveTimer=null;

  var css = 'body.de-on [data-eid]{outline:1px dashed rgba(237,111,11,.55);outline-offset:2px}'
    + 'body.de-on [data-eid]:focus{outline:2px solid #ED6F0B;outline-offset:2px}'
    + 'body.de-on [data-eid].de-pick{outline:2px solid #1A365D;outline-offset:2px}'
    + '.de-bar{position:fixed;right:16px;bottom:16px;z-index:99999;display:none;gap:8px;align-items:center;font:14px/1.2 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.de-bar.de-show{display:flex}'
    + '.de-bar button{background:#1A365D;color:#fff;border:0;border-radius:8px;padding:9px 13px;cursor:pointer;font:inherit}'
    + '.de-bar button.on{background:#ED6F0B}'
    + '.de-bar span{color:#6b7a8d;min-width:60px}'
    + '.de-panel{position:fixed;right:16px;bottom:66px;z-index:99999;width:380px;max-width:92vw;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:14px;display:none;font:14px/1.4 sans-serif;color:#333}'
    + '.de-panel.show{display:block}'
    + '.de-panel code{background:#F5F5F5;border-radius:4px;padding:1px 5px}'
    + '.de-panel .row{display:flex;gap:8px;margin-top:10px}'
    + '.de-panel .row button{flex:1;background:#ED6F0B;color:#fff;border:0;border-radius:8px;padding:9px 12px;cursor:pointer}'
    + '.de-panel .row button.alt{background:#1A365D}'
    + '.de-panel small{color:#6b7a8d}'
    + '.de-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;background:#1A365D;color:#fff;padding:9px 15px;border-radius:8px;z-index:99999;opacity:0;transition:opacity .25s;font:14px sans-serif}'
    + '.de-toast.show{opacity:1}'
    + '.tbl-wrap tbody tr>:first-child{cursor:grab}'
    + '.tbl-wrap tbody tr.de-dragging{opacity:.35}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var bar=document.createElement('div'); bar.className='de-bar';
  var bEdit=document.createElement('button'); bEdit.textContent='✎ Edit';
  var bPick=document.createElement('button'); bPick.textContent='◎ Element'; bPick.style.display='none';
  var bExport=document.createElement('button'); bExport.textContent='⤴ Export edits'; bExport.style.display='none';
  var stat=document.createElement('span'); stat.textContent='';
  bar.appendChild(bEdit); bar.appendChild(bPick); bar.appendChild(bExport); bar.appendChild(stat);
  document.body.appendChild(bar);

  // Presentation mode: the editor bar is hidden by default (clean for client screen-share)
  // and only appears once revealed — via ?edit in the URL or the Ctrl/Cmd+Shift+E shortcut.
  // The reveal choice is remembered per-browser so Ray doesn't have to re-toggle every load.
  var LS_KEY='de-bar-shown';
  function showBar(on){ bar.classList.toggle('de-show',on); try{ localStorage.setItem(LS_KEY, on?'1':'0'); }catch(e){} if(!on && editing) setEditing(false); }
  var wantsShown = /[?&]edit(=1)?(&|$)/.test(location.search);
  var remembered = null; try{ remembered = localStorage.getItem(LS_KEY); }catch(e){}
  showBar(wantsShown || remembered==='1');
  document.addEventListener('keydown',function(e){
    if(e.key.toLowerCase()==='e' && (e.ctrlKey||e.metaKey) && e.shiftKey){ e.preventDefault(); showBar(!bar.classList.contains('de-show')); } });

  var panel=document.createElement('div'); panel.className='de-panel';
  panel.innerHTML='<strong>Send an element to Claude Code</strong>'
    + '<div style="margin-top:6px"><small class="de-target">Click any element on the page to select it.</small></div>'
    + '<div class="row"><button class="de-copy">Copy for Claude Code</button><button class="alt de-copysel">Copy data-eid</button></div>'
    + '<div style="margin-top:10px"><small>Paste it into the Claude Code chat and say what to change (resize, recolour, add an image, restructure). Claude edits the template; your text edits stay put.</small></div>';
  document.body.appendChild(panel);
  var tgt=panel.querySelector('.de-target');

  function toast(m){ var t=document.createElement('div'); t.className='de-toast'; t.textContent=m; document.body.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },300); },2000); }
  function copy(text,msg){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){ toast(msg); }); }
    else { var a=document.createElement('textarea'); a.value=text; document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); toast(msg); }catch(e){} a.remove(); } }

  function editable(){ return Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(function(el){
    return !el.closest('.de-bar') && !el.closest('.de-panel') && el.textContent.trim().length>0; }); }

  // Deterministic by DOM order so KV keys line up across reloads and template pushes.
  function assignEids(){ var i=0; editable().forEach(function(el){ if(!el.getAttribute('data-eid')) el.setAttribute('data-eid','e'+i); i++; }); }

  function loadEdits(){ fetch(API+'/api/edits?page='+PAGE).then(function(r){ return r.json(); }).then(function(ed){
    if(!ed) return; Object.keys(ed).forEach(function(k){
      if(k.indexOf('__order:')===0){
        var table=document.querySelector('table[data-tid="'+k.slice(8)+'"]'); if(!table) return;
        var tb=table.querySelector('tbody'); if(!tb) return;
        ed[k].forEach(function(rid){ var tr=tb.querySelector('tr[data-rid="'+rid+'"]'); if(tr) tb.appendChild(tr); });
        return;
      }
      var el=document.querySelector('[data-eid="'+k+'"]'); if(!el) return;
      var v=ed[k]; var h=(typeof v==='string')?v:v.html; if(h!=null) el.innerHTML=h;
      if(v && typeof v==='object' && v.style!=null) el.style.cssText=v.style; }); }).catch(function(){}); }

  // ---- row drag-and-drop reordering — works even in presentation mode (bar hidden),
  // drag starts only from a row's first cell so text selection elsewhere is unaffected.
  function initRowDrag(){
    var tid=0;
    document.querySelectorAll('.tbl-wrap table').forEach(function(table){
      var tb=table.querySelector('tbody'); if(!tb) return;
      var tKey=table.getAttribute('data-tid'); if(!tKey){ tKey='t'+(tid++); table.setAttribute('data-tid',tKey); }
      var rid=0;
      Array.prototype.forEach.call(tb.children,function(tr){
        if(tr.tagName!=='TR') return;
        if(!tr.getAttribute('data-rid')) tr.setAttribute('data-rid',tKey+'-r'+(rid++));
        var handle=tr.children[0]; if(!handle) return;
        var arm=function(){ tr.setAttribute('draggable','true'); };
        var disarm=function(){ tr.removeAttribute('draggable'); };
        handle.addEventListener('mousedown',arm);
        handle.addEventListener('mouseup',disarm);
        tr.addEventListener('dragstart',function(e){ tr.classList.add('de-dragging'); e.dataTransfer.effectAllowed='move';
          try{ e.dataTransfer.setData('text/plain', tr.getAttribute('data-rid')); }catch(er){} });
        tr.addEventListener('dragend',function(){ tr.classList.remove('de-dragging'); disarm(); saveOrder(tb,tKey); });
      });
      tb.addEventListener('dragover',function(e){
        var dragging=tb.querySelector('.de-dragging'); if(!dragging) return;
        e.preventDefault();
        var after=rowAfter(tb,e.clientY);
        if(after==null) tb.appendChild(dragging); else if(after!==dragging) tb.insertBefore(dragging,after);
      });
    });
  }
  function rowAfter(tb,y){
    var rows=Array.prototype.slice.call(tb.querySelectorAll('tr:not(.de-dragging)'));
    var closest=null, closestOffset=-Infinity;
    rows.forEach(function(r){ var box=r.getBoundingClientRect(); var offset=y-box.top-box.height/2;
      if(offset<0 && offset>closestOffset){ closestOffset=offset; closest=r; } });
    return closest;
  }
  function saveOrder(tb,tKey){
    var order=Array.prototype.map.call(tb.querySelectorAll('tr'),function(tr){ return tr.getAttribute('data-rid'); });
    var patch={}; patch['__order:'+tKey]=order;
    fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)})
      .then(function(r){ return r.json(); }).then(function(){ toast('Row order saved'); }).catch(function(){ toast('Order save failed'); });
  }

  function entry(el){ return { html: el.innerHTML, style: el.getAttribute('style')||'', preview: el.textContent.trim().slice(0,80) }; }
  function queueSave(el){ var id=el.getAttribute('data-eid'); if(!id) return; dirty[id]=entry(el);
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,1200); }
  function flush(){ var keys=Object.keys(dirty); if(!keys.length) return; var patch=dirty; dirty={}; stat.textContent='saving…';
    fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)})
      .then(function(r){ return r.json(); }).then(function(){ stat.textContent='✓ saved'; setTimeout(function(){ stat.textContent=''; },1500); })
      .catch(function(){ stat.textContent='save failed'; }); }

  function setEditing(on){ editing=on; document.body.classList.toggle('de-on',on);
    bEdit.classList.toggle('on',on); bEdit.textContent=on?'✓ Editing':'✎ Edit';
    bPick.style.display=on?'':'none'; bExport.style.display=on?'':'none';
    if(!on){ panel.classList.remove('show'); if(lastSel) lastSel.classList.remove('de-pick'); }
    if(on) assignEids();
    editable().forEach(function(el){ if(on) el.setAttribute('contenteditable','true'); else el.removeAttribute('contenteditable'); }); }

  bEdit.addEventListener('click',function(){ setEditing(!editing); });
  bPick.addEventListener('click',function(){ panel.classList.toggle('show'); });

  document.addEventListener('input',function(e){ if(!editing) return; var el=e.target.closest?e.target.closest('[data-eid]'):null; if(el) queueSave(el); });
  document.addEventListener('click',function(e){ if(!editing) return; var el=e.target.closest?e.target.closest('[data-eid]'):null;
    if(el && !el.closest('.de-bar') && !el.closest('.de-panel')){
      if(lastSel) lastSel.classList.remove('de-pick'); lastSel=el; el.classList.add('de-pick');
      tgt.innerHTML='Selected <code>&lt;'+el.tagName.toLowerCase()+'&gt;</code> · <code>data-eid="'+el.getAttribute('data-eid')+'"</code> — '+el.textContent.trim().slice(0,40); } }, true);

  panel.querySelector('.de-copy').addEventListener('click',function(){ if(!lastSel){ toast('Click an element first'); return; }
    var eid=lastSel.getAttribute('data-eid');
    var msg='Please edit this element in the FeedSpark "'+PAGE+'" page template (data-eid="'+eid+'"):\\n\\n\`\`\`html\\n'+lastSel.outerHTML+'\\n\`\`\`\\n\\nChange: ';
    copy(msg,'Copied — paste into Claude Code and finish the sentence'); });
  panel.querySelector('.de-copysel').addEventListener('click',function(){ if(!lastSel){ toast('Click an element first'); return; }
    copy('data-eid="'+lastSel.getAttribute('data-eid')+'"','Copied data-eid'); });

  bExport.addEventListener('click',function(){ var patch={}; document.querySelectorAll('[data-eid]').forEach(function(el){ patch[el.getAttribute('data-eid')]=entry(el); });
    copy(JSON.stringify(patch,null,2), 'All edits copied as JSON'); });

  initRowDrag();
  loadEdits();
})();
</script>`;
}
