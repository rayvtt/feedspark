/*
 * Task Manager sync — the WORKER pulls the feedspark-reports MCP itself.
 *
 * Ray, 16 Sep 2026: "an automatic scan or push … has to sync almost four to six times a day,
 * right? If a brief is being sent from FCC and users are logging hours, reporting to clients,
 * then that sync must be automatic. I don't need a manual push or manual pull."
 *
 * So there is no agent, no GitHub Action and no Claude session in the loop: a cron firing of the
 * worker (wrangler.toml TM_CRON = :15 and :45, every hour) runs worker.js › tmPull, which speaks
 * MCP's Streamable-HTTP transport — plain JSON-RPC over POST — straight to
 * mcp.dashboard.feedspark.com/mcp with the TM_MCP_TOKEN secret, and stores what the Leadership
 * and Workflow pages read. This module is the PURE half (no fetch, no KV): request shapes,
 * response parsing (the transport may answer JSON or an SSE frame), the market rotation and the
 * task → ticket hours mapping — so the harness (tools/test_tmmcp.mjs) runs the same code against
 * a stub MCP server and the worker's lifted tmPull.
 *
 * Per firing (its own subrequest budget, apart from the guard sweeps): initialize + ONE
 * get_client_list (52 markets → the per-brand rollup tmparse.js › aggregateClientList, written
 * only when a figure moved) + TM_TASK_PULLS get_task_list_for_client reads on a rotation of the
 * markets that are actually worked — hours or a block this cycle, or an FCC brief in flight —
 * stalest first, in-flight brands twice as often. A TM task carrying an [ibfref:…] token (the
 * Workflow composer puts it in every [FS Brief] subject; the team's TM tasks keep it in the title
 * or the notes) is THAT ticket's work, so its time_taken / time_taken_nonbill / time_schedule
 * land on the exact brief (KV tmhours, keyed by brief id). No fuzzy matching: a task without the
 * token is the brand's own work and never lands on a ticket.
 */

export const TM_MCP_URL = 'https://mcp.dashboard.feedspark.com/mcp';
export const TM_PROTOCOL = '2025-06-18';
export const TM_CRON = '15,45 * * * *';   // mirrored in wrangler.toml [triggers] and worker.js › scheduled()
export const TM_TASK_PULLS = 4;           // task lists per firing (≤200 rows × ~1.9KB each)
export const TM_TASK_DAYS = 21;           // from_date window per pull — briefs in flight live inside it
export const TM_TASK_LIMIT = 200;
export const TM_KEEP_TASKS = 60;          // compact task rows kept per market in tmtasks:<client>
export const TM_HOT_DAYS = 60;            // a brief younger than this keeps its market "hot"

const s0 = (v) => String(v == null ? '' : v);
const num0 = (v) => { const n = typeof v === 'number' ? v : parseFloat(s0(v).replace(/,/g, '')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
const r2 = (n) => Math.round(n * 100) / 100;
// = the Workflow page's slug(): a brief's code is slug(client) + '-' + slug(market) ("reiss-gb")
export const slugOf = (s) => s0(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
export function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

// ---- transport -------------------------------------------------------------------------------

// TM_MCP_TOKEN → the request header. Default `Authorization: Bearer <token>` (the MCP spec's own
// scheme); TM_MCP_AUTH names another header the server reads (e.g. X-API-Key), or 'raw' when the
// secret already carries its scheme ("Token …").
export function authHeader(token, mode) {
  const t = s0(token).trim(); if (!t) return null;
  const m = s0(mode).trim();
  if (!m || /^bearer$/i.test(m)) return { name: 'Authorization', value: 'Bearer ' + t };
  if (/^raw$/i.test(m)) return { name: 'Authorization', value: t };
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(m)) return { name: m, value: t };
  return { name: 'Authorization', value: 'Bearer ' + t };
}

export function rpc(id, method, params) { return { jsonrpc: '2.0', id, method, params: params || {} }; }

// a response body → the JSON-RPC message carrying result/error. Streamable HTTP lets the server
// answer a POST with plain JSON or with an SSE frame ("event: message\ndata: {…}\n\n"); both land here.
export function parseRpc(text, contentType) {
  const s = s0(text).trim(); if (!s) return null;
  const pick = (m) => { const arr = Array.isArray(m) ? m : [m]; let f = null; arr.forEach((x) => { if (x && typeof x === 'object' && (x.result !== undefined || x.error)) f = x; }); return f; };
  const sse = /event-stream/i.test(s0(contentType)) || (/^(?:event|data|id|retry):/m.test(s) && !/^[[{]/.test(s));
  if (sse) {
    let found = null;
    s.split(/\r?\n\r?\n/).forEach((block) => {
      const data = block.split(/\r?\n/).filter((l) => /^data:/.test(l)).map((l) => l.replace(/^data:\s?/, '')).join('\n');
      if (!data) return;
      try { const m = pick(JSON.parse(data)); if (m) found = m; } catch (e) {}
    });
    return found;
  }
  try { return pick(JSON.parse(s)); } catch (e) { return null; }
}

// a tools/call message → the JSON the tool returned (structuredContent first, else the text
// content parsed). Errors carry a `code` the worker turns into an honest status.
export function toolPayload(msg) {
  if (!msg) throw new Error('empty MCP response');
  if (msg.error) {
    const e = new Error('MCP ' + (msg.error.code != null ? msg.error.code + ' ' : '') + s0(msg.error.message || 'error').slice(0, 120));
    e.code = /unauthori[sz]ed|forbidden/i.test(s0(msg.error.message)) ? 'unauthorized' : 'rpc';
    throw e;
  }
  const r = msg.result || {};
  if (r.isError) { const t = (r.content || []).map((c) => c && c.text).filter(Boolean).join(' ').slice(0, 200); const e = new Error('tool error: ' + (t || 'unknown')); e.code = 'tool'; throw e; }
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  const txt = (r.content || []).filter((c) => c && c.type === 'text' && c.text != null).map((c) => c.text).join('');
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { const er = new Error('tool returned non-JSON text: ' + txt.slice(0, 80)); er.code = 'shape'; throw er; }
}

export function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

// ---- the market rotation ------------------------------------------------------------------------

// get_client_list rows → the markets a task pull can address (client_id is the TM's market id).
export function marketsOf(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || r.client_id == null) return;
    if (r.market_flag != null && !(r.market_flag === 0 || r.market_flag === 2)) return;
    const client = s0(r.client_name || r.group_name).replace(/\s+/g, ' ').trim(); if (!client) return;
    const market = s0(r.country || r.market_name).trim().toUpperCase() || '?';
    out.push({ id: +r.client_id, client, market, code: slugOf(client) + '-' + slugOf(market), used: num0(r.used_hours), allowance: num0(r.allowance), am: s0(r.primary_am).trim() });
  });
  return out;
}

// the codes ("reiss-gb") of the briefs in flight or younger than TM_HOT_DAYS — where hours are
// landing right now, so those markets are read twice as often
export function briefCodes(briefs, now, days) {
  const set = new Set(); const cut = (now || Date.now()) - (days || TM_HOT_DAYS) * 86400000;
  Object.keys(briefs || {}).forEach((k) => {
    const b = briefs[k]; if (!b || typeof b !== 'object' || !b.code) return;
    const m = /-(\d{4})(\d{2})(\d{2})-/.exec(s0(b.id || k));
    const born = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0;
    if (b.status !== 'confirmed' || born >= cut) set.add(s0(b.code).toLowerCase());
  });
  return set;
}

// which markets this firing reads: only worked ones (hours or a block this cycle, or a hot brief),
// ranked by how long since they were last read × 2 when hot × 1.5 when carrying hours — so a
// never-read market always comes first and no market can starve behind the hot ones.
export function planPulls(markets, rot, hot, k, now) {
  rot = rot || {}; hot = hot || new Set(); k = k == null ? TM_TASK_PULLS : k; now = now || Date.now();
  const elig = (markets || []).filter((m) => m && (m.used > 0 || m.allowance > 0 || hot.has(m.code)));
  const score = (m) => { const age = Math.max(1, now - (rot[m.id] || 0)); return age * (hot.has(m.code) ? 2 : 1) * (m.used > 0 ? 1.5 : 1); };
  elig.sort((a, b) => (score(b) - score(a)) || (b.used - a.used) || (a.id - b.id));
  return elig.slice(0, Math.max(0, k));
}

// ---- tasks → ticket hours -------------------------------------------------------------------

// the FCC ticket a TM task belongs to: the [ibfref:…] token in the title, else in the notes. The
// composer writes it into every brief subject and the team keeps it on the task — exact only.
export function ibfrefOf(task) {
  const raw = (task && task.raw) || {};
  const src = s0(task && task.title) + ' \n' + s0(raw.notes) + ' \n' + s0(task && task.notes);
  const m = /ibfref:\s*([A-Za-z0-9][A-Za-z0-9-]{3,40})/i.exec(src);
  return m ? m[1].replace(/-+$/, '').toUpperCase() : null;
}

export function taskHours(task) {
  const raw = (task && task.raw) || {}; const t = task || {};
  const pick = (a, b) => (a != null ? a : b);
  return { h: num0(pick(raw.time_taken, t.time_taken)), nb: num0(pick(raw.time_taken_nonbill, t.time_taken_nonbill)), sc: num0(pick(raw.time_schedule, t.time_schedule)) };
}

// TM's status word + its flag columns → one state the board can show
export function taskState(task) {
  const raw = (task && task.raw) || {}; const st = s0((task && task.status) || raw.status).toLowerCase();
  if (st === 'done' || raw.done_id) return 'done';
  if (+raw.onhold) return 'on hold';
  if (+raw.withclient) return 'with client';
  if (+raw.test_running) return 'test running';
  if (st === 'created' || !st) return 'open';
  return st.replace(/_/g, ' ');
}
const STATE_RANK = { done: 0, 'test running': 1, 'with client': 2, 'on hold': 3, open: 4 };
export function worstState(a, b) { if (!a) return b || null; if (!b) return a; const ra = STATE_RANK[a] != null ? STATE_RANK[a] : 5, rb = STATE_RANK[b] != null ? STATE_RANK[b] : 5; return rb > ra ? b : a; }

// the task title as the board should read it — the routing tokens and the [FS Brief] tag off,
// entities decoded (the ticket already knows its client)
export function displayTitle(t) {
  return s0(t).replace(/&amp;/g, '&').replace(/^\s*\[FS Brief\]\s*/i, '').replace(/\s*\[ibfcode:[^\]]*\]\s*/gi, ' ').replace(/\s*ibfdue:\d*\s*/gi, ' ').replace(/\s*\[ibfref:[^\]]*\]\s*/gi, ' ').replace(/\s*·\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function compactTask(task) {
  const raw = (task && task.raw) || {}; const t = task || {}; const hrs = taskHours(t);
  return { id: +(t.list_id || raw.list_id) || null, t: displayTitle(t.title || raw.title).slice(0, 140), st: taskState(t), o: s0(t.owner).trim().slice(0, 40), h: hrs.h, nb: hrs.nb, sc: hrs.sc, d: s0(t.created_on || raw.createdon).slice(0, 10), u: s0(raw.updatedon).slice(0, 16) || null, ref: ibfrefOf(t) };
}

// one market's task list → what the pages read: totals, hours per FCC ticket (byRef), per owner,
// per month, and the recent rows — compact, never the raw blobs
export function summariseTasks(rows, ctx) {
  ctx = ctx || {};
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).map(compactTask);
  const hours = { h: 0, nb: 0, sc: 0 }, byRef = {}, byOwner = {}, months = {};
  list.forEach((t) => {
    hours.h += t.h; hours.nb += t.nb; hours.sc += t.sc;
    const mo = t.d.slice(0, 7) || 'undated'; const mm = months[mo] || (months[mo] = { h: 0, nb: 0, n: 0 }); mm.h += t.h; mm.nb += t.nb; mm.n++;
    if (t.o) { const o = byOwner[t.o] || (byOwner[t.o] = { h: 0, nb: 0, n: 0 }); o.h += t.h; o.nb += t.nb; o.n++; }
    if (t.ref) {
      const r = byRef[t.ref] || (byRef[t.ref] = { h: 0, nb: 0, sc: 0, n: 0, dn: 0, st: null, o: [], tasks: [] });
      r.h += t.h; r.nb += t.nb; r.sc += t.sc; r.n++; if (t.st === 'done') r.dn++;
      if (t.o && r.o.indexOf(t.o) < 0) r.o.push(t.o);
      if (r.tasks.length < 6) r.tasks.push({ id: t.id, t: t.t, st: t.st, o: t.o, h: t.h, nb: t.nb, d: t.d });
      r.st = worstState(r.st, t.st);
    }
  });
  hours.h = r2(hours.h); hours.nb = r2(hours.nb); hours.sc = r2(hours.sc);
  Object.values(byRef).forEach((r) => { r.h = r2(r.h); r.nb = r2(r.nb); r.sc = r2(r.sc); r.o = r.o.join(', '); });
  Object.values(byOwner).forEach((o) => { o.h = r2(o.h); o.nb = r2(o.nb); });
  Object.values(months).forEach((m) => { m.h = r2(m.h); m.nb = r2(m.nb); });
  return { client: s0(ctx.client), market: s0(ctx.market), id: ctx.id != null ? +ctx.id : null, pulled: ctx.now || Date.now(), n: list.length, total: ctx.total != null && ctx.total !== '' ? +ctx.total : null, hours, byRef, byOwner, months, recent: list.slice(0, TM_KEEP_TASKS) };
}

// tmhours: brief id → the hours logged against it. A market pull REPLACES that market's record
// for every ref it saw; a ref the pull did not see keeps its last value (the window has rolled
// past it — its hours are final). Returns how many refs actually changed, so the worker writes
// the map only when something moved.
export function mergeHours(hours, sum, now) {
  let changed = 0;
  Object.keys((sum && sum.byRef) || {}).forEach((ref) => {
    const r = sum.byRef[ref];
    const rec = { client: sum.client, market: sum.market, mid: sum.id, h: r.h, nb: r.nb, sc: r.sc, n: r.n, dn: r.dn, st: r.st, o: r.o, tasks: r.tasks };
    const prev = hours[ref];
    const same = prev && JSON.stringify(Object.assign({}, prev, { updated: 0 })) === JSON.stringify(Object.assign({}, rec, { updated: 0 }));
    if (!same) { rec.updated = now || Date.now(); hours[ref] = rec; changed++; }
  });
  return changed;
}

// a short stable signature over a record (change detection → KV writes only when a figure moved)
export function sigOf(obj, drop) {
  const o = Object.assign({}, obj || {}); (drop || ['updated', 'sig']).forEach((k) => { delete o[k]; });
  const s = JSON.stringify(o); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + s.length.toString(36);
}
