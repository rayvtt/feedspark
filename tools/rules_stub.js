// A small SYNTHETIC set of FeedHero rule_report rows, pushed through the REAL engine
// (cloudflare/feedspark-deck/src/rules.js) into the three shapes the worker serves — GET /api/rules,
// GET /api/rules?client=&market=, GET /api/rules/stock — for the browser tripwires (check_mobile.js,
// check_darkmode.js). Without it /rules and /stock render their "nothing read yet" state and neither
// tripwire meets the bars, findings, tables or the coverage matrix. Nothing here is a real rule list:
// the names are generic, the counts invented. The real shapes are asserted in tools/test_rules.mjs.
//
// The engine is loaded by reading its source (it has no imports) rather than require()-ing an ES
// module, so this runs on any Node the tripwires run on.
'use strict';
const fs = require('fs');
const path = require('path');
function engine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'feedspark-deck', 'src', 'rules.js'), 'utf8');
  const names = [];
  const body = src.replace(/^export (const|function) ([A-Za-z0-9_]+)/gm, (_, kw, n) => { names.push(n); return kw + ' ' + n; });
  return new Function(body + '\nreturn {' + names.join(',') + '};')();
}
function rows(cmpid, company, of, seed) {
  const R = [];
  const add = (name, field, db, type, imp, created, mod, by, issues, batch) => R.push({
    rule_id: cmpid + '-' + R.length, cmpid, company, rule_name: name, target_field: field, target_db: db, rule_type: type || 'User',
    batch_id: batch || 'All products', runtime: (0.1 + (R.length % 7) / 10).toFixed(1) + ' sec', impacted_items: (imp == null ? of : imp).toLocaleString('en-GB') + ' of ' + of.toLocaleString('en-GB'),
    created_on: created, created_by: by || 'Analyst A', modified_on: mod || '', modified_by: mod ? (by || 'Analyst A') : '', rule_status: 'Active', rule_issues: issues || [],
  });
  add('Copy base title', 'Product name', 'product_name', 'System', of, '19/08/2021 at 12:22 PM');
  add('Title: append colour', 'Product name', 'product_name', 'User', Math.round(of * 0.8), '02/03/2024 at 10:00 AM', '14/09/2026 at 09:30 AM');
  add('Title: brand at the front', 'Product name', 'product_name', 'User', Math.round(of * 0.7), '02/03/2024 at 10:05 AM');
  add('A/B title test - material', 'Product name', 'product_name', 'User', 0, '11/01/2026 at 11:00 AM', '', 'Analyst B', ['Not impacting any items']);
  add('Description clean-up', 'Description', 'long_description', 'User', of, '05/05/2023 at 09:00 AM');
  add('Product type from category', 'Product Type', 'new_product_types', 'User', of, '05/05/2023 at 09:10 AM');
  add('Setup availability', 'Availability', 'stock_status', 'System', of, '19/08/2021 at 12:30 PM');
  add('Stock < ' + (8 + seed) + ' -> OOS', 'Stock quantity', 'stock_quantity', 'User', Math.round(of * 0.3), '10/10/2024 at 02:00 PM');
  add('Range completion percentage', 'Range completion', 'rc_percent', 'User', of, '10/10/2024 at 02:10 PM');
  add('Set hero sizes', 'Hero size', 'is_hero_size', 'User', of, '10/10/2024 at 02:20 PM');
  add('Social: RC > 6' + seed + '% -> out of stock', 'Social availability', 'social_availability', 'User', Math.round(of * 0.2), '12/12/2024 at 03:00 PM');
  add('Ad hoc hero size inclusion - review weekly', 'Availability', 'stock_status', 'User', Math.round(of * 0.02), '01/02/2026 at 10:00 AM', '01/02/2026 at 10:00 AM', 'Analyst B');
  add('CL2: empty < 0.26 RC', 'Custom label 2', 'gb_cl2', 'User', of, '12/12/2024 at 03:10 PM');
  add('LIA: next day', 'Pickup SLA', 'pickup_sla', 'User', of, '03/03/2025 at 11:00 AM');
  add('New In by date', 'Custom label 0', 'gb_cl0', 'User', Math.round(of * 0.1), '03/03/2025 at 11:10 AM');
  add('Christmas 2025 label', 'Custom label 4', 'custom_label_4', 'User', 12, '01/11/2025 at 09:00 AM');
  add('Valentine label', 'Custom label 1', 'custom_label_1', 'User', 0, '01/02/2025 at 09:00 AM', '', 'Analyst A', ['Not impacting any items']);
  add('Temporary PT fix', 'Product Type', 'new_product_types', 'User', 40, '01/06/2025 at 09:00 AM');
  add('Old overlay link', 'Image URL', 'meta_image_link', 'User', 0, '01/06/2022 at 09:00 AM', '', 'Analyst C', ['Target column missing']);
  add('Tracking string', 'Product URL', 'utm_shopping', 'User', of, '01/06/2022 at 09:10 AM');
  for (let i = 0; i < 4 + seed; i++) add('Label rule ' + (i + 1), 'Custom label 3', 'custom_label_3', 'User', i % 2 ? 0 : 200, '0' + (1 + i) + '/0' + (1 + (i % 8)) + '/2025 at 10:00 AM', '', 'Analyst A', i % 2 ? ['Not impacting any items'] : []);
  return R;
}
function build() {
  const E = engine();
  const now = Date.UTC(2026, 8, 28, 9);
  const MK = [
    { client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', of: 58000, seed: 1 },
    { client: 'Superdry', market: 'DE', cmpid: 'superdry_de', of: 41000, seed: 3 },
    { client: 'Reiss', market: 'GB', cmpid: 'reiss_gb', of: 60000, seed: 2 },
  ];
  const recs = {}, idx = {};
  MK.forEach((m) => {
    const rules = E.normRules(rows(m.cmpid, m.client + ' ' + m.market, m.of, m.seed));
    recs[m.cmpid] = rules;
    idx[m.cmpid] = E.idxEntry(m, rules, { total: m.cmpid === 'superdry_gb' ? rules.length + 40 : rules.length }, now);
  });
  const list = Object.keys(idx).map((k) => idx[k]);
  const status = { state: 'ok', at: now, ok_at: now - 1800000, fails: 0, error: null, auth: 'Authorization', url: 'mcp.feedhero.net', pulled: ['Superdry GB (24)'], read: 3, total: 5 };
  const rosterBrands = [{ client: 'Reiss', markets: ['GB', 'US'] }, { client: 'Superdry', markets: ['GB', 'DE', 'FR'] }];
  const unread = [{ client: 'Reiss', market: 'US', cmpid: 'reiss_us' }, { client: 'Superdry', market: 'FR', cmpid: 'superdry_fr' }];
  const base = { ok: true, tracked: list.length, roster: 5, unread, rosterBrands, scope: { brand: null }, status, at: now };
  const findings = []; list.forEach((r) => (r.find || []).forEach((f) => findings.push(f))); findings.sort((a, b) => b.sev - a.sev || b.n - a.n);
  const book = Object.assign({}, base, { families: E.FAMILIES, mechanisms: E.MECHANISMS, channels: E.CHANNELS, sev: E.SEV, estate: E.estate(list), brands: E.brandsOf(list), findings,
    markets: list.map((r) => { const o = Object.assign({}, r); delete o.find; o.sn = (r.stock || []).length; delete o.stock; return o; }) });
  const stock = Object.assign({}, base, { mechanisms: E.MECHANISMS, channels: E.CHANNELS, drivers: E.DRIVERS, sev: E.SEV, matrix: E.stockMatrix(list), cutoffs: E.stockCutoffs(list), findings: E.stockFindings(list, now),
    markets: list.map((r) => ({ client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated, n: r.n, items: r.items, stock: r.stock || [], sentence: E.stockSentence(r.stock) })) });
  const rules = recs.superdry_gb, where = { client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', rules };
  const market = { ok: true, client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', read: true, updated: now, total: rules.length + 40, capped: true, rules,
    chains: E.chains(rules, 2).map((c) => ({ d: c.d, t: c.t, fam: c.fam, rules: c.rules.map((x) => x.i) })), findings: E.rulesFindings([where], now),
    stockFindings: E.stockFindings([Object.assign({ stock: rules.filter((x) => x.sk) }, where)], now), status };
  return { book, stock, market };
}
// the fetch-stub lines the tripwires splice into their STUB string (url + j() are theirs)
function stubLines() {
  const d = build();
  return " if(url.indexOf('/api/rules/stock')>=0)return j(" + JSON.stringify(d.stock) + ");\n"
    + " if(url.indexOf('/api/rules?client=')>=0)return j(" + JSON.stringify(d.market) + ");\n"
    + " if(url.indexOf('/api/rules?pull')>=0)return j({ok:true,status:" + JSON.stringify(d.book.status) + "});\n"
    + " if(url.indexOf('/api/rules')>=0)return j(" + JSON.stringify(d.book) + ");\n";
}
module.exports = { build, stubLines, engine };
