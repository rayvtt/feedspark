#!/usr/bin/env node
/* SECURITY HEADERS, RENDERED (security checklist, 24 Sep 2026, item 18).
 *
 * A Content-Security-Policy is the one header that can silently break the product: get a
 * directive wrong and a page loads with its fonts missing, its engine refusing to run, or its
 * whole script block dead — and every source assertion still passes. So this tripwire does not
 * read the policy, it SERVES the real pages under the real header through Chromium and fails on
 * any refusal the browser reports.
 *
 * The policy string is LIFTED from worker.js rather than restated here, so the test can never
 * drift from what ships. Two halves:
 *   1. every app page loads with zero CSP violations — the regression that would break the FCC.
 *   2. a NEGATIVE CONTROL: a script from a host the policy never names must actually be refused.
 *      Without this the suite would pass just as happily against a policy that allows everything,
 *      which is the failure mode of most CSP work.
 *
 * Run: node tools/check_csp.js   (presync)
 */
const http = require('http'), fs = require('fs'), path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + extra : '')); }
};

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const wsrc = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
const m = wsrc.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\);/);
if (!m) { console.log('  ✗ could not lift the CSP out of worker.js'); process.exit(1); }
const CSP = m[1].split('\n').map((l) => l.trim()).filter((l) => l.startsWith('"'))
                .map((l) => l.replace(/^"|",?$/g, '')).join('; ');

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('  (playwright unavailable — skipping the rendered CSP check)'); process.exit(0); }

  /* THE ENGINES THE WORKER SERVES, served here too (Ray, 24 Sep 2026: "Failed to fetch dynamically
     imported module: blob:…" on /golden the day the policy shipped). This server used to answer
     every engine route with a 404, so each page's loader failed on the FETCH, swallowed it, and
     never reached the import() the policy was refusing — the sweep passed while the rule library,
     the Analyse button and two guards' live rescan were dead in production. The route table is
     LIFTED from worker.js (path → the imported identifier → its docs/ file), so a new engine route
     is served here the day it ships. */
  const IMPORTS = {};
  for (const x of wsrc.matchAll(/^import (\w+) from "\.\.\/\.\.\/\.\.\/(docs\/[^"]+)";/gm)) IMPORTS[x[1]] = x[2];
  const ENGINES = {};
  for (const x of wsrc.matchAll(/if \(path === '(\/[\w\/.-]+\.(?:js|json))' && request\.method === 'GET'\) \{\s*return new Response\((?:JSON\.stringify\()?(\w+)/g)) {
    if (IMPORTS[x[2]]) ENGINES[x[1]] = path.join(ROOT, IMPORTS[x[2]]);
  }
  const NOBLOB = CSP.replace(/(script-src[^;]*?) blob:/, '$1');   // the policy as it shipped on 24 Sep

  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(DOCS, p);
    if (ENGINES[p]) {
      res.writeHead(200, { 'Content-Type': (p.endsWith('.json') ? 'application/json' : 'application/javascript') + '; charset=utf-8' });
      return res.end(fs.readFileSync(ENGINES[p]));
    }
    if (p.startsWith('/__noblob/')) {
      const g = path.join(DOCS, p.slice('/__noblob'.length));
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': NOBLOB });
      return res.end(fs.readFileSync(g));
    }
    if (p === '/__probe') {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': CSP });
      // the negative control: a script from a host the policy never names
      return res.end('<!doctype html><meta charset="utf-8"><body><script src="https://example.org/x.js"><\/script>');
    }
    if (f.endsWith('.html') && f.startsWith(DOCS) && fs.existsSync(f)) {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': CSP });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const b = await chromium.launch();

  const watch = (pg, bucket) => {
    pg.on('console', (msg) => { const t = msg.text();
      if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(t)) bucket.push(t.slice(0, 140)); });
    pg.on('pageerror', (e) => { if (/Content Security Policy/i.test(String(e))) bucket.push(String(e).slice(0, 140)); });
  };

  console.log('Every app page renders under the shipped policy');
  const pages = fs.readdirSync(DOCS).filter((f) => /^FeedSpark_.*\.html$/.test(f)).sort();
  for (const f of pages) {
    const pg = await b.newPage(); const viol = [];
    watch(pg, viol);
    await pg.goto('http://127.0.0.1:' + port + '/' + f, { waitUntil: 'load' }).catch(() => {});
    await pg.waitForTimeout(800);
    ok(f, viol.length === 0, viol[0]);
    await pg.close();
  }
  ok('the sweep actually read pages', pages.length >= 15, String(pages.length));

  /* EVERY ENGINE LOADER, RUN UNDER THE POLICY. /labels and /ptypes only load labelguard.js on
     demand (the live rescan, the brand ⬇ HTML), so no page-load sweep can reach their import().
     Each page's own loader functions — any `function loadX()` that fetches an engine — are lifted
     from the page source and CALLED in that page, under the shipped header, and must resolve to
     the engine. Then the same loaders run under the policy WITHOUT blob:, and every blob loader
     must be refused there: without that control this block would pass against a policy that
     never exercised the directive at all. */
  console.log('\nEvery engine loader runs under the shipped policy');
  ok('the engine routes were lifted from worker.js', Object.keys(ENGINES).length >= 8 && !!ENGINES['/labels/engine.js'], Object.keys(ENGINES).join(' '));
  const loaders = [];
  for (const f of pages) {
    const src = fs.readFileSync(path.join(DOCS, f), 'utf8');
    for (const x of src.matchAll(/\n  function (load\w+)\(\) \{\n[\s\S]*?\n  \}(?=\n)/g)) {
      if (/fetch\('\/[\w\/.-]+engine\.js'\)/.test(x[0])) loaders.push({ f, name: x[1], body: x[0], blob: /import\(URL\.createObjectURL/.test(x[0]) });
    }
  }
  ok('the pages that import an engine from a blob: URL were found', ['FeedSpark_GoldenRecord.html', 'FeedSpark_LabelGuard.html', 'FeedSpark_ProductTypeGuard.html']
    .every((f) => loaders.some((l) => l.f === f && l.blob)), loaders.filter((l) => l.blob).map((l) => l.f).join(' '));
  const run = async (base, l) => {
    const pg = await b.newPage(); const viol = [];
    watch(pg, viol);
    await pg.goto('http://127.0.0.1:' + port + base + l.f, { waitUntil: 'load' }).catch(() => {});
    const r = await pg.evaluate(({ body, name }) => { try { delete window.__LG; } catch (e) {}
      return (new Function(body + '; return ' + name + '();'))()
        .then((m) => (m && (typeof m === 'object' || typeof m === 'function') && Object.keys(m).length ? 'ok' : 'empty'), (e) => 'ERR ' + (e && e.message));
    }, l).catch((e) => 'ERR ' + e.message);
    await pg.close();
    return { r, viol };
  };
  for (const l of loaders) {
    const { r, viol } = await run('/', l);
    ok(l.f + ' › ' + l.name + '() loads its engine', r === 'ok' && !viol.length, r + (viol[0] ? ' · ' + viol[0] : ''));
  }
  for (const l of loaders.filter((x) => x.blob)) {
    const { r } = await run('/__noblob/', l);
    ok('control: without blob: in script-src, ' + l.f + ' › ' + l.name + '() is refused', r !== 'ok', r);
  }

  console.log('\nNegative control — the policy refuses what it should');
  const pg = await b.newPage(); const viol = [];
  watch(pg, viol);
  await pg.goto('http://127.0.0.1:' + port + '/__probe', { waitUntil: 'load' }).catch(() => {});
  await pg.waitForTimeout(500);
  ok('a script from an unnamed host is blocked (policy is not vacuous)', viol.length > 0);
  await pg.close();

  console.log('\nThe headers the worker stamps');
  for (const h of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
                   'Permissions-Policy', 'Strict-Transport-Security']) {
    ok(h + ' is set in secHeaders()', new RegExp("h\\.set\\('" + h + "'").test(wsrc));
  }
  ok("frame-ancestors is 'self', not 'none' (Feed Chat iframes the app)", /frame-ancestors 'self'/.test(CSP));
  ok("object-src is 'none'", /object-src 'none'/.test(CSP));
  ok("base-uri is 'self'", /base-uri 'self'/.test(CSP));
  ok('the CSP is only applied to HTML responses', /text\/html.*\n?.*Content-Security-Policy/.test(wsrc)
     || /includes\('text\/html'\)\) h\.set\('Content-Security-Policy'/.test(wsrc));

  console.log('\nSubresource integrity on every CDN script (item 20)');
  // source side: no page may pull a cross-origin script without a hash AND crossOrigin — the
  // attribute alone is silently ignored without it, which is the usual way SRI ships broken.
  const htmls = fs.readdirSync(DOCS).filter((f) => f.endsWith('.html'));
  let cdnLoads = 0;
  for (const f of htmls) {
    const src = fs.readFileSync(path.join(DOCS, f), 'utf8');
    const urls = src.match(/https:\/\/cdnjs\.cloudflare\.com\/[^'"`\s)]+\.js/g) || [];
    if (!urls.length) continue;
    cdnLoads += urls.length;
    const hashes = (src.match(/sha(?:256|384|512)-[A-Za-z0-9+/=]+/g) || []).length;
    ok(f + ' - every cdnjs script has a hash', hashes >= urls.length, hashes + ' hashes / ' + urls.length + ' loads');
    ok(f + " - sets crossOrigin (without it integrity is ignored)", /crossOrigin\s*=\s*'anonymous'/.test(src));
  }
  ok('the tree still loads scripts from a CDN (guard is still needed)', cdnLoads > 0, String(cdnLoads));

  // live side: a wrong hash must actually stop execution. Skipped, never failed, with no network.
  const probe = async (hash) => {
    const pg2 = await b.newPage();
    await pg2.setContent('<!doctype html><meta charset="utf-8"><body>', { waitUntil: 'load' });
    const r = await pg2.evaluate(async (h) => await new Promise((res) => {
      const el = document.createElement('script');
      el.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      if (h) { el.integrity = h; el.crossOrigin = 'anonymous'; }
      el.onload = () => res('loaded'); el.onerror = () => res('blocked');
      setTimeout(() => res('timeout'), 12000);
      document.head.appendChild(el);
    }), hash);
    await pg2.close();
    return r;
  };
  const GOOD = (fs.readFileSync(path.join(DOCS, 'FeedSpark_GoldenRecord.html'), 'utf8')
    .match(/sha512-[A-Za-z0-9+/=]+/g) || [])[0];
  if ((await probe(null)) !== 'loaded') {
    console.log('  (cdnjs unreachable from here - skipping the live SRI probe)');
  } else {
    ok('the pinned hash still matches what cdnjs serves', (await probe(GOOD)) === 'loaded');
    ok('a wrong hash is refused (SRI is actually enforced)',
       (await probe('sha512-' + 'A'.repeat(86) + '==')) === 'blocked');
  }

  await b.close(); srv.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})();
