/**
 * tools/test_shipped.mjs — the build log as a right-hand slide-over.
 *
 * Ray, 16 Sep 2026: "a pop-up module (right hand panel slide) for the activity build log that
 * shows all the most recent build logs that have been completed, because I'm working on multiple
 * features across multiple modules, so sometimes I forget what has actually been done. Bring the
 * shipped PRs onto a right-hand side panel when each feature is complete, and then prompt the
 * user to close the tab."
 *
 * The behaviour worth pinning is the part that stops it becoming noise: the widget must be SILENT
 * on its first ever load (announcing forty historic PRs as "new" teaches you to ignore the badge
 * on day one), must announce only what shipped since you last looked, must NAME THE BRANCH — that
 * is what identifies the tab to close — and must stop announcing once you have looked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const W = fs.readFileSync(path.join(ROOT, 'docs', 'shipped_widget.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  x ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n      got ${JSON.stringify(a)}\n      want ${JSON.stringify(b)}`);

// --- lift the widget's pure helpers by name -----------------------------------------------------
function lift(name) {
  const re = new RegExp('^  function ' + name + '\\(', 'm');
  const m = re.exec(W);
  if (!m) throw new Error('widget: ' + name + ' not found');
  const end = W.indexOf('\n  }\n', m.index);
  if (end < 0) throw new Error(name + ': no end');
  return W.slice(m.index, end + 4);
}
const F = new Function(lift('modOf') + lift('cleanTitle') + lift('ago')
  + '\nreturn { modOf: modOf, cleanTitle: cleanTitle, ago: ago };')();

console.log('-- PR titles read as the repo writes them');
eq(F.modOf('[Task Manager] Excel on every tab'), 'Task Manager', 'the bracketed module prefix is lifted out');
eq(F.modOf('No prefix here'), '', 'a title without one yields no chip rather than a guess');
eq(F.cleanTitle('[Golden] Pillar heatmap (#404)'), 'Pillar heatmap',
  'the prefix and the trailing squash-merge number are stripped — both are already shown separately');
eq(F.cleanTitle('[FCC] The hours report, everywhere'), 'The hours report, everywhere', 'and nothing else is touched');
ok(F.ago(new Date(Date.now() - 90 * 60000).toISOString()) === '2h ago', 'ages read in the largest sensible unit');
eq(F.ago(''), '', 'a missing timestamp reads as nothing, never as "now"');
eq(F.ago(new Date(Date.now() + 600000).toISOString()), '',
  'and a timestamp in the future is refused rather than rendered as a negative age');

// --- the "since you last looked" rule, exercised against the widget's own source ----------------
console.log('-- it announces only what is new, and never on first run');
ok(/if \(!seen\(\)\) setSeen\(merged\(\)/.test(W),
  'FIRST RUN IS SILENT — the first read seeds the seen-set instead of announcing the whole history');
ok(/var s = seen\(\); if \(!s\) return \[\];/.test(W),
  'and freshOnes() returns nothing at all until a baseline exists');
ok(/setSeen\(merged\(\)\.map/.test(W.slice(W.indexOf('function open()'))),
  'opening the panel IS the acknowledgement — the badge clears without a separate "mark read"');
ok(/localStorage/.test(W) && /fcc-shipped-seen/.test(W),
  'the seen-set is per DEVICE, like the theme and the nav collapse — it describes one screen, not the work');
ok(!/\/api\/state/.test(W),
  'it is deliberately NOT shared state: what one screen has been shown is not a team fact');

console.log('-- the prompt names the tab to close');
ok(/you can close its tab/.test(W), 'each newly shipped feature says its session is finished');
ok(/class="br"/.test(W) && /esc\(p\.b\)/.test(W),
  'and prints the BRANCH, which is what identifies the tab among a dozen open ones');
ok(!/window\.close|tab\.close/.test(W), 'it never closes anything itself — it prompts');
ok(!/confirm\(|alert\(/.test(W), 'and never blocks the page with a dialog');

console.log('-- a panel that slides in from the right');
ok(/#fcc-ship\{[^}]*position:fixed/.test(W) && /right:0/.test(W), 'the panel is pinned to the right edge');
ok(/transform:translateX\(102%\)/.test(W) && /#fcc-ship\.on\{transform:none\}/.test(W), 'and slides, rather than appearing');
ok(/id="fcc-ship-h"|'fcc-ship-h'/.test(W), 'a handle on the right edge opens it');
ok(/Escape/.test(W) && /sh-x/.test(W), 'Esc and a close button both dismiss it');
ok(/fcc-ship-dim/.test(W), 'with a backdrop, so it reads as over the page rather than part of it');
ok(/max-width:760px/.test(W) && /width:100%/.test(W), 'full width on a phone');
ok(/--fcc-bar/.test(W), 'and the handle sits clear of the phone module bar');
ok(/prefers-reduced-motion/.test(W), 'the attention pulse respects reduced motion');

console.log('-- it reads the build log the Activity board already publishes');
ok(/fetch\('\/api\/buildlog'\)/.test(W), 'same endpoint as the Build Log tab — one source, two surfaces');
ok(/300000/.test(W), 'polled on a 5-minute timer');
ok(/GitHub unreachable, last snapshot/.test(W),
  'and when GitHub is down it says the snapshot is stale rather than implying nothing shipped');
ok(/visibilitychange/.test(W), 'plus a re-read when the tab comes back to the front');
ok(/\/activity#build/.test(W), 'the full board is one click away');

console.log('-- wiring');
const WK = fs.readFileSync(path.join(ROOT, 'cloudflare', 'feedspark-deck', 'src', 'worker.js'), 'utf8');
ok(/import SHIPPEDW from "\.\.\/\.\.\/\.\.\/docs\/shipped_widget\.html"/.test(WK), 'the worker bundles it');
ok(/realOwner\(env, request\)\) html = inject\(html, LANGW \+ '\\n' \+ SHIPPEDW\)/.test(WK),
  'injected ONLY for the real owner — the build log lives behind the owner-only /activity board');
ok(/\^\\\/deck\\\//.test(W), 'client decks never get it');
ok(/embed=1/.test(W), 'nor the embedded Feed Chat frame');
ok(/shipped_widget\.html/.test(fs.readFileSync(path.join(ROOT, 'tools', 'check_mobile.js'), 'utf8')),
  'the phone tripwire renders it with the other injected layers');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
