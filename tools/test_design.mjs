// FeedSpark design guidelines (/design) + the shared stylesheet (/design/fcc.css).
// Ray, 28 Sep 2026: "if I start designing their own module it will automatically follow Feedspark brand
// guidelines, including font, text, the way the dashboard looks … We have to stick to this brand guideline."
// The page renders its swatches FROM the stylesheet between its FCC-DESIGN markers and the worker serves that
// same slice, so the guideline and what a module loads can never disagree. This harness pins the slice, the
// brand values (CLAUDE.md "Design system"), the dark theme, the audit legend the live pages use, the route
// and the links that make the page findable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('docs/FeedSpark_Design.html');
const WORKER = read('cloudflare/feedspark-deck/src/worker.js');
const ACCESS = read('cloudflare/feedspark-deck/src/access.js');
const GOLDEN = read('docs/FeedSpark_GoldenRecord.html');
const MIG = read('docs/FeedSpark_Transformation.html');
const LEAD = read('docs/FeedSpark_Leadership.html');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };

const A = '/* FCC-DESIGN:START */', B = '/* FCC-DESIGN:END */';
const a = PAGE.indexOf(A), b = PAGE.indexOf(B);
const CSS = a >= 0 && b > a ? PAGE.slice(a, b + B.length) : '';
const block = (sel) => { const i = CSS.indexOf(sel + '{'); if (i < 0) return {}; const j = CSS.indexOf('}', i), o = {};
  CSS.slice(i + sel.length + 1, j).replace(/(--[\w-]+)\s*:\s*([^;]+);?/g, (_, k, v) => { o[k] = v.trim(); }); return o; };
const L = block(':root'), D = block(':root[data-theme=dark]');

console.log('The stylesheet');
ok(CSS.length > 2000 && PAGE.indexOf('<style id="fcc-design">') >= 0, 'the page carries the stylesheet between its FCC-DESIGN markers, in the style block the swatches read');
ok(/^\/\* FCC-DESIGN:START \*\/\s*(\/\*[\s\S]*?\*\/\s*)*@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Lato/.test(CSS), '@import is the first rule (only comments before it), loading Lato');
ok(!/font-weight:\s*(500|600)/.test(CSS) && !/wght@[^']*\b(500|600)\b/.test(CSS), 'Lato 400 / 700 / 900 only — no 500 or 600 to be synthesised');
const brand = { '--orange': '#F5A623', '--orange-deep': '#ED6F0B', '--ink': '#333333', '--paper': '#FFFFFF', '--wash': '#F7F7F5', '--grey': '#F5F5F5', '--line': '#E6E6E6' };
ok(Object.keys(brand).every((k) => (L[k] || '').toUpperCase() === brand[k]), 'the brand tokens are the Reiss–Dentsu source values (orange, deep orange, charcoal, white, light greys, #E6E6E6 border)');
ok(['--ink', '--ink-2', '--muted', '--line', '--paper', '--wash', '--navy', '--good', '--risk', '--chart-1', '--chart-2'].every((k) => D[k] && D[k] !== L[k]), 'every surface, text and chart token has its own dark value');
ok(L['--chart-1'] === '#2563EB' && L['--chart-2'] === '#ED6F0B' && D['--chart-1'] === '#4C82E0' && D['--chart-2'] === '#C67B28', 'the chart pair is the validated one the modules already draw with (light + dark)');
ok(/\.b-yellow\{background:#F5A623\}/.test(GOLDEN) && L['--band-yellow'] === '#F5A623' && /\.b-orange\{background:#ED6F0B\}/.test(GOLDEN) && L['--band-orange'] === '#ED6F0B', 'the audit legend matches the colours /golden paints');
ok(/\[hidden\]\{display:none!important\}/.test(CSS), 'a hidden flex row really hides (the trap three modules shipped with)');
ok(/prefers-reduced-motion:reduce/.test(CSS) && /max-width:760px/.test(CSS), 'reduced motion and the phone width are handled in the stylesheet');
['.btn', '.btn.pri', '.chip', '.pill', '.seg', '.kpi', '.src', 'table.t', '.field', '.empty', '.toast', '.footmark', '.pbar'].forEach((c) =>
  ok(CSS.indexOf(c + '{') >= 0 || CSS.indexOf(c + ' ') >= 0 || CSS.indexOf(c + ',') >= 0, 'component ' + c + ' is in the stylesheet'));

console.log('The worker');
ok(/import DESIGN_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Design\.html"/.test(WORKER), 'the page is bundled');
ok(/'\/design':\s*\{ html: DESIGN_PAGE, slug: 'design' \}/.test(WORKER), '/design is served');
ok(/DESIGN_PAGE\.indexOf\("\/\* FCC-DESIGN:START \*\/"\)/.test(WORKER) && /DESIGN_PAGE\.indexOf\("\/\* FCC-DESIGN:END \*\/"\)/.test(WORKER), '/design/fcc.css is the SAME slice of the page — one source');
ok(/path === '\/design\/fcc\.css'[\s\S]{0,200}'text\/css; charset=utf-8'/.test(WORKER), '/design/fcc.css answers as text/css');
ok(!/path: '\/design'/.test(ACCESS), 'not a grantable module: every signin can read the guidelines');

console.log('The page');
['#principles', '#colour', '#type', '#components', '#charts', '#layout', '#voice', '#ux', '#never', '#build'].forEach((id) =>
  ok(PAGE.indexOf('id="' + id.slice(1) + '"') >= 0 && PAGE.indexOf('href="' + id + '"') >= 0, 'section ' + id + ' exists and is in the contents'));
ok(/var CSS=\(\$\('fcc-design'\)\|\|\{\}\)\.textContent/.test(PAGE), 'swatches read their values from the stylesheet itself, never typed twice');
ok(/<svg viewBox="0 0 64 40"/.test(PAGE), 'swatches are drawn as SVG (a white swatch is not a light island in dark mode)');
ok(/<\\\/body>\\n<\\\/html>/.test(PAGE), 'the starter template escapes its closing tags (the worker injects at the first </body>)');
ok(/FeedSpark · Private &amp; Confidential/.test(PAGE), 'the footer carries the house line');

console.log('Findable');
ok(/href="\/design"/.test(MIG) && /id:'o-design'/.test(MIG) && /id:'r7'/.test(MIG), 'the migration roadmap links it, carries its card and the AM-module rule');
ok(/Every module loads \/design\/fcc\.css/.test(MIG), 'the custom-module spec checklist requires the stylesheet');
ok(/<a class="hub-card" href="\/design">/.test(LEAD), 'the Leadership hub links it');

console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS') + ' — ' + (passed + failed) + ' assertions');
process.exit(failed ? 1 : 0);
