// Task Manager integration harness (pure node, CI-safe). SOURCE = the feedspark-reports MCP
// (get_client_list). Pins the shared normaliser (per-brand rollup of allowance / used / balance,
// health, hours + date formats), the worker's store + scoped read (KV is the only home of the
// figures — no client hours are committed to git), and the Leadership override precedence.
// The automatic pull itself is pinned by tools/test_tmmcp.mjs.
import fs from 'node:fs';
import * as TM from '../cloudflare/feedspark-deck/src/tmparse.js';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js'), LEAD = read('docs/FeedSpark_Leadership.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };

console.log('· normaliser — per-brand rollup of the MCP client list');
const rows = [
  { client_name: 'Reiss', group_name: 'Reiss', country: 'GB', primary_am: 'Ray', market_flag: 0, allowance: 35, used_hours: 38.25, balance: -36.75, balance_health: 'negative' },
  { client_name: 'Reiss', group_name: 'Reiss', country: 'DE', primary_am: 'Ray', market_flag: 0, allowance: 8, used_hours: 7.5, balance: -0.25, balance_health: 'negative' },
  { client_name: 'Reiss', group_name: 'Reiss', country: 'US', primary_am: 'Ray', market_flag: 0, allowance: 8, used_hours: 5.75, balance: 2.25, balance_health: 'warning' },
  { client_name: 'Reiss', group_name: 'Reiss', country: 'XX', primary_am: 'Ray', market_flag: 1, allowance: 99, used_hours: 99, balance: 0, balance_health: 'zero' },
  { client_name: 'YuMove', group_name: 'YuMove', country: 'GB', primary_am: 'Ray', market_flag: 0, allowance: 18, used_hours: 8.25, balance: 16.5, balance_health: 'healthy' },
];
const by = TM.aggregateClientList(rows);
t('markets roll up per brand: Reiss block 51h, used 51.5h, balance -34.75h', by.Reiss.allowance === 51 && by.Reiss.used === 51.5 && by.Reiss.balance === -34.75);
t('a stopped market (flag 1) is excluded by default', by.Reiss.marketCount === 3);
t('brand health is the worst market (negative beats warning)', by.Reiss.health === 'negative' && by.YuMove.health === 'healthy');
t('markets are ordered by hours used, most first', by.Reiss.markets[0].market === 'GB');
t('"YuMove" and "YuMOVE" share a brand key', TM.brandKey('YuMove') === TM.brandKey('YuMOVE'));
console.log('· normaliser — hours + dates (for a task list)');
t('4 / 4.5 / 4:30 / "2h 30m" / 90m / 1,234', TM.parseHours('4') === 4 && TM.parseHours('4.5') === 4.5 && TM.parseHours('4:30') === 4.5 && TM.parseHours('2h 30m') === 2.5 && TM.parseHours('90m') === 1.5 && TM.parseHours('1,234') === 1234);
t('SQL datetime / UK / ISO / "Sep 2026" / "16 Sep 2026" → YYYY-MM', TM.monthKey('2026-09-16 10:54:00') === '2026-09' && TM.monthKey('16/09/2026') === '2026-09' && TM.monthKey('2026-09-16') === '2026-09' && TM.monthKey('Sep 2026') === '2026-09' && TM.monthKey('16 Sep 2026') === '2026-09');
const tk = TM.aggregateTasks([{ date: '2026-09-03 09:00:00', hours: '4.5', detail: 'Titles', owner: 'Steven' }, { date: '2026-09-10', hours: '2h 30m', detail: 'Keywords' }], 'Reiss');
t('a task list buckets per month with summed hours', tk.months['2026-09'] && tk.months['2026-09'].hours === 7);

console.log('· no client hours in git');
t('no committed hours snapshot, seed or seed builder — the figures live in KV only', !fs.existsSync(new URL('../ops/tm', import.meta.url)) && !fs.existsSync(new URL('../docs/tm_seed.json', import.meta.url)) && !fs.existsSync(new URL('../tools/tm_build_seed.mjs', import.meta.url)) && !/TM_SEED/.test(WK));

console.log('· worker');
t('the tmpush branch stores tm:<client> (allowance / used / balance / markets) + a tmidx rollup', /Array\.isArray\(body\.tmpush\)/.test(WK) && /'tm:' \+ client/.test(WK) && /allowance: rec\.allowance, used: rec\.used, balance: rec\.balance/.test(WK) && /env\.EDITS\.put\('tmidx'/.test(WK));
t('rejects a client name that could poison a KV key', /error: 'bad client'/.test(WK) && /client\.indexOf\(':'\) >= 0 \|\| client\.indexOf\('\|'\) >= 0/.test(WK));
t("GET /api/tm reads KV only and says 'none' until the first sync lands", /const src = Object\.keys\(idx\)\.length \? 'live' : 'none';/.test(WK) && /source: src, status/.test(WK));
t('GET /api/tm is scoped per signin (owner = whole book; a scoped signin only their clients)', /path === '\/api\/tm' && request\.method === 'GET'/.test(WK) && /clientMatch\(c, name\)/.test(WK) && /out of scope/.test(WK));
t('the push rides the SAME key + Access bypass as the feed scan (no new Zero Trust config)', WK.indexOf("path === '/api/gmail/push'") < WK.indexOf('Array.isArray(body.tmpush)'));

console.log('· Leadership mapping');
t('block ← allowance and used ← used_hours from /api/tm', /fetch\('\/api\/tm'\)/.test(LEAD) && /cm\[b\]\.hours=row\.allowance; cm\[b\]\.hoursTM=true/.test(LEAD) && /cm\[b\]\.used=row\.used; cm\[b\]\.usedTM=true/.test(LEAD));
t('a hand-set block or used-hours always wins (nothing invented), and an edit clears the TM flag', /!hadHours\[b\]/.test(LEAD) && /!hadUsed\[b\]/.test(LEAD) && /if\(f==='hours'\)\{cm\[b\]\.hoursTM=false/.test(LEAD) && /if\(f==='used'\)\{cm\[b\]\.usedTM=false/.test(LEAD));
t('TM provenance chip on both figures + the balance readout', /class="tm-chip"/.test(LEAD) && /field==='hours'&&cm\[b\]\.hoursTM/.test(LEAD) && /class="tm-bal/.test(LEAD));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
