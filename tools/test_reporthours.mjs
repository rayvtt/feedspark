#!/usr/bin/env node
/*
 * Retainer-hours classification + aggregation (Ray, 16 Sep 2026).
 *
 * The fixtures are REAL task titles, taken verbatim from the FeedSpark reports database across
 * the whole book, because the thing that breaks this classifier is our own vocabulary:
 *   - "Project & Optimisation Plan Update" carries the word Optimisation and is plan admin;
 *   - "Batch Report" is reporting, "Batch set-up" is build, one word apart;
 *   - "Image optimisations" is optimisation, "DPA Image Overlay" is the overlay service;
 *   - "Scraping changes" is plumbing, not content.
 * Every one of those is a precedence question, so they are pinned here rather than trusted.
 *
 * Run: node tools/test_reporthours.mjs
 */
import { classifyTask, taskKey, monthKey, aggregate, mixVerdict, brandKey, CATS, CAT_LABEL }
  from './reporthours.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const is = (name, title, want) => ok(name + ' → ' + want, classifyTask(title) === want, classifyTask(title));

console.log('\n-- optimisation: the work that moves performance --');
is('Keyword optimisation', 'Keyword optimisation', 'opt');
is('Title optimisation', 'Title optimisation', 'opt');
is('Data field and title optimisation', 'Data field and title optimisation', 'opt');
is('Custom Label update', 'Custom Label update', 'opt');
is('Product Type Optimisation', 'Product Type Optimisation', 'opt');
is('Category mapping', 'Category mapping', 'opt');
is('Image optimisations', 'Image optimisations', 'opt');
is('Social Title Optimisation', 'Social Title Optimisation', 'opt');
is('GTIN work', 'GTIN work', 'opt');
is('Competitor keyword', 'Competitor keyword', 'opt');
// "AOTitles" is a real typo in the data and must not fall through to Other on that account
is('AOTitles work (typo in source)', 'AOTitles work', 'opt');
is('UK Meta Sale Products in New In Label', 'UK Meta Sale Products in New In Label', 'opt');

console.log('\n-- technical: something is broken --');
is('Disapprovals', 'Disapprovals', 'tech');
is('GMC Fixing', 'GMC Fixing', 'tech');
is('GMC Account Issue', 'GMC Account Issue (different from Disapprovals)', 'tech');
is('Scraping changes', 'Scraping changes', 'tech');
is('Virtual Products monitoring (scrape)', 'Virtual Products monitoring (scrape)', 'tech');
is('Urgent Feed issues', 'Urgent Feed issues', 'tech');
is('Feeds Checks', 'Feeds Checks', 'tech');
is('Mismatched Price Issue checked', 'Mismatched Price Issue checked', 'tech');

console.log('\n-- feature & set-up: new capability --');
is('New Feeds', 'New Feeds', 'feat');
is('DPA Image Overlay', 'DPA Image Overlay', 'feat');
is('Dev Work', 'Dev Work', 'feat');
is('Output feed exclusion setup', 'Output feed exclusion setup', 'feat');
is('Pinterest Feed hostiing (typo in source)', 'Pinterest Feed hostiing', 'feat');
is('FeedSpark access Configuration', 'FeedSpark access Configuration', 'feat');

console.log('\n-- account & support --');
is('General account management', 'General account management', 'acct');
is('Client call', 'Client call', 'acct');
is('QBR prep', 'QBR prep', 'acct');
is('Batch Report', 'Batch Report', 'acct');
is('Ryobi x FeedSpark - Monthly Catch up', 'Ryobi x FeedSpark - Monthly Catch up', 'acct');
is('Email ticket', 'Email ticket: [New Market Launches - ShopBrand]', 'acct');
is('forwarded mail', 'FW: Services & Billing clarification', 'acct');

console.log('\n-- PRECEDENCE: the traps, where the obvious keyword is the wrong one --');
// each of these would land in the wrong slice if the rules were reordered
is('plan admin beats the word "Optimisation"', 'Project & Optimisation Plan Update', 'acct');
is('…including the HTML-escaped form in the data', 'Project &amp; Optimisation Plan Update', 'acct');
is('Batch set-up is build, not the Batch Report', 'Batch set-up', 'feat');
is('a call about keywords is still a call', 'Monsoon x Katte.Co x FeedSpark - Monthly Call - FH', 'acct');
is('overlay work is the service, not image optimisation', 'Overlay Works', 'feat');
is('a strategy deck is account time', 'Deck prepartiong for Marketing team', 'acct');
// both of these were wrong in the first cut and the rendered sheet is what exposed them
is('"PT Fixes" is the category tree, not a technical fault', 'PT Fixes', 'opt');
is('…so is "Product Type Fixes"', 'Product Type Fixes', 'opt');
is('a keyword brief named "… Marketing Planner" is keyword work',
   '[FS Brief] Reiss  Keywords Optimisation - Cashmere/Merino - Marketing Planner - 0926', 'opt');
is('and so is the Keyword Planner itself', "Reiss' Keyword Planner", 'opt');
is('a bare "Fixing" with no other clue is technical', 'Fixing the overnight run', 'tech');
ok('an unknown title is Other, never quietly folded into a category',
   classifyTask('Zzz unknowable thing') === 'other', classifyTask('Zzz unknowable thing'));
ok('an empty title is Other', classifyTask('') === 'other' && classifyTask(null) === 'other');

console.log('\n-- task keys: repeat runs fold, distinct work does not --');
ok('"- 4" is the fourth run of the same task', taskKey('Keyword optimisation - 4') === 'Keyword optimisation');
ok('en-dash form too', taskKey('Keyword optimisation – 12') === 'Keyword optimisation');
ok('an escaped ampersand is decoded', taskKey('Leather &amp; Suede') === 'Leather & Suede');
ok('a trailing number that is part of the name is NOT stripped',
   taskKey('Reiss 2026 plan') === 'Reiss 2026 plan', taskKey('Reiss 2026 plan'));

console.log('\n-- dates: never guessed --');
ok('a normal date buckets to its month', monthKey('2026-09-15 08:43:21') === '2026-09');
ok('the source’s 0000-00-00 is undated, not year zero', monthKey('0000-00-00') === '');
ok('an empty date is undated', monthKey('') === '' && monthKey(null) === '');

console.log('\n-- aggregation --');
const ROWS = [
  { title: 'Keyword optimisation', created_on: '2026-08-01', bill: 4, nonbill: 1, market: 'gb', owner: 'Dino' },
  { title: 'Keyword optimisation - 2', created_on: '2026-08-14', bill: 2, nonbill: 0, market: 'gb', owner: 'Dino' },
  { title: 'Disapprovals', created_on: '2026-08-20', bill: 1, nonbill: 0, market: 'gb', owner: 'Vitus' },
  { title: 'New Feeds', created_on: '2026-09-02', bill: 2, nonbill: 0, market: 'de', owner: 'Febin' },
  { title: 'Client call', created_on: '2026-09-03', bill: 1, nonbill: 0, market: 'gb', owner: 'Ray' },
  { title: 'Zzz mystery', created_on: '2026-09-04', bill: 1, nonbill: 0, market: 'gb', owner: 'Ray' },
  { title: 'Keyword optimisation', created_on: '2024-01-01', bill: 99, nonbill: 99, market: 'gb' }, // outside
  { title: 'Keyword optimisation', created_on: '0000-00-00', bill: 50, nonbill: 0, market: 'gb' },  // undated
];
const A = aggregate(ROWS, { from: '2026-08-01', to: '2026-09-30' });
ok('only in-window rows count', A.tasks === 6, A.tasks);
ok('an out-of-window row is excluded, not clamped', A.hours === 12, A.hours);
ok('undated rows are counted apart, never dated by guess', A.undated === 1, A.undated);
ok('billable and non-billable both count toward the mix',
   A.bill === 11 && A.nonbill === 1, [A.bill, A.nonbill]);
ok('categories carry the right hours',
   A.cats.opt === 7 && A.cats.tech === 1 && A.cats.feat === 2 && A.cats.acct === 1 && A.cats.other === 1, A.cats);
const sum = CATS.reduce((s, c) => s + A.mix[c], 0);
ok('the mix sums to 100%', Math.abs(sum - 100) < 0.05, sum);
ok('Other is IN the mix — a pie that hides it overstates every other slice', A.mix.other > 0, A.mix.other);
ok('repeat runs fold into one task row',
   A.taskRows[0].t === 'Keyword optimisation' && A.taskRows[0].n === 2 && A.taskRows[0].h === 7, A.taskRows[0]);
ok('task rows are ranked by hours', A.taskRows.every((t, i, a) => !i || a[i - 1].h >= t.h));
ok('the task rows sum to the total hours',
   Math.abs(A.taskRows.reduce((s, t) => s + t.h, 0) - A.hours) < 0.01);
// August holds both keyword runs (4+1 on the 1st, 2 on the 14th) = 7; September holds the rest
ok('months are bucketed', A.months['2026-08'].opt === 7 && A.months['2026-09'].feat === 2, A.months);
ok('markets are summed', A.markets.gb === 10 && A.markets.de === 2, A.markets);
ok('first/last bound the real data', A.first === '2026-08-01' && A.last === '2026-09-04');
ok('an empty input is empty, not NaN',
   aggregate([], {}).hours === 0 && aggregate(null, {}).tasks === 0);

console.log('\n-- the verdict Ray reads off the pie --');
ok('a majority on optimisation is optimisation-led', mixVerdict({ opt: 70 }).v === 'good');
ok('exactly half is still optimisation-led', mixVerdict({ opt: 50 }).v === 'good');
ok('a third is balanced', mixVerdict({ opt: 40 }).v === 'ok');
ok('a minority is flagged, not softened', mixVerdict({ opt: 16 }).v === 'warn');
ok('no hours is not a failing grade', mixVerdict({ opt: 0 }).v === 'none');

console.log('\n-- brand names: the reports database spells them its own way --');
ok('Jomalone matches Jo Malone', brandKey('Jomalone') === brandKey('Jo Malone'));
ok('YuMove matches YuMOVE', brandKey('YuMove') === brandKey('YuMOVE'));
ok('accents fold', brandKey('Estée Lauder') === brandKey('Estee Lauder'));
ok('House of Bruar folds', brandKey('House of Bruar') === 'houseofbruar');
ok('two different brands do NOT collide', brandKey('Monsoon') !== brandKey('Accessorize'));

console.log('\n-- the page carries the same fold, and the same categories --');
const page = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');
ok('the page defines opBrandKey', /function opBrandKey\(/.test(page));
ok('…stripping the same characters', /replace\(\/\[\^a-z0-9\]\/g, ''\)/.test(page));
ok('the page renders a pie', /function opPie\(/.test(page));
ok('the page renders the per-task hours table', /function opTaskHours\(/.test(page));
ok('the HOURS splice markers exist', page.indexOf('<!-- HOURS:START -->') > 0 && page.indexOf('<!-- HOURS:END -->') > 0);
CATS.filter((c) => c !== 'other').forEach((c) => {
  ok('the page names the "' + CAT_LABEL[c] + '" slice', page.indexOf(CAT_LABEL[c]) > 0);
});

console.log('\n-- the baked snapshot --');
const snapPath = path.join(ROOT, 'docs', 'reports_hours.json');
if (!fs.existsSync(snapPath)) {
  ok('docs/reports_hours.json exists', false);
} else {
  const S = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  ok('the snapshot names its own window', !!(S.from && S.to && S.at), [S.from, S.to, S.at]);
  ok('it carries clients', Object.keys(S.clients || {}).length > 0);
  const bad = Object.entries(S.clients || {}).filter(([, v]) => {
    const s = CATS.reduce((a, c) => a + (v.mix[c] || 0), 0);
    return Math.abs(s - 100) > 0.5;
  });
  ok('every client’s mix sums to 100%', bad.length === 0, bad.map((b) => b[0]));
  const neg = Object.entries(S.clients || {}).filter(([, v]) => v.hours < 0 || v.tasks < 0);
  ok('no negative hours', neg.length === 0, neg.map((b) => b[0]));
  const drift = Object.entries(S.clients || {}).filter(([, v]) => {
    const t = (v.top || []).reduce((s, x) => s + x.h, 0) + ((v.tail && v.tail.h) || 0);
    return Math.abs(t - v.hours) > 0.5;
  });
  // the table a reader can see must add up to the headline above it
  ok('the per-task table reconciles to each client’s total hours', drift.length === 0, drift.map((b) => b[0]));
  const unclassified = Object.entries(S.clients || {}).filter(([, v]) => v.mix.other > 25);
  ok('no client is more than a quarter unclassified', unclassified.length === 0,
     unclassified.map((b) => b[0] + ' ' + b[1].mix.other + '%'));
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
