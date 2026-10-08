#!/usr/bin/env node
/* SOCIAL DPA tripwire (Playwright, presync). Drives the real /social page on its demo products (drawn by the page
 * itself — tools/social_stub.js hands over the four engines and an empty roster) and checks what a source read
 * cannot: the six networks actually PAINT the product, the schedule moves the words on them as the moment
 * changes, a figure that is missing or too small stands its rule down ON SCREEN, the safe zones show, a network
 * can take its own picture, an overlay design changes the pixels, an idea joins the schedule at the top, the
 * week grid fills, every section folds and remembers, the PNG export downloads, and the phone has no sideways
 * scroll. CI has no browsers; this lives in presync. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright not installed — social tripwire skipped'); process.exit(0); }
const D = path.join(__dirname, '..', 'docs');
const css = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); return s.slice(s.indexOf('/* FCC-DESIGN:START */'), s.indexOf('/* FCC-DESIGN:END */') + 22); })();
const html = fs.readFileSync(path.join(D, 'FeedSpark_Social.html'), 'utf8').split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + css + '</style>');
const tmp = path.join(os.tmpdir(), 'FeedSpark_Social.html'); fs.writeFileSync(tmp, html);
const STUB = "window.fetch=function(url,opts){url=String(url);var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};\n"
  + require('./social_stub.js').stubLines() + " return j({ok:false,error:'stub'},404);};";
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why !== undefined ? ' — ' + JSON.stringify(why) : '')); } };

// a canvas's pixel signature: how much of it is not the plate, and a coarse hash to tell two paintings apart
const SIG = `(sel) => { const c = document.querySelector(sel); if (!c) return null; const g = c.getContext('2d'), W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
  let navy = 0, h = 0, n = 0; for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) { const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
    if (b > 100 && r < 70 && gg < 90) navy++; h = (h * 31 + (r >> 4) * 7 + (gg >> 4) * 3 + (b >> 4)) >>> 0; n++; } return { W, H, navy: navy / n, h }; }`;
const setMoment = (date, hour) => `(() => { const d = document.getElementById('cx-date'); d.value = '${date}'; d.dispatchEvent(new Event('change', { bubbles: true }));
  const h = document.getElementById('cx-hour'); h.value = ${hour}; h.dispatchEvent(new Event('input', { bubbles: true })); })()`;
const nowTag = `(() => { const f = Array.from(document.querySelectorAll('#now .f')).find((e) => /Image tagline/.test(e.textContent)); return f ? f.textContent : ''; })()`;

(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(STUB);
  await p.goto('file://' + tmp); await p.waitForTimeout(2200);

  console.log('· the demo set opens on its own');
  t('no script errors', !errs.length, errs);
  t('the status line says these are DEMO products', /Demo products/.test(await p.textContent('#mstate')));
  t('six demo products in the strip, each with a picture', (await p.$$eval('#strip .pc img', (a) => a.filter((i) => i.naturalWidth > 0).length)) === 6);

  const folds = await p.$$eval('section[data-fold]', (a) => a.map((c) => c.classList.contains('folded')));
  t('a fresh device opens the first two sections only (product + previews)', folds.join() === 'false,false,true,true,true,true,true', folds);
  for (const id of ['sec-sched', 'sec-week']) await p.click('#' + id + ' .fhd');

  console.log('· six networks, side by side, each painting the product');
  const mocks = await p.$$eval('#pv .mock', (a) => a.map((m) => m.getAttribute('data-mock')));
  t('six previews: FB Feed, IG Feed, IG Stories, IG Reels, Pinterest, TikTok', mocks.join() === 'fb_feed,ig_feed,ig_story,ig_reels,pinterest,tiktok', mocks);
  const sigs = {};
  for (const id of mocks) sigs[id] = await p.evaluate('(' + SIG + ')(\'[data-mock="' + id + '"] canvas\')');
  t('every canvas carries the product (navy trainer pixels on each)', mocks.every((id) => sigs[id] && sigs[id].navy > 0.01), Object.fromEntries(mocks.map((id) => [id, sigs[id] && sigs[id].navy])));
  t('each canvas has its network’s shape: 1:1, 4:5, 9:16, 9:16, 2:3, 9:16', ['1', '1.25', '1.78', '1.78', '1.5', '1.78'].join() === mocks.map((id) => (sigs[id].H / sigs[id].W).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')).join(), mocks.map((id) => sigs[id].H / sigs[id].W));
  t('the chrome is on each: Sponsored on Meta, Promoted by on Pinterest, the TikTok button', (await p.$eval('[data-mock="fb_feed"]', (e) => /Sponsored/.test(e.textContent))) && (await p.$eval('[data-mock="pinterest"]', (e) => /Promoted by/.test(e.textContent))) && !!(await p.$('[data-mock="tiktok"] .tt-cta')));
  t('the meter says the long demo title is OVER Meta’s 40-character headline', /over 40/.test(await p.textContent('[data-mock="fb_feed"] .meter')));
  t('TikTok says it has no headline slot', /no headline slot/.test(await p.textContent('[data-mock="tiktok"] .meter')));
  t('Pinterest says its button was mapped (no “Shop now” there)', /button → Shop/.test(await p.textContent('[data-mock="pinterest"] .meter')));

  console.log('· the schedule moves the words as the moment changes');
  await p.evaluate(setMoment('2026-10-10', 20)); await p.waitForTimeout(400);   // a Saturday evening
  t('Saturday 20:00 → the weekend offer', /Weekend offer — 20% off/.test(await p.evaluate(nowTag)), await p.evaluate(nowTag));
  t('…and the FB Feed meter names the rule', /tagline: Weekend flash/.test(await p.textContent('[data-mock="fb_feed"] .meter')));
  const satSig = await p.evaluate('(' + SIG + ')(\'[data-mock="fb_feed"] canvas\')');
  await p.evaluate(setMoment('2026-10-06', 20)); await p.waitForTimeout(400);   // a Tuesday evening
  t('Tuesday 20:00 → live interest: 312 people viewed this today', /312 people viewed this today/.test(await p.evaluate(nowTag)));
  const tueSig = await p.evaluate('(' + SIG + ')(\'[data-mock="fb_feed"] canvas\')');
  t('…and the PICTURE changed with it (the tagline is painted on)', satSig.h !== tueSig.h);
  await p.fill('#cx-views', '3'); await p.waitForTimeout(500);
  t('3 views in 24 hours is too small to print → 30-day clicks instead', /1,267 clicks in the last 30 days/.test(await p.evaluate(nowTag)));
  t('…and the 24-hour rule says why it stood down, on its card', /under the 10 a shopper would read as proof|not ≥ 50/.test(await p.$$eval('#rules .rule', (a) => a[1].textContent)), await p.$$eval('#rules .rule', (a) => a[1].textContent));
  await p.fill('#cx-views', '312'); await p.waitForTimeout(400);
  await p.click('#cx-aud [data-aud="carted"]'); await p.waitForTimeout(300);
  t('a shopper who added it to their basket gets “Buy now”', /Buy now/.test(await p.textContent('[data-mock="fb_feed"] .cta')));
  await p.click('#cx-aud [data-aud="prospect"]'); await p.waitForTimeout(200);

  console.log('· safe zones, pictures per network, overlay designs');
  t('safe zones hidden until asked for', !(await p.$eval('[data-mock="ig_story"] .safe-h', (e) => getComputedStyle(e).display !== 'none')));
  await p.check('#safe');
  t('…and hatched on Stories when ticked', await p.$eval('[data-mock="ig_story"] .safe-h', (e) => getComputedStyle(e).display !== 'none'));
  const before = await p.evaluate('(' + SIG + ')(\'[data-mock="tiktok"] canvas\')');
  await p.click('#imgmode [data-m="per"]'); await p.waitForTimeout(200);
  await p.selectOption('[data-pimg="tiktok"]', '1'); await p.waitForTimeout(500);
  const after = await p.evaluate('(' + SIG + ')(\'[data-mock="tiktok"] canvas\')');
  const fbNow = await p.evaluate('(' + SIG + ')(\'[data-mock="fb_feed"] canvas\')');
  t('a picture per network: TikTok takes the lifestyle shot, Facebook keeps the packshot', before.h !== after.h && fbNow.h === tueSig.h, { before: before.h, after: after.h, fb: fbNow.h, tue: tueSig.h });
  await p.click('#dgal [data-d="pill-badge"]'); await p.waitForTimeout(400);
  const pill = await p.evaluate(`(() => { const c = document.querySelector('[data-mock="fb_feed"] canvas'), g = c.getContext('2d'); const d = g.getImageData(Math.round(c.width * 0.08), Math.round(c.height * 0.06), 1, 1).data; return [d[0], d[1], d[2]]; })()`);
  t('the Pill badge design paints its orange “20% OFF” in the corner', pill[0] > 200 && pill[1] > 80 && pill[1] < 140 && pill[2] < 60, pill);

  console.log('· ideas, the week, the folds');
  await p.click('#sec-ideas .fhd'); await p.waitForTimeout(150);
  const nRules = await p.$$eval('#rules .rule', (a) => a.length);
  await p.click('[data-idea="rain"]'); await p.waitForTimeout(300);
  await p.click('#cx-wx [data-wx="rain"]'); await p.waitForTimeout(300);
  t('an idea joins the schedule at the TOP and wins on a rainy moment', (await p.$$eval('#rules .rule', (a) => a.length)) === nRules + 1 && /Made for rainy days/.test(await p.evaluate(nowTag)), await p.evaluate(nowTag));
  t('the week grid: 7 days × 5 dayparts', (await p.$$eval('#wk .c', (a) => a.length)) === 35);
  await p.click('#wk .c[data-wd="1"][data-wh="9"]'); await p.waitForTimeout(300);
  t('a week cell sets the moment (Monday 09:00)', /Monday 09:00/.test(await p.textContent('#moment')));

  t('a section head opens its section', !(await p.$eval('#sec-ideas', (e) => e.classList.contains('folded'))) && (await p.$eval('#sec-ideas .fhd', (e) => e.getAttribute('aria-expanded'))) === 'true');
  await p.reload(); await p.waitForTimeout(1800);
  t('…and the device remembers it', !(await p.$eval('#sec-ideas', (e) => e.classList.contains('folded'))));
  await p.click('#fold-all'); await p.waitForTimeout(150);
  t('Fold all folds every section and the button offers the way back', (await p.$$eval('section[data-fold]', (a) => a.every((c) => c.classList.contains('folded')))) && /Open all/.test(await p.textContent('#fold-all')));
  await p.click('#fold-all'); await p.waitForTimeout(400);

  console.log('· exports');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('[data-png="ig_story"]')]);
  t('⬇ PNG downloads the creative, named for the network', !!dl && /ig_story\.png$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());

  console.log('· the phone');
  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await ph.newPage(); await q.addInitScript(STUB); await q.goto('file://' + tmp); await q.waitForTimeout(2200);
  t('no sideways scroll at 390px', (await q.evaluate(() => document.documentElement.scrollWidth)) <= 391, await q.evaluate(() => document.documentElement.scrollWidth));
  t('the previews stack one a row and still paint', (await q.$$eval('#pv .mock', (a) => a.length)) === 6 && (await q.evaluate('(' + SIG + ')(\'[data-mock="ig_reels"] canvas\')')).navy > 0.01);

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
