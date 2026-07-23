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
import DECK_REISS from "../../../docs/Reiss_Strategy_Review_FY2526.html";
import DECK_SUPERDRY from "../../../docs/Superdry_Strategy_Review_AllTime.html";
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
  '/deck/reiss':  { html: DECK_REISS,  slug: 'reiss' },
  '/deck/superdry': { html: DECK_SUPERDRY, slug: 'superdry' },
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

    // ---- deploy version marker: confirm which git build is actually live (the deploy Action
    // stamps GIT_SHA / GIT_REF / BUILT_AT via `wrangler deploy --var`). Answers "is my push live?"
    // in one request instead of guessing whether CF is serving a stale build.
    if (path === '/api/version') {
      return json({ worker: 'feedspark', sha: env.GIT_SHA || 'dev', ref: env.GIT_REF || '', builtAt: env.BUILT_AT || '' });
    }

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

    // ---- feedback store (per-deck review notes, namespaced per page like /api/edits) ----
    // A JSON array of {id, target, label, note, ts} — the whole array is owned by the page's
    // feedback panel and PUT wholesale; small N (a review round's worth of notes), no races
    // worth the complexity.
    if (path === '/api/feedback') {
      const slug = (url.searchParams.get('page') || 'home').replace(/[^a-z0-9_-]/gi, '');
      const key = 'feedback:' + slug;
      if (request.method === 'GET') {
        return json((await env.EDITS.get(key, 'json')) || []);
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put(key, JSON.stringify(body));
        return json({ ok: true, page: slug, count: (body || []).length });
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

    // ---- test & experiment register (Workflow) — a single JSON array of test cards ----
    if (path === '/api/tests') {
      if (request.method === 'GET') return json((await env.EDITS.get('tests', 'json')) || []);
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('tests', JSON.stringify(body));
        return json({ ok: true, count: (body || []).length });
      }
    }

    // ---- ATRT carry-over status (Workflow) — { "Client|task": "status" } for the retired tracker ----
    if (path === '/api/carryover') {
      if (request.method === 'GET') return json((await env.EDITS.get('carryover', 'json')) || {});
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('carryover', JSON.stringify(body));
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

    // ---- Google connection status (Option A: service account + domain-wide delegation) ----
    if (path === '/api/google/status' && request.method === 'GET') {
      return json({ configured: !!env.GOOGLE_SA_JSON, impersonate: env.GOOGLE_IMPERSONATE || null });
    }

    // ---- Gmail intake: recent client task emails → Workflow "Incoming emails" stream ----
    // Reads (readonly) the impersonated mailbox via the service account. Degrades to
    // {connected:false, items:[]} until GOOGLE_SA_JSON + GOOGLE_IMPERSONATE are set.
    if (path === '/api/gmail/intake' && request.method === 'GET') {
      if (!env.GOOGLE_SA_JSON || !env.GOOGLE_IMPERSONATE) return json({ connected: false, items: [] });
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/gmail.readonly', true);
        const q = encodeURIComponent('newer_than:30d -in:sent -in:chats');
        const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=' + q, { headers: { Authorization: 'Bearer ' + token } });
        const list = await listRes.json();
        const ids = (list.messages || []).slice(0, 15).map(m => m.id);
        const items = [];
        for (const id of ids) {
          const mRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date', { headers: { Authorization: 'Bearer ' + token } });
          const m = await mRes.json();
          const h = {}; ((m.payload && m.payload.headers) || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
          items.push({ id, from: h.from || '', subject: h.subject || '(no subject)', date: h.date || '', snippet: (m.snippet || '').slice(0, 160) });
        }
        return json({ connected: true, items });
      } catch (e) {
        return json({ connected: false, error: String((e && e.message) || e), items: [] });
      }
    }

    // ---- Sheets read (no admin needed: share the sheet with the service-account email) ----
    // GET /api/sheets/read?id=<spreadsheetId>&range=<A1 range>. The SA acts as itself, so any
    // sheet shared with its client_email is reachable without domain-wide delegation.
    if (path === '/api/sheets/read' && request.method === 'GET') {
      if (!env.GOOGLE_SA_JSON) return json({ connected: false, error: 'no_sa', values: [] });
      const id = url.searchParams.get('id'); const range = url.searchParams.get('range') || 'A1:Z100';
      if (!id) return json({ error: 'missing id' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
        const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range), { headers: { Authorization: 'Bearer ' + token } });
        const d = await r.json();
        if (d.error) return json({ connected: true, error: d.error.message, values: [] });
        return json({ connected: true, range: d.range || range, values: d.values || [] });
      } catch (e) { return json({ connected: false, error: String((e && e.message) || e), values: [] }); }
    }

    // ---- 2-way status: write a task's status back into its Project-Plan tab ----
    // POST { id, tab?, match, value, statusCol? }. Reads the tab, finds the row whose
    // description matches `match`, detects the Status column from the header (or uses
    // statusCol), and writes `value` there. No delegation — the sheet is shared with the SA.
    if (path === '/api/sheets/status' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', match = String(body.match || '').trim(), value = body.value;
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json();
        if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const TOK = ['open', 'done', 'on hold', 'on-hold', 'onhold', 'in progress', 'in-progress', 'wip', 'with client', 'parked', 'completed', 'complete', 'live', 'not started', 'to do', 'todo', 'blocked'];
        const isTok = v => TOK.indexOf(norm(v)) >= 0;
        // find the row whose description matches the FCC task text
        const key = norm(match).slice(0, 45); let targetRow = -1;
        for (let r = 0; r < rows.length; r++) {
          if ((rows[r] || []).some(c => { const cn = norm(c); return cn.length > 8 && (cn.indexOf(key) >= 0 || (key.length > 12 && key.indexOf(cn.slice(0, 45)) >= 0)); })) { targetRow = r; break; }
        }
        if (targetRow < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        // Status column: header cell named "Status", re-aligned to the data (the header can sit
        // one column left of the values when there's a leading number column), then confirmed
        // against the actual target row — handles stacked sub-tables with their own layout.
        let statusCol = (typeof body.statusCol === 'number') ? body.statusCol : -1, headerRow = -1;
        if (statusCol < 0) {
          for (let r = 0; r < Math.min(rows.length, 25); r++) {
            const idx = (rows[r] || []).findIndex(c => /^(status|task status)$/i.test(String(c || '').trim()));
            if (idx >= 0) { statusCol = idx; headerRow = r; break; }
          }
          if (statusCol >= 0) {
            let a = 0, b = 0;
            for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 45); r++) { const row = rows[r] || []; if (isTok(row[statusCol])) a++; if (isTok(row[statusCol + 1])) b++; }
            if (b > a) statusCol += 1;
          }
        }
        let writeCol = statusCol; const trow = rows[targetRow] || [];
        if (writeCol < 0 || !isTok(trow[writeCol])) { for (let c = 1; c < Math.min(trow.length, 14); c++) { if (isTok(trow[c])) { writeCol = c; break; } } }
        if (writeCol < 0) return json({ ok: false, error: 'could not resolve the Status column — pass statusCol', row: targetRow + 1, matched: trow[1] || trow[0] || '' });
        const cell = tab + '!' + colLetter(writeCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ values: [[value]] }),
        });
        const wd = await wr.json();
        if (wd.error) return json({ ok: false, error: wd.error.message, cell });
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- live plan sync: read each brand's Project-Plan tab and return parsed tasks ----
    // POST { sheets: { "<Brand>": "<sheetId>", ... }, tab?, force? }. Caches per sheet in KV
    // (planlive:<id>, ~5 min TTL) so the dashboard reflects new plan rows with no git rebuild.
    // Also stashes the brand->sheet map (plansheets) so the cron can warm the cache.
    if (path === '/api/plan/live' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ connected: false, error: 'no_sa', brands: {} });
      let body; try { body = await request.json(); } catch (e) { return json({ connected: false, error: 'bad_json' }, 400); }
      const sheets = body.sheets || {}, tab = body.tab || 'Project Plan', force = !!body.force;
      try { await env.EDITS.put('plansheets', JSON.stringify(sheets)); } catch (e) {}
      const out = {};
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
        const seen = {};
        for (const brand of Object.keys(sheets)) {
          const id = sheets[brand]; if (!id) continue;
          if (seen[id]) { out[brand] = seen[id]; continue; }
          const ck = 'planlive:' + id;
          let cached = force ? null : await env.EDITS.get(ck, 'json');
          if (!cached) {
            const g = await fetchGrid(id, tab, token); // values + background colours (to skip filled separator rows)
            if (g.error) { out[brand] = { error: g.error, tasks: [] }; seen[id] = out[brand]; continue; }
            cached = { tasks: parsePlanRows(g.values, g.bg), updated: Date.now() };
            try { await env.EDITS.put(ck, JSON.stringify(cached), { expirationTtl: 300 }); } catch (e) {}
          }
          out[brand] = cached; seen[id] = cached;
        }
        return json({ connected: true, brands: out });
      } catch (e) { return json({ connected: false, error: String((e && e.message) || e), brands: out }); }
    }

    // ---- 2-way owner reassign: write an AE/owner back into the plan tab (workload heatmap) ----
    // POST { id, tab?, match, value }. Same row-match + uniform-offset resolution as status.
    if (path === '/api/sheets/owner' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', match = String(body.match || '').trim(), value = body.value;
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json(); if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const key = normCell(match).slice(0, 45); let targetRow = -1;
        for (let r = 0; r < rows.length; r++) { if ((rows[r] || []).some(cc => { const cn = normCell(cc); return cn.length > 8 && (cn.indexOf(key) >= 0 || (key.length > 12 && key.indexOf(cn.slice(0, 45)) >= 0)); })) { targetRow = r; break; } }
        if (targetRow < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        const c = resolveCols(rows);
        let writeCol = c.ownerCol;
        if (writeCol < 0) return json({ ok: false, error: 'could not resolve the Owner column' });
        const cell = tab + '!' + colLetter(writeCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
        const wd = await wr.json(); if (wd.error) return json({ ok: false, error: wd.error.message, cell });
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- 2-way due date: write a task's due date (DD/MM/YYYY) into the plan's Due column ----
    if (path === '/api/sheets/due' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', match = String(body.match || '').trim(), value = body.value;
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json(); if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const key = normCell(match).slice(0, 45); let targetRow = -1;
        for (let r = 0; r < rows.length; r++) { if ((rows[r] || []).some(cc => { const cn = normCell(cc); return cn.length > 8 && (cn.indexOf(key) >= 0 || (key.length > 12 && key.indexOf(cn.slice(0, 45)) >= 0)); })) { targetRow = r; break; } }
        if (targetRow < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        const c = resolveCols(rows);
        if (c.dueCol < 0) return json({ ok: false, error: 'no Due column in this plan — add a "Due Date" header' });
        const cell = tab + '!' + colLetter(c.dueCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
        const wd = await wr.json(); if (wd.error) return json({ ok: false, error: wd.error.message, cell });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- 2-way task text: rename a task in place (match old text -> write new text to the Task column) ----
    if (path === '/api/sheets/task' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', match = String(body.match || '').trim(), value = body.value;
      if (!id || !match || value == null || !String(value).trim()) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json(); if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const key = normCell(match).slice(0, 45); let targetRow = -1;
        for (let r = 0; r < rows.length; r++) { if ((rows[r] || []).some(cc => { const cn = normCell(cc); return cn.length > 8 && (cn.indexOf(key) >= 0 || (key.length > 12 && key.indexOf(cn.slice(0, 45)) >= 0)); })) { targetRow = r; break; } }
        if (targetRow < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        const c = resolveCols(rows);
        const tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
        const cell = tab + '!' + colLetter(tc) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
        const wd = await wr.json(); if (wd.error) return json({ ok: false, error: wd.error.message, cell });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- append new task rows into a plan tab (ATRT uniques -> project plan) ----
    // POST { id, tab?, rows:[{task, owner, status}] }. Resolves the tab's column layout
    // (same uniform-offset logic as the writers) and places each value in the right column.
    if (path === '/api/sheets/append' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', rows = body.rows || [];
      if (!id || !rows.length) return json({ ok: false, error: 'missing id / rows' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        let realTab = tab;
        let rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        let rd = await rr.json();
        if (rd.error) { // tab name varies — fall back to the first sheet
          rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent('A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
          rd = await rr.json(); realTab = '';
        }
        if (rd.error) return json({ ok: false, error: rd.error.message });
        const grid = rd.values || [];
        const c = resolveCols(grid);
        const tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
        const oc = c.ownerCol, sc = c.statusCol, dc = c.dueCol;
        const width = Math.max(tc, oc, sc, dc, 0) + 1;
        const values = rows.map(r => { const a = new Array(width).fill(''); a[tc] = r.task || ''; if (oc >= 0) a[oc] = r.owner || ''; if (sc >= 0) a[sc] = r.status || 'Open'; if (dc >= 0 && r.due) a[dc] = r.due; return a; });
        // find the LAST row that has any content and write directly below it — the values:append
        // API mis-detects the table on multi-block plan layouts and drops rows at the top.
        let lastRow = 0; for (let r = 0; r < grid.length; r++) { if ((grid[r] || []).some(x => String(x || '').trim() !== '')) lastRow = r; }
        const startRow = lastRow + 2; // 1-based row just after the last content row
        const range = (realTab ? realTab + '!' : '') + 'A' + startRow;
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
        const wd = await wr.json();
        if (wd.error) return json({ ok: false, error: wd.error.message });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, appended: values.length, tab: realTab || '(first sheet)', atRow: startRow,
          cols: { task: colLetter(tc), owner: oc >= 0 ? colLetter(oc) : null, status: sc >= 0 ? colLetter(sc) : null, due: dc >= 0 ? colLetter(dc) : null } });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- undo an ATRT->plan write: delete the rows whose task matches a written task ----
    // POST { id, tab?, tasks:[text,...] }. Safe: those tasks were unique (not in the plan)
    // before the write, so the only rows that match are the ones we added.
    if (path === '/api/sheets/unappend' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan';
      const tasks = (body.tasks || []).map(t => normCell(t)).filter(Boolean);
      if (!id || !tasks.length) return json({ ok: false, error: 'missing id / tasks' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        let realTab = tab;
        let rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:Z600'), { headers: { Authorization: 'Bearer ' + token } });
        let rd = await rr.json();
        if (rd.error) { rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent('A1:Z600'), { headers: { Authorization: 'Bearer ' + token } }); rd = await rr.json(); realTab = ''; }
        if (rd.error) return json({ ok: false, error: rd.error.message });
        const grid = rd.values || [], c = resolveCols(grid), tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
        const del = [];
        for (let r = 0; r < grid.length; r++) { const v = normCell((grid[r] || [])[tc]); if (v && tasks.indexOf(v) >= 0) del.push(r); }
        if (!del.length) return json({ ok: true, deleted: 0, note: 'no matching rows' });
        // resolve the tab's numeric sheetId for deleteDimension
        const meta = await (await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=sheets.properties(sheetId,title)', { headers: { Authorization: 'Bearer ' + token } })).json();
        const sheets = meta.sheets || [];
        const match = realTab && sheets.find(s => s.properties.title === realTab);
        const sheetId = (match ? match.properties.sheetId : (sheets[0] && sheets[0].properties.sheetId)) || 0;
        const reqs = del.sort((a, b) => b - a).map(r => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 } } }));
        const br = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + ':batchUpdate', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
        const bd = await br.json();
        if (bd.error) return json({ ok: false, error: bd.error.message });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, deleted: del.length });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
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

  // ---- cron: warm the live plan-sync cache so the dashboard is instant on open ----
  // Reads the brand->sheet map the dashboard last posted (KV `plansheets`) and re-parses
  // each Project-Plan tab into KV (planlive:<id>). Registered in wrangler.toml [triggers].
  async scheduled(event, env, ctx) {
    if (!env.GOOGLE_SA_JSON) return;
    try {
      const sheets = (await env.EDITS.get('plansheets', 'json')) || {};
      const ids = Array.from(new Set(Object.keys(sheets).map(b => sheets[b]).filter(Boolean)));
      if (!ids.length) return;
      const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
      for (const id of ids) {
        try {
          const g = await fetchGrid(id, 'Project Plan', token);
          if (g.error) continue;
          await env.EDITS.put('planlive:' + id, JSON.stringify({ tasks: parsePlanRows(g.values, g.bg), updated: Date.now() }), { expirationTtl: 5400 });
        } catch (e) {}
      }
    } catch (e) {}
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

// ---- Google service-account auth: sign a JWT with the SA private key, impersonate the
// GOOGLE_IMPERSONATE user (domain-wide delegation), exchange it for a scoped access token.
// All WebCrypto — no external deps. Throws if GOOGLE_SA_JSON isn't set / the grant fails.
function b64urlBuf(buf) {
  let s = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) { return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function colLetter(n) { let s = ''; n = n + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

// ---- shared Project-Plan parsing (used by live-sync + 2-way writes) ----
// Plan sheets vary: some carry a leading task-number column, so the header row sits one
// column left of its data. We anchor on the Status header, then VOTE header-col vs col+1 by
// how many rows carry a status token — that vote yields a single `offset` that applies to
// EVERY column (the whole data row is shifted uniformly), so owner/task columns realign too.
const STATUS_TOK = ['open', 'done', 'on hold', 'on-hold', 'onhold', 'in progress', 'in-progress', 'wip', 'with client', 'parked', 'completed', 'complete', 'live', 'not started', 'to do', 'todo', 'blocked', 'ongoing', 'in review'];
function normCell(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function isStatusTok(v) { return STATUS_TOK.indexOf(normCell(v)) >= 0; }
function planBucket(s) { s = normCell(s);
  if (/(done|complete|finish|live|delivered|actioned|signed)/.test(s)) return 'done';
  if (/(hold|park)/.test(s)) return 'hold';
  if (/(progress|wip|ongoing|review)/.test(s)) return 'progress';
  if (/client/.test(s)) return 'client';
  if (!s) return 'open'; return 'open'; }
function classifyCat(t) { t = String(t || '').toLowerCase();
  if (/\btitle|mask\b/.test(t)) return 'title';
  if (/image|visual|overlay|roundel|cycler|photo/.test(t)) return 'image';
  if (/keyword|search term|kw\b|intent/.test(t)) return 'keyword';
  if (/custom label|\bcl\d|clearance flag|bestseller/.test(t)) return 'custom_label';
  if (/product type|category mapping|taxonom|gpc/.test(t)) return 'product_type';
  if (/a\/b|test|experiment|split test/.test(t)) return 'test';
  if (/feed|technical|migration|refresh|item group|disapprov|rule/.test(t)) return 'technical';
  if (/data field|attribute|back fill|material|gtin/.test(t)) return 'data';
  if (/meta|social|shopping|lia|channel|ppc|dpa|bing/.test(t)) return 'channel';
  if (/call|review|proposal|quote|contract|onboard|invoice|billing|strategy|qbr|access/.test(t)) return 'account';
  return 'opt'; }
// Resolve the header row + the uniform data offset from the Status column.
function resolveCols(rows) {
  let headerRow = -1, statusHdr = -1;
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const idx = (rows[r] || []).findIndex(c => /^(status|task status)$/i.test(String(c || '').trim()));
    if (idx >= 0) { statusHdr = idx; headerRow = r; break; }
  }
  let offset = 0;
  if (statusHdr >= 0) { let a = 0, b = 0;
    for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 45); r++) { const row = rows[r] || []; if (isStatusTok(row[statusHdr])) a++; if (isStatusTok(row[statusHdr + 1])) b++; }
    if (b > a) offset = 1; }
  // header column for a name/regex, then shifted by the data offset
  const hdr = rows[headerRow] || [];
  const colFor = re => { const i = hdr.findIndex(c => re.test(String(c || '').trim())); return i < 0 ? -1 : i + offset; };
  return { headerRow, offset, statusCol: statusHdr < 0 ? -1 : statusHdr + offset,
    taskCol: colFor(/task|area|activit|description|optimis|action/i),
    ownerCol: colFor(/owner|\bae\b|assignee|responsib|fs\b/i),
    dueCol: colFor(/due|deadline|target date|completion date|^date$/i) };
}
// Parse a plan tab's rows into clean task objects for the dashboard.
function monthOf(s) { // detect a "month separator" label like "July-26", "Jun 2026", "Mar 26"
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*['\s\-\/,.]*((?:20)?\d{2})\b/i.exec(String(s || ''));
  if (!m) return '';
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
  let y = +m[2]; if (y < 100) y += 2000;
  return y + '-' + String(mo + 1).padStart(2, '0') + '-01';
}
// a non-white cell fill = a section separator (blue/grey header), NOT a task (Ray's rule)
function isFilled(rgb) { return !!rgb && Math.min(rgb[0], rgb[1], rgb[2]) < 0.93; }
// read a tab's values AND per-cell background colour (needed to tell separators from tasks)
async function fetchGrid(id, tab, token) {
  const fields = 'sheets(properties(title),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))';
  const tryRange = async range => (await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?ranges=' + encodeURIComponent(range) + '&includeGridData=true&fields=' + encodeURIComponent(fields), { headers: { Authorization: 'Bearer ' + token } })).json();
  let d = await tryRange((tab ? tab + '!' : '') + 'A1:Z600');
  if (d.error && tab) d = await tryRange('A1:Z600'); // tab name varies — fall back to the first sheet
  if (d.error) return { error: d.error.message };
  const sheet = (d.sheets || [])[0];
  const rowData = (sheet && sheet.data && sheet.data[0] && sheet.data[0].rowData) || [];
  const values = [], bg = [];
  for (const row of rowData) {
    const cells = row.values || [];
    values.push(cells.map(c => (c && c.formattedValue != null) ? String(c.formattedValue) : ''));
    bg.push(cells.map(c => { const b = c && c.effectiveFormat && c.effectiveFormat.backgroundColor; return b ? [b.red || 0, b.green || 0, b.blue || 0] : null; }));
  }
  return { values, bg, title: (sheet && sheet.properties && sheet.properties.title) || '' };
}
function parsePlanRows(values, bg) {
  const c = resolveCols(values), out = [];
  const start = c.headerRow >= 0 ? c.headerRow + 1 : 0;
  const tcol = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
  const haveBg = Array.isArray(bg) && bg.length > 0;
  let curMonth = ''; // ISO first-of-month of the current month section
  for (let r = start; r < values.length; r++) {
    const row = values[r] || [];
    let monthHere = ''; for (let k = 0; k < Math.min(row.length, 6); k++) { monthHere = monthOf(row[k]); if (monthHere) break; }
    // separator = a filled task cell (with formatting), else fall back to a month-labelled statusless row
    const isSep = haveBg ? isFilled(((bg[r]) || [])[tcol]) : (!!monthHere && !row.some(v => isStatusTok(v)));
    if (isSep) { if (monthHere) curMonth = monthHere; continue; }
    // task text: resolved column, else first long non-status/non-date cell
    let task = c.taskCol >= 0 ? row[c.taskCol] : '';
    if (!task || String(task).trim().length < 3) {
      for (let k = 0; k < Math.min(row.length, 4); k++) { const v = String(row[k] || '').trim();
        if (v.length > 6 && !isStatusTok(v) && !/^\d/.test(v)) { task = v; break; } }
    }
    task = String(task || '').trim(); if (task.length < 3) continue;
    let status = c.statusCol >= 0 ? String(row[c.statusCol] || '').trim() : '';
    if (!isStatusTok(status)) { for (let k = 1; k < Math.min(row.length, 14); k++) { if (isStatusTok(row[k])) { status = String(row[k]).trim(); break; } } }
    const owner = c.ownerCol >= 0 ? String(row[c.ownerCol] || '').trim() : '';
    const rawDue = c.dueCol >= 0 ? String(row[c.dueCol] || '').trim() : '';
    // date = the row's Due column if the plan has one, else the current month-section
    out.push({ t: task, o: owner, s: status, b: planBucket(status), c: classifyCat(task), d: rawDue || curMonth, row: r + 1 });
  }
  return out;
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
// impersonate=true adds a `sub` (needs domain-wide delegation — Gmail). Omit it for Sheets:
// the service account then acts as itself and can reach any sheet shared with its email —
// no admin / delegation required.
async function googleToken(env, scope, impersonate) {
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  if (impersonate && env.GOOGLE_IMPERSONATE) claim.sub = env.GOOGLE_IMPERSONATE;
  const unsigned = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlBuf(sig);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token ' + (data.error || res.status) + ' ' + (data.error_description || ''));
  return data.access_token;
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
  // Broad on purpose — Design mode should be able to target essentially every visible
  // element on a deck (headings, paragraphs, list items, images, chapter dividers, the
  // hero, tables, code blocks), not just a curated set of "card-like" containers. Table
  // rows/cells are deliberately left out of the drag-reorder side of this (they already
  // have their own dedicated row-drag system below) but are still selectable for styling
  // via the plain h1-h5/p/li/td/th text-element entries.
  var DESIGN_SEL='.card,.stat,.pipe-card,.proto,.flow-step,.en-card,.tier,.mo,.sc-cell,.ask,.callout,.note,.ag-row'
    + ',.chapter,header.hero,.pill,.ct,.q,.feedrow,.agent,.agent-l,.agent-r,.eyebrow,.lede,.sec-sub'
    + ',h1,h2,h3,h4,h5,p,li,blockquote,figcaption,img,table,code';
  var blockN={}, groupN={}, groupIds=new WeakMap(), rowN={};
  var FEEDBACK=[], fbN=0;
  function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ---- Undo: snapshot the whole saved-edits object before any mutating action, so Ctrl/Cmd+Z
  // can restore exactly what was there before — covers text edits, style changes, deletes,
  // duplicates and both reorder systems (they all ultimately live in one KV object per page,
  // so "undo" is just "restore the previous version of that object"), not a per-field diff
  // that would need separate logic for every action type.
  var UNDO_KEY='de-undo-'+PAGE, undoing=false;
  function loadUndoStack(){ try{ return JSON.parse(sessionStorage.getItem(UNDO_KEY)||'[]'); }catch(e){ return []; } }
  function saveUndoStack(st){ try{ sessionStorage.setItem(UNDO_KEY, JSON.stringify(st.slice(-20))); }catch(e){} }
  // Returns the pre-change state it captured, so a call site that needs to read-then-write
  // (duplicateBlock) can reuse it instead of fetching twice. Callers that only mutate via a
  // fresh PUT (saveOrder, deleteBlock, ...) just chain .then() and ignore the value.
  function armUndo(){
    if(undoing) return Promise.resolve(null);
    return fetch(API+'/api/edits?page='+PAGE).then(function(r){ return r.json(); }).then(function(cur){
      cur=cur||{}; var st=loadUndoStack(); st.push(cur); saveUndoStack(st); return cur;
    }).catch(function(){ return null; });
  }
  function performUndo(){
    var st=loadUndoStack();
    if(!st.length){ toast('Nothing to undo'); return; }
    var snap=st.pop(); saveUndoStack(st); undoing=true; toast('Undoing…');
    fetch(API+'/api/edits?page='+PAGE,{method:'DELETE'})
      .then(function(){ return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(snap)}); })
      .then(function(){ location.reload(); })
      .catch(function(){ undoing=false; toast('Undo failed — nothing was changed'); });
  }
  document.addEventListener('keydown',function(e){
    if(!((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z')) return;
    var ae=document.activeElement;
    var typing = ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName));
    if(typing) return; // let the browser's own per-field undo handle in-progress typing
    e.preventDefault(); performUndo();
  });

  var css = 'body.de-on [data-eid]{outline:1px dashed rgba(237,111,11,.55);outline-offset:2px}'
    + 'body.de-on [data-eid]:focus{outline:2px solid #ED6F0B;outline-offset:2px}'
    + 'body.de-on [data-eid].de-pick{outline:2px solid #1A365D;outline-offset:2px}'
    + '.de-bar{position:fixed;right:16px;bottom:16px;z-index:99999;display:none;gap:8px;align-items:center;font:14px/1.2 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.de-bar.de-show{display:flex}'
    + '.de-handle{position:fixed;right:16px;bottom:16px;z-index:99998;width:34px;height:34px;border-radius:50%;background:rgba(26,54,93,.35);color:#fff;border:0;cursor:pointer;font-size:15px;opacity:.55;transition:opacity .2s,background .2s}'
    + '.de-handle:hover{opacity:1;background:#1A365D}'
    + '.de-bar.de-show + .de-handle{display:none}'
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
    + '.de-resize{position:absolute;z-index:99998;width:14px;height:14px;background:#ED6F0B;border:2px solid #fff;border-radius:50%;cursor:nwse-resize}'
    + '.de-props{position:fixed;top:80px;right:16px;bottom:16px;z-index:99998;width:280px;max-width:88vw;overflow-y:auto;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.2);display:none;font:13px sans-serif;color:#333}'
    + '.de-props.show{display:block}'
    + '.de-props .ph{padding:12px 14px;border-bottom:1px solid #E6E6E6;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:1}'
    + '.de-props .ph .tag{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#ED6F0B;background:rgba(237,111,11,.1);padding:3px 8px;border-radius:20px;font-weight:800}'
    + '.de-props .pclose{cursor:pointer;color:#999;font-size:16px;background:none;border:0;line-height:1}'
    + '.de-props section{padding:12px 14px;border-bottom:1px solid #F0F0F0}'
    + '.de-props section h5{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7a8d;margin-bottom:8px;font-weight:800}'
    + '.de-props .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.de-props label{display:block;font-size:10.5px;color:#6b7a8d;margin-bottom:3px}'
    + '.de-props input[type=number],.de-props select{width:100%;font:inherit;padding:6px 8px;border:1px solid #E6E6E6;border-radius:6px;box-sizing:border-box}'
    + '.de-props input[type=color]{width:100%;height:30px;border:1px solid #E6E6E6;border-radius:6px;padding:2px;cursor:pointer;box-sizing:border-box}'
    + '.de-props input[type=range]{width:100%;margin-top:6px}'
    + '.de-props .btnrow{display:flex;gap:6px}'
    + '.de-props .btnrow button{flex:1;border:1px solid #E6E6E6;background:#fff;border-radius:6px;padding:7px;cursor:pointer;font:inherit}'
    + '.de-props .btnrow button.on{background:#1A365D;color:#fff;border-color:#1A365D}'
    + '.de-props .actions{padding:12px 14px;display:flex;gap:8px}'
    + '.de-props .actions button{flex:1;border:0;border-radius:8px;padding:9px;cursor:pointer;font:inherit;font-weight:700}'
    + '.de-props .actions .dup{background:#EEE;color:#333}.de-props .actions .rst{background:#EEE;color:#333}'
    + '.de-props .actions .del{background:#FDE8E8;color:#C0392B}'
    + '.de-rtbar{position:absolute;z-index:99998;display:flex;gap:2px;background:#1A365D;border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.25)}'
    + '.de-rtbar button{background:transparent;border:0;color:#fff;width:26px;height:26px;border-radius:5px;cursor:pointer;font-size:13px;line-height:1}'
    + '.de-rtbar button:hover,.de-rtbar button.on{background:rgba(255,255,255,.22)}'
    + '.de-rtbar button.b{font-weight:900}.de-rtbar button.i{font-style:italic}.de-rtbar button.u{text-decoration:underline}'
    + 'body.de-feedback [data-de-block],body.de-feedback .chapter,body.de-feedback header.hero{outline:1px dashed rgba(237,111,11,.4);outline-offset:2px;cursor:copy}'
    + 'body.de-feedback [data-de-block]:hover,body.de-feedback .chapter:hover,body.de-feedback header.hero:hover{outline:2px solid #ED6F0B}'
    + '.de-fbmark{position:absolute;width:18px;height:18px;background:#ED6F0B;color:#fff;border-radius:50%;font-size:10px;display:flex;align-items:center;justify-content:center;z-index:99997;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3)}'
    + '.de-fbnote{position:absolute;z-index:99999;background:#fff;border:1px solid #E6E6E6;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:10px;width:260px;font:13px sans-serif;color:#333}'
    + '.de-fbnote textarea{width:100%;min-height:70px;font:inherit;border:1px solid #E6E6E6;border-radius:6px;padding:6px;resize:vertical;box-sizing:border-box}'
    + '.de-fbnote .row{display:flex;gap:6px;margin-top:8px}'
    + '.de-fbnote .row button{flex:1;border:0;border-radius:6px;padding:7px;cursor:pointer;font:inherit}'
    + '.de-fbnote .save{background:#ED6F0B;color:#fff}.de-fbnote .cancel{background:#EEE;color:#333}'
    + '.de-fbpanel{position:fixed;right:16px;bottom:66px;z-index:99999;width:360px;max-width:92vw;max-height:66vh;overflow-y:auto;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:14px;display:none;font:13px/1.4 sans-serif;color:#333}'
    + '.de-fbpanel.show{display:block}'
    + '.de-fbpanel h3{font-size:13px;margin-bottom:4px}'
    + '.de-fbpanel .hint{font-size:11.5px;color:#6b7a8d;margin-bottom:10px}'
    + '.de-fbitem{border:1px solid #E6E6E6;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:12.5px;position:relative}'
    + '.de-fbitem b{display:block;font-size:10.5px;color:#ED6F0B;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}'
    + '.de-fbitem .del{position:absolute;top:6px;right:8px;cursor:pointer;color:#999;font-size:14px;line-height:1}'
    + '.de-fbpanel .row{display:flex;gap:8px;margin-top:6px}'
    + '.de-fbpanel .row button{flex:1;border:0;border-radius:8px;padding:9px 12px;cursor:pointer;font:inherit;font-weight:700}'
    + '.de-fbpanel .gen{background:#ED6F0B;color:#fff}.de-fbpanel .clr{background:#EEE;color:#333}'
    + '.de-fbempty{color:#6b7a8d;font-size:12.5px;padding:10px 0}';
  var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  var bar=document.createElement('div'); bar.className='de-bar';
  var bEdit=document.createElement('button'); bEdit.textContent='✎ Edit';
  var bDesign=document.createElement('button'); bDesign.textContent='🎨 Design';
  var bFeedback=document.createElement('button'); bFeedback.textContent='💬 Feedback';
  var bUndo=document.createElement('button'); bUndo.textContent='↺ Undo'; bUndo.title='Undo the last change (Ctrl/Cmd+Z)';
  var bPick=document.createElement('button'); bPick.textContent='◎ Element'; bPick.style.display='none';
  var bExport=document.createElement('button'); bExport.textContent='⤴ Export edits'; bExport.style.display='none';
  var bReset=document.createElement('button'); bReset.textContent='🧹 Reset page'; bReset.title='Clear every saved edit on this page, back to the git template';
  var stat=document.createElement('span'); stat.textContent='';
  bar.appendChild(bEdit); bar.appendChild(bDesign); bar.appendChild(bFeedback); bar.appendChild(bUndo); bar.appendChild(bPick); bar.appendChild(bExport); bar.appendChild(bReset); bar.appendChild(stat);
  document.body.appendChild(bar);
  // Always-visible, deliberately subtle — presentation mode hides the full bar, but there
  // must always be *something* on screen to click, or the toolbar is undiscoverable unless
  // you already know the ?edit param or the keyboard shortcut.
  var handle=document.createElement('button'); handle.className='de-handle'; handle.title='Open editor'; handle.textContent='✎';
  document.body.appendChild(handle);
  handle.addEventListener('click',function(){ showBar(true); });

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

  var fbPanel=document.createElement('div'); fbPanel.className='de-fbpanel';
  document.body.appendChild(fbPanel);

  var propsPanel=document.createElement('div'); propsPanel.className='de-props';
  document.body.appendChild(propsPanel);

  function toast(m){ var t=document.createElement('div'); t.className='de-toast'; t.textContent=m; document.body.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },300); },2000); }
  function copy(text,msg){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){ toast(msg); }); }
    else { var a=document.createElement('textarea'); a.value=text; document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); toast(msg); }catch(e){} a.remove(); } }

  function editable(){ return Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(function(el){
    return !el.closest('.de-bar') && !el.closest('.de-panel') && el.textContent.trim().length>0; }); }

  // Chapter-scoped id assignment. A pure global "Nth element in document order" counter
  // (the original scheme) looks deterministic, but isn't: editing chapter 3 to add a card
  // shifts the index of every element in chapters 4-14, so a saved KV edit like "e214: {...}"
  // silently re-lands on a completely different, unrelated element after the next template
  // push — a stale style edit becomes a rogue margin on some other box, a stale text edit
  // becomes text in a location that never asked for it, a stale delete tombstone removes
  // the wrong heading. Scoping every counter to the nearest preceding chapter id (c1, c2, ...)
  // means a structural change in one chapter can only ever shift ids *within that same
  // chapter* — every other chapter's saved edits keep lining up across template pushes. A
  // key that no longer matches any element is simply skipped on load (see loadEdits), not
  // misapplied, so this also self-heals edits that were already corrupted by the old scheme.
  var CHAPTERS = Array.prototype.slice.call(document.querySelectorAll('.chapter[id]'));
  function chapterKeyFor(el){
    var found='top';
    for(var i=0;i<CHAPTERS.length;i++){
      var c=CHAPTERS[i];
      if(c===el || (c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) found=c.id; else break;
    }
    return found;
  }
  var eidN={};
  function assignEids(){ editable().forEach(function(el){
    if(el.getAttribute('data-eid')) return;
    var k=chapterKeyFor(el); eidN[k]=(eidN[k]||0);
    el.setAttribute('data-eid', k+'-e'+(eidN[k]++));
  }); }

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
    var tidN={};
    document.querySelectorAll('.tbl-wrap table').forEach(function(table){
      var tb=table.querySelector('tbody'); if(!tb) return;
      var tKey=table.getAttribute('data-tid'); if(!tKey){ var tk=chapterKeyFor(table); tidN[tk]=(tidN[tk]||0); tKey=tk+'-t'+(tidN[tk]++); table.setAttribute('data-tid',tKey); }
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
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(r){ return r.json(); }).then(function(){ toast('Row order saved'); }).catch(function(){ toast('Order save failed'); });
  }

  function entry(el){ return { html: el.innerHTML, style: el.getAttribute('style')||'', preview: el.textContent.trim().slice(0,80) }; }
  // Snapshot for undo only at the *start* of a dirty batch (dirty was empty), not on every
  // keystroke/drag tick — one Ctrl+Z should undo "that edit", not one character of it. The
  // debounce window (600-1200ms) comfortably outlasts the snapshot fetch, so no explicit
  // sequencing is needed here the way the discrete actions below need it.
  function queueSave(el){ var id=el.getAttribute('data-eid'); if(!id) return;
    if(!Object.keys(dirty).length) armUndo();
    dirty[id]=entry(el);
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,1200); }
  // Style-only save (resize/recolour/refont) — deliberately omits the html field so it can
  // never clobber a separate, later text edit to the same element's children on load.
  function queueStyleSave(el){ var id=el.getAttribute('data-eid'); if(!id) return;
    if(!Object.keys(dirty).length) armUndo();
    dirty[id]=Object.assign({},dirty[id]||{},{style:el.getAttribute('style')||''});
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,600); }

  // ---- Design mode: select / move / resize / recolour / refont / duplicate / delete
  // any card-like block. Text mode (above) edits words; this edits the box around them.
  function assignBlockIds(){
    document.querySelectorAll(DESIGN_SEL).forEach(function(el){
      if(el.closest('.de-bar,.de-panel,.de-props,.de-fbpanel')) return;
      if(!el.getAttribute('data-eid')){ var bk=chapterKeyFor(el); blockN[bk]=(blockN[bk]||0); el.setAttribute('data-eid', bk+'-b'+(blockN[bk]++)); }
      el.setAttribute('data-de-block','1');
      var parent=el.parentElement; if(!parent) return;
      var tid=groupIds.get(parent);
      if(!tid){ var gk=chapterKeyFor(parent); groupN[gk]=(groupN[gk]||0); tid=gk+'-g'+(groupN[gk]++); groupIds.set(parent,tid); parent.setAttribute('data-tid',tid); }
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
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).catch(function(){});
  }
  function initBlockDrag(){
    document.querySelectorAll('[data-de-block]').forEach(function(el){
      if(el.__deWired) return; el.__deWired=true;
      el.addEventListener('mousedown',function(e){
        if(!document.body.classList.contains('de-design')) return;
        if(e.target.closest('.de-resize,.de-props')) return;
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
        if(selEls.size===1 && selEls.has(el)) positionOverlay(el);
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

  // Shift-click adds/removes a block from selEls instead of replacing the selection, so
  // several blocks can be deleted or duplicated together. Resizing and the full style panel
  // stay single-element-only (dragging one resize handle for N differently-sized blocks
  // isn't a coherent action) — multi-select gets a simplified panel with bulk actions.
  var selEls=new Set(), resizeHandle=null;
  function positionOverlay(el){
    var r=el.getBoundingClientRect();
    if(resizeHandle){ resizeHandle.style.top=(r.top+window.scrollY+r.height-7)+'px'; resizeHandle.style.left=(r.left+window.scrollX+r.width-7)+'px'; }
  }
  function removeResizeHandle(){ if(resizeHandle){ resizeHandle.remove(); resizeHandle=null; } }
  function clearSelection(){
    selEls.forEach(function(el){ el.classList.remove('de-bsel'); });
    selEls.clear();
    removeResizeHandle();
    propsPanel.classList.remove('show');
  }
  function refreshSelectionUI(){
    removeResizeHandle();
    if(!selEls.size){ propsPanel.classList.remove('show'); return; }
    if(selEls.size===1){
      var el=Array.from(selEls)[0];
      resizeHandle=document.createElement('div'); resizeHandle.className='de-resize'; document.body.appendChild(resizeHandle);
      positionOverlay(el);
      wireResize(el,resizeHandle);
      renderPropsPanel(el);
    } else {
      renderMultiPropsPanel();
    }
    propsPanel.classList.add('show');
  }
  function deleteSelection(){
    var els=Array.from(selEls);
    if(!confirm('Delete '+els.length+' blocks? This removes them for everyone viewing this deck.')) return;
    var patch={};
    els.forEach(function(el){ var eid=el.getAttribute('data-eid'); delete dirty[eid]; patch[eid]={deleted:true}; });
    clearSelection();
    els.forEach(function(el){ el.remove(); });
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ toast(els.length+' blocks deleted'); }).catch(function(){ toast('Delete failed to save'); });
  }
  function duplicateSelection(){
    var els=Array.from(selEls);
    clearSelection();
    els.forEach(function(el){ duplicateBlock(el); });
  }
  function renderMultiPropsPanel(){
    propsPanel.innerHTML =
      '<div class="ph"><span><span class="tag">'+selEls.size+' selected</span></span><button class="pclose" title="Deselect">×</button></div>'
      + '<section><p style="font-size:12.5px;color:#6b7a8d;margin:0">Shift-click a block to add or remove it from this selection. Style editing (font, colour, size) works one block at a time — select just one to use it.</p></section>'
      + '<div class="actions"><button class="dup">⧉ Duplicate all</button><button class="del">🗑 Delete all</button></div>';
    propsPanel.querySelector('.pclose').addEventListener('click',clearSelection);
    propsPanel.querySelector('.dup').addEventListener('click',duplicateSelection);
    propsPanel.querySelector('.del').addEventListener('click',deleteSelection);
  }
  function rgbToHex(rgb){ var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb||''); if(!m) return '#ffffff';
    return '#'+[1,2,3].map(function(i){ return ('0'+parseInt(m[i],10).toString(16)).slice(-2); }).join(''); }
  var FONTS=['Lato, sans-serif','Georgia, serif','Arial, sans-serif','\\'Courier New\\', monospace','\\'Times New Roman\\', serif','Verdana, sans-serif'];
  function wireResize(el,handle){
    handle.addEventListener('mousedown',function(e){
      e.preventDefault(); e.stopPropagation();
      var startX=e.clientX, startY=e.clientY, box=el.getBoundingClientRect(), startW=box.width, startH=box.height;
      function onMove(ev){
        var w=Math.max(80,startW+(ev.clientX-startX)), h=Math.max(40,startH+(ev.clientY-startY));
        el.style.width=w+'px'; el.style.height=h+'px';
        positionOverlay(el);
        var pw=propsPanel.querySelector('.p-w'), ph=propsPanel.querySelector('.p-h');
        if(pw) pw.value=Math.round(w); if(ph) ph.value=Math.round(h);
      }
      function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); queueStyleSave(el); }
      document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    });
  }
  function deleteBlock(el){
    if(!confirm('Delete this block? This removes it for everyone viewing this deck.')) return;
    var eid=el.getAttribute('data-eid'); clearSelection(); delete dirty[eid]; el.remove();
    armUndo().then(function(){
      var patch={}; patch[eid]={deleted:true};
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ toast('Block deleted'); }).catch(function(){ toast('Delete failed to save'); });
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
    armUndo().then(function(ed){
      ed=ed||{}; var key='__added:'+tid; var list=(ed[key]||[]).slice();
      list.push({id:newId, after:afterRid, html:clone.outerHTML});
      var patch={}; patch[key]=list;
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ saveContainerOrder(parent,tid); toast('Block duplicated'); selectBlock(clone); })
      .catch(function(){ toast('Duplicate failed to save'); });
  }

  // ---- Properties panel: a persistent Canva/PowerPoint-style inspector for whatever's
  // selected — one place for text, fill/border and size, instead of scattered mini-popups.
  function normWeight(w){ var n=parseInt(w,10); if(!isNaN(n)) return n>=700?(n>=900?'900':'700'):'400';
    return (''+w).toLowerCase()==='bold' ? '700' : '400'; }
  function blockState(el){
    var cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return {
      bg: rgbToHex(cs.backgroundColor), color: rgbToHex(cs.color),
      borderColor: rgbToHex(cs.borderTopColor), borderWidth: parseInt(cs.borderTopWidth,10)||0,
      radius: parseInt(cs.borderRadius,10)||0, opacity: Math.round((parseFloat(cs.opacity)||1)*100),
      width: Math.round(r.width), height: Math.round(r.height),
      fontSize: parseInt(cs.fontSize,10)||14, fontWeight: normWeight(cs.fontWeight), textAlign: cs.textAlign
    };
  }
  function renderPropsPanel(el){
    var st=blockState(el);
    var fontOpts=FONTS.map(function(f){ return '<option value="'+f.replace(/"/g,'&quot;')+'">'+f.split(',')[0].replace(/'/g,'')+'</option>'; }).join('');
    propsPanel.innerHTML =
      '<div class="ph"><span><span class="tag">'+el.tagName.toLowerCase()+'</span></span><button class="pclose" title="Deselect">×</button></div>'
      + '<section><h5>Text</h5>'
        + '<label>Font</label><select class="p-ff">'+fontOpts+'</select>'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Size (px)</label><input type="number" class="p-fs" min="8" max="96" value="'+st.fontSize+'"></div>'
          + '<div><label>Weight</label><select class="p-fw"><option value="400">Regular</option><option value="700">Bold</option><option value="900">Black</option></select></div>'
        + '</div>'
        + '<label style="margin-top:8px">Align</label><div class="btnrow p-align">'
          + '<button data-v="left">⟵</button><button data-v="center">•</button><button data-v="right">⟶</button></div>'
        + '<label style="margin-top:8px">Text colour</label><input type="color" class="p-color" value="'+st.color+'">'
      + '</section>'
      + '<section><h5>Fill &amp; border</h5>'
        + '<label>Background</label><input type="color" class="p-bg" value="'+st.bg+'">'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Border colour</label><input type="color" class="p-bc" value="'+st.borderColor+'"></div>'
          + '<div><label>Border width</label><input type="number" class="p-bw" min="0" max="12" value="'+st.borderWidth+'"></div>'
        + '</div>'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Corner radius</label><input type="number" class="p-radius" min="0" max="60" value="'+st.radius+'"></div>'
          + '<div><label>Opacity %</label><input type="range" class="p-opacity" min="10" max="100" value="'+st.opacity+'"></div>'
        + '</div>'
      + '</section>'
      + '<section><h5>Size</h5><div class="grid2">'
        + '<div><label>Width (px)</label><input type="number" class="p-w" min="80" value="'+st.width+'"></div>'
        + '<div><label>Height (px)</label><input type="number" class="p-h" min="40" value="'+st.height+'"></div>'
      + '</div></section>'
      + '<div class="actions"><button class="dup">⧉ Duplicate</button><button class="rst">↺ Reset</button><button class="del">🗑 Delete</button></div>';

    propsPanel.querySelector('.pclose').addEventListener('click',clearSelection);
    propsPanel.querySelectorAll('.p-align button').forEach(function(b){ b.classList.toggle('on',b.getAttribute('data-v')===st.textAlign); });
    propsPanel.querySelector('.p-align').addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return; el.style.textAlign=b.getAttribute('data-v'); queueStyleSave(el); renderPropsPanel(el); });
    propsPanel.querySelector('.p-fw').value=st.fontWeight;
    propsPanel.querySelector('.p-ff').addEventListener('change',function(){ el.style.fontFamily=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-fs').addEventListener('input',function(){ el.style.fontSize=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.p-fw').addEventListener('change',function(){ el.style.fontWeight=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-color').addEventListener('input',function(){ el.style.color=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-bg').addEventListener('input',function(){ el.style.background=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-bc').addEventListener('input',function(){ el.style.borderColor=this.value; el.style.borderStyle='solid'; queueStyleSave(el); });
    propsPanel.querySelector('.p-bw').addEventListener('input',function(){ el.style.borderWidth=this.value+'px'; el.style.borderStyle='solid'; queueStyleSave(el); });
    propsPanel.querySelector('.p-radius').addEventListener('input',function(){ el.style.borderRadius=this.value+'px'; queueStyleSave(el); });
    propsPanel.querySelector('.p-opacity').addEventListener('input',function(){ el.style.opacity=(this.value/100); queueStyleSave(el); });
    propsPanel.querySelector('.p-w').addEventListener('input',function(){ el.style.width=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.p-h').addEventListener('input',function(){ el.style.height=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.dup').addEventListener('click',function(){ duplicateBlock(el); });
    propsPanel.querySelector('.del').addEventListener('click',function(){ deleteBlock(el); });
    propsPanel.querySelector('.rst').addEventListener('click',function(){
      el.removeAttribute('style'); queueStyleSave(el); renderPropsPanel(el); positionOverlay(el); toast('Reset to default'); });
  }
  function selectBlock(el, additive){
    if(additive){
      if(selEls.has(el)){ el.classList.remove('de-bsel'); selEls.delete(el); }
      else { el.classList.add('de-bsel'); selEls.add(el); }
    } else {
      if(selEls.size===1 && selEls.has(el)) return;
      selEls.forEach(function(s){ s.classList.remove('de-bsel'); }); selEls.clear();
      el.classList.add('de-bsel'); selEls.add(el);
    }
    refreshSelectionUI();
  }
  document.addEventListener('click',function(e){
    if(!document.body.classList.contains('de-design')) return;
    if(e.target.closest('.de-props,.de-resize,.de-bar,.de-panel')) return;
    var el=e.target.closest('[data-de-block]');
    if(el) selectBlock(el, e.shiftKey); else if(!e.shiftKey) clearSelection();
  }, true);
  window.addEventListener('scroll',function(){ if(selEls.size===1) positionOverlay(Array.from(selEls)[0]); },true);
  window.addEventListener('resize',function(){ if(selEls.size===1) positionOverlay(Array.from(selEls)[0]); });
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
  bUndo.addEventListener('click',performUndo);
  bReset.addEventListener('click',function(){
    if(!confirm('Clear every saved edit on this page and reload from the git template? This affects the whole page, not just what you last changed, and cannot itself be undone.')) return;
    fetch(API+'/api/edits?page='+PAGE,{method:'DELETE'}).then(function(){ location.reload(); }).catch(function(){ toast('Reset failed'); });
  });

  // ---- rich text: bold/italic/underline/link on a text selection while in Edit mode ----
  var rtbar=null;
  function hideRtbar(){ if(rtbar){ rtbar.remove(); rtbar=null; } }
  function showRtbar(range){
    hideRtbar();
    rtbar=document.createElement('div'); rtbar.className='de-rtbar';
    rtbar.innerHTML='<button class="b" data-c="bold" title="Bold">B</button>'
      + '<button class="i" data-c="italic" title="Italic">I</button>'
      + '<button class="u" data-c="underline" title="Underline">U</button>'
      + '<button data-c="link" title="Link">🔗</button>'
      + '<button data-c="clear" title="Clear formatting">✕</button>';
    document.body.appendChild(rtbar);
    var r=range.getBoundingClientRect();
    rtbar.style.top=(r.top+window.scrollY-38)+'px';
    rtbar.style.left=Math.max(8,r.left+window.scrollX+r.width/2-70)+'px';
    rtbar.addEventListener('mousedown',function(e){ e.preventDefault(); }); // keep the text selection alive
    rtbar.addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return;
      var cmd=b.getAttribute('data-c');
      var host=lastSel; // the [data-eid] element currently being edited
      if(cmd==='link'){ var u=prompt('Link URL:','https://'); if(u) document.execCommand('createLink',false,u); }
      else if(cmd==='clear') document.execCommand('removeFormat');
      else document.execCommand(cmd);
      if(host) queueSave(host);
      hideRtbar();
    });
  }
  document.addEventListener('selectionchange',function(){
    if(!editing){ hideRtbar(); return; }
    var s=window.getSelection();
    if(!s || s.isCollapsed || !s.rangeCount){ hideRtbar(); return; }
    var el=s.anchorNode && s.anchorNode.nodeType===3 ? s.anchorNode.parentElement : s.anchorNode;
    if(!el || !el.closest || !el.closest('[contenteditable="true"]')){ hideRtbar(); return; }
    showRtbar(s.getRangeAt(0));
  });

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

  // ---- Feedback module: leave a note on any block or chapter, then generate a single
  // rework prompt for a fresh Claude Code session — the review-round equivalent of
  // "Copy for Claude Code" above, but for accumulated feedback instead of one element.
  function chapterFor(el){
    var marks=[];
    document.querySelectorAll('.chapter h2').forEach(function(h){
      var ch=h.closest('.chapter'); if(!ch) return;
      marks.push({ t: h.textContent.trim(), y: ch.getBoundingClientRect().top+window.scrollY });
    });
    var y=el.getBoundingClientRect().top+window.scrollY, best=null;
    marks.forEach(function(m){ if(m.y<=y+4) best=m; });
    return best ? best.t : 'Intro / hero';
  }
  function targetKey(el){
    if(el.id) return '#'+el.id;
    if(el.getAttribute('data-eid')) return 'eid:'+el.getAttribute('data-eid');
    if(!el.getAttribute('data-fbid')) el.setAttribute('data-fbid','fb'+Math.random().toString(36).slice(2,8));
    return 'fbid:'+el.getAttribute('data-fbid');
  }
  function findByKey(key){
    if(!key) return null;
    if(key.charAt(0)==='#') return document.getElementById(key.slice(1));
    if(key.indexOf('eid:')===0) return document.querySelector('[data-eid="'+key.slice(4)+'"]');
    if(key.indexOf('fbid:')===0) return document.querySelector('[data-fbid="'+key.slice(5)+'"]');
    return null;
  }
  function saveFeedback(){
    fetch(API+'/api/feedback?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(FEEDBACK)}).catch(function(){});
  }
  function renderMarkers(){
    document.querySelectorAll('.de-fbmark').forEach(function(m){ m.remove(); });
    FEEDBACK.forEach(function(f){
      var el=findByKey(f.target); if(!el) return;
      var m=document.createElement('div'); m.className='de-fbmark'; m.textContent='💬'; m.title=f.note.slice(0,120);
      var r=el.getBoundingClientRect();
      m.style.top=(r.top+window.scrollY-8)+'px'; m.style.left=(r.left+window.scrollX-8)+'px';
      m.addEventListener('click',function(e){ e.stopPropagation(); fbPanel.classList.add('show'); });
      document.body.appendChild(m);
    });
  }
  function renderFeedbackPanel(){
    var body = FEEDBACK.length ? FEEDBACK.map(function(f){
      return '<div class="de-fbitem"><span class="del" data-id="'+f.id+'">×</span><b>'+esc(f.label.split(' — ')[0])+'</b>'+esc(f.note)+'</div>';
    }).join('') : '<div class="de-fbempty">No notes yet. Turn Feedback on, then click any card, table or chapter to leave one.</div>';
    fbPanel.innerHTML = '<h3>💬 Feedback ('+FEEDBACK.length+')</h3>'
      + '<div class="hint">Click a block or chapter while Feedback is on to leave a note there. When you\\'re done, generate a prompt to paste into a Claude Code session.</div>'
      + '<div id="fb-list">'+body+'</div>'
      + '<div class="row"><button class="gen">⤴ Generate rework prompt</button></div>'
      + (FEEDBACK.length ? '<div class="row"><button class="clr">🗑 Clear all</button></div>' : '');
    fbPanel.querySelectorAll('.del').forEach(function(x){ x.addEventListener('click',function(){
      var id=x.getAttribute('data-id'); FEEDBACK=FEEDBACK.filter(function(f){ return f.id!==id; });
      saveFeedback(); renderFeedbackPanel(); renderMarkers(); }); });
    var gen=fbPanel.querySelector('.gen'); if(gen) gen.addEventListener('click',generatePrompt);
    var clr=fbPanel.querySelector('.clr'); if(clr) clr.addEventListener('click',function(){
      if(!confirm('Clear all '+FEEDBACK.length+' feedback notes?')) return;
      FEEDBACK=[]; saveFeedback(); renderFeedbackPanel(); renderMarkers(); });
  }
  function openNotePopup(el){
    document.querySelectorAll('.de-fbnote').forEach(function(p){ p.remove(); });
    var pop=document.createElement('div'); pop.className='de-fbnote';
    pop.innerHTML='<div style="font-size:11px;color:#ED6F0B;text-transform:uppercase;font-weight:800;margin-bottom:6px">'+esc(chapterFor(el))+'</div>'
      + '<textarea placeholder="What should change here?"></textarea>'
      + '<div class="row"><button class="save">Save note</button><button class="cancel">Cancel</button></div>';
    document.body.appendChild(pop);
    var r=el.getBoundingClientRect();
    pop.style.top=(r.top+window.scrollY)+'px';
    pop.style.left=Math.max(8,Math.min(window.innerWidth-276,r.right+window.scrollX+10))+'px';
    var ta=pop.querySelector('textarea'); ta.focus();
    pop.querySelector('.cancel').addEventListener('click',function(){ pop.remove(); });
    pop.querySelector('.save').addEventListener('click',function(){
      var note=ta.value.trim(); if(!note){ pop.remove(); return; }
      FEEDBACK.push({ id:'f'+(fbN++), target:targetKey(el), label:chapterFor(el)+' — "'+el.textContent.trim().replace(/\\s+/g,' ').slice(0,60)+'"', note:note, ts:new Date().toISOString() });
      saveFeedback(); renderFeedbackPanel(); renderMarkers();
      pop.remove(); toast('Feedback saved');
    });
  }
  function generatePrompt(){
    if(!FEEDBACK.length){ toast('No feedback to generate a prompt from'); return; }
    var byChapter={}, order=[];
    FEEDBACK.forEach(function(f){ var ch=f.label.split(' — ')[0]; if(!byChapter[ch]){ byChapter[ch]=[]; order.push(ch); } byChapter[ch].push(f.note); });
    var md='# '+PAGE+' deck — feedback round, '+(new Date().toISOString().slice(0,10))+'\\n\\n'
      + 'Rework the deck at /deck/'+PAGE+' using the feedspark-deck-generator skill, based on this feedback:\\n\\n';
    order.forEach(function(ch){
      md+='## '+ch+'\\n'; byChapter[ch].forEach(function(n){ md+='- '+n.replace(/\\n+/g,' ')+'\\n'; }); md+='\\n';
    });
    md+='Follow the feedspark-deck-generator skill\\'s Step 7: rework the deck, log this round to docs/feedback/'+PAGE+'.md, and update the skill itself if any note here would recur on a future deck.\\n';
    copy(md,'Feedback prompt copied — paste into Claude Code');
  }
  function loadFeedback(){
    fetch(API+'/api/feedback?page='+PAGE).then(function(r){ return r.json(); }).then(function(list){
      FEEDBACK=list||[]; fbN=FEEDBACK.length; renderFeedbackPanel(); renderMarkers();
    }).catch(function(){ FEEDBACK=[]; renderFeedbackPanel(); });
  }
  bFeedback.addEventListener('click',function(){
    var on=!document.body.classList.contains('de-feedback');
    document.body.classList.toggle('de-feedback',on); bFeedback.classList.toggle('on',on);
    fbPanel.classList.toggle('show',on);
  });
  document.addEventListener('click',function(e){
    if(!document.body.classList.contains('de-feedback')) return;
    if(e.target.closest('.de-fbnote,.de-fbpanel,.de-fbmark,.de-bar')) return;
    var el=e.target.closest('[data-de-block],.chapter,header.hero'); if(!el) return;
    openNotePopup(el);
  }, true);
  window.addEventListener('resize',renderMarkers);

  // Ids must exist for EVERY viewer at load time, not just whoever clicks Edit/Design first —
  // otherwise a saved KV patch has nothing to attach to and silently fails to apply for anyone
  // who opens the link read-only (e.g. a client on the call).
  assignEids();
  assignBlockIds();
  initRowDrag();
  initBlockDrag();
  loadEdits();
  loadFeedback();
})();
</script>
<!-- Universal PDF export — every deck gets this for free, no per-deck edits needed.
     Injected here (not hardcoded per deck) so future decks pick it up automatically. -->
<style>
@page{size:A4 landscape;margin:11mm 13mm}
@media print{
  html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;background:#fff}
  .topbar,.side-nav,.footmark,.scrollcue,.progress,.de-bar,.de-handle,.de-panel,.de-props,.de-toast,.de-resize,[id^="tky-"]{display:none!important}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:100%}
  section{padding:34px 0}
  .hero{min-height:auto;padding:56px 0 40px;break-after:page}
  .chapter{padding:40px 0;break-before:page;break-inside:avoid}
  .chapter+section{break-before:avoid}
  .ch-num{font-size:120px}
  .band,.band-warm{break-inside:avoid-page}
  .rv{opacity:1!important;transform:none!important;transition:none!important}
  .fill{transition:none!important}
  .card,.stat,.tier,.proto,.pipe-card,.flow-step,.mo,.sc-cell,.ask,.ct,.en-card,table tr{break-inside:avoid}
  .stats,.grid-2,.grid-3,.grid-4,.tiers,.road,.pipe,.flow,.sc-grid,.contacts{break-inside:avoid-page}
  .qs,.agent-l>p{display:none}
  .close{break-before:page}
  .card,.proto,.pipe-card,.tier,.en-card{box-shadow:none}
}
</style>
<script>
(function(){
  // client decks only — the FCC app pages (/, /workflow, …) aren't a download deliverable
  if(!/^\\/deck\\//.test(location.pathname)) return;
  function preparePrint(){
    document.querySelectorAll('.rv').forEach(function(el){ el.classList.add('in'); });
    document.querySelectorAll('.fill[data-w]').forEach(function(el){ var w=el.getAttribute('data-w'); if(w) el.style.width=w+'%'; });
  }
  window.addEventListener('beforeprint', preparePrint);
  function addBtn(){
    if(document.getElementById('pdfBtn')) return;
    var btn=document.createElement('button');
    btn.id='pdfBtn'; btn.className='flagbtn'; btn.title='Save this deck as a PDF to send to clients';
    btn.textContent='⬇ Download PDF'; btn.style.marginLeft='8px';
    btn.addEventListener('click',function(){ preparePrint(); setTimeout(function(){ window.print(); },60); });
    var flag=document.getElementById('flagbtn');
    var host=document.querySelector('.topbar-in');
    if(flag && flag.parentNode) flag.insertAdjacentElement('afterend', btn);
    else if(host) host.appendChild(btn);
    else { btn.style.cssText+=';position:fixed;top:14px;right:14px;z-index:99999;background:#fff'; document.body.appendChild(btn); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', addBtn); else addBtn();
})();
</script>`;
}
