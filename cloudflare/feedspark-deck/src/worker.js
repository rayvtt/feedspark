/**
 * FeedSpark Command Center Worker
 * Serves the command center + strategy decks with parallel live editing — no paid API, no cost:
 *   - Ray edits copy in-browser (contenteditable) -> auto-saved to KV by data-eid (per page)
 *   - Claude Code (the chat interface) makes structural/visual edits to the page templates
 *     in git and pushes to main; Cloudflare rebuilds and the new pages are bundled in.
 *     Ray's KV edits persist and re-overlay on top.
 *   - The editor's "Copy for Claude Code" button hands Claude the exact element to change
 *
 * The two layers never collide: template = git (bundled at build time), content = KV / Ray.
 *
 * Routes:
 *   GET  /                 -> command center landing page (+ injected editor widget)
 *   GET  /deck/yumove      -> YuMOVE strategy deck (+ injected editor widget)
 *   GET  /api/edits?page=  -> a page's saved edits as JSON (keyed by data-eid)
 *   PUT  /api/edits?page=  -> merge an edit patch for a page
 *   DELETE /api/edits?page=-> clear a page's saved edits
 *   GET  /api/template     -> info: pages are git-bundled (push to main to change them)
 *
 * Gate the whole worker behind Cloudflare Access — the deck holds confidential
 * commercial data.
 */

// Pages are bundled from git at build time as Text modules. Editing structure/layout means
// editing the .html in git and pushing to main; Cloudflare rebuilds and redeploys.
// (wrangler.toml declares rules = [{ type = "Text", globs = ["**/*.html"] }].)
import { liftEnvelope, mergeIntoEnvelope, envelopeToClient } from "./kvmerge.js";
import { matchGmailToBriefs, classifyInbound, detectClient, detectClientEx, mailThreadKey, parseGeminiNotes } from "./briefmatch.js";
import { buildDueReminders, dd8 as remDay } from "./taskremind.js";
// Label Guard: custom_label_0..4 drop-off monitoring (gviz pivots, baseline diff -> alerts)
import { LABEL_KEYS, PT_KEYS, scanFeed, diffSnapshots, summarize, crossFeed, labelPivot, evalWatch, alertDigest, buildReport, isImplausible, dispFeed, estateMailPlan, estateAlertEmail, estateRecoveryEmail, depthProfile, diffCoverage, goldenScore, goldenAlertEmail, goldenRecoveryEmail, ATTR_SPEC, profileFor, industryOf, INDUSTRY_PROFILES, INDUSTRY } from "./labelguard.js";
import LANDING from "../../../docs/FeedSpark_Command_Center.html";
import DECK_YUMOVE from "../../../docs/YuMOVE_Strategy_Review_Jul26.html";
import TASKLIB from "../../../docs/FeedSpark_Task_Library.html";
import ROADMAP from "../../../docs/FeedSpark_Roadmap.html";
import READINESS from "../../../docs/FeedSpark_Readiness.html";
import LEADERSHIP from "../../../docs/FeedSpark_Leadership.html";
import DECKBUILDER from "../../../docs/FeedSpark_DeckBuilder.html";
import ACTIVITY from "../../../docs/FeedSpark_Activity.html";
import WORKFLOW from "../../../docs/FeedSpark_Workflow.html";
import DECK_TEMPLATE from "../../../docs/FeedSpark_Strategy_Review_Template.html";
import DECK_REISS from "../../../docs/Reiss_Strategy_Review_FY2526.html";
import DECK_SUPERDRY from "../../../docs/Superdry_Strategy_Review_AllTime.html";
// Tachyon copilot widget (style + script fragment). Injected on the app pages only —
// never on client-facing decks. Reads window.PLANTASKS and calls /api/claude.
import TACHYON from "../../../docs/tachyon_widget.html";
// FCC-PRESENCE: Google-Docs-style live avatars in the topbar — injected on app pages only.
// Identity comes from Cloudflare Access (who()); heartbeats live in the KV `presence` map.
import PRESENCEW from "../../../docs/presence_widget.html";
// FCC-FEEDCHAT-BUBBLE: Feed Chat as an ambient chatbot — floating bubble bottom-right on every
// app page; the panel hovers over the current page (embedded /feedchat?embed=1, URL unchanged).
import FEEDCHATW from "../../../docs/feedchat_widget.html";
// FCC-INSTR: collapsible-instructions widget — injected on app pages only (never decks),
// so every module's explainer subtext folds behind a ⓘ by default
import INSTR from "../../../docs/instr_collapse.html";
import FEEDLAB from "../../../docs/FeedSpark_FeedLab.html";
import FEEDCHAT from "../../../docs/FeedSpark_FeedChat.html";
import PRICER from "../../../docs/FeedSpark_Pricer.html";
// Label Guard — custom-label capture + drop-off monitoring module (page at /labels)
import LABELGUARD_PAGE from "../../../docs/FeedSpark_LabelGuard.html";
// Product Type Guard — primary g:product_type monitoring, Google channel (page at /ptypes)
import PTGUARD_PAGE from "../../../docs/FeedSpark_ProductTypeGuard.html";
// Golden Record — attribute coverage vs Google's product data spec (page at /golden)
import GOLDEN_PAGE from "../../../docs/FeedSpark_GoldenRecord.html";
// Keyword optimisation calendar — marketing moments drive the KW schedule (docs/FeedSpark_KWCal.html)
import KWCAL from "../../../docs/FeedSpark_KWCal.html";
// Tachyon Pricer quote engine — Text module, served verbatim at /pricer/engine.js (page +
// node tests share the file, same pattern as the Feed Lab engine)
import PRICER_ENGINE from "../../../docs/pricer_engine.js";
// the official Google Product Taxonomy (5,595 categories) — the Pricer's categories-done
// picker searches it; served verbatim, cached a day (Google revises it ~yearly)
import GPC_TAXONOMY from "../../../docs/gpc_taxonomy.txt";
// the Feed Lab audit engine, bundled verbatim (wrangler Text rule) and served at
// /feedlab/engine.js so the page and its node tests run the exact same code
import FEEDLAB_ENGINE from "../../../docs/feedlab_engine.js";

// Client materials bank -- binary Data module (ArrayBuffer), served by /api/materials/file.
import MAT_SUPERDRY_SR2426 from "../../../docs/materials/Superdry_FeedSpark_Strategy_Review_2024-2026.pptx";
import MAT_REISS_INTRO_AUG26 from "../../../docs/materials/Reiss_Introduction_Aug26.pptx";
import MAT_MONSOON_INTRO_AUG26 from "../../../docs/materials/Monsoon_Introduction_Aug26.pptx";

// KWCal client-calendar seeds (docs/calseed/) -- each brand's shared marketing-planner slide,
// bundled as a Data module and served at /kwcal/cal/<file>. The KWCal page falls back to these
// when KV holds no calImg for the brand (a URL/upload set in-page still wins).
import CALSEED_REISS from "../../../docs/calseed/reiss_marketing_planner.webp";
const CAL_SEED_FILES = {
  'reiss_marketing_planner.webp': { body: CALSEED_REISS, mime: 'image/webp' },
};

// path -> { html, slug }. slug namespaces each page's KV edit layer (KV key: edits:<slug>),
// so edits on the landing page and each deck never collide. Add a page = add a line here.
/* Git-bundled materials. Adding one costs its full size on every deploy, so this list
   stays short: flagship, client-facing pieces only. Everything else is uploaded to KV
   through the dossier's Materials panel. */
const SEED_MATERIALS = [
  { id: 'superdry-sr-2024-2026', client: 'Superdry',
    title: 'Superdry \u00d7 FeedSpark \u2014 Strategy Review 2024\u20132026',
    cat: 'marketing', occasion: 'Account Review Aug-26',
    file: 'Superdry_FeedSpark_Strategy_Review_2024-2026.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    at: '2026-08-05', body: MAT_SUPERDRY_SR2426 },
  { id: 'reiss-intro-aug26', client: 'Reiss',
    title: 'Reiss \u00d7 FeedSpark \u2014 Account Introduction, Aug 2026',
    cat: 'marketing', occasion: 'Account Introduction Aug-26',
    file: 'Reiss_Introduction_Aug26.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    at: '2026-08-20', body: MAT_REISS_INTRO_AUG26 },
  { id: 'monsoon-intro-aug26', client: 'Monsoon',
    title: 'Monsoon \u00d7 FeedSpark \u2014 Account Introduction, Aug 2026',
    cat: 'marketing', occasion: 'Account Introduction Aug-26',
    file: 'Monsoon_Introduction_Aug26.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    at: '2026-08-21', body: MAT_MONSOON_INTRO_AUG26 },
];

const PAGES = {
  '/':            { html: LANDING,     slug: 'home' },
  '/index.html':  { html: LANDING,     slug: 'home' },
  // Readiness / Task library / Build roadmap live UNDER Leadership (owner-gated in fetch()
  // before this map is consulted; legacy /readiness /library /roadmap 301 here). Slugs are
  // unchanged so each page's saved KV edits (edits:<slug>) survive the move.
  '/leadership/library':   { html: TASKLIB,   slug: 'library' },
  '/leadership/roadmap':   { html: ROADMAP,   slug: 'roadmap' },
  '/leadership/readiness': { html: READINESS, slug: 'readiness' },
  '/leadership':  { html: LEADERSHIP,  slug: 'leadership' },
  '/deck-builder':{ html: DECKBUILDER, slug: 'deckbuilder' },
  '/activity':    { html: ACTIVITY,    slug: 'activity' },   // owner-gated in fetch() before this map is consulted; Build Log lives on its 🔨 tab
  '/workflow':    { html: WORKFLOW,    slug: 'workflow' },
  '/feedlab':     { html: FEEDLAB,     slug: 'feedlab' },
  '/feedchat':    { html: FEEDCHAT,    slug: 'feedchat' },
  '/labels':      { html: LABELGUARD_PAGE, slug: 'labels' },
  '/ptypes':      { html: PTGUARD_PAGE, slug: 'ptypes' },
  '/golden':      { html: GOLDEN_PAGE, slug: 'golden' },
  '/pricer':      { html: PRICER,      slug: 'pricer' },
  '/kwcal':       { html: KWCAL,       slug: 'kwcal' },
  '/deck/yumove': { html: DECK_YUMOVE, slug: 'yumove' },
  '/deck/reiss':  { html: DECK_REISS,  slug: 'reiss' },
  '/deck/superdry': { html: DECK_SUPERDRY, slug: 'superdry' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Label Guard nav badge — injected on app pages only (never client decks): dots the /labels
// nav icon with the number of feeds carrying active drop-off alerts, red when any is critical.
const LGBADGE = `<style>.lg-dot{position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:100px;background:#ED6F0B;color:#fff;font-size:9.5px;font-weight:900;line-height:14px;text-align:center;pointer-events:none}.lg-dot.crit{background:#C0392B}</style>
<script>/* FCC-LABELGUARD badge */(function(){function dot(href,c){var n=(c.crit||0)+(c.warn||0);if(!n)return;var a=document.querySelector('#tb-modules a[href="'+href+'"]');if(!a)return;var b=document.createElement('span');b.className='lg-dot'+(c.crit?' crit':'');b.textContent=n>9?'9+':String(n);a.appendChild(b);}try{fetch('/api/labels/alerts').then(function(r){return r.json();}).then(function(d){dot('/labels',(d&&d.counts)||{});if(d&&d.pt)dot('/ptypes',d.pt);if(d&&d.gr)dot('/golden',d.gr);}).catch(function(){});}catch(e){}})();</script>`;

// client -> Project Plan Google Sheet id. Mirrors FeedSpark_Workflow.html's client-side
// PLANSHEET map (used there for the "+ Add task" row and status/owner/due write-back) —
// duplicated rather than fetched at runtime so /api/tasks/ingest works with zero round trips
// beyond the sheet write itself. Keep both in sync when a client is added or a sheet moves.
const PLAN_SHEETS = {
  'Reiss': '1hGcpxaTYVax4hB_nLYCMlol7sIi3qqF0xQgJGjIgZSg',
  'Schuh': '1rbr8FwZagdZdctR_fNesixm4-uDWG1VJPnBCJBdjSxc',
  'Superdry': '16Sn9HB56eaNytr7pM3sY0aJTRhK-I-RpNr84EQ36KMI',
  'Accessorize': '1SM52DXN3ecY5EDCIIqlRPONSmxkFvOM1xaeDrMlJ79w',
  'Monsoon': '1SM52DXN3ecY5EDCIIqlRPONSmxkFvOM1xaeDrMlJ79w',
  'Hobbycraft': '1oHdoFO4gazfhQZM6rp1fl5pWlDRVzr8t_THquU861fg',
  'YuMOVE': '1RMTN99Cw0J3l5mORwYPpITnoi5HCPt7tET4u8rQbsq0',
  'Ryobi': '1WofQrZ6igucGIvGnUOLgBiXP7MqK-7ZtG8Xt4LLaA1E',
  'Estée Lauder': '1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y',
  'Bobbi Brown': '1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y',
  'Benefit': '1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y',
  'Clinique': '1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y',
  'MAC': '1KWrB4IpHGRUnlhVjWP4hpyhpBGs5c-JM_cBa7mj6J0Y',
  'Jo Malone': '1m99-z1R4FI4Iw86I6P8TyLY7G-Td9sh2vNjy-y95UMc',
  'House of Bruar': '1lgO-SrzWtHmsvKRXg2Xgzq3d7fCwv5V2Fauu6pJgYOA',
};

// brands whose live feed is wired in code — imported from Ray's master feed-market sheet
// (1eiqTbLC0fpJfjVyeJaf72kYfLPgGLDWUfXB38bRDfak: one row per client+country feed). This map
// is the committed record; new rows in the sheet get re-imported here (or attached ad-hoc
// from the CC dossier / Feed Lab, which OVERRIDES the wired entry per market).
// MULTI-MARKET: a dossier record may carry `feeds` = { gb: url, de: url, ... } (managed
// from the Feed Lab portal or the CC dossier); the legacy single `feed` field doubles as
// the 'gb' market. Market codes are 2-6 chars, lowercased.
// Module scope (not inside fetch): the Label Guard cron sweep resolves feeds from scheduled().
// `<mkt>-fb` = Meta (Facebook) catalogue channel. Mass-imported from the master sheet's
// "Meta" tab (gid 908873996, URLs in col B) Aug 2026 — every Meta feed arrived as a
// link-shared Google Sheet, so they ride the full rails (Feed Lab AND Label Guard).
const DEFAULT_FEEDS = {
  Schuh: {
    gb: { id: '1uAM5I_KSsjucCr3GLXc2ekZeiMoAG6x8TIh5ZntwseA', gid: '0' },
    de: { id: '1u-B6VECXLk1YefoED5FfjpnXw1uEwV8cE_f6t-ed12I', gid: '0' },
    ie: { id: '1bawEQkhpl8GsSGVNkPnsi228TM_z1LXf1Dj35s-a9p4', gid: '0' },
    'gb-fb': { id: '13AyrXlP0se24SJS8O_aZFAi51rdTrhnxVe_h4sdKn1w', gid: '0' },
    'de-fb': { id: '1xmvblk89mmxgtFuXEYFC8towiKPsN8ILmLCfPX911H8', gid: '0' },
    'ie-fb': { id: '1hxBYKvl6trfaieFJaKbii2QyoUXuGdjdZqFpsGoiiHo', gid: '0' },
  },
  YuMOVE: { gb: { id: '1PtsaNBd5NGimchw18YlBPCtOgl0HcgkWrKdhy4lfvzA', gid: '0' } },
  Monsoon: {
    gb: { id: '1pW6CqyzM_1Rqr8O0basrxxuNAWG9sR2_OrjCIkE_8PU', gid: '0' },
    'gb-fb': { id: '1p-nudKJ_67OVqsrmEgjut1KeZu_2g_aactQShz-mp1Q', gid: '0' },
  },
  Accessorize: {
    gb: { id: '1_OkGi8ucOmJcdu5TBWm3vl5cK3bmmaimoMYvR03Z3Ic', gid: '0' },
    'gb-fb': { id: '1RQLrwFPdW_Svu7ZPzuB1YJztDV12tzpQm0Fr_Fnrc0k', gid: '0' },
  },
  Hobbycraft: {
    gb: { id: '1rlQ7H3LYeN1hbyQ9uUG-DszgpGVxuUdiQTOaFWjEL7Q', gid: '0' },
    'gb-fb': { id: '1R1ES_XtA1r6NAqROkyr_lWb3cuy3_AQDJ4b5MTJ_2A8', gid: '0' },
  },
  Superdry: {
    gb: { id: '1PimExRPPqf1CknH3yLs_tUfJrr2HZgjpiMUDiOUDc3k', gid: '0' },
    ie: { id: '1SjuQ0M-cangxVcNdlb72RQM0-ZTev7aE-R5v1iX9EGQ', gid: '0' },
    de: { id: '1y0phqG10OH55u6s6w8xpsVfZe2LohwlpelWPvb0QM3k', gid: '0' },
    fr: { id: '1FVthehZKfAiUIU0qCGrsdENMQW896o8S19C6fT0gkx4', gid: '0' },
    nl: { id: '1f4tL0BPNrVFC7Lj0az4LLs9NvIvf3YiFRBXXPafU1t0', gid: '0' },
    'gb-fb': { id: '1SmpIXWedrLlbO-NcfSmYakyxoXJr8C2fxxSkWSeaJZ0', gid: '0' },
    'ie-fb': { id: '1TmZknTdwYUkw7gbpLzfUNEUC66GS4cwOoGlB4M4aBgM', gid: '0' },
    'de-fb': { id: '1yWEyXdDWkJh1723db9QeAixrLmBDHAqhFvGupWYeEwk', gid: '0' },
    'fr-fb': { id: '1gd8SZxhDdQhTBDawtZCymKIZ8GnuVcMsVua6GawUulk', gid: '0' },
    'nl-fb': { id: '1uNKYA9hhKwPyh_V6vBsOb7yCo-DOaQxrvvOexv7-Yqw', gid: '0' },
  },
  'House of Bruar': {
    gb: { id: '16P8vLuLC4l4xkMh5w_BrCCGHzMYqi4eZec8Wezpg1bk', gid: '0' },
    us: { id: '1Wa5FQgn3mX_iMMG2nT85gmnR28hgVFPkbY1qlV0lJZM', gid: '0' },
    eu: { id: '1e3tETDX_0oGTgPXr5weI-h1DjwRoVDPJikqW9vvyTJQ', gid: '0' },
    'gb-fb': { id: '1XSH6lWe2qiG-58GUKHOw4CQQCzkPF_kv2tKQwIyrU1k', gid: '0' },
    'us-fb': { id: '1smKCDoMZnC1tvffeaCAHymfvEhFvPsFuvyhZxxgpV7Y', gid: '0' },  // no CL3 column in the Meta feed
  },
  'American Golf': { gb: { id: '1W4Tasbdi7jR7kmlIjYjrPtAb2BvW-AkQZBz9XW1aNHk', gid: '0' } },  // API-fed sheet
  Reiss: {
    gb: { id: '1KTx9ONZSju_DD06V3F7p958LfzAL0ccJJFXPf5NpLCw', gid: '0' },
    us: { id: '1_-7yjB-hZfmk9VU_srfn6oZwFGTVzHWLtdOKJRmR-nA', gid: '0' },
    ie: { id: '1BMUgdup13kqcubAA1AhLrw63_Stlr0SvXFRh4PxQ7YA', gid: '0' },
    de: { id: '13C8ECyr6lYlkI2PmMfEp_XYKTcjUivy8BpCb-dWC2OY', gid: '0' },
    nl: { id: '17a8RKY01vcmbmwHBw-kigGBo5N-PY6cSNj-SM5IOGzE', gid: '0' },
    au: { id: '1VTE5MkGw3XSacA6w5YAciwBIl0yBLt2KlKAQbXmCYyI', gid: '0' },
    ca: { id: '1pG9dzcKnGRx-r56eNISksUeeyNovJbF4tkVUBtYs25U', gid: '0' },
    eu: { id: '1LaOCzKf_zxRpSBobb-iwgYGAgggwWqB8XMjQRtbr6mM', gid: '0' },
    fr: { id: '1eb1-NHas0oDVozjQ7-gbZfvfUdM0iJTwtTTovy7pLuc', gid: '0' },
    uae: { id: '14iybEDaewEqlnsG4lMtYFwBU4s4iwqJNFma_-8VOmIY', gid: '0' },
    'gb-fb': { id: '1i5EKldXa_d8VsKbMfsixWPY_Tr0j7GyAWYSxr0xDAN4', gid: '0' },  // was FeedHero XML — Meta tab now supplies a sheet, so Label Guard covers it too
    'ca-fb': { id: '1YRWfLwevu_MnLnxMmPe41LRD6NWxYoi89QqvZtLW4LQ', gid: '0' },
    'de-fb': { id: '1fMmv_DjOFKWZAAOTOW_3hRfXxzTCwl0iyP4N7EeaUdg', gid: '0' },
    'ie-fb': { id: '1sG2buKIZsxRWyFSiAfZWW9UCd-EDy129JFGlKLDvo0c', gid: '0' },
    'us-fb': { id: '1YFPSkfKOKxvbpUcF_0bBhvTvZvmtybLI80sWctDt8ak', gid: '0' },
  },
};
const mktOf = (raw) => String(raw || 'gb').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 6) || 'gb';
const sheetRef = (u) => {
  const m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(String(u || ''));
  if (!m) return null;
  const g = /[#?&]gid=(\d+)/.exec(String(u));
  return { id: m[1], gid: (g && g[1]) || '0' };
};
// FeedHero-hosted XML product feeds (Meta/FB channel) — realtime company-public data. The
// host is allowlisted so the feed proxy can never be pointed at arbitrary URLs; a source is
// either a sheet {id,gid} or an {xml} URL, and feedRef() resolves a pasted URL to whichever.
const xmlRef = (u) => (/^https:\/\/[a-z0-9-]+\.feedhero\.net\/[^\s"'<>]+\.xml$/i.test(String(u || '').trim())
  ? { xml: String(u).trim() } : null);
const feedRef = (u) => sheetRef(u) || xmlRef(u);
const feedMarketsFor = async (env, client) => {   // { mkt: {id,gid} } for every attached market
  const out = {};
  const dft = DEFAULT_FEEDS[client] || {};
  Object.keys(dft).forEach((k) => { out[k] = dft[k]; });
  if (client) try {
    const dossier = liftEnvelope(await env.EDITS.get('clients', 'json'), Date.now()).data;
    const rec = dossier[client] || {};
    if (rec.feed) { const r = feedRef(rec.feed); if (r) out.gb = r; }   // legacy single feed = gb
    if (rec.feeds && typeof rec.feeds === 'object') {
      Object.keys(rec.feeds).forEach((mk) => { const r = feedRef(rec.feeds[mk]); if (r) out[mktOf(mk)] = r; });
    }
  } catch (e) {}
  return out;
};
const feedSourceFor = async (env, client, market) => (await feedMarketsFor(env, client))[mktOf(market)] || null;
// every client+market with a live feed (wired ∪ dossier-attached) — the Label Guard roster
async function feedRoster(env) {
  const clients = {};
  Object.keys(DEFAULT_FEEDS).forEach((c) => { clients[c] = 1; });
  try {
    const dossier = liftEnvelope(await env.EDITS.get('clients', 'json'), Date.now()).data;
    Object.keys(dossier).forEach((c) => {
      const rec = dossier[c] || {};
      if ((rec.feed && feedRef(rec.feed)) || (rec.feeds && Object.keys(rec.feeds).some((mk) => feedRef(rec.feeds[mk])))) clients[c] = 1;
    });
  } catch (e) {}
  const out = [];
  for (const c of Object.keys(clients).sort()) {
    const mkts = await feedMarketsFor(env, c);
    for (const mk of Object.keys(mkts).sort()) out.push({ client: c, mkt: mk, src: mkts[mk] });
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ---- user activity log (viewed at /activity, OWNER-only): who did what, when.
    // Identity is free: the whole app sits behind Cloudflare Access, which injects the
    // verified Cf-Access-Authenticated-User-Email on every request. Writes are logged
    // non-blocking (ctx.waitUntil) into per-entry KV keys w/ 90-day TTL; the entry lives
    // in the key's metadata so the feed is a single list() with zero value reads.
    if (request.method === 'PUT' || request.method === 'POST') {
      const ACT = { '/api/edits': 'edit', '/api/feedback': 'feedback', '/api/clients': 'dossier-save',
        '/api/materials': 'material-save',
        '/api/briefs': 'briefs-save', '/api/buildqueue': 'queue-save', '/api/claude': 'tachyon', '/api/plan/live': 'plan-sync',
        '/api/feed/audit': 'feed-audit', '/api/tachyon/rates': 'rates-save', '/api/tachyon/quotes': 'quote-save', '/api/tachyon/track': 'track-save',
        '/api/labels/scan': 'label-scan', '/api/labels/ack': 'label-rebase',
        '/api/labels/watch': 'watch-save', '/api/labels/dest': 'dest-save',
        '/api/labels/dest/test': 'dest-test', '/api/labels/watch/run': 'watch-run',
        '/api/labels/report': 'report-save', '/api/labels/report/send': 'report-send', '/api/labels/askdraft': 'label-ask', '/api/ptypes/plantask': 'ptdepth-task', '/api/gmail/techam': 'techam-send',
        '/api/golden/scan': 'golden-scan', '/api/golden/ack': 'golden-rebase', '/api/golden/plantask': 'golden-task', '/api/golden/profile': 'golden-profile',
        '/api/kwcal': 'kwcal-save', '/api/feedchat': 'feedchat-save' };
      if (ACT[path]) {
        logActivity(ctx, env, request, ACT[path],
          (path === '/api/edits' || path === '/api/feedback') ? (url.searchParams.get('page') || '') : '');
      } else if (path.startsWith('/api/sheets/') && request.method === 'POST') {
        let d = ''; try { const b = await request.clone().json();
          d = (String(b.match || (b.rows ? b.rows.length + ' rows' : '')) + (b.value != null ? ' → ' + b.value : '')).slice(0, 80); } catch (e) {}
        logActivity(ctx, env, request, 'plan-' + path.slice('/api/sheets/'.length), d);
      }
    }

    // the activity feed itself — restricted to the account owner, enforced server-side
    if (path === '/api/activity' && request.method === 'GET') {
      if (who(request) !== ownerEmail(env)) return json({ error: 'restricted to the account owner' }, 403);
      const days = Math.min(90, Math.max(1, +(url.searchParams.get('days') || 14) || 14));
      const cutoff = Date.now() - days * 86400000;
      const entries = []; let cursor;
      for (let i = 0; i < 5; i++) {
        const page = await env.EDITS.list({ prefix: 'act:', cursor });
        for (const k of page.keys) { const m = k.metadata; if (m && m.t >= cutoff) entries.push(m); }
        if (page.list_complete) break; cursor = page.cursor;
      }
      entries.sort((a, b) => b.t - a.t);
      return json({ owner: true, days, entries: entries.slice(0, 800) });
    }

    // the Build Log merged into /activity's 🔨 tab — keep the old URL working
    if (path === '/buildlog') {
      return new Response(null, { status: 301, headers: { Location: '/activity#build', ...CORS } });
    }

    // the activity PAGE is owner-only too (the link is visible to everyone; the data is not)
    if (path === '/activity' && who(request) !== ownerEmail(env)) {
      return new Response('<!doctype html><meta charset="utf-8"><title>Restricted</title><body style="font-family:Lato,system-ui,sans-serif;padding:60px;color:#333"><h2>Restricted</h2><p>The user activity log is only available to the account owner.</p><p><a href="/" style="color:#ED6F0B;font-weight:700">← Back to the command center</a></p>', { status: 403, headers: { 'content-type': 'text/html;charset=utf-8' } });
    }

    // ---- Leadership = the owner's dashboard. The landing (book health, commercial burn-down,
    // retention radar) AND the modules folded under it — Readiness, Task library, Build roadmap —
    // are all gated to OWNER_EMAIL via the verified Access identity. The old standalone URLs
    // 301 into their /leadership/* homes so bookmarks and deep links keep working.
    if ((path === '/leadership' || path.startsWith('/leadership/')) && who(request) !== ownerEmail(env)) {
      logActivity(ctx, env, request, 'view-denied', path);
      return new Response('<!doctype html><meta charset="utf-8"><title>Restricted</title><body style="font-family:Lato,system-ui,sans-serif;padding:60px;color:#333"><h2>Restricted</h2><p>The leadership dashboard is only available to the account owner.</p><p><a href="/" style="color:#ED6F0B;font-weight:700">← Back to the command center</a></p>', { status: 403, headers: { 'content-type': 'text/html;charset=utf-8' } });
    }
    if (path === '/readiness' || path === '/library' || path === '/roadmap') {
      return new Response(null, { status: 301, headers: { Location: '/leadership' + path, ...CORS } });
    }

    // ---- deploy version marker: confirm which git build is actually live (the deploy Action
    // stamps GIT_SHA / GIT_REF / BUILT_AT via `wrangler deploy --var`). Answers "is my push live?"
    // in one request instead of guessing whether CF is serving a stale build.
    if (path === '/api/version') {
      return json({ worker: 'feedspark', sha: env.GIT_SHA || 'dev', ref: env.GIT_REF || '', builtAt: env.BUILT_AT || '' });
    }

    // ---- edits (content layer: Ray, in-browser) — namespaced per page by ?page=<slug> ----
    if (path === '/api/edits') {
      const slug = (url.searchParams.get('page') || 'home').replace(/[^a-z0-9_-]/gi, '');
      const key = 'edits:' + slug;
      if (request.method === 'GET') {
        const edits = await env.EDITS.get(key, 'json');
        return json(edits || {});
      }
      // sendBeacon can only issue a POST, and a beacon is the only save that reliably
      // survives the document going away (a normal fetch is cancelled at exactly that
      // moment). Treated as a merge PUT — same body, same semantics.
      if (request.method === 'POST' && url.searchParams.get('beacon') === '1') {
        try {
          const incoming = await request.json();
          const current = (await env.EDITS.get(key, 'json')) || {};
          await env.EDITS.put(key, JSON.stringify({ ...current, ...incoming }));
          return json({ ok: true, page: slug, beacon: true });
        } catch (e) {
          return json({ ok: false, error: String((e && e.message) || e) }, 500);
        }
      }
      if (request.method === 'PUT') {
        // A bare `await request.json()` here — unlike every other POST/PUT route in this file —
        // threw uncaught on a malformed/empty body, which Cloudflare turns into an opaque, empty
        // 500 with no body: a real Reset attempt hit exactly this and the client had nothing to
        // show but "http-500:". Wrapping the whole handler means whatever the underlying cause
        // (bad body, a transient KV error, anything else) it comes back as a diagnosable error
        // instead of a blank crash.
        try {
          let incoming; try { incoming = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
          // ?replace=1 swaps the whole object in ONE put. Undo used to DELETE then PUT, so a
          // failure between the two left the page with no edits at all — a real data-loss window.
          const replace = url.searchParams.get('replace') === '1';
          const current = (await env.EDITS.get(key, 'json')) || {};
          // Same snapshot-before-overwrite the DELETE handler below does: a replace=1 PUT is just
          // as capable of discarding a whole overlay as DELETE is (Reset now uses this path — see
          // the client script), so it gets the same undo-a-Reset safety net.
          if (replace && Object.keys(current).length) {
            // __reason rides along so a backup list is readable after the fact — "which of
            // these 30 snapshots was the Reset I need to undo?" was previously unanswerable.
            await env.EDITS.put('edits-bak:' + slug + ':' + Date.now(),
              JSON.stringify({ __reason: Object.keys(incoming).length ? 'undo' : 'reset', ...current }));
          }
          const existing = replace ? {} : current;
          const merged = { ...existing, ...incoming };
          // ?drop=k1,k2 removes exactly those keys and nothing else. Before this, the only
          // way to clear a handful of stale entries was Reset, which wipes the whole overlay
          // — so clearing 14 dead tombstones cost 122 good edits, and the rational move was
          // to leave the bad state in place and live with the banner.
          const drop = (url.searchParams.get('drop') || '').split(',').map((s) => s.trim()).filter(Boolean);
          let dropped = 0;
          if (drop.length) {
            if (Object.keys(current).length) {
              await env.EDITS.put('edits-bak:' + slug + ':' + Date.now(),
                JSON.stringify({ __reason: 'drop', __keys: drop, ...current }));
            }
            for (const k of drop) if (k in merged) { delete merged[k]; dropped++; }
          }
          await env.EDITS.put(key, JSON.stringify(merged));
          return json({ ok: true, page: slug, count: Object.keys(merged).length, dropped });
        } catch (e) {
          return json({ ok: false, error: String((e && e.message) || e) }, 500);
        }
      }
      if (request.method === 'DELETE') {
        // Logged explicitly: the activity feed only records PUT/POST, so a wipe used to leave
        // no trace at all — which made "where did my edits go?" unanswerable after the fact.
        logActivity(ctx, env, request, 'edits-cleared', slug);
        // Snapshot before wiping. Reset is the correct fix when a stale overlay is mis-landing
        // on a renumbered template, but it used to be irreversible — so the only safe advice
        // was "don't press it", which left the bad overlay in place. Keeping a timestamped
        // copy makes Reset a recoverable action: the overlay can always be read back out of
        // edits-bak:<slug>:<ts> and cherry-picked.
        const doomed = await env.EDITS.get(key);
        if (doomed && doomed !== '{}') {
          await env.EDITS.put('edits-bak:' + slug + ':' + Date.now(),
            JSON.stringify({ __reason: 'delete', ...JSON.parse(doomed) }));
        }
        await env.EDITS.delete(key);
        return json({ ok: true, page: slug, cleared: true, backed_up: !!(doomed && doomed !== '{}') });
      }
    }

    // ---- edit-overlay backups (read-only): list or fetch a snapshot taken by a Reset ----
    if (path === '/api/edits/backups') {
      const slug = (url.searchParams.get('page') || 'home').replace(/[^a-z0-9_-]/gi, '');
      const at = url.searchParams.get('at');
      if (at) return json((await env.EDITS.get('edits-bak:' + slug + ':' + at.replace(/\D/g, ''), 'json')) || {});
      // Prune while we're here: backups were written on every Reset/replace/drop and never
      // removed, so the list grew without bound and every entry looked identical from the
      // outside (no record of what caused it). Newest 50 kept.
      {
        const all = await env.EDITS.list({ prefix: 'edits-bak:' + slug + ':' });
        const stale = all.keys.map((k) => k.name).sort().slice(0, Math.max(0, all.keys.length - 50));
        for (const name of stale) await env.EDITS.delete(name);
      }
      const list = await env.EDITS.list({ prefix: 'edits-bak:' + slug + ':' });
      return json(list.keys.map((k) => ({
        at: k.name.split(':').pop(),
        iso: new Date(+k.name.split(':').pop()).toISOString(),
      })).sort((a, b) => b.at - a.at));
    }

    // ---- feedback store (per-deck review notes, namespaced per page like /api/edits) ----
    // A JSON array of {id, target, label, note, ts} — the whole array is owned by the page's
    // feedback panel and PUT wholesale; small N (a review round's worth of notes), no races
    // worth the complexity.
    if (path === '/api/feedback') {
      const slug = (url.searchParams.get('page') || 'home').replace(/[^a-z0-9_-]/gi, '');
      const key = 'feedback:' + slug;
      if (request.method === 'GET') {
        return json((await env.EDITS.get(key, 'json')) || []);
      }
      if (request.method === 'PUT') {
        const body = await request.json();
        // Tag any note that doesn't already carry an author (i.e. new since the last save) with
        // the verified Access identity of whoever is saving — lets a shared per-deck feedback
        // list (Ray, Steven, anyone with access) show who left what, not just what was said.
        const author = who(request);
        for (const note of body || []) { if (note && !note.author) note.author = author; }
        await env.EDITS.put(key, JSON.stringify(body));
        return json({ ok: true, page: slug, count: (body || []).length });
      }
      if (request.method === 'DELETE') {
        await env.EDITS.delete(key);
        return json({ ok: true, page: slug, cleared: true });
      }
    }

    // ---- briefs store (Workflow control center: brief/ticket pipeline, shared across the team) ----
    // A single JSON object keyed by brief id: {id: {client, code, task, due, status, comms, ...}}.
    // The board owns its state and PUTs the whole map; small N, no races worth the complexity.
    if (path === '/api/briefs') {
      // brief pipeline: deletion = absence, disambiguated by the writer's X-Sync-Base read-stamp
      const r = await mapStoreRoute(env, request, 'briefs', {});
      if (r) return r;
    }

    // ---- Gmail → briefs status sync (the NO-ADMIN path): a Google Apps Script running in the
    // mailbox owner's own account (tools/gmail_push.gs, authorised by the user — no Workspace
    // super-admin, no domain-wide delegation) POSTs recent brief-thread messages here on a
    // 15-min trigger. briefmatch.js applies them to the Workflow tickets with the SAME rules
    // as the page's paste-router (ibfcode/id/wording match; done→done|analysis, blocked,
    // progress; ibfdue/eta → due; forward-only; deduped by message id).
    // Auth: X-FCC-Push-Key must equal the GMAIL_PUSH_KEY secret, and this exact path needs a
    // Cloudflare Access BYPASS policy (Apps Script can't pass Access) — docs/GOOGLE_SETUP.md §8.
    if (path === '/api/gmail/push' && request.method === 'POST') {
      if (!env.GMAIL_PUSH_KEY) return json({ ok: false, error: 'push key not configured — wrangler secret put GMAIL_PUSH_KEY' }, 503);
      if (request.headers.get('X-FCC-Push-Key') !== env.GMAIL_PUSH_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }

      // Label Guard email bridge: the SAME key-gated Apps Script drains queued alert emails
      // (KV labeloutbox) and sends them from Ray's own mailbox — a worker can't send mail
      // itself. Poll returns the queue; ack clears exactly what was sent (see gmail_push.gs).
      if (body.outboxPoll) {
        // drafts: client-ask emails composed on /labels — the script CREATES GMAIL DRAFTS
        // (with the breakdown images attached) rather than sending; techam: message ids the
        // script FORWARDS to the TechAM team from the owner's mailbox. Capped per poll to
        // keep the payload sane; older script versions simply ignore the extra fields.
        return json({ ok: true, outbox: ((await env.EDITS.get('labeloutbox', 'json')) || []).slice(0, 20),
          drafts: ((await env.EDITS.get('labeldrafts', 'json')) || []).slice(0, 3),
          techam: ((await env.EDITS.get('techamq', 'json')) || []).slice(0, 10) });
      }
      if (Array.isArray(body.techamAck)) {
        const tq = (await env.EDITS.get('techamq', 'json')) || [];
        const drop = {}; body.techamAck.forEach((id) => { drop[String(id)] = 1; });
        const left = tq.filter((e) => !drop[e.qid]);
        await env.EDITS.put('techamq', JSON.stringify(left));
        logActivity(ctx, env, request, 'techam-send', 'forwarded to TechAM ×' + (tq.length - left.length), 'gmail-bridge');
        return json({ ok: true, cleared: tq.length - left.length, left: left.length });
      }
      if (Array.isArray(body.draftsAck)) {
        const dq = (await env.EDITS.get('labeldrafts', 'json')) || [];
        const drop = {}; body.draftsAck.forEach((id) => { drop[String(id)] = 1; });
        const left = dq.filter((e) => !drop[e.id]);
        await env.EDITS.put('labeldrafts', JSON.stringify(left));
        logActivity(ctx, env, request, 'label-ask', 'client-ask Gmail draft created ×' + (dq.length - left.length), 'gmail-bridge');
        return json({ ok: true, cleared: dq.length - left.length, left: left.length });
      }
      if (Array.isArray(body.outboxAck)) {
        const ob = (await env.EDITS.get('labeloutbox', 'json')) || [];
        const drop = {}; body.outboxAck.forEach((id) => { drop[String(id)] = 1; });
        const left = ob.filter((e) => !drop[e.id]);
        await env.EDITS.put('labeloutbox', JSON.stringify(left));
        logActivity(ctx, env, request, 'label-alert', 'alert email sent ×' + (ob.length - left.length), 'gmail-bridge');
        return json({ ok: true, cleared: ob.length - left.length, left: left.length });
      }

      // inbox feed: general incoming mail → classify (client + briefable) and store for the
      // Workflow's "Incoming emails" stream. Same endpoint/key/bypass as the brief sync.
      if (Array.isArray(body.inbox)) {
        const inbox = body.inbox.slice(0, 150);
        const selfSrc2 = String(env.GMAIL_SELF || 'ray@feedspark.com').replace(/[.^$*+?()[\]{}|\\]/g, '\\$&');
        const selfRe2 = new RegExp(selfSrc2, 'i');
        const dossier = liftEnvelope(await env.EDITS.get('clients', 'json'), Date.now()).data;
        const clientDoms = {}; Object.keys(dossier).forEach((n) => { if (dossier[n] && dossier[n].dom) clientDoms[n] = dossier[n].dom; });
        const stored = (await env.EDITS.get('gmailinbox', 'json')) || [];
        const seen = {}; stored.forEach((it) => { if (it.id) seen[it.id] = 1; });
        // Gemini/Meet call-notes emails are CALL RECORDS, not triage items: their action items
        // are parsed into KV callactions (→ Intake rows with a 📞 Call source, Ray's ask) and the
        // email never enters the triage queue — the noreply noise gate would eat it there anyway.
        // Dedupe is by message id, so the 2-day rolling re-push files each call exactly once.
        const calls = (await env.EDITS.get('callactions', 'json')) || [];
        const haveCall = {}; calls.forEach((a) => { if (a.mid) haveCall[a.mid] = 1; });
        let added = 0, briefable = 0, callsAdded = 0;
        const names = Object.keys(dossier);
        for (const m of inbox) {
          if (!m || !m.id) continue;
          // The call-notes check runs BEFORE the stored-id dedupe: a notes email captured as a
          // plain triage item before detection learned its shape (the real gemini-notes@
          // specimen sat in gmailinbox for half an hour) must still become call actions once a
          // smarter parser ships — and its mis-filed triage entry is lifted out below.
          const g = parseGeminiNotes(m);
          if (g) {
            if (!haveCall[m.id] && g.actions.length) {
              if (seen[m.id]) {   // remove the pre-detection triage capture — the actions ARE the record
                const j = stored.findIndex((it) => it && it.id === m.id);
                if (j >= 0) stored.splice(j, 1);
                delete seen[m.id];
              }
              // client cue ladder: the meeting title alone first (a body mention could be any
              // brand discussed), then title+body head; a brand named IN the action line wins.
              const ex0 = detectClientEx({ subject: g.call, snippet: '' }, clientDoms, names);
              const ex = ex0.client ? ex0 : detectClientEx({ subject: g.call, snippet: String(m.snippet || '').slice(0, 600) }, clientDoms, names);
              g.actions.forEach((a, i) => {
                const exA = detectClientEx({ subject: a.task, snippet: '' }, clientDoms, names);
                calls.push({ id: m.id + '#' + i, mid: m.id, call: g.call, client: exA.client || ex.client || '',
                  via: exA.client ? exA.via : (ex.via || ''), when: g.when || m.date || Date.now(), owner: a.owner || '', task: a.task });
                callsAdded++;
              });
              haveCall[m.id] = 1;
            }
            continue;
          }
          if (seen[m.id]) continue;   // ordinary mail: already captured on an earlier push
          const c = classifyInbound(m, clientDoms, { selfRe: selfRe2, clientNames: names });
          if (c.hints[0] === 'noise/self') continue;
          stored.push({ id: m.id, from: String(m.from || '').slice(0, 120), subject: String(m.subject || '(no subject)').slice(0, 160),
            snippet: String(m.snippet || '').slice(0, 220), date: m.date || Date.now(), client: c.client, briefable: c.briefable, hints: c.hints });
          seen[m.id] = 1; added++; if (c.briefable) briefable++;
        }
        if (callsAdded) {
          calls.sort((a, b) => (b.when || 0) - (a.when || 0));
          await env.EDITS.put('callactions', JSON.stringify(calls.slice(0, 300)));
        }
        stored.sort((a, b) => (b.date || 0) - (a.date || 0));
        await env.EDITS.put('gmailinbox', JSON.stringify(stored.slice(0, 120)));
        logActivity(ctx, env, request, 'gmail-inbox', added + ' new · ' + briefable + ' briefable' + (callsAdded ? (' · ' + callsAdded + ' call actions') : ''), 'gmail-sync');
        return json({ ok: true, received: inbox.length, added, briefable, callActions: callsAdded });
      }

      const messages = Array.isArray(body.messages) ? body.messages.slice(0, 200) : [];
      if (!messages.length) return json({ ok: true, matched: 0, moved: [] });
      const now = Date.now();
      const envx = liftEnvelope(await env.EDITS.get('briefs', 'json'), now);
      const briefs = envelopeToClient(envx, {});
      const selfSrc = String(env.GMAIL_SELF || 'ray@feedspark.com').replace(/[.^$*+?()[\]{}|\\]/g, '\\$&');
      const res = matchGmailToBriefs(briefs, messages, { now, selfRe: new RegExp(selfSrc, 'i'), aspl: ['Dinesh', 'Thia', 'Mariraj', 'Muji'], repair: true });   // ibfref repair self-heals mis-filed replies as the rolling window re-pushes
      if (res.matched || (res.repaired && res.repaired.length)) {
        mergeIntoEnvelope(envx, briefs, now, now, {});   // full map present → pure upserts, no deletions
        await env.EDITS.put('briefs', JSON.stringify(envx));
      }
      logActivity(ctx, env, request, 'gmail-sync', res.matched + ' matched · ' + res.moved.length + ' moved' + ((res.repaired && res.repaired.length) ? (' · ' + res.repaired.length + ' repaired') : ''), 'gmail-sync');
      // rolling run history for the Activity page's Gmail-sync panel (last 60 runs)
      try {
        const runlog = (await env.EDITS.get('gmailpushlog', 'json')) || [];
        runlog.push({ t: now, n: messages.length, m: res.matched, s: res.skipped, moved: res.moved.slice(0, 12) });
        await env.EDITS.put('gmailpushlog', JSON.stringify(runlog.slice(-60)));
      } catch (e) {}
      return json({ ok: true, matched: res.matched, skipped: res.skipped, moved: res.moved, tickets: res.loggedTo });
    }

    // ---- due-today task reminders: preview + manual fire (owner-only) ----
    // GET = dry preview of what the 12:00 GMT cron would send right now (never writes);
    // POST = queue the reminders immediately ({force:true} re-runs after today's cron pass —
    // the day-scoped outbox ids still make a double-send impossible).
    if (path === '/api/tasks/remind') {
      if (who(request) !== ownerEmail(env)) return json({ error: 'restricted to the account owner' }, 403);
      if (request.method === 'GET') return json(await queueDueReminders(env, { dry: true }));
      if (request.method === 'POST') {
        let body; try { body = await request.json(); } catch (e) { body = {}; }
        const r = await queueDueReminders(env, { force: !!body.force });
        logActivity(ctx, env, request, 'task-remind', (r.queued || 0) + ' reminder(s) queued');
        return json(r);
      }
    }

    // ---- TechAM delegation: the TechAM team answers common client-email requests A2Z, so a
    // triaged email can be handed straight to them. POST queues the ORIGINAL message for a real
    // Gmail FORWARD from the owner's mailbox (the bridge script does message.forward — full
    // body + attachments); the address is remembered (KV techamcfg). The page files the plan
    // record (born Done, owner TechAM) and the triage decision separately.
    if (path === '/api/gmail/techam') {
      if (request.method === 'GET') {
        const cfg = (await env.EDITS.get('techamcfg', 'json')) || {};
        return json({ to: cfg.to || '' });
      }
      if (request.method === 'POST') {
        let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
        const mid = String(b.id || '').slice(0, 64);
        const to = String(b.to || '').slice(0, 160).trim();
        if (!mid) return json({ error: 'missing id' }, 400);
        if (to.indexOf('@') < 1) return json({ error: 'not an email address' }, 400);
        await env.EDITS.put('techamcfg', JSON.stringify({ to }));
        const q = (await env.EDITS.get('techamq', 'json')) || [];
        if (!q.some((e) => e && e.id === mid)) q.push({ qid: 'ta_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: mid, to, t: Date.now() });
        await env.EDITS.put('techamq', JSON.stringify(q.slice(-50)));
        return json({ ok: true, queued: q.length });
      }
    }

    // ---- call-action edits: unattributed 📞 rows have no plan sheet to write to, so their
    // status / due / client live on the KV entry itself — shared by the whole team, and the
    // client assignment is what lets the page adopt the row into a real plan sheet.
    if (path === '/api/gmail/calls' && request.method === 'PUT') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const cid = String(b.id || '');
      if (!cid) return json({ error: 'missing id' }, 400);
      const calls2 = (await env.EDITS.get('callactions', 'json')) || [];
      const hit = calls2.filter((a) => a && a.id === cid)[0];
      if (!hit) return json({ error: 'unknown call action' }, 404);
      if (b.s != null) hit.s = String(b.s).slice(0, 24);
      if (b.due != null) hit.due = String(b.due).slice(0, 10);        // ISO yyyy-mm-dd, '' clears
      if (b.client != null) hit.client = String(b.client).slice(0, 60);
      await env.EDITS.put('callactions', JSON.stringify(calls2));
      logActivity(ctx, env, request, 'call-edit', (hit.task || '').slice(0, 60));
      return json({ ok: true });
    }

    // the Gmail-sync run history (owner-only, rendered beside the activity stream)
    if (path === '/api/gmail/pushlog' && request.method === 'GET') {
      if (who(request) !== ownerEmail(env)) return json({ error: 'restricted to the account owner' }, 403);
      return json({ runs: ((await env.EDITS.get('gmailpushlog', 'json')) || []).slice(-60).reverse() });
    }

    // ---- Gmail triage decision: every captured email is either a task or not a task ----
    // The Workflow triage panel posts here. reason 'briefed' = it became a ticket; 'notask' =
    // dismissed. Decisions are remembered server-side (KV gmaildismissed) so the email stays
    // out of the pending queue on every later push; undo:true restores it.
    if (path === '/api/gmail/dismiss' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      // Accept ONE id or a whole thread's ids in one call. The page used to fire a POST per
      // email when clearing a thread; each request did get->mutate->put on the SAME KV key, so
      // the concurrent writes clobbered each other and all but one decision were lost —
      // dismissed threads resurfaced on the next refresh (Ray's report). One request, one write.
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id])
        .map((x) => String(x || '').slice(0, 64)).filter(Boolean).slice(0, 50);
      if (!ids.length) return json({ ok: false, error: 'missing id' }, 400);
      const dis = (await env.EDITS.get('gmaildismissed', 'json')) || {};
      const validReasons = ['briefed', 'task', 'notask', 'techam'];
      const reason = validReasons.includes(body.reason) ? body.reason : 'notask';
      let target = ids;
      if (body.undo) {
        // restoring un-decides the WHOLE conversation, not just the clicked email — decisions
        // inherit down a thread (see the intake read), so a sibling still carrying one would
        // re-dismiss the restored email on the very next refresh
        const inboxItems = (await env.EDITS.get('gmailinbox', 'json')) || [];
        const tkeys = {}; inboxItems.forEach((it) => { if (ids.indexOf(String(it.id)) >= 0) { const k = mailThreadKey(it.subject); if (k) tkeys[k] = 1; } });
        target = ids.slice();
        inboxItems.forEach((it) => { const k = mailThreadKey(it.subject);
          if (k && tkeys[k] && target.indexOf(String(it.id)) < 0) target.push(String(it.id)); });
      }
      target.forEach((id) => { if (body.undo) delete dis[id]; else dis[id] = { t: Date.now(), r: reason }; });
      const keys = Object.keys(dis);   // prune to the newest 800 decisions
      if (keys.length > 800) keys.sort((a, b) => (dis[a].t || 0) - (dis[b].t || 0)).slice(0, keys.length - 800).forEach((k) => delete dis[k]);
      await env.EDITS.put('gmaildismissed', JSON.stringify(dis));
      logActivity(ctx, env, request, body.undo ? 'gmail-restore' : 'gmail-dismiss',
        (body.undo ? '' : reason + ' · ') + (ids.length > 1 ? ids.length + ' emails · ' : '') + ids[0].slice(0, 24));
      return json({ ok: true, dismissed: !body.undo, n: ids.length });
    }

    // ================= Feed Lab: live shopping-feed audit =================
    // The heavy lifting happens IN THE BROWSER: the page streams the client's live
    // Google-Sheet feed through the proxy below (the worker only pipes bytes - a 50MB
    // CSV parse would blow the CPU budget), runs feedlab_engine.js on it, and PUTs the
    // small audit JSON back here for caching. Feeds refresh daily upstream; the page
    // re-scans when the cached audit is older than 20h.

    // Feed wiring (DEFAULT_FEEDS + feedMarketsFor/feedSourceFor) lives at MODULE scope now —
    // the Label Guard cron sweep in scheduled() resolves feeds too, not just fetch() routes.

    // ---- Tachyon Pricer: collaborative rate card + saved quotes (kvmerge = every team
    // edits the same numbers concurrency-safe; edits are activity-logged per Access user) ----
    // Keyword calendar store — per-client marketing moments + measured feed impact (kvmerge)
    if (path === '/api/kwcal') {
      const r = await mapStoreRoute(env, request, 'kwcal', {});
      if (r) return r;
    }
    // Feed Chat question bank — the AM-editable question stack (kvmerge; git QSTACK is the seed).
    // Routing runs off this bank in-page, so answers never require the Anthropic key.
    if (path === '/api/feedchat') {
      const r = await mapStoreRoute(env, request, 'feedchat', {});
      if (r) return r;
    }
    // FCC-PRESENCE heartbeat: stamp the caller's Access identity into the `presence` map and
    // return everyone's last-seen. One beat per open page per minute — deliberately NOT in the
    // ACT activity log (heartbeats would drown the real usage trail /api/activity keeps).
    if (path === '/api/presence' && request.method === 'POST') {
      const me = who(request);
      let body = {}; try { body = await request.json(); } catch (e) { body = {}; }
      const now = Date.now();
      const map = (await env.EDITS.get('presence', 'json')) || {};
      if (me !== 'unknown' && !me.startsWith('service:')) {
        map[me] = { t: now, page: String(body.page || '').slice(0, 40) };
      }
      for (const k of Object.keys(map)) { if (now - (map[k].t || 0) > 30 * 86400000) delete map[k]; }
      ctx.waitUntil(env.EDITS.put('presence', JSON.stringify(map)));
      const users = Object.keys(map).map((e) => ({ e, t: map[e].t || 0, page: map[e].page || '' }));
      return json({ ok: true, me, now, users });
    }
    if (path === '/api/tachyon/rates') {
      const r = await mapStoreRoute(env, request, 'tachyonrates', {});
      if (r) return r;
    }
    if (path === '/api/tachyon/quotes') {
      const r = await mapStoreRoute(env, request, 'tachyonquotes', {});
      if (r) return r;
    }
    // per-brief AI delivery tracking (hours, Tachyon tokens, volume done, categories done) —
    // the Pricer's collaborative table writes here, keyed by brief id; briefs stay untouched
    if (path === '/api/tachyon/track') {
      const r = await mapStoreRoute(env, request, 'tachyontrack', {});
      if (r) return r;
    }
    if (path === '/pricer/gpc.txt' && request.method === 'GET') {
      return new Response(GPC_TAXONOMY, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
    }
    if (path === '/pricer/engine.js' && request.method === 'GET') {
      return new Response(PRICER_ENGINE, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
    }

    // the engine, served verbatim so the page and node tests share one file
    if (path === '/feedlab/engine.js' && request.method === 'GET') {
      return new Response(FEEDLAB_ENGINE, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
    }

    // KWCal calendar seeds: brand planner slides bundled in git (see CAL_SEED_FILES above)
    if (path.startsWith('/kwcal/cal/') && request.method === 'GET') {
      const f = CAL_SEED_FILES[path.slice('/kwcal/cal/'.length)];
      if (!f) return json({ error: 'not_found' }, 404);
      return new Response(f.body, { headers: { 'content-type': f.mime, 'cache-control': 'public, max-age=86400' } });
    }

    // stream the live feed CSV through untouched (no open proxy: only clients whose feed
    // is in the dossier or DEFAULT_FEEDS resolve; the sheet id itself never comes from the query)
    if (path === '/api/feed/proxy' && request.method === 'GET') {
      const client = url.searchParams.get('client') || '';
      const src = await feedSourceFor(env, client, url.searchParams.get('market'));
      if (!src) return json({ error: 'no feed sheet linked for this client/market - attach one in Feed Lab or the brand dossier' }, 404);
      if (src.xml) {
        // FeedHero-hosted XML (Meta/FB channel) — realtime upstream, streamed through untouched;
        // the page's engine sniffs XML vs CSV from the first bytes, so one proxy serves both
        const upx = await fetch(src.xml);
        const ctx2 = upx.headers.get('content-type') || '';
        if (!upx.ok || !upx.body || !/xml|rss|octet-stream/i.test(ctx2)) {
          return json({ error: 'feed XML fetch failed (' + upx.status + ', ' + (ctx2.split(';')[0] || 'no type') + ')' }, 502);
        }
        return new Response(upx.body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' } });
      }
      const up = await fetch('https://docs.google.com/spreadsheets/d/' + src.id + '/export?format=csv&gid=' + src.gid);
      // a non-link-shared sheet 307s to Google's LOGIN PAGE with a 200 — final content-type is
      // the only reliable tell. Never forward content-length: Google gzips, the header counts
      // compressed bytes, and an explicit length would truncate the decompressed stream.
      const ct = up.headers.get('content-type') || '';
      if (!up.ok || !up.body || !/csv|text\/plain/i.test(ct)) {
        return json({ error: 'feed sheet fetch failed (' + up.status + ', ' + (ct.split(';')[0] || 'no type') + ') - is the sheet link-shared?' }, 502);
      }
      return new Response(up.body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // roster bootstrap: every client with a live feed (code-wired from the master sheet
    // and/or dossier-attached) + its market codes — the Feed Lab selector and the CC
    // dossier read this ONE call instead of re-deriving feeds from the clients store
    if (path === '/api/feed/clients' && request.method === 'GET') {
      const out = {};
      Object.keys(DEFAULT_FEEDS).forEach((c) => { out[c] = { wired: Object.keys(DEFAULT_FEEDS[c]), attached: [] }; });
      try {
        const dossier = liftEnvelope(await env.EDITS.get('clients', 'json'), Date.now()).data;
        Object.keys(dossier).forEach((c) => {
          const rec = dossier[c] || {}; const mks = {};
          if (rec.feed && feedRef(rec.feed)) mks.gb = 1;
          if (rec.feeds && typeof rec.feeds === 'object') {
            Object.keys(rec.feeds).forEach((mk) => { if (feedRef(rec.feeds[mk])) mks[mktOf(mk)] = 1; });
          }
          const list = Object.keys(mks);
          if (list.length) { out[c] = out[c] || { wired: [], attached: [] }; out[c].attached = list; }
        });
      } catch (e) {}
      return json({ clients: out });
    }

    // the portal's one-call bootstrap: every attached market + its cached audit summary
    if (path === '/api/feed/markets' && request.method === 'GET') {
      const client = (url.searchParams.get('client') || '').slice(0, 60);
      if (!client || client.indexOf(':') >= 0) return json({ error: 'bad client' }, 400);
      const mkts = await feedMarketsFor(env, client);
      const idx = (await env.EDITS.get('feedmkt:' + client, 'json')) || {};
      const out = {};
      Object.keys(mkts).forEach((mk) => { out[mk] = idx[mk] || null; });   // null = never scanned
      // markets = wired ∪ attached ONLY. The scan index is a summary cache, never a market
      // source — stale idx entries (markets scanned once, since detached) used to be merged
      // back in as `detached:true` and the page rendered them as real markets (phantom chips
      // on brands like Monsoon that only have gb).
      return json({ client, markets: out });
    }

    // cached audit JSON per client+market (+ a daily score history the page charts)
    if (path === '/api/feed/audit') {
      const client = (url.searchParams.get('client') || '').slice(0, 60);
      // ':' would let ?client=hist:Reiss alias another client's history key - reject outright
      if (!client || client.indexOf(':') >= 0) return json({ error: 'bad client' }, 400);
      const mkt = mktOf(url.searchParams.get('market'));
      const K = 'feedaudit:' + client + ':' + mkt;
      if (request.method === 'GET') {
        // legacy fallback: pre-multi-market audits lived at feedaudit:<client> — serve them as gb
        let a = await env.EDITS.get(K, 'json');
        if (!a && mkt === 'gb') a = await env.EDITS.get('feedaudit:' + client, 'json');
        if (url.searchParams.get('hist') === '1') {
          let h = (await env.EDITS.get(K.replace('feedaudit:', 'feedaudit:hist:'), 'json')) || null;
          if (!h && mkt === 'gb') h = (await env.EDITS.get('feedaudit:hist:' + client, 'json')) || [];
          return json({ audit: a || null, hist: h || [] });
        }
        return json(a || {});
      }
      if (request.method === 'PUT') {
        let a; try { a = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
        if (!a || !a.score || !a.score.pillars || typeof a.score.total !== 'number') return json({ error: 'not an audit payload' }, 400);
        // only markets actually attached to this client may be written — an audit PUT for
        // anything else would seed the feedmkt: index with a market the brand doesn't have
        // (env is the first arg since the resolvers moved to module scope for the Label Guard
        // cron — without it this guard resolved null for EVERY feed and 400'd all audit PUTs)
        if (!(await feedSourceFor(env, client, mkt))) return json({ error: 'market not attached for this client' }, 400);
        a.client = client; a.market = mkt; a.fetchedAt = Date.now();
        const body = JSON.stringify(a);
        if (body.length > 400000) return json({ error: 'audit too large' }, 413);
        await env.EDITS.put(K, body);
        try {
          const HK = K.replace('feedaudit:', 'feedaudit:hist:');
          const hist = (await env.EDITS.get(HK, 'json')) || [];
          hist.push({ t: a.fetchedAt, total: a.score.total, tier: a.score.tier, rows: a.rowCount || 0 });
          await env.EDITS.put(HK, JSON.stringify(hist.slice(-90)));
          // compact per-client market index — the portal reads ONE key for its whole grid
          const idx = (await env.EDITS.get('feedmkt:' + client, 'json')) || {};
          const pill = {}; (a.score.pillars || []).forEach((p) => { pill[p.key] = p.score; });
          idx[mkt] = { t: a.fetchedAt, total: a.score.total, tier: a.score.tier, tierLabel: a.score.tierLabel || '',
            rows: a.rowCount || 0, sampled: a.sampled || 0, pillars: pill,
            topGap: (a.recs && a.recs[0] && a.recs[0].title) || '' };
          await env.EDITS.put('feedmkt:' + client, JSON.stringify(idx));
        } catch (e) {}
        return json({ ok: true, fetchedAt: a.fetchedAt, market: mkt });
      }
      return json({ error: 'method not allowed' }, 405);   // a POST would otherwise log activity, then 404
    }

    // ---- Label Guard: custom_label_0..4 capture + drop-off monitoring across every wired
    // feed (page at /labels; full spec docs/LABELGUARD.md). Google's gviz endpoint does the
    // pivots server-side, so the worker never parses a raw feed CSV (CPU budget rule).
    if (path.startsWith('/api/labels/')) {
      const r = await labelGuardRoutes(env, request, url);
      if (r) return r;
    }

    // ---- Product Type Guard: primary g:product_type capture + drop-off monitoring,
    // Google Shopping channel only (page at /ptypes). Rides the same scan pass as Label
    // Guard — runLabelScan captures PT into its own ptype* stores on every Google-feed scan.
    if (path.startsWith('/api/ptypes/')) {
      const r = await productTypeRoutes(env, request, url);
      if (r) return r;
    }

    // ---- Golden Record: attribute coverage vs Google's product data spec, Google
    // Shopping channel only (page at /golden). Captured by runLabelScan on the same
    // multi-count query — these routes just read/ack the golden* stores.
    if (path.startsWith('/api/golden/')) {
      const r = await goldenRoutes(env, request, url);
      if (r) return r;
    }

    // ---- Build Log queue: Ray's "not built yet" backlog (kvmerge-backed, concurrency-safe) ----
    if (path === '/api/buildqueue') {
      const r = await mapStoreRoute(env, request, 'buildqueue', {});
      if (r) return r;
    }

    // ---- Build Log feed: PRs + active branches + per-branch changed files from the public
    // GitHub API, cached in KV (10 min) to stay far under unauthenticated rate limits. The
    // /buildlog page derives shipped / in-build / dropped / overlap from this — no manual log
    // to go stale. Optional GITHUB_TOKEN secret raises the rate limit; not required.
    if (path === '/api/buildlog' && request.method === 'GET') {
      const force = url.searchParams.get('force') === '1';
      const ck = 'buildlog:gh';
      let data = force ? null : await env.EDITS.get(ck, 'json');
      if (!data) {
        const gh = async (p) => {
          const r = await fetch('https://api.github.com/repos/rayvtt/feedspark' + p, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'feedspark-fcc',
              ...(env.GITHUB_TOKEN ? { authorization: 'Bearer ' + env.GITHUB_TOKEN } : {}) } });
          if (!r.ok) throw new Error('github ' + r.status);
          return r.json();
        };
        try {
          const pulls = await gh('/pulls?state=all&per_page=60&sort=updated&direction=desc');
          const branches = await gh('/branches?per_page=100');
          const active = branches.filter(b => b.name !== 'main' && /^claude\//.test(b.name));
          const branchFiles = {};
          for (const b of active.slice(0, 8)) {   // cap compares: 8 branches ≈ 10 API calls/refresh
            try {
              const cmp = await gh('/compare/main...' + encodeURIComponent(b.name));
              const fs = (cmp.files || []).map(f => f.filename);
              if (fs.length) branchFiles[b.name] = fs.slice(0, 40);
            } catch (e) { /* branch may be identical to main or compare too large — skip */ }
          }
          data = { at: Date.now(),
            pulls: pulls.map(p => ({ n: p.number, t: p.title, s: p.state, m: !!p.merged_at, ma: p.merged_at || '',
              mc: p.merge_commit_sha || '', ca: p.created_at, ua: p.updated_at, b: (p.head && p.head.ref) || '', u: p.html_url })),
            branchFiles };
          await env.EDITS.put(ck, JSON.stringify(data), { expirationTtl: 600 });
          await env.EDITS.put(ck + ':stale', JSON.stringify(data));
        } catch (e) {
          const stale = await env.EDITS.get(ck + ':stale', 'json');
          return json({ ...(stale || { pulls: [], branchFiles: {} }), stale: true, error: String((e && e.message) || e),
            live: { sha: env.GIT_SHA || '' } });
        }
      }
      return json({ ...data, live: { sha: env.GIT_SHA || '' } });
    }

    // ---- test & experiment register (Workflow) — a single JSON array of test cards ----
    if (path === '/api/tests') {
      if (request.method === 'GET') return json((await env.EDITS.get('tests', 'json')) || []);
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('tests', JSON.stringify(body));
        return json({ ok: true, count: (body || []).length });
      }
    }

    // ---- ATRT carry-over status (Workflow) — { "Client|task": "status" } for the retired tracker ----
    if (path === '/api/carryover') {
      if (request.method === 'GET') return json((await env.EDITS.get('carryover', 'json')) || {});
      if (request.method === 'PUT') {
        const body = await request.json();
        await env.EDITS.put('carryover', JSON.stringify(body));
        return json({ ok: true, count: Object.keys(body || {}).length });
      }
    }

    // ---- client store (dossier data layer: add / delete / link-sheet / edit-text persist here) ----
    // A single JSON object: per-brand overrides/additions to the git profiles, plus a _deleted list.
    if (path === '/api/clients') {
      // dossier store: deletions travel in the explicit `_deleted` array, never by absence
      const r = await mapStoreRoute(env, request, 'clients', { explicitTombstones: true });
      if (r) return r;
    }

    // ---- client materials bank (docs/MATERIALS.md) ----
    // A per-client bank of finished collateral -- strategy decks, review packs, one-pagers --
    // surfaced in the Brand dossier, so an account review carries its own history on the brand
    // instead of living in somebody's SharePoint folder.
    //
    // Two tiers, deliberately:
    //   SEEDS  git-bundled binaries (docs/materials/*, imported as Data modules). Live the
    //          moment they merge and versioned in git -- the only way to publish a blob from a
    //          session, since Access blocks HTTP writes and there is no key-level KV API here.
    //          Flagship pieces ONLY: each seed adds its full size to every worker deploy.
    //   KV     everything uploaded through the dossier afterwards. Blob at matblob:<id>, meta
    //          in the `materials` index. Keeps the bundle flat as the bank grows.
    if (path === '/api/materials/file') {
      const id = url.searchParams.get('id') || '';
      const seed = SEED_MATERIALS.find((m) => m.id === id);
      const dl = url.searchParams.get('dl') === '1';
      if (seed) {
        return new Response(seed.body, { headers: { ...CORS, 'content-type': seed.mime,
          'content-disposition': (dl ? 'attachment' : 'inline') + '; filename="' + seed.file + '"',
          'cache-control': 'private, max-age=3600' } });
      }
      const idx = (await env.EDITS.get('materials', 'json')) || {};
      const meta = idx[id];
      if (!meta) return json({ error: 'not_found' }, 404);
      const blob = await env.EDITS.get('matblob:' + id, 'arrayBuffer');
      if (!blob) return json({ error: 'blob_missing' }, 404);
      return new Response(blob, { headers: { ...CORS, 'content-type': meta.mime || 'application/octet-stream',
        'content-disposition': (dl ? 'attachment' : 'inline') + '; filename="' + (meta.file || id) + '"',
        'cache-control': 'private, max-age=3600' } });
    }

    if (path === '/api/materials') {
      const idx = (await env.EDITS.get('materials', 'json')) || {};
      const gone = idx._deleted || [];
      if (request.method === 'GET') {
        const want = (url.searchParams.get('client') || '').trim();
        const items = [];
        SEED_MATERIALS.forEach((m) => { if (gone.indexOf(m.id) < 0)
          items.push({ id: m.id, client: m.client, title: m.title, cat: m.cat, occasion: m.occasion,
                       file: m.file, mime: m.mime, size: (m.body && m.body.byteLength) || 0, at: m.at, seed: true }); });
        Object.keys(idx).forEach((k) => { if (k !== '_deleted' && gone.indexOf(k) < 0)
          items.push({ id: k, ...idx[k] }); });
        const out = items
          .filter((m) => !want || (m.client || '').toLowerCase() === want.toLowerCase())
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        return json({ items: out, count: out.length });
      }
      if (request.method === 'POST') {
        let form; try { form = await request.formData(); } catch (e) { return json({ ok: false, error: 'bad_form' }, 400); }
        const file = form.get('file');
        if (!file || typeof file === 'string') return json({ ok: false, error: 'no_file' }, 400);
        const buf = await file.arrayBuffer();
        // KV caps a value at 25 MB; refuse loudly rather than storing a truncated deck.
        if (buf.byteLength > 24 * 1024 * 1024) return json({ ok: false, error: 'too_large', size: buf.byteLength }, 413);
        const client = String(form.get('client') || '').trim();
        if (!client) return json({ ok: false, error: 'no_client' }, 400);
        const name = String(file.name || 'material');
        const id = (client + '-' + name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70)
                 + '-' + Date.now().toString(36);
        const meta = { client, title: String(form.get('title') || name).trim(),
          cat: String(form.get('cat') || 'marketing').trim(),
          occasion: String(form.get('occasion') || '').trim(),
          file: name, mime: file.type || 'application/octet-stream', size: buf.byteLength,
          at: new Date().toISOString().slice(0, 10),
          by: request.headers.get('Cf-Access-Authenticated-User-Email') || '' };
        await env.EDITS.put('matblob:' + id, buf);
        const cur = (await env.EDITS.get('materials', 'json')) || {};
        cur[id] = meta;
        await env.EDITS.put('materials', JSON.stringify(cur));
        return json({ ok: true, id, ...meta });
      }
      if (request.method === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!id) return json({ ok: false, error: 'no_id' }, 400);
        const cur = (await env.EDITS.get('materials', 'json')) || {};
        if (cur[id]) { delete cur[id]; await env.EDITS.delete('matblob:' + id); }
        else { // a seed is code, not data -- it can only be tombstoned
          cur._deleted = cur._deleted || []; if (cur._deleted.indexOf(id) < 0) cur._deleted.push(id); }
        await env.EDITS.put('materials', JSON.stringify(cur));
        return json({ ok: true, id });
      }
    }

    // ---- template info (structure layer: bundled from git, not KV) ----
    // To change structure/layout, edit the page's .html in git and push to main — Cloudflare
    // rebuilds and the new page is bundled in. No PUT on purpose: git is the source of truth.
    if (path === '/api/template' && request.method === 'GET') {
      return json({ source: 'git', pages: Object.keys(PAGES), note: 'pages are git-bundled at build time; push to main to update them' });
    }

    // ---- Tachyon copilot: server-side proxy to the Claude Messages API ----
    // The dashboard POSTs { system, messages | prompt, max_tokens } and the worker calls
    // Anthropic with env.ANTHROPIC_API_KEY — the key never reaches the browser. Degrades
    // gracefully (200 + setup message) when the secret isn't set, so the UI stays usable.
    //   Set the key:  wrangler secret put ANTHROPIC_API_KEY   (from the repo root)
    if (path === '/api/claude') {
      if (request.method === 'GET') {
        return json({ ok: true, configured: !!env.ANTHROPIC_API_KEY, model: 'claude-opus-4-8' });
      }
      if (request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) {
          return json({ error: 'no_key', message: 'Tachyon isn’t connected yet. Set an Anthropic API key as a Worker secret (wrangler secret put ANTHROPIC_API_KEY) and Tachyon goes live — no redeploy needed.' });
        }
        let body;
        try { body = await request.json(); } catch (e) { return json({ error: 'bad_request', message: 'Invalid JSON body.' }, 400); }
        const messages = Array.isArray(body.messages) && body.messages.length
          ? body.messages
          : [{ role: 'user', content: String(body.prompt || '') }];
        const payload = {
          model: body.model || 'claude-opus-4-8',
          max_tokens: Math.min(Math.max(parseInt(body.max_tokens, 10) || 1600, 256), 4096),
          messages,
        };
        if (body.system) payload.system = String(body.system);
        let r;
        try {
          r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          return json({ error: 'network', message: 'Could not reach the Claude API: ' + (e && e.message || e) });
        }
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          return json({ error: 'upstream', status: r.status, message: t.slice(0, 600) || ('HTTP ' + r.status) });
        }
        const data = await r.json().catch(() => ({}));
        const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
        return json({ text, usage: data.usage || null, model: payload.model });
      }
    }

    // ---- Google connection status (Option A: service account + domain-wide delegation) ----
    if (path === '/api/google/status' && request.method === 'GET') {
      return json({ configured: !!env.GOOGLE_SA_JSON, impersonate: env.GOOGLE_IMPERSONATE || null });
    }

    // ---- Gmail intake: recent client task emails → Workflow "Incoming emails" stream ----
    // Reads (readonly) the impersonated mailbox via the service account. Degrades to
    // {connected:false, items:[]} until GOOGLE_SA_JSON + GOOGLE_IMPERSONATE are set.
    if (path === '/api/gmail/intake' && request.method === 'GET') {
      // primary source: the Apps Script inbox push (no-admin path) — classified + stored in KV.
      // Each item carries its triage decision (dismissed + decidedAs) so the panel can split
      // pending vs already-triaged without a second call.
      const pushed = (await env.EDITS.get('gmailinbox', 'json')) || [];
      // call actions parsed from Gemini/Meet notes emails ride the same response — the page
      // files them as Intake rows (📞 Call source) regardless of the triage queue's state
      const calls = ((await env.EDITS.get('callactions', 'json')) || []).slice(0, 120);
      if (pushed.length) {
        // back-fill client on stored emails the older/weaker detector missed — the current
        // detectClient (domain label, display name, folded mentions) re-runs against the live
        // dossier, so adding a brand or a dom mapping upgrades past captures too
        try {
          const dossier = liftEnvelope(await env.EDITS.get('clients', 'json'), Date.now()).data;
          const doms = {}; Object.keys(dossier).forEach((n) => { if (dossier[n] && dossier[n].dom) doms[n] = dossier[n].dom; });
          let filled = 0;
          for (const it of pushed) { if (!it.client) { const ex = detectClientEx(it, doms, Object.keys(dossier)); if (ex.client) { it.client = ex.client; it.via = ex.via; filled++; } } }
          if (filled) ctx.waitUntil(env.EDITS.put('gmailinbox', JSON.stringify(pushed)));
        } catch (e) {}
        const dis = (await env.EDITS.get('gmaildismissed', 'json')) || {};
        // Conversation-level inheritance: decisions are stored per message id, so a NEW reply in
        // an already-decided thread used to re-open the whole conversation in the triage queue
        // (Ray: "triaged emails keep coming back"). A message whose subject-thread already
        // carries a decision now INHERITS it — persisted as a real per-id decision so it's
        // individually restorable and the work isn't repeated on every read. The undo path
        // clears the whole conversation, keeping decide/restore symmetric.
        const byKey = {};
        for (const it of pushed) { const d = dis[it.id]; if (!d) continue;
          const k = mailThreadKey(it.subject); if (!k) continue;
          if (!byKey[k] || (d.t || 0) > (byKey[k].t || 0)) byKey[k] = d; }
        let inherited = 0;
        for (const it of pushed) { if (dis[it.id]) continue;
          const k = mailThreadKey(it.subject); const d = k && byKey[k]; if (!d) continue;
          dis[it.id] = { t: Date.now(), r: d.r || 'notask', inh: 1 }; inherited++; }
        if (inherited) ctx.waitUntil(env.EDITS.put('gmaildismissed', JSON.stringify(dis)));
        const items = pushed.slice(0, 60).map((it) => (dis[it.id] ? Object.assign({}, it, { dismissed: true, decidedAs: dis[it.id].r || 'notask' }) : it));
        return json({ connected: true, source: 'push', items, calls });
      }
      // fallback: the original DWD pull, if a super-admin ever authorises it
      if (!env.GOOGLE_SA_JSON || !env.GOOGLE_IMPERSONATE) return json({ connected: false, items: [], calls });
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/gmail.readonly', true);
        const q = encodeURIComponent('newer_than:30d -in:sent -in:chats');
        const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=' + q, { headers: { Authorization: 'Bearer ' + token } });
        const list = await listRes.json();
        const ids = (list.messages || []).slice(0, 15).map(m => m.id);
        const items = [];
        for (const id of ids) {
          const mRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To&metadataHeaders=Cc', { headers: { Authorization: 'Bearer ' + token } });
          const m = await mRes.json();
          const h = {}; ((m.payload && m.payload.headers) || []).forEach(x => { h[x.name.toLowerCase()] = x.value; });
          items.push({ id, from: h.from || '', to: h.to || '', cc: h.cc || '', subject: h.subject || '(no subject)', date: h.date || '', snippet: (m.snippet || '').slice(0, 160) });
        }
        return json({ connected: true, items, calls });
      } catch (e) {
        return json({ connected: false, error: String((e && e.message) || e), items: [], calls });
      }
    }

    // ---- Gmail thread lookup: deep-link a brief straight to its email thread ----
    // GET /api/gmail/thread?q=<query>&q=<fallback> → {connected, threadId, mailbox}. Queries are
    // ready-made Gmail search strings (subject-phrase first, quoted ID / ibfcode fallbacks),
    // tried in order. Degrades to {connected:false} until Gmail creds are set.
    if (path === '/api/gmail/thread' && request.method === 'GET') {
      if (!env.GOOGLE_SA_JSON || !env.GOOGLE_IMPERSONATE) return json({ connected: false });
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/gmail.readonly', true);
        for (const raw of url.searchParams.getAll('q')) {
          if (!raw) continue;
          const q = encodeURIComponent(raw);
          const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&q=' + q, { headers: { Authorization: 'Bearer ' + token } });
          const d = await r.json();
          const t = (d.threads || [])[0];
          if (t && t.id) return json({ connected: true, threadId: t.id, mailbox: env.GOOGLE_IMPERSONATE });
        }
        return json({ connected: true, threadId: null, mailbox: env.GOOGLE_IMPERSONATE });
      } catch (e) {
        return json({ connected: false, error: String((e && e.message) || e) });
      }
    }

    // ---- Gmail history re-scan: replay the mailbox through the ibfref-first matcher ----
    // POST /api/gmail/rescan {days?} — searches the impersonated mailbox for brief traffic
    // (ibfref/ibfcode/[FS Brief]) back N days (default 90, max 365), re-matches replies to
    // tickets and REPAIRS comms that an ibfcode-era fuzzy match filed on the wrong ticket.
    if (path === '/api/gmail/rescan' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON || !env.GOOGLE_IMPERSONATE) return json({ ok: false, error: 'gmail_not_connected' });
      let body; try { body = await request.json(); } catch (e) { body = {}; }
      const days = Math.min(365, Math.max(1, +((body && body.days) || 90)));
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/gmail.readonly', true);
        const q = encodeURIComponent('newer_than:' + days + 'd ("ibfref:" OR "ibfcode:" OR subject:"[FS Brief]")');
        let ids = [], pageToken = '';
        for (let page = 0; page < 3 && ids.length < 150; page++) {
          const lr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=' + q + (pageToken ? '&pageToken=' + pageToken : ''), { headers: { Authorization: 'Bearer ' + token } });
          const ld = await lr.json();
          if (ld.error) return json({ ok: false, error: ld.error.message });
          ids = ids.concat((ld.messages || []).map((m) => m.id));
          pageToken = ld.nextPageToken || '';
          if (!pageToken) break;
        }
        ids = ids.slice(0, 150);
        const messages = [];
        for (let i = 0; i < ids.length; i += 10) {   // ten-wide batches keep wall-clock sane
          const chunk = await Promise.all(ids.slice(i, i + 10).map(async (id) => {
            const mr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject', { headers: { Authorization: 'Bearer ' + token } });
            const m = await mr.json();
            const h = {}; ((m.payload && m.payload.headers) || []).forEach((x) => { h[x.name.toLowerCase()] = x.value; });
            return { id, from: h.from || '', subject: h.subject || '', snippet: m.snippet || '', date: +m.internalDate || Date.now() };
          }));
          messages.push.apply(messages, chunk);
        }
        const now = Date.now();
        const envx = liftEnvelope(await env.EDITS.get('briefs', 'json'), now);
        const briefs = envelopeToClient(envx, {});
        const selfSrc = String(env.GMAIL_SELF || 'ray@feedspark.com').replace(/[.^$*+?()[\]{}|\\]/g, '\\$&');
        const res = matchGmailToBriefs(briefs, messages, { now, selfRe: new RegExp(selfSrc, 'i'), aspl: ['Dinesh', 'Thia', 'Mariraj', 'Muji'], repair: true });
        if (res.matched || (res.repaired && res.repaired.length)) {
          mergeIntoEnvelope(envx, briefs, now, now, {});   // full map present → pure upserts
          await env.EDITS.put('briefs', JSON.stringify(envx));
        }
        logActivity(ctx, env, request, 'gmail-rescan', messages.length + ' scanned · ' + res.matched + ' matched · ' + ((res.repaired || []).length) + ' repaired', 'gmail-sync');
        return json({ ok: true, scanned: messages.length, matched: res.matched, moved: res.moved, repaired: res.repaired || [] });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- Sheets read (no admin needed: share the sheet with the service-account email) ----
    // GET /api/sheets/read?id=<spreadsheetId>&range=<A1 range>. The SA acts as itself, so any
    // sheet shared with its client_email is reachable without domain-wide delegation.
    if (path === '/api/sheets/read' && request.method === 'GET') {
      if (!env.GOOGLE_SA_JSON) return json({ connected: false, error: 'no_sa', values: [] });
      const id = url.searchParams.get('id'); const range = url.searchParams.get('range') || 'A1:Z100';
      if (!id) return json({ error: 'missing id' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
        const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range), { headers: { Authorization: 'Bearer ' + token } });
        const d = await r.json();
        if (d.error) return json({ connected: true, error: d.error.message, values: [] });
        return json({ connected: true, range: d.range || range, values: d.values || [] });
      } catch (e) { return json({ connected: false, error: String((e && e.message) || e), values: [] }); }
    }

    // ---- 2-way status: write a task's status back into its Project-Plan tab ----
    // POST { id, tab?, match, value, statusCol? }. Reads the tab, finds the row whose
    // description matches `match`, detects the Status column from the header (or uses
    // statusCol), and writes `value` there. No delegation — the sheet is shared with the SA.
    if (path === '/api/sheets/status' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, match = String(body.match || '').trim(), value = body.value; let tab = body.tab || 'Project Plan';
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        tab = await resolveTab(id, tab, token);   // tab names vary per client (e.g. "Opitmisation Plan") — write where the reads come from
        if (!tab) return json(tabAmbiguous(id, body.tab || 'Project Plan'));
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json();
        if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const norm = normCell;
        const TOK = ['open', 'done', 'on hold', 'on-hold', 'onhold', 'in progress', 'in-progress', 'wip', 'with client', 'parked', 'completed', 'complete', 'live', 'not started', 'to do', 'todo', 'blocked'];
        const isTok = v => TOK.indexOf(norm(v)) >= 0;
        // find the row whose description matches the FCC task text
        const tr = findTaskRow(rows, match);
        if (tr.row < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        if (tr.ambiguous) return json(ambiguousRow(tab, match, tr.count));
        const targetRow = tr.row;
        // Status column: header cell named "Status", re-aligned to the data (the header can sit
        // one column left of the values when there's a leading number column), then confirmed
        // against the actual target row — handles stacked sub-tables with their own layout.
        let statusCol = (typeof body.statusCol === 'number') ? body.statusCol : -1, headerRow = -1;
        if (statusCol < 0) {
          for (let r = 0; r < Math.min(rows.length, 25); r++) {
            const idx = (rows[r] || []).findIndex(c => /^(status|task status)$/i.test(String(c || '').trim()));
            if (idx >= 0) { statusCol = idx; headerRow = r; break; }
          }
          if (statusCol >= 0) {
            let a = 0, b = 0;
            for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 45); r++) { const row = rows[r] || []; if (isTok(row[statusCol])) a++; if (isTok(row[statusCol + 1])) b++; }
            if (b > a) statusCol += 1;
          }
        }
        let writeCol = statusCol; const trow = rows[targetRow] || [];
        if (writeCol < 0 || !isTok(trow[writeCol])) { for (let c = 1; c < Math.min(trow.length, 14); c++) { if (isTok(trow[c])) { writeCol = c; break; } } }
        if (writeCol < 0) return json({ ok: false, error: 'could not resolve the Status column — pass statusCol', row: targetRow + 1, matched: trow[1] || trow[0] || '' });
        const cell = tab + '!' + colLetter(writeCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({ values: [[value]] }),
        });
        const wd = await wr.json();
        if (wd.error) return json({ ok: false, error: permHint(wd.error.message), cell });
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- live plan sync: read each brand's Project-Plan tab and return parsed tasks ----
    // POST { sheets: { "<Brand>": "<sheetId>", ... }, tab?, force? }. Caches per sheet in KV
    // (planlive:<id>, ~5 min TTL) so the dashboard reflects new plan rows with no git rebuild.
    // Also stashes the brand->sheet map (plansheets) so the cron can warm the cache.
    if (path === '/api/plan/live' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ connected: false, error: 'no_sa', brands: {} });
      let body; try { body = await request.json(); } catch (e) { return json({ connected: false, error: 'bad_json' }, 400); }
      const sheets = body.sheets || {}, tab = body.tab || 'Project Plan', force = !!body.force;
      try { await env.EDITS.put('plansheets', JSON.stringify(sheets)); } catch (e) {}
      const out = {};
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
        const seen = {};
        for (const brand of Object.keys(sheets)) {
          const id = sheets[brand]; if (!id) continue;
          if (seen[id]) { out[brand] = seen[id]; continue; }
          const ck = 'planlive:' + id;
          let cached = force ? null : await env.EDITS.get(ck, 'json');
          if (!cached) {
            const g = await fetchGrid(id, tab, token); // values + background colours (to skip filled separator rows)
            if (g.error) { out[brand] = { error: g.error, tasks: [] }; seen[id] = out[brand]; continue; }
            cached = { tasks: parsePlanRows(g.values, g.bg), updated: Date.now() };
            try { await env.EDITS.put(ck, JSON.stringify(cached), { expirationTtl: 300 }); } catch (e) {}
          }
          out[brand] = cached; seen[id] = cached;
        }
        return json({ connected: true, brands: out });
      } catch (e) { return json({ connected: false, error: String((e && e.message) || e), brands: out }); }
    }

    // ---- 2-way owner reassign: write an AE/owner back into the plan tab (workload heatmap) ----
    // POST { id, tab?, match, value }. Same row-match + uniform-offset resolution as status.
    if (path === '/api/sheets/owner' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, match = String(body.match || '').trim(), value = body.value; let tab = body.tab || 'Project Plan';
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        tab = await resolveTab(id, tab, token);   // tab names vary per client (e.g. "Opitmisation Plan") — write where the reads come from
        if (!tab) return json(tabAmbiguous(id, body.tab || 'Project Plan'));
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json(); if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const tr = findTaskRow(rows, match);
        if (tr.row < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        if (tr.ambiguous) return json(ambiguousRow(tab, match, tr.count));
        const targetRow = tr.row;
        const c = rowCols(rows[targetRow], resolveCols(rows));
        let writeCol = c.ownerCol;
        if (writeCol < 0) return json({ ok: false, error: 'could not resolve the Owner column' });
        const cell = tab + '!' + colLetter(writeCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
        const wd = await wr.json(); if (wd.error) return json({ ok: false, error: permHint(wd.error.message), cell });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- 2-way due date: write a task's due date (DD/MM/YYYY) into the plan's Due column ----
    if (path === '/api/sheets/due' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, match = String(body.match || '').trim(), value = body.value; let tab = body.tab || 'Project Plan';
      if (!id || !match || value == null) return json({ ok: false, error: 'missing id / match / value' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        tab = await resolveTab(id, tab, token);   // tab names vary per client (e.g. "Opitmisation Plan") — write where the reads come from
        if (!tab) return json(tabAmbiguous(id, body.tab || 'Project Plan'));
        const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(tab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
        const rd = await rr.json(); if (rd.error) return json({ ok: false, error: rd.error.message });
        const rows = rd.values || [];
        const tr = findTaskRow(rows, match);
        if (tr.row < 0) return json({ ok: false, error: 'task row not found in ' + tab, match });
        if (tr.ambiguous) return json(ambiguousRow(tab, match, tr.count));
        const targetRow = tr.row;
        const c = rowCols(rows[targetRow], resolveCols(rows));
        if (c.dueCol < 0) return json({ ok: false, error: 'no Due column in this plan — add a "Due Date" header' });
        const cell = tab + '!' + colLetter(c.dueCol) + (targetRow + 1);
        const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
          method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
        const wd = await wr.json(); if (wd.error) return json({ ok: false, error: permHint(wd.error.message), cell });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, cell, updated: wd.updatedCells || 1 });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- 2-way task text: rename a task in place (match old text -> write new text to the Task column) ----
    if (path === '/api/sheets/task' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, match = String(body.match || '').trim(), value = body.value, tab = body.tab || 'Project Plan';
      if (!id || !match || value == null || !String(value).trim()) return json({ ok: false, error: 'missing id / match / value' }, 400);
      const r = await renamePlanTask(env, id, tab, match, value);
      if (r.ok) { try { await env.EDITS.delete('planlive:' + id); } catch (e) {} }
      return json(r);
    }

    // ---- append new task rows into a plan tab (ATRT uniques -> project plan) ----
    // POST { id, tab?, rows:[{task, owner, status}] }. Resolves the tab's column layout
    // (same uniform-offset logic as the writers) and places each value in the right column.
    if (path === '/api/sheets/append' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan', rows = body.rows || [];
      if (!id || !rows.length) return json({ ok: false, error: 'missing id / rows' }, 400);
      return json(await appendPlanRows(env, id, tab, rows));
    }

    // ---- task ingestion (no-admin path): lets a trusted automation — a Claude Code session
    // with no browser, same problem the Gmail Apps Script has — push new Project-Plan tasks
    // for a client without an Access login. Same shape as /api/gmail/push: a shared secret
    // instead of a session, and this exact path needs its own Cloudflare Access BYPASS policy
    // (docs/GOOGLE_SETUP.md). Delegates to appendPlanRows — the exact same write /api/sheets/
    // append uses — so an ingested task lands identically to one typed into the Workflow's own
    // "+ Add task" row; no separate write path to drift from that one.
    // PLAN_SHEETS mirrors FeedSpark_Workflow.html's client-side PLANSHEET map — keep both in
    // sync; a client missing here fails closed (400) rather than guessing a sheet id.
    // GET verifies a push landed — same path (so it rides the same Access bypass with no new
    // Zero Trust config), same key. A write endpoint with no way to check its own result meant
    // "ok:true" had to be taken on faith; this closes that gap. ?range defaults to the columns
    // appendPlanRows actually uses (A:H covers every client's Task/Owner/Status/Due layout seen
    // so far), not the whole sheet.
    if (path === '/api/tasks/ingest' && request.method === 'GET') {
      if (!env.TASKS_INGEST_KEY) return json({ ok: false, error: 'ingest key not configured' }, 503);
      if (request.headers.get('X-FCC-Ingest-Key') !== env.TASKS_INGEST_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' }, 503);
      const client = url.searchParams.get('client') || '';
      const id = PLAN_SHEETS[client];
      if (!id) return json({ ok: false, error: 'unknown client "' + client + '"' }, 400);
      const range = url.searchParams.get('range') || 'A540:H575';
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
        const realTab = await resolveTab(id, 'Project Plan', token);
        if (!realTab) return json(tabAmbiguous(id, 'Project Plan'));
        const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(realTab + '!' + range), { headers: { Authorization: 'Bearer ' + token } });
        const d = await r.json();
        if (d.error) return json({ ok: false, error: d.error.message });
        return json({ ok: true, client, tab: realTab, range: d.range || range, values: d.values || [] });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    if (path === '/api/tasks/ingest' && request.method === 'POST') {
      if (!env.TASKS_INGEST_KEY) return json({ ok: false, error: 'ingest key not configured — wrangler secret put TASKS_INGEST_KEY' }, 503);
      if (request.headers.get('X-FCC-Ingest-Key') !== env.TASKS_INGEST_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' }, 503);
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const client = String(body.client || '');
      const id = PLAN_SHEETS[client];
      if (!id) return json({ ok: false, error: 'unknown client "' + client + '" — add it to PLAN_SHEETS in worker.js and PLANSHEET in FeedSpark_Workflow.html' }, 400);
      const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 100) : [];
      if (!tasks.length) return json({ ok: false, error: 'missing tasks' }, 400);
      // optional source tag, e.g. "SRS" for a strategy-review session — prefixed onto every
      // task so a batch pushed here reads apart from a manually-typed row in the sheet at a
      // glance, without needing a separate column no other write path fills in.
      const tag = String(body.tag || '').trim().replace(/[[\]]/g, '').slice(0, 20);
      const prefix = tag ? '[' + tag + '] ' : '';
      const rows = tasks.map((t) => ({
        task: prefix + String((t && t.task) || '').slice(0, 300),
        owner: String((t && t.owner) || '').slice(0, 60),
        status: String((t && t.status) || 'Open').slice(0, 30),
        due: (t && t.due) ? String(t.due).slice(0, 20) : '',
      })).filter((r) => r.task !== prefix);
      if (!rows.length) return json({ ok: false, error: 'no task text on any row' }, 400);
      const r = await appendPlanRows(env, id, 'Project Plan', rows);
      logActivity(ctx, env, request, 'tasks-ingest', client + ': ' + rows.length + (r.ok ? ' added' : ' failed — ' + r.error));
      return json({ ...r, client });
    }

    // PATCH: retag rows already ingested — e.g. a batch pushed before the `tag` option existed,
    // or tasks a client wants relabelled after the fact. { client, updates:[{match, task}] }
    // matches each `match` against the sheet exactly like /api/sheets/task's inline-edit does,
    // then overwrites just that cell with `task` (call already includes any [TAG] prefix wanted
    // — this endpoint does not add one, so a plain retag and a tagged retag are the same call).
    // Same path/key as the POST above — no new Access bypass needed.
    if (path === '/api/tasks/ingest' && request.method === 'PATCH') {
      if (!env.TASKS_INGEST_KEY) return json({ ok: false, error: 'ingest key not configured' }, 503);
      if (request.headers.get('X-FCC-Ingest-Key') !== env.TASKS_INGEST_KEY) return json({ ok: false, error: 'unauthorized' }, 401);
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' }, 503);
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const client = String(body.client || '');
      const id = PLAN_SHEETS[client];
      if (!id) return json({ ok: false, error: 'unknown client "' + client + '"' }, 400);
      const updates = Array.isArray(body.updates) ? body.updates.slice(0, 100) : [];
      if (!updates.length) return json({ ok: false, error: 'missing updates' }, 400);
      const results = [];
      for (const u of updates) {
        const match = String((u && u.match) || '').trim(), task = String((u && u.task) || '').trim();
        if (!match || !task) { results.push({ ok: false, error: 'missing match/task', match }); continue; }
        results.push({ match, ...(await renamePlanTask(env, id, 'Project Plan', match, task)) });
      }
      const okCount = results.filter((r) => r.ok).length;
      try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
      logActivity(ctx, env, request, 'tasks-retag', client + ': ' + okCount + '/' + updates.length + ' retagged');
      return json({ ok: okCount === updates.length, client, updated: okCount, total: updates.length, results });
    }

    // ---- undo an ATRT->plan write: delete the rows whose task matches a written task ----
    // POST { id, tab?, tasks:[text,...] }. Safe: those tasks were unique (not in the plan)
    // before the write, so the only rows that match are the ones we added.
    if (path === '/api/sheets/unappend' && request.method === 'POST') {
      if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' });
      let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
      const id = body.id, tab = body.tab || 'Project Plan';
      const tasks = (body.tasks || []).map(t => normCell(t)).filter(Boolean);
      if (!id || !tasks.length) return json({ ok: false, error: 'missing id / tasks' }, 400);
      try {
        const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
        let realTab = await resolveTab(id, tab, token);
        if (!realTab) return json(tabAmbiguous(id, tab));
        let rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(realTab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
        let rd = await rr.json();
        if (rd.error) return json({ ok: false, error: rd.error.message });
        const grid = rd.values || [], c = resolveCols(grid), tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
        const del = [];
        for (let r = 0; r < grid.length; r++) { const v = normCell((grid[r] || [])[tc]); if (v && tasks.indexOf(v) >= 0) del.push(r); }
        if (!del.length) return json({ ok: true, deleted: 0, note: 'no matching rows' });
        // resolve the tab's numeric sheetId for deleteDimension
        const meta = await (await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=sheets.properties(sheetId,title)', { headers: { Authorization: 'Bearer ' + token } })).json();
        const sheets = meta.sheets || [];
        const match = realTab && sheets.find(s => s.properties.title === realTab);
        const sheetId = (match ? match.properties.sheetId : (sheets[0] && sheets[0].properties.sheetId)) || 0;
        const reqs = del.sort((a, b) => b - a).map(r => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 } } }));
        const br = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + ':batchUpdate', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
        const bd = await br.json();
        if (bd.error) return json({ ok: false, error: bd.error.message });
        try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
        return json({ ok: true, deleted: del.length });
      } catch (e) { return json({ ok: false, error: String((e && e.message) || e) }); }
    }

    // ---- serve a git-bundled page + inject the editor widget for its slug ----
    // App pages (everything except client-facing /deck/* decks) also get the Tachyon copilot.
    const page = PAGES[path];
    if (page) {
      logActivity(ctx, env, request, 'view', path);
      // Most module pages are fragment-style (no <body> tags), so replace('</body>') silently
      // no-oped there — which kept every injected widget (editor, Tachyon, presence avatars,
      // guard badges, the Feed Chat bubble) HOMEPAGE-ONLY. Inject = replace when the tag
      // exists, append to the end otherwise (trailing <style>/<script> parse into body fine).
      const inject = (html, extra) => (html.indexOf('</body>') >= 0 ? html.replace('</body>', extra + '\n</body>') : html + '\n' + extra);
      let html = inject(page.html, getEditorScript(page.slug));
      if (!path.startsWith('/deck/')) html = inject(html, TACHYON + '\n' + INSTR + '\n' + LGBADGE + '\n' + PRESENCEW + '\n' + FEEDCHATW);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store, must-revalidate', ...CORS } });
    }

    // ---- dynamic client decks: any /deck/<slug> not in the static map above falls back to
    // the generic Strategy Review template, with its own KV edit namespace (edits:<slug>).
    // Lets the dossier's "Generate deck" button spin up a new client deck instantly — no git
    // commit needed until it's ready to be hand-crafted into its own page like YuMOVE's.
    const dynDeck = path.match(/^\/deck\/([a-z0-9-]+)$/);
    if (dynDeck) {
      const html = DECK_TEMPLATE.replace('</body>', getEditorScript(dynDeck[1]) + '\n</body>');
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store, must-revalidate', ...CORS } });
    }

    return new Response('Not found', { status: 404 });
  },

  // ---- cron: warm the live plan-sync cache so the dashboard is instant on open ----
  // Reads the brand->sheet map the dashboard last posted (KV `plansheets`) and re-parses
  // each Project-Plan tab into KV (planlive:<id>). Registered in wrangler.toml [triggers].
  async scheduled(event, env, ctx) {
    // Custom-watch passes (Ray's alert builder) with their OWN subrequest budget: the :30
    // firing checks hourly-schedule rules; 07:00/17:00 GMT checks twice-daily rules.
    if (event && event.cron === '30 * * * *') {
      const w = await labelWatchRun(env, null, 'hourly');
      // second sweep batch: the Meta import roughly doubled the estate (42 sheet feeds), so
      // the :30 firing also advances the rotation — but only when its subrequest budget
      // allows (watch checks ~4 fetches/rule + a 4-feed batch ~32 now that Google scans
      // also capture product_type, under the 50/invocation free-plan cap). Watches always
      // take precedence over the sweep.
      if (!w || (w.checked | 0) <= 3) await labelCronSweep(env);
      return;
    }
    if (event && event.cron === '0 7,17 * * *') {
      await labelWatchRun(env, null, 'twice');
      // the emailed status report rides the same firings so it reflects a fresh check:
      // daily at 07:00 GMT when enabled, 17:00 too if cfg.pm
      try {
        const cfg = (await env.EDITS.get('labelreportcfg', 'json')) || {};
        const hour = new Date().getUTCHours();
        if (cfg.on && (hour === 7 || (hour === 17 && cfg.pm))) await queueLabelReport(env, hour + ':00 schedule');
      } catch (e) {}
      return;
    }
    // Label Guard sweep runs FIRST and unconditionally — the plan warm below early-returns
    // without GOOGLE_SA_JSON, and label drop-off monitoring must never hinge on that credential.
    await labelCronSweep(env);
    if (!env.GOOGLE_SA_JSON) return;
    const warmed = {};   // sheet id → freshly parsed tasks (feeds the 12:00 reminder for free)
    try {
      const sheets = (await env.EDITS.get('plansheets', 'json')) || {};
      const ids = Array.from(new Set(Object.keys(sheets).map(b => sheets[b]).filter(Boolean)));
      if (!ids.length) return;
      const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets.readonly', false);
      for (const id of ids) {
        try {
          const g = await fetchGrid(id, 'Project Plan', token);
          if (g.error) continue;
          const tasks = parsePlanRows(g.values, g.bg);
          warmed[id] = tasks;
          await env.EDITS.put('planlive:' + id, JSON.stringify({ tasks, updated: Date.now() }), { expirationTtl: 5400 });
        } catch (e) {}
      }
    } catch (e) {}
    // 12:00 GMT: owners get nudged about tasks due TODAY but still Open (Ray's rule). Runs off
    // the tasks the warm loop just parsed — zero extra sheet reads at this firing.
    try {
      const hour = new Date(event && event.scheduledTime ? event.scheduledTime : Date.now()).getUTCHours();
      if (hour === 12) await queueDueReminders(env, { tasksById: warmed });
    } catch (e) {}
  },
};

function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...(extraHeaders || {}) } });
}

// who is making this request? Cloudflare Access injects the verified email; service
// tokens carry a client id instead; anything else (misconfig / no Access) is 'unknown'
// and never matches the owner, so the restricted surfaces stay closed.
function who(request) {
  const e = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (e) return e.toLowerCase();
  const svc = request.headers.get('Cf-Access-Client-Id');
  if (svc) return 'service:' + svc.slice(0, 12);
  return 'unknown';
}
function ownerEmail(env) { return String(env.OWNER_EMAIL || 'ray@feedspark.com').toLowerCase(); }
// append an activity entry without blocking the response (per-entry key, 90-day TTL,
// entry stored in key METADATA so reading the feed is one list() with no value gets)
function logActivity(ctx, env, request, action, detail, userOverride) {
  try {
    const t = Date.now();
    const key = 'act:' + String(t).padStart(14, '0') + ':' + Math.random().toString(36).slice(2, 6);
    const meta = { t, u: userOverride || who(request), a: action, d: String(detail || '').slice(0, 80) };
    const p = env.EDITS.put(key, '', { metadata: meta, expirationTtl: 60 * 60 * 24 * 90 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  } catch (e) { /* logging must never break the request */ }
}

// Concurrency-safe whole-map store (clients / briefs): per-key merge via kvmerge.js instead of
// last-writer-wins overwrite. GET hands the client a read-stamp (X-Sync-Base); PUT echoes it so
// "key absent" can be told apart from "key deleted", merges, and returns the MERGED map + a fresh
// stamp for the client to adopt. Legacy pages that PUT plain maps without the header degrade to
// union-only merges (nothing lost, absence never deletes).
async function mapStoreRoute(env, request, kvKey, opts) {
  if (request.method === 'GET') {
    const lifted = liftEnvelope(await env.EDITS.get(kvKey, 'json'), Date.now());
    return json(envelopeToClient(lifted, opts), 200, { 'X-Sync-Base': String(Date.now()) });
  }
  if (request.method === 'PUT') {
    let body; try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
    const base = Number(request.headers.get('X-Sync-Base') || 0) || 0;
    const now = Date.now();
    const envx = mergeIntoEnvelope(liftEnvelope(await env.EDITS.get(kvKey, 'json'), now), body, base, now, opts);
    await env.EDITS.put(kvKey, JSON.stringify(envx));
    return json(envelopeToClient(envx, opts), 200, { 'X-Sync-Base': String(Date.now()) });
  }
  return null;
}

/* ================= Label Guard: custom-label monitoring (docs/LABELGUARD.md) =================
   Engine (gviz pivots, baseline diff, thresholds): src/labelguard.js. KV keys:
     labels:<client>:<mkt>     latest snapshot (per-label value/volume pivot)
     labelbase:<client>:<mkt>  the BASELINE — last known-good snapshot alerts diff against
     labelhist:<client>:<mkt>  scan history [{t,rows,cov,crit,warn}] (cap 120)
     labelidx                  estate index: "<client>|<mkt>" -> summary (one read boots /labels)
     labelalerts               active alerts by "<client>|<mkt>" (cleared on recovery/rebaseline)
     labelcron                 sweep rotation cursor
   Alerts stay active until the feed RECOVERS or Ray rebaselines ("expected change") — a
   broken feed that stays broken keeps flagging; it does not fade after one scan. */

const lgKey = (c, m) => c + '|' + m;

async function runLabelScan(env, client, mkt) {
  const src = await feedSourceFor(env, client, mkt);
  if (!src) return { error: 'no feed sheet linked for this client/market - attach one in Feed Lab or the brand dossier', status: 404 };
  if (src.xml) return { error: 'XML feed (Meta channel) - Label Guard monitors sheet-backed feeds only (gviz cannot query XML)', status: 400 };
  // Google-channel feeds also capture the primary g:product_type in the SAME pass
  // (shared header probe + counts query, one extra group-by ≈ +1 subrequest) — the
  // Product Type Guard (/ptypes) reads its own ptype* stores written below.
  const wantPT = !/-fb$/.test(String(mkt || ''));
  // Google feeds also ride the Golden Record roster on the SAME multi-count query
  // (attribute coverage vs Google's product data spec — zero extra subrequests).
  const scanOpts = wantPT ? { attrs: true } : null;
  let snap;
  try {
    snap = await scanFeed(fetch, src, { client, market: mkt }, wantPT ? LABEL_KEYS.concat(PT_KEYS) : LABEL_KEYS, scanOpts);
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 140);
    // index + alert maps are re-read right before each write to keep the clobber window
    // (cron sweep vs a page-triggered scan) down to milliseconds; a lost entry self-heals
    // on the feed's next scan
    const idx = (await env.EDITS.get('labelidx', 'json')) || {};
    idx[lgKey(client, mkt)] = Object.assign({}, idx[lgKey(client, mkt)] || {}, { client, mkt, status: 'unreachable', err: msg, tErr: Date.now() });
    await env.EDITS.put('labelidx', JSON.stringify(idx));
    const alertsMap = (await env.EDITS.get('labelalerts', 'json')) || {};
    alertsMap[lgKey(client, mkt)] = { t: Date.now(), client, mkt,
      alerts: [{ sev: 'warn', code: 'fetch-fail', msg: 'feed unreachable: ' + msg }] };
    await env.EDITS.put('labelalerts', JSON.stringify(alertsMap));
    if (wantPT) try {
      const pidx = (await env.EDITS.get('ptypeidx', 'json')) || {};
      pidx[lgKey(client, mkt)] = Object.assign({}, pidx[lgKey(client, mkt)] || {}, { client, mkt, status: 'unreachable', err: msg, tErr: Date.now() });
      await env.EDITS.put('ptypeidx', JSON.stringify(pidx));
      const gidx = (await env.EDITS.get('goldenidx', 'json')) || {};
      gidx[lgKey(client, mkt)] = Object.assign({}, gidx[lgKey(client, mkt)] || {}, { client, mkt, status: 'unreachable', err: msg, tErr: Date.now() });
      await env.EDITS.put('goldenidx', JSON.stringify(gidx));
    } catch (e2) {}
    return { error: msg, status: 502 };
  }
  // split: PT + Golden Record go to their own stores; the label stores keep their exact
  // historical shape (attrs never ride into the labels:/ptype: snapshots)
  const splitRaw = (raw) => {
    if (!wantPT) return { lbl: raw, pt: null, gr: null };
    const lblOnly = {};
    LABEL_KEYS.forEach((k) => { lblOnly[k] = (raw.labels || {})[k]; });
    return {
      lbl: Object.assign({}, raw, { labels: lblOnly, attrs: undefined }),
      pt: Object.assign({}, raw, { labels: { product_type: (raw.labels || {}).product_type || { present: false } }, attrs: undefined }),
      gr: raw.attrs ? { v: 1, t: raw.t, client: raw.client, market: raw.market, rows: raw.rows, attrs: raw.attrs } : null,
    };
  };
  let { lbl: snapL, pt: ptSnap, gr: grSnap } = splitRaw(snap);
  snap = snapL;
  // DAILY reference (Ray's rule): the pivot's Δ columns read "vs yesterday" — automatically,
  // every day, every account, every label. The first scan of each UTC day promotes the
  // outgoing snapshot to labelday:<client>:<mkt>, freezing yesterday's closing state for
  // the whole day. The ALERT baseline below stays separate (last known-good) so alarms
  // never fade just because a day ticked over.
  try {
    const prev = await env.EDITS.get('labels:' + client + ':' + mkt, 'json');
    if (prev && prev.t && new Date(prev.t).toISOString().slice(0, 10) !== new Date(snap.t).toISOString().slice(0, 10)) {
      await env.EDITS.put('labelday:' + client + ':' + mkt, JSON.stringify(prev));
    }
  } catch (e) {}
  const BK = 'labelbase:' + client + ':' + mkt;
  let base = await env.EDITS.get(BK, 'json');
  if (!base) { base = snap; await env.EDITS.put(BK, JSON.stringify(snap)); }   // first scan seeds the baseline
  let alerts = diffSnapshots(base, snap);
  // a CATASTROPHIC reading (feed lost ≥30% rows, or a pile of crits at once) must survive an
  // immediate re-read before it may land: a throttled/partial gviz answer looks exactly like
  // a crater for one scan, and one bad read used to poison the alert board until the next
  // rotation. Real damage is still there seconds later; garbage isn't. (Custom watches have
  // their own two-strike — this is the estate sweep's equivalent.)
  if (alerts.some((a) => a.code === 'rows-drop' && a.sev === 'crit') || alerts.filter((a) => a.sev === 'crit').length >= 6) {
    let raw2 = null;
    try { raw2 = await scanFeed(fetch, src, { client, market: mkt }, wantPT ? LABEL_KEYS.concat(PT_KEYS) : LABEL_KEYS, scanOpts); } catch (e) {}
    if (!raw2 || Math.abs((raw2.rows || 0) - (snap.rows || 0)) > Math.max(1, snap.rows || 0) * 0.15) {
      try { await logAlertActivity(env, client + ' ' + mkt + ' · catastrophic reading NOT confirmed by re-read — scan skipped (gviz instability)'); } catch (e) {}
      return { skipped: 'unstable read — catastrophic diff not confirmed by immediate re-read', status: 202 };
    }
    const again = splitRaw(raw2);   // both reads agree — adopt the fresher snapshot
    snap = again.lbl; ptSnap = again.pt; grSnap = again.gr;
    alerts = diffSnapshots(base, snap);
  }
  const active = alerts.filter((a) => a.sev !== 'info');
  if (!active.length && base.t !== snap.t) {
    base = snap; await env.EDITS.put(BK, JSON.stringify(snap));   // clean scan rolls the baseline forward
  }
  await env.EDITS.put('labels:' + client + ':' + mkt, JSON.stringify(snap));
  try {
    const HK = 'labelhist:' + client + ':' + mkt;
    const hist = (await env.EDITS.get(HK, 'json')) || [];
    const cov = {}; LABEL_KEYS.forEach((k) => { const L = snap.labels[k]; cov[k] = L && L.present ? L.cov : null; });
    hist.push({ t: snap.t, rows: snap.rows, cov,
      crit: active.filter((a) => a.sev === 'crit').length, warn: active.filter((a) => a.sev === 'warn').length });
    await env.EDITS.put(HK, JSON.stringify(hist.slice(-120)));
  } catch (e) {}
  const idx = (await env.EDITS.get('labelidx', 'json')) || {};
  idx[lgKey(client, mkt)] = Object.assign({ client, mkt }, summarize(snap, alerts, base.t));
  await env.EDITS.put('labelidx', JSON.stringify(idx));
  const alertsMap = (await env.EDITS.get('labelalerts', 'json')) || {};
  if (active.length) alertsMap[lgKey(client, mkt)] = { t: snap.t, client, mkt, alerts };
  else delete alertsMap[lgKey(client, mkt)];
  await env.EDITS.put('labelalerts', JSON.stringify(alertsMap));

  // ---- Product Type Guard stores (Google feeds only) — same three-reference model:
  // ptypeday: = yesterday's closing state, ptypebase: = last known-good (rolls forward on
  // clean scans, frozen while broken, moved by /api/ptypes/ack), ptype: = latest snapshot.
  let pt = null;
  if (ptSnap) try {
    const PK = ':' + client + ':' + mkt;
    try {
      const pPrev = await env.EDITS.get('ptype' + PK, 'json');
      if (pPrev && pPrev.t && new Date(pPrev.t).toISOString().slice(0, 10) !== new Date(ptSnap.t).toISOString().slice(0, 10)) {
        await env.EDITS.put('ptypeday' + PK, JSON.stringify(pPrev));
      }
    } catch (e) {}
    let pBase = await env.EDITS.get('ptypebase' + PK, 'json');
    if (!pBase) { pBase = ptSnap; await env.EDITS.put('ptypebase' + PK, JSON.stringify(ptSnap)); }
    const pAlerts = diffSnapshots(pBase, ptSnap, null, PT_KEYS);
    const pActive = pAlerts.filter((a) => a.sev !== 'info');
    if (!pActive.length && pBase.t !== ptSnap.t) {
      pBase = ptSnap; await env.EDITS.put('ptypebase' + PK, JSON.stringify(ptSnap));
    }
    await env.EDITS.put('ptype' + PK, JSON.stringify(ptSnap));
    const pidx = (await env.EDITS.get('ptypeidx', 'json')) || {};
    pidx[lgKey(client, mkt)] = Object.assign({ client, mkt }, summarize(ptSnap, pAlerts, pBase.t, PT_KEYS),
      { depth: depthProfile(((ptSnap.labels || {}).product_type || {}).values) });   // 3/4/5-depth granularity KPI for the estate hovers
    await env.EDITS.put('ptypeidx', JSON.stringify(pidx));
    const pMap = (await env.EDITS.get('ptypealerts', 'json')) || {};
    // email-on-warning (Ray, "similar to Custom label"): two-strike by construction —
    // an alert emails only on its SECOND consecutive sighting, once per incident, with a
    // ✅ when the feed clears. Recipient/off-switch live in KV ptypealertcfg (/ptypes §01).
    const mailPlan = estateMailPlan(pMap[lgKey(client, mkt)], pActive);
    if (pActive.length) pMap[lgKey(client, mkt)] = { t: ptSnap.t, client, mkt, alerts: pAlerts, mailed: mailPlan.mailed };
    else delete pMap[lgKey(client, mkt)];
    await env.EDITS.put('ptypealerts', JSON.stringify(pMap));
    if (mailPlan.mail.length || mailPlan.recovered) try {
      const mcfg = (await env.EDITS.get('ptypealertcfg', 'json')) || {};
      if (mcfg.on !== false) {
        const to = String(mcfg.to || env.OWNER_EMAIL || 'ray@feedspark.com');
        const name = dispFeed(client, mkt);
        const link = 'https://feedspark.ray-vtt.workers.dev/ptypes';
        await sendPing(env, { type: 'email', to }, mailPlan.mail.length
          ? estateAlertEmail(name, mailPlan.mail, link)
          : estateRecoveryEmail(name, link));
        await logAlertActivity(env, 'PT ' + (mailPlan.mail.length ? 'alert email (' + mailPlan.mail.length + ' confirmed)' : 'recovery email') + ' → ' + to + ' · ' + name);
      }
    } catch (e) {}
    pt = { snapshot: ptSnap, alerts: pAlerts, baseT: pBase.t };
  } catch (e) {}

  // ---- Golden Record stores (Google feeds only) — attribute coverage vs Google's product
  // data specification, captured on the same query. Same three-reference model (goldenday: =
  // yesterday, goldenbase: = last known-good moved by /api/golden/ack, golden: = latest)
  // and the same two-strike email-on-confirmed-warning as the PT block above (goldenalertcfg).
  let gr = null;
  if (grSnap) try {
    const GK = ':' + client + ':' + mkt;
    try {
      const gPrev = await env.EDITS.get('golden' + GK, 'json');
      if (gPrev && gPrev.t && new Date(gPrev.t).toISOString().slice(0, 10) !== new Date(grSnap.t).toISOString().slice(0, 10)) {
        await env.EDITS.put('goldenday' + GK, JSON.stringify(gPrev));
      }
    } catch (e) {}
    let gBase = await env.EDITS.get('goldenbase' + GK, 'json');
    if (!gBase) { gBase = grSnap; await env.EDITS.put('goldenbase' + GK, JSON.stringify(grSnap)); }
    const gAlerts = diffCoverage(gBase, grSnap);
    const gActive = gAlerts.filter((a) => a.sev !== 'info');
    if (!gActive.length && gBase.t !== grSnap.t) {
      gBase = grSnap; await env.EDITS.put('goldenbase' + GK, JSON.stringify(grSnap));
    }
    await env.EDITS.put('golden' + GK, JSON.stringify(grSnap));
    // score to the brand's industry best-practice profile (KV goldenprofiles overrides);
    // the index also carries per-attribute coverage + the industry, so the page can
    // compute estate-wide industry benchmarks (avg / best) from the one estate call
    const gProf = profileFor(client, await env.EDITS.get('goldenprofiles', 'json'));
    const gs = goldenScore(grSnap.attrs, gProf);
    const covMap = {};
    ATTR_SPEC.forEach((sp) => { const a = grSnap.attrs[sp.key]; covMap[sp.key] = a && a.present ? a.cov : null; });
    const gidx = (await env.EDITS.get('goldenidx', 'json')) || {};
    gidx[lgKey(client, mkt)] = { client, mkt, t: grSnap.t, rows: grSnap.rows, baseT: gBase.t,
      score: gs ? gs.score : null, ai: gs ? gs.ai : null, ind: gProf.industry, cov: covMap,
      reqMissing: gs ? gs.reqMissing : [], condMissing: gs ? gs.condMissing : [], recMissing: gs ? gs.recMissing : [],
      status: gActive.some((a) => a.sev === 'crit') ? 'crit' : (gActive.length ? 'warn' : 'ok'),
      nCrit: gActive.filter((a) => a.sev === 'crit').length, nWarn: gActive.filter((a) => a.sev === 'warn').length };
    await env.EDITS.put('goldenidx', JSON.stringify(gidx));
    const gMap = (await env.EDITS.get('goldenalerts', 'json')) || {};
    const gPlan = estateMailPlan(gMap[lgKey(client, mkt)], gActive);
    if (gActive.length) gMap[lgKey(client, mkt)] = { t: grSnap.t, client, mkt, alerts: gAlerts, mailed: gPlan.mailed };
    else delete gMap[lgKey(client, mkt)];
    await env.EDITS.put('goldenalerts', JSON.stringify(gMap));
    if (gPlan.mail.length || gPlan.recovered) try {
      const gcfg = (await env.EDITS.get('goldenalertcfg', 'json')) || {};
      if (gcfg.on !== false) {
        const to = String(gcfg.to || env.OWNER_EMAIL || 'ray@feedspark.com');
        const name = dispFeed(client, mkt);
        const link = 'https://feedspark.ray-vtt.workers.dev/golden';
        await sendPing(env, { type: 'email', to }, gPlan.mail.length
          ? goldenAlertEmail(name, gPlan.mail, link)
          : goldenRecoveryEmail(name, link));
        await logAlertActivity(env, 'Golden Record ' + (gPlan.mail.length ? 'alert email (' + gPlan.mail.length + ' confirmed)' : 'recovery email') + ' → ' + to + ' · ' + name);
      }
    } catch (e) {}
    gr = { snapshot: grSnap, alerts: gAlerts, baseT: gBase.t };
  } catch (e) {}

  return { snapshot: snap, alerts, baseT: base.t, pt, gr };
}

async function labelGuardRoutes(env, request, url) {
  const path = url.pathname;
  const client = (url.searchParams.get('client') || '').slice(0, 60);
  const mkt = mktOf(url.searchParams.get('market'));
  // ':' aliases other KV keys, '|' aliases other estate-index entries — reject both outright
  const badClient = !client || client.indexOf(':') >= 0 || client.indexOf('|') >= 0;

  // estate board bootstrap: full roster (wired ∪ dossier-attached) ∪ scanned index + active
  // alerts in ONE call — never-scanned feeds surface as status 'never', not silently absent
  if (path === '/api/labels/estate' && request.method === 'GET') {
    const roster = await feedRoster(env);
    const idx = (await env.EDITS.get('labelidx', 'json')) || {};
    const alerts = (await env.EDITS.get('labelalerts', 'json')) || {};
    const feeds = {};
    for (const f of roster) {
      if (f.src && f.src.xml) continue;   // XML (Meta) feeds aren't label-monitorable — keep them off the estate grid
      feeds[lgKey(f.client, f.mkt)] = Object.assign({ client: f.client, mkt: f.mkt, status: 'never' }, idx[lgKey(f.client, f.mkt)] || {});
    }
    // scanned-but-detached feeds stay visible (with their history) rather than vanishing
    Object.keys(idx).forEach((k) => {
      if (!feeds[k]) feeds[k] = Object.assign({ client: k.split('|')[0], mkt: k.split('|')[1] || 'gb', detached: true }, idx[k]);
    });
    return json({ feeds, alerts });
  }

  // badge feed for every app page: active alert counts for BOTH guards in one call
  // (counts = Label Guard; pt = Product Type Guard — the injected badge dots each nav link)
  if (path === '/api/labels/alerts' && request.method === 'GET') {
    const alerts = (await env.EDITS.get('labelalerts', 'json')) || {};
    let crit = 0, warn = 0;
    Object.keys(alerts).forEach((k) => (alerts[k].alerts || []).forEach((a) => {
      if (a.sev === 'crit') crit++; else if (a.sev === 'warn') warn++;
    }));
    const pAlerts = (await env.EDITS.get('ptypealerts', 'json')) || {};
    let pc = 0, pw = 0;
    Object.keys(pAlerts).forEach((k) => (pAlerts[k].alerts || []).forEach((a) => {
      if (a.sev === 'crit') pc++; else if (a.sev === 'warn') pw++;
    }));
    const gAlerts = (await env.EDITS.get('goldenalerts', 'json')) || {};
    let gc = 0, gw = 0;
    Object.keys(gAlerts).forEach((k) => (gAlerts[k].alerts || []).forEach((a) => {
      if (a.sev === 'crit') gc++; else if (a.sev === 'warn') gw++;
    }));
    const out = { counts: { crit, warn, feeds: Object.keys(alerts).length },
      pt: { crit: pc, warn: pw, feeds: Object.keys(pAlerts).length },
      gr: { crit: gc, warn: gw, feeds: Object.keys(gAlerts).length } };
    // ?by=client — per-brand splits for the dossier portfolio view (keys are "<client>|<mkt>")
    if (url.searchParams.get('by') === 'client') {
      const split = (m) => { const per = {}; Object.keys(m).forEach((k) => {
        const c = k.split('|')[0]; const e = per[c] = per[c] || { crit: 0, warn: 0 };
        (m[k].alerts || []).forEach((a) => { if (a.sev === 'crit') e.crit++; else if (a.sev === 'warn') e.warn++; }); });
        return per; };
      out.clients = split(alerts); out.ptClients = split(pAlerts); out.grClients = split(gAlerts);
    }
    return json(out);
  }

  if (path === '/api/labels/snapshot' && request.method === 'GET') {
    if (badClient) return json({ error: 'bad client' }, 400);
    const snap = await env.EDITS.get('labels:' + client + ':' + mkt, 'json');
    const base = await env.EDITS.get('labelbase:' + client + ':' + mkt, 'json');
    const daily = await env.EDITS.get('labelday:' + client + ':' + mkt, 'json');
    const out = { snapshot: snap || null, baseline: base || null, daily: daily || null };
    if (url.searchParams.get('hist') === '1') out.hist = (await env.EDITS.get('labelhist:' + client + ':' + mkt, 'json')) || [];
    return json(out);
  }

  if (path === '/api/labels/scan' && request.method === 'POST') {
    if (badClient) return json({ error: 'bad client' }, 400);
    const r = await runLabelScan(env, client, mkt);
    if (r.error) return json({ error: r.error }, r.status || 502);
    return json(r);
  }

  // live cross-label dissection: within by=<value> (CL0 = "Best Sellers"), pivot the
  // segment by another label (CL2 -> women - fp / women - sale / ...). Nothing cached —
  // 3 tiny gviz fetches per click, Google aggregates (labels/cross)
  if (path === '/api/labels/cross' && request.method === 'GET') {
    if (badClient) return json({ error: 'bad client' }, 400);
    const by = String(url.searchParams.get('by') || '');
    const vs = String(url.searchParams.get('vs') || '');
    const value = String(url.searchParams.get('value') || '').slice(0, 200);
    if (LABEL_KEYS.indexOf(by) < 0 || LABEL_KEYS.indexOf(vs) < 0 || by === vs || !value) {
      return json({ error: 'bad cross params: need by+vs = two different custom_label_0..4 and a value' }, 400);
    }
    const src = await feedSourceFor(env, client, mkt);
    if (!src) return json({ error: 'no feed sheet linked for this client/market' }, 404);
    if (src.xml) return json({ error: 'XML feed (Meta channel) - cross-label dissection needs a sheet-backed feed (gviz)' }, 400);
    try {
      return json(await crossFeed(fetch, src, by, value, vs));
    } catch (e) {
      const msg = String((e && e.message) || e);
      return json({ error: msg }, msg.indexOf('bad-cross') === 0 ? 400 : 502);
    }
  }

  // ---- custom alert builder: watch rules + ping destinations (docs/LABELGUARD.md §7) ----
  // Both stores are kvmerge maps with explicit tombstones (delete = PUT {_deleted:[key]}).
  // labelwatch keys: "<client>|<mkt>|<ruleId>"; labeldest keys: destination ids.
  if (path === '/api/labels/watch' && (request.method === 'GET' || request.method === 'PUT')) {
    return await mapStoreRoute(env, request, 'labelwatch', { explicitTombstones: true });
  }
  if (path === '/api/labels/dest' && (request.method === 'GET' || request.method === 'PUT')) {
    return await mapStoreRoute(env, request, 'labeldest', { explicitTombstones: true });
  }
  if (path === '/api/labels/dest/test' && request.method === 'POST') {
    let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
    const dests = liftEnvelope(await env.EDITS.get('labeldest', 'json'), Date.now()).data;
    const dest = dests[String(b.id || '')];
    if (!dest) return json({ error: 'unknown destination' }, 404);
    const r = await sendPing(env, dest, '🟠 Test ping — FeedSpark Label Guard\nThis destination is wired up. Watch rules that route here will ping the moment a watched custom-label value drops off a live feed.');
    return json(r, r.ok ? 200 : 502);
  }
  // evaluate now — all rules, or just one feed's (?client&market)
  if (path === '/api/labels/watch/run' && request.method === 'POST') {
    const only = url.searchParams.get('client') ? lgKey(client, mkt) : null;
    return json(await labelWatchRun(env, only));
  }

  // ---- the emailed status report: settings + send-now (delivered via the Gmail bridge) ----
  if (path === '/api/labels/report') {
    if (request.method === 'GET') {
      return json((await env.EDITS.get('labelreportcfg', 'json')) || { on: false, pm: false, to: String(env.OWNER_EMAIL || 'ray@feedspark.com') });
    }
    if (request.method === 'PUT') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const to = String(b.to || '').slice(0, 120);
      if (to.indexOf('@') < 1) return json({ error: 'not an email address' }, 400);
      const cfg = { on: !!b.on, pm: !!b.pm, to };
      await env.EDITS.put('labelreportcfg', JSON.stringify(cfg));
      return json(Object.assign({ ok: true }, cfg));
    }
  }
  if (path === '/api/labels/report/send' && request.method === 'POST') {
    const r = await queueLabelReport(env, 'on-demand');
    return json(r, r.ok ? 200 : 502);
  }

  // "expected change" — adopt the current snapshot as the new baseline and clear the flags
  if (path === '/api/labels/ack' && request.method === 'POST') {
    if (badClient) return json({ error: 'bad client' }, 400);
    const snap = await env.EDITS.get('labels:' + client + ':' + mkt, 'json');
    if (!snap) return json({ error: 'no snapshot to adopt as baseline - scan first' }, 404);
    await env.EDITS.put('labelbase:' + client + ':' + mkt, JSON.stringify(snap));
    const idx = (await env.EDITS.get('labelidx', 'json')) || {};
    idx[lgKey(client, mkt)] = Object.assign({ client, mkt }, summarize(snap, [], snap.t));
    await env.EDITS.put('labelidx', JSON.stringify(idx));
    const alertsMap = (await env.EDITS.get('labelalerts', 'json')) || {};
    delete alertsMap[lgKey(client, mkt)];
    await env.EDITS.put('labelalerts', JSON.stringify(alertsMap));
    // acceptance answers the question — the feed's "✉ asked" markers are done with
    const asked0 = (await env.EDITS.get('labelasked', 'json')) || {};
    const pre = lgKey(client, mkt) + '§'; let cleared = 0;
    Object.keys(asked0).forEach((k) => { if (k.indexOf(pre) === 0) { delete asked0[k]; cleared++; } });
    if (cleared) await env.EDITS.put('labelasked', JSON.stringify(asked0));
    return json({ ok: true, baseT: snap.t });
  }

  // ---- "Ask the client — is this drop expected?" (Ray's rule: confirm before acting) ----
  // POST queues a pre-filled Gmail DRAFT — never an auto-send to a client: the Gmail bridge
  // running in the owner's own mailbox creates the draft (breakdown images attached) for
  // review + send. Each covered alert is stamped "✉ asked" until the feed recovers or the
  // change is accepted as known-good, so the panel shows who has already been chased.
  if (path === '/api/labels/askdraft') {
    if (request.method === 'GET') {
      return json({
        cfg: (await env.EDITS.get('labelaskcfg', 'json')) || { to: {} },
        asked: (await env.EDITS.get('labelasked', 'json')) || {},
        pending: ((await env.EDITS.get('labeldrafts', 'json')) || []).length,
      });
    }
    if (request.method === 'POST') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const to = String(b.to || '').slice(0, 160).trim();
      if (to.indexOf('@') < 1) return json({ error: 'not an email address' }, 400);
      // markOnly: the email was composed directly (Gmail deep-link / mail app) — persist the
      // "✉ asked" stamps and the remembered contact, but queue nothing for the bridge.
      if (b.markOnly) {
        const asked0 = (await env.EDITS.get('labelasked', 'json')) || {};
        (Array.isArray(b.keys) ? b.keys : []).slice(0, 40).forEach((k) => { asked0[String(k).slice(0, 300)] = { t: Date.now(), to }; });
        await env.EDITS.put('labelasked', JSON.stringify(asked0));
        if (b.client) {
          const cfg0 = (await env.EDITS.get('labelaskcfg', 'json')) || { to: {} };
          cfg0.to = cfg0.to || {}; cfg0.to[String(b.client).slice(0, 60)] = to;
          await env.EDITS.put('labelaskcfg', JSON.stringify(cfg0));
        }
        return json({ ok: true, marked: (Array.isArray(b.keys) ? b.keys : []).length });
      }
      const subject = String(b.subject || '').slice(0, 200).trim();
      const text = String(b.text || '').slice(0, 8000);
      if (!subject || !text) return json({ error: 'missing subject / body' }, 400);
      const atts = (Array.isArray(b.atts) ? b.atts : []).slice(0, 6)
        .map((a) => ({ name: String((a && a.name) || 'breakdown.png').slice(0, 60), mime: 'image/png', b64: String((a && a.b64) || '') }))
        .filter((a) => a.b64);
      let total = 0; atts.forEach((a) => { total += a.b64.length; });
      if (total > 1500000) return json({ error: 'attachments too large - keep the breakdown images under ~1MB total' }, 413);
      const q = (await env.EDITS.get('labeldrafts', 'json')) || [];
      const id = 'ad_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      q.push({ id, to, subject, text, atts, t: Date.now() });
      await env.EDITS.put('labeldrafts', JSON.stringify(q.slice(-12)));
      const asked = (await env.EDITS.get('labelasked', 'json')) || {};
      (Array.isArray(b.keys) ? b.keys : []).slice(0, 40).forEach((k) => { asked[String(k).slice(0, 300)] = { t: Date.now(), to }; });
      await env.EDITS.put('labelasked', JSON.stringify(asked));
      if (b.client) {   // remember the contact per client — the next compose pre-fills it
        const cfg = (await env.EDITS.get('labelaskcfg', 'json')) || { to: {} };
        cfg.to = cfg.to || {}; cfg.to[String(b.client).slice(0, 60)] = to;
        await env.EDITS.put('labelaskcfg', JSON.stringify(cfg));
      }
      return json({ ok: true, id, note: 'draft queued - it appears in the Gmail Drafts folder within ~5 min of the next sync (needs the updated gmail_push.gs)' });
    }
  }

  return null;
}

/* ---- Product Type Guard routes (/ptypes page) — mirrors Label Guard's shape for ONE
   field (primary g:product_type), Google Shopping channel only. Data is captured by
   runLabelScan on every Google-feed scan (same rotation, same freshness); these routes
   just read/ack the ptype* stores, plus a live PT<->CL cross dissection. */
async function productTypeRoutes(env, request, url) {
  const path = url.pathname;
  const client = (url.searchParams.get('client') || '').slice(0, 60);
  const mkt = mktOf(url.searchParams.get('market'));
  const badClient = !client || client.indexOf(':') >= 0 || client.indexOf('|') >= 0;
  const isFb = /-fb$/.test(mkt);

  if (path === '/api/ptypes/estate' && request.method === 'GET') {
    const roster = await feedRoster(env);
    const idx = (await env.EDITS.get('ptypeidx', 'json')) || {};
    const alerts = (await env.EDITS.get('ptypealerts', 'json')) || {};
    const feeds = {};
    for (const f of roster) {
      if (!f.src || !f.src.id) continue;                 // sheet-backed only
      if (/-fb$/.test(String(f.mkt || ''))) continue;    // Google Shopping channel only
      feeds[lgKey(f.client, f.mkt)] = Object.assign({ client: f.client, mkt: f.mkt, status: 'never' }, idx[lgKey(f.client, f.mkt)] || {});
    }
    Object.keys(idx).forEach((k) => {
      if (!feeds[k] && !/-fb$/.test(k.split('|')[1] || '')) {
        feeds[k] = Object.assign({ client: k.split('|')[0], mkt: k.split('|')[1] || 'gb', detached: true }, idx[k]);
      }
    });
    return json({ feeds, alerts });
  }

  if (path === '/api/ptypes/alerts' && request.method === 'GET') {
    const alerts = (await env.EDITS.get('ptypealerts', 'json')) || {};
    let crit = 0, warn = 0;
    Object.keys(alerts).forEach((k) => (alerts[k].alerts || []).forEach((a) => {
      if (a.sev === 'crit') crit++; else if (a.sev === 'warn') warn++;
    }));
    return json({ counts: { crit, warn, feeds: Object.keys(alerts).length } });
  }

  // email-on-warning settings (recipient + on/off) — mirrors labelreportcfg's shape
  if (path === '/api/ptypes/alertcfg') {
    if (request.method === 'GET') {
      return json((await env.EDITS.get('ptypealertcfg', 'json')) || { on: true, to: String(env.OWNER_EMAIL || 'ray@feedspark.com') });
    }
    if (request.method === 'PUT') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const to = String(b.to || '').slice(0, 120);
      if (to.indexOf('@') < 1) return json({ error: 'not an email address' }, 400);
      const cfg = { on: !!b.on, to };
      await env.EDITS.put('ptypealertcfg', JSON.stringify(cfg));
      return json(Object.assign({ ok: true }, cfg));
    }
  }

  if (path === '/api/ptypes/snapshot' && request.method === 'GET') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const snap = await env.EDITS.get('ptype:' + client + ':' + mkt, 'json');
    const base = await env.EDITS.get('ptypebase:' + client + ':' + mkt, 'json');
    const daily = await env.EDITS.get('ptypeday:' + client + ':' + mkt, 'json');
    return json({ snapshot: snap || null, baseline: base || null, daily: daily || null });
  }

  if (path === '/api/ptypes/scan' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const r = await runLabelScan(env, client, mkt);   // one pass writes labels AND ptype stores
    if (r.error) return json({ error: r.error }, r.status || 502);
    if (!r.pt) return json({ error: 'scan succeeded but captured no product_type view' }, 502);
    return json(r.pt);
  }

  // live cross dissection: PT value -> custom-label breakdown (or CL value -> PT)
  if (path === '/api/ptypes/cross' && request.method === 'GET') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const by = String(url.searchParams.get('by') || '');
    const vs = String(url.searchParams.get('vs') || '');
    const value = String(url.searchParams.get('value') || '').slice(0, 200);
    const pool = LABEL_KEYS.concat(PT_KEYS);
    if (pool.indexOf(by) < 0 || pool.indexOf(vs) < 0 || by === vs || !value ||
        (by !== 'product_type' && vs !== 'product_type')) {
      return json({ error: 'bad cross params: one of by/vs must be product_type, the other a custom_label_0..4' }, 400);
    }
    const src = await feedSourceFor(env, client, mkt);
    if (!src) return json({ error: 'no feed sheet linked for this client/market' }, 404);
    if (src.xml) return json({ error: 'XML feed - cross dissection needs a sheet-backed feed (gviz)' }, 400);
    try {
      return json(await crossFeed(fetch, src, by, value, vs));
    } catch (e) {
      const msg = String((e && e.message) || e);
      return json({ error: msg }, msg.indexOf('bad-cross') === 0 ? 400 : 502);
    }
  }

  // file the depth-optimisation proposal into the brand's Project Plan — the same
  // appendPlanRows write the Workflow "+ Add task" and the Gmail-triage adoption use, so
  // the task lands in Intake > Project Plan > pipeline identically (status dropdown, due).
  if (path === '/api/ptypes/plantask' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' }, 503);
    const sheetId = PLAN_SHEETS[client];
    if (!sheetId) return json({ ok: false, error: 'no Project Plan sheet wired for "' + client + '" — add it to PLAN_SHEETS' }, 400);
    const mon = new Date().toLocaleDateString('en-GB', { month: 'short' }) + String(new Date().getUTCFullYear()).slice(2);
    const task = 'PT Depth Optimisation (3-4-5 level granularity) - ' + client + ' ' + mkt.toUpperCase() + ' - ' + mon;
    const r = await appendPlanRows(env, sheetId, 'Project Plan', [{ task, owner: '', status: 'Open', due: '' }]);
    if (r && r.ok) { try { await env.EDITS.delete('planlive:' + sheetId); } catch (e) {} }
    return json(Object.assign({ task }, r));
  }

  // "expected change" — adopt the current PT snapshot as the new known-good, clear flags
  if (path === '/api/ptypes/ack' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const snap = await env.EDITS.get('ptype:' + client + ':' + mkt, 'json');
    if (!snap) return json({ error: 'no snapshot to adopt as known-good - scan first' }, 404);
    await env.EDITS.put('ptypebase:' + client + ':' + mkt, JSON.stringify(snap));
    const idx = (await env.EDITS.get('ptypeidx', 'json')) || {};
    idx[lgKey(client, mkt)] = Object.assign({ client, mkt }, summarize(snap, [], snap.t, PT_KEYS));
    await env.EDITS.put('ptypeidx', JSON.stringify(idx));
    const alertsMap = (await env.EDITS.get('ptypealerts', 'json')) || {};
    delete alertsMap[lgKey(client, mkt)];
    await env.EDITS.put('ptypealerts', JSON.stringify(alertsMap));
    return json({ ok: true, baseT: snap.t });
  }

  return null;
}

/* ---- Golden Record (docs/LABELGUARD.md §9): attribute coverage per Google's product
   data specification — required vs required-in-cases vs recommended — captured by
   runLabelScan on every Google-feed scan (zero extra subrequests: the roster rides the
   same multi-count query). These routes read/ack the golden* stores. */
async function goldenRoutes(env, request, url) {
  const path = url.pathname;
  const client = (url.searchParams.get('client') || '').slice(0, 60);
  const mkt = mktOf(url.searchParams.get('market'));
  const badClient = !client || client.indexOf(':') >= 0 || client.indexOf('|') >= 0;
  const isFb = /-fb$/.test(mkt);

  if (path === '/api/golden/estate' && request.method === 'GET') {
    const roster = await feedRoster(env);
    const idx = (await env.EDITS.get('goldenidx', 'json')) || {};
    const alerts = (await env.EDITS.get('goldenalerts', 'json')) || {};
    const feeds = {};
    for (const f of roster) {
      if (!f.src || !f.src.id) continue;                 // sheet-backed only
      if (/-fb$/.test(String(f.mkt || ''))) continue;    // Google Shopping channel only
      feeds[lgKey(f.client, f.mkt)] = Object.assign({ client: f.client, mkt: f.mkt, status: 'never' }, idx[lgKey(f.client, f.mkt)] || {});
    }
    Object.keys(idx).forEach((k) => {
      if (!feeds[k] && !/-fb$/.test(k.split('|')[1] || '')) {
        feeds[k] = Object.assign({ client: k.split('|')[0], mkt: k.split('|')[1] || 'gb', detached: true }, idx[k]);
      }
    });
    return json({ feeds, alerts });
  }

  // email-on-warning settings (recipient + on/off) — mirrors ptypealertcfg's shape
  if (path === '/api/golden/alertcfg') {
    if (request.method === 'GET') {
      return json((await env.EDITS.get('goldenalertcfg', 'json')) || { on: true, to: String(env.OWNER_EMAIL || 'ray@feedspark.com') });
    }
    if (request.method === 'PUT') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const to = String(b.to || '').slice(0, 120);
      if (to.indexOf('@') < 1) return json({ error: 'not an email address' }, 400);
      const cfg = { on: !!b.on, to };
      await env.EDITS.put('goldenalertcfg', JSON.stringify(cfg));
      return json(Object.assign({ ok: true }, cfg));
    }
  }

  if (path === '/api/golden/snapshot' && request.method === 'GET') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const snap = await env.EDITS.get('golden:' + client + ':' + mkt, 'json');
    const base = await env.EDITS.get('goldenbase:' + client + ':' + mkt, 'json');
    const daily = await env.EDITS.get('goldenday:' + client + ':' + mkt, 'json');
    return json({ snapshot: snap || null, baseline: base || null, daily: daily || null });
  }

  if (path === '/api/golden/scan' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const r = await runLabelScan(env, client, mkt);   // one pass writes labels, ptype AND golden stores
    if (r.error) return json({ error: r.error }, r.status || 502);
    if (!r.gr) return json({ error: 'scan succeeded but captured no attribute-coverage view' }, 502);
    return json(r.gr);
  }

  // scoring profiles: which attributes count per brand / per industry (best practices).
  // GET returns the committed defaults + KV overrides + the client->industry map; PUT
  // saves one override ({ scope: 'client'|'industry', name, expected, waived } — pass
  // reset:true to drop the override and fall back to the layer below). The required
  // seven and the gtin/mpn identifier pair are rejected — Google requires them everywhere.
  if (path === '/api/golden/profile') {
    if (request.method === 'GET') {
      const overrides = (await env.EDITS.get('goldenprofiles', 'json')) || {};
      return json({ defaults: INDUSTRY_PROFILES, overrides, industryMap: INDUSTRY });
    }
    if (request.method === 'PUT') {
      let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
      const scope = b.scope === 'industry' ? 'industries' : (b.scope === 'client' ? 'clients' : null);
      const name = String(b.name || '').slice(0, 60);
      if (!scope || !name) return json({ error: 'scope (client|industry) + name required' }, 400);
      const overrides = (await env.EDITS.get('goldenprofiles', 'json')) || {};
      overrides[scope] = overrides[scope] || {};
      if (b.reset) { delete overrides[scope][name]; }
      else {
        const clean = (v) => (Array.isArray(v) ? v : []).map(String)
          .filter((k) => ATTR_SPEC.some((sp) => sp.key === k && sp.req !== 'required' && k !== 'gtin' && k !== 'mpn')).slice(0, 40);
        overrides[scope][name] = { expected: clean(b.expected), waived: clean(b.waived) };
      }
      await env.EDITS.put('goldenprofiles', JSON.stringify(overrides));
      return json({ ok: true, overrides, effective: scope === 'clients' ? profileFor(name, overrides) : null });
    }
  }

  // file an attribute fix into the brand's Project Plan — the same appendPlanRows write
  // the Workflow "+ Add task" and the Gmail-triage adoption use, so the task rides
  // Intake > Project Plan > pipeline identically (status dropdown, editable due).
  if (path === '/api/golden/plantask' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    if (!env.GOOGLE_SA_JSON) return json({ ok: false, error: 'no_sa' }, 503);
    const attr = String(url.searchParams.get('attr') || '');
    if (!ATTR_SPEC.some((s) => s.key === attr)) return json({ ok: false, error: 'unknown attribute' }, 400);
    const sheetId = PLAN_SHEETS[client];
    if (!sheetId) return json({ ok: false, error: 'no Project Plan sheet wired for "' + client + '" — add it to PLAN_SHEETS' }, 400);
    const mon = new Date().toLocaleDateString('en-GB', { month: 'short' }) + String(new Date().getUTCFullYear()).slice(2);
    const task = 'Golden Record Fix - g:' + attr + ' - ' + client + ' ' + mkt.toUpperCase() + ' - ' + mon;
    const r = await appendPlanRows(env, sheetId, 'Project Plan', [{ task, owner: '', status: 'Open', due: '' }]);
    if (r && r.ok) { try { await env.EDITS.delete('planlive:' + sheetId); } catch (e) {} }
    return json(Object.assign({ task }, r));
  }

  // "expected change" — adopt the current coverage snapshot as the new known-good
  if (path === '/api/golden/ack' && request.method === 'POST') {
    if (badClient || isFb) return json({ error: 'bad client/market' }, 400);
    const snap = await env.EDITS.get('golden:' + client + ':' + mkt, 'json');
    if (!snap) return json({ error: 'no snapshot to adopt as known-good - scan first' }, 404);
    await env.EDITS.put('goldenbase:' + client + ':' + mkt, JSON.stringify(snap));
    const ackProf = profileFor(client, await env.EDITS.get('goldenprofiles', 'json'));
    const gs = goldenScore(snap.attrs, ackProf);
    const ackCov = {};
    ATTR_SPEC.forEach((sp) => { const a = snap.attrs[sp.key]; ackCov[sp.key] = a && a.present ? a.cov : null; });
    const idx = (await env.EDITS.get('goldenidx', 'json')) || {};
    idx[lgKey(client, mkt)] = { client, mkt, t: snap.t, rows: snap.rows, baseT: snap.t,
      score: gs ? gs.score : null, ai: gs ? gs.ai : null, ind: ackProf.industry, cov: ackCov,
      reqMissing: gs ? gs.reqMissing : [], condMissing: gs ? gs.condMissing : [], recMissing: gs ? gs.recMissing : [],
      status: 'ok', nCrit: 0, nWarn: 0 };
    await env.EDITS.put('goldenidx', JSON.stringify(idx));
    const alertsMap = (await env.EDITS.get('goldenalerts', 'json')) || {};
    delete alertsMap[lgKey(client, mkt)];
    await env.EDITS.put('goldenalerts', JSON.stringify(alertsMap));
    return json({ ok: true, baseT: snap.t });
  }

  return null;
}

/* ---- custom alert delivery + watch evaluation (docs/LABELGUARD.md §7) ----
   Destinations (KV labeldest): { id: { name, type: 'gchat'|'slack'|'email', url?, to?,
   mention? } }. gchat/slack = incoming-webhook URL, pinged straight from the worker
   ({"text": ...} works for both). email = queued to KV labeloutbox; the key-gated Gmail
   Apps Script (tools/gmail_push.gs, 5-min trigger) polls /api/gmail/push {outboxPoll:1},
   sends from Ray's mailbox, then acks {outboxAck:[ids]}. `mention` (e.g. "<!channel>" for
   Slack, "<users/all>" for Google Chat) is prepended on non-recovery pings. */
async function sendPing(env, dest, text) {
  try {
    if (dest.type === 'slack' || dest.type === 'gchat') {
      if (!/^https:\/\//.test(String(dest.url || ''))) return { ok: false, error: 'destination has no webhook url' };
      const r = await fetch(dest.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      return r.ok ? { ok: true, sent: dest.type } : { ok: false, error: dest.type + ' webhook HTTP ' + r.status };
    }
    if (dest.type === 'email') {
      if (!dest.to) return { ok: false, error: 'destination has no email address' };
      const ob = (await env.EDITS.get('labeloutbox', 'json')) || [];
      ob.push({ id: 'ob_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        to: String(dest.to).slice(0, 120), subject: text.split('\n')[0].slice(0, 140), body: text, t: Date.now() });
      await env.EDITS.put('labeloutbox', JSON.stringify(ob.slice(-50)));
      return { ok: true, queued: true, note: 'email queued — the Gmail bridge sends within ~5 min' + (env.GMAIL_PUSH_KEY ? '' : ' (GMAIL_PUSH_KEY not set: bridge inactive until GOOGLE_SETUP.md §8 is done)') };
    }
    return { ok: false, error: 'unknown destination type "' + dest.type + '"' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 140) }; }
}

// activity entry that works from cron (no request/ctx) — same key/metadata shape as logActivity
async function logAlertActivity(env, detail) {
  try {
    const t = Date.now();
    await env.EDITS.put('act:' + String(t).padStart(14, '0') + ':' + Math.random().toString(36).slice(2, 6), '',
      { metadata: { t, u: 'label-guard', a: 'label-alert', d: String(detail || '').slice(0, 80) }, expirationTtl: 60 * 60 * 24 * 90 });
  } catch (e) {}
}

// evaluate watch rules against the LIVE feeds. ~2-3 gviz fetches per rule; each cron
// firing gets its own subrequest budget, and >MAXRULES estates rotate via cursor.
// mode: 'hourly' | 'twice' filters rules by their per-rule schedule (r.sched, default
// 'hourly'); null (manual Check now / Run all) checks every enabled rule regardless.
async function labelWatchRun(env, onlyFeedKey, mode) {
  const now = Date.now();
  const envx = liftEnvelope(await env.EDITS.get('labelwatch', 'json'), now);
  const rules = envx.data;
  const dests = liftEnvelope(await env.EDITS.get('labeldest', 'json'), now).data;
  const keys = Object.keys(rules).filter((k) => {
    const r = rules[k];
    if (!r || !r.enabled) return false;
    if (onlyFeedKey && lgKey(r.client, r.mkt) !== onlyFeedKey) return false;
    if (mode && (r.sched || 'hourly') !== mode) return false;
    return true;
  }).sort();
  if (!keys.length) return { ok: true, checked: 0, fired: 0, suspects: 0, results: [] };
  const MAXRULES = 10;
  let start = 0;
  if (keys.length > MAXRULES && !onlyFeedKey) {
    const cur = (await env.EDITS.get('labelwatchcur', 'json')) || { i: 0 };
    start = (((cur.i | 0) % keys.length) + keys.length) % keys.length;
    await env.EDITS.put('labelwatchcur', JSON.stringify({ i: (start + MAXRULES) % keys.length }));
  }
  let checked = 0, fired = 0, suspects = 0;
  const results = [], srcCache = {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < Math.min(MAXRULES, keys.length); i++) {
    const key = keys[(start + i) % keys.length];
    const rule = rules[key];
    try {
      const fk = lgKey(rule.client, rule.mkt);
      if (!(fk in srcCache)) srcCache[fk] = await feedSourceFor(env, rule.client, rule.mkt);
      const src = srcCache[fk];
      if (!src || src.xml) { rule.lastRun = now; rule.lastErr = src ? 'XML feed - not gviz-queryable' : 'no feed wired'; results.push({ key, error: rule.lastErr }); continue; }
      if (i > 0) await sleep(500);   // stagger — burst-querying gviz is what draws throttled garbage
      const fetchLive = () => rule.vs
        ? crossFeed(fetch, src, rule.label, rule.value, rule.vs)
        : labelPivot(fetch, src, rule.label);
      let live = await fetchLive();
      // impossible-answer guard: "the segment counts thousands of SKUs but has zero values"
      // is self-contradictory — re-query once after a pause; still contradictory = SKIP the
      // check with a diagnostic rather than let garbage confirm an alert (see labelguard.js)
      if (isImplausible(rule, live)) {
        await sleep(10000);
        live = await fetchLive();
        if (isImplausible(rule, live)) {
          rule.lastRun = now;
          rule.lastErr = 'gviz answered segment>0 with an empty pivot twice — check skipped (likely throttling)';
          envx.meta[key] = { t: now };
          await logAlertActivity(env, rule.client + ' ' + rule.mkt + ' · check skipped: implausible gviz response');
          results.push({ key, skipped: 'implausible gviz response — not evaluated' });
          continue;
        }
      }
      const ev = evalWatch(rule, live, now);
      rule.state = ev.state; rule.lastRun = now; rule.lastErr = '';
      checked++; suspects += ev.suspects || 0;
      if (ev.fires.length) {
        fired += ev.fires.filter((f) => f.kind !== 'recovered').length;
        const link = 'https://feedspark.ray-vtt.workers.dev/labels#' + encodeURIComponent(fk);
        // ONE digest per rule per check (alert + recovery messages at most), never per value
        const msgs = alertDigest(rule, ev.fires, { link });
        for (const dId of (rule.dests || [])) {
          const dest = dests[dId]; if (!dest) continue;
          for (const m of msgs) {
            const isAlert = m.indexOf('HIGH PRIORITY') >= 0;
            await sendPing(env, dest, (isAlert && dest.mention) ? dest.mention + ' ' + m : m);
          }
        }
        await logAlertActivity(env, rule.client + ' ' + rule.mkt + ' · ' +
          ev.fires.map((f) => f.kind + ':' + String(f.value).slice(0, 20)).join(', ').slice(0, 70));
        ev.fires.forEach((f) => results.push({ key, fire: f.kind, value: f.value, was: f.was, now: f.now }));
      }
      if (ev.suspects) results.push({ key, suspect: ev.suspects, note: 'first sighting — confirms or clears on the next check' });
      envx.meta[key] = { t: now };
    } catch (e) {
      rule.lastRun = now; rule.lastErr = String((e && e.message) || e).slice(0, 120);
      envx.meta[key] = { t: now };
      results.push({ key, error: rule.lastErr });
    }
  }
  await env.EDITS.put('labelwatch', JSON.stringify(envx));
  return { ok: true, checked, fired, suspects, results: results.slice(0, 30) };
}

// assemble the status report from the KV stores and queue it as an email through the
// Gmail bridge outbox. Scheduled daily after the 07:00 GMT watch pass (17:00 optional,
// KV labelreportcfg) — so the report always reflects a fresh check — or on demand.
async function queueLabelReport(env, why) {
  try {
    const now = Date.now();
    const cfg = (await env.EDITS.get('labelreportcfg', 'json')) || {};
    const to = String(cfg.to || env.OWNER_EMAIL || 'ray@feedspark.com');
    const rules = liftEnvelope(await env.EDITS.get('labelwatch', 'json'), now).data;
    const dests = liftEnvelope(await env.EDITS.get('labeldest', 'json'), now).data;
    const idx = (await env.EDITS.get('labelidx', 'json')) || {};
    const alerts = (await env.EDITS.get('labelalerts', 'json')) || {};
    const ptAlerts = (await env.EDITS.get('ptypealerts', 'json')) || {};
    const grAlerts = (await env.EDITS.get('goldenalerts', 'json')) || {};
    const body = buildReport({ rules, dests, idx, alerts, ptAlerts, grAlerts, now, link: 'https://feedspark.ray-vtt.workers.dev/labels' });
    let downN = 0;
    Object.keys(rules).forEach((k) => { const st = (rules[k] || {}).state || {};
      Object.keys(st).forEach((v) => { if (st[v] && st[v].st === 'fired') downN++; }); });
    const subject = 'Label Guard report — ' + (downN ? '🔴 ' + downN + ' watched value(s) DOWN' : '✅ all watches OK') +
      ' · ' + new Date(now).toUTCString().slice(0, 16);
    const ob = (await env.EDITS.get('labeloutbox', 'json')) || [];
    ob.push({ id: 'ob_' + now.toString(36) + Math.random().toString(36).slice(2, 6), to, subject, body, t: now });
    await env.EDITS.put('labeloutbox', JSON.stringify(ob.slice(-50)));
    await logAlertActivity(env, 'report queued (' + why + ') → ' + to);
    return { ok: true, queued: true, to, note: 'report queued — the Gmail bridge sends within ~5 min' + (env.GMAIL_PUSH_KEY ? '' : ' (GMAIL_PUSH_KEY not set: bridge inactive)') };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 140) }; }
}

// ---- due-today task reminders (12:00 GMT cron + /api/tasks/remind) ----------------------
// Builds one email per owner (ray/steven — OWNER_EMAILS in taskremind.js) listing plan tasks
// due TODAY whose status is still in the Open bucket, and queues them into the SAME Gmail
// outbox Label Guard uses (the Apps Script bridge sends from Ray's own mailbox). Once per
// UTC day (KV taskremday); outbox ids are day-scoped so a re-queue can never double-send.
async function queueDueReminders(env, opts) {
  opts = opts || {};
  const now = Date.now();
  const day = remDay(now);
  if (!opts.force && !opts.dry) {
    const done = await env.EDITS.get('taskremday');
    if (done === day) return { ok: true, skipped: 'already ran today' };
  }
  const sheets = (await env.EDITS.get('plansheets', 'json')) || {};
  const byId = {};   // brands sharing a sheet share its rows — group per sheet so nothing mails twice
  Object.keys(sheets).forEach((b) => { const id = sheets[b]; if (id) (byId[id] = byId[id] || []).push(b); });
  const groups = [];
  for (const id of Object.keys(byId)) {
    let tasks = opts.tasksById && opts.tasksById[id];
    if (!tasks) { const cached = await env.EDITS.get('planlive:' + id, 'json'); tasks = (cached && cached.tasks) || null; }
    if (!tasks) continue;
    const bs = byId[id];
    groups.push({ brands: bs.slice(0, 2).join(' / ') + (bs.length > 2 ? ' +' + (bs.length - 2) : ''), tasks });
  }
  const mails = buildDueReminders(groups, { now });
  if (opts.dry) return { ok: true, dry: true, day, groups: groups.length, mails };
  let queued = 0;
  if (mails.length) {
    const ob = (await env.EDITS.get('labeloutbox', 'json')) || [];
    const have = {}; ob.forEach((e) => { if (e && e.id) have[e.id] = 1; });
    mails.forEach((m) => { if (!have[m.id]) { ob.push({ id: m.id, to: m.to, subject: m.subject, body: m.body, t: now, sig: '— FeedSpark Workflow (automated 12:00 GMT task reminder)' }); queued++; } });
    if (queued) await env.EDITS.put('labeloutbox', JSON.stringify(ob.slice(-50)));
  }
  await env.EDITS.put('taskremday', day);
  await logAlertActivity(env, 'due-today reminders: ' + (mails.length ? mails.map((m) => m.owner + '×' + m.n).join(' · ') : 'none due'));
  return { ok: true, day, queued, mails: mails.map((m) => ({ to: m.to, n: m.n })) };
}

// hourly rotation: BATCH feeds per firing keeps the combined cron (plan warm + this sweep)
// far under the free-plan 50-subrequest budget (each feed scan ≤7 gviz fetches); the 22-feed
// estate is re-checked every ~6 hours, hours ahead of a PMAX crater
async function labelCronSweep(env) {
  try {
    // sheet-backed feeds only — XML (Meta) feeds can't be gviz-queried, and a rotation
    // slot spent erroring on one would starve a real sheet's check
    const roster = (await feedRoster(env)).filter((f) => f.src && f.src.id);
    if (!roster.length) return;
    const BATCH = 4;
    const st = (await env.EDITS.get('labelcron', 'json')) || { i: 0 };
    const start = (((st.i | 0) % roster.length) + roster.length) % roster.length;
    for (let k = 0; k < BATCH && k < roster.length; k++) {
      const f = roster[(start + k) % roster.length];
      try { await runLabelScan(env, f.client, f.mkt); } catch (e) {}
    }
    st.i = (start + Math.min(BATCH, roster.length)) % roster.length;
    await env.EDITS.put('labelcron', JSON.stringify(st));
  } catch (e) {}
}

// ---- Google service-account auth: sign a JWT with the SA private key, impersonate the
// GOOGLE_IMPERSONATE user (domain-wide delegation), exchange it for a scoped access token.
// All WebCrypto — no external deps. Throws if GOOGLE_SA_JSON isn't set / the grant fails.
function b64urlBuf(buf) {
  let s = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) { return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function colLetter(n) { let s = ''; n = n + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

// ---- shared Project-Plan parsing (used by live-sync + 2-way writes) ----
// Plan sheets vary: some carry a leading task-number column, so the header row sits one
// column left of its data. We anchor on the Status header, then VOTE header-col vs col+1 by
// how many rows carry a status token — that vote yields a single `offset` that applies to
// EVERY column (the whole data row is shifted uniformly), so owner/task columns realign too.
const STATUS_TOK = ['open', 'done', 'on hold', 'on-hold', 'onhold', 'in progress', 'in-progress', 'wip', 'with client', 'parked', 'completed', 'complete', 'live', 'not started', 'to do', 'todo', 'blocked', 'ongoing', 'in review'];
function normCell(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
// Every 2-way sheet-cell endpoint (status/owner/due/task-rename) finds its row the same way:
// substring-match the FCC task text against every cell, first hit wins. A short value shared
// across many rows (a project code like "SVS-Q3/26" tagging a dozen different tasks on the
// same sheet) satisfies that predicate on ALL of them — taking the first uncritically writes
// to the wrong task (Reiss: a due-date edit for row 544 landed on row 538, the first row
// carrying the same shared code). The culprit is the reverse half of the predicate (cell
// contained IN the task text), so a row whose cell actually CONTAINS the task text wins
// outright; only if that still leaves several do we fall back to an exact cell match, and
// failing that report the ambiguity rather than guess — the same "never guess" rule already
// applied to tab resolution.
function findTaskRow(rows, match) {
  const key = normCell(match).slice(0, 45);
  if (key.length < 4) return { row: -1, ambiguous: false, count: 0 };
  const strong = [], weak = [];
  for (let r = 0; r < rows.length; r++) {
    let s = false, w = false;
    for (const c of rows[r] || []) {
      const cn = normCell(c);
      if (cn.length <= 8) continue;
      if (cn.indexOf(key) >= 0) { s = true; break; }
      if (key.length > 12 && key.indexOf(cn.slice(0, 45)) >= 0) w = true;
    }
    if (s) strong.push(r); else if (w) weak.push(r);
  }
  const hits = strong.length ? strong : weak;
  if (!hits.length) return { row: -1, ambiguous: false, count: 0 };
  if (hits.length === 1) return { row: hits[0], ambiguous: false, count: 1 };
  const mkey = normCell(match);
  const exact = hits.filter(r => (rows[r] || []).some(c => normCell(c) === mkey));
  if (exact.length === 1) return { row: exact[0], ambiguous: false, count: hits.length };
  return { row: hits[0], ambiguous: true, count: hits.length };
}
function ambiguousRow(tab, match, count) { return { ok: false, error: count + ' rows in "' + tab + '" all match "' + String(match).slice(0, 55) + '" — too ambiguous to edit safely (likely a shared code/prefix). Give the task more unique wording, or edit that row directly in the sheet.' }; }
function isStatusTok(v) { return STATUS_TOK.indexOf(normCell(v)) >= 0; }
function planBucket(s) { s = normCell(s);
  if (/(done|complete|finish|live|delivered|actioned|signed)/.test(s)) return 'done';
  if (/(hold|park)/.test(s)) return 'hold';
  if (/brief/.test(s)) return 'briefed';   // mirror the page's bucketOf — Briefed is its own bucket (purple), never open/gray
  if (/(progress|wip|ongoing|review)/.test(s)) return 'progress';
  if (/client/.test(s)) return 'client';
  if (!s) return 'open'; return 'open'; }
function classifyCat(t) { t = String(t || '').toLowerCase();
  if (/\btitle|mask\b/.test(t)) return 'title';
  if (/image|visual|overlay|roundel|cycler|photo/.test(t)) return 'image';
  if (/keyword|search term|kw\b|intent/.test(t)) return 'keyword';
  if (/custom label|\bcl\d|clearance flag|bestseller/.test(t)) return 'custom_label';
  if (/product type|category mapping|taxonom|gpc/.test(t)) return 'product_type';
  if (/a\/b|test|experiment|split test/.test(t)) return 'test';
  if (/feed|technical|migration|refresh|item group|disapprov|rule/.test(t)) return 'technical';
  if (/data field|attribute|back fill|material|gtin/.test(t)) return 'data';
  if (/meta|social|shopping|lia|channel|ppc|dpa|bing/.test(t)) return 'channel';
  if (/call|review|proposal|quote|contract|onboard|invoice|billing|strategy|qbr|access/.test(t)) return 'account';
  return 'opt'; }
// Resolve the header row + the uniform data offset from the Status column.
function resolveCols(rows) {
  let headerRow = -1, statusHdr = -1;
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const idx = (rows[r] || []).findIndex(c => /^(status|task status)$/i.test(String(c || '').trim()));
    if (idx >= 0) { statusHdr = idx; headerRow = r; break; }
  }
  let offset = 0;
  if (statusHdr >= 0) { let a = 0, b = 0;
    for (let r = headerRow + 1; r < Math.min(rows.length, headerRow + 45); r++) { const row = rows[r] || []; if (isStatusTok(row[statusHdr])) a++; if (isStatusTok(row[statusHdr + 1])) b++; }
    if (b > a) offset = 1; }
  // header column for a name/regex, then shifted by the data offset
  const hdr = rows[headerRow] || [];
  const colFor = re => { const i = hdr.findIndex(c => re.test(String(c || '').trim())); return i < 0 ? -1 : i + offset; };
  return { headerRow, offset, statusCol: statusHdr < 0 ? -1 : statusHdr + offset,
    taskCol: colFor(/task|area|activit|description|optimis|action/i),
    ownerCol: colFor(/owner|\bae\b|assignee|responsib|fs\b/i),
    dueCol: colFor(/due|deadline|target date|completion date|^date$/i) };
}
// resolveCols() computes ONE offset from the rows right after the header. Some sheets (Reiss:
// the header + its earliest rows are a 2020-era layout; task rows added since have 2 extra
// leading columns never backfilled onto the old ones) have EARLIER and LATER rows at different
// absolute alignments — a single sheet-wide offset fits one era and silently misses the other,
// so an owner/due write on a newer row lands on a blank or unrelated cell instead of erroring.
// Task/Owner/Due sit at a STABLE offset from Status even when a row's absolute position shifts
// (a uniform rightward insert moves the whole row together) — anchor on this row's own Status
// cell (found the same way /api/sheets/status already self-corrects) and re-derive from there.
function rowCols(row, c) {
  if (c.statusCol < 0 || isStatusTok(row[c.statusCol])) return c;
  let found = -1;
  for (let d = 1; d <= 8 && found < 0; d++) {
    if (isStatusTok(row[c.statusCol + d])) found = c.statusCol + d;
    else if (c.statusCol - d >= 0 && isStatusTok(row[c.statusCol - d])) found = c.statusCol - d;
  }
  if (found < 0) return c;
  const delta = found - c.statusCol;
  return { headerRow: c.headerRow, offset: c.offset, statusCol: found,
    taskCol: c.taskCol >= 0 ? c.taskCol + delta : c.taskCol,
    ownerCol: c.ownerCol >= 0 ? c.ownerCol + delta : c.ownerCol,
    dueCol: c.dueCol >= 0 ? c.dueCol + delta : c.dueCol };
}
// Parse a plan tab's rows into clean task objects for the dashboard.
function monthOf(s) { // detect a "month separator" label like "July-26", "Jun 2026", "Mar 26"
  const m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*['\s\-\/,.]*((?:20)?\d{2})\b/i.exec(String(s || ''));
  if (!m) return '';
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
  let y = +m[2]; if (y < 100) y += 2000;
  return y + '-' + String(mo + 1).padStart(2, '0') + '-01';
}
// a non-white cell fill = a section separator (blue/grey header), NOT a task (Ray's rule)
function isFilled(rgb) { return !!rgb && Math.min(rgb[0], rgb[1], rgb[2]) < 0.93; }
// Shared by /api/sheets/task (human, via the Workflow grid's inline task-text edit) and
// /api/tasks/ingest's PATCH (a trusted automation retagging rows it appended earlier) — same
// row-match + column-resolution as every other 2-way writer in this file.
async function renamePlanTask(env, id, tab, match, value) {
  try {
    const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
    const realTab = await resolveTab(id, tab, token);
    if (!realTab) return tabAmbiguous(id, tab);
    const rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(realTab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
    const rd = await rr.json(); if (rd.error) return { ok: false, error: rd.error.message };
    const rows = rd.values || [];
    const tr = findTaskRow(rows, match);
    if (tr.row < 0) return { ok: false, error: 'task row not found in ' + realTab, match };
    if (tr.ambiguous) return ambiguousRow(realTab, match, tr.count);
    const targetRow = tr.row;
    const c = rowCols(rows[targetRow], resolveCols(rows));
    const tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
    const cell = realTab + '!' + colLetter(tc) + (targetRow + 1);
    const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(cell) + '?valueInputOption=USER_ENTERED', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values: [[value]] }) });
    const wd = await wr.json(); if (wd.error) return { ok: false, error: permHint(wd.error.message), cell };
    return { ok: true, cell, updated: wd.updatedCells || 1 };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
// Shared by /api/sheets/append (human, via the Workflow's own "+ Add task" row) and
// /api/tasks/ingest (a trusted automation, key-gated) — one write path so both land rows
// identically instead of two implementations quietly drifting apart.
async function appendPlanRows(env, id, tab, rows) {
  try {
    const token = await googleToken(env, 'https://www.googleapis.com/auth/spreadsheets', false);
    let realTab = await resolveTab(id, tab, token);
    if (!realTab) return tabAmbiguous(id, tab);
    let rr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(realTab + '!A1:ZZ5000'), { headers: { Authorization: 'Bearer ' + token } });
    let rd = await rr.json();
    if (rd.error) return { ok: false, error: rd.error.message };
    const grid = rd.values || [];
    const c = resolveCols(grid);
    const tc = c.taskCol >= 0 ? c.taskCol : (c.offset || 0);
    const oc = c.ownerCol, sc = c.statusCol, dc = c.dueCol;
    const width = Math.max(tc, oc, sc, dc, 0) + 1;
    const values = rows.map(r => { const a = new Array(width).fill(''); a[tc] = r.task || ''; if (oc >= 0) a[oc] = r.owner || ''; if (sc >= 0) a[sc] = r.status || 'Open'; if (dc >= 0 && r.due) a[dc] = r.due; return a; });
    // find the LAST row that has any content and write directly below it — the values:append
    // API mis-detects the table on multi-block plan layouts and drops rows at the top.
    let lastRow = 0; for (let r = 0; r < grid.length; r++) { if ((grid[r] || []).some(x => String(x || '').trim() !== '')) lastRow = r; }
    const startRow = lastRow + 2; // 1-based row just after the last content row
    const range = (realTab ? realTab + '!' : '') + 'A' + startRow;
    const wr = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '/values/' + encodeURIComponent(range) + '?valueInputOption=USER_ENTERED', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
    const wd = await wr.json();
    if (wd.error) return { ok: false, error: permHint(wd.error.message) };
    try { await env.EDITS.delete('planlive:' + id); } catch (e) {}
    return { ok: true, appended: values.length, tab: realTab || '(first sheet)', atRow: startRow,
      cols: { task: colLetter(tc), owner: oc >= 0 ? colLetter(oc) : null, status: sc >= 0 ? colLetter(sc) : null, due: dc >= 0 ? colLetter(dc) : null } };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// read a tab's values AND per-cell background colour (needed to tell separators from tasks)
// Writes must land on the tab the reads came from: exact name -> case-insensitive ->
// first tab containing "plan" -> the sheet's first tab (mirrors fetchGrid's read fallback).
async function resolveTab(id, tab, token) {
  try {
    const d = await (await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?fields=sheets.properties.title', { headers: { Authorization: 'Bearer ' + token } })).json();
    const titles = ((d && d.sheets) || []).map(x => x.properties.title);
    if (!titles.length || titles.indexOf(tab) >= 0) return tab;
    const ci = titles.find(t => t.toLowerCase() === String(tab).toLowerCase());
    if (ci) return ci;
    const byPlan = titles.find(t => /plan/i.test(t));
    if (byPlan) return byPlan;
    // Several tabs, none named/keyworded like the one asked for: guessing tab #1 here is how a
    // write can silently land on an unrelated tab nobody looks at (Reiss: a briefed task never
    // appeared in Project Plan because the workbook has more than one plan-shaped tab and this
    // fallback picked blind). Only auto-pick when there is truly no ambiguity — a single tab.
    return titles.length === 1 ? titles[0] : null;
  } catch (e) { return tab; }
}
function tabAmbiguous(id, tab) { return { ok: false, error: 'Could not find a single "' + tab + '"-like tab in this sheet (' + id + ') — it has several tabs and none match by name or contain "plan". Rename the intended tab to include "Plan", or the write risks landing on the wrong one.' }; }
function permHint(m) { return /permission|forbidden/i.test(String(m)) ? (m + ' — the service account can read but not write: open the sheet\u2019s Share dialog and change its access from Viewer to Editor') : m; }
async function fetchGrid(id, tab, token) {
  // includeGridData returns a formatting object PER CELL (not sparse like values.get), so its
  // column width must stay tight: parsePlanRows/resolveCols only ever look within the first ~14
  // columns (Task/Owner/Prio/Status/Due). Widening this call's columns the way the write-path
  // values.get calls safely were (A1:ZZ5000, 702 cols) blew the payload up ~27x on a client whose
  // sheet genuinely has 100+ week-tracking columns (Reiss) — for zero functional benefit, since
  // none of those columns are ever read — and is the likely reason its live sync stopped working
  // right after that change. Rows still get a generous 5x bump (600 → 3000) for real depth.
  const GRID_RANGE = 'A1:Z3000';
  const fields = 'sheets(properties(title),data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))';
  const tryRange = async range => (await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + id + '?ranges=' + encodeURIComponent(range) + '&includeGridData=true&fields=' + encodeURIComponent(fields), { headers: { Authorization: 'Bearer ' + token } })).json();
  let d = await tryRange((tab ? tab + '!' : '') + GRID_RANGE);
  if (d.error && tab) { const best = await resolveTab(id, tab, token); if (best && best !== tab) d = await tryRange(best + '!' + GRID_RANGE); }
  if (d.error && tab) d = await tryRange(GRID_RANGE); // last resort — the first sheet
  if (d.error) return { error: d.error.message };
  const sheet = (d.sheets || [])[0];
  const rowData = (sheet && sheet.data && sheet.data[0] && sheet.data[0].rowData) || [];
  const values = [], bg = [];
  for (const row of rowData) {
    const cells = row.values || [];
    values.push(cells.map(c => (c && c.formattedValue != null) ? String(c.formattedValue) : ''));
    bg.push(cells.map(c => { const b = c && c.effectiveFormat && c.effectiveFormat.backgroundColor; return b ? [b.red || 0, b.green || 0, b.blue || 0] : null; }));
  }
  return { values, bg, title: (sheet && sheet.properties && sheet.properties.title) || '' };
}
function parsePlanRows(values, bg) {
  const c = resolveCols(values), out = [];
  const start = c.headerRow >= 0 ? c.headerRow + 1 : 0;
  const haveBg = Array.isArray(bg) && bg.length > 0;
  let curMonth = ''; // ISO first-of-month of the current month section
  for (let r = start; r < values.length; r++) {
    const row = values[r] || [];
    // some rows sit at a different absolute column alignment than the header (see rowCols) —
    // re-anchor per row so a shifted row's owner/due aren't read from an unrelated cell
    const rc = rowCols(row, c);
    const tcol = rc.taskCol >= 0 ? rc.taskCol : (rc.offset || 0);
    let monthHere = ''; for (let k = 0; k < Math.min(row.length, 6); k++) { monthHere = monthOf(row[k]); if (monthHere) break; }
    // separator = a filled task cell (with formatting), else fall back to a month-labelled statusless row
    const isSep = haveBg ? isFilled(((bg[r]) || [])[tcol]) : (!!monthHere && !row.some(v => isStatusTok(v)));
    if (isSep) { if (monthHere) curMonth = monthHere; continue; }
    // task text: resolved column, else first long non-status/non-date cell
    let task = rc.taskCol >= 0 ? row[rc.taskCol] : '';
    if (!task || String(task).trim().length < 3) {
      for (let k = 0; k < Math.min(row.length, 4); k++) { const v = String(row[k] || '').trim();
        if (v.length > 6 && !isStatusTok(v) && !/^\d/.test(v)) { task = v; break; } }
    }
    task = String(task || '').trim(); if (task.length < 3) continue;
    let status = rc.statusCol >= 0 ? String(row[rc.statusCol] || '').trim() : '';
    if (!isStatusTok(status)) { for (let k = 1; k < Math.min(row.length, 14); k++) { if (isStatusTok(row[k])) { status = String(row[k]).trim(); break; } } }
    const owner = rc.ownerCol >= 0 ? String(row[rc.ownerCol] || '').trim() : '';
    const rawDue = rc.dueCol >= 0 ? String(row[rc.dueCol] || '').trim() : '';
    // date = the row's Due column if the plan has one, else the current month-section
    out.push({ t: task, o: owner, s: status, b: planBucket(status), c: classifyCat(task), d: rawDue || curMonth, row: r + 1 });
  }
  return out;
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
// impersonate=true adds a `sub` (needs domain-wide delegation — Gmail). Omit it for Sheets:
// the service account then acts as itself and can reach any sheet shared with its email —
// no admin / delegation required.
async function googleToken(env, scope, impersonate) {
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  if (impersonate && env.GOOGLE_IMPERSONATE) claim.sub = env.GOOGLE_IMPERSONATE;
  const unsigned = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlBuf(sig);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token ' + (data.error || res.status) + ' ' + (data.error_description || ''));
  return data.access_token;
}

// Injected before </body>. Self-contained editor:
//   - Edit mode: contenteditable text with stable data-eid keys, auto-saved to KV.
//   - Selected-element inspector: "Copy for Claude Code" copies the element's data-eid
//     + outerHTML so Ray can paste it here and ask Claude Code to restructure it.
//   - "Export edits": copies the full KV patch as JSON (for the git / apply_edits.py flow).
// Written with literal unicode chars and no backslash escapes so it stays valid inside
// this template literal.
function getEditorScript(slug) {
  return `
<script>
(function(){
  var API = window.DECK_EDITOR_API || '';
  var PAGE = ${JSON.stringify(slug)};
  var SEL = window.DECK_EDITOR_SELECTOR ||
    'h1,h2,h3,h4,h5,p,li,td,th,blockquote,figcaption,.lede,.sec-sub,.stat,.callout,.card h4,.card p,.note,.pill,.q';
  var editing=false, lastSel=null, dirty={}, saveTimer=null;
  // Broad on purpose — Design mode should be able to target essentially every visible
  // element on a deck (headings, paragraphs, list items, images, chapter dividers, the
  // hero, tables, code blocks), not just a curated set of "card-like" containers. Table
  // rows/cells are deliberately left out of the drag-reorder side of this (they already
  // have their own dedicated row-drag system below) but are still selectable for styling
  // via the plain h1-h5/p/li/td/th text-element entries.
  var DESIGN_SEL='.card,.stat,.pipe-card,.proto,.flow-step,.en-card,.tier,.mo,.sc-cell,.ask,.callout,.note,.ag-row'
    + ',.chapter,header.hero,.pill,.ct,.q,.feedrow,.agent,.agent-l,.agent-r,.eyebrow,.lede,.sec-sub'
    + ',h1,h2,h3,h4,h5,p,li,blockquote,figcaption,img,table,code';
  var blockN={}, groupN={}, groupIds=new WeakMap(), rowN={};
  var FEEDBACK=[], fbN=0;
  // FeedSpark brand palette (CLAUDE.md Design system) + the decks' semantic green (--green,
  // #2E7D32) — the colour the p-done "win" pills already use, so restyling a figure to read as
  // positive matches the existing pills exactly instead of being eyeballed in the colour picker.
  var SWATCHES=['#F5A623','#ED6F0B','#333333','#FFFFFF','#F7F7F5','#2E7D32'];
  function swatchRow(forCls){
    return '<div class="de-swatches" data-for="'+forCls+'">'
      + SWATCHES.map(function(c){ return '<button type="button" class="de-sw" style="background:'+c+'" data-c="'+c+'" title="'+c+'"></button>'; }).join('')
      + '</div>';
  }
  function wireSwatches(root){
    root.querySelectorAll('.de-swatches').forEach(function(row){
      var forCls=row.getAttribute('data-for');
      row.querySelectorAll('.de-sw').forEach(function(btn){
        btn.addEventListener('click',function(){
          var input=root.querySelector('.'+forCls); if(!input) return;
          input.value=btn.getAttribute('data-c');
          input.dispatchEvent(new Event('input',{bubbles:true}));
        });
      });
    });
  }
  function esc(s){ return (s==null?'':''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ---- Save/load integrity ------------------------------------------------------------
  // Cloudflare Access does NOT 401 an unauthenticated request — it answers 200 with the
  // sign-in HTML (the Workers "Restricted" toggle intercepts before Zero Trust; see
  // docs/GOOGLE_SETUP.md). fetch() reports that as success, so without a content-type check
  // a whole editing session can PUT into the void and report nothing wrong. Verify we really
  // got JSON back, and treat anything else as "not saved".
  function deJSON(res){
    if(!res.ok) throw new Error('http-'+res.status);
    var ct=res.headers.get('content-type')||'';
    if(ct.indexOf('application/json')<0) throw new Error('not-json');
    return res.json();
  }
  // Unsaved-work mirror. Every patch is written here BEFORE it goes to the server and only
  // cleared once the server confirms with real JSON — so anything the server never accepted
  // survives a reload and can be replayed instead of being lost.
  var BK_KEY='de-unsaved-'+PAGE;
  function backupLocal(patch){ try{ var cur=JSON.parse(localStorage.getItem(BK_KEY)||'{}');
    Object.keys(patch).forEach(function(k){ cur[k]=patch[k]; });
    localStorage.setItem(BK_KEY, JSON.stringify(cur)); }catch(e){} }
  // Pass the patch that was actually confirmed saved and only those keys are dropped. Clearing
  // the whole mirror on every success loses anything typed WHILE the request was in flight:
  // queueSave has already mirrored it, dirty still holds it, but the mirror gets wiped — so a
  // tab closed in that window loses it with nothing to restore from. No argument = clear all,
  // which is what the explicit Discard button means.
  function clearBackup(patch){ try{
    if(!patch){ localStorage.removeItem(BK_KEY); return; }
    var cur=JSON.parse(localStorage.getItem(BK_KEY)||'{}');
    Object.keys(patch).forEach(function(k){ delete cur[k]; });
    if(Object.keys(cur).length) localStorage.setItem(BK_KEY, JSON.stringify(cur));
    else localStorage.removeItem(BK_KEY);
  }catch(e){} }
  function readBackup(){ try{ return JSON.parse(localStorage.getItem(BK_KEY)||'{}'); }catch(e){ return {}; } }

  var warnEl=document.createElement('div'); warnEl.className='de-warn'; warnEl.hidden=true;
  document.body.appendChild(warnEl);
  // This banner sits at the highest z-index on the page (by design — a save failure has to be
  // impossible to miss) and pins to top:0, exactly where .topbar slides in on scroll. Without an
  // explicit close it had no way to end: e.g. a standalone offline export (no backend to fetch
  // from) always fires the "could not load saved edits" message, permanently covering the topbar
  // and blocking the very Download HTML button someone would use to save their work.
  function showWarn(html){ warnEl.innerHTML=html+'<button class="de-w-x" title="Dismiss" aria-label="Dismiss">&#10005;</button>';
    warnEl.hidden=false; warnEl.querySelector('.de-w-x').onclick=hideWarn; }
  function hideWarn(){ warnEl.hidden=true; }
  var NOT_SAVED='&#9888; <b>NOT SAVED</b> &mdash; the server rejected the save (you are probably signed out of Cloudflare Access). '
    + 'Your changes are kept locally &mdash; <b>sign in again and reload</b>, then click Restore. Do not close this tab.';

  // ---- Undo: snapshot the whole saved-edits object before any mutating action, so Ctrl/Cmd+Z
  // can restore exactly what was there before — covers text edits, style changes, deletes,
  // duplicates and both reorder systems (they all ultimately live in one KV object per page,
  // so "undo" is just "restore the previous version of that object"), not a per-field diff
  // that would need separate logic for every action type.
  var UNDO_KEY='de-undo-'+PAGE, undoing=false;
  // localStorage, not sessionStorage: undo history used to be destroyed by closing the tab,
  // which is precisely when you most want it back. Each snapshot records the template shape
  // it was taken against, so undo can refuse to restore an overlay authored against a
  // different template instead of quietly reintroducing keys that no longer mean anything.
  function loadUndoStack(){ try{ return JSON.parse(localStorage.getItem(UNDO_KEY)||'[]'); }catch(e){ return []; } }
  function saveUndoStack(st){ try{ localStorage.setItem(UNDO_KEY, JSON.stringify(st.slice(-20))); }catch(e){} }
  // Returns the pre-change state it captured, so a call site that needs to read-then-write
  // (duplicateBlock) can reuse it instead of fetching twice. Callers that only mutate via a
  // fresh PUT (saveOrder, deleteBlock, ...) just chain .then() and ignore the value.
  function armUndo(){
    if(undoing) return Promise.resolve(null);
    return fetch(API+'/api/edits?page='+PAGE).then(function(r){ return r.json(); }).then(function(cur){
      cur=cur||{}; var st=loadUndoStack(); st.push({__shape:SHAPE, snap:cur}); saveUndoStack(st); return cur;
    }).catch(function(){ return null; });
  }
  function performUndo(){
    var st=loadUndoStack();
    if(!st.length){ toast('Nothing to undo'); return; }
    var top=st.pop(); saveUndoStack(st);
    // Older entries were bare snapshots; newer ones are {__shape, snap}.
    var snap = (top && top.snap!==undefined) ? top.snap : top;
    if(top && top.__shape && SHAPE && top.__shape!==SHAPE){
      toast('Undo skipped — the template changed since that step');
      showWarn('&#9888; <b>Undo stopped.</b> That step was recorded against a different version of '
        + 'the deck template, so replaying it could put your edits back on the wrong elements. '
        + 'The step was discarded; nothing was changed.');
      return;
    }
    undoing=true; toast('Undoing…');
    // Single atomic replace — the old DELETE-then-PUT could wipe everything if the PUT failed.
    fetch(API+'/api/edits?page='+PAGE+'&replace=1',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(snap)})
      .then(deJSON)
      .then(function(){ location.reload(); })
      .catch(function(){ undoing=false; toast('Undo failed — nothing was changed'); });
  }
  document.addEventListener('keydown',function(e){
    if(!((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase()==='z')) return;
    var ae=document.activeElement;
    var typing = ae && (ae.isContentEditable || /^(INPUT|TEXTAREA)$/.test(ae.tagName));
    if(typing) return; // let the browser's own per-field undo handle in-progress typing
    e.preventDefault(); performUndo();
  });
  // PowerPoint/Canva-style block shortcuts, all design-mode-only and skipped while typing
  // in a text field: Ctrl/Cmd+C copies the selected block(s) into an in-memory clipboard;
  // Ctrl/Cmd+V pastes them right after whatever block is selected at paste time — so you can
  // select a block near your target and paste there, complementing the Alt+drag copy in
  // initBlockDrag(). Delete/Backspace deletes the selection, Escape clears it, and
  // Up/Down reorders a single selected block among its siblings (the flow-layout analog of
  // "bring forward/backward" — this deck doesn't use absolute z-index positioning).
  var deClipboard=null;
  document.addEventListener('keydown',function(e){
    if(!document.body.classList.contains('de-design')) return;
    var ae=document.activeElement;
    if(ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
    if((e.ctrlKey||e.metaKey) && !e.shiftKey){
      var k=e.key.toLowerCase();
      if(k==='c'){ if(!selEls.size) return; deClipboard=Array.from(selEls).map(function(el){ return el.outerHTML; });
        toast(deClipboard.length+' block'+(deClipboard.length>1?'s':'')+' copied'); return; }
      if(k==='v'){ if(!deClipboard||!deClipboard.length) return; e.preventDefault(); pasteClipboard(); return; }
      return;
    }
    if(!selEls.size) return;
    if(e.key==='Escape'){ clearSelection(); return; }
    if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); deleteSelection(); return; }
    if((e.key==='ArrowUp'||e.key==='ArrowDown') && selEls.size===1){
      e.preventDefault(); reorderBlock(Array.from(selEls)[0], e.key==='ArrowUp'?-1:1); return;
    }
  });

  var css = 'body.de-on [data-eid]{outline:1px dashed rgba(237,111,11,.55);outline-offset:2px}'
    + 'body.de-on [data-eid]:focus{outline:2px solid #ED6F0B;outline-offset:2px}'
    + 'body.de-on [data-eid].de-pick{outline:2px solid #1A365D;outline-offset:2px}'
    + '.de-bar{position:fixed;right:16px;bottom:84px;z-index:99999;display:none;gap:8px;align-items:center;font:14px/1.2 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.de-bar.de-show{display:flex}'
    + '.de-handle{position:fixed;right:16px;bottom:84px;z-index:99998;width:34px;height:34px;border-radius:50%;background:rgba(26,54,93,.35);color:#fff;border:0;cursor:pointer;font-size:15px;opacity:.55;transition:opacity .2s,background .2s}'
    + '.de-handle:hover{opacity:1;background:#1A365D}'
    + '.de-bar.de-show + .de-handle{display:none}'
    + '.de-bar button{background:#1A365D;color:#fff;border:0;border-radius:8px;padding:9px 13px;cursor:pointer;font:inherit}'
    + '.de-bar button.on{background:#ED6F0B}'
    + '.de-bar span{color:#6b7a8d;min-width:60px}'
    // Save/load failure banner. Deliberately NOT inside .de-bar and NOT hidden by Present mode:
    // the old "save failed" text lived in the toolbar, so presenting hid the one signal that
    // your edits were not reaching the server.
    + '.de-warn{position:fixed;top:0;left:0;right:0;z-index:100000;background:#C0392B;color:#fff;font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 16px;box-shadow:0 2px 12px rgba(0,0,0,.25);text-align:center}'
    + '.de-warn[hidden]{display:none}'
    + '.de-warn button{margin-left:8px;background:#fff;color:#C0392B;border:0;border-radius:6px;padding:5px 11px;font:inherit;font-weight:800;cursor:pointer}'
    + '.de-w-x{position:absolute;right:10px;top:50%;transform:translateY(-50%);margin-left:0!important;padding:2px 9px!important;background:rgba(255,255,255,.25)!important;color:#fff!important}'
    + '.de-warn button:hover{background:#FFE9E5}'
    // Present mode: mostly the chrome the print stylesheet already hides (topbar, editor UI),
    // live on-screen and toggle-able — for screen-sharing the deck without Ray's own tooling in
    // shot. .side-nav is the one exception: kept visible on purpose (Ray's ask) so viewers can
    // still see which chapter they're on and jump around — it already highlights the current
    // section on scroll on its own, no extra wiring needed here. .de-handle stays visible (very
    // dim) so there's always a way back in.
    + 'body.de-present .topbar,body.de-present .footmark,body.de-present .scrollcue,body.de-present .progress,body.de-present .de-bar,body.de-present .de-panel,body.de-present .de-props,body.de-present .de-toast,body.de-present .de-resize,body.de-present .de-warn,body.de-present [id^="tky-"]{display:none!important}'
    // .de-bar.de-show + .de-handle{display:none} (above) would otherwise hide this escape
    // hatch whenever Present was entered while the toolbar was already open — force it back.
    + 'body.de-present .de-handle{display:block!important;opacity:.18}'
    + 'body.de-present .de-handle:hover{opacity:1}'
    + '.de-panel{position:fixed;right:16px;bottom:66px;z-index:99999;width:380px;max-width:92vw;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:14px;display:none;font:14px/1.4 sans-serif;color:#333}'
    + '.de-panel.show{display:block}'
    + '.de-panel code{background:#F5F5F5;border-radius:4px;padding:1px 5px}'
    + '.de-panel .row{display:flex;gap:8px;margin-top:10px}'
    + '.de-panel .row button{flex:1;background:#ED6F0B;color:#fff;border:0;border-radius:8px;padding:9px 12px;cursor:pointer}'
    + '.de-panel .row button.alt{background:#1A365D}'
    + '.de-panel small{color:#6b7a8d}'
    + '.de-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:22px;background:#1A365D;color:#fff;padding:9px 15px;border-radius:8px;z-index:99999;opacity:0;transition:opacity .25s;font:14px sans-serif}'
    + '.de-toast.show{opacity:1}'
    + '.tbl-wrap tbody tr>:first-child{cursor:grab}'
    + '.tbl-wrap tbody tr.de-dragging{opacity:.35}'
    + 'body.de-design [data-de-block]{outline:1px dashed rgba(26,54,93,.35);outline-offset:2px;cursor:grab}'
    + 'body.de-design [data-de-block]:hover{outline:2px solid rgba(26,54,93,.6)}'
    + 'body.de-design [data-de-block].de-bsel{outline:2px solid #ED6F0B;cursor:default}'
    + 'body.de-design [data-de-block].de-bdrag{opacity:.35}'
    + '.de-resize{position:absolute;z-index:99998;width:14px;height:14px;background:#ED6F0B;border:2px solid #fff;border-radius:50%;cursor:nwse-resize}'
    + '.de-props{position:fixed;top:80px;right:16px;bottom:16px;z-index:99998;width:280px;max-width:88vw;overflow-y:auto;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.2);display:none;font:13px sans-serif;color:#333}'
    + '.de-props.show{display:block}'
    + '.de-props .ph{padding:12px 14px;border-bottom:1px solid #E6E6E6;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#fff;z-index:1}'
    + '.de-props .ph .tag{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#ED6F0B;background:rgba(237,111,11,.1);padding:3px 8px;border-radius:20px;font-weight:800}'
    + '.de-props .pclose{cursor:pointer;color:#999;font-size:16px;background:none;border:0;line-height:1}'
    + '.de-props section{padding:12px 14px;border-bottom:1px solid #F0F0F0}'
    + '.de-props section h5{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7a8d;margin-bottom:8px;font-weight:800}'
    + '.de-props .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.de-props label{display:block;font-size:10.5px;color:#6b7a8d;margin-bottom:3px}'
    + '.de-props input[type=number],.de-props select{width:100%;font:inherit;padding:6px 8px;border:1px solid #E6E6E6;border-radius:6px;box-sizing:border-box}'
    + '.de-props input[type=color]{width:100%;height:30px;border:1px solid #E6E6E6;border-radius:6px;padding:2px;cursor:pointer;box-sizing:border-box}'
    + '.de-props .de-swatches{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}'
    + '.de-props .de-sw{width:20px;height:20px;border-radius:5px;border:1px solid rgba(0,0,0,.15);cursor:pointer;padding:0;flex-shrink:0}'
    + '.de-props .de-sw:hover{transform:scale(1.15);box-shadow:0 0 0 2px rgba(0,0,0,.08)}'
    + '.de-props .stepper{display:flex;align-items:stretch}'
    + '.de-props .stepper input{border-radius:0;text-align:center;flex:1;min-width:0}'
    + '.de-props .stepper button{width:26px;flex-shrink:0;border:1px solid #E6E6E6;background:#F7F7F5;cursor:pointer;font:inherit;font-weight:700;color:#333}'
    + '.de-props .stepper .p-fs-dn{border-radius:6px 0 0 6px;border-right:0}'
    + '.de-props .stepper .p-fs-up{border-radius:0 6px 6px 0;border-left:0}'
    + '.de-props .chk-row{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-2,#333);cursor:pointer}'
    + '.de-props .chk-row input{margin:0;cursor:pointer}'
    + '.de-props .actions .cpstyle,.de-props .actions .pstyle{background:#EEE;color:#333}'
    + '.de-props .actions button[disabled]{opacity:.4;cursor:not-allowed}'
    + '.de-ctxmenu{position:fixed;z-index:100000;background:#fff;border:1px solid #E6E6E6;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:4px;display:none;min-width:150px;font:13px/1.3 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.de-ctxmenu.show{display:block}'
    + '.de-ctxmenu button{display:flex;width:100%;text-align:left;padding:7px 10px;border:0;background:none;cursor:pointer;border-radius:5px;font:inherit;color:#333}'
    + '.de-ctxmenu button:hover{background:#F7F7F5}'
    + '.de-ctxmenu button[disabled]{opacity:.4;cursor:not-allowed}'
    + '.de-ctxmenu hr{border:0;border-top:1px solid #F0F0F0;margin:4px 0}'
    + '.de-props input[type=range]{width:100%;margin-top:6px}'
    + '.de-props .btnrow{display:flex;gap:6px}'
    + '.de-props .btnrow button{flex:1;border:1px solid #E6E6E6;background:#fff;border-radius:6px;padding:7px;cursor:pointer;font:inherit}'
    + '.de-props .btnrow button.on{background:#1A365D;color:#fff;border-color:#1A365D}'
    + '.de-props .actions{padding:12px 14px;display:flex;gap:8px}'
    + '.de-props .actions button{flex:1;border:0;border-radius:8px;padding:9px;cursor:pointer;font:inherit;font-weight:700}'
    + '.de-props .actions .dup{background:#EEE;color:#333}.de-props .actions .rst{background:#EEE;color:#333}'
    + '.de-props .actions .del{background:#FDE8E8;color:#C0392B}'
    + '.de-rtbar{position:absolute;z-index:99998;display:flex;gap:2px;background:#1A365D;border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,.25)}'
    + '.de-rtbar button{background:transparent;border:0;color:#fff;width:26px;height:26px;border-radius:5px;cursor:pointer;font-size:13px;line-height:1}'
    + '.de-rtbar button:hover,.de-rtbar button.on{background:rgba(255,255,255,.22)}'
    + '.de-rtbar button.b{font-weight:900}.de-rtbar button.i{font-style:italic}.de-rtbar button.u{text-decoration:underline}'
    + 'body.de-feedback [data-de-block],body.de-feedback .chapter,body.de-feedback header.hero{outline:1px dashed rgba(237,111,11,.4);outline-offset:2px;cursor:copy}'
    + 'body.de-feedback [data-de-block]:hover,body.de-feedback .chapter:hover,body.de-feedback header.hero:hover{outline:2px solid #ED6F0B}'
    + '.de-fbmark{position:absolute;width:18px;height:18px;background:#ED6F0B;color:#fff;border-radius:50%;font-size:10px;display:flex;align-items:center;justify-content:center;z-index:99997;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.3)}'
    + '.de-fbnote{position:absolute;z-index:99999;background:#fff;border:1px solid #E6E6E6;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:10px;width:260px;font:13px sans-serif;color:#333}'
    + '.de-fbnote textarea{width:100%;min-height:70px;font:inherit;border:1px solid #E6E6E6;border-radius:6px;padding:6px;resize:vertical;box-sizing:border-box}'
    + '.de-fbnote .row{display:flex;gap:6px;margin-top:8px}'
    + '.de-fbnote .row button{flex:1;border:0;border-radius:6px;padding:7px;cursor:pointer;font:inherit}'
    + '.de-fbnote .save{background:#ED6F0B;color:#fff}.de-fbnote .cancel{background:#EEE;color:#333}'
    + '.de-fbpanel{position:fixed;right:16px;bottom:136px;z-index:99999;width:360px;max-width:92vw;max-height:66vh;overflow-y:auto;background:#fff;border:1px solid #E6E6E6;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.18);padding:14px;display:none;font:13px/1.4 sans-serif;color:#333}'
    + '.de-fbpanel.show{display:block}'
    + '.de-fbpanel h3{font-size:13px;margin-bottom:4px}'
    + '.de-fbpanel .hint{font-size:11.5px;color:#6b7a8d;margin-bottom:10px}'
    + '.de-fbitem{border:1px solid #E6E6E6;border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:12.5px;position:relative}'
    + '.de-fbitem b{display:block;font-size:10.5px;color:#ED6F0B;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}'
    + '.de-fbitem .del{position:absolute;top:6px;right:8px;cursor:pointer;color:#999;font-size:14px;line-height:1}'
    + '.de-fbitem .by{display:inline-block;font-size:10px;font-weight:800;color:#8a94a0;background:#F7F7F5;border-radius:100px;padding:1px 7px;margin:0 6px 5px 0}'
    + '.de-fbpanel .row{display:flex;gap:8px;margin-top:6px}'
    + '.de-fbpanel .row button{flex:1;border:0;border-radius:8px;padding:9px 12px;cursor:pointer;font:inherit;font-weight:700}'
    + '.de-fbpanel .gen{background:#ED6F0B;color:#fff}.de-fbpanel .clr{background:#EEE;color:#333}'
    + '.de-fbempty{color:#6b7a8d;font-size:12.5px;padding:10px 0}';
  var st=document.createElement('style'); st.id='fs-editor-css'; st.textContent=css; document.head.appendChild(st);

  var bar=document.createElement('div'); bar.className='de-bar';
  var bEdit=document.createElement('button'); bEdit.textContent='✎ Edit';
  var bDesign=document.createElement('button'); bDesign.textContent='🎨 Design';
  var bFeedback=document.createElement('button'); bFeedback.textContent='💬 Feedback';
  var bPresent=document.createElement('button'); bPresent.textContent='🖥 Present'; bPresent.title='Hide the topbar and this editor — clean for screen-share, keeps the chapter side-nav (Ctrl/Cmd+Shift+P, or click the dim dot to exit)';
  var bUndo=document.createElement('button'); bUndo.textContent='↺ Undo'; bUndo.title='Undo the last change (Ctrl/Cmd+Z)';
  var bPick=document.createElement('button'); bPick.textContent='◎ Element'; bPick.style.display='none';
  var bExport=document.createElement('button'); bExport.textContent='⤴ Export edits'; bExport.style.display='none';
  var bReset=document.createElement('button'); bReset.textContent='🧹 Reset page'; bReset.title='Clear every saved edit on this page, back to the git template';
  var stat=document.createElement('span'); stat.textContent='';
  bar.appendChild(bEdit); bar.appendChild(bDesign); bar.appendChild(bFeedback); bar.appendChild(bPresent); bar.appendChild(bUndo); bar.appendChild(bPick); bar.appendChild(bExport); bar.appendChild(bReset); bar.appendChild(stat);
  // Ray: the toolbar reads as permanent clutter once revealed — give it a visible way DOWN.
  var bHide=document.createElement('button'); bHide.className='de-collapse'; bHide.textContent='⌄'; bHide.title='Collapse the editor toolbar — the ✎ dot brings it back (Ctrl/Cmd+Shift+E)'; bHide.style.padding='9px 11px';
  bar.appendChild(bHide);
  bHide.addEventListener('click',function(){ showBar(false); });
  document.body.appendChild(bar);
  // Always-visible, deliberately subtle — presentation mode hides the full bar, but there
  // must always be *something* on screen to click, or the toolbar is undiscoverable unless
  // you already know the ?edit param or the keyboard shortcut.
  var handle=document.createElement('button'); handle.className='de-handle'; handle.title='Open editor'; handle.textContent='✎';
  document.body.appendChild(handle);
  handle.addEventListener('click',function(){ if(document.body.classList.contains('de-present'))setPresent(false); showBar(true); });

  // Presentation mode: the editor bar is hidden by default (clean for client screen-share)
  // and only appears once revealed — via ?edit in the URL or the Ctrl/Cmd+Shift+E shortcut.
  // The reveal choice is remembered per-browser so Ray doesn't have to re-toggle every load.
  var LS_KEY='de-bar-shown';
  function showBar(on){ bar.classList.toggle('de-show',on); try{ localStorage.setItem(LS_KEY, on?'1':'0'); }catch(e){} if(!on && editing) setEditing(false); }
  var RAW = /[?&]raw(=1)?(&|$)/.test(location.search);
  var wantsShown = /[?&]edit(=1)?(&|$)/.test(location.search);
  var remembered = null; try{ remembered = localStorage.getItem(LS_KEY); }catch(e){}
  showBar(wantsShown || remembered==='1');
  document.addEventListener('keydown',function(e){
    if(e.key.toLowerCase()==='e' && (e.ctrlKey||e.metaKey) && e.shiftKey){ e.preventDefault(); showBar(!bar.classList.contains('de-show')); }
    if(e.key.toLowerCase()==='p' && (e.ctrlKey||e.metaKey) && e.shiftKey){ e.preventDefault(); setPresent(!document.body.classList.contains('de-present')); } });

  var panel=document.createElement('div'); panel.className='de-panel';
  panel.innerHTML='<strong>Send an element to Claude Code</strong>'
    + '<div style="margin-top:6px"><small class="de-target">Click any element on the page to select it.</small></div>'
    + '<div class="row"><button class="de-copy">Copy for Claude Code</button><button class="alt de-copysel">Copy data-eid</button></div>'
    + '<div style="margin-top:10px"><small>Paste it into the Claude Code chat and say what to change (resize, recolour, add an image, restructure). Claude edits the template; your text edits stay put.</small></div>';
  document.body.appendChild(panel);
  var tgt=panel.querySelector('.de-target');

  var fbPanel=document.createElement('div'); fbPanel.className='de-fbpanel';
  document.body.appendChild(fbPanel);

  var propsPanel=document.createElement('div'); propsPanel.className='de-props';
  document.body.appendChild(propsPanel);

  var ctxMenu=document.createElement('div'); ctxMenu.className='de-ctxmenu';
  document.body.appendChild(ctxMenu);
  function hideCtxMenu(){ ctxMenu.classList.remove('show'); }
  document.addEventListener('click',hideCtxMenu);
  document.addEventListener('scroll',hideCtxMenu,true);
  function showCtxMenu(x,y,el){
    var n=selEls.size;
    ctxMenu.innerHTML =
      '<button class="cm-copy">⧉ Copy'+(n>1?' ('+n+')':'')+'</button>'
      + '<button class="cm-dup">⧉ Duplicate'+(n>1?' all':'')+'</button>'
      + '<button class="cm-paste"'+(deClipboard&&deClipboard.length?'':' disabled')+'>📋 Paste</button>'
      + '<hr>'
      + '<button class="cm-del">🗑 Delete'+(n>1?' ('+n+')':'')+'</button>';
    ctxMenu.style.left=x+'px'; ctxMenu.style.top=y+'px'; ctxMenu.classList.add('show');
    ctxMenu.querySelector('.cm-copy').addEventListener('click',function(){
      deClipboard=Array.from(selEls).map(function(e2){ return e2.outerHTML; });
      toast(deClipboard.length+' block'+(deClipboard.length>1?'s':'')+' copied');
    });
    ctxMenu.querySelector('.cm-dup').addEventListener('click',function(){ n>1?duplicateSelection():duplicateBlock(el); });
    var pasteBtn=ctxMenu.querySelector('.cm-paste');
    if(!pasteBtn.disabled) pasteBtn.addEventListener('click',pasteClipboard);
    ctxMenu.querySelector('.cm-del').addEventListener('click',function(){ n>1?deleteSelection():deleteBlock(el); });
  }

  function toast(m){ var t=document.createElement('div'); t.className='de-toast'; t.textContent=m; document.body.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },300); },2000); }
  function copy(text,msg){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){ toast(msg); }); }
    else { var a=document.createElement('textarea'); a.value=text; document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); toast(msg); }catch(e){} a.remove(); } }

  function editable(){ return Array.prototype.slice.call(document.querySelectorAll(SEL)).filter(function(el){
    return !el.closest('.de-bar') && !el.closest('.de-panel') && el.textContent.trim().length>0; }); }

  // Chapter-scoped id assignment. A pure global "Nth element in document order" counter
  // (the original scheme) looks deterministic, but isn't: editing chapter 3 to add a card
  // shifts the index of every element in chapters 4-14, so a saved KV edit like "e214: {...}"
  // silently re-lands on a completely different, unrelated element after the next template
  // push — a stale style edit becomes a rogue margin on some other box, a stale text edit
  // becomes text in a location that never asked for it, a stale delete tombstone removes
  // the wrong heading. Scoping every counter to the nearest preceding chapter id (c1, c2, ...)
  // means a structural change in one chapter can only ever shift ids *within that same
  // chapter* — every other chapter's saved edits keep lining up across template pushes. A
  // key that no longer matches any element is simply skipped on load (see loadEdits), not
  // misapplied, so this also self-heals edits that were already corrupted by the old scheme.
  var CHAPTERS = Array.prototype.slice.call(document.querySelectorAll('.chapter[id]'));
  function chapterKeyFor(el){
    var found='top';
    for(var i=0;i<CHAPTERS.length;i++){
      var c=CHAPTERS[i];
      if(c===el || (c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) found=c.id; else break;
    }
    return found;
  }
  var eidN={};
  function assignEids(){ editable().forEach(function(el){
    if(el.getAttribute('data-eid')) return;
    var k=chapterKeyFor(el); eidN[k]=(eidN[k]||0);
    el.setAttribute('data-eid', k+'-e'+(eidN[k]++));
  }); }

  // Replay whatever the server never accepted (kept in localStorage by flush()). Offered on
  // load rather than applied silently, so it can never fight a newer server-side state.
  function offerRestore(){
    var bk=readBackup(), n=Object.keys(bk).length; if(!n) return;
    showWarn('&#9888; <b>'+n+' edit'+(n===1?'':'s')+' from an earlier session never reached the server.</b>'
      + '<button class="de-w-restore">Restore &amp; save now</button><button class="de-w-drop">Discard</button>');
    var r=warnEl.querySelector('.de-w-restore'), d=warnEl.querySelector('.de-w-drop');
    if(r) r.onclick=function(){
      fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(bk)})
        .then(deJSON).then(function(){ clearBackup(); hideWarn(); toast('Restored — reloading'); setTimeout(function(){ location.reload(); },600); })
        .catch(function(){ showWarn(NOT_SAVED); });
    };
    if(d) d.onclick=function(){ if(confirm('Discard '+n+' unsaved edit'+(n===1?'':'s')+'? This cannot be undone.')){ clearBackup(); hideWarn(); } };
  }
  // Normalised text of an element — the signature every patch is validated against.
  function sigOf(el){ return (el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120); }

  // ---- Staleness detection ------------------------------------------------------------
  // data-eid is POSITIONAL (chapter + index), so any template push that changes how many
  // editable elements a chapter has silently re-points every later key in that chapter at a
  // different element. Two independent guards, because they fail differently:
  //
  //  1. baseSig — the signature of each element AS THE TEMPLATE RENDERS IT, captured at boot
  //     before loadEdits() applies anything. Every patch records the baseSig of the element
  //     it was authored against; on replay we only apply it if that still matches. This is
  //     per-key and exact.
  //  2. shape — a fingerprint of the whole eid-assignment input (editable elements per
  //     chapter). Changes exactly when eid assignment would change, and never otherwise —
  //     unlike a git sha, which moves on every unrelated commit and would cry wolf. Lets the
  //     page say "the template changed under your saved edits" up front, not per element.
  //  3. ckey — a CONTENT key: hash of tag + the element's template text, plus an occurrence
  //     index only among elements that are byte-identical. Deliberately does NOT include the
  //     chapter, so renumbering chapters doesn't move it. This is a recovery index, not a
  //     replacement for data-eid: positional keys still address everything, and Ray's existing
  //     saved edits keep working untouched. When a positional key goes stale, the content key
  //     finds where that element actually went and the edit follows it, instead of being
  //     skipped and reported as a loss. That turns the Reiss failure into a self-healing case.
  var baseSig={}, ckeyOf={}, byCkey={};
  function captureBaseSigs(){
    var seen={};
    editable().forEach(function(el){
      var id=el.getAttribute('data-eid'); if(!id) return;
      var s=sigOf(el); baseSig[id]=s;
      var base='k'+hashStr(el.tagName+'|'+s);
      seen[base]=(seen[base]||0); var ck=base+(seen[base]?'.'+seen[base]:''); seen[base]++;
      ckeyOf[id]=ck; byCkey[ck]=el; el.setAttribute('data-ck',ck);
    });
  }
  function hashStr(s){ var h=5381; for(var i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); }
  function shapeOf(){
    var counts={}; editable().forEach(function(el){ var k=chapterKeyFor(el); counts[k]=(counts[k]||0)+1; });
    return hashStr(Object.keys(counts).sort().map(function(k){ return k+':'+counts[k]; }).join('|'));
  }
  var SHAPE=null;
  // Per-tab id. /api/edits is a shallow last-writer-wins merge with no optimistic
  // concurrency (unlike /api/briefs and /api/clients, which use kvmerge + X-Sync-Base), so
  // two tabs editing the same deck silently overwrite each other key by key. Full merge
  // semantics are a bigger change; knowing it happened is most of the value, and costs
  // nothing per save.
  var TABID = (function(){ try{ return Math.random().toString(36).slice(2,10); }catch(e){ return 'tab'; } })();
  var skipped=0, mismatched=0, orderSkipped=0, recovered=0, unresolved=0, staleKeys=[];

  // One banner for every kind of staleness, with a button that drops EXACTLY the keys that
  // went stale. Reset was previously the only way to clear them, and Reset destroys the whole
  // overlay — so clearing 14 dead tombstones cost 122 good edits, which is why the banner
  // kept coming back: the safe action was too expensive to take.
  function reportStale(ed){
    var meta = ed && ed.__meta, shapeChanged = !!(meta && meta.shape && SHAPE && meta.shape!==SHAPE);
    // Another tab/browser wrote this overlay recently. Not an error — but if you now edit the
    // same elements, one of you silently loses, and previously nothing said so at all.
    if(meta && meta.writer && meta.writer!==TABID && meta.ts && (Date.now()-meta.ts) < 30*60*1000){
      showWarn('&#9888; <b>Another session edited this deck '
        + Math.max(1,Math.round((Date.now()-meta.ts)/60000)) + ' min ago.</b> Your edits merge per element, '
        + 'so if you both change the same text one of you will overwrite the other. Reload before editing '
        + 'if someone else is working on it right now.');
    }
    var n = skipped + mismatched + orderSkipped + unresolved;
    if(!n && !recovered && !shapeChanged) return;
    if(!n && recovered){
      showWarn('&#10003; <b>The deck template changed</b> &mdash; <b>'+recovered+'</b> of your saved edit'
        + (recovered===1?' was':'s were')+' matched to their content in its new position and applied normally. '
        + 'Nothing was lost.');
      return;
    }
    var bits=[];
    if(skipped) bits.push('<b>'+skipped+'</b> deletion'+(skipped===1?'':'s'));
    if(mismatched) bits.push('<b>'+mismatched+'</b> text/style edit'+(mismatched===1?'':'s'));
    if(orderSkipped) bits.push('<b>'+orderSkipped+'</b> reorder'+(orderSkipped===1?'':'s'));
    if(unresolved) bits.push('<b>'+unresolved+'</b> edit'+(unresolved===1?'':'s')+' whose content is gone from the deck');
    var msg;
    if(n){
      msg = '&#9888; '+bits.join(', ')+' could not be replayed &mdash; the template changed underneath them, '
        + 'so they were <b>skipped, not applied</b>. Nothing on this page has been deleted or overwritten by them.';
      if(recovered) msg += ' <b>'+recovered+'</b> other edit'+(recovered===1?' was':'s were')
        + ' matched to their content in its new position and applied normally.';
    } else {
      msg = '&#9888; <b>The deck template has changed</b> since your saved edits were made. '
        + 'They all still matched their content, so everything was applied &mdash; but keep an eye out.';
    }
    if(staleKeys.length) msg += '<button class="de-w-drop-stale">Clear the '+staleKeys.length+' stale entr'
      +(staleKeys.length===1?'y':'ies')+'</button>';
    showWarn(msg);
    var b=warnEl.querySelector('.de-w-drop-stale');
    if(b) b.onclick=function(){
      // Double-escaped newline on purpose: this string lives inside getEditorScript's own
      // template literal, which eats a single escape and emits a raw newline, breaking the
      // quoted string in the served script ("Invalid or unexpected token"). Applies to
      // comments here too — an escape sequence written in a comment breaks the comment.
      if(!confirm('Remove '+staleKeys.length+' stale entr'+(staleKeys.length===1?'y':'ies')+' from your saved edits?\\n\\n'
        + 'Only these are removed — every edit that still applies is kept. A backup is taken first.')) return;
      b.disabled=true; b.textContent='Clearing…';
      fetch(API+'/api/edits?page='+PAGE+'&drop='+encodeURIComponent(staleKeys.join(',')),{method:'PUT',
        headers:{'content-type':'application/json'},body:'{}'})
        .then(deJSON).then(function(){ toast('Cleared — reloading'); setTimeout(function(){ location.reload(); },500); })
        .catch(function(e){ b.disabled=false; b.textContent='Clear failed — retry'; });
    };
  }
  function loadEdits(){ fetch(API+'/api/edits?page='+PAGE).then(deJSON).then(function(ed){
    offerRestore();
    if(!ed) return;
    // Pass 1: replay any runtime-added blocks (duplicated in Design mode) before content/order
    // overlays run, so they exist in the DOM for those passes to find by data-eid/data-rid.
    Object.keys(ed).forEach(function(k){
      if(k.indexOf('__added:')!==0) return;
      var parent=document.querySelector('[data-tid="'+k.slice(8)+'"]');
      // The group this block was added into no longer exists (its chapter was deleted, or the
      // group ids shifted). Previously a silent early return — the block just wasn't there,
      // with nothing to say why.
      if(!parent){ unresolved+=(ed[k]||[]).length; staleKeys.push(k); return; }
      (ed[k]||[]).forEach(function(a){
        if(document.querySelector('[data-eid="'+a.id+'"]')) return; // already present
        var tmp=document.createElement('div'); tmp.innerHTML=a.html; var node=tmp.firstElementChild; if(!node) return;
        var after=a.after?parent.querySelector('[data-rid="'+a.after+'"]'):null;
        if(after&&after.nextSibling) parent.insertBefore(node,after.nextSibling); else parent.appendChild(node);
      });
    });
    Object.keys(ed).forEach(function(k){
      if(k==='__meta') return;
      if(k.indexOf('__order:')===0){
        var container=document.querySelector('[data-tid="'+k.slice(8)+'"]'); if(!container) return;
        var scope=container.tagName==='TABLE'?container.querySelector('tbody'):container; if(!scope) return;
        // Replay ONLY when the saved list is exactly the current set of reorderable children.
        // A partial list is not a no-op: appendChild() moves each listed element to the END,
        // so an out-of-date list silently shunts everything it names to the bottom and leaves
        // everything it doesn't in place. That is precisely how a stale __order:top-g0 stacked
        // every chapter divider at the foot of the Reiss deck while the text still read fine.
        var listed=ed[k]||[];
        var kids=Array.prototype.filter.call(scope.children, function(c){ return c.getAttribute && c.getAttribute('data-rid'); })
          .map(function(c){ return c.getAttribute('data-rid'); });
        var sameSet = listed.length===kids.length && listed.every(function(r){ return kids.indexOf(r)>=0; });
        if(!sameSet){ orderSkipped++; staleKeys.push(k); return; }
        listed.forEach(function(rid){ var el=scope.querySelector('[data-rid="'+rid+'"]'); if(el) scope.appendChild(el); });
        return;
      }
      if(k.indexOf('__added:')===0) return;
      var el=document.querySelector('[data-eid="'+k+'"]');
      var v=ed[k];
      // Recovery: if the positional key is gone, or still resolves but to an element whose
      // template text is no longer what this patch was written against, follow the CONTENT
      // key instead. This is what makes a chapter insert/delete/move a non-event — the edit
      // travels with its paragraph instead of being skipped or landing on a stranger.
      var relocated=false;
      if(v && typeof v==='object' && v.ck){
        var stale = !el || (v.sig!=null && baseSig[k]!=null && v.sig!==baseSig[k]);
        if(stale){
          var alt=byCkey[v.ck];
          if(alt && alt!==el){ el=alt; relocated=true; recovered++; }
        }
      }
      if(!el){ if(v && typeof v==='object' && v.ck){ unresolved++; staleKeys.push(k); } return; }
      if(v && typeof v==='object' && v.deleted){
        // A tombstone is the only overlay type that DESTROYS content, and it is the one type
        // you cannot eyeball afterwards — what it removed simply isn't on the page to notice.
        // data-eid is positional, so once a template push renumbers chapters an old tombstone
        // lands on an innocent element and silently deletes it. Every deletion now records a
        // signature of what it removed; replay only when that still matches. Legacy tombstones
        // carry no signature and are never replayed — a deletion that stops applying is a
        // visible, fixable annoyance; one that removes the wrong thing is not.
        if(v.sig && v.sig===sigOf(el)){ el.remove(); } else { skipped++; staleKeys.push(k); }
        return;
      }
      // Same guard, now for CONTENT and STYLE patches. It used to apply only to deletions,
      // which is backwards: a skipped deletion is visible and shouts at you, while a text
      // patch landing on the wrong element rewrites a paragraph silently and looks fine.
      // Patches written before this shipped carry no sig and are still applied — refusing
      // them would discard every edit made to date, which is a worse failure than the one
      // being guarded against.
      // relocated means the content key already proved this is the right element, so the
      // positional signature check has nothing left to say.
      if(!relocated && v && typeof v==='object' && v.sig && baseSig[k]!=null && v.sig!==baseSig[k]){
        mismatched++; staleKeys.push(k); return;
      }
      var h=(typeof v==='string')?v:v.html; if(h!=null) el.innerHTML=h;
      if(v && typeof v==='object' && v.style!=null) el.style.cssText=v.style; });
    reportStale(ed); })
    .catch(function(e){
      // Used to be a silent catch — a failed load rendered the clean git template, which is
      // visually identical to "all my work is gone". Say so instead, and warn before editing
      // on top of a state that will not save. But not every failure is Access: a standalone
      // offline export (no backend at API at all, e.g. opened via file://) fails here on every
      // load by design, and blaming a nonexistent login was just noise on a page where the
      // "sign in and reload" instruction is impossible to follow.
      var offline = !API && (location.protocol==='file:' || (e&&/fetch/i.test(e.message||'')));
      showWarn(offline
        ? '&#9888; <b>Working offline</b> &mdash; this standalone copy has no saved-edit server to load from, so it is showing the template as downloaded. Use &#8681; Download HTML to save a new checkpoint.'
        : '&#9888; <b>Could not load your saved edits</b> &mdash; you may be signed out of Cloudflare Access. '
          + 'This page is showing the ORIGINAL template, not your version. <b>Sign in and reload before editing.</b>');
    }); }

  // ---- row drag-and-drop reordering — works even in presentation mode (bar hidden),
  // drag starts only from a row's first cell so text selection elsewhere is unaffected.
  function initRowDrag(){
    var tidN={};
    document.querySelectorAll('.tbl-wrap table').forEach(function(table){
      var tb=table.querySelector('tbody'); if(!tb) return;
      var tKey=table.getAttribute('data-tid'); if(!tKey){ var tk=chapterKeyFor(table); tidN[tk]=(tidN[tk]||0); tKey=tk+'-t'+(tidN[tk]++); table.setAttribute('data-tid',tKey); }
      var rid=0;
      Array.prototype.forEach.call(tb.children,function(tr){
        if(tr.tagName!=='TR') return;
        if(!tr.getAttribute('data-rid')) tr.setAttribute('data-rid',tKey+'-r'+(rid++));
        var handle=tr.children[0]; if(!handle) return;
        var arm=function(){ tr.setAttribute('draggable','true'); };
        var disarm=function(){ tr.removeAttribute('draggable'); };
        handle.addEventListener('mousedown',arm);
        handle.addEventListener('mouseup',disarm);
        tr.addEventListener('dragstart',function(e){ tr.classList.add('de-dragging'); e.dataTransfer.effectAllowed='move';
          try{ e.dataTransfer.setData('text/plain', tr.getAttribute('data-rid')); }catch(er){} });
        tr.addEventListener('dragend',function(){ tr.classList.remove('de-dragging'); disarm(); saveOrder(tb,tKey); });
      });
      tb.addEventListener('dragover',function(e){
        var dragging=tb.querySelector('.de-dragging'); if(!dragging) return;
        e.preventDefault();
        var after=rowAfter(tb,e.clientY);
        if(after==null) tb.appendChild(dragging); else if(after!==dragging) tb.insertBefore(dragging,after);
      });
    });
  }
  function rowAfter(tb,y){
    var rows=Array.prototype.slice.call(tb.querySelectorAll('tr:not(.de-dragging)'));
    var closest=null, closestOffset=-Infinity;
    rows.forEach(function(r){ var box=r.getBoundingClientRect(); var offset=y-box.top-box.height/2;
      if(offset<0 && offset>closestOffset){ closestOffset=offset; closest=r; } });
    return closest;
  }
  function saveOrder(tb,tKey){
    var order=Array.prototype.map.call(tb.querySelectorAll('tr'),function(tr){ return tr.getAttribute('data-rid'); });
    var patch={}; patch['__order:'+tKey]=order;
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(r){ return r.json(); }).then(function(){ toast('Row order saved'); }).catch(function(){ toast('Order save failed'); });
  }

  // sig is the element's TEMPLATE-state signature (captured at boot, before any overlay was
  // applied), not its current edited text — so it stays stable however many times the same
  // element is edited, and identifies which template element this patch was authored against.
  function entry(el){ var id=el.getAttribute('data-eid');
    return { html: el.innerHTML, style: el.getAttribute('style')||'',
             preview: el.textContent.trim().slice(0,80),
             sig: (id!=null && baseSig[id]!=null) ? baseSig[id] : sigOf(el),
             ck: (id!=null ? ckeyOf[id] : null) || el.getAttribute('data-ck') || null }; }
  // Snapshot for undo only at the *start* of a dirty batch (dirty was empty), not on every
  // keystroke/drag tick — one Ctrl+Z should undo "that edit", not one character of it. The
  // debounce window (600-1200ms) comfortably outlasts the snapshot fetch, so no explicit
  // sequencing is needed here the way the discrete actions below need it.
  function queueSave(el){ var id=el.getAttribute('data-eid'); if(!id) return;
    if(!Object.keys(dirty).length) armUndo();
    dirty[id]=entry(el);
    // Mirror to localStorage the moment it is queued, not only once flush() runs. backupLocal
    // used to live inside flush(), so anything typed in the last 1.2s existed ONLY in this
    // tab's memory: closing the tab, navigating away or a crash lost it with no trace and no
    // prompt on the next load. A failed save was recoverable; an unsaved one was not, which
    // is exactly backwards.
    backupLocal(dirty);
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,1200); }
  // Style-only save (resize/recolour/refont) — deliberately omits the html field so it can
  // never clobber a separate, later text edit to the same element's children on load.
  function queueStyleSave(el){ var id=el.getAttribute('data-eid'); if(!id) return;
    if(!Object.keys(dirty).length) armUndo();
    dirty[id]=Object.assign({},dirty[id]||{},{style:el.getAttribute('style')||'',
      sig:(baseSig[id]!=null?baseSig[id]:sigOf(el)), ck:ckeyOf[id]||null});
    backupLocal(dirty);
    if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(flush,600); }

  // ---- Design mode: select / move / resize / recolour / refont / duplicate / delete
  // any card-like block. Text mode (above) edits words; this edits the box around them.
  function assignBlockIds(){
    document.querySelectorAll(DESIGN_SEL).forEach(function(el){
      if(el.closest('.de-bar,.de-panel,.de-props,.de-fbpanel')) return;
      if(!el.getAttribute('data-eid')){ var bk=chapterKeyFor(el); blockN[bk]=(blockN[bk]||0); el.setAttribute('data-eid', bk+'-b'+(blockN[bk]++)); }
      el.setAttribute('data-de-block','1');
      var parent=el.parentElement; if(!parent) return;
      var tid=groupIds.get(parent);
      if(!tid){ var gk=chapterKeyFor(parent); groupN[gk]=(groupN[gk]||0); tid=gk+'-g'+(groupN[gk]++); groupIds.set(parent,tid); parent.setAttribute('data-tid',tid); }
      if(!el.getAttribute('data-rid')) el.setAttribute('data-rid', tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1));
    });
  }
  function blockAfter(container,y){
    var kids=Array.prototype.slice.call(container.children).filter(function(c){ return !c.classList.contains('de-bdrag'); });
    var closest=null, closestOffset=-Infinity;
    kids.forEach(function(c){ var box=c.getBoundingClientRect(); var offset=y-box.top-box.height/2;
      if(offset<0 && offset>closestOffset){ closestOffset=offset; closest=c; } });
    return closest;
  }
  function saveContainerOrder(container,tid){
    var order=Array.prototype.slice.call(container.children).filter(function(c){ return c.getAttribute('data-rid'); })
      .map(function(c){ return c.getAttribute('data-rid'); });
    var patch={}; patch['__order:'+tid]=order;
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).catch(function(){});
  }
  function reorderBlock(el,dir){
    var parent=el.parentElement, tid=parent&&parent.getAttribute('data-tid'); if(!tid) return;
    var sib=dir<0?el.previousElementSibling:el.nextElementSibling; if(!sib) return;
    if(dir<0) parent.insertBefore(el,sib); else parent.insertBefore(sib,el);
    saveContainerOrder(parent,tid);
    if(selEls.size===1 && selEls.has(el)) positionOverlay(el);
  }
  function initBlockDrag(){
    document.querySelectorAll('[data-de-block]').forEach(function(el){
      if(el.__deWired) return; el.__deWired=true;
      el.addEventListener('mousedown',function(e){
        if(!document.body.classList.contains('de-design')) return;
        if(e.target.closest('.de-resize,.de-props')) return;
        el.setAttribute('draggable','true');
      });
      el.addEventListener('dragstart',function(e){
        if(!document.body.classList.contains('de-design')){ e.preventDefault(); return; }
        // Alt/Option+drag copies instead of moves: a stub clone is left behind holding the
        // original's identity, while el itself (now carrying a fresh id) is the thing that
        // travels to wherever the mouse releases — reuses the move machinery below as-is.
        el.__copyDrag=e.altKey;
        if(e.altKey){
          var stub=el.cloneNode(true); stub.classList.remove('de-bsel');
          el.parentElement.insertBefore(stub, el);
        }
        el.classList.add('de-bdrag'); e.dataTransfer.effectAllowed=e.altKey?'copy':'move';
        try{ e.dataTransfer.setData('text/plain', el.getAttribute('data-rid')||''); }catch(er){}
      });
      el.addEventListener('dragend',function(){
        el.classList.remove('de-bdrag'); el.removeAttribute('draggable');
        var parent=el.parentElement, tid=parent&&parent.getAttribute('data-tid');
        if(el.__copyDrag){
          el.__copyDrag=false;
          var newId='b'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
          el.setAttribute('data-eid',newId); el.classList.remove('de-bsel');
          var newRid=tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1);
          el.setAttribute('data-rid',newRid);
          initBlockDrag();
          var afterRid=el.previousElementSibling&&el.previousElementSibling.getAttribute('data-rid')||null;
          armUndo().then(function(ed){
            ed=ed||{}; var key='__added:'+tid; var list=(ed[key]||[]).slice();
            list.push({id:newId, after:afterRid, html:el.outerHTML});
            var patch={}; patch[key]=list;
            return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
          }).then(function(){ if(tid) saveContainerOrder(parent,tid); toast('Block copied'); selectBlock(el); })
            .catch(function(){ toast('Copy failed to save'); });
        } else if(tid) saveContainerOrder(parent,tid);
        if(selEls.size===1 && selEls.has(el)) positionOverlay(el);
      });
    });
    document.querySelectorAll('[data-tid]').forEach(function(container){
      if(container.__deSortWired) return; container.__deSortWired=true;
      container.addEventListener('dragover',function(e){
        var dragging=container.querySelector('.de-bdrag'); if(!dragging) return;
        e.preventDefault();
        // [data-tid] containers can nest (a card is both a row in its grid AND, via its own
        // text children, a container in its own right) — stop here once the innermost one
        // that actually holds the dragging block has handled it, or the event bubbles into
        // an ancestor container's listener and gets re-parented somewhere it doesn't belong.
        e.stopPropagation();
        var after=blockAfter(container,e.clientY);
        if(after==null) container.appendChild(dragging); else if(after!==dragging) container.insertBefore(dragging,after);
      });
    });
  }

  // Shift-click adds/removes a block from selEls instead of replacing the selection, so
  // several blocks can be deleted or duplicated together. Resizing and the full style panel
  // stay single-element-only (dragging one resize handle for N differently-sized blocks
  // isn't a coherent action) — multi-select gets a simplified panel with bulk actions.
  var selEls=new Set(), resizeHandle=null;
  function positionOverlay(el){
    var r=el.getBoundingClientRect();
    if(resizeHandle){ resizeHandle.style.top=(r.top+window.scrollY+r.height-7)+'px'; resizeHandle.style.left=(r.left+window.scrollX+r.width-7)+'px'; }
  }
  function removeResizeHandle(){ if(resizeHandle){ resizeHandle.remove(); resizeHandle=null; } }
  function clearSelection(){
    selEls.forEach(function(el){ el.classList.remove('de-bsel'); });
    selEls.clear();
    removeResizeHandle();
    propsPanel.classList.remove('show');
  }
  function refreshSelectionUI(){
    removeResizeHandle();
    if(!selEls.size){ propsPanel.classList.remove('show'); return; }
    if(selEls.size===1){
      var el=Array.from(selEls)[0];
      resizeHandle=document.createElement('div'); resizeHandle.className='de-resize'; document.body.appendChild(resizeHandle);
      positionOverlay(el);
      wireResize(el,resizeHandle);
      renderPropsPanel(el);
    } else {
      renderMultiPropsPanel();
    }
    propsPanel.classList.add('show');
  }
  function deleteSelection(){
    var els=Array.from(selEls);
    if(!confirm('Delete '+els.length+' blocks? This removes them for everyone viewing this deck.')) return;
    var patch={};
    els.forEach(function(el){ var eid=el.getAttribute('data-eid'); delete dirty[eid]; patch[eid]={deleted:true, sig:sigOf(el)}; });
    clearSelection();
    els.forEach(function(el){ el.remove(); });
    armUndo().then(function(){
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ toast(els.length+' blocks deleted'); }).catch(function(){ toast('Delete failed to save'); });
  }
  function duplicateSelection(){
    var els=Array.from(selEls);
    clearSelection();
    els.forEach(function(el){ duplicateBlock(el); });
  }
  function renderMultiPropsPanel(){
    propsPanel.innerHTML =
      '<div class="ph"><span><span class="tag">'+selEls.size+' selected</span></span><button class="pclose" title="Deselect">×</button></div>'
      + '<section><p style="font-size:12.5px;color:#6b7a8d;margin:0">Shift-click a block to add or remove it from this selection. Style editing (font, colour, size) works one block at a time — select just one to use it.</p></section>'
      + '<div class="actions"><button class="dup">⧉ Duplicate all</button><button class="del">🗑 Delete all</button></div>';
    propsPanel.querySelector('.pclose').addEventListener('click',clearSelection);
    propsPanel.querySelector('.dup').addEventListener('click',duplicateSelection);
    propsPanel.querySelector('.del').addEventListener('click',deleteSelection);
  }
  function rgbToHex(rgb){ var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(rgb||''); if(!m) return '#ffffff';
    return '#'+[1,2,3].map(function(i){ return ('0'+parseInt(m[i],10).toString(16)).slice(-2); }).join(''); }
  var FONTS=['Lato, sans-serif','Georgia, serif','Arial, sans-serif','\\'Courier New\\', monospace','\\'Times New Roman\\', serif','Verdana, sans-serif'];
  function wireResize(el,handle){
    handle.addEventListener('mousedown',function(e){
      e.preventDefault(); e.stopPropagation();
      var startX=e.clientX, startY=e.clientY, box=el.getBoundingClientRect(), startW=box.width, startH=box.height;
      function onMove(ev){
        var w=Math.max(80,startW+(ev.clientX-startX)), h=Math.max(40,startH+(ev.clientY-startY));
        el.style.width=w+'px'; el.style.height=h+'px';
        positionOverlay(el);
        var pw=propsPanel.querySelector('.p-w'), ph=propsPanel.querySelector('.p-h');
        if(pw) pw.value=Math.round(w); if(ph) ph.value=Math.round(h);
      }
      function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); queueStyleSave(el); }
      document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
    });
  }
  function deleteBlock(el){
    if(!confirm('Delete this block? This removes it for everyone viewing this deck.')) return;
    var eid=el.getAttribute('data-eid'), sig=sigOf(el); clearSelection(); delete dirty[eid]; el.remove();
    armUndo().then(function(){
      var patch={}; patch[eid]={deleted:true, sig:sig};
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ toast('Block deleted'); }).catch(function(){ toast('Delete failed to save'); });
  }
  function duplicateBlock(el){
    var clone=el.cloneNode(true);
    var newId='b'+(blockN++)+'-'+Math.random().toString(36).slice(2,7);
    clone.setAttribute('data-eid',newId); clone.classList.remove('de-bsel');
    var parent=el.parentElement, tid=parent.getAttribute('data-tid')||'';
    var newRid=tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1);
    clone.setAttribute('data-rid',newRid);
    var afterRid=el.getAttribute('data-rid')||null;
    parent.insertBefore(clone, el.nextSibling);
    initBlockDrag();
    armUndo().then(function(ed){
      ed=ed||{}; var key='__added:'+tid; var list=(ed[key]||[]).slice();
      list.push({id:newId, after:afterRid, html:clone.outerHTML});
      var patch={}; patch[key]=list;
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ saveContainerOrder(parent,tid); toast('Block duplicated'); selectBlock(clone); })
      .catch(function(){ toast('Duplicate failed to save'); });
  }
  function pasteClipboard(){
    var target=selEls.size?Array.from(selEls)[selEls.size-1]:null;
    var container=target?target.parentElement:null;
    if(!container||!container.getAttribute('data-tid')){ toast('Select a block to paste near first'); return; }
    var tid=container.getAttribute('data-tid'), afterEl=target, newEls=[];
    deClipboard.forEach(function(html){
      var tmp=document.createElement('div'); tmp.innerHTML=html;
      var node=tmp.firstElementChild; if(!node) return;
      var newId='b'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      node.setAttribute('data-eid',newId); node.classList.remove('de-bsel');
      var newRid=tid+'-r'+(rowN[tid]=(rowN[tid]||0)+1);
      node.setAttribute('data-rid',newRid);
      container.insertBefore(node, afterEl?afterEl.nextSibling:container.firstChild);
      afterEl=node; newEls.push(node);
    });
    if(!newEls.length) return;
    initBlockDrag(); clearSelection();
    newEls.forEach(function(el){ selectBlock(el,true); });
    armUndo().then(function(ed){
      ed=ed||{}; var key='__added:'+tid; var list=(ed[key]||[]).slice();
      newEls.forEach(function(node){
        var prev=node.previousElementSibling;
        list.push({id:node.getAttribute('data-eid'), after:prev&&prev.getAttribute('data-rid')||null, html:node.outerHTML});
      });
      var patch={}; patch[key]=list;
      return fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(patch)});
    }).then(function(){ saveContainerOrder(container,tid); toast(newEls.length+' block'+(newEls.length>1?'s':'')+' pasted'); })
      .catch(function(){ toast('Paste failed to save'); });
  }

  // ---- Properties panel: a persistent Canva/PowerPoint-style inspector for whatever's
  // selected — one place for text, fill/border and size, instead of scattered mini-popups.
  function normWeight(w){ var n=parseInt(w,10); if(!isNaN(n)) return n>=700?(n>=900?'900':'700'):'400';
    return (''+w).toLowerCase()==='bold' ? '700' : '400'; }
  function blockState(el){
    var cs=getComputedStyle(el), r=el.getBoundingClientRect();
    var fs=parseFloat(cs.fontSize), lh=parseFloat(cs.lineHeight);
    return {
      bg: rgbToHex(cs.backgroundColor), color: rgbToHex(cs.color),
      borderColor: rgbToHex(cs.borderTopColor), borderWidth: parseInt(cs.borderTopWidth,10)||0,
      radius: parseInt(cs.borderRadius,10)||0, opacity: Math.round((parseFloat(cs.opacity)||1)*100),
      width: Math.round(r.width), height: Math.round(r.height),
      fontSize: parseInt(cs.fontSize,10)||14, fontWeight: normWeight(cs.fontWeight), textAlign: cs.textAlign,
      lineHeight: (fs&&lh) ? Math.round((lh/fs)*100)/100 : 1.4,
      shadow: cs.boxShadow!=='none'
    };
  }
  // Format painter: capture a source block's look-and-feel (not size/position) and reapply
  // it to any other block — the Canva/PowerPoint "paint format" tool.
  var paintedStyle=null;
  var STYLE_PROPS=['bg','color','borderColor','borderWidth','radius','opacity','fontFamily','fontSize','fontWeight','textAlign','lineHeight','shadow'];
  function captureStyle(el){
    var st=blockState(el);
    paintedStyle={ bg:st.bg, color:st.color, borderColor:st.borderColor, borderWidth:st.borderWidth,
      radius:st.radius, opacity:st.opacity, fontFamily:getComputedStyle(el).fontFamily,
      fontSize:st.fontSize, fontWeight:st.fontWeight, textAlign:st.textAlign, lineHeight:st.lineHeight, shadow:st.shadow };
    toast('Style copied — select a block, then Paste style');
  }
  function applyPaintedStyle(el){
    if(!paintedStyle) return;
    var p=paintedStyle;
    el.style.background=p.bg; el.style.color=p.color;
    el.style.borderColor=p.borderColor; el.style.borderWidth=p.borderWidth+'px'; el.style.borderStyle='solid';
    el.style.borderRadius=p.radius+'px'; el.style.opacity=(p.opacity/100);
    el.style.fontFamily=p.fontFamily; el.style.fontSize=p.fontSize+'px'; el.style.fontWeight=p.fontWeight;
    el.style.textAlign=p.textAlign; el.style.lineHeight=p.lineHeight;
    el.style.boxShadow=p.shadow?'var(--shadow-lift)':'none';
    queueStyleSave(el); renderPropsPanel(el); positionOverlay(el); toast('Style applied');
  }
  function renderPropsPanel(el){
    var st=blockState(el);
    var fontOpts=FONTS.map(function(f){ return '<option value="'+f.replace(/"/g,'&quot;')+'">'+f.split(',')[0].replace(/'/g,'')+'</option>'; }).join('');
    propsPanel.innerHTML =
      '<div class="ph"><span><span class="tag">'+el.tagName.toLowerCase()+'</span></span><button class="pclose" title="Deselect">×</button></div>'
      + '<section><h5>Text</h5>'
        + '<label>Font</label><select class="p-ff">'+fontOpts+'</select>'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Size (px)</label><div class="stepper"><button type="button" class="p-fs-dn">−</button><input type="number" class="p-fs" min="8" max="96" value="'+st.fontSize+'"><button type="button" class="p-fs-up">+</button></div></div>'
          + '<div><label>Weight</label><select class="p-fw"><option value="400">Regular</option><option value="700">Bold</option><option value="900">Black</option></select></div>'
        + '</div>'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Align</label><div class="btnrow p-align">'
            + '<button data-v="left">⟵</button><button data-v="center">•</button><button data-v="right">⟶</button></div></div>'
          + '<div><label>Line height</label><input type="number" class="p-lh" min="1" max="2.5" step="0.1" value="'+st.lineHeight+'"></div>'
        + '</div>'
        + '<label style="margin-top:8px">Text colour</label><input type="color" class="p-color" value="'+st.color+'">'
        + swatchRow('p-color')
      + '</section>'
      + '<section><h5>Fill &amp; border</h5>'
        + '<label>Background</label><input type="color" class="p-bg" value="'+st.bg+'">'
        + swatchRow('p-bg')
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Border colour</label><input type="color" class="p-bc" value="'+st.borderColor+'">'+swatchRow('p-bc')+'</div>'
          + '<div><label>Border width</label><input type="number" class="p-bw" min="0" max="12" value="'+st.borderWidth+'"></div>'
        + '</div>'
        + '<div class="grid2" style="margin-top:8px">'
          + '<div><label>Corner radius</label><input type="number" class="p-radius" min="0" max="60" value="'+st.radius+'"></div>'
          + '<div><label>Opacity %</label><input type="range" class="p-opacity" min="10" max="100" value="'+st.opacity+'"></div>'
        + '</div>'
        + '<label class="chk-row" style="margin-top:8px"><input type="checkbox" class="p-shadow"'+(st.shadow?' checked':'')+'> Drop shadow</label>'
      + '</section>'
      + '<section><h5>Size</h5><div class="grid2">'
        + '<div><label>Width (px)</label><input type="number" class="p-w" min="80" value="'+st.width+'"></div>'
        + '<div><label>Height (px)</label><input type="number" class="p-h" min="40" value="'+st.height+'"></div>'
      + '</div></section>'
      + '<div class="actions"><button class="dup">⧉ Duplicate</button><button class="rst">↺ Reset</button><button class="del">🗑 Delete</button></div>'
      + '<div class="actions"><button class="cpstyle">🖌 Copy style</button><button class="pstyle"'+(paintedStyle?'':' disabled')+'>🖌 Paste style</button></div>';

    propsPanel.querySelector('.pclose').addEventListener('click',clearSelection);
    wireSwatches(propsPanel);
    propsPanel.querySelectorAll('.p-align button').forEach(function(b){ b.classList.toggle('on',b.getAttribute('data-v')===st.textAlign); });
    propsPanel.querySelector('.p-align').addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return; el.style.textAlign=b.getAttribute('data-v'); queueStyleSave(el); renderPropsPanel(el); });
    propsPanel.querySelector('.p-fw').value=st.fontWeight;
    propsPanel.querySelector('.p-ff').addEventListener('change',function(){ el.style.fontFamily=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-fs').addEventListener('input',function(){ el.style.fontSize=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.p-fs-up').addEventListener('click',function(){ var i=propsPanel.querySelector('.p-fs'); i.value=Math.min(96,(parseInt(i.value,10)||14)+1); i.dispatchEvent(new Event('input',{bubbles:true})); });
    propsPanel.querySelector('.p-fs-dn').addEventListener('click',function(){ var i=propsPanel.querySelector('.p-fs'); i.value=Math.max(8,(parseInt(i.value,10)||14)-1); i.dispatchEvent(new Event('input',{bubbles:true})); });
    propsPanel.querySelector('.p-lh').addEventListener('input',function(){ el.style.lineHeight=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-fw').addEventListener('change',function(){ el.style.fontWeight=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-color').addEventListener('input',function(){ el.style.color=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-bg').addEventListener('input',function(){ el.style.background=this.value; queueStyleSave(el); });
    propsPanel.querySelector('.p-bc').addEventListener('input',function(){ el.style.borderColor=this.value; el.style.borderStyle='solid'; queueStyleSave(el); });
    propsPanel.querySelector('.p-bw').addEventListener('input',function(){ el.style.borderWidth=this.value+'px'; el.style.borderStyle='solid'; queueStyleSave(el); });
    propsPanel.querySelector('.p-radius').addEventListener('input',function(){ el.style.borderRadius=this.value+'px'; queueStyleSave(el); });
    propsPanel.querySelector('.p-opacity').addEventListener('input',function(){ el.style.opacity=(this.value/100); queueStyleSave(el); });
    propsPanel.querySelector('.p-shadow').addEventListener('change',function(){ el.style.boxShadow=this.checked?'var(--shadow-lift)':'none'; queueStyleSave(el); });
    propsPanel.querySelector('.p-w').addEventListener('input',function(){ el.style.width=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.p-h').addEventListener('input',function(){ el.style.height=this.value+'px'; queueStyleSave(el); positionOverlay(el); });
    propsPanel.querySelector('.dup').addEventListener('click',function(){ duplicateBlock(el); });
    propsPanel.querySelector('.del').addEventListener('click',function(){ deleteBlock(el); });
    propsPanel.querySelector('.rst').addEventListener('click',function(){
      el.removeAttribute('style'); queueStyleSave(el); renderPropsPanel(el); positionOverlay(el); toast('Reset to default'); });
    propsPanel.querySelector('.cpstyle').addEventListener('click',function(){ captureStyle(el); renderPropsPanel(el); });
    propsPanel.querySelector('.pstyle').addEventListener('click',function(){ applyPaintedStyle(el); });
  }
  function selectBlock(el, additive){
    if(additive){
      if(selEls.has(el)){ el.classList.remove('de-bsel'); selEls.delete(el); }
      else { el.classList.add('de-bsel'); selEls.add(el); }
    } else {
      if(selEls.size===1 && selEls.has(el)) return;
      selEls.forEach(function(s){ s.classList.remove('de-bsel'); }); selEls.clear();
      el.classList.add('de-bsel'); selEls.add(el);
    }
    refreshSelectionUI();
  }
  document.addEventListener('click',function(e){
    if(!document.body.classList.contains('de-design')) return;
    if(e.target.closest('.de-props,.de-resize,.de-bar,.de-panel,.de-ctxmenu')) return;
    var el=e.target.closest('[data-de-block]');
    if(el) selectBlock(el, e.shiftKey); else if(!e.shiftKey) clearSelection();
  }, true);
  document.addEventListener('contextmenu',function(e){
    if(!document.body.classList.contains('de-design')) return;
    var el=e.target.closest('[data-de-block]'); if(!el) return;
    e.preventDefault();
    if(!selEls.has(el)) selectBlock(el, false);
    showCtxMenu(e.clientX,e.clientY,el);
  });
  window.addEventListener('scroll',function(){ if(selEls.size===1) positionOverlay(Array.from(selEls)[0]); },true);
  window.addEventListener('resize',function(){ if(selEls.size===1) positionOverlay(Array.from(selEls)[0]); });
  function flush(){ var keys=Object.keys(dirty); if(!keys.length) return;
    // Raw view never writes: the overlay it is deliberately NOT showing is still in KV, so a
    // save from here would merge new keys into a state the editor can't see and make the
    // mis-landing worse. Keep the patch queued so nothing is lost if the tab is reloaded
    // without ?raw=1.
    if(RAW){ stat.textContent='raw view — not saved'; return; }
    var patch=dirty; dirty={}; stat.textContent='saving…';
    backupLocal(patch);   // local copy first — survives even if the server never accepts it
    // Stamp the shape this overlay was authored against, so the next load can tell whether
    // the template moved underneath it instead of silently trusting positional keys.
    var wire=Object.assign({},patch,{__meta:{shape:SHAPE, ts:Date.now(), writer:TABID}});
    fetch(API+'/api/edits?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(wire)})
      .then(deJSON).then(function(){ stat.textContent='✓ saved'; clearBackup(patch); hideWarn();
        setTimeout(function(){ stat.textContent=''; },1500); })
      .catch(function(){
        // Put the patch BACK on the queue. It used to be dropped here, so every failed save
        // silently discarded that batch of edits with no retry and no record.
        Object.keys(patch).forEach(function(k){ if(!(k in dirty)) dirty[k]=patch[k]; });
        stat.textContent='save failed'; showWarn(NOT_SAVED);
      }); }

  function setEditing(on){ editing=on; document.body.classList.toggle('de-on',on);
    bEdit.classList.toggle('on',on); bEdit.textContent=on?'✓ Editing':'✎ Edit';
    bPick.style.display=on?'':'none'; bExport.style.display=on?'':'none';
    if(!on){ panel.classList.remove('show'); if(lastSel) lastSel.classList.remove('de-pick'); }
    if(on) assignEids();
    editable().forEach(function(el){ if(on) el.setAttribute('contenteditable','true'); else el.removeAttribute('contenteditable'); }); }

  bEdit.addEventListener('click',function(){ setEditing(!editing); });
  bDesign.addEventListener('click',function(){
    var on=!document.body.classList.contains('de-design');
    document.body.classList.toggle('de-design',on); bDesign.classList.toggle('on',on);
    if(!on) clearSelection();
  });
  bPick.addEventListener('click',function(){ panel.classList.toggle('show'); });
  function setPresent(on){ document.body.classList.toggle('de-present',on); bPresent.classList.toggle('on',on); }
  bPresent.addEventListener('click',function(){ setPresent(!document.body.classList.contains('de-present')); });
  bUndo.addEventListener('click',performUndo);
  bReset.addEventListener('click',function(){
    if(!confirm('Clear every saved edit on this page and reload from the git template? This affects the whole page, not just what you last changed, and cannot itself be undone.')) return;
    // PUT ?replace=1 with an empty body, not DELETE. Undo already moved off DELETE for this same
    // endpoint (see the PUT handler's comment) because a two-step delete-then-restore leaves a
    // data-loss window if the second call fails — Reset only ever needed the "swap to {}" half of
    // that, which a single atomic PUT does in one round trip, on the exact request shape every
    // other save on this page already proves works.
    fetch(API+'/api/edits?page='+PAGE+'&replace=1',{method:'PUT',headers:{'content-type':'application/json'},body:'{}'})
      .then(function(res){
        if(!res.ok) return res.text().then(function(t){ throw new Error('http-'+res.status+(t?': '+t.slice(0,140):'')); });
        var ct=res.headers.get('content-type')||'';
        if(ct.indexOf('application/json')<0) throw new Error('non-json response (likely an Access login page) — status '+res.status);
        return res.json();
      })
      .then(function(){ location.reload(); })
      .catch(function(err){
        // Show what actually happened instead of guessing — a real status/body here is worth
        // more than another round of "try signing in again".
        showWarn('&#9888; <b>Reset did not go through</b> &mdash; '+(err&&err.message?err.message:'the request failed')
          +'. Your saved edits are UNCHANGED.');
      });
  });

  // ---- rich text: bold/italic/underline/link on a text selection while in Edit mode ----
  var rtbar=null;
  function hideRtbar(){ if(rtbar){ rtbar.remove(); rtbar=null; } }
  function showRtbar(range){
    hideRtbar();
    rtbar=document.createElement('div'); rtbar.className='de-rtbar';
    rtbar.innerHTML='<button class="b" data-c="bold" title="Bold">B</button>'
      + '<button class="i" data-c="italic" title="Italic">I</button>'
      + '<button class="u" data-c="underline" title="Underline">U</button>'
      + '<button data-c="link" title="Link">🔗</button>'
      + '<button data-c="clear" title="Clear formatting">✕</button>';
    document.body.appendChild(rtbar);
    var r=range.getBoundingClientRect();
    rtbar.style.top=(r.top+window.scrollY-38)+'px';
    rtbar.style.left=Math.max(8,r.left+window.scrollX+r.width/2-70)+'px';
    rtbar.addEventListener('mousedown',function(e){ e.preventDefault(); }); // keep the text selection alive
    rtbar.addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return;
      var cmd=b.getAttribute('data-c');
      var host=lastSel; // the [data-eid] element currently being edited
      if(cmd==='link'){ var u=prompt('Link URL:','https://'); if(u) document.execCommand('createLink',false,u); }
      else if(cmd==='clear') document.execCommand('removeFormat');
      else document.execCommand(cmd);
      if(host) queueSave(host);
      hideRtbar();
    });
  }
  document.addEventListener('selectionchange',function(){
    if(!editing){ hideRtbar(); return; }
    var s=window.getSelection();
    if(!s || s.isCollapsed || !s.rangeCount){ hideRtbar(); return; }
    var el=s.anchorNode && s.anchorNode.nodeType===3 ? s.anchorNode.parentElement : s.anchorNode;
    if(!el || !el.closest || !el.closest('[contenteditable="true"]')){ hideRtbar(); return; }
    showRtbar(s.getRangeAt(0));
  });

  document.addEventListener('input',function(e){ if(!editing) return; var el=e.target.closest?e.target.closest('[data-eid]'):null; if(el) queueSave(el); });
  document.addEventListener('click',function(e){ if(!editing) return; var el=e.target.closest?e.target.closest('[data-eid]'):null;
    if(el && !el.closest('.de-bar') && !el.closest('.de-panel')){
      if(lastSel) lastSel.classList.remove('de-pick'); lastSel=el; el.classList.add('de-pick');
      tgt.innerHTML='Selected <code>&lt;'+el.tagName.toLowerCase()+'&gt;</code> · <code>data-eid="'+el.getAttribute('data-eid')+'"</code> — '+el.textContent.trim().slice(0,40); } }, true);

  panel.querySelector('.de-copy').addEventListener('click',function(){ if(!lastSel){ toast('Click an element first'); return; }
    var eid=lastSel.getAttribute('data-eid');
    var msg='Please edit this element in the FeedSpark "'+PAGE+'" page template (data-eid="'+eid+'"):\\n\\n\`\`\`html\\n'+lastSel.outerHTML+'\\n\`\`\`\\n\\nChange: ';
    copy(msg,'Copied — paste into Claude Code and finish the sentence'); });
  panel.querySelector('.de-copysel').addEventListener('click',function(){ if(!lastSel){ toast('Click an element first'); return; }
    copy('data-eid="'+lastSel.getAttribute('data-eid')+'"','Copied data-eid'); });

  bExport.addEventListener('click',function(){ var patch={}; document.querySelectorAll('[data-eid]').forEach(function(el){ patch[el.getAttribute('data-eid')]=entry(el); });
    copy(JSON.stringify(patch,null,2), 'All edits copied as JSON'); });

  // ---- Feedback module: leave a note on any block or chapter, then generate a single
  // rework prompt for a fresh Claude Code session — the review-round equivalent of
  // "Copy for Claude Code" above, but for accumulated feedback instead of one element.
  function chapterFor(el){
    var marks=[];
    document.querySelectorAll('.chapter h2').forEach(function(h){
      var ch=h.closest('.chapter'); if(!ch) return;
      marks.push({ t: h.textContent.trim(), y: ch.getBoundingClientRect().top+window.scrollY });
    });
    var y=el.getBoundingClientRect().top+window.scrollY, best=null;
    marks.forEach(function(m){ if(m.y<=y+4) best=m; });
    return best ? best.t : 'Intro / hero';
  }
  function targetKey(el){
    if(el.id) return '#'+el.id;
    if(el.getAttribute('data-eid')) return 'eid:'+el.getAttribute('data-eid');
    if(!el.getAttribute('data-fbid')) el.setAttribute('data-fbid','fb'+Math.random().toString(36).slice(2,8));
    return 'fbid:'+el.getAttribute('data-fbid');
  }
  function findByKey(key){
    if(!key) return null;
    if(key.charAt(0)==='#') return document.getElementById(key.slice(1));
    if(key.indexOf('eid:')===0) return document.querySelector('[data-eid="'+key.slice(4)+'"]');
    if(key.indexOf('fbid:')===0) return document.querySelector('[data-fbid="'+key.slice(5)+'"]');
    return null;
  }
  function saveFeedback(){
    fetch(API+'/api/feedback?page='+PAGE,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(FEEDBACK)}).catch(function(){});
  }
  function renderMarkers(){
    document.querySelectorAll('.de-fbmark').forEach(function(m){ m.remove(); });
    FEEDBACK.forEach(function(f){
      var el=findByKey(f.target); if(!el) return;
      var m=document.createElement('div'); m.className='de-fbmark'; m.textContent='💬'; m.title=f.note.slice(0,120);
      var r=el.getBoundingClientRect();
      m.style.top=(r.top+window.scrollY-8)+'px'; m.style.left=(r.left+window.scrollX-8)+'px';
      m.addEventListener('click',function(e){ e.stopPropagation(); fbPanel.classList.add('show'); });
      document.body.appendChild(m);
    });
  }
  function renderFeedbackPanel(){
    var body = FEEDBACK.length ? FEEDBACK.map(function(f){
      var by = f.author ? '<span class="by">'+esc(f.author.split('@')[0])+'</span>' : '';
      return '<div class="de-fbitem"><span class="del" data-id="'+f.id+'">×</span><b>'+esc(f.label.split(' — ')[0])+'</b>'+by+esc(f.note)+'</div>';
    }).join('') : '<div class="de-fbempty">No notes yet. Turn Feedback on, then click any card, table or chapter to leave one.</div>';
    fbPanel.innerHTML = '<h3>💬 Feedback ('+FEEDBACK.length+')</h3>'
      + '<div class="hint">Click a block or chapter while Feedback is on to leave a note there. When you\\'re done, generate a prompt to paste into a Claude Code session.</div>'
      + '<div id="fb-list">'+body+'</div>'
      + '<div class="row"><button class="gen">⤴ Generate rework prompt</button></div>'
      + (FEEDBACK.length ? '<div class="row"><button class="clr">🗑 Clear all</button></div>' : '');
    fbPanel.querySelectorAll('.del').forEach(function(x){ x.addEventListener('click',function(){
      var id=x.getAttribute('data-id'); FEEDBACK=FEEDBACK.filter(function(f){ return f.id!==id; });
      saveFeedback(); renderFeedbackPanel(); renderMarkers(); }); });
    var gen=fbPanel.querySelector('.gen'); if(gen) gen.addEventListener('click',generatePrompt);
    var clr=fbPanel.querySelector('.clr'); if(clr) clr.addEventListener('click',function(){
      if(!confirm('Clear all '+FEEDBACK.length+' feedback notes?')) return;
      FEEDBACK=[]; saveFeedback(); renderFeedbackPanel(); renderMarkers(); });
  }
  function openNotePopup(el){
    document.querySelectorAll('.de-fbnote').forEach(function(p){ p.remove(); });
    var pop=document.createElement('div'); pop.className='de-fbnote';
    pop.innerHTML='<div style="font-size:11px;color:#ED6F0B;text-transform:uppercase;font-weight:800;margin-bottom:6px">'+esc(chapterFor(el))+'</div>'
      + '<textarea placeholder="What should change here?"></textarea>'
      + '<div class="row"><button class="save">Save note</button><button class="cancel">Cancel</button></div>';
    document.body.appendChild(pop);
    var r=el.getBoundingClientRect();
    pop.style.top=(r.top+window.scrollY)+'px';
    pop.style.left=Math.max(8,Math.min(window.innerWidth-276,r.right+window.scrollX+10))+'px';
    var ta=pop.querySelector('textarea'); ta.focus();
    pop.querySelector('.cancel').addEventListener('click',function(){ pop.remove(); });
    pop.querySelector('.save').addEventListener('click',function(){
      var note=ta.value.trim(); if(!note){ pop.remove(); return; }
      FEEDBACK.push({ id:'f'+(fbN++), target:targetKey(el), label:chapterFor(el)+' — "'+el.textContent.trim().replace(/\\s+/g,' ').slice(0,60)+'"', note:note, ts:new Date().toISOString() });
      saveFeedback(); renderFeedbackPanel(); renderMarkers();
      pop.remove(); toast('Feedback saved');
    });
  }
  function generatePrompt(){
    if(!FEEDBACK.length){ toast('No feedback to generate a prompt from'); return; }
    var byChapter={}, order=[];
    FEEDBACK.forEach(function(f){ var ch=f.label.split(' — ')[0]; if(!byChapter[ch]){ byChapter[ch]=[]; order.push(ch); } byChapter[ch].push(f.note); });
    var md='# '+PAGE+' deck — feedback round, '+(new Date().toISOString().slice(0,10))+'\\n\\n'
      + 'Rework the deck at /deck/'+PAGE+' using the feedspark-deck-generator skill, based on this feedback:\\n\\n';
    order.forEach(function(ch){
      md+='## '+ch+'\\n'; byChapter[ch].forEach(function(n){ md+='- '+n.replace(/\\n+/g,' ')+'\\n'; }); md+='\\n';
    });
    md+='Follow the feedspark-deck-generator skill\\'s Step 7: rework the deck, log this round to docs/feedback/'+PAGE+'.md, and update the skill itself if any note here would recur on a future deck.\\n';
    copy(md,'Feedback prompt copied — paste into Claude Code');
  }
  function loadFeedback(){
    fetch(API+'/api/feedback?page='+PAGE).then(function(r){ return r.json(); }).then(function(list){
      FEEDBACK=list||[]; fbN=FEEDBACK.length; renderFeedbackPanel(); renderMarkers();
    }).catch(function(){ FEEDBACK=[]; renderFeedbackPanel(); });
  }
  bFeedback.addEventListener('click',function(){
    var on=!document.body.classList.contains('de-feedback');
    document.body.classList.toggle('de-feedback',on); bFeedback.classList.toggle('on',on);
    fbPanel.classList.toggle('show',on);
  });
  document.addEventListener('click',function(e){
    if(!document.body.classList.contains('de-feedback')) return;
    if(e.target.closest('.de-fbnote,.de-fbpanel,.de-fbmark,.de-bar')) return;
    var el=e.target.closest('[data-de-block],.chapter,header.hero'); if(!el) return;
    openNotePopup(el);
  }, true);
  window.addEventListener('resize',renderMarkers);

  // Ids must exist for EVERY viewer at load time, not just whoever clicks Edit/Design first —
  // otherwise a saved KV patch has nothing to attach to and silently fails to apply for anyone
  // who opens the link read-only (e.g. a client on the call).
  assignEids();
  assignBlockIds();
  // Must run AFTER assignEids (keys exist) and BEFORE loadEdits (nothing applied yet), so
  // these are the signatures of the template as shipped — the thing saved patches are
  // validated against.
  captureBaseSigs();
  SHAPE=shapeOf(); try{ window.__fsShape=SHAPE; }catch(e){}
  initRowDrag();
  initBlockDrag();

  // Last-chance save. pagehide fires on close/navigate/back-forward-cache on desktop AND
  // mobile; visibilitychange->hidden covers tab-switch and app-backgrounding. sendBeacon is
  // used because a normal fetch is cancelled the moment the document goes away, which is the
  // exact moment this needs to work.
  function lastChanceSave(){
    if(RAW) return;
    var keys=Object.keys(dirty); if(!keys.length) return;
    backupLocal(dirty);
    var wire=Object.assign({},dirty,{__meta:{shape:SHAPE, ts:Date.now(), writer:TABID}});
    try{
      if(navigator.sendBeacon){
        var ok=navigator.sendBeacon(API+'/api/edits?page='+PAGE+'&beacon=1',
          new Blob([JSON.stringify(wire)],{type:'application/json'}));
        if(ok){ dirty={}; return; }
      }
    }catch(e){}
    // No beacon (or it refused): a keepalive fetch still usually outlives the document.
    try{ fetch(API+'/api/edits?page='+PAGE,{method:'PUT',keepalive:true,
      headers:{'content-type':'application/json'},body:JSON.stringify(wire)}); dirty={}; }catch(e){}
  }
  window.addEventListener('pagehide', lastChanceSave);
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='hidden') lastChanceSave(); });
  // ?raw=1 — render the git template with the saved overlay NOT applied. Diagnostic escape
  // hatch: when a stale overlay mis-lands after a structural template change (renumbered
  // chapters shift data-eid keys, so a saved delete tombstone can remove the wrong element),
  // the only way to tell "the template is broken" from "the overlay is broken" used to be
  // pressing Reset — which destroyed the overlay to find out. This answers the question
  // without writing anything, and is safe to present from.
  if (RAW) {
    showWarn('&#9888; <b>Raw template view</b> &mdash; your saved edits are <b>not</b> applied on this URL. '
      + 'Nothing has been deleted. Drop <code>?raw=1</code> to see your edited version again.');
  } else {
    loadEdits();
  }
  loadFeedback();
})();
</script>
<!-- Universal exports — every deck gets these for free, no per-deck edits needed.
     Injected here (not hardcoded per deck) so future decks pick them up automatically.
     Print stylesheet stays available (native Cmd/Ctrl+P, and it travels with the exported
     HTML file below too) even though the dedicated PDF button was replaced by "Download HTML". -->
<style>
@page{size:A4 landscape;margin:11mm 13mm}
@media print{
  html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;background:#fff}
  .topbar,.side-nav,.footmark,.scrollcue,.progress,.de-bar,.de-handle,.de-panel,.de-props,.de-toast,.de-resize,[id^="tky-"]{display:none!important}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:100%}
  section{padding:34px 0}
  .hero{min-height:auto;padding:56px 0 40px;break-after:page}
  .chapter{padding:40px 0;break-before:page;break-inside:avoid}
  .chapter+section{break-before:avoid}
  .ch-num{font-size:120px}
  .band,.band-warm{break-inside:avoid-page}
  .rv{opacity:1!important;transform:none!important;transition:none!important}
  .fill{transition:none!important}
  .card,.stat,.tier,.proto,.pipe-card,.flow-step,.mo,.sc-cell,.ask,.ct,.en-card,table tr{break-inside:avoid}
  .stats,.grid-2,.grid-3,.grid-4,.tiers,.road,.pipe,.flow,.sc-grid,.contacts{break-inside:avoid-page}
  .qs,.agent-l>p{display:none}
  .close{break-before:page}
  .card,.proto,.pipe-card,.tier,.en-card{box-shadow:none}
}
</style>
<script>
(function(){
  // client decks only — the FCC app pages (/, /workflow, …) aren't a download deliverable
  if(!/^\\/deck\\//.test(location.pathname)) return;
  function preparePrint(){
    document.querySelectorAll('.rv').forEach(function(el){ el.classList.add('in'); });
    document.querySelectorAll('.fill[data-w]').forEach(function(el){ var w=el.getAttribute('data-w'); if(w) el.style.width=w+'%'; });
  }
  window.addEventListener('beforeprint', preparePrint);
  window.__fsPreparePrint = preparePrint;
})();
</script>
<!-- "Download HTML" — bakes in the current live state (KV text edits + reveal/bar-fill
     animations already applied), strips every internal-only element (editor widget,
     data-check flags, data-eid/de-block attributes, contenteditable) so the exported file is
     safe and clean to email or hand straight to an external client — no Cloudflare Access
     gate, no dependency on the live worker or its /api endpoints. The client's copy keeps
     the print stylesheet above (self-contained, no API calls) so they can still save their
     own PDF from it if they want one, but not the export button itself — no reason for them
     to re-export a file they already have. -->
<script>
(function(){
  // client decks only — the FCC app pages (/, /workflow, …) aren't a client deliverable
  if(!/^\\/deck\\//.test(location.pathname)) return;
  function slug(s){ return (s||'strategy-review').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'strategy-review'; }
  function buildClientHtml(){
    if(window.__fsPreparePrint) window.__fsPreparePrint();
    var doc = document.cloneNode(true);
    // [class^="de-"] catches every editor-widget element by convention (.de-bar, .de-fbpanel,
    // .de-fbmark, .de-fbnote, .de-rtbar, .de-toast, ... — confirmed nothing in the shared deck
    // design system uses that prefix) instead of an enumerated list, which already proved easy
    // to under-specify: the first version of this missed .de-fbpanel/.de-fbmark/.de-fbnote/
    // .de-rtbar entirely, leaking a visible "Feedback" panel into exported client files.
    // GUARD: <body> itself carries a de-* class whenever Edit/Design/Feedback mode is active
    // (de-on/de-design/de-feedback) — exporting mid-session matched body against this same
    // selector and deleted the entire <body>, producing a silently blank file. Never remove
    // the document's own root containers, no matter what selector matched them; body's own
    // de-* mode classes are stripped separately below (as classes, not as element removal).
    ['[class^="de-"]','#fs-editor-css','#htmlBtn'].forEach(function(sel){
      Array.prototype.slice.call(doc.querySelectorAll(sel)).forEach(function(el){
        if(el===doc.body || el===doc.documentElement || el===doc.head) return;
        el.remove();
      });
    });
    Array.prototype.slice.call(doc.querySelectorAll('.chk')).forEach(function(el){ el.remove(); });
    // .int-note carries notes written to FeedSpark, never to the client — a figure still to
    // be confirmed, a source that was not reachable, a decision Ray has to make. Stripped
    // here as well as in tools/deck_to_pptx.py, so neither client-bound output can leak one.
    Array.prototype.slice.call(doc.querySelectorAll('.int-note')).forEach(function(el){ el.remove(); });
    // hide, don't remove: every deck's own template script unconditionally does
    // document.getElementById('flagbtn').addEventListener(...) — removing the element makes
    // that call throw on the exported file's own load and can abort the rest of that script
    // (topbar scroll-spy, reveal/bar observers, the interactive attribute picker). Nothing
    // left to toggle anyway once .chk markers are stripped below, so hiding is equivalent.
    var flag = doc.getElementById('flagbtn'); if(flag){ flag.style.display='none'; flag.removeAttribute('aria-pressed'); }
    Array.prototype.slice.call(doc.querySelectorAll('[data-eid]')).forEach(function(el){ el.removeAttribute('data-eid'); });
    Array.prototype.slice.call(doc.querySelectorAll('[data-ck]')).forEach(function(el){ el.removeAttribute('data-ck'); });
    // Provenance. A downloaded file is a THIRD source of truth alongside the template and the
    // overlay, and until now it carried nothing to say which version it forked from — so a
    // file handed back weeks later could not be diffed against anything. A meta tag survives
    // the comment strip below and tells you exactly what this copy is.
    try{
      var m=doc.createElement('meta'); m.setAttribute('name','fs-export');
      m.setAttribute('content', (location.pathname||'').replace(/^\\//,'')
        + ' · exported ' + new Date().toISOString().slice(0,16).replace('T',' ') + 'Z'
        + (window.__fsShape ? ' · shape ' + window.__fsShape : ''));
      if(doc.head) doc.head.appendChild(m);
    }catch(e){}
    Array.prototype.slice.call(doc.querySelectorAll('[data-de-block]')).forEach(function(el){ el.removeAttribute('data-de-block'); });
    Array.prototype.slice.call(doc.querySelectorAll('[contenteditable]')).forEach(function(el){ el.removeAttribute('contenteditable'); });
    Array.prototype.slice.call(doc.querySelectorAll('[spellcheck]')).forEach(function(el){ el.removeAttribute('spellcheck'); });
    if(doc.body) doc.body.className = doc.body.className.replace(/\\bde-\\S+/g,'').replace(/\\bhide-checks\\b/g,'').trim();
    Array.prototype.slice.call(doc.querySelectorAll('script')).forEach(function(s){
      var t = s.textContent||'';
      if(/armUndo|assignEids|loadFeedback|buildClientHtml/.test(t)) s.remove();
    });
    // strip every HTML comment — some (like this feature's own build notes) reference internal
    // implementation detail (KV edits, Access gating, worker.js internals) that has no business
    // sitting in a file a client could View Source on.
    if(doc.createTreeWalker){
      var walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
      var comments = [], n;
      while((n = walker.nextNode())) comments.push(n);
      comments.forEach(function(c){ if(c.parentNode) c.parentNode.removeChild(c); });
    }
    return '<!doctype html>\\n' + doc.documentElement.outerHTML;
  }
  function downloadClientHtml(){
    var html = buildClientHtml();
    var blob = new Blob([html], {type:'text/html'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    // Date-stamped: successive downloads used to share one filename, so the browser either
    // overwrote the previous export or silently appended (1), (2) — leaving no way to tell
    // which file was presented from.
    a.href = url; a.download = slug(document.title) + '-' + new Date().toISOString().slice(0,10) + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }
  function addBtn(){
    if(document.getElementById('htmlBtn')) return;
    var btn=document.createElement('button');
    btn.id='htmlBtn'; btn.className='flagbtn'; btn.title='Download a clean, standalone HTML copy to send to a client';
    btn.textContent='⬇ Download HTML'; btn.style.marginLeft='8px';
    btn.addEventListener('click', downloadClientHtml);
    var flag=document.getElementById('flagbtn');
    var host=document.querySelector('.topbar-in');
    if(flag && flag.parentNode) flag.insertAdjacentElement('afterend', btn);
    else if(host) host.appendChild(btn);
    else { btn.style.cssText+=';position:fixed;top:14px;right:14px;z-index:99999;background:#fff'; document.body.appendChild(btn); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', addBtn); else addBtn();
})();
</script>`;
}
