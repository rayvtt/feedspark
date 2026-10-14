#!/usr/bin/env node
/*
 * Keyword Calendar — a moment's NAME and DATE are editable on the card
 * (Ray, 14 Oct 2026: "can you also allow date & name of event to be manually editable too").
 *
 * A source assertion could not have caught what was wrong here. editEvent() has asked for both
 * fields since v1 and every string in it read correctly — but it was reachable only by clicking a
 * card in edit mode, and every informative part of a card is already a button (scope, ✦ themes,
 * the state chip, the owner initials, → Brief), so a click aimed at the name or the date landed on
 * a sub-handler and the editor never opened. The bug was in what the page DOES, so this drives the
 * real page: it clicks the name, clicks the date, and checks the card moved to the month the new
 * date briefs in — plus the two refusals, which used to be silent.
 *
 * Run: node tools/check_kwcal_edit.js        (skips cleanly where Playwright is unavailable)
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('· playwright unavailable — skipped'); process.exit(0); }
const D = path.resolve(__dirname, '..', 'docs');

let fail = 0;
const ok = (n, c, x) => { if (c) console.log('   ✓ ' + n); else { fail++; console.log('   ✗ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// One brand, two moments three months apart, no KV record beyond them. Every PUT the page makes is
// recorded OUTSIDE the page so a save can be proved rather than inferred from the screen.
const EVENTS = [
  { id: 'x_one', name: 'Cable knit sweaters', lane: 'campaign', date: '2026-11-05', terms: ['cable knit sweater'] },
  { id: 'x_two', name: 'Winter intent', lane: 'studio', date: '2026-12-10', terms: ['winter coat'] }
];
const INIT = "window.__puts=[];window.fetch=function(url,opt){var u=String(url);"
  + "var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/kwcal')>=0&&opt&&opt.method==='PUT'){window.__puts.push(String(opt.body));return j({ok:1});}"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Northwind:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j({});"
  + "if(u.indexOf('/api/kwcal')>=0)return j({Northwind:{events:" + JSON.stringify(EVENTS) + "}});"
  + "return j({});};";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await ctx.addInitScript({ content: INIT });
  await page.goto('file://' + path.join(D, 'FeedSpark_KWCal.html'));
  await page.waitForTimeout(900);
  await page.selectOption('#brand', 'Northwind');
  await page.waitForTimeout(600);

  // one answer per prompt, in order — prompt() is this page's own idiom for every field it edits
  let answers = [];
  page.on('dialog', async (d) => { const a = answers.shift(); await (a === null || a === undefined ? d.dismiss() : d.accept(a)); });
  const cardOf = (id) => page.$('.rc[data-kw="' + id + '"]');
  // every reader answers null for a missing node rather than throwing — a regression must report
  // every assertion it breaks, not only the first
  const monthOf = async (id) => { const c = await cardOf(id); return c ? c.evaluate((n) => n.closest('.mo-sec').querySelector('.mo-nm').textContent.trim()) : null; };
  const nameOf = async (id) => (await txt('.rc[data-kw="' + id + '"] .rt') || '').replace(/[×⛓]/g, '').trim() || null;
  const strip = (t) => t.replace(/^live\s+/, '').trim();
  const dateOf = async (id) => { const t = await txt('.rc[data-kw="' + id + '"] .rd'); return t === null ? null : strip(t.split('·')[0]); };
  const errShown = () => page.$eval('#kw-error', (n) => n.classList.contains('on'));
  const txt = async (sel) => { const el = await page.$(sel); return el ? (await el.textContent()).trim() : null; };
  const tap = async (sel) => { const el = await page.$(sel); if (!el) { fail++; console.log('   ✗ no control ' + sel); return false; } await el.click(); await page.waitForTimeout(450); return true; };

  console.log('\n1) nothing is editable until edit mode is on');
  ok('no page error', errs.length === 0, errs.slice(0, 3));
  ok('both moments are on the board', !!(await cardOf('x_one')) && !!(await cardOf('x_two')));
  ok('no rename control at rest', (await page.$$('[data-rename]')).length === 0);
  ok('no date control at rest', (await page.$$('[data-date]')).length === 0);

  await page.click('#edit'); await page.waitForTimeout(400);
  console.log('\n2) in edit mode each card offers its own name and date');
  ok('a rename control per card', (await page.$$('[data-rename]')).length === 2);
  ok('a date control per card', (await page.$$('[data-date]')).length === 2);
  // the reason this had to be an affordance rather than "click the card": a click on the name used
  // to land on the card and open a two-prompt editor only if it missed every other button
  ok('the rename control carries the name', (await txt('[data-rename="x_one"]')) === 'Cable knit sweaters');
  ok('the date control carries the date as the card reads it', strip(await txt('[data-date="x_one"]')) === '5 Nov');

  console.log('\n3) renaming');
  answers = ['Chunky knit jumpers'];
  await tap('[data-rename="x_one"]');
  ok('the card takes the new name', (await nameOf('x_one')) === 'Chunky knit jumpers', await nameOf('x_one'));
  ok('and nothing is reported', !(await errShown()));
  answers = ['   '];
  await tap('[data-rename="x_one"]');
  ok('an empty name is refused OUT LOUD', await errShown());
  ok('and the name is unchanged', (await nameOf('x_one')) === 'Chunky knit jumpers');

  console.log('\n4) re-dating moves the moment to the month its BRIEF is due');
  const wasMon = await monthOf('x_one');
  answers = ['2027-01-21'];                       // briefs 31 Dec — the board files work, not launches
  await tap('[data-date="x_one"]');
  ok('the card shows the new date', (await dateOf('x_one')) === '21 Jan', await dateOf('x_one'));
  const nowMon = await monthOf('x_one');
  ok('it left the month it was in', nowMon !== wasMon, { wasMon, nowMon });
  ok('and lands in the month 21 days earlier — DEC', /DEC/i.test(nowMon), nowMon);

  console.log('\n5) a w/c moment reads back exactly what was typed');
  answers = ['w/c 2026-12-07'];
  await tap('[data-date="x_two"]');
  ok('the prefix is kept', (await dateOf('x_two')) === 'w/c 7 Dec', await dateOf('x_two'));
  ok('the control offers it back with its prefix', strip(await txt('[data-date="x_two"]')) === 'w/c 7 Dec');
  answers = ['2026-12-07'];                        // typing it bare clears the prefix — what you type is what it reads
  await tap('[data-date="x_two"]');
  ok('typing it bare clears the prefix', (await dateOf('x_two')) === '7 Dec', await dateOf('x_two'));

  console.log('\n6) a date that is not a date is refused, never dropped in silence');
  // the band must be cleared by each attempt, or a stale refusal makes the NEXT one look refused
  // too — which is how this harness first missed that 2026-02-31 was quietly becoming 3 March
  const keep = await dateOf('x_two');
  for (const bad of ['next tuesday', '2026-02-31']) {
    answers = [bad];
    await tap('[data-date="x_two"]');
    ok('“' + bad + '” is refused out loud', await errShown());
    ok('and the date is unchanged', (await dateOf('x_two')) === keep, await dateOf('x_two'));
  }

  console.log('\n7) the card says WHICH date it shows, so it cannot contradict its column');
  // Ray, 14 Oct 2026: "due date doesn't fit with month card" — a moment going live 21 Jan sits in
  // the DECEMBER column, because the board files work by the month the brief is due. True, and
  // nowhere on the card.
  const rd = async (id) => (await txt('.rc[data-kw="' + id + '"] .rd')) || '';
  ok('a moment whose live month differs from its column names both',
    /live\s*21 Jan/.test(await rd('x_one')) && /brief\s*31 Dec/.test(await rd('x_one')), await rd('x_one'));
  ok('…and the column it names is the one it sits in', /DEC/i.test(await monthOf('x_one')), await monthOf('x_one'));
  answers = ['2026-12-28'];                      // briefs 7 Dec — one month, so one date
  await tap('[data-date="x_one"]');
  ok('where the two months agree it stays one short date', !/brief/.test(await rd('x_one')) && /28 Dec/.test(await rd('x_one')), await rd('x_one'));
  ok('and the board says what a month IS, once, above it',
    /brief is due/i.test(await page.$eval('#road', (n) => n.textContent)));

  console.log('\n8) ＋ Add never drops what a person typed');
  const before = (await page.$$('.rc[data-kw]')).length;
  // a date in UK order is how anyone here writes one; the old handler returned on it, after three
  // answered prompts, with no moment and no message — "event created being lost"
  answers = ['Spring drop', 'campaign', '20/11/2026', '2026-11-20', 'jeans'];
  await page.click('#add'); await page.waitForTimeout(700);
  ok('a UK-order date is refused and asked again, not thrown away', answers.length === 0, answers);
  ok('…and the corrected moment is created', (await page.$$('.rc[data-kw]')).length === before + 1);
  ok('…carrying the name that was typed before the typo',
    (await page.$$eval('.rc .rt', (n) => n.map((x) => x.textContent))).some((t) => /Spring drop/.test(t)));
  const mid = (await page.$$('.rc[data-kw]')).length;
  answers = ['Doomed', 'campaign', null];        // cancel is still cancel
  await page.click('#add'); await page.waitForTimeout(600);
  ok('cancelling the date creates nothing', (await page.$$('.rc[data-kw]')).length === mid);

  console.log('\n9) the edits are saved, not only drawn');
  await page.waitForTimeout(1600);
  const puts = await page.evaluate(() => window.__puts.slice());
  const last = puts.length ? JSON.parse(puts[puts.length - 1]) : null;
  const ev = last && (last.Northwind.events || []).find((x) => x.id === 'x_one');
  ok('a PUT reached /api/kwcal', puts.length > 0);
  ok('carrying the new name', !!ev && ev.name === 'Chunky knit jumpers', ev && ev.name);
  ok('carrying the date it was last given', !!ev && ev.date === '2026-12-28', ev && ev.date);

  await browser.close();
  console.log(fail ? '\nFAIL ' + fail : '\nPASS');
  process.exit(fail ? 1 : 0);
})();
