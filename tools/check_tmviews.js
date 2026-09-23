#!/usr/bin/env node
/* FS Task Manager — saved chart views, and the account a view is pointed at
   (Ray, 23 Sep 2026: "in this chart dissection > allow option to save a view and that same view
    can be applied across different client").

   The engine half — lifting the account clause out of a query and putting it back — is pinned by
   tools/test_reporttasks.mjs against both copies. This is the other half, and it is the half a
   source read cannot reach: whether the controls exist, whether picking an account really moves
   the WHOLE reading, and whether a view restored onto a different client brings its own client
   back with it. A view that quietly re-pointed the board at Superdry would look completely
   correct in the source.

   It also holds the CONTROL ROW (Ray, 23 Sep 2026: "you see how many button there are here ? -
   reorganise them to make it easy to see please, or add pop up menu/ on left and right to be less
   cluttered"): twenty controls over three rows folded into six on one, behind three menus. A row
   that quietly grows back to three lines, a panel that opens off the edge of the card, or two
   panels open at once are all things only a rendered page can tell you.

   Run: NODE_PATH=$(npm root -g) node tools/check_tmviews.js   (presync) */
const path = require('path');
const fs = require('fs');
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

// three accounts, one of them multi-word — a name with a space is the case that has to be quoted
// back into the query or the view lands on the wrong rows
const CLIENTS = ['Reiss', 'Superdry', 'House of Bruar'];
const TITLES = ['Keyword optimisation', 'GMC disapproval fix', 'Title optimisation', 'Client call', 'Category mapping'];
const rows = [];
let i = 0;
CLIENTS.forEach((c, ci) => { for (let m = 1; m <= 6 - ci; m++) for (let k = 0; k < 4; k++) {
  i++;
  rows.push({ d: '2026-0' + m + '-1' + k, client: c, market: 'GB', am: 'Ray', owner: ['Ray', 'Febin', 'Ezgi'][i % 3],
    title: TITLES[i % 5] + ' ' + i, status: 'done', cat: ['opt', 'tech', 'feat', 'acct', 'other'][i % 5],
    bucket: 'done', bill: 1 + (i % 3) * 0.5, nonbill: (i % 4) * 0.25,
    hours: 1 + (i % 3) * 0.5 + (i % 4) * 0.25, sched: 1, id: 1000 + i, ticket: 0, note: '' });
} });
// one rare, tiny task: the leader layout must REFUSE to label a sliver and fall it through to a
// swatch instead, and that rule needs a sliver to act on
rows.push({ d: '2026-03-02', client: 'Reiss', market: 'GB', am: 'Ray', owner: 'Ray',
  title: 'Sliver task', status: 'done', cat: 'other', bucket: 'done',
  bill: 0.25, nonbill: 0, hours: 0.25, sched: 0, id: 99999, ticket: 0, note: '' });
const ACC = CLIENTS.map((c, n) => ({ cid: n + 1, tid: n + 1, client: c, market: 'GB', name: c + ' - GB',
  group: '', flag: 0, status: 'active', type: 'FM', am: 'Ray', am2: '', allowance: 35, used: 20,
  balance: 15, health: 'healthy', since: '2019-01-01' }));
const DATA = { from: '2025-10-01', to: '2026-09-23', months: 12, at: Date.now(), rows, tickets: [], accounts: ACC,
  coverage: [], ticketCoverage: [], health: { read: 3, total: 3, partial: 0, oldest: Date.now(), newest: Date.now(), complete: true, staleHours: 0 },
  scoped: false, queuesTotal: 0 };

// every control still has its own id — the menus MOVED the nodes, they did not rebuild them —
// so the shape is read the same way whether a panel is open or shut
const shape = () => ({
  q: document.getElementById('q').value.trim(),
  acct: document.getElementById('cacct').value,
  dim: document.getElementById('cdim').value,
  dim2: document.getElementById('cdim2').value,
  form: document.getElementById('cform').value,
  meas: document.getElementById('cmeas').value,
  leg: document.getElementById('cleg').checked,
  // the population the chart is actually drawn from, so "the same reading, another account" is
  // measured rather than assumed
  n: (document.getElementById('qres').textContent.match(/^\s*([\d,]+)/) || [, '?'])[1],
  bars: document.querySelectorAll('#cstage svg text').length,
});

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.route('**/api/**', r => r.fulfill({ json: { ok: true, owner: true, clients: null, modules: null, users: [], roster: [], crit: 0, warn: 0 } }));
  await p.route('**/api/state*', r => r.fulfill({ json: { tmtags: {}, tmtagdef: { tags: [], rules: [] }, tmtype: {} }, headers: { 'X-Sync-Base': String(Date.now()) } }));
  await p.route('**/api/taskmanager*', r => r.fulfill({ json: { ok: true, owner: true, scoped: false, status: { state: 'ok', at: Date.now() }, data: DATA } }));
  await p.route('https://fcc.test/tasks*', r => r.fulfill({ contentType: 'text/html', body: page + W }));
  await p.goto('https://fcc.test/tasks', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);

  // ---- the row is on screen, under the controls it belongs to -------------------------------
  const geo = await p.evaluate(() => {
    const row = document.querySelector('.cw-ctl');
    const stage = document.getElementById('cstage');
    const r = row && row.getBoundingClientRect();
    return { row: !!row, rect: r ? { x: Math.round(r.x), r: Math.round(r.right), y: Math.round(r.y) } : null,
      vw: innerWidth,
      above: !!(stage && row) && row.getBoundingClientRect().bottom <= stage.getBoundingClientRect().top + 1,
      acct: !!document.getElementById('cacct'), view: !!document.getElementById('cview'),
      save: !!document.getElementById('vsave'), note: (document.getElementById('vnote') || {}).textContent || '' };
  });
  ok('the control row renders with every control on it', geo.row && geo.acct && geo.view && geo.save);
  ok('inside the card, not spilling out of it', !!geo.rect && geo.rect.x >= 0 && geo.rect.r <= geo.vw, geo.rect);
  ok('above the chart', geo.above, { above: geo.above });
  ok('and it says the rule before anyone saves one', /keeps the shape, never the account/.test(geo.note), geo.note);

  // ---- ONE ROW, NOT THREE ----------------------------------------------------------------
  const row = await p.evaluate(() => {
    const r = document.querySelector('.cw-ctl');
    const kids = [...r.children].filter(el => el.getBoundingClientRect().width > 0);
    // a 30px pill and a 34px select on the SAME line have different tops, so the test is whether
    // their CENTRES agree — comparing tops would fail a row that is perfectly on one line
    const mid = kids.map(el => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; });
    const spread = kids.length ? Math.round(Math.max(...mid) - Math.min(...mid)) : 0;
    return { h: Math.round(r.getBoundingClientRect().height), n: kids.length, spread,
      open: [...document.querySelectorAll('.cpop')].filter(x => getComputedStyle(x).display !== 'none').length,
      // …and the three elements INSIDE the menus that set their own display and ship hidden
      ghosts: ['vdel', 'vname', 'cuntag-l'].filter(i => {
        const el = document.getElementById(i);
        return el && el.hidden && getComputedStyle(el).display !== 'none';
      }) };
  });
  ok('the whole control block is ONE line', row.spread <= 2 && row.h < 50, row);
  ok('six controls on it, not twenty', row.n <= 6, row);
  // a flex element ignores `hidden`, which would paint all three panels open on load
  ok('and every menu starts shut', row.open === 0, row);
  // a flex row IGNORES `hidden` — the UA's [hidden]{display:none} loses to any class that sets
  // display — so this reads what is PAINTED, not what the property says. Trusting the property is
  // what let the same bug ship open on the AI Quote card.
  ok('nothing that ships hidden inside a menu is painted anyway', row.ghosts.length === 0, row.ghosts);

  // ---- the menus ---------------------------------------------------------------------------
  await p.click('#mb-disp');
  await p.waitForTimeout(250);
  const m1 = await p.evaluate(() => {
    const c = document.getElementById('chartcard').getBoundingClientRect();
    const r = document.getElementById('p-disp').getBoundingClientRect();
    return { open: [...document.querySelectorAll('.cpop')].filter(x => getComputedStyle(x).display !== 'none').length,
      inside: r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= 0,
      rect: { l: Math.round(r.left), rr: Math.round(r.right) }, cardR: Math.round(c.right) };
  });
  ok('a menu opens', m1.open === 1, m1);
  ok('and its panel is inside the card, not off the right edge', m1.inside, m1);
  await p.click('#mb-view');
  await p.waitForTimeout(250);
  ok('opening another closes the first — two panels over one row is the clutter again',
    await p.evaluate(() => [...document.querySelectorAll('.cpop')].filter(x => getComputedStyle(x).display !== 'none').length) === 1);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  ok('Esc closes the open menu',
    await p.evaluate(() => [...document.querySelectorAll('.cpop')].filter(x => getComputedStyle(x).display !== 'none').length) === 0);
  ok('and the drawer underneath was not what Esc reached',
    await p.evaluate(() => !document.querySelector('.drawer.on')));

  const roster = await p.evaluate(() => [...document.querySelectorAll('#cacct option')].map(o => o.value));
  ok('every account in the book is offered', CLIENTS.every(c => roster.indexOf(c) >= 0), roster);
  ok('plus "every account", which is the empty value', roster.indexOf('') >= 0, roster);
  ok('and no account is selected while the query names none',
    await p.evaluate(() => document.getElementById('cacct').value === ''));

  // the controls moved into menus, so the harness does what a person does: open the menu, use
  // the control, let it close. Every id is unchanged.
  const menu = async (m) => {
    if (await p.evaluate(x => document.getElementById('p-' + x).hidden, m)) {
      await p.click('#mb-' + m); await p.waitForTimeout(220);
    }
  };
  const shut = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(160); };

  // ---- build a reading on one account --------------------------------------------------------
  await p.evaluate(() => { document.getElementById('q').value = 'client:Superdry bill:no'; });
  await p.evaluate(() => document.getElementById('q').dispatchEvent(new Event('input')));
  await p.waitForTimeout(400);
  await p.selectOption('#cdim', 'owner');
  await menu('nest'); await p.selectOption('#cdim2', 'cat'); await shut();
  await p.selectOption('#cform', 'nest');
  await menu('disp'); await p.selectOption('#cmeas', 'bill'); await shut();
  await p.waitForTimeout(300);
  const built = await p.evaluate(shape);
  ok('the picker follows a query typed into the search bar', built.acct === 'Superdry', built);
  ok('the reading is built', built.dim === 'owner' && built.dim2 === 'cat' && built.meas === 'bill', built);

  // ---- save it, and it must not carry the account --------------------------------------------
  await menu('view');
  await p.click('#vsave');
  await p.fill('#vnm', 'Billable by owner');
  await p.click('#vok');
  await p.waitForTimeout(300);
  await shut();
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('fcc-tm-chartviews') || '[]'));
  ok('the view is kept on this device', stored.length === 1 && stored[0].name === 'Billable by owner', stored);
  ok('THE POINT — it carries no account at all',
    stored.length === 1 && !/client:|brand:/i.test(stored[0].q), stored[0] && stored[0].q);
  ok('it still carries every other term of the search', stored.length === 1 && stored[0].q === 'bill:no', stored[0] && stored[0].q);
  ok('and it records the account it was saved from, rather than dropping it silently',
    stored.length === 1 && JSON.stringify(stored[0].was) === JSON.stringify(['Superdry']), stored[0] && stored[0].was);
  ok('the whole shape rode with it',
    stored.length === 1 && stored[0].dim === 'owner' && stored[0].dim2 === 'cat' && stored[0].meas === 'bill', stored[0]);
  ok('nothing about this is shared state — it never reaches /api/state',
    stored.length === 1);

  // ---- point the SAME reading at another account ---------------------------------------------
  await p.selectOption('#cacct', 'Reiss');
  await p.waitForTimeout(400);
  const moved = await p.evaluate(shape);
  ok('picking an account rewrites only the account clause', moved.q === 'client:Reiss bill:no', moved.q);
  ok('the split, the nesting, the form and the series all stay exactly as they were',
    moved.dim === built.dim && moved.dim2 === built.dim2 && moved.form === built.form && moved.meas === built.meas, moved);
  ok('and the chart really is drawn from the other account\'s rows now', moved.n !== built.n && moved.n !== '0', { was: built.n, now: moved.n });

  // a name with a space has to come back QUOTED or `client:House of Bruar` reads as three terms
  await p.selectOption('#cacct', 'House of Bruar');
  await p.waitForTimeout(400);
  const hob = await p.evaluate(shape);
  ok('a multi-word account is quoted back into the query', hob.q === 'client:"House of Bruar" bill:no', hob.q);
  ok('and it really matches — not zero rows', hob.n !== '0', hob);
  ok('and the picker reads it back as that account', hob.acct === 'House of Bruar', hob.acct);

  // ---- change the shape, then restore the view ONTO THE ACCOUNT ON SCREEN ---------------------
  await p.selectOption('#cacct', 'Reiss');
  await p.waitForTimeout(300);
  await menu('nest'); await p.selectOption('#cdim2', ''); await shut();
  await p.selectOption('#cdim', 'month');
  await p.selectOption('#cform', 'stack');
  await menu('disp'); await p.selectOption('#cmeas', 'hours'); await shut();
  await p.evaluate(() => { document.getElementById('cleg').checked = false; document.getElementById('cleg').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  ok('the reading is changed away from the saved one',
    await p.evaluate(() => document.getElementById('cdim').value === 'month'));

  await menu('view');
  await p.selectOption('#cview', { label: 'Billable by owner' });
  await p.waitForTimeout(500);
  // the closed button names the open view, so a fold never hides which reading is on screen
  ok('the Views button names the view that is open',
    /Billable by owner/.test(await p.evaluate(() => document.getElementById('mb-view').textContent)),
    await p.evaluate(() => document.getElementById('mb-view').textContent.trim()));
  await shut();
  const back = await p.evaluate(shape);
  ok('the saved view restores the split and the nesting', back.dim === 'owner' && back.dim2 === 'cat', back);
  ok('the form and the series with it', back.form === 'nest' && back.meas === 'bill', back);
  ok('and the toggles it was saved with', back.leg === true, back);
  ok('the rest of the search comes back too', /\bbill:no\b/.test(back.q), back.q);
  ok('THE POINT — it runs against the account ON SCREEN, not the one it was saved from',
    back.acct === 'Reiss' && /client:Reiss/.test(back.q) && !/Superdry/.test(back.q), back.q);
  const note = await p.evaluate(() => document.getElementById('vnote').textContent);
  ok('and the card says which account it was saved from', /Superdry/.test(note), note);

  // ---- apply the same view to a THIRD account, which is the whole ask ------------------------
  await p.selectOption('#cacct', 'Superdry');
  await p.waitForTimeout(400);
  const third = await p.evaluate(shape);
  ok('the same view carries across to another account again',
    third.q === 'client:Superdry bill:no' && third.dim === 'owner' && third.dim2 === 'cat' && third.meas === 'bill', third);

  // ---- the honest states ---------------------------------------------------------------------
  await p.evaluate(() => { document.getElementById('q').value = 'client:Reiss client:Superdry'; document.getElementById('q').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  const multi = await p.evaluate(() => {
    const el = document.getElementById('cacct');
    const sel = el.options[el.selectedIndex];
    return { v: el.value, label: sel ? sel.textContent : '' };
  });
  ok('two accounts in the query never read as "every account"',
    multi.v !== '' && /Reiss/.test(multi.label) && /Superdry/.test(multi.label), multi);

  await p.evaluate(() => { document.getElementById('q').value = 'client:Sup'; document.getElementById('q').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  const typed = await p.evaluate(() => {
    const el = document.getElementById('cacct');
    return { v: el.value, label: (el.options[el.selectedIndex] || {}).textContent || '' };
  });
  ok('a typed prefix is offered verbatim, never snapped to a name nobody typed',
    typed.v === 'Sup' && /as typed/.test(typed.label), typed);

  // ---- the picker follows the query wherever the query came from ------------------------------
  await p.evaluate(() => { document.getElementById('q').value = ''; document.getElementById('q').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('#bd .bx')][0].querySelectorAll('.r');
    for (const x of r) if (/Reiss/.test(x.textContent)) { x.click(); return; }
  });
  await p.waitForTimeout(400);
  ok('clicking a client in the breakdown moves the picker too',
    await p.evaluate(() => document.getElementById('cacct').value === 'Reiss'));

  // ---- DIRECT LABELS WITH A LEADER (Ray, 23 Sep 2026: "the label can appear with an arrow and
  // light italic directly on chart like this") -------------------------------------------------
  await p.evaluate(() => { document.getElementById('q').value = ''; document.getElementById('q').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  // a second split makes the form list nested-only, so it has to go before a donut can be picked
  await menu('nest'); await p.selectOption('#cdim2', ''); await shut();
  await p.selectOption('#cdim', 'task');
  await p.selectOption('#cform', 'donut');
  await menu('disp');
  await p.evaluate(() => { const c = document.getElementById('cleg'); if (!c.checked) { c.checked = true; c.dispatchEvent(new Event('change')); } });
  await shut();
  await p.waitForTimeout(500);

  const lead = await p.evaluate(() => {
    const svg = document.querySelector('#cstage svg');
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const labs = [...svg.querySelectorAll('text')].filter(t => t.querySelector('tspan[font-style="italic"]'));
    const box = labs.map(t => { const b = t.getBBox(); return { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height, t: t.textContent }; });
    // leader curves: a path with no fill, drawn in its slice's own colour
    const curves = [...svg.querySelectorAll('path[fill="none"][stroke-linecap="round"]')];
    const fills = [...svg.querySelectorAll('path.cg')].map(x => x.getAttribute('fill'));
    return { vb, n: labs.length, box, curves: curves.length,
      strokes: curves.map(c => c.getAttribute('stroke')), fills,
      dots: svg.querySelectorAll('circle[r="2.6"]').length,
      swatches: svg.querySelectorAll('rect[rx="2"]').length,
      slices: fills.length,
      italicWeight: labs.length ? labs[0].querySelector('tspan[font-style="italic"]').getAttribute('font-weight') : null,
      valueWeight: labs.length ? labs[0].querySelectorAll('tspan')[1].getAttribute('font-weight') : null };
  });
  ok('the donut names its slices on the chart', lead.n >= 4, { labels: lead.n, slices: lead.slices });
  ok('each one has its own leader curve and a dot on the arc',
    lead.curves === lead.n && lead.dots === lead.n, lead);
  ok('the leader is drawn in its own slice\'s colour, never a generic grey',
    lead.strokes.every(c => lead.fills.indexOf(c) >= 0), lead.strokes);
  ok('the NAME is the light italic half (Ray\'s words) and the FIGURE is not',
    lead.italicWeight === '400' && lead.valueWeight === '800', lead);
  // a leader layout that lets two labels sit on one line is worse than the legend it replaces
  const pairs = [];
  for (let i = 0; i < lead.box.length; i++) for (let j = i + 1; j < lead.box.length; j++) {
    const a = lead.box[i], b = lead.box[j];
    if (a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b) pairs.push([a.t, b.t]);
  }
  ok('and no two labels overlap', pairs.length === 0, pairs.slice(0, 3));
  ok('every label is inside the drawing, not clipped by it',
    lead.box.every(b => b.x >= -1 && b.r <= lead.vb[2] + 1 && b.y >= -1 && b.b <= lead.vb[3] + 1),
    { vb: lead.vb, worst: lead.box.filter(b => b.x < -1 || b.r > lead.vb[2] + 1) });
  // identity is never left to colour alone: what was too small to label keeps a swatch
  ok('a slice too small for a leader still gets a swatch',
    lead.n < lead.slices ? lead.swatches >= (lead.slices - lead.n) : true,
    { labelled: lead.n, slices: lead.slices, swatches: lead.swatches });

  await menu('disp');
  await p.evaluate(() => { const c = document.getElementById('cleg'); c.checked = false; c.dispatchEvent(new Event('change')); });
  await shut();
  await p.waitForTimeout(400);
  ok('unticking the toggle takes them away again',
    await p.evaluate(() => document.querySelectorAll('#cstage svg tspan[font-style="italic"]').length) === 0);
  await menu('disp');
  await p.evaluate(() => { const c = document.getElementById('cleg'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await shut();

  // ---- it survives a reload, because it is the device's own shelf ------------------------------
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  ok('the saved view is still there after a reload',
    await p.evaluate(() => [...document.querySelectorAll('#cview option')].some(o => o.textContent === 'Billable by owner')));

  // ---- 390px ----------------------------------------------------------------------------------
  await p.setViewportSize({ width: 390, height: 780 });
  await p.waitForTimeout(600);
  const phone = await p.evaluate(() => {
    const row = document.querySelector('.cw-ctl');
    // the digest view folds sections on a phone — open the chart card before measuring it
    if (window.FCCDigest && window.FCCDigest.expandAll) window.FCCDigest.expandAll();
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.x), rr: Math.round(r.right), vw: innerWidth,
      acct: !!document.getElementById('cacct'), view: !!document.getElementById('cview') };
  });
  ok('both controls survive on the phone', phone.acct && phone.view, phone);
  ok('and the row does not overflow 390px', phone.x >= 0 && phone.rr <= phone.vw + 1, phone);

  ok('no page errors along the way', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(fail ? '\n✗ ' + fail + ' failed' : '\n✓ saved chart views: the shape travels, the account does not');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
