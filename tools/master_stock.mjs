#!/usr/bin/env node
/*
 * MASTER STOCK — each roster market's MASTER FEED counted by availability (Ray, 30 Sep 2026: "In the stock
 * management module, bring in the availability ratio between master feed and output feeds as well.
 * (instock & outofstock)").
 *
 * /stock already knew what the stock RULES say; what it could not show is what they DO — the client sends
 * a catalogue that is, say, 40% in stock and FeedSpark's output feed goes to Google 100% in stock. The
 * output half is counted on the 4x-daily xml-scan stream (labelguard.js › availBucket, index `feedavail`);
 * this agent is the other half: the master as the client sent it — FeedHero's own latest import.
 *
 * For every company on the ROAS roster (src/roas.js — the ONLY scope /stock reads) it asks the worker for
 * that company's master ({masterfile: cmpid} on /api/gmail/push — the key-gated lane the other agents use).
 * The worker resolves the file with the Catalogue's catMasterInfo (FeedHero's master_feed tool) and streams
 * it back untouched, so FeedHero's backup URL never leaves the server — or answers `unchanged` when the
 * stored reading is already of this import, which makes a re-run cheap. The file is unzipped, decoded
 * (UTF-8, falling back to Windows-1252 as Schuh's master needs), sniffed (XML / TSV / CSV …) and parsed with
 * the Catalogue's own readers, and every row is counted by docs/catalog_engine.js › stockTally: the
 * availability word first, the quantity only where a row states no word, neither = "not stated" — never a
 * guess. The counts go back as {masterstock:[…]} into ONE index, `masteravail` (cmpid → counts). Only
 * counts leave this process: no row, id or URL is pushed, printed or kept.
 *
 * HERO SIZES (Ray, 30 Sep 2026: "bring in hero size mapping per brand … breakdown by their product type"): the
 * SAME pass builds each master's SIZE CENSUS (docs/herosize_engine.js › census) — per product type, every size it
 * is made in with rows + in stock, and each style's size run as a pattern of in / out / not made — posted per
 * market as {mastersize:[…]} into KV mastersize:<cmpid>. Counts and size names only, like the tally. The stock
 * counts never wait on it: a census the worker refuses is logged and the next run builds it again (the tally
 * carries `szv` only when its census was stored, and the worker answers `unchanged` only when both are current).
 *
 *
 * PRODUCT-TYPE TIERS (Ray, 30 Sep 2026: "can you allow tier 2, tier 3 of PT to be chosen too ? sometimes no need too much
 * granulartiy"): a master names its types its own way, so before each master the agent streams that market's GOOGLE
 * SHOPPING feed (the wired FeedHero XML, the one the xml-scan agent reads) into a product_type index (herosize_engine ›
 * treeIndex — each product's g:product_type path by id and by style, paths only) and the census places every master row on
 * the feed's own tree. A market with no Google feed wired, or one whose feed cannot be read, falls back to the master's own
 * types and says so (census src 'master'); the stock counts never wait on it.
 *
 * Runs from .github/workflows/master-stock.yml. Auth: FCC_PUSH_KEY (= the worker's GMAIL_PUSH_KEY, the
 * xml-scan secret). Every response is checked for JSON / octet-stream — the Access login page is an HTTP
 * 200 text/html. Run: node tools/master_stock.mjs
 *   ONLY=<cmpid>        one company       FORCE=1  re-read even an unchanged import
 *   MASTER_FILE=<path>  count a local master file and print the tally (no worker, nothing pushed)
 *   FEED_FILE=<path>    … placed on a local copy of its Google Shopping feed's product_type tree
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { rosterList } from '../cloudflare/feedspark-deck/src/roas.js';
import { feedKeys } from '../cloudflare/feedspark-deck/src/rules.js';
const require = createRequire(import.meta.url);
const FA = require('../docs/feedlab_engine.js');
const E = require('../docs/catalog_engine.js');
const H = require('../docs/herosize_engine.js');

const HOST = process.env.FCC_HOST || 'feedspark.ray-vtt.workers.dev';
const KEY = process.env.FCC_PUSH_KEY || '';
const ONLY = (process.env.ONLY || '').trim().toLowerCase();
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';
const WORKER = process.env.WORKER_JS || new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url).pathname;
const BATCH = 8;              // tallies per {masterstock} post
const FEED_TIMEOUT = 240000;  // one Google feed read, start to finish
const CHUNK = 1 << 20;        // bytes decoded per step — the text is never held as one string

// the one file worth reading: a FeedHero backup is a zip holding one CSV / TSV / XML (the largest entry)
export function masterBytes(u8) {
  if (!E.isZip(u8)) return { name: '', bytes: u8 };
  const ent = E.zipMain(E.zipEntries(u8) || []);
  if (!ent) throw new Error('the zip is empty');
  const data = E.zipData(u8, ent);
  if (!data) throw new Error('an unreadable zip entry');
  if (ent.method === 0) return { name: ent.name, bytes: data };
  if (ent.method !== 8) throw new Error('zip method ' + ent.method + ' is not supported');
  return { name: ent.name, bytes: new Uint8Array(inflateRawSync(data)) };
}

// every wired Google Shopping feed by FeedHero company id — DEFAULT_FEEDS read straight from the worker's source, the way
// tools/xml_scan.mjs reads it, and keyed by the company id in the output URL (src/rules.js › feedKeys, as /stock joins them)
export function googleFeeds(src) {
  const block = /const DEFAULT_FEEDS = \{([\s\S]*?)\n\};/.exec(src || readFileSync(WORKER, 'utf8'));
  if (!block) return {};
  const list = []; let client = null;
  for (const ln of block[1].split('\n')) {
    const c = /^  (?:'([^']+)'|([A-Za-z]+)): \{/.exec(ln);
    if (c) client = c[1] || c[2];
    for (const m of ln.matchAll(/'?([a-z0-9-]+)'?: \{ xml: '([^']+)' \}/g)) if (client) list.push({ client, mkt: m[1], url: m[2] });
  }
  const keys = feedKeys(list), out = {};
  Object.keys(keys).forEach((cmpid) => {
    const g = keys[cmpid].g; if (!g) return;
    const f = list.find((x) => x.client + '|' + x.mkt === g);
    if (f) out[cmpid] = f;
  });
  return out;
}
// a Google Shopping feed's text -> its product_type index (herosize_engine › treeIndex; paths only)
export function treeFromText(txt) {
  const ti = H.treeIndex(E), p = FA.createXmlParser((r, h) => ti.onRow(r, h));
  for (let o = 0; o < txt.length; o += CHUNK) p.push(txt.slice(o, o + CHUNK));
  p.end();
  return ti.finish();
}
// …streamed: a 120MB feed is never held as one string
async function readTree(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(FEED_TIMEOUT) });
  if (!r.ok || !r.body) throw new Error('feed fetch failed (HTTP ' + r.status + ')');
  const ti = H.treeIndex(E), p = FA.createXmlParser((row, h) => ti.onRow(row, h)), dec = new TextDecoder();
  for await (const chunk of r.body) p.push(dec.decode(chunk, { stream: true }));
  p.push(dec.decode()); p.end();
  return ti.finish();
}

// bytes -> the master's stock tally ({n, in, out, pre, none, other, via, col, qcol, ow} + fmt, enc) and, off the SAME
// rows, its size census (census — docs/herosize_engine.js), placed on the feed's product_type tree when one is given
export function tallyMaster(u8, tree) {
  const { bytes } = masterBytes(u8);
  const t = E.stockTally(), c = H.census(E, tree || null);
  const both = (r, h) => { t.onRow(r, h); c.onRow(r, h); };
  let dec = new TextDecoder('utf-8', { fatal: true }), enc = 'UTF-8', parser = null, fmt = '';
  for (let o = 0; o < bytes.length; o += CHUNK) {
    const part = bytes.subarray(o, Math.min(bytes.length, o + CHUNK));
    let s;
    // Schuh's master is Windows-1252: at the first byte that is not UTF-8 switch for the rest of the file
    try { s = dec.decode(part, { stream: true }); }
    catch (e) { dec = new TextDecoder('windows-1252'); enc = 'Windows-1252'; s = dec.decode(part, { stream: true }); }
    if (!parser) {
      s = s.replace(/^﻿/, '');
      if (!s.trim()) continue;
      const sn = E.sniff(s.slice(0, 20000));
      fmt = sn.fmt === 'xml' ? 'XML' : ({ '\t': 'TSV', ',': 'CSV', '|': 'pipe', ';': 'semicolon' }[sn.delim] || 'text');
      // delimParser's second argument is a row INDEX, not a header — stockTally reads the first row as the header
      parser = sn.fmt === 'xml' ? FA.createXmlParser((r, h) => both(r, h)) : E.delimParser(sn.delim, (r) => both(r), sn);
    }
    parser.push(s);
  }
  if (!parser) throw new Error('the master file is empty');
  const tail = dec.decode();
  if (tail) parser.push(tail);
  parser.end();
  return Object.assign(t.finish(), { fmt, enc, census: c.finish() });
}
// the census in one line — where its types came from, the tiers, sized rows, styles, and the biggest type's run
export function sizeLine(cs) {
  if (!cs || !cs.types) return 'no size census';
  const top = cs.types.filter((x) => x.sz.length)[0], tr = cs.tree, n0 = (v) => (v || 0).toLocaleString('en-GB');
  const placed = tr ? ' (by id ' + n0(tr.id) + ' · style ' + n0(tr.grp) + ' · master type ' + n0(tr.learn + tr.word) + ' · master only ' + n0(tr.own)
    + (tr.fold ? ' · ' + n0(tr.fold) + ' feed spellings read as one' : '') + ')' : '';
  return (cs.src === 'feed' ? 'the Google feed’s product types' + placed : 'the master’s own product types') + ' · tiers '
    + H.tiers(cs).map((x) => x.t + ':' + x.types).join(' ') + ' · ' + n0(cs.sized) + ' sized rows · ' + n0(cs.groups) + ' styles'
    + (top ? ' · biggest: ' + top.k + ' (' + top.sz.map((z) => z[0]).join(' ') + ')' : '');
}

async function post(body) {
  const r = await fetch('https://' + HOST + '/api/gmail/push', {
    method: 'POST', headers: { 'X-FCC-Push-Key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) throw new Error('non-JSON response (HTTP ' + r.status + ') — Access login page? check the bypass/key');
  const d = await r.json();
  if (!d.ok) throw new Error('push refused: ' + (d.error || JSON.stringify(d)));
  return d;
}

// one company's master through the worker: {bytes, file, imp} | {unchanged} | {preparing}
async function fetchMaster(cmpid) {
  const r = await fetch('https://' + HOST + '/api/gmail/push', {
    method: 'POST', headers: { 'X-FCC-Push-Key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ masterfile: cmpid, force: FORCE }),
  });
  const ct = r.headers.get('content-type') || '';
  if (/octet-stream/i.test(ct)) {
    return { bytes: new Uint8Array(await r.arrayBuffer()), file: r.headers.get('x-master-file') || '',
      imp: r.headers.get('x-master-import') || '', rows: +(r.headers.get('x-master-rows') || 0) || null };
  }
  if (!/json/i.test(ct)) throw new Error('non-JSON response (HTTP ' + r.status + ') — Access login page? check the bypass/key');
  const d = await r.json();
  if (d.unchanged) return { unchanged: true, imp: d.imp || '' };
  if (d.state === 'preparing') return { preparing: true, note: String(d.note || '') };
  throw new Error(String(d.error || d.state || ('HTTP ' + r.status)).slice(0, 140));
}

const pct = (a, n) => (n ? Math.round((a / n) * 1000) / 10 + '%' : '—');
export function line(tag, t) {
  return tag + ' — ' + t.n.toLocaleString('en-GB') + ' rows · ' + pct(t.in, t.n) + ' in stock · ' + pct(t.out, t.n) + ' out'
    + (t.pre ? ' · ' + t.pre + ' pre/backorder' : '') + (t.none ? ' · ' + t.none + ' not stated' : '') + (t.other ? ' · ' + t.other + ' unread word' : '')
    + ' (via ' + t.via + ', ' + t.fmt + (t.enc !== 'UTF-8' ? ', ' + t.enc : '') + ')';
}

async function main() {
  if (process.env.MASTER_FILE) {
    const tree = process.env.FEED_FILE ? treeFromText(readFileSync(process.env.FEED_FILE, 'utf8')) : null;
    if (tree) console.log('  feed — ' + tree.n.toLocaleString('en-GB') + ' products · ' + tree.paths + ' product_type paths');
    const t = tallyMaster(new Uint8Array(readFileSync(process.env.MASTER_FILE)), tree);
    console.log(line(process.env.MASTER_FILE.split('/').pop(), t));
    console.log('  sizes — ' + sizeLine(t.census));
    return 0;
  }
  if (!KEY) { console.error('✗ FCC_PUSH_KEY not set — store the GMAIL_PUSH_KEY value as a GitHub secret named FCC_PUSH_KEY.'); return 2; }
  let list = rosterList();
  if (ONLY) list = list.filter((m) => m.cmpid === ONLY);
  const feeds = googleFeeds();
  console.log('· ' + list.length + ' roster market(s) — reading each master feed' + (FORCE ? ' (forced)' : '') + ' · '
    + list.filter((m) => feeds[m.cmpid]).length + ' with a Google Shopping feed for the product-type tree');
  const done = [], tally = { read: 0, same: 0, prep: 0, failed: 0, sized: 0 }, later = [];
  const readOne = async (m, last) => {
    const tag = m.client + ' ' + m.market;
    try {
      const got = await fetchMaster(m.cmpid);
      if (got.unchanged) { tally.same++; console.log('= ' + tag + ' — import unchanged since the last reading'); return; }
      if (got.preparing) {
        if (last) { tally.prep++; console.log('~ ' + tag + ' — FeedHero is still reading this master; next run'); }
        else later.push(m);
        return;
      }
      // the market's Google Shopping feed first, for its product_type tree — never a reason to skip the master
      let tree = null;
      if (feeds[m.cmpid]) {
        try { tree = await readTree(feeds[m.cmpid].url); }
        catch (e) { console.log('~ ' + tag + ' — Google feed not read (' + String((e && e.message) || e).slice(0, 100) + '); types from the master'); }
      }
      const t = tallyMaster(got.bytes, tree);
      if (!t.n) throw new Error('no rows read');
      // the size census goes first and on its own (one market per post — a census runs to tens of KB); a refusal is
      // logged and never costs the stock counts
      let sz = null;
      try {
        const r = await post({ mastersize: [{ cmpid: m.cmpid, imp: got.imp, census: t.census }] });
        const one = (r.results || [])[0] || {};
        if (one.ok) { sz = { types: t.census.types.length, sized: t.census.sized, groups: t.census.groups }; tally.sized++; }
        else console.log('✗ size census refused  ' + tag + ' — ' + (one.error || 'no reason given'));
      } catch (e) { console.log('✗ size census not stored  ' + tag + ' — ' + String((e && e.message) || e).slice(0, 140)); }
      done.push({ cmpid: m.cmpid, n: t.n, in: t.in, out: t.out, pre: t.pre, none: t.none, other: t.other,
        via: t.via, col: t.col, qcol: t.qcol, ow: t.ow, fmt: t.fmt, enc: t.enc, imp: got.imp, rows: got.rows,
        szv: sz ? H.CENSUS_V : 0, sz });
      tally.read++;
      console.log('✓ ' + line(tag, t) + '\n    sizes — ' + sizeLine(t.census));
    } catch (e) {
      tally.failed++;
      console.log('✗ ' + tag + ' — ' + String((e && e.message) || e).slice(0, 140));
    }
  };
  let i = 0;
  await Promise.all(Array.from({ length: 2 }, async () => { while (i < list.length) await readOne(list[i++], false); }));
  if (later.length) {
    // FeedHero's FIRST read of a big master downloads the import and outlasts one request — ask once more
    console.log('· ' + later.length + ' master(s) still being prepared by FeedHero — asking again in 60s');
    await new Promise((r) => setTimeout(r, 60000));
    for (const m of later) await readOne(m, true);
  }
  let stored = 0;
  for (let b = 0; b < done.length; b += BATCH) {
    const d = await post({ masterstock: done.slice(b, b + BATCH) });
    (d.results || []).forEach((r) => { if (r.ok) stored++; else console.log('✗ rejected  ' + r.cmpid + ' — ' + r.error); });
  }
  console.log('\n✓ master stock — ' + stored + ' stored · ' + tally.sized + ' size censuses · ' + tally.same + ' unchanged · ' + tally.prep + ' still preparing · ' + tally.failed + ' failed');
  return tally.failed && !stored && !tally.same ? 1 : 0;
}

// run only when executed, never when a harness imports the helpers above
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code), (e) => { console.error('✗ ' + ((e && e.message) || e)); process.exit(1); });
}
