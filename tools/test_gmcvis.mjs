#!/usr/bin/env node
/*
 * GMC competitive visibility (Ray, 2 Nov 2026: "You can now start importing competitors on Google Shopping
 * via the new data from Google Merchant Center. Inside [FeedHero] MCP, you can see GMC visibility and bring
 * in whatever is necessary").
 *
 * Pins: the engine (src/gmcvis.js) on rows SHAPED like FeedHero's gmc_visibility answer — the visibility
 * words, the rank ceiling read as "5 or lower", the per-account rows filtered to a market's own country
 * (and a country the account does not report saying so), the plan (never-read first, a fresh read never
 * repeated), the signals; then gmcPull and the /api/gmcvis route LIFTED out of worker.js against a stub MCP
 * + a stub KV; then the wiring (the cron branch, the Test Lab merge, the rail).
 * Every domain here is invented — competitor domains are client data and never go in git.
 *
 * Run: node tools/test_gmcvis.mjs
 */
import fs from 'node:fs';
import * as GMC from '../cloudflare/feedspark-deck/src/gmcvis.js';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const WF = read('docs/FeedSpark_Workflow.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + JSON.stringify(why).slice(0, 300) : '')); } };
const HOUR = 3600000, NOW = Date.UTC(2026, 10, 2, 10);

// rows in the shape the MCP answers with (client = <cmpid>): every figure invented
const row = (o) => Object.assign({ country: 'GB', category: 'Apparel & Accessories', rank: '5', ads_ratio: '96', top_competitor: 'northwind.example', top_rank: '1', visibility: '+5%', higher: '48', overlap: '6', competitors: '9', checked: '2026-11-02 09:45', note: '' }, o);
const ACCOUNT = { // one multi-country account, as Reiss's is
  all: [row({}), row({ category: 'Home & Garden', ads_ratio: '100', top_competitor: 'harbour.example', visibility: '>+1,000%', higher: '70', overlap: '73', competitors: '4' }),
    row({ country: 'US', ads_ratio: '33', top_competitor: 'linden.example', visibility: '+700%', higher: '21', overlap: '38', competitors: '4' })],
  organic: [row({ ads_ratio: '96', top_competitor: 'atelier.example', visibility: '+25%', higher: '56', overlap: '11' }), row({ country: 'US', ads_ratio: '0', top_competitor: 'linden.example', visibility: '+800%', overlap: '50' })],
  ads: [row({ top_competitor: 'tidewater.example', higher: '61' }), row({ country: 'US', rank: '1', ads_ratio: '100', top_competitor: '', top_rank: '', visibility: '', higher: '', overlap: '', competitors: '0' })],
};
const payload = (rows) => ({ report: 'GMC Visibility', total_rows: rows.length, rows });

console.log('── the visibility words');
t('"+5%" is five per cent more visible', JSON.stringify(GMC.visPct('+5%')) === '{"v":5,"t":"+5%"}');
t('">+1,000%" is a floor, kept as one', GMC.visPct('>+1,000%').v === 1000 && GMC.visPct('>+1,000%').gt === true);
t('"Within 2.5%" is level, never a number', GMC.visPct('Within 2.5%').within === true && GMC.visPct('Within 2.5%').v === 0);
t('a minus is a minus; nothing is nothing', GMC.visPct('-20%').v === -20 && GMC.visPct('') === null && GMC.visPct(null) === null && GMC.visPct('n/a') === null);

console.log('── the rows');
const all = GMC.normMarkets(ACCOUNT.all);
t('each row becomes a market: country, category, rank, the paid share, the one top competitor, the count of the rest', all.length === 3 && all[0].c === 'GB' && all[0].cat === 'Apparel & Accessories' && all[0].rank === 5 && all[0].ads === 96 && all[0].top.d === 'northwind.example' && all[0].top.rank === 1 && all[0].top.higher === 48 && all[0].top.overlap === 6 && all[0].n === 9);
const noTop = GMC.normMarkets(ACCOUNT.ads)[1];
t('a market with no competitor has none — never an empty one', noTop.top === null && noTop.n === 0 && noTop.rank === 1);
t('a row with no country is not a market', GMC.normMarkets([row({ country: '' }), { note: 'x' }, null]).length === 0);
t('a domain is read bare: scheme and www dropped, lower-cased', GMC.normMarkets([row({ top_competitor: 'https://WWW.Northwind.Example' })])[0].top.d === 'northwind.example');
t('the rank the source reads on almost every market is read as a ceiling, never an exact fifth', GMC.rankWord(5) === '5 or lower' && GMC.rankWord(2) === '2' && GMC.rankWord(null) === '–');

console.log('── the record, the plan');
const M = { client: 'Reiss', market: 'GB', cmpid: 'reiss_gb' };
const rec = GMC.makeRecord(M, { all: payload(ACCOUNT.all), organic: payload(ACCOUNT.organic), ads: payload(ACCOUNT.ads) }, NOW);
t('a record keeps all three sources, the source’s own check time, no note when there is data', rec.src.all.length === 3 && rec.src.organic.length === 2 && rec.src.ads.length === 2 && rec.checked === '2026-11-02 09:45' && rec.note === '' && rec.at === NOW);
const emptyRec = GMC.makeRecord({ client: 'Superdry', market: 'IT', cmpid: 'superdry_it' }, { all: payload([]), organic: payload([]), ads: payload([]) }, NOW);
t('an account that answers nothing is stored WITH the reason, never as "no competitors"', /No visibility data/.test(emptyRec.note) && emptyRec.src.all.length === 0);
const roster = [{ cmpid: 'a' }, { cmpid: 'b' }, { cmpid: 'c' }, { cmpid: 'd' }].map((m) => Object.assign({ client: 'X', market: 'GB' }, m));
const store = { a: { at: NOW - 30 * HOUR }, b: { at: NOW - 2 * HOUR }, d: { at: NOW - 25 * HOUR } };
const plan = GMC.gmcPlan(roster, store, 3, NOW).map((m) => m.cmpid);
t('the plan reads a never-read company first, then the stalest, and never one read inside a day', plan.join() === 'c,a,d');
t('two a firing by default, and 48 firings cover the whole 56-market roster many times over', GMC.GMC_PULLS === 2 && 48 * GMC.GMC_PULLS >= ROAS.rosterList().length);

console.log('── a market sees its own country');
t('a roster label resolves to the country the source reports it under', GMC.ccOf('GB') === 'GB' && GMC.ccOf('BE-FR') === 'BE' && GMC.ccOf('UAE') === 'AE' && GMC.ccOf('CA-EN') === 'CA' && GMC.ccOf('EU') === null);
const rl = ROAS.rosterList();
t('a wired feed code finds its roster company, case and dashes aside', GMC.cmpidFor(rl, 'Superdry', 'befr').cmpid === 'superdry_befr' && GMC.cmpidFor(rl, 'reiss', 'ie').cmpid === 'reiss_ie_pla' && GMC.cmpidFor(rl, 'Monsoon', 'gb').cmpid === 'monsoon_uk' && GMC.cmpidFor(rl, 'Northwind', 'gb') === null);
const gb = GMC.marketView(rec, 'GB'), us = GMC.marketView(rec, 'US'), de = GMC.marketView(rec, 'DE');
t('GB sees only GB rows, US only US', gb.src.all.length === 2 && gb.src.all.every((r) => r.c === 'GB') && us.src.all.length === 1 && us.src.all[0].c === 'US');
t('a country the account does not report has nothing, and the view names what it does report', de.has === false && de.countries.join() === 'GB,US');
t('a market with no single country (EU) reads nothing rather than every country', GMC.marketView(rec, null).has === false);
t('a company never read has no view', GMC.marketView(null, 'GB') === null);

console.log('── the signals');
const sg = GMC.gmcSignals(gb), byK = {}; sg.forEach((s) => { byK[s.k] = s.why; });
t('a competitor far more visible on most of the same pages promotes the keyword test, naming it, the category and the figures', /harbour\.example is over 11× as visible as you in Home & Garden and shows on 73% of the same pages/.test(byK.kw_theme || ''));
t('a competitor above you on most shared pages promotes the performance label', /harbour\.example sits above you 70% of the time/.test(byK.cl_perf || ''));
t('visibility that is almost all paid promotes the title test — free listings read the feed', /100% of your visibility in Home & Garden is paid and the free listings report no Home & Garden market/.test(byK.title_mask || ''));
t('with no free-listings read at all the paid signal claims nothing about free listings', (() => { const v = GMC.marketView(GMC.makeRecord(M, { all: payload([row({ ads_ratio: '95' })]), organic: payload([]), ads: payload([]) }, NOW), 'GB'); const s = GMC.gmcSignals(v).find((x) => x.k === 'title_mask'); return s && !/free listings report no/.test(s.why); })());
t('a market that is level or small raises nothing', GMC.gmcSignals(GMC.marketView(GMC.makeRecord(M, { all: payload([row({ visibility: 'Within 2.5%', higher: '10', ads_ratio: '40' })]), organic: payload([]), ads: payload([]) }, NOW), 'GB')).length === 0);
t('no data, no signals', GMC.gmcSignals(de).length === 0 && GMC.gmcSignals(null).length === 0);
t('every signal names a test the library has', (() => { const tl = read('cloudflare/feedspark-deck/src/testlab.js'); return sg.every((s) => tl.indexOf("k: '" + s.k + "'") >= 0); })());
const ss = GMC.storeStatus(roster, { a: { at: NOW - HOUR, src: { all: [1] } }, b: { at: NOW - 30 * HOUR, src: {} } }, NOW);
t('the status counts read, fresh and empty across the roster', ss.total === 4 && ss.read === 2 && ss.fresh === 1 && ss.empty === 1);

console.log('── gmcPull, lifted out of worker.js against a stub MCP + KV');
function liftFn(name) {
  const start = WK.indexOf('async function ' + name + '(');
  let depth = 0, end = -1;
  for (let i = WK.indexOf('{', start); i < WK.length; i++) { const ch = WK[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } } }
  return start > 0 && end > start ? WK.slice(start, end) : '';
}
function liftBlock(mark) {
  const start = WK.indexOf(mark);
  let depth = 0, end = -1;
  for (let i = WK.indexOf('{', start); i < WK.length; i++) { const ch = WK[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } } }
  return start > 0 && end > start ? WK.slice(start, end) : '';
}
const src = liftFn('gmcPull');
t('gmcPull is found', src.length > 400);
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const mkPull = (roasMcp) => new Function('ROAS', 'GMC', 'roasMcp', 'fetch', src + '\nreturn gmcPull;')(ROAS, GMC, roasMcp, async () => { throw new Error('no network'); });
function kvStub() { const m = new Map(); let puts = 0; return { m, get puts() { return puts; }, async get(k, type) { const v = m.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; }, async put(k, v) { puts++; m.set(k, v); }, async delete(k) { m.delete(k); } }; }
function mcpStub(opts) {
  opts = opts || {}; const calls = [];
  return { calls, auth: 'Authorization', host: 'mcp.example', inits: 0,
    async init() { this.inits++; if (opts.unauth) { const e = new Error('unauthorized (HTTP 401)'); e.code = 'unauthorized'; throw e; } },
    async call(name, args) {
      calls.push(name + ':' + args.client + ':' + args.source);
      if (opts.failAfter != null && calls.length > opts.failAfter) { const e = new Error('HTTP 503'); e.code = 'unreachable'; throw e; }
      return payload(ACCOUNT[args.source] || []);
    } };
}
let KV = kvStub(), mcp = mcpStub();
const pull = mkPull(() => mcp);
let r = await pull({ EDITS: KV }, { now: NOW });
t('no token: nothing is called and the reason is said', r.state === 'no_token' && mcp.calls.length === 0 && KV.puts === 0);
const env = { EDITS: KV, ROAS_MCP_TOKEN: 'tok' };
r = await pull(env, { now: NOW, mcp });
const st1 = JSON.parse(KV.m.get('gmcvis'));
t('a firing reads GMC_PULLS companies, three sources each, and stores them in ONE key with ONE put', r.state === 'ok' && mcp.calls.length === 6 && mcp.calls.every((c) => /^gmc_visibility:/.test(c)) && KV.puts === 1 && Object.keys(st1).length === 2);
t('the session passed in is used, never re-opened', mcp.inits === 0);
const first = Object.keys(st1);
r = await pull(env, { now: NOW + HOUR, mcp });
const st2 = JSON.parse(KV.m.get('gmcvis'));
t('the next firing moves on to the next companies and never re-reads a fresh one', Object.keys(st2).length === 4 && mcp.calls.slice(6).every((c) => first.every((f) => c.indexOf(':' + f + ':') < 0)));
t('the status it answers counts the roster', r.total === ROAS.rosterList().length && r.read === 4);
r = await pull(env, { now: NOW + 2 * HOUR, mcp, only: 'monsoon_uk' });
t('only: one named company is read whatever its age', mcp.calls.slice(-3).every((c) => /:monsoon_uk:/.test(c)) && JSON.parse(KV.m.get('gmcvis')).monsoon_uk.client === 'Monsoon');
KV = kvStub(); const env2 = { EDITS: KV, ROAS_MCP_TOKEN: 'tok' };
const flaky = mcpStub({ failAfter: 3 });
r = await mkPull(() => flaky)(env2, { now: NOW, mcp: flaky });
t('a source failing mid-firing keeps what was read whole and says why', r.state === 'unreachable' && Object.keys(JSON.parse(KV.m.get('gmcvis'))).length === 1 && r.pulled.length === 1);
const bad = mcpStub({ unauth: true }); KV = kvStub();
r = await mkPull(() => bad)({ EDITS: KV, ROAS_MCP_TOKEN: 'tok' }, { now: NOW });
t('a refused token is "unauthorized", nothing stored', r.state === 'unauthorized' && !KV.m.has('gmcvis'));

console.log('── /api/gmcvis, lifted');
const rb = liftBlock("  if (path === '/api/gmcvis' && request.method === 'GET') {");
t('the route is found', rb.length > 400);
const routeFn = new AsyncFn('path', 'url', 'request', 'env', 'ctx', 'accessOf', 'clientMatch', 'clientSlug', 'realOwner', 'json', 'logActivity', 'ROAS', 'GMC', 'gmcPull', rb + '\nreturn null;');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const jsonR = (d, s) => new Response(JSON.stringify(d), { status: s || 200, headers: { 'content-type': 'application/json' } });
KV = kvStub();
await KV.put('gmcvis', JSON.stringify({ reiss_gb: rec, reiss_de: Object.assign({}, rec, { cmpid: 'reiss_de', market: 'DE' }) }));
const pulls = [];
async function call(p, acc0, owner) {
  const url = new URL('https://x' + p);
  const res = await routeFn(url.pathname, url, new Request(url), { EDITS: KV, ROAS_MCP_TOKEN: 'tok' }, {}, async () => acc0 || { clients: null }, (cl, n) => !cl || cl.indexOf(n) >= 0, slug,
    () => !!owner, jsonR, () => {}, ROAS, GMC, async (e, o) => { pulls.push(o); return { state: 'ok', pulled: ['x'] }; });
  return { status: res.status, body: await res.json() };
}
let c = await call('/api/gmcvis');
t('GET with no client: the status across the roster', c.body.ok && c.body.total === ROAS.rosterList().length && c.body.read === 2 && c.body.on === true);
c = await call('/api/gmcvis?client=Reiss');
const gbm = c.body.markets.find((m) => m.market === 'GB'), dem = c.body.markets.find((m) => m.market === 'DE'), usm = c.body.markets.find((m) => m.market === 'US');
t('?client= lists every roster market, each its own country’s rows and signals', c.body.markets.length === ROAS.ROAS_ROSTER.Reiss.length && gbm.view.src.all.length === 2 && gbm.signals.length === 3 && dem.view.has === false && usm.view === null);
c = await call('/api/gmcvis?client=Reiss', { clients: ['Schuh'] });
t('scope: a brand outside the signin is refused', c.status === 403);
c = await call('/api/gmcvis?pull=2');
t('read now is the owner’s alone', c.status === 403 && pulls.length === 0);
c = await call('/api/gmcvis?pull=9', null, true);
t('the owner’s read is capped at four a call', c.body.ok && pulls[0].pulls === 4);
c = await call('/api/gmcvis?pull=1&cmpid=not_ours', null, true);
t('a company off the roster is never read', c.status === 400 && pulls.length === 1);

console.log('── the wiring');
t('the worker imports the engine', /import \* as GMC from "\.\/gmcvis\.js"/.test(WK));
t('the ROAS firing opens ONE session and hands it to both reads; a rules firing carries none',
  /await roasPull\(env, mcp \? \{ mcp \} : \{\}\);\s*\n\s*if \(mcp\) await gmcPull\(env, \{ mcp \}\);/.test(WK) && /rulesDue\([\s\S]{0,120}await rulesPull\(env\); return; \}/.test(WK));
t('/api/gmcvis is a rail path, dispatched through railRoutes', /RAIL_PATHS = new Set\(\[[^\]]*'\/api\/gmcvis'/.test(WK) && WK.indexOf("path === '/api/gmcvis'") > WK.indexOf('async function railRoutes('));
t('the Test Lab reads the store once and files its signals as gmc', /env\.EDITS\.get\('gmcvis', 'json'\)/.test(WK) && /addSig\(f\.mkt, 'gmc', sg\)/.test(WK));
t('the rail draws the block between the Shopping read and Auction Insights, in both states', (WF.match(/secGmc\(m,r(?:&&r)?\.gmc,brand,cw\)/g) || []).length === 2 && /function secGmc\(m,g,brand,cw\)/.test(WF));
t('the rail reads the ceiling as "5 or lower" and says what an unreported country is', /r>=5\?'5 or lower'/.test(WF) && /Merchant Center reports no '\+g\.cc\+' market for this account/.test(WF));
t('the rail shows free listings apart from all traffic and Shopping ads', /organic:'Free listings'/.test(WF) && /ads:'Shopping ads'/.test(WF));
const REAL = ['coleandharrison', 'nobodyschild', 'anthropologie', 'ambrosewilson', 'jonesbootmaker', 'affordablegolf', 'lisaangel', 'johnlewis.com', 'groundedfeet', 'trooplondon'];
t('no competitor domain read off a live account is committed', REAL.every((d) => [read('cloudflare/feedspark-deck/src/gmcvis.js'), read('tools/test_gmcvis.mjs').replace(/const REAL = \[[^\]]*\]/, '')].every((f) => f.indexOf(d) < 0)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
