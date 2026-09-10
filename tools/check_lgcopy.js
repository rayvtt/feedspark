#!/usr/bin/env node
// docs/labelguard_engine.js is the BROWSER-SERVED copy of src/labelguard.js (served at
// /labels/engine.js for the guard pages' in-browser live rescan). wrangler cannot treat
// one file as both a bundled ES module (the worker's import) and a Text module (the
// served source), so the copy is committed — and this tripwire keeps it byte-identical.
// Fix a drift with:  cp cloudflare/feedspark-deck/src/labelguard.js docs/labelguard_engine.js
const { readFileSync } = require('node:fs');
const src = readFileSync(__dirname + '/../cloudflare/feedspark-deck/src/labelguard.js', 'utf8');
const copy = readFileSync(__dirname + '/../docs/labelguard_engine.js', 'utf8');
if (src === copy) { console.log('✓ docs/labelguard_engine.js is byte-identical to src/labelguard.js'); process.exit(0); }
console.error('✗ docs/labelguard_engine.js has DRIFTED from cloudflare/feedspark-deck/src/labelguard.js');
console.error('  The browser live-rescan would run different code than the worker/agent.');
console.error('  Fix: cp cloudflare/feedspark-deck/src/labelguard.js docs/labelguard_engine.js');
process.exit(1);
