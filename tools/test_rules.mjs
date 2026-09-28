// RULES + STOCK MANAGEMENT harness (pure node, CI-safe). Ray, 28 Sep 2026: "besides ROAS, let's
// try to bring other data points from FeedHero reports MCPs as well. For example, 'Rules' … I'm
// most interested in stock management related rules … The new module can be called rules and
// another is stock management - taking into consideration from rules".
//
// Pins the pure engine (src/rules.js) on rule NAME + FIELD shapes taken from the live rule report
// (28 Sep 2026 — the names are the team's own wording, which is exactly what the classifier reads;
// every count and date here is invented), then LIFTS rulesStore + rulesPull out of worker.js by
// name and runs them against an in-process stub MCP (pagination, the cmpid guard, the rotation,
// the honest failure states), then the wiring (routes, scope, cron split, budget, access, nav,
// migration twin), the two pages, the tripwire stub, and that no rule list is committed.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as R from '../cloudflare/feedspark-deck/src/rules.js';
import * as ROAS from '../cloudflare/feedspark-deck/src/roas.js';
import * as TMM from '../cloudflare/feedspark-deck/src/tmmcp.js';
import { MODULES } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const RP = read('docs/FeedSpark_Rules.html'), SP = read('docs/FeedSpark_Stock.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };
const NOW = Date.UTC(2026, 8, 28, 10);
let seq = 0;
const row = (name, db, o) => Object.assign({ rule_id: 'r' + (++seq), cmpid: 'monsoon_uk', company: 'Monsoon UK', rule_name: name, target_field: db, target_db: db, rule_type: 'User',
  batch_id: 'All products', runtime: '0.3 sec', impacted_items: '100 of 1,000', created_on: '10/10/2024 at 02:00 PM', created_by: 'A', modified_on: '', modified_by: '', rule_status: 'Active', rule_issues: [] }, o || {});
const one = (name, db, o) => R.normRule(row(name, db, o), 0);

console.log('· parsing — FeedHero formats everything for display');
t('"7,849 of 16,979" reads as {n, of}', JSON.stringify(R.parseImpact('7,849 of 16,979')) === JSON.stringify({ n: 7849, of: 16979 }));
t('an unreadable impact is null, never a guessed zero', R.parseImpact('-').n === null && R.parseImpact('').of === null);
t('runtime reads sec / secs / mins, "-" is null', R.parseRuntime('0.3 sec') === 0.3 && R.parseRuntime('12 secs') === 12 && R.parseRuntime('1 min 5 secs') === 65 && R.parseRuntime('-') === null);
t('"19/08/2021 at 12:22 PM" is day-first, 12-hour', R.parseWhen('19/08/2021 at 12:22 PM') === Date.UTC(2021, 7, 19, 12, 22) && R.parseWhen('01/02/2026 at 12:05 AM') === Date.UTC(2026, 1, 1, 0, 5));
t('an empty date is null (modified falls back to created)', R.parseWhen('') === null && one('x', 'product_name').mo === one('x', 'product_name').co);
t('FeedHero\'s own issue strings map to stable codes', JSON.stringify(R.issueCodes(['Not impacting any items', 'Target column missing', 'Dependent column missing'])) === JSON.stringify(['none', 'target', 'dep']));
t('"All products" batch is empty; a named batch is kept', one('x', 'title', { batch_id: 'All products' }).b === '' && one('x', 'title', { batch_id: 'Dresses' }).b === 'Dresses');
t('System / User', one('x', 'title', { rule_type: 'System' }).ty === 'S' && one('x', 'title').ty === 'U');

console.log('· stock classification — the rules Ray asked about, by the field they write and what their name says');
let r = one('Stock < 11 -> OOS', 'stock_quantity');
t('"Stock < 11 -> OOS" on stock_quantity = a stock threshold, cut-off stock < 11, reads quantity', r.fam === 'stock' && r.sk === 'threshold' && R.cutText(r.cut[0]) === 'stock < 11' && r.dr.indexOf('qty') >= 0);
r = one('Social: RC > 65% -> Out of stocj', 'social_availability');
t('"Social: RC > 65% -> Out of stocj" = availability, on Meta, cut-off RC > 65%', r.sk === 'avail' && r.ch === 'meta' && R.cutText(r.cut[0]) === 'RC > 65%' && r.dr.indexOf('rc') >= 0);
r = one('Empty < 0.26 RC Products', 'gb_cl2');
t('"Empty < 0.26 RC" on a Google label = a stock label, RC < 26% (a fraction read as a percentage)', r.fam === 'labels' && r.sk === 'label' && r.ch === 'google' && R.cutText(r.cut[0]) === 'RC < 26%');
r = one('Removing products with quantity with 3 or less', 'excluded_destination');
t('"…quantity with 3 or less" on an exclusion field = a stock exclusion, stock ≤ 3', r.fam === 'excl' && r.sk === 'excl' && R.cutText(r.cut[0]) === 'stock ≤ 3');
r = one('ADhoc [inclusion] for Hero Size - review weekly please', 'stock_status');
t('the ad-hoc hero-size inclusion = availability, tagged temporary AND a weekly review, reads hero sizes + a manual list', r.sk === 'avail' && r.tag.indexOf('temp') >= 0 && r.tag.indexOf('review') >= 0 && r.dr.indexOf('hero') >= 0 && r.dr.indexOf('manual') >= 0 && R.reviewDays(r.n) === 7);
t('LIA pickup fields = local inventory, Google', one('LIA: "Next Day"', 'pickup_sla').sk === 'local' && one('LIA: "Next Day"', 'pickup_sla').ch === 'google');
t('a store-code link = local inventory', one('Product URL with store code', 'url_store_code').sk === 'local');
t('an "older than 3 months" exclusion = lifecycle', one('exclusion', 'older_than_3_months').sk === 'life');
t('a pre-2024 exclusion = lifecycle', one('Pre 2024 Products Exclusion', 'pre_2024_exclusion').sk === 'life');
t('Olapic / Awin availability = availability, affiliates channel', one('Set Olapic Availability', 'olapic_avail').ch === 'aff' && one('Awin availability setup', 'awin_availability').sk === 'avail');
t('range completion / hero size fields = range completion', one('Range completion percentage calculation', 'rc_percent').sk === 'range' && one('Set hero sizes', 'is_hero_size').sk === 'range' && one('Ordering the Quantity', 'product_quantity_rank').sk === 'range');
t('a custom label is a stock label only when its NAME says stock', one('Stock Status', 'custom_label_3').sk === 'label' && one('Bestsellers', 'custom_label_3').sk === null);
t('a label named New In is lifecycle, not a stock label', one('CL3 -> New In', 'custom_label_3').sk === 'life');
t('an exclusion with no stock or age word is not a stock rule', one('Remove gift cards', 'excluded_destination').sk === null && one('Stock Exclusion except Jan Launch', 'meta_exclusion').sk === 'excl');
t('a title rule is not a stock rule', one('Copy Base title', 'product_name', { rule_type: 'System' }).sk === null && one('Copy Base title', 'product_name').fam === 'title');
t('"Add size to GPN if size not avail" writes a title — stays a title rule', one('Add size to GPN if size not avail', 'new_product_name_with_size_rules').sk === null);

console.log('· families, channels and tags');
t('field families: highlights, UTM, impressions, category levels', one('Copy All HLs into One', 'all_hls').fam === 'desc' && one('Define UTM for Shopping', 'utm_shopping').fam === 'links' && one('Set zero to empty impression', 'impressions_90_days').fam === 'perf' && one('Category - Get last level', 'cat_last_level').fam === 'taxonomy');
t('every family the classifier can return is listed on the page\'s legend (nothing hidden as "other")', ['title', 'desc', 'taxonomy', 'attr', 'ident', 'labels', 'price', 'stock', 'excl', 'media', 'links', 'kw', 'ship', 'perf', 'other'].every((k) => R.FAMILIES.some((f) => f.k === k)));
t('a *_temp target is a working column, not a temporary rule — only the NAME says temporary', one('copy', 'product_type_temp_fix').tag.indexOf('temp') < 0 && one('Temporary PT fix', 'product_type_temp_fix').tag.indexOf('temp') >= 0);
t('"One-off test for …" is temporary, not an A/B test', one("One-off test for Hobbycraft's team", 'url_store_code').tag.join() === 'temp');
t('A/B tests are named as such', ['AB Title Test - Brand at End', 'Title Material AB Test Rule 1', 'A/B Short title test (Bags)', 'Test Group - Title (Original vs. Shortened)', 'Titles test - AI Search Intent Rule 1'].every((n) => one(n, 'product_name').tag.indexOf('ab') >= 0) && one('testcopy', 'test').tag.indexOf('ab') < 0);
t('campaign rules are tagged, and a campaign year is read', one('FB CL0 - Black Friday 2025', 'fb_cl0').tag.indexOf('promo') >= 0 && R.yearIn('FB CL0 - Black Friday 2025') === 2025 && R.yearIn('Christmas') === null);

console.log('· one market — chains, duplicates, summary');
const mk = (list) => R.normRules(list.map((x, i) => row(x[0], x[1], Object.assign({ rule_id: 'm' + i }, x[2] || {}))));
const M = mk([
  ['Copy Base title', 'product_name', { rule_type: 'System', impacted_items: '1,000 of 1,000' }],
  ['Title colour', 'product_name', { modified_on: '20/09/2026 at 10:00 AM', modified_by: 'B' }],
  ['Title colour', 'product_name'],
  ['Stock < 11 -> OOS', 'stock_quantity', { impacted_items: '300 of 1,000' }],
  ['ADhoc [inclusion] for Hero Size - review weekly please', 'stock_status', { modified_on: '01/02/2026 at 10:00 AM' }],
  ['Old overlay', 'meta_image_link', { rule_issues: ['Target column missing'], impacted_items: '0 of 1,000' }],
  ['Valentine label', 'custom_label_1', { rule_issues: ['Not impacting any items'], impacted_items: '0 of 1,000' }],
  ['FB CL0 - Black Friday 2025', 'fb_cl0', { impacted_items: '949 of 1,000' }],
  ['Temporary PT fix', 'new_product_types', { created_on: '01/06/2025 at 09:00 AM' }],
  ['AB Title Test - Brand at End', 'google_product_name', { modified_on: '01/03/2026 at 09:00 AM' }],
  ['Guard 1', 'custom_label_3', { rule_issues: ['Not impacting any items'] }], ['Guard 2', 'custom_label_3', { rule_issues: ['Not impacting any items'] }], ['Guard 3', 'custom_label_3', { rule_issues: ['Not impacting any items'] }],
  ['T1', 'google_product_name'], ['T2', 'google_product_name'], ['T3', 'google_product_name'], ['T4', 'google_product_name'], ['T5', 'google_product_name'],
]);
t('rules keep FeedHero\'s run order', M.map((x) => x.i).join() === M.map((_, i) => i).join());
const ch = R.chains(M, 2);
t('chains = fields more than one rule writes, rules in run order, longest first', ch[0].d === 'google_product_name' && ch[0].rules.length === 6 && ch[0].rules.every((x, i, a) => !i || a[i - 1].i < x.i));
t('same name on the same field twice = a duplicate', R.duplicates(M).length === 1 && R.duplicates(M)[0][0].n === 'Title colour');
const sum = R.marketSummary(M, NOW);
t('summary counts system/user, idle, broken, stock, the catalogue size', sum.n === M.length && sum.sys === 1 && sum.iss.none === 4 && sum.iss.target === 1 && sum.stock.length === 2 && sum.items === 1000);
t('the last change and who made it', sum.last === Date.UTC(2026, 8, 20, 10) && sum.lastBy === 'B' && sum.changed30 === 1 && sum.recent[0].n === 'Title colour');
t('stock rows carry only what the Stock page reads', Object.keys(sum.stock[0]).sort().join() === 'b,ch,co,cut,d,dr,i,id,imp,iss,mb,mo,n,of,sk,t,tag,ty');

console.log('· rule hygiene findings');
const F = R.rulesFindings([{ client: 'Monsoon', market: 'GB', cmpid: 'monsoon_uk', rules: M }], NOW);
const kinds = F.map((f) => f.k);
['broken', 'review', 'promo', 'pastpromo', 'temp', 'ab', 'dormant', 'dupe', 'chain'].forEach((k) => t('finding "' + k + '" is raised', kinds.indexOf(k) >= 0, kinds.join(',')));
t('findings are worst first', F.every((f, i) => !i || F[i - 1].sev >= f.sev));
t('the weekly review left 8 months is act-now, and names its rule', F.filter((f) => f.k === 'review')[0].sev === 3 && F.filter((f) => f.k === 'review')[0].rules[0].n.indexOf('review weekly') >= 0);
t('a past year\'s campaign still labelling products counts them', /949 products/.test(F.filter((f) => f.k === 'pastpromo')[0].t));
t('every finding says where and why', F.every((f) => f.client === 'Monsoon' && f.market === 'GB' && f.why && f.t));
t('dormant needs 3+ idle rules — a lone idle guard is not a finding', !R.rulesFindings([{ client: 'X', market: 'GB', rules: mk([['Guard', 'custom_label_3', { rule_issues: ['Not impacting any items'] }]]) }], NOW).some((f) => f.k === 'dormant'));

console.log('· stock findings — per market and across a brand');
const idx = (client, market, list) => R.idxEntry({ client, market, cmpid: client.toLowerCase() + '_' + market.toLowerCase() }, mk(list), null, NOW);
const brand = [
  idx('Monsoon', 'GB', [['Stock < 11 -> OOS', 'stock_quantity'], ['Setup availability', 'stock_status'], ['LIA: "Next Day"', 'pickup_sla'], ['Broken stock', 'stock_status', { rule_issues: ['Dependent column missing'] }]]),
  idx('Monsoon', 'DE', [['Stock < 7 -> OOS', 'stock_quantity'], ['Setup availability', 'stock_status']]),
  idx('Monsoon', 'FR', [['Setup availability', 'stock_status'], ['Idle stock', 'stock_status', { rule_issues: ['Not impacting any items'] }]]),
];
const SF = R.stockFindings(brand, NOW), sk = SF.map((f) => f.k);
t('a broken stock rule is act-now', SF.some((f) => f.k === 'broken' && f.sev === 3 && f.market === 'GB'));
t('an idle stock rule is worth a look', sk.indexOf('dormant') >= 0);
t('a threshold untouched for a year is flagged stale', sk.indexOf('stale') >= 0);
t('GAP: two of three markets run stock thresholds, FR does not — named', SF.some((f) => f.k === 'gap' && f.mk === 'threshold' && f.market === 'FR'));
t('a control only ONE market runs is not a gap (no brand practice yet)', !SF.some((f) => f.k === 'gap' && f.mk === 'local'));
t('CUT-OFF: stock < 11 in GB vs < 7 in DE is named with both values', SF.some((f) => f.k === 'cutoff' && /< 7, < 11/.test(f.t)));
t('the matrix counts markets per mechanism per brand', R.stockMatrix(brand)[0].mech.avail === 3 && R.stockMatrix(brand)[0].mech.threshold === 2);
t('cut-offs are listed with the rule they came from', R.stockCutoffs(brand).length === 2 && R.stockCutoffs(brand).every((c) => /Stock </.test(c.rule)));
t('a market with no stock rules reads so, in words', /No stock rules/.test(R.stockSentence([])) && /Stock thresholds \(1 · stock < 11\)/.test(R.stockSentence(brand[0].stock)));

console.log('· the index entry, the brand table, the rotation');
const many = mk(Array.from({ length: 20 }, (_, i) => ['Guard ' + i, 'custom_label_3', { rule_issues: ['Not impacting any items'] }]));
const e = R.idxEntry({ client: 'Reiss', market: 'GB', cmpid: 'reiss_gb' }, many, { total: 311 }, NOW);
t('a market read in part says so (capped: 311 listed, fewer read)', e.capped === true && e.total === 311);
t('findings on the index keep FIND_KEEP rules and count the rest', e.find[0].rules.length === R.FIND_KEEP && e.find[0].more === 20 - R.FIND_KEEP);
const bo = R.brandsOf(brand);
t('brandsOf sums a brand\'s markets', bo.length === 1 && bo[0].markets === 3 && bo[0].broken === 1 && bo[0].idle === 1);
const roster = [{ cmpid: 'a' }, { cmpid: 'b' }];
t('rules are due while any market was never read', R.rulesDue({}, roster, NOW) === true);
t('…and not once every market is under a day old', R.rulesDue({ state: 'ok', rot: { a: NOW - 3600000, b: NOW - 7200000 } }, roster, NOW) === false);
t('…and due again past RULES_STALE_MS', R.rulesDue({ state: 'ok', rot: { a: NOW - R.RULES_STALE_MS - 1, b: NOW } }, roster, NOW) === true);
t('a failed firing backs off 3 hours — a rules error can never starve ROAS of the :40 slot', R.rulesDue({ state: 'error', at: NOW - 3600000, rot: {} }, roster, NOW) === false && R.rulesDue({ state: 'error', at: NOW - R.RULES_BACKOFF_MS - 1, rot: {} }, roster, NOW) === true);
t('budget: RULES_PULLS x (RULES_MAX_PAGES MCP + 2 KV) + 5 fits a ~50-subrequest firing', R.RULES_PULLS * (R.RULES_MAX_PAGES + 2) + 5 <= 50);

console.log('· the worker\'s pull, LIFTED from worker.js and run against a stub MCP');
const lift = (name) => { const a = WK.indexOf('async function ' + name + '('); const b = WK.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return WK.slice(a, b + 2); };
const W = new Function('RULES', 'ROAS', 'TMM', lift('rulesStore') + '\n' + lift('rulesPull') + '\nreturn { rulesStore, rulesPull };')(R, ROAS, TMM);
const kv = () => { const m = new Map(); return { m, EDITS: { get: async (k, ty) => (m.has(k) ? (ty === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } } }; };
const pageOf = (cmpid, n0, n, total, pages, extra) => ({ report: 'Rules', total_rows: total, page: 1, pages, rows: Array.from({ length: n }, (_, i) => row('Rule ' + (n0 + i), 'product_name', { cmpid })).concat(extra || []) });
{
  const k = kv(); const calls = [];
  const mcp = { auth: 'Authorization', host: 'mcp.feedhero.net', call: async (tool, a) => { calls.push([tool, a.company, a.page]); if (a.company === 'reiss_gb') return pageOf('reiss_gb', (a.page - 1) * 200, a.page < 2 ? 200 : 111, 311, 2); return pageOf(a.company, 0, 3, 3, 1, [row('INTRUDER', 'product_name', { cmpid: 'someone_else' })]); } };
  const env = Object.assign({ ROAS_MCP_TOKEN: 'x' }, { EDITS: k.EDITS });
  const s = await W.rulesPull(env, { mcp, now: NOW, pulls: 60 });
  t('the pull reads every roster market with rule_report and nothing else', s.state === 'ok' && calls.every((c) => c[0] === 'rule_report') && new Set(calls.map((c) => c[1])).size === ROAS.rosterList().length);
  t('a market past one page is read page by page (Reiss GB 311 = 2 pages)', calls.filter((c) => c[1] === 'reiss_gb').length === 2 && JSON.parse(k.m.get('rules:reiss_gb')).rules.length === 311);
  t('a row whose cmpid is not the market is dropped — the company filter can never widen the roster', JSON.parse(k.m.get('rules:superdry_gb')).rules.every((x) => x.n !== 'INTRUDER'));
  const ix = JSON.parse(k.m.get('rulesidx'));
  t('the index carries every read market, keyed by cmpid, only roster cmpids', Object.keys(ix).length === ROAS.rosterList().length && Object.keys(ix).every((c) => ROAS.cmpidBrand(c)));
  t('status: read/total, the rotation stamps, the markets pulled', s.read === ROAS.rosterList().length && s.total === ROAS.rosterList().length && s.rot.reiss_gb === NOW && /Reiss GB \(311\)/.test(s.pulled.join()));
  const s2 = await W.rulesPull(env, { mcp, now: NOW + 60000, pulls: 3 });
  t('the rotation takes the stalest markets first', s2.pulled.length === 3);
}
{
  const k = kv();
  const s = await W.rulesPull({ EDITS: k.EDITS }, { now: NOW });
  t('no token → no_token, stored, nothing pulled', s.state === 'no_token' && JSON.parse(k.m.get('rulesstatus')).state === 'no_token');
  const e401 = Object.assign(new Error('unauthorized (HTTP 401)'), { code: 'unauthorized' });
  const s2 = await W.rulesPull({ ROAS_MCP_TOKEN: 'x', EDITS: k.EDITS }, { now: NOW, mcp: { call: async () => { throw e401; } } });
  t('a refused token → unauthorized, a failure counted', s2.state === 'unauthorized' && s2.fails === 1);
  const s3 = await W.rulesPull({ ROAS_MCP_TOKEN: 'x', EDITS: k.EDITS }, { now: NOW, mcp: { call: async () => { throw new Error('fetch failed'); } } });
  t('an unreachable server → unreachable, and the index is not overwritten', s3.state === 'unreachable' && !k.m.has('rulesidx'));
}

console.log('· worker wiring');
t('engine + both pages imported, both routes in PAGES', /import \* as RULES from "\.\/rules\.js"/.test(WK) && /FeedSpark_Rules\.html/.test(WK) && /FeedSpark_Stock\.html/.test(WK) && /'\/rules':\s+\{ html: RULES_MOD_PAGE, slug: 'rules' \}/.test(WK) && /'\/stock':\s+\{ html: STOCK_PAGE,\s+slug: 'stock' \}/.test(WK));
t('/api/rules + /api/rules/stock are served, scoped per signin like /api/roas', /path === '\/api\/rules' \|\| path === '\/api\/rules\/stock'/.test(WK) && /inScope = \(name\) => acc\.owner \|\| clientMatch\(acc\.clients, name\)/.test(WK));
t('sync-now is owner-only and capped at 6 markets a call', /'\/api\/rules' && url\.searchParams\.get\('pull'\)\)\s*\{\s*if \(!realOwner\(env, request\)\)/.test(WK) && /rulesPull\(env, \{ pulls: Math\.min\(6,/.test(WK));
t('the book keeps roster cmpids only', /&& ROAS\.cmpidBrand\(r\.cmpid\)\)/.test(WK));
t('rule_report is read page by page at FeedHero\'s ceiling, and only this market\'s rows are kept', /mcp\.call\('rule_report', \{ company: m\.cmpid, page: p, page_size: RULES\.RULES_PAGE \}\)/.test(WK) && /if \(r && r\.cmpid === m\.cmpid\) rows\.push\(r\)/.test(WK));
t('the :40 half of the ROAS firing goes to rules while they are due — the ROAS firing itself is untouched', /event\.cron === '10,40 \* \* \* \*'/.test(WK) && /getUTCMinutes\(\)/.test(WK) && /mi >= 30 && RULES\.rulesDue\(/.test(WK) && /await roasPull\(env\)/.test(WK));
t('the same token as ROAS — no second FeedHero credential', /if \(!env\.ROAS_MCP_TOKEN\) return save\(Object\.assign\(st, \{ state: 'no_token', error: 'ROAS_MCP_TOKEN not set — the rules read/.test(WK) && !/RULES_MCP_TOKEN/.test(WK));
t('both modules are grantable in the 👥 Access panel', MODULES.some((m) => m.slug === 'rules' && m.path === '/rules') && MODULES.some((m) => m.slug === 'stock' && m.path === '/stock'));
t('both have a migration state (twin of the /migration board)', MIG_SEED.some((m) => m.p === '/rules') && MIG_SEED.some((m) => m.p === '/stock'));

console.log('· the pages');
const navOf = (h) => (h.match(/<nav class="tb-nav tb-modules"[\s\S]*?<\/nav>/) || [''])[0];
t('every nav-bearing page carries both module icons, after ROAS', fs.readdirSync(new URL('../docs/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => read('docs/' + f)).filter((h) => /class="tb-nav tb-modules"/.test(h)).every((h) => /href="\/roas"[\s\S]*?<\/a><a href="\/rules" class="tbm[^"]*"[\s\S]*?<\/a><a href="\/stock" class="tbm/.test(navOf(h))));
t('each page lights its own icon only', /href="\/rules" class="tbm on"/.test(RP) && !/href="\/stock" class="tbm on"/.test(RP) && /href="\/stock" class="tbm on"/.test(SP) && !/href="\/rules" class="tbm on"/.test(SP));
[['Rules', RP], ['Stock', SP]].forEach(([n, h]) => {
  t(n + ': loads the shared design stylesheet', h.indexOf('<link rel="stylesheet" href="/design/fcc.css">') >= 0);
  t(n + ': a <select id="brand"> so the hours badge follows it', /<select class="fld" id="brand"/.test(h));
  t(n + ': ⚡ Sync now, ⬇ CSV, a search box, a source line', /id="sync-now"/.test(h) && /id="csv"/.test(h) && /id="q" type="search"/.test(h) && /id="mstate"/.test(h));
  t(n + ': the explainer folds behind ⓘ (data-instr)', /<p class="sub" data-instr>/.test(h));
  t(n + ': says the report carries no rule conditions', /does not carry a rule's conditions/.test(h));
  t(n + ': no closing body/script tag inside the script (the worker injects at the first </body>)', (() => { const s = h.slice(h.indexOf('<script>\n(function')); const body = s.slice(0, s.lastIndexOf('</script>')); return body.indexOf('</body>') < 0 && body.slice(8).indexOf('</script') < 0; })());
  t(n + ': the shared helpers live inside the page\'s closure (no global $)', /<script>\n\(function \(\) \{\n\/\* ---- shared by \/rules and \/stock/.test(h));
  t(n + ': never hides a control on the phone', !/@media[^{]*\{[^}]*\.(ctl|btn|q|chip)[^{]*\{[^}]*display:none/.test(h));
});
t('Rules: the market drill reads ONE market off /api/rules?client=&market=', /api\('\/api\/rules\?client=' \+ encodeURIComponent\(client\) \+ '&market='/.test(RP));
t('Rules: family bars, findings by severity, the markets table, the 30-day log', /id="fams"/.test(RP) && /id="sevs"/.test(RP) && /id="mk-table"/.test(RP) && /id="recent"/.test(RP));
t('Stock: coverage matrix, findings, cut-offs, each market\'s setup', /id="cov"/.test(SP) && /id="finds"/.test(SP) && /id="cuts"/.test(SP) && /id="setups"/.test(SP) && /api\('\/api\/rules\/stock'/.test(SP));
t('Stock: a cut-off is shown as what the NAME states', /name states/.test(SP) && /read from the name/i.test(SP));

console.log('· the rule inside FeedHero — every rule pops out to its own row on FeedHero\'s site');
// the two links FeedHero's OWN MCP handed back on 28 Sep 2026 for a filtered rule_report (its web_url)
const FH_REAL_1 = 'https://mcp.feedhero.net/reports/rule-report?company=monsoon_uk&f%5Brule_name%5D=Stock+%3C+11';
const FH_REAL_2 = 'https://mcp.feedhero.net/reports/rule-report?company=monsoon_uk&f%5Brule_name%5D=LIA%3A+%22Next+Day%22&f%5Btarget_field%5D=Pickup+SLA';
t('the engine builds FeedHero\'s own link byte for byte (name only)', R.feedheroUrl('monsoon_uk', 'Stock < 11') === FH_REAL_1);
t('…and with the target field (quotes, colon, spaces encoded as FeedHero encodes them)', R.feedheroUrl('monsoon_uk', 'LIA: "Next Day"', 'Pickup SLA') === FH_REAL_2);
t('a field alone opens every rule writing it; nothing opens the market\'s whole report', R.feedheroUrl('reiss_gb', null, 'Product name') === 'https://mcp.feedhero.net/reports/rule-report?company=reiss_gb&f%5Btarget_field%5D=Product+name' && R.feedheroUrl('reiss_gb') === 'https://mcp.feedhero.net/reports/rule-report?company=reiss_gb');
const liftFn = (h, name) => { const a = h.indexOf('function ' + name + '('); const b = h.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return h.slice(a, b + 2); };
const liftVar = (h, name) => { const m = new RegExp('var ' + name + " = '[^']*';").exec(h); if (!m) throw new Error('cannot lift ' + name); return m[0]; };
const FH_IN = [['monsoon_uk', 'Stock < 11'], ['monsoon_uk', 'LIA: "Next Day"', 'Pickup SLA'], ['reiss_gb', null, 'Product name'], ['reiss_gb'], ['superdry_gb', 'ADhoc [inclusion] for Hero Size - review weekly please', 'Availability'], ['schuh_uk_1', 'Title & Material — A/B test (Rule 1)', 'New Product Name with Size Rules'], ['accessorize_uk', 'Removing products with quantity with 3 or less', 'Excluded destination']];
[['Rules', RP], ['Stock', SP]].forEach(([n, h]) => {
  const fhUrl = new Function(liftVar(h, 'FEEDHERO_REPORT') + '\n' + liftFn(h, 'fhUrl') + '\nreturn fhUrl;')();
  t(n + ': the page twin fhUrl builds the SAME link as the engine on every input (incl. the two real ones)', FH_IN.every((a) => fhUrl.apply(null, a) === R.feedheroUrl.apply(null, a)) && fhUrl('monsoon_uk', 'Stock < 11') === FH_REAL_1);
  t(n + ': the pop-out is a new tab, never a navigation away from the FCC', /class="fh' \+ \(label \? ' lbl' : ''\) \+ '" href="' \+ esc\(fhUrl\(cmpid, name, field\)\) \+ '" target="_blank" rel="noopener"/.test(h));
  t(n + ': every CSV carries the FeedHero link beside the rule', /'FeedHero link'/.test(h) && /fhUrl\(/.test(h.slice(h.indexOf('csvDownload('))));
});
t('Rules: a button on every rule surface — the market\'s rule list, its chains (each rule + the whole chain), findings (each rule + each chained field), the 30-day log, the markets table, the market header',
  /<b>' \+ esc\(r\.n\) \+ '<\/b> ' \+ fhA\(d\.cmpid, r\.n, r\.t\)/.test(RP) && /fhA\(d\.cmpid, r\.n, r\.t\) \+ '<\/li>'/.test(RP) && /fhA\(d\.cmpid, null, c\.t, 'All '/.test(RP)
  && /fhA\(r\.cmpid \|\| f\.cmpid, r\.n, r\.t\)/.test(RP) && /fhA\(f\.cmpid, null, x\.t\)/.test(RP) && /fhA\(x\.m\.cmpid, x\.r\.n, x\.r\.t\)/.test(RP) && /fhA\(m\.cmpid\)/.test(RP) && /\$\('#d-fhw'\)\.innerHTML = fhA\(d\.cmpid, null, null,/.test(RP));
t('Rules: a click on the pop-out is the browser\'s — the clickable row under it never also opens', /if \(e\.target\.closest\('a\.fh'\)\) return;[^\n]*\n\s*var o = e\.target\.closest\('\[data-open\]'\);/.test(RP));
t('Stock: a button on every stock rule — the setup tables, the cut-offs table, the findings, and each market\'s whole list',
  /<b>' \+ esc\(r\.n\) \+ '<\/b> ' \+ fhA\(m\.cmpid, r\.n, r\.t\)/.test(SP) && /esc\(c\.rule\) \+ ' ' \+ fhA\(c\.cmpid, c\.rule, c\.t\)/.test(SP) && /fhA\(r\.cmpid \|\| f\.cmpid, r\.n, r\.t\)/.test(SP) && /fhA\(m\.cmpid, null, null, 'All '/.test(SP));
{
  const cuts = R.stockCutoffs(brand), cf = R.stockFindings(brand, NOW).filter((f) => f.k === 'cutoff')[0];
  t('a cut-off row carries the target field its link narrows on', cuts.every((c) => c.t && c.cmpid));
  t('a brand-level cut-off finding names each rule\'s own market id, so its pop-out lands on the right market', cf && cf.rules.every((r) => r.cmpid && r.t && r.market));
}

console.log('· the tripwire stub + nothing in git');
const stub = require('./rules_stub.js').build();
t('stub: the book shape the page reads (markets without stock rows, with sn)', stub.book.markets.length === 3 && stub.book.markets.every((m) => m.sn > 0 && !m.stock && !m.find) && stub.book.findings.length > 0);
t('stub: the stock shape (sentence per market, matrix, cut-offs)', stub.stock.markets.every((m) => m.sentence && m.stock.length) && stub.stock.cutoffs.length > 0 && stub.stock.matrix.length === 2);
t('both browser tripwires feed the stub and inline /design/fcc.css', ['tools/check_mobile.js', 'tools/check_darkmode.js'].every((p) => { const s = read(p); return /rules_stub\.js/.test(s) && /\$\{RULES_STUB\}/.test(s) && /withFccCss\(/.test(s); }));
const tracked = execSync('git ls-files', { cwd: new URL('..', import.meta.url) }).toString().split('\n').filter((f) => /\.(json|txt|csv|md|html|js|mjs)$/.test(f));
const leaks = tracked.filter((f) => { try { return /"impacted_items"\s*:|"rule_issues"\s*:/.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')); } catch (e2) { return false; } });
t('no rule_report payload is committed anywhere (KV only)', leaks.length === 0, leaks.join(', '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
