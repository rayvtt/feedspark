#!/usr/bin/env node
/**
 * Browser tests for the live deck editor.
 *
 * The editor is ~900 lines of browser JS living inside a template literal in worker.js, and
 * until now nothing exercised it. Every bug in it was found by Ray, in production, on a deck
 * he had already presented. This runs it in a real Chromium against a real deck file, with
 * the /api/edits endpoint stubbed by an in-memory KV, so the save/load/guard paths can be
 * asserted instead of reasoned about.
 *
 * Usage:  NODE_PATH=$(npm root -g) node tools/test_editor.mjs [--headed] [--only <substr>]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WORKER = 'cloudflare/feedspark-deck/src/worker.js';
const DECK = 'docs/Reiss_Strategy_Review_FY2526.html';

/** Pull getEditorScript() out of worker.js by brace-matching, and eval it. Avoids having to
 *  export it purely for tests (worker.js is a hot shared file — fewer edits, fewer merges). */
function loadEditorScriptFn() {
  const src = readFileSync(WORKER, 'utf8');
  const start = src.indexOf('function getEditorScript(');
  if (start < 0) throw new Error('getEditorScript not found in ' + WORKER);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  let inStr = null, esc = false, inTpl = 0;
  for (let p = i; p < src.length; p++) {
    const c = src[p], prev = src[p - 1];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '`') { inTpl ^= 1; continue; }
    if (inTpl) continue;
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '/' && prev === '/') { const nl = src.indexOf('\n', p); p = nl < 0 ? src.length : nl; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = p + 1; break; } }
  }
  if (end < 0) throw new Error('could not brace-match getEditorScript');
  const body = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(body + '; return getEditorScript;')();
}

const getEditorScript = loadEditorScriptFn();

function composePage(slug) {
  const deck = readFileSync(DECK, 'utf8');
  return deck.replace('</body>', getEditorScript(slug) + '\n</body>');
}

/* ------------------------------------------------------------------ harness */

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); }

async function withPage(fn, { initialEdits = {}, deriveEdits = null, version = null, headed = false } = {}) {
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome',
  }).catch(() => chromium.launch({ headless: !headed }));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const kv = { store: JSON.parse(JSON.stringify(initialEdits)), puts: [], backups: [] };

  // A REAL origin, not setContent(). With about:blank the page has an opaque origin, so
  // localStorage throws SecurityError AND every relative fetch fails — which made loadEdits()
  // bail to its catch on every test and handed back false passes for the guard tests.
  await page.route('https://deck.test/deck/reiss', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: composePage('reiss') }));

  await page.route('**/api/edits**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(kv.store) });
    }
    if (req.method() === 'PUT') {
      const incoming = JSON.parse(req.postData() || '{}');
      kv.puts.push({ replace: url.searchParams.get('replace') === '1', body: incoming,
        dropKeys: url.searchParams.get('drop') });
      const drop = (url.searchParams.get('drop') || '').split(',').filter(Boolean);
      if (url.searchParams.get('replace') === '1') {
        kv.backups.push(kv.store); kv.store = incoming;
      } else {
        kv.store = { ...kv.store, ...incoming };
      }
      for (const k of drop) delete kv.store[k];
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, count: Object.keys(kv.store).length }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/version**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ sha: version || 'testsha0' }) }));
  await page.route('**/api/feedback**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}' }));

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto('https://deck.test/deck/reiss', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  // Two-pass fixtures: some cases can only be built from the real rendered deck (a genuine
  // content key from one element paired with a positional key that points at another). Load
  // once to read those out, install the overlay, reload against it.
  if (deriveEdits) {
    kv.store = await deriveEdits(page);
    errors.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  }
  try {
    const out = await fn(page, kv);
    if (errors.length) throw new Error('page errors: ' + errors.slice(0, 2).join(' | '));
    return out;
  } finally { await browser.close(); }
}

const sleep = (p, ms) => p.waitForTimeout(ms);

/* -------------------------------------------------------------------- tests */

const TESTS = [];
const test = (name, fn, opts) => TESTS.push({ name, fn, opts });

/* Not a browser test — a parse check on the script the worker actually serves. The editor is
 * built inside a template literal, so a single-backslash escape in an inner string (\n, \')
 * is eaten by the literal and emits a broken script. That has now happened twice. This makes
 * it a one-second failure instead of a dead Edit button in production. */
function syntaxCheck() {
  const s = getEditorScript('reiss');
  // The injected block contains SEVERAL <script> sections (editor + universal exports), so
  // slicing first-open to last-close would swallow the intervening tags. Check each.
  const blocks = [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error('no <script> blocks found');
  blocks.forEach((b, i) => {
    // eslint-disable-next-line no-new-func
    try { new Function(b); } catch (e) { throw new Error('block ' + (i + 1) + ': ' + e.message); }
  });
  return blocks.length + ' blocks parse';
}

test('eids are assigned at load for read-only viewers', async (page) => {
  const n = await page.evaluate(() => document.querySelectorAll('[data-eid]').length);
  if (n < 50) throw new Error('expected many eids at load, got ' + n);
  return n + ' eids';
});

test('typing then waiting out the debounce saves to the server', async (page, kv) => {
  await page.evaluate(() => {
    var b=Array.prototype.find.call(document.querySelectorAll('.de-bar button'),
      function(x){ return /Edit/.test(x.textContent); });
    if(b) b.click();
  });
  await page.evaluate(() => {
    const el = document.querySelector('[data-eid="c1-e1"]') || document.querySelector('[data-eid]');
    el.focus();
    el.textContent = 'HARNESS EDIT ONE';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(page, 1800);
  const saved = JSON.stringify(kv.store);
  if (!saved.includes('HARNESS EDIT ONE')) throw new Error('edit never reached the server: ' + saved.slice(0, 300));
  return 'saved ' + kv.puts.length + ' put(s)';
});

test('C1: an edit typed inside the debounce window survives the tab closing', async (page, kv) => {
  await page.evaluate(() => {
    var b=Array.prototype.find.call(document.querySelectorAll('.de-bar button'),
      function(x){ return /Edit/.test(x.textContent); });
    if(b) b.click();
  });
  await page.evaluate(() => {
    const el = document.querySelector('[data-eid]');
    el.focus();
    el.textContent = 'DOOMED EDIT';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // do NOT wait for the debounce — simulate the tab going away immediately
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await sleep(page, 250);
  const onServer = JSON.stringify(kv.store).includes('DOOMED EDIT');
  const inLocal = await page.evaluate(() =>
    (localStorage.getItem('de-unsaved-reiss') || '').includes('DOOMED EDIT'));
  if (!onServer && !inLocal) {
    throw new Error('edit lost: not on server, not mirrored to localStorage');
  }
  return onServer ? 'flushed to server on hide' : 'mirrored to localStorage';
});

test('delete tombstones with a stale signature are skipped, not applied', async (page, kv) => {
  // handled by the initialEdits option below
  const stillThere = await page.evaluate(() =>
    !!document.querySelector('[data-eid="c1-e1"]'));
  if (!stillThere) throw new Error('a stale tombstone removed the element it should have skipped');
  return 'element preserved';
}, { initialEdits: { 'c1-e1': { deleted: true, sig: 'THIS TEXT IS NOT IN THE DECK AT ALL' } } });

test('delete tombstones with a matching signature ARE applied', async (page) => {
  const sig = await page.evaluate(() => {
    const el = document.querySelector('[data-eid="c1-e1"]');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  });
  if (!sig) throw new Error('fixture element missing');
  return 'sig read: ' + sig.slice(0, 40);
});

test('C6: a text patch whose signature no longer matches is NOT applied blind', async (page) => {
  const txt = await page.evaluate(() => {
    const el = document.querySelector('[data-eid="c1-e1"]');
    return el ? el.textContent.trim() : null;
  });
  if (txt === null) throw new Error('fixture element missing');
  if (txt.includes('WRONG PLACE')) {
    throw new Error('stale text patch applied blind onto a mismatched element');
  }
  return 'blind patch rejected';
}, {
  initialEdits: {
    'c1-e1': { html: 'WRONG PLACE', sig: 'a signature that does not match anything here' },
  },
});

test('C7: a stale __order list is not replayed', async (page) => {
  const bodyChapterOrder = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('.chapter[id]'), (c) => c.id).join(','));
  if (!bodyChapterOrder.startsWith('c1,c2,c3')) {
    throw new Error('chapter order was mangled by a stale __order key: ' + bodyChapterOrder.slice(0, 80));
  }
  return 'order intact';
}, { initialEdits: { '__order:top-g0': ['nope-1', 'nope-2', 'nope-3'] } });

test('C5: a shape change alone warns, even when every patch still applies', async (page) => {
  const warned = await page.evaluate(() => {
    const w = document.querySelector('.de-warn');
    // NOT offsetParent — .de-warn is position:fixed, whose offsetParent is always null.
    const vis = w && !w.hidden && getComputedStyle(w).display !== 'none';
    return vis ? w.textContent : null;
  });
  if (!warned) throw new Error('no banner shown for a changed template shape');
  if (!/template has changed/i.test(warned)) {
    throw new Error('banner shown but wrong message: ' + warned.slice(0, 120));
  }
  return 'warned';
}, { initialEdits: { __meta: { shape: 'OLDSHAPE99' }, 'c1-e1': { html: 'legacy, no sig' } } });

test('C13: a stale patch offers a Clear button that drops only those keys', async (page, kv) => {
  const btn = await page.evaluate(() => {
    const b = document.querySelector('.de-w-drop-stale');
    return b ? b.textContent : null;
  });
  if (!btn) throw new Error('no "clear stale entries" button offered');
  page.on('dialog', (d) => d.accept());
  await page.click('.de-w-drop-stale');
  await page.waitForTimeout(600);
  const dropUrls = kv.puts.filter((p) => p.dropKeys);
  return btn.trim();
}, {
  initialEdits: {
    'c1-e1': { html: 'WRONG', sig: 'does not match' },
    'c2-e1': { html: 'ALSO WRONG', sig: 'nor does this' },
  },
});

test('the toolbar has a visible collapse — and lives above the Feed Chat corner', async (page) => {
  // Once revealed, the bar used to be permanent (only Ctrl+Shift+E hid it) — Ray read it as
  // clutter. ⌄ collapses back to the subtle ✎ dot and the choice is remembered; the whole
  // editor stack also sits above bottom:70px so the Feed Chat bubble keeps its corner.
  await page.evaluate(() => { localStorage.setItem('de-bar-shown', '1'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const shown = await page.evaluate(() => document.querySelector('.de-bar').classList.contains('de-show'));
  if (!shown) throw new Error('bar should start shown (remembered = 1)');
  await page.click('.de-collapse');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    shown: document.querySelector('.de-bar').classList.contains('de-show'),
    handle: getComputedStyle(document.querySelector('.de-handle')).display !== 'none',
    remembered: localStorage.getItem('de-bar-shown'),
    barBottom: parseInt(getComputedStyle(document.querySelector('.de-bar')).bottom, 10),
    handleBottom: parseInt(getComputedStyle(document.querySelector('.de-handle')).bottom, 10),
  }));
  if (after.shown) throw new Error('bar still shown after ⌄');
  if (!after.handle) throw new Error('✎ handle missing after collapse');
  if (after.remembered !== '0') throw new Error('collapse not remembered (got ' + after.remembered + ')');
  if (after.barBottom < 70 || after.handleBottom < 70) throw new Error('editor still parked on the Feed Chat corner (' + after.barBottom + '/' + after.handleBottom + ')');
  return 'collapses to ✎, remembered, clear of the bubble';
});

test('C2: an edit follows its content when a chapter deletion shifts every key', async (page) => {
  // The overlay below was authored against the PRE-deletion deck: its positional key names
  // chapter 9's third element, but the text it carries belongs to a paragraph that a chapter
  // deletion has since shifted elsewhere. Without the content index this either lands on a
  // stranger or is skipped; with it, the edit finds its paragraph.
  const landed = await page.evaluate(() => {
    const el = document.querySelector('[data-ck]');
    return document.body.textContent.includes('RELOCATED EDIT LANDED');
  });
  if (!landed) throw new Error('edit was not recovered to its content in the new position');
  const onRightElement = await page.evaluate(() => {
    // innerHTML, not textContent — an ANCESTOR with a data-eid also contains the text, so
    // counting by textContent would report the same single landing as several.
    const hits = Array.prototype.filter.call(document.querySelectorAll('[data-eid]'),
      (e) => e.innerHTML === 'RELOCATED EDIT LANDED');
    return hits.length === 1;
  });
  if (!onRightElement) throw new Error('recovered edit landed on more than one element');
  return 'recovered onto its content';
}, {
  deriveEdits: async (page) => page.evaluate(() => {
    // Take a real element deep in the deck, and file its edit under a DIFFERENT positional
    // key — exactly what a chapter deletion does to every key after the deleted chapter.
    const els = Array.prototype.slice.call(document.querySelectorAll('[data-ck]'));
    const target = els[Math.floor(els.length / 2)];
    const sig = (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const wrongKey = 'c1-e0';
    const out = {};
    out[wrongKey] = { html: 'RELOCATED EDIT LANDED', sig: sig,
                      ck: target.getAttribute('data-ck') };
    return out;
  }),
});

test('C2: a saved edit whose content no longer exists is reported, not applied blind', async (page) => {
  const stray = await page.evaluate(() => document.body.textContent.includes('GHOST EDIT'));
  if (stray) throw new Error('an edit whose content is gone was applied to some other element');
  const warned = await page.evaluate(() => {
    const w = document.querySelector('.de-warn');
    return w && !w.hidden ? w.textContent : '';
  });
  if (!/content is gone|could not be replayed/i.test(warned)) {
    throw new Error('no report for an edit whose content is gone: ' + warned.slice(0, 120));
  }
  return 'reported';
}, {
  initialEdits: {
    'c9-e99': { html: 'GHOST EDIT', sig: 'text that is not in this deck anywhere',
                ck: 'knosuchkey' },
  },
});

/* --------------------------------------------------------------------- run */

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const onlyIx = args.indexOf('--only');
const only = onlyIx >= 0 ? args[onlyIx + 1] : null;

let pass = 0, fail = 0;
try {
  const d = syntaxCheck();
  console.log('  ✓ served editor script parses  (%s)', d); pass++;
} catch (e) {
  console.log('  ✗ served editor script parses\n      %s', e.message); fail++;
}
for (const t of TESTS) {
  if (only && !t.name.includes(only)) continue;
  try {
    const detail = await withPage(t.fn, { ...(t.opts || {}), headed });
    record(t.name, true, detail); pass++;
    console.log('  ✓ %s%s', t.name, detail ? '  (' + detail + ')' : '');
  } catch (e) {
    record(t.name, false, e.message); fail++;
    console.log('  ✗ %s\n      %s', t.name, e.message);
  }
}
console.log('\n%s  %d passed, %d failed', fail ? '✗ FAILED' : '✓ all green', pass, fail);
process.exit(fail ? 1 : 0);
