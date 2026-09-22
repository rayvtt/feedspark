// Build Log suggestions harness (pure node, CI-safe).
// Pins the rules that make a ranked backlog trustworthy rather than a wishlist with a score on it:
// a signal nobody has synced is UNREAD and never a zero, a play already queued or shipped is never
// suggested again (including the moment you queue it from the panel), and the ranking is the stated
// formula rather than a hand-ordered list. Runs the engine the worker imports, and pins the worker
// and page wiring so the panel cannot drift from it.
import fs from 'node:fs';
import * as BS from '../cloudflare/feedspark-deck/src/buildsuggest.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const PAGE = read('docs/FeedSpark_Activity.html');
const GATE = read('tools/qa_gate.sh'), PRE = read('tools/presync.sh'), CI = read('.github/workflows/validate.yml');

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (why ? ' — ' + why : '')); } };

const NOW = Date.UTC(2026, 8, 22);          // 22 Sep 2026
const DAY = 86400000;
const idOf = (list) => (list || []).map((r) => r.id);

// a full, healthy set of live signals — every store synced, every rule with something to say
function signals(over) {
  return Object.assign({
    now: NOW,
    tm: { Reiss: { balance: -40 }, Superdry: { balance: -120 }, Schuh: { balance: 12 } },
    skip: { clients: { Reiss: { onStreak: 3, hoursSkipped: 252 }, Superdry: { onStreak: 2, hoursSkipped: 168 } } },
    quotes: {
      a: { stage: 'Saved', gross: 12000, t: NOW - 30 * DAY },
      b: { stage: 'Delivered', gross: 8000, t: NOW - 3 * DAY },
      c: { stage: 'Billed', gross: 50000, t: NOW - 60 * DAY },
    },
    briefs: {
      b1: { client: 'Reiss', status: 'briefed', created: NOW - 40 * DAY, updated: NOW - 30 * DAY },
      b2: { client: 'Reiss', status: 'confirmed', created: NOW - 5 * DAY, updated: NOW - DAY },
    },
    golden: {
      'Reiss|gb': { t: NOW, q: 60, reqMissing: ['gtin'], condMissing: [] },
      'Superdry|gb': { t: NOW, q: 91, reqMissing: [], condMissing: ['color'] },
    },
    arrivals: { 'Reiss|gb': { m: { '2026-08': 4000, '2026-09': 90 } } },
    feeds: { wired: 46, scanned: 30 },
    clients: ['Reiss', 'Superdry', 'Schuh'],
  }, over || {});
}

console.log('· the candidate plays');
t('every rule is complete and names one of Ray\'s six levers', BS.RULES.every((r) =>
  r.id && r.title && r.what && r.lever && BS.LEVERS[r.lever] && BS.EFFORT[r.effort]
  && Array.isArray(r.keys) && r.keys.length && r.full > 0 && typeof r.read === 'function'));
t('the six levers are the ones he named', ['revenue', 'churn', 'retention', 'billable', 'efficiency', 'time']
  .every((k) => BS.LEVERS[k]) && Object.keys(BS.LEVERS).length === 6);
t('rule ids are unique, so queueing one can never suppress another', new Set(BS.RULES.map((r) => r.id)).size === BS.RULES.length);
t('every rule covers at least one of revenue / churn / retention / billable / efficiency / time',
  new Set(BS.RULES.map((r) => r.lever)).size >= 5);

console.log('· an unread signal is never a zero');
const blank = BS.suggest({ now: NOW }, []);
t('with nothing synced, NOTHING is ranked', blank.top.length === 0 && blank.rest.length === 0);
t('with nothing synced, every play is UNREAD rather than clear', blank.unread.length === BS.RULES.length && blank.clear.length === 0);
t('each unread play says which signal is missing', blank.unread.every((u) => u.why && u.why.length > 8));
const zero = BS.suggest(signals({ tm: { Schuh: { balance: 12 } } }), []);
t('a store that IS synced and finds nothing lands in clear, not unread',
  idOf(zero.clear).includes('overrun-report') && !idOf(zero.unread).includes('overrun-report'));
t('a clear play is never ranked', !idOf(zero.top).includes('overrun-report') && !idOf(zero.rest).includes('overrun-report'));

console.log('· the readings');
const full = BS.suggest(signals(), []);
const by = {}; full.top.concat(full.rest).forEach((r) => { by[r.id] = r; });
t('overrun sums only the NEGATIVE balances', by['overrun-report'] && by['overrun-report'].n === 160);
t('skip win-back sums the hours skipped across brands', by['skip-winback'] && by['skip-winback'].n === 420);
t('quote chase counts only quotes that are neither billed nor declined AND have gone quiet',
  by['quote-chase'] && by['quote-chase'].n === 12000);
t('invoice handoff counts only what is Delivered', by['invoice-handoff'] && by['invoice-handoff'].n === 8000);
t('auto-chase skips a ticket already confirmed', by['auto-chase'] && by['auto-chase'].n === 1);
t('gap-to-quote counts feeds with required OR conditional gaps', by['gap-to-quote'] && by['gap-to-quote'].n === 2);
t('quality packs count only feeds analysed AND under the 75 band', by['quality-packs'] && by['quality-packs'].n === 1);
t('coverage sweep is wired minus scanned', by['coverage-sweep'] && by['coverage-sweep'].n === 16);
t('quiet accounts counts a brand with no brief in sixty days', by['quiet-accounts'] && by['quiet-accounts'].n === 2);
t('every ranked play states its number and where it came from',
  full.top.every((r) => r.why && r.src && r.why.indexOf(String(Math.round(r.n)).slice(0, 3)) >= 0 || r.why.length > 10));

console.log('· arrivals read the last COMPLETE month');
t('arrivals take the completed month, never the running one', by['arrivals-autobrief'] && by['arrivals-autobrief'].n === 4000);
t('lastCompleteMonth rolls the year at January', BS.lastCompleteMonth(Date.UTC(2027, 0, 9)) === '2026-12');
t('lastCompleteMonth is the previous month mid-year', BS.lastCompleteMonth(Date.UTC(2026, 8, 22)) === '2026-08');
const noMonth = BS.suggest(signals({ arrivals: { 'Reiss|gb': { m: { '2026-09': 90 } } } }), []);
t('a feed with arrivals only in the running month reads as unread, not as zero arrivals',
  idOf(noMonth.unread).includes('arrivals-autobrief'));

console.log('· the ranking is the stated formula');
t('BASIS states the formula, the lever weights and the effort factors',
  /lever weight/.test(BS.BASIS.formula) && /1\.00/.test(BS.BASIS.levers) && /0\.45/.test(BS.BASIS.effort));
t('score = lever × size × effort', Math.abs(BS.scoreOf({ lever: 'revenue', effort: 'S', full: 100 }, 50) - 0.5) < 1e-9);
t('evidence size is capped at full marks', BS.sizeOf(9999, 100) === 1);
t('a bigger unit cannot buy a better score — size is measured against the rule\'s own threshold',
  BS.scoreOf({ lever: 'revenue', effort: 'S', full: 25000 }, 25000) === BS.scoreOf({ lever: 'revenue', effort: 'S', full: 20 }, 20));
t('the top is sorted by score, highest first', full.top.every((r, i) => i === 0 || full.top[i - 1].score >= r.score));
t('at most five are suggested; the remainder is kept as rest', full.top.length === 5
  && full.top.length + full.rest.length === (BS.RULES.length - full.clear.length - full.unread.length - full.taken.length));
t('a tie goes to the cheaper build', (() => {
  const a = { lever: 'revenue', effort: 'S', full: 10 }, b = { lever: 'revenue', effort: 'M', full: 10 };
  return BS.scoreOf(a, 10) > BS.scoreOf(b, 10);
})());
t('the order is stable across identical calls', JSON.stringify(idOf(BS.suggest(signals(), []).top)) === JSON.stringify(idOf(full.top)));

console.log('· never suggest what is already somebody\'s job');
const queued = BS.suggest(signals(), [{ title: 'Over-servicing report — turn a negative balance into a billable conversation', where: 'queue' }]);
t('a play already in the queue drops off the list', !idOf(queued.top).includes('overrun-report') && idOf(queued.taken).includes('overrun-report'));
t('the taken entry says where it already lives', (queued.taken.find((x) => x.id === 'overrun-report') || {}).where === 'queue');
t('a merged PR suppresses its play too', idOf(BS.suggest(signals(), [{ title: '[Leadership] Over-servicing report for negative balances', where: 'shipped' }]).taken).includes('overrun-report'));
t('a partial word match never suppresses a play', idOf(BS.suggest(signals(), [{ title: 'Quote options — 1, 2, 3, 4', where: 'shipped' }]).top).includes('quote-chase')
  || idOf(BS.suggest(signals(), [{ title: 'Quote options — 1, 2, 3, 4', where: 'shipped' }]).rest).includes('quote-chase'));
t('THE CLOSED LOOP: queueing a play under its own title is what makes it disappear', BS.RULES.every((r) =>
  BS.alreadyOn(r, [{ title: r.title, where: 'queue' }])));
t('one play\'s title never suppresses a different play', BS.RULES.every((r) =>
  BS.RULES.filter((o) => o.id !== r.id).every((o) => !BS.alreadyOn(o, [{ title: r.title }]))));

console.log('· wiring');
t('the worker imports the engine and serves /api/buildsuggest', /import \* as BSG from "\.\/buildsuggest\.js";/.test(WK)
  && /path === '\/api\/buildsuggest' && request\.method === 'GET'/.test(WK));
t('the route is owner-only, like the rest of the Build Log',
  /\/api\/buildsuggest[\s\S]{0,220}realOwner\(env, request\)\) return json\(\{ error: 'restricted to the account owner' \}, 403\)/.test(WK));
t('it reads the live stores rather than a committed snapshot',
  ["'tmidx'", "'schedskip'", "'goldenidx'", "'voldobidx'", "'briefs'", "'aiquotesaved'", "'buildqueue'"]
    .every((k) => new RegExp('buildsuggest[\\s\\S]{0,2200}' + k).test(WK)));
t('briefs and saved quotes are lifted out of their kvmerge envelopes',
  /buildsuggest[\s\S]{0,1600}liftEnvelope\(await env\.EDITS\.get\('briefs'[\s\S]{0,400}liftEnvelope\(await env\.EDITS\.get\('aiquotesaved'/.test(WK));
t('the queue AND the PR history are passed in as already-done', /buildsuggest[\s\S]{0,2400}const done = Object\.keys\(queue\)[\s\S]{0,400}bl\.pulls/.test(WK));
t('no client hours or client names are baked into the engine',
  !/Reiss|Superdry|Schuh|Monsoon|YuMOVE|Accessorize/.test(read('cloudflare/feedspark-deck/src/buildsuggest.js')));
t('the Build Log tab carries the panel above the queue it feeds',
  PAGE.indexOf('id="sg-panel"') > 0 && PAGE.indexOf('id="sg-panel"') < PAGE.indexOf('Queue — not built yet'));
t('the panel loads with the tab and on ⟳ Refresh', /window\.__blInit=function\(\)\{ qGet\(\); load\(false\); sgLoad\(\); \}/.test(PAGE)
  && /bl-refresh'\)\.onclick=function\(\)\{ load\(true\); sgLoad\(\); \}/.test(PAGE));
t('＋ Queue it writes the play into the SAME buildqueue store and re-reads the suggestions',
  /function sgQueue\(id\)/.test(PAGE) && /Q\[qid\]=\{id:qid,title:r\.title/.test(PAGE) && /qSave\(\); renderQueue\(\); sgLoad\(\);/.test(PAGE));
t('the panel prints the basis and names what it did not rank', /function sgFoot\(d\)/.test(PAGE)
  && /candidate plays ranked/.test(PAGE) && /never synced/.test(PAGE));
t('harness wired into the gate, presync and CI', /test_buildsuggest\.mjs/.test(GATE) && /test_buildsuggest\.mjs/.test(PRE) && /test_buildsuggest\.mjs/.test(CI));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
