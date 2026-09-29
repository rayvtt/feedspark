#!/usr/bin/env node
/*
 * Spot illustrations — the set, the placement rule, and where it is wired.
 *
 * Ray, 29 Sep 2026, over Google Merchant Center's "What to do next" cards: "do a quick review of
 * latest 10 modules just build on FCC to generate / add in icons like (similar) to GMC like this
 * to ease on eye strain". ONE set (docs/spots_widget.html), one drawing language, placed by one
 * attribute (data-spot) on the hero and the main cards of the ten newest modules. This pins:
 * every spot is a well-formed, class-only SVG (so the set re-colours from the stylesheet and never
 * carries a page's own colours), the dark set and the phone/print rules exist, every data-spot a
 * page names exists, the ten modules carry a hero spot and at least two card spots, the worker
 * injects the widget in its place, every render tripwire carries it, and /design documents the
 * whole set from the widget's own names.
 *
 *   node tools/test_spots.mjs      (qa_gate / presync / validate)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

const WIDGET = read('docs/spots_widget.html');
const js = (WIDGET.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
const css = (WIDGET.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';

// ── 1 · the set, lifted from the widget by running its script against a bare document
const win = {};
const doc = { readyState: 'complete', body: {}, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ setAttribute() {}, classList: { add() {} } }) };
new Function('window', 'document', 'MutationObserver', js)(win, doc, function () { this.observe = function () {}; });
const S = win.FCCSpots;
ok(S && Array.isArray(S.names) && S.names.length === 16, 'the widget exposes sixteen spots');
const NAMES = S ? S.names : [];
const CLASSES = new Set(['g', 'p', 'l', 'la', 'lb', 'ld', 'lf', 'd', 'c', 'a', 'ad', 'at', 'wf', 'w', 'ws']);
for (const n of NAMES) {
  const svg = S.svg(n);
  ok(/^<svg viewBox="0 0 96 96" aria-hidden="true" focusable="false">/.test(svg) && /<\/svg>$/.test(svg), n + ': a 96-grid, decorative svg');
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(svg) && !/\b(fill|stroke|style)=/.test(svg), n + ': no colour written into the drawing — classes only');
  ok(!/<script|<image|href=|url\(/.test(svg), n + ': nothing but shapes');
  // balanced: every opened element is self-closed or closed
  const open = [...svg.matchAll(/<([a-z]+)\b[^>]*?(\/?)>/g)].filter((m) => m[1] !== 'svg');
  const closes = [...svg.matchAll(/<\/([a-z]+)>/g)].filter((m) => m[1] !== 'svg').length;
  ok(open.every((m) => m[2] === '/') && closes === 0, n + ': every shape self-closes');
  const cls = [...svg.matchAll(/class="([a-z ]+)"/g)].flatMap((m) => m[1].split(' '));
  ok(cls.length > 0 && cls.every((c) => CLASSES.has(c)), n + ': every class is one of the palette classes (' + cls.filter((c) => !CLASSES.has(c)).join(',') + ')');
  ok(/class="a"|class="la"|class="lb"/.test(svg), n + ': carries the one orange accent');
  ok(/class="g"/.test(svg), n + ': sits on the soft disc');
}

// ── 2 · the stylesheet: light tokens, a dark set, the three placements, the phone and print rules
ok(/\.spot\{[^}]*--sp-paper:#fff[^}]*--sp-orange:#F5A623/.test(css), 'light palette tokens on .spot');
ok(/\[data-theme=dark\] \.spot\{--sp-paper:#1C1F27;--sp-grey:#20242E;--sp-line:#2C3039/.test(css), 'a dark set — no light island in the dark theme');
for (const cl of CLASSES) ok(new RegExp('\\.spot \\.' + cl + '\\{').test(css), 'palette class .' + cl + ' is styled');
ok(/\.spot-card\{width:44px;height:44px/.test(css) && /\.spot-corner\{position:absolute/.test(css) && /\.spot-hero\{position:absolute;right:22px;top:-4px;width:72px;height:72px\}/.test(css), 'three placements: header row, corner, hero — the hero art the height of eyebrow + title, so it ends above the status row whose buttons sit at the right');
ok(/\.spot-host-hero>\.eyebrow,\.spot-host-hero>h1,\.spot-host-hero>\.sub\{padding-right:96px\}/.test(css), 'the hero text keeps clear of the art');
ok(!/max-width:1100px/.test(css), 'one hero size on every desktop width — no step-down to keep in sync');
ok(/\.spot-row>\.spot\+\*\{max-width:calc\(100% - 64px\)\}/.test(css), 'the title block is capped at the row less the spot, so a wrapping row never drops it under the spot (the /roas Performance card did)');
ok(/@media \(max-width:760px\)\{\s*\.spot-hero\{display:none\}/.test(css), 'the hero art is not drawn on a phone');
ok(/@media print\{\.spot\{display:none!important\}\}/.test(css), 'never printed');
ok(/\.mod>\.chead>\.spot-card\{width:34px/.test(css), 'the Catalogue\'s module tiles get the small size');

// ── 3 · the placement rule
ok(/':scope > \.chead, :scope > \.blk-h, :scope > \.cw-head, :scope > \.thead'/.test(js), 'header rows: .chead / .blk-h / .cw-head / .thead');
ok(/host\.closest\('\.hero'\)/.test(js) && /'spot-hero'/.test(js), 'a host inside .hero takes the hero placement');
ok(/s\.style\.right = cs\.paddingRight; s\.style\.top = \(parseFloat\(cs\.paddingTop\) - 4\) \+ 'px'/.test(js), 'the hero offsets are read off the host\'s own padding — the padded .wrap on most pages, the padded .hero section on /tasks — never assumed');
ok(/row\.insertBefore\(make\(name, 'spot-card'\), row\.firstChild\)/.test(js), 'on a header row the spot is prepended — left of the title, clear of the tools');
ok(/'spot-corner'/.test(js) && /spot-host-corner/.test(js), 'no header row → the corner');
ok(/data-spot-done/.test(js) && /\[data-spot\]:not\(\[data-spot-done\]\)/.test(js), 'idempotent — a host is placed once');
ok(/setAttribute\('aria-hidden', 'true'\)/.test(js), 'decorative');
ok(/MutationObserver/.test(js) && /addedNodes/.test(js), 'a card rendered after load gets its spot');

// ── 4 · the pages: every name exists; the ten newest modules carry a hero spot and ≥2 card spots
const PAGES = ['AIVisibility', 'Stock', 'Rules', 'Catalog', 'Transformation', 'ROAS', 'TaskManager', 'Images', 'Schedule', 'Design'];
const all = fs.readdirSync(path.join(root, 'docs')).filter((f) => /^FeedSpark_.*\.html$/.test(f));
for (const f of all) {
  const src = read('docs/' + f);
  // attributes on tags only — /design's prose shows the attribute inside <code>, which is not a host
  const used = [...src.matchAll(/<[a-z][^>]*\sdata-spot="([^"]*)"/g)].map((m) => m[1]);
  ok(used.every((u) => NAMES.includes(u)), f + ': every data-spot names a spot (' + used.filter((u) => !NAMES.includes(u)).join(',') + ')');
  ok(!/<\/[a-z0-9]+ data-spot=/.test(src), f + ': the attribute sits on an opening tag');
}
for (const p of PAGES) {
  const src = read('docs/FeedSpark_' + p + '.html');
  const hero = src.match(/<(?:header|section) class="hero"(?: data-spot="([a-z]+)")?>(?:<div class="wrap" data-spot="([a-z]+)">)?/);
  ok(hero && (hero[1] || hero[2]), p + ': the hero carries a spot');
  const cards = [...src.matchAll(/<(?:section|div) class="(?:card|blk)[^"]*"[^>]*data-spot="([a-z]+)"/g)].length;
  ok(cards >= 2, p + ': at least two cards carry a spot (' + cards + ')');
}

// ── 5 · wiring: the worker, the render tripwires, the design page, CLAUDE.md
const W = read('cloudflare/feedspark-deck/src/worker.js');
ok(/import SPOTSW from "\.\.\/\.\.\/\.\.\/docs\/spots_widget\.html";/.test(W), 'the worker imports the widget');
ok(/NAVROWW \+ '\\n' \+ SPOTSW \+ '\\n' \+ HOURSW/.test(W), 'injected after the module row, before the hours badge');
for (const t of ['check_mobile.js', 'check_darkmode.js', 'check_grpdf.js', 'check_grmobile.js', 'check_navrow.js']) {
  ok(read('tools/' + t).includes("'spots_widget.html'"), t + ' renders with the widget');
}
const D = read('docs/FeedSpark_Design.html');
ok(/<section class="blk" id="spots" data-spot="images">/.test(D) && /href="#spots"/.test(D), '/design has the Spot illustrations section and its chip');
ok(/window\.FCCSpots/.test(D) && /S\.names\.map/.test(D), 'the gallery is drawn from the widget\'s own names — it can never list a spot that does not exist');
for (const n of NAMES) ok(new RegExp('\\b' + n + ":'").test(D), '/design says what ' + n + ' is for');
ok(/data-spot="name"/.test(D) && /One per card, never two/.test(D), '/design states the rule');
ok(/spots_widget\.html/.test(read('CLAUDE.md')), 'CLAUDE.md names the widget');

console.log(`\ntest_spots: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
