// feedspark.com redesign mockup (/website).
// Ray, 30 Sep 2026: "devise a proper website … highlight the main benefit of having a dedicated feed management
// system in the age of AI … use some visuals of the system … host the mockup site on FCC too", then "replace
// Tachyon with SparkAI"; v2, 1 Oct 2026: "website still looking a bit too 'AI done' — shake it up and use actual
// footage of FCC". The page is the layout of a PUBLIC site, so this harness pins what must never reach it —
// a client's name or a figure off the FeedHero screen recording, the retired AI name — and what makes it reviewable:
// every numbered review pin has its note, the live editor edits the copy and never the product renderings, and the
// route serves it as a document (editor only, no FCC chrome over a page that has to look like the real site).
// v2's figures are FOOTAGE (docs/website/, made by tools/website_media.js on the synthetic demo catalogue): every
// file the page names must exist, be bundled and be served — the MP4s by byte range, or Safari will not play them.
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
ok(/Northwind/.test(PAGE) && /demo (data|catalogue)/i.test(PAGE), 'the figures use the invented Northwind catalogue and say they are demo data');
ok(!/Tachyon/i.test(PAGE), 'the AI layer is SparkAI — "Tachyon" appears nowhere on the page');
ok((PAGE.match(/SparkAI/g) || []).length >= 6, 'SparkAI is named where the AI layer is presented');

console.log('\nReview layer');
const pins = [...new Set([...PAGE.matchAll(/data-note="(\d+)"/g)].map((m) => +m[1]))].sort((a, b) => a - b);
const notes = [...PAGE.matchAll(/<li id="mk-n(\d+)">/g)].map((m) => +m[1]);
ok(pins.length > 0 && pins.every((n) => notes.indexOf(n) >= 0), 'every numbered pin on the page has its note (' + pins.join(',') + ')');
ok(notes.every((n) => pins.indexOf(n) >= 0), 'every note is pinned somewhere on the page');
const badge = (PAGE.match(/Review notes\s*<em>(\d+)<\/em>/) || [])[1];
ok(+badge === notes.length, 'the Review notes badge counts the notes (' + badge + ')');

console.log('\nThe live editor edits copy, never the product renderings');
const sel = (PAGE.match(/window\.DECK_EDITOR_SELECTOR = '([^']+)'/) || [])[1] || '';
ok(sel.length > 0, 'the page declares its own editor selector');
ok(sel.split(',').every((x) => !/^(td|th|span|div)$/.test(x.trim())), 'no bare td / th / span / div — the FeedHero tables are not editable copy');
const fhA = PAGE.indexOf('id="fh-fig"'), fh = PAGE.slice(fhA, PAGE.indexOf('<figcaption>', fhA));
ok(fhA > 0 && fh.length > 1000 && !/<(p|h[1-4]|li)[\s>]/.test(fh), 'the redrawn FeedHero figure carries no p / h / li the editor would pick up');

console.log('\nThe footage (Command Center on the demo catalogue)');
const MEDIA = [...new Set([...PAGE.matchAll(/(?:src|poster)="website\/([a-z0-9-]+\.(?:mp4|webp))"/g)].map((m) => m[1]))].sort();
const dir = path.join(ROOT, 'docs/website');
const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')).sort() : [];
ok(MEDIA.length >= 8, MEDIA.length + ' figures name a file under website/');
ok(MEDIA.every((f) => onDisk.indexOf(f) >= 0), 'every file the page names is in docs/website/' + (MEDIA.filter((f) => onDisk.indexOf(f) < 0).length ? ' — missing ' + MEDIA.filter((f) => onDisk.indexOf(f) < 0).join(', ') : ''));
ok(onDisk.every((f) => MEDIA.indexOf(f) >= 0), 'nothing in docs/website/ is unused (every byte ships on every deploy)' + (onDisk.filter((f) => MEDIA.indexOf(f) < 0).length ? ' — unused ' + onDisk.filter((f) => MEDIA.indexOf(f) < 0).join(', ') : ''));
const bytes = onDisk.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
ok(bytes <= 2.5 * 1024 * 1024, 'the footage stays within 2.5 MB in all (' + (bytes / 1048576).toFixed(2) + ' MB) — it rides in the worker bundle');
const vids = [...PAGE.matchAll(/<video\b[^>]*>/g)].map((m) => m[0]);
ok(vids.length >= 3 && vids.every((v) => /\bmuted\b/.test(v) && /\bplaysinline\b/.test(v) && /poster="website\//.test(v) && /preload="metadata"/.test(v)), 'every video is muted, inline, metadata-only until played and has a poster frame');
ok(/prefers-reduced-motion: reduce/.test(PAGE) && /v\.pause\(\)/.test(PAGE) && (PAGE.match(/class="pp"/g) || []).length === vids.length, 'the footage never plays with reduced motion, pauses off screen and every clip has its own pause control');
ok([...PAGE.matchAll(/<img\b[^>]*>/g)].every((m) => /\balt="[^"]{20,}"/.test(m[0]) && /\bwidth="\d+"/.test(m[0]) && /\bheight="\d+"/.test(m[0])), 'every still says what it shows and reserves its box (alt, width, height)');
for (const f of MEDIA) ok(new RegExp("'" + f.replace(/[.-]/g, '\\$&') + "':\\s*\\{ body: WEB_[A-Z_]+, mime: '" + (f.endsWith('.mp4') ? 'video/mp4' : 'image/webp') + "' \\}").test(WORKER), 'the worker serves ' + f + ' with its type');
const imp = [...WORKER.matchAll(/import (WEB_[A-Z_]+) from "\.\.\/\.\.\/\.\.\/docs\/website\/([a-z0-9-]+\.(?:mp4|webp))";/g)];
ok(imp.length === MEDIA.length && imp.every((m) => MEDIA.indexOf(m[2]) >= 0), 'one import per file, no more (' + imp.length + ')');
ok(/\{ type = "Data", globs = \["\*\*\/website\/\*\.webp", "\*\*\/website\/\*\.mp4"\]/.test(read('wrangler.toml')), 'wrangler bundles docs/website/ as binary Data modules');
ok(/if \(path\.startsWith\('\/website\/'\) && \(request\.method === 'GET' \|\| request\.method === 'HEAD'\)\) \{\s*const f = WEBSITE_MEDIA\[path\.slice\('\/website\/'\.length\)\];\s*if \(!f\) return json\(\{ error: 'not_found' \}, 404\);\s*return mediaResponse\(request, f\);/.test(WORKER), 'GET/HEAD /website/<file> answers from the bundle, an unknown file is a 404');

// the Range answer, lifted out of the worker by name and run
const mA = WORKER.indexOf('function mediaResponse(request, f) {');
let depth = 0, mB = mA;
for (let i = WORKER.indexOf('{', mA); i < WORKER.length; i++) { if (WORKER[i] === '{') depth++; else if (WORKER[i] === '}' && --depth === 0) { mB = i + 1; break; } }
const mediaResponse = new Function(WORKER.slice(mA, mB) + '; return mediaResponse;')();
const body = new Uint8Array(1000).map((_, i) => i % 251).buffer;
const req = (range, method) => new Request('https://x/website/a.mp4', { method: method || 'GET', headers: range ? { range } : {} });
const F = { body, mime: 'video/mp4' };
const whole = mediaResponse(req(), F);
ok(whole.status === 200 && whole.headers.get('accept-ranges') === 'bytes' && whole.headers.get('content-length') === '1000' && whole.headers.get('content-type') === 'video/mp4', 'no Range: the whole file, 200, advertising byte ranges');
const r0 = mediaResponse(req('bytes=0-1'), F);
ok(r0.status === 206 && r0.headers.get('content-range') === 'bytes 0-1/1000' && r0.headers.get('content-length') === '2', 'bytes=0-1 (Safari\'s probe): 206, Content-Range 0-1/1000');
const r1 = mediaResponse(req('bytes=990-'), F);
const r1b = new Uint8Array(await r1.arrayBuffer());
ok(r1.status === 206 && r1.headers.get('content-range') === 'bytes 990-999/1000' && r1b.length === 10 && r1b[0] === 990 % 251, 'bytes=990-: the tail, the right bytes');
const r2 = mediaResponse(req('bytes=-100'), F);
ok(r2.status === 206 && r2.headers.get('content-range') === 'bytes 900-999/1000', 'bytes=-100: the last 100');
const r3 = mediaResponse(req('bytes=500-5000'), F);
ok(r3.status === 206 && r3.headers.get('content-range') === 'bytes 500-999/1000', 'an end past the file is clamped');
const r4 = mediaResponse(req('bytes=1000-'), F);
ok(r4.status === 416 && r4.headers.get('content-range') === 'bytes */1000', 'a start past the file is 416 with the size');
const r5 = mediaResponse(req('bytes=0-1,5-6'), F);
ok(r5.status === 200 && r5.headers.get('content-length') === '1000', 'a multi-range request is answered whole (allowed by the spec)');
const r6 = mediaResponse(req('bytes=0-1', 'HEAD'), F);
ok(r6.status === 206 && r6.body === null, 'HEAD carries the headers and no body');

console.log('\nBuilt to run under the FCC policy');
ok(!/<script[^>]+src=/.test(PAGE), 'no external scripts');
ok(!/<form[^>]*\saction=/.test(PAGE), 'the audit form posts nowhere (form-action is self; the mockup says nothing is sent)');
ok(/\[hidden\]\{display:none!important\}/.test(PAGE), 'a hidden flex/grid element really hides');
ok(!/wght@[^"']*\b(500|600)\b/.test(PAGE) && !/font-weight:\s*(500|600)/.test(PAGE), 'Lato 400 / 700 / 900 only');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
