// Every read answers for the market it was asked for (Ray, 19 Nov 2026: "go across the whole FCC dashboard to ensure that
// each market and each feed type is read correctly. So, Canadian source feed — meaning master feed source feed for
// Canada — not UK source feed").
//
// The wiring is checked by DATA: every wired feed resolves to its own market's FeedHero company (the master read for a
// market is the company its own output URL names). The page fixes are races — a read for market A drawn or saved under
// market B after a switch — so each guard is pinned by the line that makes it, and the pure helpers are LIFTED and run.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); } };
const has = (f, s) => rd(f).indexOf(s) >= 0;

console.log('· the wiring: every wired feed is its own market\'s FeedHero company');
const W = rd('cloudflare/feedspark-deck/src/worker.js');
const a = W.indexOf('const DEFAULT_FEEDS'), b = W.indexOf('\n};', a);
const DF = (new Function('return ' + W.slice(W.indexOf('{', a), b + 2)))();
const { ROAS_ROSTER } = await import(path.join(ROOT, 'cloudflare/feedspark-deck/src/roas.js'));
const nk = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const roster = {};
Object.keys(ROAS_ROSTER).forEach((c) => ROAS_ROSTER[c].forEach((m) => { roster[c + '|' + nk(m.market)] = m.cmpid; }));
const bad = [];
let n = 0;
Object.keys(DF).forEach((c) => Object.keys(DF[c]).forEach((m) => {
  const s = DF[c][m]; if (!s || !s.xml) return; n++;
  const x = /\/output_feeds\/[a-z0-9_]+\/([a-z0-9_]+)\//i.exec(s.xml), cmp = x ? x[1].toLowerCase() : '';
  const want = roster[c + '|' + nk(m.replace(/-fb$/, ''))];
  if (want && cmp !== want) bad.push(c + ' ' + m + ': ' + cmp + ' ≠ ' + want);
}));
t('all ' + n + ' wired feeds read their own market\'s company — a Canada feed is never the UK company', !bad.length && n > 40, bad);
t('Reiss CA (Google + Meta) is reiss_ca', /\/reiss_ca\//.test(DF.Reiss.ca.xml) && /\/reiss_ca\//.test(DF.Reiss['ca-fb'].xml));

console.log('· the worker never folds a market key');
const mk = /const mktOf = (\(raw\) => [^;]+);/.exec(W);
const mktOf = mk ? eval(mk[1]) : null;
t('a Meta key keeps its "-fb" (befr-fb, de-en-fb) — at 6 characters it read as a Google market', mktOf && mktOf('befr-fb') === 'befr-fb' && mktOf('de-en-fb') === 'de-en-fb' && mktOf('GB') === 'gb');
t('a hero-size census asked for a market the roster lacks answers nothing, never another market\'s', /const pick = want \? \(/.test(W));

console.log('· the result emails name every market');
const { parseKwResult } = await import(path.join(ROOT, 'cloudflare/feedspark-deck/src/briefmatch.js'));
const kr = (s) => { const r = parseKwResult({ subject: s, body: 'Clicks: 5% increase', date: '2026-11-12', mid: 'x' }); return r ? r.brand + '|' + r.mkt : null; };
t('ES, BE-FR, UK and US are each read as the market they name', kr('Reiss ES x Feedspark - Nov I - Keyword Optimisation') === 'Reiss|es'
  && kr('Superdry BE-FR x Feedspark - Nov I - Keyword Optimisation') === 'Superdry|be-fr'
  && kr('Reiss UK x Feedspark - Nov I - Keyword Optimisation') === 'Reiss|gb' && kr('American Golf x Feedspark - Nov I - Keyword Optimisation') === 'American Golf|',
  [kr('Reiss ES x Feedspark - Nov I - Keyword Optimisation'), kr('Superdry BE-FR x Feedspark - Nov I - Keyword Optimisation')]);
t('KWCal shows a batch with no market named as such — never under the board\'s market', has('docs/FeedSpark_KWCal.html', "esc(r.mkt?String(r.mkt).toUpperCase():'market not named')"));

console.log('· a brief carries the market it was sent from');
const WF = rd('docs/FeedSpark_Workflow.html');
const ma = WF.indexOf('function moduleMkt'), mb = WF.indexOf('window.__wfModuleMkt');
let moduleMkt = () => null; try { if (ma >= 0 && mb > ma) moduleMkt = (new Function(WF.slice(ma, mb) + '; return moduleMkt;'))(); } catch (e) {}
t('the module\'s own market wins; else the house task name says it; else gb', moduleMkt({ mkt: 'ca-fb', task: 'x', client: 'Reiss' }) === 'ca'
  && moduleMkt({ task: 'Catalogue Fix - x - Reiss CA - 1126', client: 'Reiss' }) === 'ca'
  && moduleMkt({ task: 'Social DPA - Dynamic schedule - Superdry BE-FR - 1126', client: 'Superdry' }) === 'be-fr'
  && moduleMkt({ task: 'Keywords Optimisation - Gifting - Marketing Planner - 1126', client: 'Reiss' }) === 'gb');
t('…and the composer\'s Market box is set from it', /bm\.value=moduleMkt\(j\)/.test(WF));
const KE = await import(path.join(ROOT, 'docs/kwcal_engine.js')).then((m) => m.default || m).catch(() => null);
const KWE = KE && KE.briefPayload ? KE : (await import('module')).createRequire(import.meta.url)(path.join(ROOT, 'docs/kwcal_engine.js'));
const pay = KWE.briefPayload ? KWE.briefPayload({}, 'Reiss', { id: 'm1', name: 'Gifting', date: '2026-12-01', lane: 'campaign' }, 'ca') : null;
t('a keyword-calendar brief names its market', pay && pay.mkt === 'ca', pay && pay.mkt);
t('a ticket stamped for one market ties to that market\'s board only', /b\.kw&&String\(b\.kw\)===String\(e\.id\)&&\(!b\.kwm\|\|b\.kwm===evMkt\(e,mkt\|\|'gb'\)\)/.test(rd('docs/kwcal_engine.js')));
t('the Playbook backlog reads each market\'s own title / keyword work', /function pbLastOpt\(tasks,ov,mkt\)/.test(WF) && /pbLastOpt\(tasks,ov,feed\.mkt\)/.test(WF));
t('the brief rail reads the brief\'s own market', /\/api\/feed\/audit\?client='\+encodeURIComponent\(c\)\+'&market='\+encodeURIComponent\(bmk\)/.test(WF));

console.log('· a read never lands on the market now on screen');
const guards = [
  ['docs/FeedSpark_Social.html', 'if (g !== S.gen) return;', 'Social: a feed sample answers only for its brand + market'],
  ['docs/FeedSpark_Social.html', 'if (S.pickTok !== tok) return;', 'Social: one product\'s pictures are never drawn on another'],
  ['docs/FeedSpark_Social.html', 'if (!j || stale()) return;', 'Social: a Google Ads read for the market before is dropped'],
  ['docs/FeedSpark_Stock.html', 'if (S.loadTok !== tok) return;', 'Stock: the newest brand pick wins'],
  ['docs/FeedSpark_Stock.html', 'PID.hit.D !== xr.D', 'Stock: a re-read finds the checked product again'],
  ['docs/FeedSpark_Catalog.html', "if (S.chan === 'meta') return { why: 'Ad spend kept off is sized on Google Ads", 'Catalogue: no Google Ads money on a Meta catalogue'],
  ['docs/FeedSpark_Volume.html', "fetch('/api/volume/dobpush?client='+enc(sc)+'&market='+enc(sm)", 'Volume: a scan is stored under the market it streamed'],
  ['docs/FeedSpark_Images.html', "fetch('/api/images/audit?client='+encodeURIComponent(ac)+'&market='+encodeURIComponent(am)", 'Images: an audit is saved to the market it read'],
  ['docs/FeedSpark_Images.html', 'return saveTags(patch,null,{client:c});', 'Images: an AI verdict is saved to the brand it was asked for'],
  ['docs/FeedSpark_Images.html', 'savePhotos(r.patch,null,PHCTX&&PHCTX.c)', 'Images: a photograph run saves to its own brand'],
  ['docs/FeedSpark_Overlays.html', "if(ST.client!==CLIENT||ST.mkt!==MKT)throw new Error('STALE');", 'Overlays studio: another feed is never opened under this one'],
  ['docs/FeedSpark_Overlays.html', 'if(DEEP){', 'Overlays: a link opens on the feed it names'],
  ['docs/FeedSpark_LabelGuard.html', 'if (SEL !== k) return;   // another market', 'Label Guard: a slow snapshot never repaints another market'],
  ['docs/FeedSpark_ProductTypeGuard.html', 'if (SEL !== k) return;   // another market', 'PT Guard: the same'],
  ['docs/FeedSpark_GoldenRecord.html', 'if (SEL !== k) return;   // another market', 'Golden Record: the same'],
  ['docs/FeedSpark_GoldenRecord.html', 'qualityRun(k, function (st) { if (SEL === k) drawScan(st); })', 'Golden Record: a quality scan\'s progress stays on its market'],
  ['docs/FeedSpark_GoldenRecord.html', "if (PDP.run && PDP.run.k !== k) PDP.run = null;", 'Golden Record: another market\'s PDP scan never paints this modal'],
  ['docs/FeedSpark_AIQuote.html', 'IDX[pm]={map:map', 'Quote: a pulled feed is filed under the market it read'],
  ['docs/FeedSpark_AIVisibility.html', "if (m !== S.mkt) { S.prod = null; S.prodSt = ''; }", 'AI visibility: a market switch drops the matched catalogue'],
  ['docs/FeedSpark_KWCal.html', "fetch('/api/feed/proxy?client='+encodeURIComponent(brand)+'&market='", 'KWCal: a product-type sync writes the brand it read'],
  ['docs/FeedSpark_KWCal.html', "loadMkts(qm?MKT:'')", 'KWCal: a link\'s market is kept'],
  ['docs/FeedSpark_Pricer.html', "function exK(c,m,id){return c+'|'+m+'|'+id}", 'Pricer: an example belongs to one brand\'s one market'],
  ['docs/FeedSpark_Command_Center.html', "return Object.keys(ks).filter(function(m){return m.indexOf('-fb')<0}); }", 'Dossier: brand figures read every market, not the first eight'],
  ['docs/FeedSpark_Breakdown.html', 'var hitM = (S.roster[S.brand] || [])', 'Field breakdown: a roster label finds its wired market'],
];
guards.forEach(([f, s, nm]) => t(nm, has(f, s)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
