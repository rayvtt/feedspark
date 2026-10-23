#!/usr/bin/env node
/* EVERY ROUTE THE WORKER WRITES IS A ROUTE THE ROUTER CAN REACH (23 Oct 2026 — Ray, over the
   Playbook rail with two sections reading "could not read": "these sections of playbook cannot
   fetch data").
   /api/spendlens, /api/testlab, /api/outcomes and both /api/compwatch routes had been written
   inside goldenRoutes(), which route() enters only on `/api/golden/`. Every one of them was
   therefore dead: the request fell through the router to the page handler, the rail's fetch got
   HTML back, r.json() threw, and the section printed the honest-but-cryptic words a failed read
   prints. Nothing failed loudly — the worker built, the harnesses (which LIFT a route's text out
   of the file) passed, and the route simply was not there.
   So this reads the router the way the runtime does: for every `path === '/api/…'` a sub-router
   answers, route() must dispatch that sub-router under a guard the path actually satisfies — a
   `startsWith` prefix it carries, or a Set that names it — and the FIRST dispatcher whose guard
   matches must be the one holding the route, or an earlier prefix swallows it.
   Usage: node tools/check_routes.js */
const fs = require('fs');
const SRC = 'cloudflare/feedspark-deck/src/worker.js';
const src = fs.readFileSync(SRC, 'utf8');
const lineOf = (i) => src.slice(0, i).split('\n').length;

// ---- every top-level `async function NAME(…) { … }`, by brace depth
const fns = {};
const fnRe = /^async function (\w+)\(([^)]*)\)\s*\{/gm;
for (let m; (m = fnRe.exec(src));) {
  let d = 0, i = m.index + m[0].length - 1, inS = '', esc = false;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inS) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inS) inS = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) break; }
  }
  fns[m[1]] = { name: m[1], args: m[2], from: m.index, to: i, body: src.slice(m.index, i + 1) };
}
if (!fns.route) { console.error('check_routes: no route() in ' + SRC); process.exit(1); }

// ---- the exact paths each sub-router answers
const pathsOf = (body) => {
  const out = [];
  for (let m, re = /path === '(\/api\/[^']+)'/g; (m = re.exec(body));) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
};
// ---- module-level `const NAME = new Set([...])`
const setOf = (name) => {
  const m = new RegExp('const ' + name + ' = new Set\\(\\[([^\\]]*)\\]\\)').exec(src);
  return m ? (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)) : null;
};

// ---- route()'s dispatchers, in the order the runtime meets them
const rb = fns.route.body, dispatch = [];
for (let m, re = /await (\w+)\(env, request, url[^)]*\)/g; (m = re.exec(rb));) {
  const fn = m[1];
  if (!fns[fn] || fn === 'route') continue;
  const head = rb.lastIndexOf('if (', m.index);
  const cond = head < 0 ? '' : rb.slice(head, rb.indexOf('{', head));
  const prefixes = (cond.match(/startsWith\('([^']+)'\)/g) || []).map((s) => s.slice(12, -2));
  const sets = (cond.match(/(\w+)\.has\(path\)/g) || []).map((s) => s.split('.')[0]);
  let named = [];
  sets.forEach((s) => { const v = setOf(s); if (v) named = named.concat(v); else named = null; });
  dispatch.push({ fn, at: m.index, prefixes, named: named || [], unreadable: named === null ? cond.trim() : '' });
}

let fail = 0;
const bad = (msg) => { console.log('  ✗ ' + msg); fail++; };
const good = (msg) => console.log('  ✓ ' + msg);

console.log('── routes the router can reach (' + SRC + ')');
dispatch.forEach((d) => { if (d.unreadable) bad(d.fn + ' is dispatched under a guard this checker cannot read: ' + d.unreadable); });

Object.keys(fns).forEach((name) => {
  if (name === 'route') return;
  const ps = pathsOf(fns[name].body);
  if (!ps.length) return;
  const mine = dispatch.filter((d) => d.fn === name);
  if (!mine.length) { bad(name + '() answers ' + ps.length + ' /api path(s) (' + ps[0] + ') and route() never calls it'); return; }
  ps.forEach((p) => {
    // the FIRST dispatcher whose guard matches this path is the one that gets it
    const first = dispatch.find((d) => d.prefixes.some((x) => p.indexOf(x) === 0) || d.named.indexOf(p) >= 0);
    if (!first) bad(p + ' is answered by ' + name + '() but no dispatch in route() matches it — the request falls through');
    else if (first.fn !== name) bad(p + ' is answered by ' + name + '() but ' + first.fn + '() is dispatched first and swallows it');
  });
  if (!ps.some((p) => {
    const first = dispatch.find((d) => d.prefixes.some((x) => p.indexOf(x) === 0) || d.named.indexOf(p) >= 0);
    return !first || first.fn !== name;
  })) good(name + '() — all ' + ps.length + ' path(s) reachable');
});

// a path named in a dispatch Set that nothing answers is the same mistake upside down
dispatch.forEach((d) => d.named.forEach((p) => {
  if (pathsOf(fns[d.fn].body).indexOf(p) < 0) bad(p + ' is dispatched to ' + d.fn + '() but that function answers no such path');
}));

console.log(fail ? '\n✗ ' + fail + ' unreachable route(s)' : '\n✓ every /api route a sub-router answers is reachable');
process.exit(fail ? 1 : 0);
