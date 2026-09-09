#!/usr/bin/env node
/*
 * Column-E feed migration (Ray's workflow, 9 Sep 2026): the master feed sheet
 * (1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak, tab 1) gains column E
 * "Google Shopping URL" — the FeedHero-hosted XML for that feed. Ray fills the
 * column at his own pace; running this tool migrates DEFAULT_FEEDS in
 * cloudflare/feedspark-deck/src/worker.js to the XML source for every row
 * where column E holds a VERIFIED URL. Everything else is untouched.
 *
 * Safety model:
 *  - rows join to the wired map by SHEET ID (the Feed URL column), never by
 *    parsing client names — no guesswork, unknown ids are reported not wired
 *  - each column-E URL must pass the *.feedhero.net .xml allowlist AND a live
 *    first-bytes check (serves XML) before it is wired; failures are listed
 *    and skipped, never spliced
 *  - the splice is line-level, keyed on the sheet id, preserving indentation,
 *    market key and any trailing comment; already-migrated {xml} lines have no
 *    sheet id so they can never be touched or reverted by a re-run
 *  - a wired {xml} URL whose sheet row no longer carries it is REPORTED as a
 *    possible rollback, never auto-reverted
 *
 * Usage:  node tools/sync_feedmap.mjs            # report + splice worker.js
 *         DRY=1 node tools/sync_feedmap.mjs      # report only, no write
 * Tests override the inputs: FEEDMAP_CSV=<path> WORKER_JS=<path> SKIP_VERIFY=1
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SHEET = '1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak';
const WORKER = process.env.WORKER_JS || 'cloudflare/feedspark-deck/src/worker.js';
const XML_RE = /^https:\/\/[a-z0-9-]+\.feedhero\.net\/[^\s"'<>]+\.xml$/i;   // mirror worker xmlRef

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const sheetIdOf = (u) => { const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(String(u || '')); return m ? m[1] : null; };

let csv;
if (process.env.FEEDMAP_CSV) csv = readFileSync(process.env.FEEDMAP_CSV, 'utf8');
else {
  const r = await fetch('https://docs.google.com/spreadsheets/d/' + SHEET + '/export?format=csv&gid=0');
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !/csv|text\/plain/.test(ct)) { console.error('✗ master sheet fetch failed (HTTP ' + r.status + ', ' + ct.split(';')[0] + ') — is it link-shared?'); process.exit(1); }
  csv = await r.text();
}
const rows = parseCsv(csv);
const hdr = rows[0].map((h) => h.trim().toLowerCase());
const iName = hdr.findIndex((h) => /client/.test(h));
const iFeed = hdr.findIndex((h) => /^feed url/.test(h));
const iGsu = hdr.findIndex((h) => /google shopping url/.test(h));
if (iFeed < 0 || iGsu < 0) { console.error('✗ expected "Feed URL" + "Google Shopping URL" columns — got: ' + rows[0].join(' | ')); process.exit(1); }

const wanted = [];   // { name, sheetId, xml }
for (const r of rows.slice(1)) {
  const xml = (r[iGsu] || '').trim();
  if (!xml) continue;
  wanted.push({ name: (r[iName] || '').trim(), sheetId: sheetIdOf(r[iFeed]), xml });
}
if (!wanted.length) { console.log('· column E is empty on every row — nothing to migrate'); process.exit(0); }

let src = readFileSync(WORKER, 'utf8');
const problems = [], planned = [], already = [];
for (const w of wanted) {
  if (!XML_RE.test(w.xml)) { problems.push('✗ ' + w.name + ': column E is not an allowlisted feedhero .xml URL — ' + w.xml.slice(0, 90)); continue; }
  if (src.includes("xml: '" + w.xml + "'")) { already.push('= ' + w.name + ': already wired to this XML'); continue; }
  if (!w.sheetId) { problems.push('✗ ' + w.name + ': the Feed URL cell has no sheet id to join on'); continue; }
  const lineRe = new RegExp("^(\\s*)('?)([a-z0-9-]+)\\2(: \\{ )id: '" + w.sheetId + "', gid: '[^']*'( \\},?)(.*)$", 'm');
  const m = lineRe.exec(src);
  if (!m) { problems.push('✗ ' + w.name + ': sheet id ' + w.sheetId + ' is not in DEFAULT_FEEDS (not wired, or already migrated to a different URL) — wire by hand'); continue; }
  if (!process.env.SKIP_VERIFY) {
    try {
      const fr = await fetch(w.xml, { headers: { Range: 'bytes=0-400' } });
      const head = (await fr.text()).slice(0, 400);
      if (!fr.ok || !/^\s*<\?xml|<rss/i.test(head)) { problems.push('✗ ' + w.name + ': URL does not serve XML (HTTP ' + fr.status + ') — skipped'); continue; }
    } catch (e) { problems.push('✗ ' + w.name + ': URL fetch failed (' + (e && e.message) + ') — skipped'); continue; }
  }
  planned.push({ w, m });
}
// rollback watch: wired {xml} URLs that no longer appear in column E
const wiredXml = [...src.matchAll(/xml: '([^']+)'/g)].map((m) => m[1]);
const colE = new Set(wanted.map((w) => w.xml));
for (const u of wiredXml) if (!colE.has(u)) problems.push('⚠ wired XML no longer in column E (possible rollback — not auto-reverted): ' + u.slice(0, 100));

for (const { w, m } of planned) {
  const line = m[1] + m[2] + m[3] + m[2] + m[4] + "xml: '" + w.xml + "'" + m[5] + m[6]
    + (m[6].trim() ? '' : '   // col-E migration (' + new Date().toISOString().slice(0, 10) + ')');
  src = src.replace(m[0], line);
  console.log('✓ ' + w.name + ' → ' + w.xml.slice(0, 100));
}
already.forEach((s) => console.log(s));
problems.forEach((s) => console.log(s));
if (planned.length && !process.env.DRY) { writeFileSync(WORKER, src); console.log('\n' + planned.length + ' feed(s) migrated in ' + WORKER + ' — run the validators + tests, then ship.'); }
else if (planned.length) console.log('\nDRY run — ' + planned.length + ' feed(s) would migrate.');
else console.log('\nnothing new to migrate.');
process.exit(problems.some((p) => p.startsWith('✗')) ? 2 : 0);
