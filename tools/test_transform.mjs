#!/usr/bin/env node
/* AI TRANSFORMATION ROADMAP harness (Ray, 24 Sep 2026: "a month-by-month migration roadmap until
 * completion … a roadmap for a live dashboard migration so I can keep track with my management").
 *
 * Lifts the roadmap data (RM) and its pure engine (TX) out of docs/FeedSpark_Transformation.html
 * BY MARKER and runs them in a bare sandbox, then checks the wiring the page depends on:
 *   - the roadmap is internally consistent (ids unique, every month has a gate, every owner is a role)
 *   - the progress maths (late = an earlier month not closed; dropped leaves the total)
 *   - the status update a manager pastes into an email says what is late and what needs deciding
 *   - the page is an OPT-IN module and /api/transform refuses anyone not granted it
 *   - NO MONEY ON THE PAGE: Andy and Matt read this board, and the rate Ray is negotiating with
 *     them must never ship in it — a £ sign here is a leak, not a typo
 * Run: node tools/test_transform.mjs   (qa_gate / presync / validate)
 */
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Transformation.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
const WF = fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Workflow.html'), 'utf8');
const ACCESS = fs.readFileSync(path.join(ROOT, 'cloudflare/feedspark-deck/src/access.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return s.slice(i + a.length, j); };

const ctx = {};
vm.createContext(ctx);
vm.runInContext(between(PAGE, '/* RM:START */', '/* RM:END */') + '\n' + between(PAGE, '/* TX:ENGINE:START */', '/* TX:ENGINE:END */') + '\nthis.RM=RM;this.TX=TX;', ctx);
const { RM, TX } = ctx;

console.log('Roadmap shape');
const months = RM.months.map((m) => m.k);
ok(months.join(',') === '2026-10,2026-11,2026-12,2027-01,2027-02,2027-03,2027-04', 'seven months, October 2026 to April 2027, in order');
const ids = RM.items.map((i) => i.id);
ok(new Set(ids).size === ids.length, 'every milestone id is unique (' + ids.length + ')');
ok(RM.items.every((i) => months.includes(i.m)), 'every milestone sits in a roadmap month');
ok(RM.items.every((i) => RM.ws[i.ws]), 'every milestone names a known workstream');
const roleIds = RM.roles.map((r) => r.id);
ok(RM.items.every((i) => roleIds.includes(i.o)), 'every milestone is owned by a named role');
ok(RM.decisions.every((d) => roleIds.includes(d.o) && months.includes(d.due)), 'every decision has an owner role and a due month');
ok(months.every((k) => RM.items.some((i) => i.m === k && i.gate)), 'every month carries a gate');
ok(Object.keys(RM.ws).every((w) => RM.items.some((i) => i.ws === w)), 'every workstream has work in it');
ok(RM.items.some((i) => i.id === 'n-cut' && i.gate) && RM.months[1].freeze, 'the November cut-over is a gate and the month shows the peak freeze');
ok(RM.items.some((i) => i.id === 'o-scope' && i.m === '2026-10'), 'access profiles for new AMs land in October, before wave 1 signs in');
ok(RM.items.some((i) => i.id === 'm-decom' && i.gate), 'personal-account decommission is the March gate');
ok(new Set(RM.decisions.map((d) => d.id)).size === RM.decisions.length && RM.decisions.length === 13, 'thirteen decisions, ids unique');
ok(RM.model.zones.reduce((a, z) => a + z.share, 0) === 100, 'the operating-model shares add up to 100');
ok(RM.model.zones[0].share >= 60 && RM.model.zones[0].share <= 75, 'the fixed core is roughly 70% of the product');
ok(RM.sources.some((s) => /Desk Manager/.test(s.n) && s.st === 'Not connected'), 'Desk Manager is listed honestly as not connected');
ok(RM.ams.length === 5 && RM.ams.filter((a) => a.wave === 1).length === 2, 'five AMs in two waves (2 + 3)');
ok(new Set(RM.kpis.map((k) => k.id)).size === RM.kpis.length && new Set(RM.risks.map((r) => r.id)).size === RM.risks.length, 'KPI and risk ids unique');

console.log('Progress maths');
const s0 = TX.summary(RM, {}, '2026-09');
ok(s0.started === false && s0.cur === '2026-10' && s0.late.length === 0, 'before October nothing is late and the first month is shown');
ok(s0.done === RM.items.filter((i) => i.st0 === 'done').length, 'seeded done milestones count as done');
const s1 = TX.summary(RM, {}, '2026-11');
const octOpen = RM.items.filter((i) => i.m === '2026-10' && i.st0 !== 'done').length;
ok(s1.late.length === octOpen, 'in November every open October milestone is late (' + octOpen + ')');
const closeAll = {};
RM.items.filter((i) => i.m === '2026-10').forEach((i, n) => { closeAll['i:' + i.id] = { st: n % 2 ? 'done' : 'na' }; });
const s2 = TX.summary(RM, closeAll, '2026-11');
ok(s2.late.length === 0, 'done or dropped October milestones are not late');
ok(s2.total === RM.items.length - Math.ceil(RM.items.filter((i) => i.m === '2026-10').length / 2), 'a dropped milestone leaves the total');
ok(TX.statusOf({ id: 'x', st0: 'doing' }, { 'i:x': { st: 'blocked' } }) === 'blocked', 'a recorded status beats the seed');
ok(TX.summary(RM, {}, '2026-10').gate.id === 'o-dec', 'the next gate is the first unclosed gate');
ok(TX.summary(RM, { 'd:D1': { st: 'decided' }, 'd:D2': { st: 'proposed' } }, '2026-10').decided === 1, 'only decided decisions count as signed');
ok(TX.amsActive(RM, { 'a:1': { st: 'onboarded' }, 'a:2': { st: 'active' }, 'a:3': { st: 'invited' } }) === 2, 'AMs onboarded = onboarded + active only');

console.log('Status update');
const upd = TX.update(RM, { 'i:o-census': { st: 'blocked', note: 'waiting on\nIT' } }, '2026-11', '1 Nov 2026');
ok(/Overall: \d+ of \d+ milestones done/.test(upd), 'opens with the overall count');
ok(/This month — November 2026/.test(upd), 'names the current month');
ok(/Late \(\d+\):/.test(upd) && /October 2026 — Data census of the live store/.test(upd), 'lists what is late by month');
ok(/Blocked:\n  Data census of the live store — waiting on IT/.test(upd), 'lists what is blocked, note flattened to one line');
ok(/Decisions needed now:/.test(upd) && /D1 End state/.test(upd), 'lists the decisions due by now');
ok(/Red risks:/.test(upd), 'lists the red risks');

console.log('Access and wiring');
ok(/slug: 'transformation'[^}]*optIn: true/.test(ACCESS), 'transformation is an opt-in module in access.js');
ok(/import TRANSFORM_PAGE from "..\/..\/..\/docs\/FeedSpark_Transformation.html"/.test(WORKER), 'the worker imports the page');
ok(/'\/transformation':\s*\{ html: TRANSFORM_PAGE, slug: 'transformation' \}/.test(WORKER), '/transformation is served from PAGES');
const api = between(WORKER, "if (path === '/api/transform') {", "// ---- Build Log queue");
ok(/moduleAllowed\(acc\.modules, 'transformation'\)/.test(api) && api.indexOf('403') < api.indexOf('mapStoreRoute'), '/api/transform refuses a signin not granted the module, before touching the store');
ok(/mapStoreRoute\(env, request, 'transform'/.test(api), '/api/transform is a kvmerge store (concurrent edits merge)');
ok(/'\/api\/transform': 'transform-save'/.test(WORKER), 'writes are logged in the activity log');
ok(/acl-mchip:not\(\.opt\)/.test(WF) && /m\.optIn\?!!\(msel&&msel\[m\.slug\]\)/.test(WF), 'the Access panel never ticks an opt-in module by default or via All');

console.log('Nothing commercial on the page');
ok(PAGE.indexOf('£') < 0 && !/day rate|per day|retainer fee|negotiat/i.test(PAGE.replace(/<script>[\s\S]*?RM:START/, '')), 'no £ figure or rate talk on a page management reads');
ok(/X-Sync-Base/.test(PAGE) && /retrying in/.test(PAGE), 'the page saves with a read-stamp and retries a failed save on screen');

console.log('\nRESULT: ' + (failed ? 'FAIL — ' + failed + ' failed, ' : 'PASS — ') + passed + ' assertions');
process.exit(failed ? 1 : 0);
