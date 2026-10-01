#!/usr/bin/env node
/*
 * tools/website_media.js — REAL FCC FOOTAGE FOR THE WEBSITE MOCKUP (/website).
 *
 * Ray, 1 Oct 2026: "website still looking a bit too 'AI done' — shake it up and use actual footage of FCC to
 * pull in amazing data segmentation & visualisation too". So the website's pictures are not drawn: they are
 * the REAL module pages (Catalogue, ROAS, AI visibility, Stock, Rules, Golden Record) rendered in Chromium
 * against the repo's SYNTHETIC demo books (tools/*_stub.js + the Golden Record history fixture), filmed and
 * screenshotted, then compressed into docs/website/.
 *
 * NOTHING PRIVATE CAN REACH A PUBLIC-SITE PICTURE:
 *   · the demo books are synthetic, but two of them borrow real client NAMES (the ROAS and Rules stubs) and
 *     some pages name the roster in their explanatory copy — every name is swapped for a fictional brand
 *     (Northwind, Harbour, Atelier, Linden …) in the stub AND the page source before anything renders;
 *   · before every capture the page's visible text is checked against the client roster and the capture is
 *     REFUSED (exit 1) if any name survives;
 *   · product images come from a generator here (garment silhouettes), never a URL — the demo feed's image
 *     hosts are *.invalid and the overlay host is answered locally, so no request leaves the machine for them;
 *   · crops are panels inside the modules, never the FCC topbar (no avatars, names or internal nav).
 *
 * Output: docs/website/<name>.webp (stills, ≤1600px wide) + <name>.mp4 (H.264 loops, no audio, faststart).
 * MP4 only, deliberately: H.264 plays in Chrome, Edge, Safari (incl. iPhone) and Firefox; a second WebM copy
 * would double the worker bundle for the browsers that already play the MP4. The page shows the still as the
 * poster, so a browser that cannot play the loop still shows the real screen.
 *
 * Run:  NODE_PATH=$(npm root -g) PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/website_media.js
 *       (needs Playwright + an ffmpeg with libx264/libwebp — FFMPEG=/path, else imageio-ffmpeg's binary)
 * Then: node tools/test_website.mjs   (asserts the media list, the size budget and the names rule)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright not installed'); process.exit(1); }
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'docs'), OUT = path.join(D, 'website');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmedia-'));
const FF = process.env.FFMPEG || (() => {
  try { return cp.execSync("python3 -c \"import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())\"").toString().trim(); } catch (e) { return 'ffmpeg'; }
})();
fs.mkdirSync(OUT, { recursive: true });

// ---- names: every real client a demo book or a page's copy might carry → a fictional brand -----------------
const NAMES = [
  [/Superdry/g, 'Northwind'], [/superdry/g, 'northwind'], [/SUPERDRY/g, 'NORTHWIND'],
  [/Schuh/g, 'Harbour'], [/schuh/g, 'harbour'],
  [/Reiss/g, 'Atelier'], [/reiss/g, 'atelier'],
  [/Accessorize/g, 'Linden Accessories'], [/Monsoon/g, 'Linden'],
  [/YuMOVE|YuMove/g, 'Pawsome'], [/Lintbells/g, 'Pawsome'], [/Hobbycraft/g, 'Craftwell'],
  [/American Golf/g, 'Fairway'], [/House of Bruar/g, 'Glen House'], [/Est[ée]e Lauder/g, 'Lumen Beauty'],
  // the demo catalogue singularises its leaf by dropping a trailing s — readable for a tripwire, not on a website
  [/Dresse\b/g, 'Dress'], [/Scarve\b/g, 'Scarf'],
];
const ren = (s) => NAMES.reduce((t, [a, b]) => t.replace(a, b), s);
const CLIENTS = /\b(Superdry|Reiss|Schuh|Monsoon|Accessorize|YuMOVE|YuMove|Lintbells|Hobbycraft|American Golf|House of Bruar|Est[ée]e Lauder|ELC)\b/;

const FCC_CSS = (() => { const s = fs.readFileSync(path.join(D, 'FeedSpark_Design.html'), 'utf8'); const a = s.indexOf('/* FCC-DESIGN:START */'), b = s.indexOf('/* FCC-DESIGN:END */'); return s.slice(a, b + '/* FCC-DESIGN:END */'.length); })();
function pageFile(name) {
  const src = ren(fs.readFileSync(path.join(D, 'FeedSpark_' + name + '.html'), 'utf8'))
    .split('<link rel="stylesheet" href="/design/fcc.css">').join('<style>' + FCC_CSS + '</style>');
  const f = path.join(TMP, 'FeedSpark_' + name + '.html'); fs.writeFileSync(f, src); return f;
}

// ---- a richer ROAS book: the stub's own builder, renamed, with 45 days, seven markets and a rising return --
function roasShowcase() {
  let s = ren(fs.readFileSync(path.join(__dirname, 'roas_stub.js'), 'utf8'));
  const patch = (a, b) => { if (s.indexOf(a) < 0) throw new Error('roas_stub changed — cannot find: ' + a.slice(0, 60)); s = s.split(a).join(b); };
  patch('const DAYS = 10, day0 = Date.UTC(2026, 8, 14);', 'const DAYS = 40, day0 = Date.UTC(2026, 7, 21);');
  patch('const wob = 1 + 0.2 * Math.sin((i + seed) / 3);', 'const wob = (0.86 + i * (seed === 3 ? -0.004 : 0.0045)) * (1 + 0.1 * Math.sin((i + seed) / 3.4) + 0.05 * Math.sin(i * 1.9 + seed));');
  patch('+(rv * f * wob).toFixed(2)', '+(rv * f * wob * (0.9 + i * (seed === 3 ? -0.003 : 0.006))).toFixed(2)');
  const a = s.indexOf('const rows = ['), b = s.indexOf('];', a);
  s = s.slice(0, a) + "const rows = [\n"
    + "    mk('northwind_gb', 'Northwind', 'GB', '£', 41794.42, 480072.16, 6585.04, 204985, 14477612, 64469, 38.06, 'Strong', 1),\n"
    + "    mk('northwind_de', 'Northwind', 'DE', '€', 53253.13, 369851.24, 4200, 150000, 9000000, 62253, 52.95, 'Strong', 2),\n"
    + "    mk('northwind_fr', 'Northwind', 'FR', '€', 18200, 96500, 1320, 61000, 4100000, 40100, 49.2, 'Steady', 5),\n"
    + "    mk('northwind_ie', 'Northwind', 'IE', '€', 6210, 52400, 690, 26100, 1880000, 31200, 44.1, 'Steady', 4),\n"
    + "    mk('atelier_gb', 'Atelier', 'GB', '£', 22400, 201600, 1850, 74200, 5200000, 21800, 31.4, 'Strong', 6),\n"
    + "    mk('linden_gb', 'Linden', 'GB', '£', 9800, 41200, 610, 38400, 2900000, 12300, 46.7, 'Steady', 7),\n"
    + "    mk('harbour_gb', 'Harbour', 'GB', '£', 30000, 45000, 900, 100000, 8000000, 85000, 57.7, 'Weak', 3),\n"
    + "  " + s.slice(b);
  // the movers' week-on-week deltas are written per row in the stub — one per market here
  patch('dSp: [4.2, -1.1, 8.8][i], dRv: [16.5, -3.1, -11.3][i], dRoas: [12, -2, -18][i], dCv: [3, -1, -5][i]',
    'dSp: [4.2, -1.1, 8.8, 2.6, 6.1, 1.9, -4.4][i], dRv: [16.5, -3.1, 9.2, 4.8, 12.7, -6.4, -11.3][i], dRoas: [12, -2, 6, 3, 9, -5, -18][i], dCv: [3, -1, 2, 1, 4, -2, -5][i]');
  const f = path.join(TMP, 'roas_showcase.js'); fs.writeFileSync(f, s);
  return require(f).stubLines();
}

// the AI-visibility live run: the same NDJSON stream tools/check_aivis.js plays, slowed to watching speed
const ASK = `
function askStub(opts){
  var b=JSON.parse(opts.body),enc=new TextEncoder(),named=/coats|boots|Northwind/.test(b.q);
  var text=named?'Top picks: **Southbay** first, then **Northwind** for the best-made coat, and **Harbour & Co**.':'Try **Southbay** or **Eastfield**; **Harbour & Co** is a smaller label.';
  var lines=[{t:'start',s:b.s},{t:'search',q:b.q.toLowerCase()},{t:'sources',n:3}];
  text.match(/.{1,9}/g).forEach(function(p){lines.push({t:'text',d:p});});
  var r={ok:true,text:text,cites:named?[{u:'https://www.northwind.co.uk/p/wool-coat/NW100',t:'NW'},{u:'https://www.reddit.com/r/x',t:'r'}]:[{u:'https://southbay.com/',t:'S'}],results:[],searches:[b.q],model:'m',ms:900};
  if(b.s==='aio'&&/walking/.test(b.q))r={ok:true,none:true,note:'Google showed no AI Overview for this search'};
  lines.push({t:'done',r:r});
  var i=0,dead=false,delay=window.__askDelay||70;
  var st=new ReadableStream({pull:function(c){return new Promise(function(res){setTimeout(function(){if(dead){res();return;}if(i<lines.length){c.enqueue(enc.encode(JSON.stringify(lines[i++])+'\\n'));}else{dead=true;c.close();}res();},delay);});}});
  return Promise.resolve(new Response(st,{status:200,headers:{'content-type':'application/x-ndjson'}}));
}`;

const STUB_LINES = ren([
  require('./catalog_stub.js').stubLines(),
  require('./aivis_stub.js').stubLines(),
  require('./rules_stub.js').stubLines(),
].join('\n')) + '\n' + roasShowcase();
const STUB = `${ASK}
window.__askDelay=70;
// pictures are panels of the module, never the FCC chrome: the sticky topbar scrolls away with the page
document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='.topbar{position:static!important}';document.head.appendChild(s);});
window.fetch=function(url,opts){url=String(url);opts=opts||{};var j=function(o,st){return Promise.resolve(new Response(JSON.stringify(o),{status:st||200,headers:{'content-type':'application/json'}}));};
 if(url.indexOf('/api/aivis/ask')>=0)return askStub(opts);
 if(url.indexOf('/api/aivis/run')>=0)return j({ok:true});
${STUB_LINES}
 return j({ok:false,error:'stub'},404);};`;

// ---- product pictures for the synthetic Northwind catalogue --------------------------------------------------
const COL = { Navy: '#2B3A55', Black: '#26262B', Ivory: '#E9E1D2', Sage: '#8FA48E', Rust: '#B35A35', Grey: '#8D9096' };
const BG = ['#EFEBE5', '#E9E4DD', '#ECE7E2', '#E7E2DA', '#EEEAE6', '#E5E1DB'];
const COLS = ['Navy', 'Black', 'Ivory', 'Sage', 'Rust', 'Grey'];
const SHAPE = {
  dress: 'M250 120c18 22 32 30 50 30s32-8 50-30l40 30-26 70 20 400H216l20-400-26-70Z',
  maxi: 'M250 120c18 22 32 30 50 30s32-8 50-30l40 30-26 70 46 470H190l46-470-26-70Z',
  jumper: 'M255 120h90c0 22-20 38-45 38s-45-16-45-38Zm-6 0-70 28c-9 4-15 11-18 20l-36 150 46 16 30-92v330h198V246l30 92 46-16-36-150c-3-9-9-16-18-20l-70-28c-4 30-30 50-56 50s-52-20-56-50Z',
  tote: 'M180 300h240l22 330H158Zm60 0v-50a60 60 0 0 1 120 0v50h-24v-50a36 36 0 0 0-72 0v50Z',
  scarf: 'M230 140h140l-20 300 50 220h-80l-30-200-30 200h-80l50-220Z',
  shirt: 'M260 120l40 40 40-40 74 30c9 4 15 11 18 20l34 150-46 16-30-92v330H220V244l-30 92-46-16 34-150c3-9 9-16 18-20Zm40 40v420',
  cardigan: 'M255 120l45 70 45-70 70 28c9 4 15 11 18 20l36 150-46 16-30-92v330H300V188m0 0v386H202V244l-30 92-46-16 36-150c3-9 9-16 18-20Z',
  cushion: 'M150 260q150-40 300 0q30 150 0 300q-150 40-300 0q-30-150 0-300Z',
};
const KIND = ['dress', 'maxi', 'jumper', 'tote', 'scarf', 'shirt', 'cardigan', 'cushion'];
function productSvg(grp, variant, overlay) {
  const k = Math.max(0, (parseInt(String(grp).replace(/\D/g, ''), 10) || 100) - 100);
  const i = (k * 2) % 26, kind = KIND[i % 8], col = COL[COLS[i % 6]], bg = BG[k % BG.length];
  const flip = variant === 2 ? ' transform="translate(600 0) scale(-1 1)"' : '';
  const zoom = variant === 3 ? ' transform="translate(-300 -260) scale(2)"' : '';
  const stroke = kind === 'shirt' || kind === 'cardigan' ? '<path d="' + SHAPE[kind].split('Z').pop() + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/>' : '';
  const ov = overlay ? '<g><circle cx="482" cy="118" r="62" fill="#ED6F0B"/><text x="482" y="112" text-anchor="middle" font-family="Lato,Arial" font-weight="900" font-size="30" fill="#fff">NEW</text><text x="482" y="144" text-anchor="middle" font-family="Lato,Arial" font-weight="700" font-size="20" fill="#fff">IN</text></g>'
    + '<rect x="0" y="690" width="600" height="60" fill="rgba(31,31,36,.86)"/><text x="30" y="729" font-family="Lato,Arial" font-weight="700" font-size="24" fill="#fff">Free delivery · Easy returns</text>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750" width="600" height="750"><defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="600" height="750" fill="' + bg + '"/><rect width="600" height="750" fill="url(#g)"/>'
    + '<ellipse cx="300" cy="690" rx="190" ry="18" fill="rgba(0,0,0,.08)"/>'
    + '<g' + flip + zoom + '><path d="' + SHAPE[kind] + '" fill="' + col + '"/>' + stroke + '</g>' + ov + '</svg>';
}
// Lato, served locally: the sandbox proxy drops Google Fonts requests now and then, and a capture in a
// fallback face is a picture of the wrong product. Downloaded once (curl, retried), then answered from disk.
const FONT_DIR = path.join(os.homedir(), '.cache', 'wsmedia-fonts');
// a LINUX Chrome identity on purpose: Google Fonts serves different files per platform, and the Mac (unhinted)
// set renders with broken word spacing at small sizes under Linux Chromium — the files must match the renderer
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,400;1,900&display=swap';
function curl(url, out) {
  for (let i = 0; i < 5; i++) {
    const r = cp.spawnSync('curl', ['-sSfL', '--retry', '3', '-A', UA, '-o', out, url]);
    if (!r.status && fs.existsSync(out) && fs.statSync(out).size > 200) return true;
  }
  return false;
}
function fonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const css = path.join(FONT_DIR, 'lato.css');
  if (!fs.existsSync(css) && !curl(CSS_URL, css)) throw new Error('could not download the Lato stylesheet');
  const txt = fs.readFileSync(css, 'utf8');
  (txt.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || []).forEach((u) => {
    const f = path.join(FONT_DIR, path.basename(u));
    if (!fs.existsSync(f) && !curl(u, f)) throw new Error('could not download ' + u);
  });
  return txt;
}
const FONT_CSS = fonts();
async function routeImages(ctx) {
  await ctx.route(/fonts\.googleapis\.com\/css/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: FONT_CSS }));
  await ctx.route(/fonts\.gstatic\.com\//, (route) => {
    const f = path.join(FONT_DIR, path.basename(route.request().url().split('?')[0]));
    return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }) : route.abort();
  });
  await ctx.route(/northwind\.invalid|lia\.feedspark\.com|dashboard\.feedspark\.com/, (route) => {
    const u = route.request().url();
    const m = u.match(/(NW\d{3})(?:-(\d))?\.jpg/), overlay = /feedspark\.com/.test(u);
    const body = m ? productSvg(m[1], m[2] ? +m[2] : 1, overlay) : productSvg('NW100', 1, false);
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
  });
}

// ---- capture helpers --------------------------------------------------------------------------------------
const sh = (args) => { const r = cp.spawnSync(FF, args, { stdio: ['ignore', 'ignore', 'pipe'] }); if (r.status) throw new Error('ffmpeg failed: ' + String(r.stderr).slice(-600)); };
async function guard(pg, label) {
  const hit = await pg.evaluate((re) => (document.body.innerText.match(new RegExp(re)) || [])[0] || null, CLIENTS.source);
  if (hit) { console.error('✗ ' + label + ': a real client name is on screen ("' + hit + '") — capture refused'); process.exit(1); }
}
async function still(pg, sel, name, opts) {
  opts = opts || {};
  const el = typeof sel === 'string' ? pg.locator(sel).first() : sel;
  await el.scrollIntoViewIfNeeded(); await pg.waitForTimeout(opts.wait || 500);
  await guard(pg, name);
  let box = await el.boundingBox();
  if (opts.pad || opts.h) box = { x: box.x - (opts.pad || 0), y: box.y - (opts.pad || 0), width: box.width + 2 * (opts.pad || 0), height: Math.min(opts.h || 1e9, box.height + 2 * (opts.pad || 0)) };
  const png = path.join(TMP, name + '.png');
  await pg.screenshot({ path: png, clip: box });
  const w = Math.min(1600, Math.round(box.width * 2));
  sh(['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=' + w + ':-2:flags=lanczos', '-c:v', 'libwebp', '-quality', String(opts.q || 80), '-compression_level', '6', path.join(OUT, name + '.webp')]);
  console.log('  ✓ ' + name + '.webp  ' + Math.round(fs.statSync(path.join(OUT, name + '.webp')).size / 1024) + ' KB');
}
// the union of several panels (cards side by side or one under another), as one still
async function span(pg, sels, name, opts) {
  opts = opts || {};
  await pg.locator(sels[0]).first().scrollIntoViewIfNeeded(); await pg.waitForTimeout(400);
  const box = await pg.evaluate((ss) => { let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; ss.forEach((s) => { const e = document.querySelector(s); if (!e) return; const r = e.getBoundingClientRect(); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top + scrollY); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom + scrollY); }); return x1 < 1e9 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null; }, sels);
  if (!box) { console.log('  · ' + name + ': nothing to capture'); return; }
  const pad = opts.pad == null ? 6 : opts.pad;
  await pg.evaluate((y) => window.scrollTo(0, Math.max(0, y - 90)), box.y);
  await pg.waitForTimeout(opts.wait || 700);
  await guard(pg, name);
  const sy = await pg.evaluate(() => scrollY);
  const clip = { x: box.x - pad, y: box.y - sy - pad, width: box.width + pad * 2, height: Math.min(opts.h || 1e9, box.height + pad * 2) };
  const png = path.join(TMP, name + '.png');
  await pg.screenshot({ path: png, clip, fullPage: false }).catch(async () => { await pg.screenshot({ path: png, clip: Object.assign({}, clip, { y: box.y - pad }), fullPage: true }); });
  const w = Math.min(1600, Math.round(clip.width * 2));
  sh(['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=' + w + ':-2:flags=lanczos', '-c:v', 'libwebp', '-quality', String(opts.q || 80), '-compression_level', '6', path.join(OUT, name + '.webp')]);
  console.log('  ✓ ' + name + '.webp  ' + Math.round(fs.statSync(path.join(OUT, name + '.webp')).size / 1024) + ' KB');
}
function encodeLoop(raw, name, crop, t0, dur) {
  // crop = CSS px box at DPR 1 (the recording's own pixels); even sizes for yuv420p
  const W = crop.width & ~1, H = crop.height & ~1, X = Math.max(0, Math.round(crop.x)), Y = Math.max(0, Math.round(crop.y));
  const out = path.join(OUT, name + '.mp4');
  sh(['-y', '-loglevel', 'error', '-ss', (t0 / 1000).toFixed(2), '-t', (dur / 1000).toFixed(2), '-i', raw,
    '-vf', 'crop=' + W + ':' + H + ':' + X + ':' + Y + ",scale='min(1280,iw)':-2:flags=lanczos,fps=24,setsar=1,format=yuv420p", '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-profile:v', 'high', '-movflags', '+faststart', out]);
  console.log('  ✓ ' + name + '.mp4  ' + Math.round(fs.statSync(out).size / 1024) + ' KB · ' + W + '×' + H + ' · ' + (dur / 1000).toFixed(1) + 's');
  // the poster IS the loop's last frame, so the figure never changes size when the video starts
  const poster = path.join(OUT, name + '.webp');
  sh(['-y', '-loglevel', 'error', '-sseof', '-0.3', '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', poster]);
  console.log('  ✓ ' + name + '.webp (poster)  ' + Math.round(fs.statSync(poster).size / 1024) + ' KB');
}
async function open(b, name, opts) {
  opts = opts || {};
  const ctx = await b.newContext(Object.assign({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: opts.dpr || 2 },
    opts.video ? { recordVideo: { dir: TMP, size: { width: 1440, height: 900 } }, deviceScaleFactor: 1 } : {}));
  await routeImages(ctx);
  const pg = await ctx.newPage(); const t0 = Date.now();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.addInitScript(opts.init || STUB);
  // headless recordings draw no pointer — a hover would look like it happened by itself, so draw one
  if (opts.video) await pg.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const c = document.createElement('div'); c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2l17 11-7.6 1.4 4.4 8.8-3.4 1.6-4.3-8.9L2 21Z" fill="#1F1F24" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'; c.style.cssText = 'position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3));transition:transform .06s linear'; document.body.appendChild(c); document.addEventListener('mousemove', (e) => { c.style.left = e.clientX - 2 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true); document.addEventListener('mousedown', () => { c.style.transform = 'scale(.86)'; }, true); document.addEventListener('mouseup', () => { c.style.transform = ''; }, true); }); });
  await pg.goto('file://' + pageFile(name), { waitUntil: 'load' });
  if (opts.ready) await pg.waitForFunction(opts.ready, null, { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(opts.settle || 2500);
  if (errs.length) console.log('  · page errors on ' + name + ': ' + errs.slice(0, 2).join(' | '));
  return { ctx, pg, t0, at: () => Date.now() - t0 };
}
async function finishVideo(o) { const v = o.pg.video(); await o.ctx.close(); return v ? await v.path() : null; }

(async () => {
  const b = await chromium.launch();
  try {
    // ---------------------------------------------------------------- stills
    console.log('· stills');
    {
      const o = await open(b, 'Catalog', { ready: () => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone });
      // the dashboard: the first two rows of modules
      await span(o.pg, ['#ins'], 'catalogue-dashboard', { h: 800, wait: 900 });
      // the table with the inspector open on a product, at the last stage (what FeedSpark sends)
      await o.pg.evaluate(() => { const c = document.getElementById('cat'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 16); });
      await o.pg.waitForTimeout(300);
      const r0 = await o.pg.locator('#vr .tr.row[data-i="0"]').boundingBox();
      await o.pg.mouse.move(r0.x + 380, r0.y + r0.height / 2); await o.pg.mouse.move(r0.x + 390, r0.y + r0.height / 2 + 1);
      await o.pg.waitForTimeout(900);
      await o.pg.evaluate(() => { window.__FCCCatalogue.state().pin = true; });
      await o.pg.click('#i-stage [data-st="3"]').catch(() => {}); await o.pg.waitForTimeout(600);
      // the docked inspector reflows the dashboard above, so bring the table back to the top of the frame
      await o.pg.evaluate(() => { const c = document.getElementById('cat'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 16); });
      await o.pg.waitForTimeout(500);
      await guard(o.pg, 'catalogue-stages');
      // the inspector alone: master → populated → optimised → enriched for one product
      const ib = await o.pg.evaluate(() => { const r = document.getElementById('insp').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 900 - r.top) }; });
      const png = path.join(TMP, 'stages.png'); await o.pg.screenshot({ path: png, clip: ib });
      sh(['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '82', path.join(OUT, 'catalogue-stages.webp')]);
      console.log('  ✓ catalogue-stages.webp  ' + Math.round(fs.statSync(path.join(OUT, 'catalogue-stages.webp')).size / 1024) + ' KB');
      await o.ctx.close();
    }
    {
      const o = await open(b, 'Stock', { settle: 3000 });
      await span(o.pg, ['#av-card'], 'stock-instock');
      await o.ctx.close();
    }
    {
      const o = await open(b, 'Rules', { settle: 3000 });
      await span(o.pg, ['#fam-card', '#find-card'], 'rules-findings', { h: 760 });
      await o.ctx.close();
    }

    // ---------------------------------------------------------------- loops (real interactions, filmed)
    console.log('· loops');
    {
      const o = await open(b, 'Catalog', { video: true, settle: 1500, ready: () => window.__FCCCatalogue && window.__FCCCatalogue.state().linDone });
      const pg = o.pg;
      const toTable = () => pg.evaluate(() => { const c = document.getElementById('cat'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 16); });
      const row = async (i, steps) => { const r = await pg.locator('#vr .tr.row').nth(i).boundingBox(); await pg.mouse.move(r.x + 330, r.y + r.height / 2, { steps: steps || 14 }); await pg.mouse.move(r.x + 336, r.y + r.height / 2 + 1); };
      await toTable(); await pg.waitForTimeout(400);
      await row(0, 2); await pg.waitForTimeout(900);
      await toTable(); await pg.waitForTimeout(700);          // the docked inspector reflows the page above
      await guard(pg, 'catalogue-loop');
      const t0 = o.at();
      await row(2); await pg.waitForTimeout(1300);
      await row(5); await pg.waitForTimeout(1300);
      await row(0); await pg.waitForTimeout(1100);
      const play = pg.locator('#insp button[data-a="play"]').first();
      const pb = await play.boundingBox().catch(() => null);
      if (pb) { await pg.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 16 }); await pg.waitForTimeout(250); }
      await play.click().catch(() => {}); await pg.waitForTimeout(4200);
      const dur = o.at() - t0;
      const raw = await finishVideo(o);
      encodeLoop(raw, 'catalogue-loop', { x: 0, y: 0, width: 1440, height: 860 }, t0, dur);
    }
    {
      const o = await open(b, 'AIVisibility', { video: true, settle: 2500 });
      const pg = o.pg;
      await pg.evaluate(() => { window.__askDelay = 120; });
      await pg.waitForFunction(() => { const r = document.getElementById('run'); return r && !r.disabled; }, null, { timeout: 15000 }).catch(() => {});
      // starting a run scrolls the page to its status line — start it, then frame the KPIs + the grid filling in
      await pg.click('#run').catch(() => {});
      await pg.waitForTimeout(150);
      await pg.evaluate(() => { const k = document.getElementById('kpis'); window.scrollTo(0, k.getBoundingClientRect().top + scrollY - 14); });
      await pg.waitForTimeout(200);
      await guard(pg, 'aivis-loop');
      const box = await pg.evaluate(() => { const k = document.getElementById('kpis').getBoundingClientRect(), c = document.getElementById('live-card').getBoundingClientRect(); return { x: c.left - 8, y: k.top - 8, width: c.width + 16, height: Math.min(780, c.bottom - k.top + 16) }; });
      const t0 = o.at();
      await pg.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.62, { steps: 12 });
      await pg.waitForFunction(() => (document.getElementById('live-h') || {}).textContent === 'Answers', null, { timeout: 30000 }).catch(() => {});   // the heading drops 'asking now' when the run ends
      await pg.waitForTimeout(2000);
      const dur = Math.min(o.at() - t0, 16000);
      const raw = await finishVideo(o);
      encodeLoop(raw, 'aivis-loop', box, t0, dur);
    }
    {
      const o = await open(b, 'ROAS', { video: true, settle: 2500 });
      const pg = o.pg;
      await pg.evaluate(() => { const c = document.getElementById('win'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 24); });
      await pg.waitForTimeout(600);
      await guard(pg, 'roas-loop');
      const box = await pg.evaluate(() => { const w = document.getElementById('win').getBoundingClientRect(), a = document.getElementById('sc-card').getBoundingClientRect(), t = document.getElementById('tr-card').getBoundingClientRect(), m = document.getElementById('mv-card').getBoundingClientRect(); return { x: a.left - 6, y: w.top - 14, width: a.width + 12, height: Math.min(860, Math.max(t.bottom, m.bottom) - w.top + 20) }; });
      // the period switch is a different READ of FeedHero's report, not a re-cut: every card and both panels re-read
      // (the trend's own crosshair re-renders the chart on every pointer move, too slow to film smoothly)
      const t0 = o.at();
      const win = async (k) => { const r = await pg.locator('#win [data-win="' + k + '"]').boundingBox(); await pg.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 5 }); await pg.waitForTimeout(220); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(1700); };
      await pg.waitForTimeout(500);
      await win('w7'); await win('w90'); await win('w30');
      const dur = o.at() - t0;
      const raw = await finishVideo(o);
      encodeLoop(raw, 'roas-loop', box, t0, dur);
    }
  } finally { await b.close(); }
  console.log('· written to docs/website/  (' + fs.readdirSync(OUT).length + ' files)');
})().catch((e) => { console.error(e); process.exit(1); });
