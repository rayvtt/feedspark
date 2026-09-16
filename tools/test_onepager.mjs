#!/usr/bin/env node
/**
 * Brand one-pager — browser tests (Ray, 16 Sep 2026).
 *
 * This sheet is the one thing in the FCC built to be handed to somebody OUTSIDE FeedSpark —
 * "if a new marketing director joins the team, this will be a quick document to share directly
 * with that person". That changes what can go wrong. Two failure modes matter more than layout:
 *
 *   1. A WRONG NUMBER. Every figure is an argument for the account. A stat that reads 0 because
 *      a fetch failed, or that counts another brand's emails, is worse than no sheet at all —
 *      so absence must render as "—", and per-brand filtering is asserted directly.
 *   2. INTERNAL VOCABULARY LEAKING. Module names, KV keys, ticket ids and staff names are
 *      normal everywhere else in this app and must never appear here.
 *
 * Runs the real page from file:// with every API stubbed, exactly as the editor harness does.
 * Usage:  NODE_PATH=$(npm root -g) node tools/test_onepager.mjs [--headed]
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PAGE = 'file://' + process.cwd() + '/docs/FeedSpark_Command_Center.html';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

// Stub set A: everything healthy. Five intake items, only FOUR of them Reiss.
const FULL = {
  abtests: { ok: true, client: 'Reiss', tab: 'AB Test Archive',
    summary: { total: 10, positive: 2, negative: 2, inconclusive: 6, winRate: 50 },
    tests: [
      { batch: 'Jan II - Keyword Optimisation', type: 'Keyword Optimisation', verdict: 'positive', metrics: { impressions: 21.37, clicks: 11.85 }, report: 'r' },
      { batch: 'Jan I - Keyword Optimisation', type: 'Keyword Optimisation', verdict: 'negative', metrics: { impressions: -17.67, clicks: -18.18 }, report: 'r' },
    ] },
  kwresults: { ok: true, results: [], total: 23 },
  audit: { score: { total: 88 } },
  clients: { clients: { Reiss: { wired: ['gb', 'us', 'de', 'fr', 'nl'] } } },
  alerts: { clients: { Reiss: { crit: 1, warn: 2 } }, ptClients: {} },
  briefs: { b1: { client: 'Reiss', st: 'briefed' }, b2: { client: 'Reiss', st: 'done' } },
  volumes: (function () {
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(2026, 8 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const hours = {}, emails = {};
    // 10,11,…,21 across the 12 months: 12mo = 186, 6mo = 111, 3mo = 60. Deliberately rising so
    // a window that silently summed the WHOLE range instead of its tail would not coincide.
    months.forEach((m, i) => { hours[m] = 10 + i; emails[m] = 2; });
    return { ok: true, client: 'Reiss', months,
      streams: { schedule: { n: 12, byMonth: hours, sums: { hours: hours } }, emails: { n: 24, byMonth: emails } } };
  })(),
};
// Stub set B: the archives are down and nothing is wired. Nothing here may render as a zero.
const EMPTY = {
  abtests: { ok: false, error: 'no_archive_tab', tests: [] },
  kwresults: { ok: false },
  audit: {}, clients: { clients: {} }, alerts: {}, briefs: {},
  volumes: { ok: false, error: 'outside your client scope' },
};

async function run(stubs) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: !process.argv.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/api/**', (route) => {
    const u = route.request().url();
    const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('/api/abtests')) return j(stubs.abtests);
    if (u.includes('/api/kwresults')) return j(stubs.kwresults);
    if (u.includes('/api/feed/audit')) return j(stubs.audit);
    if (u.includes('/api/feed/clients')) return j(stubs.clients);
    if (u.includes('/api/labels/alerts')) return j(stubs.alerts);
    if (u.includes('/api/volumes')) return j(stubs.volumes);
    if (u.includes('/api/briefs')) return j(stubs.briefs);
    return j({});
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.dz-list *')].find((e) => e.textContent.trim() === 'Reiss');
    if (el) el.click();
  });
  await page.waitForTimeout(800);
  const btn = await page.locator('.dz-opb').count();
  if (btn) { await page.locator('.dz-opb').first().click(); await page.waitForTimeout(1400); }
  const sheet = await page.locator('#op-sheet').count();
  const text = sheet ? await page.locator('#op-sheet').innerText() : '';
  await browser.close();
  return { btn, sheet, text, errs };
}

console.log('\n-- the sheet opens from the dossier --');
const A = await run(FULL);
ok('a One-pager button exists on the brand card', A.btn === 1, A.btn);
ok('clicking it renders the sheet', A.sheet === 1);
ok('no page errors', A.errs.length === 0, A.errs.slice(0, 2));

console.log('\n-- every section is present --');
['What’s live today', 'The work behind it', 'Nothing changes without a test',
 'Watched every day', 'Where the account stands'].forEach((s) => {
  ok('section: ' + s, A.text.includes(s));
});
ok('carries the confidentiality footer', A.text.includes('Private & Confidential'));

console.log('\n-- the numbers are the brand’s own --');
ok('all-time tasks delivered (447 from the plan)', /\b447\b/.test(A.text));
ok('12-month window reads 78 worked / 58 done', /78[\s\S]{0,40}58/.test(A.text), A.text.match(/Last 12 months[\s\S]{0,60}/));
ok('6-month window reads 54', /Last 6 months[\s\S]{0,30}54/.test(A.text));
ok('3-month window reads 40', /Last 3 months[\s\S]{0,30}40/.test(A.text));
ok('markets live = 5 wired', /5[\s\S]{0,30}Markets live/.test(A.text));
ok('test archive total lands', /10[\s\S]{0,40}Tests run/.test(A.text));
ok('win rate lands', A.text.includes('50%'));
ok('best result quoted from the archive', A.text.includes('+21.37%'));
// Ray's exact ask: hours and email volume per look-back window, in one table
const hrsOf = (lbl) => { const seg = (A.text.split(lbl)[1] || '').split('\n')[0]; const n = seg.match(/\d+/g) || []; return n.map(Number); };
ok('12-month hours summed from the schedule (186)', hrsOf('Last 12 months')[2] === 186, hrsOf('Last 12 months'));
ok('6-month hours are the tail only (111)', hrsOf('Last 6 months')[2] === 111, hrsOf('Last 6 months'));
ok('3-month hours are the tail only (60)', hrsOf('Last 3 months')[2] === 60, hrsOf('Last 3 months'));
ok('each window is a strict subset of the longer one',
   hrsOf('Last 3 months')[2] < hrsOf('Last 6 months')[2] && hrsOf('Last 6 months')[2] < hrsOf('Last 12 months')[2]);
ok('emails handled appear per window (24 over 12mo)', /Last 12 months[\s\S]{0,80}24/.test(A.text));
ok('12-month email total also heads the standing section', /24[\s\S]{0,40}Requests answered/.test(A.text),
   A.text.match(/[\s\S]{0,60}Requests answered/));

console.log('\n-- missing data renders as "—", never as a confident zero --');
const B = await run(EMPTY);
ok('the sheet still renders with everything down', B.sheet === 1);
ok('no page errors on the empty path', B.errs.length === 0, B.errs.slice(0, 2));
ok('tests stat is a dash, not 0', /—[\s\S]{0,40}Tests run/.test(B.text), B.text.match(/[\s\S]{0,50}Tests run/));
ok('markets stat is 0-with-explanation, not a bare 0',
   B.text.includes('no feed wired yet'), B.text.match(/[\s\S]{0,60}Markets live/));
ok('feed quality is a dash', /—[\s\S]{0,40}Feed quality/.test(B.text));
ok('hours dash out when the schedule does not cover the brand', !/Hours delivered[\s\S]{0,120}\b0\b/.test(B.text));
ok('no stray "NaN" or "undefined" anywhere', !/NaN|undefined/.test(B.text), B.text.match(/.{0,40}(NaN|undefined).{0,40}/));

console.log('\n-- client-safe: no internal vocabulary --');
// these are everyday words elsewhere in the FCC and must never reach a client's desk
const LEAKS = ['FCC', 'Command Center', 'Workflow', 'Feed Lab', 'Label Guard', 'Golden Record',
  'Tachyon', 'FeedHero', 'KV', 'ibfcode', 'ASPL', 'TechAM', 'gviz', 'Cloudflare', 'triage'];
LEAKS.forEach((w) => {
  ok('does not leak "' + w + '"', !new RegExp('\\b' + w.replace(/ /g, '\\s') + '\\b', 'i').test(A.text),
     A.text.match(new RegExp('.{0,50}' + w + '.{0,50}', 'i')));
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
