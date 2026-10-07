#!/usr/bin/env node
/* Golden Record — every scorecard section folds (Ray, 7 Oct 2026, over a screenshot of the
   "Two scores, two questions" card: "make these boxes collapsible as well").

   What a fold may NOT do, and what this renders the real page to prove:
     · hide a finding — a folded section keeps its header: badge, title and what it found
       (avg fill, the content-quality score, "⚠ N fields read differently");
     · swallow the header's own controls — ⓘ Scoring logic, Analyse, the range chips keep working;
     · reach the client — ⬇ PDF / ⬇ HTML / Ctrl+P print every section OPEN, with no fold control;
     · fire twice on a phone — the skim view hands a tap on the heading to the chevron, so one
       tap is one toggle.
   "Two scores, two questions" starts folded on a fresh device (it explains the scoring, it is not
   a finding); every other section starts open; a person's choice is remembered on the device.
   Assertions read what is PAINTED, never a property (a flex child ignores `hidden`).

   Playwright-based → presync. Run: NODE_PATH=$(npm root -g) node tools/check_grfold.js */
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const fs = require('fs');
const os = require('os');

const D = path.resolve(__dirname, '..', 'docs');
const WIDGETS = ['instr_collapse.html', 'digest_widget.html', 'mobile_widget.html']
  .filter((f) => fs.existsSync(path.join(D, f)))
  .map((f) => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const SRC = fs.readFileSync(path.join(D, 'FeedSpark_GoldenRecord.html'), 'utf8');
const TMP = path.join(os.tmpdir(), '_grfold_FeedSpark_GoldenRecord.html');
fs.writeFileSync(TMP, SRC.indexOf('</body>') >= 0 ? SRC.replace('</body>', WIDGETS + '\n</body>') : SRC + '\n' + WIDGETS);
const PAGE = 'file://' + TMP;
const ENGINE_LG = path.join(D, 'labelguard_engine.js');
const ENGINE_FA = path.join(D, 'feedlab_engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const ATTRS = ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand', 'gtin',
  'mpn', 'condition', 'item_group_id', 'color', 'size', 'gender', 'age_group', 'google_product_category',
  'product_type', 'sale_price', 'additional_image_link', 'product_highlight', 'product_detail', 'material',
  'pattern', 'size_type', 'size_system', 'question_and_answer', 'document_link', 'related_product',
  'item_group_title', 'variant_option', 'popularity_rank'];
const rule = (n, pct) => ({ n, pct, eg: ['example value'] });
// a content-quality reading + its AI-readiness read, so the quality, AI and "Two scores" sections all render
const QUALITY = {
  t: Date.now(), client: 'Reiss', market: 'gb', rows: 1000,
  attrs: {
    title: { filled: 1000, cov: 100, avgLen: 58, minLen: 12, maxLen: 160, rules: { caps: rule(120, 12), short: rule(600, 60) } },
    description: { filled: 990, cov: 99, avgLen: 240, minLen: 20, maxLen: 4000, rules: { thin: rule(300, 30.3) } },
    product_highlight: { filled: 400, cov: 40, avgLen: 30, minLen: 8, maxLen: 90, rules: { 'count-low': rule(380, 95) } },
  },
  ai: {
    total: 61, tier: 3, tierLabel: 'Enriched', sampled: 1000, rows: 1000,
    pillars: [
      { key: 'identity', label: 'Identity & trust', score: 100, weight: 1.4, summary: 'GTIN, brand, price, availability all present' },
      { key: 'titles', label: 'Title anatomy', score: 57, weight: 1.6, summary: 'avg 61 chars' },
      { key: 'descriptions', label: 'Descriptions', score: 85, weight: 1.3, summary: '100% coverage' },
      { key: 'attributes', label: 'Attribute completeness', score: 80, weight: 1.5, summary: 'pattern 15%' },
      { key: 'taxonomy', label: 'Taxonomy depth', score: 76, weight: 1.2, summary: 'GPC on 100%' },
      { key: 'media', label: 'Media richness', score: 100, weight: 1.0, summary: 'multi-angle imagery' },
      { key: 'conversational', label: 'Conversational', score: 0, weight: 2.4, summary: 'none of the six' },
      { key: 'ai', label: 'Structured detail', score: 20, weight: 1.2, summary: 'highlights avg 0.5 per item' },
    ],
    titles: { avg: 61, min: 18, max: 140, dup: 0, allCaps: 0, buckets: [{ b: '<50', n: 300 }, { b: '50–79', n: 500 }, { b: '80–119', n: 200 }],
      mask: { brand: 96, material: 41, fit: 28, colour: 88, use: 12 } },
  },
};

async function arm(page, errs) {
  page.on('pageerror', (e) => errs.push(e.message));
  await page.route('**/labels/engine.js', (r) => r.fulfill({ path: ENGINE_LG, contentType: 'text/javascript' }));
  await page.route('**/feedlab/engine.js', (r) => r.fulfill({ path: ENGINE_FA, contentType: 'text/javascript' }));
  await page.addInitScript(({ ATTRS, QUALITY }) => {
    const NOW = Date.now(), cov = {}, attrs = {};
    ATTRS.forEach((k, i) => {
      const absent = i > 19 && i % 3 === 0;
      cov[k] = absent ? null : 100 - (i % 7) * 4;
      attrs[k] = absent ? { present: false } : { present: true, filled: 900, cov: cov[k] };
    });
    const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1000, score: 88, ai: { n: 0, of: 6 }, cov, reqMissing: [] };
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      const j = (o) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });
      if (/engine\.js/.test(u)) return real(url, opts);
      if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {} });
      if (u.includes('/api/golden/quality')) return j({ quality: QUALITY });
      if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1000, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
      if (u.includes('/api/golden/history')) return j({ ok: true, rec: { r: [{ t: NOW - 864e5 * 3, rows: 1000, cov }, { t: NOW, rows: 1000, cov }], s: [], q: [] } });
      if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: {}, industryMap: {} });
      if (u.includes('/api/labels/askdraft')) return j({ cfg: { to: {} }, asked: {} });
      return j({});
    };
    window.print = function () {};
  }, { ATTRS, QUALITY });
}

// what each section paints: its header, and whether anything below the header is on screen
const READ = () => {
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return Array.from(document.querySelectorAll('#det-panel .tier')).filter((t) => t.firstElementChild && t.firstElementChild.classList.contains('tier-h')).map((t) => {
    const h = t.firstElementChild, b = h.querySelector('.tfold');
    const body = Array.from(t.children).slice(1);
    return { key: t.getAttribute('data-tf'), id: t.id, title: (h.querySelector('h4') || {}).textContent || '',
      btn: !!b, exp: b && b.getAttribute('aria-expanded'), btnVis: vis(b), headVis: vis(h), headText: h.textContent,
      bodyVis: body.some(vis), folded: t.classList.contains('folded') };
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  await arm(page, errs);
  await page.goto(PAGE);
  await page.waitForSelector('#rec-tier', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);

  console.log('\n-- a fresh device --');
  let S = await page.evaluate(READ);
  const by = (k) => S.find((x) => x.key === k) || {};
  ok('every section carries a fold chevron — the four spec tiers, history, content quality, AI-readiness, Two scores',
    ['req', 'cond', 'rec', 'ai', 'hist', 'qual', 'air', 'recon'].every((k) => by(k).btn && by(k).btnVis), S.map((x) => [x.key, x.btn]));
  ok('"Two scores, two questions" starts folded: its table is not painted, its header and flag are',
    by('recon').folded && !by('recon').bodyVis && by('recon').headVis && /read differently|agree/.test(by('recon').headText) && by('recon').exp === 'false', by('recon'));
  ok('every other section starts open', ['req', 'cond', 'rec', 'ai', 'qual', 'air'].every((k) => !by(k).folded && by(k).bodyVis && by(k).exp === 'true'));

  // GRFOLD_SHOT=/path/prefix keeps screenshots of the fresh scorecard for a visual pass
  if (process.env.GRFOLD_SHOT) {
    await page.evaluate(() => document.querySelector('#air-tier').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: process.env.GRFOLD_SHOT + '_fresh.png' });
  }
  console.log('\n-- folding and opening --');
  await page.click('#rec-tier > .tier-h h4');
  S = await page.evaluate(READ);
  ok('a click on the header opens "Two scores" — the table paints, aria-expanded follows', !by('recon').folded && by('recon').bodyVis && by('recon').exp === 'true');
  await page.click('.tier[data-tf="req"] > .tier-h .tfold');
  S = await page.evaluate(READ);
  ok('the chevron folds the Required tier — its rows go, its header and "avg fill" stay', by('req').folded && !by('req').bodyVis && /avg fill|none in feed/.test(by('req').headText));
  const qHeadBtn = await page.$('#qz-tier > .tier-h button:not(.tfold)');
  if (qHeadBtn) {
    await qHeadBtn.click().catch(() => {});
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape').catch(() => {});
    S = await page.evaluate(READ);
    ok('a control inside a header (ⓘ Scoring logic) does its own job and never folds the section', !by('qual').folded && by('qual').bodyVis);
  } else ok('the content-quality header carries a control to test against', false);
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gr-tfold') || '{}'); } catch (e) { return null; } });
  ok('the choices are remembered on this device (gr-tfold), the opened default included', stored && stored.req === 1 && stored.recon === 0, stored);

  console.log('\n-- the scorecard re-renders --');
  const rng = await page.$('#hs-tier .hs-rng button:not(.on)');
  if (rng) { await rng.click(); await page.waitForTimeout(250); }
  S = await page.evaluate(READ);
  ok('a history range change redraws its card in place and the card still folds', by('hist').btn);
  await page.reload();
  await page.waitForSelector('#rec-tier', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  S = await page.evaluate(READ);
  ok('after a reload: Required still folded, "Two scores" still open', by('req').folded && !by('req').bodyVis && !by('recon').folded && by('recon').bodyVis);

  console.log('\n-- fold all / open all --');
  const allTxt0 = await page.textContent('#tf-all');
  await page.click('#tf-all');
  S = await page.evaluate(READ);
  ok('⊖ Fold all sections folds every section', S.length >= 8 && S.every((x) => x.folded && !x.bodyVis), S.map((x) => [x.key, x.folded]));
  const sums = await page.evaluate(() => ['qz-tier', 'air-tier'].map((id) => { const e = document.querySelector('#' + id + ' > .tier-h .tf-sum'); return e && e.getClientRects().length ? e.textContent : null; }));
  ok('folded, content quality and AI-readiness still show their score in the header', /^\d/.test(sums[0] || '') && /^61\/100$/.test(sums[1] || ''), sums);
  const allTxt1 = await page.textContent('#tf-all');
  ok('…and the button names the action still available', /Fold all/.test(allTxt0) && /Open all/.test(allTxt1), [allTxt0, allTxt1]);
  await page.click('#tf-all');
  S = await page.evaluate(READ);
  ok('⊕ Open all sections opens every one', S.every((x) => !x.folded && x.bodyVis));
  await page.click('#tf-all');   // leave everything folded for the export checks
  if (process.env.GRFOLD_SHOT) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); await page.screenshot({ path: process.env.GRFOLD_SHOT + '_allfolded.png', fullPage: true }); }

  console.log('\n-- the client documents print every section open --');
  const pr = await page.evaluate(() => {
    document.body.classList.add('pdf');
    const vis = (el) => !!el && el.getClientRects().length > 0;
    const t = Array.from(document.querySelectorAll('#det-panel .tier[data-tf]'));
    // a card the print layout drops on its own (the Two-scores band, an empty history card) is not a fold
    const printed = t.filter((x) => x.id !== 'rec-tier' && vis(x));
    const r = { n: printed.length, open: printed.length >= 6 && printed.every((x) => Array.from(x.children).slice(1).some(vis)),
      shut: printed.filter((x) => !Array.from(x.children).slice(1).some(vis)).map((x) => x.getAttribute('data-tf')),
      chev: Array.from(document.querySelectorAll('.tfold')).some(vis), all: vis(document.getElementById('tf-all')) };
    document.body.classList.remove('pdf');
    return r;
  });
  ok('in the print layout every folded section paints its body', pr.open, pr.shut);
  ok('…and no fold control is on the page', !pr.chev && !pr.all, pr);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#det-html')]);
  const tmp = path.join(os.tmpdir(), 'grfold-' + Date.now() + '.html');
  await download.saveAs(tmp);
  const html = fs.readFileSync(tmp, 'utf8');
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
  ok('the ⬇ HTML file carries no chevron and no fold-all button', !/class="tfold"/.test(body) && !/id="tf-all"/.test(body));
  const px = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await px.goto('file://' + tmp);
  await px.waitForTimeout(300);
  const xr = await px.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    const t = Array.from(document.querySelectorAll('.tier[data-tf]'));
    return { n: t.length, open: t.every((x) => Array.from(x.children).slice(1).some(vis)), rows: document.querySelectorAll('.at-row').length };
  });
  ok('…and opened, every section folded on screen is OPEN in the file', xr.n >= 6 && xr.open && xr.rows > 20, xr);
  await px.close();
  await page.click('#tf-all');   // open again

  console.log('\n-- a phone --');
  const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await arm(ph, errs);
  await ph.goto(PAGE);
  await ph.waitForSelector('#rec-tier', { timeout: 8000 }).catch(() => {});
  await ph.waitForTimeout(900);
  // the skim view opens on its own folds — open them, so the scorecard's sections are on screen
  await ph.evaluate(() => { if (window.FCCDigest && FCCDigest.expandAll) FCCDigest.expandAll(); });
  await ph.waitForTimeout(300);
  const before = await ph.evaluate(() => document.querySelector('.tier[data-tf="cond"]').classList.contains('folded'));
  await ph.evaluate(() => document.querySelector('.tier[data-tf="cond"] > .tier-h').scrollIntoView({ block: 'center' }));
  await ph.tap('.tier[data-tf="cond"] > .tier-h h4');
  await ph.waitForTimeout(200);
  const after = await ph.evaluate(() => document.querySelector('.tier[data-tf="cond"]').classList.contains('folded'));
  ok('one tap on a heading at 390px is one toggle — never folded and re-opened by two handlers', before !== after, [before, after]);
  // the skim view leaves a heading that already toggles to the page and hands a tap on it to the
  // heading's [aria-expanded] button (digest_widget decorateOwn). It does not decorate these today;
  // if it ever does, the page's guard keeps one tap one toggle — stood up here exactly as it would be
  const own = await ph.evaluate(() => {
    const h = document.querySelector('.tier[data-tf="rec"] > .tier-h');
    h.classList.add('fcc-dg-hd', 'fcc-dg-own');
    h.addEventListener('click', (ev) => { if (ev.target.closest('button,a,input,select,label,textarea')) return; const b = h.querySelector('[aria-expanded]:not(.instr-tgl)'); if (b) b.click(); });
    h.scrollIntoView({ block: 'center' });
    return h.parentNode.classList.contains('folded');
  });
  await ph.tap('.tier[data-tf="rec"] > .tier-h h4');
  await ph.waitForTimeout(200);
  const own2 = await ph.evaluate(() => document.querySelector('.tier[data-tf="rec"]').classList.contains('folded'));
  ok('…and on a heading the skim view hands to the chevron, still one tap, one toggle', own !== own2, [own, own2]);
  const wide = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok('…and the chevron adds no sideways scroll', wide);
  await ph.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  try { fs.unlinkSync(TMP); fs.unlinkSync(tmp); } catch (e) {}
  console.log(fail ? '\n✗ ' + fail + ' failed' : '\n✓ every scorecard section folds — and never hides a finding or reaches a client folded');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
