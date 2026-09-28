#!/usr/bin/env node
/*
 * The news digest's road to main — harness for tools/check_news.js and the landing lane.
 *
 * Ray, 28 Sep 2026: "why i vhnt' seen industry updated or a while ? it should be a daily thing".
 * The daily Routine ran every morning and reported success while docs/news_digest.json never
 * changed on main: a cloud session pushes freely only to claude/-prefixed branches, and the ship
 * step said push to main. The fix is a branch + a workflow + ONE gate; this pins the gate's rules
 * (the committed file passes; every way a digest can be wrong is refused with a reason), the
 * lane's shape, and that the skill no longer tells the Routine to push to main.
 *
 *   node tools/test_news.mjs      (qa_gate / presync / validate)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = require(path.join(root, 'tools/check_news.js'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } }
const has = (arr, re) => arr.some((e) => re.test(e));

const src = read('docs/news_digest.json');
const base = JSON.parse(src);
const clone = () => JSON.parse(JSON.stringify(base));
const errs = (d, o) => N.validateDigest(d, o).errors;

// ── 1 · the committed digest passes the schema as it stands (no --fresh: the repo's own file may age)
{
  const r = N.validateText(src);
  ok(r.errors.length === 0, 'committed digest has errors: ' + r.errors.join(' | '));
  ok(r.digest && r.digest.id === base.id, 'validateText hands back the parsed digest');
  ok(base.items.length >= 2 && base.items.length <= N.MAX_ITEMS, 'committed digest carries 2–8 items');
}

// ── 2 · JSON that does not parse is refused with the reason that matters (the worker bundles it)
{
  const r = N.validateText(src.slice(0, -3));
  ok(has(r.errors, /not valid JSON/) && /bundles this file/.test(r.errors[0]), 'malformed JSON refused, naming the bundle');
  ok(r.digest === null, 'no digest handed back on a parse failure');
}

// ── 3 · the id: shape, a real date, agreeing with `generated`, and the same-day suffix
{
  let d = clone(); d.id = '18-09-2026'; ok(has(errs(d), /`id` must be/), 'id shape');
  d = clone(); d.id = '2026-09-31'; ok(has(errs(d), /impossible date/), 'impossible id date');
  d = clone(); d.id = '2026-09-25'; ok(has(errs(d), /disagree by more than a day/), 'id and generated must agree');
  d = clone(); d.id = '2026-09-18-3'; ok(errs(d).length === 0, 'same-day correction suffix accepted');
  d = clone(); delete d.id; ok(has(errs(d), /`id` must be/), 'missing id');
  d = clone(); d.generated = 'yesterday'; ok(has(errs(d), /`generated` is not an ISO/), 'generated must parse');
}

// ── 4 · headline / intro / comment
{
  let d = clone(); d.headline = ''; ok(has(errs(d), /`headline`/), 'empty headline refused');
  d = clone(); d.headline = '<b>bold</b>'; ok(has(errs(d), /`headline`/), 'markup in the headline refused');
  d = clone(); delete d.intro; ok(errs(d).length === 0, 'intro is optional');
  d = clone(); d.intro = 'x'.repeat(301); ok(has(errs(d), /`intro`/), 'intro bounded');
  d = clone(); delete d._comment; ok(has(errs(d), /`_comment` missing/), 'the file keeps its own note');
}

// ── 5 · item count: none, one (warns), nine
{
  let d = clone(); d.items = []; ok(has(errs(d), /no items/), 'empty items refused');
  d = clone();
  while (d.items.length < 9) { const it = JSON.parse(JSON.stringify(d.items[0])); it.title += ' ' + d.items.length; it.url += '?v=' + d.items.length; d.items.push(it); }
  ok(has(errs(d), /cap is 8/), 'nine items refused');
  d = clone(); d.items = [d.items[0]];
  const r = N.validateDigest(d); ok(r.errors.length === 0 && has(r.warnings, /one item/), 'one item passes with a warning');
  d = clone(); d.items = 'many'; ok(has(errs(d), /`items` must be an array/), 'items must be an array');
  d = clone(); d.items[2] = 'a string'; ok(has(errs(d), /items\[2\]: not an object/), 'a non-object item is named by index');
}

// ── 6 · item prose: required, bounded, never markup
{
  for (const k of ['title', 'source', 'what', 'sowhat']) { const d = clone(); d.items[0][k] = ''; ok(has(errs(d), new RegExp('`' + k + '`')), k + ' is required'); }
  let d = clone(); d.items[0].what = 'a <script>alert(1)</script>'; ok(has(errs(d), /`what`/), 'markup in `what` refused');
  d = clone(); d.items[0].sowhat = 'x'.repeat(701); ok(has(errs(d), /`sowhat`/), 'sowhat bounded at 700');
  d = clone(); d.items[0].title = 'x'.repeat(161); ok(has(errs(d), /`title`/), 'title bounded at 160');
}

// ── 7 · the link: https, a real host, nothing that could break out of the href
{
  for (const bad of ['http://example.com/a', 'ftp://x.com/y', 'example.com/path', 'https://localhost/x', 'https://a.com/"onmouseover=1', 'javascript:alert(1)', 'https://a.com/x y', undefined, 42]) {
    const d = clone(); d.items[0].url = bad; ok(has(errs(d), /`url` must be a real https/), 'url refused: ' + String(bad));
  }
  let d = clone(); d.items[1].url = d.items[0].url + '/'; ok(has(errs(d), /same url as items\[0\]/), 'duplicate url refused, trailing slash folded');
  d = clone(); d.items[1].title = d.items[0].title.toUpperCase(); ok(has(errs(d), /same title as items\[0\]/), 'duplicate title refused, case-blind');
}

// ── 8 · dates: a real day, not after generation, inside the 90-day window read against `generated` (not today)
{
  // committed digest: generated 2026-09-18T09:10Z → the window opens 2026-06-20 whole-day, closes 2026-09-19
  let d = clone(); d.items[0].date = '18/09/2026'; ok(has(errs(d), /`date` must be a real/), 'date shape');
  d = clone(); d.items[0].date = '2026-02-30'; ok(has(errs(d), /`date` must be a real/), 'impossible date');
  d = clone(); d.items[0].date = '2026-06-20'; ok(!has(errs(d), /older than/), 'exactly 90 days before is inside the window (whole days, not hours)');
  d = clone(); d.items[0].date = '2026-06-19'; ok(has(errs(d), /older than 90 days/), '91 days before is refused');
  d = clone(); d.items[0].date = '2026-09-19'; ok(!has(errs(d), /after the digest/), 'the day after generation passes (timezones)');
  d = clone(); d.items[0].date = '2026-09-20'; ok(has(errs(d), /after the digest was generated/), 'two days after generation is refused');
  d = clone(); delete d.items[0].date; ok(has(errs(d), /`date` must be a real/), 'missing date');
}

// ── 9 · impact + tags
{
  let d = clone(); d.items[0].impact = 'medium'; ok(has(errs(d), /`impact` must be one of high\|med\|watch/), 'impact vocabulary');
  d = clone(); d.items[0].tags = []; ok(has(errs(d), /`tags` is 1–6/), 'no tags refused');
  d = clone(); d.items[0].tags = 'Google'; ok(has(errs(d), /`tags` is 1–6/), 'tags must be an array');
  d = clone(); d.items[0].tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; ok(has(errs(d), /`tags` is 1–6/), 'seven tags refused');
  d = clone(); d.items[0].extra = 1; const r = N.validateDigest(d); ok(r.errors.length === 0 && has(r.warnings, /unknown field\(s\) extra/), 'an unknown item field warns, passes');
}

// ── 10 · against main's digest: the id must change, `generated` must be newer, the comment is kept
{
  const main = clone();
  let d = clone(); d.id = '2026-09-19'; d.generated = '2026-09-19T06:30:00Z';
  ok(errs(d, { against: main }).length === 0, 'a newer digest with a new id lands');
  d = clone(); d.generated = '2026-09-19T06:30:00Z'; d.id = '2026-09-18-2';
  ok(has(errs(d, { against: main }), /is main's id/), 'main\'s own id is refused — nobody would be re-prompted');
  d = clone(); d.id = '2026-09-17'; d.generated = '2026-09-17T06:00:00Z';
  ok(has(errs(d, { against: main }), /not newer than main's/), 'an older digest never lands over a newer one');
  d = clone(); d.id = '2026-09-19'; d.generated = '2026-09-19T06:30:00Z'; d._comment = 'rewritten';
  const r = N.validateDigest(d, { against: main }); ok(r.errors.length === 0 && has(r.warnings, /`_comment` differs/), 'a rewritten comment warns');
  ok(errs(clone(), { against: null }).length === 0, 'no --against = schema only');
}

// ── 11 · --fresh is the landing lane's clock; the repo's own QA never uses it
{
  const now = Date.parse('2026-09-28T06:30:00Z');
  let d = clone(); d.id = '2026-09-28'; d.generated = '2026-09-28T06:10:00Z';
  d.items.forEach((it) => { if (Date.parse(it.date) < now - 90 * 86400e3) it.date = '2026-09-01'; });
  ok(errs(d, { fresh: true, now }).length === 0, 'today\'s digest passes --fresh');
  ok(has(errs(clone(), { fresh: true, now }), /more than 48h old/), 'the 18 Sep digest is refused by the landing lane on 28 Sep');
  d = clone(); d.id = '2026-09-29'; d.generated = '2026-09-29T09:00:00Z';
  ok(has(errs(d, { fresh: true, now }), /in the future/), 'a future `generated` is refused');
  ok(errs(clone(), { fresh: false, now }).length === 0, 'without --fresh the committed file passes (repo QA)');
}

// ── 12 · the file as text: a pop-up, not a report
{
  const body = JSON.stringify(clone(), null, 2), baseLines = body.split('\n').length;
  const long = body + '\n'.repeat(340 - baseLines);
  ok(has(N.validateText(long).errors, /lines — over 320/), 'over 320 lines refused');
  const mid = body + '\n'.repeat(300 - baseLines);
  const r = N.validateText(mid); ok(r.errors.length === 0 && has(r.warnings, /keep it under ~200/), '221–320 lines warns');
  const fat = JSON.stringify(Object.assign(clone(), { intro: 'x'.repeat(290) }), null, 2).replace('"items"', '"zz": "' + 'y'.repeat(70000) + '", "items"');
  ok(has(N.validateText(fat).errors, /bytes — over 65536/), 'over 64KB refused');
}

// ── 13 · the link check, with a stubbed fetch: 2xx ok · 401/403/429 a wall · 404/410 dead · else unverified
{
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url, method: init.method, ua: init.headers['user-agent'] });
    if (/ok/.test(url)) return { status: 200 };
    if (/wall/.test(url)) return { status: 403 };
    if (/gone/.test(url)) return { status: 404 };
    if (/boom/.test(url)) throw new Error('ECONNRESET');
    return { status: 503 };
  };
  const d = { items: [{ url: 'https://a.com/ok' }, { url: 'https://a.com/wall' }, { url: 'https://a.com/gone' }, { url: 'https://a.com/boom' }, { url: 'https://a.com/five' }, { url: 'https://a.com/ok' }, { url: 'http://a.com/plain' }, { url: 'not a url' }] };
  const l = await N.checkLinks(d, { fetch: stub });
  ok(l.ok.length === 1 && l.blocked.length === 1 && l.dead.length === 1 && l.unverified.length === 2, 'link classes: ' + JSON.stringify(l));
  ok(l.unverified.some((x) => x.error === 'ECONNRESET') && l.unverified.some((x) => x.status === 503), 'a thrown fetch and a 5xx both read unverified, never dead');
  ok(calls.length === 5, 'each https url fetched once (duplicate folded, non-https never fetched): ' + calls.length);
  ok(calls.every((c) => c.method === 'GET' && /FeedSparkNewsDigest/.test(c.ua)), 'GET with an honest user agent, never HEAD');
}

// ── 14 · the CLI's flags
{
  const o = N.parseArgs(['docs/x.json', '--against', '/tmp/m.json', '--fresh', '--offline', '--now', '2026-09-28T00:00:00Z']);
  ok(o.file === 'docs/x.json' && o.against === '/tmp/m.json' && o.fresh && o.offline && o.now === Date.parse('2026-09-28T00:00:00Z'), 'parseArgs reads every flag');
  ok(N.parseArgs([]).file === 'docs/news_digest.json', 'default file is the digest');
  let threw = false; try { N.parseArgs(['--nope']); } catch (e) { threw = true; } ok(threw, 'an unknown flag throws rather than being ignored');
}

// ── 15 · the landing lane, asserted on the workflow file
{
  const W = read('.github/workflows/news-digest.yml');
  ok(/branches:\s*\[\s*'claude\/news-digest'/.test(W), 'fires on the Routine\'s branch');
  ok(/permissions:\s*\n\s*contents: write\s*\n\s*actions: write/.test(W), 'asks for contents + actions write (the push and the dispatch)');
  ok(/git diff --name-only "origin\/main\.\.\.\$\{GITHUB_SHA\}"/.test(W) && /!= "docs\/news_digest\.json"/.test(W), 'refuses anything but the digest');
  ok(/check_news\.js docs\/news_digest\.json --against \/tmp\/main_digest\.json --fresh/.test(W), 'runs the gate against main\'s digest, fresh');
  ok(!/--offline/.test(W), 'the lane checks the links for real');
  ok(/wrangler@4 deploy --dry-run/.test(W), 'dry-run bundles the worker with the new digest');
  ok(/git push origin main/.test(W) && /\[News\] Digest \$id/.test(W), 'lands on main as [News] Digest <id>');
  ok(/for attempt in 1 2 3/.test(W) && /git fetch origin main/.test(W), 'a moved main is retried from the new main');
  ok(/git diff --cached --quiet/.test(W) && /landed=false/.test(W), 'a digest already on main lands nothing');
  ok(/gh workflow run deploy\.yml --ref main/.test(W), 'dispatches the deploy by name — a GITHUB_TOKEN push starts none');
  ok(/git push origin --delete "\$GITHUB_REF_NAME"/.test(W), 'retires the branch');
  ok((W.match(/if: steps\.land\.outputs\.landed == 'true'/g) || []).length === 2, 'deploy and retire run only after a landing');
  ok(/cancel-in-progress: false/.test(W), 'two landings queue, never cancel');
  const D = read('.github/workflows/deploy.yml'); ok(/workflow_dispatch/.test(D), 'deploy.yml accepts a dispatch');
}

// ── 16 · the skill and the Routine no longer push to main; they push the branch, run the gate, confirm the landing
{
  const S = read('.claude/skills/feedspark-news-digest/SKILL.md');
  ok(!/git push -u origin main/.test(S) && !/push straight to `main`/.test(S), 'the skill no longer pushes to main');
  ok(/git checkout -B claude\/news-digest origin\/main/.test(S), 'the skill starts the branch from main');
  ok(/check_news\.js docs\/news_digest\.json --against/.test(S) && /--offline/.test(S), 'the skill runs the same gate first, offline');
  ok(/git push --force -u origin claude\/news-digest/.test(S), 'the skill pushes the branch');
  ok(/Digest \$ID/.test(S) && /git fetch -q origin main/.test(S) && /landed/.test(S), 'the skill confirms the landing on origin/main');
  ok(/Muse/.test(S), 'the beats name Meta\'s shopping agent');
}

// ── 17 · wiring: harness + gate in qa_gate / presync / validate; the worker + page unchanged
{
  const Q = read('tools/qa_gate.sh'), P = read('tools/presync.sh'), V = read('.github/workflows/validate.yml');
  ok(/test_news\.mjs/.test(Q) && /test_news\.mjs/.test(P) && /test_news\.mjs/.test(V), 'harness wired into qa_gate / presync / validate');
  ok(/check_news\.js docs\/news_digest\.json --offline/.test(Q) && /check_news\.js docs\/news_digest\.json --offline/.test(P) && /check_news\.js docs\/news_digest\.json --offline/.test(V), 'the committed digest is gated in all three');
  const Wk = read('cloudflare/feedspark-deck/src/worker.js');
  ok(/import NEWS_DIGEST from "\.\.\/\.\.\/\.\.\/docs\/news_digest\.json"/.test(Wk) && /path === '\/api\/news'/.test(Wk), 'the worker serves /api/news from the bundled file');
  const CC = read('docs/FeedSpark_Command_Center.html');
  ok(/fcc-news-read/.test(CC) && /fetch\('\/api\/news'\)/.test(CC), 'the page keys the pop on the digest id');
  const M = read('CLAUDE.md'); ok(/news-digest\.yml/.test(M) && /claude\/news-digest/.test(M), 'CLAUDE.md names the lane');
}

console.log(`\ntest_news: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
