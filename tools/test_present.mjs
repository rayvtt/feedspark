#!/usr/bin/env node
/*
 * 🎬 PRESENT — THE ONE-PAGER, PLAYED (Ray, 16 Sep 2026).
 *
 *   "instead of the video intro, you can make the one pager have the same animation at the video
 *    intro with as much granular data that you see in the one pager. It could be on HTML, I
 *    don't mind."
 *
 * The old intro carried its OWN five-scene story over five headline numbers. Two things were
 * wrong with that and this harness pins both:
 *
 *   1. ONE RENDERER. The presentation is built from opHtml — the same function the sheet and the
 *      printed PDF are built from. A second story would drift, and a presentation that shows a
 *      client a different figure to the PDF beside it is worse than no presentation.
 *   2. THE ANIMATION MAY NOT COMPUTE. It counts UP TO the string the one-pager already rendered
 *      and hands that exact string back on the final frame. "96/100", "42.5%" and "1,204" keep
 *      their own formatting, and a rounding artefact can never be what is left on screen.
 *
 * The DOM surgery (splitting the document into scenes, the pinned headers, the pan) is pinned in
 * a real browser by tools/check_present.js — this file is the parts that run without one, plus
 * the wiring that must not silently come apart.
 *
 * Run: node tools/test_present.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CC = fs.readFileSync(path.join(ROOT, 'docs', 'FeedSpark_Command_Center.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, got) => {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + name);
}

/* ===================================================== ONE RENDERER ======================= */
console.log('\n-- the presentation has no story of its own --');
const showBlock = CC.slice(CC.indexOf('function showOpen('), CC.indexOf('var PCAT={technical:'));
ok('it loads the one-pager’s own data', /opLoad\(name,function\(b,p,mkts,got\)/.test(showBlock));
ok('…and builds the one-pager’s own document', /doc\.innerHTML=opHtml\(name,b,p,mkts,got\)/.test(showBlock));
ok('the loader is shared, not copied — the sheet uses it too',
   /function openOnePager\(name\)\s*\{\s*opShell\(name\);\s*opLoad\(name,/.test(CC));
ok('opHtml RETURNS the document rather than writing it, so two surfaces can use it',
   /function opHtml\(name, b, p, mkts, got\)/.test(CC) && /\n    return h;\n  \}/.test(CC));
ok('the sheet still renders through it', /sheet\.innerHTML = opHtml\(name, b, p, mkts, got\)/.test(CC));
// the five hand-written scenes are the thing that could drift; they must be gone, not dormant
['data-sc="1"', 'data-sc="5"', 'The work, to date', 'dzs-stats', 'dzs-stamp', 'dzs-moves', 'dzs-rows']
  .forEach((dead) => ok('the old hand-written scene "' + dead + '" is gone', !CC.includes(dead)));
ok('…and so is the second copy of the health verdict it drew', !/dzs-health/.test(CC));

console.log('\n-- what belongs to the sheet stays on the sheet --');
ok('Print / ✕ are stripped out of the presentation',
   /var acts=doc\.querySelector\('\.op-acts'\); if\(acts\)acts\.remove\(\)/.test(showBlock));

/* ================================================= THE NUMBER RULE ======================== */
const N = new Function('fmtN', `
  ${lift(CC, 'showNum')} ${lift(CC, 'showCount')}
  return { showNum:showNum, showCount:showCount };
`)((n) => { n = +n; return isFinite(n) ? n.toLocaleString('en-GB') : '0'; });

const el = (t) => ({ textContent: t });
console.log('\n-- a number is read OUT of what the one-pager wrote --');
{
  const a = N.showNum(el('1,204'));
  ok('a thousands-separated figure is read', a && a.target === 1204, a && a.target);
  const b = N.showNum(el('96/100'));
  ok('a score keeps everything around the number', b && b.target === 96 && b.post === '/100',
     b && [b.pre, b.target, b.post]);
  const c = N.showNum(el('42.5%'));
  ok('a decimal percentage keeps its places and its sign', c && c.target === 42.5 && c.dec === 1 && c.post === '%',
     c && [c.target, c.dec, c.post]);
  ok('a dash is not a number', N.showNum(el('—')) === null);
  ok('"not scanned" is not a number', N.showNum(el('not scanned')) === null);
  ok('0 has nowhere to count from, so it is left alone', N.showNum(el('0')) === null);
  ok('…and so does 1', N.showNum(el('1')) === null);
  ok('2 does count', N.showNum(el('2')) !== null);
}

console.log('\n-- THE LAST FRAME IS THE ONE-PAGER’S OWN STRING --');
{
  // drive the rAF loop by hand so the final frame is observable rather than raced
  const frames = [];
  global.requestAnimationFrame = (fn) => frames.push(fn);
  const run = (text, ms) => {
    frames.length = 0;
    const e = el(text), n = N.showNum(e);
    N.showCount(n, ms);
    const seen = [];
    let t = 0;
    while (frames.length && seen.length < 200) {
      const fn = frames.shift(); fn(t); seen.push(e.textContent); t += ms / 4;
    }
    return { end: e.textContent, seen };
  };
  const a = run('1,204', 1000);
  ok('a counted figure ends on its exact original string', a.end === '1,204', a.end);
  ok('…and its separators are kept while counting', a.seen.some((s) => /,/.test(s)), a.seen.slice(0, 3));
  const b = run('96/100', 1000);
  ok('a score ends exactly as written', b.end === '96/100', b.end);
  ok('…and carries its suffix the whole way', b.seen.every((s) => /\/100$/.test(s)), b.seen.slice(0, 3));
  const c = run('42.5%', 1000);
  ok('a decimal ends exactly as written', c.end === '42.5%', c.end);
  ok('…and keeps its decimal place rather than jumping between 1 and 2 digits',
     c.seen.every((s) => /^\d+\.\d%$/.test(s)), c.seen.slice(0, 3));
  ok('the count rises rather than starting at the answer',
     a.seen.length > 1 && a.seen[0] !== '1,204', a.seen[0]);
  delete global.requestAnimationFrame;
}

/* ============================================ NOTHING IS CUT OFF ========================== */
console.log('\n-- a long section pans; it is never clipped or shrunk --');
ok('overflow is measured, not assumed', /body\.scrollHeight-body\.clientHeight/.test(showBlock));
ok('the dwell time grows with what there is to read',
   /return 3600\+Math\.min\(9000,Math\.round\(over\/90\*1000\)\)/.test(showBlock));
ok('the pan is driven frame by frame, since scrollTop is not a CSS-animatable property',
   /requestAnimationFrame\(step\)/.test(showBlock) && !/transitionDuration/.test(showBlock));
ok('a pan stops when its scene stops being the one on screen',
   /if\(!sc\.classList\.contains\('on'\)\)return;/.test(showBlock));
ok('a section only splits on the one-pager’s OWN sub-headings, never on a height guess',
   /subs=sec\.querySelectorAll\('\.op-h4'\)/.test(showBlock) && /if\(subs\.length<2\)/.test(showBlock));
ok('every split part repeats the section header, so the section is never lost',
   /\+\(sech\?sech\.outerHTML:''\)\+x\.h\+/.test(showBlock));

console.log('\n-- what must stay put while a scene pans --');
ok('the pinned offsets are MEASURED, not hard-coded',
   /head\.getBoundingClientRect\(\)\.height/.test(showBlock) && /h4\.getBoundingClientRect\(\)\.height/.test(showBlock));
ok('the section name pins', /#dz-show \.op-sech\{[^}]*position:sticky/.test(CC));
ok('the sub-heading pins under it', /#dz-show \.op-h4\.dzsx-stick\{[^}]*position:sticky/.test(CC));
ok('the column names pin under that', /#dz-show \.op-tbl th\{position:sticky/.test(CC));
// a translucent pinned bar shows the row sliding under it — two sets of numbers on one line
ok('the pinned bars are SOLID', /#dz-show \.op-sech\{[^}]*background:#0d1320/.test(CC)
   && /#dz-show \.op-tbl th\{[^}]*background:#0d1320/.test(CC));
ok('…and none of them relies on backdrop-filter in a border-collapse table',
   !/#dz-show \.op-tbl th\{[^}]*backdrop-filter/.test(CC));
// the reveal leaves a transform on thead AND on every row, so each is its own stacking context
ok('the header’s stacking context outranks the body rows it is pinned over',
   /#dz-show \.op-tbl thead\{position:relative;z-index:5\}/.test(CC));

console.log('\n-- presenting it live --');
ok('→ advances', /ArrowRight/.test(CC));
ok('← goes back', /ArrowLeft/.test(CC));
ok('space pauses', /ev\.key===' '\|\|ev\.key==='Spacebar'/.test(CC));
ok('Esc still exits', /if\(ev\.key==='Escape'\)\{ showClose\(\); return; \}/.test(CC));
ok('a click still moves on', /go\(state\.i\+1\);/.test(showBlock));
ok('the rail jumps to a scene', /closest\('\.dzsx-dot'\)/.test(showBlock));
ok('…and jumping pauses, so it does not run off while being discussed',
   /if\(dot\)\{ state\.paused=true; go\(\+dot\.getAttribute\('data-go'\)\); return; \}/.test(showBlock));
ok('the position is stated', /pos\.textContent=\(i\+1\)\+' \/ '\+els\.length/.test(showBlock));
ok('closing tears down every pending timer', /SHOWT\.forEach\(clearTimeout\); SHOWT=\[\]; SHOWST=null;/.test(CC));
ok('…and the key handler with it', /document\.removeEventListener\('keydown',showKey\)/.test(CC));
ok('a deck closed while still loading is never built over',
   /if\(document\.getElementById\('dz-show'\)!==d\)return;/.test(showBlock));
ok('the stagger restarts per scene, so a late scene does not wait for the whole deck',
   /Array\.prototype\.forEach\.call\(els,function\(sc\)\{[\s\S]{0,200}setProperty\('--i'/.test(showBlock));

console.log('\n-- reduced motion gets the whole document, not a frozen first slide --');
ok('it is detected', /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/.test(showBlock));
ok('every scene is shown at once', /Array\.prototype\.forEach\.call\(els,function\(sc\)\{ sc\.classList\.add\('on'\); showFill\(sc\); \}\)/.test(showBlock));
ok('…and the stage becomes an ordinary scrollable page',
   /#dz-show\.dzsx-static\{overflow:auto\}/.test(CC) && /#dz-show\.dzsx-static \.dzsx-scene\{position:static/.test(CC));
ok('every bar still ends at its real width', /a\.raw|getAttribute\('data-w'\)/.test(showBlock));
ok('the auto-play chrome is hidden rather than left dead', /#dz-show\.dzsx-static \.dzsx-rail\{display:none\}/.test(CC));

console.log('\n-- a bar is handed back its OWN width, never a recomputed one --');
ok('the width is captured off the element', /i\.setAttribute\('data-w',i\.style\.width\|\|''\)/.test(showBlock));
ok('…set to nothing to start', /i\.style\.width='0%'/.test(showBlock));
ok('…and restored verbatim', /var w=i\.getAttribute\('data-w'\); if\(w!==null\)setTimeout\(function\(\)\{ i\.style\.width=w; \}/.test(showBlock));

console.log('\n-- the way in --');
ok('the dossier button opens it', /class="lnk dz-showb"/.test(CC));
ok('…and says what it now does', /Play the one-pager as a presentation/.test(CC));
ok('the one-pager button is untouched beside it', /class="lnk dz-opb"/.test(CC));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
