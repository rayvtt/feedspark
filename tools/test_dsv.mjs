#!/usr/bin/env node
/*
 * DSV scan harness (Ray, 16 Oct 2026: "Superdry NL meta feed currently is in DSV format, so I think the
 * current label scan is not read properly … add scanning DSV as a skill needed for this label scan so it
 * scans multiple formats of the feed").
 *
 * FeedHero hands some Meta catalogues out ONLY as a tab-separated file, and the label scan read XML only.
 * This pins: the engine's delimited reader on Meta's real TSV shape (two '#' metadata lines, an unquoted
 * header, quoted text cells holding commas / tabs / newlines / doubled quotes), chunk-safe at every split;
 * a comma file read exactly as before (a Google Sheets header full of '|||' pipes stays a comma file);
 * pipe and semicolon files; an unquoted TSV whose cell starts with a quote mark NOT swallowing the file;
 * the label collector reading the SAME snapshot off a TSV as off the same products in XML; the language
 * override feed refused; and the wiring — the worker accepts a FeedHero .tsv, the proxy passes it, the
 * agent and the guard pages read it, and no Meta market is wired to an override feed again.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { xmlCollector } from '../cloudflare/feedspark-deck/src/labelguard.js';
const require = createRequire(import.meta.url);
const FA = require('../docs/feedlab_engine.js');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };
const read = (mk, text, step) => { const rows = []; const p = mk((r, h) => rows.push(r.slice())); if (step) { for (let i = 0; i < text.length; i += step) p.push(text.slice(i, i + step)); } else p.push(text); p.end(); return { rows, p }; };
const J = JSON.stringify;

console.log('· the delimited reader on Meta\'s TSV shape');
// the shape FeedHero serves (checked on Superdry NL's 'Facebook TSV', 16 Oct 2026), with every hard case in it
const TSV = '# ref_application_id 1034880353200000\n# ref_asset_id 454143\n'
  + 'id\ttitle\tdescription\tavailability\tprice\tcustom_label_0\tcustom_label_2\n'
  + '275819\t"Logo T-shirt - White"\t"Slim fit, close to the body\tsignature tab"\tin stock\t30.00 EUR\tFULL\t"Black Friday bij Superdry"\n'
  + '269304\t"Lace ""Cami"" Top"\t"Frilled hem\nbutton fastening"\tin stock\t45.00 EUR\tSALE\t\n'
  + '269305\t"Plain Tee"\t"Soft"\tout of stock\t20.00 EUR\tSALE\tEindigt vanavond\r\n';
const WANT = [['id', 'title', 'description', 'availability', 'price', 'custom_label_0', 'custom_label_2'],
  ['275819', 'Logo T-shirt - White', 'Slim fit, close to the body\tsignature tab', 'in stock', '30.00 EUR', 'FULL', 'Black Friday bij Superdry'],
  ['269304', 'Lace "Cami" Top', 'Frilled hem\nbutton fastening', 'in stock', '45.00 EUR', 'SALE', ''],
  ['269305', 'Plain Tee', 'Soft', 'out of stock', '20.00 EUR', 'SALE', 'Eindigt vanavond']];
{
  const r = read((f) => FA.createParser(f), TSV);
  t('a Meta TSV reads as its header + rows: # lines skipped, quoted commas, tabs, newlines and "" kept inside their cell', J(r.rows) === J(WANT), J(r.rows));
  t('… and says what it decided: tab, quotes honoured, two metadata lines', J(r.p.format()) === J({ delim: '\t', quotes: true, comments: 2 }), J(r.p.format()));
  let bad = 0;
  for (let step = 1; step <= TSV.length; step++) if (J(read((f) => FA.createParser(f), TSV, step).rows) !== J(WANT)) bad++;
  t('chunk-safe: the same rows whatever size the chunks arrive in (1 … ' + TSV.length + ' chars)', bad === 0, bad + ' split sizes differ');
  const bom = read((f) => FA.createParser(f), '﻿' + TSV);
  t('a byte-order mark before the metadata lines is stripped', J(bom.rows) === J(WANT));
  const f = read((g) => FA.createFeedParser(g), TSV, 97);
  t('createFeedParser: a file not opening with < is read as delimited', f.p.kind() === 'dsv' && J(f.rows) === J(WANT));
}

console.log('· a comma file is read exactly as before');
{
  const SHEET = 'id,title,product_type|||2,product_type|||3,custom_label_0\n'
    + '1,"Tweed jacket, brown",Coats|Wool,"Gifts",FULL\n2,"Say ""hi""",,,SALE\r\n3,"two\nlines",x,y,z\n';
  const auto = read((f) => FA.createParser(f), SHEET), forced = read((f) => FA.createParser(f, { delim: ',' }), SHEET);
  t('a Google Sheets header full of |||N pipes stays a COMMA file (delimiter chosen by presence, never by count)', auto.p.format().delim === ',' && J(auto.rows) === J(forced.rows) && auto.rows[1][1] === 'Tweed jacket, brown' && auto.rows[1][2] === 'Coats|Wool', J(auto.rows));
  let bad = 0;
  for (let step = 1; step <= SHEET.length; step++) if (J(read((f) => FA.createParser(f), SHEET, step).rows) !== J(forced.rows)) bad++;
  t('… chunk-safe the same way', bad === 0, bad + ' split sizes differ');
  const one = read((f) => FA.createParser(f), 'id,title\n1,A');
  t('a file with no trailing newline still emits its last row', J(one.rows) === J([['id', 'title'], ['1', 'A']]));
  const hdrOnly = read((f) => FA.createParser(f), 'id,title');
  t('a header with no rows and no newline is still the header', J(hdrOnly.rows) === J([['id', 'title']]));
  t('an empty stream reads nothing and does not throw', read((f) => FA.createParser(f), '').rows.length === 0);
}

console.log('· pipe, semicolon, and an unquoted TSV');
{
  t('a pipe file', J(read((f) => FA.createParser(f), 'id|title|price\n1|"A|B"|9.99 GBP\n').rows) === J([['id', 'title', 'price'], ['1', 'A|B', '9.99 GBP']]));
  t('a semicolon file', J(read((f) => FA.createParser(f), 'id;title;price\n1;Tee;9,99 EUR\n').rows) === J([['id', 'title', 'price'], ['1', 'Tee', '9,99 EUR']]));
  // an UNQUOTED tsv whose cell happens to open with a quote mark: honouring it would swallow the rest of the file
  const U = 'id\ttitle\tsize\n1\t"Boss" style tee\tM\n2\tPlain tee\tL\n3\tCap\tOS\n';
  const u = read((f) => FA.createParser(f), U);
  t('an unquoted TSV whose cell starts with a quote mark is NOT read as quoted (no row swallowed)', u.rows.length === 4 && u.rows[3][2] === 'OS' && u.p.format().quotes === false, J(u.rows));
  const fx = read((f) => FA.createParser(f, { delim: '\t', quotes: false }), 'a\tb\n"x\ty\n');
  t('opts.delim / opts.quotes force the read with no sniff', J(fx.rows) === J([['a', 'b'], ['"x', 'y']]));
}

console.log('· XML still XML; an override feed is not a catalogue');
{
  const X = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>1</g:id><title>A</title></item></channel></rss>';
  const x = read((f) => FA.createFeedParser(f), '\n  ' + X, 13);
  t('createFeedParser: a file opening with < (after blanks) is read as XML', x.p.kind() === 'xml' && x.rows.length === 2 && x.rows[1][0] === '1');
  t('isOverrideFeed: id + override + translated text is an override feed', FA.isOverrideFeed(['g:id', 'override', 'title', 'description', 'g:short_description']));
  t('isOverrideFeed: Meta\'s full TSV carries an override column AND price/availability — a catalogue', !FA.isOverrideFeed(WANT[0].concat(['override'])) && !FA.isOverrideFeed(['id', 'title']) && !FA.isOverrideFeed(null));
}

console.log('· the label collector reads the same snapshot off a TSV as off the same products in XML');
{
  const items = WANT.slice(1);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const X = '<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
    + items.map((r) => '<item><g:id>' + r[0] + '</g:id><title>' + esc(r[1]) + '</title><description>' + esc(r[2]) + '</description><g:availability>' + r[3]
      + '</g:availability><g:price>' + r[4] + '</g:price><g:custom_label_0>' + r[5] + '</g:custom_label_0>' + (r[6] ? '<g:custom_label_2>' + esc(r[6]) + '</g:custom_label_2>' : '') + '</item>').join('')
    + '</channel></rss>';
  const scan = (text) => { const c = xmlCollector({ client: 'Superdry', market: 'nl-fb' }); const p = FA.createFeedParser(c.onRow); p.push(text); p.end(); return c.finish(); };
  const a = scan(TSV), b = scan(X);
  const strip = (o) => { const s = Object.assign({}, o.snap); delete s.t; return s; };
  t('rows, every custom label and its values, and the label population are identical', J(strip(a)) === J(strip(b)), J(strip(a)).slice(0, 300) + ' vs ' + J(strip(b)).slice(0, 300));
  t('… and so is the stock count /stock reads (2 in, 1 out)', ['n', 'in', 'out', 'pre', 'none', 'other'].every((k) => a.vol.av[k] === b.vol.av[k]) && a.vol.av.in === 2 && a.vol.av.out === 1, J(a.vol.av));
}

console.log('· the wiring');
const WK = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const AG = readFileSync(new URL('./xml_scan.mjs', import.meta.url), 'utf8');
{
  const m = /const xmlRef = \(u\) => \(([\s\S]*?)\n  \? \{ xml: String\(u\)\.trim\(\) \} : null\);/.exec(WK);
  const xmlRef = m ? new Function('u', 'return (' + m[1] + ') ? { xml: String(u).trim() } : null;') : null;
  t('worker: xmlRef found', !!xmlRef);
  if (xmlRef) {
    t('xmlRef accepts a FeedHero .tsv / .csv / .txt as well as .xml', ['tsv', 'csv', 'txt', 'xml'].every((e) => xmlRef('https://s2.feedhero.net/output_feeds/fb_tsv/x/h/f.' + e)));
    t('… and still refuses any other host or file type', !xmlRef('https://evil.example/f.tsv') && !xmlRef('https://s2.feedhero.net/f.html') && !xmlRef('http://s2.feedhero.net/f.tsv') && !xmlRef('https://feedhero.net.evil.io/f.tsv'));
  }
  t('worker: the feed proxy passes a delimited upstream (FeedHero serves a TSV as text/tab-separated-values) and never HTML', /const dsv = \/tab-separated\|csv\|text\\\/plain\/i\.test\(ctx2\);/.test(WK) && /!\(dsv \|\| \/xml\|rss\|octet-stream\/i\.test\(ctx2\)\)/.test(WK));
  t('worker: both feed-head readers (image hosts, PDP host) read a delimited head through dsvHead', /const dh = dsvHead\(text, 59\)/.test(WK) && /const dh = dsvHead\(text, 39\)/.test(WK) && !/function pdpSplitCsv/.test(WK));
  // DEFAULT_FEEDS, evaluated as the worker holds it
  const FEEDS = new Function('return {' + /const DEFAULT_FEEDS = \{([\s\S]*?)\n\};/.exec(WK)[1] + '\n};')();
  const sd = FEEDS.Superdry || {};
  t('Superdry ie/de/fr/nl-fb read their FeedHero Facebook TSVs', ['ie', 'de', 'fr', 'nl'].every((k) => sd[k + '-fb'] && /\/output_feeds\/fb_tsv\/superdry_/.test(sd[k + '-fb'].xml || '') && /\.tsv$/.test(sd[k + '-fb'].xml)), J(['ie', 'de', 'fr', 'nl'].map((k) => sd[k + '-fb'])));
  const all = []; Object.keys(FEEDS).forEach((c) => Object.keys(FEEDS[c]).forEach((k) => { const s = FEEDS[c][k]; if (s && s.xml) all.push(s.xml); }));
  t('NO market is wired to a language override feed (fb_lang_feed)', all.every((u) => !/\/fb_lang_feed\//.test(u)), all.filter((u) => /fb_lang_feed/.test(u)).join(' '));
  // the agent's own roster reader, lifted by name, picks the TSVs up
  const fn = /function wiredXmlFeeds\(\) \{[\s\S]*?\n\}\n/.exec(AG);
  const wired = fn ? new Function('readFileSync', 'WORKER', fn[0] + 'return wiredXmlFeeds();')(readFileSync, new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url).pathname) : [];
  t('agent: its roster reader picks up the wired .tsv feeds', ['ie', 'de', 'fr', 'nl'].every((k) => wired.some((f) => f.client === 'Superdry' && f.mkt === k + '-fb' && /\.tsv$/.test(f.url))), wired.length + ' wired');
  t('agent: it reads each feed through createFeedParser and refuses an override feed', /FA\.createFeedParser\(/.test(AG) && !/FA\.createXmlParser\(/.test(AG) && /FA\.isOverrideFeed\(head\)/.test(AG));
  ['FeedSpark_LabelGuard', 'FeedSpark_ProductTypeGuard', 'FeedSpark_GoldenRecord'].forEach((pg) => {
    const s = readFileSync(new URL('../docs/' + pg + '.html', import.meta.url), 'utf8');
    t(pg + ': the live rescan reads XML or a delimited file', /\(a\[0\]\.createFeedParser \|\| a\[0\]\.createXmlParser\)\(/.test(s) && !/var parser = a\[0\]\.createXmlParser\(/.test(s));
  });
  const LG = readFileSync(new URL('../docs/FeedSpark_LabelGuard.html', import.meta.url), 'utf8');
  t('Label Guard: the live rescan refuses a language override feed rather than posting every label as gone', /a\[0\]\.isOverrideFeed\(head\)/.test(LG));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
