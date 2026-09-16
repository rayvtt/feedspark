/*
 * Task Manager normaliser (Ray, 16 Sep 2026: "connect to FS's Task Manager which has an hours
 * report on every task and map it back into our system"). SOURCE = the team's custom connector
 * MCP `feedspark-reports` (get_client_list / get_task_list_for_client) — NOT an HTML scrape.
 *
 * PURE + dependency-free (an ES module like the worker's other src/ modules) so the worker's
 * cron pull (worker.js › tmPull) and the harnesses (tools/test_tm.mjs, tools/test_tmmcp.mjs) run
 * the SAME code. get_client_list returns one row per client x market
 * from sh_merchants with the hours already computed — allowance (the monthly retainer block),
 * used_hours (this billing cycle), balance (remaining, incl. carried) and balance_health.
 * aggregateClientList rolls those markets up per BRAND, which is the grain the FCC's Leadership
 * "Hours & commercial" section works in (one block, one used per brand). The worker only STORES
 * this rollup; the page reads it.
 */

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function num(v) { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
function r2(n) { return Math.round(n * 100) / 100; }
function brandKey(s) { return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }   // "YuMove" == "YuMOVE"

// hours cell → number (kept for a task list that reports "4h", "2h 30m", "4:30", "90m").
function parseHours(v) {
  const s = norm(v).toLowerCase(); if (!s) return null;
  let m = /^(\d+)\s*:\s*(\d{1,2})$/.exec(s); if (m) return r2(+m[1] + (+m[2]) / 60);
  let h = 0, hit = false;
  m = /(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/.exec(s); if (m) { h += +m[1]; hit = true; }
  const mm = /(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?|ins?)?\b/.exec(s); if (mm) { h += (+mm[1]) / 60; hit = true; }
  if (hit) return r2(h);
  const n = parseFloat(s.replace(/,/g, '')); return isNaN(n) ? null : n;
}

// a date-ish value → 'YYYY-MM' (ISO, UK DD/MM/YYYY, "Sep 2026", "16 Sep 2026", or a SQL datetime).
const MONS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function monthKey(v) {
  const s = norm(v); if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})/.exec(s); if (m) return m[1] + '-' + String(+m[2]).padStart(2, '0');
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s); if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + String(+m[2]).padStart(2, '0'); }
  m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2,4})\b/.exec(s); if (m && MONS[m[2].slice(0, 3).toLowerCase()]) { let y = +m[3]; if (y < 100) y += 2000; return y + '-' + String(MONS[m[2].slice(0, 3).toLowerCase()]).padStart(2, '0'); }
  m = /\b([A-Za-z]{3,9})\.?\s*'?(\d{2,4})\b/.exec(s); if (m && MONS[m[1].slice(0, 3).toLowerCase()]) { let y = +m[2]; if (y < 100) y += 2000; return y + '-' + String(MONS[m[1].slice(0, 3).toLowerCase()]).padStart(2, '0'); }
  return null;
}

// worst-first health across a brand's markets (drives the Leadership pill / dossier band)
const HEALTH_RANK = { negative: 4, warning: 3, zero: 1, no_allowance: 1, healthy: 2 };
function worstHealth(list) { let best = null, r = -1; list.forEach((h) => { const k = HEALTH_RANK[h] || 0; if (k > r) { r = k; best = h; } }); return best; }

// get_client_list rows → per-brand rollup. Only live markets (market_flag 0/2) unless includeAll.
function aggregateClientList(rows, opts) {
  opts = opts || {};
  const by = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (!row) return;
    if (!opts.includeAll && row.market_flag != null && !(row.market_flag === 0 || row.market_flag === 2)) return;
    const brand = norm(row.client_name || row.group_name); if (!brand) return;
    const b = by[brand] || (by[brand] = { client: brand, group: norm(row.group_name), am: norm(row.primary_am), allowance: 0, used: 0, balance: 0, current: 0, carried: 0, markets: [] });
    const allowance = num(row.allowance), used = num(row.used_hours), balance = num(row.balance);
    b.allowance += allowance; b.used += used; b.balance += balance; b.current += num(row.current_hours); b.carried += num(row.carried_hours);
    b.markets.push({ market: norm(row.country || row.market_name), allowance: r2(allowance), used: r2(used), balance: r2(balance), health: norm(row.balance_health) || null });
  });
  Object.values(by).forEach((b) => {
    b.allowance = r2(b.allowance); b.used = r2(b.used); b.balance = r2(b.balance); b.current = r2(b.current); b.carried = r2(b.carried);
    b.marketCount = b.markets.length;
    b.health = worstHealth(b.markets.map((m) => m.health).filter(Boolean));
    b.markets.sort((a, c) => c.used - a.used);
  });
  return by;
}

// a get_task_list_for_client response → per client x month hours (for a future task breakdown).
function aggregateTasks(rows, client) {
  const months = {};
  (Array.isArray(rows) ? rows : []).forEach((t) => {
    if (!t) return;
    const mo = monthKey(t.date || t.created || t.completed) || 'undated';
    const hours = parseHours(t.hours != null ? t.hours : t.time);
    const m = months[mo] || (months[mo] = { hours: 0, tasks: [] });
    if (hours != null) m.hours += hours;
    if (m.tasks.length < 300) m.tasks.push({ task: norm(t.detail || t.task || t.description || t.title).slice(0, 200), hours, owner: norm(t.owner || t.staff), status: norm(t.status) });
  });
  Object.values(months).forEach((m) => { m.hours = r2(m.hours); });
  return { client: norm(client), months };
}

export { norm, num, r2, brandKey, parseHours, monthKey, worstHealth, aggregateClientList, aggregateTasks };
