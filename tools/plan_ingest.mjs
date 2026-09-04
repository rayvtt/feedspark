#!/usr/bin/env node
/*
 * Plan ingest — file rows into a client's Project Plan sheet through the LIVE worker,
 * from CI (no browser, no Access login): the same service-token lane as estate_rescan.mjs.
 *
 * Usage: INGEST_FILE=ops/ingest/<batch>.json node tools/plan_ingest.mjs
 * The batch file is self-contained: { "client", "id" (sheet id), "tab"?, "rows": [{task, owner?, status?, due?}] }
 *
 * Writes go through POST /api/sheets/append — the exact write the Workflow's "+ Add task"
 * uses, which SKIPS rows whose task text is already in the tab (normalised match), so
 * re-dispatching this workflow can never double-append a batch.
 *
 * Auth: env FCC_ACCESS_CLIENT_ID / FCC_ACCESS_CLIENT_SECRET (Access service token).
 * IMPORTANT: Access serves its login page as HTTP 200 text/html — a 200 is NOT success;
 * every response is JSON-verified, HTML means the token is missing/not allowed -> hard fail.
 */
import { readFileSync } from 'node:fs';

const HOST = process.env.FCC_HOST || 'feedspark.ray-vtt.workers.dev';
const ID = process.env.FCC_ACCESS_CLIENT_ID || '';
const SECRET = process.env.FCC_ACCESS_CLIENT_SECRET || '';
const FILE = process.env.INGEST_FILE || '';

if (!ID || !SECRET) {
  console.error('✗ FCC_ACCESS_CLIENT_ID / FCC_ACCESS_CLIENT_SECRET not set.');
  console.error('  Mint a service token in Cloudflare Zero Trust (Access -> Service Auth),');
  console.error('  include it in the FCC Access app policy, and store both values as GitHub secrets.');
  process.exit(2);
}
if (!FILE) { console.error('✗ INGEST_FILE not set — point it at an ops/ingest/*.json batch file.'); process.exit(2); }

const batch = JSON.parse(readFileSync(FILE, 'utf8'));
const rows = (batch.rows || []).filter((r) => r && r.task);
if (!batch.id || !rows.length) { console.error('✗ batch file needs "id" (sheet id) and non-empty "rows".'); process.exit(2); }

const r = await fetch('https://' + HOST + '/api/sheets/append', {
  method: 'POST',
  headers: { 'CF-Access-Client-Id': ID, 'CF-Access-Client-Secret': SECRET, 'content-type': 'application/json' },
  body: JSON.stringify({ id: batch.id, tab: batch.tab || 'Project Plan', rows }),
});
const text = await r.text();
const ct = r.headers.get('content-type') || '';
if (!/json/i.test(ct)) {
  console.error('✗ non-JSON response (HTTP ' + r.status + ', ' + ct.split(';')[0] + ') — the Access login page, not the worker. Fix the service token.');
  process.exit(1);
}
let d; try { d = JSON.parse(text); } catch (e) { console.error('✗ bad JSON from the worker'); process.exit(1); }
if (!d.ok) { console.error('✗ append failed: ' + (d.error || JSON.stringify(d))); process.exit(1); }
console.log('✓ ' + (batch.client || batch.id) + ': appended ' + d.appended + ' row(s)'
  + (d.skipped ? ' · skipped ' + d.skipped + ' already in the plan' : '')
  + (d.atRow ? ' · from row ' + d.atRow : '') + ' · tab "' + d.tab + '"');
