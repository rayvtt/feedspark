#!/usr/bin/env node
/* The client PDF's stage map vs the Workflow pipeline's actual vocabulary (Ray, 22 Sep 2026,
 * reading his own Reiss PDF: "isn't cashmere/merino and leather & suede also 'Live' - so
 * shouldn't the box be orange?").
 *
 * They were Live — both tickets sat at Workflow's `running` ("Test running ⏱"), where an
 * optimisation is live in the feed and being measured — and the PDF painted them grey. CST
 * simply had no `running` key, so the lookup came back undefined and a ||'Scheduled' fallback
 * answered for it. The Live / complete KPI counted neither. Nothing failed; the document just
 * quietly told a client that live work had not started.
 *
 * That is a CROSS-FILE contract: FeedSpark_Workflow.html owns the stages, FeedSpark_KWCal.html
 * has to collapse every one of them into a client word. Neither file can see the other, so this
 * harness lifts BOTH by name and fails the moment they drift — which is the only thing that
 * stops the next stage Workflow adds from landing back in the grey.
 *
 * Run: NODE_PATH=$(npm root -g) node tools/test_kwcal_stages.mjs   (qa_gate / presync / validate) */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const kw = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_KWCal.html'), 'utf8');
const wf = fs.readFileSync(path.join(root, 'docs', 'FeedSpark_Workflow.html'), 'utf8');

let pass = 0; const fails = [];
const is = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('   ✓ ' + name); }
  else { fails.push(name + '\n      got  ' + a + '\n      want ' + b); console.log('   ✗ ' + name); }
};

// ---------- lift both vocabularies out of the pages, by name ----------
function liftBlock(src, decl, file) {                // `var NAME=…;` brace/bracket matched
  const at = src.indexOf('var ' + decl + '=');
  if (at < 0) throw new Error(`${file}: var ${decl} not found — did it get renamed?`);
  const open = /[[{]/.exec(src.slice(at)).index;
  const shut = src[at + open] === '[' ? ']' : '}';
  let depth = 0, inS = null, esc = false, line = false, block = false;
  for (let j = at + open; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inS) inS = null; continue; }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (!depth) return src.slice(at, j + 1) + ';'; }
  }
  throw new Error(`${file}: unbalanced ${decl}`);
}
const STAGES = new Function(`${liftBlock(wf, 'STAGES', 'Workflow')} return STAGES;`)();
const CST = new Function(`${liftBlock(kw, 'CST', 'KWCal')} return CST;`)();
const CSTC = new Function(`${liftBlock(kw, 'CSTC', 'KWCal')} return CSTC;`)();
const SRANK = new Function(`${liftBlock(kw, 'SRANK', 'KWCal')} return SRANK;`)();

console.log('-- the two files agree on the vocabulary --');
const stageKeys = STAGES.map((s) => s[0]).sort();
is('Workflow still owns the eight pipeline stages', stageKeys,
  ['analysis', 'blocked', 'briefed', 'confirmed', 'done', 'intake', 'progress', 'running']);
// THE BUG: `running` was missing. Every stage, not just the ones someone remembered.
const unmapped = stageKeys.filter((k) => !CST[k]);
is('every pipeline stage collapses to a client word — none falls through to the fallback', unmapped, []);
is('`running` — a test live in the feed — reads Live, not Scheduled', CST.running, 'Live');
is('`analysis` reads Live too — still live, being read', CST.analysis, 'Live');
is('the calendar’s own `planned` is mapped', CST.planned, 'Scheduled');
// every word CST can produce must have a colour class and a rank, or a day paints as 'sched'
const words = [...new Set(Object.values(CST))].sort();
is('every client word has a colour class', words.filter((w) => !CSTC[w]), []);
is('every client word has a rank, so a day shows its furthest-along optimisation',
  words.filter((w) => SRANK[w] === undefined), []);
is('the four client words and no fifth', words, ['Complete', 'In progress', 'Live', 'Scheduled']);
// a CST key that is neither a pipeline stage nor a documented calendar word is dead weight —
// an unreachable key is exactly what made this map look complete
const own = ['planned', 'live'];
is('no CST key outside the pipeline except the calendar’s own two',
  Object.keys(CST).filter((k) => !stageKeys.includes(k) && !own.includes(k)), []);
is('the fallback can never silently read Scheduled again',
  /CST\[stOf\([^\]]*\)\]\s*\|\|\s*'Scheduled'/.test(kw), false);
is('one reader for the client word', (kw.match(/function cstOf\(/g) || []).length, 1);
is('and both PDF call sites go through it', (kw.match(/cstOf\(/g) || []).length >= 3, true);

// ---------- and the document actually draws it ----------
const req = createRequire(path.join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium;
try { ({ chromium } = req('playwright')); } catch { console.log('\n· playwright unavailable — DOM half skipped'); done(); }

function done() {
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }
  console.log('PASS'); process.exit(0);
}

console.log('-- and the client document draws it --');
// one Reiss moment per pipeline stage, tied by the calendar's own house task name
const T = (id, name, status) => [id, { id, client: 'Reiss', status, cat: 'keyword', updated: 1,
  task: 'Keywords Optimisation - ' + name + ' - Marketing Planner - 0926' }];
const WANT = [['Cashmere/Merino', 'running', 's-live'], ['Leather & Suede', 'running', 's-live'],
  ['Silk', 'analysis', 's-live'], ['Denim', 'confirmed', 's-done'], ['Tailoring', 'done', 's-done'],
  ['Coats', 'progress', 's-prog'], ['Gifting', 'blocked', 's-prog'], ['Jewellery', 'briefed', 's-prog'],
  ['Monogram', 'intake', 's-sched']];
const briefs = Object.fromEntries(WANT.map(([n, st], i) => T('b' + i, n, st)));
const INIT = 'window.__B=' + JSON.stringify(briefs) + ';'
  + "window.fetch=function(url){var u=String(url);var j=function(o){return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'content-type':'application/json'}}))};"
  + "if(u.indexOf('/api/feed/clients')>=0)return j({clients:{Reiss:{markets:['gb']}}});"
  + "if(u.indexOf('/api/feed/markets')>=0)return j({markets:{gb:1}});"
  + "if(u.indexOf('/api/kwresults')>=0)return j({results:[]});"
  + "if(u.indexOf('/api/briefs')>=0)return j(window.__B);"
  + "if(u.indexOf('/api/kwcal')>=0)return j({});return j({});};";

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await ctx.addInitScript({ content: INIT });
await page.goto('file://' + path.join(root, 'docs', 'FeedSpark_KWCal.html'));
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  window.print = function () {}; window.__saved = null;
  window.html2canvas = () => Promise.resolve({ width: 1400, height: 960, toDataURL: () => 'data:image/jpeg;base64,AAA' });
  window.jspdf = { jsPDF: function () { this.addImage = function () {}; this.save = function (n) { window.__saved = n; }; } };
  document.getElementById('pdf').click();
  await new Promise((r) => setTimeout(r, 1500));
  const d = document.getElementById('pdf-doc');
  const rows = {};
  d.querySelectorAll('.pd-ag').forEach((r) => {
    const n = (r.querySelector('.an') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
    const dot = r.querySelector('.dot');
    rows[n.split(' ')[0]] = dot ? dot.className.replace('dot ', '').trim() : '?';
  });
  const kpi = {};
  d.querySelectorAll('.pd-kpi').forEach((k) => { kpi[(k.querySelector('.l') || {}).textContent] = (k.querySelector('.n') || {}).textContent; });
  return { rows, kpi, legend: (d.querySelector('.pd-legend') || { textContent: '' }).textContent.replace(/\s+/g, ' ') };
});
WANT.forEach(([name, st, cls]) => {
  is(`${name} at "${st}" draws ${cls}`, out.rows[name.split(' ')[0]], cls);
});
// Ray's own reading: with two moments at `running`, the KPI must count them
is('Live / complete counts every Live and Complete moment', out.kpi['Live / complete'], '5');
is('the legend still offers exactly the four words',
  ['Scheduled', 'In progress', 'Live', 'Complete'].every((w) => out.legend.includes(w)), true);
is('no page errors', errs.length, 0);
await browser.close();
done();
