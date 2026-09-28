#!/usr/bin/env node
/*
 * tools/check_hrssplit.js — THE CALCULATION BEHIND THE HOURS FIGURE, RENDERED.
 *
 * Ray, 28 Sep 2026, circling the USED figure on a brand dossier: "actually i dont understand how
 * [it] was calculated" → "maybe show calculation when hover that number on brand dossier".
 *
 * The arithmetic is pinned by tools/test_hoursbadge.mjs. THIS pins the half a source read cannot
 * see, which on this page is the half that has broken before:
 *
 *   · A FLEX/BLOCK RULE BEATS `hidden`. Three panels on the Task Manager chart card shipped
 *     painted open because the check read the PROPERTY instead of the paint. Every assertion
 *     here reads getComputedStyle, and the breakdown must be display:none at rest.
 *   · A HOVER CARD THAT IS CLIPPED OR BEHIND SOMETHING IS NOT A HOVER CARD. The import preview
 *     was a correct dialog painted past the edge of the screen. So: the box is measured against
 *     the viewport, and the card under it is asked who owns the pixel.
 *   · A PHONE HAS NO HOVER. The click has to pin it, the outside click and Esc have to put it
 *     away, and Esc must not take the dossier with it.
 *
 * The page's own CSS and its own lifted functions are used, so this is the shipped code.
 * Run: node tools/check_hrssplit.js      (PW_CHROMIUM overrides the browser path)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

/** lift a function out of the page by name, brace-balanced — the shipped body, not a copy */
function lift(name) {
  const i = CC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0, j = CC.indexOf('{', i);
  for (let k = j; k < CC.length; k++) {
    if (CC[k] === '{') d++;
    else if (CC[k] === '}' && --d === 0) return CC.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + name);
}
const STYLES = (CC.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
const HANDLERS = CC.slice(CC.indexOf('function hrsSplitShut'), CC.indexOf('function portHours'));

const REC = { tracked: true, allowance: 27, used: 45.5, balance: -7.5, markets: 2, mk: [
  { market: 'GB', allowance: 27, used: 28.75, balance: -7.5, health: 'negative' },
  { market: 'IE', allowance: 0, used: 16.75, balance: 0, health: 'zero' } ] };
const BARE = { tracked: true, allowance: 27, used: 45.5, balance: -7.5, markets: 2 };

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${STYLES}</head><body><main class="wrap" style="padding:24px">
<div class="dz-port"><div class="dzp-grid">
  <div class="dzp-card" id="hcard"><h5>Hours — retainer</h5><div id="meter"></div></div>
  <div class="dzp-card" id="under"><h5>Neighbour</h5><p>a card the breakdown has to sit above</p></div>
</div></div></main>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
${lift('hrsSplitCard')}
${lift('hrsMeter')}
${lift('hrsN')}
${HANDLERS}
window.__draw=function(rec){
  document.getElementById('meter').innerHTML=hrsMeter(rec.used,rec.allowance,'#C0392B',window.__split(rec),rec);
};
<\/script></body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });

  // the engine the page calls is the widget's; give the harness the same one, lifted from it
  const HW = fs.readFileSync(path.join(ROOT, 'docs', 'hours_widget.html'), 'utf8');
  const SPLITFN = HW.slice(HW.indexOf('  function hoursSplit(rec) {'), HW.indexOf('  /* FCC-HOURS:ENGINE-END */'));

  for (const W of [1440, 390]) {
    console.log('\n── ' + W + 'px');
    const ctx = await browser.newContext({ viewport: { width: W, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.setContent(PAGE, { waitUntil: 'domcontentloaded' });
    await p.evaluate((src) => { window.eval(src + '\nwindow.__split=hoursSplit;'); }, SPLITFN);
    await p.evaluate((r) => window.__draw(r), REC);
    ok('the page threw nothing', errs.length === 0, errs[0]);

    const shown = () => p.evaluate(() => {
      const s = document.querySelector('.dzp-split');
      return s ? getComputedStyle(s).display : 'absent';
    });
    ok('at rest the breakdown is NOT painted (read off the paint, never the property)',
      (await shown()) === 'none', await shown());

    await p.hover('.dzp-mcap .dzp-mx');
    ok('hovering the figure paints it', (await shown()) === 'block', await shown());

    const box = await p.evaluate(() => {
      const s = document.querySelector('.dzp-split'), b = s.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height,
        vw: innerWidth, vh: innerHeight, scroll: document.documentElement.scrollWidth };
    });
    ok('every edge of it is inside the viewport',
      box.left >= 0 && box.right <= box.vw + 0.5 && box.top >= 0 && box.w > 120 && box.h > 80, box);
    ok('and the page gained no sideways scroll', box.scroll <= box.vw + 0.5, box.scroll + ' vs ' + box.vw);

    ok('it owns its own pixels — the card under it does not show through',
      await p.evaluate(() => {
        const s = document.querySelector('.dzp-split'), b = s.getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(20, b.height / 2));
        return !!(el && s.contains(el));
      }));

    const read = await p.evaluate(() => {
      const t = document.querySelector('.dzp-spt');
      const row = (tr) => [].map.call(tr.children, (c) => c.textContent.trim());
      return { body: [].map.call(t.tBodies[0].rows, row), foot: row(t.tFoot.rows[0]),
        notes: [].map.call(document.querySelectorAll('.dzp-spn'), (n) => n.textContent) };
    });
    ok('the markets are listed biggest user first, with their own used and block',
      JSON.stringify(read.body) === JSON.stringify([['GB', '28.75h', '27h'], ['IE', '16.75h', 'no block']]),
      read.body);
    ok('the footer adds them up to the very figure the caption shows',
      read.foot[1] === '45.5h' && read.foot[2] === '27h' && /2 markets/.test(read.foot[0]), read.foot);
    ok('the hours booked against no block are named',
      /16\.75h of the used total sits on IE/.test(read.notes.join(' ')), read.notes);
    ok('and it says outright that the balance is not block minus used',
      /balance is not block minus used/.test(read.notes.join(' ')), read.notes);

    // a click PINS it — a phone never hovers
    await p.click('.dzp-mcap .dzp-mx');
    await p.mouse.move(5, 5);
    ok('a click pins it open once the pointer has left', (await shown()) === 'block', await shown());
    ok('and the figure says it is open',
      (await p.getAttribute('.dzp-mcap .dzp-mx', 'aria-expanded')) === 'true');

    // a click well clear of both the card and the breakdown — not the neighbouring card, which
    // the pinned breakdown is correctly sitting on top of
    await p.mouse.click(5, 880);
    ok('a click anywhere else puts it away', (await shown()) === 'none', await shown());

    await p.click('.dzp-mcap .dzp-mx');
    await p.mouse.move(5, 5);   // else the :hover rule keeps it painted and Esc proves nothing
    const esc = await p.evaluate(() => {
      let reachedTheDossier = false;
      const spy = () => { reachedTheDossier = true; };
      document.addEventListener('keydown', spy);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      document.removeEventListener('keydown', spy);
      return { reachedTheDossier, display: getComputedStyle(document.querySelector('.dzp-split')).display };
    });
    ok('Esc closes the breakdown', esc.display === 'none', esc);
    ok('…and is stopped there, so the dossier underneath does not close with it',
      esc.reachedTheDossier === false, esc);

    // no rows → no trigger, no card, no invented breakdown
    await p.evaluate((r) => window.__draw(r), BARE);
    ok('a record the index has not re-read draws no breakdown at all',
      await p.evaluate(() => !document.querySelector('.dzp-split')));
    ok('…and its caption goes back to plain text, not a button that opens nothing',
      await p.evaluate(() => !document.querySelector('.dzp-mx')
        && /45\.5h used/.test(document.querySelector('.dzp-mcap').textContent)));

    await ctx.close();
  }
  await browser.close();
  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
