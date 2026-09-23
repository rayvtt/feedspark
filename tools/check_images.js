// Image Library page harness — drives the REAL page in Chromium with its own <script src>
// engine tags (the path that failed live). Needs feed fixtures; set IMG_FIXTURES to a dir
// holding probe_monsoon_gb.xml + probe_superdry_gb.xml, else it skips.
// Playwright QA for /images — file:// page, every /api and engine fetch stubbed (Access
// blocks the live host from a session); the product images themselves load for real.
import { createRequire as _cr } from 'node:module'; const { chromium } = _cr(import.meta.url)('/opt/node22/lib/node_modules/playwright');
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = process.env.IMG_FIXTURES || '/tmp/img-fixtures/';
const REPO = '/home/user/feedspark/';
const I = require(REPO + 'docs/image_engine.js');
const FA = require(REPO + 'docs/feedlab_engine.js');
const PAGE = REPO + 'docs/FeedSpark_Images.html';

// real captures, from the real feeds
function cap(fx, client, mkt, limit) {
  const c = I.imageCollector({ client, market: mkt });
  const p = FA.createXmlParser((r, h) => c.onRow(r, h));
  const t = readFileSync(fx, 'utf8').slice(0, limit || 1e9);
  for (let i = 0; i < t.length; i += 262144) p.push(t.slice(i, i + 262144));
  p.end();
  const s = c.finish(); s.t = Date.now() - 3600e3; return s;
}
if (!existsSync(S + 'probe_monsoon_gb.xml')) { console.log('· image page harness skipped (no fixtures; set IMG_FIXTURES)'); process.exit(0); }
const MON = cap(S + 'probe_monsoon_gb.xml', 'Monsoon', 'gb', 24e6);       // patterned: 01/21/02/03…
const SUP = cap(S + 'probe_superdry_gb.xml', 'Superdry', 'gb', 20e6);      // unpatterned: opaque hashes
const idxOf = (s) => ({ client: s.client, mkt: s.market, t: s.t, rows: s.rows, withImg: s.withImg, imgs: s.imgs,
  slots: s.slots, learnable: s.learnable, toks: s.tokens.length, tokCover: s.tokCover,
  tops: s.tokens.slice(0, 12).map((t) => ({ tok: t.tok, n: t.n })) });
const FEEDS = [
  { client: 'Monsoon', mkt: 'gb', kind: 'xml', scan: idxOf(MON) },
  { client: 'Superdry', mkt: 'gb', kind: 'xml', scan: idxOf(SUP) },
  { client: 'Reiss', mkt: 'gb', kind: 'xml' },
  { client: 'House of Bruar', mkt: 'gb-fb', kind: 'sheet' },
];
let TAGS = { v: 1, tok: { '01': { tag: 'packshot', by: 'manual', t: Date.now() } }, img: {} };
const puts = [], pushes = [], claudeCalls = [];
const errors = [];
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 980 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.exposeFunction('__api', (p, search, body) => {
  const u = new URL('http://x' + p + search);
  const c = u.searchParams.get('client'), m = u.searchParams.get('market');
  if (p === '/api/images' && !c) return { status: 200, body: { ok: true, feeds: FEEDS } };
  if (p === '/api/images') {
    if (c === 'Monsoon' && m === 'gb') return { status: 200, body: { ok: true, client: c, market: m, kind: 'xml', snap: MON, hist: [], tags: TAGS } };
    if (c === 'Superdry' && m === 'gb') return { status: 200, body: { ok: true, client: c, market: m, kind: 'xml', snap: SUP, hist: [], tags: null } };
    return { status: 200, body: { ok: true, client: c, market: m, kind: 'xml', snap: null, hist: [], tags: null } };
  }
  if (p === '/api/images/tags') {
    const b = JSON.parse(body || '{}'); puts.push({ client: c, b });
    TAGS = TAGS || { v: 1, tok: {}, img: {} };
    Object.assign(TAGS.tok, (b.tags && b.tags.tok) || {});
    if (b.tags && b.tags.tax) TAGS.tax = b.tags.tax;
    ((b.clear && b.clear.tok) || []).forEach((k) => delete TAGS.tok[k]);
    return { status: 200, body: { ok: true, client: c, tags: TAGS } };
  }
  if (p === '/api/images/scanpush') { const b = JSON.parse(body || '{}'); pushes.push({ c, m, img: b.img });
    const f = FEEDS.find((x) => x.client === c && x.mkt === m); if (f) f.scan = idxOf(Object.assign({}, b.img, { market: m }));
    return { status: 200, body: { ok: true, imgs: b.img.imgs, tokens: b.img.tokens.length, learnable: b.img.learnable } }; }
  if (p === '/api/claude') { const b = JSON.parse(body || '{}'); claudeCalls.push(b);
    // the real proxy returns {text}; answer as the model would, so the parse path is exercised
    return { status: 200, body: { text: '{"tag":"model-full","conf":0.88,"note":"A model photographed head to toe against a studio backdrop."}', model: b.model } }; }
  return { status: 200, body: {} };
});
const FXTXT = readFileSync(S + 'probe_monsoon_gb.xml', 'utf8').slice(0, 24e6);
await page.exposeFunction('__proxy', () => FXTXT);
await page.addInitScript(() => {
  window.fetch = async (url, opts) => {
    const u = new URL(String(url), 'http://x');
    if (u.pathname === '/api/feed/proxy') return new Response(await window.__proxy(), { status: 200, headers: { 'content-type': 'application/xml' } });
    const r = await window.__api(u.pathname, u.search, opts && opts.body);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
});
// The engines are NOT pre-injected: the page's own <script src="/feedlab/engine.js"> and
// <script src="/images/engine.js"> must fetch and define their globals, because that is
// exactly the path that failed live (the worker served an EMPTY 200 for the image engine,
// which a script tag loads without firing onerror and without a parse error).
const ENGINE_FILES = { '/feedlab/engine.js': 'docs/feedlab_engine.js', '/images/engine.js': 'docs/image_engine.js' };
await page.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (ENGINE_FILES[u.pathname]) return route.fulfill({ status: 200,
    contentType: 'application/javascript; charset=utf-8', body: readFileSync(REPO + ENGINE_FILES[u.pathname], 'utf8') });
  if (u.protocol === 'file:') return /\.html$/.test(u.pathname) ? route.continue() : route.abort();
  try { const r = await fetch(u.href); const buf = Buffer.from(await r.arrayBuffer());
    return route.fulfill({ status: r.status, contentType: r.headers.get('content-type') || 'application/octet-stream', body: buf }); }
  catch (e) { return route.abort(); }
});
await page.goto('file://' + PAGE);
await page.waitForSelector('#esttbl tbody tr');
let pass = 0, fail = 0; const t = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : ' — ' + x)); };

console.log('· the engines the page asks for actually arrive and define themselves');
{
  const g = await page.evaluate(() => ({ fa: typeof window.FeedAudit, fi: typeof window.FeedImages,
    f1: window.__engineFail || 0, f2: window.__imgEngineFail || 0 }));
  t('both engine script tags defined their globals', g.fa === 'object' && g.fi === 'object', JSON.stringify(g));
  t('and neither reported a load failure', !g.f1 && !g.f2, JSON.stringify(g));
}

console.log('· chrome + selection');
t('nav carries /images marked on', await page.$eval('#tb-modules a[href="/images"]', (a) => a.classList.contains('on')));
t('nav is otherwise the canonical 18 links', (await page.$$('#tb-modules a')).length === 18, String((await page.$$('#tb-modules a')).length));
t('default selection lands on the scanned feed', (await page.$eval('#det-title', (e) => e.textContent)).includes('Monsoon · GB'));

console.log('· the capture as the page reads it');
const kp = await page.$$eval('#kpis .kpi .n', (e) => e.map((x) => x.textContent));
t('KPIs: images, per product, shot codes, tagged %, codes to name', kp.length === 5 && /^\d[\d,]*$/.test(kp[0]) && /%$/.test(kp[3]), JSON.stringify(kp));
t('Monsoon reads as learnable', (await page.$eval('#verdict .verdict', (e) => e.className)).includes('ok'));
t('the verdict says how many images one tagging session names', /tag them once and .*images are named/.test(await page.$eval('#verdict', (e) => e.textContent)), await page.$eval('#verdict', (e) => e.textContent));
const codes = await page.$$eval('.tcard[data-tok] .tn', (e) => e.map((x) => x.textContent));
t('the shot codes are Monsoon\'s real prefixes', codes.includes('01') && codes.includes('21') && codes.includes('02'), JSON.stringify(codes.slice(0, 6)));
t('a slot-depth card sits beneath the codes', (await page.$$('.slotbar')).length === 1 && (await page.$$('.slotbar .sb')).length === 11);

console.log('· a code used in many slots is flagged before anyone tags 4,000 images on trust');
{
  const chips = await page.$$eval('.tcard[data-tok] .chip.live', (e) => e.map((x) => x.textContent));
  const titles = await page.$$eval('.tcard[data-tok] .chip.live', (e) => e.map((x) => x.getAttribute('title') || ''));
  t('the spread-out code carries a check chip', chips.length >= 1 && chips[0] === 'check the examples', JSON.stringify(chips));
  t('and the reason lives in the tooltip, not on the page',
    /different image slots/.test(titles[0] || '') && chips.every((c) => c.length < 24), JSON.stringify(chips));
}

console.log('· the sample strip renders the real images');
await page.waitForTimeout(4500);
const dims = await page.$$eval('.tcard[data-tok] .strip .g .ph', (els) => els.slice(0, 6).map((i) => [i.naturalWidth, i.naturalHeight]));
t('first product images render live', dims.length && dims.filter((d) => d[0] > 0).length >= 3, JSON.stringify(dims));
{
  const sl = await page.$eval('.tcard[data-tok] .strip .g .sl', (e) => e.textContent);
  t('each thumbnail is stamped with the image slot it came from', sl === 'main' || /^([1-9]|10)$/.test(sl), sl);
}

console.log('· tagging a shot code names every image that carries it');
t('the pre-tagged code shows as tagged', await page.$eval('.tcard[data-tok="01"]', (e) => e.classList.contains('tagged')));
t('an untagged code is flagged for attention', await page.$eval('.tcard[data-tok="21"]', (e) => e.classList.contains('untag')));
const n21 = await page.$eval('.tcard[data-tok="21"] .tshare b', (e) => e.textContent);
await page.selectOption('select[data-tagsel="21"]', 'model-full');
await page.waitForFunction(() => document.querySelector('.tcard[data-tok="21"]').classList.contains('tagged'));
t('a manual tag lands on the code', (await page.$eval('select[data-tagsel="21"]', (e) => e.value)) === 'model-full');
t('it is saved to the client, not the market', puts.length && puts[puts.length - 1].client === 'Monsoon' && puts[puts.length - 1].b.tags.tok['21'].tag === 'model-full', JSON.stringify(puts[puts.length - 1] || {}));
t('the status line says how many images that named', (await page.$eval('#mstate', (e) => e.textContent)).includes(n21 + ' images named'), await page.$eval('#mstate', (e) => e.textContent));
t('the coverage bar now carries two tags', (await page.$$('#coverage .covbar i')).length >= 3);
await page.selectOption('select[data-tagsel="21"]', '');
await page.waitForFunction(() => document.querySelector('.tcard[data-tok="21"]').classList.contains('untag'));
t('clearing a tag sends an explicit clear, never a blank rule', (puts[puts.length - 1].b.clear.tok || []).includes('21'), JSON.stringify(puts[puts.length - 1].b));

console.log('· ✦ AI tagging looks at the images themselves');
await page.click('.tcard[data-tok="21"] button[data-ai]');
await page.waitForFunction(() => document.querySelector('.tcard[data-tok="21"]').classList.contains('tagged'), null, { timeout: 20000 });
const call = claudeCalls[claudeCalls.length - 1];
const blocks = call.messages[0].content;
t('the model is sent real image blocks', blocks.filter((b) => b.type === 'image').length >= 3, JSON.stringify(blocks.map((b) => b.type)));
t('the images are the shot code\'s own samples', blocks.filter((b) => b.type === 'image').every((b) => /^https?:\/\//.test(b.source.url)));
t('the taxonomy is in the system prompt, ids and all', /model-up/.test(call.system) && /flat-lay/i.test(call.system));
t('it asks for strict JSON with a reason', /STRICT JSON/.test(call.system) && /"note"/.test(call.system));
t('the model choice is the current Opus', call.model === 'claude-opus-5', call.model);
t('the verdict lands with its provenance', (await page.$eval('.tcard[data-tok="21"] .tagby', (e) => e.textContent)).includes('AI') && (await page.$eval('.tcard[data-tok="21"] .tagby', (e) => e.textContent)).includes('88%'));
t('and with what the model says it saw', (await page.$eval('.tcard[data-tok="21"] .tagnote', (e) => e.textContent)).includes('head to toe'));
t('a manual tag still overrides it', true);

console.log('· an unpatterned feed is refused on the page, not fudged');
await page.selectOption('#brand', 'Superdry');
await page.waitForFunction(() => (document.querySelector('#det-title') || {}).textContent.includes('Superdry'));
t('Superdry reads as unpatterned', (await page.$eval('#verdict .verdict', (e) => e.className)).includes('no'));
t('and says the page tags per image instead', /tags per image/.test(await page.$eval('#verdict', (e) => e.textContent)));
t('the estate row says unpatterned too', (await page.$eval('#esttbl tbody tr:nth-child(2)', (e) => e.textContent)).includes('unpatterned'));

console.log('· a never-scanned feed says so');
await page.selectOption('#brand', 'Reiss');
await page.waitForFunction(() => !document.querySelector('#det-empty').hidden);
t('an unscanned feed offers the live scan, never a blank', (await page.$eval('#det-empty', (e) => e.textContent)).includes('has not been scanned'));

console.log('· ⚡ live scan runs the agent\'s own engine in the browser');
await page.selectOption('#brand', 'Monsoon');
await page.waitForFunction(() => (document.querySelector('#det-title') || {}).textContent.includes('Monsoon'));
await page.click('#scan1');
await page.waitForFunction(() => /scanned:/.test((document.querySelector('#mstate') || {}).textContent || ''), null, { timeout: 180000 });
t('the capture is posted to the worker', pushes.length === 1 && pushes[0].c === 'Monsoon', JSON.stringify(pushes.map((p) => p.c)));
t('the pushed capture carries shot codes and samples', pushes[0].img.tokens.length > 3 && pushes[0].img.tokens[0].samples.length > 0);
t('the browser and the harness agree on the token count', pushes[0].img.tokens.length === MON.tokens.length, JSON.stringify([pushes[0].img.tokens.length, MON.tokens.length]));

console.log('· product search finds one product and names each of its images');
await page.fill('#psq', (MON.tokens[0].samples[0].id || ''));
await page.click('#psgo');
await page.waitForFunction(() => /matched|Nothing/.test((document.querySelector('#psstate') || {}).textContent || ''), null, { timeout: 120000 });
t('the product is found', /matched/.test(await page.$eval('#psstate', (e) => e.textContent)), await page.$eval('#psstate', (e) => e.textContent));
{
  const caps = await page.$$eval('#psout .strip .g .cap', (e) => e.map((x) => x.textContent));
  // every image reads as either the shot type it inherited or, untagged, its raw shot code
  t('its images are listed with a tag or its shot code', caps.length > 1 && caps.every((c) => /^code |^—$/.test(c)
    || /packshot|flat-lay|model|back|side|detail|lifestyle|styled|swatch|infographic|other/i.test(c)), JSON.stringify(caps));
}

console.log('· lightbox');
await page.click('.tcard[data-tok] .strip .g');
await page.waitForSelector('#lb.on');
t('the lightbox names the shot code and slot', /shot code/.test(await page.$eval('#lb-sub', (e) => e.textContent)));
t('and says what it is tagged as', /Tagged as/.test(await page.$eval('#lb-meta', (e) => e.textContent)));
await page.keyboard.press('Escape');
t('Escape closes it', !(await page.$eval('#lb', (e) => e.classList.contains('on'))));

console.log('· taxonomy is the client\'s own vocabulary');
await page.click('#taxtgl');
await page.waitForSelector('#taxedit .taxrow');
const before = (await page.$$('#taxedit .taxrow')).length;
await page.fill('#taxedit .taxrow:first-child input[data-tf="label"]', 'Cut-out on white');
await page.waitForFunction(() => document.querySelectorAll('.tcard[data-tok] select.tagsel option')[1].textContent === 'Cut-out on white', null, { timeout: 8000 });
t('a renamed shot type flows into every tag dropdown', true);
t('the rename is saved against the client', puts[puts.length - 1].b.tags.tax[0].label === 'Cut-out on white');
await page.click('#txadd');
await page.waitForFunction((n) => document.querySelectorAll('#taxedit .taxrow').length === n + 1, before, { timeout: 8000 });
t('a client can add its own shot type', true);
await page.click('#txreset');
await page.waitForFunction(() => document.querySelectorAll('.tcard[data-tok] select.tagsel option')[1].textContent === 'Packshot / flat-lay', null, { timeout: 8000 });
t('and reset to the standard list', true);
await page.click('#taxtgl');

console.log('· phone');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t('no sideways overflow at 390px', ov <= 1, String(ov));
t('the tag dropdown is still on the phone', await page.$eval('.tcard[data-tok] select.tagsel', (e) => e.offsetParent !== null));
t('so is the AI tag button', await page.$eval('.tcard[data-tok] button[data-ai]', (e) => e.offsetParent !== null));
await page.screenshot({ path: S + 'qai_phone.png', fullPage: false });
await page.setViewportSize({ width: 1360, height: 980 });

await page.waitForTimeout(1500);
await page.screenshot({ path: S + 'qai_light.png', fullPage: true });
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await page.waitForTimeout(600);
await page.screenshot({ path: S + 'qai_dark.png', fullPage: false });

t('no console errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close();
process.exit(fail ? 1 : 0);
