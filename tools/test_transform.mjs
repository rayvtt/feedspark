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
const WIDGET = fs.readFileSync(path.join(ROOT, 'docs/migration_widget.html'), 'utf8');
const { MIG_SEED, MIG_STATES, migrationView, migrationPathOf } = await import('../cloudflare/feedspark-deck/src/migration.js');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.log('  ✗ ' + m); } };
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); if (i < 0 || j < 0) throw new Error('marker missing: ' + a); return s.slice(i + a.length, j); };

const ctx = {};
vm.createContext(ctx);
vm.runInContext(between(PAGE, '/* RM:START */', '/* RM:END */') + '\n' + between(PAGE, '/* TX:ENGINE:START */', '/* TX:ENGINE:END */') + '\nthis.RM=RM;this.TX=TX;', ctx);
const { RM, TX } = ctx;

console.log('Roadmap shape');
const months = RM.months.map((m) => m.k);
ok(months.join(',') === '2026-10,2026-11,2026-12,2027-01,2027-02,2027-03', 'six months, October 2026 to March 2027, in order');
ok(RM.items.filter((i) => i.ws === 'mig' && /^Module wave|Personal accounts decommissioned/.test(i.t)).every((i) => i.m <= '2026-12'), 'every module wave and the decommission land by December (migration done by year end)');
ok(RM.items.some((i) => i.id === 'j-live' && i.m === '2027-01' && i.gate), 'January opens on the first live iteration with every AM, as a gate');
ok(RM.modules.every((m) => m.m <= '2026-12'), 'every module is planned to migrate by December');
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
ok(RM.items.some((i) => i.id === 'o-scope' && i.m === '2026-12'), 'access profiles land in December, before the AMs start in January');
ok(RM.items.some((i) => i.id === 'm-decom' && i.gate), 'personal-account decommission is the March gate');
ok(new Set(RM.decisions.map((d) => d.id)).size === RM.decisions.length && RM.decisions.length === 13, 'thirteen decisions, ids unique');
ok(RM.model.zones.reduce((a, z) => a + z.share, 0) === 100, 'the operating-model shares add up to 100');
ok(RM.model.zones[0].share >= 60 && RM.model.zones[0].share <= 75, 'the fixed core is roughly 70% of the product');
ok(RM.sources.some((s) => /Desk Manager/.test(s.n) && s.st === 'Not connected'), 'Desk Manager is listed honestly as not connected');
ok(RM.ams.length === 5 && RM.ams.filter((a) => a.wave === 1).length === 2, 'five AMs in two waves (2 + 3)');
ok(RM.items.filter((i) => i.chk).every((i) => Array.isArray(i.chk) && i.chk.length && i.chk.every((t) => typeof t === 'string' && t)), 'every seeded checklist is a list of wording');
ok(RM.modtpl.length >= 6, 'every module carries the module-migration checklist template');
ok(RM.rules.length && RM.sources.every((x) => x.id) && RM.rules.every((x) => x.id), 'rules and sources carry ids, so each row is editable');
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

console.log('Editable roadmap — changes laid over the seed');
const base = TX.view(RM, {});
ok(base.items.length === RM.items.length && base.items[0].id === RM.items[0].id, 'with no changes the view IS the seed, in order');
const Sx = {
  'c:items:o-reg': { t: 'Register signed', by: 'Andy', at: 1 },
  'c:items:o-census': { del: 1 },
  'c:items:u1': { add: 1, t: 'A new card', m: '2026-11', ws: 'am', o: 'cto', at: 5 },
  'c:items:o-infra': { m: '2027-01', ord: -5 },
  'c:months:2027-05': { add: 1, name: 'May 2027', theme: 'Server move' },
  'c:decisions:D6': { del: 1 },
  'c:risks:u9': { add: 1, t: 'New risk', m: 'Watch it', rag: 'a' },
};
const vx = TX.view(RM, Sx);
ok(vx.items.find((i) => i.id === 'o-reg').t === 'Register signed' && !('by' in vx.items.find((i) => i.id === 'o-reg')), 'an edited field wins; the stamp never leaks into the row');
ok(!vx.items.some((i) => i.id === 'o-census'), 'a deleted card is gone');
ok(vx.items.some((i) => i.id === 'u1' && i.m === '2026-11' && i.t === 'A new card'), 'an added card appears with its own id');
ok(vx.items.filter((i) => i.m === '2027-01')[0].id === 'o-infra', 'a dragged card lands in its new month, at the position its ord gives');
ok(vx.months.some((m) => m.k === '2027-05' && m.theme === 'Server move') && vx.months[vx.months.length - 1].k === '2027-05', 'an added month joins the end of the board');
ok(TX.view(RM, { 'c:items:u2': { add: 1, t: 'x', m: '2027-08' } }).months.some((m) => m.k === '2027-08' && m.name === 'August 2027'), 'a card in a month nobody created still gets its column');
ok(vx.decisions.length === RM.decisions.length - 1 && vx.risks.some((r) => r.id === 'u9'), 'decisions and risks edit the same way');
ok(TX.nextMonth('2026-12') === '2027-01' && TX.monthName('2027-03') === 'March 2027', 'month arithmetic crosses the year');
const it = RM.items.find((i) => i.id === 'n-cut');
const cl = TX.checklist('i.n-cut', it.chk, { 'chk:i.n-cut|s0': { done: true }, 'chk:i.n-cut|s1': { del: 1 }, 'chk:i.n-cut|s2': { t: 'Reworded' }, 'chk:i.n-cut|lx': { add: 1, t: 'Added line', ord: 999 } });
ok(cl.length === it.chk.length && cl[0].done && cl.some((l) => l.t === 'Reworded') && cl[cl.length - 1].t === 'Added line', 'a checklist: ticked, reworded, removed and added lines all hold');
ok(TX.prog(cl).done === 1 && TX.prog(cl).n === cl.length, 'checklist progress counts done lines');
ok(TX.modState(RM.modules[0], {}) === 'legacy' && TX.modState(RM.modules[0], { 'mod:/feedchat': { st: 'bogus' } }) === 'legacy', 'a module with no (or a nonsense) state reads Not migrated');
ok(TX.modState(RM.modules[0], { 'mod:/feedchat': { st: 'migrated' } }) === 'migrated', 'a recorded module state is read');
ok(TX.summary(RM, { 'mod:/feedchat': { st: 'migrated' }, 'mod:/volume': { st: 'migrating' } }, '2026-10').mods.migrated === 1, 'the summary counts modules by state');

console.log('Status update');
const upd = TX.update(RM, { 'i:o-census': { st: 'blocked', note: 'waiting on\nIT' } }, '2026-11', '1 Nov 2026');
ok(/Overall: \d+ of \d+ milestones done/.test(upd), 'opens with the overall count');
ok(/This month — November 2026/.test(upd), 'names the current month');
ok(/Late \(\d+\):/.test(upd) && /October 2026 — Data census of the live store/.test(upd), 'lists what is late by month');
ok(/Blocked:\n  Data census of the live store — waiting on IT/.test(upd), 'lists what is blocked, note flattened to one line');
ok(/Decisions needed now:/.test(upd) && /D1 End state/.test(upd), 'lists the decisions due by now');
ok(/Red risks:/.test(upd), 'lists the red risks');
ok(/Modules: 0 of 20 migrated/.test(upd), 'says how many modules have migrated');
ok(/checklist \d+\/\d+/.test(upd), 'carries each card\'s checklist progress');

console.log('Module migration — what every AM sees');
ok(JSON.stringify(MIG_SEED.map((m) => [m.p, m.n, m.w, m.m])) === JSON.stringify(RM.modules.map((m) => [m.p, m.n, m.w, m.m])), 'the page\'s module list is the worker\'s, path for path (twin)');
ok(new Set(MIG_SEED.map((m) => m.p)).size === MIG_SEED.length, 'every module path is unique');
const NAV = [...WF.match(/<nav class="tb-nav tb-modules"[^>]*>([\s\S]*?)<\/nav>/)[1].matchAll(/href="([^"?]+)/g)].map((m) => m[1]);
ok(NAV.every((h) => MIG_SEED.some((m) => m.p === h)), 'every module in the nav has a migration state');
const mv0 = migrationView({});
ok(mv0.on === true && Object.values(mv0.modules).every((m) => m.st === 'legacy') && mv0.modules['/workflow'].m === '2026-12', 'with nothing recorded every module reads Not migrated, with its planned month');
const mv1 = migrationView({ 'mod:/golden': { st: 'migrated', m: '2027-02', note: 'secret note', by: 'Andy', at: 9 }, 'mod:/labels': { st: 'weird', m: 'soon' }, 'cfg:badges': { on: false } });
ok(mv1.modules['/golden'].st === 'migrated' && !('note' in mv1.modules['/golden']) && !('by' in mv1.modules['/golden']), 'the public view carries the state, never the note or who wrote it');
ok(mv1.modules['/labels'].st === 'legacy' && mv1.modules['/labels'].m === '2026-12', 'a bad state or month falls back rather than leaking through');
ok(mv1.on === false, 'management can hide the badges from AMs');
ok(MIG_STATES.join() === TX.MS.join(), 'the page and the worker agree on the four states');
ok(migrationPathOf('/leadership/roadmap') === '/leadership' && migrationPathOf('/') === '/' && migrationPathOf('/workflow') === '/workflow' && migrationPathOf('/nope') === null, 'sub-pages ride their module; unknown paths have none');
const stat = between(WORKER, "if (path === '/api/migration/status' && request.method === 'GET') {", "if (path === '/api/transform') {");
ok(/migrationView\(lifted\.data\)/.test(stat) && !/moduleAllowed/.test(stat), '/api/migration/status serves the public projection to any signin');
ok(WORKER.indexOf("'/api/migration/status'") < WORKER.indexOf("if (path === '/api/transform') {"), 'the public route is answered before the opt-in gate');
ok(/import MIGW from "..\/..\/..\/docs\/migration_widget.html"/.test(WORKER) && /TOUCHW \+ '\\n' \+ MIGW/.test(WORKER), 'the migration badge widget is injected on every app page');
ok(/\/api\/migration\/status/.test(WIDGET) && /if\(!DATA\|\|!DATA\.on\|\|!DATA\.modules\)\{ clear\(\); return; \}/.test(WIDGET), 'the widget reads the public route and draws nothing when badges are off or the read failed');
ok(/@media\(max-width:760px\)\{\.fcc-mig-pill\{display:none\}/.test(WIDGET), 'the page pill stands down on the phone (the dot on the bottom bar carries it)');

console.log('Full-screen board');
ok(/id="fs-btn"/.test(PAGE) && /section\.blk\.fs\{position:fixed;inset:0;z-index:150/.test(PAGE), 'the board can take the whole window (a fixed layer under the editor\'s z-index 200)');
ok(/if\(e\.key==='Escape'&&!OPEN&&\$\('board'\)\.classList\.contains\('fs'\)\)/.test(PAGE), 'Esc leaves full screen, but never while the editor is open over it');
ok(/section\.blk\.fs \.canvas\{flex:1;max-height:none/.test(PAGE), 'in full screen the canvas grows to fill the window instead of its 78vh cap');

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
