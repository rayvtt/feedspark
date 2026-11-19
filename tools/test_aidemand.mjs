// tools/test_aidemand.mjs — AI SHOPPING DEMAND: the engine, the store and the wiring.
//
// Ray, 19 Nov 2026: Merchant Center's "AI performance" report (shopping terms · search intents · product
// attributes) turned into feed work — SKU matching, ROAS beside the catalogue's, an action per term.
// Every fixture is INVENTED in the export's real shape (four meta lines, tab or comma, UTF-16 for the tab
// file, blanks where Google prints none). No client report is committed; the last block fails if one is.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = require(path.join(ROOT, 'docs', 'aidemand_engine.js'));
const S = await import(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'aidemand.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (got !== undefined ? ' — got ' + JSON.stringify(got) : '')); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- 1. the export, as Google writes it -----------------------------------------------------------------
const META = '"Name: AI shopping terms, product attributes and search intents"\n"Time period: Nov 9, 2026 – Nov 15, 2026"\nFilters: Country = US;Category = Apparel > Outerwear\n';
const TSV = META + 'Column filters: Term frequency >= 0.05\nSearch term\tTerm frequency\tProducts showing\tShare of voice\nwool coat\t1.0\t40\t0.31\nrain jacket\t0.62\t22\t0.08\nstorm proof\t0.3\t5\t0\nski suit\t0.2\t0\t\n\n';
const CSV = META + 'Column filters: Intent frequency >= 0.01\nSearch intent,Intent frequency,Products showing,Share of voice\ndressing for cold weather,1.0,12,0.1\n"shopping for a gift, last minute",0.5,0,\nother attire,0.04,,\n';
const ATT = META + 'Attribute,Attribute search popularity,Products showing\nColor,2.34k,300\nMaterial,324,120\nSleeve Style,94,12\n';
const t = E.parseExport(TSV), c = E.parseExport(CSV), a = E.parseExport(ATT);
ok('a tab-separated terms export parses', t.ok && t.kind === 'terms' && t.rows.length === 4, t);
ok('its period, country, category and column filter are read off the meta lines', t.from === '2026-11-09' && t.to === '2026-11-15' && t.country === 'US' && t.category === 'Apparel > Outerwear' && t.filter === 'Term frequency >= 0.05', t);
ok('a blank share of voice is null and a 0 is 0 — never the same thing', t.rows[3].sov === null && t.rows[2].sov === 0 && t.rows[0].sov === 0.31, t.rows);
ok('a comma export parses, a quoted comma stays in its cell', c.ok && c.kind === 'intents' && c.rows[1].t === 'shopping for a gift, last minute', c.rows);
ok('a blank Products showing is null, not zero', c.rows[2].ps === null && c.rows[1].ps === 0, c.rows);
ok('the attributes tab parses, "2.34k" is 2,340, and it has no share of voice', a.ok && a.kind === 'attrs' && a.rows[0].f === 2340 && a.rows[0].sov === null && a.rows[2].t === 'Sleeve Style', a.rows);
const u16 = Buffer.from('﻿' + TSV, 'utf16le');
ok('the UTF-16 file Google writes for the tab export is decoded off its bytes', E.parseExport(E.decode(new Uint8Array(u16))).rows.length === 4);
ok('a UTF-8 file with a byte-order mark too', E.parseExport(E.decode(new Uint8Array(Buffer.from('﻿' + CSV, 'utf8')))).kind === 'intents');
ok('a file that is not this report is refused with the reason', E.parseExport('id,title\n1,a\n').ok === false && /not a Merchant Center/.test(E.parseExport('id,title\n1,a\n').error));
ok('a header with no rows is refused', E.parseExport('Search term\tTerm frequency\n').ok === false);
ok('num: counts, thousands, blanks', E.num('161') === 161 && E.num('3.5k') === 3500 && E.num('1,940') === 1940 && E.num('') === null && E.num('—') === null);
ok('frac: a fraction, a percentage and a whole-number percentage are one scale', E.frac('0.25') === 0.25 && E.frac('25%') === 0.25 && E.frac('25.0') === 0.25 && E.frac('') === null);
ok('a day-first period and an ISO period read too', E.parsePeriod('9 Nov 2026 – 15 Nov 2026').from === '2026-11-09' && E.parsePeriod('2026-11-09 to 2026-11-15').to === '2026-11-15');
ok('a day the calendar does not have is no date', E.parsePeriod('Feb 31, 2026 – Mar 2, 2026').from === '');

// ---- 2. words ---------------------------------------------------------------------------------------------
const says = (text, term) => E.says(E.normText(text), E.termForms(term));
ok('"long sleeve" is said by Long-Sleeved, long sleeves, LONGSLEEVE', says('Vintage Long-Sleeved Top', 'long sleeve') && says('tee with long sleeves', 'long sleeve') && says('LONGSLEEVE tee', 'long sleeve'));
ok('"v neck" is said by V-Neck and Vneck', says('Cotton V-Neck', 'v neck') && says('Vneck jumper', 'v neck'));
ok('"high waisted" is said by High Waist and high-waisted', says('High Waist Jean', 'high waisted') && says('a high-waisted cut', 'high waisted'));
ok('"2 piece" is said by Two-Piece', says('Two-Piece Set', '2 piece'));
ok('whole words only: "low rise" is not said by "slow riser", "button up" not by "buttons upper"', !says('a slow riser', 'low rise') && !says('buttons upper', 'button up'));
ok('word order matters: "wide leg" is not said by "leg, wide"', !says('leg wide', 'wide leg'));
ok('a plural term meets a singular title', says('Wide Leg Jean', 'wide leg jeans'));

// ---- 3. the catalogue: SKU matching and ROAS ------------------------------------------------------------
const FEED = [
  { id: 'N1', gid: 'g1', ti: 'Wool Coat Navy', de: 'warm', pt: 'Women > Coats', hl: 'Fully lined', has: { color: 1, material: 1 } },
  { id: 'N2', gid: 'g1', ti: 'Wool Coat Camel', de: 'warm', pt: 'Women > Coats', hl: '', has: { color: 1, material: 1 } },
  { id: 'N3', gid: 'g2', ti: 'Long Overcoat', de: 'a long wool coat', pt: 'Women > Coats', has: { color: 1 } },
  { id: 'N4', gid: 'g3', ti: 'Storm Rain Jacket', hl: 'A rain jacket with taped seams', pt: 'Men > Jackets', has: { color: 1 } },
  { id: 'N5', gid: 'g3', ti: 'Packable Rain-Jackets', pt: 'Men > Jackets', has: {} },
  { id: 'N6', gid: 'g4', ti: 'Shell', de: 'a light rain jacket', pd: 'General:Season:Winter', pt: 'Men > Jackets', has: {} },
  { id: '', ti: 'no id' },
];
const ADS = { n1: [900, 40, 50, 3, 400], N2: [500, 20, 50, 1, 100], n4: [400, 10, 100, 1, 100], GONE: [1, 1, 999, 0, 0] };
const cat = E.indexProducts(FEED, ADS);
ok('a row with no id is no product', cat.tot.n === 6 && cat.tot.groups === 4, cat.tot);
ok('Google Ads joins by product id, case-blind; spend on an id the feed no longer carries is in no total', cat.tot.adv === 3 && cat.tot.cost === 200 && cat.tot.value === 600 && near(cat.tot.roas, 3), cat.tot);
const res = E.matchTerms(t.rows, cat), [wool, rain, storm, ski] = res;
ok('wool coat: 3 products, 2 styles, 2 in the title, 1 only outside it', wool.m.n === 3 && wool.m.groups === 2 && wool.m.ti === 2 && wool.m.notTi === 1 && wool.m.de === 1, wool.m);
ok('its ROAS is the ratio of the matched products’ sums (500 / 100), not a mean of ratios (8 and 2 → 5)', near(wool.m.ads.roas, 5) && wool.m.ads.cost === 100 && wool.m.ads.value === 500 && wool.m.ads.adv === 2, wool.m.ads);
ok('rain jacket: a hyphenated plural title and a highlight both count', rain.m.n === 3 && rain.m.ti === 2 && rain.m.hl === 1 && near(rain.m.ads.roas, 1), rain.m);
ok('no spend on the matched products is no ROAS, never 0%', E.matchOne('shell', cat).ads.roas === null);
ok('the four verdicts', wool.v.kind === 'hero' && rain.v.kind === 'growth' && storm.v.kind === 'wording' && ski.v.kind === 'range', res.map((x) => x.v.kind));
ok('hero is a share of voice at or over the line, whatever the catalogue says', E.verdict({ t: 'x', f: 1, sov: E.HERO_SOV, ps: 1 }, { n: 0, ti: 0, hl: 0, notTi: 0, ads: {} }, cat.tot).kind === 'hero');
ok('a wording gap needs Google to show products; with none shown it is a range question', storm.row.ps === 5 && ski.row.ps === 0 && /not a feed fix/.test(ski.v.act) && /write the term in/.test(storm.v.act));
ok('growth with most titles already saying it sends the work to highlights and Q&A', /highlights/.test(rain.v.act) && rain.v.fields.join() === 'product_highlight,question_and_answer', rain.v);
const lowTi = E.verdict({ t: 'wool coat', f: 1, sov: 0.05, ps: 9 }, { n: 10, ti: 2, hl: 0, notTi: 8, ads: {} }, cat.tot);
ok('growth with under half the titles saying it is a title job that counts the products', lowTi.kind === 'growth' && /Say it in the title: 8 of the 10/.test(lowTi.act) && lowTi.fields[0] === 'title', lowTi);
ok('the comparison with the catalogue: above, below — and none without spend', wool.v.cmp === 'above' && rain.v.cmp === 'below' && ski.v.cmp === null, [wool.v.cmp, rain.v.cmp]);
ok('ranking: asked often and held little outranks a hero and a range gap', rain.v.score > storm.v.score && storm.v.score > wool.v.score && wool.v.score > ski.v.score, res.map((x) => x.v.score));
const noAds = E.indexProducts(FEED, null);
ok('with no Google Ads read every ROAS is null and the match still stands', noAds.tot.roas === null && noAds.tot.ads === false && E.matchOne('wool coat', noAds).n === 3);

// ---- 4. activation ------------------------------------------------------------------------------------------
const L = E.labelSets(res, cat);
ok('labels: products of a hero term are AI_Hero_Terms, of a growth term AI_Growth_Opportunity', L.hero === 3 && L.growth === 3 && L.rows.filter((r) => r.label === 'AI_Hero_Terms').map((r) => r.id).sort().join() === 'N1,N2,N3', L);
const both = E.labelSets(E.matchTerms([{ t: 'wool coat', f: 1, sov: 0.4, ps: 1 }, { t: 'coat', f: 1, sov: 0.01, ps: 1 }], cat), cat);
ok('a product matching a hero AND a growth term is labelled once, as the hero', both.rows.length === 3 && both.rows.every((r) => r.label === 'AI_Hero_Terms'), both);
ok('wording and range gaps label nothing', E.labelSets([storm, ski], cat).rows.length === 0);
const tp = E.termProducts(wool, cat, 0);
ok('a term’s products lead with the ones not saying it in the title, then by what they earn', tp.map((p) => p.id).join() === 'N3,N1,N2' && tp[0].inTi === false && tp[1].value === 400, tp);
ok('the list can be capped for the screen and whole for the download', E.termProducts(wool, cat, 2).length === 2 && tp.length === 3);

// ---- 5. intents and attributes --------------------------------------------------------------------------------
ok('an intent’s key words drop the filler', E.intentKey('dressing for weddings') === 'weddings' && E.intentKey('shopping for hot weather clothing') === 'hot weather' && E.intentKey('other special occasion attire') === 'special occasion');
ok('an intent too general to match by words has no key', E.intentKey('finding items with specific features') === '' && E.intentKey('shopping for items with specific sizing') === '');
ok('each intent gets the play that fits it', E.intentPlay('dressing for weddings').k === 'occasion' && E.intentPlay('shopping for items with specific sizing').k === 'sizing' && E.intentPlay('shopping for hot weather clothing').k === 'weather' && E.intentPlay('finding items with specific features').k === 'features' && E.intentPlay('something else').k === 'usecase');
const mi = E.matchIntents([{ t: 'dressing for cold weather', f: 1 }, { t: 'finding items with specific features', f: 0.5 }], cat);
ok('an intent with a key is counted in the catalogue; one without is left unmatched', mi[0].key === 'cold weather' && mi[0].m.n === 0 && mi[1].m === null, mi.map((x) => [x.key, x.m && x.m.n]));
ok('intents read without a catalogue too', E.matchIntents([{ t: 'dressing for weddings', f: 1 }], null)[0].m === null);
const ap = E.attrPlan(a.rows, cat);
ok('an attribute with a Google field names it and reads the feed’s fill (colour 4 of 6)', ap[0].field === 'color' && ap[0].where === 'g:color' && near(ap[0].fill, 4 / 6) && ap[1].field === 'material' && near(ap[1].fill, 2 / 6), ap.map((x) => [x.where, x.fill]));
ok('an attribute with no field of its own goes to product_detail and says so', ap[2].field === '' && ap[2].where === 'g:product_detail' && /product detail/.test(ap[2].how));
ok('…and is counted where a product detail names it (Season on 1 of 6)', near(E.attrPlan([{ t: 'Season', f: 10 }], cat)[0].fill, 1 / 6));
ok('popularity is drawn relative to the most-searched attribute', ap[0].rel === 1 && near(ap[1].rel, 324 / 2340));
ok('before a match the fill is unread, not zero', E.attrPlan(a.rows, null)[0].fill === null);

// ---- 6. the headline and the trend ------------------------------------------------------------------------------
const H = E.headline(t.rows, res);
ok('share of voice is weighted by frequency over the terms that REPORT one (ski suit left out)', H.terms === 4 && H.known === 3 && near(H.sov, (1 * 0.31 + 0.62 * 0.08 + 0.3 * 0) / 1.92), H);
ok('the headline counts each verdict', H.kinds.hero === 1 && H.kinds.growth === 1 && H.kinds.wording === 1 && H.kinds.range === 1);
ok('no term reporting a share is no headline share, not 0%', E.headline([{ t: 'a', f: 1, sov: null }], null).sov === null);
const W = (to, rows) => ({ kind: 'terms', from: to, to, rows });
const tr = E.trend([W('2026-11-15', [{ t: 'wool coat', sov: 0.31 }, { t: 'ski suit', sov: null }, { t: 'new term', sov: 0.2 }]), W('2026-11-01', [{ t: 'Wool Coat', sov: 0.07 }, { t: 'ski suit', sov: null }]), W('2026-11-08', [{ t: 'wool coat', sov: null }, { t: 'ski suit', sov: 0.1 }])]);
const tw = tr.filter((o) => o.t.toLowerCase() === 'wool coat')[0], tsk = tr.filter((o) => o.t === 'ski suit')[0], tn = tr.filter((o) => o.t === 'new term')[0];
ok('a term is followed across readings, oldest first, whatever its casing', tw.pts.length === 3 && tw.pts[0].to === '2026-11-01');
ok('the move is between the first and latest MEASURED readings (7% → 31% = +24 pts)', tw.delta === 24 && tw.first.sov === 0.07 && tw.last.sov === 0.31, tw);
ok('one measured reading beside blanks is no move', tsk.delta === null && tn.delta === null, [tsk.delta, tn.delta]);
ok('the biggest movers lead', tr[0] === tw);

// ---- 7. the store ---------------------------------------------------------------------------------------------
const up = S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, label: t.label, country: 'us', category: t.category, filter: t.filter, rows: t.rows }, { by: 'ray@feedspark.com', at: 5, src: 'upload' });
ok('an upload is kept with its id, stamp and rows', up && up.id === 'terms_2026-11-09_2026-11-15' && up.rows.length === 4 && up.by === 'ray@feedspark.com' && up.country === 'US' && up.src === 'upload', up);
ok('a null share of voice survives the store as null', up.rows[3].sov === null && up.rows[2].sov === 0);
ok('who and when are the server’s word, never the page’s', S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: t.rows, by: 'someone else', at: 1, src: 'api' }, { by: 'x@y', at: 9 }).by === 'x@y');
ok('refused: no kind, no period, a period backwards, no rows, a day that does not exist',
  !S.cleanUpload({ kind: 'nope', from: t.from, to: t.to, rows: t.rows }) && !S.cleanUpload({ kind: 'terms', rows: t.rows }) && !S.cleanUpload({ kind: 'terms', from: '2026-11-15', to: '2026-11-09', rows: t.rows })
  && !S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: [] }) && !S.cleanUpload({ kind: 'terms', from: '2026-02-31', to: '2026-03-02', rows: t.rows }) && !S.cleanUpload(null));
const dirty = S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: [{ t: 'a', f: 7, ps: -3, sov: 4 }, { t: 'A', f: 1 }, { t: '', f: 1 }, { t: 'x'.repeat(200), f: 'abc' }, null] });
ok('figures are clamped, a repeated or empty term dropped, a long one cut', dirty.rows.length === 2 && dirty.rows[0].f === 1 && dirty.rows[0].ps === 0 && dirty.rows[0].sov === 1 && dirty.rows[1].t.length === 80 && dirty.rows[1].f === null, dirty.rows);
ok('an attribute’s popularity is a count, not capped at 1', S.cleanUpload({ kind: 'attrs', from: t.from, to: t.to, rows: [{ t: 'Color', f: 2340 }] }).rows[0].f === 2340);
ok('rows are capped', S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: Array.from({ length: 900 }, (_, i) => ({ t: 't' + i, f: 0.1 })) }).rows.length === S.MAX_ROWS);
let st = S.mergeUpload(null, up);
st = S.mergeUpload(st, S.cleanUpload({ kind: 'terms', from: '2026-11-16', to: '2026-11-22', rows: t.rows }, { at: 6 }));
st = S.mergeUpload(st, S.cleanUpload({ kind: 'intents', from: t.from, to: t.to, rows: c.rows }, { at: 7 }));
ok('readings are held newest period first', st.up.length === 3 && st.up[0].to === '2026-11-22', st.up.map((x) => x.id));
const again = S.mergeUpload(st, S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: t.rows.slice(0, 2) }, { at: 8 }));
ok('the same kind × period re-uploaded REPLACES its reading', again.up.length === 3 && again.up.filter((x) => x.id === up.id)[0].rows.length === 2);
ok('a daily pull writes the same record, marked api', S.cleanUpload({ kind: 'terms', from: t.from, to: t.to, rows: t.rows }, { src: 'api' }).src === 'api');
const dr = S.dropUpload(st, up.id);
ok('a reading can be dropped; an unknown id drops nothing', dr.removed && dr.up.length === 2 && S.dropUpload(st, 'nope').removed === false);
let big = null; for (let i = 0; i < S.MAX_UPLOADS + 20; i++) { const d = new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10); big = S.mergeUpload(big, S.cleanUpload({ kind: 'terms', from: d, to: d, rows: t.rows })); }
ok('the store is bounded and keeps the newest', big.up.length === S.MAX_UPLOADS && big.up[0].to > big.up[big.up.length - 1].to);
ok('an empty store reads as no readings', S.viewStore(null).length === 0 && S.viewStore(st).length === 3);

// ---- 8. wiring -----------------------------------------------------------------------------------------------
const W_ = read('cloudflare/feedspark-deck/src/worker.js'), P = read('docs/FeedSpark_AIVisibility.html');
ok('the worker serves the engine and imports the store', /path === '\/aivis\/demand\.js'/.test(W_) && /import \* as AIDEMAND from "\.\/aidemand\.js"/.test(W_) && /AIDEMAND_ENGINE_SRC from "\.\.\/\.\.\/\.\.\/docs\/aidemand_engine\.js"/.test(W_));
const blk = W_.slice(W_.indexOf("if (path === '/api/aivis/demand')"), W_.indexOf("if (path === '/api/aivis' && request.method === 'GET' && !client)"));
ok('the route sits inside the scoped /api/aivis block', blk.length > 200 && W_.indexOf("if (path === '/api/aivis/demand')") > W_.indexOf("if (client && !inScope(client)) return json({ ok: false, error: 'out of scope' }, 403);"));
ok('reading is open to a scoped signin, writing needs the grant', blk.indexOf("request.method === 'GET'") < blk.indexOf('if (!granted)') && blk.indexOf('if (!granted)') < blk.indexOf("request.method === 'PUT'") && blk.indexOf('if (!granted)') < blk.indexOf("request.method === 'DELETE'"));
ok('a Meta market is refused and the upload goes through cleanUpload with the server’s stamp', /AIVIS\.aivisMarket\(dm\)/.test(blk) && /AIDEMAND\.cleanUpload\(b && b\.upload, \{ by: who\(request\), at: Date\.now\(\), src: 'upload' \}\)/.test(blk));
ok('the page loads the engine, reads and writes the store', /A\.load\('\/aivis\/demand\.js', 'FeedAiDemand'\)/.test(P) && /\/api\/aivis\/demand/.test(P) && /method: 'PUT'/.test(P));
ok('the page reads the bytes (UTF-16) rather than text', /E\.parseExport\(E\.decode\(new Uint8Array\(buf\)\)\)/.test(P));
ok('a brief opens Workflow in a new tab', /function wfTab\(u\) \{ var w = window\.open\(u, '_blank'\)/.test(P) && !/location\.href\s*=\s*'\/workflow\?brief=/.test(P));
ok('every section folds: the chevron, the device memory, open/fold all, the hash', /fcc-aivis-fold/.test(P) && /id="fold-all"/.test(P) && /aria-expanded/.test(P) && /hashchange/.test(P));
ok('the engine is a Text module by the glob', /\*\*\/\*_engine\.js/.test(read('wrangler.toml')));
['tools/qa_gate.sh', 'tools/presync.sh', '.github/workflows/validate.yml'].forEach((f) => ok(f + ' runs this harness', /test_aidemand\.mjs/.test(read(f))));
ok('presync drives the page', /check_aidemand\.js/.test(read('tools/presync.sh')));

// ---- 9. no client report in git ---------------------------------------------------------------------------------
const mine = ['docs/aidemand_engine.js', 'cloudflare/feedspark-deck/src/aidemand.js', 'tools/check_aidemand.js', 'tools/aivis_stub.js', 'tools/test_aidemand.mjs'].map(read).join('\n');
ok('no figure off a real report is committed (a real export carries 8-decimal shares)', !/0\.\d{8,}/.test(mine.replace(/1e-9/g, '')));
ok('no export file is committed', !fs.readdirSync(path.join(ROOT, 'docs')).some((f) => /AI_shopping_terms/i.test(f)) && !fs.existsSync(path.join(ROOT, 'ops', 'aidemand')));

console.log((fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions' + (fail ? ', ' + fail + ' failed' : ''));
process.exit(fail ? 1 : 0);
