#!/usr/bin/env node
/*
 * News digest gate — the one check between the daily Routine and main.
 *
 * docs/news_digest.json is what the Command Center pops to every AM (/api/news), keyed on its
 * `id`, and an AM may quote a line of it to a client. It is rewritten every morning by the news
 * Routine (.claude/skills/feedspark-news-digest/SKILL.md), which runs as a cloud session — and a
 * cloud session pushes freely only to claude/-prefixed branches. Its ship step said "push to
 * main", so for ten days (18→28 Sep 2026) every run researched, wrote, reported success, and the
 * file never left its container. Now the file travels on claude/news-digest and
 * .github/workflows/news-digest.yml lands it on main once THIS check passes. The Routine runs
 * the same check before it pushes (--offline), so a refusal is seen where somebody is looking
 * rather than in a log nobody opens.
 *
 *   node tools/check_news.js [docs/news_digest.json]
 *        --against <main's digest>   the id must change and `generated` must be newer than main's
 *        --fresh                     `generated` within 48h of now — the landing lane only; the
 *                                    committed file is allowed to age in the repo's own QA
 *        --now <ISO>                 the clock, for tests
 *        --offline                   skip the link check (the sandbox may block a site the
 *                                    workflow can reach)
 *
 * Exit 1 on any error. Warnings print and pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ID_RE = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d+))?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMPACT = ['high', 'med', 'watch'];
const MAX_ITEMS = 8;          // the skill's cap — more than eight and the weakest were not high
const WINDOW_DAYS = 90;       // Ray, 18 Sep 2026: nothing older than three months
const FRESH_MS = 48 * 3600e3; // the landing lane lands TODAY's digest
const DAY = 86400e3;
const ITEM_KEYS = ['title', 'source', 'url', 'date', 'impact', 'tags', 'what', 'sowhat'];
const TOP_KEYS = ['_comment', 'id', 'generated', 'headline', 'intro', 'items'];
const MAX_BYTES = 65536, MAX_LINES = 320, WARN_LINES = 220; // "a pop-up, not a report"

// YYYY-MM-DD → UTC ms, NaN for anything that is not a real calendar day (2026-02-31 included)
function dayMs(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return NaN;
  const t = Date.parse(s + 'T00:00:00Z');
  if (isNaN(t)) return NaN;
  return new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
}
// prose the page prints through esc(): non-empty, bounded, and no angle brackets (nothing here is markup)
function textOk(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[<>]/.test(v);
}

function validateDigest(d, opts) {
  opts = opts || {};
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!d || typeof d !== 'object' || Array.isArray(d)) { err('the digest is not a JSON object'); return { errors, warnings }; }

  if (typeof d._comment !== 'string' || !d._comment.trim()) err('`_comment` missing — keep the file\'s own note');
  const idm = ID_RE.exec(typeof d.id === 'string' ? d.id : '');
  if (!idm) err('`id` must be YYYY-MM-DD or YYYY-MM-DD-N (same-day correction), got ' + JSON.stringify(d.id));
  const gen = Date.parse(typeof d.generated === 'string' ? d.generated : '');
  if (isNaN(gen)) err('`generated` is not an ISO timestamp: ' + JSON.stringify(d.generated));
  const genDay = isNaN(gen) ? NaN : dayMs(new Date(gen).toISOString().slice(0, 10));
  if (idm && !isNaN(gen)) {
    const idDay = dayMs(idm[1] + '-' + idm[2] + '-' + idm[3]);
    if (isNaN(idDay)) err('`id` carries an impossible date: ' + d.id);
    else if (Math.abs(idDay - gen) > 2 * DAY) err('`id` ' + d.id + ' and `generated` ' + d.generated + ' disagree by more than a day');
  }
  if (!textOk(d.headline, 200)) err('`headline` missing, empty, over 200 chars or carrying < >');
  if (d.intro !== undefined && !textOk(d.intro, 300)) err('`intro`, when present, is one sentence under 300 chars with no < >');
  if (!Array.isArray(d.items)) { err('`items` must be an array'); return { errors, warnings }; }
  if (d.items.length === 0) err('no items — a quiet day still ships two or three');
  if (d.items.length > MAX_ITEMS) err(d.items.length + ' items — the cap is ' + MAX_ITEMS + '; if more clear the bar, the weakest were not high');
  if (d.items.length === 1) warn('one item — the bar is "a quiet day ships two or three"');

  const urls = new Map(), titles = new Map();
  d.items.forEach((it, i) => {
    const at = 'items[' + i + ']' + (it && typeof it.title === 'string' ? ' "' + it.title.slice(0, 40) + '"' : '');
    if (!it || typeof it !== 'object' || Array.isArray(it)) { err(at + ': not an object'); return; }
    for (const k of ['title', 'source', 'what', 'sowhat']) {
      const max = k === 'title' ? 160 : k === 'source' ? 80 : 700;
      if (!textOk(it[k], max)) err(at + ': `' + k + '` missing, empty, over ' + max + ' chars or carrying < >');
    }
    let u = null;
    try { u = new URL(it.url); } catch (e) { u = null; }
    if (!u || u.protocol !== 'https:' || !/\./.test(u.hostname) || /[\s"'<>]/.test(it.url)) {
      err(at + ': `url` must be a real https:// link, got ' + JSON.stringify(it.url));
    } else {
      const key = u.href.replace(/\/$/, '');
      if (urls.has(key)) err(at + ': same url as items[' + urls.get(key) + '] — one item per source page');
      urls.set(key, i);
    }
    if (typeof it.title === 'string') {
      const t = it.title.trim().toLowerCase();
      if (titles.has(t)) err(at + ': same title as items[' + titles.get(t) + ']');
      titles.set(t, i);
    }
    const dm = dayMs(it.date);
    if (isNaN(dm)) err(at + ': `date` must be a real YYYY-MM-DD, got ' + JSON.stringify(it.date));
    else if (!isNaN(genDay)) {
      // whole days: an item dated the day the window opens is inside it, whatever hour the digest was written
      if (dm > genDay + DAY) err(at + ': dated ' + it.date + ', after the digest was generated');
      if (dm < genDay - WINDOW_DAYS * DAY) err(at + ': dated ' + it.date + ' — older than ' + WINDOW_DAYS + ' days (nothing older than three months; date the item, not the day you found it)');
    }
    if (!IMPACT.includes(it.impact)) err(at + ': `impact` must be one of ' + IMPACT.join('|') + ', got ' + JSON.stringify(it.impact));
    if (!Array.isArray(it.tags) || it.tags.length === 0 || it.tags.length > 6 || !it.tags.every((t) => textOk(t, 40))) err(at + ': `tags` is 1–6 short strings');
    const extra = Object.keys(it).filter((k) => !ITEM_KEYS.includes(k));
    if (extra.length) warn(at + ': unknown field(s) ' + extra.join(', ') + ' — the page ignores them');
  });
  const extraTop = Object.keys(d).filter((k) => !TOP_KEYS.includes(k));
  if (extraTop.length) warn('unknown top-level field(s) ' + extraTop.join(', '));

  const a = opts.against;
  if (a && typeof a === 'object') {
    if (a.id === d.id) err('`id` ' + JSON.stringify(d.id) + ' is main\'s id — nobody would be re-prompted; change it (same day: YYYY-MM-DD-2)');
    const ag = Date.parse(typeof a.generated === 'string' ? a.generated : '');
    if (!isNaN(ag) && !isNaN(gen) && gen <= ag) err('`generated` ' + d.generated + ' is not newer than main\'s ' + a.generated + ' — this would land an older digest over a newer one');
    if (typeof a._comment === 'string' && a._comment !== d._comment) warn('`_comment` differs from main\'s — the skill says keep it');
  }
  if (opts.fresh) {
    const now = opts.now != null ? opts.now : Date.now();
    if (!isNaN(gen) && now - gen > FRESH_MS) err('`generated` ' + d.generated + ' is more than 48h old — this lane lands today\'s digest');
    if (!isNaN(gen) && gen - now > 6 * 3600e3) err('`generated` ' + d.generated + ' is in the future');
  }
  return { errors, warnings };
}

// the file as text: it must parse (a malformed digest breaks the worker bundle) and stay a pop-up
function validateText(src, opts) {
  const errors = [], warnings = [];
  let d = null;
  try { d = JSON.parse(src); } catch (e) { errors.push('not valid JSON — the worker bundles this file as a Text module and a malformed one breaks the build: ' + e.message); return { errors, warnings, digest: null }; }
  const bytes = Buffer.byteLength(src, 'utf8'), lines = src.split('\n').length;
  if (bytes > MAX_BYTES) errors.push('file is ' + bytes + ' bytes — over ' + MAX_BYTES + '; this is a pop-up, not a report');
  if (lines > MAX_LINES) errors.push('file is ' + lines + ' lines — over ' + MAX_LINES + '; the skill says keep it under ~200');
  else if (lines > WARN_LINES) warnings.push('file is ' + lines + ' lines — the skill says keep it under ~200');
  const r = validateDigest(d, opts);
  return { errors: errors.concat(r.errors), warnings: warnings.concat(r.warnings), digest: d };
}

// every link, for real: 2xx = ok; 401/403/429 = a bot wall, not proof the page is gone (warn);
// 404/410 = dead (error); anything else = unverified (warn). Never a HEAD — many sites answer it wrongly.
async function checkLinks(d, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || globalThis.fetch;
  const timeoutMs = opts.timeoutMs || 12000;
  const out = { ok: [], blocked: [], dead: [], unverified: [] };
  const seen = new Set();
  for (const it of (d && Array.isArray(d.items) ? d.items : [])) {
    const url = it && typeof it.url === 'string' ? it.url : '';
    if (!/^https:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal: ctl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FeedSparkNewsDigest/1.0; +https://feedspark.com)', accept: 'text/html,*/*' } });
      const s = r.status;
      if (s >= 200 && s < 300) out.ok.push({ url, status: s });
      else if (s === 401 || s === 403 || s === 429 || s === 999) out.blocked.push({ url, status: s });
      else if (s === 404 || s === 410) out.dead.push({ url, status: s });
      else out.unverified.push({ url, status: s });
    } catch (e) {
      out.unverified.push({ url, status: 0, error: (e && e.name === 'AbortError') ? 'timeout' : String(e && e.message || e) });
    } finally { clearTimeout(timer); }
  }
  return out;
}

function parseArgs(argv) {
  const o = { file: 'docs/news_digest.json', against: null, fresh: false, now: null, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--against') o.against = argv[++i];
    else if (a === '--fresh') o.fresh = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--now') o.now = Date.parse(argv[++i]);
    else if (a.startsWith('--')) throw new Error('unknown flag ' + a);
    else o.file = a;
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const root = path.join(__dirname, '..');
  const file = path.isAbsolute(o.file) ? o.file : path.join(root, o.file);
  const src = fs.readFileSync(file, 'utf8');
  let against = null;
  if (o.against) {
    try { against = JSON.parse(fs.readFileSync(o.against, 'utf8')); }
    catch (e) { console.error('✗ could not read the digest to compare against (' + o.against + '): ' + e.message); process.exit(1); }
  }
  const r = validateText(src, { against, fresh: o.fresh, now: o.now });
  r.warnings.forEach((w) => console.log('  ⚠ ' + w));
  r.errors.forEach((e) => console.error('✗ ' + e));
  if (r.errors.length) { console.error('\n' + r.errors.length + ' error(s) — the digest is refused'); process.exit(1); }
  const d = r.digest;
  console.log('✓ ' + path.relative(root, file) + ' — id ' + d.id + ', ' + d.items.length + ' item(s), generated ' + d.generated + (against ? ' (main: ' + against.id + ')' : ''));
  if (o.offline) { console.log('  · link check skipped (--offline)'); return; }
  const l = await checkLinks(d);
  l.ok.forEach((x) => console.log('  ✓ ' + x.status + ' ' + x.url));
  l.blocked.forEach((x) => console.log('  ⚠ ' + x.status + ' ' + x.url + ' — a bot wall answered; not proof the page is gone'));
  l.unverified.forEach((x) => console.log('  ⚠ ' + (x.status || x.error) + ' ' + x.url + ' — could not be verified from here'));
  l.dead.forEach((x) => console.error('✗ ' + x.status + ' ' + x.url + ' — the page is gone; an AM cannot be sent to a dead link'));
  if (l.dead.length) { console.error('\n' + l.dead.length + ' dead link(s) — the digest is refused'); process.exit(1); }
  console.log('✓ links: ' + l.ok.length + ' reachable' + (l.blocked.length ? ', ' + l.blocked.length + ' behind a bot wall' : '') + (l.unverified.length ? ', ' + l.unverified.length + ' unverified' : ''));
}

module.exports = { validateDigest, validateText, checkLinks, dayMs, parseArgs, ID_RE, IMPACT, MAX_ITEMS, WINDOW_DAYS, FRESH_MS };

if (require.main === module) main().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
