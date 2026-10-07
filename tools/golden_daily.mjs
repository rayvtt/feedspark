#!/usr/bin/env node
/*
 * GOLDEN RECORD DAILY — 09:00 UK (Ray, 24 Sep 2026: "I think Golden Record and content quality
 * should automatically scan on a daily basis, then at 9 a.m. UK time, so every day there's a
 * tracker. If there's a manual scan on any day, that new score can override that day. So let's
 * do that for all clients.").
 *
 * The feed score already had an automatic lane (the 4x-daily xml-scan); content quality and
 * AI-readiness had none — they were computed in the browser when somebody pressed Analyse, so
 * the score history only moved on days a person remembered to. This agent reads every wired
 * Google Shopping feed ONCE and pushes three things off that one stream:
 *   · the scanFeed-shape snapshot (+ /volume ids, overlays, images) down the existing {xmlscan}
 *     lane — the Golden Score reading, identical to the 4x-daily agent's (XML feeds);
 *   · a gviz scan request ({goldenscan}) for the sheet-backed Google feeds, which the worker
 *     scans itself as the cron sweep does;
 *   · the content-quality + AI-readiness reading ({goldenqual}), computed with labelguard's
 *     qualityStream — the ONE implementation /golden's Analyse button runs — under each brand's
 *     own scoring profile, which the worker hands back from {goldendaily}.
 * Everything it sends is AUTOMATIC: the worker never lets it replace a reading somebody took by
 * hand the same day (storeGoldenQuality for quality; histAdd's manual pin for the score).
 *
 * WHEN. GitHub cron speaks UTC and the UK moves between GMT and BST, so the workflow fires at
 * 08:00, 09:00 and 10:00 UTC and THIS script decides: it runs once the London clock has reached
 * 09:00 and today's run (London date) is not yet on the worker's ledger. In summer the 08:00 UTC
 * firing is 09:00 London; in winter the 09:00 one is; the later firings are the catch-up for a
 * delayed or failed run, and a finished run makes them no-ops. GOLDEN_FORCE=1 runs regardless.
 *
 * Auth: FCC_PUSH_KEY = the worker's GMAIL_PUSH_KEY (same secret as the xml-scan agent). Every
 * response is JSON-verified — the Access login page is an HTTP 200 text/html.
 * Run: node tools/golden_daily.mjs   (DRY=1 computes without pushing; SCAN_ONLY="Client|mkt")
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { xmlCollector, qualityStream } from '../cloudflare/feedspark-deck/src/labelguard.js';
const require = createRequire(import.meta.url);
const FA = require('../docs/feedlab_engine.js');
const OV = require('../docs/overlay_engine.js');
const IM = require('../docs/image_engine.js');

const HOST = process.env.FCC_HOST || 'feedspark.ray-vtt.workers.dev';
const KEY = process.env.FCC_PUSH_KEY || '';
const ONLY = (process.env.SCAN_ONLY || '').trim();
const FORCE = process.env.GOLDEN_FORCE === '1' || process.env.GOLDEN_FORCE === 'true';
const DRY = !!process.env.DRY;
const WORKER = process.env.WORKER_JS || new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url).pathname;
const AUD_CAP = 30000;                 // the page's own sample for the AI-readiness audit

// ---- the London clock: the date the tracker files the run under, and the hour that gates it
export function londonClock(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d || new Date());
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  return { day: g('year') + '-' + g('month') + '-' + g('day'), hour: parseInt(g('hour'), 10) % 24, minute: parseInt(g('minute'), 10) };
}
export const RUN_HOUR = 9;
// once a day, from 09:00 London: a finished run makes every later firing a no-op
export function shouldRun(clock, done, force) {
  if (force) return true;
  if (done) return false;
  return clock.hour >= RUN_HOUR;
}

// ---- every wired Google Shopping feed: XML ones stream here, sheet ones stream the public CSV
// export the worker's own feed proxy reads (Meta -fb feeds are not Golden Record feeds)
export function googleFeeds(src) {
  const block = /const DEFAULT_FEEDS = \{([\s\S]*?)\n\};/.exec(src)[1];
  const out = []; let client = null;
  for (const line of block.split('\n')) {
    const c = /^  (?:'([^']+)'|([A-Za-z][A-Za-z ]*?)): \{/.exec(line);
    if (c) client = c[1] || c[2];
    for (const m of line.matchAll(/'?([a-z0-9-]+)'?: \{ xml: '([^']+)' \}/g)) {
      if (client && !/-fb$/.test(m[1])) out.push({ client, mkt: m[1], kind: 'xml', url: m[2] });
    }
    for (const m of line.matchAll(/'?([a-z0-9-]+)'?: \{ id: '([^']+)', gid: '([^']*)' \}/g)) {
      if (client && !/-fb$/.test(m[1])) out.push({ client, mkt: m[1], kind: 'sheet', url: 'https://docs.google.com/spreadsheets/d/' + m[2] + '/export?format=csv&gid=' + (m[3] || '0') });
    }
  }
  return out;
}

// one feed, one stream: the guard snapshot (XML only — a sheet's score comes from the worker's
// own gviz scan) and the content-quality reading, side by side off the same rows
export async function readFeed(feed, profile, fetchImpl) {
  const f = fetchImpl || fetch;
  const qs = qualityStream({ FA, client: feed.client, market: feed.mkt, audCap: AUD_CAP,
    expected: (profile && profile.expected) || [], waived: (profile && profile.waived) || [] });
  const xml = feed.kind === 'xml';
  const col = xml ? xmlCollector({ client: feed.client, market: feed.mkt }) : null;
  const ovc = xml ? OV.overlayCollector({ client: feed.client, market: feed.mkt }) : null;
  const imc = xml ? IM.imageCollector({ client: feed.client, market: feed.mkt }) : null;
  const onRow = (r, h) => { if (col) { col.onRow(r, h); ovc.onRow(r, h); imc.onRow(r, h); } qs.onRow(r, h); };
  const res = await f(feed.url);
  if (!res.ok || !res.body) throw new Error('fetch-fail: HTTP ' + res.status);
  const dec = new TextDecoder();
  let parser = null;
  for await (const chunk of res.body) {
    const txt = dec.decode(chunk, { stream: true });
    if (!parser) parser = /^\s*</.test(txt) ? FA.createXmlParser(onRow) : FA.createParser(onRow);
    parser.push(txt);
  }
  if (!parser) throw new Error('empty feed');
  parser.push(dec.decode()); parser.end();
  const out = { quality: qs.finish() };
  if (col) {
    Object.assign(out, col.finish());          // snap + vol
    try { out.ovl = ovc.finish(); } catch (e) { out.ovl = null; }
    try { out.img = imc.finish(); } catch (e) { out.img = null; }
  }
  return out;
}

async function post(payload) {
  const r = await fetch('https://' + HOST + '/api/gmail/push', {
    method: 'POST', headers: { 'X-FCC-Push-Key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) throw new Error('non-JSON response (HTTP ' + r.status + ') — Access login page? check the bypass/key');
  const d = await r.json();
  if (!d.ok) throw new Error('push refused: ' + (d.error || JSON.stringify(d)));
  return d;
}

async function main() {
  if (!KEY && !DRY) {
    console.error('✗ FCC_PUSH_KEY not set — store the GMAIL_PUSH_KEY value as a GitHub secret named FCC_PUSH_KEY.');
    process.exit(2);
  }
  const clock = londonClock();
  let profiles = {};
  if (!DRY) {
    const st = await post({ goldendaily: { day: clock.day } });
    profiles = st.profiles || {};
    if (!shouldRun(clock, st.done, FORCE)) {
      console.log('· ' + clock.day + ' ' + String(clock.hour).padStart(2, '0') + ':' + String(clock.minute).padStart(2, '0') + ' London — '
        + (st.done ? 'today\'s run is already on the ledger (' + new Date(st.last.t).toISOString() + ')' : 'before 09:00 London') + '; nothing to do');
      return 0;
    }
  }
  let feeds = googleFeeds(readFileSync(WORKER, 'utf8'));
  if (ONLY) feeds = feeds.filter((f) => (f.client + '|' + f.mkt) === ONLY);
  console.log('· ' + clock.day + ' — daily Golden Record run over ' + feeds.length + ' Google Shopping feed(s)');

  const tally = { feeds: feeds.length, quality: 0, kept: 0, failed: 0 };
  let i = 0;
  const workers = Array.from({ length: 2 }, async () => {        // two at a time: each holds a 30k-row audit sample
    while (i < feeds.length) {
      const f = feeds[i++];
      const tag = f.client + ' ' + f.mkt;
      try {
        const got = await readFeed(f, profiles[f.client]);
        if (DRY) { console.log('✓ ' + tag + ' — ' + got.quality.rows + ' rows · AI ' + (got.quality.ai ? got.quality.ai.total : '—') + ' (dry)'); tally.quality++; continue; }
        // the Golden Score reading first: the XML snapshot down the scan lane, a sheet's gviz scan
        if (f.kind === 'xml') {
          const d = await post({ xmlscan: [{ client: f.client, mkt: f.mkt, snap: got.snap, vol: got.vol, ovl: got.ovl, img: got.img }] });
          const r0 = (d.results || [])[0] || {};
          if (r0.error) console.log('  ~ ' + tag + ' score push: ' + r0.error);
          else if (r0.retry) console.log('  ~ ' + tag + ' score held (a big change waits for the next agreeing read)');
        } else {
          const d = await post({ goldenscan: [{ client: f.client, mkt: f.mkt }] });
          const r0 = (d.results || [])[0] || {};
          if (r0.error) console.log('  ~ ' + tag + ' gviz scan: ' + r0.error);
        }
        const q = await post({ goldenqual: [{ client: f.client, mkt: f.mkt, snap: got.quality }] });
        const r1 = (q.results || [])[0] || {};
        if (r1.error) { tally.failed++; console.log('✗ ' + tag + ' — quality refused: ' + r1.error); continue; }
        if (r1.skipped) { tally.kept++; console.log('= ' + tag + ' — ' + r1.skipped); continue; }
        tally.quality++;
        console.log('✓ ' + tag + ' — ' + got.quality.rows + ' rows · content quality ' + (r1.score == null ? '—' : r1.score)
          + ' · AI-readiness ' + (got.quality.ai ? got.quality.ai.total : '—'));
      } catch (e) {
        tally.failed++;
        console.log('✗ ' + tag + ' — ' + String((e && e.message) || e).slice(0, 120));
      }
    }
  });
  await Promise.all(workers);
  if (DRY) { console.log('\nDRY — nothing pushed.'); return 0; }
  // the ledger: a partial single-feed run (SCAN_ONLY) never marks the day done
  if (!ONLY) await post({ goldendaily: { day: clock.day, finish: true, feeds: tally.feeds, quality: tally.quality,
    kept: tally.kept, failed: tally.failed, by: FORCE ? 'dispatch' : 'schedule' } });
  console.log('\n✓ daily run complete — ' + tally.quality + ' analysed · ' + tally.kept + ' kept a hand-run reading · ' + tally.failed + ' failed');
  return tally.failed && tally.failed === tally.feeds ? 1 : 0;
}

// run only when executed, never when a harness imports the helpers above
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code), (e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
}
