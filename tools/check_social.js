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
  t('two sections — the product and the ad studio — both open on a fresh device', folds.join() === 'false,false', folds);
  t('the studio panel opens on Picture', (await p.getAttribute('#rt-pic', 'aria-selected')) === 'true' && !(await p.$eval('#rp-pic', (e) => e.hidden)) && (await p.$eval('#rp-sched', (e) => e.hidden)));
  const w0 = await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width);
  await p.click('#rt-sched'); await p.waitForTimeout(200);
  const w1 = await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width);
  t('the schedule opens IN the panel and the panel widens for it', !(await p.$eval('#rp-sched', (e) => e.hidden)) && (await p.$eval('#rp-pic', (e) => e.hidden)) && w1 > w0 + 60, { w0, w1 });
  const both = await p.evaluate(() => { const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight && r.bottom > 0; }; return { hour: vis(document.getElementById('cx-hour')), rule: vis(document.querySelector('#rules .rule')), fb: vis(document.querySelector('[data-mock="fb_feed"]')) }; });
  t('the moment, the first rule AND the Facebook preview are on screen together — no scrolling between them', both.hour && both.rule && both.fb, both);

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
  await p.click('#rt-pic'); await p.waitForTimeout(150);
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

  console.log('· the design controls ride beside the previews');
  const geo = await p.evaluate(() => { const r = document.getElementById('pv-rail').getBoundingClientRect(), m = document.querySelector('[data-mock="fb_feed"]').getBoundingClientRect(); return { rr: r.right, ml: m.left, rt: r.top, mt: m.top }; });
  t('the rail is to the LEFT of the previews, level with them', geo.rr <= geo.ml && Math.abs(geo.rt - geo.mt) < 80, geo);
  await p.evaluate(() => { const m = document.querySelector('[data-mock="ig_reels"]'); window.scrollTo(0, m.getBoundingClientRect().top + scrollY - 120); }); await p.waitForTimeout(300);
  const inView = await p.evaluate(() => { const d = document.querySelector('#dgal [data-d="burst"]').getBoundingClientRect(), tb = document.querySelector('.topbar').getBoundingClientRect().bottom, m = document.querySelector('[data-mock="ig_reels"]').getBoundingClientRect(); return { dt: d.top, db: d.bottom, tb, vh: innerHeight, mt: m.top }; });
  t('scrolled down to the Reels preview, the overlay designs are still on screen beside it', inView.dt >= inView.tb && inView.db <= inView.vh && inView.mt < inView.vh, inView);
  await p.click('#dgal [data-d="burst"]'); await p.waitForTimeout(300);
  t('…and a design picked from there repaints the preview without scrolling', /Starburst/.test(await p.textContent('#fl-prev')));
  await p.click('#dgal [data-d="pill-badge"]'); await p.waitForTimeout(200);
  await p.evaluate(() => window.scrollTo(0, 0));

  console.log('· ideas, the week, the tabs, the folds');
  await p.click('#rt-ideas'); await p.waitForTimeout(150);
  const nRules = await p.$$eval('#rules .rule', (a) => a.length);
  await p.click('[data-idea="rain"]'); await p.waitForTimeout(300);
  t('adding an idea takes you to the schedule tab', (await p.getAttribute('#rt-sched', 'aria-selected')) === 'true');
  await p.click('#cx-wx [data-wx="rain"]'); await p.waitForTimeout(300);
  t('an idea joins the schedule at the TOP and wins on a rainy moment', (await p.$$eval('#rules .rule', (a) => a.length)) === nRules + 1 && /Made for rainy days/.test(await p.evaluate(nowTag)), await p.evaluate(nowTag));
  await p.click('#rt-week'); await p.waitForTimeout(150);
  t('the week grid: 7 days × 5 dayparts', (await p.$$eval('#wk .c', (a) => a.length)) === 35);
  await p.click('#wk .c[data-wd="1"][data-wh="9"]'); await p.waitForTimeout(300);
  t('a week cell sets the moment (Monday 09:00)', /Monday 09:00/.test(await p.textContent('#moment')));

  // the grip: drag the panel wider on the Week tab, and the device keeps that width for that tab
  const gb = await p.$eval('#rgrip', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const wk0 = await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width);
  await p.mouse.move(gb.x, gb.y); await p.mouse.down(); await p.mouse.move(gb.x + 80, gb.y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
  const wk1 = await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width);
  t('dragging the panel’s edge widens it', wk1 > wk0 + 50, { wk0, wk1 });
  await p.click('#sec-prod .fhd'); await p.waitForTimeout(100);
  await p.reload(); await p.waitForTimeout(1800);
  t('…and after a reload the device keeps the tab, its width and the folded section', (await p.getAttribute('#rt-week', 'aria-selected')) === 'true' && Math.abs((await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width)) - wk1) < 3 && (await p.$eval('#sec-prod', (e) => e.classList.contains('folded'))));
  await p.dblclick('#rgrip'); await p.waitForTimeout(100);
  t('a double-click on the edge puts the tab’s width back', Math.abs((await p.$eval('#pv-railw', (e) => e.getBoundingClientRect().width)) - wk0) < 3);
  await p.keyboard.press('Tab'); await p.focus('#rt-week'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
  t('arrow keys walk the tabs (Week → Fields)', (await p.getAttribute('#rt-fields', 'aria-selected')) === 'true');
  await p.click('#sec-prod .fhd'); await p.waitForTimeout(100);
  await p.click('#fold-all'); await p.waitForTimeout(150);
  t('Fold all folds every section and the button offers the way back', (await p.$$eval('section[data-fold]', (a) => a.every((c) => c.classList.contains('folded')))) && /Open all/.test(await p.textContent('#fold-all')));
  await p.click('#fold-all'); await p.waitForTimeout(400);

  console.log('· 🎨 design your own overlay');
  {
    p.on('dialog', (dg) => dg.accept());
    const px = (sel) => p.evaluate(`(() => { const c = document.querySelector('${sel} canvas'), g = c.getContext('2d'); const d = g.getImageData(Math.round(c.width * 0.08), Math.round(c.height * 0.06), 1, 1).data; return [d[0], d[1], d[2]]; })()`);
    await p.click('#rt-design'); await p.waitForTimeout(150);
    t('the Design tab opens in the panel beside the previews', !(await p.$eval('#rp-design', (e) => e.hidden)) && (await p.$eval('#pv-rail', (e) => e.getBoundingClientRect().right)) <= (await p.$eval('[data-mock="fb_feed"]', (e) => e.getBoundingClientRect().left)));
    await p.click('[data-cdnew]'); await p.waitForTimeout(400);
    t('＋ New design draws at once, and is the overlay in use (orange pill, top left)', (await p.textContent('#fl-prev')).includes('My design') && (await px('[data-mock="fb_feed"]'))[0] > 200, await px('[data-mock="fb_feed"]'));
    await p.click('#cd [data-cdsw="bg|#2563EB"]'); await p.waitForTimeout(400);
    const blue = await px('[data-mock="fb_feed"]');
    t('a swatch recolours the element on the preview (now blue)', blue[2] > 180 && blue[0] < 90, blue);
    await p.click('#cd [data-cdadd]'); await p.waitForTimeout(300);
    const before = await p.evaluate('(' + SIG + ')(\'[data-mock="fb_feed"] canvas\')');
    await p.fill('#cd .cd-z >> nth=1 >> [data-k="text"]', 'Only {stock} left'); await p.waitForTimeout(600);
    const after = await p.evaluate('(' + SIG + ')(\'[data-mock="fb_feed"] canvas\')');
    t('own words with a field (“Only {stock} left”) paint on the picture as you type', before.h !== after.h);
    t('…the caret never left the box (typing does not redraw the editor)', await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-k') === 'text'));
    await p.click('#cd [data-cdadd]'); await p.waitForTimeout(300);
    t('leaving the box for ＋ Add element still adds it (the click lands)', (await p.$$eval('#cd .cd-z', (a) => a.length)) === 3);
    await p.click('#cd .cd-z >> nth=2 >> [data-cdrm]'); await p.waitForTimeout(200);
    await p.click('#rt-sched'); await p.fill('#cx-stock', '60'); await p.waitForTimeout(400); await p.click('#rt-design'); await p.waitForTimeout(200);
    t('a figure that is not scarcity (60 in stock) stands the element down, and the editor says why', /Not drawn on this product/.test(await p.textContent('#cd')));
    await p.click('#rt-sched'); await p.fill('#cx-stock', '6'); await p.waitForTimeout(300); await p.click('#rt-pic'); await p.waitForTimeout(150);
    t('your design sits in the Picture gallery and in every per-network select', (await p.$$eval('#dgal .chip.own', (a) => a.length)) === 1 && (await p.$$eval('[data-pdes="tiktok"] option', (a) => a.some((o) => /My design/.test(o.textContent)))));
    await p.reload(); await p.waitForTimeout(1800);
    t('…kept after a reload', (await p.$$eval('#dgal .chip.own', (a) => a.length)) === 1 && /My design/.test(await p.textContent('#fl-prev')));
    await p.click('#rt-design'); await p.waitForTimeout(150);
    const ctxp = p.context(); await ctxp.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await p.click('#cd [data-cddel]'); await p.waitForTimeout(400);
    t('🗑 Delete removes it and the previews fall back to no overlay', (await p.$$eval('#dgal .chip.own', (a) => a.length)) === 0 && !/My design/.test(await p.textContent('#fl-prev')));
  }

  console.log('· exports');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('[data-png="ig_story"]')]);
  t('⬇ PNG downloads the creative, named for the network', !!dl && /ig_story\.png$/.test(dl.suggestedFilename()), dl && dl.suggestedFilename());

  console.log('· a real brand: its own logo on every network, read from its own pages');
  {
    const http = require('http');
    const ORANGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN4m8+NFTEMLQkASlVZwTa/HD0AAAAASUVORK5CYII=', 'base64');
    const NAVY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOQs+oiCTGMahjVMHw1AAC7R+IB7fUXEAAAAABJRU5ErkJggg==', 'base64');
    const csv = 'id,title,brand,price,sale_price,image_link,link\n'
      + ['NW-1,Northwind Trail Runner Navy,Northwind,72.00 GBP,57.60 GBP', 'NW-2,Northwind Rain Jacket Olive,Northwind,120.00 GBP,', 'NW-3,Northwind Court Trainer White,Northwind,85.00 GBP,']
        .map((r, i) => r + ',https://img.northwind.example/p' + i + '.png,https://www.northwind-shop.example/p/' + i).join('\n') + '\n';
    const logos = [];
    const page = html;   // the page with fcc.css inlined, served from an http origin so <img> requests reach this server
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'), send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
      const eng = { '/social/engine.js': 'social_engine.js', '/overlays/studio.js': 'overlay_studio_engine.js', '/overlays/engine.js': 'overlay_engine.js', '/feedlab/engine.js': 'feedlab_engine.js' }[u.pathname];
      if (eng) return send(200, 'application/javascript', fs.readFileSync(path.join(D, eng)));
      if (u.pathname === '/social') return send(200, 'text/html', page);
      if (u.pathname === '/api/feed/clients') return send(200, 'application/json', JSON.stringify({ clients: { Northwind: { wired: ['gb-fb'] } } }));
      if (u.pathname === '/api/feed/proxy') return send(200, 'text/csv', csv);
      if (u.pathname === '/api/catalog/img') return send(200, 'image/png', NAVY);
      if (u.pathname === '/api/state') { if (req.method === 'PUT') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => send(200, 'application/json', b)); return; } return send(200, 'application/json', '{"socialdpa":{}}'); }
      if (u.pathname === '/api/social/logo') {
        logos.push(u.search);
        if (u.searchParams.get('info')) {
          const n = u.searchParams.get('net'), h = u.searchParams.get('h');
          return send(200, 'application/json', JSON.stringify(n === 'tt' ? { ok: true, name: h === 'northwind' ? 'Somebody Else' : 'Northwind', verified: h !== 'northwind' } : { ok: true, name: '', verified: false }));
        }
        return send(200, 'image/png', ORANGE);
      }
      send(404, 'application/json', '{"ok":false}');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + srv.address().port;
    const bc = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const r = await bc.newPage(); const rerr = []; r.on('pageerror', (e) => rerr.push(e.message));
    await r.goto(base + '/social?brand=Northwind&market=gb-fb'); await r.waitForTimeout(2500);
    t('the brand opens on its live feed sample', /products sampled from the live feed/.test(await r.textContent('#mstate')) && !rerr.length, [await r.textContent('#mstate'), rerr]);
    const avs = await r.$$eval('#pv .mock .av img.av-img', (a) => a.map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })));
    t('every network’s avatar is the brand’s logo picture, not a letter (a brand with no Facebook page reads its website icon)', avs.length >= 6 && avs.every((a) => a.ok && /net=site/.test(a.src)), avs);
    t('the Facebook ad prints the product link’s own domain, not a guessed one', /northwind-shop\.example/.test(await r.textContent('[data-mock="fb_feed"] .fb-bot .d')));
    await r.click('#rt-brand'); await r.waitForTimeout(200);
    await r.fill('[data-idf="fb"]', 'northwindhq'); await r.waitForTimeout(700);
    await r.click('[data-lsrc="fb"]'); await r.waitForTimeout(400);
    const fbAv = await r.$eval('[data-mock="ig_feed"] .av img', (i) => i.getAttribute('src'));
    t('a Facebook page typed in becomes the logo on Instagram too (Instagram has no public read)', /net=fb&h=northwindhq/.test(fbAv), fbAv);
    t('TikTok keeps the brand logo while its handle is only a guess', /net=fb/.test(await r.$eval('[data-mock="tiktok"] .av img', (i) => i.getAttribute('src'))));
    await r.click('[data-look="tt"]'); await r.waitForTimeout(500);
    t('looking up the guessed TikTok handle shows whose account it really is', /Somebody Else/.test(await r.textContent('#idn')) && /net=fb/.test(await r.$eval('[data-mock="tiktok"] .av img', (i) => i.getAttribute('src'))));
    await r.fill('[data-idf="tt"]', 'northwindofficial'); await r.waitForTimeout(700);
    await r.click('[data-look="tt"]'); await r.waitForTimeout(500);
    t('…the real handle reads as the brand, verified', /Northwind/.test(await r.textContent('#idn .look')) && /verified/.test(await r.textContent('#idn .look')));
    await r.click('[data-own="tt"]'); await r.waitForTimeout(500);
    const ttAv = await r.$eval('[data-mock="tiktok"] .av img', (i) => i.getAttribute('src'));
    t('“This is us” puts TikTok’s own avatar on the TikTok ad', /net=tt&h=northwindofficial/.test(ttAv), ttAv);
    t('…and the TikTok ad names the handle', /@northwindofficial/.test(await r.textContent('[data-mock="tiktok"]')));
    await r.reload(); await r.waitForTimeout(2500);
    t('the brand’s logo choices are saved with its schedule (a reload keeps them)', /net=tt&h=northwindofficial/.test(await r.$eval('[data-mock="tiktok"] .av img', (i) => i.getAttribute('src'))) && /net=fb&h=northwindhq/.test(await r.$eval('[data-mock="fb_feed"] .av img', (i) => i.getAttribute('src'))));
    await bc.close(); srv.close();
  }

  console.log('· the phone');
  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await ph.newPage(); await q.addInitScript(STUB); await q.goto('file://' + tmp); await q.waitForTimeout(2200);
  t('no sideways scroll at 390px', (await q.evaluate(() => document.documentElement.scrollWidth)) <= 391, await q.evaluate(() => document.documentElement.scrollWidth));
  t('on the phone the controls stack ABOVE the previews (no rail squeezing them)', await q.evaluate(() => document.getElementById('pv-rail').getBoundingClientRect().bottom <= document.querySelector('[data-mock="fb_feed"]').getBoundingClientRect().top && getComputedStyle(document.getElementById('pv-rail')).position === 'static'));
  t('the previews stack one a row and still paint', (await q.$$eval('#pv .mock', (a) => a.length)) === 6 && (await q.evaluate('(' + SIG + ')(\'[data-mock="ig_reels"] canvas\')')).navy > 0.01);

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
