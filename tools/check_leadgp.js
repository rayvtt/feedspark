#!/usr/bin/env node
/* Leadership › GOLDEN RECORD — PORTFOLIO TREND tripwire (Ray, 24 Sep 2026: "should there be an
   additional interface for AM only to view these charts across their portfolio at once?" — then
   "can you build on leadership").

   The payload is built by the REAL engine (labelguard.js histSeries — what /api/golden/portfolio
   returns), then the REAL Leadership page renders it and is used the way Ray would: filter to one
   AM, switch the score, switch the window, flip to the table, hover a chart, open a feed. A source
   read cannot see the things that make this view honest or not — whether a day nobody scanned is a
   gap, whether a feed whose record began last week starts halfway across the shared calendar,
   whether "Improved / Declined" print zeros when there is nothing yet to compare, whether a remembered
   AM who has left the book opens on an empty grid.

   Playwright-based, so it runs in presync (like check_grhist), not in validate.yml.
   Run: NODE_PATH=$(npm root -g) node tools/check_leadgp.js   (LEADGP_SHOT=/dir keeps screenshots)
*/
const { createRequire } = require('module');
const path = require('path');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch (e) {
  console.log('· playwright unavailable — skipped'); process.exit(0);
}
const PAGE = 'file://' + path.resolve(__dirname, '..', 'docs', 'FeedSpark_Leadership.html');
const SHOT = process.env.LEADGP_SHOT || '';

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const DAY = 864e5;
const now = new Date(); now.setUTCHours(12, 0, 0, 0);
const T = (n) => now.getTime() - n * DAY;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const TODAY = iso(T(0));
const BASE = { id: 100, title: 100, description: 95, link: 100, image_link: 100, availability: 100, price: 100,
  brand: 100, gtin: 98, condition: 100, item_group_id: 100, color: 90, size: 96, gender: 100, age_group: 100,
  google_product_category: 100, product_type: 100, sale_price: 30, additional_image_link: 80, material: 40, pattern: 20 };
const cv = (patch) => Object.assign({}, BASE, patch || {});
const days = (from, to, skip) => { const o = []; for (let d = from; d >= to; d--) if (!(skip || []).includes(d)) o.push(iso(T(d))); return o; };

(async () => {
  const LG = await import('../cloudflare/feedspark-deck/src/labelguard.js');
  const prof = LG.profileFor('Reiss', {});
  // six feeds, three AMs (one brand the Task Manager never reached)
  const FEEDS = [
    // Reiss GB — a 20-day record, material climbing, then colour slipping hard 3 days ago (the biggest drop)
    { client: 'Reiss', mkt: 'gb', am: 'Ray', hist: { v: 1, r: [
      { t: T(20), rows: 1000, cov: cv() }, { t: T(12), rows: 1000, cov: cv({ material: 70 }) }, { t: T(3), rows: 1000, cov: cv({ material: 70, color: 40 }) }],
      s: days(20, 0, [8, 9]), q: [{ t: T(20), q: 80, air: 60, tier: 3 }, { t: T(2), q: 84, air: 61, tier: 3 }] } },
    // Reiss DE — improving
    { client: 'Reiss', mkt: 'de', am: 'Ray', hist: { v: 1, r: [
      { t: T(20), rows: 1000, cov: cv({ description: 60 }) }, { t: T(6), rows: 1000, cov: cv({ description: 99 }) }],
      s: days(20, 0), q: [{ t: T(10), q: 70, air: 55, tier: 2 }] } },
    // Schuh GB — flat
    { client: 'Schuh', mkt: 'gb', am: 'Steven', hist: { v: 1, r: [{ t: T(20), rows: 900, cov: cv() }], s: days(20, 0), q: [] } },
    // Schuh IE — the record began 5 days ago (starts late on the shared calendar)
    { client: 'Schuh', mkt: 'ie', am: 'Steven', hist: { v: 1, r: [{ t: T(5), rows: 900, cov: cv({ sale_price: 80 }) }], s: days(5, 0), q: [] } },
    // Hobbycraft GB — one reading, today
    { client: 'Hobbycraft', mkt: 'gb', am: null, hist: { v: 1, r: [{ t: T(0), rows: 800, cov: cv() }], s: [TODAY], q: [{ t: T(0), q: 87.8, air: 62, tier: 3 }] } },
    // YuMOVE GB — never scanned
    { client: 'YuMOVE', mkt: 'gb', am: 'Ray', hist: null, never: true },
  ];
  const payload = (n) => ({ ok: true, at: Date.now(), today: TODAY, days: n, scoped: false,
    daily: { day: TODAY, t: T(0) - 3 * 3600e3, feeds: 49, quality: 49, kept: 0, failed: 0 },
    feeds: FEEDS.map((f) => Object.assign({ client: f.client, mkt: f.mkt, am: f.am, ind: 'Fashion', status: f.never ? 'never' : 'ok' },
      LG.histSeries(f.hist, prof, { days: n, today: TODAY }))) });
  const P90 = payload(90), P30 = payload(30);
  const gsOf = (c, m, p) => p.feeds.find((f) => f.client === c && f.mkt === m).sum.gs;

  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const errs = [];
  const open = async (opts) => {
    const page = await browser.newPage({ viewport: opts.vp || { width: 1280, height: 950 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(({ P90, P30, st, dark, bad }) => {
      try {
        if (!sessionStorage.getItem('leadgp-init')) {
          localStorage.clear();
          if (st) localStorage.setItem('fcc-lead-gp', JSON.stringify(st));
          if (dark) localStorage.setItem('fcc-theme', 'dark');
          sessionStorage.setItem('leadgp-init', '1');
        }
      } catch (e) {}
      window.__asked = [];
      window.fetch = (url) => {
        const u = String(url);
        const j = (x) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(x) });
        if (/\/api\/golden\/portfolio/.test(u)) {
          window.__asked.push(u);
          // an unauthenticated read answers the Access LOGIN PAGE as a 200 — never content
          if (bad) return Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("Unexpected token '<'")) });
          return j(/days=30/.test(u) ? P30 : P90);
        }
        return j({});
      };
    }, Object.assign({ P90, P30 }, opts));
    await page.goto(PAGE);
    await page.waitForSelector(opts.bad ? '#gp-body .gp-empty' : '#gp-body .gp-grid, #gp-body .gp-tw', { timeout: 8000 });
    return page;
  };
  const tiles = (page) => page.$$eval('#gp-body a.gp-tile', (a) => a.map((t) => ({
    name: t.querySelector('.gp-hd b').textContent + ' ' + t.querySelector('.gp-mk').textContent,
    n: t.querySelector('.gp-n').textContent, d: (t.querySelector('.gp-d') || {}).textContent || '',
    ft: t.querySelector('.gp-ft').textContent, off: t.classList.contains('gp-off'), href: t.getAttribute('href'),
    lines: t.querySelectorAll('.gp-sp .ln').length, pts: t.querySelectorAll('.gp-sp .pt').length, now: t.querySelectorAll('.gp-sp .now').length,
    x0: (() => { const p = t.querySelector('.gp-sp .ln, .gp-sp .now'); const m = p && /M([\d.]+)/.exec(p.getAttribute('d')); return m ? +m[1] : null; })(),
  })));

  console.log('── the portfolio, movers first');
  {
    const first = await open({});
    ok('a first open reads the last 30 days', (await first.evaluate(() => window.__asked)).every((u) => /days=30/.test(u)));
    await first.close();
    const page = await open({ st: { am: '*', met: 'gs', rng: '90', ord: 'move', tbl: false } });
    const t = await tiles(page);
    ok('every feed on the book is a tile', t.length === FEEDS.length, t.length);
    const rgb = gsOf('Reiss', 'gb', P90);
    ok('the biggest drop leads', t[0].name === 'Reiss GB' && rgb.dir === 'down' && t[0].d.indexOf('▼') === 0, [t[0].name, t[0].d, rgb]);
    ok('…its figure is the engine\'s, to the decimal', t[0].n === String(rgb.now) && t[0].d.indexOf(String(Math.abs(rgb.delta))) > 0, [t[0].n, t[0].d, rgb.now, rgb.delta]);
    ok('then the gains', t[1].name === 'Reiss DE' && t[1].d.indexOf('▲') === 0, t[1]);
    ok('a flat feed says flat, not a direction', t.find((x) => x.name === 'Schuh GB').d.indexOf('≈') === 0, t.find((x) => x.name === 'Schuh GB'));
    const hc = t.find((x) => x.name === 'Hobbycraft GB');
    ok('one reading says so rather than inventing a change', hc.d === '' && /one reading so far/.test(hc.ft), hc);
    const yu = t[t.length - 1];
    ok('a feed never scanned comes last, muted, named as such', yu.name === 'YuMOVE GB' && yu.off && yu.n === '—' && /never scanned/.test(yu.ft), yu);
    ok('a day nobody scanned breaks the line — two segments, never a bridge', t[0].lines === 2, t[0].lines);
    const ie = t.find((x) => x.name === 'Schuh IE'), gb = t.find((x) => x.name === 'Schuh GB');
    ok('one calendar for every tile: a record that began 5 days ago starts near the right edge', ie.x0 > 180 && gb.x0 < ie.x0, [ie.x0, gb.x0]);
    ok('today\'s value is marked on every measured tile', t.filter((x) => !x.off).every((x) => x.now === 1));
    ok('a tile opens that feed on /golden', t[0].href === '/golden#' + encodeURIComponent('Reiss|gb'), t[0].href);
    const k = await page.$$eval('#gp-roll .kpi', (a) => a.map((x) => [x.querySelector('.n').textContent, x.querySelector('.l').textContent]));
    ok('the strip counts the moves', k[1][0] === '1' && k[2][0] === '1' && k[3][0] === '2' && k[4][0] === '1', k);
    const src = await page.$eval('#gp-src', (e) => e.textContent);
    ok('the source line names the 09:00 run and how far back the readings go', /Scored daily at 09:00 UK · last run/.test(src) && /49 analysed/.test(src) && /earliest reading in this window/.test(src), src);
    // hover: the day's value under the cursor, on the window's calendar
    await page.$eval('#gp-body a.gp-tile .gp-sp', (e) => e.scrollIntoView({ block: 'center' }));
    const box = await page.$eval('#gp-body a.gp-tile .gp-sp', (e) => { const r = e.getBoundingClientRect(); return { x: r.right - 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    const tip = await page.$eval('#gp-tip', (e) => [getComputedStyle(e).display, e.textContent]);
    ok('hovering a chart reads the day and its value', tip[0] === 'block' && /Golden Score/.test(tip[1]) && tip[1].indexOf(String(rgb.now)) > 0, tip);
    const gx = await page.$eval('#gp-body a.gp-tile .gp-sp .gx', (e) => getComputedStyle(e).visibility);
    ok('…with a crosshair on the chart', gx === 'visible', gx);
    if (SHOT) await (await page.$('#golden-pf')).screenshot({ path: path.join(SHOT, 'leadgp_movers.png') });

    // one AM's book
    await page.click('#gp-bar [data-gk="am"][data-gv="Steven"]');
    const s = await tiles(page);
    ok('filtering to an AM shows only their accounts', s.length === 2 && s.every((x) => /^Schuh/.test(x.name)), s.map((x) => x.name));
    const chips = await page.$$eval('#gp-bar [data-gk="am"]', (a) => a.map((b) => b.textContent));
    ok('each AM chip carries its count, and a brand with no AM on record is its own chip', chips.includes('All6') && chips.includes('Ray3') && chips.includes('Steven2') && chips.includes('No AM on record1'), chips);
    ok('the AM name leaves the tile once the view is one AM', !(await page.$('#gp-body .gp-am')));

    // the score being read
    await page.click('#gp-bar [data-gk="am"][data-gv="*"]');
    await page.click('#gp-bar [data-gk="met"][data-gv="q"]');
    const q = await tiles(page);
    const rq = P90.feeds.find((f) => f.client === 'Reiss' && f.mkt === 'gb').sum.q;
    ok('content quality reads the analyses', q.find((x) => x.name === 'Reiss GB').n === String(rq.now), [q.find((x) => x.name === 'Reiss GB'), rq]);
    ok('…and a feed never analysed says so', /not analysed in this window/.test(q.find((x) => x.name === 'Schuh GB').ft));
    await page.click('#gp-bar [data-gk="met"][data-gv="air"]');
    ok('AI-readiness names the tier', /^Tier 3/.test((await tiles(page)).find((x) => x.name === 'Reiss GB').ft));

    // opening a feed opens its card on the same score and window
    await page.evaluate(() => { document.querySelector('#gp-body a.gp-tile').addEventListener('click', (e) => e.preventDefault(), { once: true }); });
    await page.click('#gp-body a.gp-tile');
    const carried = await page.evaluate(() => [localStorage.getItem('gr-hist-met'), localStorage.getItem('gr-hist-rng')]);
    ok('the card opens on the score and window being read here', carried[0] === 'air' && carried[1] === '90', carried);

    // the window
    await page.click('#gp-bar [data-gk="rng"][data-gv="30"]');
    await page.waitForFunction(() => window.__asked.some((u) => /days=30/.test(u)));
    await page.waitForSelector('#gp-body .gp-grid');
    ok('switching the window asks for that window', (await page.evaluate(() => window.__asked)).some((u) => /days=30/.test(u)));

    // the table view
    await page.click('#gp-bar [data-gt]');
    const rows = await page.$$eval('#gp-body table.gp-t tbody tr', (a) => a.length);
    ok('⊞ Table lists the same feeds in the same order', rows === FEEDS.length, rows);
    // remembered per device — saved on every change, and a fresh open lands on it
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('fcc-lead-gp') || 'null'));
    ok('the view is saved on this device', kept && kept.met === 'air' && kept.rng === '30' && kept.tbl === true, kept);
    const again = await open({ st: kept });
    const on = await again.$$eval('#gp-bar .gp-chip.on', (a) => a.map((b) => b.textContent));
    ok('…and opens on it next time', !!(await again.$('#gp-body table.gp-t')) && on.includes('AI-readiness') && on.includes('30 days'), on);
    await again.close();
    await page.close();
  }

  console.log('── nothing to compare yet');
  {
    // every feed on one reading — the day the tracker started
    const one = JSON.parse(JSON.stringify(P90));
    one.feeds.forEach((f) => { if (f.start) f.start = TODAY; ['gs', 'q', 'air'].forEach((m) => { const s = f.sum[m]; s.delta = null; s.from = null; s.fromD = null; s.dir = null; }); });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript((one) => { try { localStorage.clear(); } catch (e) {} window.fetch = (u) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(/portfolio/.test(String(u)) ? one : {}) }); }, one);
    await page.goto(PAGE);
    await page.waitForSelector('#gp-body .gp-grid');
    const k = await page.$$eval('#gp-roll .kpi', (a) => a.map((x) => [x.querySelector('.n').textContent, x.querySelector('.sub2').textContent]));
    ok('Improved / Declined / Flat print a dash, not a zero, until two days are measured', k[1][0] === '—' && k[2][0] === '—' && k[3][0] === '—' && /two days/.test(k[1][1]), k);
    const src = await page.$eval('#gp-src', (e) => e.textContent);
    ok('a young record says when it began and that it fills in each morning', /record began/.test(src) && /fill in each morning/.test(src), src);
    await page.close();
  }

  console.log('── a remembered AM who has left the book');
  {
    const page = await open({ st: { am: 'Andrew', met: 'gs', rng: '90', ord: 'move', tbl: false } });
    const t = await tiles(page);
    ok('falls back to the whole book, never an empty grid', t.length === FEEDS.length, t.length);
    await page.close();
  }

  console.log('── by account');
  {
    const page = await open({ st: { am: '*', met: 'gs', rng: '90', ord: 'acct', tbl: false } });
    const h = await page.$$eval('#gp-body .gp-grp-h', (a) => a.map((x) => x.firstChild.textContent));
    ok('grouped under each account, alphabetically', JSON.stringify(h) === JSON.stringify(['Hobbycraft', 'Reiss', 'Schuh', 'YuMOVE']), h);
    const t = await tiles(page);
    ok('GB leads inside an account', t.findIndex((x) => x.name === 'Reiss GB') < t.findIndex((x) => x.name === 'Reiss DE'));
    await page.close();
  }

  console.log('── the Access login page is not a portfolio');
  {
    const page = await open({ bad: true });
    const msg = await page.$eval('#gp-body .gp-empty', (e) => e.textContent);
    ok('an HTML answer reads as a failed read, not an empty book', /Couldn’t read the portfolio/.test(msg), msg);
    await page.close();
  }

  console.log('── dark, and the phone');
  {
    const page = await open({ dark: true });
    const bg = await page.$eval('#gp-body a.gp-tile', (e) => getComputedStyle(e).backgroundColor);
    ok('dark mode puts the tiles on the dark surface', bg !== 'rgb(255, 255, 255)', bg);
    const nm = await page.$eval('#gp-body a.gp-tile .gp-hd b', (e) => getComputedStyle(e).color);
    ok('…and the account name stays ink, not the page\'s orange link colour', nm === 'rgb(231, 233, 237)', nm);
    if (SHOT) await (await page.$('#golden-pf')).screenshot({ path: path.join(SHOT, 'leadgp_dark.png') });
    await page.close();
    const ph = await open({ vp: { width: 390, height: 844 } });
    const over = await ph.$eval('#golden-pf', (e) => { const r = e.getBoundingClientRect(); return Math.round(r.right); });
    const tl = await ph.$eval('#gp-body a.gp-tile', (e) => Math.round(e.getBoundingClientRect().width));
    ok('at 390px the section fits the screen and a tile takes the width', over <= 390 && tl > 300, [over, tl]);
    if (SHOT) await (await ph.$('#golden-pf')).screenshot({ path: path.join(SHOT, 'leadgp_phone.png') });
    await ph.close();
  }

  ok('no page errors', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? `\n✗ Leadership portfolio: ${fail} failed` : '\n✓ Leadership portfolio: all passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
