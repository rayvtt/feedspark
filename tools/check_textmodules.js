#!/usr/bin/env node
/* Text-module tripwire.
 *
 * The worker imports two KINDS of .js: `./thing.js` is a real ES module (source it calls),
 * and `../../../docs/thing.js` is a FILE IT SERVES VERBATIM — a string, which only happens
 * because wrangler.toml's `rules` marks it as a Text module. Miss it there and esbuild
 * silently bundles it as an ES module instead: the import resolves to `undefined` (a UMD
 * file has no ESM default export), the route answers 200 with an EMPTY BODY, and a <script>
 * tag loads that without firing onerror and without a parse error. The page then sees no
 * global and no failure — which is how /images shipped with a dead engine.
 *
 * So: every docs/*.js the worker imports must be covered by a Text glob.
 *
 * .json is deliberately NOT checked: esbuild gives it a real parsed default export, and the
 * one we import (docs/i18n/vi.json) is correctly served with JSON.stringify — marking THAT
 * as Text would double-encode it. The hole is .js, where a UMD file has no default export
 * at all and the failure is therefore silent.
 *   node tools/check_textmodules.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');

// the Text rule's globs, as written
const m = /\{\s*type\s*=\s*"Text"\s*,\s*globs\s*=\s*\[([^\]]*)\]/.exec(toml);
if (!m) { console.log('✗ no Text rule found in wrangler.toml'); process.exit(1); }
const globs = m[1].split(',').map((g) => g.trim().replace(/^"|"$/g, '')).filter(Boolean);
const rx = globs.map((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*') + '$'));
const covered = (p) => rx.some((r) => r.test(p));

// every import the worker serves verbatim: a path that leaves src/ into docs/
const imports = [...worker.matchAll(/^import\s+[^;]*?from\s+"((?:\.\.\/)+docs\/[^"]+)";/gm)].map((x) => x[1]);
module.exports = { covered, globs };   // so a test can ask "is this a Text module?" without
                                       // hardcoding a filename glob of its own
if (require.main === module) main();
function main() {
let fail = 0, checked = 0;
for (const spec of imports) {
  const rel = path.relative(ROOT, path.resolve(ROOT, 'cloudflare/feedspark-deck/src', spec)).replace(/\\/g, '/');
  if (!/\.js$/.test(rel)) continue;        // see the .json note above
  checked++;
  if (!covered(rel)) {
    fail++;
    console.log('   ✗ ' + rel + ' is imported by the worker but NO Text glob covers it');
    console.log('     → it will bundle as an ES module and the route will serve an EMPTY body.');
    console.log('     → add a glob to wrangler.toml rules (Text).');
  }
}
if (!fail) console.log('✓ all ' + checked + ' worker-served docs imports are Text modules');
process.exit(fail ? 1 : 0);
}
