/**
 * tools/test_keep.mjs — the pick you made is the pick you come back to.
 *
 * Ray, 14 Oct 2026: "after refreshing the page or tab, the pre-filter pre-selected option is not
 * saved and continues to be persisted. For example, on workflow, if I selected Monsoon on the
 * playbook, after refreshing the page it returned to where it was before. I want it to stay on
 * Monsoon even after refresh. Apply this methodology across everything else."
 *
 * The RULES of the shared layer (docs/keep_widget.html) are lifted between its ENGINE markers and
 * run against a tiny DOM shim — which control is a page-level picker and which is an input to an
 * action, when a link wins, how a chip is tied to its brand — and the WIRING is read off the
 * sources: the worker injects the layer on app pages, the Workflow page keeps its own two states
 * (the board filter and the Playbook account) and opts their controls out of the layer so there is
 * one writer per control, and every browser tripwire builds its served page with the widget in.
 * The reload itself is tools/check_keep.js (Playwright).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const W = rd('docs/keep_widget.html');
const WF = rd('docs/FeedSpark_Workflow.html');
const WORKER = rd('cloudflare/feedspark-deck/src/worker.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  x ' + m); } };

/* ---- the engine, lifted by its markers ----------------------------------------------------- */
const m = /\/\* FCC-KEEP:ENGINE-START[^\n]*\n([\s\S]*?)\/\* FCC-KEEP:ENGINE-END \*\//.exec(W);
ok(!!m, 'the engine block sits between FCC-KEEP:ENGINE-START / END markers');
const ctx = { performance: undefined, location: { href: 'https://fcc/roas' } };
vm.createContext(ctx);
vm.runInContext(m[1] + '\nthis.KEEP=KEEP;', ctx);
const KEEP = ctx.KEEP;

/* a DOM shim: an element with a tag, attributes, a class list and ancestors */
function el(tag, attrs, parent) {
  const a = Object.assign({}, attrs || {});
  const e = {
    tagName: tag.toUpperCase(), id: a.id || '', multiple: !!a.multiple, value: a.value || '', options: a.options || [],
    classList: { contains: (c) => (a['class'] || '').split(/\s+/).indexOf(c) >= 0 },
    getAttribute: (k) => (k in a ? String(a[k]) : null), hasAttribute: (k) => k in a,
    parent,
    closest(sel) {
      const parts = sel.split(',').map((s) => s.trim());
      for (let n = e; n; n = n.parent) {
        for (const p of parts) {
          if (p[0] === '.' && n.classList.contains(p.slice(1))) return n;
          if (p[0] === '#' && n.id === p.slice(1)) return n;
          if (p[0] === '[') { const k = p.slice(1, -1).split('=')[0]; const v = p.indexOf('=') > 0 ? p.slice(1, -1).split('=')[1] : null;
            if (n.hasAttribute(k) && (v === null || n.getAttribute(k) === v)) return n; }
          if (/^[a-z]+$/.test(p) && n.tagName === p.toUpperCase()) return n;
        }
      }
      return null;
    },
  };
  return e;
}

console.log('-- what is a page-level picker, and what is an input to an action');
const page = el('body');
const hero = el('div', { class: 'hero' }, page);
ok(KEEP.keepsSelect(el('select', { id: 'brand' }, hero)), 'a select with an id at page level is kept');
ok(!KEEP.keepsSelect(el('select', {}, hero)), 'a select with no id is not (nothing stable to key it on)');
ok(!KEEP.keepsSelect(el('select', { id: 'x', multiple: true }, hero)), 'a multi-select is not');
for (const [tag, attrs] of [['form', {}], ['table', {}], ['div', { role: 'dialog' }], ['div', { class: 'modal' }], ['div', { class: 'scrim' }], ['div', { class: 'm-sec' }], ['div', { class: 'chat-log' }]]) {
  const host = el(tag, attrs, hero);
  ok(!KEEP.keepsSelect(el('select', { id: 'bg-client' }, host)), 'a select inside ' + tag + ' ' + JSON.stringify(attrs) + ' is an input, never kept');
}
ok(!KEEP.keepsSelect(el('select', { id: 'it-window', 'data-no-keep': '' }, hero)), 'data-no-keep on the control opts it out');
ok(!KEEP.keepsSelect(el('select', { id: 'w' }, el('div', { 'data-no-keep': '' }, hero))), 'data-no-keep on an ancestor opts it out');
const chips = el('div', { id: 'mkts', class: 'chips' }, hero);
ok(KEEP.keepsChip(el('button', { 'data-mkt': 'de' }, chips)), 'a market chip is kept');
ok(KEEP.keepsChip(el('button', { 'data-win': '90' }, chips)), 'a period chip is kept');
ok(!KEEP.keepsChip(el('button', { 'data-m': 'table' }, chips)), 'any other chip is not — the layer names what it keeps');
ok(!KEEP.keepsChip(el('button', { 'data-mkt': 'de' }, el('div', { class: 'modal' }, hero))), 'a market chip inside a modal is not');
ok(KEEP.chipKey(el('button', { 'data-mkt': 'de' }, chips)) === 'chip:mkt:mkts', 'a chip is keyed on its attribute and its host\'s id');
ok(KEEP.chipKey(el('button', { 'data-win': '7' }, el('span', { id: 'win' }, hero))) === 'chip:win:win', '…so two groups on one page never share a key');

console.log('-- a link wins');
ok(KEEP.linked('https://fcc/roas?brand=Reiss'), '?brand= names the state');
ok(KEEP.linked('https://fcc/golden?client=Reiss&market=gb#x'), '?client=&market= names the state');
ok(KEEP.linked('https://fcc/kwcal?b=Reiss'), '?b= (the short form) names the state');
ok(!KEEP.linked('https://fcc/workflow?pb=1'), '?pb=1 opens a rail, it names nothing');
ok(!KEEP.linked('https://fcc/catalog?view=procurement'), '?view= is a preset, not a brand');
ok(!KEEP.linked('https://fcc/catalog?embed=mods'), '?embed= names nothing');
ok(!KEEP.linked('https://fcc/roas?brand='), 'an EMPTY brand= names nothing');
ok(!KEEP.linked('https://fcc/roas'), 'no query, no link');
ok(KEEP.landing() === 'https://fcc/roas', 'without a navigation entry the landing URL falls back to location.href');
ok(KEEP.key('/roas') === 'fcc-keep:/roas' && KEEP.key('/roas/') === 'fcc-keep:/roas' && KEEP.key('/') === 'fcc-keep:/', 'the key is per page, trailing slash folded');

console.log('-- what is due: only a value the page offers, a market only under its brand');
const doc = {
  byId: {}, getElementById(id) { return this.byId[id] || null; },
  querySelector(sel) { return sel.indexOf('select#brand') === 0 ? this.byId.brand || null : null; },
  querySelectorAll() { return []; },
};
const brand = el('select', { id: 'brand', value: 'Reiss', options: [{ value: 'Reiss' }, { value: 'Monsoon' }] }, hero);
doc.byId.brand = brand;
const mkts = el('div', { id: 'mkts' }, hero);
const de = el('button', { 'data-mkt': 'de', class: 'chip' }, mkts), gb = el('button', { 'data-mkt': 'gb', class: 'chip on' }, mkts);
mkts.querySelectorAll = () => [gb, de];
doc.byId.mkts = mkts;
let due = KEEP.due(doc, { 'sel:brand': { v: 'Monsoon' } }, {});
ok(due.length === 1 && due[0].el === brand && due[0].v === 'Monsoon' && !due[0].same, 'a remembered brand the select offers is due');
ok(KEEP.due(doc, { 'sel:brand': { v: 'Schuh' } }, {}).length === 0, 'a brand the select no longer offers is NOT due (never forced)');
ok(KEEP.due(doc, { 'sel:brand': { v: 'Reiss' } }, {})[0].same === true, 'the value already in force is due as "same" — nothing is dispatched');
ok(KEEP.due(doc, { 'sel:brand': { v: 'Monsoon' } }, { 'sel:brand': 1 }).length === 0, 'an entry already applied this load is not due again');
due = KEEP.due(doc, { 'chip:mkt:mkts': { v: 'de', b: 'Reiss' } }, {});
ok(due.length === 1 && due[0].el === de && !due[0].same, 'a market remembered under the brand on screen is due');
ok(KEEP.due(doc, { 'chip:mkt:mkts': { v: 'de', b: 'Monsoon' } }, {}).length === 0, 'a market remembered under ANOTHER brand is not — Reiss DE is not a market of Monsoon');
ok(KEEP.due(doc, { 'chip:mkt:mkts': { v: 'gb', b: 'Reiss' } }, {})[0].same === true, 'a chip already on is "same"');
ok(KEEP.due(doc, { 'chip:mkt:mkts': { v: 'fr', b: 'Reiss' } }, {}).length === 0, 'a market the page does not draw is not due');
ok(KEEP.due(doc, { 'chip:mkt:nowhere': { v: 'de', b: 'Reiss' } }, {}).length === 0, 'a host that is not on the page: nothing');
ok(KEEP.due(doc, { 'sel:brand': 'Monsoon', 'chip:mkt:mkts': null }, {}).length === 0, 'a malformed record is ignored, never thrown on');

console.log('-- the widget: trusted picks only, a replay never records itself');
ok(/document\.addEventListener\('change',function\(e\)\{\n  if\(!e\.isTrusted\)return;/.test(W), 'a change is recorded only when a PERSON made it (isTrusted)');
ok(/document\.addEventListener\('click',function\(e\)\{\n  if\(!e\.isTrusted\)return;/.test(W), 'a chip click likewise');
ok(/if\(LINKED\)return;\s+\/\/ the link IS the state/.test(W), 'a linked landing records but replays nothing');
ok(/d\.el\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/.test(W) && /d\.el\.click\(\)/.test(W), 'a replay sets the control and fires ITS OWN event — the page runs the code a hand pick runs');
ok(/Date\.now\(\)-T0>20000\)return/.test(W), 'the replay window closes after 20 s');
ok(/new MutationObserver\(schedule\)/.test(W), 'the pickers fill asynchronously, so the pass re-runs on DOM change');
ok(/localStorage\.setItem\(KEY/.test(W) && !/\/api\/state/.test(W) && !/fetch\(/.test(W), 'per device, never shared state — the widget makes no request');
ok(/if\(b\)\{ var bs=KEEP\.brandSel\(document\); if\(bs\)record\('sel:'\+bs\.id,b\); \}/.test(W), 'a market picked under a brand confirms that brand (a linked landing sets the brand with no change event)');
ok(!/<\/body>/.test(W.replace(/<!--[\s\S]*?-->/, '')), 'the widget carries no </body> of its own (the worker injects at the page\'s first one)');

console.log('-- the worker injects it on app pages');
ok(/import KEEPW from "\.\.\/\.\.\/\.\.\/docs\/keep_widget\.html";/.test(WORKER), 'imported as a Text module');
ok(/\+ '\\n' \+ HOURSW \+ '\\n' \+ KEEPW \+ '\\n' \+ TOUCHW/.test(WORKER), 'injected with the other app-page widgets (never on client decks)');

console.log('-- the Workflow page keeps its own two states, and opts their controls out of the layer');
ok(/<select id="it-window" data-no-keep /.test(WF), 'the board window select is the board\'s own (data-no-keep)');
ok(/<select id="ck-brand" data-no-keep /.test(WF), 'the Playbook account select is the rail\'s own (data-no-keep)');
ok(/var IT_KEEP='fcc-it-state';/.test(WF), 'the board filter is kept on the device under fcc-it-state');
ok(/function renderIntake\(\)\{\n    keepFilter\(\);/.test(WF), '…written on every render of the board');
ok(/JSON\.parse\(localStorage\.getItem\(IT_KEEP\)\|\|'null'\)/.test(WF) && WF.indexOf('IT_KEEP') < WF.indexOf("var cl=qs('client'), f=qs('f'), q=qs('q');"), '…read back before the first render, and BEFORE the ?client= deep link so the link still wins');
ok(/\['srcs','statuses','clients','ams','owners'\]\.forEach\(function\(k\)\{ if\(Array\.isArray\(f\[k\]\)\)itState\[k\]=f\[k\]\.filter\(function\(x\)\{return typeof x==='string';\}\); \}\)/.test(WF), '…every list checked on the way in');
ok(/var CK_KEEP='fcc-ck-brand';/.test(WF), 'the Playbook account is kept under fcc-ck-brand');
ok(/if\(!BRAND\)\{ var kb=keptBrand\(\); if\(kb&&v\.all\.indexOf\(kb\)>=0\)\{ BRAND=kb;/.test(WF), '…read back only while nothing has chosen an account, and only when the roster still carries it');
ok(/BRAND=sel\.value; keepBrand\(\); render\(\); syncBoard\(\);/.test(WF), '…written on a hand pick');
ok(/BRAND=cs\[0\]; NOBOARD=false; keepBrand\(\); fillBrands\(\);/.test(WF), '…and when the rail follows the board');
ok(/if\(b\)\{BRAND=b;keepBrand\(\);\}/.test(WF), '…and when a module opens the rail on an account');
ok(/if\(qbox&&itState\.q&&!qbox\.value\)qbox\.value=itState\.q;/.test(WF), 'a remembered search is shown in the box, not just applied');

console.log('-- the browser tripwires build their served page with the widget in');
for (const f of ['tools/check_mobile.js', 'tools/check_darkmode.js', 'tools/check_navrow.js']) {
  ok(/'keep_widget\.html'/.test(rd(f)), f + ' lists keep_widget.html among the injected widgets');
}
ok(/check_keep\.js/.test(rd('tools/presync.sh')), 'check_keep.js runs in presync');
for (const f of ['tools/qa_gate.sh', 'tools/presync.sh', '.github/workflows/validate.yml']) {
  ok(/test_keep\.mjs/.test(rd(f)), f + ' runs this harness');
}

console.log(`test_keep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
