/* CC THE ACCOUNT'S AM.
 *
 * Steven Opuni via Ray, 17 Sep 2026: "Would it be possible for 'Draft in GMail' button to
 * automatically CC the AM of the account in the email draft?"
 *
 * Two halves, both pinned here:
 *   1. amEmail() in src/access.js — the AM's NAME (all the Task Manager states) resolved to an
 *      ADDRESS against what the FCC already knows, and null rather than a guess.
 *   2. ccList()/ccParam() on the Workflow page — who ends up on the draft: deduped, never the
 *      person drafting, and nothing at all when the brand's hours have never been read.
 *
 * The page's copies are LIFTED OUT BY NAME and run against the same table as the module, so the
 * two can't drift.
 */
import { readFileSync } from 'node:fs';
import { amEmail, ACCESS_SEED } from '../cloudflare/feedspark-deck/src/access.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } };

/* ---------- 1. the resolver ---------- */
console.log('\n── an AM name becomes an address, or nothing');
const DIR = {
  'radostina@feedspark.com': { name: 'Radostina', clients: ['House of Bruar'] },
  'andrew@aroxo.com': { name: 'Andrew' },
};
const KNOWN = ['ray@feedspark.com', 'steven@feedspark.com'];
const res = (n) => amEmail(n, { dir: DIR, known: KNOWN });

ok(res('Ray') === 'ray@feedspark.com', 'Ray → ray@feedspark.com');
ok(res('Steven') === 'steven@feedspark.com', 'Steven → steven@feedspark.com');
ok(res('ray') === 'ray@feedspark.com', 'the match folds case');
ok(res(' Ray ') === 'ray@feedspark.com', 'and surrounding space');
ok(res('Radostina') === 'radostina@feedspark.com', 'a directory row resolves by its name');
ok(res('Andrew') === 'andrew@aroxo.com',
  'including the one address that does NOT fit <name>@feedspark.com — the reason guessing is refused');
ok(res('Tech-am') === null, 'a team alias with no address on file resolves to nothing');
ok(res('Michel') === null, 'and so does an AM the FCC has never seen');
ok(res('') === null && res(null) === null && res(undefined) === null, 'empty in, nothing out');
ok(amEmail('Radostina', {}) === 'radostina@feedspark.com', 'with no dir passed it falls back to the git seed');
ok(amEmail('Ray', { dir: {}, known: [] }) === null,
  'nothing is invented when neither source knows the name');

/* the real roster, 17 Sep 2026: every primary AM across all 71 markets is Ray or Steven */
console.log('\n── the roster the Task Manager actually returns');
['Ray', 'Steven'].forEach((n) => ok(!!res(n), 'primary AM "' + n + '" resolves — the live book is covered'));

/* ---------- 2. the page's rules, lifted by name ---------- */
console.log('\n── who ends up on the draft');
const page = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
function lift(name) {
  const at = page.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('could not find ' + name + ' on the page — has it been renamed?');
  // walk braces from the body's first {
  let i = page.indexOf('{', at), depth = 0, end = -1;
  for (let k = i; k < page.length; k++) {
    if (page[k] === '{') depth++;
    else if (page[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return page.slice(at, end);
}
const KEYDECL = (page.match(/var CC_KEY='[^']+';/) || [])[0];
if (!KEYDECL) throw new Error('CC_KEY declaration not found — the off-switch would test nothing');
const SRC = KEYDECL + '\n'
  + ['ccOn', 'ccSet', 'meEmail', 'accountAm', 'ccList', 'ccParam'].map(lift).join('\n');
ok(/localStorage/.test(SRC), 'lifted the page\'s own ccOn/accountAm/ccList/ccParam');
/* The page ALREADY declares amOf(client) -> the AM's NAME (the AM filter, the workload panel and
   the timeline all call it). Declarations hoist, so a second amOf would silently replace it and
   hand those callers an object where they expect a string. Not hypothetical: it happened while
   building this feature, and the lift above is what caught it. */
const amOfDecls = (page.match(/function amOf\s*\(/g) || []).length;
ok(amOfDecls === 1, 'exactly one amOf() on the page — the CC helper must not shadow it (found ' + amOfDecls + ')');
ok(/AM_OF\[c\]\s*\|\|\s*DEFAULT_AM/.test(page), 'and the survivor is the original name lookup');

function makeEngine({ me, hours, on = true }) {
  const store = { 'fcc-bg-cc': on ? '1' : '0' };
  const sandbox = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    ACCESS_ME: { email: me },
    window: { FCCHours: { rec: (n) => (hours[n] ? { name: n, rec: hours[n] } : null) } },
    encodeURIComponent,
  };
  // eslint-disable-next-line no-new-func
  const f = new Function('localStorage', 'ACCESS_ME', 'window', 'encodeURIComponent',
    SRC + '\nreturn { ccList: ccList, ccParam: ccParam, accountAm: accountAm };');
  return { api: f(sandbox.localStorage, sandbox.ACCESS_ME, sandbox.window, encodeURIComponent), store };
}

const HOURS = {
  Monsoon:     { am: 'Ray',    amEmail: 'ray@feedspark.com' },
  Accessorize: { am: 'Ray',    amEmail: 'ray@feedspark.com' },
  Reiss:       { am: 'Steven', amEmail: 'steven@feedspark.com' },
  YuMOVE:      { am: 'Michel', amEmail: null },
  Hobbycraft:  { am: null,     amEmail: null },
};

{
  const { api } = makeEngine({ me: 'steven@feedspark.com', hours: HOURS });
  ok(JSON.stringify(api.ccList(['Monsoon'])) === '["ray@feedspark.com"]',
    'Steven briefing a Ray account copies Ray');
  ok(api.ccParam(['Monsoon']) === '&cc=ray%40feedspark.com', 'and it rides the Gmail URL as &cc=');
  ok(api.ccList(['Reiss']).length === 0, 'briefing his OWN account copies nobody');
  ok(api.ccParam(['Reiss']) === '', 'so no cc parameter is added at all');
  ok(api.ccList(['YuMOVE']).length === 0, 'an AM with no address on file is not invented');
  ok(api.ccList(['Hobbycraft']).length === 0, 'an unread brand contributes nobody');
  ok(api.ccList(['Nowhere']).length === 0, 'and an unknown brand cannot throw');

  console.log('\n── a batch spanning brands');
  const batch = api.ccList(['Monsoon', 'Accessorize', 'Reiss', 'YuMOVE', 'Hobbycraft']);
  ok(batch.length === 1 && batch[0] === 'ray@feedspark.com',
    'each AM appears ONCE, his own account is skipped, the unresolved ones add nothing: ' + JSON.stringify(batch));
  const two = makeEngine({ me: 'ray@feedspark.com', hours: HOURS }).api.ccList(['Monsoon', 'Reiss']);
  ok(two.length === 1 && two[0] === 'steven@feedspark.com',
    'and for Ray the same batch copies only Steven: ' + JSON.stringify(two));
}

console.log('\n── the reader stays in charge');
{
  const { api } = makeEngine({ me: 'steven@feedspark.com', hours: HOURS, on: false });
  ok(api.ccList(['Monsoon']).length === 0, 'switched off, nobody is copied');
  ok(api.ccParam(['Monsoon']) === '', 'and the draft carries no cc');
}
{
  // an unreadable localStorage (private window) must not break the draft — it defaults to ON
  const f = new Function('localStorage', 'ACCESS_ME', 'window', 'encodeURIComponent',
    SRC + '\nreturn ccList;');
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const ccl = f(boom, { email: 'steven@feedspark.com' },
    { FCCHours: { rec: (n) => (HOURS[n] ? { name: n, rec: HOURS[n] } : null) } }, encodeURIComponent);
  ok(JSON.stringify(ccl(['Monsoon'])) === '["ray@feedspark.com"]',
    'a browser that refuses localStorage still gets the default CC, not an exception');
}

console.log('\n── every brief-drafting link carries it');
const briefLinks = page.split('\n')
  .map((l, n) => ({ n: n + 1, l }))
  .filter((r) => /view=cm/.test(r.l) && /encodeURIComponent\(BRIEF_TO\)/.test(r.l));
ok(briefLinks.length >= 4, 'found ' + briefLinks.length + ' links that draft to briefing@feedspark.com');
const without = briefLinks.filter((r) => !/ccParam\(/.test(r.l));
/* The chase link is deliberately NOT one of these: it re-opens an existing ASPL thread rather
   than drafting the brief, so it isn't the button Steven named. Everything else that drafts a
   brief must carry the CC, or the feature only works from whichever entry point I happened to
   remember. */
ok(without.length <= 1,
  without.length <= 1
    ? 'every brief draft carries ccParam (the chase re-open is the one deliberate exception)'
    : 'these brief links skip the CC: ' + JSON.stringify(without.map((r) => 'line ' + r.n)));
/* Name the exception by the function it sits in, not by what happens to be on its own line —
   the 'Re: ' that identifies it is built a line earlier. */
const chase = without[0];
const enclosing = (lineNo) => {
  const upto = page.split('\n').slice(0, lineNo).reverse();
  for (const l of upto) { const m = l.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) return m[1]; }
  return '(top level)';
};
ok(!chase || enclosing(chase.n) === 'chaseAspl',
  'and the one exception really is the chase re-open — it sits in '
    + (chase ? enclosing(chase.n) + '() at line ' + chase.n : 'nothing, every link is covered'));

console.log('\n── the worker serves the resolved address');
const worker = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
ok(/amEmail: r \? amAddr\(r\.am\) : null/.test(worker), '/api/hours carries amEmail beside am');
ok(/const amKnown = \[ownerEmail\(env\), \.\.\.Object\.values\(OWNER_EMAILS/.test(worker),
  'resolved against the owner + the due-reminder roster, not a hard-coded list here');
ok(/accessdir/.test(worker.slice(worker.indexOf('const amDir'), worker.indexOf('const amDir') + 200)),
  'and against the access directory the owner maintains');

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + (pass + fail) + ' assertions');
process.exit(fail ? 1 : 0);
