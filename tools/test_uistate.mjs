#!/usr/bin/env node
/*
 * A REFRESH SHOULD NOT BLANK THE PAGE (Ray, 24 Sep 2026).
 *
 *   "Can FCC handle a refresh so the page retains the previous session selection? For example,
 *    if anything written in the task manager uses the text bar, it should stay there unless
 *    changed. A preselected option on a certain module should also remain after refresh, not
 *    result in a completely blank page."
 *
 * Two shapes of state were losing themselves on a bare reload (opening the module from its own
 * nav link, a bookmark, or a fresh tab — anything that doesn't already carry the page's own
 * `?client=`/`?q=` query string):
 *
 *   1. FS TASK MANAGER's search box and its chart controls (split / nested splits / form / which
 *      tab was open / whether the table was showing) were either read from the URL ONLY (so a
 *      bare link always opened blank) or not persisted at all (the tab and the table toggle).
 *      Fixed the same way `fcc-tm-meas`/`fcc-tm-lab` already worked: `?param=` wins when a link
 *      names one, else the device's last pick, else the page's own default.
 *   2. The brand/client picker on Feed Lab, Volume, KWCal and AI Quote always fell back to a
 *      hardcoded or first-alphabetical brand with no memory at all — so leaving Reiss's dossier
 *      open and coming back the next day landed back on the client list's own A-to-Z winner.
 *
 * Run: node tools/test_uistate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

/* ==================================================== FS TASK MANAGER ====================== */
console.log('\n-- Task Manager: the restore rule is URL-param, else remembered, else default --');
const TM = read('docs/FeedSpark_TaskManager.html');

// pull the boot() restore block out by its own opening comment, so a source edit that moves it
// still gets tested rather than silently skipped
function slice(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('marker not found: ' + startMarker);
  const j = src.indexOf(endMarker, i);
  if (j < 0) throw new Error('end marker not found after start: ' + endMarker);
  return src.slice(i, j + endMarker.length);
}
const restoreBlock = slice(TM, "try {\n      var qp = new URL(location.href).searchParams;", '} catch (e) {}');

ok('the restore block reads ?q= OR the remembered search text, never ?q= alone',
  /qvv = qp\.get\('q'\); if \(qvv == null\) qvv = localStorage\.getItem\('fcc-tm-q'\)/.test(restoreBlock));
ok('…split (dim), else the remembered split, validated against the real DIMS list',
  /dvv = qp\.get\('dim'\) \|\| localStorage\.getItem\('fcc-tm-dim'\)/.test(restoreBlock)
  && /DIMS\.some\(function \(x\) \{ return x\.k === dvv; \}\)/.test(restoreBlock));
ok('…the two nested splits', /localStorage\.getItem\('fcc-tm-dim2'\)/.test(restoreBlock) && /localStorage\.getItem\('fcc-tm-dim3'\)/.test(restoreBlock));
ok('…the form, validated against the real FORMS list',
  /fvv = qp\.get\('form'\) \|\| localStorage\.getItem\('fcc-tm-form'\)/.test(restoreBlock)
  && /FORMS\.some\(function \(o\) \{ return o\.v === fvv; \}\)/.test(restoreBlock));
ok('…which of Tasks / Client tickets / Accounts was open, validated against the three real tabs',
  /tvv = qp\.get\('tab'\) \|\| localStorage\.getItem\('fcc-tm-tab'\)/.test(restoreBlock)
  && /\['tasks', 'tickets', 'accounts'\]\.indexOf\(tvv\) >= 0/.test(restoreBlock));
ok('…and whether the table under the chart was showing', /localStorage\.getItem\('fcc-tm-table'\)/.test(restoreBlock));
ok('an explicit link still wins over a remembered pick — never the other way round (the meas/lab precedent)',
  /qp\.get\('q'\)/.test(restoreBlock) && restoreBlock.indexOf("qp.get('q')") < restoreBlock.indexOf("localStorage.getItem('fcc-tm-q')"));

ok('the search box saves its OWN raw text on every apply(), not just when it changes via oninput — so a chip click or a clear button also sticks',
  /localStorage\.setItem\('fcc-tm-q', \$\('q'\)\.value\)/.test(TM));
ok('the split saves itself (and clears its own children) on change', /localStorage\.setItem\('fcc-tm-dim', CDIM\); localStorage\.setItem\('fcc-tm-dim2', CDIM2\); localStorage\.setItem\('fcc-tm-dim3', CDIM3\)/.test(TM));
ok('the nested splits save on their own change too', (TM.match(/localStorage\.setItem\('fcc-tm-dim2'/g) || []).length >= 2 && (TM.match(/localStorage\.setItem\('fcc-tm-dim3'/g) || []).length >= 2);
ok('the form saves on change', /localStorage\.setItem\('fcc-tm-form', CFORM\)/.test(TM));
ok('the table toggle saves on change (it never used to save at all)', /localStorage\.setItem\('fcc-tm-table', \$\('ctab'\)\.checked \? '1' : '0'\)/.test(TM));
ok('the open tab saves on click', /localStorage\.setItem\('fcc-tm-tab', TAB\)/.test(TM));

// PROVE the actual semantics, not just that the strings are present: build a minimal sandbox
// standing in for the DOM/localStorage this restore block reads, and run the real block.
console.log('\n-- Task Manager: the restore logic actually behaves that way, not just reads that way --');
function runRestore({ urlQuery, stored, dims, forms }) {
  const els = {
    q: { value: '' }, cdim: { value: '' }, cform: { value: '' }, cmeas: { value: '' },
    ctab: { checked: false },
    tabs: { querySelectorAll: () => [
      { getAttribute: (k) => (k === 'data-t' ? 'tasks' : null), classList: { toggle: () => {} } },
      { getAttribute: (k) => (k === 'data-t' ? 'tickets' : null), classList: { toggle: () => {} } },
      { getAttribute: (k) => (k === 'data-t' ? 'accounts' : null), classList: { toggle: () => {} } },
    ] },
  };
  const store = { ...stored };
  const sandbox = {
    console,
    $: (id) => els[id],
    location: { href: 'https://feedspark.example/tasks' + (urlQuery ? '?' + urlQuery : '') },
    URL,
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    DIMS: dims || [{ k: 'client' }, { k: 'owner' }],
    FORMS: forms || [{ v: 'donut' }, { v: 'stack' }],
    MEASURES: ['hours'],
    LABS: [{ v: 'hours' }],
    CDIM: 'total', CDIM2: '', CDIM3: '', CFORM: 'donut', CMEAS: 'hours', CLAB: 'hours', TAB: 'tasks',
    Array,
  };
  vm.createContext(sandbox);
  vm.runInContext(restoreBlock, sandbox);
  return { els, CDIM: sandbox.CDIM, CDIM2: sandbox.CDIM2, CFORM: sandbox.CFORM, TAB: sandbox.TAB };
}

let r = runRestore({ urlQuery: '', stored: { 'fcc-tm-q': 'client:Reiss cat:opt' } });
ok('bare reload, no URL param at all: the remembered search text is restored', r.els.q.value === 'client:Reiss cat:opt', r.els.q.value);

r = runRestore({ urlQuery: 'q=cat:tech', stored: { 'fcc-tm-q': 'client:Reiss cat:opt' } });
ok('a link naming ?q= wins over whatever this device had remembered', r.els.q.value === 'cat:tech', r.els.q.value);

r = runRestore({ urlQuery: '', stored: {} });
ok('nothing remembered, no link: the box stays exactly as its own HTML default (empty), never an error', r.els.q.value === '');

r = runRestore({ urlQuery: '', stored: { 'fcc-tm-dim': 'owner', 'fcc-tm-dim2': 'month' }, dims: [{ k: 'client' }, { k: 'owner' }, { k: 'month' }] });
ok('the remembered split is restored and reflected onto the real <select>', r.CDIM === 'owner' && r.els.cdim.value === 'owner', r);
ok('a remembered nested split restores too', r.CDIM2 === 'month', r.CDIM2);

r = runRestore({ urlQuery: '', stored: { 'fcc-tm-dim': 'discontinued-dim' } });
ok('a remembered split that no longer exists on this build is ignored, not applied blind', r.CDIM === 'total', r.CDIM);

r = runRestore({ urlQuery: '', stored: { 'fcc-tm-tab': 'accounts' } });
ok('the remembered open tab is restored', r.TAB === 'accounts', r.TAB);

r = runRestore({ urlQuery: '', stored: { 'fcc-tm-table': '1' } });
ok('the remembered table-under-chart toggle is restored', r.els.ctab.checked === true, r.els.ctab.checked);

r = runRestore({ urlQuery: '', stored: { 'fcc-tm-table': '0' } });
ok('…and a remembered OFF stays off (not just "truthy string present")', r.els.ctab.checked === false, r.els.ctab.checked);

/* =================================== THE FOUR BRAND-SELECTOR MODULES ======================== */
console.log('\n-- Feed Lab / Volume / KWCal / AI Quote: the brand picker remembers this device’s last pick --');
const cases = [
  { name: 'Feed Lab', file: 'docs/FeedSpark_FeedLab.html', key: 'fcc-fl-client' },
  { name: 'Volume', file: 'docs/FeedSpark_Volume.html', key: 'fcc-vol-client' },
  { name: 'KWCal', file: 'docs/FeedSpark_KWCal.html', key: 'fcc-kw-client' },
  { name: 'AI Quote', file: 'docs/FeedSpark_AIQuote.html', key: 'fcc-aiq-client' },
];
cases.forEach(({ name, file, key }) => {
  const src = read(file);
  const reads = src.split(key).length - 1;
  ok(name + ': the remembered-brand key is both read and written (not a write nobody reads, or vice versa)',
    new RegExp('localStorage\\.getItem\\(\'' + key + '\'\\)').test(src) && new RegExp('localStorage\\.setItem\\(\'' + key + '\'').test(src), reads);
  ok(name + ': every localStorage touch on the brand key is wrapped in try/catch (private-window / blocked storage must not break the page)',
    (() => {
      const idxs = []; let i = -1;
      while ((i = src.indexOf(key, i + 1)) >= 0) idxs.push(i);
      return idxs.every((idx) => {
        // walk back from the key to the nearest preceding try{ / try { on the SAME statement run
        // (no unmatched '}' in between — a wider window than one fixed char count, since a real
        // statement ahead of the setItem call, e.g. an history.replaceState(...), can be long)
        const before = src.slice(Math.max(0, idx - 400), idx);
        const tryAt = before.lastIndexOf('try');
        if (tryAt < 0) return false;
        const between = before.slice(tryAt);
        return /^try\s*\{/.test(between) && (between.match(/\}/g) || []).length === 0;
      });
    })());
});
ok('Feed Lab: an explicit ?client= link still wins over a remembered brand (the deep-link contract is untouched)',
  /var remembered='';try\{remembered=localStorage\.getItem\('fcc-fl-client'\)\|\|''\}catch\(e\)\{\}/.test(read('docs/FeedSpark_FeedLab.html'))
  && /load\(META\[pre\]\?pre:\(META\[remembered\]\?remembered:'Reiss'\),preM\|\|undefined\)/.test(read('docs/FeedSpark_FeedLab.html')));
ok('KWCal: ?client=*  (All brands) and a remembered "*" both still resolve, not just named brands',
  /remembered==='\*'\|\|roster\[remembered\]/.test(read('docs/FeedSpark_KWCal.html')));
ok('AI Quote: the remembered brand is checked against the CURRENT client list — a brand dropped from the estate never sticks',
  /rememberedHit=remembered&&cs\.indexOf\(remembered\)>=0&&remembered/.test(read('docs/FeedSpark_AIQuote.html')));
ok('Volume: a remembered brand yields to an explicit ?client=/?b= link, and to a table-row click, but not to the plain A-Z default',
  /var rememberedHit=!hit&&remembered&&cs\.filter/.test(read('docs/FeedSpark_Volume.html')));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
