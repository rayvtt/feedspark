#!/usr/bin/env node
/*
 * Build docs/reports_hours.json from FeedSpark-reports task pulls, and splice window.FSHOURS
 * into the pages that render it.
 *
 * WHY A BAKE AND NOT A LIVE CALL. The reports database reaches this repo through an MCP server
 * that only a Claude session can call — the Cloudflare worker has no route to it and no
 * credential for it. So the ingest is the same shape as the ATRT tracker and the scheduled-work
 * snapshot: a session pulls, this tool aggregates, and the committed JSON is the record. The
 * page always says which date it is reading, because a snapshot that silently ages is worse
 * than no snapshot.
 *
 * Refresh:
 *   1. in a session, per market:  get_task_list_for_client(client_id, limit 700+)
 *      Oversized results are written to disk by the harness — that is the intended path, and
 *      the reason a 12-month estate pull costs almost nothing to ingest.
 *   2. node tools/build_report_hours.mjs --pulls <dir> --clients <clients.json> --months 12
 *
 * The pull is NEWEST-FIRST and capped by `limit`, so a busy market needs a limit deep enough to
 * reach the window's start. This tool REFUSES to write a client whose deepest pull starts after
 * the window opens, rather than quietly reporting a partial year as a full one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, classifyTask, CATS } from './reporthours.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'reports_hours.json');
const PAGES = ['FeedSpark_Command_Center.html'];

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

function monthsAgo(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (n - 1));
  return d.toISOString().slice(0, 10);
}

function main() {
  const pullDir = arg('pulls', '');
  const clientsFile = arg('clients', '');
  const months = Number(arg('months', 12));
  if (!pullDir || !clientsFile) {
    console.error('usage: build_report_hours.mjs --pulls <dir> --clients <clients.json> [--months 12]');
    process.exit(2);
  }
  const from = monthsAgo(months);
  const to = new Date().toISOString().slice(0, 10);

  // market_id -> {client, country} from the roster pull
  const roster = {};
  JSON.parse(fs.readFileSync(clientsFile, 'utf8')).forEach((r) => {
    roster[r.client_id] = {
      client: r.client_name, market: r.country || String(r.client_id),
      allowance: Number(r.allowance) || 0, used: Number(r.used_hours) || 0,
      am: r.primary_am || '',
    };
  });

  // Gather every pull, newest file per market wins (a re-pull with a deeper limit supersedes).
  const files = fs.readdirSync(pullDir).filter((f) => /get_task_list_for_client.*\.txt$/.test(f))
    .map((f) => path.join(pullDir, f));
  const byMarket = new Map();
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    if (!d || !Array.isArray(d.rows) || !d.rows.length) continue;
    const cid = d.rows[0].raw && d.rows[0].raw.client_id;
    if (!cid) continue;
    const prev = byMarket.get(cid);
    if (!prev || d.rows.length > prev.rows.length) byMarket.set(cid, d);
  }

  const perClient = new Map();
  const coverage = [];
  for (const [cid, d] of byMarket) {
    const meta = roster[cid];
    if (!meta) { coverage.push({ cid, note: 'not in roster — skipped' }); continue; }
    const rows = d.rows.map((r) => ({
      title: r.title, created_on: r.created_on, status: r.status, owner: r.owner,
      market: meta.market,
      bill: Number(r.raw && r.raw.time_taken) || 0,
      nonbill: Number(r.raw && r.raw.time_taken_nonbill) || 0,
    }));
    // how deep does this pull actually reach? a capped pull that stops inside the window would
    // report a partial year as a whole one
    const dated = rows.map((r) => String(r.created_on || '').slice(0, 10))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && s.slice(0, 4) !== '0000').sort();
    const deepest = dated[0] || '';
    const full = !d.truncated || (deepest && deepest <= from);
    coverage.push({ cid, client: meta.client, market: meta.market, rows: rows.length,
      total: d.total_count, deepest, full });
    if (!full) {
      console.warn(`  ! ${meta.client} ${meta.market}: pull only reaches ${deepest}, window opens ${from} — PARTIAL, excluded`);
      continue;
    }
    if (!perClient.has(meta.client)) perClient.set(meta.client, { rows: [], markets: [], am: meta.am });
    const p = perClient.get(meta.client);
    p.rows.push(...rows);
    p.markets.push({ m: meta.market, allowance: meta.allowance, used: meta.used });
  }

  const out = { at: new Date().toISOString().slice(0, 10), from, to, months, clients: {} };
  for (const [client, p] of perClient) {
    const a = aggregate(p.rows, { from, to });
    if (!a.tasks) continue;
    out.clients[client] = {
      am: p.am,
      markets: p.markets.sort((x, y) => (y.allowance - x.allowance) || x.m.localeCompare(y.m)),
      allowance: Math.round(p.markets.reduce((s, m) => s + m.allowance, 0) * 100) / 100,
      tasks: a.tasks, hours: a.hours, bill: a.bill, nonbill: a.nonbill,
      cats: a.cats, mix: a.mix, months: a.months,
      byMarket: a.markets, first: a.first, last: a.last,
      // the per-task table: every distinct piece of work with its hours. Capped at 40 rows —
      // past that it is a database export, not a one-pager — with the tail kept as one line so
      // the column still sums to the client's real total.
      top: a.taskRows.slice(0, 40),
      tail: (() => {
        const rest = a.taskRows.slice(40);
        if (!rest.length) return null;
        const h = rest.reduce((s, t) => s + t.h, 0);
        return { n: rest.length, h: Math.round(h * 100) / 100 };
      })(),
    };
  }
  out.coverage = coverage.sort((a, b) => String(a.client).localeCompare(String(b.client)));

  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`wrote ${path.relative(ROOT, OUT)}  |  ${Object.keys(out.clients).length} clients  |  window ${from} → ${to}  |  ${kb} KB`);
  for (const [c, v] of Object.entries(out.clients)) {
    console.log(`  ${c.padEnd(15)} ${String(v.tasks).padStart(5)} tasks  ${String(v.hours).padStart(8)} h   ` +
      CATS.map((k) => `${k} ${String(v.mix[k]).padStart(5)}%`).join('  '));
  }
  splice(out);
}

function splice(out) {
  const payload = 'window.FSHOURS=' + JSON.stringify(out) + ';';
  const block = '<!-- HOURS:START -->\n<script>' + payload + '</script>\n<!-- HOURS:END -->';
  for (const fn of PAGES) {
    const p = path.join(ROOT, 'docs', fn);
    if (!fs.existsSync(p)) continue;
    const doc = fs.readFileSync(p, 'utf8');
    if (doc.indexOf('<!-- HOURS:START -->') < 0) { console.log(`  (${fn}: HOURS markers not found; skipped)`); continue; }
    const next = doc.replace(/<!-- HOURS:START -->[\s\S]*?<!-- HOURS:END -->/, () => block);
    fs.writeFileSync(p, next);
    console.log(`  spliced window.FSHOURS into ${fn} (${Math.round(payload.length / 1024)} KB)`);
  }
}

main();
