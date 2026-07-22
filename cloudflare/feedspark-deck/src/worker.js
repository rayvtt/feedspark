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
import ROADMAP from "../../../docs/FeedSpark_Roadmap.html";
import READINESS from "../../../docs/FeedSpark_Readiness.html";
import LEADERSHIP from "../../../docs/FeedSpark_Leadership.html";
import DECKBUILDER from "../../../docs/FeedSpark_DeckBuilder.html";
import WORKFLOW from "../../../docs/FeedSpark_Workflow.html";
import DECK_TEMPLATE from "../../../docs/FeedSpark_Strategy_Review_Template.html";
// Tachyon copilot widget (style + script fragment). Injected on the app pages only —
// never on client-facing decks. Reads window.PLANTASKS and calls /api/claude.
import TACHYON from "../../../docs/tachyon_widget.html";

// path -> { html, slug }. slug namespaces each page's KV edit layer (KV key: edits:<slug>),
// so edits on the landing page and each deck never collide. Add a page = add a line here.
const PAGES = {
  '/':            { html: LANDING,     slug: 'home' },
  '/index.html':  { html: LANDING,     slug: 'home' },
  '/templates':   { html: TEMPLATES,   slug: 'templates' },
  '/library':     { html: TASKLIB,     slug: 'library' },
  '/roadmap':     { html: ROADMAP,     slug: 'roadmap' },
  '/readiness':   { html: READINESS,   slug: 'readiness' },
  '/leadership':  { html: LEADERSHIP,  slug: 'leadership' },
  '/deck-builder':{ html: DECKBUILDER, slug: 'deckbuilder' },
  '/workflow':    { html: WORKFLOW,    slug: 'workflow' },
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

    // ---- briefs store (Workflow control center: brief/ticket pipeline, shared across the team) ----
    // A single JSON object keyed by brief id: {id: {client, code, task, due, status, comms, ...}}.
    // The board owns its state and PUTs the whole map; small N, no races worth the complexity.
    if (path === '/api/briefs') {
      if (request.method === 'GET') {
        return json((await env.EDITS.get('briefs', 'json')) || {});
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('briefs', JSON.stringify(body));
        return json({ ok: true, count: Object.keys(body || {}).length });
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

    // ---- Tachyon copilot: server-side proxy to the Claude Messages API ----
    // The dashboard POSTs { system, messages | prompt, max_tokens } and the worker calls
    // Anthropic with env.ANTHROPIC_API_KEY — the key never reaches the browser. Degrades
    // gracefully (200 + setup message) when the secret isn't set, so the UI stays usable.
    //   Set the key:  wrangler secret put ANTHROPIC_API_KEY   (from the repo root)
    if (path === '/api/claude') {
      if (request.method === 'GET') {
        return json({ ok: true, configured: !!env.ANTHROPIC_API_KEY, model: 'claude-opus-4-8' });
      }
      if (request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) {
          return json({ error: 'no_key', message: 'Tachyon isn’t connected yet. Set an Anthropic API key as a Worker secret (wrangler secret put ANTHROPIC_API_KEY) and Tachyon goes live — no redeploy needed.' });
        }
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400); }
        const messages = Array.isArray(body.messages) && body.messages.length
          ? body.messages
          : [{ role: 'user', content: String(body.prompt || '') }];
        const payload = {
          model: body.model || 'claude-opus-4-8',
          max_tokens: Math.min(Math.max(parseInt(body.max_tokens, 10) || 1600, 256), 4096),
          messages,
        };
        if (body.system) payload.system = String(body.system);
        let r;
        try {
          r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          return json({ error: 'network', message: 'Could not reach the Claude API: ' + (e && e.message || e) });
        }
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          return json({ error: 'upstream', status: r.status, message: t.slice(0, 600) || ('HTTP ' + r.status) });
        }
        const data = await r.json().catch(() => ({}));
        const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
        return json({ text, usage: data.usage || null, model: payload.model });
      }
    }

    // ---- serve a git-bundled page + inject the editor widget for its slug ----
    // App pages (everything except client-facing /deck/* decks) also get the Tachyon copilot.
    const page = PAGES[path];
    if (page) {
      let html = page.html.replace('</body>', getEditorScript(page.slug) + '\n</body>');
      if (!path.startsWith('/deck/')) html = html.replace('</body>', TACHYON + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store, must-revalidate', ...CORS } });
    }

    // ---- dynamic client decks: any /deck/<slug> not in the static map above falls back to
    // the generic Strategy Review template, with its own KV edit namespace (edits:<slug>).
    // Lets the dossier's "Generate deck" button spin up a new client deck instantly — no git
    // commit needed until it's ready to be hand-crafted into its own page like YuMOVE's.
    const dynDeck = path.match(/^\/deck\/([a-z0-9-]+)$/);
    if (dynDeck) {
      const html = DECK_TEMPLATE.replace('</body>', getEditorScript(dynDeck[1]) + '\n</body>');
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
  var DESIGN_SEL='.card,.stat,.pipe-card,.proto,.flow-step,.en-card,.tier,.mo,.sc-cell,.ask,.callout,.note,.ag-row';
  var blockN=0, groupN=0, groupIds=new WeakMap(), rowN={};

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
    + '.tbl-wrap tbody tr.de-dragging{opacity:.35}'
    + 'body.de-design [data-de-block]{outline:1px dashed rgba(26,54,93,.35);outline-offset:2px;cursor:grab}'
    + 'body.de-design [data-de-block]:hover{outline:2px solid rgba(26,54,93,.6)}'
    + 'body.de-design [data-de-block].de-bsel{outline:2px solid #ED6F0B;cursor:default}'
    + 'body.de-design [data-de-block].de-bdrag{opacity:.35}'
    + '.de-toolbar{position:absolute;z-index:99998;display:flex;gap:4px;background:#1A365D;border-radius:8px;padding:5px;box-shadow:0 6px 20px rgba(0,0,0,.25)}'
    + '.de-toolbar button{background:transparent;border:0;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1}'
    + '.de-toolbar button:hover{background:rgba(255,255,255,.18)}'
    + '.de-resize{position:absolute;z-index:99998;width:14px;height:14px;background:#ED6F0B;border:2px solid #fff;border-radius:50%;cursor:nwse-resize}'
    + '.de-pop{position:absolute;z-index:99999;background:#fff;border:1px solid #E6E6E6;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:12px;display:flex;flex-direction:column;gap:8px;font:13px sans-serif;color:#333;min-width:190px}'
    + '.de-pop label{font-size:11px;color:#6b7a8d;display:flex;justify-content:space-between;align-items:center;gap:8px}'
    + '.de-pop select,.de-pop input[type=number]{font:inherit;padding:4px;border:1px solid #E6E6E6;border-radius:6px}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var bar=document.createElement('div'); bar.className='de-bar';
  var bEdit=document.createElement('button'); bEdit.textContent='✎ Edit';
  var bDesign=document.createElement('button'); bDesign.textContent='🎨 Design';
  var bPick=document.createElement('button'); bPick.textContent='◎ Element'; bPick.style.display='none';
  var bExport=document.createElement('button'); bExport.textContent='⤴ Export edits'; bExport.style.display='none';
  var stat=document.createElement('span'); stat.textContent='';
  bar.appendChild(bEdit); bar.appendChild(bDesign); bar.appendChild(bPick); bar.appendChild(bExport); bar.appendChild(stat);
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
    if(!ed) return;
    // Pass 1: replay any runtime-added blocks (duplicated in Design mode) before content/order
    // overlays run, so they exist in the DOM for those passes to find by data-eid/data-rid.
    Object.keys(ed).forEach(function(k){
      if(k.indexOf('__added:')!==0) return;
      var parent=document.querySelector('[data-tid="'+k.slice(8)+'"]'); if(!parent) return;
      (ed[k]||[]).forEach(function(a){
        if(document.querySelector('[data-eid="'+a.id+'"]')) return; // already present
        var tmp=document.createElement('div'); tmp.innerHTML=a.html; var node=tmp.firstElementChild; if(!node) return;
        var after=a.after?parent.querySelector('[data-rid="'+a.after+'"]'):null;
        if(after&&after.nextSibling) parent.insertBefore(node,after.nextSibling); else parent.appendChild(node);
      });
    });
    Object.keys(ed).forEach(function(k){
      if(k.indexOf('__order:')===0){
        var container=document.querySelector('[data-tid="'+k.slice(8)+'"]'); if(!container) return;
        var scope=container.tagName==='TABLE'?container.querySelector('tbody'):container; if(!scope) return;
        ed[k].forEach(function(rid){ var el=scope.querySelector('[data-rid="'+rid+'"]'); if(el) scope.appendChild(el); });
        return;
      }
      if(k.indexOf('__added:')===0) return;
      var el=document.querySelector('[data-eid="'+k+'"]'); if(!el) return;
      var v=ed[k];
      if(v && typeof v==='object' && v.deleted){ el.remove(); return; }
      var h=(typeof v==='string')?v:v.html; if(h!=null) el.innerHTML=h;
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
  // Style-only save (resize/recolour/refont) — deliberately omits the html field so it can
  // never clobber a separate, later text edit to the same element's children on load.
  function queueStyleSave(el){ var id=el.getAttribute('data-eid'); if(!id) return;
    dirty[id]=Object.assign({},dirty[id]||{},{style:el.getAttribute('style')||''});
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,600); }

  // ---- Design mode: select / move / resize / recolour / refont / duplicate / delete
  // any card-like block. Text mode (above) edits words; this edits the box around them.
  function assignBlockIds(){
    document.querySelectorAll(DESIGN_SEL).forEach(function(el){
      if(el.closest('.de-bar,.de-panel,.de-pop,.de-toolbar')) return;
      if(!el.getAttribute('data-eid')) el.setAttribute('data-eid','b'+(blockN++));
      el.setAttribute('data-de-block','1');
      var parent=el.parentElement; if(!parent) return;
      var tid=groupIds.get(parent);
      if(!tid){ tid='g'+(groupN++); groupIds.set(parent,tid); parent.setAttribute('data-tid',tid); }
      if(!el.getAttribute('data-rid')) el.setAttribute('data-rid', tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1));
    });
  }
  function blockAfter(container,y){
    var kids=Array.prototype.slice.call(container.children).filter(function(c){ return !c.classList.contains('de-bdrag'); });
    var closest=null, closestOffset=-Infinity;
    kids.forEach(function(c){ var box=c.getBoundingClientRect(); var offset=y-box.top-box.height/2;
      if(offset<0 && offset>closestOffset){ closestOffset=offset; closest=c; } });
    return closest;
  }
  function saveContainerOrder(container,tid){
    var order=Array.prototype.slice.call(container.children).filter(function(c){ return c.getAttribute('data-rid'); })
      .map(function(c){ return c.getAttribute('data-rid'); });
    var patch={}; patch['__order:'+tid]=order;
    fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)}).catch(function(){});
  }
  function initBlockDrag(){
    document.querySelectorAll('[data-de-block]').forEach(function(el){
      if(el.__deWired) return; el.__deWired=true;
      el.addEventListener('mousedown',function(e){
        if(!document.body.classList.contains('de-design')) return;
        if(e.target.closest('.de-resize,.de-toolbar,.de-pop')) return;
        el.setAttribute('draggable','true');
      });
      el.addEventListener('dragstart',function(e){
        if(!document.body.classList.contains('de-design')){ e.preventDefault(); return; }
        el.classList.add('de-bdrag'); e.dataTransfer.effectAllowed='move';
        try{ e.dataTransfer.setData('text/plain', el.getAttribute('data-rid')||''); }catch(er){}
      });
      el.addEventListener('dragend',function(){
        el.classList.remove('de-bdrag'); el.removeAttribute('draggable');
        var parent=el.parentElement, tid=parent&&parent.getAttribute('data-tid');
        if(tid) saveContainerOrder(parent,tid);
        if(selEl===el) positionOverlay(el);
      });
    });
    document.querySelectorAll('[data-tid]').forEach(function(container){
      if(container.__deSortWired) return; container.__deSortWired=true;
      container.addEventListener('dragover',function(e){
        var dragging=container.querySelector('.de-bdrag'); if(!dragging) return;
        e.preventDefault();
        var after=blockAfter(container,e.clientY);
        if(after==null) container.appendChild(dragging); else if(after!==dragging) container.insertBefore(dragging,after);
      });
    });
  }

  var selEl=null, toolbar=null, resizeHandle=null;
  function closeAllPops(){ document.querySelectorAll('.de-pop').forEach(function(p){ p.remove(); }); }
  function positionOverlay(el){
    var r=el.getBoundingClientRect();
    if(toolbar){ toolbar.style.top=(r.top+window.scrollY-38)+'px'; toolbar.style.left=(r.left+window.scrollX)+'px'; }
    if(resizeHandle){ resizeHandle.style.top=(r.top+window.scrollY+r.height-7)+'px'; resizeHandle.style.left=(r.left+window.scrollX+r.width-7)+'px'; }
  }
  function clearSelection(){
    if(selEl) selEl.classList.remove('de-bsel');
    if(toolbar){ toolbar.remove(); toolbar=null; }
    if(resizeHandle){ resizeHandle.remove(); resizeHandle=null; }
    closeAllPops(); selEl=null;
  }
  function rgbToHex(rgb){ var m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb||''); if(!m) return '#ffffff';
    return '#'+[1,2,3].map(function(i){ return ('0'+parseInt(m[i],10).toString(16)).slice(-2); }).join(''); }
  function openColorPop(el,anchor){
    closeAllPops();
    var pop=document.createElement('div'); pop.className='de-pop';
    var cs=getComputedStyle(el);
    pop.innerHTML='<label>Background <input type="color" class="de-bg" value="'+rgbToHex(cs.backgroundColor)+'"></label>'
      + '<label>Text <input type="color" class="de-fg" value="'+rgbToHex(cs.color)+'"></label>';
    document.body.appendChild(pop);
    var r=anchor.getBoundingClientRect(); pop.style.top=(r.bottom+window.scrollY+6)+'px'; pop.style.left=(r.left+window.scrollX)+'px';
    pop.querySelector('.de-bg').addEventListener('input',function(){ el.style.background=this.value; });
    pop.querySelector('.de-fg').addEventListener('input',function(){ el.style.color=this.value; });
    pop.addEventListener('change',function(){ queueStyleSave(el); });
  }
  var FONTS=['Lato, sans-serif','Georgia, serif','Arial, sans-serif','\'Courier New\', monospace','\'Times New Roman\', serif','Verdana, sans-serif'];
  function openFontPop(el,anchor){
    closeAllPops();
    var pop=document.createElement('div'); pop.className='de-pop';
    var cs=getComputedStyle(el);
    var opts=FONTS.map(function(f){ return '<option value="'+f.replace(/"/g,'&quot;')+'">'+f.split(',')[0].replace(/'/g,'')+'</option>'; }).join('');
    pop.innerHTML='<label>Font <select class="de-ff">'+opts+'</select></label>'
      + '<label>Size (px) <input type="number" class="de-fs" min="8" max="96" value="'+(parseInt(cs.fontSize,10)||14)+'"></label>'
      + '<label>Weight <select class="de-fw"><option value="400">Regular</option><option value="700">Bold</option><option value="900">Black</option></select></label>';
    document.body.appendChild(pop);
    var r=anchor.getBoundingClientRect(); pop.style.top=(r.bottom+window.scrollY+6)+'px'; pop.style.left=(r.left+window.scrollX)+'px';
    pop.querySelector('.de-ff').addEventListener('change',function(){ el.style.fontFamily=this.value; queueStyleSave(el); });
    pop.querySelector('.de-fs').addEventListener('input',function(){ el.style.fontSize=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    pop.querySelector('.de-fw').addEventListener('change',function(){ el.style.fontWeight=this.value; queueStyleSave(el); });
  }
  function wireResize(el,handle){
    handle.addEventListener('mousedown',function(e){
      e.preventDefault(); e.stopPropagation();
      var startX=e.clientX, startY=e.clientY, box=el.getBoundingClientRect(), startW=box.width, startH=box.height;
      function onMove(ev){
        el.style.width=Math.max(80,startW+(ev.clientX-startX))+'px';
        el.style.height=Math.max(40,startH+(ev.clientY-startY))+'px';
        positionOverlay(el);
      }
      function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); queueStyleSave(el); }
      document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    });
  }
  function deleteBlock(el){
    if(!confirm('Delete this block? This removes it for everyone viewing this deck.')) return;
    var eid=el.getAttribute('data-eid'); clearSelection(); delete dirty[eid]; el.remove();
    var patch={}; patch[eid]={deleted:true};
    fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)})
      .then(function(){ toast('Block deleted'); }).catch(function(){ toast('Delete failed to save'); });
  }
  function duplicateBlock(el){
    var clone=el.cloneNode(true);
    var newId='b'+(blockN++)+'-'+Math.random().toString(36).slice(2,7);
    clone.setAttribute('data-eid',newId); clone.classList.remove('de-bsel');
    var parent=el.parentElement, tid=parent.getAttribute('data-tid')||'';
    var newRid=tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1);
    clone.setAttribute('data-rid',newRid);
    var afterRid=el.getAttribute('data-rid')||null;
    parent.insertBefore(clone, el.nextSibling);
    initBlockDrag();
    fetch(API+'/api/edits?page='+PAGE).then(function(r){ return r.json(); }).then(function(ed){
      ed=ed||{}; var key='__added:'+tid; var list=(ed[key]||[]).slice();
      list.push({id:newId, after:afterRid, html:clone.outerHTML});
      var patch={}; patch[key]=list;
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ saveContainerOrder(parent,tid); toast('Block duplicated'); selectBlock(clone); })
      .catch(function(){ toast('Duplicate failed to save'); });
  }
  function selectBlock(el){
    if(selEl===el) return;
    clearSelection(); selEl=el; el.classList.add('de-bsel');
    toolbar=document.createElement('div'); toolbar.className='de-toolbar';
    toolbar.innerHTML='<button data-a="color" title="Colour">🎨</button><button data-a="font" title="Font">Aa</button>'
      + '<button data-a="dup" title="Duplicate">⧉</button><button data-a="del" title="Delete">🗑</button>';
    document.body.appendChild(toolbar);
    resizeHandle=document.createElement('div'); resizeHandle.className='de-resize'; document.body.appendChild(resizeHandle);
    positionOverlay(el);
    toolbar.addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return; var a=b.getAttribute('data-a');
      if(a==='color') openColorPop(el,b); else if(a==='font') openFontPop(el,b);
      else if(a==='dup') duplicateBlock(el); else if(a==='del') deleteBlock(el);
    });
    wireResize(el,resizeHandle);
  }
  document.addEventListener('click',function(e){
    if(!document.body.classList.contains('de-design')) return;
    if(e.target.closest('.de-toolbar,.de-pop,.de-resize,.de-bar,.de-panel')) return;
    var el=e.target.closest('[data-de-block]');
    if(el) selectBlock(el); else clearSelection();
  }, true);
  window.addEventListener('scroll',function(){ if(selEl) positionOverlay(selEl); },true);
  window.addEventListener('resize',function(){ if(selEl) positionOverlay(selEl); });
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
  bDesign.addEventListener('click',function(){
    var on=!document.body.classList.contains('de-design');
    document.body.classList.toggle('de-design',on); bDesign.classList.toggle('on',on);
    if(!on) clearSelection();
  });
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

  // Ids must exist for EVERY viewer at load time, not just whoever clicks Edit/Design first —
  // otherwise a saved KV patch has nothing to attach to and silently fails to apply for anyone
  // who opens the link read-only (e.g. a client on the call).
  assignEids();
  assignBlockIds();
  initRowDrag();
  initBlockDrag();
  loadEdits();
})();
</script>`;
}
