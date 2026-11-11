#!/usr/bin/env node
/* Golden Record — ✎ EDIT THE CLIENT REPORT (Ray, 15 Oct 2026: "can you build an interface where i can edit text on the report
   pdf or html as format pls?").

   Renders the REAL page against a stubbed FCC (the audit of tools/check_grplan.js) with an in-page /api/state that keeps what
   the editor saves, then: opens the editor, checks the report's text is editable, rewords a heading and a task the way a person
   types, and checks the wording reaches the team store, the ⬇ HTML file and the ⬇ PDF — with none of the editing furniture in
   either — survives a reload, says when a stored edit no longer matches the report, is hidden in demo, and ↺ puts the audit's
   wording back.

   Run: NODE_PATH=$(npm root -g) node tools/check_grtext.js
*/
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
const { settle, served, repainted, dialogs, instrumentSrc, bridge, bridgeSrc } = require('./lib/pwsettle.js');
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
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.on('pageerror', (e) => errs.push(e.message));
  const DLG = dialogs(page);   // a `once` that never fires stays registered; this cannot
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  // both stores live in NODE: this harness reloads six times, and file:// web storage —
  // which it used to read them back through — is dropped at random by Chromium
  const FX = await bridge(page.context(), { grtext: {}, grtextall: {} });
  await page.context().addInitScript(bridgeSrc());
  await page.addInitScript(instrumentSrc('det-panel'));
  await page.addInitScript(({ ATTRS, QUALITY, COV }) => {
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k) => {
      const c = k in COV ? COV[k] : 100;
      cov[k] = c; attrs[k] = c == null ? { present: false } : { present: true, filled: c * 10, cov: c };
    });
    const peerCov = {}; ATTRS.forEach((k) => { peerCov[k] = 100; });
    const feeds = {
      'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 80, ai: { n: 0, of: 6 }, cov, reqMissing: [] },
      'Superdry|gb': { client: 'Superdry', mkt: 'gb', status: 'ok', t: NOW, rows: 900, score: 97, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
      'Monsoon|gb': { client: 'Monsoon', mkt: 'gb', status: 'ok', t: NOW, rows: 800, score: 85, ai: { n: 0, of: 6 }, cov: peerCov, reqMissing: [] },
    };
    window.__store = (window.__fx && window.__fx.grtext) || {}; window.__puts = [];
    window.__tpl = (window.__fx && window.__fx.grtextall) || {};
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url), j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/state?ns=grtextall')) return window.__fxReady.then((fx) => {
        window.__tpl = fx.grtextall || {}; window.__count('tpl');
        return j({ grtextall: JSON.parse(JSON.stringify(window.__tpl)) }); });
      if (u.includes('/api/state?ns=grtext')) return window.__fxReady.then((fx) => {
        window.__gets = (window.__gets || 0) + 1; window.__count('text');
        window.__store = fx.grtext || {};        // held in NODE, so every reload keeps it
        return j({ grtext: JSON.parse(JSON.stringify(window.__store)) }); });
      if (u.endsWith('/api/state') && opts && opts.method === 'PUT') {
        const b = JSON.parse(opts.body);
        if (b.grtextall) { window.__tpl = b.grtextall; window.__count('put');
          return window.__fxSave('grtextall', b.grtextall).then(() => j({ grtextall: b.grtextall })); }
        if (b.grtext) { window.__store = b.grtext; window.__puts.push(b.grtext); window.__count('put');
          return window.__fxSave('grtext', b.grtext).then(() => j({ grtext: b.grtext })); }
      }
      return j({});
    };
  }, { ATTRS, QUALITY, COV });
  /* THE REPORT IS READ WHEN IT HAS STOPPED CHANGING, never after a guessed sleep: the
   * scorecard kicks off its own reads on the first render and re-renders as each lands. */
  const loaded = async () => {
    await page.waitForSelector('#det-edit', { timeout: 15000 });
    await served(page, 'text'); await repainted(page); await settle(page, '#det-panel');
  };
  /* and the EDITOR is read when IT has stopped changing. It lives in an iframe, so the
   * panel settling says nothing about it: settle both, the frame only while it is open. */
  const quietEd = async () => {
    await settle(page, '#det-panel', { quiet: 120 });
    const h = await page.$('#rped-f');
    if (!h) return;
    const fr = await h.contentFrame();
    if (fr) await settle(fr, 'body', { quiet: 120 });
  };
  await page.goto(PAGE);
  await loaded();
  const store = () => page.evaluate(() => ((window.__store['Reiss|gb'] || {}).e) || []);
  const frame = async () => { const h = await page.waitForSelector('#rped-f'); return h.contentFrame(); };
  const openEd = async () => {
    await page.click('#det-edit');
    await page.waitForSelector('#rped-f', { timeout: 15000 });
    const f = await frame();
    await f.waitForSelector('[data-ek]', { timeout: 15000, state: 'attached' });
    await quietEd();
    return f;
  };
  // type into a unit the way a person does: focus, select its text, type
  const putN = () => page.evaluate(() => (window.__served && window.__served.put) || 0);
  const afterPut = async (prev, what) => {
    try { await page.waitForFunction((n) => ((window.__served && window.__served.put) || 0) > n, prev, { timeout: 20000 }); return true; }
    catch (e) { ok('the edit reached the team store' + (what ? ' (' + what + ')' : ''), false, 'no PUT within 20s'); return false; }
  };
  /* type the way a person does — focus, select the unit's text, type — then wait for the
     editor's own debounced save to have REACHED the store, never for a duration */
  const typeInto = async (f, sel, text, expectSave) => {
    const prev = await putN();
    const el = await f.$(sel);
    await el.click();
    await f.evaluate((s) => { const e = document.querySelector(s); const r = document.createRange(); r.selectNodeContents(e); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
    await page.keyboard.type(text);
    if (expectSave !== false) await afterPut(prev, sel);
    await quietEd();
  };

  console.log('-- the editor');
  let f = await openEd();
  const st0 = await f.evaluate(() => ({ units: document.querySelectorAll('[data-ek]').length,
    ce: Array.from(document.querySelectorAll('[data-ek]')).filter((e) => !(e instanceof SVGElement)).every((e) => e.isContentEditable), svg: document.querySelectorAll('text[data-ek]').length,
    plan: (document.querySelector('#print-plan h3') || {}).textContent || '', task: (document.querySelector('#print-plan .ap-t') || {}).textContent || '' }));
  ok('✎ Edit report opens the client document full screen, its text editable', st0.units > 20 && st0.ce, st0);
  const cov = await f.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), miss = [];
    let n, all = 0;
    while ((n = w.nextNode())) {
      if (!/\S/.test(n.nodeValue)) continue;
      const p = n.parentElement; if (!p || p.closest('style,script,title,#print-catx')) continue;
      all++; if (!p.closest('[data-ek]')) miss.push(n.nodeValue.trim().slice(0, 40));
    }
    return { all, miss: miss.slice(0, 8), n: miss.length };
  });
  ok('every piece of text in the report is editable — words beside layout and inside charts included', cov.all > 50 && cov.n === 0, cov);
  ok('…the action plan is in it, as the downloads carry it', /Action plan — Reiss GB/.test(st0.plan) && st0.task.length > 5, st0);
  // opening the editor must not flatten the document: a unit holding a <b>, a <br> or a nested span keeps it (Ray, 15 Oct 2026:
  // "template broke when try to edit" — every unit was written back as plain text, so the tier ladder read "TIER 1Foundational< 40")
  const shape = await page.evaluate(() => {
    const f = document.getElementById('rped-f'), fd = f.contentDocument;
    const src = new DOMParser().parseFromString(f.srcdoc, 'text/html');
    const inFrame = fd.body.querySelectorAll('*').length - fd.body.querySelectorAll('[data-tw]').length;
    const nested = Array.from(fd.querySelectorAll('[data-ek]')).filter((e) => e.children.length && !e.children[0].hasAttribute('data-tw')).length;
    return { src: src.body.querySelectorAll('*').length, inFrame, nested };
  });
  ok('opening the editor keeps every element of the document — nothing flattened to plain text', shape.src > 100 && shape.inFrame === shape.src && shape.nested > 0, shape);

  console.log('-- reword a heading and a task');
  await f.evaluate(() => { document.querySelector('#print-plan h3').setAttribute('data-t', '1'); document.querySelector('#print-plan .ap-t').setAttribute('data-t', '2'); });
  await typeInto(f, '[data-t="1"]', 'Your plan for the next quarter');
  await typeInto(f, '[data-t="2"]', 'Send GTINs for the spring range first');
  await quietEd();
  let ed = await store();
  ok('both edits reach the team store under Reiss|gb, each saying what it replaced', ed.length === 2 && ed.some((x) => x.o === st0.plan.trim() && x.t === 'Your plan for the next quarter') && ed.some((x) => x.o === st0.task.trim() && x.t === 'Send GTINs for the spring range first'), ed);
  const msg = await page.textContent('#rped-msg');
  ok('the bar says how many edits are saved', /2 edits to this report/.test(msg), msg);
  const marked = await f.evaluate(() => document.querySelectorAll('.ek-on').length);
  ok('the edited lines are marked in the editor', marked === 2, marked);

  if (st0.svg) {
    let pv = await putN();
    DLG.expect('88');
    await f.click('text[data-ek]');
    await afterPut(pv, 'a word in a chart');   // the chart edit saves on the same debounce
    await quietEd();
    const sv = await store();
    ok('a word inside a chart is edited on click and saved like any other', sv.some((x) => x.t === '88'), sv.map((x) => x.t));
    // and put back to the audit's word the same way, which drops the edit
    const orig = sv.find((x) => x.t === '88');
    pv = await putN();
    DLG.expect(orig ? orig.o : '');
    await f.click('text[data-ek].ek-on');
    await afterPut(pv, 'the audit\'s word typed back');
    await quietEd();
    const sv2 = await store();
    ok('…and typing the original back drops the edit', !sv2.some((x) => x.t === '88') && sv2.length === 2, sv2.map((x) => x.t));
  }
  console.log('-- ⬇ HTML from the editor');
  await page.evaluate(() => {
    window.__html = null; window.__grPlainExport = true;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#rped-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  let html = await page.evaluate(() => window.__html);
  const gone = await page.evaluate(() => !document.getElementById('rped'));
  ok('the editor closes and the file downloads', gone && html.length > 1000);
  ok('the file carries the new wording, not the audit\'s', html.includes('Your plan for the next quarter') && html.includes('Send GTINs for the spring range first') && !html.includes(st0.task.trim()), null);
  ok('…and none of the editing furniture', !/contenteditable=|data-ek=|class="[^"]*ek-on|id="rped/.test(html), (html.match(/.{30}(contenteditable=|data-ek=|ek-on\"|id="rped).{30}/) || [])[0]);

  console.log('-- ⬇ PDF on the scorecard uses the same wording');
  await page.evaluate(() => {
    window.__cap = null; window.__pdfdone = false;
    window.html2canvas = (el) => { const d = el.ownerDocument; if (d !== document && !window.__cap) window.__cap = d.body.textContent;
      return Promise.resolve({ width: 1220, height: 3000, toDataURL: () => 'data:image/jpeg;base64,AAAA' }); };
    window.jspdf = { jsPDF: function () { this.addImage = () => {}; this.link = (x, y, w, h, o) => { (window.__pdfLinks = window.__pdfLinks || []).push({ x, y, w, h, url: o && o.url }); }; this.save = () => { window.__pdfdone = true; }; } };
  });
  await page.click('#det-pdf');
  await page.waitForFunction(() => window.__pdfdone === true, null, { timeout: 20000 }).catch(() => {});
  const cap = await page.evaluate(() => window.__cap || '');
  ok('the PDF reads the edited heading and task', cap.includes('Your plan for the next quarter') && cap.includes('Send GTINs for the spring range first'));

  console.log('-- a reload keeps it; a stale edit is named');
  // plant a stored edit the audit no longer writes, in NODE so the reload below reads it
  {
    const m = JSON.parse(JSON.stringify(FX.get().grtext || {}));
    (m['Reiss|gb'] = m['Reiss|gb'] || { e: [] }).e.push({ o: 'A sentence the audit no longer writes', n: 0, t: 'x' });
    FX.patch('grtext', m);
  }
  await page.evaluate(() => { try { localStorage.removeItem('gr-text-b'); } catch (e) {} });
  await page.reload();
  await loaded();
  await page.waitForSelector('#det-edit', { timeout: 15000 });
  await quietEd();
  f = await openEd();
  const st1 = await f.evaluate(() => ({ plan: document.querySelector('#print-plan h3').textContent, on: document.querySelectorAll('.ek-on').length }));
  const msg1 = await page.textContent('#rped-msg');
  ok('the editor opens on the team\'s wording after a reload', st1.plan === 'Your plan for the next quarter' && st1.on === 2, st1);
  ok('…and says an edit no longer matches the report rather than pasting it anywhere', /1 no longer match/.test(msg1), msg1);

  console.log('-- Esc closes; demo hides it');
  await page.keyboard.press('Escape');
  const shut = await page.evaluate(() => !document.getElementById('rped'));
  ok('Esc closes the editor', shut);
  const dm = await page.evaluate(() => { document.body.classList.add('demo'); const v = getComputedStyle(document.getElementById('det-edit')).display; document.body.classList.remove('demo'); return v; });
  ok('demo mode hides ✎ Edit report', dm === 'none', dm);

  console.log('-- ↺ back to the audit');
  f = await openEd();
  DLG.expect();
  await page.click('#rped-reset');
  await quietEd();
  f = await frame();
  await f.waitForSelector('[data-ek]', { timeout: 15000, state: 'attached' });
  const st2 = await f.evaluate(() => ({ plan: document.querySelector('#print-plan h3').textContent, on: document.querySelectorAll('.ek-on').length }));
  ed = await store();
  ok('↺ clears the store and the report reads as the audit wrote it', !ed.length && st2.on === 0 && /Action plan — Reiss GB/.test(st2.plan), { ed, st2 });
  await page.click('#rped-x');

  console.log('-- the template: one edit, every brand');
  const grabHtml = async () => {
    await page.evaluate(() => {
      window.__html = null; window.__grPlainExport = true;
      const real = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (b) { b.text().then((t) => { window.__html = t; }); return real(b); };
      HTMLAnchorElement.prototype.click = function () {};
    });
    await page.click('#det-html');
    await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
    return page.evaluate(() => window.__html);
  };
  f = await openEd();
  const lead0 = await f.evaluate(() => document.querySelector('#print-plan .pm-sub').textContent.trim());
  await page.click('#rped-all');
  const help = await page.textContent('#rped-help');
  ok('the scope switch puts the editor in template mode and says what that means', /every brand/i.test(help) && (await page.getAttribute('#rped-all', 'aria-pressed')) === 'true', help);
  await typeInto(f, '#print-plan .pm-sub', 'Our plan for you, month by month');
  await quietEd();
  let tp = await page.evaluate(() => Object.values(window.__tpl));
  ok('a template edit reaches the house-wide store, saying what it replaces', tp.length === 1 && tp[0].o === lead0 && tp[0].t === 'Our plan for you, month by month', tp);
  ok('…and nothing lands in this report\'s own edits', !(await store()).length);
  ok('the bar counts the template', /1 template edit for all brands/.test(await page.textContent('#rped-msg')), await page.textContent('#rped-msg'));
  // a report's own edit beats the template on that report
  await page.click('#rped-one');
  await f.evaluate(() => document.querySelector('#print-plan h3').setAttribute('data-t', '3'));
  await typeInto(f, '[data-t="3"]', 'Reiss only heading');
  await quietEd();
  ed = await store();
  ok('in "This report" mode the edit stays with Reiss GB', ed.length === 1 && ed[0].t === 'Reiss only heading', ed);
  await page.click('#rped-x');
  html = await grabHtml();
  ok('Reiss\'s ⬇ HTML carries the template line and its own heading', html.includes('Our plan for you, month by month') && html.includes('Reiss only heading') && !html.includes(lead0), null);
  // another brand: the template applies, Reiss's own edit does not
  await page.evaluate(() => { localStorage.removeItem('gr-textall-b'); localStorage.removeItem('gr-text-b'); });
  await page.goto(PAGE.replace('Reiss%7Cgb', 'Superdry%7Cgb'));
  await page.reload();
  await loaded();
  await page.waitForSelector('#det-edit', { timeout: 15000 });
  await quietEd();
  html = await grabHtml();
  ok('Superdry\'s ⬇ HTML reads the template line too', html.includes('Our plan for you, month by month') && !html.includes(lead0), null);
  ok('…and never Reiss\'s own edit', !html.includes('Reiss only heading'));
  await page.evaluate(() => {
    window.__cap = null; window.__pdfdone = false;
    window.html2canvas = (el) => { const d = el.ownerDocument; if (d !== document && !window.__cap) window.__cap = d.body.textContent;
      return Promise.resolve({ width: 1220, height: 3000, toDataURL: () => 'data:image/jpeg;base64,AAAA' }); };
    window.jspdf = { jsPDF: function () { this.addImage = () => {}; this.link = (x, y, w, h, o) => { (window.__pdfLinks = window.__pdfLinks || []).push({ x, y, w, h, url: o && o.url }); }; this.save = () => { window.__pdfdone = true; }; } };
  });
  await page.click('#det-pdf');
  await page.waitForFunction(() => window.__pdfdone === true, null, { timeout: 20000 }).catch(() => {});
  ok('…and so does Superdry\'s ⬇ PDF', (await page.evaluate(() => window.__cap || '')).includes('Our plan for you, month by month'));
  f = await openEd();
  const sd = await f.evaluate(() => ({ lead: document.querySelector('#print-plan .pm-sub').textContent, blue: document.querySelectorAll('.ek-tpl').length }));
  ok('the Superdry editor shows the template line, marked as the template\'s', sd.lead === 'Our plan for you, month by month' && sd.blue >= 1, sd);
  DLG.expect();
  await page.click('#rped-treset');
  await quietEd();
  tp = await page.evaluate(() => Object.keys(window.__tpl));
  ok('↺ Reset template empties the house-wide store', tp.length === 0, tp);
  await page.click('#rped-x');

  console.log('-- a template made from one brand\'s edits never carries that brand, a figure or a lone word (Ray, 15 Oct 2026)');
  const goBrand = async (b) => {
    await page.evaluate(() => { localStorage.removeItem('gr-textall-b'); localStorage.removeItem('gr-text-b'); });
    await page.goto(PAGE.replace('Reiss%7Cgb', b + '%7Cgb')); await page.reload(); await loaded();
    await page.waitForSelector('#det-edit', { timeout: 15000 }); await quietEd();
  };
  const plain = (h) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  await goBrand('Reiss');
  f = await openEd();
  const rv = await f.evaluate(() => {
    const t = (e) => e.textContent.trim();
    const u = Array.from(document.querySelectorAll('[data-ek]'));
    return { fig: t(u.find((e) => e instanceof SVGElement && /^\d+(\.\d+)?$/.test(t(e))) || { textContent: '' }),
      lead: t(document.querySelector('#print-plan .pm-sub')) };
  });
  await page.click('#rped-x');
  // the store as the first cut of the template wrote it when Monsoon's edits were promoted: literal lines, one of them good
  const OLD = { a1: { o: 'Required', t: 'Monsoon label', at: 1 }, a2: { o: rv.fig, t: '77.7', at: 1 },
    a3: { o: 'Action plan — Monsoon GB', t: 'Monsoon GB — our plan', at: 1 }, a4: { o: rv.lead, t: 'Monsoon wrote this lead', at: 1 },
    a5: { o: 'Golden Record audit · Google Shopping', t: 'Feed health review · Google Shopping', at: 1 } };
  FX.patch('grtextall', OLD);
  await page.evaluate((m) => { window.__tpl = m; }, OLD);
  await goBrand('Reiss');
  html = plain(await grabHtml());
  ok('a stored line naming another brand is never applied (Reiss\'s file names no Monsoon)', !/Monsoon/.test(html), (html.match(/.{30}Monsoon.{30}/) || [])[0]);
  ok('…nor a figure (Reiss keeps its own ' + rv.fig + ')', !!rv.fig && html.includes(rv.fig) && !html.includes('77.7'));
  ok('…nor a lone word', !html.includes('Monsoon label'));
  ok('…while a good line still serves every brand', html.includes('Feed health review · Google Shopping'));
  await goBrand('Monsoon');
  f = await openEd();
  const tidyOn = await page.evaluate(() => !document.getElementById('rped-tidy').hidden);
  const msgT = await page.textContent('#rped-msg');
  ok('the editor names the lines set aside and offers to tidy them', tidyOn && /4 template lines set aside/.test(msgT), msgT);
  DLG.expect();
  await page.click('#rped-tidy');
  await quietEd();
  tp = await page.evaluate(() => Object.values(window.__tpl).map((x) => x.t));
  let mon = await page.evaluate(() => ((window.__store['Monsoon|gb'] || {}).e || []).map((x) => x.t));
  ok('tidy leaves only the line that serves every brand in the template', tp.length === 1 && tp[0] === 'Feed health review · Google Shopping', tp);
  ok('…and keeps the Monsoon lines found in this report as Monsoon\'s own edits', mon.includes('Monsoon GB — our plan') && mon.includes('Monsoon label'), mon);
  console.log('-- promoting now generalises the brand and keeps the rest home');
  f = await frame();
  await f.waitForSelector('[data-ek]', { timeout: 15000, state: 'attached' });
  DLG.expect();
  await page.click('#rped-promote');
  await quietEd();
  tp = await page.evaluate(() => Object.values(window.__tpl));
  mon = await page.evaluate(() => ((window.__store['Monsoon|gb'] || {}).e || []).map((x) => x.t));
  ok('the brand-named heading goes in as {brand} {market}', tp.some((x) => x.o === 'Action plan — {brand} {market}' && x.t === '{brand} {market} — our plan' && x.b === 'Monsoon'), tp);
  ok('…the lone word stays on Monsoon\'s report', mon.includes('Monsoon label') && !tp.some((x) => /Monsoon/.test(x.t + x.o)), { mon, tp });
  await page.click('#rped-x');
  await goBrand('Superdry');
  html = plain(await grabHtml());
  ok('Superdry\'s file reads the heading as its own — "Superdry GB — our plan" — and never Monsoon', html.includes('Superdry GB — our plan') && !/Monsoon/.test(html), (html.match(/.{20}our plan.{10}/) || [])[0]);
  DLG.expect();
  f = await openEd();
  await page.click('#rped-treset');
  await quietEd();
  await page.click('#rped-x');

  ok('every dialog this run expected actually opened', DLG.pending() === 0, DLG.pending());
  ok('and no prompt appeared that nobody planned for', DLG.unexpected().length === 0, DLG.unexpected());
  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' check(s) failed' : '\n✓ Golden client report: edited in place, saved for the team, carried by ⬇ HTML and ⬇ PDF');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
