#!/usr/bin/env node
/*
 * Parse every inline <script> in the FCC app pages and fail on a JavaScript syntax
 * error. The worker bundle build (wrangler --dry-run) proves the SERVER code compiles,
 * but the dashboard pages are served as-is — a syntax slip in one of their inline
 * scripts would ship a broken page. This is the client-side guard for that.
 *
 * Run locally:  node tools/check_inline_scripts.js
 * CI:           see .github/workflows/validate.yml
 */
const fs = require('fs'), vm = require('vm'), path = require('path');

const dir = path.join(__dirname, '..', 'docs');
const files = fs.readdirSync(dir).filter(f => /^FeedSpark_.*\.html$/.test(f)).sort();

let failed = 0, checked = 0;
for (const f of files) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  let ok = true, n = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '', body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;                       // external script, no inline body
    const type = (attrs.match(/type\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (type && !/javascript|ecmascript/i.test(type)) continue;  // JSON / template blocks, not JS
    if (!body.trim()) continue;
    n++;
    try { new vm.Script(body); }
    catch (e) { ok = false; failed++; console.error(`  ✗ ${f}  script #${n}: ${e.message}`); }
  }
  checked += n;
  console.log(`${ok ? '✓' : '✗'} ${f}  (${n} inline scripts)`);
}
console.log(`\n${checked} inline scripts checked across ${files.length} app pages`);
if (failed) { console.error(`\nFAIL: ${failed} inline script(s) have syntax errors`); process.exit(1); }
console.log('PASS');
