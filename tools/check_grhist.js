#!/usr/bin/env node
/* Golden Record SCORE HISTORY tripwire (Ray, 24 Sep 2026: "Can the Golden Score module record
   historic changes in terms of improvement or deduction from the previous scan, please? That
   would be good to show clients on improvement progress. At the same time, maybe also track it
   on a day-to-day basis, similar to [product] volumes").

   A source read cannot see the things that make this card right or wrong — whether a day nobody
   scanned draws as a gap or as a flat copy, whether a deduction lands BELOW the line, whether
   editing the brand's profile re-bases the whole history rather than reading as the feed moving,
   whether the client download keeps the chart and drops the hover furniture. So this renders the
   REAL page against a stubbed FCC carrying a forty-day record and uses it.

   Playwright-based, so it runs in presync (like check_grpdf), not in validate.yml.
   Run: NODE_PATH=$(npm root -g) node tools/check_grhist.js   (GRHIST_SHOT=/dir keeps screenshots)
*/
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}
const fs = require('fs');
const os = require('os');
const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_GoldenRecord.html');
const SHOT = process.env.GRHIST_SHOT || '';

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const DAY = 864e5;
const today = new Date(); today.setUTCHours(12, 0, 0, 0);
const T = (n) => today.getTime() - n * DAY;          // n days ago, midday UTC
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// the feed on its first recorded day — every required attribute full, the optimisation surface part-filled
const BASE = { id: 100, title: 100, description: 95, link: 100, image_link: 100, availability: 100, price: 100,
  brand: 100, gtin: 98, condition: 100, item_group_id: 100, color: 90, size: 96, gender: 100, age_group: 100,
  google_product_category: 100, product_type: 100, sale_price: 30, additional_image_link: 80, material: 40, pattern: 20 };
const step = (from, patch) => { const c = Object.assign({}, from); Object.keys(patch).forEach((k) => { if (patch[k] == null) delete c[k]; else c[k] = patch[k]; }); return c; };
const R0 = BASE;
const R1 = step(R0, { material: 55 });                    // 30 days ago: +15pp material
const R2 = step(R1, { product_highlight: 60 });           // 21 days ago: highlights arrive
const R3 = step(R2, { color: 80 });                       // 14 days ago: colour slips — a deduction, read BY HAND
const R3b = step(R3, { color: 90 });                      // …and an automatic scan six hours later reads it back up
const R4 = step(R3, { material: 70 });                    // 7 days ago
const R5 = step(step(R4, { color: 90 }), { description: 99 });   // 2 days ago (the colour back at 90)
const R4x = step(R3b, { material: 70 });
const READS = [[40, R0, 1000], [30, R1, 1000], [21, R2, 1010], [14, R3, 1010, 1], [13.75, R3b, 1010], [7, R4x, 1040], [2, step(R4x, { description: 99 }), 1040]]
  .map(([d, cov, rows, m]) => Object.assign({ t: T(d), rows, cov }, m ? { m: 1 } : {}));
const SCANNED = [];
for (let d = 40; d >= 0; d--) if (d < 8 || d > 10) SCANNED.push(iso(T(d)));   // 8–10 days ago: not scanned
const HIST = { v: 1, r: READS, s: SCANNED, q: [{ t: T(20), q: 72.4, air: 55, tier: 2 }, { t: T(3), q: 80.5, air: 58, tier: 2, m: 1 },
  { t: T(3) + 4 * 3600e3, q: 61, air: 50, tier: 2 }] };
const DAILY = { day: iso(T(0)), t: T(0) - 3 * 3600e3, feeds: 49, quality: 47, kept: 1, failed: 1, by: 'schedule' };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (opts) => {
    const page = await browser.newPage({ viewport: opts.vp || { width: 1360, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(({ HIST, R5, R4, NOW, T2, waive, dark, noHist, rng, DAILY }) => {
      try {
        localStorage.clear();
        if (dark) localStorage.setItem('fcc-theme', 'dark');
        if (rng) localStorage.setItem('gr-hist-rng', rng);
      } catch (e) {}
      const attrs = {};
      Object.keys(R5).forEach((k) => { attrs[k] = { present: true, cov: R5[k], filled: Math.round(R5[k] * 10.4) }; });
      const feed = { client: 'Reiss', mkt: 'gb', status: 'ok', t: NOW, rows: 1040, score: 80, ai: { n: 0, of: 6 }, cov: R5,
        reqMissing: [], hp: { t: NOW - 7 * 864e5, rows: 1040, cov: R4 }, ht: T2 };
      const real = window.fetch.bind(window);
      window.fetch = (url, o) => {
        const u = String(url);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/engine\.js/.test(u)) return real(url, o);
        if (u.includes('/api/golden/estate')) return j({ feeds: { 'Reiss|gb': feed }, alerts: {}, daily: DAILY });
        if (u.includes('/api/golden/history')) return j({ hist: noHist ? null : HIST });
        if (u.includes('/api/golden/snapshot')) return j({ snapshot: { t: NOW, rows: 1040, client: 'Reiss', market: 'gb', attrs }, baseline: { t: NOW - 7e6, attrs }, daily: null });
        if (u.includes('/api/golden/profile')) return j({ defaults: {}, overrides: waive ? { clients: { Reiss: { expected: [], waived: waive } } } : {}, industryMap: {} });
        if (u.includes('/api/golden/alertcfg')) return j({ on: false, to: '' });
        return j({});
      };
    }, Object.assign({ HIST, R5, R4, NOW: Date.now(), T2: T(2), DAILY }, opts));
    await page.goto(PAGE);
    await page.waitForSelector('#hs-tier .hs-svg, #hs-tier .hs-empty-note', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    return page;
  };

  const read = (page) => page.evaluate(() => {
    const tier = document.getElementById('hs-tier');
    const svg = tier && tier.querySelector('.hs-svg');
    const bars = svg ? Array.from(svg.querySelectorAll('path[style]')) : [];
    const mid = (() => { const a = svg && svg.querySelector('line.axis'); return a ? +a.getAttribute('y1') : null; })();
    const barInfo = bars.map((b) => { const bb = b.getBBox(); return { up: /--hup/.test(b.getAttribute('style')), top: bb.y, bot: bb.y + bb.height, fill: getComputedStyle(b).fill }; });
    const hits = svg ? svg.querySelectorAll('.hit').length : 0;
    const dots = svg ? svg.querySelectorAll('circle.z').length : 0;
    const segs = svg ? (svg.querySelector('path.ln').getAttribute('d').match(/M/g) || []).length : 0;
    const kpis = Array.from(document.querySelectorAll('#hs-tier .hs-k')).map((k) => k.innerText.replace(/\s+/g, ' ').trim());
    const logRows = Array.from(document.querySelectorAll('#hs-tier .hs-log tbody tr')).map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    const more = document.querySelector('#hs-tier .hs-more');
    const est = document.querySelector('.est-mkt .est-su span i');
    return { has: !!tier, empty: !!(tier && tier.classList.contains('hs-empty')), bars: barInfo, mid, hits, dots, segs, kpis, logRows,
      more: more ? more.textContent : null, est: est ? { t: est.textContent, c: est.className } : null,
      rng: (tier && tier.querySelector('.hs-rng:not(.hs-met) .on') || {}).textContent || null,
      met: (tier && tier.querySelector('.hs-met .on') || {}).textContent || null };
  });

  console.log('── the card, against a forty-day record');
  const page = await open({});
  const a = await read(page);
  ok('the Score history card renders under the scorecard header', a.has && !a.empty);
  ok('the default window is 90 days', a.rng === '90 days', a.rng);
  // 41 calendar days from the first reading to today; the record starts inside the window
  ok('one day column per calendar day from the first reading to today', a.hits === 41, a.hits);
  const ups = a.bars.filter((b) => b.up), dns = a.bars.filter((b) => !b.up);
  ok('the improvements draw ABOVE the zero line', ups.length >= 4 && ups.every((b) => b.bot <= a.mid + 0.5), ups);
  ok('the colour slip draws BELOW it — a deduction is a bar under the line', dns.length === 1 && dns[0].top >= a.mid - 0.5, dns);
  // Ray, 24 Sep 2026: "If there's a manual scan on any day, that new score can override that day" —
  // the colour slip was read BY HAND and an automatic scan six hours later read it back; the day
  // stays the hand-run reading, so the recovery lands on the NEXT day instead of erasing the slip
  ok('a day with a scan run by hand is set by that scan, even when an automatic one came after it', dns.length === 1 && ups.length >= 5, { ups: ups.length, dns: dns.length });
  ok('…and wears a ring on the line', await page.$$eval('#hs-tier circle.pt.man', (e) => e.length) === 1);
  // 41 days − 3 not scanned − 6 moves (5 recorded + the live day is the same as the last one) → dots
  ok('a scanned day with no change is a dot on the line, not a bar', a.dots >= 25, a.dots);
  ok('the three days nobody scanned are a GAP in the line, never a flat copy', a.segs === 2, a.segs);
  ok('the headline reads the last change and the move over the window',
    a.kpis.some((x) => /^Last change ▲ \+\d/i.test(x)) && a.kpis.some((x) => /^Since tracking began ▲ \+\d/i.test(x)), a.kpis);
  ok('a window longer than the record never claims the days it did not see', !a.kpis.some((x) => /^Over 90 days/i.test(x)), a.kpis);
  ok('content quality and AI-readiness ride along as analysed',
    a.kpis.some((x) => /Content quality 80\.5 ▲ \+8\.1/i.test(x)) && a.kpis.some((x) => /AI-readiness 58 ▲ \+3/i.test(x)), a.kpis);
  ok('the change log lists the latest six, newest first', a.logRows.length === 6 && /Golden Score/.test(a.logRows[0]) && /g:description ▲ \+4pp/.test(a.logRows[0]), a.logRows.slice(0, 2));
  ok('…with the deduction named by the attribute that moved — and marked as run by hand', a.logRows.some((x) => /by hand/.test(x) && /g:color ▼ −10pp/.test(x)), a.logRows);
  ok('…and the rest one click away', /Show all 7 changes/.test(a.more || ''), a.more);
  ok('the card says the tracker fills itself at 09:00 UK, and when it last ran', await page.$eval('#hs-tier .hs-auto', (e) => /auto 09:00 UK · last/.test(e.textContent) && /47 feeds analysed/.test(e.title)));
  ok('the estate row names the last move under the feed score', a.est && /^▲[\d.]+$/.test(a.est.t) && a.est.c === 'up', a.est);

  // hover a deduction day — the tooltip names what moved
  const dIdx = await page.evaluate(() => {
    const hits = Array.from(document.querySelectorAll('#hs-tier .hit'));
    return hits.length - 1 - 14;
  });
  await page.$eval('#hs-tier .hs-svg', (e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const box = await page.$$eval('#hs-tier .hit', (h, i) => { const r = h[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; }, dIdx);
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(200);
  const tip = await page.$eval('#hs-tip', (t) => ({ o: getComputedStyle(t).opacity, txt: t.innerText }));
  ok('hovering a day says what moved that day', +tip.o > 0.5 && /▼ −/.test(tip.txt) && /g:color/.test(tip.txt), tip);
  const gapIdx = 41 - 1 - 9;
  const gbox = await page.$$eval('#hs-tier .hit', (h, i) => { const r = h[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; }, gapIdx);
  await page.mouse.move(gbox.x, gbox.y);
  await page.waitForTimeout(150);
  ok('…and a gap day says it was not scanned', /not scanned/.test(await page.$eval('#hs-tip', (t) => t.innerText)));
  if (SHOT) await page.screenshot({ path: path.join(SHOT, 'grhist_light.png'), clip: await page.$eval('#hs-tier', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; }), fullPage: true });

  // the range chips re-draw in place and are remembered on the device
  await page.click('[data-hrng="30"]');
  await page.waitForTimeout(200);
  const b30 = await read(page);
  ok('30 days re-draws the window in place', b30.hits === 30 && b30.rng === '30 days', { hits: b30.hits, rng: b30.rng });
  ok('…the window\'s first day still moves against the reading before it', b30.kpis.some((x) => /^Over 30 days ▲/i.test(x)), b30.kpis);
  ok('…and the choice is remembered on this device', await page.evaluate(() => localStorage.getItem('gr-hist-rng')) === '30');
  await page.click('[data-hmore]').catch(() => {});

  console.log('── the history follows the brand\'s CURRENT profile');
  await page.click('[data-hrng="90"]');
  await page.waitForTimeout(150);
  const base90 = await read(page);
  const w = await open({ waive: ['material', 'color'] });
  const b = await read(w);
  ok('waive the attributes that moved and their days stop reading as moves — the line is re-based, not rewritten',
    b.bars.length === base90.bars.length - 4 && !b.bars.some((x) => !x.up), { before: base90.bars.length, after: b.bars.length });
  ok('…and the log says so: the colour change costs the score nothing now', b.logRows.some((x) => /±0/.test(x) && /g:color/.test(x)), b.logRows);
  await w.close();

  console.log('── content quality, day by day');
  await page.click('[data-hmet="q"]');
  await page.waitForTimeout(200);
  const cq = await read(page);
  ok('the chart switches to content quality', await page.$eval('#hs-tier .hs-svg text.pl', (t) => /CONTENT QUALITY · DAY BY DAY/.test(t.textContent)));
  // two analyses seventeen days apart: the first is a dot (nothing before it to compare), the days
  // between draw nothing at all, and the line is two points — never a flat run across the gap
  ok('a day with no analysis is a gap — nothing drawn, not a flat copy', cq.dots === 1 && cq.hits >= 21 && cq.met === 'Content quality', { dots: cq.dots, met: cq.met });
  ok('the hand-run analysis holds its day over the automatic one four hours later',
    cq.bars.length === 1 && cq.bars[0].up && cq.kpis.some((x) => /Content quality 80\.5/i.test(x)), { bars: cq.bars.length, kpis: cq.kpis });
  ok('the log lists the analyses, the hand-run one marked', cq.logRows.length === 3 && cq.logRows.some((x) => /by hand/.test(x) && /80\.5/.test(x)), cq.logRows);
  ok('…and the choice is remembered on this device', await page.evaluate(() => localStorage.getItem('gr-hist-met')) === 'q');
  await page.click('[data-hmet="gs"]');
  await page.waitForTimeout(150);

  console.log('── the client PDF (body.pdf is the layout both client documents share)');
  const pdf = await page.evaluate(() => {
    document.body.classList.add('pdf');
    const t = document.getElementById('hs-tier');
    const vis = (e) => !!e && getComputedStyle(e).display !== 'none';
    const r = { card: vis(t), bars: t.querySelectorAll('.hs-svg path[style]').length,
      offRange: Array.from(t.querySelectorAll('.hs-rng button:not(.on)')).filter(vis).length,
      onRange: vis(t.querySelector('.hs-rng .on')), more: vis(t.querySelector('.hs-more')) };
    document.body.classList.remove('pdf');
    return r;
  });
  ok('the PDF prints the history with only the active range chip and no Show-all button',
    pdf.card && pdf.bars > 0 && pdf.offRange === 0 && pdf.onRange && !pdf.more, pdf);

  console.log('── the client download');
  await page.evaluate(() => {
    window.__html = null;
    const real = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (bl) { bl.text().then((t) => { window.__html = t; }); return real(bl); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.click('#det-html');
  await page.waitForFunction(() => window.__html !== null, null, { timeout: 15000 });
  const html = await page.evaluate(() => window.__html);
  const tmp = path.join(os.tmpdir(), 'grhist_export_' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  const out = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await out.goto('file://' + tmp);
  await out.waitForTimeout(300);
  const x = await out.evaluate(() => {
    const t = document.getElementById('hs-tier');
    return { has: !!t, bars: t ? t.querySelectorAll('.hs-svg path[style]').length : 0,
      buttons: t ? t.querySelectorAll('button').length : -1,
      rng: Array.from(t ? t.querySelectorAll('.hs-rng .on') : []).map((e) => e.tagName + ':' + e.textContent).join(' + '),
      hits: t ? t.querySelectorAll('.hit').length : -1, tip: !!document.getElementById('hs-tip'),
      log: t ? t.querySelectorAll('.hs-log tbody tr').length : 0 };
  });
  ok('the download carries the history — chart and change log', x.has && x.bars > 0 && x.log === 6, x);
  ok('…the metric and the range as plain chips, no button a script would have to answer', x.buttons === 0 && x.rng === 'SPAN:Golden Score + SPAN:90 days', x);
  ok('…and none of the hover furniture', x.hits === 0 && !x.tip, x);
  fs.unlinkSync(tmp);
  await out.close();
  await page.close();

  console.log('── a feed with no history yet');
  const e = await open({ noHist: true });
  const ee = await read(e);
  ok('the card says when history starts, and marks itself empty for the client documents', ee.has && ee.empty
    && /next scan/.test(await e.$eval('#hs-tier', (t) => t.innerText)));
  ok('…and a client document drops it rather than printing an empty card', await e.evaluate(() => {
    document.body.classList.add('pdf');
    const hidden = getComputedStyle(document.getElementById('hs-tier')).display === 'none';
    document.body.classList.remove('pdf');
    return hidden;
  }));
  await e.close();

  console.log('── dark, and the phone');
  const dk = await open({ dark: true });
  const dd = await read(dk);
  ok('dark mode draws the selected dark steps, not the light ones',
    dd.bars.some((x) => /76, 130, 224/.test(x.fill)) && dd.bars.some((x) => /198, 123, 40/.test(x.fill)), dd.bars.slice(0, 2).map((x) => x.fill));
  if (SHOT) await dk.screenshot({ path: path.join(SHOT, 'grhist_dark.png'), clip: await dk.$eval('#hs-tier', (e2) => { const r = e2.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; }), fullPage: true });
  await dk.close();
  const ph = await open({ vp: { width: 390, height: 844 } });
  // the page's own topbar is reflowed by the injected phone layer (check_mobile covers that);
  // what this card owes the phone is to stay inside the screen and pan its log in its own frame
  const over = await ph.evaluate(() => { const t = document.getElementById('hs-tier'), r = t.getBoundingClientRect();
    return { right: Math.round(r.right - window.innerWidth), inner: t.scrollWidth - t.clientWidth,
      pans: (function () { const l = t.querySelector('.hs-log'); return l ? getComputedStyle(l).overflowX : null; })() }; });
  ok('at 390px the card stays inside the screen and the change log pans in its own frame', over.right <= 0 && over.inner <= 0 && over.pans === 'auto', over);
  await ph.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(fail ? `\nscore history: ${fail} failed` : '\nscore history: all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
