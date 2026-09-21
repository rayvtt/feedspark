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

function composePage(slug, mutateDeck = null) {
  let deck = readFileSync(DECK, 'utf8');
  if (mutateDeck) deck = mutateDeck(deck);
  return deck.replace('</body>', getEditorScript(slug) + '\n</body>');
}

/** The signature formula as the served script now computes it, and as it computed it before
 *  the /\s+/ fix (a single-escaped \s cooked to /s+/ inside the template literal, collapsing
 *  runs of the LETTER s). Every sig/ck saved to KV before the fix carries the legacy form. */
const sigNew = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const sigLegacy = (t) => (t || '').replace(/s+/g, ' ').trim().slice(0, 120);
// Same in-page helpers as a string, for page.evaluate() — the editor's are closed over.
const SIG_HELPERS = `
  var sigNew=function(t){ return (t||'').replace(/\\s+/g,' ').trim().slice(0,120); };
  var sigLegacy=function(t){ return (t||'').replace(/s+/g,' ').trim().slice(0,120); };
  var hashStr=function(s){ var h=5381; for(var i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); };
  // The legacy content-key index exactly as captureBaseSigs built it before the fix: hash of
  // tag + legacy sig, plus an occurrence index among elements identical under THAT form.
  var legacyCkOf=(function(){ var seen={}, map=new Map();
    Array.prototype.forEach.call(document.querySelectorAll('[data-ck]'), function(el){
      var base='k'+hashStr(el.tagName+'|'+sigLegacy(el.textContent));
      seen[base]=(seen[base]||0); var ck=base+(seen[base]?'.'+seen[base]:''); seen[base]++;
      map.set(el, ck); });
    return function(el){ return map.get(el); }; })();
`;
// page.evaluate(string) evaluates an EXPRESSION, so a body with `return` needs a wrapper.
const inPage = (body) => '(function(){' + SIG_HELPERS + body + '})()';

/* ------------------------------------------------------------------ harness */

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); }

async function withPage(fn, { initialEdits = {}, deriveEdits = null, deckOnReload = null, version = null, headed = false } = {}) {
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
  // deckOnReload: a transform applied to the deck on every load AFTER the first — how a
  // template push is simulated between "the edit was saved" and "the edit is replayed".
  let loads = 0;
  await page.route('https://deck.test/deck/reiss', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: composePage('reiss', (++loads > 1 && deckOnReload) ? deckOnReload : null) }));

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

/* Also static: the SERVED signature function must normalise whitespace. Written with a single
 * backslash inside getEditorScript's template literal, \s cooks to a bare s and the served
 * script collapses runs of the letter s instead — every stored sig and ck was computed that
 * way until the fix, which is why the served script must ALSO keep the legacy twin around
 * for replay. Both are asserted on the cooked output, not on worker.js source. */
function sigFormCheck() {
  const s = getEditorScript('reiss');
  const fixed = "function sigOf(el){ return (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120); }";
  const legacy = "function sigLegacy(el){ return (el.textContent||'').replace(/s+/g,' ').trim().slice(0,120); }";
  if (!s.includes(fixed)) throw new Error('served sigOf does not normalise whitespace (\\s cooked away in the template literal?)');
  if (!s.includes(legacy)) throw new Error('served script lost sigLegacy — pre-fix saved edits would stop replaying');
  if (!/sig===baseSig\[id\] \|\| sig===baseSigL\[id\]/.test(s)) throw new Error('replay no longer accepts the legacy signature form');
  if (!/byCkey\[ck\] \|\| byCkeyL\[ck\]/.test(s)) throw new Error('content keys no longer resolve against the legacy hash');
  return 'served sigOf uses /\\s+/, legacy twin kept for replay';
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

/* ---- sigOf migration: the served signature collapsed runs of the letter s instead of
 * whitespace until PR (this one). Every sig and ck in KV was computed with that form. The
 * three cases below store LEGACY-form overlays against the real deck and assert they still
 * replay through every path — positional key, content-key relocation, and a tombstone. */
test('S1: overlays saved with legacy-form signatures and content keys still replay', async (page) => {
  const r = await page.evaluate(() => {
    var ids = JSON.parse(localStorage.getItem('__S1') || '{}');
    var a = document.querySelector('[data-eid="' + ids.a + '"]');
    return {
      text: a ? a.innerHTML : null,
      relocated: Array.prototype.filter.call(document.querySelectorAll('[data-eid]'),
        function(e){ return e.innerHTML === 'LEGACY CK RELOCATED'; }).length,
      tombstoned: !document.querySelector('[data-eid="' + ids.c + '"]'),
      warn: (function(){ var w=document.querySelector('.de-warn'); return (w && !w.hidden && getComputedStyle(w).display!=='none') ? w.textContent : ''; })(),
    };
  });
  if (r.text !== 'LEGACY SIG APPLIED') throw new Error('positional patch with a legacy sig was not applied (got ' + JSON.stringify(r.text) + ')');
  if (r.relocated !== 1) throw new Error('legacy content key did not relocate the edit (landed ' + r.relocated + ' times)');
  if (!r.tombstoned) throw new Error('legacy tombstone was not replayed');
  if (/could not be replayed|content is gone/i.test(r.warn)) throw new Error('legacy overlays reported stale: ' + r.warn.slice(0, 160));
  return 'positional + relocated + tombstone, all legacy-form';
}, {
  deriveEdits: async (page) => page.evaluate(inPage(`
    // Leaf editable elements whose text contains an s — where the legacy and corrected forms
    // DIFFER, so accepting the legacy form is actually exercised, not trivially equal.
    var cands = Array.prototype.filter.call(document.querySelectorAll('[data-ck]'), function(el){
      var id=el.getAttribute('data-eid');
      return id && id!=='c1-e0' && !el.querySelector('[data-eid]')
        && sigNew(el.textContent)!==sigLegacy(el.textContent); });
    if (cands.length < 6) throw new Error('fixture: too few candidate elements (' + cands.length + ')');
    var a=cands[Math.floor(cands.length/4)], b=cands[Math.floor(cands.length/2)], c=cands[Math.floor(cands.length*3/4)];
    var out={};
    // (a) positional key intact, legacy sig, no ck — the plain "still matches" path.
    out[a.getAttribute('data-eid')] = { html:'LEGACY SIG APPLIED', sig:sigLegacy(a.textContent) };
    // (b) wrong positional key + legacy sig + LEGACY content key — relocation via byCkeyL.
    out['c1-e0'] = { html:'LEGACY CK RELOCATED', sig:sigLegacy(b.textContent), ck:legacyCkOf(b) };
    // (c) a tombstone carrying the legacy sig of what it removed.
    out[c.getAttribute('data-eid')] = { deleted:true, sig:sigLegacy(c.textContent) };
    // Remember which elements so the assertion can find them after the reload (ids are
    // positional and the deck is unchanged, so they resolve to the same elements).
    localStorage.setItem('__S1', JSON.stringify({ a:a.getAttribute('data-eid'), c:c.getAttribute('data-eid') }));
    return out;
  `)),
});

// The whitespace case needs the SAME element's markup on both sides of the reload.
let S2_HTML = null, S2_MUTATED = 0;
test('S2: a whitespace-only template change no longer marks an edit stale', async (page) => {
  if (S2_MUTATED !== 1) throw new Error('fixture: the reload did not serve a whitespace-altered template (' + S2_MUTATED + ')');
  const r = await page.evaluate(() => ({
    text: (function(){ var el=document.querySelector('[data-eid="c1-e1"]'); return el ? el.innerHTML : null; })(),
    warn: (function(){ var w=document.querySelector('.de-warn'); return (w && !w.hidden && getComputedStyle(w).display!=='none') ? w.textContent : ''; })(),
  }));
  if (r.text !== 'WHITESPACE SURVIVOR') throw new Error('edit was not replayed after a whitespace-only template change (got ' + JSON.stringify(r.text) + ')');
  if (/could not be replayed|text\/style edit/i.test(r.warn)) throw new Error('edit reported stale: ' + r.warn.slice(0, 160));
  return 'replayed, no stale report';
}, {
  deriveEdits: async (page) => {
    const d = await page.evaluate(inPage(`
      var el=document.querySelector('[data-eid="c1-e1"]');
      return { html: el.innerHTML, sig: sigNew(el.textContent), legacy: sigLegacy(el.textContent) };`));
    if (!d.html.includes(' ')) throw new Error('fixture: c1-e1 has no space to break');
    S2_HTML = d.html;
    // Saved with the CORRECTED form, as every save now writes it.
    return { 'c1-e1': { html: 'WHITESPACE SURVIVOR', sig: d.sig } };
  },
  deckOnReload: (deck) => {
    // Move a line break into the paragraph — a reformat, not a content change. Under the
    // legacy form this changed the signature (no whitespace normalisation) and the edit
    // read as stale; under the corrected form it is the same text.
    if (!S2_HTML || !deck.includes(S2_HTML)) { S2_MUTATED = -1; return deck; }
    const broken = S2_HTML.replace(' ', '\n            ');
    if (sigNew(broken) !== sigNew(S2_HTML) || sigLegacy(broken) === sigLegacy(S2_HTML)) { S2_MUTATED = -2; return deck; }
    S2_MUTATED++;
    return deck.replace(S2_HTML, broken);
  },
});

test('S3: a new save writes the corrected signature and content key, never the legacy form', async (page, kv) => {
  const before = await page.evaluate(inPage(`
    var el=document.querySelector('[data-eid="c1-e1"]');
    return { sig:sigNew(el.textContent), legacy:sigLegacy(el.textContent), ck:el.getAttribute('data-ck'),
             ckNew:'k'+hashStr(el.tagName+'|'+sigNew(el.textContent)), ckLegacy:legacyCkOf(el) };`));
  if (before.sig === before.legacy) throw new Error('fixture: c1-e1 text has no run of s — forms would not differ');
  if (before.ck !== before.ckNew) throw new Error('data-ck is not the corrected-form hash: ' + before.ck + ' vs ' + before.ckNew);
  if (before.ck === before.ckLegacy) throw new Error('data-ck still carries the legacy hash');
  await page.evaluate(() => {
    var b=Array.prototype.find.call(document.querySelectorAll('.de-bar button'),
      function(x){ return /Edit/.test(x.textContent); });
    if(b) b.click();
    const el = document.querySelector('[data-eid="c1-e1"]');
    el.focus(); el.textContent = 'S3 EDIT'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(page, 1800);
  const saved = kv.store['c1-e1'];
  if (!saved || saved.html !== 'S3 EDIT') throw new Error('edit never reached the server: ' + JSON.stringify(kv.store).slice(0, 200));
  if (saved.sig !== before.sig) throw new Error('saved sig is not the corrected form: ' + JSON.stringify(saved.sig));
  if (saved.sig === before.legacy) throw new Error('saved sig is the legacy form');
  if (saved.ck !== before.ckNew) throw new Error('saved ck is not the corrected form: ' + saved.ck);
  return 'sig + ck corrected-form';
});

/* --------------------------------------------------------------------- run */

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const onlyIx = args.indexOf('--only');
const only = onlyIx >= 0 ? args[onlyIx + 1] : null;

let pass = 0, fail = 0;
for (const [label, check] of [['served editor script parses', syntaxCheck], ['served sigOf normalises whitespace', sigFormCheck]]) {
  try {
    const d = check();
    console.log('  ✓ %s  (%s)', label, d); pass++;
  } catch (e) {
    console.log('  ✗ %s\n      %s', label, e.message); fail++;
  }
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
