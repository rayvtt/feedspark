#!/usr/bin/env node
/* FS Task Manager — ⇧ Import edits (Ray, 22 Sep 2026: "import edits dont do anything anymore").
   The preview was never broken as CODE: it read the file, matched on Task id, built the whole
   diff and the Apply button. It rendered at x:1449 in a 1440px window. #tgbd became a right-hand
   RAIL in PR #436 — .bd-box parked at translateX(102%) until something adds .on — and the import
   preview, which shared that host, still emitted the pre-#436 centred-modal markup (a .bd-dim
   whose CSS went with the rewrite). Nothing added .on, so the dialog was correct and off-screen.

   A source-level assertion could not have caught that: the markup was in one file, the rule that
   hid it in another, shipped by a different PR. So this RENDERS the real page, imports a real
   CSV, and asserts the dialog is where a person can see it — then applies it, and checks the
   judgements actually landed on the rows.

   Run: NODE_PATH=$(npm root -g) node tools/check_tmimport.js   (presync) */
const path = require('path');
const fs = require('fs');
const os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('   ✓ ' + name);
  else { fail++; console.log('   ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const page = fs.readFileSync(path.join(D, 'FeedSpark_TaskManager.html'), 'utf8');
// NOTE: this page has no </body>, so widgets are APPENDED — never spliced into a closing tag
const W = ['instr_collapse.html', 'presence_widget.html', 'hours_widget.html', 'mobile_widget.html']
  .map(f => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');

const TITLES = ['Keyword optimisation', 'GMC disapproval fix', 'Title optimisation', 'Email ticket 44', 'Category mapping'];
const rows = [];
let i = 0;
for (const c of ['Reiss', 'Superdry']) for (let m = 1; m <= 6; m++) for (let k = 0; k < 4; k++) {
  i++;
  rows.push({ d: '2026-0' + m + '-1' + k, client: c, market: 'GB', am: 'Ray', owner: ['Ray', 'Febin'][i % 2],
    title: TITLES[i % 5] + ' ' + i, status: 'done', cat: ['opt', 'tech', 'feat', 'acct', 'other'][i % 5],
    bucket: 'done', bill: 1 + (i % 3) * 0.5, nonbill: (i % 4) * 0.25,
    hours: 1 + (i % 3) * 0.5 + (i % 4) * 0.25, sched: 1, id: 1000 + i, ticket: 0, note: '' });
}
const ACC = [{ cid: 1, tid: 1, client: 'Reiss', market: 'GB', name: 'Reiss - GB', group: '', flag: 0, status: 'active', type: 'FM', am: 'Ray', am2: '', allowance: 35, used: 20, balance: 15, health: 'healthy', since: '2019-01-01' }];
const DATA = { from: '2025-10-01', to: '2026-09-22', months: 12, at: Date.now(), rows, tickets: [], accounts: ACC,
  coverage: [], ticketCoverage: [], health: { read: 1, total: 1, partial: 0, oldest: Date.now(), newest: Date.now(), complete: true, staleHours: 0 },
  scoped: false, queuesTotal: 0 };
const TAGDEF = { tags: [
  { slug: 'urgent', label: 'Urgent', color: '#e34948', displaces: true },
  { slug: 'agency', label: 'Agency work', color: '#4a3aa7' },
  { slug: 'technical', label: 'Technical', color: '#1baf7a' }], rules: [] };

const csv = (tag, type) => 'Task id,Task,Tags,Type of work\n'
  + rows.slice(0, 6).map(r => [r.id, '"' + r.title + '"', tag, type].join(',')).join('\n') + '\n';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.route('**/api/**', r => r.fulfill({ json: { ok: true, owner: true, clients: null, modules: null, users: [], roster: [], crit: 0, warn: 0 } }));
  // the real /api/state PUT echoes the MERGED map back, and the page adopts what it returns —
  // a stub that always answered {} would wipe every judgement the moment it was saved
  let STATE = { tmtags: {}, tmtagdef: TAGDEF, tmtype: {} };
  await p.route('**/api/state*', r => {
    const q = r.request();
    if (q.method() === 'PUT') {
      const sent = JSON.parse(q.postData() || '{}');
      STATE = { tmtags: Object.assign({}, STATE.tmtags, sent.tmtags), tmtagdef: sent.tmtagdef || STATE.tmtagdef, tmtype: Object.assign({}, STATE.tmtype, sent.tmtype) };
    }
    return r.fulfill({ json: STATE, headers: { 'X-Sync-Base': String(Date.now()) } });
  });
  await p.route('**/api/taskmanager*', r => r.fulfill({ json: { ok: true, owner: true, scoped: false, status: { state: 'ok', at: Date.now() }, data: DATA } }));
  await p.route('**/xlsx/engine.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(D, 'xlsx_engine.js'), 'utf8') }));
  await p.route('https://fcc.test/tasks', r => r.fulfill({ contentType: 'text/html', body: page + W }));
  await p.goto('https://fcc.test/tasks', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);

  // the tags rail is opened FIRST, because that is the order a person can actually do it in:
  // once the preview is up its scrim covers the page (as a modal should). The two used to share
  // #tgbd, where rulesOpen() would find the import's .bd-box, skip building #tg-body and throw
  // on the next line — so both are asserted alive at once.
  await p.click('#dp-tags');
  await p.waitForTimeout(400);
  ok('the tags rail opens', await p.evaluate(() => !!document.querySelector('#tgbd .bd-box.on') && !!document.getElementById('tg-body')));

  const f1 = path.join(os.tmpdir(), 'fcc-tmimport-1.csv');
  fs.writeFileSync(f1, csv('Urgent', 'Technical fixes'));
  await p.setInputFiles('#ptagfile', f1);
  await p.waitForTimeout(900);

  const st = await p.evaluate(() => {
    const host = document.getElementById('impbd');
    const scrim = host && host.querySelector('.im-scrim');
    const card = host && host.querySelector('.im-card');
    const r = card && card.getBoundingClientRect();
    return {
      host: !!host, scrim: !!scrim, card: !!card,
      // the card must be INSIDE the scrim, or a click on the backdrop is a click on the dialog
      nested: !!(scrim && card && scrim.contains(card)),
      on: !!(scrim && scrim.classList.contains('on')),
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null,
      vw: innerWidth, vh: innerHeight,
      apply: !!document.getElementById('im-yes'),
      // the tags rail's own host must be untouched — a shared host is what caused this
      railOn: !!document.querySelector('#tgbd .bd-box.on'),
      railBody: !!document.getElementById('tg-body'),
      // the preview must not have been written into the rail's host
      tgbdHasImport: !!document.querySelector('#tgbd .im-card, #tgbd [id^="im-"]')
    };
  });

  ok('the preview opens on its own host, not the tags rail\'s', st.card && !st.tgbdHasImport, { card: st.card, inRail: st.tgbdHasImport });
  ok('it is a scrim with the card inside it', st.scrim && st.nested);
  ok('it is shown (.on), not parked mid-transition', st.on);
  ok('every edge of the dialog is inside the viewport',
    !!st.rect && st.rect.x >= 0 && st.rect.y >= 0 && st.rect.r <= st.vw && st.rect.b <= st.vh, st.rect);
  ok('it is big enough to read the diff in', !!st.rect && st.rect.w > 360 && st.rect.h > 200, st.rect);
  ok('the Apply button is there', st.apply);
  ok('the tags rail is still whole underneath it', st.railBody && st.railOn, { on: st.railOn, body: st.railBody });

  // if the dialog is not reachable there is nothing left to drive — say so in words rather than
  // letting Playwright time out clicking a button parked off the edge of the screen
  if (fail) {
    await browser.close();
    console.log('\n✗ ' + fail + ' failed — the import preview never reached the screen, so the rest was not run');
    process.exit(1);
  }

  await p.click('#im-yes');
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => ({
    closed: document.getElementById('impbd').innerHTML === '',
    urgent: [...document.querySelectorAll('#pbody span.tg')].filter(x => /Urgent/.test(x.textContent)).length
  }));
  ok('applying closes the dialog', after.closed);
  ok('applying actually tags the rows', after.urgent >= 6, after);

  const f2 = path.join(os.tmpdir(), 'fcc-tmimport-2.csv');
  fs.writeFileSync(f2, csv('Technical', 'Optimisation'));
  await p.setInputFiles('#ptagfile', f2);
  await p.waitForTimeout(800);
  ok('a second import reopens', !!(await p.$('#impbd .im-card')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  ok('Esc closes it', await p.evaluate(() => document.getElementById('impbd').innerHTML === ''));

  // 390px: the phone convention on this page is a full sheet, not a card cropped by the gutter
  await p.setViewportSize({ width: 390, height: 780 });
  // a THIRD file, because the rows already carry f1's tags by now and a plan of 0 renders no
  // Apply button at all — correctly, but then the phone check would be measuring nothing
  const f3 = path.join(os.tmpdir(), 'fcc-tmimport-3.csv');
  fs.writeFileSync(f3, csv('Agency work', 'Optimisation'));
  await p.setInputFiles('#ptagfile', f3);
  await p.waitForTimeout(800);
  const ph = await p.evaluate(() => {
    const c = document.querySelector('#impbd .im-card');
    const r = c && c.getBoundingClientRect();
    const y = document.getElementById('im-yes');
    const yr = y && y.getBoundingClientRect();
    return r ? { x: Math.round(r.x), r: Math.round(r.right), w: Math.round(r.width), vw: innerWidth, vh: innerHeight,
      apply: yr ? { y: Math.round(yr.y), b: Math.round(yr.bottom), r: Math.round(yr.right) } : null } : null;
  });
  ok('on a 390px screen it fits the width without overflowing',
    !!ph && ph.x >= 0 && ph.r <= ph.vw + 1 && ph.w > 300, ph);
  // the decision has to be reachable on the phone, not scrolled off under the fold: the inner
  // diff table caps its own height, so the buttons stay in the sheet rather than below it
  ok('the Apply button is on the phone screen too',
    !!(ph && ph.apply) && ph.apply.y >= 0 && ph.apply.b <= ph.vh && ph.apply.r <= ph.vw + 1, ph && ph.apply);

  ok('no page errors along the way', errs.length === 0, errs);
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' failed' : '\n✓ import preview reaches the screen');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
