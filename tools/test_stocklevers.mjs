// STOCK LEVERS — BAU ↔ SALE harness (pure node, CI-safe).
//
// Ray, 5 Oct 2026: "summarise a stock management dashboard for Superdry (specifically) eahc of those markets have got
// quite aan interesting mix of stock levers : 1 . Range Completion (20-40%, currently at 35%) - 2. Stock unit exclusion
// for Everest (previously >5 units per size, now N/A) - 3. Hero Sizes (current activated, follow the mapping above) -
// build an facilitor interface to action BAU vs. SALE perido".
//
// Pins the lever engine (docs/stocklevers_engine.js) on stock rules pushed through the REAL rules classifier
// (src/rules.js normRules → the rows /api/rules/stock serves): what each market runs, the plan it is held to, the mode and
// the periods, the switch list and its brief, the suggestions, "keep as it runs", the summary. Then the worker's half
// (src/stocklevers.js: what a signin may store, the stamps, the scope, the seed written once), the route, the page and the
// stub. Rule names are the SHAPES the live rules take; every count, id and date is invented.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as W from '../cloudflare/feedspark-deck/src/stocklevers.js';
import * as R from '../cloudflare/feedspark-deck/src/rules.js';
const require = createRequire(import.meta.url);
const L = require('../docs/stocklevers_engine.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), SP = read('docs/FeedSpark_Stock.html'), ST = read('tools/rules_stub.js');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// a market's rules as rule_report rows, through the real classifier, kept as /api/rules/stock keeps them
let rid = 0;
function rule(name, field, db, imp, of) {
  return { rule_id: 'r' + (++rid), cmpid: 'x', company: 'Brand X', rule_name: name, target_field: field, target_db: db, rule_type: 'User', batch_id: 'All products',
    runtime: '0.3 sec', impacted_items: (imp == null ? of : imp) + ' of ' + of, created_on: '10/02/2025 at 10:00 AM', created_by: 'Analyst A', modified_on: '', modified_by: '', rule_status: 'Active', rule_issues: [] };
}
function market(mk, cmpid, rows, line) {
  const stock = R.normRules(rows).filter((r) => r.sk).map(R.stockRow);
  return { client: 'Superdry', market: mk, cmpid, stock, av: { held: { state: line ? 'ok' : 'unread', line: line || null, stated: R.rcStated(stock) } } };
}
const OF = 1000;
const RC_SET = (n) => rule(n, 'RC Availability', 'rc_availability', OF, OF), RC_HOLD = (n) => rule(n, 'Availability', 'stock_status', 60, OF);
const HERO_SET = () => rule('Set Hero size values', 'Is hero size', 'is_hero_size', OF, OF);
const HERO_KEEP = () => rule('ADhoc [inclusion] for Hero Size - review weekly please', 'Availability', 'stock_status', 9, OF);
// the shapes Superdry's markets run (5 Oct 2026), each market its own mix
const GB = market('GB', 'b_gb', [RC_SET('RC Availability by Range completion with date'), RC_HOLD('Range Completion by Availability'), HERO_SET()], { x: 36, lo: 35.3, hi: 36.4 });
const FR = market('FR', 'b_fr', [RC_SET('Range Completion < 0.21 ( 20% completion)'), RC_HOLD('Range Completion based Availability'), HERO_SET(), HERO_KEEP()]);
const NL = market('NL', 'b_nl', [RC_SET('Range Completion < 0.21'), RC_HOLD('Range Completion (BAU & Peak) - 20%'), HERO_SET(), HERO_KEEP()]);
const IT = market('IT', 'b_it', [RC_SET('Availability - Range Completion < 0.21'), RC_HOLD('Range Completion (BAU & Peak) - 20%')]);
const SE = market('SE', 'b_se', [RC_SET('Range Completion based availability2'), RC_HOLD('Range Completion based availability')]);
const CA = market('CA-EN', 'b_caen', [RC_SET('Range Completion < 0.21 ( 20% completion)'), RC_HOLD('Range Completion based availability'), HERO_KEEP()]);
// a Meta rule and a label that name a range-completion level are not the Google lever
const SOC = market('DK', 'b_dk', [rule('Social: RC > 65% -> out of stock', 'Social availability', 'social_availability', 30, OF), rule('CL2: empty < 0.26 RC', 'Custom label 2', 'gb_cl2', OF, OF), HERO_SET()]);
// an Everest units rule (the lever as it ran before) and one for another range
const EV = market('US', 'b_us', [RC_SET('Range Completion < 0.2 ( 20% completion)'), rule('Everest: stock <= 5 -> out of stock', 'Availability', 'stock_status', 40, OF), rule('Stock < 4 -> OOS', 'Availability', 'stock_status', 80, OF), HERO_SET(), rule('Temporarily pause hero sizes', 'Availability', 'stock_status', 0, OF)]);
const MKS = [GB, FR, NL, IT, SE, CA, SOC, EV];
const by = (m) => MKS.filter((x) => x.market === m)[0];

console.log('· the levers, and a value');
t('three levers: range completion (a %), stock unit exclusion (units per size, or off), hero sizes (on / off)', eq(L.LEVERS.map((l) => [l.k, l.kind]), [['rc', 'pct'], ['units', 'units'], ['hero', 'onoff']]));
t('a value is a number, on, off — or not set (null, never a guess)', L.isSet(35) && L.isSet('on') && L.isSet('off') && !L.isSet(null) && !L.isSet('') && !L.isSet(undefined) && !L.isSet(NaN));
t('shown in the brand’s words: 35% · "> 5 units per size" · N/A · on · not set', L.fmtVal('rc', 35) === '35%' && L.fmtVal('units', 5) === '> 5 units per size' && L.fmtVal('units', 'off') === 'N/A' && L.fmtVal('hero', 'on') === 'on' && L.fmtVal('rc', null) === 'not set');

console.log('· what each market runs — read off its own rules');
const rd = (m, k, sc) => L.reading(k, by(m), { k, scope: sc || '' });
t('range completion: the line MEASURED from the products wins (GB ≈36%)', rd('GB', 'rc').state === 'on' && rd('GB', 'rc').val === 36 && rd('GB', 'rc').how === 'line');
t('…else the cut-off a rule name states ("< 0.21" → 21%) — the classifier files most of these under availability, so the NAME finds them', rd('FR', 'rc').val === 21 && rd('FR', 'rc').how === 'name'
  && rd('FR', 'rc').rules.some((r) => r.n === 'Range Completion based Availability'));
t('…a percentage a name states without a comparison ("(BAU & Peak) - 20%") when no comparison is written', (() => { const m = market('ZZ', 'b_zz', [RC_HOLD('Range Completion (BAU & Peak) - 20%')]); const r = L.reading('rc', m, {}); return r.val === 20 && r.how === 'name'; })());
t('…rules that run with no stated or measured line read "on", no number — never a guessed one', rd('SE', 'rc').state === 'on' && rd('SE', 'rc').val === null && rd('SE', 'rc').how === 'rules');
t('…and a market with none reads "none"', L.reading('rc', market('ZZ', 'b_zz', [HERO_SET()]), {}).state === 'none');
t('a Meta rule ("Social: RC > 65%") and a label ("CL2: empty < 0.26 RC") are not the Google lever', rd('DK', 'rc').state === 'none');
t('a hero-size inclusion rule is never counted as range completion', !rd('FR', 'rc').rules.some((r) => /hero/i.test(r.n)));
t('stock unit exclusion · Everest: the rule naming Everest, its cut-off from the name (≤ 5)', rd('US', 'units', 'Everest').state === 'on' && rd('US', 'units', 'Everest').val === 5 && rd('US', 'units', 'Everest').rules.length === 1);
t('…a units rule for another range is not Everest’s; no such rule reads "off" (N/A)', rd('GB', 'units', 'Everest').state === 'off' && rd('FR', 'units', 'Everest').state === 'off');
t('hero sizes: set and kept live → on, naming both rules', rd('FR', 'hero').state === 'on' && /Set Hero size values/.test(rd('FR', 'hero').why) && /inclusion/.test(rd('FR', 'hero').why));
t('…an inclusion rule with nothing setting the sizes it reads → part (Superdry CA’s shape)', rd('CA-EN', 'hero').state === 'part');
t('…a rule that pauses hero sizes → paused, whatever else runs', rd('US', 'hero').state === 'paused' && rd('US', 'hero').pause.length === 1);
t('…no hero rule → none', rd('IT', 'hero').state === 'none' && rd('SE', 'hero').state === 'none');

console.log('· off plan');
t('range completion within 2 points of the plan is on plan (36% measured vs 35%)', L.drift('rc', rd('GB', 'rc'), 35) === null);
t('…21% in a rule name against 35% is off plan, and says both numbers', /21%/.test(L.drift('rc', rd('FR', 'rc'), 35).why) && /35%/.test(L.drift('rc', rd('FR', 'rc'), 35).why));
t('…a line nobody can state is never called off plan', L.drift('rc', rd('SE', 'rc'), 35) === null);
t('…no rule at all is', !!L.drift('rc', L.reading('rc', market('ZZ', 'b_zz', []), {}), 35));
t('units: N/A planned and none running is on plan; one running is off plan', L.drift('units', rd('GB', 'units', 'Everest'), 'off') === null && !!L.drift('units', rd('US', 'units', 'Everest'), 'off'));
t('hero: on planned — none, part or paused is off plan; off planned — on is', !!L.drift('hero', rd('IT', 'hero'), 'on') && !!L.drift('hero', rd('CA-EN', 'hero'), 'on') && !!L.drift('hero', rd('US', 'hero'), 'on') && !!L.drift('hero', rd('GB', 'hero'), 'off') && L.drift('hero', rd('GB', 'hero'), 'on') === null);
t('no plan value → nothing to be off', L.drift('rc', rd('FR', 'rc'), null) === null);

console.log('· the plan, a market’s own values, the periods');
const store = {
  'p:Superdry': { levers: [{ k: 'rc', bau: 35, sale: 20, lo: 20, hi: 40 }, { k: 'units', scope: 'Everest', bau: 'off', sale: 5, was: '> 5 units per size' }, { k: 'hero', bau: 'on', sale: null }] },
  'm:Superdry|IT': { lv: { rc: { bau: 21, sale: null }, hero: { bau: 'off', sale: null } } },
  'e:Superdry|bf-1': { name: 'Black Friday', from: '2026-11-20', to: '2026-12-01', mk: ['GB', 'FR', 'IT'], sale: { st: 'planned' }, bau: { st: 'planned' } },
  'e:Superdry|eoss-1': { name: 'Boxing Day', from: '2026-12-26', to: '2027-01-10', mk: ['GB'], sale: { st: 'planned' }, bau: { st: 'planned' } },
};
const P = L.planOf(store, 'Superdry');
t('a market’s own value wins; blank falls back to the brand’s', L.valueOf(P, store['m:Superdry|IT'], 'rc', 'bau') === 21 && L.valueOf(P, store['m:Superdry|IT'], 'rc', 'sale') === 20 && L.valueOf(P, null, 'rc', 'bau') === 35);
t('periods in date order, each with its id', eq(L.periodsOf(store, 'Superdry').map((p) => p.id), ['bf-1', 'eoss-1']));
const ps = L.periodsOf(store, 'Superdry');
t('before a period: BAU, expected BAU; the next step is the switch to SALE, in N days', (() => { const m = L.modeOf(ps, 'GB', '2026-11-10'), n = L.nextStep(ps[0], '2026-11-10'); return m.mode === 'bau' && m.expect === 'bau' && n.dir === 'sale' && n.days === 10; })());
t('inside it, not switched: still BAU but EXPECTED SALE — the nudge — and the switch is late', (() => { const m = L.modeOf(ps, 'GB', '2026-11-22'), n = L.nextStep(ps[0], '2026-11-22'); return m.mode === 'bau' && m.expect === 'sale' && n.late === 2; })());
const done = JSON.parse(JSON.stringify(ps)); done[0].sale = { st: 'done', by: 'A', at: 1 };
t('switched: SALE until the switch back is marked; a market outside the period stays BAU', L.modeOf(done, 'GB', '2026-11-22').mode === 'sale' && L.modeOf(done, 'NL', '2026-11-22').mode === 'bau' && L.nextStep(done[0], '2026-11-22').dir === 'bau');
t('over and not switched back: SALE, expected BAU, the switch back late', (() => { const m = L.modeOf(done, 'GB', '2026-12-03'); return m.mode === 'sale' && m.expect === 'bau' && L.nextStep(done[0], '2026-12-03').late === 2; })());
t('a period that never switched and is over is missed, not late', L.nextStep(ps[0], '2026-12-05').missed === true);
t('… and the summary says it was missed, never "0 days late"', (() => { const x = L.summaryText(L.model(store, 'Superdry', MKS, null, '2026-12-05'), 'Superdry', '2026-12-05'); return /Black Friday \(2026-11-20 → 2026-12-01\): switch to SALE missed — the period ended 2026-12-01/.test(x) && !/0 days late/.test(x); })());

console.log('· the switch list, and the brief');
const sw = L.switchList(P, store, 'Superdry', MKS, ['GB', 'FR', 'IT'], 'sale');
const rc = sw.changes.filter((c) => c.k === 'rc')[0];
t('one line per change, its markets together (35% → 20% in GB and FR)', rc && eq(rc.mk, ['GB', 'FR']) && rc.from === 35 && rc.to === 20, JSON.stringify(sw.changes));
t('…IT moves 21% → 20% on its own line (its own BAU)', sw.changes.some((c) => c.k === 'rc' && eq(c.mk, ['IT']) && c.from === 21 && c.to === 20));
t('each market names ITS rules to edit in FeedHero', rc.rules.GB.indexOf('Range Completion by Availability') >= 0 && rc.rules.FR.indexOf('Range Completion based Availability') >= 0);
t('a lever whose SALE value is not set is a BLOCKER, never assumed (hero sizes)', sw.blocked.some((b) => b.k === 'hero' && eq(b.mk, ['GB', 'FR', 'IT'])));
t('units N/A → > 5: listed even where no rule runs it yet', sw.changes.some((c) => c.k === 'units' && c.mk.indexOf('GB') >= 0 && eq(c.rules.GB, [])));
const back = L.switchList(P, store, 'Superdry', MKS, ['GB'], 'bau');
t('back to BAU is the same list the other way', back.changes.some((c) => c.k === 'rc' && c.from === 20 && c.to === 35));
const bl = L.briefLines(sw, 'Superdry', ps[0]);
t('the brief: the direction, the period, every change with its markets and the rule names, the blocker', /^Switch to SALE — Superdry — Black Friday \(2026-11-20 → 2026-12-01\)/.test(bl) && /Range completion: 35% → 20% — GB, FR/.test(bl)
  && /“Range Completion by Availability” \(GB\)/.test(bl) && /no rule runs it yet/.test(bl) && /⚠ Hero sizes: the SALE value is not set/.test(bl), bl);
t('…kept under the composer’s 2,000 characters', (() => { const big = { dir: 'sale', changes: Array.from({ length: 60 }, (_, i) => ({ k: 'rc', label: 'Range completion', from: 35, to: 20, mk: ['M' + i], rules: { ['M' + i]: ['A long rule name number ' + i + ' that goes on and on'] } })), blocked: [] }; return L.briefLines(big, 'X', null).length <= 1990; })());
t('nothing to change says so', /Nothing to change/.test(L.briefLines({ dir: 'sale', changes: [], blocked: [] }, 'X', null)));

console.log('· the dashboard model');
const M = L.model(store, 'Superdry', MKS.filter((m) => m.market !== 'SE'), ['GB', 'FR', 'NL', 'IT', 'SE', 'CA-EN', 'DK', 'US'], '2026-10-05');
t('one row per roster market — one not read yet is a row saying so', M.rows.length === 8 && M.rows.filter((r) => r.market === 'SE')[0].read === false && M.rows.filter((r) => r.market === 'SE')[0].cells.rc.rd === null);
t('each cell: the reading, the BAU and SALE in force, the target now, own or not, off plan or not', (() => { const c = M.rows.filter((r) => r.market === 'IT')[0].cells.rc; return c.rd.val === 21 && c.bau === 21 && c.sale === 20 && c.tgt === 21 && c.own === true && c.drift === null; })());
t('…the target in force names its source: IT’s own BAU now; in a sale, the brand’s SALE — never labelled IT’s own', (() => {
  const c = M.rows.filter((r) => r.market === 'IT')[0].cells.rc, s4 = JSON.parse(JSON.stringify(store));
  s4['m:Superdry|IT'] = { lv: { rc: { bau: 21, sale: null } } }; s4['e:Superdry|bf-1'].sale = { st: 'done', by: 'A', at: 1 };
  const c4 = L.model(s4, 'Superdry', MKS, null, '2026-11-22').rows.filter((r) => r.market === 'IT')[0].cells.rc;
  return c.tgtOwn === true && c4.tgt === P.levers.filter((l) => l.k === 'rc')[0].sale && c4.own === true && c4.tgtOwn === false; })());
t('IT keeps its own BAU (21%) — on plan; FR at 21% against 35% — off plan', !M.rows.filter((r) => r.market === 'IT')[0].cells.rc.drift && !!M.rows.filter((r) => r.market === 'FR')[0].cells.rc.drift);
t('the sums: markets, read, in SALE, due to switch, off plan', M.sum.markets === 8 && M.sum.read === 7 && M.sum.sale === 0 && M.sum.late === 0 && M.sum.drift === M.rows.filter((r) => M.levers.some((l) => r.cells[l.k].drift)).length);
t('the periods carry their next step', M.periods.length === 2 && M.periods[0].next.dir === 'sale');

console.log('· a SALE value to consider, and keeping a market as it runs');
const P0 = { levers: [{ k: 'rc', bau: 35, sale: null, lo: 20, hi: 40 }, { k: 'units', bau: 'off', sale: null, was: '> 5 units per size' }, { k: 'hero', bau: 'on', sale: null }] };
const sg = L.suggest(P0, MKS, 'rc');
t('range completion: the line a market’s rule names for a peak, quoting the rule and its markets', sg && sg.v === 20 && /“Range Completion \(BAU & Peak\) - 20%” in NL, IT/.test(sg.why), JSON.stringify(sg));
t('…else the band’s floor', (() => { const s2 = L.suggest(P0, [GB, FR], 'rc'); return s2 && s2.v === 20 && /floor/.test(s2.why); })());
t('units: what the lever ran at before', eq(L.suggest(P0, MKS, 'units'), { v: 5, why: 'what it ran at before (> 5 units per size)' }));
t('hero sizes: nothing in the rules says which way a sale takes them — no suggestion', L.suggest(P0, MKS, 'hero') === null);
const fr = M.rows.filter((r) => r.market === 'FR')[0];
t('"keep as it runs": the market’s own BAU is what it runs (21% · N/A · on)', eq(L.adopt(fr), { rc: { bau: 21, sale: null }, units: { bau: 'off', sale: null }, hero: { bau: 'on', sale: null } }), JSON.stringify(L.adopt(fr)));
t('…a line nobody can state is not written (the brand’s value stays in force)', (() => { const m2 = L.model(store, 'Superdry', [SE], ['SE'], '2026-10-05'); return !('rc' in L.adopt(m2.rows[0])); })());
t('…a market’s own SALE is kept', (() => { const s3 = JSON.parse(JSON.stringify(store)); s3['m:Superdry|FR'] = { lv: { rc: { bau: null, sale: 25 } } }; const m3 = L.model(s3, 'Superdry', [FR], ['FR'], '2026-10-05'); return L.adopt(m3.rows[0]).rc.sale === 25; })());

console.log('· the summary, in words');
const txt = L.summaryText(M, 'Superdry', '2026-10-05');
t('each lever: the plan, then the markets grouped by what they run — named, never a count alone', /^Superdry — stock levers, 2026-10-05/.test(txt) && /• Range completion: BAU 35% · SALE 20% \(band 20–40%\)/.test(txt) && /36% measured from the products — GB/.test(txt) && /not read yet — SE/.test(txt), txt);
t('…off plan named, and each period’s next step', /• Off plan: \d+ of 8 markets — /.test(txt) && /Black Friday \(2026-11-20 → 2026-12-01\): switch to SALE in 46 days/.test(txt));

console.log('· the worker’s half — what a signin may store');
const ctx = { brands: ['Superdry', 'Reiss'], inScope: (b) => b === 'Superdry', marketsOf: () => ['GB', 'FR', 'IT'], prev: () => null, by: 'Ray', now: 1000 };
const ok = (k, v, c) => W.sanitizeLeverKey(k, v, c || ctx);
t('a plan: the three levers, values checked by kind, the band kept for range completion, stamped here', eq(ok('p:Superdry', { levers: [{ k: 'rc', bau: 35, sale: 20, lo: 20, hi: 40 }], by: 'someone else', at: 5 }).value, { levers: [{ k: 'rc', bau: 35, sale: 20, lo: 20, hi: 40 }], note: '', by: 'Ray', at: 1000 }));
t('…refused: an unknown lever, the same lever twice, a % over 100, hero "maybe", a band upside down', !!ok('p:Superdry', { levers: [{ k: 'xx', bau: 1 }] }).error && !!ok('p:Superdry', { levers: [{ k: 'rc', bau: 1 }, { k: 'rc', bau: 2 }] }).error
  && !!ok('p:Superdry', { levers: [{ k: 'rc', bau: 120 }] }).error && !!ok('p:Superdry', { levers: [{ k: 'hero', bau: 'maybe' }] }).error && !!ok('p:Superdry', { levers: [{ k: 'rc', bau: 30, lo: 40, hi: 20 }] }).error);
t('…a brand off the roster or out of scope is refused', /roster/.test(ok('p:Nobody', { levers: [] }).error) && /scope/.test(ok('p:Reiss', { levers: [] }).error));
t('a market’s own values: only the brand’s roster markets, blanks dropped', eq(ok('m:Superdry|IT', { lv: { rc: { bau: 21 }, hero: { bau: null, sale: null } } }).value, { lv: { rc: { bau: 21, sale: null } }, by: 'Ray', at: 1000 }) && /not a Superdry market/.test(ok('m:Superdry|XX', { lv: {} }).error));
const per = { name: 'Black Friday', from: '2026-11-20', to: '2026-12-01', mk: ['gb', 'FR'], sale: { st: 'done', by: 'forged', at: 1 }, bau: { st: 'planned' } };
const pv = ok('e:Superdry|bf-1', per).value;
t('a period: a name, a day to a later day, the brand’s markets (upper-cased, deduped)', pv && pv.name === 'Black Friday' && eq(pv.mk, ['GB', 'FR']) && !!ok('e:Superdry|bf-1', Object.assign({}, per, { from: '2026-12-02' })).error && !!ok('e:Superdry|bf-1', Object.assign({}, per, { mk: [] })).error && !!ok('e:Superdry|bf-1', Object.assign({}, per, { name: '' })).error);
t('…who made a switch, and when, is the SERVER’s word (a forged stamp is replaced)', pv.sale.by === 'Ray' && pv.sale.at === 1000 && eq(pv.bau, { st: 'planned' }));
t('…a step the save did not move keeps the stamp it had', (() => { const c2 = Object.assign({}, ctx, { by: 'Steven', now: 2000, prev: () => ({ sale: { st: 'done', by: 'Ray', at: 1000 } }) }); const v2 = ok('e:Superdry|bf-1', per, c2).value; return v2.sale.by === 'Ray' && v2.sale.at === 1000; })());
t('a whole save is refused if any key is (nothing half-written)', (() => { const r = W.sanitizeLeverPut({ 'p:Superdry': { levers: [] }, 'm:Superdry|XX': { lv: {} } }, ctx); return r.errors.length === 1; })());
t('deletions only through _deleted (or a null value), each key checked', eq(W.sanitizeLeverPut({ _deleted: ['e:Superdry|bf-1'], 'm:Superdry|IT': null }, ctx).deleted.sort(), ['e:Superdry|bf-1', 'm:Superdry|IT']) && W.sanitizeLeverPut({ _deleted: ['e:Reiss|x-1'] }, ctx).errors.length === 1);
t('a signin reads only its brands', eq(Object.keys(W.leverView({ 'p:Superdry': {}, 'p:Reiss': {}, 'e:Reiss|a-1': {}, 'm:Superdry|GB': {} }, (b) => b === 'Superdry')).sort(), ['m:Superdry|GB', 'p:Superdry']));
t('the brands with a plan, and their periods', eq(W.leverBrands({ 'p:Superdry': { levers: [1, 2, 3] }, 'e:Superdry|a-1': {}, 'e:Superdry|b-2': {} }, ['Superdry', 'Reiss']), [{ client: 'Superdry', levers: 3, periods: 2 }]));

console.log('· Superdry’s plan as Ray stated it — seeded once');
const SD = W.LEVER_SEEDS.Superdry;
t('range completion: band 20–40%, BAU 35% ("currently at 35%"), SALE not set', eq(SD.levers[0], Object.assign({ k: 'rc', lo: 20, hi: 40, bau: 35, sale: null }, { note: SD.levers[0].note })));
t('stock unit exclusion for Everest: BAU N/A, was "> 5 units per size", SALE not set', SD.levers[1].k === 'units' && SD.levers[1].scope === 'Everest' && SD.levers[1].bau === 'off' && SD.levers[1].was === '> 5 units per size' && SD.levers[1].sale === null);
t('hero sizes: BAU on ("current activated"), SALE not set', SD.levers[2].k === 'hero' && SD.levers[2].bau === 'on' && SD.levers[2].sale === null);
t('every seed passes the sanitiser it will be edited through', SD.levers.every((l) => !ok('p:Superdry', { levers: [l] }).error));
const envx = { data: {}, meta: {} };
t('written once into an empty store, stamped from Ray’s brief', W.applyLeverSeeds(envx, 5) === 1 && envx.data['p:Superdry'].seed === 1 && /from Ray/.test(envx.data['p:Superdry'].by) && envx.meta['p:Superdry'].t === 5);
t('…never again, and never over a plan the team deleted (its tombstone counts)', W.applyLeverSeeds(envx, 6) === 0 && W.applyLeverSeeds({ data: {}, meta: { 'p:Superdry': { t: 1, del: true } } }, 6) === 0);

console.log('· route, page, stub, nothing committed');
t('worker: the engine served verbatim at /stock/levers.js (a Text module by the *_engine.js rule)', /import STOCKLEVERS_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/stocklevers_engine\.js";/.test(WK) && /path === '\/stock\/levers\.js'/.test(WK));
t('worker: GET/PUT /api/rules/levers — scoped, the kvmerge envelope with explicit tombstones, logged', /if \(path === '\/api\/rules\/levers' && \(request\.method === 'GET' \|\| request\.method === 'PUT'\)\)/.test(WK) && /LEVERS\.sanitizeLeverPut\(body, lctx\)/.test(WK)
  && /mergeIntoEnvelope\(lenv, incoming, base, now, \{ explicitTombstones: true \}\)/.test(WK) && /logActivity\(ctx, env, request, 'stock-levers'/.test(WK));
t('worker: writing needs the stock module; the stamps read what was stored', /if \(!\(acc\.owner \|\| moduleAllowed\(acc\.modules, 'stock'\)\)\) return json\(\{ ok: false, error: 'stock management is not in your access' \}, 403\);/.test(WK) && /prev: \(k\) => was\[k\] \|\| null/.test(WK));
t('worker: the seed applied on read, written back only when it wrote', /if \(LEVERS\.applyLeverSeeds\(lenv, now\)\) await env\.EDITS\.put\(LEVERS\.LEVERS_KEY, JSON\.stringify\(lenv\)\);/.test(WK));
t('page: the card, its engine, the store with a read-stamp, edits kept until the server confirms', /<section class="card" id="lev-card" hidden>/.test(SP) && /fetch\('\/stock\/levers\.js'/.test(SP) && /fetch\('\/api\/rules\/levers'/.test(SP) && /'X-Sync-Base': String\(LV\.base \|\| 0\)/.test(SP) && /function lvReapply\(\)/.test(SP));
t('page: the card renders with the page (and after every save)', /renderChips\(\); renderKpis\(\); renderLev\(\);/.test(SP));
t('page: → Brief opens the Workflow composer with the switch as the brief (technical, from the levers)', /location\.href = '\/workflow\?brief=' \+ lvB64\(\{ client: b, task: task, cat: 'technical', scope: scope, source: 'stock-levers' \}\)/.test(SP));
t('page: a switch marked briefed BEFORE the page leaves (flushed now, then navigate)', /lvSetStep\(q, dir, 'briefed', true, go\)/.test(SP));
t('page: every rule in the switch list opens on FeedHero', /fhUrl\(x\.cmpid, n\)/.test(SP));
t('stub: serves the lever engine and a synthetic store', /\/stock\/levers\.js/.test(ST) && /\/api\/rules\/levers/.test(ST));
t('harness wired into qa_gate, presync and validate', ['tools/qa_gate.sh', 'tools/presync.sh', '.github/workflows/validate.yml'].every((f) => read(f).indexOf('test_stocklevers.mjs') >= 0));
t('no lever store is committed (KV only)', !fs.existsSync(new URL('../ops/stocklevers', import.meta.url)));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
process.exit(fail ? 1 : 0);
