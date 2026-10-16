#!/usr/bin/env node
/*
 * Keyword Calendar — an attribute condition either LAYERS or STANDS ON ITS OWN (Ray, 16 Oct 2026:
 * "This shouldn't be a condition based on the previous condition, but should continue to have a
 * separate future. So either conditional layers conditions or a separate condition").
 *
 * tools/test_kwcal_tie.mjs pins the arithmetic on the lifted functions. This drives the REAL
 * picker, because the thing that was wrong was not the sum — it was that an AM had no way to say
 * which kind of condition they meant, and that is only visible once the panel is drawn: the two
 * add buttons, the ⋂/⊕ toggle on a chip, and the footer count really moving when it is flipped.
 *
 * Run: node tools/check_kwcal_cond.js        (skips cleanly where Playwright is unavailable)
 */
const { createRequire } = require('node:module');
const path = require('node:path');
const { installEngineRoutes } = require('./engine_routes.js');
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

/* An invented Accessorize GB feed, five products, counted here so the page is never checked
   against its own arithmetic: "halloween" is in three titles, black or orange on three products,
   and only two are both — so a narrowing condition reads 2 and a separate one reads 4. */
const ROWS = [
  ['Jewellery', 'Halloween skull necklace', 'black'],
  ['Jewellery', 'Halloween pumpkin ring', 'orange'],
  ['Bags', 'Everyday tote', 'black'],
  ['Bags', 'Everyday tote', 'navy'],
  ['Scarves', 'Halloween wrap', 'navy'],
];
const CSV = ['id,title,description,product_type,color,product_type2']
  .concat(ROWS.map((r, i) => ['P' + i, '"' + r[1] + '"', '"' + r[1] + '"', r[0], r[2], ''].join(',')))
  .join('\n');

const EV = { id: 'acc_hw', name: 'Halloween & Half-Term', lane: 'studio', date: '2026-11-20', terms: ['halloween'] };
const STORED = { Accessorize: {
  ptidx: { gb: { map: { Jewellery: 2, Bags: 2, Scarves: 1 }, __total: 5, sat: { n: 0, cols: 1, v: 2 }, t: Date.now() } },
  events: [EV] } };

const INIT = "window.fetch=function(url){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/proxy')>=0)return Promise.resolve(new Response(" + JSON.stringify(CSV) + ",{status:200}));"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Accessorize:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/kwcal')>=0)return j(" + JSON.stringify(STORED) + ");return j({});};";

const footNum = async (page) => {
  const t = await page.textContent('#pt-tot');
  const m = /([\d,]+) SKUs in scope/.exec(t || '');
  return m ? +m[1].replace(/,/g, '') : null;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await installEngineRoutes(ctx);
  await ctx.addInitScript({ content: INIT });
  await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html') + '?client=Accessorize');
  await page.waitForTimeout(1400);

  console.log('\n1) the board and the picker open');
  ok('no page error', errs.length === 0, errs.slice(0, 3));
  await page.click('.scope[data-scope="acc_hw"]');
  await page.waitForTimeout(300);
  ok('the scope picker is up', await page.isVisible('#cnd-sel'));

  // the moment's own theme as a text filter — the state Ray screenshotted
  await page.click('[data-txq="halloween"]');
  await page.waitForTimeout(1500);           // the feed streams once, then counts are live
  ok('the text filter alone finds 3', await footNum(page) === 3, await page.textContent('#pt-tot'));

  console.log('\n2) a condition can narrow, or stand on its own');
  // Ray's own case: a text filter is on, no condition yet, and the colour condition he wants is
  // separate from THAT — so the choice has to be there before a second condition exists
  ok('with a text filter on, a separate condition is offered straight away',
    await page.isVisible('#cnd-add') && await page.isVisible('#cnd-addor'));
  await page.click('#cnd-add');
  await page.click('[data-cndattr="color"]');
  await page.waitForTimeout(200);
  await page.click('[data-cndval="black"]');
  await page.click('[data-cndval="orange"]');
  await page.click('#cnd-commit');
  await page.waitForTimeout(300);
  ok('a narrowing condition takes products away — 3 → 2', await footNum(page) === 2, await page.textContent('#pt-tot'));

  ok('the first condition carries the toggle too — the text filter is what it is separate from',
    (await page.$$('[data-cndjoin]')).length === 1 && !!(await page.$('[data-cndjoin="0"]')));

  // flipping the FIRST condition alone: 3 (the text filter) ∪ 3 (black or orange) = 4
  await page.click('[data-cndjoin="0"]');
  await page.waitForTimeout(300);
  ok('the first condition made separate adds its own products — 2 → 4',
    await footNum(page) === 4, await page.textContent('#pt-tot'));
  await page.click('[data-cndjoin="0"]');
  await page.waitForTimeout(300);
  ok('…and back to narrowing — 2', await footNum(page) === 2, await page.textContent('#pt-tot'));

  await page.click('#cnd-addor');
  await page.click('[data-cndattr="material"]').catch(() => {});
  // material is not in this feed; the builder offers only attributes the feed carries
  const attrs = await page.$$eval('[data-cndattr]', (n) => n.map((x) => x.getAttribute('data-cndattr')));
  ok('the builder offers only attributes this feed carries', attrs.join(',') === 'color', attrs);
  await page.click('[data-cndattr="color"]');
  await page.waitForTimeout(200);
  const navy = await page.textContent('[data-cndval="navy"] .n');
  ok('a separate condition reads its values across the catalogue (navy 2, not 1)',
    (navy || '').trim() === '2', navy);
  await page.click('[data-cndval="navy"]');
  await page.click('#cnd-commit');
  await page.waitForTimeout(300);
  ok('a separate condition ADDS its own products — 2 → 4', await footNum(page) === 4, await page.textContent('#pt-tot'));
  ok('…and the chip says so', /OR/.test(await page.textContent('#cnd-sel')));

  console.log('\n3) the toggle flips one into the other, and the count follows');
  await page.click('[data-cndjoin="1"]');
  await page.waitForTimeout(300);
  ok('flipped to narrowing, the navy condition empties the scope', await footNum(page) === 0, await page.textContent('#pt-tot'));
  await page.click('[data-cndjoin="1"]');
  await page.waitForTimeout(300);
  ok('flipped back, it is its own set again', await footNum(page) === 4, await page.textContent('#pt-tot'));

  console.log('\n4) it is what gets saved, and what the card then reads');
  await page.click('#pt-done');
  await page.waitForTimeout(500);
  const card = await page.textContent('.scope[data-scope="acc_hw"]');
  ok('the card reads the union, not the narrowed set', /^4 products/.test((card || '').trim()), card);

  // the kind each condition is has to SURVIVE the save, or the next edit silently re-narrows
  await page.click('.scope[data-scope="acc_hw"]');
  await page.waitForTimeout(400);
  const chips = await page.textContent('#cnd-sel');
  ok('reopened, both conditions are still there', (chips.match(/Colour:/g) || []).length === 2, chips);
  ok('…the second is still a separate one', /OR/.test(chips), chips);
  ok('…and both carry a toggle', (await page.$$('[data-cndjoin]')).length === 2);
  await page.keyboard.press('Escape');

  ok('no page error through all of it', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(fail ? `\n${fail} failed` : '\nPASS');
  process.exit(fail ? 1 : 0);
})();
