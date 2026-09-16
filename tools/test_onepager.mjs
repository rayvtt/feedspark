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
let FULL_PLAN = {};
const FULL = {
  abtests: { ok: true, client: 'Reiss', tab: 'AB Test Archive',
    summary: { total: 10, positive: 2, negative: 2, inconclusive: 6, winRate: 50 },
    tests: [
      { batch: 'Jan II - Keyword Optimisation', type: 'Keyword Optimisation', verdict: 'positive', metrics: { impressions: 21.37, clicks: 11.85 }, report: 'r' },
      { batch: 'Jan I - Keyword Optimisation', type: 'Keyword Optimisation', verdict: 'negative', metrics: { impressions: -17.67, clicks: -18.18 }, report: 'r' },
    ] },
  kwresults: { ok: true, results: [], total: 23 },
  arrivals: null,   // filled below, once the month list exists
  intake: { connected: true, calls: [], items: [
    { client: 'Reiss', subject: 'Newest Reiss request', from: 'Emily Clark <emily@reiss.com>', date: Date.now() },
    { client: 'Reiss', subject: 'Batch approval [ibfref:REIS-20260910-02]', from: 'steven@agency.com', date: Date.now() - 2e8 },
    { client: 'Schuh', subject: 'A SCHUH email that must not appear', from: 'x@schuh.com', date: Date.now() }] },
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
    FULL_PLAN = {}; months.forEach((m, i) => { FULL_PLAN[m] = 4 + (i % 3); });
    return { ok: true, client: 'Reiss', months,
      streams: { schedule: { n: 12, byMonth: hours, sums: { hours: hours } }, emails: { n: 24, byMonth: emails },
        plan: { n: 60, byMonth: FULL_PLAN } } };
  })(),
};
// arrivals ride the same months as the volumes payload; Schuh's feed is present precisely so
// the sum can be asserted to exclude it
FULL.arrivals = { ok: true, feeds: [
  { client: 'Reiss', mkt: 'gb', kind: 'xml', dob: { m: Object.fromEntries(FULL.volumes.months.map((m, i) => [m, 100 + i])) } },
  { client: 'Reiss', mkt: 'us', kind: 'xml', dob: { m: Object.fromEntries(FULL.volumes.months.map((m) => [m, 50])) } },
  { client: 'Schuh', mkt: 'gb', kind: 'xml', dob: { m: Object.fromEntries(FULL.volumes.months.map((m) => [m, 9999])) } }] };

// Stub set B: the archives are down and nothing is wired. Nothing here may render as a zero.
const EMPTY = {
  abtests: { ok: false, error: 'no_archive_tab', tests: [] },
  kwresults: { ok: false },
  audit: {}, clients: { clients: {} }, alerts: {}, briefs: {},
  volumes: { ok: false, error: 'outside your client scope' },
  arrivals: { ok: false }, intake: { connected: false },
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
    if (u.includes('/api/volume/arrivals')) return j(stubs.arrivals);
    if (u.includes('/api/gmail/intake')) return j(stubs.intake);
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
  const html = sheet ? await page.locator('#op-sheet').innerHTML() : '';
  const svgs = sheet ? await page.locator('#op-sheet svg').count() : 0;
  await browser.close();
  return { btn, sheet, text, html, svgs, errs };
}

console.log('\n-- the sheet opens from the dossier --');
const A = await run(FULL);
ok('a One-pager button exists on the brand card', A.btn === 1, A.btn);
ok('clicking it renders the sheet', A.sheet === 1);
ok('no page errors', A.errs.length === 0, A.errs.slice(0, 2));

console.log('\n-- every section is present --');
['What’s live today', 'The work behind it', 'Optimisation in detail',
 'Watched every day', 'Month by month', 'Where the account stands'].forEach((s) => {
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


console.log('\n-- section 1 is coverage only; anything granular moved to optimisation --');
ok('search-term coverage is NOT in section 1',
   A.text.indexOf('Search-term coverage') > A.text.indexOf('Optimisation in detail'),
   { cov: A.text.indexOf('Search-term coverage'), opt: A.text.indexOf('Optimisation in detail') });
ok('markets and feed quality sit together', /Markets live[\s\S]{0,120}Feed quality score/.test(A.text));
ok('a per-market table lists each market', /MARKET[\s\S]{0,200}\bGB\b[\s\S]{0,120}\bUS\b/i.test(A.text));

console.log('\n-- the area mix carries percentages --');
ok('a "where the work went" breakdown renders', /Where the work went/i.test(A.text));
ok('areas are shown as percentages', /\d+(\.\d+)?%[\s\S]{0,30}\d+\/\d+ done/.test(A.text),
   A.text.match(/Where the work went[\s\S]{0,160}/));
ok('the mix sums to about 100%', (function () {
  const seg = (A.text.split(/where the work went/i)[1] || '').split(/by look-back/i)[0];
  const pcts = (seg.match(/(\d+(?:\.\d+)?)%/g) || []).map((x) => parseFloat(x));
  const sum = pcts.reduce((a, b) => a + b, 0);
  return sum > 97 && sum < 103;
})());

console.log('\n-- the test record is itemised, not just counted --');
ok('a test-record table renders', /THE TEST RECORD/i.test(A.text));
ok('a named test appears with its uplift', /Jan II - Keyword Optimisation[\s\S]{0,80}\+21\.37%/.test(A.text));
ok('a losing test is labelled lost', /-17\.67%[\s\S]{0,60}lost/.test(A.text));

console.log('\n-- monthly volume charts --');
ok('at least two charts render as SVG', A.svgs >= 2, A.svgs);
ok('new products get their OWN chart, not a shared scale',
   /New products entering the catalogue/i.test(A.text));
ok('the work chart legends both series', /Emails in[\s\S]{0,40}Work booked in/.test(A.text));
// the arrivals chart must sum this brand's markets only — Schuh's 9999/month sits in the payload
ok('arrivals exclude another brand\u2019s feed', !/9999/.test(A.html), A.html.match(/.{0,40}9999.{0,40}/));
ok('arrivals sum the brand\u2019s own markets (gb+us)', /151|150/.test(A.html));

console.log('\n-- section 6 is itemised --');
ok('open tasks are listed by name', /OPEN RIGHT NOW/i.test(A.text));
ok('the pipeline is listed by name', /IN THE PIPELINE/i.test(A.text));
ok('the five most recent requests are listed', /MOST RECENT REQUESTS/i.test(A.text));
ok('the newest request is this brand\u2019s', A.text.includes('Newest Reiss request'));
ok('another brand\u2019s email never appears', !A.text.includes('A SCHUH email that must not appear'));
ok('a ticket reference is stripped without leaving empty brackets',
   A.text.includes('Batch approval') && !/Batch approval\s*\[\s*\]/.test(A.text),
   A.text.match(/Batch approval.{0,24}/));

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
