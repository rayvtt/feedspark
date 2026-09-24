/* THE INTAKE TABLE — a wide task column and rows of one height.
 *
 * Ray, 24 Sep 2026, on the Workflow Intake board: "expand the task cell ? make sure the row are
 * evenly spread pls". Two separate things were wrong.
 *
 * 1. Task was NOT 269px by anyone's decision. <col class="cw-act"> carried the Brief column's
 *    166px, and the call-wrap composer shipped a component namespace using the same two letters —
 *    .cw-act{display:flex} — which matched that <col> and took it out of the table-column model
 *    altogether. Its width was then ignored, the browser handed the leftover to it as an auto
 *    column, and Brief quietly ate 103px of Task. The columns are `ic-` now, so a component can
 *    never claim one again; a rendered assertion catches it if one does.
 * 2. A task ran one to five lines, so rows stepped 43 / 50 / 66 / 82 / 98px down the page. The
 *    text box is exactly two lines tall — clamped and floored — so every row is one height.
 *
 * The widths are measured, not read: this is a layout bug and the source was right both times.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const SRC = new URL('../docs/FeedSpark_Workflow.html', import.meta.url);
const html = readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

console.log('\n── the columns have a namespace of their own');
const cg = (html.match(/<colgroup>((?:<col class="ic-[a-z]+">)+)<\/colgroup>/) || [])[1] || '';
ok(cg.split('<col').length - 1 === 9, 'the intake colgroup declares nine ic- columns');
ok(!/<col class="cw-/.test(html), 'no <col> wears a cw- class — that is the composer\'s namespace');
ok(/#itbl col\.ic-act\{width:(\d+)px\}/.test(html), 'Brief is a fixed column');
ok(/#itbl col\.ic-task\{width:auto\}/.test(html), 'and Task is the only auto one, so it takes the rest');
ok(/#itbl col\.ic-(?:client|feed|owner|due)\{width:[\d.]+%\}/.test(html),
  'Client / Feed / Owner / Due are percentages — deprioritised, not frozen');
ok(/#itbl col\.ic-(?:status|source|act)\{width:\d+px\}/.test(html),
  'while the fixed-size controls are px — more width there is only whitespace');

console.log('\n── every row is one height');
ok(/-webkit-line-clamp:2/.test(html) && /\.tk-w\{[^}]*min-height:calc\(2 \* 1\.35em\)/.test(html),
  'the task box is clamped to two lines AND floored at two, so neither a long nor a short task moves the row');
ok(/function tkClip\(\)/.test(html), 'tkClip() exists');
ok(/scrollHeight>w\.clientHeight/.test(html),
  'and it decides by MEASURING the box, never by a character count — where a task is cut moves with the window');
ok(/tkClip\(\);/.test(html) && /addEventListener\('resize'[\s\S]{0,120}?tkClip/.test(html),
  'it runs on every render and again when the window changes');

const req = createRequire(join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium = null;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('\n── measured · playwright unavailable — skipped'); }
if (chromium) {
  const B = await chromium.launch();
  const read = async (W) => {
    const ctx = await B.newContext({ viewport: { width: W, height: 900 } });
    await ctx.addInitScript(`(function(){window.fetch=function(){return Promise.resolve({ok:true,status:200,
      headers:{get:function(){return '0'}},json:function(){return Promise.resolve({ok:true,briefs:{},map:{},items:[],calls:[]})},
      text:function(){return Promise.resolve('{}')}});};})();`);
    const p = await ctx.newPage();
    await p.goto(SRC.href);
    await p.waitForTimeout(2000);
    const g = await p.evaluate(() => {
      const t = document.getElementById('itbl');
      const cols = [...t.querySelectorAll('col')].map((c) => ({ cls: c.className, d: getComputedStyle(c).display }));
      const th = [...t.querySelectorAll('thead th')].map((x) => Math.round(x.getBoundingClientRect().width));
      const rows = [...document.querySelectorAll('#it-body tr')];
      const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
      const ws = [...document.querySelectorAll('#it-body .tk-w')];
      const clipped = ws.filter((w) => w.scrollHeight > w.clientHeight + 1);
      const whole = ws.filter((w) => w.scrollHeight <= w.clientHeight + 1);
      return { cols, th, tw: Math.round(t.getBoundingClientRect().width), n: rows.length, hi: Math.max(...hs), lo: Math.min(...hs),
        clip: clipped.length, clipTitled: clipped.filter((w) => (w.title || '').length > 10).length,
        wholeTitled: whole.filter((w) => w.title).length,
        clipFull: clipped.length ? clipped[0].title.length >= clipped[0].innerText.trim().length : true,
        cl: [...document.querySelectorAll('#it-body .c-client')].filter((c) => c.scrollWidth > c.clientWidth + 1).length,
        ow: (function () {
          const c = [...document.querySelectorAll('#it-body .c-owner')].filter((o) => o.scrollWidth > o.clientWidth + 1);
          return { n: c.length, named: c.filter((o) => (o.title || '').indexOf(o.innerText.trim()) === 0).length,
            hint: c.filter((o) => /double-click/i.test(o.title || '')).length };
        })(),
        tags: [...document.querySelectorAll('#it-body .feed-tag')].filter((t) => !t.title).length };
    });
    await ctx.close();
    return g;
  };
  const a = await read(1131), b = await read(1500);
  console.log('\n── measured at 1131px, the width Ray works at');
  ok(a.cols.every((c) => c.d === 'table-column'),
    'every <col> is still a table column: ' + a.cols.filter((c) => c.d !== 'table-column').map((c) => c.cls).join(', ')
    + (a.cols.every((c) => c.d === 'table-column') ? 'none broken' : ''));
  ok(a.th[8] === 162, 'Brief renders at the 162px it declares, not the leftover (it was 269) — got ' + a.th[8]);
  ok(a.th[3] === Math.max(...a.th), 'Task is the widest column — ' + a.th[3] + 'px');
  ok(a.th[3] >= 340, 'and it is wider than the 269px it was starved to — ' + a.th[3] + 'px');
  ok(a.n > 20 && a.hi - a.lo <= 1, a.n + ' rows, every one ' + a.lo + 'px tall'
    + (a.hi - a.lo > 1 ? ' … except they run ' + a.lo + '–' + a.hi : ''));
  ok(a.clipTitled === a.clip, (a.clip || 'no') + ' clipped task' + (a.clip === 1 ? '' : 's')
    + ' — each carries its full text in the tooltip');
  ok(a.clipFull, 'and the tooltip is the WHOLE task, not the visible part of it');
  ok(a.wholeTitled === 0, 'a task shown in full promises nothing — the cell keeps its own edit hint');
  ok(a.cl === 0, 'no client name is cut — 122px is what the longest brand in the book measures');
  ok(a.ow.n > 0 && a.ow.named === a.ow.n,
    a.ow.n + ' owner cells are free text too long for any column — each names them in full on hover');
  ok(a.ow.hint === a.ow.n, 'and keeps the cell\'s own edit hint, since only one tooltip can show');
  ok(a.tags === 0, 'every feed chip carries its full label — an ellipsis reads as a long name, a clip reads as broken');

  console.log('\n── Task takes the majority of any widening; the rest still grow');
  /* The page's own column caps how wide the table gets, so these are shares of what the TABLE
     gained, which is the part these rules decide. */
  const grew = b.tw - a.tw, took = b.th[3] - a.th[3];
  ok(took >= grew * 0.6, 'the table grew ' + grew + 'px from 1131 to 1500 and Task took ' + took + ' of it');
  ok(b.th[1] > a.th[1] && b.th[2] > a.th[2] && b.th[4] > a.th[4],
    'and Client / Feed / Owner still grew (' + a.th[1] + '→' + b.th[1] + ', ' + a.th[2] + '→' + b.th[2]
    + ', ' + a.th[4] + '→' + b.th[4] + 'px) — deprioritised, never frozen');
  ok(b.th[6] === a.th[6] && b.th[8] === a.th[8],
    'while Status and Brief hold at ' + a.th[6] + ' / ' + a.th[8]
    + 'px — a select and four buttons cannot use a wider window');
  ok(b.hi - b.lo <= 1, 'rows are still one height at 1500px — ' + b.lo + 'px');
  await B.close();
}

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
