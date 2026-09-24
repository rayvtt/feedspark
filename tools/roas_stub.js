// A small SYNTHETIC GET /api/roas payload in the worker's own shape, for the browser tripwires
// (check_mobile.js, check_darkmode.js) — without it /roas renders its "nothing read yet" state
// and neither tripwire sees the scorecards, the trend, the movers or the table it is meant to
// check. Nothing here is a real figure: two brands, three markets, two currencies, ten days of
// history, numbers picked to exercise every band. The REAL shape is asserted against the engine
// in tools/test_roas.mjs; this only has to render.
'use strict';
function money(cur, n) { return { cur, n }; }
function total(cmpid, cur, sp, rv, cv, ck, im, sk, zb, band) {
  return { cmpid, cmpname: cmpid, category: 'Total', skus: sk, zombiePct: zb, impr: im, clicks: ck, conv: cv, revenue: money(cur, rv), spend: money(cur, sp),
    cpc: money(cur, ck ? +(sp / ck).toFixed(2) : 0), ctrPct: im ? +((ck / im) * 100).toFixed(2) : 0, aov: money(cur, cv ? +(rv / cv).toFixed(2) : 0), avgPrice: money(cur, 41.96),
    upliftPct: 173.74, crPct: ck ? +((cv / ck) * 100).toFixed(2) : 0, cpa: money(cur, cv ? +(sp / cv).toFixed(2) : 0), roasPct: sp ? +((rv / sp) * 100).toFixed(2) : 0, minMarginPct: 8.71, band, source: 'Google Ads', collected: null };
}
function build() {
  const DAYS = 10, day0 = Date.UTC(2026, 8, 14);
  const mk = (cmpid, client, market, cur, sp, rv, cv, ck, im, sk, zb, band, seed) => {
    const w = (f) => total(cmpid, cur, +(sp * f).toFixed(2), +(rv * f).toFixed(2), +(cv * f).toFixed(2), Math.round(ck * f), Math.round(im * f), sk, zb, band);
    const wins = { w7: w(0.25), w30: w(1), w90: w(2.8) };
    const spark = [];
    for (let i = 0; i < DAYS; i++) {
      const wob = 1 + 0.2 * Math.sin((i + seed) / 3);
      const pt = (f) => [+(sp * f * wob).toFixed(2), +(rv * f * wob).toFixed(2), +(cv * f * wob).toFixed(2), Math.round(ck * f * wob), Math.round(im * f * wob), sk, zb];
      spark.push({ d: new Date(day0 + i * 86400000).toISOString().slice(0, 10), cur, w7: pt(0.25), w30: pt(1), w90: pt(2.8) });
    }
    return Object.assign({ client, market, cmpid, updated: day0 + (DAYS - 1) * 86400000, day: spark[DAYS - 1].d, cur }, wins.w30, wins, { spark });
  };
  const rows = [
    mk('superdry_gb', 'Superdry', 'GB', '£', 41794.42, 480072.16, 6585.04, 204985, 14477612, 64469, 48.06, 'Strong', 1),
    mk('superdry_de', 'Superdry', 'DE', '€', 53253.13, 369851.24, 4200, 150000, 9000000, 62253, 52.95, 'Strong', 2),
    mk('schuh_uk_1', 'Schuh', 'GB', '£', 30000, 45000, 900, 100000, 8000000, 85000, 57.7, 'Weak', 3),
  ];
  const wins = ['w7', 'w30', 'w90'];
  const agg = (list) => { const by = {}; list.forEach((r) => { const t = r; const a = by[t.cur] || (by[t.cur] = { n: 0, sp: 0, rv: 0, cv: 0, ck: 0, im: 0, sk: 0, zb: null, roas: null, bands: {} }); a.n++; a.sp += t.spend.n; a.rv += t.revenue.n; a.cv += t.conv; a.ck += t.clicks; a.im += t.impr; a.sk += t.skus; a.zb = t.zombiePct; if (t.band) a.bands[t.band] = (a.bands[t.band] || 0) + 1; }); Object.keys(by).forEach((c) => { by[c].roas = by[c].sp ? +((by[c].rv / by[c].sp) * 100).toFixed(2) : null; }); return by; };
  const brands = {}, book = {}, series = {}, movers = {};
  wins.forEach((k) => {
    const byBrand = {};
    rows.forEach((r) => { const t = r[k]; const b = byBrand[r.client] || (byBrand[r.client] = { client: r.client, roster: r.client === 'Superdry' ? 19 : 3, markets: [], spendByCur: {}, revenueByCur: {}, byCur: {}, bandCounts: {}, conv: 0, clicks: 0, impr: 0, skus: 0, updated: r.updated, marketsRead: 0, roasPct: null, avgZombiePct: t.zombiePct });
      b.markets.push(Object.assign({ client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated, cur: r.cur, has: true }, t));
      b.spendByCur[r.cur] = (b.spendByCur[r.cur] || 0) + t.spend.n; b.revenueByCur[r.cur] = (b.revenueByCur[r.cur] || 0) + t.revenue.n; b.bandCounts[t.band] = (b.bandCounts[t.band] || 0) + 1;
      b.conv += t.conv; b.clicks += t.clicks; b.impr += t.impr; b.skus += t.skus; b.marketsRead++; });
    Object.keys(byBrand).forEach((c) => { const b = byBrand[c]; b.byCur = agg(b.markets.map((m) => Object.assign({ cur: m.cur }, m))); const curs = Object.keys(b.byCur); b.roasPct = curs.length === 1 ? b.byCur[curs[0]].roas : null; });
    brands[k] = Object.keys(byBrand).sort().map((c) => byBrand[c]);
    const all = agg(rows.map((r) => Object.assign({ cur: r.cur }, r[k])));
    book[k] = { brands: brands[k].length, brandsRead: brands[k].length, marketsRead: rows.length, marketsTotal: 22, spendByCur: {}, revenueByCur: {}, byCur: all, bandCounts: {}, bandOrder: ['Strong', 'Steady', 'Weak', 'Losing'] };
    Object.keys(all).forEach((c) => { book[k].spendByCur[c] = all[c].sp; book[k].revenueByCur[c] = all[c].rv; Object.keys(all[c].bands).forEach((bn) => { book[k].bandCounts[bn] = (book[k].bandCounts[bn] || 0) + all[c].bands[bn]; }); });
    series[k] = { '*': [] };
    ['£', '€'].forEach((cur) => { const pts = []; for (let i = 0; i < DAYS; i++) { const p = { d: rows[0].spark[i].d, sp: 0, rv: 0, cv: 0, ck: 0, im: 0, sk: 0, n: 0 }; rows.filter((r) => r.cur === cur).forEach((r) => { const q = r.spark[i][k]; p.sp += q[0]; p.rv += q[1]; p.cv += q[2]; p.ck += q[3]; p.im += q[4]; p.sk += q[5]; p.n++; }); p.roas = p.sp ? +((p.rv / p.sp) * 100).toFixed(2) : null; pts.push(p); } series[k][cur] = pts; series[k]['*'] = pts.map((p) => Object.assign({}, p, { sp: null, rv: null, roas: null })); });
    movers[k] = rows.map((r, i) => ({ client: r.client, market: r.market, cmpid: r.cmpid, cur: r.cur, band: r[k].band, sp: r[k].spend.n, rv: r[k].revenue.n, roas: r[k].roasPct, cv: r[k].conv, prevD: rows[0].spark[2].d, dSp: [4.2, -1.1, 8.8][i], dRv: [16.5, -3.1, -11.3][i], dRoas: [12, -2, -18][i], dCv: [3, -1, -5][i] }));
  });
  const markets = rows.map((r) => ({ client: r.client, market: r.market, cmpid: r.cmpid, updated: r.updated, cur: r.cur, spark: r.spark, w7: r.w7, w30: r.w30, w90: r.w90 }));
  const tree = ['Women', 'Women > Clothing', 'Women > Clothing > Jackets', 'Men', 'Men > Footwear', 'Kids'].map((p, i) => ({ path: p, row: total('superdry_gb', '£', 3070 - i * 300, 42837 - i * 3000, 440 - i * 30, 14709 - i * 900, 1175375 - i * 90000, 900 - i * 50, 43.15, ['Strong', 'Steady', 'Weak', 'Losing', null, 'Strong'][i]) }));
  const nodes = {}; tree.forEach((n) => { n.row.category = n.path; nodes[n.path] = { name: n.path.split(' > ').pop(), path: n.path, depth: n.path.split(' > ').length, row: n.row, kids: [] }; });
  const roots = []; Object.keys(nodes).forEach((p) => { const parts = p.split(' > '); const pp = parts.slice(0, -1).join(' > '); if (nodes[pp]) nodes[pp].kids.push(nodes[p]); else roots.push(nodes[p]); });
  return {
    book: { ok: true, wins: [{ k: 'w7', period: '7_days', days: 7, label: '7 days' }, { k: 'w30', period: '30_days', days: 30, label: '30 days' }, { k: 'w90', period: '90_days', days: 90, label: '90 days' }], defaultWin: 'w30', back: 7, brands, book, markets, series, movers, curs: ['£', '€'], tracked: rows.length, roster: 22, rosterBrands: [{ client: 'Schuh', markets: ['GB', 'DE', 'IE'] }, { client: 'Superdry', markets: ['GB', 'DE', 'FR'] }], scope: { brand: null, market: null }, status: { state: 'ok', at: Date.now(), ok_at: Date.now() - 1800000, fails: 0, error: null, auth: 'Authorization', url: 'mcp.feedhero.net', pulled: ['Superdry GB'], read: 22, total: 22 } },
    market: { ok: true, client: 'Superdry', market: 'GB', cmpid: 'superdry_gb', win: 'w30', read: true, total: rows[0].w30, tree: roots, n: tree.length, updated: rows[0].updated, hist: rows[0].spark },
    live: { ok: true, cached: false, cmpid: 'superdry_gb', client: 'Superdry', market: 'GB', agg: 'Brand', win: 'w30', at: Date.now(), total: rows[0].w30, rows: tree.slice(0, 3).map((n, i) => Object.assign({}, n.row, { category: ['Nike', 'Adidas', 'Converse'][i] })), n: 3 },
  };
}
// the fetch-stub lines the tripwires splice into their STUB string (url + j() are theirs)
function stubLines() {
  const d = build();
  return " if(url.indexOf('/api/roas/live')>=0)return j(" + JSON.stringify(d.live) + ");\n"
    + " if(url.indexOf('/api/roas?client=')>=0)return j(" + JSON.stringify(d.market) + ");\n"
    + " if(url.indexOf('/api/roas?pull')>=0)return j({ok:true,status:" + JSON.stringify(d.book.status) + "});\n"
    + " if(url.indexOf('/api/roas')>=0)return j(" + JSON.stringify(d.book) + ");\n";
}
module.exports = { build, stubLines };
