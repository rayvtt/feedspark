// feedspark.com redesign mockup (/website).
// Ray, 30 Sep 2026: "devise a proper website … highlight the main benefit of having a dedicated feed management
// system in the age of AI … use some visuals of the system … host the mockup site on FCC too", then "replace
// Tachyon with SparkAI". The page is the layout of a PUBLIC site, so this harness pins what must never reach it —
// a client's name or a figure off the FeedHero screen recording, the retired AI name — and what makes it reviewable:
// every numbered review pin has its note, the live editor edits the copy and never the product renderings, and the
// route serves it as a document (editor only, no FCC chrome over a page that has to look like the real site).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = read('docs/FeedSpark_Website.html');
const WORKER = read('cloudflare/feedspark-deck/src/worker.js');
const LEAD = read('docs/FeedSpark_Leadership.html');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };

console.log('Served as a document');
ok(/import WEBSITE_PAGE from "\.\.\/\.\.\/\.\.\/docs\/FeedSpark_Website\.html";/.test(WORKER), 'the page is bundled into the worker');
ok(/'\/website':\s*\{ html: WEBSITE_PAGE, slug: 'website' \}/.test(WORKER), '/website is in PAGES with its own edit slug');
const dp = (WORKER.match(/const DOC_PATHS = new Set\(\[([^\]]*)\]\)/) || [])[1] || '';
ok(dp.indexOf("'/website'") >= 0, '/website is a DOC path — the live editor only, no module nav, presence or chat bubble over the site');
ok(LEAD.indexOf('href="/website"') >= 0, 'the Leadership hub links to it');
ok((PAGE.match(/<\/body>/g) || []).length === 1, 'exactly one </body> — the worker injects the editor at the first one');

console.log('\nNothing private on a public-site layout');
const CLIENTS = ['Reiss', 'Schuh', 'Superdry', 'Monsoon', 'Accessorize', 'YuMOVE', 'YuMove', 'Lintbells', 'Hobbycraft', 'American Golf', 'House of Bruar', 'Estée Lauder', 'Estee Lauder', 'ELC'];
const hit = CLIENTS.filter((c) => new RegExp('\\b' + c + '\\b').test(PAGE));
ok(hit.length === 0, 'no client from the active book is named (case studies are by sector until the client signs off)' + (hit.length ? ' — found ' + hit.join(', ') : ''));
ok(!/60,577|3,521,473|239,829|Reiss GB/.test(PAGE), 'no figure from the FeedHero screen recording — the renderings carry invented data');
ok(/Northwind/.test(PAGE) && /illustrative data/i.test(PAGE), 'the renderings use the invented Northwind catalogue and say they are illustrative');
ok(!/Tachyon/i.test(PAGE), 'the AI layer is SparkAI — "Tachyon" appears nowhere on the page');
ok((PAGE.match(/SparkAI/g) || []).length >= 6, 'SparkAI is named where the AI layer is presented');

console.log('\nReview layer');
const pins = [...new Set([...PAGE.matchAll(/data-note="(\d+)"/g)].map((m) => +m[1]))].sort((a, b) => a - b);
const notes = [...PAGE.matchAll(/<li id="mk-n(\d+)">/g)].map((m) => +m[1]);
ok(pins.length > 0 && pins.every((n) => notes.indexOf(n) >= 0), 'every numbered pin on the page has its note (' + pins.join(',') + ')');
ok(notes.every((n) => pins.indexOf(n) >= 0), 'every note is pinned somewhere on the page');
const badge = (PAGE.match(/Review notes <em>(\d+)<\/em>/) || [])[1];
ok(+badge === notes.length, 'the Review notes badge counts the notes (' + badge + ')');

console.log('\nThe live editor edits copy, never the product renderings');
const sel = (PAGE.match(/window\.DECK_EDITOR_SELECTOR = '([^']+)'/) || [])[1] || '';
ok(sel.length > 0, 'the page declares its own editor selector');
ok(sel.split(',').every((x) => !/^(td|th|span|div)$/.test(x.trim())), 'no bare td / th / span / div — the FeedHero tables are not editable copy');
const tour = PAGE.slice(PAGE.indexOf('id="tour-win"'), PAGE.indexOf('id="tour-count"'));
ok(tour.length > 1000 && !/<(p|h[1-4]|li)[\s>]/.test(tour), 'the rebuilt FeedHero window carries no p / h / li the editor would pick up');

console.log('\nBuilt to run under the FCC policy');
ok(!/<script[^>]+src=/.test(PAGE), 'no external scripts');
ok(!/<form[^>]*\saction=/.test(PAGE), 'the audit form posts nowhere (form-action is self; the mockup says nothing is sent)');
ok(/\[hidden\]\{display:none!important\}/.test(PAGE), 'a hidden flex/grid element really hides');
ok(!/wght@[^"']*\b(500|600)\b/.test(PAGE) && !/font-weight:\s*(500|600)/.test(PAGE), 'Lato 400 / 700 / 900 only');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
