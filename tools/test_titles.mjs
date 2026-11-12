// TITLE LAB harness (pure node, CI-safe). Ray, 12 Nov 2026: "a new module just for the title. The audit will compare
// the master feed to the output feed, showing the state of the title and how the title mask looks … if material
// appears in the title, it must also appear in the material field".
//
// Pins the browser engine (docs/titlelab_engine.js) on SYNTHETIC titles shaped like the real ones — finding each of
// the eight attributes, the mask, the title-against-field check, before/after kinds, provenance, the packed list
// record, the summary and the story — then runs the whole synthetic Northwind set of tools/titles_stub.js through the
// REAL Feed Lab parser and Catalogue engine (the join the page makes) against counts the stub's own rules give; and
// the wiring: route, registries, nav, stub + gates, docs, no client data.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { MODULES, MODULE_PATHS } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
const require = createRequire(import.meta.url);
const T = require('../docs/titlelab_engine.js');
const E = require('../docs/catalog_engine.js');
const FA = require('../docs/feedlab_engine.js');
const STUB = require('./titles_stub.js');
const { covered } = require('./check_textmodules.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), PG = read('docs/FeedSpark_Titles.html'), TX = read('docs/FeedSpark_Transformation.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + (typeof why === 'string' ? why : JSON.stringify(why)) : '')); } };

// ---- the engine on hand-made sides ------------------------------------------------------------------------------------
const F = (o) => { const f = {}; T.KEYS.forEach((k) => { f[k] = { f: (o[k] || [])[0] || '', m: (o[k] || [])[1] || '', mh: '' }; }); return f; };
const side = (id, before, after, o, mtext) => ({ id, before, after, src: before ? 'master' : '', bh: 'title', f: F(o), mtext: mtext || '', img: '', opt: null });
const A = side('a1', 'Midi Dress Navy', 'Northwind Women’s Navy Floral Cotton Midi Dress, Size 12',
  { brand: ['Northwind', 'Northwind'], type: ['Womens > Dresses > Midi Dresses', ''], pattern: ['Floral'], material: ['Cotton'], color: ['Navy', 'Navy'], size: ['12'], gender: ['female'], age_group: ['adult'] }, 'Midi Dress Navy Northwind 100% cotton');
const B = side('b1', 'Kids Rain Jacket', 'Kids Rain Jacket', { brand: ['Northwind'], type: ['Kids > Jackets'], color: ['Yellow'], age_group: ['kids'], gender: ['unisex'] });
const C = side('c1', 'Jumper Grey', 'Northwind Grey Wool Jumper', { brand: ['Northwind'], type: ['Womens > Knitwear > Jumpers'], color: ['Charcoal', 'Grey'], material: [''] });
const D = side('d1', '', 'Northwind Striped Linen Shirt', { brand: ['Northwind'], type: ['Mens > Shirts'], pattern: ['Striped'], material: ['Linen'] });
const V = T.vocabNew();
// a vocabulary needs a value on three products before it is trusted
[A, A, A, B, C, D, D, D, side('w1', '', 'x', { material: ['Wool'] }), side('w2', '', 'x', { material: ['Wool'] }), side('w3', '', 'x', { material: ['Wool'] })].forEach((s) => T.vocabAdd(V, s));
T.vocabSeal(V);

console.log('· the eight attributes, the mask');
{
  t('eight attributes in the order Ray named them', T.KEYS.join(',') === 'brand,type,pattern,material,color,size,age_group,gender');
  const r = T.readTitle(A.after, A.f, V, { side: 'f' });
  t('every attribute the title names is found', ['brand', 'gender', 'color', 'pattern', 'material', 'type', 'size'].every((k) => r.found[k]), Object.keys(r.found));
  t('the mask is the attributes in the order the title says them', r.sig === 'brand>gender>color>pattern>material>type>size', r.sig);
  t('a span is the title’s own words, where they sit', r.spans.every((s) => A.after.slice(s.s, s.e) === s.v) && r.spans.some((s) => s.k === 'type' && s.v === 'Midi Dress'), r.spans);
  t('the item type is the last level of the product type, singular or plural', r.found.type.v === 'Midi Dress');
  t('an age group nobody wrote into the title reads absent', !r.found.age_group);
  const b = T.readTitle(A.before, A.f, V, { side: 'm' });
  t('the master title has its own, shorter mask', b.sig === 'type>color', b.sig);
  const k = T.readTitle(B.after, B.f, V, { side: 'f' });
  t('“Kids” is read as an age group; words that are none of the eight are the product name', !!k.found.age_group && k.mask.indexOf('name') >= 0, k.sig);
  t('a title naming nothing still has a mask of its name', T.readTitle('Lovely Thing', F({}), V, { side: 'f' }).sig === 'name');
  t('the product name is ONE part of a mask however many attribute words sit inside it', T.readTitle('Northwind Sue Navy Bow Jumper Soft', F({ brand: ['Northwind'], color: ['Navy'], type: ['Jumpers'] }), V, { side: 'f' }).sig === 'brand>name>color>type');
  t('the mask in words', T.maskLabel('brand>color>type') === 'Brand + Colour + Item type' && T.maskLabel('') === 'no attribute found');
}

console.log('· the title against its field');
{
  const ra = T.read(A, V), rc = T.read(C, V);
  t('a value in the title and in the field agrees', ra.chk.material === 'agree' && ra.chk.color === 'agree' && ra.chk.brand === 'agree' && ra.chk.type === 'agree', ra.chk);
  t('a field value the title leaves out is “in the field, not in the title”', ra.chk.age_group === 'field_only');
  t('MATERIAL IN THE TITLE, NOT IN THE FIELD (Ray’s example) is caught', rc.chk.material === 'title_only', rc.chk);
  t('a title colour the field says differently is a difference', rc.chk.color === 'differ', rc.chk);
  t('neither side naming it is nothing at all', rc.chk.pattern === 'none');
  t('the same word inflected is not a difference (Printed / Print, Striped / Stripe) — another word is', T.check('pattern', 'Print', { v: 'Printed', via: 'vocab' }) === 'agree' && T.check('pattern', 'Stripe', { v: 'Striped', via: 'vocab' }) === 'agree' && T.check('pattern', 'Plain', { v: 'Floral', via: 'vocab' }) === 'differ');
  t('gender agrees through its synonym (Women’s ↔ female)', ra.chk.gender === 'agree');
  t('a child word agrees with any child age band and differs only from adult', T.check('age_group', 'toddler', { v: 'Girls', canon: 'kids' }) === 'agree' && T.check('age_group', 'adult', { v: 'Girls', canon: 'kids' }) === 'differ');
}

console.log('· before → after');
{
  const ra = T.read(A, V), rb = T.read(B, V), rd = T.read(D, V);
  t('a title that gained attributes is “added”, naming which', ra.kind === 'added' && ['brand', 'gender', 'pattern', 'material', 'size'].every((k) => ra.added.indexOf(k) >= 0) && !ra.removed.length, ra);
  t('an identical title is unchanged', rb.kind === 'same');
  t('no before title is never counted as a rewrite', rd.kind === 'nobefore' && rd.b === null);
  t('same attributes in another order is re-ordered; other words is reworded',
    T.read(side('x', 'Navy Northwind Jumper', 'Northwind Navy Jumper', { brand: ['Northwind'], color: ['Navy'], type: ['Jumpers'] }), V).kind === 'reordered' &&
    T.read(side('y', 'Northwind Navy Jumper', 'Northwind Navy Jumper Soft', { brand: ['Northwind'], color: ['Navy'], type: ['Jumpers'] }), V).kind === 'reworded');
  t('a dropped attribute is “removed”', T.read(side('z', 'Northwind Navy Jumper', 'Navy Jumper', { brand: ['Northwind'], color: ['Navy'], type: ['Jumpers'] }), V).kind === 'removed');
  t('where a value came from: the client’s own row, or populated', ra.prov.material === 'source' && ra.prov.pattern === 'populated' && ra.prov.color === 'source', ra.prov);
  t('a short value is never “found” in the master row by accident (a size in an ID)', T.read(side('s', 'Dress', 'Dress, Size M', { type: ['Dresses'], size: ['M'] }, 'M-100 Dress'), V).prov.size === 'populated');
}

console.log('· the packed record, the summary, the story');
{
  const masks = T.masksNew(), rows = [A, B, C, D].map((s) => T.lite(T.read(s, V), masks));
  t('every check survives the packing', T.KEYS.every((k, i) => T.chkOf(rows[2].c, i) === T.read(C, V).chk[k]));
  const S = T.summary(rows, masks);
  t('titles, those with a before, those rewritten', S.n === 4 && S.before === 3 && S.changed === 2, [S.n, S.before, S.changed]);
  t('the kinds add up to the titles', Object.values(S.kinds).reduce((a, b) => a + b, 0) === 4);
  t('to look at counts title-only and differ, never field-only', S.issueRows === 1 && S.issues === 2, [S.issueRows, S.issues]);
  t('per attribute: in titles before and after, and how many gained it', S.attr.material.a === 3 && S.attr.material.b === 0 && S.attr.material.added === 2, S.attr.material);
  t('masks ranked, shares of the whole', S.masksA.length === 4 && Math.abs(S.top3 - 0.75) < 1e-9 && S.masksB.length >= 1, S.masksA);
  const st = T.story(S, { brand: 'Northwind', market: 'GB' });
  t('the story leads with the brand, states the rewrite and the gaps, and names no figure it did not count', /^Northwind GB: 4 titles read, 3 set against/.test(st[0]) && st.some((x) => /2 of 3 titles \(66\.7%\) were rewritten/.test(x)) && st.some((x) => /Material — 1 in the title but not in the field/.test(x)), st);
  t('a before read from the stamp is never called the master feed', /original title FeedSpark stamps/.test(T.story(S, { before: 'stamp' })[0]) && !/master feed carries/.test(T.story(S, { before: 'stamp' })[0]));
  t('an empty read says so', /no titles read yet/.test(T.story(T.summary([], T.masksNew()), {})[0]));
  t('a feed with no before says nothing is compared', /nothing is compared with a before/.test(T.story(T.summary([T.lite(T.read(D, V), T.masksNew())], T.masksNew()), {})[0]));
}

// ---- auto-learn: the screenshot Ray sent, and what a person can teach ----------------------------------------------
console.log('· the item type is found up the tree; what a person teaches holds everywhere it fits');
{
  const SH = side('s1', 'Geox Black Casey MJ Girls Youth Shoes', 'Geox Black Casey Girls Youth Shoes, Size: 13',
    { brand: ['Geox', 'Geox'], type: ['Kids > Girls > Shoes > Geox', 'Girls > Girls Youth'], color: ['Black', 'Black'], size: ['13', 'UK 13 (EU 32)'], age_group: ['kids'], gender: ['Female', 'female'], material: ['Leather'] });
  const V0 = T.vocabNew(); T.vocabSeal(V0);
  const r = T.read(SH, V0);
  t('“Youth” is the age group, never the item type (Ray’s screenshot)', r.a.found.age_group && r.a.found.age_group.v === 'Youth' && r.a.found.type.v === 'Shoes', r.a.found);
  t('a tree whose leaf is the brand names the item one level up — and it agrees with the product type', r.chk.type === 'agree' && r.a.sig === 'brand>color>name>gender>age_group>type>size', [r.chk.type, r.a.sig]);
  t('a level that only says who it is for (Girls Youth) is no item type', T.parts('type', 'Girls > Girls Youth').length === 0 && T.parts('type', 'Kids > Girls > Shoes > Geox').some((w) => w.join(' ') === 'shoe'));
  const V1 = T.vocabNew(); T.vocabSeal(V1); T.vocabTeach(V1, [{ w: 'Casey', a: 'pattern' }]);
  const r1 = T.read(SH, V1);
  t('a taught word is read as that attribute, marked as taught', r1.a.found.pattern && r1.a.found.pattern.via === 'taught' && r1.chk.pattern === 'title_only' && r1.a.spans.some((x) => x.k === 'pattern' && x.via === 'taught'));
  T.vocabTeach(V1, [{ w: 'Casey', a: 'pattern' }, { ok: 1, a: 'pattern', t: 'casey', f: '' }]);
  t('an accepted pair is not a gap', T.read(SH, V1).chk.pattern === 'agree');
  T.vocabTeach(V1, [{ w: 'Shoes', a: 'name' }]);
  t('a word taught as the product name is nobody’s attribute', !T.read(SH, V1).a.found.type && T.read(SH, V1).chk.type === 'field_only');
  T.vocabTeach(V1, [{ w: 'Casey', a: 'pattern' }, { w: 'casey', a: 'name' }]);
  t('a later rule wins (the brand’s own over every brand’s), case and plural blind', !T.read(SH, V1).a.found.pattern);
  T.vocabTeach(V1, [{ w: 'Girls Youth', a: 'age_group' }]);
  t('a taught phrase is taken whole', T.read(SH, V1).a.found.age_group.v === 'Girls Youth');
  t('a rule naming no attribute, or no word, is dropped', T.teachNew([{ w: 'x', a: 'colourway' }, { w: '', a: 'color' }, null, { ok: 1, a: 'nope', t: 'a', f: 'b' }]).n === 0);
  t('the two shared-state namespaces exist: one brand’s rules, every brand’s', /titleteach:\s+'key',/.test(read('cloudflare/feedspark-deck/src/sharedstate.js')) && /titleteachall:\s+null,/.test(read('cloudflare/feedspark-deck/src/sharedstate.js')));
}

// ---- the whole synthetic set through the real parser + the Catalogue's join ----------------------------------------------
console.log('· the Northwind set, joined as the page joins it');
{
  const d = STUB.build(), P = STUB.products(), prods = [], ix = new Map();
  let pl = null, n = 0;
  const xp = FA.createXmlParser((row, h) => { if (!pl) { pl = E.outPlan(h || row); n = (h || row).length; return; } if (h && h.length !== n) { pl = E.outPlan(h); n = h.length; } const p = E.outRow(pl, row); if (p.id) { ix.set(E.idKey(p.oid), prods.length); prods.push(p); } });
  xp.push(d.xml); xp.end();
  const sn = E.sniff(d.csv.slice(0, 20000)), mrows = []; let hdr = null;
  const mp = E.delimParser(sn.delim, (r) => { if (!hdr) hdr = r; else mrows.push(r); }, sn); mp.push(d.csv); mp.end();
  const plan = E.plan(hdr), j = E.detectJoin(plan, mrows, new Set(ix.keys())), by = new Map();
  mrows.forEach((r) => { const i = ix.get(E.idKey(r[j.col])); if (i != null) by.set(i, E.masterCells(r)); });
  t('every product joins its master row on the id column', prods.length === STUB.N && by.size === STUB.N && j.h === 'id', [prods.length, by.size, j.h]);
  const V2 = T.vocabNew(), sides = prods.map((p, i) => T.sides(E, p, by.get(i), plan));
  sides.forEach((s) => T.vocabAdd(V2, s)); T.vocabSeal(V2);
  const masks = T.masksNew(), recs = sides.map((s) => T.read(s, V2)), S = T.summary(recs.map((r) => T.lite(r, masks)), masks);
  t('before is the master title, after the shopping title', sides.every((s, i) => s.before === P[i].before && s.after === P[i].after && s.src === 'master'));
  const same = P.filter((p) => p.same).length;
  t('unchanged and rewritten equal the stub’s own rule', S.kinds.same === same && S.changed === STUB.N - same && S.kinds.added === STUB.N - same, S.kinds);
  t('material in the title, not in the field: the products the stub left without g:material', S.attr.material.chk.title_only === P.filter((p) => !p.same && !p.fieldMat).length, S.attr.material.chk);
  t('colour differs on the one product whose field says another colour', S.attr.color.chk.differ === 1 && recs[7].chk.color === 'differ');
  const full = P.filter((p) => !p.same && p.pat).length;
  t('the top mask is the full one, on every rewritten title with a pattern', S.masksA[0].sig === 'brand>gender>color>pattern>material>type>size' && S.masksA[0].n === full, S.masksA[0]);
  t('every master title has the one mask', S.masksB.length === 1 && S.masksB[0].sig === 'type>color' && S.masksB[0].n === STUB.N);
  t('without the master, before falls back to FeedSpark’s original-title stamp and says so', (() => { const s = T.sides(E, prods[0], null, null); return s.before === P[0].before && s.src === 'stamp'; })());
}

// ---- wiring ----------------------------------------------------------------------------------------------------------
console.log('· route, registries, nav, gates, docs');
{
  t('the page and its engine are imported and served', /import TITLES_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Titles\.html"/.test(WK) && /'\/titles':\s+\{ html: TITLES_PAGE, slug: 'titles' \}/.test(WK) && /path === '\/titles\/engine\.js'[\s\S]{0,120}TITLES_ENGINE_SRC/.test(WK));
  t('the engine is bundled as text, not as a module', covered('titlelab_engine.js'));
  t('a grantable module with its page path', MODULES.some((m) => m.slug === 'titles' && m.path === '/titles') && MODULE_PATHS['/titles'] === 'titles');
  t('on the migration board, its twin and the assessment', MIG_SEED.some((m) => m.p === '/titles') && /\{p:'\/titles',n:'Title Lab'/.test(TX) && /\{id:'titles',p:'\/titles'/.test(TX));
  const pages = fs.readdirSync(new URL('../docs', import.meta.url)).filter((f) => /\.html$/.test(f) && read('docs/' + f).indexOf('id="tb-modules"') >= 0);
  t('the nav link is on every nav-bearing page, lit only on its own', pages.length >= 28 && pages.every((f) => { const s = read('docs/' + f), on = /<a href="\/titles" class="tbm on"/.test(s); return /<a href="\/titles" class="tbm/.test(s) && on === (f === 'FeedSpark_Titles.html'); }));
  t('the page loads the three engines and reads the Catalogue’s lanes — the only thing it writes is what the team taught it', ['/feedlab/engine.js', '/catalog/engine.js', '/titles/engine.js', '/api/catalog/roster', '/api/catalog/master/file', '/api/feed/proxy'].every((u) => PG.indexOf(u) >= 0) && (PG.match(/method: 'PUT'/g) || []).length === 1 && /fetch\('\/api\/state', \{ method: 'PUT'/.test(PG));
  t('built on the shared stylesheet', PG.indexOf('<link rel="stylesheet" href="/design/fcc.css">') >= 0);
  t('every section folds: seven tiles, aria-expanded, Open/Fold all, per device', (PG.match(/<section class="sec[^"]*" id="sec-/g) || []).length === 7 && (PG.match(/class="sec-h" type="button" aria-expanded/g) || []).length === 7 && /id="foldall"/.test(PG) && /fcc-tl-fold/.test(PG));
  t('a brief opens Workflow in a new tab', /function wfTab\(u\) \{ var w = window\.open\(u, '_blank'\)/.test(PG) && /wfTab\('\/workflow\?brief='/.test(PG) && !/location\.href = '\/workflow/.test(PG));
  const QA = read('tools/qa_gate.sh'), PS = read('tools/presync.sh'), VY = read('.github/workflows/validate.yml'), CM = read('tools/check_mobile.js'), CD = read('tools/check_darkmode.js'), MF = read('docs/feature_manifest.json'), CL = read('CLAUDE.md');
  t('the harness runs in qa_gate, presync and validate; the tripwire in presync', /node tools\/test_titles\.mjs/.test(QA) && /node tools\/test_titles\.mjs/.test(PS) && /node tools\/check_titles\.js/.test(PS) && /run: node tools\/test_titles\.mjs/.test(VY));
  t('the phone and dark-mode tripwires are fed the synthetic set', /TITLES_STUB/.test(CM) && /TITLES_STUB/.test(CD));
  t('docs/TITLES.md, the CLAUDE.md entry and the manifest markers are in', fs.existsSync(new URL('../docs/TITLES.md', import.meta.url)) && /^GET  \/titles /m.test(CL) && (MF.match(/"name": "Title Lab: /g) || []).length >= 5);
  t('no client is named in the engine, the stub or the page', ['Reiss', 'Superdry', 'Monsoon', 'Schuh', 'Accessorize', 'Hobbycraft', 'YuMOVE'].every((b) => read('docs/titlelab_engine.js').indexOf(b) < 0 && read('tools/titles_stub.js').indexOf(b) < 0 && PG.indexOf(b) < 0));
}

console.log('\nRESULT: ' + (fail ? 'FAIL — ' + fail + ' failed, ' : 'PASS — ') + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
