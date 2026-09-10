#!/usr/bin/env node
/*
 * XML scan agent — Ray's 4x-daily guard monitoring for FeedHero XML feeds (9 Sep 2026:
 * "fetch four times a day for every URL … migrate the monitoring to the URL instead of
 * the sheet"). Fetches every wired {xml} feed in DEFAULT_FEEDS, builds the SAME raw
 * snapshot scanFeed assembles from gviz — by importing labelguard.js's own snapshot
 * code (findCols/snapshotFromParts/findAttrCols/attrsFromCounts/TH), never a reimplementation —
 * and pushes batches to the worker's /api/gmail/push {xmlscan} handler, which runs the
 * shared processScanSnapshot: identical baselines, day references, drop alerts, acks,
 * two-strike emails and badges as the sheet sweep. A feed the agent cannot fetch is
 * reported as {err} so the worker indexes it unreachable (fetch-fail warn), same as gviz.
 *
 * Runs from .github/workflows/xml-scan.yml (cron 4x/day + workflow_dispatch).
 * Auth: FCC_PUSH_KEY secret = the same GMAIL_PUSH_KEY value the Gmail bridge uses —
 * the push path's Access bypass already exists, so no new Zero Trust config.
 * IMPORTANT: the Access login page is HTTP 200 text/html — every response is JSON-verified.
 *
 * Memory: rows are aggregated INSIDE the parser's row callback (counts + value maps only),
 * so a 125MB feed costs the agent a few MB, never the feed.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { xmlCollector } from '../cloudflare/feedspark-deck/src/labelguard.js';
const require = createRequire(import.meta.url);
const FA = require('../docs/feedlab_engine.js');

const HOST = process.env.FCC_HOST || 'feedspark.ray-vtt.workers.dev';
const KEY = process.env.FCC_PUSH_KEY || '';
const ONLY = (process.env.SCAN_ONLY || '').trim();   // "Client|mkt" to scan one feed (debug)
const WORKER = process.env.WORKER_JS || new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url).pathname;
if (!KEY && !process.env.DRY) {
  console.error('✗ FCC_PUSH_KEY not set — store the GMAIL_PUSH_KEY value as a GitHub secret named FCC_PUSH_KEY.');
  process.exit(2);
}

// wired {xml} feeds straight from DEFAULT_FEEDS (client blocks line-scanned; xml only)
function wiredXmlFeeds() {
  const src = readFileSync(WORKER, 'utf8');
  const block = /const DEFAULT_FEEDS = \{([\s\S]*?)\n\};/.exec(src)[1];
  const out = []; let client = null;
  for (const line of block.split('\n')) {
    const c = /^  (?:'([^']+)'|([A-Za-z]+)): \{/.exec(line);
    if (c) client = c[1] || c[2];
    for (const m of line.matchAll(/'?([a-z0-9-]+)'?: \{ xml: '([^']+)' \}/g)) {
      if (client) out.push({ client, mkt: m[1], url: m[2] });
    }
  }
  return out;
}

// one feed -> the scanFeed-shape raw snapshot + the /volume SKU id set. All the
// aggregation and assembly lives in labelguard.js's xmlCollector — the SAME code the
// guard pages' in-browser manual live rescan runs, so the two lanes can never drift.
async function snapshotFeed(feed) {
  const col = xmlCollector({ client: feed.client, market: feed.mkt });
  const parser = FA.createXmlParser(col.onRow);
  const res = await fetch(feed.url);
  if (!res.ok || !res.body) throw new Error('fetch-fail: HTTP ' + res.status);
  const dec = new TextDecoder();
  for await (const chunk of res.body) parser.push(dec.decode(chunk, { stream: true }));
  parser.push(dec.decode()); parser.end();
  return col.finish();
}

async function post(entries) {
  const r = await fetch('https://' + HOST + '/api/gmail/push', {
    method: 'POST', headers: { 'X-FCC-Push-Key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ xmlscan: entries }),
  });
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) throw new Error('non-JSON response (HTTP ' + r.status + ') — Access login page? check the bypass/key');
  const d = await r.json();
  if (!d.ok) throw new Error('push refused: ' + (d.error || JSON.stringify(d)));
  return d.results || [];
}

let feeds = wiredXmlFeeds();
if (ONLY) feeds = feeds.filter((f) => (f.client + '|' + f.mkt) === ONLY);
console.log('· ' + feeds.length + ' wired XML feed(s) to scan');
const entries = [];
let i = 0;
const workers = Array.from({ length: 3 }, async () => {
  while (i < feeds.length) {
    const f = feeds[i++];
    try {
      const { snap, vol } = await snapshotFeed(f);
      entries.push({ client: f.client, mkt: f.mkt, snap, vol });
      console.log('✓ ' + f.client + ' ' + f.mkt + ' — ' + snap.rows + ' rows · '
        + (vol.ids ? vol.ids.split('\n').length : 0) + ' ids' + (vol.trunc ? ' (truncated)' : ''));
    } catch (e) {
      entries.push({ client: f.client, mkt: f.mkt, err: String((e && e.message) || e).slice(0, 140) });
      console.log('✗ ' + f.client + ' ' + f.mkt + ' — ' + String((e && e.message) || e).slice(0, 100));
    }
  }
});
await Promise.all(workers);
if (process.env.DRY) { console.log('\nDRY — computed ' + entries.length + ' snapshot(s), nothing pushed.'); process.exit(0); }

let held = [];
const all = [];
for (let b = 0; b < entries.length; b += 8) all.push(...await post(entries.slice(b, b + 8)));
// every non-ok worker verdict is printed with its reason — a silent reject is undebuggable
const explain = (r) => { if (r.error) console.log('✗ rejected  ' + r.client + ' ' + r.mkt + ' — ' + r.error);
  else if (r.skipped) console.log('~ held      ' + r.client + ' ' + r.mkt + ' — awaiting confirming re-read'); };
all.forEach(explain);
held = all.filter((r) => r.retry);
if (held.length) {
  // catastrophic readings held by the worker: re-fetch those feeds NOW (the confirming
  // second read) and push again — two agreeing reads let real damage land
  console.log('· ' + held.length + ' catastrophic reading(s) held — re-reading for confirmation');
  const confirm = [];
  for (const h of held) {
    const f = feeds.find((x) => x.client === h.client && x.mkt === h.mkt);
    if (!f) continue;
    try { const { snap, vol } = await snapshotFeed(f); confirm.push({ client: f.client, mkt: f.mkt, snap, vol }); }
    catch (e) { confirm.push({ client: f.client, mkt: f.mkt, err: String((e && e.message) || e).slice(0, 140) }); }
  }
  for (let b = 0; b < confirm.length; b += 8) { const rs = await post(confirm.slice(b, b + 8)); rs.forEach(explain); all.push(...rs); }
}
const ok = all.filter((r) => r.ok).length, bad = all.filter((r) => r.error).length, unr = all.filter((r) => r.unreachable).length;
// "still held" = a hold with NO later ok for the same feed (the confirm entry supersedes the hold)
const okKeys = new Set(all.filter((r) => r.ok).map((r) => r.client + '|' + r.mkt));
const stillHeld = all.filter((r) => r.retry && !okKeys.has(r.client + '|' + r.mkt)).length;
console.log('\n✓ scan push complete — ' + ok + ' processed · ' + unr + ' unreachable · ' + bad + ' rejected'
  + (stillHeld ? ' · ' + stillHeld + ' still held' : ''));
process.exit(bad > 0 ? 1 : 0);
