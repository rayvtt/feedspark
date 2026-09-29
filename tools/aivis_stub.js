// A small SYNTHETIC AI-visibility book for the browser tripwires (check_mobile.js, check_darkmode.js,
// check_aivis.js): one invented brand ("Northwind", three invented competitors), two stored runs whose
// answers are made up, pushed through the REAL reading engine (docs/aivis_engine.js) so the headline
// each run carries in its metadata is the one the page would have written. Without it /aivis renders
// its "no run yet" state and no tripwire meets the grid, the charts or the drawer. Nothing here is a real
// answer from a real surface; the real shapes are asserted in tools/test_aivis.mjs.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
const E = require(path.join(D, 'aivis_engine.js'));
// src/aivis.js is an ES module with no imports — read it the way rules_stub reads rules.js
function adapters() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'feedspark-deck', 'src', 'aivis.js'), 'utf8');
  const names = [];
  const body = src.replace(/^export (const|function|async function) ([A-Za-z0-9_]+)/gm, (_, kw, n) => { names.push(n); return kw + ' ' + n; });
  return new Function(body + '\nreturn {' + names.join(',') + '};')();
}
const QS = [
  { id: 'q1', q: "What are the best women's wool coats to buy online in the UK?", type: 'cat' },
  { id: 'q2', q: "What are the best men's rain jackets to buy online in the UK?", type: 'cat' },
  { id: 'q3', q: 'Where is the best place to buy walking boots in the UK?', type: 'buy' },
  { id: 'q4', q: 'What is Northwind known for, and is it worth buying from?', type: 'brand' },
];
const COMPS = [{ n: 'Southbay', a: [], d: [] }, { n: 'Eastfield', a: [], d: [] }, { n: 'Westgate', a: [], d: ['westgate-outdoor.com'] }];
const SV = ['chatgpt', 'aimode', 'aio', 'claude'];
function answer(qi, s, k) {
  const named = (qi + k) % 3 !== 0;
  const lead = ['Southbay', 'Eastfield', 'Westgate'][(qi + k) % 3];
  const text = qi === 3
    ? 'Northwind is a British outdoor brand known for **waterproof outerwear** and a lifetime repair service. Reviewers compare it with Southbay on price.'
    : 'Here are strong options:\n\n1. **' + lead + '** – dependable and well priced.\n' + (named ? '2. **Northwind** – the best-made of the group, with recycled fabrics.\n' : '') +
      '3. **Harbour & Co** – a smaller label worth a look.\n\nMost shoppers pair reviews on Reddit with a retailer like Amazon.';
  const cites = [{ u: 'https://www.vogue.co.uk/article/best-coats', t: 'The best coats' }, { u: 'https://www.reddit.com/r/ukfashion/x', t: 'r/ukfashion' }];
  if (named && (qi + k) % 2) cites.unshift({ u: 'https://www.northwind.co.uk/p/wool-coat/NW100?utm_source=chatgpt.com', t: 'Northwind wool coat' });
  cites.push({ u: 'https://www.' + lead.toLowerCase() + (lead === 'Westgate' ? '-outdoor' : '') + '.com/', t: lead });
  if (s === 'aimode') cites.push({ u: 'https://www.amazon.co.uk/s?k=coat', t: 'Amazon' });
  return { text, cites, results: cites.concat([{ u: 'https://www.northwind.co.uk/help', t: 'Northwind help' }]), searches: [QS[qi].q.toLowerCase().replace(/\?$/, '')] };
}
function build() {
  const A = adapters();
  const ctx = E.brandCtx('Northwind', { comps: COMPS });
  const runAt = [Date.UTC(2026, 8, 22, 9), Date.UTC(2026, 8, 29, 9)];
  const runs = runAt.map((at, k) => {
    const cells = [];
    QS.forEach((q, qi) => SV.forEach((s) => {
      const c = { qid: q.id, q: q.q, type: q.type, s, ok: true, none: false, err: null, model: A.modelOf({}, s), ms: 4000 + qi * 900, at };
      if (s === 'aio' && qi === 2) Object.assign(c, { none: true, note: 'Google showed no AI Overview for this search', text: '', cites: [], results: [], searches: [] });
      else if (s === 'chatgpt' && qi === 1 && k === 0) Object.assign(c, { ok: false, err: 'HTTP 429 — rate limited, try fewer at once', text: '', cites: [], results: [], searches: [] });
      else Object.assign(c, answer(qi, s, k), s === 'claude' ? { usage: { i: 18000 + qi * 900, o: 1300, ws: 2 } } : {});
      cells.push(c);
    }));
    const run = { v: 1, id: 'r' + at + 'nw' + k, mkt: 'gb', at, final: true, sv: SV, cells, client: 'Northwind', by: 'ray@feedspark.com' };
    const sum = E.compact(E.summarise(cells.map((c) => E.analyse(c, ctx)), ctx));
    return { run, meta: { id: run.id, client: 'Northwind', at, by: 'ray@feedspark.com', mkt: 'gb', sv: SV, n: cells.length, final: true, sum } };
  });
  const surfaces = A.surfaceStatus({ ANTHROPIC_API_KEY: 1, OPENAI_API_KEY: 1, SERPAPI_KEY: 1 });
  const last = runs[1];
  const book = { ok: true, surfaces, markets: A.MARKETS, brands: [{ client: 'Northwind', markets: ['gb', 'de'], runs: 2, last: last.meta }], granted: true, owner: true };
  const cfg = { q: { gb: QS.map((q) => Object.assign({ on: true }, q)) }, comps: COMPS, doms: [], alias: [], sv: [] };
  const brand = { ok: true, client: 'Northwind', cfg, runs: [runs[1].meta, runs[0].meta], last: runs[1].run, surfaces, granted: true };
  const pt = { snapshot: { labels: { product_type: { values: [['Women > Coats > Wool Coats', 420], ['Men > Jackets > Rain Jackets', 380], ['Footwear > Walking Boots', 300], ['Accessories > Hats', 90]] } } } };
  const csv = 'id,title,link\nNW100,Northwind Wool Coat Navy,https://www.northwind.co.uk/p/wool-coat/NW100\nNW200,Northwind Storm Rain Jacket,https://www.northwind.co.uk/p/storm/NW200\n';
  return { book, brand, runs: runs.map((r) => r.run), pt, csv, ctx };
}
function stubLines() {
  const d = build();
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:{"content-type":"' + type + '"}}));';
  return " if(/AIVisibility/.test(location.pathname)){\n"
    + "  if(url.indexOf('/aivis/engine.js')>=0)" + txt(src('aivis_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/feed/proxy')>=0)" + txt(JSON.stringify(d.csv), 'text/csv') + "\n"
    + "  if(url.indexOf('/api/ptypes/snapshot')>=0)return j(" + JSON.stringify(d.pt) + ");\n"
    + "  if(url.indexOf('/api/aivis?client=')>=0&&url.indexOf('run=')>=0){var R=" + JSON.stringify(d.runs) + ";var id=(url.match(/run=([^&]+)/)||[])[1];return j({ok:true,run:R.filter(function(x){return x.id===id;})[0]||R[1]});}\n"
    + "  if(url.indexOf('/api/aivis?client=')>=0)return j(" + JSON.stringify(d.brand) + ");\n"
    + "  if(url.indexOf('/api/aivis/run')>=0)return j({ok:true});\n"
    + "  if(url.indexOf('/api/aivis')>=0&&url.indexOf('/api/aivis/ask')<0)return j(" + JSON.stringify(d.book) + ");\n"
    + " }\n";
}
module.exports = { build, stubLines, adapters };
