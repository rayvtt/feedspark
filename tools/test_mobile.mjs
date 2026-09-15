// Phone layer harness (pure node, CI-safe — the Playwright render check is tools/check_mobile.js in presync).
// Pins what makes the phone view MIRROR the desktop (Ray, 15 Sep 2026): the layer is injected on every
// app page for every signin, the module nav node becomes the bottom bar (same anchors), nothing a page
// used to hide under a max-width rule stays hidden, and the two render tripwires carry the widget.
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const W = read('docs/mobile_widget.html'), WK = read('cloudflare/feedspark-deck/src/worker.js');
const DARK = read('tools/check_darkmode.js'), MOB = read('tools/check_mobile.js'), PRE = read('tools/presync.sh');
let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };
const media = W.match(/@media \(max-width:760px\)\{([\s\S]*)\n\}\n<\/style>/);
t('the layer is a single ≤760px media block', !!media);
const css = media ? media[1] : '';
console.log('· chrome');
t('the module nav node itself becomes the fixed bottom bar (same anchors, same order, same ▦ bundling)', /#tb-modules\{display:flex!important;position:fixed;left:0;right:0;bottom:0/.test(css));
t('every bar item shows its label (the desktop tooltip text) under the icon', /#tb-modules a\.tbm::after\{content:attr\(data-lbl\)/.test(css));
t('the desktop collapse toggle collapses the bar too (mirror), the ▦ sheet still lists every module', /:root\.nav-collapsed #tb-modules\{display:none!important\}/.test(css) && /All modules/.test(W));
t('the topbar drops its backdrop blur on phones (it would become the containing block of the fixed bar + sheets)', /\.topbar\{backdrop-filter:none!important/.test(css));
t('the ▦ menu, presence popover, view-as pill and customizer become bottom sheets above the bar', /#fcc-apps-menu\{position:fixed!important/.test(css) && /\.pz-pop\{left:8px!important/.test(css) && /#fcc-viewas\{top:auto!important/.test(css) && /#fcc-navcz\{width:100%!important/.test(css));
t('the Feed Chat bubble rides above the bar', /#fcc-fcb\{bottom:calc\(var\(--fcc-bar\)/.test(css));
t('body reserves the bar height (safe-area aware)', /body\{padding-bottom:calc\(var\(--fcc-bar\) \+ env\(safe-area-inset-bottom/.test(css));
console.log('· mirror — nothing a page hid under a max-width rule stays hidden');
t('Golden Record per-attribute actions + notes are shown', /\.at-act\{display:flex!important/.test(css) && /\.at-note\{display:block!important/.test(css));
t("the brief composer's context rail is shown", /\.bs-ctx\{display:block!important/.test(css));
t('the home CTA link is shown', /\.wf-cta \.wf-go\{display:inline-flex!important/.test(css));
t('the AI Quote rate / line columns are shown and the grid pans', /\.qrow \.col-rate,\.qrow \.col-line[^{]*\{display:block!important/.test(css) && /\.qrows\{display:block;overflow-x:auto/.test(css));
t('the court sub-labels are shown', /\.court \.ct-s\{display:block!important/.test(css));
console.log('· pan, don\'t crush');
t('wide tables and min-width workbenches get a scrolling frame from the sweep', /function pan\(el\)/.test(W) && /querySelectorAll\('table'\)/.test(W) && /parseFloat\(cs\.minWidth\)/.test(W));
t('the sweep re-runs on DOM mutations and on resize, never inside the bar / sheets', /MutationObserver/.test(W) && /closest\('#tb-modules,#fcc-apps-menu,\.pz-pop'\)/.test(W));
t('inputs render at 16px (no iOS zoom on focus) and buttons get a thumb-sized target', /select,textarea\{font-size:16px!important\}/.test(css) && /a\.btn\{min-height:36px\}/.test(css));
console.log('· wiring');
t('the worker injects the layer on app pages for EVERY signin (not owner-gated)', /if \(realOwner\(env, request\)\) html = inject\(html, LANGW\);\n[^\n]*\n\s*html = inject\(html, MOBILEW\);/.test(WK));
t('the worker imports the widget as a Text module', /import MOBILEW from "\.\.\/\.\.\/\.\.\/docs\/mobile_widget\.html";/.test(WK));
t('the dark tripwire renders pages WITH the phone layer', /'apps_widget\.html', 'mobile_widget\.html'/.test(DARK));
t('the phone tripwire renders every app page at 390px and fails on overflow / tall header / lost bar / hidden desktop controls', /devices\['iPhone 13'\]/.test(MOB) && /horizontal overflow/.test(MOB) && /topbar ' \+ m\.tbH \+ 'px tall/.test(MOB) && /hidden on the phone but visible on desktop/.test(MOB));
t('presync runs the phone tripwire after the dark one', /check_darkmode\.js[\s\S]*check_mobile\.js/.test(PRE));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
