/* ONE MODAL AT A TIME — the structural tripwire.
 *
 * Ray, 17 Sep 2026, on a ticket opened from the Brief ledger: "what happened to brief ledger
 * view". The answer was two overlays open at once: the task-edit pop-up sits at z-index 9500
 * (it has to clear Focus mode's full-screen overlay) while the ticket modal's scrim is 200, so
 * the 460px edit card painted straight across the middle of the ticket. The ledger was intact —
 * it was covered.
 *
 * A browser test would pin the two overlays that happened to collide. What actually needs
 * pinning is the RULE: every overlay opener goes through soloModal(). This reads the page and
 * fails if a SEVENTH scrim is added later without it — which is the way this bug comes back.
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('../docs/FeedSpark_Workflow.html', import.meta.url);
const html = readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

console.log('\n── the guard exists and says what it protects');
ok(/function soloModal\(keep\)/.test(html), 'soloModal(keep) is defined');
ok(/SOLO_NEVER\s*=\s*'bg-scrim'/.test(html),
  "the composer is named as the one overlay never auto-closed");
ok(/closeBrief\(\)[\s\S]{0,200}?window\.__emailId=null[\s\S]{0,120}?pinClient\(null\)/.test(html),
  'and that exception is earned — closeBrief() really does drop the draft context and unpin');

console.log('\n── every .scrim in the markup is accounted for');
const scrims = [...html.matchAll(/<div class="scrim[^"]*" id="([^"]+)"/g)].map((m) => m[1]);
ok(scrims.length >= 5, 'the page carries ' + scrims.length + ' overlays: ' + scrims.join(', '));
ok(new Set(scrims).size === scrims.length, 'each has a unique id');

console.log('\n── every opener routes through the guard');
/* An opener is any site adding the `on` class to one of those scrims. Each must call soloModal
   on the same statement, naming ITSELF as the one to keep. */
const lines = html.split('\n');
const VARS = { scrim: 'scrim', tleScrim: 'tle-scrim', bgScrim: 'bg-scrim', sc: 'ck-tune-scrim' };
const openers = [];
lines.forEach((ln, i) => {
  // two shapes reach the same place: a held reference (`tleScrim.classList.add('on')`) and an
  // inline lookup (`document.getElementById('acl-scrim').classList.add('on')`). Catch both, or
  // the tripwire quietly stops watching whichever shape the next overlay happens to use.
  const re = /(?:getElementById\('([^']+)'\)|([A-Za-z_$][\w$]*))\.classList\.add\('on'\)/g;
  let m;
  while ((m = re.exec(ln)) !== null) {
    const id = m[1] || VARS[m[2]] || null;
    if (id && scrims.includes(id)) openers.push({ id, line: i + 1, text: ln.trim() });
  }
});
ok(openers.length >= 6, 'found ' + openers.length + ' overlay-opening sites');

const missing = openers.filter((o) => !/soloModal\(/.test(o.text));
ok(missing.length === 0,
  missing.length ? 'these openers skip soloModal — an overlay added without the guard stacks: '
    + missing.map((o) => o.id + ' @ line ' + o.line).join(', ')
    : 'every opener calls soloModal on the same statement');

const mislabelled = openers.filter((o) => {
  const call = o.text.match(/soloModal\('([^']+)'\)/);
  return call && call[1] !== o.id;
});
ok(mislabelled.length === 0,
  mislabelled.length ? 'an opener keeps the WRONG overlay (it would close itself): '
    + mislabelled.map((o) => o.id + ' keeps ' + o.text.match(/soloModal\('([^']+)'\)/)[1]).join(', ')
    : 'each opener names itself as the one to keep');

console.log('\n── the guard closes others, never the one being opened');
const body = html.slice(html.indexOf('function soloModal(keep)'));
const fn = body.slice(0, body.indexOf('\n  }') + 4);
ok(/s\s*===?\s*keepEl/.test(fn), 'it skips the overlay being opened');
ok(/s\.id\s*===?\s*SOLO_NEVER/.test(fn), 'it skips the composer');
ok(/classList\.remove\('on'\)/.test(fn), 'and closes the rest');
ok(/querySelectorAll\('\.scrim\.on'\)/.test(fn),
  'it sweeps the OPEN overlays generically — a new scrim is covered without touching it');

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
