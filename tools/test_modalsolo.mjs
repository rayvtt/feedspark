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
import { createRequire } from 'node:module';
import { join } from 'node:path';

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

const GUARD = /(?:soloModal|FCCSolo)\(/;
const missing = openers.filter((o) => !GUARD.test(o.text));
ok(missing.length === 0,
  missing.length ? 'these openers skip soloModal — an overlay added without the guard stacks: '
    + missing.map((o) => o.id + ' @ line ' + o.line).join(', ')
    : 'every opener calls soloModal on the same statement');

const mislabelled = openers.filter((o) => {
  const call = o.text.match(/(?:soloModal|FCCSolo)\('([^']+)'\)/);
  return call && call[1] !== o.id;
});
ok(mislabelled.length === 0,
  mislabelled.length ? 'an opener keeps the WRONG overlay (it would close itself): '
    + mislabelled.map((o) => o.id + ' keeps ' + o.text.match(/(?:soloModal|FCCSolo)\('([^']+)'\)/)[1]).join(', ')
    : 'each opener names itself as the one to keep');

console.log('\n── the guard closes others, never the one being opened');
const body = html.slice(html.indexOf('function soloModal(keep)'));
const fn = body.slice(0, body.indexOf('\n  }') + 4);
ok(/s\s*===?\s*keepEl/.test(fn), 'it skips the overlay being opened');
ok(/s\.id\s*===?\s*SOLO_NEVER/.test(fn), 'it skips the composer');
ok(/classList\.remove\('on'\)/.test(fn), 'and closes the rest');
ok(/querySelectorAll\('\.scrim\.on'\)/.test(fn),
  'it sweeps the OPEN overlays generically — a new scrim is covered without touching it');

console.log('\n── the guard is reachable from every script block');
/* The cockpit tuner lives in its OWN <script>, so it cannot see the closure soloModal is declared
   in — it threw "soloModal is not defined" and took the panel down. The bridge is what makes the
   rule enforceable page-wide rather than closure-wide. */
ok(/window\.FCCSolo\s*=\s*soloModal/.test(html), 'soloModal is exported as window.FCCSolo');
const blocks = [...html.matchAll(/<script[^>]*>/g)].map((m) => html.slice(0, m.index).split('\n').length);
const blockOf = (line) => blocks.filter((b) => b <= line).length;
const defBlock = blockOf(html.slice(0, html.indexOf('function soloModal(keep)')).split('\n').length);
const strays = openers.filter((o) => blockOf(o.line) !== defBlock && !/FCCSolo\(/.test(o.text));
ok(strays.length === 0,
  strays.length ? 'these openers are in another <script> and call soloModal directly — it is not in scope there: '
    + strays.map((o) => o.id + ' @ line ' + o.line).join(', ')
    : 'an opener outside the declaring block goes through the bridge');

console.log('\n── and a modal never lands on an open rail');
/* Ray, 18 Sep 2026, opening a brief ticket with the Playbook rail up: "workflow still have this
   issue when clickign on brief ticket" — a screenshot of two cards, the right one sliced down
   its left edge. Not two overlays this time: ONE modal, centred on the viewport by a
   position:fixed;inset:0 scrim while the page itself is padded for the rail, so on any window
   under ~1400px the card's right edge crossed the rail's left edge. Same picture, different
   cause — which is why the rule above did not catch it and this one exists. */
ok(/@media\(min-width:901px\)\{[\s\S]{0,400}?body\.ck-l-on \.scrim\{padding-left:calc\(var\(--ck-w\)/.test(html),
  'the scrim mirrors the LEFT rail\'s padding, so the modal centres in the column that is left');
ok(/@media\(min-width:901px\)\{[\s\S]{0,400}?body\.ck-r-on \.scrim\{padding-right:calc\(var\(--ck-w\)/.test(html),
  'and the RIGHT rail\'s — one rule per rail, both off --ck-w so they can never disagree with the body');
/* A vw width is measured against the VIEWPORT, so a modal sized that way steps straight back out
   of the column the scrim reserves — the bug returns while the padding rule above still reads
   correct. Every .modal sizes off 100% (its scrim's content box) or a px cap. */
const vwModals = [...html.matchAll(/^[ \t]*\.?[\w.\- ]*\bmodal\b[\w.\- ]*\{[^}]*\}/gm)]
  .filter((m) => /\d+vw/.test(m[0]));
ok(vwModals.length === 0,
  vwModals.length ? 'these modals size off the viewport, not their scrim\'s column: '
    + vwModals.map((m) => m[0].trim()).join(' | ')
    : 'no modal sizes itself off vw — each measures the column its scrim reserves');

/* The rules above pin the mechanism; this measures the result. Renders the real page with the
   Playbook rail up, opens a ticket from the ledger and asserts the two boxes do not intersect,
   at the widths where they used to. */
const req = createRequire(join(process.env.NODE_PATH || '/usr/lib/node_modules', 'x'));
let chromium = null;
try { ({ chromium } = req('playwright')); } catch (e) { console.log('\n── geometry · playwright unavailable — skipped'); }
if (chromium) {
  console.log('\n── measured: the ticket modal and the open rail do not intersect');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const BRIEFS = { 'MONS-20260812-01': { id: 'MONS-20260812-01', client: 'Monsoon', market: 'gb',
    task: 'FS to breakdown the volume count', cat: 'technical', status: 'progress', code: 'MONS-GB',
    created: day(40), due: day(30), by: 'Ray', comms: [] } };
  const INIT = `(function(){var BR=${JSON.stringify(BRIEFS)};
    window.fetch=function(u,o){var s=String(u),b={ok:true};
      if(s.indexOf('/api/briefs')>=0&&(!o||(o.method||'GET')==='GET'))b=BR;
      return Promise.resolve({ok:true,status:200,headers:{get:function(){return '0'}},
        json:function(){return Promise.resolve(b)},text:function(){return Promise.resolve(JSON.stringify(b))}});};})();`;
  const B = await chromium.launch();
  for (const W of [1100, 1280, 1340, 1500]) {
    const ctx = await B.newContext({ viewport: { width: W, height: 900 } });
    await ctx.addInitScript(INIT);
    const p = await ctx.newPage();
    await p.goto(new URL('../docs/FeedSpark_Workflow.html', import.meta.url).href + '?pb=1');
    await p.waitForTimeout(1800);
    try { await p.locator('#bl-tog').click({ timeout: 4000 }); await p.waitForTimeout(500);
          await p.locator('#bl-rows tr').first().click({ force: true, timeout: 4000 }); } catch (e) {}
    await p.waitForTimeout(600);
    const g = await p.evaluate(() => {
      const sc = document.getElementById('scrim'), m = document.getElementById('modal');
      const rail = [...document.querySelectorAll('.ck')].find((r) => {
        const cs = getComputedStyle(r); return cs.display !== 'none' && r.getBoundingClientRect().width > 2; });
      if (!sc || !sc.classList.contains('on') || !rail) return { open: false, rail: !!rail };
      const r = m.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      return { open: true, rail: true, w: Math.round(r.width), mx: Math.round(r.x),
        rx: Math.round(rr.x), rw: Math.round(rr.width),
        hits: !(r.x + r.width <= rr.x + 0.5 || rr.x + rr.width <= r.x + 0.5),
        onScreen: rr.x >= -0.5 && rr.x + rr.width <= innerWidth + 0.5 };
    });
    ok(g.open, W + 'px — the rail is up and a ticket is open');
    if (g.open) {
      ok(!g.hits, W + 'px — modal ' + g.mx + '..' + (g.mx + g.w) + ' clears the rail at ' + g.rx
        + (g.hits ? ' — IT LANDS ON THE RAIL' : ''));
      ok(g.onScreen, W + 'px — and the rail is still whole on screen');
    }
    await ctx.close();
  }
  await B.close();
}

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
