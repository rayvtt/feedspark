#!/usr/bin/env node
/* Golden Record — EACH ACTION-PLAN TASK BRIEFED INTO WORKFLOW AND READ BACK ON THE NEXT AUDIT (Ray, 16 Oct 2026: "within the
   Golden Record action plan, allow each task to be added in Intake/ Workflow and therefore be tracked within the Golden Record
   audit … from the next time the audit is ran again").

   Renders the REAL page against a stubbed FCC: → Brief opens /workflow?brief= with the task's own key (gp), the briefing is
   saved to the team plan before the page leaves, and on the next open the card reads its ticket's stage in Workflow's own
   words (held equal to Workflow's STAGES), a done ticket reads ✓ taken care of, a ticket is tied on its exact task name when it
   carries no stamp (never another brand's), an action the audit no longer raises is listed as closed, ↺ keeps the briefing
   record, and none of it reaches the client copy.

   Run: NODE_PATH=$(npm root -g) node tools/check_grplanbrief.js
*/
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }

const D = path.resolve(__dirname, '..', 'docs');
const PAGE = 'file://' + path.join(D, 'FeedSpark_GoldenRecord.html') + '#Reiss%7Cgb';
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin', 'mpn',
  'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category', 'product_type',
  'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material', 'pattern', 'size_type', 'size_system'];
const COV = { price: 92, gtin: null, mpn: null, material: 30, pattern: 100, sale_price: 100, product_highlight: 100, product_detail: 100 };
const rule = (n, pct) => ({ n, pct, eg: ['EXAMPLE TITLE'] });
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: { title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160, rules: { caps: rule(120, 12) } } },
  ai: { total: 61, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000, pillars: [
    { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4 }, { key: 'titles', label: 'Title anatomy', score: 62, weight: 1.6 },
    { key: 'descriptions', label: 'Descriptions', score: 90, weight: 1.3 }, { key: 'attributes', label: 'Attribute completeness', score: 92, weight: 1.5 },
    { key: 'taxonomy', label: 'Taxonomy depth', score: 41, weight: 1.2 }, { key: 'media', label: 'Media richness', score: 100, weight: 1.0 },
    { key: 'conv', label: 'Conversational attributes', score: 0, weight: 2.4 }, { key: 'detail', label: 'Structured detail', score: 55, weight: 1.2 }] },
};


(async () => {
  console.log('-- one stage vocabulary: the plan reads Workflow\'s own words');
  const wf = fs.readFileSync(path.join(D, 'FeedSpark_Workflow.html'), 'utf8');
  const gr = fs.readFileSync(path.join(D, 'FeedSpark_GoldenRecord.html'), 'utf8');
  const stg = {}; (wf.match(/var STAGES=\[([\s\S]*?)\];/)[1].match(/\['(\w+)','([^']+)'/g) || []).forEach((m) => { const x = m.match(/\['(\w+)','([^']+)'/); stg[x[1]] = x[2]; });
  const gps = eval('(' + gr.match(/var GP_STAGE = (\{[\s\S]*?\});/)[1] + ')');
  ok('GP_STAGE names every Workflow stage exactly as Workflow does', JSON.stringify(Object.keys(stg).sort()) === JSON.stringify(Object.keys(gps).sort()) && Object.keys(stg).every((k) => stg[k] === gps[k]), { wf: stg, gr: gps });
  const ce = fs.readFileSync(path.join(D, 'kwcal_engine.js'), 'utf8');
  const court = eval('(' + ce.match(/var COURT=(\{[\s\S]*?\});/)[1] + ')');
  const gpc = eval('(' + gr.match(/var GP_COURT = (\{[\s\S]*?\});/)[1] + ')');
  ok('GP_COURT is the calendar engine\'s COURT', JSON.stringify(court) === JSON.stringify(gpc), { court, gpc });
  ok('the Workflow composer stamps the tie on the saved ticket and clears it on a fresh draft',
    /if\(window\.__gpId\)\{ b\.gp=window\.__gpId; window\.__gpId=null; \}/.test(wf) && /window\.__gpId=null;/.test(wf.slice(wf.indexOf('function prefill('))) && /if\(j\.gp\)window\.__gpId=String\(j\.gp\)/.test(wf));

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  let landed = null;
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.route((u) => /\/workflow\?brief=/.test(String(u)), (r) => { landed = r.request().url(); r.fulfill({ body: '<html><body>workflow</body></html>', contentType: 'text/html' }); });
  await page.addInitScript(({ ATTRS, QUALITY, COV }) => {
    if (location.protocol !== 'file:') return;
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k) => { const c = k in COV ? COV[k] : 100; cov[k] = c; attrs[k] = c == null ? { present: false } : { present: true, filled: c * 10, cov: c }; });
    const feeds = { 'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] } };
    window.__store = JSON.parse(localStorage.getItem('__store') || '{}');
    window.__briefs = JSON.parse(localStorage.getItem('__briefs') || '{}');
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/briefs')) return j(JSON.parse(JSON.stringify(window.__briefs)));
      if (u.includes('/api/state?ns=grplan')) return j({ grplan: JSON.parse(JSON.stringify(window.__store)) });
      if (u.endsWith('/api/state') && opts && opts.method === 'PUT') {
        const b = JSON.parse(opts.body); if (b.grplan) { window.__store = b.grplan; localStorage.setItem('__store', JSON.stringify(b.grplan)); return j({ grplan: b.grplan }); }
      }
      return j({});
    };
  }, { ATTRS, QUALITY, COV });
  const open = async () => { await page.goto('about:blank'); await page.goto(PAGE); await page.waitForSelector('#ap-tier', { timeout: 15000 }); await page.waitForTimeout(800); };
  const read = () => page.evaluate(() => {
    const t = document.getElementById('ap-tier');
    return { cards: Array.from(t.querySelectorAll('.ap-tk[data-apid]')).map((c) => ({ id: c.getAttribute('data-apid'), t: (c.querySelector('.ap-t') || {}).innerText || '',
        wf: ((c.querySelector('.ap-wf') || {}).innerText || '').replace(/\s+/g, ' ').trim(), br: !!c.querySelector('[data-apbr]') })),
      line: ((t.querySelector('.ap-wfl') || {}).innerText || '').replace(/\s+/g, ' '),
      closed: Array.from(t.querySelectorAll('.ap-closed .ap-rrow')).map((r) => r.innerText.replace(/\s+/g, ' ')) };
  });
  const it = () => page.evaluate(() => ((window.__store['Reiss|gb'] || {}).it) || {});
  const seed = (store, briefs) => page.evaluate(([s, b]) => { localStorage.setItem('__store', JSON.stringify(s)); localStorage.setItem('__briefs', JSON.stringify(b)); localStorage.removeItem('gr-plan-b'); }, [store, briefs]);

  await page.goto(PAGE); await seed({}, {});
  await open();
  console.log('-- before anything is briefed');
  let r = await read();
  ok('every task on the board offers → Brief in Workflow', r.cards.length >= 6 && r.cards.every((c) => c.br && /Brief in Workflow/.test(c.wf)), r.cards.map((c) => c.wf));
  ok('the board says nothing is briefed yet', /No task briefed yet/.test(r.line), r.line);

  console.log('-- → Brief');
  const first = r.cards[0];
  await Promise.all([page.waitForURL(/workflow\?brief=/, { timeout: 8000 }).catch(() => {}), page.click('#ap-tier .ap-tk[data-apid="' + first.id + '"] [data-apbr]')]);
  ok('it opens the Workflow composer through /workflow?brief=', !!landed, landed);
  let pay = null;
  try { const b = new URL(landed).searchParams.get('brief').replace(/-/g, '+').replace(/_/g, '/'); pay = JSON.parse(Buffer.from(b, 'base64').toString('utf8')); } catch (e) {}
  ok('…the brief names the client, the plan task family, and carries the task\'s own key', pay && pay.client === 'Reiss' && /^Golden Record Plan - .+ - Reiss GB - \d{4}$/.test(pay.task) && pay.gp === 'Reiss|gb|' + first.id, pay);
  ok('…its scope says what to do, why, and where it came from', pay && /^Action: /.test(pay.scope) && /Source: Golden Record action plan/.test(pay.scope), pay && pay.scope);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('__store')) || '{}');
  const br = ((stored['Reiss|gb'] || {}).it || {})[first.id];
  ok('…and the briefing was saved to the team plan BEFORE the page left', br && br.br && br.br.task === (pay && pay.task), br);

  console.log('-- back on the audit, no ticket in the pipeline yet (the composer was closed unsaved)');
  await open();
  r = await read();
  let c = r.cards.find((x) => x.id === first.id);
  ok('the card says it is not in the pipeline yet and offers → Brief again', c && /not in the pipeline yet/.test(c.wf) && /Brief again/.test(c.wf), c);

  console.log('-- the ticket saved: the next audit reads its stage');
  const tid = 'REIS-20261016-01';
  await seed(stored, { [tid]: { id: tid, client: 'Reiss', task: pay.task, gp: pay.gp, status: 'briefed', updated: Date.now() } });
  await open();
  r = await read();
  c = r.cards.find((x) => x.id === first.id);
  ok('the card carries the ticket\'s stage in Workflow\'s words and whose court', c && /Briefed to ASPL/.test(c.wf) && /with ASPL/.test(c.wf) && !c.br, c);
  ok('the board counts it: 1 in Workflow, 0 taken care of', /^1 of \d+ tasks? in Workflow · 0 taken care of/.test(r.line), r.line);
  const other = r.cards.find((x) => x.id !== first.id);
  ok('another task is untouched — still offers → Brief', other && other.br, other);

  console.log('-- matched on the task name when a ticket carries no stamp');
  const second = r.cards[1];
  const st2 = JSON.parse(JSON.stringify(stored)); st2['Reiss|gb'].it[second.id] = { br: { at: Date.now(), task: 'Golden Record Plan - by hand - Reiss GB - 1026', t: second.t } };
  await seed(st2, { [tid]: { id: tid, client: 'Reiss', task: pay.task, gp: pay.gp, status: 'done', updated: Date.now() },
    'REIS-2': { id: 'REIS-2', client: 'Reiss', task: 'Golden Record Plan - by hand - Reiss GB - 1026', status: 'progress', updated: Date.now() },
    'SUPE-1': { id: 'SUPE-1', client: 'Superdry', task: 'Golden Record Plan - by hand - Reiss GB - 1026', status: 'confirmed', updated: Date.now() + 5 } });
  await open();
  r = await read();
  c = r.cards.find((x) => x.id === first.id);
  ok('a ticket at Done — ASPL reads ✓ Taken care of', c && /Taken care of/.test(c.wf) && /Done — ASPL/.test(c.wf), c);
  const c2 = r.cards.find((x) => x.id === second.id);
  ok('…the hand-named ticket ties on its exact task name, never another brand\'s', c2 && /In progress/.test(c2.wf) && !/Client confirmed/.test(c2.wf), c2);
  ok('the board counts 2 in Workflow, 1 taken care of', /^2 of \d+ tasks in Workflow · 1 taken care of/.test(r.line), r.line);

  console.log('-- an action the audit no longer raises (the field was fixed)');
  const st3 = JSON.parse(JSON.stringify(st2)); st3['Reiss|gb'].it['a:size_type'] = { br: { at: Date.now(), task: 'Golden Record Plan - Fill size type - Reiss GB - 1026', t: 'Fill g:size_type' } };
  await seed(st3, { 'REIS-3': { id: 'REIS-3', client: 'Reiss', gp: 'Reiss|gb|a:size_type', task: 'x', status: 'confirmed', updated: Date.now() } });
  await open();
  r = await read();
  ok('it is not on the board…', !r.cards.some((x) => x.id === 'a:size_type'));
  ok('…it is listed as closed since it was briefed, with its ticket\'s stage', r.closed.length === 1 && /Fill g:size_type/.test(r.closed[0]) && /Client confirmed/.test(r.closed[0]), r.closed);
  ok('…and the board line counts it', /1 closed since briefed/.test(r.line), r.line);

  console.log('-- ↺ Back to the audit\'s plan keeps the briefing record');
  page.once('dialog', (d) => d.accept());
  await page.click('#ap-reset');
  await page.waitForTimeout(250);
  const kept = await it();
  ok('the briefed tasks keep their stamp; nothing else stays', Object.keys(kept).every((id) => Object.keys(kept[id]).join() === 'br') && kept[first.id] && kept['a:size_type'], kept);

  console.log('-- ✦ SparkAI in place of the FeedSpark pill on what SparkAI generates');
  const pills = await page.evaluate(() => Array.from(document.querySelectorAll('#ap-tier .ap-tk[data-apid]')).map((c) => ({ id: c.getAttribute('data-apid'), own: (c.querySelector('.ap-own') || {}).innerText || '' })));
  const pill = (id) => (pills.find((x) => x.id === id) || {}).own;
  ok('a generated field (g:material) reads ✦ SparkAI', /SparkAI/.test(pill('a:material') || ''), pills);
  ok('a content rewrite (g:title) reads ✦ SparkAI', /SparkAI/.test(pill('q:title') || ''), pills);
  ok('the identifier stays the client\'s team, never SparkAI', /Your team/.test(pill('a:gtin') || ''), pills);
  ok('the conversational attributes read ✦ SparkAI', /SparkAI/.test(pill('ai:conv') || ''), pills);
  ok('…and nothing that is not generated wears it', pills.every((x) => !/SparkAI/.test(x.own) || /^(a|q|ai):(title|description|product_highlight|hl_depth|product_detail|detail_depth|keywords|material|pattern|conv|titles|descriptions|detail|attributes)$/.test(x.id)), pills);
  const cvRule = (gr.match(/\.cv\{[^}]*\}/) || [''])[0];
  ok('the cover follows the body face (no hard-coded Lato on .cv or the ring text)', /font-family:var\(--font-body,Lato\)/.test(cvRule) && !/text-anchor="middle" font-family="Lato/.test(gr), cvRule);

  console.log('-- never in a client file');
  const ph = await page.evaluate(() => { const p = document.getElementById('print-plan'); return p ? p.querySelectorAll('.ap-wf,.ap-br,.ap-wfl,.ap-closed').length : -1; });
  ok('the client copy (#print-plan) carries no ticket, no stage, no → Brief', ph === 0, ph);
  const dm = await page.evaluate(() => { document.body.classList.add('demo'); const w = document.querySelector('#ap-tier .ap-wf'); const v = w && getComputedStyle(w).display; document.body.classList.remove('demo'); return v; });
  ok('demo mode hides the Workflow chips on a screen share', dm === 'none', dm);

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden action plan → Workflow: briefed through the composer, stamped, and read back on the next audit');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
