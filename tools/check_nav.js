#!/usr/bin/env node
/* Module-nav parity tripwire (Ray's standing rule, Aug 2026): the topbar menu must be
 * IDENTICAL on every FCC app page — same modules, same order, same icons — differing only
 * in which link is marked `.on` (the page's own module).
 *
 * docs/FeedSpark_Workflow.html is the canonical reference (the nav Ray signed off).
 * Adding a module = add its link to EVERY nav-bearing page in the same PR; this check
 * fails presync + qa_gate + CI the moment any page's nav drifts from the reference.
 *
 * Rules enforced:
 *   1. Every docs/FeedSpark_*.html page that carries a `.tb-modules` nav matches the
 *      reference exactly once ` on` markers are stripped (icons + labels + order included).
 *   2. Each page marks at most one link `.on`, and that href exists in the nav.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');
const REF_FILE = 'FeedSpark_Workflow.html';
const NAV_RE = /<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/;

function navOf(file) {
  const s = fs.readFileSync(path.join(DOCS, file), 'utf8');
  const m = s.match(NAV_RE);
  return m ? m[1] : null;
}
const canon = (nav) => nav.replace(/ class="tbm on"/g, ' class="tbm"');
const links = (nav) => [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

const pages = fs.readdirSync(DOCS).filter((f) => /^FeedSpark_.*\.html$/.test(f) && navOf(f) !== null);
const refNav = navOf(REF_FILE);
if (!refNav) { console.error(`✗ reference ${REF_FILE} has no .tb-modules nav`); process.exit(1); }
const refCanon = canon(refNav);
const refLinks = links(refNav);

let fail = 0;
for (const f of pages) {
  const nav = navOf(f);
  if (canon(nav) !== refCanon) {
    fail = 1;
    const l = links(nav);
    const missing = refLinks.filter((x) => !l.includes(x));
    const extra = l.filter((x) => !refLinks.includes(x));
    console.error(`✗ ${f} nav differs from ${REF_FILE}`);
    if (missing.length) console.error(`    missing: ${missing.join(', ')}`);
    if (extra.length) console.error(`    extra:   ${extra.join(', ')}`);
    if (!missing.length && !extra.length) console.error('    same links, different markup/order — copy the reference nav verbatim');
    continue;
  }
  const on = [...nav.matchAll(/href="([^"]+)" class="tbm on"/g)].map((m) => m[1]);
  if (on.length > 1) { fail = 1; console.error(`✗ ${f} marks ${on.length} links .on (${on.join(', ')}) — at most one`); continue; }
  if (on.length === 1 && !refLinks.includes(on[0])) { fail = 1; console.error(`✗ ${f} marks unknown href .on: ${on[0]}`); continue; }
  console.log(`✓ ${f} (${links(nav).length} links${on.length ? ', on=' + on[0] : ''})`);
}
console.log(`\n${pages.length} nav-bearing pages checked against ${REF_FILE}`);
if (fail) { console.error('✗ NAV PARITY FAILED — the module menu must stay identical on every page'); process.exit(1); }
console.log('PASS');
