#!/usr/bin/env node
// WORKFLOW YAML TRIPWIRE. A syntax error in .github/workflows/*.yml does not fail CI — it stops
// the workflow being created at all, so the run completes in ZERO seconds with no jobs and the PR
// looks like it simply has no CI rather than a red one. That is the worst failure shape there is,
// and it is exactly what an unquoted colon in a step name produced (PR #746: "Pair scan harness
// (the Pockets method: ratio bands …)" — YAML read the colon as a mapping and the whole file died).
//
// Parsed with js-yaml when the repo has it, else python3 + PyYAML, else a targeted scan for the
// one shape that actually bites: a `- name:` / `name:` value that is unquoted and contains ": ".
// Every path degrades to SOMETHING rather than passing silently.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const dir = path.join(__dirname, '..', '.github', 'workflows');
if (!fs.existsSync(dir)) { console.log('no .github/workflows — nothing to check'); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => path.join(dir, f));
let bad = 0, how = 'scan';

let Y = null;
try { Y = require('js-yaml'); how = 'js-yaml'; } catch (e) { /* not installed */ }
if (!Y) {
  const probe = cp.spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
  if (probe.status === 0) how = 'python3+PyYAML';
}

for (const f of files) {
  const rel = path.relative(path.join(__dirname, '..'), f), src = fs.readFileSync(f, 'utf8');
  let err = null, jobs = null;
  if (how === 'js-yaml') {
    try { const d = Y.load(src); jobs = d && d.jobs ? Object.keys(d.jobs).length : 0; }
    catch (e) { err = e.message.split('\n')[0]; }
  } else if (how === 'python3+PyYAML') {
    const r = cp.spawnSync('python3', ['-c',
      'import sys,yaml,json\nd=yaml.safe_load(open(sys.argv[1]))\nprint(len((d or {}).get("jobs",{})))', f],
      { encoding: 'utf8' });
    if (r.status !== 0) err = (r.stderr || '').trim().split('\n').filter(Boolean).pop();
    else jobs = parseInt(r.stdout.trim(), 10);
  } else {
    // last resort: the unquoted-colon-in-a-name shape, which is what breaks these files in practice
    src.split('\n').forEach((ln, i) => {
      const m = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(ln);
      if (!m) return;
      const v = m[1];
      if (/^["']/.test(v) || /^[|>]/.test(v)) return;
      if (/:\s/.test(v)) err = 'line ' + (i + 1) + ': unquoted name contains ": " — quote it';
    });
  }
  if (err) { console.log('  ✗ ' + rel + ' — ' + err); bad++; }
  else console.log('  ✓ ' + rel + (jobs != null ? ' (' + jobs + ' job' + (jobs === 1 ? '' : 's') + ')' : ''));
}
console.log('\n' + files.length + ' workflow file(s) checked via ' + how);
if (bad) { console.log('FAIL: ' + bad + ' workflow file(s) will not parse — GitHub would create NO run at all'); process.exit(1); }
console.log('PASS');
