// Task Manager AUTOMATIC sync harness (pure node, CI-safe). Ray, 16 Sep 2026: "that sync must be
// automatic. I don't need a manual push or manual pull." Pins the pure module (src/tmmcp.js:
// transport parsing JSON + SSE, auth modes, the market rotation, the ibfref task → ticket hours
// mapping), then LIFTS the worker's own tmMcp / tmStore / tmPull out of worker.js by name and runs
// them against an in-process stub MCP server (401 on a bad header, Mcp-Session-Id, SSE-framed and
// JSON-framed tool results, a 500) with a fake KV — so the code the :15/:45 cron runs is the code
// under test. Finally pins the wiring: the cron in wrangler.toml + scheduled(), /api/tm's status /
// hours / owner-only pull, the Workflow ⏱ chip and the Leadership source line.
import fs from 'node:fs';
import http from 'node:http';
import * as TMM from '../cloudflare/feedspark-deck/src/tmmcp.js';
import { aggregateClientList } from '../cloudflare/feedspark-deck/src/tmparse.js';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), WF = read('docs/FeedSpark_Workflow.html'), LEAD = read('docs/FeedSpark_Leadership.html'), TOML = read('wrangler.toml');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };
const J = (v) => JSON.stringify(v);

// ---- pure module -------------------------------------------------------------------------------
console.log('· transport helpers');
t('auth: Bearer by default, a named header on request, raw when the secret carries its scheme, none without a token',
  J(TMM.authHeader('abc')) === J({ name: 'Authorization', value: 'Bearer abc' }) && J(TMM.authHeader('abc', 'X-API-Key')) === J({ name: 'X-API-Key', value: 'abc' })
  && J(TMM.authHeader('Token abc', 'raw')) === J({ name: 'Authorization', value: 'Token abc' }) && TMM.authHeader('') === null);
t('a secret pasted with its scheme already on it is never double-prefixed ("Bearer Bearer …")',
  J(TMM.authHeader('Bearer abc123')) === J({ name: 'Authorization', value: 'Bearer abc123' }) && J(TMM.authHeader('  bearer   abc123 ')) === J({ name: 'Authorization', value: 'bearer abc123' })
  && J(TMM.authHeader('Token abc123')) === J({ name: 'Authorization', value: 'Token abc123' }) && J(TMM.authHeader('abc123', 'X-API-Key')) === J({ name: 'X-API-Key', value: 'abc123' }));
const okMsg = { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: '[{"a":1}]' }] } };
t('parseRpc reads plain JSON, a batch, and an SSE frame (picks the message carrying the result)',
  J(TMM.parseRpc(J(okMsg), 'application/json')) === J(okMsg)
  && J(TMM.parseRpc(J([{ jsonrpc: '2.0', method: 'notifications/progress' }, okMsg]), 'application/json')) === J(okMsg)
  && J(TMM.parseRpc('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: ' + J(okMsg) + '\n\n', 'text/event-stream')) === J(okMsg)
  && TMM.parseRpc('', 'application/json') === null);
t('toolPayload: structuredContent wins, text JSON is parsed, isError and rpc errors throw with a code',
  J(TMM.toolPayload({ result: { structuredContent: { rows: [1] }, content: [{ type: 'text', text: '[]' }] } })) === J({ rows: [1] })
  && J(TMM.toolPayload(okMsg)) === J([{ a: 1 }])
  && (() => { try { TMM.toolPayload({ result: { isError: true, content: [{ type: 'text', text: 'boom' }] } }); return false; } catch (e) { return e.code === 'tool'; } })()
  && (() => { try { TMM.toolPayload({ error: { code: -32000, message: 'Unauthorized.' } }); return false; } catch (e) { return e.code === 'unauthorized'; } })());
t('rowsOf accepts an array, {rows} and {data}', TMM.rowsOf([1]).length === 1 && TMM.rowsOf({ rows: [1, 2] }).length === 2 && TMM.rowsOf({ data: [1] }).length === 1 && TMM.rowsOf(null).length === 0);

console.log('· the market rotation');
const row = (id, client, country, allowance, used, health, flag) => ({ market_id: id, client_id: id, ticket_client_id: 1, market_flag: flag, market_name: client + ' - ' + country, client_name: client, group_name: client, country, primary_am: 'Ray', allowance, balance: allowance - used, balance_health: health, used_hours: used, current_hours: allowance, carried_hours: 0 });
const CLIENTS = [
  row(155, 'Reiss', 'GB', 35, 38.25, 'negative', 0), row(467, 'Reiss', 'DE', 8, 7.5, 'negative', 0), row(607, 'Reiss', 'PT', 0, 0, 'zero', 0),
  row(582, 'YuMove', 'GB', 18, 8.25, 'healthy', 0), row(501, 'Superdry', 'GB', 16, 20.5, 'negative', 0), row(504, 'Superdry', 'PL', 2, 1, 'healthy', 0),
  row(999, 'Estee Lauder', 'GB', 10, 5, 'warning', 1),
];
const mkts = TMM.marketsOf(CLIENTS);
t('marketsOf: live markets only, the TM market id, brief-code parity ("reiss-gb"), numeric hours', mkts.length === 6 && mkts[0].id === 155 && mkts[0].code === 'reiss-gb' && mkts[0].used === 38.25 && !mkts.some((m) => m.client === 'Estee Lauder'));
const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const hot = TMM.briefCodes({ 'REIS-20260910-02': { id: 'REIS-20260910-02', code: 'reiss-gb', status: 'progress' }, 'SUPE-20260101-01': { id: 'SUPE-20260101-01', code: 'superdry-pl', status: 'confirmed' }, 'YUMO-20260901-01': { id: 'YUMO-20260901-01', code: 'yumove-gb', status: 'confirmed' } }, NOW);
t('briefCodes: an in-flight brief is hot, an old confirmed one is not, a recent confirmed one still is', hot.has('reiss-gb') && !hot.has('superdry-pl') && hot.has('yumove-gb'));
const plan1 = TMM.planPulls(mkts, {}, new Set(['reiss-gb']), 4, NOW);
t('planPulls: a 0h/0-block market is left out, the hot market leads, then by hours used, capped at k', plan1.map((m) => m.id).join(',') === '155,501,582,467' && !plan1.some((m) => m.id === 607));
const rot = {}; plan1.forEach((m) => { rot[m.id] = NOW; });
const plan2 = TMM.planPulls(mkts, rot, new Set(['reiss-gb']), 4, NOW + 1800000);
t('…next firing: the market nobody has read yet comes first, the hot one before the rest', plan2[0].id === 504 && plan2[1].id === 155);
t('…a 0h market with a brief in flight IS read', TMM.planPulls(mkts, {}, new Set(['reiss-pt']), 9, NOW).some((m) => m.id === 607));

console.log('· tasks → ticket hours (the real specimen shape: title token, notes token, no token)');
const task = (id, title, status, owner, created, h, nb, sc, notes, flags) => ({ list_id: id, title, status, owner, created_on: created, time_taken: h, raw: Object.assign({ list_id: id, client_id: 155, title, notes: notes || '', createdon: created, updatedon: created, done_id: status === 'done' ? 1 : null, status, onhold: 0, withclient: 0, test_running: 0, time_schedule: sc, time_taken: h, time_taken_nonbill: nb }, flags || {}) });
const TASKS = {
  155: [
    task(219998, 'Quarterly Business Review', 'created', 'Ray', '2026-09-16 04:00:00', 0, 0, 3),
    task(219841, '[FS Brief] Reiss  Keywords Optimisation - Leather &amp; Suede - Marketing Planner - 0926  [ibfcode:reiss-gb] ibfdue:15092026 [ibfref:REIS-20260910-01]', 'done', 'Vitus', '2026-09-14 00:00:00', 4, 3, 4),
    task(219619, '[FS Brief] Reiss · Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926 · [ibfcode:reiss-gb] ibfdue:15092026 [ibfref:REIS-20260910-02]', 'done', 'Steven Opuni', '2026-09-10 00:00:00', 0.5, 0.25, 0.5),
    task(219835, 'Keyword optimisation', 'done', 'Vitus', '2026-09-14 00:00:00', 4, 3.75, 4, 'Batch Setup - Keyword Optimisation; [FS Brief] Reiss  Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926  [ibfcode:reiss-gb] ibfdue:15092026 [ibfref:REIS-20260910-02];'),
    task(218303, 'Product Type Optimisation', 'created', 'Febin', '2026-08-20 00:00:00', 1.5, 0, 24, '[FS Brief] Reiss  [SVS-Q3/26] Daily delta-alert monitoring proposal  [ibfcode:reiss-gb] ibfdue:18082026 [ibfref:REIS-20260817-01]', { onhold: 1 }),
  ],
  582: [task(300001, 'Feed check', 'done', 'Dino', '2026-09-12 00:00:00', 1, 0, 1)],
};
t('ibfrefOf: from the title, from the notes, none when absent — upper-cased', TMM.ibfrefOf(TASKS[155][1]) === 'REIS-20260910-01' && TMM.ibfrefOf(TASKS[155][3]) === 'REIS-20260910-02' && TMM.ibfrefOf(TASKS[155][0]) === null && TMM.ibfrefOf({ title: 'x [ibfref:reis-1-01]' }) === 'REIS-1-01');
t('taskHours reads time_taken / time_taken_nonbill / time_schedule off raw', J(TMM.taskHours(TASKS[155][3])) === J({ h: 4, nb: 3.75, sc: 4 }));
t('taskState: done · on hold (flag) · open (created)', TMM.taskState(TASKS[155][1]) === 'done' && TMM.taskState(TASKS[155][4]) === 'on hold' && TMM.taskState(TASKS[155][0]) === 'open');
t('displayTitle strips the routing tokens + the [FS Brief] tag and decodes &amp;', TMM.displayTitle(TASKS[155][1].title) === 'Reiss Keywords Optimisation - Leather & Suede - Marketing Planner - 0926');
const sum = TMM.summariseTasks(TASKS[155], { client: 'Reiss', market: 'GB', id: 155, now: NOW, total: 3013 });
t('summariseTasks: totals, per-ticket sums across BOTH tasks carrying the ref (title + notes), owners joined, done count',
  sum.n === 5 && sum.total === 3013 && sum.hours.h === 10 && sum.hours.nb === 7 && sum.hours.sc === 35.5
  && sum.byRef['REIS-20260910-02'].h === 4.5 && sum.byRef['REIS-20260910-02'].nb === 4 && sum.byRef['REIS-20260910-02'].n === 2 && sum.byRef['REIS-20260910-02'].dn === 2 && sum.byRef['REIS-20260910-02'].st === 'done' && sum.byRef['REIS-20260910-02'].o === 'Steven Opuni, Vitus'
  && sum.byRef['REIS-20260817-01'].st === 'on hold' && !sum.byRef.QBR && Object.keys(sum.byRef).length === 3 && sum.byOwner.Vitus.h === 8 && sum.months['2026-09'].n === 4);
const H = {}; const c1 = TMM.mergeHours(H, sum, NOW);
t('mergeHours writes each ref once, stamps the pull time, reports the change count', c1 === 3 && H['REIS-20260910-02'].client === 'Reiss' && H['REIS-20260910-02'].market === 'GB' && H['REIS-20260910-02'].updated === NOW);
t('…an identical re-pull changes nothing; a moved figure replaces the record', TMM.mergeHours(H, sum, NOW + 1) === 0 && (() => { const s2 = JSON.parse(J(sum)); s2.byRef['REIS-20260910-01'].h = 6; return TMM.mergeHours(H, s2, NOW + 2) === 1 && H['REIS-20260910-01'].h === 6 && H['REIS-20260910-01'].updated === NOW + 2; })());
// TWO LANES, ONE RECORD (Ray, 16 Sep 2026: "crawl the entire TM data, use the [ibfref] to match
// with the tickets… and bring over the billable, non-billable and total hours"). tmPull looks back
// 21 days so a brief raised this morning shows hours within the hour; tmBookPull crawls twelve
// months. Without a rule they overwrite each other every firing and a ticket worked across months
// reads as a fraction of itself half the time.
{
  const wide = JSON.parse(J(sum)); wide.byRef['REIS-20260910-02'].h = 40;      // the whole year
  const narrow = JSON.parse(J(sum)); narrow.byRef['REIS-20260910-02'].h = 4.5; // the last 21 days
  const W = {};
  TMM.mergeHours(W, wide, NOW, TMM.TM_BOOK_DAYS);
  t('the book crawl stamps its window on every ref it writes', W['REIS-20260910-02'].win === TMM.TM_BOOK_DAYS && W['REIS-20260910-02'].h === 40);
  const c = TMM.mergeHours(W, narrow, NOW + 1, TMM.TM_TASK_DAYS);
  t('…and the 21-day lane may NOT overwrite it — a ticket worked across months keeps its full sum',
    c === 0 && W['REIS-20260910-02'].h === 40 && W['REIS-20260910-02'].win === TMM.TM_BOOK_DAYS);
  const N = {};
  TMM.mergeHours(N, narrow, NOW, TMM.TM_TASK_DAYS);
  t('a ref the crawl has not reached yet is still filled fast, so a new brief shows hours at once',
    N['REIS-20260910-02'].h === 4.5 && N['REIS-20260910-02'].win === TMM.TM_TASK_DAYS);
  t('…and the crawl replaces it the moment it arrives',
    TMM.mergeHours(N, wide, NOW + 2, TMM.TM_BOOK_DAYS) > 0
    && N['REIS-20260910-02'].h === 40 && N['REIS-20260910-02'].win === TMM.TM_BOOK_DAYS);
  t('the wider lane re-reading its own ref still updates it — the rule blocks narrower, not equal',
    (() => { const w2 = JSON.parse(J(wide)); w2.byRef['REIS-20260910-02'].h = 41;
      return TMM.mergeHours(N, w2, NOW + 3, TMM.TM_BOOK_DAYS) === 1 && N['REIS-20260910-02'].h === 41; })());
  t('a record stored before the rule existed carries no window and is corrected by the first crawl',
    (() => { const O = { 'REIS-20260910-02': { client: 'Reiss', h: 1, nb: 0, sc: 0, n: 1 } };
      return TMM.mergeHours(O, wide, NOW + 4, TMM.TM_BOOK_DAYS) > 0 && O['REIS-20260910-02'].h === 40; })());
  t('an unwindowed merge (the old signature) still works and claims no window',
    (() => { const U = {}; TMM.mergeHours(U, wide, NOW); return U['REIS-20260910-02'].win === undefined; })());
}
t('sigOf is stable and blind to the updated stamp', TMM.sigOf({ a: 1, updated: 5 }) === TMM.sigOf({ a: 1, updated: 9 }) && TMM.sigOf({ a: 1 }) !== TMM.sigOf({ a: 2 }));

// ---- the worker's own functions, lifted by name, against a stub MCP server ----------------------
console.log('· worker: tmPull (lifted) against a stub MCP');
function lift(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm'); const m = re.exec(WK);
  if (!m) throw new Error('worker.js: ' + name + ' not found');
  const end = WK.indexOf('\n}\n', m.index); if (end < 0) throw new Error(name + ': no end');
  return WK.slice(m.index, end + 3);
}
const W = new Function('TMM', 'aggregateClientList', 'liftEnvelope', lift('tmMcp') + lift('tmStore') + lift('tmPull') + '\nreturn { tmMcp, tmStore, tmPull };')(TMM, aggregateClientList, (stored) => ({ data: stored || {} }));
function fakeKV(init) { const store = new Map(); Object.keys(init || {}).forEach((k) => store.set(k, typeof init[k] === 'string' ? init[k] : J(init[k]))); const puts = []; return { store, puts, async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, typeof v === 'string' ? v : J(v)); puts.push(k); } }; }
const TOKEN = 'test-token-123'; let MODE = 'bearer', FAIL500 = false; const hits = [];
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const m = body ? JSON.parse(body) : {};
    hits.push({ method: m.method, auth: req.headers.authorization || null, apikey: req.headers['x-api-key'] || null, sid: req.headers['mcp-session-id'] || null, accept: req.headers.accept || '', args: m.params && m.params.arguments, name: m.params && m.params.name });
    const ok = MODE === 'bearer' ? req.headers.authorization === 'Bearer ' + TOKEN : req.headers['x-api-key'] === TOKEN;
    if (!ok) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(J({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized.' }, id: null })); }
    if (m.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'Mcp-Session-Id': 'sess-1' }); return res.end(J({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } } })); }
    if (m.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
    if (m.method === 'tools/call' && m.params.name === 'get_client_list') {
      if (FAIL500) { FAIL500 = false; res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<h1>Internal Server Error</h1>'); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });   // SSE-framed, like a streaming server
      return res.end('event: message\ndata: ' + J({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: J(CLIENTS) }] } }) + '\n\n');
    }
    if (m.method === 'tools/call' && m.params.name === 'get_task_list_for_client') {
      const rows = TASKS[m.params.arguments.client_id] || [];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(J({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: J({ status: 'ok', rows, returned_count: rows.length, total_count: rows.length + 5, truncated: true, row_limit: m.params.arguments.limit }) }] } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(J({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL0 = 'http://127.0.0.1:' + server.address().port + '/mcp';
const envOf = (o) => Object.assign({ TM_MCP_URL: URL0 }, o);

// A. no secret → honest status, no network
{ const kv = fakeKV(); const s = await W.tmPull(envOf({ EDITS: kv }), { now: NOW });
  t('no TM_MCP_TOKEN → state no_token, nothing fetched, nothing stored but the status', s.state === 'no_token' && hits.length === 0 && kv.puts.join() === 'tmstatus'); }
// B. a refused credential → unauthorized, failure count up, the last good sync kept
{ const kv = fakeKV({ tmstatus: { ok_at: 111, fails: 2 } }); const s = await W.tmPull(envOf({ EDITS: kv, TM_MCP_TOKEN: 'nope' }), { now: NOW });
  t('a refused token → state unauthorized, fails 3, ok_at preserved, header + host reported (no secret)', s.state === 'unauthorized' && s.fails === 3 && s.ok_at === 111 && s.auth === 'Authorization' && s.url === '127.0.0.1:' + server.address().port && J(s).indexOf('nope') < 0); }
// C. the real pull
hits.length = 0;
const kv = fakeKV({ briefs: { 'REIS-20260910-02': { id: 'REIS-20260910-02', client: 'Reiss', code: 'reiss-gb', status: 'progress' } } });
const env = envOf({ EDITS: kv, TM_MCP_TOKEN: TOKEN });
const s1 = await W.tmPull(env, { now: NOW });
t('state ok · every brand stored via tmStore (Reiss = GB+DE+PT rolled up, Estee flag 1 excluded) · tmidx carries a change signature',
  s1.state === 'ok' && s1.ok_at === NOW && s1.fails === 0 && s1.clients === 3 && s1.markets === CLIENTS.length
  && (await kv.get('tm:Reiss', 'json')).allowance === 43 && (await kv.get('tm:Reiss', 'json')).used === 45.75 && (await kv.get('tm:Reiss', 'json')).marketCount === 3 && (await kv.get('tm:Reiss', 'json')).src === 'mcp'
  && !!(await kv.get('tmidx', 'json')).Reiss.sig && !(await kv.get('tm:Estee Lauder', 'json')), J(s1));
t('MCP handshake: initialize (Accept includes text/event-stream) → notifications/initialized → tools/call with the Mcp-Session-Id',
  hits[0].method === 'initialize' && /text\/event-stream/.test(hits[0].accept) && hits[1].method === 'notifications/initialized' && hits[2].method === 'tools/call' && hits[2].sid === 'sess-1' && hits[2].name === 'get_client_list');
const tl = hits.filter((h) => h.name === 'get_task_list_for_client');
t('task pulls: TM_TASK_PULLS markets on the rotation — hot Reiss GB first, then by hours used — with the 21-day window and the row cap',
  tl.length === 4 && tl.map((h) => h.args.client_id).join(',') === '155,501,582,467' && tl[0].args.from_date === TMM.isoDay(NOW - 21 * 86400000) && tl[0].args.limit === TMM.TM_TASK_LIMIT && s1.pulled.length === 4 && s1.pulled[0] === 'Reiss GB (5)');
const book = await kv.get('tmtasks:Reiss', 'json'), hrs = await kv.get('tmhours', 'json');
t('tmtasks:Reiss holds the per-market summaries (GB 5 rows · DE 0) — compact, no raw blobs', book && book.markets.GB.n === 5 && book.markets.DE.n === 0 && book.markets.GB.hours.h === 10 && J(book).indexOf('notes_open_tickets') < 0 && book.markets.GB.recent.length === 5);
t('tmhours: the two Cashmere/Merino tasks (title token + notes token) sum onto ONE ticket; the tokenless QBR lands on none',
  hrs && hrs['REIS-20260910-02'].h === 4.5 && hrs['REIS-20260910-02'].nb === 4 && hrs['REIS-20260910-02'].n === 2 && hrs['REIS-20260910-01'].h === 4 && hrs['REIS-20260817-01'].st === 'on hold' && Object.keys(hrs).length === 3 && s1.refs === 3);
// D. the next firing: nothing moved → no re-writes; the market left over is read first
const putsBefore = kv.puts.filter((k) => k.indexOf('tm:') === 0 || k === 'tmidx' || k === 'tmhours').length; hits.length = 0;
const s2 = await W.tmPull(env, { now: NOW + 1800000 });
t('a quiet firing re-writes no brand record, no index and no hours map (change detection) — the status alone',
  s2.state === 'ok' && s2.changed === 0 && kv.puts.filter((k) => k.indexOf('tm:') === 0 || k === 'tmidx' || k === 'tmhours').length === putsBefore, J(kv.puts));
t('…and the rotation moves on: Superdry PL (never read) leads, hot Reiss GB follows', s2.pulled[0].indexOf('Superdry PL') === 0 && s2.pulled[1].indexOf('Reiss GB') === 0 && s2.rot['504'] === NOW + 1800000);
// E. a 500 from the MCP → unreachable, previous good sync kept
FAIL500 = true; const s3 = await W.tmPull(env, { now: NOW + 3600000 });
t('an MCP 5xx → state unreachable, fails 1, ok_at = the last good sync, figures untouched', s3.state === 'unreachable' && s3.fails === 1 && s3.ok_at === NOW + 1800000 && (await kv.get('tm:Reiss', 'json')).used === 45.75);
// F. the header the server reads is configurable
MODE = 'apikey';
{ const kv2 = fakeKV(); const sA = await W.tmPull(envOf({ EDITS: kv2, TM_MCP_TOKEN: TOKEN }), { now: NOW, pulls: 0 });
  const sB = await W.tmPull(envOf({ EDITS: kv2, TM_MCP_TOKEN: TOKEN, TM_MCP_AUTH: 'X-API-Key' }), { now: NOW + 1, pulls: 0 });
  t('a server reading X-API-Key: Bearer is refused (unauthorized), TM_MCP_AUTH=X-API-Key gets in — with pulls=0 the client list alone', sA.state === 'unauthorized' && sB.state === 'ok' && sB.auth === 'X-API-Key' && sB.pulled.length === 0 && (await kv2.get('tm:YuMove', 'json')).used === 8.25); }
MODE = 'bearer';
// G. tmStore is the shared writer — the push lane's guards still hold through it
{ const kv3 = fakeKV(); const r = await W.tmStore(envOf({ EDITS: kv3 }), [{ client: 'Bad:Name', allowance: 1 }, { client: 'YuMove', allowance: 18, used: 8.25, markets: [{ market: 'GB', allowance: 18, used: 8.25 }] }], { source: 'push' });
  t('tmStore: a key-poisoning client name is refused, a good one stored with its market list, tmidx written', r.results[0].error === 'bad client' && r.results[1].ok && (await kv3.get('tm:YuMove', 'json')).markets[0].market === 'GB' && kv3.puts.indexOf('tmidx') >= 0); }
server.close();

// ---- wiring ---------------------------------------------------------------------------------------
console.log('· wiring');
t('the cron: wrangler.toml [triggers] carries TM_CRON and scheduled() dispatches it to tmPull on its own firing', TOML.indexOf('"' + TMM.TM_CRON + '"') >= 0 && WK.indexOf("event.cron === '" + TMM.TM_CRON + "'") >= 0 && /event\.cron === '15,45 \* \* \* \*'\) \{\n\s+await tmPull\(env\);/.test(WK));
t('the push lane writes through the same tmStore', /Array\.isArray\(body\.tmpush\)\) \{\n\s+const \{ results \} = await tmStore\(env, body\.tmpush, \{ source: 'push' \}\);/.test(WK));
t('/api/tm: status on every read, ?hours=1 scoped by the brief’s client, ?client= with the task book, ?pull=1 owner-only via realOwner',
  /url\.searchParams\.get\('hours'\)/.test(WK) && /if \(r && inScope\(r\.client\)\) out\[ref\] = r;/.test(WK) && /tasks: tasks \|\| null, status/.test(WK) && /if \(url\.searchParams\.get\('pull'\)\) \{\n\s+if \(!realOwner\(env, request\)\) return json\(\{ ok: false, error: 'owner only' \}, 403\);/.test(WK) && /source: src, status \}/.test(WK));
t('the status never leaks the secret (pubStatus whitelists fields)', /const pubStatus = \(s\) => \(s \? \{ state: s\.state/.test(WK) && !/TM_MCP_TOKEN[^\n]*pubStatus|pubStatus[^\n]*TM_MCP_TOKEN/.test(WK));
t('the worker imports the pure modules (tmparse is an ES module now)', /import \{ aggregateClientList \} from "\.\/tmparse\.js";/.test(WK) && /import \* as TMM from "\.\/tmmcp\.js";/.test(WK) && /^export \{ norm, num, r2, brandKey/m.test(read('cloudflare/feedspark-deck/src/tmparse.js')));
t('Workflow: reads /api/tm?hours=1 at boot + every 5 min + on tab-visible, wears ⏱ on the card, breaks it down in the modal',
  /fetch\('\/api\/tm\?hours=1'\)/.test(WF) && /setInterval\(tmLoad,300000\)/.test(WF) && /renderAll\(\); tmLoad\(\);/.test(WF) && /\+db\+ageChip\+tmChip\(b\)\+/.test(WF) && /function tmChip\(b\)/.test(WF) && /\+tmModalPill\(b\)/.test(WF) && /\+tmModalSec\(b\)/.test(WF) && /Hours logged in the Task Manager/.test(WF) && /\.tik \.tk-hrs\{/.test(WF) && /\[data-theme=dark\] \.tik \.tk-hrs\{/.test(WF));
t('Leadership: the source line reports live / no_token / unauthorized / unreachable honestly and offers ⟳ Sync now (owner route)',
  /function tmLine\(d\)/.test(LEAD) && /st\.state==='no_token'/.test(LEAD) && /st\.state==='unauthorized'/.test(LEAD) && /st\.state==='unreachable'/.test(LEAD) && /id="tm-sync"/.test(LEAD) && /fetch\('\/api\/tm\?pull=1'\)/.test(LEAD) && /line\.innerHTML=tmLine\(d\)/.test(LEAD));
// THE BOOK LANE HARVESTS THE SAME TOKENS (Ray, 16 Sep 2026: "crawl the entire TM data, use the
// [ibfref] to match with the tickets that have been raised and brief from the FCC workflow, and
// bring over the billable, non-billable, and total hours to show case in either Brief Ledger and
// on Workflow individual task"). The crawl was already holding twelve months of rows for the
// trail; harvesting the refs off them costs no extra MCP call.
t('tmBookPull harvests ibfref hours off the rows it already pulled — no second call',
  /const trows = TMM\.rowsOf\(payload\);/.test(WK) && /TMM\.mergeHours\(hours,\s*\n\s*TMM\.summariseTasks\(trows/.test(WK));
t('…declaring the WIDE window, so the crawl owns a ref over the 21-day lane',
  /now, TMM\.TM_BOOK_DAYS\)/.test(WK) && /TMM\.mergeHours\(hours, sum, now, TMM\.TM_TASK_DAYS\)/.test(WK));
t('…and writes tmhours only when a figure actually moved',
  /if \(hoursDirty\) \{ try \{ await env\.EDITS\.put\('tmhours'/.test(WK));
t('the two look-backs are named constants, not literals buried at the call sites',
  TMM.TM_BOOK_DAYS === 365 && TMM.TM_TASK_DAYS === 21 && TMM.TM_BOOK_DAYS > TMM.TM_TASK_DAYS);

// the Brief Ledger — the register you go to for "what did this run of work come to"
{
  // WF is already read at module scope
  t('Brief Ledger carries an hours column, sortable like every other',
    /data-k="tmh"[^>]*>\u23f1 Hours</.test(WF) && /if\(k==='tmh'\)/.test(WF));
  t('…reading the SAME brief-id map the board card and the modal read',
    /function blHours\(b\)\{\s*\n?\s*var h=TMH\[b\.id\]/.test(WF));
  t('…showing the TOTAL with the split in its tooltip — the two are never merged away',
    /billable \\u00b7 '\+fmtH\(nb\)\+' non-billable/.test(WF));
  t('…and a DASH, never a zero, when no task carries the token yet',
    /class="tm-none"/.test(WF) && /\\u2014</.test(WF) && /token yet/.test(WF));
  t('…with the colspan of the empty row widened to match the new column',
    /colspan="9" class="it-empty"/.test(WF) && !/colspan="8" class="it-empty"/.test(WF));
}

t('gates: presync, qa_gate and validate.yml run this harness', /test_tmmcp\.mjs/.test(read('tools/presync.sh')) && /test_tmmcp\.mjs/.test(read('tools/qa_gate.sh')) && /test_tmmcp\.mjs/.test(read('.github/workflows/validate.yml')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
