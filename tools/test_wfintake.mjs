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
 *    CLAMP caps the task box at two lines so no task can push its row taller.
 *
 * Ray, 29 Sep 2026: "task row (especially 1 row) is not centered in Intake". The floor that made
 * every row equal was a min-height on the TEXT BOX, which held a one-line task in a two-line box —
 * and a -webkit-box lays its single line at the TOP, so the text sat 9.4px above the row's centre
 * while the status select beside it was middle-aligned. The floor moved onto the row itself, where
 * `vertical-align:middle` can centre a one-line box and a two-line box alike.
 *
 * The widths and the centring are MEASURED, not read: these are layout bugs and the source read
 * correctly every time.
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

console.log('\n── the view the board opens on');
/* Ray, 29 Sep 2026: "default view is (plan: all history) (3 statuses) (sort Due Date latest)" —
   the three he was re-setting by hand on every load. Read off ONE object, because the
   Clear-filter button restores the default too and used to restate the retired 2-month window. */
const def = (html.match(/var IT_DEF=\{([^}]*)\}/) || [])[1] || '';
ok(/window:''/.test(def), 'the plan window defaults to ALL history, not its latest months');
ok(/statuses:\['open','progress','briefed'\]/.test(def), 'three statuses — open, in progress, briefed');
ok(/sort:'dsort'/.test(def) && /dir:-1/.test(def), 'sorted by the DUE date, latest first');
ok(/itState=\{[^;]*statuses:IT_DEF\.statuses\.slice\(\)[^;]*window:IT_DEF\.window[^;]*sort:IT_DEF\.sort[^;]*dir:IT_DEF\.dir/.test(html),
  'the board reads those defaults rather than restating them');
ok(/itState\.statuses=IT_DEF\.statuses\.slice\(\); itState\.q=''; itState\.window=IT_DEF\.window/.test(html),
  'and so does Clear filter — it used to pin the window back to the retired 2-month default');
ok(/function sortArrow\(\)/.test(html) && /\n  sortArrow\(\);/.test(html),
  'the sort arrow is painted at boot, not only by a click — a default sort had nothing naming it');

console.log('\n── every row is one height, and the floor is on the row');
const tkw = (html.match(/\.itbl \.c-task \.tk-w\{([\s\S]*?)\}/) || [])[1] || '';
ok(/-webkit-line-clamp:2/.test(tkw), 'the task box is clamped to two lines, so a long task cannot push its row taller');
ok(!/min-height/.test(tkw),
  'and carries NO min-height — a floor on the box holds a one-line task at the top of a two-line box');
ok(/#itbl tbody tr\{height:calc\(2 \* 1\.35em \+ 17px\)\}/.test(html),
  'the floor is on the ROW instead: the same two lines as the clamp, plus the cell padding and its rule');
ok(!/^\s*\.itbl tbody tr\{height:/m.test(html),
  'scoped to #itbl — the Brief ledger and the tests table share the .itbl class and Ray asked for the Intake');
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
      const wsel = document.getElementById('it-window');
      const view = { win: wsel ? wsel.value : null,
        winLabel: wsel && wsel.selectedOptions[0] ? wsel.selectedOptions[0].textContent : '',
        statusBtn: (document.getElementById('it-status-btn') || {}).textContent || '',
        arrow: (function () { const t = document.querySelector('#itbl thead th .ar');
          return t ? t.closest('th').getAttribute('data-k') + t.textContent.trim() : null; })(),
        /* the dates actually drawn, in the order drawn — dateless rows read '—' and sink */
        due: [...document.querySelectorAll('#it-body .c-due')].map((c) => c.textContent.trim()) };
      const rows = [...document.querySelectorAll('#it-body tr')];
      const hs = rows.map((r) => Math.round(r.getBoundingClientRect().height));
      const ws = [...document.querySelectorAll('#it-body .tk-w')];
      const clipped = ws.filter((w) => w.scrollHeight > w.clientHeight + 1);
      const whole = ws.filter((w) => w.scrollHeight <= w.clientHeight + 1);
      return { view, cols, th, tw: Math.round(t.getBoundingClientRect().width), n: rows.length, hi: Math.max(...hs), lo: Math.min(...hs),
        clip: clipped.length, clipTitled: clipped.filter((w) => (w.title || '').length > 10).length,
        wholeTitled: whole.filter((w) => w.title).length,
        clipFull: clipped.length ? clipped[0].title.length >= clipped[0].innerText.trim().length : true,
        cl: [...document.querySelectorAll('#it-body .c-client')].filter((c) => c.scrollWidth > c.clientWidth + 1).length,
        ow: (function () {
          const c = [...document.querySelectorAll('#it-body .c-owner')].filter((o) => o.scrollWidth > o.clientWidth + 1);
          return { n: c.length, named: c.filter((o) => (o.title || '').indexOf(o.innerText.trim()) === 0).length,
            hint: c.filter((o) => /double-click/i.test(o.title || '')).length };
        })(),
        tags: [...document.querySelectorAll('#it-body .feed-tag')].filter((t) => !t.title).length,
        /* A one-line task and a two-line task must sit the same way in their row: the box's own
           centre on the row's centre. The pre-fix page reads -9.4px on every one-line row. */
        mid: (function () {
          const one = [], many = [];
          [...document.querySelectorAll('#it-body tr')].forEach((r) => {
            const w = r.querySelector('.tk-w'); if (!w) return;
            /* Bucket by the TEXT's own line count, not the box's height — the box is what the bug
               changes, so bucketing on it would move every row into the same bucket and let the
               offset assertions pass on a page that has none of the rows they are about. The clamp
               hides lines 3+ but they are still laid out, so only the first two count. */
            const rng = document.createRange(); rng.selectNodeContents(w);
            const rects = [...rng.getClientRects()].filter((x) => x.height > 0); if (!rects.length) return;
            const lines = new Set(rects.map((x) => Math.round(x.top))).size;
            /* The LINE BOX, never the glyph rect: a rect is the font's content height (14.4px here)
               while the line it sits in is line-height (16.9px), and halving the wrong one puts
               every reading 1.2px out. */
            const lh = parseFloat(getComputedStyle(w).lineHeight);
            const wb = w.getBoundingClientRect(), rb = r.getBoundingClientRect();
            const d = (wb.top + Math.min(lines, 2) * lh / 2) - (rb.top + rb.height / 2);
            (lines === 1 ? one : many).push(Math.round(d * 100) / 100);
          });
          const sel = [...document.querySelectorAll('#it-body tr')].map((r) => {
            const w = r.querySelector('.tk-w'), s = r.querySelector('select');
            if (!w || !s) return null;
            const rng = document.createRange(); rng.selectNodeContents(w);
            const rects = [...rng.getClientRects()].filter((x) => x.height > 0); if (!rects.length) return null;
            const lines = new Set(rects.map((x) => Math.round(x.top))).size;
            const lh = parseFloat(getComputedStyle(w).lineHeight);
            const wb = w.getBoundingClientRect(), sb = s.getBoundingClientRect();
            return Math.round(((wb.top + Math.min(lines, 2) * lh / 2) - (sb.top + sb.height / 2)) * 100) / 100;
          }).filter((x) => x !== null);
          const sp = (a) => (a.length ? Math.max(...a.map(Math.abs)) : 0);
          return { one: one.length, many: many.length, oneOff: sp(one), manyOff: sp(many), selOff: sp(sel) };
        })() };
    });
    await ctx.close();
    return g;
  };
  const a = await read(1131), b = await read(1500);
  console.log('\n── and that view is what actually renders');
  ok(a.view.win === '' && /all history/i.test(a.view.winLabel),
    'the window control opens on “' + a.view.winLabel + '”');
  ok(/3 statuses/.test(a.view.statusBtn), 'the status control opens on “' + a.view.statusBtn.trim() + '”');
  ok(a.view.arrow === 'dsort▼', 'the Due header carries the descending arrow on load — got ' + a.view.arrow);
  ok((function () {   // latest due first, with the dateless rows at the bottom in date order terms
    const d = a.view.due, i = d.findIndex((x) => x === '—');
    const dated = i < 0 ? d : d.slice(0, i);
    return dated.length > 5 && (i < 0 || d.slice(i).every((x) => x === '—'));
  })(), a.view.due.length + ' rows: the dated ones lead and every dateless row sinks to the bottom');

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

  console.log('\n── and the task sits in the middle of its row, whatever its length');
  ok(a.mid.one > 5 && a.mid.many > 5,
    'the board carries both kinds of row — ' + a.mid.one + ' one-line tasks and ' + a.mid.many + ' that wrap');
  ok(a.mid.oneOff <= 1, 'a ONE-LINE task is centred in its row — off by ' + a.mid.oneOff + 'px (it was 9.4)');
  ok(a.mid.manyOff <= 1, 'a wrapped task is too — off by ' + a.mid.manyOff + 'px');
  ok(a.mid.selOff <= 1,
    'so the task reads level with the status select beside it, which was middle-aligned all along — off by '
    + a.mid.selOff + 'px');

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
  ok(b.mid.oneOff <= 1 && b.mid.manyOff <= 1,
    'and the task is still centred there — ' + b.mid.oneOff + ' / ' + b.mid.manyOff + 'px');
  await B.close();
}

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
