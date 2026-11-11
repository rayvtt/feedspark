/* WORKFLOW TEST REGISTER + RESULTS LAB.
 *
 * Ray, 11 Nov 2026, over a screenshot of the register with its Test column one syllable wide:
 * "test registers has issue - Also find a new interactive, visually impactful way to showcase all
 * the test results and how each of the testing components run in the test and control groups
 * specifically".
 *
 * (1) THE REGISTER: auto layout + a result written as a sentence in a nowrap badge widened Status /
 *     result and crushed Test. Rendered with exactly that row, Test must keep a readable width.
 * (2) THE RESULTS LAB: the register and every brand's A/B archive (/api/abtests, stubbed) read as one
 *     board — every count here is made in the TEST from the stub, never read back off the page.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/check_tstlab.js
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); }
catch (e) { console.log('· playwright not installed — test lab tripwire skipped'); process.exit(0); }
const ROOT = path.resolve(__dirname, '..'), PORT = 8879, U = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };

const LONG = 'Test group with keyword optimisation saw +4.63% impressions and +5.18% clicks over the control group across the whole fortnight of the run';
const TESTS = [
  { client: 'YuMOVE', name: 'Benefit copy in titles', hypo: 'Benefit-led beats feature-led', skus: 'FP range', readout: '', status: 'done', result: '+24.7%' },
  { client: 'Superdry', name: 'US: Short (AI) description vs. Long description AB Test', hypo: '', skus: '', start: '2026-10-01', readout: '2099-12-31', status: 'running', result: '' },
  { client: 'Reiss', name: 'Silk titles', hypo: 'MASK lifts CTR', skus: '', readout: '', status: 'done', result: LONG }];
const ARCH = {
  Reiss: [
    { country: 'UK', method: 'A/B Test', type: 'Title Test', live: '18/03/2026', reportDate: '01/04/2026', metrics: { impressions: -8, clicks: -5.2 }, verdict: 'negative',
      winner: { group: 'control', label: 'Without Item Type Descriptor', how: 'prose' }, groups: { control: 'Without Item Type Descriptor', test: 'With Item Type Descriptor' },
      report: 'The control group (without item type descriptor) is stronger performance.' }],
  Schuh: [
    { country: 'UK', method: 'Single Group', type: 'Keyword', live: '01/05/2026', reportDate: '20/05/2026', metrics: { impressions: 12, clicks: 18, conversions: 9 },
      verdict: 'positive', winner: null, groups: null, report: 'Up after launch.' },
    { country: 'IE', method: 'A/B Test', type: 'Titles [attribute] placement', typeName: 'Titles Brand placement', attr: 'Brand', live: '01/06/2026', reportDate: '', metrics: {}, verdict: 'unknown', winner: null,
      groups: { control: 'Without Colour', test: 'With Colour' }, report: 'Inconclusive, shared on the call.' }] };
// independent expectations, from the stub
const FIGS = 1 + 2 /* register: 24.7 | 4.63 imp + 5.18 clk */ + 2 + 3;
const N = TESTS.length + ARCH.Reiss.length + ARCH.Schuh.length;   // 6
const EXP = { test: 3 /* benefit, silk, schuh single(up) */, control: 1, none: 1, running: 1 };

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x'), p = u.pathname;
  const send = (o, h) => { r.writeHead(200, Object.assign({ 'content-type': 'application/json' }, h || {})); r.end(JSON.stringify(o)); };
  if (p === '/kwcal') { r.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); return r.end(fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_KWCal.html'))); }
  if (p === '/feedlab/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end(fs.readFileSync(path.join(ROOT, 'docs/feedlab_engine.js'))); }
  if (p === '/kwcal/engine.js') { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end(fs.readFileSync(path.join(ROOT, 'docs/kwcal_engine.js'))); }
  if (p === '/api/tests') return q.method === 'PUT' ? send({ ok: true }) : send(TESTS);
  if (p === '/api/abtests') { const c = u.searchParams.get('client'); return send(ARCH[c] ? { ok: true, client: c, tests: ARCH[c] } : { ok: false, error: 'no_plan_sheet', tests: [] }); }
  if (p === '/api/access') return send({ ok: true, clients: null, modules: null, owner: true, name: 'Ray', ownerName: 'Ray' });
  if (p === '/api/briefs' || p === '/api/state' || p === '/api/kwcal') return send({}, { 'X-Sync-Base': '1' });
  return send({ ok: true });
});

(async () => {
  await new Promise(s => srv.listen(PORT, '127.0.0.1', s));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1150, height: 1000 } });
  const pg = await ctx.newPage(); pg.on('pageerror', e => { fail++; console.log('  ✗ pageerror ' + e.message); });
  const open = async () => { await pg.goto(U + '/kwcal'); await pg.waitForTimeout(3500);
    await pg.evaluate(() => { const s = document.getElementById('kw-tests'); if (s.classList.contains('folded')) document.getElementById('kwt-tog').click(); });
    await pg.waitForTimeout(1500); };
  await open();

  console.log('\n-- the register lives on the Keyword calendar, and folds --');
  ok('a fresh device opens the calendar with the register folded … and the open above was a click', await pg.evaluate(() => document.getElementById('kwt-tog').getAttribute('aria-expanded')) === 'true');
  ok('the open is kept on this device', await pg.evaluate(() => localStorage.getItem('fcc-kw-tests-open')) === '1');

  console.log('\n-- the results lab is the default view --');
  ok('the section opens on the Results lab', await pg.evaluate(() => document.getElementById('kw-tests').getAttribute('data-tv')) === 'lab');
  const L = await pg.evaluate(() => ({
    cards: document.querySelectorAll('#lab-cards .lab-card').length,
    dots: document.querySelectorAll('#lab-field circle[data-ld]').length,
    kpi: [...document.querySelectorAll('#lab-kpis .lab-k b')].map(x => +x.textContent),
    verd: [...document.querySelectorAll('.lab-verd')].map(x => x.textContent),
    regShown: getComputedStyle(document.getElementById('tst-reg')).display !== 'none' }));
  ok('one card per test, register AND archive', L.cards === N, L.cards);
  ok('one dot per figure the reports carry', L.dots === FIGS, L.dots);
  ok('the KPIs: tests · test won · control won · no call · running', JSON.stringify(L.kpi) === JSON.stringify([N, EXP.test, EXP.control, EXP.none, EXP.running]), L.kpi);
  ok('the register table is not drawn under the lab', !L.regShown);

  console.log('\n-- each card shows the two groups --');
  const C = await pg.evaluate(() => {
    const card = id => document.getElementById('lab-' + id);
    const rs = card('a0|Reiss'), sg = card('a0|Schuh'), nc = card('a1|Schuh'), run = card('r1');
    const lanes = el => [...el.querySelectorAll('.lab-lane')].map(l => ({ g: l.querySelector('.g').textContent, d: l.querySelector('.d').textContent, won: l.classList.contains('won') }));
    return { rs: lanes(rs), rsVals: [...rs.querySelectorAll('.lab-m .v')].map(v => v.textContent),
      rsBars: [...rs.querySelectorAll('.lab-m')].map(m => [...m.querySelectorAll('.b')].map(x => x.getBoundingClientRect().width)),
      sg: lanes(sg), ncTxt: nc.querySelector('.lab-none') && nc.querySelector('.lab-none').textContent,
      ncBars: nc.querySelectorAll('.lab-m').length, run: run && run.querySelector('.lab-run .tx').textContent };
  });
  ok('the control lane is named by what sets it apart, and it WON', C.rs[0].g === 'Control group' && C.rs[0].d === 'Without Item Type Descriptor' && C.rs[0].won, C.rs);
  ok('the test lane is named too, and did not win', C.rs[1].d === 'With Item Type Descriptor' && !C.rs[1].won, C.rs);
  ok('each metric prints the report’s own figure', JSON.stringify(C.rsVals) === JSON.stringify(['−8%', '−5.2%']), C.rsVals);
  ok('…and a test bar SHORTER than its control bar when the test group did worse', C.rsBars.every(p => p[1] < p[0]), C.rsBars);
  ok('a one-group run reads baseline against measured, never control against test', C.sg[0].g === 'Baseline' && C.sg[1].g === 'Measured', C.sg);
  ok('a test with no figure says so and draws no bar', /No figure/.test(C.ncTxt || '') && C.ncBars === 0, C.ncTxt);
  ok('a running test shows how far it is to its analysis', /Analysis in \d+ days/.test(C.run || ''), C.run);

  console.log('\n-- the filters --');
  await pg.click('[data-lb="Schuh"]'); await pg.waitForTimeout(200);
  ok('a brand chip narrows the cards to that brand', await pg.evaluate(() => document.querySelectorAll('#lab-cards .lab-card').length) === 2);
  await pg.click('[data-lb="*"]'); await pg.click('[data-lo="control"]'); await pg.waitForTimeout(200);
  ok('an outcome chip narrows to that outcome', await pg.evaluate(() => [...document.querySelectorAll('.lab-verd')].every(v => v.textContent === 'Control group won') && document.querySelectorAll('.lab-card').length === 1));
  await pg.click('[data-lo="*"]'); await pg.fill('#lab-q', 'silk'); await pg.waitForTimeout(200);
  ok('the search finds a test by its name', await pg.evaluate(() => document.querySelectorAll('.lab-card').length) === 1);
  await pg.fill('#lab-q', ''); await pg.waitForTimeout(200);

  console.log('\n-- a dot opens its test --');
  const dot = await pg.$('#lab-field circle[data-ld="a0|Reiss"]');
  await dot.hover(); await pg.waitForTimeout(150);
  ok('hovering a dot names the test, the metric and both groups', /Reiss.*Title Test[\s\S]*With Item Type Descriptor against Without Item Type Descriptor/.test(await pg.evaluate(() => document.getElementById('lab-tip').textContent)));
  await dot.click(); await pg.waitForTimeout(250);
  ok('clicking it flags its card', await pg.evaluate(() => document.getElementById('lab-a0|Reiss').classList.contains('flash')));

  console.log('\n-- the attribute, the completed date, the order --');
  const A = await pg.evaluate(() => { const c = document.getElementById('lab-a1|Schuh'), r = document.getElementById('lab-a0|Reiss'), run = document.getElementById('lab-r1');
    return { nm: c.querySelector('.lab-nm').textContent, at: c.querySelector('.lab-at') && c.querySelector('.lab-at').textContent,
      done: r.querySelector('.lab-dt').textContent, run: run.querySelector('.lab-dt').textContent }; });
  ok('the [attribute] in the test type is filled from the report', A.nm === 'Titles Brand placement · IE', A.nm);
  ok('…and the attribute tested is its own field on the card', /Tested · Brand/.test(A.at || ''), A.at);
  ok('the day a test was completed is its own field', /Completed 1 Apr 26/.test(A.done), A.done);
  ok('a running test is never given a completed date', /Not completed yet/.test(A.run), A.run);
  await pg.selectOption('#lab-sort', 'new'); await pg.waitForTimeout(200);
  ok('Newest completed first puts the latest completion first', await pg.evaluate(() => document.querySelector('#lab-cards .lab-card').id) === 'lab-a0|Schuh');
  await pg.selectOption('#lab-sort', 'move'); await pg.waitForTimeout(200);

  console.log('\n-- brands shown --');
  await pg.click('#lab-bv-sum'); await pg.uncheck('[data-bvb="Schuh"]'); await pg.waitForTimeout(250);
  const H = await pg.evaluate(() => ({ cards: document.querySelectorAll('#lab-cards .lab-card').length, dots: document.querySelectorAll('#lab-field circle[data-ld]').length,
    chip: !!document.querySelector('[data-lb="Schuh"]'), kpi: +document.querySelector('#lab-kpis .lab-k b').textContent, sum: document.getElementById('lab-bv-sum').textContent }));
  ok('a hidden brand leaves the cards', H.cards === N - 2, H.cards);
  ok('…the dot field', H.dots === FIGS - 3, H.dots);
  ok('…the brand chips and the counts', !H.chip && H.kpi === N - 2, H);
  ok('the control says how many brands are shown', /3 of 4/.test(H.sum), H.sum);
  await open();
  ok('hiding a brand is kept on this device', await pg.evaluate(() => document.querySelectorAll('#lab-cards .lab-card').length) === N - 2);
  await pg.click('#lab-bv-sum'); await pg.click('[data-bva="1"]'); await pg.waitForTimeout(250);
  ok('Show all brings every brand back', await pg.evaluate(() => document.querySelectorAll('#lab-cards .lab-card').length) === N);

  console.log('\n-- the register --');
  await pg.click('#tv-reg'); await pg.waitForTimeout(300);
  const R = await pg.evaluate(() => { const ths = [...document.querySelectorAll('.tstbl thead th')];
    const silk = [...document.querySelectorAll('#tests-body tr')].find(t => /Silk/.test(t.textContent));
    return { test: ths[1].getBoundingClientRect().width, res: ths[5].getBoundingClientRect().width,
      tbl: document.querySelector('.tstbl').getBoundingClientRect().width, frame: document.getElementById('tst-reg').clientWidth,
      badge: silk.querySelector('.tst-badge').textContent, wrapped: !!silk.querySelector('.tst-res-txt') }; });
  ok('with a result written as a sentence, Test keeps a readable width', R.test >= 180, R.test);
  ok('…and the table fits its frame rather than running past it', R.tbl <= R.frame + 1, R);
  ok('the badge carries the headline figure, the sentence wraps beneath it', R.badge === '+4.63%' && R.wrapped, R);
  await pg.goto(U + '/kwcal'); await pg.waitForTimeout(3500);
  ok('the view picked is kept on this device', await pg.evaluate(() => document.getElementById('kw-tests').getAttribute('data-tv')) === 'reg');

  console.log('\n-- negative control: the register as it was (auto layout, nowrap result) --');
  await pg.evaluate(() => { const st = document.createElement('style'); st.textContent = '.tstbl{table-layout:auto!important}.tst-badge{max-width:none!important}.tst-res-txt{display:none!important}'; document.head.appendChild(st);
    document.querySelectorAll('#tests-body .tst-badge.win').forEach(b => { b.textContent = b.getAttribute('title'); }); });
  const NW = await pg.evaluate(() => { const s = document.getElementById('kw-tests'); if (s.classList.contains('folded')) document.getElementById('kwt-tog').click();
    return document.querySelectorAll('.tstbl thead th')[1].getBoundingClientRect().width; });
  ok('the old rules crush Test — so the width check above can really fail', NW < 180, NW);

  await b.close(); srv.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' assertions passed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('✗ ' + e.stack); process.exit(1); });
