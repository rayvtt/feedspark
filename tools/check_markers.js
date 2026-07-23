#!/usr/bin/env node
/*
 * Shipped-feature tripwire (multi-session overwrite guard).
 * Reads docs/feature_manifest.json and fails if any shipped feature's marker has
 * regressed — the signature of one session's merge clobbering another's work.
 *
 * Run locally:  node tools/check_markers.js
 * CI:           validate.yml + tools/presync.sh
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'feature_manifest.json'), 'utf8'));

let failed = 0;
for (const m of manifest.markers) {
  const file = path.join(root, m.file);
  if (!fs.existsSync(file)) { failed++; console.error(`✗ ${m.name} — FILE MISSING: ${m.file} (shipped in PR #${m.pr})`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const re = new RegExp(m.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const count = (src.match(re) || []).length;
  if (m.forbidden) {
    if (count > 0) { failed++; console.error(`✗ ${m.name} — pattern "${m.pattern}" REAPPEARED ×${count} in ${m.file} (retired in PR #${m.pr})`); }
    else console.log(`✓ ${m.name} (absent, as required)`);
  } else {
    const min = m.min || 1;
    if (count < min) { failed++; console.error(`✗ ${m.name} — expected ≥${min} of "${m.pattern}" in ${m.file}, found ${count} (shipped in PR #${m.pr})`); }
    else console.log(`✓ ${m.name} (${count})`);
  }
}
console.log(`\n${manifest.markers.length} shipped-feature markers checked`);
if (failed) { console.error(`\nFAIL: ${failed} marker(s) regressed — a merge has likely overwritten another session's shipped work. Restore it (or, if retiring the feature deliberately, update docs/feature_manifest.json in the same PR).`); process.exit(1); }
console.log('PASS');
