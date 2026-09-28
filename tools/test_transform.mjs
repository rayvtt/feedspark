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
const { txDiff, txKind, txLogAppend, TX_LOG_CAP } = await import('../cloudflare/feedspark-deck/src/txhistory.js');

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

console.log('History & archive (who changed what, and undo)');
{
  const prev = { 'c:items:o-dec': { t: 'Decision memo signed', by: 'Ray', at: 1 }, 'i:o-scope': { st: 'todo', by: 'Ray', at: 1 }, 'chk:i.o-dec|s0': { done: false, by: 'Ray', at: 1 }, 'c:items:x1': { t: 'Gone soon', add: 1, by: 'Ray', at: 1 } };
  const next = { 'c:items:o-dec': { t: 'Decision memo signed by the board', by: 'Andy', at: 2 }, 'i:o-scope': { st: 'done', by: 'Andy', at: 2 }, 'chk:i.o-dec|s0': { done: true, by: 'Andy', at: 2 },
    'c:items:x1': { t: 'Gone soon', add: 1, del: 1, by: 'Andy', at: 2 }, 'c:items:n1': { t: 'New card', m: '2026-12', add: 1, by: 'Andy', at: 2 }, 'c:items:mv': { m: '2027-01', by: 'Andy', at: 2 } };
  const ents = txDiff(prev, next, 'Andy', 'andrew@aroxo.com', 99);
  const kind = (k) => (ents.filter((e) => e.k === k)[0] || {}).kind;
  ok(kind('c:items:o-dec') === 'edited' && kind('i:o-scope') === 'status' && kind('chk:i.o-dec|s0') === 'ticked', 'an edit, a status change and a tick are each named for what they were');
  ok(kind('c:items:x1') === 'deleted' && kind('c:items:n1') === 'added' && kind('c:items:mv') === 'moved', 'a delete, an add and a move to another month too');
  ok(ents.every((e) => e.who === 'Andy' && e.email === 'andrew@aroxo.com' && e.at === 99), 'every entry carries the Access identity and the time, not what the page wrote');
  ok(ents.filter((e) => e.k === 'c:items:o-dec')[0].b.t === 'Decision memo signed' && !('by' in ents.filter((e) => e.k === 'c:items:o-dec')[0].b), 'the before value is kept (so it can be put back), minus who/when');
  ok(txDiff({ a: { t: 'x', by: 'Ray', at: 1 } }, { a: { t: 'x', by: 'Andy', at: 5 } }, 'Andy', '', 5).length === 0, 'a re-save that only re-stamps who/when is not a change');
  ok(txKind('c:items:x1', { del: 1 }, undefined) === 'restored' && txKind('c:items:o-dec', { t: 'x' }, undefined) === 'reset', 'removing a delete restores; removing an edit resets to the plan');
  ok(txKind('cfg:badges', {}, { on: false }) === 'setting', 'the badges switch is a setting');
  let log = []; for (let i = 0; i < 3; i++) log = txLogAppend(log, [{ at: i, k: 'k' + i }]);
  ok(log[0].at === 2 && log.length === 3, 'newest first');
  ok(txLogAppend(new Array(TX_LOG_CAP).fill({ at: 0 }), [{ at: 1 }]).length === TX_LOG_CAP, 'the log is capped');
  const put = between(WORKER, "if (path === '/api/transform') {", "// ---- Build Log queue");
  ok(put.indexOf("moduleAllowed(acc.modules, 'transformation')") < put.indexOf("searchParams.get('history')"), 'the history is behind the same opt-in gate as the roadmap');
  ok(/txDiff\(prev, envx\.data, acc\.name \|\| displayName\(acc\.email\), acc\.email, now\)/.test(put) && /JSON\.parse\(JSON\.stringify\(cur\.data/.test(put), 'the worker diffs the map before and after the merge, stamped with the Access identity');
  ok(/'transformlog'/.test(put), 'the log lives in its own KV key');
  // the page's words
  const e1 = ents.filter((e) => e.k === 'c:items:o-dec')[0];
  ok(TX.histSubject(RM, {}, 'c:items:o-dec', e1).name === 'Decision memo signed by the board' && TX.histSubject(RM, {}, 'c:items:o-dec', e1).what === 'card', 'a logged key reads back as "card “title”"');
  ok(TX.histSubject(RM, {}, 'chk:i.o-dec|s0', { a: { done: true } }).name === RM.items.filter((i) => i.id === 'o-dec')[0].chk[0], 'a ticked seed checklist line is named by its own words');
  ok(TX.histSubject(RM, {}, 'chk:m./golden|s1', {}).where === 'Golden Record module', 'a module checklist line names its module');
  ok(TX.histDiffs(RM, { k: 'c:items:o-dec', f: ['t'], b: null, a: { t: 'New' } })[0].from === RM.items.filter((i) => i.id === 'o-dec')[0].t, 'an edit to a planned card diffs against the plan’s own wording');
  ok(TX.histDiffs(RM, { k: 'i:x', f: ['note', 'st'], b: { note: '' }, a: { note: '', st: 'done' } }).length === 1, 'a field that reads the same before and after is not listed as a change');
  ok(TX.histVerb(RM, { kind: 'moved', a: { m: '2026-12' }, b: {} }).join(' ') === 'moved to December 2026', 'a move says where to');
  ok(TX.archive(RM, { 'c:items:o-dec': { del: 1, by: 'Matt', at: 5 }, 'i:o-dec': { st: 'done' } }).length === 1, 'the archive lists what is deleted right now');
  ok(/id="hist"/.test(PAGE) && /data-hist-open/.test(PAGE) && /\.hist\{position:fixed;top:0;right:0/.test(PAGE) && /z-index:170/.test(PAGE), 'the panel slides in from the right, above the full-screen board and below the card editor');
  ok(/\.hist-fil\[hidden\]\{display:none\}/.test(PAGE), 'the filter row really hides on the Archive tab (a flex row ignores hidden)');
  ok(/function undoEntry/.test(PAGE) && /has changed again since/.test(PAGE), 'undo puts the before value back, and asks first if someone changed it again since');
  ok(/if\(e\.key==='Escape'&&HOPEN&&!OPEN\)/.test(PAGE), 'Esc closes the panel before it leaves full screen');
}

console.log('Plan reviewed against each module as it stands (28 Sep 2026)');
{
  const w2 = RM.modules.filter((m) => m.w === 2).map((m) => m.p).sort().join(',');
  ok(w2 === '/golden,/images,/labels,/overlays,/ptypes,/volume', 'wave 2 is the whole feed-scan family — one scan lane feeds all six, so they switch together');
  ok(RM.modules.every((m) => Array.isArray(m.chk) && m.chk.length >= 2), 'every module carries its own checklist lines');
  const g = RM.modules.filter((m) => m.p === '/golden')[0];
  ok(TX.modLines(RM, g).slice(0, RM.modtpl.length).join('|') === RM.modtpl.join('|') && TX.modLines(RM, g).length === RM.modtpl.length + g.chk.length, 'a module’s own lines come AFTER the common steps (ticks already made keep their place)');
  ok(/score history/i.test(g.chk.join(' ')) && /image tags/i.test(RM.modules.filter((m) => m.p === '/images')[0].chk.join(' ')), 'the data no scan can rebuild is copied, never re-scanned');
  const ids = RM.items.map((i) => i.id);
  ok(['o-browser', 'o-roster', 'f-news'].every((i) => ids.indexOf(i) >= 0), 'new cards: browser-only data, scan agents reading the feed map, the news lane');
  ok(/call notes/i.test(RM.items.filter((i) => i.id === 'f-mail')[0].chk.join(' ')) && /Keyword result/i.test(RM.items.filter((i) => i.id === 'f-mail')[0].chk.join(' ')), 'moving the mailbox covers call notes and keyword results, not just the inbox');
  ok(/Bypass/.test(RM.items.filter((i) => i.id === 'n-cut')[0].chk.join(' ')) && /never Restricted/.test(RM.items.filter((i) => i.id === 'n-cut')[0].chk.join(' ')), 'the cut-over recreates both Access apps and keeps the Workers layer Public');
  ok(RM.kpis.filter((k) => k.id === 'pers')[0].base === '8', 'eight personal-account dependencies (the news routine counted)');
}

console.log('Board graphics');
ok(RM.months.every((m) => m.ic), 'every planned month has an icon on the road');
ok(/\.canvas-in\{display:flex;align-items:flex-start;gap:48px/.test(PAGE), 'the months are spaced out (48px apart)');
ok(/class="node'/.test(PAGE) && /conic-gradient\(var\(--good\) calc\(var\(--p,0\)\*1%\)/.test(PAGE), 'each month hangs from a node whose ring fills as its cards are done');
ok(/function celebrate/.test(PAGE) && /prefers-reduced-motion/.test(PAGE), 'finishing a card or migrating a module gets a small burst, never with reduced motion');
ok(!/\.stk\.gate/.test(PAGE), 'the gate sticky class does not collide with the Gate pill (.gate uppercases)');

console.log('Full-screen board');
ok(/id="fs-btn"/.test(PAGE) && /section\.blk\.fs\{position:fixed;inset:0;z-index:150/.test(PAGE), 'the board can take the whole window (a fixed layer under the editor\'s z-index 200)');
ok(/if\(e\.key==='Escape'&&!OPEN&&\$\('board'\)\.classList\.contains\('fs'\)\)/.test(PAGE), 'Esc leaves full screen, but never while the editor is open over it');
ok(/section\.blk\.fs \.canvas\{flex:1;max-height:none/.test(PAGE), 'in full screen the canvas grows to fill the window instead of its 78vh cap');

console.log('Renamed route keeps what was recorded');
ok(migrationView({ 'mod:/transformation': { st: 'owned', m: '2026-11' } }).modules['/migration'].st === 'owned', 'a status recorded under the old /transformation key still reads');
ok(migrationView({ 'mod:/transformation': { st: 'owned' }, 'mod:/migration': { st: 'migrated' } }).modules['/migration'].st === 'migrated', 'a status written under the new key wins');
const trm = RM.modules.filter((m) => m.p === '/migration')[0];
ok(trm && TX.modState(trm, { 'mod:/transformation': { st: 'migrating' } }) === 'migrating', 'the page reads the old key too');
ok(TX.checklist('m./migration', ['a', 'b'], { 'chk:m./transformation|s0': { done: true } })[0].done === true, 'a ticked checklist line under the old key stays ticked');
ok(migrationPathOf('/migration') === '/migration', 'the pill finds the page at /migration');

console.log('Access and wiring');
ok(/slug: 'transformation'[^}]*optIn: true/.test(ACCESS), 'transformation is an opt-in module in access.js');
ok(/import TRANSFORM_PAGE from "..\/..\/..\/docs\/FeedSpark_Transformation.html"/.test(WORKER), 'the worker imports the page');
ok(/'\/migration':\s*\{ html: TRANSFORM_PAGE, slug: 'transformation' \}/.test(WORKER), '/migration is served from PAGES');
ok(/path === '\/transformation'\) \{\s*return new Response\(null, \{ status: 301, headers: \{ Location: '\/migration'/.test(WORKER), 'the old /transformation link 301s to /migration');
ok(!/'\/transformation':\s*\{ html:/.test(WORKER) && /path: '\/migration', optIn: true/.test(ACCESS), 'the page and its grant both live at /migration now');
ok(/href="\/migration"/.test(fs.readFileSync(path.join(ROOT, 'docs/FeedSpark_Leadership.html'), 'utf8')), 'the Leadership hub links /migration');
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
