#!/usr/bin/env node
/*
 * SERVICES & PRICER engine harness (pure node, CI-safe) — docs/pricer_engine.js v2.
 * Ray, 7 Oct 2026: "attach and transform /pricer a little bit" — the custom Tachyon quote stays,
 * and the same engine now prices a client's SERVICES PACKAGE off the Golden Record audit.
 *
 * What this pins, in the order of the build spec (§8, items 1–16):
 *   1  the registry — VERSION, CATALOG untouched (the AI Quote reads it), PKG_ROWS kept OUT of it
 *   2  the v1 maths — rates() / tieredUnits() / quote() deep-equal to outputs RECORDED from the
 *      pre-change engine (git HEAD before this PR), embedded below as fixtures, so a later tidy-up
 *      cannot move a saved quote's figure
 *   3  quoteText — ex VAT, Spark AI, never "+VAT" or "Tachyon"
 *   4  classifyTach — the recorded table unchanged; the two new rules; every briefTask title ×
 *      every roster client classifying back to its own line
 *   5  parentCounter re-resolving item_group_id when the REAL Feed Lab XML parser grows its header
 *   6  needCollector on a hand-built feed with every case worked out by hand, parity with
 *      labelguard's own qualityCollector, the delimParser row-number trap, a late-debut column
 *   7  auditStored mapping every field off the real stores' shapes (built by labelguard's own
 *      collectors from the same rows), the -fb refusal, the CURRENT profile not G.score
 *   8  needsOf on the stored lane — unknown vs null keywords, the U() bounds, scope, D, T
 *   9  SKU → parent conversion (ratio / sku-ceiling / exact)
 *  10  packageQuote — reproduces quote() line for line when need = P, one block rounding over the
 *      union, the bundle on generation only, every exclusion listed, every client-safe blocker,
 *      contracted lines, re-use + β, the monthly
 *  11  the Spark AI twin byte-identical to the AI Quote's AIMODE:ENGINE block AND equal on 6+ builds
 *  12  the projection   13 costModel   14 proposalText (guard, tones, no Tachyon / annual / VAT-in)
 *  15  contractedFrom / rolloutStage / countedOption / quickWins / proposalRef / snapshotOption
 *  15b the review's confirmed findings (fix round 1), each pinned on the exact shape that failed:
 *      a 0-to-N bound read as "nothing to fix" [0], an empty live read zeroing a stored one [1],
 *      a one-market bundle zeroing every market's new products [2], a one-market Spark AI
 *      contract dropping the attribute everywhere [3], null + x in the monthly cost [4], the
 *      derived stage on declined siblings [5/18/29], a declined option counted [6], Pβ 0 → £0
 *      [7], scope-all upper bounds priced exact [8], β on SKUs [9], uncosted rule/language hours
 *      [10], the client count beside a contracted market [11], a typed P above S [12], "only you
 *      hold" [19], the duplicated snapshot needs [31], the store's frozen-field forms [33]; and
 *      the two additions — the tiers renamed Google-ready / AI-ready (A) and test packages (B)
 *  16  the engine stays pure (no import, require( or document.)
 *
 * Nothing here is a client figure: every feed is invented (Northwind), the roster names are read
 * from the worker only to prove a brief title can never be re-tagged by a client's name.
 *
 * Run: node tools/test_pricer.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as LG from '../cloudflare/feedspark-deck/src/labelguard.js';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const E = require('../docs/pricer_engine.js');
const Arr = require('../docs/arrivals_engine.js');
const FA = require('../docs/feedlab_engine.js');
const FC = require('../docs/catalog_engine.js');

let fails = 0, n = 0;
function ok(cond, what, extra) {
  n++;
  if (cond) return;
  fails++;
  console.log('  ✗ ' + what + (extra ? '\n      ' + extra : ''));
}
function eq(a, b, what) { ok(a === b, what, `got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
function near(a, b, what, tol) { ok(typeof a === 'number' && Math.abs(a - b) < (tol || 0.005), what, `got ${a}, expected ${b}`); }
const J = (x) => JSON.stringify(x);
function deq(a, b, what) { ok(J(a) === J(b), what, `got ${J(a).slice(0, 400)}\n      expected ${J(b).slice(0, 400)}`); }
const section = (t) => console.log('  ' + t);
const NOW = Date.UTC(2026, 9, 7, 12);   // 7 Oct 2026

/* the pre-change engine's outputs, recorded from git HEAD (pricer_engine.js 1.6.0) before v2 */
const FIX = {"version":"1.6.0","ratesDefault":[{"id":"title_gen","grp":"AI Titles","name":"AI Product Title Generation","aspl":6,"qc":3,"pm":2,"mon":2,"unit":0.08,"lead":10,"note":"","draft":true},{"id":"title_short","grp":"AI Titles","name":"AI Short Title Generation","aspl":4,"qc":2,"pm":1,"mon":1,"unit":0.05,"lead":7,"note":"","draft":true},{"id":"title_intent","grp":"AI Titles","name":"Title with AI Search Intent","aspl":8,"qc":4,"pm":2,"mon":2,"unit":0.12,"lead":12,"note":"","draft":true},{"id":"desc_gen","grp":"AI Description","name":"AI Product Description Generation","aspl":8,"qc":4,"pm":3,"mon":3,"unit":0.15,"lead":14,"note":"","draft":true},{"id":"desc_pro","grp":"AI Description","name":"AI Description Pro (Compare & Q/A)","aspl":12,"qc":6,"pm":3,"mon":4,"unit":0.25,"lead":18,"note":"","draft":true},{"id":"highlights","grp":"Product Highlights & Details","name":"AI Product Highlights","aspl":6,"qc":3,"pm":2,"mon":2,"unit":0.1,"lead":10,"note":"","draft":true},{"id":"details","grp":"Product Highlights & Details","name":"AI Product Details","aspl":6,"qc":3,"pm":2,"mon":2,"unit":0.1,"lead":10,"note":"","draft":true},{"id":"keywords","grp":"AI Keywords","name":"AI Keyword Generation","aspl":5,"qc":3,"pm":2,"mon":2,"unit":0.06,"lead":8,"note":"","draft":true},{"id":"visual_attr","grp":"AI Visual Attributes","name":"AI Visual Attribute Extraction","aspl":10,"qc":5,"pm":3,"mon":3,"unit":0.2,"lead":15,"note":"","draft":true},{"id":"gpc","grp":"GPC Mapping & PT","name":"AI GPC Mapping","aspl":6,"qc":3,"pm":2,"mon":1,"unit":0.05,"lead":8,"note":"","draft":true},{"id":"pt_class","grp":"GPC Mapping & PT","name":"AI Product Type Classification","aspl":6,"qc":3,"pm":2,"mon":1,"unit":0.05,"lead":8,"note":"","draft":true}],"ratesOver":[{"id":"title_gen","grp":"AI Titles","name":"AI Product Title Generation","aspl":7,"qc":3,"pm":2,"mon":2,"unit":0.09,"lead":10,"note":"","draft":false},{"id":"title_short","grp":"AI Titles","name":"AI Short Title Generation","aspl":4,"qc":2,"pm":1,"mon":1,"unit":0.05,"lead":7,"note":"","draft":true},{"id":"title_intent","grp":"AI Titles","name":"Title with AI Search Intent","aspl":8,"qc":4,"pm":2,"mon":2,"unit":0.12,"lead":12,"note":"","draft":true},{"id":"desc_gen","grp":"AI Description","name":"AI Product Description Generation","aspl":8,"qc":4,"pm":3,"mon":3,"unit":0.15,"lead":20,"note":"","draft":false},{"id":"desc_pro","grp":"AI Description","name":"AI Description Pro (Compare & Q/A)","aspl":12,"qc":6,"pm":3,"mon":4,"unit":0.25,"lead":18,"note":"","draft":true},{"id":"highlights","grp":"Product Highlights & Details","name":"AI Product Highlights","aspl":6,"qc":3,"pm":2,"mon":2,"unit":0.1,"lead":10,"note":"","draft":true},{"id":"details","grp":"Product Highlights & Details","name":"AI Product Details","aspl":6,"qc":3,"pm":2,"mon":2,"unit":0.1,"lead":10,"note":"","draft":true},{"id":"keywords","grp":"AI Keywords","name":"AI Keyword Generation","aspl":5,"qc":3,"pm":2,"mon":2,"unit":0.06,"lead":8,"note":"","draft":false},{"id":"visual_attr","grp":"AI Visual Attributes","name":"AI Visual Attribute Extraction","aspl":10,"qc":5,"pm":3,"mon":3,"unit":0.2,"lead":15,"note":"","draft":true},{"id":"gpc","grp":"GPC Mapping & PT","name":"AI GPC Mapping","aspl":6,"qc":3,"pm":2,"mon":1,"unit":0.05,"lead":8,"note":"checked","draft":false},{"id":"pt_class","grp":"GPC Mapping & PT","name":"AI Product Type Classification","aspl":6,"qc":3,"pm":2,"mon":1,"unit":0.05,"lead":8,"note":"","draft":true}],"tiered":[{"units":0,"bands":[]},{"units":1,"bands":[{"from":0,"upTo":1,"x":1,"products":1,"skus":1}]},{"units":4999,"bands":[{"from":0,"upTo":4999,"x":1,"products":4999,"skus":4999}]},{"units":5000,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000}]},{"units":5000.8,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":5001,"x":0.8,"products":1,"skus":1}]},{"units":17000,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":20000,"x":0.8,"products":15000,"skus":15000}]},{"units":48105,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":20000,"x":0.8,"products":15000,"skus":15000},{"from":20000,"upTo":50000,"x":0.65,"products":30000,"skus":30000},{"from":50000,"upTo":73210,"x":0.5,"products":23210,"skus":23210}]},{"units":136500,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":20000,"x":0.8,"products":15000,"skus":15000},{"from":20000,"upTo":50000,"x":0.65,"products":30000,"skus":30000},{"from":50000,"upTo":250000,"x":0.5,"products":200000,"skus":200000}]}],"q1":{"picks":["title_gen","keywords","gpc"],"volume":12314,"unit":"product","skus":30011,"tier":{"units":10851.2,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":12314,"x":0.8,"products":7314,"skus":7314}]},"blockGBP":585,"blockHours":8,"lines":[{"id":"title_gen","name":"AI Product Title Generation","grp":"AI Titles","hours":11,"mon":2,"unit":0.08,"tachyon":868.1,"lead":10,"draft":true},{"id":"keywords","name":"AI Keyword Generation","grp":"AI Keywords","hours":10,"mon":2,"unit":0.06,"tachyon":651.07,"lead":8,"draft":true},{"id":"gpc","name":"AI GPC Mapping","grp":"GPC Mapping & PT","hours":11,"mon":1,"unit":0.05,"tachyon":542.56,"lead":8,"draft":true}],"oneOff":{"hours":32,"byRole":{"aspl":17,"qc":9,"pm":6},"blocks":4,"blockCost":2340,"tachyon":2061.73,"total":4401.73},"monthly":{"monHours":5,"absorbed":false,"blocks":1,"blockCost":585,"refreshPct":0.05,"refreshTachyon":103.09,"total":688.09},"slaDays":14,"draftRates":true,"client":"Northwind","market":"gb"},"q2":{"picks":["desc_gen","highlights","details","pt_class","visual_attr"],"volume":64000,"unit":"product","skus":0,"tier":{"units":43500,"bands":[{"from":0,"upTo":5000,"x":1,"products":5000,"skus":5000},{"from":5000,"upTo":20000,"x":0.8,"products":15000,"skus":15000},{"from":20000,"upTo":50000,"x":0.65,"products":30000,"skus":30000},{"from":50000,"upTo":64000,"x":0.5,"products":14000,"skus":14000}]},"blockGBP":600,"blockHours":7.5,"lines":[{"id":"desc_gen","name":"AI Product Description Generation","grp":"AI Description","hours":15,"mon":3,"unit":0.2,"tachyon":8700,"lead":14,"draft":false},{"id":"highlights","name":"AI Product Highlights","grp":"Product Highlights & Details","hours":14,"mon":2,"unit":0.1,"tachyon":4350,"lead":10,"draft":false},{"id":"details","name":"AI Product Details","grp":"Product Highlights & Details","hours":11,"mon":2,"unit":0.1,"tachyon":4350,"lead":10,"draft":true},{"id":"pt_class","name":"AI Product Type Classification","grp":"GPC Mapping & PT","hours":11,"mon":1,"unit":0.05,"tachyon":2175,"lead":8,"draft":true},{"id":"visual_attr","name":"AI Visual Attribute Extraction","grp":"AI Visual Attributes","hours":18,"mon":3,"unit":0.2,"tachyon":8700,"lead":15,"draft":true}],"oneOff":{"hours":69,"byRole":{"aspl":39,"qc":18,"pm":12},"blocks":10,"blockCost":6000,"tachyon":28275,"total":34275},"monthly":{"monHours":11,"absorbed":true,"blocks":0,"blockCost":0,"refreshPct":1,"refreshTachyon":28275,"total":28275},"slaDays":23,"draftRates":true,"client":"Atelier","market":""},"q3":{"picks":["title_short","title_intent","desc_pro"],"volume":3500,"unit":"product","skus":0,"tier":{"units":2000,"bands":[{"from":0,"upTo":1000,"x":1,"products":1000,"skus":1000},{"from":1000,"upTo":3500,"x":0.4,"products":2500,"skus":2500}]},"blockGBP":585,"blockHours":8,"lines":[{"id":"title_short","name":"AI Short Title Generation","grp":"AI Titles","hours":4.75,"mon":1,"unit":0.05,"tachyon":100,"lead":6,"draft":false},{"id":"title_intent","name":"Title with AI Search Intent","grp":"AI Titles","hours":14,"mon":2,"unit":0.12,"tachyon":240,"lead":12,"draft":true},{"id":"desc_pro","name":"AI Description Pro (Compare & Q/A)","grp":"AI Description","hours":21,"mon":4,"unit":0.3,"tachyon":600,"lead":18,"draft":false}],"oneOff":{"hours":39.75,"byRole":{"aspl":22.5,"qc":11.25,"pm":6},"blocks":5,"blockCost":2925,"tachyon":940,"total":3865},"monthly":{"monHours":7,"absorbed":false,"blocks":1,"blockCost":585,"refreshPct":0.1,"refreshTachyon":94,"total":679},"slaDays":24,"draftRates":true,"client":"","market":""},"q0":{"picks":[],"volume":0,"unit":"product","skus":0,"tier":{"units":0,"bands":[]},"blockGBP":585,"blockHours":8,"lines":[],"oneOff":{"hours":0,"byRole":{"aspl":0,"qc":0,"pm":0},"blocks":0,"blockCost":0,"tachyon":0,"total":0},"monthly":{"monHours":0,"absorbed":false,"blocks":0,"blockCost":0,"refreshPct":0,"refreshTachyon":0,"total":0},"slaDays":0,"draftRates":false,"client":"","market":""},"classify":[["AI Product Title Generation — Monsoon","title_gen"],["AI Short Title Generation — Reiss GB","title_short"],["Title with AI Search Intent","title_intent"],["AI Search Intent — Hobbycraft","title_intent"],["AI Pre-Description — Accessorize",""],["AI Product Details — Monsoon","details"],["AI Question & Answer — Superdry","desc_pro"],["AI Text Attribute — Hobbycraft",""],["AI Visual Attribute — Accessorize","visual_attr"],["AI Description Pro (Compare & Q/A) — Schuh","desc_pro"],["AI Product Description Generation — Reiss","desc_gen"],["AI Product Highlights — Superdry","highlights"],["AI Keyword Generation — YuMOVE","keywords"],["AI GPC Mapping — Hobbycraft","gpc"],["AI Product Type Classification — Schuh","pt_class"],["Tachyon setup — AI Product Title Generation + AI Keyword Generation (12,314 parent products · GB) · one-off £1,200 +VAT","keywords"],["Tachyon setup — AI Product Highlights + AI Product Details (500 parent products)","highlights"],["tachyon titles batch 2","title_gen"],["Keyword optimisation - Gifting",""],["AI image attributes harvest","visual_attr"],["ai classification of categories","pt_class"],["AI q/a pairs","desc_pro"],["AI question and answer generation","desc_pro"],["Compare products AI","desc_pro"],["AI descriptions refresh","desc_gen"],["Golden Record Fix - g:color - Reiss GB - Oct26",""],["AI title rewrite — dresses","title_gen"],["Tachyon: product type cleanup","pt_class"],["AI GPC","gpc"],["Title optimisation — Monsoon",""],["",""],[null,""],["AI",""],["AI product detail extraction","details"],["AI predesc run",""]]};

console.log('Services & Pricer engine — v2 on top of an unchanged v1\n');

/* ---------- 1. registry ---------- */
section('1 · registry');
eq(E.VERSION, '2.0.0', 'VERSION is 2.0.0');
eq(E.CATALOG.map((c) => c.id).join(','), 'title_gen,title_short,title_intent,desc_gen,desc_pro,highlights,details,keywords,visual_attr,gpc,pt_class',
  'CATALOG is still the 11 optimisations, in order (the AI Quote builds its catalogue from it)');
deq(E.CATALOG, FIX.ratesDefault.map((r) => ({ id: r.id, grp: r.grp, name: r.name, aspl: r.aspl, qc: r.qc, pm: r.pm, mon: r.mon, unit: r.unit, lead: r.lead })),
  'every CATALOG row is byte-for-byte the pre-change row');
eq(E.PKG_ROWS.map((r) => r.id).join(','), 'attr_pop', 'PKG_ROWS = [attr_pop]');
ok(!E.CATALOG.some((c) => c.id === 'attr_pop'), 'attr_pop is NOT in CATALOG (it would appear as a per-SKU field on every AI Quote)');
ok(E.LIVE_IDS.attr_pop === 1 && E.LIVE_IDS.title_gen === 1, 'LIVE_IDS carries attr_pop beside the catalogue');
eq(E.PKG_LINES.map((l) => l.key).join(','), 'title,keywords,ptype,gpc,attr_ai,attr_rule,client,highlights,details,desc,conv', 'the eleven package lines');
eq(E.PKG_LINES.filter((l) => l.pkg === 'go').length, 7, 'seven Tier-1 lines'); eq(E.PKG_LINES.filter((l) => l.pkg === 'ar').length, 4, 'four AI Readiness lines');
eq(E.PKG_LINES.find((l) => l.key === 'attr_ai').grain, 'sku', 'attribute population is priced per SKU value');
eq(E.langOf('gb'), 'en', 'gb is English'); eq(E.langOf('BEFR'), 'fr', 'befr is French'); eq(E.langOf('kw'), 'm:kw', 'an unlisted market is its own group, never guessed');
ok(E.AIM_NEWNESS_DEFAULT === 10.5 && E.AIM_RATE_DEFAULT.dayRate === 695, 'Spark AI defaults exported');
ok(typeof E.aim.build === 'function', 'aim.build exported');

/* ---------- 2. the v1 maths, against the recorded pre-change outputs ---------- */
section('2 · rates() / tieredUnits() / quote() unchanged');
deq(E.rates(), FIX.ratesDefault, 'rates() with no overrides');
deq(E.rates({ title_gen: { unit: 0.09, aspl: 7, t: 1 }, gpc: { note: 'checked' }, keywords: { unit: '' }, desc_gen: { qc: 'x', lead: 20 } }), FIX.ratesOver, 'rates() with overrides (bad values ignored, draft cleared exactly as before)');
deq([0, 1, 4999, 5000, 5001, 20000, 73210.6, 250000].map((v) => E.tieredUnits(v)), FIX.tiered, 'tieredUnits() across the ladder');
const Q1 = E.quote(['title_gen', 'keywords', 'gpc'], { volume: 12314, skus: 30011, absorbMonitoring: false, refreshPct: 0.05, client: 'Northwind', market: 'gb' });
deq(Q1, FIX.q1, 'quote #1 (three lines, refresh, monitoring blocks)');
deq(E.quote(['desc_gen', 'highlights', 'details', 'pt_class', 'visual_attr'], { volume: 64000.7, skus: 0,
  rateOverrides: { desc_gen: { unit: 0.2, t: 1 }, highlights: { aspl: 9 } }, blockGBP: 600, blockHours: 7.5, absorbMonitoring: true, refreshPct: 2, client: 'Atelier', market: '' }),
  FIX.q2, 'quote #2 (overrides, custom block, absorbed, refresh clamped)');
const act3 = { title_short: { n: 3, aspl: 2.5, qc: 1.25, pm: 1, mon: 0, lead: 6 }, title_intent: { n: 0, aspl: 9 } };
deq(E.quote(['title_short', 'title_intent', 'desc_pro', 'nope'], { volume: 3500, tiers: [{ upTo: 1000, x: 1 }, { upTo: Infinity, x: 0.4 }],
  rateOverrides: E.overridesWithActuals({ desc_pro: { unit: 0.3 } }, act3), staggerDays: 3, refreshPct: 0.1 }), FIX.q3, 'quote #3 (custom tiers, actuals layered, unknown pick dropped)');
deq(E.quote([], {}), FIX.q0, 'quote #0 (empty)');

/* ---------- 3. quoteText ---------- */
section('3 · quoteText wording');
const QT = E.quoteText(Q1);
ok(/ex VAT/.test(QT), 'quoteText says ex VAT');
ok(!/\+\s?VAT/.test(QT), 'no "+VAT" left');
ok(!/tachyon/i.test(QT), 'no "Tachyon" in client copy');
ok(/^SPARK AI OPTIMISATION — Northwind \(GB\)/.test(QT), 'header reads SPARK AI OPTIMISATION');
ok(/Spark AI processing \(volume-tiered\): £2,061\.73 ex VAT/.test(QT), 'Spark AI processing line, figure unchanged');
ok(QT.indexOf(E.fmtGBP(FIX.q1.oneOff.total)) >= 0 && QT.indexOf(E.fmtGBP(FIX.q1.monthly.total)) >= 0, 'the totals printed are the recorded totals');
ok(!/annual|year 1|× ?12|\*12/i.test(QT), 'no annual money');

/* ---------- 4. classifyTach + briefTask ---------- */
section('4 · classifyTach + briefTask');
FIX.classify.forEach(([t, want]) => eq(E.classifyTach(t), want, 'unchanged: ' + JSON.stringify(t)));
eq(E.classifyTach('Conversational attributes (Spark AI) — Q&A'), '', 'conversational briefs are Spark AI work — no longer AI Description Pro');
eq(E.classifyTach('AI conversational Q&A pairs'), '', 'conversational wording beats the Q&A rule');
eq(E.classifyTach('AI attribute population — colour batch 3'), 'attr_pop', 'attribute population → attr_pop');
eq(E.classifyTach('AI Attribute Population (colour · material · pattern) — Northwind GB — anything'), 'attr_pop', 'the attr_pop catalogue name leads → attr_pop');
// every package line × every roster client — read from the worker, plus names built to trip the wording rules
const W = read('cloudflare/feedspark-deck/src/worker.js');
function keysOf(constName) {
  const i = W.indexOf('const ' + constName + ' = {'), j = W.indexOf('\n};', i), body = W.slice(i, j), out = [];
  for (const m of body.matchAll(/^ {2}(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w ]*)):/gm)) out.push(m[1] || m[2] || m[3]);
  return out;
}
const roster = Array.from(new Set([].concat(keysOf('DEFAULT_FEEDS'), keysOf('PLAN_SHEETS'), Object.keys(LG.INDUSTRY), ['Visual K', 'Compare & Contrast Q/A Ltd', 'Short Title Co'])));
ok(roster.length >= 18 && roster.indexOf('Schuh') >= 0 && roster.indexOf('House of Bruar') >= 0, 'roster read from DEFAULT_FEEDS ∪ PLAN_SHEETS ∪ INDUSTRY (' + roster.length + ' names)');
let briefBad = [];
E.PKG_LINES.forEach((l) => roster.forEach((c) => ['gb', 'de', ''].forEach((m) => {
  const t = E.briefTask(l, c, m, l.label, 'SVC123456');
  if (E.classifyTach(t) !== l.cat) briefBad.push(t + ' → ' + E.classifyTach(t) + ' (want ' + l.cat + ')');
})));
eq(briefBad.length, 0, 'every briefTask title classifies back to its own line\'s cat (' + E.PKG_LINES.length * roster.length * 3 + ' titles)' + (briefBad.length ? ': ' + briefBad.slice(0, 3).join(' | ') : ''));
eq(E.briefTask('title', 'Northwind', 'gb', 'Title optimisation', 'SVC000123'), 'AI Product Title Generation — Northwind GB — Title optimisation (SVC000123)', 'briefTask format');
eq(E.briefTask('conv', 'Northwind', 'gb', 'Q&A'), 'Conversational attributes (Spark AI) — Northwind GB — Q&A', 'briefTask without a ref');

/* ---------- 5. parentCounter re-resolves on the live header ---------- */
section('5 · parentCounter on a growing header');
function xmlFeed(items) {
  return '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>' + items.map((it) =>
    '<item>' + Object.keys(it).map((k) => '<g:' + k + '>' + it[k] + '</g:' + k + '>').join('') + '</item>').join('\n') + '</channel></rss>';
}
const grow = [];
for (let i = 1; i <= 70; i++) {
  const it = { id: 'p' + i, title: 'Northwind item ' + i, google_product_category: 'Apparel &amp; Accessories &gt; Clothing &gt; Shirts &amp; Tops' };
  if (i >= 60) { it.item_group_id = 'G' + Math.floor(i / 2); it.color = 'Blue'; }   // both debut at item 60, past the 50-item sample
  grow.push(it);
}
{
  const pc = E.parentCounter(FA.normKey), seen = [];
  const px = FA.createXmlParser((r, h) => { seen.push(h ? h.length : 0); pc.row(r, h); });
  px.push(xmlFeed(grow)); px.end();
  const r = pc.result();
  ok(seen[seen.length - 1] > seen[0], 'the real Feed Lab parser grew its header mid-stream (the case under test)');
  eq(r.rows, 70, '70 SKUs'); eq(r.grouped, 11, 'the 11 rows after the debut carry a group');
  eq(r.products, 59 + 6, 'products = 59 ungrouped + 6 groups after the debut (the pre-fix counter read 70)');
  ok(r.hasGroups, 'hasGroups once the column appears');
  const pc2 = E.parentCounter();
  pc2.row(['id', 'item_group_id']); pc2.row(['a', 'G'], 7); pc2.row(['b', 'G'], 8);
  eq(pc2.result().products, 1, 'a row NUMBER as the second argument (delimParser) is ignored');
  const pc3 = E.parentCounter(); pc3.header(['id', 'item_group_id']); pc3.row(['a', 'G']); pc3.row(['b', '']);
  eq(pc3.result().products, 2, 'the v1 call shape (header() then row(r)) still counts');
}

/* ---------- 6. needCollector ---------- */
section('6 · needCollector — exact needs per parent');
const H = ['id', 'item_group_id', 'title', 'description', 'brand', 'link', 'image_link', 'availability', 'price', 'gtin', 'mpn', 'google_product_category',
  'product_type', 'product_type(2)', 'product_type(3)', 'product_highlight', 'product_highlight(2)', 'product_detail', 'color', 'material', 'pattern',
  'gender', 'age_group', 'size', 'size_type', 'size_system', 'condition', 'fs_date_of_birth'];
const GOOD_TITLE = 'Northwind Mens Linen Shirt in White with a Relaxed Fit and Short Sleeves for Summer';
const APP = 'Apparel & Accessories > Clothing > Shirts & Tops';
const D = { id: '', item_group_id: '', title: GOOD_TITLE, description: 'x'.repeat(600), brand: 'Northwind', link: 'https://n.example/p', image_link: 'https://n.example/i.jpg',
  availability: 'in_stock', price: '10.00 GBP', gtin: '5012345678900', mpn: '', google_product_category: APP, product_type: 'Men > Shirts > Linen',
  'product_type(2)': 'linen shirt > summer shirt', 'product_type(3)': '', product_highlight: 'Breathable linen', 'product_highlight(2)': 'Relaxed fit|||Easy care|||Made in Portugal',
  product_detail: 'Fabric:material:linen', color: 'White', material: 'Linen', pattern: 'Plain', gender: 'male', age_group: 'adult', size: 'M',
  size_type: 'regular', size_system: 'UK', condition: 'new', fs_date_of_birth: '2026-03-15' };
const row = (o) => H.map((k) => (o[k] != null ? o[k] : D[k]));
const ROWS = [
  row({ id: 'r1', item_group_id: 'G1' }),
  row({ id: 'r2', item_group_id: 'G1', title: 'SALE ON NOW SHIRT' }),                                    // caps + promo + thin + no-brand
  row({ id: 'r3', item_group_id: 'G2', description: '', material: 'none' }),                             // empty description, placeholder material
  row({ id: 'r4', item_group_id: 'G2', description: 'x'.repeat(200) }),
  row({ id: 'r5', item_group_id: 'G3', product_highlight: '', 'product_highlight(2)': '' }),            // no highlights
  row({ id: 'r6', item_group_id: 'G3', description: 'x'.repeat(100), link: '' }),
  row({ id: 'r7', product_type: 'Shirts', google_product_category: 'Apparel/Shoes', color: 'n/a' }),     // single-level PT, GPC fires two rules, colour invalid
  row({ id: 'r8', item_group_id: 'G5', product_type: 'Men>Shirts>Linen', description: 'x'.repeat(400) }), // separator rule fails
  row({ id: 'r9', item_group_id: 'G5', product_highlight: 'One', 'product_highlight(2)': '', pattern: '' }),
  row({ id: 'r10', description: 'x'.repeat(1200), google_product_category: 'Home & Garden > Kitchen & Dining > Tableware', 'product_type(2)': 'a3f9c2e1b4d5a6f7a3f9c2e1b4d5a6f7', product_detail: '',
    color: '', material: '', gender: '', gtin: '', size_type: '', size_system: '', condition: '', fs_date_of_birth: 'not a date' }),
  row({ id: 'r11', item_group_id: 'G7', google_product_category: '', color: '', gender: '', age_group: '', size: '', fs_date_of_birth: '2026-05-10' }),
  row({ id: 'r12', item_group_id: 'G7', title: 'Classic Cotton Oxford Shirt in Pale Blue with a Button Down Collar and Chest Pocket',
    google_product_category: 'Gibberish Category', color: 'Red', product_highlight: 'Alpha|||Beta', 'product_highlight(2)': '', product_detail: '', fs_date_of_birth: '2026-02-01' }),
  row({ id: '', item_group_id: 'G1' })                                                                   // no id — skipped
];
// self-check the fixture: the default row breaks no title rule, so every title finding is deliberate
const tq = LG.qspecOf('title');
ok(tq.rules.filter((r) => r.test && !['space', 'dupe'].includes(r.id)).every((r) => !r.test(GOOD_TITLE, { brand: 'Northwind', title: GOOD_TITLE }, GOOD_TITLE)), 'fixture: the default title passes every title rule');
const nc = E.needCollector(LG, Arr);
nc.onRow(H.slice());
ROWS.forEach((r, i) => nc.onRow(r, i));                       // a NUMBER as the second argument, like delimParser
const NC = nc.finish();
eq(NC.S, 12, 'S = 12 SKU rows with an id'); eq(NC.P, 7, 'P = 7 parents'); eq(NC.noId, 1, 'the id-less row counted in noId and nothing else');
ok(NC.hasGroups === true && NC.grouped === 10, 'hasGroups + 10 grouped rows');
const tmask = (ids) => ids.reduce((m, id) => m | (1 << E.TITLE_BITS.indexOf(id)), 0);
deq(NC.title.masks[tmask(['caps', 'promo', 'thin', 'no-brand'])], [1, 1], 'r2: caps + promo + thin + no-brand — one SKU, and G1\'s OR-folded parent mask');
deq(NC.title.masks[tmask(['no-brand'])], [1, 1], 'r12: brand missing only — and G7');
deq(NC.title.masks['0'], [10, 5], 'ten clean title rows, five clean parents');
deq(NC.desc.b, { empty: [1, 1], lt160: [1, 1], lt300: [1, 0], lt500: [1, 1], lt1000: [7, 3], ok: [1, 1] }, 'description buckets: SKUs + parents by their WORST row');
deq(NC.hl.h, { 0: [1, 1], 1: [1, 1], 2: [1, 1], 3: [0, 0], 4: [9, 4], 5: [0, 0], '6+': [0, 0] }, 'highlight counts across both columns; parents by their FEWEST');
deq(NC.pt.h, { 0: [1, 1], 1: [1, 1], 2: [0, 0], 3: [10, 5], 4: [0, 0], 5: [0, 0], '6+': [0, 0] }, 'product type depth; the badly separated path scores 0');
deq(NC.gpc.masks, { 0: [9, 5], 1: [1, 0], 4: [1, 0], 6: [1, 1], 5: [0, 1] }, 'GPC: "Apparel/Shoes" is ONE row with two bits (counted once); G7 folds empty + shallow');
deq(NC.kw, { slots: 2, none: [1, 1] }, 'a 32-hex id in a keyword slot is not a keyword');
deq(NC.det, { empty: [2, 2] }, 'product details missing on r10 + r12');
deq(NC.attrs.color, { n: 11, u: 3, miss: 1, inv: 1, missP: 1, invP: 1 }, 'colour: the kitchen row is out of scope, three unreadable categories stay IN scope (u), n/a is invalid');
deq(NC.attrs.material, { n: 11, u: 3, miss: 0, inv: 1, missP: 0, invP: 1 }, 'material: "none" is a placeholder');
deq(NC.attrs.pattern, { n: 11, u: 3, miss: 1, inv: 0, missP: 1, invP: 0 }, 'pattern: one missing value');
deq(NC.rule, { gender: { n: 11, u: 3, miss: 1 }, age_group: { n: 11, u: 3, miss: 1 }, size_type: { n: 12, miss: 1 }, size_system: { n: 12, miss: 1 }, condition: { n: 12, miss: 1 } }, 'rule attributes: gender/age group in scope, the rest over every row');
deq(NC.client, { link: 1, image_link: 0, availability: 0, price: 0, brand: 0, gtin_mpn: 1, item_group_id: 2, size: { n: 11, u: 3, miss: 1 } }, 'client data counted');
deq(NC.dob, { col: true, sku: { n: 11, bad: 1, m: { '2026-03': 9, '2026-05': 1, '2026-02': 1 } }, par: { n: 6, m: { '2026-03': 5, '2026-02': 1 } } }, 'first-seen: a parent is dated by its EARLIEST row; an undated parent is not dated');
// a parent's fold cannot depend on which of its rows arrives first: the same rows reversed give the same pairs
{
  const ncr = E.needCollector(LG, Arr);
  ncr.onRow(H.slice()); ROWS.slice().reverse().forEach((r) => ncr.onRow(r));
  const NR = ncr.finish();
  ['title', 'gpc'].forEach((k) => deq(NR[k].masks, NC[k].masks, k + ' masks are order-independent (OR across rows)'));
  ['desc', 'hl', 'pt'].forEach((k) => deq(NR[k][k === 'desc' ? 'b' : 'h'], NC[k][k === 'desc' ? 'b' : 'h'], k + ' is order-independent (worst / fewest / shallowest row)'));
  deq([NR.kw, NR.det, NR.attrs], [NC.kw, NC.det, NC.attrs], 'keywords, details, attributes order-independent');
  deq(NR.dob.par, { n: 6, m: { '2026-02': 1, '2026-03': 5 } }, 'a parent\'s first-seen month is its EARLIEST row in either order');
}
// parity with labelguard's own content-quality collector on the same rows (SKU grain)
const qcol = LG.qualityCollector(LG.findAttrCols(H), { header: H });
ROWS.filter((r) => r[0]).forEach((r) => qcol.onRow(r));
const QS = qcol.finish();
['len-over', 'caps', 'promo', 'gimmick', 'thin', 'short', 'no-brand'].forEach((id) => {
  const b = 1 << E.TITLE_BITS.indexOf(id);
  const s = Object.keys(NC.title.masks).reduce((t, m) => t + ((+m & b) ? NC.title.masks[m][0] : 0), 0);
  eq(s, QS.attrs.title.rules[id].n, 'title rule ' + id + ' at SKU grain = qualityCollector');
});
const hl = QS.attrs.product_highlight;
eq(NC.hl.h['1'][0] + NC.hl.h['2'][0] + NC.hl.h['3'][0], hl.rules['count-min'].n + hl.rules['count-low'].n, 'highlights 1–3 at SKU grain = count-min + count-low');
eq(NC.hl.h['0'][0], 12 - hl.filled, 'no highlight = rows − filled');
eq(NC.gpc.masks['6'][0] + NC.gpc.masks['4'][0], QS.attrs.google_product_category.rules.shallow.n, 'GPC shallow at SKU grain = qualityCollector');
eq(NC.desc.b.lt160[0], QS.attrs.description.rules.thin.n, 'description lt160 = the thin rule');
// needs from the counts (exact)
const PRN = { overrides: { industries: { Retail: { expected: ['color', 'size', 'gender', 'age_group', 'item_group_id'], waived: [] } }, clients: {} } };
const AF = E.auditMerge(null, { nc: NC, src: 'file', client: 'Northwind', mkt: 'gb', industry: 'Fashion', PR: PRN }, LG, Arr, NOW);
const NX = E.needsOf(AF, {}, LG);
eq(NX.title.n, 2, 'title: the parents with ANY failing row (G1 caps/promo/thin, G7 no brand)'); eq(NX.title.est, null, 'exact');
const AFw = Object.assign({}, AF, { prof: Object.assign({}, AF.prof, { qwaived: ['title:no-brand'] }) });
eq(E.needsOf(AFw, {}, LG).title.n, 1, 'title: "no-brand" set aside at need time — G7 drops out, no re-stream');
eq(E.needsOf(AF, { descTarget: 160 }, LG).desc.n, 2, 'desc to 160: G2 (empty) + G3 (<160)');
eq(E.needsOf(AF, { descTarget: 300 }, LG).desc.n, 2, 'desc to 300: no parent\'s worst row sits in 160–300');
eq(E.needsOf(AF, { descTarget: 500 }, LG).desc.n, 3, 'desc to 500: + G5');
eq(E.needsOf(AF, { descTarget: 1000 }, LG).desc.n, 6, 'desc to 1,000: every parent but the 1,200-character one');
eq(E.needsOf(AF, { hlTarget: 4 }, LG).highlights.n, 3, 'highlights to 4: G3, G5, G7'); eq(NX.highlights.n, 7, 'highlights to 6 (house default): every parent');
eq(NX.ptype.n, 2, 'product type to 3 levels: the single-level parent + the badly separated one');
eq(E.needsOf(AF, { ptMinDepth: 4 }, LG).ptype.n, 7, 'product type to 4: every parent');
eq(NX.gpc.n, 2, 'GPC: p4 once (two rules on one value) + G7');
eq(NX.keywords.n, 1, 'keywords: the hex-only parent'); eq(NX.details.n, 2, 'details: G7 + p6');
eq(NX.attr_ai.n, 4, 'attribute population: 1 + 1 colour, 1 material, 1 pattern (SKU values)'); eq(NX.attr_ai.grain, 'sku', 'SKU grain');
ok(/category unreadable on 3/.test(NX.attr_ai.why), 'the unreadable categories are named');
const AFpet = Object.assign({}, AF, { prof: Object.assign({}, AF.prof, { waived: ['pattern'] }) });
eq(E.needsOf(AFpet, {}, LG).attr_ai.n, 3, 'a waived attribute leaves the line');
eq(NX.attr_rule.n, 4, 'attribute rules: four attributes need a rule — attributes, not values');
eq(NX.attr_rule.parts.map((p) => p.k).join(','), 'gender,age_group,size_type,size_system', 'rule attributes: gender + age group (in scope) and size type/system (apparel); condition only when expected');
eq(NX.client.parts.map((p) => p.k).join(','), 'link,gtin_mpn,size,item_group_id', 'client to supply, item group id because the profile expects it');
eq(NX.conv.n, 7, 'conversational: Spark AI over every parent');
// a header that grows mid-stream: the late columns count from their debut, earlier rows are genuinely empty
{
  const nc2 = E.needCollector(LG, Arr);
  const px = FA.createXmlParser((r, h) => nc2.onRow(r, h));
  px.push(xmlFeed(grow)); px.end();
  const G2 = nc2.finish();
  eq(G2.S, 70, 'late debut: 70 SKUs'); eq(G2.P, 65, 'late debut: parents counted by group only after item_group_id appears');
  deq(G2.attrs.color, { n: 70, u: 0, miss: 59, inv: 0, missP: 59, invP: 0 }, 'late debut: colour missing on the 59 rows before it appeared, filled after');
}
// a TSV through catalog_engine's delimParser — it passes a row NUMBER as the second argument
{
  const nc3 = E.needCollector(LG, Arr);
  const dp = FC.delimParser('\t', (r, i) => nc3.onRow(r, i), { quotes: true });
  dp.push('id\titem_group_id\ttitle\nx1\tG\t' + GOOD_TITLE + '\nx2\tG\tShort\n'); dp.end();
  let res = null, err = null; try { res = nc3.finish(); } catch (e) { err = e; }
  ok(!err && res.S === 2 && res.P === 1, 'delimParser\'s numeric second argument does not throw and does not re-resolve', err && err.message);
}

/* ---------- 7. auditStored ---------- */
section('7 · auditStored — the stored lane');
// the real store shapes, built by labelguard's own collectors from the same rows
const xc = LG.xmlCollector({ client: 'Northwind', market: 'gb' });
xc.onRow(H.slice()); ROWS.forEach((r) => xc.onRow(r));
const XS = xc.finish();
const ci = LG.goldenCovIndex(XS.snap.attrs);
const Gs = { client: 'Northwind', mkt: 'gb', t: NOW - 3600e3, rows: XS.snap.rows, cov: ci.cov, sc: ci.sc, score: 12.3, air: 58, airTier: 2 };
const Qs = Object.assign({}, QS, { t: NOW - 7200e3, ai: { total: 61, tier: 3 } });
const PTs = { t: NOW - 5400e3, depth: LG.depthProfile(XS.snap.labels.product_type.values) };
const Ds = { client: 'Northwind', mkt: 'gb', t: NOW - 1800e3, rows: 12, n: 11, m: { '2025-11': 2, '2026-01': 3, '2026-03': 6 } };
const PR = { overrides: { industries: {}, clients: { Northwind: { expected: ['color', 'item_group_id'], waived: ['pattern'], qwaived: ['title:no-brand'] } } } };
const PS = { n: 10, ok: 0 };
const AS = E.auditStored({ client: 'Northwind', mkt: 'GB', G: Gs, Q: Qs, PT: PTs, D: Ds, PR, PS, now: NOW }, LG, Arr);
eq(AS.v, 1, 'v'); eq(AS.client, 'Northwind', 'client'); eq(AS.mkt, 'gb', 'mkt lowercased'); eq(AS.src, 'stored', 'src');
const profW = LG.profileFor('Northwind', PR.overrides);
deq(AS.prof, profW, 'prof = LG.profileFor(client, PR.overrides)'); eq(AS.industry, profW.industry, 'industry');
deq(AS.t, { cov: Gs.t, qual: Qs.t, pt: PTs.t, dob: Ds.t, live: null }, 't: one stamp per source');
eq(AS.S, Gs.rows, 'S = G.rows'); eq(AS.P, null, 'P null until the stream lands'); eq(AS.r, null, 'r null'); eq(AS.pSrc, null, 'pSrc null');
eq(AS.hasGroups, Gs.cov.item_group_id != null, 'hasGroups = G.cov.item_group_id != null'); eq(AS.grouped, null, 'grouped null');
deq(AS.golden.attrs, LG.attrsFromCov(Gs.cov, Gs.sc, Gs.rows), 'golden.attrs = attrsFromCov(G.cov, G.sc, G.rows)');
ok(AS.golden.cov === Gs.cov && AS.golden.sc === Gs.sc, 'golden.cov / sc are the stored ones');
const gsW = LG.goldenScore(LG.attrsFromCov(Gs.cov, Gs.sc, Gs.rows), profW);
eq(AS.golden.score, gsW.score, 'golden.score re-scored under the CURRENT profile'); ok(AS.golden.score !== Gs.score, 'never G.score (the scan-time profile)');
deq(AS.golden.gs, gsW, 'golden.gs = goldenScore full result');
eq(AS.quality.rows, Qs.rows, 'quality.rows'); ok(AS.quality.attrs === Qs.attrs, 'quality.attrs = Q.attrs');
const qsW = LG.qualityScore({ rows: Qs.rows, attrs: Qs.attrs }, profW);
eq(AS.qScore, qsW.score, 'qScore = qualityScore(quality, prof)'); eq(AS.qFails, qsW.fails, 'qFails');
deq(AS.ptDepth, PTs.depth, 'ptDepth = PT.depth'); eq(AS.gpcDepth, Qs.attrs.google_product_category.avgDepth, 'gpcDepth = Q gpc avgDepth');
deq(AS.air, { total: 58, tier: 2 }, 'air from G.air/airTier');
deq(AS.conv.cov, { question_and_answer: null, document_link: null, related_product: null, item_group_title: null, variant_option: null, popularity_rank: null }, 'conv.cov — the six, null when absent');
eq(AS.conv.n, gsW.ai.n, 'conv.n = gs.ai.n'); eq(AS.conv.hasVariants, Gs.cov.item_group_id >= 5, 'conv.hasVariants = cov.item_group_id ≥ 5');
const sW = Arr.stats(Ds, new Date(NOW), Ds.rows);
eq(AS.arrivals.perMonthS, sW.m12, 'arrivals.perMonthS = stats.m12'); eq(AS.arrivals.perMonthP, null, 'perMonthP null while r is unknown');
eq(AS.arrivals.unit, 'sku', 'unit sku until parents are counted'); eq(AS.arrivals.basis, sW.forecast.basis, 'basis'); eq(AS.arrivals.coverage, sW.coverage, 'coverage');
eq(AS.counts, null, 'counts null on the stored lane'); eq(AS.pdp, 'blocked', 'PS.n>0 && ok 0 → blocked');
eq(E.auditStored({ client: 'Northwind', mkt: 'gb', G: Gs, PS: { n: 4, ok: 3 } }, LG, Arr).pdp, 'ok', 'a PDP sample that fetched → ok');
eq(E.auditStored({ client: 'Northwind', mkt: 'gb', G: Gs }, LG, Arr).pdp, 'unknown', 'no sample → unknown');
eq(E.auditStored({ client: 'Northwind', mkt: 'gb-fb', G: Gs }, LG, Arr), null, 'a -fb market → null');
const ANone = E.auditStored({ client: 'Northwind', mkt: 'gb', G: { client: 'Northwind', mkt: 'gb', status: 'never' } }, LG, Arr);
ok(ANone && ANone.golden === null && ANone.missing.some((m) => /never scanned/.test(m)), 'a never-scanned roster row: no golden, said so');
ok(AS.missing.some((m) => /parent products not counted/.test(m)), 'missing names the uncounted parents');
// the live merge on top
const AL = E.auditMerge(AS, { nc: NC, xc: XS, src: 'live' }, LG, Arr, NOW);
eq(AL.src, 'live', 'live merge'); eq(AL.P, 7, 'P from the stream'); eq(AL.pSrc, 'counted', 'counted'); near(AL.r, 12 / 7, 'r = S/P exact (never the 0.1-rounded ratio)', 1e-12);
ok(AL.quality === AS.quality, 'a stored content-quality reading wins on the live lane');
deq(AL.ptDepth, LG.depthProfile(XS.snap.labels.product_type.values), 'live ptDepth from the stream');
eq(AL.arrivals.unit, 'parent', 'live arrivals per parent (the feed has first-seen dates)');
eq(AL.counts, NC, 'counts = NEEDCOUNTS');
const ATyped = E.auditMerge(AS, { typedP: 5, src: 'live' }, LG, Arr, NOW);
ok(ATyped.P === 5 && ATyped.pSrc === 'typed' && ATyped.counts === null, 'a typed P when the stream failed');
eq(ATyped.arrivals.perMonthP, AS.arrivals.perMonthS / (AS.S / 5), 'the stored SKU arrival rate taken to parents at the typed S/P');
const AFile = E.auditMerge(null, { nc: Object.assign({}, NC, { dob: { col: false, sku: { n: 0, bad: 0, m: {} }, par: { n: 0, m: {} } } }), src: 'file', client: 'Prospect', mkt: 'gb', industry: 'Footwear' }, LG, Arr, NOW);
eq(AFile.industry, 'Footwear', 'file lane: the industry the AM picked');
deq(AFile.prof.expected, LG.INDUSTRY_PROFILES.Footwear.expected, 'file lane: the picked industry\'s profile');
eq(AFile.arrivals.unit, 'fallback', 'file lane with no dates: the 10.5% estimate, labelled');
near(AFile.arrivals.perMonthP, 7 * 10.5 / 100 / 12, 'P × 10.5/100/12', 1e-12);

/* ---------- 8. needsOf, stored lane ---------- */
section('8 · needsOf — stored formulas');
function stored({ cov = {}, sc, rows = 1000, qattrs, qrows = 1000, P = null, prof, industry, ptDepth } = {}) {
  const fullCov = {}; LG.ATTR_SPEC.forEach((s) => { if (!s.derived) fullCov[s.key] = 100; });
  const c = Object.assign(fullCov, cov);
  const A = E.auditStored({ client: 'Northwind', mkt: 'gb', G: { rows, cov: c, sc, t: 1 }, Q: qattrs ? { rows: qrows, attrs: qattrs, t: 1 } : null, PT: ptDepth ? { depth: ptDepth } : null, PR: { overrides: {} } }, LG, Arr);
  if (prof) A.prof = Object.assign({ expected: [], waived: [], qwaived: [] }, prof);
  if (industry) A.industry = industry;
  A.P = P; A.S = rows;
  return A;
}
const qa = (filled, rules) => { const r = {}; Object.keys(rules || {}).forEach((k) => { r[k] = { n: rules[k], pct: 0, eg: [] }; }); return { filled, rules: r }; };
let N8 = E.needsOf(stored({ qattrs: { title: qa(900) } }), {}, LG);
eq(N8.keywords.est, 'unknown', 'keywords key absent from cov → unknown'); ok(/not read on this scan/.test(N8.keywords.why), 'with the reason');
N8 = E.needsOf(stored({ cov: { keywords: null }, qattrs: { title: qa(900) } }), {}, LG);
eq(N8.keywords.n, 1000, 'keywords null → every row'); eq(N8.keywords.est, 'sku-ceiling', '(left at the SKU count while P is unknown)');
N8 = E.needsOf(stored({ cov: { keywords: 25 }, qattrs: {}, P: 1000 }), {}, LG);
eq(N8.keywords.n, 750, 'keywords at 25% → 750'); eq(N8.keywords.est, 'ratio', 'ratio once P is known (here P = S)');
N8 = E.needsOf(stored({ qattrs: { title: qa(900, { 'len-over': 2, caps: 5, promo: 3, gimmick: 0, 'no-brand': 4, thin: 6, short: 10 }) }, P: 1000 }), {}, LG);
eq(N8.title.lo, 100 + 16, 'title lo = missing + the biggest hit, thin + short COMBINED (6 + 10)');
eq(N8.title.hi, 100 + 30, 'title hi = missing + the sum of hits (capped at filled)'); eq(N8.title.n, N8.title.lo, 'title n = lo'); eq(N8.title.est, 'bound', 'bound');
N8 = E.needsOf(stored({ qattrs: { title: qa(900, { caps: 5, promo: 3, 'no-brand': 4 }) }, P: 1000, prof: { qwaived: ['title:no-brand', 'title:caps'] } }), {}, LG);
eq(N8.title.lo, 103, 'a set-aside rule leaves the title bound'); eq(N8.title.hi, 103, '…lo = hi = exact once only one rule is left'); eq(N8.title.est, 'ratio', 'an exact stored count is ratio-converted');
N8 = E.needsOf(stored({ qattrs: { google_product_category: qa(950, { 'not-taxonomy': 40, shallow: 300 }) }, P: 1000 }), {}, LG);
eq(N8.gpc.lo, 50 + 300, 'gpc lo = missing + max(not-taxonomy, shallow)'); eq(N8.gpc.hi, 50 + 340, 'gpc hi = missing + their sum');
N8 = E.needsOf(stored({ qattrs: { google_product_category: qa(100, { 'not-taxonomy': 80, shallow: 90 }) }, P: 1000 }), {}, LG);
eq(N8.gpc.hi, 900 + 100, 'gpc hi capped at the filled count');
N8 = E.needsOf(stored({ cov: { color: null, material: null, pattern: null }, sc: { color: 0, material: 0, pattern: 0, gender: 0, age_group: 0, size: 0 }, qattrs: {}, P: 1000 }), {}, LG);
eq(N8.attr_ai.est, 'na', 'attr_ai: every attribute scoped to zero products → na'); eq(N8.attr_ai.n, 0, 'na is 0');
N8 = E.needsOf(stored({ cov: { color: 80 }, qattrs: {}, P: 1000 }), {}, LG);
eq(N8.attr_ai.est, 'unknown', 'attr_ai: no sc on a non-apparel brand → unknown'); ok(/category scope not measured/.test(N8.attr_ai.why), 'with the reason');
N8 = E.needsOf(stored({ cov: { color: 80, material: 50, pattern: 100 }, qattrs: { color: qa(800, { 'not-colour': 10, hex: 5 }) }, P: 1000, industry: 'Fashion' }), {}, LG);
eq(N8.attr_ai.est, 'bound', 'attr_ai: apparel with no sc → a bound'); eq(N8.attr_ai.lo, 200 + 10 + 500, 'lo = colour missing + max(invalid) + material missing');
eq(N8.attr_ai.hi, 200 + 15 + 500, 'hi = with the invalid counts summed');
N8 = E.needsOf(stored({ cov: { color: 50 }, sc: { color: 400, material: 0, pattern: 0, gender: 400, age_group: 400, size: 400 }, qattrs: {}, P: 1000 }), {}, LG);
eq(N8.attr_ai.n, 200, 'attr_ai with sc: 50% of the 400 in scope'); eq(N8.attr_ai.est, null, 'exact (SKU grain is never parent-converted)');
N8 = E.needsOf(stored({ qattrs: { description: qa(900, { thin: 120 }) }, P: 1000 }), { descTarget: 160 }, LG);
eq(N8.desc.n, 100 + 120, 'desc to 160 = missing + thin'); eq(N8.desc.est, 'ratio', 'exact (ratio-converted)');
N8 = E.needsOf(stored({ qattrs: { description: qa(900, { thin: 120 }) }, P: 1000 }), { descTarget: 500 }, LG);
eq(N8.desc.lo, 220, 'desc to 500: lo = the under-160 count'); eq(N8.desc.hi, 1000, 'desc to 500: hi = missing + every filled'); eq(N8.desc.est, 'bound', 'bound');
ok(/160–500 band is only counted by the live audit/.test(N8.desc.why), 'the band is named');
const hlq = qa(800, { 'count-min': 30, 'count-low': 70 }); hlq.hlDist = { 1: 5, 2: 5, 3: 10, 4: 30, 5: 20, '6+': 30 };
N8 = E.needsOf(stored({ qattrs: { product_highlight: hlq }, P: 1000 }), { hlTarget: 4 }, LG);
eq(N8.highlights.n, 200 + 100, 'highlights to 4 = missing + count-min + count-low'); eq(N8.highlights.est, 'ratio', 'exact');
N8 = E.needsOf(stored({ qattrs: { product_highlight: hlq }, P: 1000 }), { hlTarget: 6 }, LG);
eq(N8.highlights.n, 200 + Math.round(800 * 0.7), 'highlights to 6 = missing + filled × the 1–5 shares'); eq(N8.highlights.est, 'bound', 'bound (shares rounded)');
N8 = E.needsOf(stored({ cov: { title: 90 }, qattrs: { description: qa(900) } }), {}, LG);
eq(N8.title.est, 'unknown', 'missQ: Q lacks title but G.cov has it → unknown'); ok(/column not read/.test(N8.title.why), 'with the reason');
N8 = E.needsOf(stored({ cov: { title: null }, qattrs: { description: qa(900) }, P: 1000 }), {}, LG);
eq(N8.title.n, 1000, 'missQ: the column is not in the feed → every row');
eq(E.needsOf(stored({ qattrs: null }), {}, LG).title.est, 'unknown', 'missQ: no content-quality reading → unknown');
{
  const rh = /export const RUN_HOUR = (\d+);/.exec(read('tools/golden_daily.mjs'));
  ok(rh && E.needsOf(stored({ qattrs: null }), {}, LG).title.why.indexOf(('0' + rh[1]).slice(-2) + ':00 UK') >= 0,
    'and it names the automatic daily run at golden_daily\'s own RUN_HOUR (' + (rh && rh[1]) + ':00)');
}
N8 = E.needsOf(stored({ qattrs: { product_type: qa(1000, { 'single-level': 50 }) }, P: 1000, ptDepth: { pct: { 1: 10, 2: 20, 3: 30, 4: 30, 5: 10, '6+': 0 }, avg: 3, skus: 900 } }), {}, LG);
eq(N8.ptype.n, 300, 'ptype to 3 reads the depth profile: filled × (1 + 2 levels)'); eq(N8.ptype.lo, 50, 'lo = the single-level count'); eq(N8.ptype.est, 'bound', 'bound');

/* ---------- 9. SKU → parent ---------- */
section('9 · SKU → parent conversion');
N8 = E.needsOf(stored({ rows: 1000, cov: { product_detail: 60 }, qattrs: {}, P: 400 }), {}, LG);
eq(N8.details.n, Math.min(400, Math.ceil(400 * 400 / 1000)), 'P known: ceil(x × P / S), capped at P'); eq(N8.details.est, 'ratio', 'est ratio');
N8 = E.needsOf(stored({ rows: 1000, cov: { product_detail: 60 }, qattrs: {} }), {}, LG);
eq(N8.details.n, 400, 'P null: the SKU count stands'); eq(N8.details.est, 'sku-ceiling', 'est sku-ceiling');
eq(NX.details.est, null, 'counts present: exact, no conversion');
N8 = E.needsOf(stored({ qattrs: { description: qa(900, { thin: 120 }) }, P: 100 }), { descTarget: 500 }, LG);
eq(N8.desc.est, 'bound', 'a bound stays a bound through the ratio'); eq(N8.desc.lo, 22, 'lo converted'); eq(N8.desc.hi, 100, 'hi converted (capped at P)');

/* ---------- 10. packageQuote ---------- */
section('10 · packageQuote');
const ROWIDS = ['title_gen', 'keywords', 'pt_class', 'gpc', 'highlights', 'details', 'desc_gen'];
function everyParent(S, P, extra) {
  const z = [0, 0];
  return Object.assign({ v: 1, S, P, noId: 0, hasGroups: true, grouped: S,
    title: { bits: E.TITLE_BITS, masks: { 1: [S, P] } }, desc: { b: { empty: [S, P], lt160: z, lt300: z, lt500: z, lt1000: z, ok: z } },
    hl: { h: { 0: [S, P], 1: z, 2: z, 3: z, 4: z, 5: z, '6+': z } }, pt: { h: { 0: [S, P], 1: z, 2: z, 3: z, 4: z, 5: z, '6+': z } },
    gpc: { bits: E.GPC_BITS, masks: { 1: [S, P] } }, kw: { slots: 0, none: [S, P] }, det: { empty: [S, P] },
    attrs: { color: { n: S, u: 0, miss: S, inv: 0, missP: P, invP: 0 }, material: { n: S, u: 0, miss: 0, inv: 0, missP: 0, invP: 0 }, pattern: { n: S, u: 0, miss: 0, inv: 0, missP: 0, invP: 0 } },
    rule: { gender: { n: S, u: 0, miss: 0 }, age_group: { n: S, u: 0, miss: 0 }, size_type: { n: S, miss: 0 }, size_system: { n: S, miss: 0 }, condition: { n: S, miss: 0 } },
    client: { link: 0, image_link: 0, availability: 0, price: 0, brand: 0, gtin_mpn: 0, item_group_id: 0, size: { n: S, u: 0, miss: 0 } },
    dob: { col: false, sku: { n: 0, bad: 0, m: {} }, par: { n: 0, m: {} } } }, extra || {});
}
const liveAudit = (mkt, S, P, extra, arrivals) => {
  const a = E.auditMerge(null, { nc: everyParent(S, P, extra), src: 'live', client: 'Northwind', mkt, PR: { overrides: {} } }, LG, Arr, NOW);
  if (arrivals) a.arrivals = Object.assign({}, a.arrivals, arrivals);
  return a;
};
const OFF6 = { qa: 'off', doc: 'off', rel: 'off', igt: 'off', vopt: 'off', pop: 'off', hi: 'off' };
const R0 = E.composeRates({});
const A1 = liveAudit('gb', 60000, 23456);
const PQ = E.packageQuote({ client: 'Northwind', option: 'go+ar', markets: [{ mkt: 'gb', audit: A1 }], rates: R0, aimSources: OFF6,
  lineOpts: { attr_ai: { on: false }, attr_rule: { on: false } } }, LG);
const QV = E.quote(ROWIDS, { volume: 23456 });
const genOf = (pq, k) => (pq.lines.find((l) => l.key === k) || {}).gen;
[['title', 'title_gen'], ['keywords', 'keywords'], ['ptype', 'pt_class'], ['gpc', 'gpc'], ['highlights', 'highlights'], ['details', 'details'], ['desc', 'desc_gen']].forEach(([k, id]) => {
  eq(genOf(PQ, k), QV.lines.find((l) => l.id === id).tachyon, 'need = P, one market: ' + k + ' gen === quote() ' + id + ' tachyon');
});
eq(PQ.oneOff.blocks, QV.oneOff.blocks, 'blocks === quote().oneOff.blocks for the same picks');
eq(PQ.oneOff.blockCost, QV.oneOff.blockCost, 'block cost === quote()'); near(PQ.beta, E.tieredUnits(23456).units / 23456, 'β = tieredUnits(Pβ).units / Pβ', 1e-12);
const PQgo = E.packageQuote({ client: 'Northwind', option: 'go', markets: [{ mkt: 'gb', audit: A1 }], rates: R0, lineOpts: { attr_ai: { on: false }, attr_rule: { on: false } } }, LG);
const PQar = E.packageQuote({ client: 'Northwind', option: 'ar', markets: [{ mkt: 'gb', audit: A1 }], rates: R0, aimSources: OFF6 }, LG);
ok(PQ.oneOff.blocks < PQgo.oneOff.blocks + PQar.oneOff.blocks, 'go+ar set-up block-rounded ONCE over the union: ' + PQ.oneOff.blocks + ' < ' + PQgo.oneOff.blocks + ' + ' + PQar.oneOff.blocks);
eq(PQ.oneOff.H, PQgo.oneOff.H + PQar.oneOff.H, '…the hours themselves add');
eq(PQgo.label, 'Tier 1 · Google-ready', 'Tier 1 label: Google-ready'); eq(PQ.label, 'Tier 2 · AI-ready', 'Tier 2 label: AI-ready (the bundle)');
eq(PQar.label, 'AI-ready only', 'AI Readiness alone: AI-ready only');
eq(PQgo.sub, 'Google Optimise — eligible + everything Google recommends', 'Tier 1 sub-label'); eq(PQ.sub, 'Google-ready + AI Readiness — the bundle', 'Tier 2 sub-label'); eq(PQar.sub, 'AI Readiness without Tier 1', 'AI-ready only sub-label');
ok(PQgo.lines.every((l) => l.pkg === 'go') && PQar.lines.every((l) => l.pkg === 'ar'), 'each option carries only its own lines');
// the bundle discount touches generation only
const Rb = E.composeRates({ price: { '_g|bundlePct': { v: 10, by: 'm', at: 1 } } });
const PQb = E.packageQuote({ client: 'Northwind', option: 'go+ar', markets: [{ mkt: 'gb', audit: A1 }], rates: Rb, aimSources: OFF6, lineOpts: { attr_ai: { on: false }, attr_rule: { on: false } } }, LG);
eq(PQb.oneOff.bundleDisc, Math.round(0.1 * PQb.oneOff.gen * 100) / 100, 'bundle discount = bundlePct × Σgen');
eq(PQb.oneOff.blockCost, PQ.oneOff.blockCost, 'bundle leaves the set-up blocks alone');
near(PQb.oneOff.total, PQb.oneOff.blockCost + PQb.oneOff.gen - PQb.oneOff.bundleDisc, 'one-off = blocks + gen − bundle');
const PQb1 = E.packageQuote({ client: 'Northwind', option: 'go', markets: [{ mkt: 'gb', audit: A1 }], rates: Rb, lineOpts: { attr_ai: { on: false }, attr_rule: { on: false } } }, LG);
eq(PQb1.oneOff.bundleDisc, 0, 'no bundle on Tier 1 alone');
// unknown / unpriced / coming — excluded and listed
const AUnk = E.auditStored({ client: 'Northwind', mkt: 'gb', G: { rows: 1000, cov: { title: 100 }, t: 1 }, PR: { overrides: {} } }, LG, Arr);
const PQx = E.packageQuote({ client: 'Northwind', option: 'go+ar', markets: [{ mkt: 'gb', audit: A1 }], rates: R0, aimSources: OFF6, roadmap: { 'details|*': { status: 'building' } } }, LG);
eq((PQx.lines.find((l) => l.key === 'attr_ai') || {}).status, 'unpriced', 'attr_pop has no price yet → unpriced'); ok(PQx.unpriced.indexOf('attr_ai') >= 0, '…listed');
eq((PQx.lines.find((l) => l.key === 'details') || {}).status, 'coming', 'a line marked building → coming'); ok(PQx.coming.indexOf('details') >= 0, '…listed');
eq((PQx.lines.find((l) => l.key === 'details') || {}).reason, 'coming — included when live', 'coming says so');
ok(Math.abs(PQx.oneOff.gen - (PQ.oneOff.gen - genOf(PQ, 'details'))) < 0.011, 'the coming line is out of the total');
const PQu = E.packageQuote({ client: 'Northwind', option: 'go', markets: [{ mkt: 'gb', audit: AUnk }], rates: R0 }, LG);
eq((PQu.lines.find((l) => l.key === 'title') || {}).status, 'unknown', 'no content-quality reading → title unknown'); ok(PQu.unknown.indexOf('title') >= 0, '…listed');
eq((PQu.lines.find((l) => l.key === 'title') || {}).gen, 0, 'an unknown line prices nothing');
// client-safe: one clean proposal, then every blocker flips it
function cleanStores() {
  const ops = {}, price = {};
  E.CATALOG.concat(E.PKG_ROWS).forEach((c) => {
    const d = c.id === 'attr_pop' ? { aspl: 4, qc: 2, pm: 1, mon: 1, lead: 5, unit: 0.02 } : c;
    ['aspl', 'qc', 'pm', 'mon', 'lead'].forEach((f) => { ops[c.id + '|' + f] = { v: d[f], by: 'aspl@feedspark.com', at: 1 }; });
    price[c.id + '|unit'] = { v: d.unit, by: 'ray@feedspark.com', at: 1 };
  });
  ops['_g|ruleH'] = { v: 2, by: 'a', at: 1 }; ops['_g|langSetupH'] = { v: 4, by: 'a', at: 1 };
  return { ops, price };
}
const live = {}; E.PKG_LINES.forEach((l) => { live[l.key + '|*'] = { status: 'live', note: '', by: 'r', at: 1 }; });
const RC = E.composeRates(cleanStores());
const base10 = { client: 'Northwind', option: 'go+ar', rates: RC, roadmap: live };
const extraRule = { rule: { gender: { n: 100, u: 0, miss: 10 }, age_group: { n: 100, u: 0, miss: 0 }, size_type: { n: 100, miss: 0 }, size_system: { n: 100, miss: 0 }, condition: { n: 100, miss: 0 } } };
const AC = liveAudit('gb', 3000, 1000, extraRule, { perMonthP: 40, unit: 'parent' });
const PQc = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }] }, base10), LG);
eq(PQc.clientSafe, true, 'a fully confirmed, exactly counted, single-market proposal is client-safe' + (PQc.blockers.length ? ': ' + J(PQc.blockers.slice(0, 3)) : ''));
eq(PQc.draftRates, false, 'no draft rates');
ok(E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }] }, base10, { rates: R0 }), LG).clientSafe === false, 'draft rates → not client-safe');
const ASb = stored({ qattrs: { title: qa(900, { caps: 5, promo: 3 }) }, P: 1000 });
const PQsb = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: ASb }], lineOpts: { keywords: { on: false }, ptype: { on: false }, gpc: { on: false }, attr_ai: { on: false }, attr_rule: { on: false }, highlights: { on: false }, details: { on: false }, desc: { on: false }, conv: { on: false } } }, base10), LG);
ok(PQsb.clientSafe === false && PQsb.blockers.some((b) => b.code === 'estimate'), 'a bound line → not client-safe');
const ASc = stored({ qattrs: { title: qa(900) } });
const PQsc = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: ASc }], lineOpts: { keywords: { on: false }, ptype: { on: false }, gpc: { on: false }, attr_ai: { on: false }, attr_rule: { on: false }, highlights: { on: false }, details: { on: false }, desc: { on: false }, conv: { on: false } } }, base10), LG);
ok(PQsc.clientSafe === false && PQsc.lines.find((l) => l.key === 'title').est === 'sku-ceiling', 'a sku-ceiling line → not client-safe');
const PQrm = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }] }, base10, { roadmap: {} }), LG);
ok(PQrm.clientSafe === false && PQrm.blockers.some((b) => b.code === 'roadmap'), 'an unconfirmed delivery status → not client-safe');
ok(!PQrm.blockers.some((b) => b.code === 'roadmap' && b.line === 'attr_rule'), '…except attribute rules, seeded live');
const AIe = liveAudit('ie', 3000, 1000, extraRule, { perMonthP: 40, unit: 'parent' });
const PQre = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }, { mkt: 'ie', audit: AIe }] }, base10), LG);
ok(PQre.reuseUnset === true && PQre.clientSafe === false && PQre.blockers.some((b) => b.code === 'reuse'), 'two English markets with re-use unset → not client-safe');
const RCr = E.composeRates(Object.assign(cleanStores(), { price: Object.assign(cleanStores().price, { '_g|reusePct': { v: 35, by: 'r', at: 1 } }) }));
const PQre2 = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }, { mkt: 'ie', audit: AIe }] }, base10, { rates: RCr }), LG);
eq(PQre2.clientSafe, true, '…and client-safe once Management sets the re-use rate');
// contracted
const PQct = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }], contracted: { lines: { title: 'QT261234' }, conv: {}, bundle: null } }, base10), LG);
const tl = PQct.lines.find((l) => l.key === 'title');
ok(tl.status === 'contracted' && /QT261234/.test(tl.reason), 'a contracted line is excluded and names the quote');
ok(Math.abs(PQct.oneOff.gen - (PQc.oneOff.gen - genOf(PQc, 'title'))) < 0.011, '…and its generation leaves the total');
eq(E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }], contracted: { lines: { title: 'QT261234' }, conv: {}, bundle: null }, opts: { includeContracted: true } }, base10), LG).lines.find((l) => l.key === 'title').status, 'priced', 'includeContracted puts it back');
const PQbu = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }], contracted: { lines: {}, conv: {}, bundle: 'QT260001' } }, base10), LG);
ok(PQbu.monthly.gen === 0 && /QT260001/.test(PQbu.monthly.overlap), 'a contracted AI Quote new-products bundle: monthly generation excluded, overlap named');
// re-use + β over two markets
const RCr50 = E.composeRates(Object.assign(cleanStores(), { price: Object.assign(cleanStores().price, { '_g|reusePct': { v: 50, by: 'r', at: 1 } }) }));
const PQ2m = E.packageQuote(Object.assign({ markets: [{ mkt: 'ie', audit: liveAudit('ie', 30000, 10000) }, { mkt: 'gb', audit: liveAudit('gb', 60000, 20000) }] }, base10, { rates: RCr50, option: 'go', lineOpts: { attr_ai: { on: false }, attr_rule: { on: false } } }), LG);
const pmGB = PQ2m.perMarket.find((m) => m.mkt === 'gb'), pmIE = PQ2m.perMarket.find((m) => m.mkt === 'ie');
ok(pmGB.lead && pmGB.w === 1 && !pmIE.lead && pmIE.w === 0.5, 'the larger market leads its language; the other is re-used at 50%');
eq(PQ2m.Pbeta, 25000, 'Pβ = 20,000 + 0.5 × 10,000'); near(PQ2m.beta, E.tieredUnits(25000).units / 25000, 'β on Pβ', 1e-12);
near(genOf(PQ2m, 'title'), Math.round(0.08 * 20000 * PQ2m.beta * 100) / 100 + Math.round(0.08 * 10000 * 0.5 * PQ2m.beta * 100) / 100, 'title gen = unit × β × units × w, per market', 0.011);
eq(PQ2m.nLang, 1, 'one language group');
// the monthly
const RCf = E.composeRates(Object.assign(cleanStores(), { price: Object.assign(cleanStores().price, { '_g|floorMonthly': { v: 5000, by: 'r', at: 1 } }) }));
const AM = liveAudit('gb', 3000, 1000, extraRule, { perMonthP: 123.4, unit: 'parent' });
const PQm = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AM }], aimSources: OFF6 }, base10, { option: 'go', lineOpts: { attr_ai: { on: false } } }), LG);
const pm = PQm.perMarket[0];
eq(pm.newP, Math.ceil(123.4 * 1.1), 'newP = ceil(rate × 1.1)');
near(pm.perNew, PQm.beta * (0.08 + 0.06 + 0.05 + 0.05), 'every new parent through every priced parent line, full unit (× β)');
near(PQm.monthly.gen, pm.newP * pm.perNew, 'monthly generation = newP × perNew', 0.02);
eq(PQm.monthly.monCost, Math.ceil(PQm.monthly.monH / 8) * 585, 'monitoring blocks');
const PQf = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AM }] }, base10, { rates: RCf, option: 'go', lineOpts: { attr_ai: { on: false } } }), LG);
ok(PQf.monthly.floorApplied && Math.abs(PQf.monthly.total - (PQf.monthly.monCost + 5000)) < 0.01, 'the Management floor lifts monthly generation');
const PQab = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AM }], opts: { absorbMonitoring: true } }, base10, { option: 'go', lineOpts: { attr_ai: { on: false } } }), LG);
eq(PQab.monthly.monCost, 0, 'absorbed → monitoring £0');
const AMf = liveAudit('gb', 3000, 1000, extraRule, { perMonthP: null, perMonthS: null, unit: null });
const pmf = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AMf }] }, base10, { option: 'go' }), LG).perMarket[0];
ok(pmf.newEst === 'fallback' && pmf.newP === Math.ceil(1000 * 10.5 / 100 / 12 * 1.1), 'no arrival rate → the 10.5% estimate, flagged fallback');
ok(!J(PQm.monthly).match(/year|annual/i) && PQm.monthly.annual === undefined, 'nothing annual on the monthly');
eq(PQc.sla, 14 + (8 - 1) * 2, 'SLA = longest lead + 2 days per further line');

/* ---------- 11. the Spark AI twin ---------- */
section('11 · Spark AI twin');
const PAGE = read('docs/FeedSpark_AIQuote.html'), ENG = read('docs/pricer_engine.js');
const pa = PAGE.indexOf('/* AIMODE:ENGINE-START'), pb = PAGE.indexOf('/* AIMODE:ENGINE-END */');
const ea = ENG.indexOf('/* AIMODE:TWIN-START'), eb = ENG.indexOf('/* AIMODE:TWIN-END */');
ok(pa > 0 && pb > pa && ea > 0 && eb > ea, 'both marker pairs present');
const pageCode = PAGE.slice(PAGE.indexOf('*/', pa) + 2, pb), engCode = ENG.slice(ENG.indexOf('*/', ea) + 2, eb);
ok(pageCode === engCode, 'the twin is BYTE-IDENTICAL to the AI Quote\'s AIMODE:ENGINE block (copy the page block into pricer_engine.js)');
const sb = {}; vm.createContext(sb);
vm.runInContext(PAGE.slice(pa, pb) + '\n;this.B=aimBuild;this.R=AIM_RATE_DEFAULT;', sb);
const R6 = () => JSON.parse(J(sb.R));
const combos = [
  [{ qa: 'ai' }, 1000, 50],                                                                 // floor top-up
  [{ doc: 'scrape', rel: 'scrape', qa: 'feed' }, 500, 10],                                  // two scraped fields charged once
  [{ pop: 'feedhero', vopt: 'feedhero', rel: 'feedhero' }, 800, 0],                         // FeedHero rules
  [{ qa: 'ai', igt: 'ai', hi: 'ai' }, 30000, 2750.3],                                       // ai with ceil, over the floor
  [{ qa: 'off', doc: 'off', rel: 'off', igt: 'off', vopt: 'off', hi: 'off', pop: 'off' }, 100, 5], // everything off
  [{ qa: 'ai', doc: 'scrape', rel: 'feedhero', igt: 'feed', vopt: 'scrape', hi: 'off', pop: 'feedhero' }, 12345.6, 99.9]
];
combos.forEach(([src, u, pmth], i) => {
  const rr = R6(); if (i === 3) rr.aiPerField = 0.07;
  deq(E.aim.build(src, rr, u, pmth), sb.B(src, rr, u, pmth), 'aim.build === the AI Quote\'s aimBuild, combo ' + (i + 1));
});
const fl = E.aim.build({ qa: 'ai' }, R6(), 1000, 50);
ok(fl.lines.some((l) => l.id === 'min') && Math.abs(fl.monthly - 100) < 1e-9, 'the AI floor tops the monthly up to £100');
const sc2 = E.aim.build({ doc: 'scrape', rel: 'scrape' }, R6(), 500, 10);
eq(sc2.monthly, 100, 'two scraped fields: one £100 run');
const PQconv = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }], aimSources: { qa: 'ai', doc: 'scrape', rel: 'feedhero', igt: 'ai', vopt: 'feedhero', pop: 'feedhero', hi: 'off' } }, base10), LG);
const convD = E.aim.build({ qa: 'ai', doc: 'scrape', rel: 'feedhero', igt: 'ai', vopt: 'feedhero', pop: 'feedhero', hi: 'off' }, E.AIM_RATE_DEFAULT, 1000, 40 * 1.1);
near(PQconv.oneOff.conv, Math.round(convD.setup * 100) / 100, 'the conversational line is ONE Spark AI build over the range');
near(PQconv.monthly.conv, Math.round(convD.monthly * 100) / 100, '…and its monthly');
ok(/at Spark AI rates \(£695\/8h\)/.test(PQconv.conv.rateLabel), 'labelled at Spark AI rates (£695/8h)');
eq(PQconv.oneOff.rateLabel, 'set-up hours at the Pricer block (£585 per 8h)', 'the set-up rate is labelled too — never a silent rate');
ok(E.proposalText(PQconv, {}).flags.some((f) => /Two hourly rates/.test(f) && /£585/.test(f) && /£695/.test(f)), 'both rates named to the AM when a proposal carries both');
ok(E.proposalText([PQgo, PQconv], {}).flags.some((f) => /Two hourly rates/.test(f)), '…also when only a later option carries Spark AI');
deq(E.aimDefaultSources([AC]), { qa: 'ai', igt: 'ai', doc: 'scrape', rel: 'feedhero', vopt: 'feedhero', pop: 'feedhero', hi: 'off' }, 'default routes with item groups');
const ANoG = liveAudit('gb', 1000, 1000, { hasGroups: false, grouped: 0 }); ANoG.pdp = 'blocked';
deq(E.aimDefaultSources([ANoG]), { qa: 'ai', igt: 'off', doc: 'feed', rel: 'feedhero', vopt: 'off', pop: 'feedhero', hi: 'off' }, 'no groups → no variant routes; PDP blocked → document link from the feed');
const A95 = liveAudit('gb', 1000, 500); A95.conv.cov.question_and_answer = 96;
eq(E.aimDefaultSources([A95]).qa, 'off', 'an attribute already at 95%+ defaults off');

/* ---------- 12. projection ---------- */
section('12 · projection');
const AP = liveAudit('gb', 3000, 1000, extraRule);
AP.golden = (() => {
  const cov = {}; LG.ATTR_SPEC.forEach((s) => { if (!s.derived && s.req !== 'ai') cov[s.key] = 100; });
  Object.assign(cov, { gtin: null, mpn: null, sale_price: null, product_highlight: 50 });   // keywords never measured: the key is absent
  const at = LG.attrsFromCov(cov, null, 3000);
  return { attrs: at, cov, sc: null, score: LG.goldenScore(at, AP.prof).score, gs: LG.goldenScore(at, AP.prof) };
})();
const onlyTitle = {}; E.PKG_LINES.forEach((l) => { onlyTitle[l.key] = { on: l.key === 'title' }; });
const PQt = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AP }], lineOpts: onlyTitle }, base10, { option: 'go' }), LG);
eq(PQt.perMarket[0].projected.after, AP.golden.score, 'a title-only option leaves the Golden Score where it is (title is already complete)');
ok(PQt.perMarket[0].projected.blockers.some((b) => b.key === 'gtin/mpn' && b.tag === 'client to supply'), 'identifiers listed as a client-supply blocker');
ok(PQt.perMarket[0].projected.blockers.some((b) => b.key === 'product_highlight' && b.tag === 'in Tier 2'), 'a Tier-2 attribute is tagged in Tier 2');
const PQall = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AP }] }, base10), LG);
const pj = PQall.perMarket[0].projected;
ok(Array.isArray(pj.fixed) && pj.fixed.indexOf('title') < 0 === !PQall.lines.some((l) => l.key === 'title' && l.status === 'priced') && PQt.perMarket[0].projected.fixed.every((k) => k === 'title'), 'projection.fixed names exactly the attributes the option fills (the tier preview animates them)');
ok(pj.after > pj.now, 'Tier 2 lifts the score');
eq(pj.met, pj.after >= 95, 'met only at 95+'); ok(!pj.met, 'still short while identifiers are missing (client data)');
ok(!('keywords' in AP.golden.attrs) && pj.blockers.every((b) => b.key !== 'keywords'), 'keywords not measured → left out of the projection');
const airP = PQall.perMarket[0].air;
ok(airP.after === null && airP.note === 'projection not computed', 'AI-readiness after is not projected');

/* ---------- 13. costModel ---------- */
section('13 · costModel');
const costs = { '_c|rateAspl': { v: 30 }, '_c|rateAm': { v: 60 }, '_c|gbpPerMTok': { v: 2 }, '_c|tokAsOf': { v: '2026-10-01' }, '_c|ohPct': { v: 20 }, '_c|marginPct': { v: 60 } };
const opsC = cleanStores(); opsC.ops['title_gen|aMin'] = { v: 6 }; opsC.ops['title_gen|tokPerP'] = { v: 2000 }; opsC.ops['title_gen|qcPct'] = { v: 10 }; opsC.ops['title_gen|qcMin'] = { v: 3 };
const RK = E.composeRates(opsC);
const CM = E.costModel(RK, costs, {}, null);
const tg = CM.rows.title_gen;
near(tg.cTok, 2000 * 2 / 1e6, 'cTok = tokPerP × £/Mtok / 1e6', 1e-12);
near(tg.cLab, (6 / 100 * 30 + 10 / 100 * 3 * 60) / 60, 'cLab = (aMin/100 × rateAspl + qcPct/100 × qcMin × rateAm) / 60', 1e-12);
near(tg.loaded, tg.cTok + tg.cLab * 1.2, 'loaded = cTok + cLab × (1 + oh) — overhead on labour only, never on tokens', 1e-12);
near(tg.listMargin, 1 - tg.loaded / 0.08, 'list margin', 1e-12);
near(tg.suggested, tg.loaded / 0.4, 'suggested = loaded / (1 − margin)', 1e-12);
eq(tg.floorOK, 0.08 * 0.5 >= tg.loaded, 'floor check at the lowest tier multiplier');
near(tg.setupCost, (6 * 30 + (3 + 2) * 60) * 1.2, 'set-up cost = (ASPL × rateAspl + (QC + PM) × rateAm) × (1 + oh)', 1e-9);
const CMa = E.costModel(E.composeRates(Object.assign({}, opsC, { useActuals: true, actuals: { keywords: { n: 2, aspl: 4, qc: 2, pm: 1, mon: 1, lead: 7, billPerProd: 1500 } }, ops: Object.assign({}, opsC.ops, { 'keywords|aspl': undefined }) })),
  costs, { keywords: { n: 2, aspl: 4, qc: 2, pm: 1, billPerProd: 1500 } }, null);
eq(E.composeRates({ useActuals: true, actuals: { keywords: { n: 2, aspl: 4, qc: 2, pm: 1, mon: 1, lead: 7 } } }).rows.keywords.src.aspl, 'actuals', 'actuals supply hours when on (and nothing above them is set)');
const RKa = E.composeRates({ useActuals: true, actuals: { keywords: { n: 2, aspl: 4, qc: 2, pm: 1, mon: 1, lead: 7 } } });
const CMa2 = E.costModel(RKa, costs, { keywords: { n: 2, billPerProd: 1500 } }, null);
eq(CMa2.rows.keywords.cLab, 0, 'hours from actuals → labour already inside them, cLab 0');
eq(CMa2.rows.keywords.tok, 1500, 'tokens per product from actuals.billPerProd when n ≥ 1');
ok(CMa && CMa.rows, 'costModel runs on an actuals-layered card');
const CMn = E.costModel(E.composeRates({}), { '_c|rateAspl': { v: 30 } }, {}, null);
ok(CMn.rows.title_gen.loaded === null && CMn.rows.title_gen.why.some((w) => /Management/.test(w)) && CMn.rows.title_gen.why.some((w) => /ASPL to enter/.test(w)), 'a null input → null with who has to enter it');
const CMp = E.costModel(RC, costs, {}, PQc);
ok(CMp.proposal && CMp.proposal.excluded[0] === 'conv', 'proposal margins exclude Spark AI'); ok(CMp.proposal.genCost === null, 'proposal gen cost null while a line has no loaded cost');

/* ---------- 14. proposalText ---------- */
section('14 · proposalText');
const T1 = E.proposalText(PQx, { tone: 'direct', contact: 'jane.doe@northwind.example' });
ok(!PQx.clientSafe, 'fixture: the draft proposal is not client-safe');
ok(T1.body.indexOf('[£ to confirm — Ray]') >= 0, 'guarded: the placeholder is there');
ok(!/£\s?\d/.test(T1.body) && !/£\d/.test(T1.talk.join(' ')), 'guarded: not one £ figure in the body or the talk track');
eq((T1.body.match(/£/g) || []).length, (T1.body.match(/\[£ to confirm — Ray\]/g) || []).length, 'every £ in the body IS the placeholder');
ok(/^Hi Jane,/.test(T1.body), 'a person is greeted by name'); ok(/^Hi team,/.test(E.proposalText(PQx, { contact: 'info@northwind.example' }).body), 'a shared mailbox is not');
const T2 = E.proposalText(PQx, { tone: 'consult' });
ok(T1.body !== T2.body && /Thank you for the time/.test(T2.body) && /reply to confirm/.test(T1.body), 'the two tones differ');
const TS = E.proposalText(PQc, { tone: 'direct' });
ok(PQc.clientSafe && /£\d/.test(TS.body) && TS.body.indexOf('[£ to confirm') < 0, 'a client-safe proposal prints its figures');
ok(TS.body.indexOf(E.fmtGBP(PQc.oneOff.total)) >= 0 && TS.body.indexOf(E.fmtGBP(PQc.monthly.total)) >= 0, 'one-off and monthly printed apart');
[T1, T2, TS, E.proposalText([PQc, PQx], {})].forEach((t, i) => {
  const all = t.subject + '\n' + t.body + '\n' + t.talk.join('\n');
  ok(!/tachyon/i.test(all), 'no Tachyon in client copy (' + i + ')');
  ok(!all.split('\n').some((l) => /£/.test(l) && /annual|year 1|× ?12|\*12/i.test(l)), 'no annual money line (' + i + ')');
  ok(!/inc(l\.|luding|lusive)?\s+VAT|\+\s?VAT|plus VAT|VAT[- ]inclusive/i.test(all), 'no VAT-inclusive wording (' + i + ')');
});
ok(/ex VAT/.test(TS.body), 'figures say ex VAT');
eq(TS.talk.length, 5, 'five talk-track bullets');
ok(TS.flags.some((f) => /supplemental data source/.test(f)) && TS.flags.some((f) => /CHARACTERS/.test(f)) && TS.flags.some((f) => /never generated/.test(f)), 'flags: supplemental source, characters not words, identifiers');
ok(T1.flags.some((f) => /^Ray to confirm:/.test(f)), 'every blocker becomes a "Ray to confirm" flag');
ok(!/immediately/i.test(TS.body), 'never "immediately" while always-on is not live');
ok(/target is on arrival once automatic routing ships/.test(TS.body) && !/picked up on arrival/.test(TS.body), 'always-on not live: today\'s cycle named, on arrival only as the target');
ok(/picked up on arrival/.test(E.proposalText(E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AC }] }, base10, { roadmap: Object.assign({}, live, { 'alwayson|*': { status: 'live' } }) }), LG)).body), 'picked up on arrival once always-on is live');
const TO = E.optionsText([{ client: 'Northwind', prop: { id: 'ppabc1', n: 1 }, pq: PQc, clientSafe: true }, { client: 'Northwind', prop: { id: 'ppabc1', n: 2 }, pq: PQx, clientSafe: false }]);
ok(/1\. Tier 2/.test(TO) && /2\. Tier 2/.test(TO) && TO.indexOf(E.fmtGBP(PQc.oneOff.total)) >= 0 && /\[£ to confirm — Ray\]/.test(TO), 'optionsText: each option, its own guard');
ok(/ex VAT/.test(TO) && !/tachyon/i.test(TO), 'optionsText ex VAT, no Tachyon');

/* ---------- 15. contracted / stage / counted / quick wins / refs / snapshots ---------- */
section('15 · contractedFrom, rolloutStage, countedOption, quickWins, proposalRef, snapshotOption, composeRates');
const SAVED = {
  q1: { ref: 'QT261001', client: 'northwind', mkt: 'GB', t: 1, stage: 'Greenlight', lines: [{ id: 'title_gen' }, { id: 'visual_attr' }, { id: 'question_and_answer' }],
    aim: { lines: [{ id: 'qa', key: 'question_and_answer', route: 'ai' }, { id: 'hi', key: 'product_highlight', route: 'scrape' }, { id: 'min', key: 'minimum', route: 'ai' }, { id: 'doc', key: 'document_link', route: 'off' }] } },
  q2: { ref: 'QT261002', client: 'Northwind', mkt: 'gb', t: 2, stage: 'Saved', lines: [{ id: 'keywords' }] },                                   // not chosen, not past Approved
  q3: { ref: 'QT261003', client: 'Northwind', mkt: 'gb', t: 3, stage: 'Saved', chosen: { t: 50 }, prop: { id: 'pa', n: 1 }, lines: [{ id: 'pt_class' }] },
  q4: { ref: 'QT261004', client: 'Northwind', mkt: 'gb', t: 4, stage: 'Saved', chosen: { t: 40 }, prop: { id: 'pa', n: 2 }, lines: [{ id: 'gpc' }] }, // older choice in the same proposal
  q5: { ref: 'QT261005', client: 'Northwind', mkt: 'gb', t: 5, stage: 'Declined', chosen: { t: 60 }, lines: [{ id: 'desc_gen' }] },
  q6: { ref: 'QT261006', client: 'Northwind', mkt: 'gb', t: 6, stage: 'Billed', superseded: { ref: 'x' }, lines: [{ id: 'details' }] },
  q7: { ref: 'QT261007', client: 'Northwind', mkt: 'de', t: 7, stage: 'Billed', lines: [{ id: 'highlights' }] },
  q8: { ref: 'QT261008', client: 'Northwind', mkt: 'gb', t: 8, stage: 'Delivered', deleted: true, lines: [{ id: 'desc_gen' }] },
  q9: { ref: 'QT261009', client: 'Northwind', mkt: 'gb', t: 9, stage: 'In action', lines: [], upd: { gbp: 200 } }
};
const CF = E.contractedFrom(SAVED, 'NORTHWIND', 'gb');
deq(CF.lines, { title: 'QT261001', attr_ai: 'QT261001', highlights: 'QT261001', ptype: 'QT261003' }, 'contracted lines: legacy ids + the Spark AI highlight route; only the newest choice in a proposal');
deq(CF.conv, { qa: 'QT261001' }, 'contracted conversational: legacy + Spark AI routes (off and the floor ignored)');
eq(CF.bundle, 'QT261009', 'a live new-products bundle');
deq(E.contractedFrom(SAVED, 'Northwind', 'fr'), { lines: {}, conv: {}, bundle: null }, 'another market: nothing');
const t = (x) => ({ t: x });
[
  [{}, {}, [], 'Not started'], [{}, {}, [{ t: { cov: 5 } }], 'Audit ready'], [{ debriefAt: t(7) }, {}, [{ t: { cov: 5 } }], 'Debriefed'],
  [{ debriefAt: t(7) }, { o1: { t: 1, sentAt: t(9) } }, [], 'Proposal sent'], [{}, { o1: { t: 1, sentAt: t(9), chosen: t(10) } }, [], 'Agreed'],
  [{ live: t(20) }, { o1: { t: 1, chosen: t(10) } }, [], 'Always-on live'], [{ live: t(20), declined: t(21) }, {}, [], 'Declined'],
  [{}, { o1: { t: 1, chosen: t(10) }, o2: { t: 2, declined: t(12) } }, [], 'Declined'], [{}, { o1: { t: 1, sentAt: t(9), deleted: true } }, [], 'Not started']
].forEach(([r, o, a, want], i) => eq(E.rolloutStage(r, o, a).stage, want, 'rolloutStage #' + (i + 1) + ' → ' + want));
eq(E.rolloutStage({}, { o1: { t: 1, chosen: t(10) }, o2: { t: 2, chosen: t(30) } }, []).since, 30, 'since = the newest event');
const OPS = { oa: { prop: { id: 'pp1', n: 2 }, t: 1 }, ob: { prop: { id: 'pp1', n: 1 }, t: 2 }, oc: { prop: { id: 'pp1', n: 3 }, t: 3, chosen: t(5) }, od: { prop: { id: 'pp1', n: 4 }, t: 4, chosen: t(9) }, oe: { prop: { id: 'pp2', n: 1 } } };
eq(E.countedOption(OPS, 'pp1'), 'od', 'countedOption: the newest choice wins');
eq(E.countedOption({ oa: OPS.oa, ob: OPS.ob }, 'pp1'), 'ob', 'countedOption: else the lowest-numbered');
eq(E.countedOption(OPS, 'nope'), null, 'countedOption: unknown proposal → null');
const QW = E.quickWins({ LG, now: NOW,
  estate: { feeds: { 'Northwind|gb': { client: 'Northwind', mkt: 'gb', t: 1, rows: 100, score: 70, ai: { n: 0 } }, 'Northwind|gb-fb': { client: 'Northwind', mkt: 'gb-fb', score: 10 },
    'Atelier|gb': { client: 'Atelier', mkt: 'gb', t: 1, rows: 100, score: 96, ai: { n: 2 } } } },
  rollout: { Atelier: { debriefAt: t(1) } },
  schedule: { cadence: [{ client: 'Atelier', mkt: 'gb', kind: 'kw', skipRate: 40, streak: 0 }, { client: 'Atelier', mkt: 'gb', kind: 'pt', skipRate: 90, streak: 5 }, { client: 'Harbour', mkt: 'gb', kind: 'titles', skipRate: 10, streak: 2 }] },
  arrivals: { feeds: [{ client: 'Harbour', mkt: 'gb', dob: { rows: 1000, m: { '2026-09': 120 } } }, { client: 'Linden', mkt: 'gb', dob: { rows: 1000, m: { '2026-09': 50 } } }] } });
deq(QW.map((w) => w.key), ['debrief-first|Northwind', 'batch-to-always-on|Atelier', 'batch-to-always-on|Harbour', 'collection-landing|Harbour'], 'quick wins: each rule on its fixture (Northwind is Retail, so no ai-gap)');
const QW2 = E.quickWins({ estate: { feeds: { 'Northwind|gb': { client: 'Northwind', mkt: 'gb', score: 99, ind: 'Fashion', ai: { n: 0 } } } }, LG, now: NOW });
deq(QW2.map((w) => w.key), ['ai-gap|Northwind'], 'ai-gap: a Fashion brand (industry as the scan stored it) with none of the six');
ok(/^SVC\d{6}$/.test(E.proposalRef('Northwind', '2026-10-07', [])), 'proposalRef = SVC + 6 digits');
const r1 = E.proposalRef('Northwind', '2026-10-07', []);
eq(E.proposalRef('Northwind', new Date(Date.UTC(2026, 9, 7, 15)), []), r1, 'same client + day → same ref');
eq(E.proposalRef('Northwind', '2026-10-07', [r1]), r1 + '-2', 'collision → -2'); eq(E.proposalRef('Northwind', '2026-10-07', { a: { ref: r1 }, b: { ref: r1 + '-2' } }), r1 + '-3', '…then -3 (refs read off a proposals map)');
const SNAP = E.snapshotOption(Object.assign({}, PQre2), [AC, AIe], RCr, null, { client: 'Northwind', by: 'ray@feedspark.com', t: NOW, prop: { id: 'ppabcd', n: 1, label: 'Tier 2' } });
ok(/^SVC\d{6}$/.test(SNAP.ref) && SNAP.client === 'Northwind' && SNAP.markets.join() === 'gb,ie', 'snapshot: ref, client, markets');
ok(J(SNAP).length < 60000, 'snapshot under 60 KB (' + J(SNAP).length + ' bytes)');
ok(!/genCost|listMargin|loaded|setupCost|rateAspl|marginPct/.test(J(SNAP)), 'snapshot carries no cost field');
ok(SNAP.audit.gb && SNAP.audit.gb.golden && 'score' in SNAP.audit.gb.golden, 'snapshot audit per market');
ok(!('needs' in SNAP.audit.gb) && SNAP.pq.lines.find((l) => l.key === 'title').byMkt.gb.n != null, 'the needs live ONCE, on pq.lines[].byMkt — never duplicated into audit[mkt]');
eq(SNAP.rates.g.tiers[SNAP.rates.g.tiers.length - 1].upTo, null, 'the open-ended tier is stored as null (JSON-safe)');
eq(SNAP.clientSafe, true, 'clientSafe frozen on the snapshot'); deq(SNAP.rates.aim, E.AIM_RATE_DEFAULT, 'Spark AI rates frozen');
const SNAPr = JSON.parse(J(SNAP));   // as it comes back from the store
eq(E.proposalText(SNAPr, { tone: 'direct' }).body, E.proposalText(PQre2, { tone: 'direct' }).body, 'the email written from a SAVED option is the email written from the live proposal');
const PQaf = E.packageQuote({ client: 'Northwind', option: 'go', markets: [{ mkt: 'gb', audit: AF }], rates: RC, roadmap: live }, LG);
const SNaf = JSON.parse(J(E.snapshotOption(PQaf, [AF], RC, null, { t: NOW })));
ok(/WHAT WE NEED FROM YOU\n· link — missing on 1 product\n· GTIN \/ MPN — missing on 1 product\n· size — missing on 1 product\n· item group id — missing on 2 products/.test(E.proposalText(SNaf, {}).body),
  'a saved option keeps the client-supply list, counted');
eq(E.snapshotOption(PQre2, [AC], RCr, null, { t: NOW }).client, 'Northwind', 'the snapshot reads the client off the proposal when the caller does not pass one');
// composeRates — precedence + the draft flags
const RR = E.composeRates({ legacy: { title_gen: { unit: 0.09, aspl: 7, t: 5 }, keywords: { t: 9, note: 'x' }, _globals: { blockGBP: 600 } },
  ops: { 'title_gen|aspl': { v: 8, by: 'dinesh@feedspark.com', at: 10 }, 'gpc|qcPct': { v: 25, by: 'a', at: 2 } },
  price: { 'gpc|unit': { v: 0.04, by: 'ray@feedspark.com', at: 3 } }, useActuals: true, actuals: { title_gen: { n: 2, aspl: 3, qc: 1, pm: 1, mon: 0, lead: 4 }, gpc: { n: 1, aspl: 2, qc: 1, pm: 1, mon: 2, lead: 0 } } });
ok(RR.rows.title_gen.aspl === 8 && RR.rows.title_gen.src.aspl === 'ops' && RR.rows.title_gen.by.aspl.by === 'dinesh@feedspark.com', 'ops beats everything, stamped');
ok(RR.rows.title_gen.unit === 0.09 && RR.rows.title_gen.src.unit === 'legacy', 'legacy £ when no price key');
ok(RR.rows.title_gen.qc === 1 && RR.rows.title_gen.src.qc === 'actuals', 'actuals beat the default'); eq(RR.rows.title_gen.lead, 4, 'actual lead');
eq(RR.rows.gpc.mon, 2, 'actual monitoring when > 0'); eq(RR.rows.gpc.src.lead, 'default', 'a zero actual lead is no evidence');
ok(RR.rows.gpc.unit === 0.04 && RR.rows.gpc.src.unit === 'ops' && !RR.rows.gpc.draftUnit, 'Management price clears draftUnit');
ok(RR.rows.keywords.draftUnit === true, 'a legacy row stamped t by an unrelated edit does NOT confirm the price');
eq(RR.rows.keywords.draftHours, false, '…but the v1 explicit save still confirms its hours');
eq(RR.rows.keywords.note, 'x', 'legacy note');
ok(RR.rows.attr_pop.unpriced && RR.rows.attr_pop.src.unit === 'unset', 'attr_pop starts unpriced');
eq(RR.g.blockGBP, 600, 'legacy block £ as the fallback'); eq(RR.g.src.blockGBP, 'legacy', '…labelled');
eq(E.composeRates({ price: { '_g|blockGBP': { v: 595 } } }).g.blockGBP, 595, 'Management block £ wins');
eq(E.composeRates({}).g.reusePct, null, 're-use unset by default'); eq(E.composeRates({}).g.ruleH, null, 'rule hours unset by default');
eq(E.composeRates({ price: { '_g|tiers': { v: [{ upTo: 1000, x: 1 }, { upTo: null, x: 0.5 }] } } }).g.tiers[1].upTo, Infinity, 'stored tiers: null = ∞');
eq(E.composeRates({ price: { '_g|tiers': { v: [{ upTo: 1000, x: 1 }, { upTo: 500, x: 0.5 }] } } }).g.src.tiers, 'default', 'non-ascending tiers refused');
const RQ = E.composeRates({ legacy: { title_gen: { unit: 0.09, t: 5 } } });
eq(E.quote(['title_gen'], { volume: 1000, rateOverrides: { title_gen: { unit: 0.09, t: 5 } } }).lines[0].tachyon, Math.round(0.09 * 1000 * 100) / 100, 'v1 quote still reads the legacy card');
eq(RQ.rows.title_gen.unit, 0.09, 'v2 reads the same legacy unit');
eq(E.DELIVERY_PLAN.length >= 13 && E.DELIVERY_PLAN.every((d) => ['this PR', 'Ray / Management', 'ASPL', 'London AM', 'Team', 'Next', 'Later'].indexOf(d.owner) >= 0 && d.title && d.detail), true, 'DELIVERY_PLAN rows carry a known owner, a title and a detail');
ok(!/£\s?\d/.test(J(E.DELIVERY_PLAN)), 'DELIVERY_PLAN carries no figure');

/* ---------- 15b. review fixes (round 1) — every confirmed finding pinned on the shape that failed ---------- */
section('15b · review fixes — each finding\'s failing shape, now held');
const offBut = (keep) => { const o = {}; E.PKG_LINES.forEach((l) => { if (keep.indexOf(l.key) < 0) o[l.key] = { on: false }; }); return o; };
const lineOf = (pq, k) => pq.lines.find((l) => l.key === k) || {};
const r2 = (x) => Math.round(x * 100) / 100;
// [0] a stored-lane BOUND need whose lower end is 0 is not "nothing to fix": it stays priced and blocks
{
  const AB0 = stored({ rows: 1000, P: 1000, qattrs: { description: qa(1000, { thin: 0 }), product_highlight: qa(1000, {}) } });
  const NB0 = E.needsOf(AB0, { descTarget: 500, hlTarget: 6 }, LG);
  ok(NB0.desc.lo === 0 && NB0.desc.hi === 1000 && NB0.desc.est === 'bound', 'fixture: every description ≥160 → the 160–500 band reads 0 to 1,000');
  const pq = E.packageQuote({ client: 'Northwind', option: 'ar', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: AB0 }], lineOpts: offBut(['desc', 'highlights']), aimSources: OFF6, targets: { descTarget: 500, hlTarget: 6 } }, LG);
  ['desc', 'highlights'].forEach((k) => {
    const l = lineOf(pq, k);
    ok(l.status === 'priced' && l.reason !== 'nothing to fix', '[0] ' + k + ': a 0-to-1,000 bound stays priced (was "none · nothing to fix")', l.status + ' / ' + l.reason);
    ok(l.gen === 0 && l.genHi > 0, '[0] ' + k + ': priced at its lower end with its upper end beside it (gen 0, genHi ' + l.genHi + ')');
    ok(pq.blockers.some((b) => b.code === 'estimate' && b.line === k && /up to 1,000/.test(b.why)), '[0] ' + k + ': the estimate blocker fires, worded "up to" (never "at least 0")');
  });
  eq(pq.clientSafe, false, '[0] the proposal is NOT client-safe (was true at £0)');
  ok(pq.oneOff.total > 0, '[0] the set-up hours of the two lines are in the one-off (was £0)');
  const body = E.proposalText(pq, { guard: false }).body;
  ok(/· Description enrichment — up to 1,000 products — up to £150\b/.test(body), '[0] client copy reads "up to 1,000 products — up to £150"', body.split('\n').filter((x) => /Description/.test(x)).join(' | '));
  // product type to 4+ levels on the stored lane: lo = missing + single-level = 0, hi = filled
  const APT = stored({ rows: 1000, P: 1000, qattrs: { product_type: qa(1000, {}) } });
  const pqt = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: APT }], lineOpts: offBut(['ptype']), targets: { ptMinDepth: 4 } }, LG);
  ok(lineOf(pqt, 'ptype').status === 'priced' && !pqt.clientSafe && pqt.blockers.some((b) => b.line === 'ptype' && b.code === 'estimate'), '[0] ptMinDepth 4 with no single-level paths: priced + blocked, never "nothing to fix"');
  // attribute population with no content-quality reading and nothing missing (hi null)
  const AAN = stored({ rows: 1000, P: 1000, sc: { color: 1000, material: 1000, pattern: 1000, gender: 1000, age_group: 1000, size: 1000 } });
  const pqa = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: AAN }], lineOpts: offBut(['attr_ai']) }, LG);
  eq(lineOf(pqa, 'attr_ai').need.hi, null, 'fixture: attr_ai with no quality reading has no upper bound');
  ok(lineOf(pqa, 'attr_ai').status === 'priced' && !pqa.clientSafe, '[0] attr_ai with no quality reading and nothing missing: priced + blocked, not "nothing to fix"');
  // control: an EXACT zero is still nothing to fix
  const z = [0, 0], AOK = liveAudit('gb', 3000, 1000, { desc: { b: { empty: z, lt160: z, lt300: z, lt500: z, lt1000: z, ok: [3000, 1000] } } });
  eq(lineOf(E.packageQuote({ client: 'Northwind', option: 'ar', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: AOK }], lineOpts: offBut(['desc']) }, LG), 'desc').status, 'none', '[0] control: an exact zero (live count) is still "nothing to fix"');
}
// [1] an empty or item-less live read never replaces a populated stored reading with zeros
{
  const stE = stored({ rows: 5000, cov: { keywords: 40, product_detail: 10 }, qattrs: { title: qa(4800, { caps: 300 }), description: qa(4000, { thin: 900 }) } });
  const ncE = E.needCollector(LG, Arr); ncE.onRow(H.slice());                 // a header, then nothing
  const xcE = LG.xmlCollector({ client: 'Northwind', market: 'gb' }); xcE.onRow(H.slice());
  const AE = E.auditMerge(stE, { nc: ncE, pc: E.parentCounter(), xc: xcE, src: 'live', client: 'Northwind', mkt: 'gb', PR: { overrides: {} } }, LG, Arr, NOW);
  eq(AE.S, 5000, '[1] an empty live read keeps the stored S (was S 0)'); eq(AE.P, null, '[1] …and P stays uncounted (was P 0)'); eq(AE.pSrc, null, '[1] nothing is reported as counted');
  eq(AE.counts, null, '[1] counts stay null — the zeros are never read as exact needs');
  ok(AE.golden && AE.golden.cov === stE.golden.cov, '[1] an item-less xmlCollector read leaves the stored coverage in place');
  ok(AE.emptyRead && AE.missing.some((m) => /live read returned no products — the stored reading is kept/.test(m)), '[1] and the audit says so');
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: AE }] }, LG);
  ok(lineOf(pq, 'title').status === 'priced' && pq.oneOff.total > 0 && !pq.clientSafe, '[1] the stored quote stands: title priced, one-off > 0, not client-safe (was £0, client-safe)');
  // the file lane: a file whose rows all lack an id counts S 0 — nothing reads "nothing to fix"
  const ncF = E.needCollector(LG, Arr); ncF.onRow(['id', 'title']); ncF.onRow(['', 'x']);
  const AFE = E.auditMerge(null, { nc: ncF, src: 'file', client: 'Prospect', mkt: 'gb', industry: 'Fashion' }, LG, Arr, NOW);
  ok(AFE.S == null && AFE.emptyRead, '[1] file lane: an empty read leaves S unknown');
  const pqf = E.packageQuote({ client: 'Prospect', option: 'go+ar', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: AFE }] }, LG);
  ok(!pqf.lines.some((l) => l.status === 'none') && lineOf(pqf, 'conv').status === 'unknown' && !pqf.clientSafe, '[1] file lane: no line "nothing to fix", conversational not sized, not client-safe');
  // a stored reading of ZERO rows is not sized either (P_m = P ?? S, and a size of 0 is no size)
  const A0r = stored({ rows: 0, qrows: 0, qattrs: { title: qa(0, {}) } });
  const pq0 = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: A0r }], lineOpts: offBut(['title']) }, LG);
  ok(lineOf(pq0, 'title').status === 'unknown' && /returned no products/.test(lineOf(pq0, 'title').reason), '[1] a zero-row reading: title "not sized", never "nothing to fix"');
}
// [2] a new-products bundle contracted on ONE market leaves only that market's new products out
{
  const GBm = liveAudit('gb', 3000, 1000, extraRule, { perMonthP: 40, unit: 'parent' }), DEm = liveAudit('de', 3000, 1000, extraRule, { perMonthP: 40, unit: 'parent' });
  const b = { client: 'Northwind', option: 'go', rates: RC, roadmap: live, aimSources: OFF6, markets: [{ mkt: 'gb', audit: GBm }, { mkt: 'de', audit: DEm }] };
  const noC = E.packageQuote(b, LG);
  const withC = E.packageQuote(Object.assign({}, b, { contracted: { gb: { lines: {}, conv: {}, bundle: 'QT260001' }, de: { lines: {}, conv: {}, bundle: null } } }), LG);
  const gbP = withC.perMarket.find((m) => m.mkt === 'gb'), deP = withC.perMarket.find((m) => m.mkt === 'de');
  near(withC.monthly.gen, r2(deP.newP * deP.perNew), '[2] monthly generation = DE\'s new products only (was £0 for both)', 0.011);
  ok(withC.monthly.gen > 0 && withC.monthly.gen < noC.monthly.gen, '[2] …between nothing and both markets');
  ok(gbP.overlap === 'QT260001' && deP.overlap == null && Object.keys(gbP.perNewUnits).length === 0, '[2] the overlap is per market: GB carries the ref and no new-product units');
  deq(withC.monthly.overlapMkts, ['gb'], '[2] overlapMkts names GB'); ok(/GB overlaps QT260001 monthly bundle/.test(withC.monthly.overlap), '[2] overlap names the market and the ref');
  const body = E.proposalText(withC, { guard: false }).body;
  ok(/Every new product: DE £0\.30 each — about 44 new products a month\./.test(body) && !/GB £0\.30/.test(body), '[2] client copy prices DE\'s new products only', body.split('\n').filter((x) => /new product/i.test(x)).join(' | '));
  ok(/New products in GB: already covered by your current new-products bundle\./.test(body), '[2] …and says GB is covered by the bundle');
  const RCfl = E.composeRates(Object.assign(cleanStores(), { price: Object.assign(cleanStores().price, { '_g|floorMonthly': { v: 5000, by: 'r', at: 1 } }) }));
  ok(E.packageQuote(Object.assign({}, b, { rates: RCfl, contracted: { gb: { lines: {}, conv: {}, bundle: 'QT1' }, de: { lines: {}, conv: {}, bundle: null } } }), LG).monthly.floorApplied, '[2] the floor still applies while one market is priced');
  ok(!E.packageQuote(Object.assign({}, b, { rates: RCfl, contracted: { gb: { lines: {}, conv: {}, bundle: 'QT1' }, de: { lines: {}, conv: {}, bundle: 'QT2' } } }), LG).monthly.floorApplied, '[2] …and not when every market is covered');
}
// [3] a Spark AI attribute contracted in SOME markets is never silently dropped for the rest
{
  const GBc = liveAudit('gb', 3000, 1000, null, { perMonthP: 40, unit: 'parent' }), DEc = liveAudit('de', 6000, 2000, null, { perMonthP: 80, unit: 'parent' });
  const b = { client: 'Northwind', option: 'ar', rates: RC, roadmap: live, aimSources: { qa: 'ai', doc: 'off', rel: 'off', igt: 'off', vopt: 'off', pop: 'off', hi: 'off' }, markets: [{ mkt: 'gb', audit: GBc }, { mkt: 'de', audit: DEc }], lineOpts: offBut(['conv']) };
  const a = E.packageQuote(b, LG);
  const part = E.packageQuote(Object.assign({}, b, { contracted: { gb: { lines: {}, conv: { qa: 'QT9' }, bundle: null }, de: { lines: {}, conv: {}, bundle: null } } }), LG);
  ok(lineOf(part, 'conv').status === 'priced' && part.oneOff.conv === a.oneOff.conv && part.monthly.conv === a.monthly.conv, '[3] Q&A contracted on GB only: still priced over GB + DE (was "contracted", £0)');
  ok(!part.clientSafe && part.blockers.some((x) => x.code === 'contracted-partial' && /QT9, GB/.test(x.why) && /DE/.test(x.why)), '[3] …and blocked until the AM settles the DE scope, naming both markets');
  const all = E.packageQuote(Object.assign({}, b, { contracted: { gb: { lines: {}, conv: { qa: 'QT9' }, bundle: null }, de: { lines: {}, conv: { qa: 'QT8' }, bundle: null } } }), LG);
  ok(lineOf(all, 'conv').status === 'contracted' && /QT9, GB/.test(lineOf(all, 'conv').reason) && /QT8, DE/.test(lineOf(all, 'conv').reason), '[3] contracted in EVERY market: set aside, each market\'s quote named');
}
// [4] a null loaded cost anywhere in the monthly loop keeps monthlyCost null (null + x is x)
{
  const costs4 = { '_c|rateAspl': { v: 30 }, '_c|rateAm': { v: 40 }, '_c|gbpPerMTok': { v: 2 }, '_c|ohPct': { v: 20 }, '_c|marginPct': { v: 40 } };
  const st = cleanStores();
  E.CATALOG.concat(E.PKG_ROWS).forEach((c) => { if (c.id === 'title_gen') return; st.ops[c.id + '|aMin'] = { v: 10 }; st.ops[c.id + '|tokPerP'] = { v: 1000 }; st.ops[c.id + '|qcPct'] = { v: 10 }; st.ops[c.id + '|qcMin'] = { v: 2 }; });
  const R4 = E.composeRates(st), A4 = liveAudit('gb', 3000, 1000, null, { perMonthP: 400, unit: 'parent' });
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: R4, roadmap: live, markets: [{ mkt: 'gb', audit: A4 }], aimSources: OFF6 }, LG);
  ok(Object.keys(pq.perMarket[0].perNewUnits)[0] === 'title', 'fixture: the uncosted line is the FIRST monthly key (the order that hid it)');
  const cm = E.costModel(R4, costs4, {}, pq);
  ok(cm.proposal.monthlyCost === null && cm.proposal.monthlyMargin === null, '[4] monthlyCost and its margin stay null (were 587.41 / 18.1%)');
  ok(cm.proposal.why.some((w) => /monthly line has no loaded cost/.test(w)), '[4] …with the reason');
  st.ops['title_gen|aMin'] = { v: 10 }; st.ops['title_gen|tokPerP'] = { v: 1000 }; st.ops['title_gen|qcPct'] = { v: 10 }; st.ops['title_gen|qcMin'] = { v: 2 };
  ok(typeof E.costModel(E.composeRates(st), costs4, {}, pq).proposal.monthlyCost === 'number', '[4] control: every line costed → a number');
}
// [5][18][29] the derived stage: a decline beside a chosen sibling is an agreement; ties are deterministic
{
  const S1 = { o1: { t: 1000, prop: { id: 'ppabcd', n: 1 }, chosen: { t: 6000 } }, o2: { t: 1000, prop: { id: 'ppabcd', n: 2 } }, o3: { t: 5000, prop: { id: 'ppabcd', n: 3 }, declined: { t: 7000 } } };
  eq(E.rolloutStage({}, S1, {}).stage, 'Agreed', '[5] option 1 chosen, a later-added option 3 declined → Agreed (was Declined)');
  const tie = (first) => { const d = { oA: { t: 1000, prop: { id: 'ppx1', n: 1 }, declined: { t: 300 } }, oB: { t: 1000, prop: { id: 'ppx1', n: 2 }, chosen: { t: 500 } } }; return first === 'A' ? d : { oB: d.oB, oA: d.oA }; };
  eq(E.rolloutStage({}, tie('A'), {}).stage, 'Agreed', '[29] same save, Tier 1 declined + Tier 2 chosen, Tier 1 first in the map → Agreed');
  eq(E.rolloutStage({}, tie('B'), {}).stage, 'Agreed', '[29] …and with the map in the other order (the order no longer decides)');
  const mir = { oA: { t: 1000, prop: { id: 'ppx2', n: 1 }, chosen: { t: 500 } }, oB: { t: 1000, prop: { id: 'ppx2', n: 2 }, declined: { t: 300 } } };
  eq(E.rolloutStage({}, mir, {}).stage, 'Agreed', '[18] the mirror (Tier 1 chosen, Tier 2 declined) → Agreed');
  eq(E.rolloutStage({}, { oA: { t: 1000, prop: { id: 'ppx3', n: 1 }, declined: { t: 300 } }, oB: { t: 1000, prop: { id: 'ppx3', n: 2 }, declined: { t: 400 } } }, {}).stage, 'Declined', '[29] every live option declined, none chosen → Declined');
  eq(E.rolloutStage({}, { o1: { t: 1, sentAt: { t: 9 }, prop: { id: 'ppx4', n: 1 } }, o2: { t: 50, superseded: { ref: 'x' }, declined: { t: 60 }, prop: { id: 'ppx4', n: 1 } } }, {}).stage, 'Proposal sent', '[18] a superseded option is history — never the "latest" that declines');
  eq(E.rolloutStage({}, { o1: { t: 1, chosen: t(10) }, o2: { t: 2, declined: t(12) } }, []).stage, 'Declined', '[5] unchanged: options of DIFFERENT proposals (no prop) — the newest declined still reads Declined');
}
// [6] countedOption never counts a declined option; a live sibling keeps the proposal in the pipeline
{
  const C6 = { oc1: { t: 1, prop: { id: 'ppy', n: 1 }, declined: { t: 7 } }, oc2: { t: 1, prop: { id: 'ppy', n: 2 } } };
  eq(E.countedOption(C6, 'ppy'), 'oc2', '[6] option 1 declined, option 2 open → option 2 is counted (was the declined option 1)');
  eq(E.countedOption({ oc1: C6.oc1, oc2: Object.assign({}, C6.oc2, { declined: { t: 8 } }) }, 'ppy'), null, '[6] every option declined → counted at none');
  eq(E.countedOption({ oc1: Object.assign({}, C6.oc1, { chosen: { t: 9 } }), oc2: C6.oc2 }, 'ppy'), 'oc2', '[6] a chosen-then-declined option is not counted either');
}
// [7] no market sized (Pβ = 0): β = 1, so a need read off the quality record prices — never a silent £0
{
  const A7 = E.auditStored({ client: 'Northwind', mkt: 'gb', G: { client: 'Northwind', mkt: 'gb', status: 'never' },
    Q: { rows: 1000, t: 1, attrs: { title: qa(900, { caps: 50 }), description: qa(900, { thin: 100 }) } }, PR: { overrides: {} } }, LG, Arr);
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: A7 }], lineOpts: offBut(['title']) }, LG);
  ok(A7.S == null && pq.Pbeta === 0 && pq.beta === 1, 'fixture: S unknown, Pβ 0, β 1');
  eq(lineOf(pq, 'title').gen, r2(0.08 * 150), '[7] title gen = unit × β(1) × 150 (was £0)');
  ok(pq.oneOff.gen > 0 && !pq.clientSafe, '[7] the generation is in the one-off; still an estimate, not client-safe');
}
// [8] scope "every product" on attribute population with the category scope NOT measured is an upper bound
{
  const B8 = stored({ rows: 1000, cov: { color: 80, material: 50, pattern: 100 }, qattrs: { color: qa(800, {}), material: qa(500, {}), pattern: qa(1000, {}) }, P: 1000, industry: 'Fashion' });
  const lo8 = offBut(['attr_ai']); lo8.attr_ai = { on: true, scope: 'all' };
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: B8 }], lineOpts: lo8 }, LG);
  ok(lineOf(pq, 'attr_ai').est === 'bound' && !pq.clientSafe, '[8] scope all, scope not measured: est bound, not client-safe (was exact + client-safe)');
  ok(pq.blockers.some((b) => b.line === 'attr_ai' && /category scope not measured/.test(b.why)), '[8] …the blocker names the unmeasured scope');
  const B8m = stored({ rows: 1000, cov: { color: 80, material: 50, pattern: 100 }, sc: { color: 1000, material: 1000, pattern: 1000, gender: 1000, age_group: 1000, size: 1000 }, qattrs: { color: qa(800, {}), material: qa(500, {}), pattern: qa(1000, {}) }, P: 1000, industry: 'Fashion' });
  eq(lineOf(E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: B8m }], lineOpts: lo8 }, LG), 'attr_ai').est, null, '[8] control: the scope measured → exact');
}
// [9] β read on SKUs while a grouped feed's parents are uncounted blocks, even when every line is exact
{
  const sc9 = { color: 60000, material: 60000, pattern: 60000, gender: 60000, age_group: 60000, size: 60000 };
  const mk9 = (P) => stored({ rows: 60000, cov: { color: 50, material: 50, pattern: 50 }, sc: sc9, qattrs: { color: qa(30000, {}), material: qa(30000, {}), pattern: qa(30000, {}) }, P, industry: 'Fashion' });
  const spec9 = (A) => ({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, markets: [{ mkt: 'gb', audit: A }], lineOpts: offBut(['attr_ai']) });
  const q0 = E.packageQuote(spec9(mk9(null)), LG), q1 = E.packageQuote(spec9(mk9(12000)), LG);
  ok(lineOf(q0, 'attr_ai').est === null && !q0.clientSafe && q0.blockers.some((b) => /volume discount is read on the SKU count/.test(b.why)), '[9] P uncounted: the β-on-SKUs blocker (was client-safe at a price that moves)');
  ok(q1.clientSafe && !q1.blockers.some((b) => /volume discount/.test(b.why)), '[9] P counted: no β blocker');
  const A9 = mk9(null); A9.hasGroups = false;
  ok(!E.packageQuote(spec9(A9), LG).blockers.some((b) => /volume discount/.test(b.why)), '[9] no item groups (P = S exactly): no β blocker');
}
// [10] set-up hours on no rate row (FeedHero rules, extra languages) are costed — the margin is no longer overstated
{
  const costs10 = { '_c|rateAspl': { v: 30 }, '_c|rateAm': { v: 40 }, '_c|gbpPerMTok': { v: 2 }, '_c|ohPct': { v: 20 }, '_c|marginPct': { v: 40 } };
  const st = cleanStores(); st.ops['_g|ruleH'] = { v: 6 }; st.ops['_g|langSetupH'] = { v: 16 };
  const R10 = E.composeRates(st);
  const rule4 = { rule: { gender: { n: 100, u: 0, miss: 10 }, age_group: { n: 100, u: 0, miss: 10 }, size_type: { n: 100, miss: 10 }, size_system: { n: 100, miss: 10 }, condition: { n: 100, miss: 0 } } };
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: R10, roadmap: live, aimSources: OFF6, markets: [{ mkt: 'gb', audit: liveAudit('gb', 3000, 1000, rule4) }, { mkt: 'de', audit: liveAudit('de', 3000, 1000, rule4) }] }, LG);
  let rowH = 0, rowCost = 0;
  pq.lines.forEach((l) => { const d = E.PKG_LINES.find((x) => x.key === l.key); if (d.row && l.status === 'priced') { const r = R10.rows[d.row]; rowH += r.aspl + r.qc + r.pm; rowCost += (r.aspl * 30 + (r.qc + r.pm) * 40) * 1.2; } });
  ok(pq.oneOff.H - rowH === 24 + 16, 'fixture: 24 rule hours + 16 language hours on no rate row');
  const cm = E.costModel(R10, costs10, {}, pq);
  near(cm.proposal.setupCost, rowCost + 40 * 30 * 1.2, '[10] setupCost = row lines + the rule and language hours at the ASPL rate × (1 + oh)', 1e-6);
  const pqR = E.packageQuote({ client: 'Northwind', option: 'go', rates: R10, roadmap: live, aimSources: OFF6, markets: [{ mkt: 'gb', audit: liveAudit('gb', 3000, 1000, rule4) }],
    contracted: { lines: { title: 'Q', keywords: 'Q', ptype: 'Q', gpc: 'Q', attr_ai: 'Q' }, conv: {}, bundle: null } }, LG);
  ok(lineOf(pqR, 'attr_rule').status === 'priced' && E.costModel(R10, costs10, {}, pqR).proposal.setupMargin < 1, '[10] a rules-only proposal no longer reads a 100% set-up margin');
  ok(E.costModel(R10, { '_c|rateAm': { v: 40 }, '_c|ohPct': { v: 20 } }, {}, pqR).proposal.setupCost === null, '[10] no ASPL cost rate → the set-up cost is null, never partial');
}
// [11] the client copy's count is the count the £ beside it covers
{
  const pq = E.packageQuote({ client: 'Northwind', option: 'go', rates: RC, roadmap: live, aimSources: OFF6, markets: [{ mkt: 'gb', audit: liveAudit('gb', 3000, 1000) }, { mkt: 'de', audit: liveAudit('de', 3000, 1000) }],
    contracted: { gb: { lines: { title: 'QT7' }, conv: {}, bundle: null }, de: { lines: {}, conv: {}, bundle: null } }, lineOpts: { attr_ai: { on: false } } }, LG);
  const tl = lineOf(pq, 'title');
  ok(tl.need.n === 2000 && tl.pricedNeed && tl.pricedNeed.n === 1000, '[11] need over every market 2,000; the priced need 1,000');
  ok(/· Title optimisation — 1,000 products \(already covered in GB\) — £80/.test(E.proposalText(pq, { guard: false }).body), '[11] client copy: "1,000 products (already covered in GB) — £80" (was 2,000 for £80)');
  ok(/1,000 products/.test(E.proposalText(pq, { guard: false }).talk[1]) || !/title/.test(E.proposalText(pq, { guard: false }).talk[1]), '[11] the talk track\'s biggest gap reads the priced count too');
}
// [12] a typed parent count above the SKUs read is refused, never priced as a multiplier
{
  const st = stored({ rows: 10000, qrows: 10000, cov: { product_detail: 90 }, qattrs: { title: qa(10000, { caps: 500 }) } });
  const A50 = E.auditMerge(st, { typedP: 50000, src: 'live' }, LG, Arr, NOW), A5 = E.auditMerge(st, { typedP: 5000, src: 'live' }, LG, Arr, NOW);
  ok(A50.P === null && A50.pRefused === 50000 && A50.missing.some((m) => /50,000 is more than the 10,000 SKUs/.test(m)), '[12] typed 50,000 on 10,000 SKUs: refused and named');
  eq(E.needsOf(A50, {}, LG).details.n, 1000, '[12] …so details stays at the SKU count (was 5,000 "parents")');
  ok(A5.P === 5000 && A5.pSrc === 'typed', '[12] control: a typed 5,000 is taken');
}
// [19] "95 needs data only you hold" only when every remaining gap IS the client's data
{
  const t1 = PQt.perMarket[0].projected, t2 = PQall.perMarket[0].projected;
  ok(t2.blockers.length && t2.blockers.every((b) => b.tag === 'client to supply'), 'fixture: Tier 2 leaves only client data under 99%');
  ok(/once this work lands \(Tier 2 · AI-ready takes it further\)/.test(E.proposalText(PQt, { guard: false }).body), '[19] Tier 1 with a Tier-2 gap: "Tier 2 · AI-ready takes it further", never "only you hold"');
  ok(/once this work lands \(95 needs data only you hold — listed below\)/.test(E.proposalText(PQall, { guard: false }).body), '[19] Tier 2, client data alone left: "data only you hold — listed below"');
  ok(/WHAT WE NEED FROM YOU\n· sale price — filled on 0% of products today\n· GTIN \/ MPN — filled on 0% of products today/.test(E.proposalText(PQall, { guard: false }).body), '[19] …and "listed below" is true: every client-to-supply gap is listed');
  const PQcm = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: AP }] }, base10, { roadmap: Object.assign({}, live, { 'highlights|*': { status: 'building' } }) }), LG);
  ok(PQcm.perMarket[0].projected.blockers.some((b) => b.key === 'product_highlight' && b.tag === 'coming'), '[19] a FeedSpark line that is coming is tagged "coming", not "client to supply"');
  ok(/\(the rest follows the work still to be confirmed below\)/.test(E.proposalText(PQcm, { guard: false }).body), '[19] …and the email says so');
  const APg = Object.assign({}, AP, { golden: (() => { const cov = Object.assign({}, AP.golden.cov, { google_product_category: 80 }); const at = LG.attrsFromCov(cov, null, 3000); return { attrs: at, cov, sc: null, score: LG.goldenScore(at, AP.prof).score, gs: LG.goldenScore(at, AP.prof) }; })() });
  const PQoff = E.packageQuote(Object.assign({ markets: [{ mkt: 'gb', audit: APg }], lineOpts: { gpc: { on: false } } }, base10, { option: 'go' }), LG);
  ok(PQoff.perMarket[0].projected.blockers.some((b) => b.key === 'google_product_category' && b.tag === 'not in this quote'), '[19] GPC switched off: "not in this quote" (was "client to supply")');
  ok(/\(95 needs work outside this option\)/.test(E.proposalText(PQoff, { guard: false }).body), '[19] …and the email does not blame the client');
  const both = E.proposalText([PQt, PQall], { guard: false }).body;
  ok(new RegExp('today — ' + t1.after + ' with option 1, ' + t2.after + ' with option 2 \\(95 needs data only you hold').test(both), '[19] several options: every option\'s projection, the tail read off the best one', both.split('\n').filter((x) => /Golden Record/.test(x)).join(' | '));
}
// [31][33] the snapshot: needs stored once; the frozen fields in the store's own form
{
  ok(!('needs' in SNAP.audit.gb) && !('needs' in SNAP.audit.ie), '[31] no market\'s needs copied into audit[mkt] (pq.lines[].byMkt holds them)');
  const SN1 = E.snapshotOption(PQgo, [A1], RC, null, { t: NOW });
  ok(SN1.pkgVersion === '' && J(SN1.opts) === '{}' && J(SN1.aimSources) === '{}', '[33] pkgVersion "" · opts {} · aimSources {} — never null, so a re-push compares equal');
  eq(SNAP.prop.label, 'Tier 2', '[33] prop carried as the store keeps it'); eq(E.snapshotOption(PQgo, [A1], RC, null, { t: NOW, prop: { id: 'ppabcd', n: '2' } }).prop.label, '', '[33] a prop with no label stores ""');
}
// ADDITION B — test packages: a flat monthly add-on to any option
{
  const Rt = E.composeRates({});
  deq(Rt.g.tests, { 2: 800, 3: 1140, 4: 1440 }, 'B: draft test package prices {2: £800, 3: £1,140, 4: £1,440} a month');
  deq(Rt.g.src.tests, { 2: 'default', 3: 'default', 4: 'default' }, 'B: …each read as a draft default');
  const Rm = E.composeRates({ price: { '_g|test3': { v: 1200, by: 'ray@feedspark.com', at: 5 } } });
  ok(Rm.g.tests[3] === 1200 && Rm.g.src.tests[3] === 'ops' && Rm.g.by.tests[3].by === 'ray@feedspark.com', 'B: Management\'s _g|test3 wins, stamped');
  const stT = cleanStores(); stT.price['_g|test2'] = { v: 800, by: 'm', at: 1 }; stT.price['_g|test3'] = { v: 1140, by: 'm', at: 1 }; stT.price['_g|test4'] = { v: 1440, by: 'm', at: 1 };
  const RCt = E.composeRates(stT);
  const spec = (R, tests) => Object.assign({ markets: [{ mkt: 'gb', audit: AC }] }, base10, { rates: R, opts: { tests } });
  const q0 = E.packageQuote(spec(RCt, 0), LG), q3 = E.packageQuote(spec(RCt, 3), LG), qd = E.packageQuote(spec(RC, 3), LG);
  deq(q0.tests, { n: 0, price: null, perTest: null, draft: false, status: 'off' }, 'B: tests 0 → off'); eq(q0.monthly.tests, 0, 'B: …nothing on the monthly');
  deq(q3.tests, { n: 3, price: 1140, perTest: 380, draft: false, status: 'priced' }, 'B: 3 tests a month, Management-priced');
  near(q3.monthly.total, q0.monthly.total + 1140, 'B: the monthly total carries the package', 1e-6); eq(q3.monthly.tests, 1140, 'B: monthly.tests');
  ok(q3.monthly.gen === q0.monthly.gen && q3.oneOff.total === q0.oneOff.total && q3.oneOff.bundleDisc === q0.oneOff.bundleDisc, 'B: no one-off, never in generation, outside β and the bundle %');
  ok(q3.clientSafe, 'B: a confirmed test price keeps the proposal client-safe');
  ok(qd.tests.draft && !qd.clientSafe && qd.blockers.some((b) => b.code === 'draft-tests' && b.why === 'test package price not confirmed — Management'), 'B: a DRAFT test price blocks: "test package price not confirmed — Management"');
  const RCf2 = E.composeRates(Object.assign(cleanStores(), { price: Object.assign({}, stT.price, { '_g|floorMonthly': { v: 99999, by: 'r', at: 1 } }) }));
  const qf0 = E.packageQuote(spec(RCf2, 0), LG), qf2 = E.packageQuote(spec(RCf2, 2), LG);
  near(qf2.monthly.total - qf0.monthly.total, 800, 'B: the floor never absorbs the package', 1e-6);
  const Ru = JSON.parse(J(RCt)); Ru.g.tests[4] = null; Ru.g.src.tests[4] = 'unset';
  Ru.g.tiers = RCt.g.tiers;
  const qu = E.packageQuote(spec(Ru, 4), LG);
  ok(qu.tests.status === 'unpriced' && qu.monthly.tests === 0 && Math.abs(qu.monthly.total - q0.monthly.total) < 1e-6 && qu.blockers.some((b) => b.code === 'unpriced' && b.line === 'tests'), 'B: an unset price → unpriced, out of the total, blocked');
  eq(E.packageQuote(spec(RCt, 5), LG).tests.status, 'off', 'B: only 2, 3 or 4 tests');
  const body = E.proposalText(q3, { guard: false }).body;
  ok(/· Test package: 3 tests a month — £1,140 a month \(£380 a test\)/.test(body), 'B: client copy "Test package: 3 tests a month — £1,140 a month (£380 a test)"');
  ok(body.indexOf('· Test package: ' + E.TEST_WHAT) >= 0, 'B: …and what a test IS, once, under HOW WE WOULD DO IT');
  ok(/Test package: 3 tests a month — \[£ to confirm — Ray\] a month \(\[£ to confirm — Ray\] a test\)/.test(E.proposalText(qd, {}).body), 'B: guarded while the price is a draft');
  ok(/3-test package/.test(E.proposalText(q3, {}).talk[2]), 'B: the talk track mentions it');
  ok(!/Test package/.test(E.proposalText(q0, { guard: false }).body), 'B: nothing about tests when there is none');
  const ot = E.optionsText([{ client: 'Northwind', pq: q3, clientSafe: true }]);
  ok(/Includes: .*Test package \(3 tests a month\)/.test(ot) && /   Test package: 3 tests a month — £1,140 a month \(£380 a test\)/.test(ot), 'B: optionsText lists it in Includes and prices it');
  const sn = JSON.parse(J(E.snapshotOption(q3, [AC], RCt, null, { t: NOW, opts: { tests: 3 } })));
  ok(sn.pq.tests.price === 1140 && sn.rates.g.tests[3] === 1140 && sn.opts.tests === 3, 'B: the snapshot keeps the package, its frozen price and the option');
  eq(E.proposalText(sn, { guard: false }).body, E.proposalText(q3, { guard: false }).body, 'B: the email from the saved option is the live one');
  const costsB = { '_c|rateAspl': { v: 30 }, '_c|rateAm': { v: 40 }, '_c|gbpPerMTok': { v: 2 }, '_c|ohPct': { v: 20 }, '_c|marginPct': { v: 40 } };
  const cm0 = E.costModel(RCt, costsB, {}, q0), cm3 = E.costModel(RCt, costsB, {}, q3);
  ok(cm3.proposal.monthlyMargin === cm0.proposal.monthlyMargin && cm3.proposal.excluded.indexOf('tests') >= 0, 'B: the package is out of both sides of the monthly margin');
  deq(E.contractedFrom({ x: Object.assign({}, sn, { mkt: 'gb', chosen: { t: 1 } }) }, 'Northwind', 'gb'), { lines: {}, conv: {}, bundle: null }, 'B: contractedFrom ignores a test package');
}
// ADDITION A — the tier names in client copy
{
  const tx = E.proposalText([PQt, PQall], { guard: false }).body;
  ok(/OPTION 1 · Tier 1 · Google-ready\nGoogle Optimise — eligible \+ everything Google recommends\n/.test(tx) && /OPTION 2 · Tier 2 · AI-ready\nGoogle-ready \+ AI Readiness — the bundle\n/.test(tx), 'A: the email names Tier 1 · Google-ready and Tier 2 · AI-ready, each with its one-line descriptor');
  ok(!/Google Optimise \+ AI Readiness|AI Readiness only/.test(tx + E.optionsText([{ pq: PQt }, { pq: PQall }, { pq: PQar }])), 'A: the old tier names are gone from client copy');
  ok(/3\. AI-ready only \(AI Readiness without Tier 1\)/.test(E.optionsText([{ pq: PQt }, { pq: PQall }, { pq: PQar }])), 'A: optionsText — "AI-ready only (AI Readiness without Tier 1)"');
}

/* ---------- 16. purity ---------- */
section('16 · the engine stays pure');
const code = ENG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
ok(!/\bimport\s*[({'"\w]/.test(code.replace(/import\(\)/g, '')), 'no import');
ok(!/\brequire\(/.test(code), 'no require(');
ok(!/\bdocument\./.test(code), 'no document.');
ok(!/\bwindow\./.test(code), 'no window.');
ok(!/\bfetch\(/.test(code), 'no fetch(');
ok(ENG.indexOf('predesc') < 0 && ENG.indexOf('text_attr') < 0, 'retired catalogue ids stay gone');

console.log('\n' + (fails ? '✗ ' + fails + ' of ' + n + ' failed' : '✓ all ' + n + ' passed'));
process.exit(fails ? 1 : 0);
