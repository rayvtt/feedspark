#!/usr/bin/env node
/* UI-language harness — pins docs/i18n_engine.js (the owner-only Vietnamese toggle runs this exact
 * file on every text node of every page), the shipped seed dictionary's integrity, and the worker's
 * copy of the protected-token list. Runs in qa_gate, presync and validate.yml:
 *   node tools/test_i18n.mjs */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const I = require('../docs/i18n_engine.js');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); } };

console.log('· skip rules — what must never be translated');
['https://www.reiss.com/x', 'www.reiss.com', 'ray@feedspark.com', 'g:material', 'g:product_type(2)', 'YMDCR15', 'SV131275', '12.5%', '3/9', '07:00', '45h', '£', '—', 'a', '[Client]', 'Reiss', 'FeedHero', 'PMax', 'GB'].forEach((s) => t('skip ' + JSON.stringify(s), I.skip(s)));
['Open feed', 'Scan now', 'Loading…', '→ Brief', '12 of 40 done', 'Golden Record data-quality monitor', 'Filter by owner'].forEach((s) => t('keep ' + JSON.stringify(s), !I.skip(s)));

console.log('· number templating');
t('tpl turns every number run into {n}', I.tpl(' 12 of 40 done (30%) ').key === '{n} of {n} done ({n}%)' && I.tpl('12 of 40 done (30%)').nums.join('|') === '12|40|30');
t('tpl keeps decimals, thousands and versions whole', I.tpl('£1,974/mo · v1.2').key === '£{n}/mo · v{n}' && I.tpl('£1,974/mo · v1.2').nums.join('|') === '1,974|1.2');
t('fill puts the numbers back in order', I.fill('{n} trên {n} đã xong ({n}%)', ['12', '40', '30']) === '12 trên 40 đã xong (30%)');
t('fill tolerates a short number list', I.fill('{n} of {n}', ['5']) === '5 of ');

console.log('· dictionary lookup');
const D = I.index({ 'Open →': 'Mở →', '{n} of {n} done ({n}%)': '{n} trên {n} đã xong ({n}%)', 'Loading…': 'Đang tải…', 'Scan now': 'Quét ngay', 'Reiss': 'XXX' });
t('exact match, surrounding whitespace preserved', I.lookup(D, '  Open → ') === '  Mở → ');
t('templated match fills the numbers', I.lookup(D, '12 of 40 done (30%)') === '12 trên 40 đã xong (30%)');
t('case-folded match; ALL-CAPS source upper-cases the answer', I.lookup(D, 'LOADING…') === 'ĐANG TẢI…' && I.lookup(D, 'scan now') === 'Quét ngay');
t('unknown → null', I.lookup(D, 'Something else') === null);
t('a protected brand is never looked up even when the dict carries it', I.lookup(D, 'Reiss') === null);
t('empty / whitespace / null are null', I.lookup(D, '') === null && I.lookup(D, '   ') === null && I.lookup(D, null) === null && I.lookup(null, 'Open →') === null);
t('an entry equal to its key is not a translation', I.lookup(I.index({ 'Save': 'Save' }), 'Save') === null);

console.log('· protected tokens survive a translation');
t('protect lists brand + product tokens in order', I.protect('Scan the Reiss feed in Label Guard').join(',') === 'Reiss,Label Guard');
t('keepsProtected: missing brand → refused', !I.keepsProtected('Reiss feed', 'feed của Rít') && I.keepsProtected('Reiss feed', 'feed của Reiss'));
t('keepsProtected: {n} count must match', !I.keepsProtected('{n} of {n}', '{n} trên') && I.keepsProtected('{n} of {n}', '{n} trên {n}'));

console.log('· the shipped seed (docs/i18n/vi.json)');
const seed = JSON.parse(readFileSync(new URL('../docs/i18n/vi.json', import.meta.url), 'utf8'));
const keys = Object.keys(seed).filter((k) => k.charAt(0) !== '_');
t('seed carries a real dictionary (≥ 1000 entries)', keys.length >= 1000, String(keys.length));
t('every value is a non-empty string', keys.every((k) => typeof seed[k] === 'string' && seed[k].trim().length > 0));
// an identity entry ("Google Shopping" → "Google Shopping") is a deliberate keep-as-is answer that stops the
// runtime lane asking Tachyon about it — allowed, but it must stay a small minority of the seed
t('identity entries are a small minority (deliberate keep-as-is answers, not untranslated leftovers)', keys.filter((k) => seed[k] === k).length <= Math.floor(keys.length * 0.05), keys.filter((k) => seed[k] === k).length + ' of ' + keys.length);
t('every key is whitespace-normalised', keys.every((k) => k === I.norm(k)), keys.filter((k) => k !== I.norm(k)).slice(0, 3).join(' | '));
t('{n} placeholders balance on every entry', keys.every((k) => (k.match(/\{n\}/g) || []).length === (seed[k].match(/\{n\}/g) || []).length));
t('no seed entry translates a protected brand / product token away', keys.every((k) => I.keepsProtected(k, seed[k])), keys.filter((k) => !I.keepsProtected(k, seed[k])).slice(0, 3).join(' | '));
t('no seed key is a protected brand / product token', keys.every((k) => I.KEEP.indexOf(k) < 0));
t('an explicit seed entry beats the code heuristic (OPEN / WIP chips translate), a protected token never does', I.lookup(I.index({ 'WIP': 'Đang làm', 'MAC': 'x' }), 'WIP') === 'Đang làm' && I.lookup(I.index({ 'MAC': 'x' }), 'MAC') === null);
t('whole-word protection: Meta does not claim metadata, Benefit copy is not the brand', I.keepsProtected('metadata quality', 'chất lượng siêu dữ liệu') && I.keepsProtected('Benefit copy in titles', 'Nội dung lợi ích trong tiêu đề') && !I.keepsProtected('Meta catalogue', 'danh mục'));
['Command center', 'Workflow', 'Loading…', 'Save', 'Cancel', '✉ Ask client', '{n} of {n} done ({n}%)'].forEach((k) => t('seed answers the core chrome: ' + k, typeof seed[k] === 'string' && seed[k].length > 0));

console.log('· worker parity');
const wsrc = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const wk = /const I18N_KEEP = (\[[\s\S]*?\]);/.exec(wsrc);
t('worker carries I18N_KEEP identical to the engine KEEP list', !!wk && JSON.stringify(eval(wk[1])) === JSON.stringify(I.KEEP));
t('the translation route is owner-gated', /path === '\/api\/i18n'[\s\S]{0,200}realOwner\(env, request\)/.test(wsrc));
t('the widget is injected only for the real owner', /if \(realOwner\(env, request\)\) html = inject\(html, LANGW\);/.test(wsrc));
t('one KV key per language (no per-string KV traffic)', /const LK = 'i18n:' \+ lang;/.test(wsrc) && !/i18n:vi:' \+/.test(wsrc));
const widget = readFileSync(new URL('../docs/lang_widget.html', import.meta.url), 'utf8');
t('widget never touches inputs / textareas / contenteditable / data-ed fields', /textarea,input,select,option/.test(widget) && /\[contenteditable="true"\]/.test(widget) && /\[data-ed\]/.test(widget));
t('widget restores the exact originals on the way back (live-DOM walk, no node arrays pinning memory)', /function restore\(root\)[\s\S]*n\.nodeValue = o;/.test(widget) && /function stop\(\)[\s\S]*restore\(document\.body\)/.test(widget) && !/touchedT/.test(widget));
t('widget never translates after a VI→EN flip that beat the engine load', /loadDict\(\); \}\)\.then\(function \(\) \{ if \(lang !== 'vi'\) return;/.test(widget));
t('widget leaves the Templates email copy bodies English (the Copy button reads them)', /\.tpl \.subj,\.tpl \.body/.test(widget));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
