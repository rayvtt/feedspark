#!/usr/bin/env node
/*
 * Estate rescan — the "parallel agent": force-rescans every sheet-backed feed by calling
 * the live worker's POST /api/labels/scan (one pass per feed refreshes custom labels AND
 * product types server-side, with all baseline/daily semantics intact — each request is
 * its own worker invocation, so the 50-subrequest budget applies per feed, never in total).
 *
 * The FCC is Cloudflare Access-gated, so this authenticates with an Access SERVICE TOKEN:
 *   env FCC_ACCESS_CLIENT_ID / FCC_ACCESS_CLIENT_SECRET  (Zero Trust -> Access -> Service Auth;
 *   the token must be allowed by the site-wide Access app's policy)
 *   env FCC_HOST (default feedspark.ray-vtt.workers.dev)
 *
 * Run via the estate-rescan GitHub Action (workflow_dispatch) or locally with the env set.
 * IMPORTANT: Access serves its login page as HTTP 200 text/html — a 200 is NOT success.
 * Every response is JSON-verified; HTML means the token is missing/not allowed -> hard fail.
 */
const HOST = process.env.FCC_HOST || 'feedspark.ray-vtt.workers.dev';
const ID = process.env.FCC_ACCESS_CLIENT_ID || '';
const SECRET = process.env.FCC_ACCESS_CLIENT_SECRET || '';
const CONCURRENCY = Math.max(1, parseInt(process.env.RESCAN_CONCURRENCY || '5', 10) || 5);

if (!ID || !SECRET) {
  console.error('✗ FCC_ACCESS_CLIENT_ID / FCC_ACCESS_CLIENT_SECRET not set.');
  console.error('  Mint a service token in Cloudflare Zero Trust (Access -> Service Auth),');
  console.error('  include it in the FCC Access app policy, and store both values as GitHub secrets.');
  process.exit(2);
}

const HDRS = { 'CF-Access-Client-Id': ID, 'CF-Access-Client-Secret': SECRET };

async function j(path, opts) {
  const r = await fetch('https://' + HOST + path, Object.assign({ headers: HDRS }, opts || {}));
  const text = await r.text();
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) {
    // Access login page = HTTP 200 text/html. Never mistake it for a result.
    throw new Error('non-JSON response from ' + path + ' (HTTP ' + r.status + ', ' + ct.split(';')[0] +
      ') — the service token is missing from the Access policy or invalid');
  }
  let body;
  try { body = JSON.parse(text); } catch (e) { throw new Error('bad JSON from ' + path); }
  return { status: r.status, body };
}

const estate = await j('/api/labels/estate');
const feeds = Object.values(estate.body.feeds || {});
if (!feeds.length) { console.error('✗ estate returned no feeds'); process.exit(1); }
console.log('Estate: ' + feeds.length + ' sheet-backed feeds — force-rescanning all (concurrency ' + CONCURRENCY + ')');

let ok = 0, failed = 0, i = 0;
const failures = [];
async function worker() {
  while (i < feeds.length) {
    const f = feeds[i++];
    const tag = f.client + ' | ' + f.mkt;
    try {
      const r = await j('/api/labels/scan?client=' + encodeURIComponent(f.client) + '&market=' + encodeURIComponent(f.mkt), { method: 'POST' });
      if (r.body && r.body.error) { failed++; failures.push(tag + ' — ' + r.body.error); console.log('✗ ' + tag + ' — ' + r.body.error); }
      else {
        ok++;
        const pt = r.body && r.body.pt && r.body.pt.snapshot && r.body.pt.snapshot.labels.product_type;
        console.log('✓ ' + tag + ' — ' + (r.body.snapshot ? r.body.snapshot.rows + ' rows' : 'scanned') +
          (pt && pt.present ? ' · PT ' + pt.cov + '% (' + pt.distinct + (pt.truncated ? '+' : '') + ' paths)' : ''));
      }
    } catch (e) {
      failed++; failures.push(tag + ' — ' + e.message); console.log('✗ ' + tag + ' — ' + e.message);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log('\nDone: ' + ok + ' scanned, ' + failed + ' failed of ' + feeds.length);
if (failures.length) { console.log('Failures:'); failures.forEach((f) => console.log('  ' + f)); }
process.exit(failed && !ok ? 1 : 0);
