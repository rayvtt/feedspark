#!/usr/bin/env node
/* Golden Record — DEPTH IN THE SCORE, rendered (Ray, 7 Oct 2026: "image population … at least four plus
   … 100% score … product details … separated from product highlight … please give me more scoring
   logic and let me approve" — approved: images per product (4+, ★ for Fashion & Footwear), highlights
   per product (Google's 4–6), product details per product (3+, care lines and repeats not counted),
   lifestyle images (Fashion only) and size_system ★ for apparel).

   A filled column is not a full one: one extra image on every product read as 100% additional_image_link.
   So each of the three list attributes gains a DEPTH twin, read product by product on the XML scan,
   and once it is measured the twin scores INSTEAD of the presence row — one fact, one weight. When it
   was not measured (a sheet-read feed, a snapshot from before 7 Oct) the presence row scores as it
   always did and the depth row says "not measured", never "missing". A source read cannot see which
   row the page scores, what the dial prints or what the client is sent, so this renders the REAL
   /golden page and holds the dial to the engine's goldenScore on the same snapshot, under the same
   profile the worker serves.

   Playwright-based, so it runs in presync. Run: NODE_PATH=$(npm root -g) node tools/check_grdepth.js */
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

// invented figures, shaped like a fashion feed read on the XML scan
const ROWS = 9600;
const COV = { id: 100, title: 100, description: 99, link: 100, image_link: 100, availability: 100, price: 100,
  brand: 100, gtin: 97, condition: 100, item_group_id: 100, color: 94, size: 98, gender: 100, age_group: 100,
  google_product_category: 100, product_type: 100, sale_price: 22, additional_image_link: 98, material: 61, pattern: 18,
  product_highlight: 88, product_detail: 70 };
const IMG = { present: true, filled: 9408, full: 7900, target: 4, cov: 91.5, avg: 4.6,
  dist: { 0: 2, 1: 3.1, 2: 4.6, 3: 8, 4: 31.3, 5: 29, '6+': 22 } };
const HL = { present: true, filled: 8448, full: 4800, target: 4, cov: 78, avg: 3.4,
  dist: { 0: 12, 1: 4, 2: 9, 3: 25, 4: 34, 5: 10, '6+': 6 } };
const DET = { present: true, filled: 6720, full: 1200, target: 3, cov: 41.3, avg: 1.4,
  dist: { 0: 30, 1: 22, 2: 35.5, 3: 9, 4: 2.5, 5: 1, '6+': 0 }, care: 4100, dup: 900, bad: 12,
  names: [['sleeve length', 3100], ['neckline', 2900], ['fit', 2400], ['fastening', 600]] };

(async () => {
  const LG = await import('../cloudflare/feedspark-deck/src/labelguard.js');
  const attrsWith = (dep, extra) => {
    const a = {};
    Object.keys(COV).forEach((k) => { a[k] = { present: true, cov: COV[k], filled: Math.round(COV[k] * ROWS / 100) }; });
    if (dep) { a.img_depth = IMG; a.hl_depth = HL; a.detail_depth = DET; }
    return Object.assign(a, extra || {});
  };
  // the profile route answers as the worker does — the engine's own defaults + upgrade table
  const profAns = { defaults: LG.INDUSTRY_PROFILES, overrides: {}, industryMap: LG.INDUSTRY, upgrade: { v: LG.PROFILE_V, delta: LG.PROFILE_DELTA } };
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (client, attrs, vp) => {
    const page = await browser.newPage({ viewport: vp || { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(({ client, attrs, ROWS, profAns }) => {
      try { localStorage.clear(); } catch (e) {}
      const real = window.fetch.bind(window);
      const cov = {};
      Object.keys(attrs).forEach((k) => { cov[k] = attrs[k].present ? attrs[k].cov : null; });
      const feed = { client, mkt: 'gb', status: 'ok', t: Date.now(), rows: ROWS, score: null, ai: { n: 0, of: 6 }, cov };
      window.__blobs = [];
      const mk = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (b) { b.text().then((t) => { window.__blobs.push(t); }); return mk(b); };
      HTMLAnchorElement.prototype.click = function () {};   // the export builds its file; nothing downloads
      window.fetch = (url, o) => {
        const u = String(url);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/golden/estate')) { const f = {}; f[client + '|gb'] = feed; return j({ feeds: f, alerts: {}, daily: null }); }
        if (u.includes('/api/golden/history')) return j({ hist: null });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: Date.now(), rows: ROWS, client, market: 'gb', attrs }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j(profAns);
        return j({});
      };
    }, { client, attrs, ROWS, profAns });
    await page.goto(PAGE);
    await page.waitForSelector('.at-row', { timeout: 8000 });
    await page.waitForTimeout(300);
    return page;
  };
  const row = (page, lead) => page.evaluate((lead) => {
    const r = Array.from(document.querySelectorAll('.at-row')).find((x) => ((x.querySelector('.at-nm') || {}).textContent || '').replace(/^g:/, '').indexOf(lead) === 0);
    if (!r) return null;
    const nm = r.querySelector('.at-nm');
    return { nm: nm.textContent, badges: Array.from(r.querySelectorAll('.fs-std')).map((b) => b.textContent), star: !!r.querySelector('.bpstar'),
      waived: !!r.querySelector('.wv:not(.dep-by)'), byDepth: !!r.querySelector('.dep-by'),
      miss: (r.querySelector('.at-miss') || {}).textContent || null, cov: (r.querySelector('.at-cov') || {}).textContent,
      note: (r.querySelector('.at-note') || {}).textContent, tip: (r.querySelector('.at-note') || {}).title,
      ask: !!r.querySelector('[data-ask]'), pdp: !!r.querySelector('[data-pdp]'), brief: !!r.querySelector('[data-brief]'),
      tier: (r.closest('.tier').querySelector('h4') || {}).textContent,
      card: (function () { const c = r.nextElementSibling; return c && c.classList.contains('dep-card') ? c.getAttribute('data-dep') : null; })() };
  }, lead);
  const dial = (page) => page.$eval('svg.dial', (e) => { const m = /score ([\d.]+)/.exec(e.getAttribute('aria-label')); return m ? +m[1] : null; });

  console.log('── measured on the XML scan (a Fashion brand)');
  {
    const attrs = attrsWith(true);
    const page = await open('Reiss', attrs);
    const img = await row(page, 'images per product'), hl = await row(page, 'highlights per product'), det = await row(page, 'details per product');
    ok('the three depth rows sit in the Recommended tier, named in words, never as a g: key',
      [img, hl, det].every((r) => r && /Recommended/i.test(r.tier) && !/^g:/.test(r.nm)), [img, hl, det].map((r) => r && r.nm));
    ok('images and details are badged FeedSpark (our number), highlights Google 4–6 (Google\'s)',
      img && img.badges.join() === 'FeedSpark' && det && det.badges.join() === 'FeedSpark' && hl && hl.badges.join() === 'Google 4–6', [img, hl, det].map((r) => r && r.badges));
    ok('images per product is ★ for a Fashion brand (the approved default)', img && img.star);
    ok('each row reads its depth score and says how many each product carries',
      img.cov === '91.5%' && /^4\.6 images per product · 82\.3% carry 4\+$/.test(img.note) &&
      hl.cov === '78%' && /^3\.4 highlights per product · 50% carry 4\+$/.test(hl.note), [img.cov, img.note, hl.cov, hl.note]);
    ok('the details row says how many lines it did not count',
      det.cov === '41.3%' && /1\.4 details per product · 12\.5% carry 3\+ · 5,000 lines not counted/.test(det.note), det.note);
    ok('the tooltip gives the arithmetic and that it replaces the presence row',
      /each product scores images ÷ 4, capped at 100% — 4 or more is full credit, 3 is 75%, 2 is 50%, 1 is 25%, none is 0 — averaged over all 9,600 products/.test(img.tip) &&
      /replaces g:additional_image_link in the score \(filled is not full\)/.test(img.tip) &&
      /4,100 care lines \(washing, cleaning\) are not counted/.test(det.tip) && /900 lines repeat another attribute/.test(det.tip), [img.tip, det.tip]);
    ok('each depth row carries its breakdown card, 0 … 6+', img.card === 'img_depth' && hl.card === 'hl_depth' && det.card === 'detail_depth');
    const card = await page.$eval('.dep-card[data-dep="img_depth"]', (c) => ({
      segs: Array.from(c.querySelectorAll('.dep-bar i')).reduce((s, i) => s + parseFloat(i.style.width), 0),
      leg: Array.from(c.querySelectorAll('.dep-leg span')).map((s) => s.textContent.trim()),
      full: Array.from(c.querySelectorAll('.dep-leg span.dep-full')).length, foot: c.querySelector('.dep-foot').textContent }));
    ok('the card\'s bar is the whole catalogue and its legend names every bucket', Math.abs(card.segs - 100) < 0.2 &&
      card.leg.join(' | ') === '0 images 2% | 1 image 3.1% | 2 images 4.6% | 3 images 8% | 4 images 31.3% | 5 images 29% | 6+ images 22%', card);
    ok('…the buckets at full credit are marked, and the foot says whose standard it is', card.full === 3 && /FeedSpark’s standard/.test(card.foot), card);
    const dc = await page.$eval('.dep-card[data-dep="detail_depth"] .dep-foot', (f) => f.textContent);
    ok('the details card names what the feed carries today and gives examples by product type',
      /Carried today: sleeve length 3,100 · neckline 2,900 · fit 2,400 · fastening 600/.test(dc) && /dresses: dress length/.test(dc), dc);
    // the explanation folds; the coloured legend holds one line (Ray, 8 Oct 2026)
    const fold = await page.$$eval('.dep-card', (cs) => cs.map((c) => { const sp = Array.from(c.querySelectorAll('.dep-leg span')); const lg = c.querySelector('.dep-leg');
      return { k: c.getAttribute('data-dep'), oneLine: sp.every((x) => Math.abs(x.offsetTop - sp[0].offsetTop) < 2), fits: lg.scrollWidth <= lg.clientWidth + 1, sw: lg.scrollWidth, cw: lg.clientWidth,
        closed: !!c.querySelector('details.dep-more:not([open]) .dep-foot'), sum: (c.querySelector('details.dep-more summary') || {}).textContent || '' }; }));
    ok('each depth card keeps its coloured legend on ONE line, fitting the card, with the explanation folded behind "How it\'s scored · full credit at N+"',
      fold.length === 3 && fold.every((f) => f.oneLine && f.fits && f.closed && /How it’s scored · full credit at \d\+/.test(f.sum)), fold);
    const pres = await Promise.all(['additional_image_link', 'product_highlight', 'product_detail'].map((k) => row(page, k)));
    ok('the presence rows stay (is it in the feed at all?) but say the depth row scores instead',
      pres.every((r) => r && r.byDepth && /^g:/.test(r.nm)), pres.map((r) => r && r.nm));
    // Ray, 8 Oct 2026: "make sure button spacing and type is the same as rest of other attributes" — a row
    // missing an action keeps its slot, so every → Brief / ✉ Ask client sits in ONE column down the tiers
    const cols = await page.evaluate(() => {
      const xs = (sel) => Array.from(document.querySelectorAll('.at-row ' + sel)).filter((b) => b.offsetWidth).map((b) => Math.round(b.getBoundingClientRect().left));
      const font = (sel) => Array.from(document.querySelectorAll('.at-row ' + sel)).map((b) => { const c = getComputedStyle(b); return c.fontSize + '/' + c.fontWeight + '/' + c.paddingLeft; });
      return { brief: [...new Set(xs('[data-brief]'))], ask: [...new Set(xs('[data-ask]'))], pdp: [...new Set(xs('[data-pdp]'))], type: [...new Set(font('[data-brief], [data-ask], [data-pdp]'))],
        gap: Array.from(document.querySelectorAll('.ab-gap')).every((g) => getComputedStyle(g).visibility === 'hidden' && !g.matches('[data-ask],[data-brief],[data-pdp]')) };
    });
    ok('every row\'s buttons line up — one column each for ✉ Ask client, → Brief and 🔎 PDP, in one type and padding',
      cols.brief.length === 1 && cols.ask.length === 1 && cols.pdp.length <= 1 && cols.type.length === 1 && cols.gap, cols);
    ok('depth rows: ✉ Ask client + → Brief, no PDP scan (a product page holds one product, not a count)',
      [img, hl, det].every((r) => r.ask && r.brief && !r.pdp));
    const d = await dial(page), e = LG.goldenScore(attrs, LG.profileFor('Reiss', {})).score;
    ok('the dial is the engine\'s score — depth in, the presence rows it replaces out', d === e, [d, e]);
    const noDep = LG.goldenScore(attrsWith(false), LG.profileFor('Reiss', {})).score;
    ok('…and depth costs points a filled column hid (98% filled, 91.5% full; 70% filled, 41.3% full)', e < noDep, [e, noDep]);
    // ✉ Ask client — the per-product proposal, and the plan task it files
    await page.click('.at-row [data-ask="img_depth"]');
    const ask = await page.evaluate(() => ({ sub: document.getElementById('ask-subject').value, body: document.getElementById('ask-body').value,
      hint: document.querySelector('.askp .hint').textContent }));
    ok('✉ Ask client composes the per-product proposal, not "add the attribute"',
      ask.sub === 'Reiss GB — feed data: proposal to add more images per product' &&
      /82\.3% of products carry 4 or more images \(4\.6 per product on average\)/.test(ask.body) && /Google allows the main image plus up to ten more/.test(ask.body), ask);
    ok('…and names the plan task in words, the same words the worker files', /Golden Record Fix - Images per product"/.test(ask.hint), ask.hint);
    // → Brief
    const nav = new Promise((res) => page.on('request', (rq) => { if (/brief=/.test(rq.url())) res(rq.url()); }));
    await page.click('#ask-cancel').catch(() => {});
    await page.click('.at-row [data-brief="detail_depth"]');
    const url = await Promise.race([nav, new Promise((res) => setTimeout(() => res(null), 3000))]);
    let b = null;
    try { const x = /brief=([^&]+)/.exec(url)[1].replace(/-/g, '+').replace(/_/g, '/'); b = JSON.parse(Buffer.from(x, 'base64').toString('utf8')); } catch (e) {}
    ok('→ Brief opens a details brief in words (cat data), scoped with the count and what was not counted',
      b && b.cat === 'data' && /^Golden Record Fix - Details per product - Reiss GB - \d{4}$/.test(b.task) &&
      /1\.4 details per product on average; 12\.5% of 9,600 products carry 3 or more \(depth score 41\.3%\)/.test(b.scope) &&
      /Not counted: 4,100 care lines, 900 repeats of other attributes/.test(b.scope) && /Target: 3\+ details on every product/.test(b.scope), b);
    await page.close();
  }

  console.log('── the exports carry the depth rows');
  {
    const attrs = attrsWith(true);
    const page = await open('Reiss', attrs);
    await page.click('#det-csv');
    await page.waitForFunction(() => window.__blobs.length > 0);
    const csv = (await page.evaluate(() => window.__blobs[0])).split('\n');
    const line = (n) => csv.find((l) => l.indexOf(n + ',') === 0) || '';
    ok('the CSV names the depth rows in words with their depth score', /^images_per_product,feedspark_standard,9408,91\.5,9600/.test(line('images_per_product')) &&
      /^highlights_per_product,recommended,8448,78,9600/.test(line('highlights_per_product')) && /^details_per_product,feedspark_standard,6720,41\.3,/.test(line('details_per_product')),
      [line('images_per_product'), line('highlights_per_product'), line('details_per_product')]);
    await page.click('#det-html');
    await page.waitForFunction(() => window.__blobs.length > 1);
    const html = await page.evaluate(() => window.__blobs[1]);
    const xp = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await xp.setContent(html.replace(/<link[^>]+fonts[^>]*>/g, ''));
    const xr = await xp.evaluate(() => ({ cards: Array.from(document.querySelectorAll('.dep-card')).filter((c) => c.offsetHeight > 0).map((c) => c.getAttribute('data-dep')),
      rows: Array.from(document.querySelectorAll('.dep-nm')).map((n) => n.textContent), acts: document.querySelectorAll('[data-ask],[data-brief]').length }));
    ok('the client\'s ⬇ HTML shows the three depth rows and their cards, with no AM buttons',
      xr.cards.join() === 'img_depth,hl_depth,detail_depth' && xr.rows.length === 3 && xr.acts === 0, xr);
    await xp.close();
    await page.evaluate(() => document.body.classList.add('pdf'));
    const pv = await page.$$eval('.dep-card', (cs) => cs.filter((c) => getComputedStyle(c).display !== 'none' && c.offsetHeight > 0).length);
    const pdfOpen = await page.evaluate(() => { const ds = Array.from(document.querySelectorAll('details.dep-more')); ds.forEach((d) => { d.open = true; }); return ds.length; });
    ok('…and a paper copy can carry every explanation open (preparePdf opens the folds)', pdfOpen === 3 && /details\.dep-more:not\(\[open\]\)/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html'), 'utf8')));
    ok('…and the PDF layout prints the cards', pv === 3, pv);
    await page.close();
  }

  console.log('── not measured (a sheet-read feed, or a snapshot from before 7 Oct)');
  {
    const attrs = attrsWith(false);
    const page = await open('Reiss', attrs);
    const img = await row(page, 'images per product'), ail = await row(page, 'additional_image_link');
    ok('the depth row says NOT MEASURED, and that the presence row scores until the next XML scan',
      img && /not measured/i.test(img.miss) && /g:additional_image_link scores until the next XML scan/.test(img.note) && !img.card, img);
    ok('…with nothing to act on', img && !img.ask && !img.brief && !img.pdp);
    ok('the presence row scores as it always did — no "scored by depth" chip', ail && !ail.byDepth && ail.cov === '98%', ail);
    const d = await dial(page), e = LG.goldenScore(attrs, LG.profileFor('Reiss', {})).score;
    ok('the dial is the engine\'s score with depth left out entirely', d === e, [d, e]);
    await page.close();
  }

  console.log('── a non-fashion brand (Pet Care)');
  {
    const attrs = attrsWith(true);
    const page = await open('YuMOVE', attrs);
    const img = await row(page, 'images per product'), life = await row(page, 'lifestyle_image_link'), ss = await row(page, 'size_system');
    ok('lifestyle images are waived — a joint supplement is not worn', life && life.waived, life);
    ok('images per product scores, but without the Fashion ★', img && !img.star && !img.waived, img);
    ok('size_system is waived for Pet Care, not ★', ss && ss.waived && !ss.star, ss);
    const d = await dial(page), e = LG.goldenScore(attrs, LG.profileFor('YuMOVE', {})).score;
    ok('the dial is the engine\'s score under the Pet Care profile', d === e, [d, e]);
    await page.click('#prof-edit');
    const chips = await page.$$eval('.profp [data-pk]', (cs) => cs.map((c) => [c.getAttribute('data-pk'), c.textContent]));
    const lbl = (k) => (chips.find((c) => c[0] === k) || [])[1];
    ok('the ⚙ editor offers the depth rows by name, so a brand can ★ or waive them',
      lbl('img_depth') === 'images per product' && lbl('hl_depth') === 'highlights per product' && lbl('detail_depth') === 'details per product', chips.slice(-12));
    await page.close();
  }

  console.log('── a saved Fashion profile from before 7 Oct (v1) picks up the new defaults');
  {
    const attrs = attrsWith(true);
    const saved = { expected: ['color', 'size', 'gender', 'age_group', 'item_group_id', 'material'], waived: [] };
    const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    const ans = Object.assign({}, profAns, { overrides: { clients: { Reiss: saved } } });
    await page.addInitScript(({ attrs, ROWS, ans }) => {
      try { localStorage.clear(); } catch (e) {}
      const real = window.fetch.bind(window);
      const cov = {}; Object.keys(attrs).forEach((k) => { cov[k] = attrs[k].present ? attrs[k].cov : null; });
      window.fetch = (url, o) => {
        const u = String(url), j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': { client: 'Reiss', mkt: 'gb', status: 'ok', t: Date.now(), rows: ROWS, cov } }, alerts: {}, daily: null });
        if (u.includes('/api/golden/history')) return j({ hist: null });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: Date.now(), rows: ROWS, client: 'Reiss', market: 'gb', attrs }, baseline: null, daily: null });
        if (u.includes('/api/golden/profile')) return j(ans);
        return j({});
      };
    }, { attrs, ROWS, ans });
    await page.goto(PAGE);
    await page.waitForSelector('.at-row', { timeout: 8000 });
    await page.waitForTimeout(300);
    const img = await row(page, 'images per product'), mat = await row(page, 'material');
    ok('the brand\'s own ★ material stands, and images per product is ★ from the new default', img && img.star && mat && mat.star, [img && img.star, mat && mat.star]);
    const d = await dial(page), e = LG.goldenScore(attrs, LG.profileFor('Reiss', { clients: { Reiss: saved } })).score;
    ok('…and the dial is the engine\'s score under the same layering', d === e, [d, e]);
    await page.close();
  }

  console.log('── on a phone');
  {
    const page = await open('Reiss', attrsWith(true), { width: 390, height: 844 });
    const ov = await page.$$eval('.dep-card', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    ok('the depth cards fit a 390px screen', ov.length === 3 && ov.every((x) => x[0] >= 0 && x[1] <= 390), ov);
    await page.close();
  }

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? `\n✗ depth in the Golden Score: ${fail} failed` : '\n✓ depth in the Golden Score: all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
