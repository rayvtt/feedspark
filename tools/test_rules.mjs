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
t('range completion fields (RC %, colour depth, quantity rank) = range completion', one('Range completion percentage calculation', 'rc_percent').sk === 'range' && one('Ordering the Quantity', 'product_quantity_rank').sk === 'range' && one('Set colour stock', 'colour_stock').sk === 'range');
// HERO SIZES (Ray, 28 Sep 2026: "add hero sizes in the stock control for each market … because
// it's different from range completion") — split into its own mechanism, read from the field first
r = one('Set hero sizes', 'is_hero_size');
t('a hero-size field is its OWN mechanism, not range completion', r.sk === 'hero' && r.fam === 'stock' && r.sk !== 'range');
t('the name alone can also say hero sizes, on a field with no "hero_size" in it', one('Flag the Hero Sizes for AW26', 'new_size_flag_v2').sk === 'hero');
t('a field that only reads hero sizes as a DRIVER (writes availability) stays availability — the mechanism is what a rule WRITES, the driver is what its name says it READS', one('ADhoc [inclusion] for Hero Size - review weekly please', 'stock_status').sk === 'avail');
t('MECHANISMS lists Hero sizes as its own entry, split from Range completion, and every mechanism the classifier can return is on it', R.MECHANISMS.some((m) => m.k === 'hero' && m.label === 'Hero sizes') && !/hero/i.test((R.MECHANISMS.find((m) => m.k === 'range') || {}).q) && ['avail', 'threshold', 'range', 'hero', 'label', 'excl', 'local', 'life'].every((k) => R.MECHANISMS.some((m) => m.k === k)));
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

console.log('· hero sizes — split from range completion, and the runs table (heroRuns)');
const heroBrand = [
  idx('Monsoon', 'GB', [['Set hero sizes', 'is_hero_size'], ['Stock < 11 -> OOS', 'stock_quantity'], ['Range completion percentage calculation', 'rc_percent']]),
  idx('Monsoon', 'DE', [['Hero Size flag for AW26', 'new_size_flag_v2', { impacted_items: '50 of 500' }], ['Setup availability', 'stock_status']]),
  idx('Monsoon', 'FR', [['Setup availability', 'stock_status']]),
];
const HR = R.heroRuns(heroBrand);
t('heroRuns lists only the hero-mechanism rules, one row per rule', HR.length === 2);
t('…sorted by client, then market, then FeedHero\'s own run order', HR[0].market === 'DE' && HR[1].market === 'GB');
t('a heroRuns row carries what a runs table needs', ['client', 'market', 'cmpid', 'i', 'n', 't', 'd', 'ch', 'b', 'imp', 'of', 'mo', 'mb', 'iss', 'cut'].every((k) => k in HR[0]));
t('range completion itself never shows up as a hero run', !HR.some((x) => /Range completion/.test(x.n)));
t('a brand with no hero-size rule anywhere reads an empty list, never a guess', R.heroRuns(brand).length === 0);
t('the brand-level "gap" finding treats hero sizes as an ordinary mechanism', R.stockFindings(heroBrand, NOW).some((f) => f.k === 'gap' && f.mk === 'hero' && f.market === 'FR'));

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
t('the stock route also serves heroRuns — the runs table', /matrix: RULES\.stockMatrix\(rows\), cutoffs: RULES\.stockCutoffs\(rows\), heroRuns: RULES\.heroRuns\(rows\), findings: RULES\.stockFindings\(rows, now\),/.test(WK));

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
t('Stock: hero sizes get their own runs table, reading heroRuns and filtering like the cut-offs table', /id="heroes"/.test(SP) && /function renderHeroes\(\) \{/.test(SP) && /S\.d && S\.d\.heroRuns/.test(SP) && /renderCov\(\); renderHeroes\(\); renderFinds\(\)/.test(SP));
t('Stock: a "Markets with hero sizes" KPI, split from local inventory\'s own tile', /kpi\(n0\(hero\), 'Markets with hero sizes',/.test(SP) && /st\.some\(function \(r\) \{ return r\.sk === 'hero'; \}\)/.test(SP));
t('Stock: the hero-size glyph is ONE function, shown only where the mechanism itself shows up — a tag, a column header, a filter chip, the runs table (never a wall of icons on every row)', (() => {
  const uses = (SP.match(/heroIcon\(\)/g) || []).length;
  return /function heroIcon\(\)/.test(SP) && /function mechTag\(sk\) \{ return '<span class="tg">' \+ \(sk === 'hero' \? heroIcon\(\) : ''\)/.test(SP) && uses >= 5;
})());

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

console.log('· ad spend kept off low-stock products — the forecast behind the /stock panel');
{
  // real rule NAME + FIELD shapes from the 28 Sep 2026 rule report; every count here is invented
  const K = (name, db, imp) => R.heldBack(one(name, db, imp ? { impacted_items: imp } : {}));
  const k = (name, db, imp) => (K(name, db, imp) || { kind: null }).kind;
  t('a stock threshold that holds products back is sized on its impacted count', JSON.stringify(K('Stock < 11 -> OOS', 'stock_quantity', '800 of 2,000')) === JSON.stringify({ kind: 'blocked', n: 800, why: null }));
  t('a range-completion exclusion is sized', k('Range Completion Exclusion', 'rc_exclusion', '140 of 2,000') === 'blocked');
  t('an availability rule driven by range completion is sized', k('Range Completion by Availability', 'stock_status', '370 of 3,000') === 'blocked');
  t('"quantity with 3 or less" into the exclusion field is sized', k('Removing products with quantity with 3 or less', 'excluded_destination', '120 of 1,500') === 'blocked');
  t('an inclusion / exception RELEASES products — never a saving', k('Include Hero size low RC', 'rc_exclusion', '340 of 2,000') === 'releases' && k('ADhoc [inclusion] for Hero Size - review weekly please', 'stock_status', '50 of 3,000') === 'releases');
  t('a rule holding back on Meta is not priced with Google Ads\' CPC', k('Social: RC > 65% -> Out of stocj', 'social_availability', '900 of 2,000') === 'channel' && k('Stock Exclusion except Jan Launch', 'meta_exclusion', '120 of 1,500') === 'channel');
  t('a rule writing EVERY product sets each one in or out — its count is not what it held back', k('Empty < 0.26 RC Products', 'gb_cl2', '2,000 of 2,000') === 'all');
  t('"Not available to Zero" restates a state the products are already in — not sized', k('Not available to Zero', 'product_stock', '2,900 of 3,000') === 'mirror');
  t('a rule that WORKS OUT a value (RC %, stock counts, hero sizes) is not the one holding products back', k('Range completion percentage calculation', 'rc_percent', '2,000 of 2,000') === 'calc' && k('Calculate stock count details', 'stock_num', '10 of 20') === 'calc' && k('Set Hero size values', 'is_hero_size', '10 of 20') === 'calc');
  t('a blocking rule touching nothing on its last run holds nothing back', JSON.stringify(K('Stock < 11 -> OOS', 'stock_quantity', '0 of 2,000')) === JSON.stringify({ kind: 'none', n: 0, why: K('Stock < 11 -> OOS', 'stock_quantity', '0 of 2,000').why }));
  t('an unreadable impacted count is never guessed', k('Stock < 11 -> OOS', 'stock_quantity', '-') === 'all');
  t('titles, lifecycle labels and local inventory are not thresholds or range completion', k('Title: append colour', 'product_name') === null && k('New In by date', 'gb_cl0') === null && k('LIA: next day', 'pickup_sla') === null);
  t('"IG ID" is an item-group id, not Instagram', R.channel({ d: 'ig_id_colour_stock', n: 'IG ID Colour - Count unique' }) === 'all' && R.channel({ d: 'ig_availability', n: 'x' }) === 'meta');

  // the SKU denominator (Ray, 28 Sep 2026, on Reiss GB's forecast panel): "spend per product per day
  // should be base on the volume of output feeds (the feed URLs rather than the products impacted
  // number in the rule) — Reiss GB Shopping should have 22,657 SKUs instead of 60,235". FeedHero's
  // own roas_dashboard 'skus' field is Ads TRAFFIC (docs/ROAS.md: a market can carry "Unlisted SKUs
  // in Ads traffic" — real spend on SKUs the feed does not hold), never the catalogue — so E2.skus
  // below is set to something absurd on purpose and must never leak into the basis.
  const E2 = { w30: { spend: { cur: '£', n: 72000 }, clicks: 240000, skus: 999999, impr: 30000000, zombiePct: 30 }, updated: NOW };
  const B = R.adsBasis(E2, { n: 20000, t: NOW - 3600000 });
  t('the basis: CPC = spend ÷ clicks, spend per product per day = spend ÷ FEED products ÷ 30 — never FeedHero\'s Ads-traffic skus', B && B.cur === '£' && B.cpc === 0.3 && Math.abs(B.spendDay - 0.12) < 1e-12 && Math.abs(B.clicksDay - 0.4) < 1e-12 && B.skus === 20000 && B.skus !== E2.w30.skus);
  t('…and the two ways of stating it agree (clicks per product per day × CPC)', Math.abs(B.clicksDay * B.cpc - B.spendDay) < 1e-12);
  t('the real Reiss GB numbers: FeedHero read 60,235 Ads-traffic skus, the live feed holds 22,657 — the basis reads the feed', (() => {
    const r = R.adsBasis({ w30: { spend: { cur: '£', n: 10000 }, clicks: 50000, skus: 60235 } }, { n: 22657, t: NOW });
    return r.skus === 22657;
  })());
  t('a v1 flat ROAS entry reads the same', JSON.stringify(R.adsBasis(Object.assign({}, E2.w30, { updated: NOW }), { n: 20000, t: NOW - 3600000 })) === JSON.stringify(B));
  t('no spend, no clicks, or no feed-row read = no basis (never a zero price, never FeedHero\'s own skus as a fallback)',
    R.adsBasis(null, { n: 20000 }) === null
    && R.adsBasis({ w30: { spend: { cur: '£', n: 0 }, clicks: 5, skus: 5 } }, { n: 20000 }) === null
    && R.adsBasis({ w30: { spend: { cur: '£', n: 9 }, clicks: 0, skus: 5 } }, { n: 20000 }) === null
    && R.adsBasis({ w30: { spend: { cur: '£', n: 9 }, clicks: 5, skus: 500000 } }, null) === null
    && R.adsBasis({ w30: { spend: { cur: '£', n: 9 }, clicks: 5, skus: 500000 } }, { n: 0 }) === null);
  t('Ray\'s two scenarios: Conservative 5 %, Aggressive 10 %, over the 30-day window', JSON.stringify(R.SV_SCENARIOS.map((x) => [x.label, x.pct])) === JSON.stringify([['Conservative', 5], ['Aggressive', 10]]) && R.SV_WINDOW_DAYS === 30);
  t('saved = held back × spend per product per day × share × days', Math.abs(R.savingFor(800, B, 5, 30) - 144) < 1e-9 && Math.abs(R.savingFor(800, B, 5, 1) - 4.8) < 1e-9);
  t('aggressive is exactly twice conservative; per month is 30 × per day', Math.abs(R.savingFor(800, B, 10, 30) - 2 * R.savingFor(800, B, 5, 30)) < 1e-9 && Math.abs(R.savingFor(800, B, 5, 30) - 30 * R.savingFor(800, B, 5, 1)) < 1e-9);
  t('nothing held back, or no basis, saves nothing', R.savingFor(0, B, 5, 30) === 0 && R.savingFor(800, null, 5, 30) === 0);
  // the real Monsoon UK basis read on 28 Sep 2026 is NOT committed (client figures stay in KV) — the
  // arithmetic above is the same one, on round invented numbers

  const hb = (name, db, imp) => Object.assign(one(name, db, { impacted_items: imp }), {});
  const st1 = [hb('Stock < 11 -> OOS', 'stock_quantity', '800 of 2,000'), hb('Range Completion Exclusion', 'rc_exclusion', '140 of 2,000'), hb('Include Hero size low RC', 'rc_exclusion', '900 of 2,000')].map((r, i) => Object.assign(r, { i, hb: R.heldBack(r) }));
  const f1 = R.svFloor(st1);
  t('a market counts ONCE, at its largest blocking rule — two rules can hold back the same product', f1 && f1.n === 800 && f1.rule === 'Stock < 11 -> OOS');
  t('a release never becomes the floor, however large', R.svFloor([st1[2]]) === null);
  const eur = R.adsBasis({ w30: { spend: { cur: '€', n: 9000 }, clicks: 30000, skus: 999 } }, { n: 10000, t: NOW });
  const mk = [{ cmpid: 'a', stock: st1, ads: B }, { cmpid: 'b', stock: st1, ads: eur }, { cmpid: 'c', stock: st1, ads: null }, { cmpid: 'd', stock: [st1[2]], ads: B }];
  const bk = R.svBook(mk, 5, 30);
  t('the book adds MARKETS per currency and never across one', bk.byCur.length === 2 && bk.byCur[0].cur === '£' && Math.abs(bk.byCur[0].amt - 144) < 1e-9 && bk.byCur[1].cur === '€' && Math.abs(bk.byCur[1].amt - 800 * 0.03 * 0.05 * 30) < 1e-9);
  t('a market with a blocking rule but no Google Ads read is counted as unpriced, not as zero', bk.unpriced === 1 && bk.sized === 2);

  const v = R.stockView({ client: 'Monsoon', market: 'UK', cmpid: 'monsoon_uk', updated: NOW, n: 3, items: 2000, stock: st1.map((r) => { const o = Object.assign({}, r); delete o.hb; return o; }) }, E2, { rows: 20000, t: NOW - 3600000 });
  t('stockView: every stock row carries hb, the market carries its basis and sentence', v.stock.every((r) => 'hb' in r) && v.stock[0].hb.kind === 'blocked' && JSON.stringify(v.ads) === JSON.stringify(B) && typeof v.sentence === 'string');
  t('stockView: no ROAS entry = ads null even with a feed-row read', R.stockView({ client: 'x', market: 'y', cmpid: 'z', stock: [] }, undefined, { rows: 20000, t: NOW }).ads === null);
  t('stockView: no feed-row read = ads null even with a full ROAS read', R.stockView({ client: 'x', market: 'y', cmpid: 'z', stock: [] }, E2, undefined).ads === null);

  // the page's twins, LIFTED by name and run against the engine on the same table
  const liftIn = (h, name) => {
    const a = h.indexOf('function ' + name + '('); if (a < 0) throw new Error('cannot lift ' + name);
    const eol = h.indexOf('\n', a), line = h.slice(a, eol);
    if (/\}\s*$/.test(line) && (line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
    const b = h.indexOf('\n  }\n', a); if (b < 0) throw new Error('cannot lift ' + name); return h.slice(a, b + 4);
  };
  const tw = new Function(liftIn(SP, 'svCalc') + '\n' + liftIn(SP, 'svFloor') + '\n' + liftIn(SP, 'svBook') + '\nreturn { svCalc, svFloor, svBook };')();
  const CASES = [[800, B, 5, 30], [800, B, 10, 1], [1, eur, 37, 30], [0, B, 5, 30], [5, null, 5, 30], [123456, B, 50, 30]];
  t('page svCalc === engine savingFor on every case', CASES.every((c) => tw.svCalc.apply(null, c) === R.savingFor.apply(null, c)));
  t('page svFloor === engine svFloor', JSON.stringify(tw.svFloor(st1)) === JSON.stringify(R.svFloor(st1)) && tw.svFloor([]) === null);
  t('page svBook === engine svBook, at both scenarios and both periods', [[5, 30], [10, 30], [5, 1], [10, 1]].every(([p, d]) => JSON.stringify(tw.svBook(mk, p, d)) === JSON.stringify(R.svBook(mk, p, d))));

  t('worker: the stock route reads the ROAS index ONCE and serves every market through stockView, its feeds found by the cmpid', /const ridx = \(await env\.EDITS\.get\('roasidx', 'json'\)\) \|\| \{\};/.test(WK) && /return RULES\.stockView\(r, ridx\[r\.cmpid\], k\.g \? vdidx\[k\.g\] : null,/.test(WK) && /sv: \{ scenarios: RULES\.SV_SCENARIOS, days: RULES\.SV_WINDOW_DAYS \}/.test(WK));
  t('worker: never looks a scan index up by the roster LABEL again (\'Reiss|GB\' — the index keys \'Reiss|gb\')', !/vdidx\[r\.client \+ '\|' \+ r\.market\]/.test(WK) && !/favail\[r\.client/.test(WK));
  t('worker: the SKU denominator reads the SAME voldobidx the Product Volume module keeps — one more KV get, keyed client|market, never FeedHero\'s Ads-traffic skus', /const vdidx = \(await env\.EDITS\.get\('voldobidx', 'json'\)\) \|\| \{\};/.test(WK));
  t('the tripwire stub builds the stock book through the SAME stockView, its feeds joined on the cmpid like the worker (never FeedHero\'s skus)', /const FK = E\.feedKeys\(WIRED\);/.test(read('tools/rules_stub.js')) && /return E\.stockView\(r, ROAS\[r\.cmpid\], k\.g \? VOLIDX\[k\.g\] : null,/.test(read('tools/rules_stub.js')));
  t('page: the panel, and the rules that open it (the card, the setup tables, the cut-offs, the KPI)', /<aside class="svp" id="svp"/.test(SP) && /'<tr data-sv="' \+ esc\(m\.cmpid \+ '\|' \+ r\.i\) \+ '"><td class="num">'/.test(SP) && /'<tr data-sv="' \+ esc\(c\.cmpid \+ '\|' \+ c\.i\)/.test(SP) && /'<tr data-sv="' \+ esc\(m\.cmpid \+ '\|' \+ r\.i\) \+ '" tabindex="0">/.test(SP) && /class="kpi sv-k link" data-sv="book"/.test(SP));
  t('page: opened by REAL pointer movement (a push or scroll under a still cursor never re-targets it)', /document\.addEventListener\('mousemove', function \(e\) \{\s*if \(e\.clientX === PT\.x && e\.clientY === PT\.y\) return;/.test(SP) && !/addEventListener\('mouseover'/.test(SP));
  t('page: it STAYS — only ✕, Esc or a vanished rule close it', (SP.match(/svClose\(\)/g) || []).length === 3 && /\$\('#svp-x'\)\.addEventListener\('click', svClose\)/.test(SP) && !/mouseleave|mouseout/.test(SP));
  t('page: a tap opens it too, never when the tap is on a link or a button', /e\.target\.closest\('a,button,summary,input'\)\) return; svOpen/.test(SP));
  t('page: Conservative / Aggressive / a custom share, per day or per month, remembered on the device', /data-per="day"/.test(SP) && /id="svp-pct" min="1" max="50"/.test(SP) && /remember\('fcc-stock-sv'/.test(SP) && /recall\('fcc-stock-sv'\)/.test(SP));
  t('page: the working is printed — the formula with this rule\'s own numbers, and the ceiling named as not the forecast', /' × ' \+ money\(B\.cur, B\.spendDay, 3\) \+ ' × ' \+ SV\.pct \+ '% × '/.test(SP) && /the ceiling, not the forecast/.test(SP));
  t('page: the count-up stands down under reduced motion', /prefers-reduced-motion: reduce/.test(SP));
  t('page: every figure wears its market\'s own currency; the card groups by currency', /money\(m\.ads\.cur, x\.amt\)/.test(SP) && /money never crosses one/.test(SP));
  t('page: the panel pushes the page on a wide screen rather than covering it', /@media\(min-width:1100px\)\{body\.sv-on\{padding-right:var\(--svw\)\}\}/.test(SP));
}

console.log('· availability, master → feed — the join, both counters, the agent, the worker lanes, the card');
{
  // THE JOIN. Every wired FeedHero output (DEFAULT_FEEDS, evaluated as the worker holds it) against the real roster.
  const FEEDS = new Function('return {' + /const DEFAULT_FEEDS = \{([\s\S]*?)\n\};/.exec(WK)[1] + '\n};')();
  const WIRED = []; Object.keys(FEEDS).forEach((c) => Object.keys(FEEDS[c]).forEach((m) => { const s = FEEDS[c][m]; if (s && s.xml) WIRED.push({ client: c, mkt: m, url: s.xml }); }));
  const FK = R.feedKeys(WIRED), ROSTER = ROAS.rosterList();
  t('feedKeys: a roster market finds its Google AND Meta feed by the FeedHero company id', JSON.stringify(FK.reiss_gb) === JSON.stringify({ g: 'Reiss|gb', fb: 'Reiss|gb-fb' }) && FK.reiss_ie_pla.g === 'Reiss|ie' && FK.superdry_befr.g === 'Superdry|befr' && FK.schuh_uk_1.g === 'Schuh|gb' && FK.fs_new_hobbycraft.g === 'Hobbycraft|gb');
  t('feedKeys: most of the roster is wired (a market with no feed says so — never a guessed one)', ROSTER.filter((m) => FK[m.cmpid] && FK[m.cmpid].g).length >= 40 && !FK.superdry_it);
  t('THE BUG IT REPLACES: the roster label never names a scan-index key (Reiss|GB vs Reiss|gb, Superdry|BE-FR vs Superdry|befr)', ROSTER.every((m) => !WIRED.some((w) => w.client + '|' + w.mkt === m.client + '|' + m.market)));
  const catCmpid = new Function(liftFn(WK, 'catCmpid') + '\nreturn catCmpid;')();
  t('feedKeys reads the cmpid exactly as the Catalogue\'s catCmpid does, on every wired feed', WIRED.every((w) => { const c = catCmpid({ xml: w.url }); const k = FK[c]; return c && k && (/-fb$/.test(w.mkt) ? k.fb : k.g) && Object.values(k).indexOf(w.client + '|' + w.mkt) >= 0 || (/-fb$/.test(w.mkt) ? k.fb !== w.client + '|' + w.mkt && !!k.fb : k.g !== w.client + '|' + w.mkt && !!k.g); }));
  const wiredFn = new Function('DEFAULT_FEEDS', liftFn(WK, 'wiredXmlList') + '\nreturn wiredXmlList;')(FEEDS);
  t('worker: wiredXmlList hands feedKeys every wired XML feed and nothing else', JSON.stringify(wiredFn()) === JSON.stringify(WIRED));

  // THE ENGINE
  const M = { n: 1000, in: 400, out: 580, pre: 10, none: 5, other: 5, via: 'mixed', imp: '2026-09-30 05:27:48', col: 'availability', qcol: 'quantity', t: NOW };
  const G = { n: 500, in: 490, out: 0, pre: 10, none: 0, other: 0, t: NOW }, FB = { n: 300, in: 200, out: 100, pre: 0, none: 0, other: 0, t: NOW };
  const av = R.availView({ master: M, g: G, fb: FB, wired: { g: 1, fb: 1 } });
  t('availView: counts per side with the shares, and the master\'s reading (import, how stock was read)', av.master.inPct === 40 && Math.abs(av.master.outPct - 58) < 1e-9 && av.g.inPct === 98 && Math.abs(av.fb.outPct - 100 / 3) < 1e-9 && av.via === 'mixed' && av.imp === M.imp && av.col === 'availability' && av.wired.g === true);
  t('availView: an unread side is null, and "no Meta feed" (wired false) stays apart from "not scanned yet"', (() => { const v = R.availView({ master: null, g: G, fb: null, wired: { g: true, fb: false } }); return v.master === null && v.fb === null && v.wired.fb === false && v.via === null; })());
  t('availSide: nothing counted (n 0) is no reading, never 0%; a bucket can never exceed the products', R.availSide({ n: 0, in: 0 }) === null && R.availSide(null) === null && R.availSide({ n: 10, in: 50 }).in === 10);
  const bkm = [{ av: av }, { av: R.availView({ master: M, g: null, fb: null, wired: {} }) }, { av: R.availView({ master: null, g: G, fb: null, wired: {} }) }, { av: null }];
  const bg = R.availBook(bkm, 'g');
  t('availBook pairs like with like: only markets with BOTH sides counted add up; one-sided markets are counted apart', bg.markets === 1 && bg.one === 2 && bg.master.n === 1000 && bg.feed.n === 500 && bg.master.in === 400 && bg.feed.in === 490);
  t('availBook: the Meta pair is its own book', R.availBook(bkm, 'fb').markets === 1 && R.availBook(bkm, 'fb').feed.out === 100);
  const sv2 = R.stockView({ client: 'x', market: 'y', cmpid: 'z', stock: [] }, undefined, undefined, { master: M, g: G, fb: null, wired: { g: true, fb: false } });
  t('stockView carries av (and still no ads without a ROAS read)', sv2.av && sv2.av.master.n === 1000 && sv2.ads === null && R.stockView({ client: 'x', market: 'y', cmpid: 'z', stock: [] }).av === null);

  // ONE WORD TABLE, TWO COUNTERS: the master's (catalog_engine) and the feed's (labelguard)
  const CE = require('../docs/catalog_engine.js');
  const LG = await import('../cloudflare/feedspark-deck/src/labelguard.js');
  const WORDS = { 'in stock': 'in', in_stock: 'in', IN_STOCK: 'in', InStock: 'in', 'https://schema.org/InStock': 'in', available: 'in', Yes: 'in', true: 'in', 1: 'in', 'limited availability': 'in',
    'out of stock': 'out', out_of_stock: 'out', NOT_AVAILABLE: 'out', 'sold out': 'out', discontinued: 'out', unavailable: 'out', 'http://schema.org/OutOfStock': 'out', No: 'out', 0: 'out',
    preorder: 'pre', 'pre-order': 'pre', backorder: 'pre', 'available for order': 'pre', '': 'none', '   ': 'none', 'coming soon': 'other', Y: 'other', 'and this..."': 'other' };
  t('availBucket: the master counter and the feed counter bucket every word the same way', Object.keys(WORDS).every((w) => CE.availBucket(w) === WORDS[w] && LG.availBucket(w) === WORDS[w]), Object.keys(WORDS).filter((w) => CE.availBucket(w) !== WORDS[w] || LG.availBucket(w) !== WORDS[w]).join(' | '));
  t('availBucket: "available for order" is not read as "available" (anchored words, not prefixes)', CE.availBucket('available for order') === 'pre' && LG.availBucket('availableforordering') === 'pre');

  // THE MASTER COUNTER — the availability word first, the quantity only where there is no word, neither = not stated
  const tl = CE.stockTally();
  [['product_id', 'availability', 'quantity'], ['a', 'IN_STOCK', '3'], ['b', 'NOT_AVAILABLE', '9'], ['c', '', '5'], ['d', '', '0'], ['e', '', ''], ['f', 'Pre-Order', ''], ['g', 'weird', ''], ['h', 'x "and this...', ''], ['', '', '']].forEach((r) => tl.onRow(r));
  const T1 = tl.finish();
  t('stockTally: word beats quantity (NOT_AVAILABLE with 9 on hand is out), quantity only where no word, a blank line is no product', T1.n === 8 && T1.in === 2 && T1.out === 2 && T1.pre === 1 && T1.none === 1 && T1.other === 2 && T1.via === 'mixed' && T1.col === 'availability' && T1.qcol === 'quantity');
  t('stockTally: the buckets add up to the rows, always', T1.in + T1.out + T1.pre + T1.none + T1.other === T1.n);
  t('stockTally: an unread WORD is recorded, a spilled fragment of description text never is', JSON.stringify(T1.ow) === JSON.stringify([['weird', 1]]));
  const tq = CE.stockTally(); [['id', 'qty'], ['a', '2'], ['b', '0'], ['c', '1,204']].forEach((r) => tq.onRow(r));
  t('stockTally: a master with no availability column reads its quantity', JSON.stringify(tq.finish()).indexOf('"n":3,"in":2,"out":1') >= 0 && tq.finish().via === 'quantity');

  // THE AGENT'S READER on files built in-process: a zipped CSV, a Windows-1252 TSV, a plain XML
  const MS = await import('./master_stock.mjs');
  const zlib = await import('node:zlib');
  const zip1 = (name, buf) => {
    const def = zlib.deflateRawSync(buf), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(buf.length, 22); lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(def.length, 20); cd.writeUInt32LE(buf.length, 24); cd.writeUInt16LE(nm.length, 28);
    const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + nm.length, 12); eo.writeUInt32LE(30 + nm.length + def.length, 16);
    return new Uint8Array(Buffer.concat([lh, nm, def, cd, nm, eo]));
  };
  const csv = 'id,title,availability,quantity\n1,"Coat, navy",in stock,4\n2,Scarf,out of stock,0\n3,"Hat ""wool""",,7\n4,Belt,,0\n';
  const Z = MS.tallyMaster(zip1('m.csv', Buffer.from(csv)));
  t('master_stock: a zipped CSV (quoted commas, doubled quotes) is unzipped and counted', Z.n === 4 && Z.in === 2 && Z.out === 2 && Z.fmt === 'CSV' && Z.via === 'mixed');
  const tsv = Buffer.from('id\ttitle\tavailability\n1\tBoots \u00a345\tin_stock\n2\tShoes\tout_of_stock\n', 'latin1');
  const W1 = MS.tallyMaster(new Uint8Array(tsv));
  t('master_stock: a Windows-1252 master (Schuh\'s) switches decoder instead of failing; TSV sniffed', W1.n === 2 && W1.in === 1 && W1.out === 1 && W1.fmt === 'TSV' && W1.enc === 'Windows-1252');
  const xml = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>1</g:id><g:availability>in stock</g:availability></item><item><g:id>2</g:id><g:availability>preorder</g:availability></item><item><g:id>3</g:id><g:availability>out of stock</g:availability></item></channel></rss>';
  const X1 = MS.tallyMaster(new Uint8Array(Buffer.from(xml)));
  t('master_stock: an XML master reads g:availability', X1.n === 3 && X1.in === 1 && X1.pre === 1 && X1.out === 1 && X1.fmt === 'XML');
  const MSRC = read('tools/master_stock.mjs');
  t('master_stock: scope = the ROAS roster only; asks the worker for the file ({masterfile}) — never a FeedHero URL of its own', /import \{ rosterList \} from '\.\.\/cloudflare\/feedspark-deck\/src\/roas\.js';/.test(MSRC) && /body: JSON\.stringify\(\{ masterfile: cmpid, force: FORCE \}\)/.test(MSRC) && !/feedhero\.net/.test(MSRC));
  t('master_stock: pushes counts only ({masterstock}), checks for the Access login page, runs only when executed', /post\(\{ masterstock: done\.slice\(b, b \+ BATCH\) \}\)/.test(MSRC) && /Access login page\?/.test(MSRC) && /import\.meta\.url === pathToFileURL\(process\.argv\[1\] \|\| ''\)\.href/.test(MSRC));
  const WF = read('.github/workflows/master-stock.yml');
  t('workflow: 3x a day after the morning imports, the xml-scan secret, a one-company + force dispatch', /cron: '40 7,13,19 \* \* \*'/.test(WF) && /FCC_PUSH_KEY: \$\{\{ secrets\.FCC_PUSH_KEY \}\}/.test(WF) && /run: node tools\/master_stock\.mjs/.test(WF) && /ONLY: \$\{\{ inputs\.only \}\}/.test(WF));

  // THE FEED COUNTER, on the SAME stream as every scan (Google and Meta)
  const FA = require('../docs/feedlab_engine.js');
  const feedXml = (vals) => '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>' + vals.map((v, i) => '<item><g:id>p' + i + '</g:id><g:title>T' + i + '</g:title>' + (v == null ? '' : '<g:availability>' + v + '</g:availability>') + '</item>').join('') + '</channel></rss>';
  const scan = (mkt, vals) => { const c = LG.xmlCollector({ client: 'X', market: mkt }); const p = FA.createXmlParser((r, h) => c.onRow(r, h)); p.push(feedXml(vals)); p.end(); return c.finish(); };
  const S1 = scan('gb', ['in stock', 'in stock', 'out of stock', 'backorder', null]);
  t('xmlCollector: every product counted by availability on the scan stream (vol.av), buckets adding to the rows', S1.vol.av.n === 5 && S1.vol.av.in === 2 && S1.vol.av.out === 1 && S1.vol.av.pre === 1 && S1.vol.av.none === 1 && S1.vol.av.col === 'g:availability' && S1.snap.rows === 5);
  const S2 = scan('gb-fb', ['in stock', 'out of stock', 'out of stock']);
  t('xmlCollector: a Meta (-fb) feed is counted too', S2.vol.av.n === 3 && S2.vol.av.out === 2);
  t('the browser copy of labelguard.js carries the same counter (check_lgcopy holds it byte-identical)', read('docs/labelguard_engine.js') === read('cloudflare/feedspark-deck/src/labelguard.js'));

  // THE WORKER: the tally sanitiser (lifted), the store on confirmed scans, the two push lanes, the route
  const san = new Function(/const AV_BUCKETS = \[[^\]]*\];/.exec(WK)[0] + '\n' + liftFn(WK, 'sanitizeAvail') + '\nreturn sanitizeAvail;')();
  t('worker sanitizeAvail: keeps a tally whose buckets add up to its products', JSON.stringify(san({ n: 5, in: 2, out: 1, pre: 1, none: 1, other: 0, col: 'g:availability', ow: [['weird', 2]] })) === JSON.stringify({ n: 5, in: 2, out: 1, pre: 1, none: 1, other: 0, col: 'g:availability', ow: [['weird', 2]] }));
  t('worker sanitizeAvail: refuses one that does not add up, an empty one, and a text fragment posing as a word', san({ n: 5, in: 2, out: 1, pre: 0, none: 0, other: 0 }) === null && san({ n: 0 }) === null && san(null) === null && san({ n: 1, in: 0, out: 0, pre: 0, none: 0, other: 1, ow: [['x "and this..."', 1]] }).ow.length === 0);
  t('worker: an output feed\'s counts ride only CONFIRMED scans (applyPushedSnapshot, both lanes), into ONE index feedavail', /if \(vol && vol\.av\) \{ try \{ await availTrack\(env, client, mkt, vol\.av\); \} catch \(e\) \{\} \}/.test(WK) && /const idx = \(await env\.EDITS\.get\('feedavail', 'json'\)\) \|\| \{\};\s*idx\[client \+ '\|' \+ mkt\] = Object\.assign\(\{ client, mkt, t: Date\.now\(\) \}, a\);/.test(WK));
  t('worker {masterfile}: roster companies only, resolved by catMasterInfo, `unchanged` for the same import, the file streamed as bytes', /if \(typeof body\.masterfile === 'string'\) \{/.test(WK) && /if \(!ROAS\.cmpidBrand\(cmpid\)\) return json\(\{ ok: false, error: 'not a roster company' \}, 404\);/.test(WK) && /if \(have && have\.imp && have\.imp === rec\.lastImport\) return json\(\{ ok: true, unchanged: true/.test(WK) && /'content-type': 'application\/octet-stream', 'cache-control': 'no-store'/.test(WK));
  t('worker {masterstock}: roster companies only, sanitised, ONE write per post into masteravail', /if \(Array\.isArray\(body\.masterstock\)\) \{/.test(WK) && /if \(results\.some\(\(r\) => r\.ok\)\) await env\.EDITS\.put\('masteravail', JSON\.stringify\(idx\)\);/.test(WK));
  t('worker route: two KV gets (masteravail, feedavail), the join by cmpid, the wiring beside the counts', /const mavail = \(await env\.EDITS\.get\('masteravail', 'json'\)\) \|\| \{\};/.test(WK) && /const favail = \(await env\.EDITS\.get\('feedavail', 'json'\)\) \|\| \{\};/.test(WK) && /const fkeys = RULES\.feedKeys\(wiredXmlList\(\)\);/.test(WK) && /\{ master: mavail\[r\.cmpid\], g: k\.g \? favail\[k\.g\] : null, fb: k\.fb \? favail\[k\.fb\] : null, wired: \{ g: !!k\.g, fb: !!k\.fb \} \}/.test(WK));

  // THE PAGE
  const liftPg = (h, name) => { const a = h.indexOf('  function ' + name + '('); const b = h.indexOf('\n  }\n', a); if (a < 0 || b < 0) throw new Error('cannot lift ' + name); return h.slice(a, b + 4); };
  const avTw = new Function(liftPg(SP, 'avBook') + '\nreturn avBook;')();
  t('page avBook === engine availBook, both channels', ['g', 'fb'].every((c) => JSON.stringify(avTw(bkm, c)) === JSON.stringify(R.availBook(bkm, c))));
  t('page: the card (master · Google · Meta per market), its summary per channel, the legend, and its own CSV', /<section class="card" id="av-card">/.test(SP) && /<th>Master feed<\/th><th>Google Shopping<\/th><th>Meta<\/th>/.test(SP) && /avCell\(m, 'master'\) \+ avCell\(m, 'g'\) \+ avCell\(m, 'fb'\)/.test(SP) && /pair\(avBook\(ms, 'g'\), 'Google'\) \+ pair\(avBook\(ms, 'fb'\), 'Meta'\)/.test(SP) && /csvDownload\('stock_availability'/.test(SP));
  t('page: an unread side says WHY — not counted yet / no feed wired / no Meta feed / not scanned yet — never an empty bar', /var why = k === 'master' \? 'not counted yet' : !w\[k\] \? \(k === 'fb' \? 'no Meta feed' : 'no feed wired'\) : 'not scanned yet';/.test(SP));
  t('page: the KPI band leads with what Google receives, beside its master', /In stock in the Google feed/.test(SP) && /data-go="av-card"/.test(SP) && /renderKpis\(\); renderAv\(\);/.test(SP));
  t('page: in stock green, out of stock the chart pair\'s second colour — tokens, never a hex, so dark mode follows', /--av-in:var\(--good\);--av-pre:var\(--navy\);--av-out:var\(--chart-2\)/.test(SP));
  const stubS = require('./rules_stub.js').build().stock;
  t('stub: every market carries av; one master is left uncounted and a Meta feed is present, so the card draws every state', stubS.markets.every((m) => m.av) && stubS.markets.some((m) => !m.av.master && m.av.g) && stubS.markets.some((m) => m.av.fb) && stubS.markets.some((m) => m.av.wired && !m.av.wired.fb));
}

console.log('· the tripwire stub + nothing in git');
const stub = require('./rules_stub.js').build();
t('stub: the book shape the page reads (markets without stock rows, with sn)', stub.book.markets.length === 3 && stub.book.markets.every((m) => m.sn > 0 && !m.stock && !m.find) && stub.book.findings.length > 0);
t('stub: the stock shape (sentence per market, matrix, cut-offs)', stub.stock.markets.every((m) => m.sentence && m.stock.length) && stub.stock.cutoffs.length > 0 && stub.stock.matrix.length === 2);
t('stub: carries heroRuns too, so the mobile/dark-mode tripwires actually render the runs table, not an empty one', stub.stock.heroRuns.length > 0 && stub.stock.mechanisms.some((m) => m.k === 'hero'));
t('both browser tripwires feed the stub and inline /design/fcc.css', ['tools/check_mobile.js', 'tools/check_darkmode.js'].every((p) => { const s = read(p); return /rules_stub\.js/.test(s) && /\$\{RULES_STUB\}/.test(s) && /withFccCss\(/.test(s); }));
const tracked = execSync('git ls-files', { cwd: new URL('..', import.meta.url) }).toString().split('\n').filter((f) => /\.(json|txt|csv|md|html|js|mjs)$/.test(f));
const leaks = tracked.filter((f) => { try { return /"impacted_items"\s*:|"rule_issues"\s*:/.test(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')); } catch (e2) { return false; } });
t('no rule_report payload is committed anywhere (KV only)', leaks.length === 0, leaks.join(', '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
