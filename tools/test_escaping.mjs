#!/usr/bin/env node
/* EVERY ESCAPER ESCAPES QUOTES (security checklist, 24 Sep 2026, item 15 "Escape user content").

   The FCC renders content it does not control: email subjects, senders and body snippets pushed in
   from ANY inbound message, product titles and custom-label values read off client feeds, task names
   derived from those subjects. Almost all of it is written into HTML strings, and a lot of it into
   ATTRIBUTE values — title="…", data-id="…".

   Workflow's main script block carried an esc() that escaped & < > and NOTHING ELSE, so a crafted
   email snippet closed the title attribute and added its own event handler, which then ran in the
   reader's authenticated session — the owner's, holding the whole book. Eight more pages carried the
   same escaper and six others escaped " but not ', which fails the same way inside a single-quoted
   attribute.

   The fix is one shape of function everywhere, so this harness reads every esc() in every page and
   widget AS SOURCE and fails any that cannot neutralise a quote. It also runs each one against the
   real payload rather than trusting the regex: a page that "looks right" but drops a character still
   fails here instead of on a live screen.

   Run: node tools/test_escaping.mjs   (qa_gate / presync / validate) */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
};

const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const pages = readdirSync(DOCS).filter((f) => f.endsWith('.html')).sort();

/* pull each `function esc(...)` out whole — brace-balanced, so a multi-line one is read entire
   rather than judged on its first line (that misread is what produced a false positive the first
   time this sweep ran). */
function escapers(src) {
  const out = [];
  const re = /\bfunction\s+esc\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index);
    if (open < 0) continue;
    let depth = 0, end = open;
    for (let i = open; i < src.length && i < open + 4000; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, body: src.slice(m.index, end + 1) });
  }
  return out;
}

/* the payload that made the live bug exploitable: a double quote closing the attribute, then a
   handler. Single-quoted attributes are in use too, so an apostrophe has to go as well. */
const PAYLOAD = '" onmouseenter="x" \' onfocus=\'y\'';

console.log('Escapers — every page and widget');
let total = 0;
for (const f of pages) {
  const src = readFileSync(join(DOCS, f), 'utf8');
  for (const e of escapers(src)) {
    total++;
    let fn = null;
    try { fn = new Function('return (' + e.body + ')')(); } catch (_) { /* reported below */ }
    const label = basename(f) + ':' + e.line;
    if (typeof fn !== 'function') { ok(label + ' parses', false, e.body.slice(0, 60)); continue; }
    const out = String(fn(PAYLOAD));
    ok(label, !out.includes('"') && !out.includes("'") && !out.includes('<') && !out.includes('>'),
       out.slice(0, 70));
  }
}
ok('found escapers to check (the sweep is not silently reading nothing)', total >= 20, total);

/* the specific render that was exploitable, rebuilt from the page's own line so this fails if the
   email panel ever goes back to building the attribute another way. */
console.log('\nThe email-triage render that carried the bug');
const wf = readFileSync(join(DOCS, 'FeedSpark_Workflow.html'), 'utf8');
const wfLines = wf.split('\n');
const subjLine = wfLines.findIndex((l) => l.includes('class="em-subj" title="'));
ok('Workflow still renders the email snippet into an attribute (guard is still needed)', subjLine >= 0);
if (subjLine >= 0) {
  ok('…and it goes through esc()', /title="'\+esc\(/.test(wfLines[subjLine].replace(/\s/g, '')),
     wfLines[subjLine].trim().slice(0, 90));
}

/* no page may reintroduce the weak shape */
console.log('\nThe weak shape is gone from the tree');
for (const f of pages) {
  const src = readFileSync(join(DOCS, f), 'utf8');
  for (const e of escapers(src)) {
    const weak = !/&quot;|&#34;/.test(e.body);
    if (weak) ok(basename(f) + ':' + e.line + ' escapes a double quote', false, e.body.slice(0, 70));
  }
}
ok('no escaper in docs/ omits double-quote escaping', true);

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed');
process.exit(fail ? 1 : 0);
