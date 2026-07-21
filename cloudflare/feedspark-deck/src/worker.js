/**
 * FeedSpark Deck Worker
 * Serves an HTML strategy deck with parallel live editing — no paid API, no cost:
 *   - Ray edits copy in-browser (contenteditable) -> auto-saved to KV by data-eid
 *   - Claude Code (the chat interface) makes structural/visual edits to the TEMPLATE
 *     and pushes it via PUT /api/template; Ray's KV edits persist and re-merge on top
 *   - The editor's "Copy for Claude Code" button hands Claude the exact element to change
 *
 * The two layers never collide: template = git / Claude Code, content = KV / Ray.
 *
 * Routes:
 *   GET  /                -> serve deck HTML (template + injected editor widget)
 *   GET  /api/edits       -> saved edits as JSON (keyed by data-eid)
 *   PUT  /api/edits       -> merge an edit patch
 *   DELETE /api/edits     -> clear saved edits
 *   GET  /api/template    -> template version info
 *   PUT  /api/template    -> replace the template HTML (Claude Code pushes new versions)
 *
 * Gate the whole worker behind Cloudflare Access — the deck holds confidential
 * commercial data.
 */

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

    // ---- edits (content layer: Ray, in-browser) ----
    if (path === '/api/edits') {
      if (request.method === 'GET') {
        const edits = await env.EDITS.get('current_edits', 'json');
        return json(edits || {});
      }
      if (request.method === 'PUT') {
        const incoming = await request.json();
        const existing = (await env.EDITS.get('current_edits', 'json')) || {};
        const merged = { ...existing, ...incoming };
        await env.EDITS.put('current_edits', JSON.stringify(merged));
        return json({ ok: true, count: Object.keys(merged).length });
      }
      if (request.method === 'DELETE') {
        await env.EDITS.delete('current_edits');
        return json({ ok: true, cleared: true });
      }
    }

    // ---- template (structure layer: Claude Code pushes new versions; KV edits re-merge) ----
    if (path === '/api/template') {
      if (request.method === 'GET') {
        const ver = await env.EDITS.get('template_version');
        return json({ version: ver || 'none' });
      }
      if (request.method === 'PUT') {
        const body = await request.text();
        const now = new Date().toISOString();
        await env.EDITS.put('template_html', body);
        await env.EDITS.put('template_version', now);
        return json({ ok: true, version: now });
      }
    }

    // ---- serve the deck ----
    if (path === '/' || path === '/index.html') {
      let html = (await env.EDITS.get('template_html')) || FALLBACK_HTML;
      html = html.replace('</body>', getEditorScript() + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS } });
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
function getEditorScript() {
  return `
<script>
(function(){
  var API = window.DECK_EDITOR_API || '';
  var SEL = window.DECK_EDITOR_SELECTOR ||
    'h1,h2,h3,h4,h5,p,li,td,th,blockquote,figcaption,.lede,.sec-sub,.stat,.callout,.card h4,.card p,.note,.pill,.q';
  var editing=false, lastSel=null, dirty={}, saveTimer=null;

  var css = 'body.de-on [data-eid]{outline:1px dashed rgba(237,111,11,.55);outline-offset:2px}'
    + 'body.de-on [data-eid]:focus{outline:2px solid #ED6F0B;outline-offset:2px}'
    + 'body.de-on [data-eid].de-pick{outline:2px solid #1A365D;outline-offset:2px}'
    + '.de-bar{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;gap:8px;align-items:center;font:14px/1.2 -apple-system,Segoe UI,Roboto,sans-serif}'
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
    + '.de-toast.show{opacity:1}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var bar=document.createElement('div'); bar.className='de-bar';
  var bEdit=document.createElement('button'); bEdit.textContent='✎ Edit';
  var bPick=document.createElement('button'); bPick.textContent='◎ Element'; bPick.style.display='none';
  var bExport=document.createElement('button'); bExport.textContent='⤴ Export edits'; bExport.style.display='none';
  var stat=document.createElement('span'); stat.textContent='';
  bar.appendChild(bEdit); bar.appendChild(bPick); bar.appendChild(bExport); bar.appendChild(stat);
  document.body.appendChild(bar);

  var panel=document.createElement('div'); panel.className='de-panel';
  panel.innerHTML='<strong>Send an element to Claude Code</strong>'
    + '<div style="margin-top:6px"><small class="de-target">Click any element in the deck to select it.</small></div>'
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

  function loadEdits(){ fetch(API+'/api/edits').then(function(r){ return r.json(); }).then(function(ed){
    if(!ed) return; Object.keys(ed).forEach(function(k){ var el=document.querySelector('[data-eid="'+k+'"]'); if(!el) return;
      var v=ed[k]; var h=(typeof v==='string')?v:v.html; if(h!=null) el.innerHTML=h;
      if(v && typeof v==='object' && v.style!=null) el.style.cssText=v.style; }); }).catch(function(){}); }

  function entry(el){ return { html: el.innerHTML, style: el.getAttribute('style')||'', preview: el.textContent.trim().slice(0,80) }; }
  function queueSave(el){ var id=el.getAttribute('data-eid'); if(!id) return; dirty[id]=entry(el);
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,1200); }
  function flush(){ var keys=Object.keys(dirty); if(!keys.length) return; var patch=dirty; dirty={}; stat.textContent='saving…';
    fetch(API+'/api/edits',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)})
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
    var msg='Please edit this element in the YuMOVE deck template (data-eid="'+eid+'"):\\n\\n\`\`\`html\\n'+lastSel.outerHTML+'\\n\`\`\`\\n\\nChange: ';
    copy(msg,'Copied — paste into Claude Code and finish the sentence'); });
  panel.querySelector('.de-copysel').addEventListener('click',function(){ if(!lastSel){ toast('Click an element first'); return; }
    copy('data-eid="'+lastSel.getAttribute('data-eid')+'"','Copied data-eid'); });

  bExport.addEventListener('click',function(){ var patch={}; document.querySelectorAll('[data-eid]').forEach(function(el){ patch[el.getAttribute('data-eid')]=entry(el); });
    copy(JSON.stringify(patch,null,2), 'All edits copied as JSON'); });

  loadEdits();
})();
</script>`;
}

const FALLBACK_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FeedSpark Deck</title></head>' +
  '<body><h1>No template uploaded yet</h1><p>Push one with <code>PUT /api/template</code>.</p></body></html>';
