// THE PAIR SCAN harness (pure node, CI-safe). Ray, 29 Oct 2026, on Matt Rogers' Superdry Pockets deck:
// "review / study / adapt / innovate these types of analysis for clients".
//
// The Pockets method (docs/POCKETS_METHOD.md) scans EVERY pair of attributes and ranks the cuts by how much each
// finds — the step that turns a pivot tool into an analysis. This pins the engine's pairScan/pockets on a SYNTHETIC
// catalogue whose pockets are planted, so every figure the scan reports is checked against a tally this file
// computes ITSELF from the same rows — never against the engine's own arithmetic.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = require('../docs/breakdown_engine.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

let pass = 0, fail = 0;
const t = (n, ok) => { if (ok) { pass++; } else { fail++; console.log('  FAIL ' + n); } };
const near = (a, b, e = 1e-6) => a != null && b != null && Math.abs(a - b) <= e;

// ---- a catalogue with planted pockets ------------------------------------------------------
// 4 categories x 4 colours. Spend and value are set so the account lands near 10.0 ROAS and the
// planted cells sit either side of 0.65x / 1.5x. Clicks and conversions give a second metric
// that disagrees with ROAS on purpose — the whole point of reading both.
const CATS = ['Jackets', 'Trousers', 'Tops', 'Hoodies'];
const COLS = ['Black', 'Navy', 'Green', 'Brown'];
const rows = [], H = ['id', 'cat', 'colour', 'size'];
let n = 0;
for (const c of CATS) for (const k of COLS) {
  // 30 products a cell: past the 25 floor everywhere, so the floors are tested by spend alone
  for (let i = 0; i < 30; i++) rows.push([`p${n++}`, c, k, i % 3 === 0 ? 'S' : i % 3 === 1 ? 'M' : 'L']);
}
const S = B.createStore();
rows.forEach(r => B.addRow(S, r, H));
t('the store holds every planted product', S.n === 16 * 30);

// per-product Google Ads numbers, keyed off the row index so the harness can re-tally them
const cost = [], val = [], clk = [], cnv = [];
for (let r = 0; r < S.n; r++) {
  const cat = rows[r][1], col = rows[r][2];
  let c = 10, ratio = 10;                                   // £10 a product, 10x return = the account
  if (cat === 'Jackets' && col === 'Green') ratio = 4;      // planted WASTE  (0.4x)
  if (cat === 'Trousers' && col === 'Brown') ratio = 20;    // planted STAR   (2.0x)
  if (cat === 'Tops' && col === 'Navy') c = 1;              // under the spend floor: 30 x £1 = £30
  if (cat === 'Tops' && col === 'Brown') ratio = 7;         // INSIDE the band: qualifying at 0.65x, waste if the floor widens
  cost.push(c); val.push(c * ratio);
  // conversion: 10 clicks each at 5%, except one cell that draws clicks and does not convert
  const clicks = 10, cr = (cat === 'Hoodies' && col === 'Black') ? 0.01 : 0.05;
  clk.push(clicks); cnv.push(clicks * cr);
}
const ads = { cost: r => cost[r], value: r => val[r], clicks: r => clk[r], conv: r => cnv[r] };

// ---- the account baseline, tallied here ----------------------------------------------------
const tot = (a) => a.reduce((x, y) => x + y, 0);
const baseRoas = tot(val) / tot(cost), baseCr = tot(cnv) / tot(clk);
const R = B.pairScan(S, { ads, minSpend: 150, minN: 25 });
t('pairScan answers on a feed with spend', R && R.cuts.length > 0);
t('the baseline ROAS is the account, counted here not by the engine', near(R.base.roas, baseRoas, 1e-9));
t('the baseline CR likewise', near(R.base.cr, baseCr, 1e-9));
t('the bands are ratios to the account, never absolutes',
  near(R.cfg.rB.lo, baseRoas * B.PK_LOW, 1e-9) && near(R.cfg.rB.hi, baseRoas * B.PK_HIGH, 1e-9));

// ---- the cat x colour cut, tallied here -----------------------------------------------------
const cell = new Map();
for (let r = 0; r < S.n; r++) {
  const k = rows[r][1] + '|' + rows[r][2], c = cell.get(k) || { n: 0, cost: 0, val: 0, clk: 0, cnv: 0 };
  c.n++; c.cost += cost[r]; c.val += val[r]; c.clk += clk[r]; c.cnv += cnv[r]; cell.set(k, c);
}
let wasteN = 0, wasteSpend = 0, starN = 0, smallN = 0, poorN = 0;
cell.forEach(c => {
  if (c.n < 25 || c.cost < 150) { smallN++; return; }
  const ro = c.val / c.cost, cr = c.cnv / c.clk;
  if (ro < baseRoas * 0.65) { wasteN++; wasteSpend += c.cost; } else if (ro > baseRoas * 1.5) starN++;
  if (cr < baseCr * 0.65) poorN++;
});
t('one cell is planted under the spend floor and is counted small, not judged', smallN === 1);

const cut = R.cuts.find(c => (c.a === 'cat' && c.b === 'colour') || (c.a === 'colour' && c.b === 'cat'));
t('the scan found the category x colour cut', !!cut);
t('…its judged-cell count matches the tally', cut && cut.judged === 16 - smallN);
t('…its small count matches', cut && cut.small === smallN);
t('…its wasted-spend pockets match', cut && cut.roas.waste.n === wasteN && wasteN === 1);
t('…the spend inside them matches, to the penny', cut && near(cut.roas.waste.cost, wasteSpend, 1e-9));
t('…its star pockets match', cut && cut.roas.star.n === starN && starN === 1);
t('…the poor CONVERTERS are counted apart from the ROAS bands', cut && cut.cr.waste.n === poorN && poorN === 1);

// A cut that finds nothing on ROAS can still find plenty on conversion — the two-metric thesis.
t('a cell can be flat on ROAS and poor on conversion at once', (() => {
  const P = B.pockets(S, { f: 'cat', m: 'raw' }, { f: 'colour', m: 'raw' }, { ads, metric: 'cr' });
  const h = P.pockets.find(p => (p.a === 'Hoodies' || p.b === 'Hoodies') && (p.a === 'Black' || p.b === 'Black'));
  return h && h.rb === 0 && h.cb === -1;
})());

// ---- the floors ------------------------------------------------------------------------------
t('raising the spend floor above every cell leaves nothing judged',
  B.pairScan(S, { ads, minSpend: 1e9 }).cuts.every(c => c.judged === 0 && c.roas.found === 0));
t('raising the product floor does the same',
  B.pairScan(S, { ads, minN: 1e6 }).cuts.every(c => c.judged === 0));
t('a floor never turns an unjudged cell into a finding',
  B.pairScan(S, { ads, minSpend: 1e9 }).cuts.every(c => c.roas.waste.n === 0 && c.roas.star.n === 0));

// ---- ranking ----------------------------------------------------------------------------------
t('cuts come back ranked by the spend they find, worst first',
  R.cuts.every((c, i) => i === 0 || R.cuts[i - 1].roas.found >= c.roas.found));
t('ranking on conversion reorders them independently of ROAS', (() => {
  const C = B.pairScan(S, { ads, rank: 'cr' });
  return C.rank === 'cr' && C.cuts.every((c, i) => i === 0 || C.cuts[i - 1].cr.found >= c.cr.found);
})());
t('a tally carries a conversion rate too, as a ratio of sums not a mean of cells', (() => {
  const c = R.cuts.find(x => (x.a === 'cat' && x.b === 'colour') || (x.a === 'colour' && x.b === 'cat'));
  if (!c || !c.roas.waste.n) return false;
  // the planted waste pocket is Jackets x Green: tally its clicks and conversions here
  let k = 0, v = 0;
  for (let r = 0; r < S.n; r++) if (rows[r][1] === 'Jackets' && rows[r][2] === 'Green') { k += clk[r]; v += cnv[r]; }
  return near(c.roas.waste.cr, v / k, 1e-9);
})());
t('every cut carries BOTH metrics, so one is never shipped without the other',
  R.cuts.every(c => c.roas && c.cr && typeof c.roas.found === 'number' && typeof c.cr.found === 'number'));
t('top caps the list without changing its order',
  (() => { const C = B.pairScan(S, { ads, top: 2 }); return C.cuts.length === 2 && C.cuts[0].a === R.cuts[0].a && C.cuts[0].b === R.cuts[0].b; })());

// ---- honest refusals ---------------------------------------------------------------------------
t('no ads reading at all is a refusal, never a zero', B.pairScan(S, {}) === null);
t('a feed with no spend says so rather than inventing bands', (() => {
  const Z = B.pairScan(S, { ads: { cost: () => 0, value: () => 0, clicks: () => 0, conv: () => 0 } });
  return Z.cuts.length === 0 && /no spend/.test(Z.reason || '');
})());
t('a field with one value is never paired', R.fields.every(f => f.values >= 2));
// A cell planted between the bands pins their EDGES, not just the banding logic: it must read
// qualifying at 0.65x and flip to waste the moment the floor is widened.
t('a cell inside the band reads qualifying, and flips when the band widens', (() => {
  const inside = P0 => P0.pockets.find(p => (p.a === 'Tops' || p.b === 'Tops') && (p.a === 'Brown' || p.b === 'Brown'));
  const a = inside(B.pockets(S, { f: 'cat', m: 'raw' }, { f: 'colour', m: 'raw' }, { ads, metric: 'roas' }));
  const b = inside(B.pockets(S, { f: 'cat', m: 'raw' }, { f: 'colour', m: 'raw' }, { ads, metric: 'roas', low: 0.95 }));
  return a && b && a.band === 0 && b.band === -1;
})());

// ---- pockets(): the detail view -----------------------------------------------------------------
const P = B.pockets(S, { f: 'cat', m: 'raw' }, { f: 'colour', m: 'raw' }, { ads, metric: 'roas' });
t('pockets() judges the same cells as the scan', P.pockets.length === 16 - smallN);
t('…and the same waste', P.roas.waste.n === wasteN);
t('…worst first: the wasted-spend pocket leads', P.pockets[0].band === -1);
t('…and it is the planted one',
  (P.pockets[0].a === 'Jackets' || P.pockets[0].b === 'Jackets') && (P.pockets[0].a === 'Green' || P.pockets[0].b === 'Green'));
t('…every judged pocket is past both floors', P.pockets.every(p => p.n >= 25 && p.cost >= 150));
t('…a pocket carries its own counted figures', near(P.pockets[0].roas, P.pockets[0].val / P.pockets[0].cost, 1e-9));

// ---- the method note is committed and holds the thresholds ---------------------------------------
const MD = read('docs/POCKETS_METHOD.md');
t('the method note states the ratio bands the engine uses', /0\.65/.test(MD) && /1\.5/.test(MD));
t('the method note carries no client spend figures', !/£224|£11\.2k|2\.55m|45,077/.test(MD));
t('the engine defaults match the documented method', B.PK_LOW === 0.65 && B.PK_HIGH === 1.5 && B.PK_MIN_N === 25);

// ---- the page carries it ----------------------------------------------------------------------
const PG = read('docs/FeedSpark_Breakdown.html');
t('the page has a Find the cuts section that folds like the rest',
  /id="sec-cuts"/.test(PG) && /aria-controls="sec-cuts"/.test(PG) && /'sec-cuts': 0/.test(PG));
t('…a fresh device opens the pivot, not the scan (the scan needs a Google Ads read first)',
  /'sec-pivot': 1, 'sec-cuts': 0/.test(PG));
t('…it calls the ENGINE, never a second copy of the maths in the page', /B\.pairScan\(S\.st, \{/.test(PG) && !/function pairScan/.test(PG));
t('…the floors and the ranking are the reader\'s to set', /id="ck-n"/.test(PG) && /id="ck-s"/.test(PG) && /id="ck-rank"/.test(PG));
t('…a cut opens in the pivot rather than drawing a second table', /S\.L\.pivot\.r = c\.aSpec/.test(PG) && /reveal\('sec-pivot'\)/.test(PG));
t('…and it re-reads when the Google Ads join lands', /renderFields\(\); renderCuts\(\);/.test(PG));
t('…with no ads read it says so instead of showing an empty table', /Pick a Google Ads measure on the pivot first/.test(PG));
t('…the CSV goes through the page\'s own download helper', /download\(\(\(S\.brand/.test(PG) && !/\bdl\(B\.csv\(out\)/.test(PG));
t('…the ranked column is named for the metric it ranks on', /'Their CR' : 'Their ROAS'/.test(PG));
t('the harness, the gate and CI all run this file',
  /test_pairscan/.test(read('tools/qa_gate.sh')) && /test_pairscan/.test(read('tools/presync.sh')) && /test_pairscan/.test(read('.github/workflows/validate.yml')));

console.log(`\npair scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
