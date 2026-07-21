/**
 * FeedSpark Deck Worker
 * Serves an HTML strategy deck with live-edit persistence via KV.
 *
 * Routes:
 *   GET  /                → serve the deck HTML (template + edits merged client-side)
 *   GET  /api/edits       → return all saved edits as JSON
 *   PUT  /api/edits       → save an edit patch (merges with existing)
 *   DELETE /api/edits     → clear all saved edits
 *   GET  /api/template    → return raw template version info
 *   PUT  /api/template    → update the template HTML (for Claude to push new versions)
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

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ---- API: edits ----
    if (path === '/api/edits') {
      if (request.method === 'GET') {
        const edits = await env.EDITS.get('current_edits', 'json');
        return json(edits || {});
      }

      if (request.method === 'PUT') {
        const incoming = await request.json();
        const existing = (await env.EDITS.get('current_edits', 'json')) || {};
        // Merge: incoming overwrites per-eid
        const merged = { ...existing, ...incoming };
        await env.EDITS.put('current_edits', JSON.stringify(merged));
        return json({ ok: true, count: Object.keys(merged).length });
      }

      if (request.method === 'DELETE') {
        await env.EDITS.delete('current_edits');
        return json({ ok: true, cleared: true });
      }
    }

    // ---- API: template ----
    if (path === '/api/template') {
      if (request.method === 'GET') {
        const ver = await env.EDITS.get('template_version');
        return json({ version: ver || 'none' });
      }

      if (request.method === 'PUT') {
        const body = await request.text();
        await env.EDITS.put('template_html', body);
        await env.EDITS.put('template_version', new Date().toISOString());
        return json({ ok: true, version: new Date().toISOString() });
      }
    }

    // ---- Serve the deck ----
    if (path === '/' || path === '/index.html') {
      // Try KV-stored template first, fall back to embedded
      let html = await env.EDITS.get('template_html');
      if (!html) {
        html = FALLBACK_HTML;
      }

      // Inject the live-sync script before </body>
      const syncScript = getSyncScript();
      html = html.replace('</body>', syncScript + '\n</body>');

      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=utf-8', ...CORS },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function getSyncScript() {
  return `
<script>
(function(){
  /* ---- Live sync layer ---- */
  var SYNC_INTERVAL = 5000; // auto-save every 5s if dirty
  var dirty = false;
  var syncing = false;

  /* Load saved edits on page load */
  fetch('/api/edits').then(function(r){ return r.json(); }).then(function(edits){
    if (!edits || Object.keys(edits).length === 0) return;
    Object.keys(edits).forEach(function(eid){
      var el = document.querySelector('[data-eid="'+eid+'"]');
      if (el) {
        var html = typeof edits[eid] === 'string' ? edits[eid] : edits[eid].html;
        if (html) el.innerHTML = html;
      }
    });
    console.log('[sync] Loaded ' + Object.keys(edits).length + ' saved edits');
  }).catch(function(e){ console.warn('[sync] Load failed:', e); });

  /* Mark dirty on any edit */
  document.addEventListener('input', function(e){
    if (e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
      dirty = true;
    }
  });

  /* Auto-save loop */
  setInterval(function(){
    if (!dirty || syncing) return;
    dirty = false;
    syncing = true;

    var patch = {};
    var els = document.querySelectorAll('[data-eid]');
    els.forEach(function(el){
      var eid = el.getAttribute('data-eid');
      patch[eid] = { html: el.innerHTML, preview: el.textContent.substring(0,80).replace(/\\s+/g,' ').trim() };
    });

    fetch('/api/edits', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    }).then(function(r){ return r.json(); }).then(function(d){
      syncing = false;
      var msg = document.getElementById('savedMsg');
      if (msg) { msg.textContent = '✓ Synced'; msg.classList.add('show'); setTimeout(function(){ msg.classList.remove('show'); }, 1500); }
      console.log('[sync] Saved ' + d.count + ' edits to KV');
    }).catch(function(e){ syncing = false; console.warn('[sync] Save failed:', e); });
  }, SYNC_INTERVAL);

})();
</script>`;
}

const FALLBACK_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>FeedSpark Deck</title></head><body><h1>No template uploaded yet</h1><p>Push the HTML template via <code>PUT /api/template</code></p></body></html>';
