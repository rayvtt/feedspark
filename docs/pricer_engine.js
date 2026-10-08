/*
 * Services & Pricer engine — pure quote maths for the /pricer module. UMD like feedlab_engine:
 * browser (globalThis.PricerEngine) + node tests run the exact same file. No imports, no DOM.
 * The labelguard module (LG), FeedArrivals (Arr) and FeedAudit are HANDED IN by the caller —
 * this file never loads one, so the page, an agent and tools/test_pricer.mjs run it alike.
 *
 * Two models live here:
 *   v1 (the custom quote, unchanged maths — the AI Quote reads CATALOG, saved quotes re-render
 *      from it): picks × one volume through the tier ladder, set-up block-rounded.
 *   v2 (the services package, 7 Oct 2026 — "Services & Pricer"): a client × markets AUDIT read
 *      from the Golden Record stores (stored lane) or the live stream (exact needs per parent),
 *      priced line by line on the parent products that actually NEED each line, two cumulative
 *      tiers, the conversational six on Spark AI's own engine (a verbatim twin, below), and a
 *      client-safe guard that hides every figure a blocker still stands behind. See the
 *      SERVICES section further down.
 *
 * Commercial model (v1):
 *   one-off  = setup hours (ASPL + AM QC + PM, per optimisation) rounded UP to 8h retainer
 *              blocks × block £  +  Tachyon processing (unit £/product × volume through the
 *              MARGINAL tier ladder — each band priced like tax brackets)
 *   monthly  = monitoring hours/mo (block-rounded unless "absorb into existing retainer")
 *              + optional refresh processing (newPct of volume × unit £/product each month)
 *   sla      = longest selected lead time + 2 working days per extra optimisation (stagger)
 *   VOLUME UNIT = PARENT PRODUCTS — unique g:item_group_id, NOT variant SKUs (Ray, 10 Sep
 *              2026: "for parent products (g:item_group_id) because of unique products").
 *              Tachyon generates once per unique product and the variants inherit, so a
 *              dress in six sizes is ONE billable unit. parentCounter() below is the single
 *              counting rule every page streams a feed through; a row with no item_group_id
 *              is its own product, so single-SKU catalogues price 1:1.
 * All prices ex VAT, and every surface says "ex VAT" — no VAT row, no VAT-inclusive figure, no
 * annual or ×12 money anywhere (one-off and monthly are always shown apart).
 */
(function (g) {
  'use strict';

  // The Tachyon catalogue ("What We Do") — 11 optimisations in 6 groups. RETIRED entries (must
  // stay gone): an "AI Text Attribute Extraction" entry was added 10 Sep 2026 and pulled the same
  // day — Ray: "not needed ever"; the two "AI Pre-Description" entries (plain + Highlighting
  // Attributes) were pulled 10 Sep 2026 — Ray: "remove AI Pre Description also". Their
  // handback rows in the Pricer tracker stay as untagged billing history; classifyTach below
  // sends that wording to '' so it can never fall through to the AI Description slot.
  // Hours/unit rates are DRAFT defaults: the collaborative rate card (KV `tachyonrates`) overrides every field, and
  // the module flags rows still on draft values. id keys are stable — KV merges hang off them.
  var CATALOG = [
    { id: 'title_gen',      grp: 'AI Titles',                    name: 'AI Product Title Generation',            aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.08, lead: 10 },
    { id: 'title_short',    grp: 'AI Titles',                    name: 'AI Short Title Generation',              aspl: 4,  qc: 2, pm: 1, mon: 1, unit: 0.05, lead: 7 },
    { id: 'title_intent',   grp: 'AI Titles',                    name: 'Title with AI Search Intent',            aspl: 8,  qc: 4, pm: 2, mon: 2, unit: 0.12, lead: 12 },
    { id: 'desc_gen',       grp: 'AI Description',               name: 'AI Product Description Generation',      aspl: 8,  qc: 4, pm: 3, mon: 3, unit: 0.15, lead: 14 },
    { id: 'desc_pro',       grp: 'AI Description',               name: 'AI Description Pro (Compare & Q/A)',     aspl: 12, qc: 6, pm: 3, mon: 4, unit: 0.25, lead: 18 },
    { id: 'highlights',     grp: 'Product Highlights & Details', name: 'AI Product Highlights',                  aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.10, lead: 10 },
    { id: 'details',        grp: 'Product Highlights & Details', name: 'AI Product Details',                     aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.10, lead: 10 },
    { id: 'keywords',       grp: 'AI Keywords',                  name: 'AI Keyword Generation',                  aspl: 5,  qc: 3, pm: 2, mon: 2, unit: 0.06, lead: 8 },
    { id: 'visual_attr',    grp: 'AI Visual Attributes',         name: 'AI Visual Attribute Extraction',         aspl: 10, qc: 5, pm: 3, mon: 3, unit: 0.20, lead: 15 },
    { id: 'gpc',            grp: 'GPC Mapping & PT',             name: 'AI GPC Mapping',                         aspl: 6,  qc: 3, pm: 2, mon: 1, unit: 0.05, lead: 8 },
    { id: 'pt_class',       grp: 'GPC Mapping & PT',             name: 'AI Product Type Classification',         aspl: 6,  qc: 3, pm: 2, mon: 1, unit: 0.05, lead: 8 }
  ];

  // PACKAGE-ONLY rate rows (services v2). Deliberately NOT in CATALOG: the AI Quote builds its
  // field catalogue straight from CATALOG, so a row added there would appear as a priceable
  // per-SKU field on every quote. attr_pop is priced per VALUE (colour / material / pattern
  // per SKU), every number starts unset — Management prices it, ASPL and London enter the hours.
  var PKG_ROWS = [
    { id: 'attr_pop', grp: 'AI Attributes', name: 'AI Attribute Population (colour · material · pattern)',
      aspl: null, qc: null, pm: null, mon: null, unit: null, lead: null, grain: 'sku' }
  ];

  // Retainer + tier defaults (rate card can override all of it).
  // blockGBP/blockHours = the London ratecard (£585 ex VAT per 8h → £73.125/h).
  // tiers = MARGINAL volume ladder on the Tachyon unit rate.
  var DEFAULTS = {
    blockGBP: 585, blockHours: 8,
    tiers: [
      { upTo: 5000,     x: 1.0 },
      { upTo: 20000,    x: 0.8 },
      { upTo: 50000,    x: 0.65 },
      { upTo: Infinity, x: 0.5 }
    ],
    staggerDays: 2
  };

  function round2(n) { return Math.round(n * 100) / 100; }

  // effective rate row: catalogue defaults overlaid with the collaborative rate card
  function effRow(base, over) {
    var r = { id: base.id, grp: base.grp, name: base.name, aspl: base.aspl, qc: base.qc, pm: base.pm,
      mon: base.mon, unit: base.unit, lead: base.lead, note: '', draft: true };
    if (over && typeof over === 'object') {
      ['aspl', 'qc', 'pm', 'mon', 'unit', 'lead'].forEach(function (k) {
        if (over[k] != null && over[k] !== '' && isFinite(+over[k])) { r[k] = +over[k]; }
      });
      if (over.note) r.note = String(over.note);
      // any explicit save (even re-confirming a default) clears the draft flag
      if (over.t || Object.keys(over).some(function (k) { return ['aspl','qc','pm','mon','unit','lead','note'].indexOf(k) >= 0; })) r.draft = false;
    }
    return r;
  }
  function rates(overrides) {
    overrides = overrides || {};
    return CATALOG.map(function (b) { return effRow(b, overrides[b.id]); });
  }

  // marginal tier maths: each band of volume (parent products) pays unit × band multiplier
  function tieredUnits(volume, tiers) {
    tiers = tiers && tiers.length ? tiers : DEFAULTS.tiers;
    var left = Math.max(0, Math.floor(+volume || 0)), prev = 0, units = 0, bands = [];
    for (var i = 0; i < tiers.length && left > 0; i++) {
      var cap = tiers[i].upTo, take = Math.min(left, cap - prev);
      // `products` is the band's unit count; `skus` kept as an alias for older readers
      if (take > 0) { units += take * tiers[i].x; bands.push({ from: prev, upTo: Math.min(cap, prev + take), x: tiers[i].x, products: take, skus: take }); left -= take; prev += take; }
      else prev = cap;
    }
    return { units: units, bands: bands };
  }

  // ---- parent products: the pricing unit ------------------------------------------------
  // Streams a feed's rows (the Feed Lab parser contract: first row = header) and counts
  // DISTINCT g:item_group_id. A row without one is its own product (keyed on id, else the
  // row number), so a variant-less catalogue counts 1:1 and never prices at zero.
  // normKey = FeedAudit.normKey when available (strips g:/c:, |||N, BOM); falls back to a
  // local equivalent so node tests need no parser. result() = { rows, products, grouped,
  // hasGroups, ratio } where grouped = rows carrying an item_group_id and ratio = SKUs
  // per product (the variant multiplier the page shows beside the volume).
  // THE LIVE HEADER (services v2): the Feed Lab XML parser GROWS its header when a tag first
  // appears past its 50-item sample and hands the live array to onRow as a second argument.
  // Resolving item_group_id once from the first row meant a feed whose groups debut late counted
  // every SKU as its own product (ratio 1). row(r, liveHeader) re-resolves whenever that Array
  // grows; rows before the debut had no group by definition, so they stay keyed on their id. A
  // non-Array second argument (catalog_engine's delimParser passes a row NUMBER) is ignored.
  function parentCounter(normKey) {
    var ig = -1, idc = -1, n = 0, grouped = 0, seen = {}, products = 0, hdr = false, hlen = 0;
    function nk(s) {
      var k = normKey ? normKey(s) : String(s == null ? '' : s).replace(/^\uFEFF/, '').trim().replace(/^[gc]:/i, '').toLowerCase();
      return k.replace(/[^a-z0-9]/g, '');
    }
    var pc = {
      header: function (r) {
        hdr = true; hlen = (r || []).length;
        for (var i = 0; i < (r || []).length; i++) { var k = nk(r[i]); if (ig < 0 && k === 'itemgroupid') ig = i; if (idc < 0 && k === 'id') idc = i; }
      },
      row: function (r, liveHeader) {
        if (!hdr) { pc.header(r); return; }
        if (Array.isArray(liveHeader) && liveHeader.length !== hlen) pc.header(liveHeader);
        n++;
        var g = ig >= 0 ? String(r[ig] == null ? '' : r[ig]).trim() : '', key;
        if (g) { grouped++; key = 'g:' + g; }
        else { var id = idc >= 0 ? String(r[idc] == null ? '' : r[idc]).trim() : ''; key = id ? 'i:' + id : 'r:' + n; }
        if (!seen[key]) { seen[key] = 1; products++; }
      },
      result: function () {
        return { rows: n, products: products, grouped: grouped, hasGroups: ig >= 0,
          ratio: products ? Math.round(n / products * 10) / 10 : 0 };
      }
    };
    return pc;
  }

  // The quote. picks = [optimisation ids]; opts = { volume (PARENT PRODUCTS), skus (the
  // variant SKUs behind that volume — informational, echoed on the quote), rateOverrides,
  // blockGBP, blockHours, tiers, absorbMonitoring, refreshPct (0-1 of volume reprocessed
  // monthly), client, market }
  function quote(picks, opts) {
    opts = opts || {};
    var R = {}; rates(opts.rateOverrides).forEach(function (r) { R[r.id] = r; });
    var rows = (picks || []).map(function (id) { return R[id]; }).filter(Boolean);
    var blockGBP = isFinite(+opts.blockGBP) && +opts.blockGBP > 0 ? +opts.blockGBP : DEFAULTS.blockGBP;
    var blockHours = isFinite(+opts.blockHours) && +opts.blockHours > 0 ? +opts.blockHours : DEFAULTS.blockHours;
    var vol = Math.max(0, Math.floor(+opts.volume || 0));
    var skus = Math.max(0, Math.floor(+opts.skus || 0));
    var tv = tieredUnits(vol, opts.tiers);

    var h = { aspl: 0, qc: 0, pm: 0, mon: 0 }, tach = 0, lead = 0, lines = [], draft = false;
    rows.forEach(function (r) {
      h.aspl += r.aspl; h.qc += r.qc; h.pm += r.pm; h.mon += r.mon;
      var t = round2(r.unit * tv.units);
      tach += t; lead = Math.max(lead, r.lead); draft = draft || r.draft;
      lines.push({ id: r.id, name: r.name, grp: r.grp, hours: r.aspl + r.qc + r.pm, mon: r.mon,
        unit: r.unit, tachyon: t, lead: r.lead, draft: r.draft });
    });
    var setupHours = h.aspl + h.qc + h.pm;
    var blocks = Math.ceil(setupHours / blockHours);
    var monBlocks = Math.ceil(h.mon / blockHours);
    var oneOff = { hours: setupHours, byRole: { aspl: h.aspl, qc: h.qc, pm: h.pm },
      blocks: blocks, blockCost: round2(blocks * blockGBP),
      tachyon: round2(tach), total: round2(blocks * blockGBP + tach) };
    var refreshPct = Math.max(0, Math.min(1, +opts.refreshPct || 0));
    var refreshTach = round2(tach * refreshPct);
    var monthly = { monHours: h.mon, absorbed: !!opts.absorbMonitoring,
      blocks: opts.absorbMonitoring ? 0 : monBlocks,
      blockCost: opts.absorbMonitoring ? 0 : round2(monBlocks * blockGBP),
      refreshPct: refreshPct, refreshTachyon: refreshTach,
      total: round2((opts.absorbMonitoring ? 0 : monBlocks * blockGBP) + refreshTach) };
    var sla = rows.length ? lead + (rows.length - 1) * (isFinite(+opts.staggerDays) ? +opts.staggerDays : DEFAULTS.staggerDays) : 0;
    return { picks: rows.map(function (r) { return r.id; }), volume: vol, unit: 'product', skus: skus, tier: tv,
      blockGBP: blockGBP, blockHours: blockHours, lines: lines,
      oneOff: oneOff, monthly: monthly, slaDays: sla, draftRates: draft,
      client: opts.client || '', market: opts.market || '' };
  }

  // client-ready quote text. Every figure is ex VAT and SAYS so — never a VAT-inclusive number.
  // The client-facing name of the generation engine is Spark AI (the AI Quote's and the
  // website's word); the quote's field names (`tachyon`) stay, saved quotes read them.
  function fmtGBP(n) { return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function quoteText(q) {
    var L = [];
    L.push('SPARK AI OPTIMISATION — ' + (q.client || 'Client') + (q.market ? ' (' + q.market.toUpperCase() + ')' : ''));
    L.push('Volume: ' + q.volume.toLocaleString('en-GB') + ' parent products (unique g:item_group_id)'
      + (q.skus > q.volume ? ' — ' + q.skus.toLocaleString('en-GB') + ' variant SKUs inherit the generated fields' : ''));
    L.push('');
    q.lines.forEach(function (l) {
      L.push('· ' + l.name + ' — setup ' + l.hours + 'h · Spark AI ' + fmtGBP(l.tachyon) + ' · live in ~' + l.lead + ' working days');
    });
    L.push('');
    L.push('ONE-OFF SETUP');
    L.push('  Team setup: ' + q.oneOff.hours + 'h (ASPL ' + q.oneOff.byRole.aspl + ' · QC ' + q.oneOff.byRole.qc + ' · PM ' + q.oneOff.byRole.pm + ') = ' + q.oneOff.blocks + ' × ' + fmtGBP(q.blockGBP) + ' block = ' + fmtGBP(q.oneOff.blockCost) + ' ex VAT');
    L.push('  Spark AI processing (volume-tiered): ' + fmtGBP(q.oneOff.tachyon) + ' ex VAT');
    L.push('  One-off total: ' + fmtGBP(q.oneOff.total) + ' ex VAT');
    L.push('');
    L.push('ONGOING (MONTHLY)');
    if (q.monthly.absorbed) L.push('  Monitoring: ' + q.monthly.monHours + 'h/mo — absorbed into the existing retainer');
    else L.push('  Monitoring: ' + q.monthly.monHours + 'h/mo = ' + q.monthly.blocks + ' × ' + fmtGBP(q.blockGBP) + ' = ' + fmtGBP(q.monthly.blockCost) + ' ex VAT');
    if (q.monthly.refreshPct > 0) L.push('  New/refreshed products (~' + Math.round(q.monthly.refreshPct * 100) + '%/mo): ' + fmtGBP(q.monthly.refreshTachyon) + ' ex VAT');
    L.push('  Monthly total: ' + fmtGBP(q.monthly.total) + ' ex VAT');
    L.push('');
    L.push('Live in ~' + q.slaDays + ' working days from sign-off.');
    if (q.draftRates) L.push('[DRAFT RATES — hours/unit prices pending confirmation in the FCC rate card]');
    return L.join('\n');
  }

  // ---- AI-brief detection: the Pricer finds AI work by SCANNING TASK TITLES ------------
  // (Ray: tracking lives here, not in the Workflow pipeline). classifyTach maps wording to a
  // catalogue id; aiBriefRows joins every scanned-or-tracked brief with its tracking record.
  // The names briefTask() leads a services brief with, for the three package lines that have no
  // rate row. Conversational work is Spark AI's (priced and tracked by the AI Quote), FeedHero
  // rules are hours, and client data is never ours to brief — so all three classify to ''.
  var BRIEF_NAME = { conv: 'Conversational attributes (Spark AI)', attr_rule: 'FeedHero attribute rules', client: 'Client data to supply' };
  var BRIEF_HEAD = {};
  CATALOG.concat(PKG_ROWS).forEach(function (c) { BRIEF_HEAD[c.name.toLowerCase()] = c.id; });
  Object.keys(BRIEF_NAME).forEach(function (k) { BRIEF_HEAD[BRIEF_NAME[k].toLowerCase()] = ''; });
  function classifyTach(t) {
    t = String(t || '').toLowerCase();
    if (!/\bai\b|tachyon/.test(t)) return '';
    // A SERVICES BRIEF IS READ BY ITS LEAD SEGMENT (briefTask writes '<name> — <Client> <MKT> —
    // <label>'): the wording rules below scan the whole title, so a client or label carrying one
    // of their words ("Visual K", a "compare" in a label) would re-tag the brief. A title whose
    // first ' — ' segment IS a catalogue name is that optimisation — nothing else is consulted.
    var head = t.split(' — ')[0].trim();
    if (Object.prototype.hasOwnProperty.call(BRIEF_HEAD, head)) return BRIEF_HEAD[head];
    if (/short title/.test(t)) return 'title_short';
    if (/search intent/.test(t)) return 'title_intent';
    // RETIRED wording (AI Pre-Description, 10 Sep 2026) stays untagged — it must NOT fall
    // through to the /desc/ rule and pollute the AI Description averages
    if (/pre.?desc/.test(t)) return '';
    // conversational attributes are Spark AI work, priced and tracked by the AI Quote — and
    // "Q&A" in their briefs used to land them in the AI Description Pro averages
    if (/conversational/.test(t)) return '';
    if (/attribute population/.test(t)) return 'attr_pop';
    if (/description pro|q\/?a|q\s*&\s*a|question.{0,12}answer|compare/.test(t)) return 'desc_pro';
    if (/desc/.test(t)) return 'desc_gen';
    if (/highlight/.test(t)) return 'highlights';
    if (/product detail/.test(t)) return 'details';
    if (/keyword/.test(t)) return 'keywords';
    if (/visual|image attr/.test(t)) return 'visual_attr';
    if (/gpc/.test(t)) return 'gpc';
    if (/product type|classif/.test(t)) return 'pt_class';
    if (/title/.test(t)) return 'title_gen';
    return '';
  }
  // briefs = the Workflow briefs map; track = KV `tachyontrack` (briefId -> {tach, aspl, qc,
  // pm, mon, tokens, billTok, runOne, runPar, volDone, prodDone, catsDone, t}). tokens =
  // ACTUAL tokens consumed; billTok = billing tokens (actual × model cost multiplier); billing
  // units are always derived (billTok ÷ 1M), never stored. runOne/runPar = AI running time in
  // MINUTES (single request / 25 parallel requests). volDone = variant SKUs delivered;
  // prodDone = PARENT PRODUCTS delivered (the billing unit — when absent, the brand's
  // clientMeta.prodGroups stands in). A brief joins the table when its TITLE scans as AI work
  // or a track record exists; the track's explicit tach overrides the scan.
  function trackNums(tr) {
    return { aspl: +tr.aspl || 0, qc: +tr.qc || 0, pm: +tr.pm || 0, mon: +tr.mon || 0,
      tokens: +tr.tokens || 0, billTok: +tr.billTok || 0,
      runOne: +tr.runOne || 0, runPar: +tr.runPar || 0,
      volDone: +tr.volDone || 0, prodDone: +tr.prodDone || 0, catsDone: String(tr.catsDone || '') };
  }
  // A stored tag only counts while its optimisation is still in the catalogue: a KV record
  // tagged with a RETIRED id (the Pre-Description handbacks) reads as untagged, so the
  // tracker shows "— pick —" and no orphan slot leaks into the actuals.
  var LIVE_IDS = {};
  CATALOG.concat(PKG_ROWS).forEach(function (c) { LIVE_IDS[c.id] = 1; });
  function liveTag(v) { return (typeof v === 'string' && LIVE_IDS[v]) ? v : ''; }
  function aiBriefRows(briefs, track) {
    track = track || {};
    var rows = [];
    Object.keys(briefs || {}).forEach(function (k) {
      var b = briefs[k]; if (!b) return;
      var scanned = classifyTach(b.task);
      var tr = track[k] || {};
      if (!scanned && !liveTag(tr.tach) && !Object.keys(tr).length) return;
      var done = b.status === 'done' || b.status === 'confirmed' || b.status === 'running' || b.status === 'analysis';
      var row = trackNums(tr);
      row.bid = k; row.client = b.client || ''; row.task = b.task || ''; row.status = b.status || 'intake';
      row.done = done; row.created = +b.created || 0; row.tach = liveTag(tr.tach) || scanned || '';
      rows.push(row);
    });
    // manual/historic entries: track records with no Workflow brief behind them (AI work
    // done before the FCC existed, or delivered runs handed back by ASPL). They carry their
    // own client + task and count toward the averages exactly like scanned briefs — minus
    // lead time (no ticket history).
    Object.keys(track).forEach(function (k) {
      if ((briefs || {})[k] || !track[k] || !track[k].manual || track[k].deleted) return;
      var tr = track[k];
      var row = trackNums(tr);
      row.bid = k; row.client = String(tr.client || ''); row.task = String(tr.task || '');
      row.status = 'historic'; row.done = true; row.manual = true; row.created = +tr.t || 0;
      row.tach = liveTag(tr.tach) || classifyTach(tr.task) || '';
      rows.push(row);
    });
    rows.sort(function (a, b2) { return (b2.created || 0) - (a.created || 0); });
    return rows;
  }

  // ---- actuals: learn the real hours from tagged Workflow briefs -----------------------
  // Each brief may carry b.tach (one optimisation id) + b.hours {aspl,qc,pm,mon} tagged by the
  // teams as the work happens. The average across every tagged brief per optimisation becomes
  // the evidence-based rate ("price = the average of all the briefs done", Ray). Bundles
  // (multi-optimisation briefs) are excluded — their hours can't be attributed cleanly.
  // Actual lead time comes from the ticket history (briefed → done days) when present.
  // Token economics come out per PARENT PRODUCT (the billing unit) as tokPerProd/billPerProd —
  // denominator = the brief's prodDone, else the brand's clientMeta.prodGroups from the dev
  // handback — and per variant SKU (tokPerSku/billPerSku over volDone) for the delivery view.
  function actualsFromBriefs(briefs, track) {
    var acc = {};
    var metaProd = {};   // client -> parent products covered (clientMeta.prodGroups)
    Object.keys(track || {}).forEach(function (k) {
      var tr = track[k]; if (!tr || !tr.clientMeta || tr.deleted || !tr.client) return;
      if (+tr.prodGroups > 0) metaProd[String(tr.client).trim().toLowerCase()] = +tr.prodGroups;
    });
    function slot(tach) {
      return acc[tach] = acc[tach] || { n: 0, aspl: 0, qc: 0, pm: 0, mon: 0, leadN: 0, lead: 0,
        tok: 0, bill: 0, vol: 0, ptok: 0, pbill: 0, prod: 0 };
    }
    // one record's contribution; returns the accumulator only when HOURS were tagged (lead
    // time is measured on those briefs alone)
    function tally(tach, tr, client, h) {
      var any = h.aspl > 0 || h.qc > 0 || h.pm > 0 || h.mon > 0;
      var tokens = +tr.tokens || 0, volDone = +tr.volDone || 0;
      var prod = +tr.prodDone || metaProd[String(client || '').trim().toLowerCase()] || 0;
      if (!any && !(tokens > 0 && (volDone > 0 || prod > 0))) return null;
      var a = slot(tach);
      if (any) { a.n++; ['aspl', 'qc', 'pm', 'mon'].forEach(function (f) { a[f] += Math.max(0, h[f]); }); }
      if (tokens > 0 && volDone > 0) { a.tok += tokens; a.bill += (+tr.billTok || 0); a.vol += volDone; }
      if (tokens > 0 && prod > 0) { a.ptok += tokens; a.pbill += (+tr.billTok || 0); a.prod += prod; }
      return any ? a : null;
    }
    Object.keys(briefs || {}).forEach(function (k) {
      var b = briefs[k]; if (!b) return;
      var tr = (track || {})[k] || {};
      // track record wins; a brief-embedded tag (the retired Workflow tagging) still counts;
      // otherwise the TITLE SCAN decides — same rule that builds the tracking table
      var tach = liveTag(tr.tach) || liveTag(b.tach) || classifyTach(b.task);
      if (!tach) return;
      var h = { aspl: +tr.aspl || +(b.hours || {}).aspl || 0, qc: +tr.qc || +(b.hours || {}).qc || 0,
        pm: +tr.pm || +(b.hours || {}).pm || 0, mon: +tr.mon || +(b.hours || {}).mon || 0 };
      var a = tally(tach, tr, b.client, h);
      if (!a) return;
      var t0 = 0, t1 = 0;
      (b.hist || []).forEach(function (e) {
        if (e.s === 'briefed' && !t0) t0 = +e.t || 0;
        if ((e.s === 'done' || e.s === 'confirmed' || e.s === 'running' || e.s === 'analysis') && !t1) t1 = +e.t || 0;
      });
      if (t0 && t1 && t1 > t0) { a.leadN++; a.lead += (t1 - t0) / 86400000; }
    });
    // manual/historic records join the averages too (no lead — nothing to measure)
    Object.keys(track || {}).forEach(function (k) {
      if ((briefs || {})[k]) return;
      var tr = track[k]; if (!tr || !tr.manual || tr.deleted) return;
      var tach = liveTag(tr.tach) || classifyTach(tr.task);
      if (!tach) return;
      tally(tach, tr, tr.client, { aspl: +tr.aspl || 0, qc: +tr.qc || 0, pm: +tr.pm || 0, mon: +tr.mon || 0 });
    });
    var out = {};
    Object.keys(acc).forEach(function (id) {
      var a = acc[id];
      if (!a.n && !a.vol && !a.prod) return;
      out[id] = { n: a.n,
        aspl: a.n ? round2(a.aspl / a.n) : 0, qc: a.n ? round2(a.qc / a.n) : 0,
        pm: a.n ? round2(a.pm / a.n) : 0, mon: a.n ? round2(a.mon / a.n) : 0,
        lead: a.leadN ? Math.max(1, Math.round(a.lead / a.leadN)) : null,
        tokPerSku: a.vol > 0 ? round2(a.tok / a.vol) : null,
        billPerSku: a.vol > 0 && a.bill > 0 ? round2(a.bill / a.vol) : null, volDone: a.vol,
        tokPerProd: a.prod > 0 ? round2(a.ptok / a.prod) : null,
        billPerProd: a.prod > 0 && a.pbill > 0 ? round2(a.pbill / a.prod) : null, prodDone: a.prod };
    });
    return out;
  }
  // ---- per-brand token & runtime summary (mirrors the ASPL dev handback sheet) ----------
  // Sums the tracking table per client: actual tokens, billing tokens (units derived ÷1M) and
  // the two running-time totals. volDone is the MAX across the brand's briefs, not the sum —
  // every optimisation runs over the same catalogue, so summing would double-count products.
  // Brand-level facts that can't be split per brief live in `clientMeta` track records
  // (key -> {clientMeta:true, client, manh, prodGroups, prodVariants}): manh = TOTAL MAN TIME
  // for the brand's AI briefs, assigned to ASPL hours (Ray, Aug 2026 — the dev handback
  // reports it per brand, so a per-brief split would be invented data).
  function clientSummary(rows, track) {
    var by = {}, order = [];
    function slot(c) {
      var key = String(c || '').trim() || '—';
      if (!by[key]) { by[key] = { client: key, n: 0, tokens: 0, billTok: 0, runOne: 0, runPar: 0, volDone: 0, manh: null, metaKey: '' }; order.push(key); }
      return by[key];
    }
    (rows || []).forEach(function (r) {
      var s = slot(r.client);
      s.n++; s.tokens += (+r.tokens || 0); s.billTok += (+r.billTok || 0);
      s.runOne += (+r.runOne || 0); s.runPar += (+r.runPar || 0);
      s.volDone = Math.max(s.volDone, +r.volDone || 0);
    });
    Object.keys(track || {}).forEach(function (k) {
      var tr = track[k]; if (!tr || !tr.clientMeta || tr.deleted || !tr.client) return;
      var s = slot(tr.client); s.metaKey = k;
      if (tr.manh != null && isFinite(+tr.manh)) s.manh = +tr.manh;
      if (+tr.prodGroups > 0) s.prodGroups = +tr.prodGroups;
      if (+tr.prodVariants > 0) s.prodVariants = +tr.prodVariants;
    });
    return order.map(function (k) { var s = by[k]; s.billUnits = round2(s.billTok / 1e6); return s; })
      .filter(function (s) { return s.n > 0; })
      .sort(function (a, b) { return b.billTok - a.billTok; });
  }
  // minutes -> "28h 7m" (the tracking cells store run time as plain minutes)
  function fmtMin(min) {
    min = Math.round(+min || 0); if (min <= 0) return '—';
    var h = Math.floor(min / 60), m = min % 60;
    return h ? (h + 'h' + (m ? ' ' + m + 'm' : '')) : (m + 'm');
  }
  // rate-card overrides with actuals layered on top (unit £ stays commercial — actuals only
  // ever replace HOURS + lead, never the per-product price)
  function overridesWithActuals(rateOverrides, actuals, minN) {
    minN = minN || 1;
    var out = {};
    Object.keys(rateOverrides || {}).forEach(function (k) { out[k] = rateOverrides[k]; });
    Object.keys(actuals || {}).forEach(function (id) {
      var a = actuals[id]; if (!a || !a.n || a.n < minN) return;
      var base = {}; Object.keys(out[id] || {}).forEach(function (k) { base[k] = out[id][k]; });
      base.aspl = a.aspl; base.qc = a.qc; base.pm = a.pm;
      if (a.mon > 0) base.mon = a.mon;
      if (a.lead) base.lead = a.lead;
      base.t = base.t || 1;   // actuals count as confirmation — no draft flag
      out[id] = base;
    });
    return out;
  }

  /* =====================================================================================
   * SERVICES (v2, 7 Oct 2026) — the package proposal an AM debriefs a client with.
   *
   * One AUDIT per client × market (Google Shopping only — a '-fb' market returns null),
   * read three ways: STORED (the Golden Record KV reads, the instant first paint), LIVE (the
   * stored read plus the wired feed streamed once — exact needs per parent) and FILE (a
   * prospect's dropped export). needsOf() turns an audit into how many PARENT PRODUCTS (or
   * SKU values) need each line; packageQuote() prices the lines, two cumulative tiers, the
   * conversational six on Spark AI's own engine; proposalText() writes the client copy with
   * every figure a blocker still stands behind replaced by '[£ to confirm — Ray]'.
   *
   * THREE RULES the whole section keeps:
   *   · a gap is never a zero — an unmeasured input makes a line UNKNOWN (n:null) with a
   *     reason, a null price makes it UNPRICED, and both stay out of every total;
   *   · ex VAT, one-off and monthly apart, never an annual or Year-1 figure;
   *   · the client copy never claims what the team has not confirmed (draft rates, an
   *     estimated count, a delivery status nobody set) — the guard hides the figure instead.
   * ===================================================================================== */

  /* Spark AI — the conversational six (plus highlights) priced by DATA SOURCE. This block is
     a VERBATIM TWIN of the AI Quote's AIMODE:ENGINE block (docs/FeedSpark_AIQuote.html), so a
     package's Spark AI line and an AI Quote are the same arithmetic by construction.
     tools/test_pricer.mjs holds the text byte-identical AND runs both copies on the same
     inputs; change the page's block and copy it here in the same PR. */
  /* AIMODE:TWIN-START — verbatim copy of the AIMODE:ENGINE block; edit the page, then copy. */
  var AIM_RATE_DEFAULT={dayRate:695,hoursPerDay:8,hoursSupplied:2,hoursScrape:2,scrapeMonthly:100,
    aiSetupDays:2,aiPerField:0.10,aiMinMonthly:100,hoursFeedHero:2,buffer:10};
  var AIM_NEWNESS_DEFAULT=10.5;
  /* the six conversational attributes plus product_highlight — with the routes each one can
     honestly take. AI cannot invent a document link, a related product or a variant option, and
     popularity rank is computed in FeedHero from the brand's own Google Ads data, nowhere else. */
  var AIM_ATTRS=[
    {id:'qa',   name:'Question and answer', key:'question_and_answer', routes:['feed','scrape','ai','feedhero']},
    {id:'doc',  name:'Document link',       key:'document_link',       routes:['feed','scrape','feedhero']},
    {id:'rel',  name:'Related product',     key:'related_product',     routes:['feed','scrape','feedhero']},
    {id:'igt',  name:'Item group title',    key:'item_group_title',    routes:['feed','scrape','ai','feedhero']},
    {id:'vopt', name:'Variant option',      key:'variant_option',      routes:['feed','scrape','feedhero']},
    {id:'hi',   name:'Product highlight',   key:'product_highlight',   routes:['feed','scrape','ai','feedhero']},
    {id:'pop',  name:'Popularity rank',     key:'popularity_rank',     routes:['feedhero']}
  ];
  var AIM_ROUTE_LABEL={off:'Ignore',feed:'Add to master feed',scrape:'Scrape',ai:'Tachyon AI',feedhero:'FeedHero rule'};
  var AIM_RATE_LABEL={dayRate:'Day rate (£)',hoursPerDay:'Hours in a day',hoursSupplied:'Hours to add a feed field',
    hoursScrape:'Hours per scraped field',scrapeMonthly:'Scrape run (£ / month)',aiSetupDays:'AI set-up (days per field)',
    aiPerField:'AI cost per field (£)',hoursFeedHero:'Hours for a FeedHero rule',aiMinMonthly:'AI minimum (£ / month)',
    buffer:'Volume buffer (%)'};
  var AIM_RATE_ORDER=['dayRate','hoursPerDay','hoursSupplied','hoursScrape','scrapeMonthly','aiSetupDays','aiPerField','hoursFeedHero','aiMinMonthly','buffer'];

  function aimMoney(n){ if(!isFinite(n))n=0; return '£'+Math.round(n).toLocaleString('en-GB'); }
  function aimMoney2(n){ return '£'+(Math.round((+n||0)*100)/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function aimInt(n){ return Math.round(+n||0).toLocaleString('en-GB'); }
  function aimHrsW(n){ if(!n)return '—'; return (Math.round(n*10)/10)+'h'; }
  function aimHourly(r){ var hpd=+r.hoursPerDay||8; return (+r.dayRate||0)/hpd; }
  var AIM_DOB_PATS=[/date_?of_?birth/,/^dob$/,/date_?added/,/date_?created/,/^created/,/first_?seen/,/launch_?date/,/^added/,/on_?sale_?since/];

  /* a feed's date field, read the way feeds actually write one: dd/mm/yyyy (UK order unless the
     day is plainly the month), bare YYYYMMDD, or anything Date.parse understands. */
  function aimParseDate(v){
    if(!v)return null; v=String(v).trim(); if(!v)return null;
    var m=v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if(m){ var d1=+m[1],m1=+m[2];
      if(d1>12&&m1<=12)return new Date(+m[3],m1-1,d1);
      if(m1>12&&d1<=12)return new Date(+m[3],d1-1,m1);
      return new Date(+m[3],m1-1,d1); }
    if(/^\d{8}$/.test(v))return new Date(+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6,8));
    var t=Date.parse(v); return isNaN(t)?null:new Date(t);
  }

  /* newness: the share of the catalogue that turns over in a year, spread over twelve months and
     lifted by the volume buffer. perMonthRaw is the plain twelfth; perMonth is what we quote on. */
  function aimNewness(units,pct,buffer){
    if(!isFinite(pct)||pct<0)pct=0;
    var perYear=units*pct/100, perMonthRaw=perYear/12;
    return {units:units,pct:pct,perYear:perYear,perMonthRaw:perMonthRaw,perMonth:perMonthRaw*(1+(+buffer||0)/100)};
  }

  /* the quote itself. sources = {attrId: route}; units = the catalogue in scope at the chosen
     unit; perMonth = aimNewness().perMonth. Returns exact numbers — rounding is display only. */
  function aimBuild(sources,rates,units,perMonth){
    var r=rates, hr=aimHourly(r), lines=[], setup=0, monthly=0, totalHours=0;
    var counts={ai:0,scrape:0,feed:0,fh:0};
    AIM_ATTRS.forEach(function(a){ var s=sources[a.id];
      if(s==='ai')counts.ai++; else if(s==='scrape')counts.scrape++;
      else if(s==='feed')counts.feed++; else if(s==='feedhero')counts.fh++; });
    var newPer=Math.ceil(perMonth||0), scrapeSeen=0;
    AIM_ATTRS.forEach(function(a){
      var s=sources[a.id]; if(!s||s==='off')return;
      var hoursN=0,setupN=0,monthlyN=0,gen=0,detail='',monthlyNote=null;
      if(s==='feed'){
        hoursN=+r.hoursSupplied||0; setupN=hoursN*hr;
        detail='Configure the field in the master feed · '+aimHrsW(hoursN)+' at '+aimMoney(hr)+'/h · no monthly time';
      } else if(s==='scrape'){
        hoursN=+r.hoursScrape||0; setupN=hoursN*hr; scrapeSeen++;
        if(scrapeSeen===1){ monthlyN=+r.scrapeMonthly||0;
          detail='Configure the scrape · '+aimHrsW(hoursN)+' at '+aimMoney(hr)+'/h · the '+aimMoney(monthlyN)+'/month covers every scraped field, charged once';
        } else { monthlyNote='Included';
          detail='Configure the scrape · '+aimHrsW(hoursN)+' at '+aimMoney(hr)+'/h · covered by the scrape running cost above'; }
      } else if(s==='ai'){
        hoursN=(+r.aiSetupDays||0)*(+r.hoursPerDay||8);
        gen=units*(+r.aiPerField||0);
        setupN=hoursN*hr+gen;
        monthlyN=newPer*(+r.aiPerField||0);
        detail=(+r.aiSetupDays||0)+' day set-up for this field ('+aimMoney(hoursN*hr)+') plus '+aimInt(units)+' × '+aimMoney2(r.aiPerField)+' ('+aimMoney(gen)+') to generate the range · then '+aimInt(newPer)+' new a month';
      } else if(s==='feedhero'){
        hoursN=+r.hoursFeedHero||0; setupN=hoursN*hr;
        detail=(a.id==='pop'?'Calculated in FeedHero from the brand’s own Google Ads data · ':'Built as a FeedHero rule from data we already hold · ')+aimHrsW(hoursN)+' at '+aimMoney(hr)+'/h · no monthly time';
      }
      /* man = hours at the day rate, gen = the per-product AI charge. They are split because the
         Discount % column excludes man power unless "+ man power" is ticked on this quote. */
      lines.push({label:a.name,key:a.key,id:a.id,route:s,detail:detail,hours:hoursN,
                  setup:setupN,man:hoursN*hr,gen:gen,monthly:monthlyN,monthlyNote:monthlyNote});
      totalHours+=hoursN; setup+=setupN; monthly+=monthlyN;
    });
    if(counts.ai){
      var floor=+r.aiMinMonthly||0, aiMonthly=0;
      lines.forEach(function(l){ if(l.route==='ai')aiMonthly+=l.monthly; });
      if(aiMonthly<floor){ var topUp=floor-aiMonthly;
        lines.push({label:'AI minimum monthly',key:'minimum',id:'min',route:'ai',shared:true,
          detail:'AI generation across '+counts.ai+' field'+(counts.ai>1?'s':'')+' comes to '+aimMoney(aiMonthly)+' a month, under the '+aimMoney(floor)+' minimum · tops it up by '+aimMoney(topUp),
          hours:0,setup:0,man:0,gen:0,monthly:topUp,monthlyNote:null});
        monthly+=topUp; }
    }
    return {lines:lines,setup:setup,monthly:monthly,hours:totalHours,units:units,
            perMonth:perMonth,newPer:newPer,counts:counts};
  }
  /* AIMODE:TWIN-END */

  // the Spark AI rate card: AI Quote's ratecard.aim over the builder's defaults, key by key
  function aimRatesOf(r) {
    var out = {};
    Object.keys(AIM_RATE_DEFAULT).forEach(function (k) {
      var v = r && r[k];
      out[k] = (v != null && v !== '' && isFinite(+v) && +v >= 0) ? +v : AIM_RATE_DEFAULT[k];
    });
    return out;
  }
  function aimRouteOk(id, route) {
    var a = AIM_ATTRS.filter(function (x) { return x.id === id; })[0];
    return !!a && (route === 'off' || a.routes.indexOf(route) >= 0);
  }

  // Market → language group. Two markets in one group share the generated copy (the lead is
  // written, the rest re-used at the Management re-use rate). AM-editable per proposal; an
  // unlisted market is its own group ('m:<code>') rather than guessed into one.
  var MKT_LANG = { gb: 'en', uk: 'en', ie: 'en', us: 'en', au: 'en', ca: 'en', eu: 'en', hk: 'en', sg: 'en',
    de: 'de', at: 'de', fr: 'fr', befr: 'fr', nl: 'nl', benl: 'nl', es: 'es', it: 'it', dk: 'da', se: 'sv',
    fi: 'fi', pl: 'pl', pt: 'pt', cz: 'cs', sk: 'sk', ro: 'ro', gr: 'el' };
  function langOf(mkt, map) {
    var m = String(mkt || '').toLowerCase();
    return (map && map[m]) || MKT_LANG[m] || ('m:' + m);
  }

  // The package lines. `pkg` go = Tier 1 · Google-ready (Google Optimise), ar = the AI Readiness
  // lines Tier 2 · AI-ready adds on top of it. `row` = the rate row it is priced on (null:
  // priced another way or never), `grain` = what one unit IS (a parent product, an SKU value, or
  // nothing — counted, never priced per unit), `cat` = what classifyTach reads its brief title
  // back as, `fixes` = the Golden Record attributes the line completes (the projection; attr_*
  // lines name theirs per market).
  var PKG_LINES = [
    { key: 'title',      pkg: 'go', row: 'title_gen',  grain: 'parent', cat: 'title_gen',  label: 'Title optimisation',              fixes: ['title'] },
    { key: 'keywords',   pkg: 'go', row: 'keywords',   grain: 'parent', cat: 'keywords',   label: 'Keyword optimisation',            fixes: ['keywords'] },
    { key: 'ptype',      pkg: 'go', row: 'pt_class',   grain: 'parent', cat: 'pt_class',   label: 'Product type optimisation',       fixes: ['product_type'] },
    { key: 'gpc',        pkg: 'go', row: 'gpc',        grain: 'parent', cat: 'gpc',        label: 'Google product category mapping', fixes: ['google_product_category'] },
    { key: 'attr_ai',    pkg: 'go', row: 'attr_pop',   grain: 'sku',    cat: 'attr_pop',   label: 'Attribute population — colour, material, pattern', fixes: null },
    { key: 'attr_rule',  pkg: 'go', row: null,         grain: 'none',   cat: '',           label: 'Attribute rules — gender, age group, size type, size system, condition', fixes: null },
    { key: 'client',     pkg: 'go', row: null,         grain: 'none',   cat: '',           label: 'Client to supply', fixes: [] },
    { key: 'highlights', pkg: 'ar', row: 'highlights', grain: 'parent', cat: 'highlights', label: 'Product highlights',              fixes: ['product_highlight'] },
    { key: 'details',    pkg: 'ar', row: 'details',    grain: 'parent', cat: 'details',    label: 'Product details (from images)',   fixes: ['product_detail'] },
    { key: 'desc',       pkg: 'ar', row: 'desc_gen',   grain: 'parent', cat: 'desc_gen',   label: 'Description enrichment',          fixes: ['description'] },
    { key: 'conv',       pkg: 'ar', row: null,         grain: 'parent', cat: '',           label: 'Conversational attributes (Spark AI)', fixes: null, aim: true }
  ];
  var LINE_BY = {};
  PKG_LINES.forEach(function (l) { LINE_BY[l.key] = l; });

  /* THE OPTIMISATION BANK (Ray, 8 Oct 2026: "allow a system where new AI optimisation can be added as well — a bank
     of different optimisation to be allocated flexibly between tiers … when added / removed / changed between tiers it
     should be reflected in the audit + pricing quote"). ONE registry of every optimisation FeedSpark sells:
       · the built-in package lines above — each can move to Tier 1 (go), Tier 2 (ar), Tier 3 (rf) or off, and carry
         its own "what it gives" phrase (the chip a Head of Marketing reads);
       · new optimisations the team adds (`x_<slug>`) — the feed fields they fill, a price (£ a product, set-up hours,
         and/or a flat £ a month) and a delivery status;
       · SERVICES that write no feed field (stock range completion, restock alerts …) — a phrase and an optional
         monthly £, listed on the tier as what it gives.
     Stored house-wide in the Management-owned `pricerbank` store; the engine reads it for EVERY option, so a move
     shows on the tier cards, the preview, the projection, the quote and the client copy at once. A tier includes
     every tier below it (Tier 3 ⊃ Tier 2 ⊃ Tier 1); `AI-ready only` is Tier 2's own items. */
  var BANK_TIERS = ['go', 'ar', 'rf', 'off'];
  var TIER_NAME = { go: 'Tier 1', ar: 'Tier 2', rf: 'Tier 3', off: 'not offered' };
  var BANK_GIVES = { title: 'MASK titles, 80–120 characters', keywords: '10+ keyword strings per product', ptype: 'product types 3+ levels deep',
    gpc: 'every product mapped to Google\'s taxonomy', attr_ai: 'colour · material · pattern on every product',
    attr_rule: 'gender · age group · size type · size system set by rule', highlights: '+4 highlights per product',
    details: '+5–8 product details per product', desc: 'descriptions enriched to the target length', conv: 'Q&A + the AI Mode attributes' };
  // services seeded into Tier 2 (Ray, 8 Oct 2026: "Stock RC%: xx% · Restock: x days"); no separate charge until
  // Management sets a monthly £ in the bank — the phrase and the tier are the team's to change or remove
  var BANK_SEED = {
    x_stock_rc: { label: 'Stock range completion', kind: 'service', pkg: 'ar', gives: 'Stock RC%: held at the brand\'s line',
      why: 'products held back from Google until enough of their sizes are in stock — set and read on /stock' },
    x_restock: { label: 'Restock alerts', kind: 'service', pkg: 'ar', gives: 'Restock: demanded-but-unbuyable products flagged daily',
      why: 'products shoppers still ask for in Google Ads that cannot be bought — read on /restock' } };
  var BANK_STATUS = ['live', 'pilot', 'building', 'planned'];
  // does an option carry an item in this tier?
  function inOption(option, pkg) {
    if (pkg === 'off' || BANK_TIERS.indexOf(pkg) < 0) return false;
    if (option === 'ar') return pkg === 'ar';
    if (option === 'go') return pkg === 'go';
    if (option === 'go+ar') return pkg === 'go' || pkg === 'ar';
    return true;
  }
  // the effective bank: every built-in line (with the store's tier / phrase), the seeds, the team's own items
  function bankOf(bank) {
    bank = bank && typeof bank === 'object' ? bank : {};
    var out = [];
    PKG_LINES.forEach(function (d) {
      if (d.key === 'client') return;
      var b = bank[d.key] && typeof bank[d.key] === 'object' ? bank[d.key] : {};
      var pkg = BANK_TIERS.indexOf(b.pkg) >= 0 ? b.pkg : d.pkg;
      out.push({ key: d.key, builtin: true, label: d.label, pkg: pkg, defPkg: d.pkg, moved: pkg !== d.pkg, gives: b.gives || BANK_GIVES[d.key] || '',
        fields: d.fixes ? d.fixes.slice() : (d.key === 'attr_ai' ? ATTR_AI.slice() : d.key === 'attr_rule' ? RULE_ATTRS.slice() : d.key === 'conv' ? CONV_KEYS.slice() : []),
        kind: 'feed', by: b.by || null, at: b.at || null });
    });
    var custom = {};
    Object.keys(BANK_SEED).forEach(function (k) { custom[k] = Object.assign({ seed: true }, BANK_SEED[k]); });
    Object.keys(bank).forEach(function (k) { if (/^x_[a-z0-9_]{2,30}$/.test(k) && bank[k] && typeof bank[k] === 'object') custom[k] = Object.assign({}, custom[k] || {}, bank[k]); });
    Object.keys(custom).forEach(function (k) {
      var c = custom[k];
      if (c.del) return;
      var kind = c.kind === 'service' ? 'service' : 'feed';
      out.push({ key: k, custom: true, seed: !!c.seed, label: c.label || k, pkg: BANK_TIERS.indexOf(c.pkg) >= 0 ? c.pkg : 'off', gives: c.gives || '',
        fields: kind === 'feed' && Array.isArray(c.fields) ? c.fields.filter(function (f) { return /^[a-z_]{2,40}$/.test(f); }).slice(0, 6) : [], kind: kind,
        unit: numOr(c.unit), setupH: numOr(c.setupH), monthly: numOr(c.monthly), grain: c.grain === 'sku' ? 'sku' : 'parent',
        status: BANK_STATUS.indexOf(c.status) >= 0 ? c.status : 'live', why: c.why || '', by: c.by || null, at: c.at || null });
    });
    return out;
  }
  // what the bank puts in one option, tier by tier — for the cards' "what you get" and the preview
  function bankGives(bank, option) {
    return bankOf(bank).filter(function (b) { return inOption(option, b.pkg); }).map(function (b) { return { key: b.key, label: b.label, gives: b.gives, pkg: b.pkg, kind: b.kind, custom: !!b.custom }; });
  }
  // The tiers BY NAME (Ray, 7 Oct 2026: "where's the bundle function? (Google-ready) (AI-Ready)"):
  // Tier 1 is Google-ready, Tier 2 is the AI-ready BUNDLE (Tier 1 + AI Readiness, set-up rounded
  // once, the bundle % on generation), and AI Readiness alone is the odd one out. OPTION_SUB is
  // the one-line descriptor the page and the client copy print under the name.
  var OPTION_LABEL = { go: 'Tier 1 · Google-ready', 'go+ar': 'Tier 2 · AI-ready', 'go+ar+rf': 'Tier 3 · AI-Refresher', ar: 'AI-ready only' };
  var OPTION_SUB = { go: 'Google Optimise — eligible + everything Google recommends',
    'go+ar': 'Google-ready + AI Readiness — the bundle', 'go+ar+rf': 'AI-ready + the AI data kept fresh, monthly or quarterly',
    ar: 'AI Readiness without Tier 1' };

  // AI-REFRESHER (Ray, 8 Oct 2026: "a tier-three product of AI-ready datasets, such as data fields like
  // Q&A, keywords … refreshed on a monthly or quarterly basis, depending on the marketing event /
  // customer questions / AI-visibility monitor / customer reviews"). Tier 3 is Tier 2 PLUS a recurring
  // refresh of the AI-ready fields: each refresh regenerates the ticked fields over the share of the
  // catalogue it covers, read against the signals the AM ticks. Priced at a share of each field's own
  // generation price (`_g|rfPct`, Management-owned; DRAFT until set — the guard holds the figure back),
  // β applied like generation, never touched by the bundle % or the monthly floor. A quarterly
  // refresh is charged a quarter at a time and carried into the monthly total as a third of it, so
  // two options always compare on the same footing.
  var REFRESH_FIELDS = [
    { id: 'keywords', label: 'Keywords', row: 'keywords', why: 'search phrases re-cut to what shoppers ask now' },
    { id: 'qa', label: 'Q&A', aim: true, why: 'the questions customers and AI surfaces are asking now' },
    { id: 'highlights', label: 'Product highlights', row: 'highlights', why: 'benefits re-ranked by what reviews and search reward' },
    { id: 'desc', label: 'Descriptions', row: 'desc_gen', why: 'copy refreshed for the season and the moment' }];
  var REFRESH_DEFAULT_FIELDS = ['keywords', 'qa', 'highlights'];
  var REFRESH_SIGNALS = [
    { id: 'events', label: 'Marketing calendar moments' },
    { id: 'questions', label: 'Customer questions & search terms' },
    { id: 'aivis', label: 'AI-visibility monitor' },
    { id: 'reviews', label: 'Customer reviews' }];
  var REFRESH_CADENCE = { monthly: { label: 'Monthly', per: 'a month', perMonth: 1 }, quarterly: { label: 'Quarterly', per: 'a quarter', perMonth: 1 / 3 } };
  var REFRESH_SHARES = [25, 50, 100];
  var REFRESH_PCT_DEFAULT = 50;
  var REFRESH_WHAT = 'the AI-ready fields are regenerated on a schedule against what changed — the marketing calendar, the questions customers ask, what AI answer engines say about the brand and what reviews reward — so the data an AI shopping surface reads never goes stale.';

  // TEST PACKAGES — a monthly add-on to any option: N tests a month, each changing ONE thing on a
  // set of products against a control. The prices are Management's price-store cells
  // _g|test2 / _g|test3 / _g|test4; until Management sets them these are DRAFT figures (the
  // website mockup's proposed ladder), so a proposal carrying a test package is not client-safe
  // until the price is confirmed. A test package is a flat monthly price: never in generation,
  // never touched by β, the bundle % or the floor.
  var TEST_COUNTS = [2, 3, 4];
  var TEST_DEFAULTS = { 2: 800, 3: 1140, 4: 1440 };
  var TEST_WHAT = 'each test changes one thing on a set of products — a title pattern, a keyword theme, an attribute or an image — runs it against a control on Google Shopping, and reports back; a winner rolls out, a loser is rolled back.';

  var TITLE_BITS = ['empty', 'len-over', 'caps', 'promo', 'gimmick', 'thin', 'short', 'no-brand'];
  var GPC_BITS = ['empty', 'not-taxonomy', 'shallow'];
  var DESC_B = ['empty', 'lt160', 'lt300', 'lt500', 'lt1000', 'ok'];
  var DESC_TARGETS = [160, 300, 500, 1000];
  var HKEYS = ['0', '1', '2', '3', '4', '5', '6+'];
  var ATTR_AI = ['color', 'material', 'pattern'];
  var RULE_ATTRS = ['gender', 'age_group', 'size_type', 'size_system', 'condition'];
  // a filled value that breaks one of these FAIL rules is as unusable as an empty one
  var ATTR_INV = { color: ['not-colour', 'hex', 'one-letter'], material: ['placeholder'], pattern: ['placeholder'] };
  var ATTR_WORD = { color: 'colour', material: 'material', pattern: 'pattern', gender: 'gender', age_group: 'age group',
    size_type: 'size type', size_system: 'size system', condition: 'condition', link: 'link', image_link: 'image link',
    availability: 'availability', price: 'price', brand: 'brand', gtin_mpn: 'GTIN / MPN', size: 'size', item_group_id: 'item group id' };
  var APPAREL = ['Fashion', 'Footwear'];
  var GUARD_TXT = '[£ to confirm — Ray]';
  var DAILY_RUN = '12:00 UK';   // tools/golden_daily.mjs RUN_HOUR — the automatic content-quality read

  function numOr(v) { return (v != null && v !== '' && isFinite(+v)) ? +v : null; }
  // a stored rate-card value: {v, by, at} as the worker stamps it, or a bare value
  function sv(x) { return (x && typeof x === 'object' && !Array.isArray(x) && Object.prototype.hasOwnProperty.call(x, 'v')) ? x.v : x; }
  function stampOf(x) { return (x && typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, 'v')) ? { by: x.by || '', at: +x.at || 0 } : null; }
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function fmtInt(n) { return Math.round(+n || 0).toLocaleString('en-GB'); }
  function nWord(n, one, many) { return fmtInt(n) + ' ' + (Math.round(+n || 0) === 1 ? one : many); }
  function pct1(x) { return Math.round(x * 1000) / 10; }
  // a map or an array of records → [[id, record]]
  function entries(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x.map(function (r, i) { return [r && r.id != null ? String(r.id) : String(i), r]; });
    return Object.keys(x).map(function (k) { return [k, x[k]]; });
  }
  function tOf(x) { return x == null ? null : (typeof x === 'object' ? (+x.t || null) : (+x || null)); }

  /* ---- needCollector: EXACT needs per parent product, off the stream the page already runs --
     A parent needs a line when ANY of its SKU rows needs it, so every count comes back as a
     pair [s, p] — SKU rows, distinct parents. Per parent the fold is: title / GPC rule bits
     OR'd across rows, the WORST description bucket, the FEWEST highlights, the SHALLOWEST
     product_type, any row lacking keywords / details / an attribute value. Rules are the
     labelguard QSPEC tests themselves (LG.qspecOf(k).rules[i].test) — no second copy — so a
     row this collector fails is a row content quality fails.
     The first row is the header; a row with no id is counted in noId and nothing else (S
     matches goldenidx.rows). The second argument is the parser's LIVE header and is read only
     when it is an Array — catalog_engine's delimParser passes a row number there. */
  function needCollector(LG, Arr, opts) {
    opts = opts || {};
    var header = null, C = null, S = 0, noId = 0, grouped = 0;
    var par = new Map();
    var T = {}, G = {}, D = [0, 0, 0, 0, 0, 0], H = [0, 0, 0, 0, 0, 0, 0], PT = [0, 0, 0, 0, 0, 0, 0];
    var kwNone = 0, detEmpty = 0;
    var at = {}, rule = {}, cl = { link: 0, image_link: 0, availability: 0, price: 0, brand: 0, gtin_mpn: 0, item_group_id: 0, size: { n: 0, u: 0, miss: 0 } };
    ATTR_AI.forEach(function (a) { at[a] = { n: 0, u: 0, miss: 0, inv: 0 }; });
    ['gender', 'age_group'].forEach(function (a) { rule[a] = { n: 0, u: 0, miss: 0 }; });
    ['size_type', 'size_system', 'condition'].forEach(function (a) { rule[a] = { n: 0, miss: 0 }; });
    var dobS = { n: 0, bad: 0, m: {} }, gcache = new Map();
    function testOf(key, id) {
      var q = LG.qspecOf(key), r = q && q.rules.filter(function (x) { return x.id === id; })[0];
      var fn = r && typeof r.test === 'function' ? r.test : null;
      return function (v, ctx, raw) { if (!fn) return false; try { return !!fn(v, ctx, raw); } catch (e) { return false; } };
    }
    var titleT = TITLE_BITS.slice(1).map(function (id) { return testOf('title', id); });
    var gpcNT = testOf('google_product_category', 'not-taxonomy'), gpcSh = testOf('google_product_category', 'shallow');
    var ptSep = testOf('product_type', 'sep');
    var invT = {};
    ATTR_AI.forEach(function (a) { invT[a] = ATTR_INV[a].map(function (id) { return testOf(a, id); }); });
    function isDob(h) {
      if (Arr && typeof Arr.isDobHeader === 'function') return Arr.isDobHeader(h);
      return LG.normHeader(h) === LG.DOB_KEY;
    }
    function month(v) {
      if (Arr && typeof Arr.dobMonth === 'function') return Arr.dobMonth(v);
      var m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m && +m[1] >= 2000 && +m[1] <= 2100 && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? m[1] + '-' + m[2] : null;
    }
    function resolve() {
      var dob = -1;
      for (var i = 0; i < header.length; i++) if (isDob(header[i])) { dob = i; break; }
      C = { id: LG.findCols(header, []).id, ac: LG.findAttrCols(header), hl: LG.slotCols(header, 'product_highlight'),
        det: LG.slotCols(header, 'product_detail'), kw: LG.kwSlotCols(header), dob: dob };
    }
    function cell(i, r) { return (i != null && i >= 0) ? String(r[i] == null ? '' : r[i]) : ''; }
    // per-parent state: [titleMask, gpcMask, worstDesc, fewestHl, shallowestPt, flags, earliestDob]
    var F_KW = 1, F_DET = 2, F_MISS = { color: 4, material: 16, pattern: 64 }, F_INV = { color: 8, material: 32, pattern: 128 };
    return {
      onRow: function (r, h) {
        if (!header) { header = (r || []).slice(); resolve(); return; }
        if (Array.isArray(h) && h.length !== header.length) { header = h.slice(); resolve(); }
        var ac = C.ac, idv = cell(C.id, r).trim();
        if (!idv) { noId++; return; }
        S++;
        var igv = cell(ac.item_group_id, r).trim();
        if (igv) grouped++;
        var key = igv ? 'g:' + igv : 'i:' + idv, st = par.get(key);
        if (!st) { st = [0, 0, 9, 1e9, 1e9, 0, null]; par.set(key, st); }
        var rawT = cell(ac.title, r), vT = rawT.trim(), ctx = { brand: cell(ac.brand, r).trim(), title: vT }, i;
        // title — one bit per rule the row breaks; an empty title is its own bit and nothing else
        var tm = 0;
        if (!vT) tm = 1;
        else for (i = 0; i < titleT.length; i++) if (titleT[i](vT, ctx, rawT)) tm |= 1 << (i + 1);
        T[tm] = (T[tm] || 0) + 1; st[0] |= tm;
        // description — the length bucket, in CHARACTERS
        var dv = cell(ac.description, r).trim(), dl = dv.length;
        var db = !dl ? 0 : dl < 160 ? 1 : dl < 300 ? 2 : dl < 500 ? 3 : dl < 1000 ? 4 : 5;
        D[db]++; if (db < st[2]) st[2] = db;
        // highlights — every value across every highlight column (a repeated tag is several)
        var hc = 0;
        for (i = 0; i < C.hl.length; i++) hc += LG.multiVals(cell(C.hl[i], r)).length;
        H[Math.min(6, hc)]++; if (hc < st[3]) st[3] = hc;
        // product type — chevron depth; an empty or wrongly separated path scores 0
        var pv = cell(ac.product_type, r).trim();
        var ps = (!pv || ptSep(pv, ctx, pv)) ? 0 : Math.min(6, LG.pathDepth(pv));
        PT[ps]++; if (ps < st[4]) st[4] = ps;
        // google product category
        var gRaw = cell(ac.google_product_category, r), gv = gRaw.trim(), gm = 0;
        if (!gv) gm = 1;
        else { if (gpcNT(gv, ctx, gRaw)) gm |= 2; if (gpcSh(gv, ctx, gRaw)) gm |= 4; }
        G[gm] = (G[gm] || 0) + 1; st[1] |= gm;
        // keywords — a slot counts only when it holds a keyword PHRASE (an id is not one)
        var kw = false;
        for (i = 0; i < C.kw.length; i++) if (LG.kwValueKind(r[C.kw[i]]) === 'kw') { kw = true; break; }
        if (!kw) { kwNone++; st[5] |= F_KW; }
        var det = false;
        for (i = 0; i < C.det.length; i++) if (cell(C.det[i], r).trim()) { det = true; break; }
        if (!det) { detEmpty++; st[5] |= F_DET; }
        // the GPC-scoped attributes: a row is asked for colour etc. only when its category is
        var cls = gcache.get(gRaw);
        if (cls === undefined) { cls = LG.gpcClass(gRaw); if (gcache.size < 20000) gcache.set(gRaw, cls); }
        ATTR_AI.forEach(function (a) {
          if (!LG.gpcInScope(a, cls)) return;
          var x = at[a], raw = cell(ac[a], r), v = raw.trim();
          x.n++; if (cls == null) x.u++;
          if (!v) { x.miss++; st[5] |= F_MISS[a]; return; }
          for (var j = 0; j < invT[a].length; j++) if (invT[a][j](v, ctx, raw)) { x.inv++; st[5] |= F_INV[a]; return; }
        });
        ['gender', 'age_group'].forEach(function (a) {
          if (!LG.gpcInScope(a, cls)) return;
          var x = rule[a]; x.n++; if (cls == null) x.u++;
          if (!cell(ac[a], r).trim()) x.miss++;
        });
        ['size_type', 'size_system', 'condition'].forEach(function (a) { rule[a].n++; if (!cell(ac[a], r).trim()) rule[a].miss++; });
        ['link', 'image_link', 'availability', 'price', 'brand'].forEach(function (a) { if (!cell(ac[a], r).trim()) cl[a]++; });
        if (!cell(ac.gtin, r).trim() && !cell(ac.mpn, r).trim()) cl.gtin_mpn++;
        if (!igv) cl.item_group_id++;
        if (LG.gpcInScope('size', cls)) { cl.size.n++; if (cls == null) cl.size.u++; if (!cell(ac.size, r).trim()) cl.size.miss++; }
        // first-seen date — per SKU, and per parent as its EARLIEST month
        if (C.dob >= 0) {
          var ds = cell(C.dob, r).trim();
          if (ds) {
            var mo = month(ds);
            if (mo) { dobS.n++; dobS.m[mo] = (dobS.m[mo] || 0) + 1; if (!st[6] || mo < st[6]) st[6] = mo; }
            else dobS.bad++;
          }
        }
      },
      finish: function () {
        var Tp = {}, Gp = {}, Dp = [0, 0, 0, 0, 0, 0], Hp = [0, 0, 0, 0, 0, 0, 0], PTp = [0, 0, 0, 0, 0, 0, 0];
        var kwP = 0, detP = 0, missP = { color: 0, material: 0, pattern: 0 }, invP = { color: 0, material: 0, pattern: 0 };
        var dobP = { n: 0, m: {} };
        par.forEach(function (st) {
          Tp[st[0]] = (Tp[st[0]] || 0) + 1; Gp[st[1]] = (Gp[st[1]] || 0) + 1;
          Dp[st[2]]++; Hp[Math.min(6, st[3])]++; PTp[st[4]]++;
          if (st[5] & F_KW) kwP++; if (st[5] & F_DET) detP++;
          ATTR_AI.forEach(function (a) { if (st[5] & F_MISS[a]) missP[a]++; if (st[5] & F_INV[a]) invP[a]++; });
          if (st[6]) { dobP.n++; dobP.m[st[6]] = (dobP.m[st[6]] || 0) + 1; }
        });
        function pairs(sk, pk) { var o = {}; Object.keys(sk).concat(Object.keys(pk)).forEach(function (k) { o[k] = [sk[k] || 0, pk[k] || 0]; }); return o; }
        function hist(sk, pk, keys) { var o = {}; keys.forEach(function (k, i) { o[k] = [sk[i], pk[i]]; }); return o; }
        var attrs = {};
        ATTR_AI.forEach(function (a) { var x = at[a]; attrs[a] = { n: x.n, u: x.u, miss: x.miss, inv: x.inv, missP: missP[a], invP: invP[a] }; });
        return { v: 1, S: S, P: par.size, noId: noId, hasGroups: !!(C && C.ac.item_group_id >= 0), grouped: grouped,
          title: { bits: TITLE_BITS.slice(), masks: pairs(T, Tp) },
          desc: { b: hist(D, Dp, DESC_B) },
          hl: { h: hist(H, Hp, HKEYS) },
          pt: { h: hist(PT, PTp, HKEYS) },
          gpc: { bits: GPC_BITS.slice(), masks: pairs(G, Gp) },
          kw: { slots: C ? C.kw.length : 0, none: [kwNone, kwP] },
          det: { empty: [detEmpty, detP] },
          attrs: attrs,
          rule: JSON.parse(JSON.stringify(rule)),
          client: JSON.parse(JSON.stringify(cl)),
          dob: { col: !!(C && C.dob >= 0), sku: dobS, par: dobP } };
      }
    };
  }

  /* ---- composeRates: ONE rate card from the team stores, the legacy card and the actuals ----
     Per field, the first that holds a number wins: the team store (pricerops for hours and the
     ASPL / London fields, pricerprice for £ — both `<rowId>|<field>` → {v, by, at}) → the legacy
     tachyonrates card (read-only now) → the tracked actuals (hours + lead, only with the toggle
     on) → the CATALOG / PKG_ROWS default. src says which one, by says who set it and when.
     draftUnit = nobody has set the £ (no price key, no legacy key) — a legacy `t` stamped by an
     unrelated hours edit no longer confirms a price. draftHours = a set-up hour still on its
     draft default, unless the legacy row was explicitly saved (the v1 confirmation). */
  var HOUR_F = ['aspl', 'qc', 'pm', 'mon', 'lead'], OPS_F = ['aMin', 'tokPerP', 'qcPct', 'qcMin'];
  function actualFor(a, f) {
    if (f === 'mon') return a.mon > 0 ? +a.mon : null;
    if (f === 'lead') return a.lead ? +a.lead : null;
    return numOr(a[f]);
  }
  function tiersOf(v) {
    if (!Array.isArray(v) || !v.length || v.length > 6) return null;
    var out = [], prev = 0;
    for (var i = 0; i < v.length; i++) {
      var t = v[i] || {}, up = t.upTo == null || t.upTo === Infinity ? Infinity : numOr(t.upTo), x = numOr(t.x);
      if (up == null || x == null || x < 0 || x > 1 || up <= prev) return null;
      if (up === Infinity && i !== v.length - 1) return null;
      out.push({ upTo: up, x: x }); prev = up;
    }
    if (out[out.length - 1].upTo !== Infinity) out.push({ upTo: Infinity, x: out[out.length - 1].x });
    return out;
  }
  function composeRates(o) {
    o = o || {};
    var legacy = o.legacy || {}, ops = o.ops || {}, price = o.price || {}, act = o.actuals || {}, useA = !!o.useActuals;
    var rows = {}, draft = false;
    CATALOG.concat(PKG_ROWS).forEach(function (b) {
      var L = legacy[b.id] && typeof legacy[b.id] === 'object' ? legacy[b.id] : null;
      var A = useA && act[b.id] && act[b.id].n >= 1 ? act[b.id] : null;
      var r = { id: b.id, grp: b.grp, name: b.name, grain: b.grain || 'parent', src: {}, by: {} };
      HOUR_F.forEach(function (f) {
        var k = b.id + '|' + f, ov = numOr(sv(ops[k]));
        if (ov != null) { r[f] = ov; r.src[f] = 'ops'; r.by[f] = stampOf(ops[k]); return; }
        var lv = L ? numOr(L[f]) : null;
        if (lv != null) { r[f] = lv; r.src[f] = 'legacy'; return; }
        var av = A ? actualFor(A, f) : null;
        if (av != null) { r[f] = av; r.src[f] = 'actuals'; return; }
        r[f] = b[f] == null ? null : b[f]; r.src[f] = b[f] == null ? 'unset' : 'default';
      });
      // £ per unit: Management's price store, then the legacy card, then the draft default
      var pk = b.id + '|unit', pv = numOr(sv(price[pk])), lu = L ? numOr(L.unit) : null;
      if (pv != null) { r.unit = pv; r.src.unit = 'ops'; r.by.unit = stampOf(price[pk]); }
      else if (lu != null) { r.unit = lu; r.src.unit = 'legacy'; }
      else { r.unit = b.unit == null ? null : b.unit; r.src.unit = b.unit == null ? 'unset' : 'default'; }
      OPS_F.forEach(function (f) {
        var k = b.id + '|' + f, ov = numOr(sv(ops[k]));
        r[f] = ov; r.src[f] = ov != null ? 'ops' : 'unset';
        if (ov != null) r.by[f] = stampOf(ops[k]);
      });
      var nk = b.id + '|note', nv = sv(ops[nk]);
      if (nv != null && String(nv).trim()) { r.note = String(nv); r.src.note = 'ops'; r.by.note = stampOf(ops[nk]); }
      else if (L && L.note) { r.note = String(L.note); r.src.note = 'legacy'; }
      else { r.note = ''; r.src.note = 'unset'; }
      r.draftUnit = pv == null && lu == null;
      r.draftHours = HOUR_F.some(function (f) { return r.src[f] === 'default' || r.src[f] === 'unset'; }) && !(L && L.t);
      r.unpriced = r.unit == null;
      if (r.draftUnit || r.draftHours) draft = true;
      rows[b.id] = r;
    });
    var g = { src: {}, by: {} };
    function gset(f, val, src, st) { g[f] = val; g.src[f] = src; if (st) g.by[f] = st; }
    var bg = numOr(sv(price['_g|blockGBP'])), lg = legacy._globals ? numOr(legacy._globals.blockGBP) : null;
    if (bg != null && bg > 0) gset('blockGBP', bg, 'ops', stampOf(price['_g|blockGBP']));
    else if (lg != null && lg > 0) gset('blockGBP', lg, 'legacy');
    else gset('blockGBP', DEFAULTS.blockGBP, 'default');
    var bh = numOr(sv(price['_g|blockH']));
    if (bh != null && bh > 0) gset('blockH', bh, 'ops', stampOf(price['_g|blockH'])); else gset('blockH', DEFAULTS.blockHours, 'default');
    var tt = tiersOf(sv(price['_g|tiers']));
    if (tt) gset('tiers', tt, 'ops', stampOf(price['_g|tiers'])); else gset('tiers', DEFAULTS.tiers, 'default');
    ['bundlePct', 'reusePct', 'floorMonthly'].forEach(function (f) {
      var v = numOr(sv(price['_g|' + f]));
      gset(f, v, v != null ? 'ops' : 'unset', v != null ? stampOf(price['_g|' + f]) : null);
    });
    var pkv = sv(price['_g|pkgVersion']);
    gset('pkgVersion', pkv != null && String(pkv).trim() ? String(pkv).slice(0, 20) : null, pkv ? 'ops' : 'unset', pkv ? stampOf(price['_g|pkgVersion']) : null);
    ['ruleH', 'langSetupH'].forEach(function (f) {
      var v = numOr(sv(ops['_g|' + f]));
      gset(f, v, v != null ? 'ops' : 'unset', v != null ? stampOf(ops['_g|' + f]) : null);
    });
    // test packages: g.tests = {2,3,4} → £ a month; g.src.tests / g.by.tests per count like every
    // other _g field. A count Management has not priced reads the DRAFT default ('default'); a
    // count with neither is 'unset' (null) and prices nothing.
    g.tests = {}; g.src.tests = {}; g.by.tests = {};
    TEST_COUNTS.forEach(function (n) {
      var k = '_g|test' + n, v = numOr(sv(price[k]));
      if (v != null && v >= 0) { g.tests[n] = v; g.src.tests[n] = 'ops'; g.by.tests[n] = stampOf(price[k]); }
      else if (TEST_DEFAULTS[n] != null) { g.tests[n] = TEST_DEFAULTS[n]; g.src.tests[n] = 'default'; g.by.tests[n] = null; }
      else { g.tests[n] = null; g.src.tests[n] = 'unset'; g.by.tests[n] = null; }
    });
    // AI-Refresher price: a refresh costs this % of each field's generation price. Unset reads the
    // DRAFT default; the guard holds it back until Management confirms it
    var rfv = numOr(sv(price['_g|rfPct']));
    if (rfv != null && rfv >= 0) gset('rfPct', rfv, 'ops', stampOf(price['_g|rfPct'])); else gset('rfPct', REFRESH_PCT_DEFAULT, 'default');
    return { rows: rows, g: g, draft: draft };
  }

  /* ---- the AUDIT --------------------------------------------------------------------------- */
  // the scoring profile for a prospect read off a dropped file: the industry the AM PICKED,
  // with the house industry overrides, the same filtering profileFor applies (the required
  // seven and gtin/mpn can never be profiled; a token must name a real QSPEC rule).
  // profileFor itself reads the industry off the client NAME, which a prospect does not have.
  function profileForIndustry(LG, ind, PR) {
    var ov = (PR && PR.overrides) || PR || {};
    var base = ((ov.industries || {})[ind]) || LG.INDUSTRY_PROFILES[ind] || { expected: [], waived: [] };
    var ok = function (k) { return LG.ATTR_SPEC.some(function (s) { return s.key === k && s.req !== 'required' && k !== 'gtin' && k !== 'mpn'; }); };
    var exp = (Array.isArray(base.expected) ? base.expected : []).filter(ok);
    var wav = (Array.isArray(base.waived) ? base.waived : []).filter(function (k) { return ok(k) && exp.indexOf(k) < 0; });
    var qw = (Array.isArray(base.qwaived) ? base.qwaived : []).map(String);
    return { industry: ind, expected: exp, waived: wav, qwaived: qw.filter(function (t, i) { return qw.indexOf(t) === i && LG.qruleKnown(t); }) };
  }
  var CONV_KEYS = ['question_and_answer', 'document_link', 'related_product', 'item_group_title', 'variant_option', 'popularity_rank'];
  function auditBase(client, mkt, src, prof) {
    return { v: 1, client: client, mkt: mkt, src: src, industry: prof.industry, prof: prof,
      t: { cov: null, qual: null, pt: null, dob: null, live: null },
      S: null, P: null, r: null, pSrc: null, pRefused: null, emptyRead: false, hasGroups: null, grouped: null,
      golden: null, quality: null, qScore: null, qFails: null, ptDepth: null, gpcDepth: null, air: null,
      conv: { cov: {}, n: null, hasVariants: null },
      arrivals: { perMonthP: null, perMonthS: null, basis: null, coverage: null, unit: null, months: null },
      counts: null, pdp: 'unknown', missing: [] };
  }
  function goldenOf(LG, attrs, cov, sc, prof) {
    var gs = LG.goldenScore(attrs, prof);
    return { attrs: attrs, cov: cov, sc: sc, score: gs ? gs.score : null, gs: gs };
  }
  function scoreQuality(LG, A) {
    var qs = A.quality ? LG.qualityScore(A.quality, A.prof) : null;
    A.qScore = qs ? qs.score : null; A.qFails = qs ? qs.fails : null;
    var g = A.quality && A.quality.attrs && A.quality.attrs.google_product_category;
    A.gpcDepth = g && g.avgDepth != null ? +g.avgDepth : null;
  }
  function convOf(A) {
    var cov = {};
    CONV_KEYS.forEach(function (k) { cov[k] = A.golden && A.golden.cov && A.golden.cov[k] != null ? +A.golden.cov[k] : null; });
    A.conv.cov = cov;
    A.conv.n = A.golden && A.golden.gs ? A.golden.gs.ai.n : null;
  }
  function arrivalsFrom(Arr, dob, now, rows, r) {
    if (!Arr || !dob || !dob.m) return null;
    var s = Arr.stats(dob, new Date(now), rows);
    var perS = s.m12 != null ? s.m12 : (s.forecast ? s.forecast.month : null);
    return { s: s, perMonthS: perS, perMonthP: (r && perS != null) ? perS / r : null,
      basis: s.forecast ? s.forecast.basis : null, coverage: s.coverage,
      months: s.months.map(function (m) { return { k: m.k, n: m.n, complete: m.complete }; }) };
  }
  function missingOf(A) {
    var m = [];
    if (!A.golden) m.push('never scanned — no Golden Record coverage yet');
    if (!A.quality) m.push('no content-quality reading yet — runs automatically at ' + DAILY_RUN + ', or run the live audit');
    if (A.emptyRead) m.push('the live read returned no products' + (A.S != null ? ' — the stored reading is kept' : ' — check the feed and read it again'));
    if (A.pRefused != null) m.push('the typed parent count ' + fmtInt(A.pRefused) + ' is more than the ' + fmtInt(A.S) + ' SKUs read — a parent product can never outnumber its SKUs; check the figure');
    if (A.P == null) m.push(A.src === 'stored' ? 'parent products not counted yet — the live count fills it' : 'parent products could not be counted — type the count');
    if (!A.ptDepth) m.push('product type depth not profiled on this read');
    if (A.air == null) m.push('AI-readiness not analysed yet');
    if (A.arrivals.unit === 'fallback') m.push('no first-seen dates in the feed — new products a month uses FeedSpark\'s 10.5% a year working estimate');
    else if (A.arrivals.perMonthS == null && A.arrivals.perMonthP == null) m.push('no first-seen dates (fs:date_of_birth) captured for this feed');
    if (A.arrivals.coverage != null && A.arrivals.coverage < 0.9) m.push('first-seen dates cover only ' + Math.round(A.arrivals.coverage * 100) + '% of products — arrivals read as at least');
    if (A.golden && A.golden.cov && !('keywords' in A.golden.cov)) m.push('keyword slots not read on this scan');
    return m;
  }

  // STORED lane — KV reads only: G = (/api/golden/estate).feeds[c|m], Q = (/api/golden/quality).quality,
  // PT = (/api/ptypes/estate).feeds[c|m], D = the /api/volume/arrivals feed's dob, PR =
  // /api/golden/profile, PS = (/api/golden/pdp).sample. The Golden Score is RE-SCORED under the
  // brand's CURRENT profile, never G.score (the profile as it stood at scan time).
  function auditStored(inp, LG, Arr) {
    inp = inp || {};
    var client = String(inp.client || ''), mkt = lower(inp.mkt);
    if (!client || !mkt || /-fb$/.test(mkt)) return null;
    var G = inp.G && inp.G.cov ? inp.G : null;               // a roster row with status 'never' carries no coverage
    var Q = inp.Q && inp.Q.attrs ? inp.Q : null, PT = inp.PT || null, D = inp.D && inp.D.m ? inp.D : null, PS = inp.PS || null;
    var now = +inp.now || Date.now();
    var prof = LG.profileFor(client, inp.PR && inp.PR.overrides);
    var A = auditBase(client, mkt, 'stored', prof);
    A.t = { cov: G ? (+G.t || null) : null, qual: Q ? (+Q.t || null) : null, pt: PT && PT.t ? +PT.t : null, dob: D && D.t ? +D.t : null, live: null };
    if (G) {
      A.S = +G.rows || 0;
      A.hasGroups = G.cov.item_group_id != null;
      A.golden = goldenOf(LG, LG.attrsFromCov(G.cov, G.sc, G.rows), G.cov, G.sc || null, prof);
      A.air = G.air != null ? { total: +G.air, tier: G.airTier != null ? +G.airTier : null } : null;
      A.conv.hasVariants = (G.cov.item_group_id || 0) >= 5;
    }
    A.quality = Q ? { t: +Q.t || null, rows: +Q.rows || 0, attrs: Q.attrs, ai: Q.ai || null } : null;
    scoreQuality(LG, A);
    A.ptDepth = PT && PT.depth && PT.depth.pct ? PT.depth : null;
    convOf(A);
    var ar = arrivalsFrom(Arr, D, now, D ? D.rows : null, A.r);
    if (ar) {
      A.arrivals = { perMonthP: ar.perMonthP, perMonthS: ar.perMonthS, basis: ar.basis, coverage: ar.coverage,
        unit: ar.perMonthP != null ? 'parent' : (ar.perMonthS != null ? 'sku' : null), months: ar.months };
    }
    A.pdp = PS == null ? 'unknown' : ((+PS.n > 0 && +PS.ok === 0) ? 'blocked' : 'ok');
    A.missing = missingOf(A);
    return A;
  }

  // LIVE / FILE lane. inp = {pc, nc, xc, qs, typedP, industry, src, client, mkt, PR}: pc = the
  // parentCounter result, nc = NEEDCOUNTS, xc = labelguard xmlCollector's {snap, vol}, qs =
  // the qualityStream snapshot (each may also be the collector itself — finish()/result() is
  // called once). A file lane's profile is the industry the AM picked; its new products a
  // month read the file's own first-seen dates or say plainly they are the 10.5% estimate.
  function settle(x, m) {
    if (!x) return null;
    if (typeof x[m] === 'function') { try { return x[m](); } catch (e) { return null; } }
    return x;
  }
  function auditMerge(stored, inp, LG, Arr, now) {
    inp = inp || {}; now = +now || Date.now();
    var src = inp.src || (stored ? 'live' : 'file');
    var client = String(inp.client || (stored && stored.client) || ''), mkt = lower(inp.mkt || (stored && stored.mkt) || '');
    if (/-fb$/.test(mkt)) return null;
    var pc = settle(inp.pc, 'result'), nc = settle(inp.nc, 'finish'), X = settle(inp.xc, 'finish'), qs = settle(inp.qs, 'finish');
    var prof = src === 'file' ? profileForIndustry(LG, inp.industry || 'Retail', inp.PR)
      : (stored && stored.prof) || LG.profileFor(client, inp.PR && inp.PR.overrides);
    var A = auditBase(client, mkt, src, prof);
    if (stored && src !== 'file') {
      Object.keys(stored).forEach(function (k) { if (k !== 'missing') A[k] = stored[k]; });
      A.t = Object.assign({}, stored.t); A.conv = Object.assign({}, stored.conv); A.arrivals = Object.assign({}, stored.arrivals);
      A.src = src; A.prof = prof;
    }
    A.t.live = now;
    // A READ THAT FOUND NOTHING IS NOT A COUNT OF ZERO. An empty 200, a channel with no <item>, a
    // header-only sheet all finish cleanly with S = 0 — taken at its word that would replace a
    // populated stored reading with "nothing to fix" on every line, at £0, client-safe. So a
    // count (and the stream's coverage / arrivals) is accepted only when it found products; an
    // empty read keeps whatever the stored lane had and says so.
    var ncOk = !!(nc && nc.S > 0), pcOk = !!(pc && pc.rows > 0), xOk = !!(X && X.snap && X.snap.attrs && +X.snap.rows > 0);
    if (!ncOk && !pcOk && (nc || pc || X)) A.emptyRead = true;
    if (ncOk) { A.S = nc.S; A.P = nc.P; A.hasGroups = nc.hasGroups; A.grouped = nc.grouped; A.pSrc = 'counted'; }
    else if (pcOk) { A.S = pc.rows; A.P = pc.products; A.hasGroups = pc.hasGroups; A.grouped = pc.grouped; A.pSrc = 'counted'; }
    else if (numOr(inp.typedP) != null && +inp.typedP > 0) {
      // a typed count is a human's figure: one larger than the SKUs read is a typo (parents can
      // never outnumber SKUs) — refused and named, never priced as a 5× multiplier
      var tp = Math.round(+inp.typedP);
      if (A.S && tp > A.S) A.pRefused = tp;
      else { A.P = tp; A.pSrc = 'typed'; }
    }
    A.r = (A.S && A.P) ? A.S / A.P : null;
    if (xOk) {
      var ci = LG.goldenCovIndex(X.snap.attrs);
      A.golden = goldenOf(LG, X.snap.attrs, ci.cov, Object.keys(ci.sc).length ? ci.sc : null, prof);
      A.t.cov = now;
      var pt = X.snap.labels && X.snap.labels.product_type;
      var dp = pt && pt.values ? LG.depthProfile(pt.values) : null;
      if (dp) { A.ptDepth = dp; A.t.pt = now; }
    } else if (A.golden && A.golden.attrs) {
      A.golden = goldenOf(LG, A.golden.attrs, A.golden.cov, A.golden.sc, prof);
    }
    // content quality: a stored reading wins on the live lane (it is the whole catalogue,
    // analysed); the stream's own read fills in when there is none, and is the file lane's only one
    var storedQ = src !== 'file' && stored && stored.quality;
    var qsOk = !!(qs && qs.attrs && !A.emptyRead);
    if (!storedQ && qsOk) { A.quality = { t: +qs.t || now, rows: +qs.rows || 0, attrs: qs.attrs, ai: qs.ai || null }; A.t.qual = now; }
    if (src === 'file' && !qsOk) A.quality = null;
    scoreQuality(LG, A);
    if (A.quality && A.quality.ai) A.air = { total: +A.quality.ai.total, tier: +A.quality.ai.tier || null };
    else if (src === 'file') A.air = null;
    convOf(A);
    if (nc && nc.S) A.conv.hasVariants = !!(nc.hasGroups && nc.grouped / nc.S >= 0.05);
    // new products a month — per PARENT when the feed carries first-seen dates (a parent is
    // dated by its earliest row), else the stored SKU rate over the live S/P, else (file) the
    // FeedSpark working estimate, labelled as one
    if (ncOk && nc.dob && nc.dob.col && Arr) {
      var sp = Arr.stats({ n: nc.dob.par.n, m: nc.dob.par.m }, new Date(now), nc.P);
      var perP = sp.m12 != null ? sp.m12 : (sp.forecast ? sp.forecast.month : null);
      A.arrivals = { perMonthP: perP, perMonthS: null, basis: sp.forecast ? sp.forecast.basis : null, coverage: sp.coverage,
        unit: perP != null ? 'parent' : null, months: sp.months.map(function (m) { return { k: m.k, n: m.n, complete: m.complete }; }) };
      A.t.dob = now;
    } else if (src === 'file') {
      A.arrivals = { perMonthP: A.P != null ? A.P * AIM_NEWNESS_DEFAULT / 100 / 12 : null, perMonthS: null,
        basis: 'FeedSpark working estimate 10.5%/yr', coverage: null, unit: 'fallback', months: null };
    } else if (A.arrivals && A.arrivals.perMonthS != null) {
      A.arrivals.perMonthP = A.r ? A.arrivals.perMonthS / A.r : null;
      A.arrivals.unit = A.arrivals.perMonthP != null ? 'parent' : 'sku';
    }
    A.counts = ncOk ? nc : null;
    A.pdp = src === 'file' ? 'unknown' : (stored ? stored.pdp : 'unknown');
    A.missing = missingOf(A);
    return A;
  }

  /* ---- needsOf: how many products need each line -------------------------------------------
     NEED = {n, lo, hi, grain, est, why, parts:[{k,label,n}]}. est: null exact · 'bound' (n is
     the figure priced, lo..hi what the reading can prove) · 'ratio' (an SKU count taken to
     parents at the exact S/P) · 'sku-ceiling' (a parent line left at an SKU count — P unknown)
     · 'na' (the line does not apply, n 0) · 'unknown' (n null — never a zero). */
  function need(n, grain, est, why, parts, lo, hi) {
    return { n: n, lo: lo === undefined ? n : lo, hi: hi === undefined ? n : hi, grain: grain, est: est || null, why: why || '', parts: parts || [] };
  }
  function unknownNeed(grain, why) { return { n: null, lo: null, hi: null, grain: grain, est: 'unknown', why: why, parts: [] }; }
  function naNeed(grain, why) { return { n: 0, lo: 0, hi: 0, grain: grain, est: 'na', why: why, parts: [] }; }
  function targetsOf(tg) {
    tg = tg || {};
    return { hlTarget: +tg.hlTarget === 4 ? 4 : 6,
      descTarget: DESC_TARGETS.indexOf(+tg.descTarget) >= 0 ? +tg.descTarget : 500,
      ptMinDepth: [3, 4, 5].indexOf(+tg.ptMinDepth) >= 0 ? +tg.ptMinDepth : 3 };
  }
  // §1.12: which rule-built attributes a market's package carries
  function ruleIncluded(a, prof, apparel, inScope, sizeInScope) {
    var exp = prof.expected || [], wav = prof.waived || [];
    if (wav.indexOf(a) >= 0) return false;
    if (a === 'condition') return exp.indexOf(a) >= 0;
    if (a === 'gender' || a === 'age_group') return exp.indexOf(a) >= 0 || inScope !== false;
    return exp.indexOf(a) >= 0 || apparel || sizeInScope !== false;   // size_type / size_system
  }
  function needsOf(audit, targets, LG) {
    var out = {};
    if (!audit) return out;
    var tg = targetsOf(targets), prof = audit.prof || { expected: [], waived: [], qwaived: [] };
    var apparel = APPAREL.indexOf(audit.industry) >= 0;
    if (audit.counts) return exactNeeds(audit, tg, prof, apparel, LG);
    return storedNeeds(audit, tg, prof, apparel, LG);
  }

  // LIVE / FILE — exact, from NEEDCOUNTS
  function exactNeeds(A, tg, prof, apparel, LG) {
    var c = A.counts, out = {}, wav = prof.waived || [], exp = prof.expected || [];
    function g(pair, grain) { return pair ? (grain === 'sku' ? +pair[0] || 0 : +pair[1] || 0) : 0; }
    function below(hist, cut) { var n = 0; HKEYS.forEach(function (k) { if ((k === '6+' ? 6 : +k) < cut) n += g(hist[k], 'parent'); }); return n; }
    // title — the rules this brand has not set aside, an empty title always counts
    var qw = LG.qwaivedFor(prof, 'title'), bitsR = 0;
    TITLE_BITS.forEach(function (id, i) { if (qw.indexOf(id) < 0) bitsR |= 1 << i; });
    var tn = 0, tparts = {};
    Object.keys(c.title.masks).forEach(function (m) {
      var p = g(c.title.masks[m], 'parent'), mi = +m;
      if (mi & bitsR) tn += p;
      TITLE_BITS.forEach(function (id, i) { if ((mi & (1 << i)) && (bitsR & (1 << i))) tparts[id] = (tparts[id] || 0) + p; });
    });
    out.title = need(tn, 'parent', null, qw.length ? 'set aside for this brand: ' + qw.join(', ') : '',
      TITLE_BITS.filter(function (id) { return tparts[id]; }).map(function (id) { return { k: id, label: id === 'empty' ? 'missing' : id, n: tparts[id] }; }));
    // description — every parent with a row under the target length (an empty one included)
    var di = DESC_TARGETS.indexOf(tg.descTarget) + 2, dn = 0, dparts = [];
    DESC_B.slice(0, di).forEach(function (b) { var p = g(c.desc.b[b], 'parent'); dn += p; if (p) dparts.push({ k: b, label: b, n: p }); });
    out.desc = need(dn, 'parent', null, 'to ' + tg.descTarget + ' characters (Google: 1–5,000, key facts in the first 160–500)', dparts);
    out.highlights = need(below(c.hl.h, tg.hlTarget), 'parent', null,
      'to ' + tg.hlTarget + '+ highlights' + (tg.hlTarget === 6 ? '; Google\'s floor is 4' : ' (Google\'s floor); house target 6+'));
    out.ptype = need(below(c.pt.h, tg.ptMinDepth), 'parent', null, 'to ' + tg.ptMinDepth + '+ levels deep (an empty or badly separated path counts)');
    var gn = 0; Object.keys(c.gpc.masks).forEach(function (m) { if (+m) gn += g(c.gpc.masks[m], 'parent'); });
    out.gpc = need(gn, 'parent', null, 'missing, not a Google taxonomy value, or too broad');
    out.keywords = need(g(c.kw.none, 'parent'), 'parent', null, c.kw.slots ? '' : 'no keyword slots in this feed');
    out.details = need(g(c.det.empty, 'parent'), 'parent', null, '');
    // attribute population — SKU VALUES missing or invalid, over the products whose category asks for each
    var an = 0, au = 0, aparts = [], inc = ATTR_AI.filter(function (a) { return wav.indexOf(a) < 0; });
    inc.forEach(function (a) {
      var x = c.attrs[a] || { n: 0, u: 0, miss: 0, inv: 0 };
      if (!x.n) return;
      an += x.miss + x.inv; au = Math.max(au, x.u);   // the same unreadable rows sit in every attribute's scope — rows, not a sum
      aparts.push({ k: a, label: ATTR_WORD[a], n: x.miss + x.inv, miss: x.miss, inv: x.inv, inScope: x.n, u: x.u });
    });
    out.attr_ai = aparts.length ? need(an, 'sku', null, au ? 'category unreadable on ' + fmtInt(au) + ' rows (counted in scope)' : '', aparts)
      : naNeed('sku', inc.length ? 'no product sits in a category Google asks these of' : 'waived for this industry');
    // attribute rules — attributes, not values: one FeedHero rule builds each
    var rparts = [];
    ['gender', 'age_group', 'size_type', 'size_system', 'condition'].forEach(function (a) {
      var x = c.rule[a]; if (!x) return;
      var inScope = (a === 'gender' || a === 'age_group') ? x.n > 0 : null;
      if (!ruleIncluded(a, prof, apparel, inScope, c.client.size.n > 0)) return;
      if (x.miss > 0) rparts.push({ k: a, label: ATTR_WORD[a], n: x.miss });
    });
    out.attr_rule = need(rparts.length, 'none', null, rparts.length ? '' : 'every rule-built attribute already carried', rparts);
    // client to supply — listed, never priced
    var cparts = [];
    ['link', 'image_link', 'availability', 'price', 'brand', 'gtin_mpn'].forEach(function (a) { if (c.client[a]) cparts.push({ k: a, label: ATTR_WORD[a], n: c.client[a] }); });
    if (c.client.size.miss) cparts.push({ k: 'size', label: 'size', n: c.client.size.miss });
    if (exp.indexOf('item_group_id') >= 0 && c.client.item_group_id) cparts.push({ k: 'item_group_id', label: ATTR_WORD.item_group_id, n: c.client.item_group_id });
    out.client = need(cparts.length, 'none', null, 'listed — the client supplies these; never priced', cparts);
    out.conv = need(c.P, 'parent', null, 'Spark AI generates over the whole range');
    return out;
  }

  // STORED — the KV readings, with bounds where a reading cannot say exactly
  function storedNeeds(A, tg, prof, apparel, LG) {
    var out = {}, exp = prof.expected || [], wav = prof.waived || [];
    var G = A.golden && A.golden.cov ? { cov: A.golden.cov, sc: A.golden.sc, rows: +A.S || 0 } : null;
    var Q = A.quality && A.quality.attrs ? A.quality : null;
    function fq(k) { return Q && Q.attrs[k] ? (+Q.attrs[k].filled || 0) : 0; }
    function hn(k, id) { var a = Q && Q.attrs[k]; return a && a.rules && a.rules[id] ? (+a.rules[id].n || 0) : 0; }
    function wv(k) { return LG.qwaivedFor(prof, k); }
    // SKU rows lacking k, read from the content-quality record
    function missQ(k) {
      if (!Q) return { u: 'no content-quality reading yet — runs automatically at ' + DAILY_RUN + ', or run the live audit' };
      if (Q.attrs[k]) return { n: Math.max(0, (+Q.rows || 0) - fq(k)) };
      if (G && G.cov[k] === null && !(G.sc && G.sc[k] === 0)) return { n: +Q.rows || 0 };
      return { u: 'column not read by the last content-quality analysis' };
    }
    // SKU rows lacking k, read from coverage (GPC scope where the read measured it)
    function missG(k) {
      if (!G) return { u: 'never scanned' };
      var c = G.cov[k];
      if (G.sc && Object.prototype.hasOwnProperty.call(G.sc, k)) {
        var n = +G.sc[k] || 0;
        if (n === 0) return { na: true };
        return { n: c == null ? n : Math.round(n * (1 - c / 100)) };
      }
      if (LG.GPC_SCOPE[k]) {
        if (exp.indexOf(k) >= 0 || apparel) return { n: c == null ? G.rows : Math.round(G.rows * (1 - c / 100)), bound: true };
        return { u: 'category scope not measured on this read' };
      }
      return { n: c == null ? G.rows : Math.round(G.rows * (1 - c / 100)) };
    }
    // a union of rule hits over disjoint-from-missing filled values: at least the biggest
    // rule, at most their sum (capped at the filled count)
    function U(base, hits, cap, grain, why, parts) {
      var mx = 0, sum = 0;
      hits.forEach(function (h) { mx = Math.max(mx, h); sum += h; });
      var lo = base + mx, hi = base + (cap != null ? Math.min(cap, sum) : sum);
      if (hi < lo) hi = lo;
      return need(lo, grain, hi > lo ? 'bound' : null, why, parts, lo, hi);
    }
    // title
    var tb = missQ('title');
    if (tb.u) out.title = unknownNeed('parent', tb.u);
    else {
      var tw = wv('title'), tparts = [{ k: 'empty', label: 'missing', n: tb.n }];
      var hits = ['len-over', 'caps', 'promo', 'gimmick', 'no-brand'].filter(function (id) { return tw.indexOf(id) < 0; })
        .map(function (id) { var n = hn('title', id); if (n) tparts.push({ k: id, label: id, n: n }); return n; });
      var ts = (tw.indexOf('thin') < 0 ? hn('title', 'thin') : 0) + (tw.indexOf('short') < 0 ? hn('title', 'short') : 0);
      if (ts) tparts.push({ k: 'thin+short', label: 'under 70 characters', n: ts });
      hits.push(ts);
      out.title = U(tb.n, hits, Q.attrs.title ? fq('title') : 0, 'parent',
        'a product can break several rules — the live audit counts each once' + (tw.length ? '; set aside: ' + tw.join(', ') : ''), tparts.filter(function (p) { return p.n; }));
    }
    // keywords — an ABSENT key is not measured, a null one is measured and missing
    if (!G) out.keywords = unknownNeed('parent', 'never scanned');
    else if (!Object.prototype.hasOwnProperty.call(G.cov, 'keywords')) out.keywords = unknownNeed('parent', 'keyword slots not read on this scan — sheet-backed or pre-30-Sep reading');
    else if (G.cov.keywords === null) out.keywords = need(G.rows, 'parent', null, 'no keyword slots in this feed');
    else out.keywords = need(Math.round(G.rows * (1 - G.cov.keywords / 100)), 'parent', null, '');
    // product type
    var pb = missQ('product_type');
    if (pb.u) out.ptype = unknownNeed('parent', pb.u);
    else {
      var sl = hn('product_type', 'single-level'), pf = fq('product_type'), plo = pb.n + sl, phi = pb.n + pf, pn = plo;
      var dp = A.ptDepth;
      if (dp && dp.pct && tg.ptMinDepth === 3) pn = pb.n + Math.max(Math.round(pf * ((+dp.pct['1'] || 0) + (+dp.pct['2'] || 0)) / 100), sl);
      out.ptype = need(pn, 'parent', phi > plo ? 'bound' : null,
        tg.ptMinDepth === 3 ? 'depth read off the top product-type paths' : 'depth ' + tg.ptMinDepth + '+ is only exact on the live audit — at least the single-level paths',
        [{ k: 'missing', label: 'missing', n: pb.n }, { k: 'single-level', label: 'a single level', n: sl }].filter(function (p) { return p.n; }), plo, Math.max(phi, pn));
    }
    // GPC — a placeholder fires both rules, so the two are a union, not a sum
    var gb = missQ('google_product_category');
    if (gb.u) out.gpc = unknownNeed('parent', gb.u);
    else {
      var nt = hn('google_product_category', 'not-taxonomy'), sh = hn('google_product_category', 'shallow');
      out.gpc = U(gb.n, [nt, sh], fq('google_product_category'), 'parent', 'a value can be both invalid and too broad — the live audit counts it once',
        [{ k: 'missing', label: 'missing', n: gb.n }, { k: 'not-taxonomy', label: 'not a Google taxonomy value', n: nt }, { k: 'shallow', label: 'too broad', n: sh }].filter(function (p) { return p.n; }));
    }
    // attribute population (SKU values)
    var alo = 0, ahi = 0, aBound = false, aUnknown = null, aparts = [], inc = ATTR_AI.filter(function (a) { return wav.indexOf(a) < 0; });
    inc.forEach(function (a) {
      var m = missG(a);
      if (m.u) { aUnknown = aUnknown || (ATTR_WORD[a] + ': ' + m.u); return; }
      if (m.na) return;
      var f = Q ? ATTR_INV[a].map(function (id) { return hn(a, id); }) : [];
      var mx = 0, sm = 0; f.forEach(function (x) { mx = Math.max(mx, x); sm += x; });
      alo += m.n + mx; ahi += m.n + sm;
      if (sm > mx || m.bound) aBound = true;
      aparts.push({ k: a, label: ATTR_WORD[a], n: m.n + mx, miss: m.n, inv: mx, invHi: sm, bound: !!m.bound });
    });
    if (aUnknown) out.attr_ai = unknownNeed('sku', aUnknown);
    else if (!aparts.length) out.attr_ai = naNeed('sku', inc.length ? 'no product sits in a category Google asks these of' : 'waived for this industry');
    else if (!Q) out.attr_ai = need(alo, 'sku', 'bound', 'invalid values not counted until a content-quality reading exists', aparts, alo, null);
    else out.attr_ai = need(alo, 'sku', aBound ? 'bound' : null, aBound ? 'category scope or overlapping invalid values estimated — exact on the live audit' : '', aparts, alo, ahi);
    // attribute rules — which attributes need a FeedHero rule
    if (!G) out.attr_rule = unknownNeed('none', 'never scanned');
    else {
      var rparts = [], rflag = false, sizeIn = G.sc && Object.prototype.hasOwnProperty.call(G.sc, 'size') ? G.sc.size > 0 : null;
      ['gender', 'age_group', 'size_type', 'size_system', 'condition'].forEach(function (a) {
        var inScope = (a === 'gender' || a === 'age_group') ? (G.sc && Object.prototype.hasOwnProperty.call(G.sc, a) ? G.sc[a] > 0 : null) : null;
        if (!ruleIncluded(a, prof, apparel, inScope, sizeIn)) return;
        var m = missG(a);
        if (m.na) return;
        var unk = !!m.u || (a !== 'condition' && inScope === null && (a === 'gender' || a === 'age_group')) || (sizeIn === null && (a === 'size_type' || a === 'size_system') && !apparel && exp.indexOf(a) < 0);
        if (m.u) { if (G.cov[a] === 100) return; rparts.push({ k: a, label: ATTR_WORD[a], n: null, flag: 'scope not measured' }); rflag = true; return; }
        if (m.n > 0) { rparts.push({ k: a, label: ATTR_WORD[a], n: m.n, flag: unk || m.bound ? 'scope not measured' : undefined }); if (unk || m.bound) rflag = true; }
      });
      out.attr_rule = need(rparts.length, 'none', rflag ? 'bound' : null, rflag ? 'category scope not measured on this read — included and flagged' : '', rparts);
    }
    // client to supply (info)
    if (!G) out.client = unknownNeed('none', 'never scanned');
    else {
      var cparts = [];
      ['link', 'image_link', 'availability', 'price', 'brand'].forEach(function (a) { var m = missG(a); if (m.n) cparts.push({ k: a, label: ATTR_WORD[a], n: m.n }); });
      var gm = Math.round(G.rows * (1 - Math.max(+G.cov.gtin || 0, +G.cov.mpn || 0) / 100));
      if (gm) cparts.push({ k: 'gtin_mpn', label: ATTR_WORD.gtin_mpn, n: gm });
      var zm = missG('size');
      if (zm.n) cparts.push({ k: 'size', label: 'size', n: zm.n });
      else if (zm.u && G.cov.size !== 100) cparts.push({ k: 'size', label: 'size', n: null, flag: zm.u });
      if (exp.indexOf('item_group_id') >= 0) { var im = missG('item_group_id'); if (im.n) cparts.push({ k: 'item_group_id', label: ATTR_WORD.item_group_id, n: im.n }); }
      out.client = need(cparts.length, 'none', null, 'listed — the client supplies these; never priced', cparts);
    }
    // highlights — T=4 is exact (Google's two rules), T=6 reads the 1..5 shares
    var hb = missQ('product_highlight');
    if (hb.u) out.highlights = unknownNeed('parent', hb.u);
    else {
      var t4 = hb.n + hn('product_highlight', 'count-min') + hn('product_highlight', 'count-low');
      if (tg.hlTarget === 4) out.highlights = need(t4, 'parent', null, 'to 4+ highlights (Google\'s floor); house target 6+');
      else {
        var hl = Q.attrs.product_highlight, hf = fq('product_highlight');
        if (hl && hl.hlDist) {
          var shr = 0; ['1', '2', '3', '4', '5'].forEach(function (b) { shr += +hl.hlDist[b] || 0; });
          var h6 = Math.max(t4, hb.n + Math.round(hf * shr / 100));
          out.highlights = need(h6, 'parent', 'bound', 'to 6+ highlights; Google\'s floor is 4 — shares rounded to 0.1%', [], h6, h6);
        } else out.highlights = need(t4, 'parent', hb.n + hf > t4 ? 'bound' : null, 'no 6+ breakdown on this reading — at least the products under Google\'s 4', [], t4, hb.n + hf);
      }
    }
    var dm = missG('product_detail');
    out.details = dm.u ? unknownNeed('parent', dm.u) : need(dm.n, 'parent', null, '');
    // description — under 160 is exact; the 160–D band is only counted live
    var db = missQ('description');
    if (db.u) out.desc = unknownNeed('parent', db.u);
    else {
      var d160 = db.n + hn('description', 'thin');
      if (tg.descTarget === 160) out.desc = need(d160, 'parent', null, 'to 160 characters (Google: key facts in the first 160–500)');
      else {
        var dhi = db.n + fq('description');
        out.desc = need(d160, 'parent', dhi > d160 ? 'bound' : null, 'the 160–' + tg.descTarget + ' band is only counted by the live audit', [], d160, dhi);
      }
    }
    // conversational — Spark AI generates over the whole range
    if (A.P != null) out.conv = need(A.P, 'parent', null, 'Spark AI generates over the whole range');
    else if (A.S != null) out.conv = need(A.S, 'parent', 'sku-ceiling', 'parent products not counted yet — SKU count shown');
    else out.conv = unknownNeed('parent', 'never scanned');
    // SKU → parent, at the exact S/P; with no P the SKU count stands, marked as a ceiling
    var P = A.P, S = A.S;
    Object.keys(out).forEach(function (k) {
      var x = out[k];
      if (k === 'conv' || x.grain !== 'parent' || x.est === 'unknown' || x.est === 'na') return;
      if (P != null && S) {
        var cv = function (v) { return v == null ? null : Math.min(P, Math.ceil(v * P / S)); };
        x.n = cv(x.n); x.lo = cv(x.lo); x.hi = cv(x.hi);
        x.est = x.est === 'bound' ? 'bound' : 'ratio';
      } else { x.bound = x.est === 'bound'; x.est = 'sku-ceiling'; }
    });
    return out;
  }

  /* ---- what is already contracted: the AI Quote's saved quotes ------------------------------
     A quote counts when it is live (not deleted, not superseded), for this client + market,
     not Declined, and either CHOSEN (the newest choice in its proposal) or moved past Approved
     on the finance rail. Its legacy field lines and its Spark AI routes map onto package lines. */
  var LEGACY_LINE = { title_gen: 'title', keywords: 'keywords', pt_class: 'ptype', gpc: 'gpc', highlights: 'highlights',
    details: 'details', desc_gen: 'desc', visual_attr: 'attr_ai' };
  // the legacy AI type's conversational field lines (before Spark AI) are the same six
  var LEGACY_CONV = { question_and_answer: 'qa', document_link: 'doc', related_product: 'rel', item_group_title: 'igt', variant_option: 'vopt', popularity_rank: 'pop' };
  var STAGES_COUNTED = ['Greenlight', 'In action', 'Delivered', 'Billed'];
  function contractedFrom(savedMap, client, mkt) {
    var out = { lines: {}, conv: {}, bundle: null };
    var c = lower(client), m = lower(mkt);
    var live = entries(savedMap).filter(function (e) {
      var q = e[1];
      return q && typeof q === 'object' && !q.deleted && !q.superseded && lower(q.client) === c && lower(q.mkt) === m && q.stage !== 'Declined';
    });
    var newest = {};   // proposal id -> the newest chosen.t (two AMs can each click before their stores merge)
    live.forEach(function (e) { var q = e[1]; if (q.chosen && q.prop && q.prop.id) newest[q.prop.id] = Math.max(newest[q.prop.id] || 0, tOf(q.chosen) || 0); });
    live.sort(function (a, b) { return (+a[1].t || 0) - (+b[1].t || 0); });   // newer refs win the map
    live.forEach(function (e) {
      var q = e[1];
      var chosen = !!q.chosen && (!(q.prop && q.prop.id) || (tOf(q.chosen) || 0) >= (newest[q.prop.id] || 0));
      if (!chosen && STAGES_COUNTED.indexOf(q.stage) < 0) return;
      var ref = q.ref || e[0];
      (q.lines || []).forEach(function (l) {
        if (!l) return;
        if (LEGACY_LINE[l.id]) out.lines[LEGACY_LINE[l.id]] = ref;
        else if (LEGACY_CONV[l.id]) out.conv[LEGACY_CONV[l.id]] = ref;
      });
      ((q.aim && q.aim.lines) || []).forEach(function (l) {
        if (!l || !l.route || l.route === 'off' || l.id === 'min') return;
        if (l.key === 'product_highlight' || l.id === 'hi') out.lines.highlights = ref;
        else out.conv[l.id] = ref;
      });
      if (q.upd && typeof q.upd === 'object') out.bundle = ref;
    });
    return out;
  }

  /* ---- delivery status per line × industry --------------------------------------------------
     The team's own word wins (industry, then '*'), then evidence (a tracked brief for the line's
     catalogue id — it has been delivered), then the seed; otherwise UNCONFIRMED, which priced
     lines carry as a blocker until somebody says what is true. */
  var ROADMAP_SEED = { 'attr_rule|*': 'live' };
  var RM_STATUS = ['live', 'pilot', 'building', 'planned'];
  function roadmapStatus(map, lineKey, industry, actuals) {
    map = map || {};
    function read(k) { var v = map[k]; v = v && typeof v === 'object' && v.v && typeof v.v === 'object' ? v.v : v; return v && RM_STATUS.indexOf(v.status) >= 0 ? v : null; }
    var hit = industry ? read(lineKey + '|' + industry) : null;
    if (hit) return { status: hit.status, src: 'industry', note: hit.note || '' };
    hit = read(lineKey + '|*');
    if (hit) return { status: hit.status, src: '*', note: hit.note || '' };
    var cat = LINE_BY[lineKey] ? LINE_BY[lineKey].cat : '';
    if (cat && actuals && actuals[cat] && actuals[cat].n >= 1) return { status: 'live', src: 'evidence', note: actuals[cat].n + ' tracked brief' + (actuals[cat].n === 1 ? '' : 's') };
    if (ROADMAP_SEED[lineKey + '|*']) return { status: ROADMAP_SEED[lineKey + '|*'], src: 'seed', note: '' };
    return { status: null, src: 'unconfirmed', note: 'confirm delivery status' };
  }

  // Spark AI's default routes for a proposal's markets. An attribute already at 95%+ in every
  // market stays off; the two variant attributes only where the feed carries item groups; a
  // document link is scraped unless the PDP blocks the scanner, then it comes from the feed.
  function aimDefaultSources(audits) {
    var list = (audits || []).filter(Boolean);
    var groups = list.some(function (a) { return a.conv && a.conv.hasVariants; });
    var blocked = list.some(function (a) { return a.pdp === 'blocked'; });
    var src = { qa: 'ai', igt: groups ? 'ai' : 'off', doc: blocked ? 'feed' : 'scrape', rel: 'feedhero', vopt: groups ? 'feedhero' : 'off', pop: 'feedhero', hi: 'off' };
    AIM_ATTRS.forEach(function (a) {
      if (!list.length || src[a.id] === 'off') return;
      var low = list.some(function (au) { var c = au.conv && au.conv.cov ? au.conv.cov[a.key] : null; return !(c >= 95); });
      if (!low) src[a.id] = 'off';
    });
    return src;
  }

  /* ---- packageQuote: price a tier for a client's markets ------------------------------------
     §4.1 of the services spec, line for line. One volume factor β = tieredUnits(Pβ)/Pβ on the
     weighted parent count, applied to every generation line; set-up hours block-rounded ONCE
     over the whole option; the conversational six in ONE Spark AI build over the combined
     range; monthly = monitoring blocks + every new parent through the full package (with the
     Management floor) + Spark AI's monthly. Unknown / unpriced / coming / contracted lines are
     listed and kept out of every total; every reason a figure is not yet client-safe is a
     blocker. */
  function packageQuote(spec, LG) {
    spec = spec || {};
    var option = (spec.option === 'ar' || spec.option === 'go+ar' || spec.option === 'go+ar+rf') ? spec.option : 'go';
    // Tier 3 carries every Tier 2 line; `core` is the option its lines are read under
    var core = option === 'go+ar+rf' ? 'go+ar' : option;
    var R = spec.rates || composeRates({}), g = R.g || {}, opts = spec.opts || {}, tg = targetsOf(spec.targets);
    var aimR = aimRatesOf(spec.aimRates), buffer = aimR.buffer;
    var blockGBP = numOr(g.blockGBP) || DEFAULTS.blockGBP, blockH = numOr(g.blockH) || DEFAULTS.blockHours;
    var mk = (spec.markets || []).filter(function (m) { return m && m.audit; }).map(function (m) {
      var a = m.audit, mkt = lower(m.mkt || a.mkt);
      // P_m := P ?? S — but a size of ZERO is no size: a read that found nothing (S 0) is
      // "not sized", never "nothing to fix"
      var Pm = a.P != null && +a.P > 0 ? +a.P : (a.S != null && +a.S > 0 ? +a.S : null);
      return { mkt: mkt, audit: a, needs: m.needs || needsOf(a, tg, LG), lang: m.lang || langOf(mkt),
        S: a.S, P: a.P, Pm: Pm, empty: a.S != null && +a.S === 0 };
    });
    // language groups: the lead (largest P; gb first on a tie, then A–Z) is written, the rest re-used
    var groups = {};
    mk.forEach(function (m) { (groups[m.lang] = groups[m.lang] || []).push(m); });
    var reuseSet = numOr(g.reusePct) != null, reuse = reuseSet ? g.reusePct / 100 : 1;
    var shared = Object.keys(groups).some(function (k) { return groups[k].length > 1; });
    var reuseUnset = !reuseSet && shared;
    Object.keys(groups).forEach(function (k) {
      groups[k].slice().sort(function (x, y) {
        return ((y.Pm || 0) - (x.Pm || 0)) || ((x.mkt === 'gb' ? 0 : 1) - (y.mkt === 'gb' ? 0 : 1)) || (x.mkt < y.mkt ? -1 : x.mkt > y.mkt ? 1 : 0);
      }).forEach(function (m, i) { m.lead = i === 0; m.w = i === 0 ? 1 : reuse; });
    });
    var nLang = Object.keys(groups).length;
    var Pbeta = 0; mk.forEach(function (m) { Pbeta += m.w * (m.Pm || 0); });
    var TU = Pbeta > 0 ? tieredUnits(Pbeta, g.tiers).units : 0;
    var beta = Pbeta > 0 ? TU / Pbeta : 1;
    var industry = mk.length ? mk[0].audit.industry : null;
    function contr(m) {
      var c = spec.contracted;
      if (!c) return { lines: {}, conv: {}, bundle: null };
      if (c.lines || c.conv) return c;
      return c[m.mkt] || { lines: {}, conv: {}, bundle: null };
    }
    var incC = !!opts.includeContracted, lineOpts = spec.lineOpts || {};
    var EST_RANK = { 'sku-ceiling': 3, bound: 2, ratio: 1 };
    var lines = [], unknown = [], unpriced = [], coming = [], estimated = [], blockers = [];
    function block(code, why, extra) { var b = { code: code, why: why }; if (extra) Object.keys(extra).forEach(function (k) { b[k] = extra[k]; }); blockers.push(b); }
    // the number of in-scope SKU VALUES for the attr line's "every product" scope → {n, bound} or
    // null. bound: the category scope was NOT measured on this read, so every product of an
    // apparel brand was taken as in scope — an UPPER bound (§3.3), never priced as exact.
    function allValues(m) {
      var a = m.audit, n = 0, ok = true, bound = false;
      ATTR_AI.forEach(function (k) {
        if ((a.prof.waived || []).indexOf(k) >= 0) return;
        if (a.counts) { n += a.counts.attrs[k] ? a.counts.attrs[k].n : 0; return; }
        var sc = a.golden && a.golden.sc;
        if (sc && Object.prototype.hasOwnProperty.call(sc, k)) n += +sc[k] || 0;
        else if (a.S != null && (APPAREL.indexOf(a.industry) >= 0 || (a.prof.expected || []).indexOf(k) >= 0)) { n += a.S; bound = true; }
        else ok = false;
      });
      return ok ? { n: n, bound: bound } : null;
    }
    var priced = {}, conv = null;   // key -> line, for the monthly and the projection; the Spark AI build
    // the lines THIS option carries, read off the bank: a built-in line at the tier the bank sets, then every
    // feed optimisation the team added (priced like generation off its own row); services are extras below
    var BK = bankOf(spec.bank), LBY = {}, LINES = [];
    PKG_LINES.forEach(function (d) {
      var b = BK.filter(function (x) { return x.key === d.key; })[0];
      var def = Object.assign({}, d, { pkg: b ? b.pkg : d.pkg, gives: b ? b.gives : '' });
      LBY[d.key] = def; LINES.push(def);
    });
    BK.filter(function (b) { return b.custom && b.kind === 'feed'; }).forEach(function (b) {
      var def = { key: b.key, pkg: b.pkg, row: null, grain: b.unit != null ? b.grain : 'none', cat: '', label: b.label, fixes: b.fields, custom: true, gives: b.gives,
        crow: { unit: b.unit == null ? 0 : b.unit, aspl: b.setupH || 0, qc: 0, pm: 0, mon: 0, lead: 5, unpriced: b.unit == null && b.setupH == null },
        status: b.status, why: b.why };
      LBY[b.key] = def; LINES.push(def);
    });
    // a team-added feed line's need: the products its fields leave empty (worst field), else every product
    mk.forEach(function (m) {
      m.needs = Object.assign({}, m.needs);
      LINES.forEach(function (d) {
        if (!d.custom) return;
        var a = m.audit, at = a.golden && a.golden.attrs, Pn = d.grain === 'sku' ? (a.S != null && +a.S > 0 ? +a.S : m.Pm) : m.Pm;
        if (Pn == null) { m.needs[d.key] = unknownNeed(d.grain, 'not sized — count the feed first'); return; }
        var meas = (d.fixes || []).filter(function (k) { return at && at[k] && !at[k].na; });
        if (d.fixes.length && meas.length === d.fixes.length) {
          var worst = Math.min.apply(null, meas.map(function (k) { return at[k].present ? +at[k].cov || 0 : 0; }));
          var n = Math.round(Pn * (100 - worst) / 100);
          m.needs[d.key] = { n: n, lo: n, hi: n, grain: d.grain, est: 'ratio', why: 'products missing ' + meas.join(', ') + ' (' + worst + '% filled)', parts: [] };
        } else {
          m.needs[d.key] = { n: Pn, lo: Pn, hi: Pn, grain: d.grain, est: d.fixes.length ? 'bound' : null, parts: [],
            why: d.fixes.length ? 'not measured on this read — every product taken as in scope' : 'every product' };
        }
      });
    });
    LINES.forEach(function (def) {
      if (!inOption(option, def.pkg)) return;
      var lo = lineOpts[def.key] || {}, on = lo.on !== false, scope = lo.scope === 'all' ? 'all' : 'need';
      var row = def.row ? (R.rows || {})[def.row] || null : (def.crow || null);
      var rm = def.custom ? { status: def.status, src: 'bank', note: '' } : roadmapStatus(spec.roadmap, def.key, industry, spec.actuals);
      var L = { key: def.key, pkg: def.pkg, custom: !!def.custom, gives: def.gives || '', label: def.label, cat: def.cat, grain: def.grain, status: 'priced', scope: scope,
        need: null, units: 0, unit: row ? row.unit : null, gen: 0, genHi: null, setupH: 0, monH: 0, lead: row ? row.lead : null,
        reason: '', roadmap: rm, byMkt: {} };
      // the need, summed over markets (n / lo / hi stay null when any market cannot say)
      var nn = 0, nlo = 0, nhi = 0, est = null, anyUnknown = null, allNa = true, why = [];
      mk.forEach(function (m) {
        var x = m.needs[def.key] || unknownNeed(def.grain, 'not measured');
        L.byMkt[m.mkt] = x;
        if (x.est === 'unknown') { anyUnknown = anyUnknown || (m.mkt.toUpperCase() + ': ' + x.why); return; }
        if (x.est !== 'na') allNa = false;
        nn += x.n || 0; nlo += x.lo || 0; nhi = (nhi == null || x.hi == null) ? null : nhi + x.hi;
        if (EST_RANK[x.est] > (EST_RANK[est] || 0)) est = x.est;
        if (x.why && why.indexOf(x.why) < 0) why.push(x.why);
      });
      L.need = { n: anyUnknown ? null : nn, lo: anyUnknown ? null : nlo, hi: anyUnknown ? null : nhi, est: anyUnknown ? 'unknown' : (allNa && mk.length ? 'na' : est), grain: def.grain, why: anyUnknown || why.join(' · ') };
      var cMk = mk.filter(function (m) { return !incC && (def.key === 'conv' ? false : !!contr(m).lines[def.key]); });
      L.contractedIn = cMk.map(function (m) { return m.mkt; });
      // the need over the markets this line PRICES — the count the client copy prints beside the
      // £, which leaves out a market where the line is already contracted
      if (cMk.length && !anyUnknown) {
        var pn = 0, plo = 0, phi = 0;
        mk.forEach(function (m) {
          if (cMk.indexOf(m) >= 0) return;
          var x = L.byMkt[m.mkt]; if (x.est === 'na') return;
          pn += x.n || 0; plo += x.lo || 0; phi = (phi == null || x.hi == null) ? null : phi + x.hi;
        });
        L.pricedNeed = { n: pn, lo: plo, hi: phi, est: L.need.est, grain: def.grain, why: L.need.why };
      }
      if (def.key === 'client') { L.status = 'client'; L.reason = 'listed — the client supplies these values; never priced'; lines.push(L); return; }
      if (!on) { L.status = 'off'; L.reason = 'switched off for this proposal'; lines.push(L); return; }
      if (rm.status === 'building' || rm.status === 'planned') { L.status = 'coming'; L.reason = 'coming — included when live'; coming.push(def.key); lines.push(L); return; }
      if (mk.length && cMk.length === mk.length) {
        L.status = 'contracted'; L.reason = 'already contracted on ' + contr(mk[0]).lines[def.key]; lines.push(L); return;
      }
      if (def.aim) return priceConv(L);
      var sizeUnknown = mk.some(function (m) { return m.Pm == null; });
      // a market whose read found no products cannot say "nothing to fix" — it is not sized
      var emptyMk = mk.filter(function (m) { return m.empty && cMk.indexOf(m) < 0; });
      if (anyUnknown || (scope === 'all' && sizeUnknown) || emptyMk.length) {
        var uwhy = anyUnknown || (emptyMk.length ? emptyMk.map(function (m) { return m.mkt.toUpperCase(); }).join(', ') + ': the feed read returned no products — read it again' : 'not sized — count the feed first');
        L.status = 'unknown'; L.reason = uwhy; unknown.push(def.key);
        if (row && row.unpriced) unpriced.push(def.key);
        block('unknown', def.label + ' not sized — ' + (anyUnknown || (emptyMk.length ? uwhy : 'count the feed')), { line: def.key });
        lines.push(L); return;
      }
      if (row && row.unpriced) {
        L.status = 'unpriced'; L.reason = 'price not set — Management'; unpriced.push(def.key);
        block('unpriced', def.label + ': price not set — Management', { line: def.key });
        lines.push(L); return;
      }
      if (scope === 'all' && def.grain === 'sku' && mk.some(function (m) { return cMk.indexOf(m) < 0 && allValues(m) == null; })) {
        L.status = 'unknown'; L.reason = 'category scope not measured — the every-product scope needs the live audit'; unknown.push(def.key);
        block('unknown', def.label + ' not sized — category scope not measured', { line: def.key });
        lines.push(L); return;
      }
      // units per market — the products needing the line, or every product
      var units = 0, raw = 0, rawHi = 0, unitsHi = 0, hiOk = true, gen = 0, genHi = 0, lineEst = scope === 'all' ? null : L.need.est, allBound = false;
      mk.forEach(function (m) {
        var x = L.byMkt[m.mkt];
        if (cMk.indexOf(m) >= 0) return;
        var u, uh;
        if (scope === 'all') {
          if (def.grain === 'sku') {
            var av = allValues(m); u = av.n;
            // the category scope not measured: every product of the brand taken as in scope — an
            // UPPER bound, so the line is an estimate and the guard holds the figure back
            if (av.bound) { allBound = true; if ((EST_RANK[lineEst] || 0) < EST_RANK.bound) lineEst = 'bound'; }
          } else u = m.Pm;
          uh = u;
          if (def.grain === 'parent' && m.P == null) lineEst = 'sku-ceiling';
        } else {
          u = x.est === 'na' ? 0 : (x.n || 0);
          uh = x.est === 'na' ? 0 : x.hi;
          if (uh == null) hiOk = false;
        }
        units += m.w * u; raw += u; rawHi += uh || 0; unitsHi += m.w * (uh || 0);
        if (def.grain !== 'none') {
          // gen = unit × β × units × w, β = TU / Pβ — and β = 1 when no market is sized (Pβ = 0):
          // a need read off the content-quality record still prices, never a silent £0
          if (Pbeta > 0) {
            gen += round2(L.unit * TU * (u * m.w) / Pbeta);
            genHi += round2(L.unit * TU * ((uh || 0) * m.w) / Pbeta);
          } else {
            gen += round2(L.unit * u * m.w);
            genHi += round2(L.unit * (uh || 0) * m.w);
          }
        }
      });
      L.units = units;
      if (def.key === 'attr_rule') {
        var maxAttrs = 0; mk.forEach(function (m) { if (cMk.indexOf(m) < 0) maxAttrs = Math.max(maxAttrs, L.byMkt[m.mkt].n || 0); });
        if (!maxAttrs) { L.status = 'none'; L.reason = 'every rule-built attribute already carried'; lines.push(L); return; }
        L.ruleAttrs = maxAttrs;
        L.setupH = (numOr(g.ruleH) || 0) * maxAttrs;
        if (numOr(g.ruleH) == null) block('draft-ruleH', 'hours per FeedHero rule not entered — ASPL', { line: def.key, draft: true });
      } else {
        // "nothing to fix" only when the reading PROVES zero: an exact 0, or a bound whose upper end
        // is 0 too. A bound of 0 to 1,000 (the 160–D description band, a 4+ product-type depth, an
        // attribute with no content-quality reading) stays priced at its lower end with its upper end
        // beside it, and the estimate blocker keeps it out of client copy.
        if (L.need.est === 'na' || (!raw && hiOk && !rawHi)) {
          L.status = 'none'; L.reason = L.need.est === 'na' ? (L.need.why || 'does not apply') : 'nothing to fix'; lines.push(L); return;
        }
        L.gen = round2(gen);
        L.genHi = hiOk && (lineEst === 'bound' || (lineEst === 'sku-ceiling' && round2(genHi) > L.gen)) ? round2(genHi) : null;
        L.setupH = (row.aspl || 0) + (row.qc || 0) + (row.pm || 0);
        L.monH = row.mon || 0;
        if (row.draftUnit) block('draft-unit', def.label + ': the unit price is still a draft — Management', { line: def.key, draft: true });
        if (row.draftHours) block('draft-hours', def.label + ': hours still draft defaults — ASPL / London AM', { line: def.key, draft: true });
      }
      L.est = lineEst;
      if (lineEst === 'bound' || lineEst === 'sku-ceiling') {
        var nd = L.pricedNeed || L.need, ew;
        if (lineEst === 'sku-ceiling') ew = 'parent products not counted — SKU count used';
        else if (def.key === 'attr_rule') ew = 'category scope not measured';
        else if (allBound) ew = 'category scope not measured — every product taken as in scope (an upper bound)';
        else if (nd.lo) ew = 'an estimated count, at least ' + fmtInt(nd.lo) + (nd.hi != null && nd.hi > nd.lo ? ', up to ' + fmtInt(nd.hi) : '');
        else ew = 'not counted on this reading' + (nd.hi != null && nd.hi > 0 ? ' — up to ' + fmtInt(nd.hi) : '');
        block('estimate', def.label + ': ' + ew + ' — run the live audit', { line: def.key });
      }
      if (lineEst) estimated.push(def.key);
      if (rm.src === 'unconfirmed') block('roadmap', def.label + ': confirm delivery status', { line: def.key });
      if (rm.status === 'pilot') L.reason = 'pilot';
      if (cMk.length) L.reason = (L.reason ? L.reason + ' · ' : '') + 'already contracted in ' + cMk.map(function (m) { return m.mkt.toUpperCase(); }).join(', ');
      priced[def.key] = L;
      lines.push(L);
    });

    // Spark AI — one build over the combined range of every market
    function rateOf(m) {
      var ar = m.audit.arrivals || {};
      if (ar.perMonthP != null) return { rate: ar.perMonthP, est: ar.unit === 'fallback' ? 'fallback' : null };
      if (ar.perMonthS != null) return { rate: ar.perMonthS, est: 'sku-ceiling' };
      if (m.Pm != null) return { rate: m.Pm * AIM_NEWNESS_DEFAULT / 100 / 12, est: 'fallback' };
      return { rate: null, est: 'unknown' };
    }
    function priceConv(L) {
      var srcs = {}, given = spec.aimSources || aimDefaultSources(mk.map(function (m) { return m.audit; })), set = [], part = [];
      AIM_ATTRS.forEach(function (a) {
        var r = given[a.id] || 'off';
        if (!aimRouteOk(a.id, r)) r = 'off';
        // an attribute already contracted in EVERY selected market is set aside, and said so. One
        // contracted in SOME of them stays priced over the combined range (one Spark AI build
        // cannot leave a market out of one attribute) and blocks the proposal until the AM
        // settles the scope — never silently dropped for the markets that do not have it.
        if (r !== 'off' && !incC) {
          var hits = mk.filter(function (m) { return contr(m).conv[a.id]; });
          if (hits.length) {
            var where = a.name + ' (' + hits.map(function (m) { return contr(m).conv[a.id] + ', ' + m.mkt.toUpperCase(); }).join('; ') + ')';
            if (hits.length === mk.length) { set.push(where); r = 'off'; }
            else part.push({ name: a.name, where: where, rest: mk.filter(function (m) { return hits.indexOf(m) < 0; }).map(function (m) { return m.mkt.toUpperCase(); }) });
          }
        }
        srcs[a.id] = r;
      });
      L.sources = srcs;
      if (!AIM_ATTRS.some(function (a) { return srcs[a.id] !== 'off'; })) {
        L.status = set.length ? 'contracted' : 'off'; L.reason = set.length ? 'already contracted: ' + set.join(', ') : 'every attribute routed off';
        lines.push(L); return;
      }
      if (mk.some(function (m) { return m.Pm == null; })) {
        L.status = 'unknown'; L.reason = 'not sized — count the feed first'; unknown.push(L.key);
        block('unknown', L.label + ' not sized — count the feed', { line: L.key }); lines.push(L); return;
      }
      var unitsC = 0, perMonthC = 0, est = null;
      mk.forEach(function (m) {
        unitsC += m.w * m.Pm;
        var r = rateOf(m); perMonthC += m.w * (r.rate || 0) * (1 + buffer / 100);
        if (m.P == null) est = 'sku-ceiling';
      });
      conv = aimBuild(srcs, aimR, unitsC, perMonthC);
      conv.sources = srcs; conv.unitsC = unitsC; conv.perMonthC = perMonthC; conv.markets = mk.length;
      conv.rateLabel = 'at Spark AI rates (£' + aimR.dayRate + '/' + aimR.hoursPerDay + 'h)';
      conv.rangeLabel = mk.length > 1 ? 'combined range of ' + mk.length + ' markets' : '';
      L.units = unitsC; L.est = est; L.setupGBP = conv.setup; L.monthlyGBP = conv.monthly;
      if (set.length) L.reason = 'set aside as already contracted: ' + set.join(', ');
      if (part.length) {
        L.reason = (L.reason ? L.reason + ' · ' : '') + 'priced over every market although already contracted in some: ' + part.map(function (p) { return p.where; }).join(', ');
        part.forEach(function (p) {
          block('contracted-partial', p.where.replace(/ \(/, ' already contracted (') + ' — confirm the ' + p.rest.join(', ') + ' scope, or quote ' + p.rest.join(', ') + ' on its own', { line: L.key });
        });
      }
      if (est) { estimated.push(L.key); block('estimate', L.label + ': parent products not counted — SKU count used — run the live audit', { line: L.key }); }
      if (L.roadmap.src === 'unconfirmed') block('roadmap', L.label + ': confirm delivery status', { line: L.key });
      if (L.roadmap.status === 'pilot') L.reason = (L.reason ? L.reason + ' · ' : '') + 'pilot';
      priced[L.key] = L;
      lines.push(L);
    }

    // ONE-OFF — set-up hours over the whole option, block-rounded once
    var rowLines = lines.filter(function (l) { return l.status === 'priced' && LBY[l.key] && (LBY[l.key].row || LBY[l.key].crow); });
    var H = 0, qcpm = 0, lead = 0, leadN = 0;
    rowLines.forEach(function (l) {
      var row = LBY[l.key].row ? R.rows[LBY[l.key].row] : LBY[l.key].crow;
      H += l.setupH; qcpm += (row.qc || 0) + (row.pm || 0);
      if (row.lead != null) { lead = Math.max(lead, row.lead); leadN++; }
    });
    if (priced.attr_rule) H += priced.attr_rule.setupH;
    if (nLang > 1 && rowLines.length) {
      H += (numOr(g.langSetupH) || 0) * (nLang - 1);
      if (numOr(g.langSetupH) == null) block('draft-lang', 'set-up hours per extra language not entered — ASPL', { draft: true });
    }
    var retainerH = Math.max(0, Math.min(numOr(opts.retainerH) || 0, qcpm));
    var blocks = Math.ceil(Math.max(0, H - retainerH) / blockH);
    var blockCost = round2(blocks * blockGBP);
    var genSum = 0; lines.forEach(function (l) { if (l.status === 'priced') genSum += l.gen || 0; });
    genSum = round2(genSum);
    var bundleDisc = core === 'go+ar' ? round2((numOr(g.bundlePct) || 0) / 100 * genSum) : 0;
    var convSetup = conv ? conv.setup : 0, convMonthly = conv ? conv.monthly : 0;
    // two hourly rates can sit in one proposal (the Pricer block for set-up, Spark AI's own for the
    // conversational lines) — each carries its label, so neither is ever a silent rate
    var oneOff = { H: H, retainerH: retainerH, blocks: blocks, blockGBP: blockGBP, blockH: blockH, blockCost: blockCost, gen: genSum,
      conv: round2(convSetup), bundleDisc: bundleDisc, total: round2(blockCost + genSum + convSetup - bundleDisc),
      rateLabel: 'set-up hours at the Pricer block (£' + blockGBP + ' per ' + blockH + 'h)' };

    // MONTHLY — monitoring, then every new parent through the full package
    var monH = 0; rowLines.forEach(function (l) { monH += l.monH || 0; });
    var monBlocks = Math.ceil(monH / blockH), absorbed = !!opts.absorbMonitoring;
    var monCost = absorbed ? 0 : round2(monBlocks * blockGBP);
    var parentRows = rowLines.filter(function (l) { return l.grain === 'parent'; });
    var attrL = priced.attr_ai || null, attrRow = R.rows.attr_pop || {};
    var perMarket = [], monthlyGen = 0, overlaps = [];
    mk.forEach(function (m) {
      var r = rateOf(m), C = contr(m);
      // an AI Quote new-products bundle covers ITS OWN market (contractedFrom is per client ×
      // market): that market's new products are left out, the others are still priced
      var ov = !incC && C.bundle ? C.bundle : null;
      var newP = r.rate != null ? Math.ceil(r.rate * (1 + buffer / 100)) : null;
      var units = {}, perUnit = 0;
      parentRows.forEach(function (l) { if (incC || !C.lines[l.key]) { units[l.key] = 1; perUnit += l.unit; } });
      if (attrL && (incC || !C.lines.attr_ai) && m.S) {
        var rr = m.Pm ? m.S / m.Pm : 1, share = 0, parts = (attrL.byMkt[m.mkt] || {}).parts || [];
        if (opts.newBasis === 'every') { var all = allValues(m); share = all != null ? all.n / m.S : 0; }
        else parts.forEach(function (p) { share += (p.n || 0) / m.S; });
        units.attr_ai = rr * share; perUnit += (attrL.unit || 0) * rr * share;
      }
      var perNew = beta * perUnit;
      if (ov) overlaps.push({ mkt: m.mkt, ref: ov });
      else if (newP != null) monthlyGen += m.w * newP * perNew;
      perMarket.push({ mkt: m.mkt, lang: m.lang, lead: m.lead, w: m.w, pdp: m.audit.pdp, rate: r.rate, newP: newP, newEst: r.est, perNew: round2(perNew),
        perNewUnits: ov ? {} : units, overlap: ov, projected: projection(m), air: airOf(m) });
      if (!ov && (r.est === 'fallback' || r.est === 'sku-ceiling')) estimated.push('newP:' + m.mkt);
    });
    monthlyGen = round2(monthlyGen);
    var open = mk.length > overlaps.length;   // at least one market's new products are priced here
    var floor = numOr(g.floorMonthly) || 0, hasGen = lines.some(function (l) { return l.status === 'priced' && l.grain !== 'none' && !LBY[l.key].aim && l.gen > 0; });
    var genCharged = hasGen && open ? Math.max(floor, monthlyGen) : monthlyGen;
    // TEST PACKAGE — a flat monthly add-on: no one-off, outside β, the bundle % and the floor
    var tN = TEST_COUNTS.indexOf(+opts.tests) >= 0 ? +opts.tests : 0;
    var tests = { n: tN, price: null, perTest: null, draft: false, status: tN ? 'priced' : 'off' };
    if (tN) {
      var tp = g.tests ? numOr(g.tests[tN]) : null, tsrc = g.src && g.src.tests ? g.src.tests[tN] : null;
      if (tp == null) { tests.status = 'unpriced'; block('unpriced', 'test package price not set — Management', { line: 'tests' }); }
      else {
        tests.price = round2(tp); tests.perTest = round2(tp / tN); tests.draft = tsrc !== 'ops';
        if (tests.draft) block('draft-tests', 'test package price not confirmed — Management', { line: 'tests', draft: true });
      }
    }
    var testsGBP = tests.status === 'priced' ? tests.price : 0;
    // AI-REFRESHER — Tier 3 only: the ticked fields regenerated over a share of the catalogue each refresh
    var refresh = null;
    if (option === 'go+ar+rf') {
      var ro = opts.refresh || {};
      var cad = REFRESH_CADENCE[ro.cadence] ? ro.cadence : 'monthly';
      var share = REFRESH_SHARES.indexOf(+ro.share) >= 0 ? +ro.share : 100;
      var fIds = Array.isArray(ro.fields) ? ro.fields.filter(function (f) { return REFRESH_FIELDS.some(function (x) { return x.id === f; }); }) : REFRESH_DEFAULT_FIELDS.slice();
      var sigs = Array.isArray(ro.signals) ? ro.signals.filter(function (f) { return REFRESH_SIGNALS.some(function (x) { return x.id === f; }); }) : REFRESH_SIGNALS.map(function (x) { return x.id; });
      var pct = numOr(g.rfPct), pctDraft = !(g.src && g.src.rfPct === 'ops');
      var wP = 0, sized = mk.length > 0 && mk.every(function (m) { return m.Pm != null && m.Pm > 0; });
      mk.forEach(function (m) { wP += m.w * (m.Pm || 0); });
      var prods = Math.round(wP * share / 100), fac = Pbeta > 0 ? TU / Pbeta : 1;
      var fl = fIds.map(function (id) {
        var d = REFRESH_FIELDS.filter(function (x) { return x.id === id; })[0];
        var unit = d.aim ? numOr(aimR.aiPerField) : numOr(((R.rows || {})[d.row] || {}).unit);
        var per = unit != null && pct != null ? round2(unit * pct / 100) : null;
        return { id: id, label: d.label, why: d.why, unit: unit, perProduct: per,
          gbp: per != null && sized ? round2(per * fac * wP * share / 100) : null };
      });
      refresh = { cadence: cad, cadLabel: REFRESH_CADENCE[cad].label, per: REFRESH_CADENCE[cad].per, share: share, products: sized ? prods : null,
        fields: fl, signals: sigs, pct: pct, draft: pctDraft, status: 'priced', perRefresh: null, monthlyEq: 0 };
      if (!fl.length) { refresh.status = 'off'; }
      else if (!sized) { refresh.status = 'unknown'; block('unknown', 'AI-Refresher not sized — count the feed first', { line: 'refresh' }); }
      else if (fl.some(function (f) { return f.perProduct == null; })) { refresh.status = 'unpriced'; block('unpriced', 'AI-Refresher: a field has no price — Management', { line: 'refresh' }); }
      else {
        var pr = 0; fl.forEach(function (f) { pr += f.gbp; });
        refresh.perRefresh = round2(pr);
        refresh.monthlyEq = round2(pr * REFRESH_CADENCE[cad].perMonth);
        if (pctDraft) block('draft-refresh', 'AI-Refresher price not confirmed — Management', { line: 'refresh', draft: true });
      }
    }
    var refreshGBP = refresh && refresh.status === 'priced' ? refresh.monthlyEq : 0;
    // SERVICES from the bank this option carries (stock range completion, restock alerts …): what it gives, and a
    // flat monthly £ when Management has set one — "included" until then, "coming" while not yet live
    var extras = BK.filter(function (b) { return b.custom && b.kind === 'service' && inOption(option, b.pkg); }).map(function (b) {
      var coming = b.status === 'building' || b.status === 'planned';
      return { key: b.key, label: b.label, gives: b.gives, pkg: b.pkg, why: b.why, monthly: coming ? null : b.monthly,
        status: coming ? 'coming' : (b.monthly != null ? 'priced' : 'included') };
    });
    var extrasGBP = 0; extras.forEach(function (x) { if (x.status === 'priced') extrasGBP += x.monthly; });
    extrasGBP = round2(extrasGBP);
    var monthly = { monH: monH, monBlocks: monBlocks, monCost: monCost, absorbed: absorbed, gen: monthlyGen, floor: floor,
      floorApplied: genCharged > monthlyGen,
      overlap: overlaps.length ? overlaps.map(function (o) { return (mk.length > 1 ? o.mkt.toUpperCase() + ' ' : '') + 'overlaps ' + o.ref + ' monthly bundle'; }).join(' · ') : null,
      overlapMkts: overlaps.map(function (o) { return o.mkt; }),
      conv: round2(convMonthly), tests: testsGBP, refresh: refreshGBP, extras: extrasGBP, total: round2(monCost + genCharged + convMonthly + testsGBP + refreshGBP + extrasGBP) };

    // the projection: the Golden Score once the option's priced lines land, under the brand's profile
    // which line closes a Golden Record attribute (null: nobody's but the client's)
    function ownerOf(key) {
      if (CONV_KEYS.indexOf(key) >= 0) return 'conv';
      if (ATTR_AI.indexOf(key) >= 0) return 'attr_ai';
      if (RULE_ATTRS.indexOf(key) >= 0) return 'attr_rule';
      var fx = LINES.filter(function (x) { return x.fixes && x.fixes.indexOf(key) >= 0; });
      var d = fx.filter(function (x) { return inOption(option, x.pkg); })[0] || fx[0];
      return d ? d.key : null;
    }
    // WHO closes each gap still under 99% once the option lands: a line in the other tier, a line
    // in this option that is not priced yet (and why), or the client's own data. Only the last is
    // "client to supply" — the email's "95 needs data only you hold" leans on that tag.
    function gapTag(key, m) {
      var lk = ownerOf(key);
      if (!lk) return 'client to supply';
      var d = LBY[lk];
      if (!inOption(option, d.pkg)) return d.pkg === 'off' ? 'not in this quote' : 'in ' + TIER_NAME[d.pkg];
      var L = lines.filter(function (l) { return l.key === lk; })[0];
      if (!L) return 'not in this quote';
      if (lk === 'conv' && !incC) {
        var at = AIM_ATTRS.filter(function (x) { return x.key === key; })[0];
        if (at && contr(m).conv[at.id]) return 'already contracted';
      }
      if ((L.contractedIn || []).indexOf(m.mkt) >= 0 || L.status === 'contracted') return 'already contracted';
      return { coming: 'coming', unknown: 'to be sized', unpriced: 'price to follow', off: 'not in this quote', none: 'to be checked' }[L.status] || 'not in this quote';
    }
    function projection(m) {
      var a = m.audit;
      if (!a.golden || !a.golden.attrs) return { now: null, after: null, met: false, blockers: [] };
      var after = {}, fix = {};
      Object.keys(a.golden.attrs).forEach(function (k) { after[k] = Object.assign({}, a.golden.attrs[k]); });
      Object.keys(priced).forEach(function (k) {
        var L = priced[k], ks = LBY[k].fixes;
        if ((L.contractedIn || []).indexOf(m.mkt) >= 0) return;
        if (k === 'attr_ai' || k === 'attr_rule') ks = ((L.byMkt[m.mkt] || {}).parts || []).map(function (p) { return p.k; });
        if (k === 'conv') ks = AIM_ATTRS.filter(function (x) { return conv && conv.sources[x.id] !== 'off'; }).map(function (x) { return x.key; });
        (ks || []).forEach(function (key) {
          if (key === 'keywords' && !Object.prototype.hasOwnProperty.call(a.golden.attrs, 'keywords')) return;   // not measured — left out
          var cur = after[key] || {};
          if (cur.na) return;
          after[key] = { present: true, cov: 100 }; if (cur.scope) after[key].scope = cur.scope;
          fix[key] = 1;
        });
      });
      var gs = LG.goldenScore(after, a.prof), sc = gs ? gs.score : null;
      var bl = gs ? gs.parts.filter(function (p) { return p.cov < 99; }).map(function (p) {
        return { key: p.key, cov: p.cov, tag: gapTag(p.key, m) };
      }) : [];
      // `fixed` = the Golden Record attributes this option fills in this market (the page animates them)
      return { now: a.golden.score, after: sc, met: sc != null && sc >= 95, blockers: bl, fixed: Object.keys(fix) };
    }
    function airOf(m) {
      var a = m.audit, n = a.conv ? a.conv.n : null, add = 0;
      if (conv && n != null) AIM_ATTRS.forEach(function (x) {
        if (conv.sources[x.id] === 'off' || CONV_KEYS.indexOf(x.key) < 0) return;
        var at = a.golden && a.golden.attrs ? a.golden.attrs[x.key] : null;
        if (!(at && at.present)) add++;
      });
      return { now: a.air ? a.air.total : null, after: null, note: 'projection not computed', conv: { n: n, after: n != null ? Math.min(6, n + add) : null } };
    }

    if (reuseUnset) block('reuse', 'two or more markets share a language — the re-use rate is not set (Management)');
    // β is read on the SKU count while a grouped feed's parents are uncounted: every generation
    // figure then moves once P lands (β rises as the volume falls), even on a line that is
    // itself exact (an SKU-grain attribute line). Said once, unless a line already says it.
    var betaOnSku = mk.some(function (m) { return m.P == null && m.Pm != null && m.audit.hasGroups !== false; });
    if (betaOnSku && Pbeta > 0 && beta < 1
      && lines.some(function (l) { return l.status === 'priced' && l.grain !== 'none' && !LBY[l.key].aim && (l.gen || 0) > 0; })
      && !blockers.some(function (b) { return b.code === 'estimate' && /parent products not counted/.test(b.why); }))
      block('estimate', 'parent products not counted — the volume discount is read on the SKU count — run the live audit');
    var sla = leadN ? lead + (leadN - 1) * DEFAULTS.staggerDays : 0;
    var draftRates = blockers.some(function (b) { return b.draft; });
    var alwaysOn = roadmapStatus(spec.roadmap, 'alwayson', industry, null);
    return { v: 1, client: spec.client || '', option: option, label: OPTION_LABEL[option], sub: OPTION_SUB[option], pkgVersion: g.pkgVersion || null, targets: tg,
      beta: beta, Pbeta: Pbeta, reuse: reuse, reuseUnset: reuseUnset, nLang: nLang,
      lines: lines, perMarket: perMarket, conv: conv, oneOff: oneOff, monthly: monthly, tests: tests, refresh: refresh, extras: extras, gives: bankGives(spec.bank, option), sla: sla,
      unknown: unknown, unpriced: unpriced, coming: coming, estimated: estimated, blockers: blockers,
      clientSafe: blockers.length === 0, draftRates: draftRates,
      alwaysOn: { status: alwaysOn.status, live: alwaysOn.status === 'live', mechanism: opts.mechanism || 'monthly' } };
  }

  /* ---- costModel: what a line COSTS us (Management only) -------------------------------------
     Tokens pass through at cost (no overhead); labour is the ASPL attended minutes + the London
     QC share at the cost rates, with the overhead markup on labour only. When the hours come
     from the tracked actuals the labour already sits inside them, so it is never counted twice.
     Any missing input leaves the figure that needs it null, with who has to enter it. Spark AI
     lines are not costed, so they sit out of BOTH sides of every margin. */
  function costModel(R, costs, actuals, pq) {
    R = R || composeRates({}); costs = costs || {}; actuals = actuals || {};
    var cv = function (k) { return numOr(sv(costs['_c|' + k])); };
    var c = { rateAspl: cv('rateAspl'), rateAm: cv('rateAm'), gbpPerMTok: cv('gbpPerMTok'), ohPct: cv('ohPct'), marginPct: cv('marginPct'),
      tokAsOf: sv(costs['_c|tokAsOf']) || null };
    var MG = 'set by Management', minX = Math.min.apply(null, (R.g.tiers || DEFAULTS.tiers).map(function (t) { return t.x; }));
    var rows = {};
    CATALOG.concat(PKG_ROWS).forEach(function (b) {
      var r = R.rows[b.id] || {}, a = actuals[b.id], why = [];
      var fromA = a && a.n >= 1 && a.billPerProd != null;
      var tok = fromA ? +a.billPerProd : r.tokPerP;
      if (tok == null) why.push('tokens per product — ASPL to enter');
      if (c.gbpPerMTok == null) why.push('£ per million tokens — ' + MG);
      var cTok = tok != null && c.gbpPerMTok != null ? tok * c.gbpPerMTok / 1e6 : null;
      var hoursA = ['aspl', 'qc', 'pm'].some(function (f) { return r.src && r.src[f] === 'actuals'; });
      var cLab = null;
      if (hoursA) cLab = 0;
      else {
        if (r.aMin == null) why.push('attended minutes per 100 — ASPL to enter');
        if (r.qcPct == null || r.qcMin == null) why.push('QC share and minutes — London AM to enter');
        if (c.rateAspl == null || c.rateAm == null) why.push('cost rates — ' + MG);
        if (r.aMin != null && r.qcPct != null && r.qcMin != null && c.rateAspl != null && c.rateAm != null)
          cLab = (r.aMin / 100 * c.rateAspl + r.qcPct / 100 * r.qcMin * c.rateAm) / 60;
      }
      if (c.ohPct == null && cLab) why.push('overhead % — ' + MG);
      var loaded = (cTok != null && cLab != null && (cLab === 0 || c.ohPct != null)) ? cTok + cLab * (1 + (c.ohPct || 0) / 100) : null;
      if (c.marginPct == null) why.push('target margin — ' + MG);
      var setupCost = (r.aspl != null && r.qc != null && r.pm != null && c.rateAspl != null && c.rateAm != null && c.ohPct != null)
        ? (r.aspl * c.rateAspl + (r.qc + r.pm) * c.rateAm) * (1 + c.ohPct / 100) : null;
      rows[b.id] = { tok: tok, tokSrc: fromA ? 'actuals' : (tok != null ? 'ops' : 'unset'), cTok: cTok, cLab: cLab, loaded: loaded,
        listMargin: loaded != null && r.unit > 0 ? 1 - loaded / r.unit : null,
        floorOK: loaded != null && r.unit != null ? r.unit * minX >= loaded : null,
        suggested: loaded != null && c.marginPct != null && c.marginPct < 100 ? loaded / (1 - c.marginPct / 100) : null,
        setupCost: setupCost, why: why };
    });
    var proposal = null;
    if (pq) {
      var why = [], genCost = 0, setupCost = 0, ok = true, sok = true;
      (pq.lines || []).forEach(function (l) {
        var d = LINE_BY[l.key]; if (!d || !d.row || l.status !== 'priced') return;
        var cr = rows[d.row];
        if (cr.loaded == null) ok = false; else genCost += cr.loaded * (l.units || 0);
        if (cr.setupCost == null) sok = false; else setupCost += cr.setupCost;
      });
      if (!ok) { genCost = null; why.push('a priced line has no loaded cost yet'); }
      // the set-up hours that sit on NO rate row — the FeedHero rule hours and the hours per extra
      // language — are billed in the blocks, so they cost too (ASPL builds both, at the ASPL rate)
      var rowH = 0;
      (pq.lines || []).forEach(function (l) { var d = LINE_BY[l.key]; if (d && d.row && l.status === 'priced') rowH += +l.setupH || 0; });
      var extraH = Math.max(0, (+pq.oneOff.H || 0) - rowH);
      if (extraH > 0) {
        if (c.rateAspl == null || c.ohPct == null) { sok = false; why.push('rule / language set-up hours — cost rates ' + MG); }
        else setupCost += extraH * c.rateAspl * (1 + c.ohPct / 100);
      }
      if (!sok) { setupCost = null; why.push('a priced line has no set-up cost yet'); }
      var net = pq.oneOff.gen - pq.oneOff.bundleDisc;
      var monthlyCost = null;
      if (c.rateAm != null && c.ohPct != null) {
        monthlyCost = pq.monthly.monH * c.rateAm * (1 + c.ohPct / 100);
        (pq.perMarket || []).forEach(function (m) {
          if (monthlyCost == null || m.newP == null) return;
          Object.keys(m.perNewUnits || {}).forEach(function (k) {
            // one line with no loaded cost nulls the whole figure — and it STAYS null (null + x is x)
            if (monthlyCost == null) return;
            var d = LINE_BY[k]; if (!d || !d.row) return;
            var cr = rows[d.row];
            if (cr.loaded == null) { monthlyCost = null; why.push('a monthly line has no loaded cost yet'); return; }
            monthlyCost += m.w * m.newP * cr.loaded * m.perNewUnits[k];
          });
        });
      } else why.push('cost rates — ' + MG);
      // a test package is not costed (its labour is not on the rate card) — out of both sides,
      // like Spark AI
      var testsSell = pq.monthly.tests || 0, refreshSell = pq.monthly.refresh || 0, extrasSell = pq.monthly.extras || 0;
      var monSell = pq.monthly.total - pq.monthly.conv - testsSell - refreshSell - extrasSell;
      if (extrasSell) why.push('bank services are not costed — left out of both sides');
      if (testsSell) why.push('test packages are not costed — left out of both sides');
      if (refreshSell) why.push('the AI-Refresher is not costed yet — left out of both sides');
      proposal = { genCost: genCost, genMargin: genCost != null && net > 0 ? 1 - genCost / net : null,
        setupCost: setupCost, setupMargin: setupCost != null && pq.oneOff.blockCost > 0 ? 1 - setupCost / pq.oneOff.blockCost : null,
        setupNote: 'retainer hours still cost — they are in the set-up cost even when the block is absorbed',
        monthlyCost: monthlyCost, monthlyMargin: monthlyCost != null && monSell > 0 ? 1 - monthlyCost / monSell : null,
        excluded: ['conv'].concat(testsSell ? ['tests'] : [], refreshSell ? ['refresh'] : [], extrasSell ? ['extras'] : []), why: why.concat(['Spark AI lines are not costed — left out of both sides']) };
    }
    return { rows: rows, proposal: proposal, inputs: c };
  }

  /* ---- proposals: references, snapshots, client copy ---------------------------------------- */
  function fnv1a(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function ymdOf(date) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    var d = date instanceof Date ? date : new Date(date == null ? Date.now() : date);
    return d.toISOString().slice(0, 10);
  }
  // 'SVC' + 6 digits from the client and the day; a second proposal the same day gets -2, -3 …
  function proposalRef(client, date, existingRefs) {
    var base = 'SVC' + ('00000' + (fnv1a(String(client || '') + '|' + ymdOf(date)) % 1e6)).slice(-6);
    var refs = {};
    entries(existingRefs).forEach(function (e) { var v = e[1]; refs[typeof v === 'string' ? v : (v && v.ref) || ''] = 1; });
    if (!refs[base]) return base;
    var n = 2; while (refs[base + '-' + n]) n++;
    return base + '-' + n;
  }
  // the parts stay (a handful of {k, label, n}) — the client copy's "what we need from you" reads them
  function compactNeed(x) {
    return x ? { n: x.n, lo: x.lo, hi: x.hi, est: x.est, parts: (x.parts || []).map(function (p) { return { k: p.k, label: p.label, n: p.n }; }) } : null;
  }
  // the OPTION record a proposal stores (§7.2). The page renders and exports from this snapshot
  // only, so the frozen rates travel with it; cost figures never do.
  function snapshotOption(pq, audits, R, aimRates, ctx) {
    ctx = ctx || {};
    var now = +ctx.t || Date.now(), by = ctx.by || '';
    var A = {};
    (Array.isArray(audits) ? audits : entries(audits).map(function (e) { return e[1]; })).forEach(function (a) {
      if (!a) return;
      var pm = (pq.perMarket || []).filter(function (m) { return m.mkt === a.mkt; })[0];
      // the market's needs are NOT copied here: pq.lines[].byMkt already carries every one, and a
      // second copy per market is what put a 28-market proposal over the 60 KB store limit
      A[a.mkt] = { src: a.src, t: a.t, S: a.S, P: a.P, r: a.r, pSrc: a.pSrc, golden: { score: a.golden ? a.golden.score : null },
        qScore: a.qScore, air: a.air, newP: pm ? pm.newP : null };
    });
    var rrows = {};
    CATALOG.concat(PKG_ROWS).forEach(function (b) {
      var r = (R && R.rows && R.rows[b.id]) || b;
      rrows[b.id] = { unit: r.unit, aspl: r.aspl, qc: r.qc, pm: r.pm, mon: r.mon, lead: r.lead };
    });
    var gg = (R && R.g) || {};
    var pqc = JSON.parse(JSON.stringify(pq, function (k, v) { return v === Infinity ? null : v; }));
    (pqc.lines || []).forEach(function (l) {
      Object.keys(l.byMkt || {}).forEach(function (m) { l.byMkt[m] = compactNeed(l.byMkt[m]); });
      if (l.pricedNeed) l.pricedNeed = compactNeed(l.pricedNeed);
    });
    if (pqc.conv) pqc.conv.lines = (pqc.conv.lines || []).map(function (l) {
      return { id: l.id, key: l.key, label: l.label, route: l.route, detail: l.detail, hours: l.hours, setup: l.setup, man: l.man, gen: l.gen, monthly: l.monthly, monthlyNote: l.monthlyNote || null, shared: !!l.shared };
    });
    return { ref: ctx.ref || proposalRef(pq.client || ctx.client, now, ctx.existingRefs),
      client: ctx.client || pq.client || '', markets: (pq.perMarket || []).map(function (m) { return m.mkt; }), t: now, by: by,
      // the frozen fields are written in the form the store keeps them ('' / {} — never null), so
      // a re-push of the page's own copy (a click while the first save is in flight) compares
      // equal and is not reported as an edit to a frozen option
      prop: ctx.prop ? { id: ctx.prop.id, n: +ctx.prop.n, label: ctx.prop.label == null ? '' : String(ctx.prop.label) } : null,
      option: pq.option, pkgVersion: pq.pkgVersion || '', audit: A,
      rates: { rows: rrows, g: { blockGBP: gg.blockGBP, blockH: gg.blockH,
        tiers: (gg.tiers || []).map(function (t) { return { upTo: t.upTo === Infinity ? null : t.upTo, x: t.x }; }),
        bundlePct: gg.bundlePct, reusePct: gg.reusePct, floorMonthly: gg.floorMonthly, pkgVersion: gg.pkgVersion, ruleH: gg.ruleH, langSetupH: gg.langSetupH,
        tests: gg.tests ? { 2: gg.tests[2], 3: gg.tests[3], 4: gg.tests[4] } : null, rfPct: gg.rfPct == null ? null : gg.rfPct },
        aim: aimRatesOf(aimRates) },
      opts: ctx.opts || {}, aimSources: (pq.conv ? pq.conv.sources : ctx.aimSources) || {},
      pq: pqc, clientSafe: !!pq.clientSafe, blockers: (pq.blockers || []).slice(), hist: [{ s: 'Saved', t: now, by: by }] };
  }

  // a person's first name off an address — only when it plainly belongs to a person (the Call
  // wrap-up rule: a shared mailbox greeted "Hi Info," is worse than no name)
  var ROLE_BOX = /^(info|hello|hi|team|admin|support|sales|marketing|ecommerce|ecom|digital|contact|enquiries|office|accounts|feeds?|shop|online|web|help|noreply|no-reply)$/i;
  function greetName(contact) {
    var s = String(contact || '').trim();
    if (!s) return '';
    var local = s.indexOf('@') > 0 ? s.split('@')[0] : s;
    var first = local.split(/[.\s_-]+/)[0];
    if (!/^[A-Za-zÀ-ÿ]{3,}$/.test(first) || ROLE_BOX.test(first)) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }
  function pqOf(op) { return op && op.pq ? op.pq : op; }
  function safeOf(op) { return op && op.clientSafe != null ? !!op.clientSafe : !!(pqOf(op) || {}).clientSafe; }
  function mechWord(m) { return { weekly: 'a weekly', fortnightly: 'a fortnightly', monthly: 'a monthly' }[m] || 'a monthly'; }
  function lineText(l, M) {
    // the count the £ beside it covers: a market where the line is already contracted is left
    // out of both, and named, so "2,000 products — £80" can never price 1,000 of them
    var n = l.pricedNeed || l.need || {}, one = l.grain === 'sku' ? 'value' : 'product', many = one + 's';
    var cin = (l.contractedIn || []).map(function (m) { return String(m).toUpperCase(); });
    var skip = cin.length && l.status === 'priced' ? ' (already covered in ' + cin.join(', ') + ')' : '';
    if (l.status === 'coming') return '· ' + l.label + ' — coming, included when live';
    if (l.status === 'unknown') return '· ' + l.label + ' — to be sized once the full feed is counted';
    if (l.status === 'unpriced') return '· ' + l.label + ' — ' + (n.n != null ? nWord(n.n, one, many) + ' · ' : '') + 'price to follow';
    if (l.key === 'conv') return null;
    if (l.key === 'attr_rule') return '· ' + l.label + ' — ' + l.ruleAttrs + ' rule' + (l.ruleAttrs === 1 ? '' : 's') + ' built in FeedHero (set-up time)';
    // the REAL count of products (re-use lowers the price of a repeated language, not the count);
    // a reading that can only bound the count says so — "up to" when it proves no lower end
    var range = n.hi != null && n.hi > (n.lo || 0);
    var cnt = l.scope === 'all' ? 'every product'
      : range ? (n.lo ? 'at least ' + nWord(n.lo, one, many) + ', up to ' + fmtInt(n.hi) : 'up to ' + nWord(n.hi, one, many))
      : nWord(n.n, one, many);
    var money = l.genHi != null && l.genHi > l.gen ? (l.gen > 0 ? 'from ' + M(l.gen) + ' up to ' + M(l.genHi) : 'up to ' + M(l.genHi)) : M(l.gen);
    return '· ' + l.label + ' — ' + cnt + skip + ' — ' + money + (l.reason === 'pilot' || /pilot/.test(l.reason) ? ' (pilot)' : '');
  }
  // the test package line — "Test package: N tests a month — £X a month (£Y a test)"
  function testsText(T, M) {
    if (!T || !T.n) return null;
    return 'Test package: ' + T.n + ' tests a month — ' + (T.status === 'priced' ? M(T.price) + ' a month (' + M(T.perTest) + ' a test)' : 'price to follow');
  }
  // the AI-Refresher in one line: what is refreshed, how often, against what, and its price
  function refreshText(F, M) {
    if (!F || F.status === 'off') return null;
    var sig = (F.signals || []).map(function (id) { var x = REFRESH_SIGNALS.filter(function (s) { return s.id === id; })[0]; return x ? x.label.toLowerCase() : id; });
    var t = 'AI-Refresher: ' + (F.fields || []).map(function (f) { return f.label; }).join(', ') + ' refreshed ' + F.cadLabel.toLowerCase()
      + (F.share < 100 ? ' on ' + F.share + '% of the catalogue' : '') + (sig.length ? ', read against ' + sig.join(', ') : '') + ' — ';
    if (F.status !== 'priced') return t + 'price to follow';
    return t + M(F.perRefresh) + ' ' + F.per + (F.cadence === 'quarterly' ? ' (counted as ' + M(F.monthlyEq) + ' a month)' : '');
  }
  function optionBlock(op, idx, M, guarded) {
    var q = pqOf(op) || {}, L = [];
    L.push('OPTION ' + (op && op.prop && op.prop.n ? op.prop.n : idx + 1) + ' · ' + (q.label || ''));
    var sub = q.sub || OPTION_SUB[q.option];
    if (sub) L.push(sub);
    (q.lines || []).forEach(function (l) {
      if (l.status === 'priced' || l.status === 'coming' || l.status === 'unknown' || l.status === 'unpriced') { var t = lineText(l, M); if (t) L.push(t); }
    });
    if (q.conv) {
      L.push('· Conversational attributes (Spark AI) — ' + (guarded ? 'at Spark AI rates' : q.conv.rateLabel) + (q.conv.rangeLabel ? ', ' + q.conv.rangeLabel : '') + ': set-up ' + M(q.conv.setup) + ', then ' + M(q.conv.monthly) + ' a month');
    }
    var tt = testsText(q.tests, M);
    if (tt) L.push('· ' + tt);
    var rt = refreshText(q.refresh, M);
    if (rt) L.push('· ' + rt);
    (q.extras || []).forEach(function (x) { L.push('· ' + x.label + (x.gives ? ' — ' + x.gives : '') + (x.status === 'priced' ? ': ' + M(x.monthly) + ' a month' : x.status === 'coming' ? ' (coming — included when live)' : '')); });
    L.push('One-off: ' + M(q.oneOff.total) + ' ex VAT');
    L.push('Monthly: ' + M(q.monthly.total) + ' ex VAT');
    // every new product, priced PER MARKET (a re-used language costs less there); a market whose
    // new products an existing bundle already covers is named apart and never priced twice
    var newN = 0, per = [], covd = [];
    (q.perMarket || []).forEach(function (m) {
      if (m.overlap) { covd.push(m.mkt.toUpperCase()); return; }
      if (m.newP != null) { newN += m.newP; per.push((q.perMarket.length > 1 ? m.mkt.toUpperCase() + ' ' : '') + M(m.perNew)); }
    });
    if (per.length) {
      var ao = q.alwaysOn || {};
      L.push('Every new product: ' + per.join(' · ') + ' each — about ' + nWord(newN, 'new product', 'new products') + ' a month' + (per.length > 1 ? ' across the markets' : '') + '. '
        + (ao.live ? 'New products are picked up on arrival.' : 'Today we run new products through on ' + mechWord(ao.mechanism) + ' cycle; the target is on arrival once automatic routing ships.'));
    }
    if (covd.length) L.push('New products in ' + covd.join(', ') + ': already covered by your current new-products bundle.');
    if (q.sla) L.push('Live in about ' + q.sla + ' working days from sign-off.');
    return L;
  }
  // the clause after "N once this work lands": Google-ready, or WHO closes the rest — "data only
  // you hold" ONLY when every attribute still under 99% is the client's own data
  function standTail(p, n) {
    if (p.met) return ' (Google-ready at 95+' + (n ? ' with option ' + n : '') + ')';
    var bl = p.blockers || [], rest = bl.filter(function (b) { return b.tag !== 'client to supply'; });
    if (!bl.length) return '';
    if (!rest.length) return ' (95 needs data only you hold — listed below)';
    var PENDING = { coming: 1, 'to be sized': 1, 'price to follow': 1 };
    if (rest.every(function (b) { return b.tag === 'in Tier 2'; })) return ' (Tier 2 · AI-ready takes it further)';
    if (rest.every(function (b) { return PENDING[b.tag] || b.tag === 'in Tier 2'; })) return ' (the rest follows the work still to be confirmed below)';
    return ' (95 needs work outside ' + (n ? 'these options' : 'this option') + ')';
  }
  // the client email (two tones) + the AM's talk track + the flags to raise before sending.
  // guard (default on): while an option is not client-safe EVERY £ in its copy reads
  // '[£ to confirm — Ray]' — the email can go to Ray for a look, never to a client as is.
  function proposalText(input, o) {
    o = o || {};
    var list = (Array.isArray(input) ? input : [input]).filter(Boolean);
    var tone = o.tone === 'consult' ? 'consult' : 'direct', guard = o.guard !== false;
    var first = list[0] || {}, q0 = pqOf(first) || {};
    var client = first.client || o.client || 'your team';
    var mkts = (q0.perMarket || []).map(function (m) { return m.mkt.toUpperCase(); });
    var feedWord = mkts.length > 1 ? 'Google Shopping feeds (' + mkts.join(', ') + ')' : 'Google Shopping feed' + (mkts.length ? ' (' + mkts[0] + ')' : '');
    var guarded = function (op) { return guard && !safeOf(op); };
    var Mfor = function (op) { return function (n) { return guarded(op) ? GUARD_TXT : fmtGBP(round2(+n || 0)); }; };
    var M0 = Mfor(first), name = greetName(o.contact), B = [];
    B.push(name ? 'Hi ' + name + ',' : 'Hi team,');
    B.push('');
    B.push(tone === 'direct'
      ? 'We have audited your ' + feedWord + ' against Google\'s product data specification. Here is what we found, what we recommend and what it costs.'
      : 'Thank you for the time on our recent review. We have audited your ' + feedWord + ' against Google\'s product data specification, and I wanted to share what we found and how we would suggest approaching it — very happy to shape this around your priorities.');
    B.push('');
    B.push('WHERE THE FEED STANDS');
    // every option's own projection for the market — never the first option's alone
    function projOf(op, mkt) { var pm = ((pqOf(op) || {}).perMarket || []).filter(function (x) { return x.mkt === mkt; })[0]; return pm ? pm.projected || {} : {}; }
    (q0.perMarket || []).forEach(function (m) {
      var p = m.projected || {}, s = '· ' + m.mkt.toUpperCase() + ': Golden Record score ' + (p.now != null ? p.now : 'not measured yet');
      var outs = list.map(function (op, i) { return { n: op && op.prop && op.prop.n ? op.prop.n : i + 1, p: projOf(op, m.mkt) }; }).filter(function (x) { return x.p.after != null; });
      if (list.length > 1 && outs.length > 1) {
        var best = outs.slice().sort(function (a, b) { return b.p.after - a.p.after; })[0];
        s += ' today — ' + outs.map(function (x) { return x.p.after + ' with option ' + x.n; }).join(', ') + standTail(best.p, best.n);
      } else if (p.after != null) s += ' today, ' + p.after + ' once this work lands' + standTail(p);
      if (m.air && m.air.now != null) s += ' · AI-readiness ' + m.air.now;
      B.push(s);
    });
    B.push('');
    B.push(list.length > 1 ? 'THE OPTIONS' : 'THE PROPOSAL');
    list.forEach(function (op, i) { optionBlock(op, i, Mfor(op), guarded(op)).forEach(function (l) { B.push(l); }); B.push(''); });
    // what we need from the client: the client line's own counts, then every other attribute the
    // projection says only the client can close — so "listed below" is true
    var needFrom = {}, nfKey = {};
    list.forEach(function (op) { ((pqOf(op) || {}).lines || []).forEach(function (l) {
      if (l.key !== 'client') return;
      Object.keys(l.byMkt || {}).forEach(function (mkt) { ((l.byMkt[mkt] || {}).parts || []).forEach(function (p) {
        needFrom[p.label] = needFrom[p.label] || { n: 0, cov: null }; needFrom[p.label].n += (p.n || 0); nfKey[p.k] = 1;
      }); });
    }); });
    list.forEach(function (op) { ((pqOf(op) || {}).perMarket || []).forEach(function (m) { (((m.projected || {}).blockers) || []).forEach(function (b) {
      if (b.tag !== 'client to supply') return;
      var k = String(b.key).replace('/', '_');
      if (nfKey[k]) return;
      var lab = ATTR_WORD[k] || String(b.key).replace(/_/g, ' ');
      needFrom[lab] = needFrom[lab] || { n: 0, cov: null };
      if (b.cov != null) needFrom[lab].cov = needFrom[lab].cov == null ? b.cov : Math.min(needFrom[lab].cov, b.cov);
    }); }); });
    var nf = Object.keys(needFrom);
    if (nf.length) {
      B.push('WHAT WE NEED FROM YOU');
      nf.forEach(function (k) {
        var x = needFrom[k];
        B.push('· ' + k + (x.n ? ' — missing on ' + nWord(x.n, 'product', 'products') : x.cov != null ? ' — filled on ' + x.cov + '% of products today' : ''));
      });
      B.push('Identifiers, prices and links come from your systems — we never generate them.');
      B.push('');
    }
    var hasConv = list.some(function (op) { return (pqOf(op) || {}).conv; });
    var hasGpc = list.some(function (op) { return ((pqOf(op) || {}).lines || []).some(function (l) { return l.key === 'gpc' && l.status === 'priced'; }); });
    var hasTests = list.some(function (op) { var T = (pqOf(op) || {}).tests; return T && T.n; });
    var hasRefresh = list.some(function (op) { var F = (pqOf(op) || {}).refresh; return F && F.status !== 'off'; });
    if (hasConv || hasGpc || hasTests || hasRefresh) {
      B.push('HOW WE WOULD DO IT');
      if (hasGpc) B.push('· Google product category is Google\'s own fixed taxonomy — we map each product to it, we never invent categories.');
      if (hasConv) B.push('· Conversational attributes go to Google through a supplemental data source, so your main feed stays untouched.');
      if (hasTests) B.push('· Test package: ' + TEST_WHAT);
      if (hasRefresh) B.push('· AI-Refresher: ' + REFRESH_WHAT);
      B.push('');
    }
    B.push('All figures are ex VAT.');
    B.push('');
    B.push(tone === 'direct'
      ? 'If this works for you, reply to confirm the option and we will schedule the work.'
      : 'Happy to walk through any of this on a call, adjust the scope, or start with a smaller set of products first — whatever suits your team best.');
    B.push('');
    B.push('Best regards,' + (o.from ? '\n' + o.from : ''));
    var subject = client + ' — Google Shopping services proposal' + (list.length > 1 ? ': ' + list.length + ' options' : ': ' + (q0.label || ''));
    // the AM's talk track — five bullets for the debrief call
    var nOf = function (l) { return (l.pricedNeed || l.need || {}).n; };
    var worst = (q0.lines || []).filter(function (l) { return l.status === 'priced' && l.grain !== 'none' && nOf(l); })
      .sort(function (a, b) { return (nOf(b) || 0) - (nOf(a) || 0); })[0];
    var pm0 = (q0.perMarket || [])[0] || {}, pr0 = pm0.projected || {};
    var T0 = q0.tests && q0.tests.n ? q0.tests : null;
    var talk = [
      'Golden Record ' + (pr0.now != null ? pr0.now : '—') + (pr0.after != null ? ' → ' + pr0.after + ' with ' + (q0.label || 'this option') : '') + ' — the 95 line is Google-ready.',
      worst ? 'Biggest gap: ' + worst.label.toLowerCase() + ' on ' + nWord(nOf(worst), worst.grain === 'sku' ? 'value' : 'product', worst.grain === 'sku' ? 'values' : 'products') + '.' : 'Nothing priced needs work yet — size the feed first.',
      'One-off ' + M0(q0.oneOff ? q0.oneOff.total : 0) + ', monthly ' + M0(q0.monthly ? q0.monthly.total : 0)
        + (T0 ? ' (with a ' + T0.n + '-test package' + (T0.status === 'priced' ? ' at ' + M0(T0.price) : ', price to follow') + ')' : '') + ' — ex VAT, never added together.',
      (q0.alwaysOn && q0.alwaysOn.live) ? 'New products are picked up on arrival.' : 'New products run on ' + mechWord(q0.alwaysOn && q0.alwaysOn.mechanism) + ' ASPL cycle today — on arrival is the target, not a promise yet.',
      nf.length ? 'Ask them for: ' + nf.slice(0, 4).join(', ') + '.' : 'Nothing needed from their side for this option.'
    ];
    var flags = [];
    if (hasConv) flags.push('Conversational attributes are submitted via a supplemental data source — not the primary feed.');
    if (hasGpc) flags.push('GPC is Google\'s fixed taxonomy — mapped, never generated.');
    flags.push('Identifiers (GTIN, MPN, brand) are never generated.');
    var cq = list.map(pqOf).filter(function (q) { return q && q.conv && q.oneOff; })[0];
    if (cq) flags.push('Two hourly rates in this proposal: ' + cq.oneOff.rateLabel + ' and the conversational lines ' + cq.conv.rateLabel + ' — one published rate or two labelled is Management\'s call.');
    var tgt = q0.targets || targetsOf();
    flags.push('Description target is ' + tgt.descTarget + ' CHARACTERS (Google: 1–5,000, key facts in the first 160–500) — "500 words" is for Ray to confirm.');
    flags.push('Highlights: Google\'s floor is 4; the house target is 6+ (this proposal: ' + tgt.hlTarget + '+).');
    if (list.some(function (op) { return ((pqOf(op) || {}).perMarket || []).some(function (m) { return m.pdp === 'blocked'; }); })) flags.push('PDP fetch is blocked — scraped routes need the client to allowlist the FeedSparkPDPScan agent.');
    list.forEach(function (op) { ((pqOf(op) || {}).blockers || (op && op.blockers) || []).forEach(function (b) { var t = 'Ray to confirm: ' + b.why; if (flags.indexOf(t) < 0) flags.push(t); }); });
    return { subject: subject, body: B.join('\n'), talk: talk, flags: flags, guarded: list.some(guarded) };
  }
  // every option of a proposal as ONE client-facing comparison — what each includes, not just a price
  function optionsText(options, o) {
    o = o || {};
    var list = (options || []).filter(Boolean), guard = o.guard !== false, L = [];
    var client = (list[0] && list[0].client) || o.client || 'Client';
    L.push(client + ' — Google Shopping services: ' + list.length + ' option' + (list.length === 1 ? '' : 's') + ' (all figures ex VAT)');
    L.push('');
    list.forEach(function (op, i) {
      var q = pqOf(op) || {}, M = function (n) { return guard && !safeOf(op) ? GUARD_TXT : fmtGBP(round2(+n || 0)); };
      var inc = (q.lines || []).filter(function (l) { return l.status === 'priced'; }).map(function (l) { return l.label.replace(/ —.*$/, ''); });
      if (q.tests && q.tests.n) inc.push('Test package (' + q.tests.n + ' tests a month)');
      if (q.refresh && q.refresh.status !== 'off') inc.push('AI-Refresher (' + q.refresh.cadLabel.toLowerCase() + ')');
      (q.extras || []).forEach(function (x) { inc.push(x.label + (x.status === 'priced' ? ' (' + M(x.monthly) + ' a month)' : '')); });
      var sub = q.sub || OPTION_SUB[q.option];
      L.push((op.prop && op.prop.n ? op.prop.n : i + 1) + '. ' + (op.prop && op.prop.label ? op.prop.label : q.label) + (sub ? ' (' + sub + ')' : ''));
      L.push('   Includes: ' + (inc.length ? inc.join(', ') : 'nothing priced yet'));
      var tt = testsText(q.tests, M);
      if (tt) L.push('   ' + tt);
      var rt = refreshText(q.refresh, M);
      if (rt) L.push('   ' + rt);
      L.push('   One-off ' + M(q.oneOff ? q.oneOff.total : 0) + ' · monthly ' + M(q.monthly ? q.monthly.total : 0));
      L.push('');
    });
    return L.join('\n').replace(/\n+$/, '');
  }
  // the Workflow brief title for a line: led by the catalogue name, so classifyTach reads it back
  // as that line's catalogue id however the client or the label is worded
  function briefTask(line, client, mkt, label, ref) {
    var l = typeof line === 'string' ? LINE_BY[line] : line;
    if (!l) return '';
    var row = l.row ? CATALOG.concat(PKG_ROWS).filter(function (c) { return c.id === l.row; })[0] : null;
    var name = row ? row.name : (BRIEF_NAME[l.key] || l.label);
    return name + ' — ' + String(client || '').trim() + (mkt ? ' ' + String(mkt).toUpperCase() : '') + ' — ' + (label || l.label) + (ref ? ' (' + ref + ')' : '');
  }
  // the ONE option a proposal is counted at: the newest choice, else the lowest-numbered — of the
  // options still OPEN: a declined option is never the one a proposal is counted at (a proposal
  // whose every option is declined counts at none), so a live sibling keeps it in the pipeline
  function countedOption(options, pid) {
    var ops = entries(options).filter(function (e) { var q = e[1]; return q && !q.deleted && !q.superseded && !q.declined && q.prop && q.prop.id === pid; });
    if (!ops.length) return null;
    var chosen = ops.filter(function (e) { return e[1].chosen; }).sort(function (a, b) { return (tOf(b[1].chosen) || 0) - (tOf(a[1].chosen) || 0); });
    if (chosen.length) return chosen[0][0];
    return ops.sort(function (a, b) { return (+a[1].prop.n || 0) - (+b[1].prop.n || 0); })[0][0];
  }
  // a client's stage, DERIVED — proposals hold sent / chosen / declined, the rollout record
  // holds debriefed / always-on live; nobody writes a stage field
  var ROLL_STAGES = ['Not started', 'Audit ready', 'Debriefed', 'Proposal sent', 'Agreed', 'Always-on live', 'Declined'];
  function rolloutStage(roll, options, audits) {
    roll = roll || {};
    var ops = entries(options).map(function (e) { return e[1]; }).filter(function (q) { return q && !q.deleted; });
    function maxT(f) { var m = 0; ops.forEach(function (q) { m = Math.max(m, tOf(q[f]) || 0); }); return m || null; }
    // the latest LIVE option (a superseded one is history), deterministic on a tie: options saved
    // in one click share their `t`, so the higher option number counts as the later one
    var latest = ops.filter(function (q) { return !q.superseded; }).sort(function (a, b) {
      return ((+b.t || 0) - (+a.t || 0)) || (((b.prop && +b.prop.n) || 0) - ((a.prop && +a.prop.n) || 0));
    })[0];
    if (roll.declined) return { stage: 'Declined', since: tOf(roll.declined) };
    // the latest option declined is the CLIENT declining — unless they chose a live sibling in the
    // same proposal: turning Tier 1 down while taking Tier 2 is an agreement, not a decline
    var sibChosen = latest && latest.prop && latest.prop.id && ops.some(function (q) {
      return q !== latest && q.chosen && !q.superseded && !q.declined && q.prop && q.prop.id === latest.prop.id;
    });
    if (latest && latest.declined && !sibChosen) return { stage: 'Declined', since: tOf(latest.declined) };
    if (roll.live) return { stage: 'Always-on live', since: tOf(roll.live) };
    var t = maxT('chosen'); if (t) return { stage: 'Agreed', since: t };
    t = maxT('sentAt'); if (t) return { stage: 'Proposal sent', since: t };
    if (roll.debriefAt) return { stage: 'Debriefed', since: tOf(roll.debriefAt) };
    var au = 0; entries(audits).forEach(function (e) { var a = e[1]; if (a && a.t && a.t.cov) au = Math.max(au, +a.t.cov); });
    if (au) return { stage: 'Audit ready', since: au };
    return { stage: 'Not started', since: null };
  }

  /* ---- quick wins: where the services rollout should go next, read off the book ------------- */
  function prevMonthKey(now) {
    var d = new Date(now), y = d.getUTCFullYear(), m = d.getUTCMonth();   // the month before this one
    var p = new Date(Date.UTC(y, m - 1, 1));
    return p.getUTCFullYear() + '-' + ('0' + (p.getUTCMonth() + 1)).slice(-2);
  }
  function quickWins(inp) {
    inp = inp || {};
    var LG = inp.LG, now = +inp.now || Date.now(), out = [];
    var est = inp.estate && inp.estate.feeds ? inp.estate.feeds : (inp.estate || {});
    var roll = inp.rollout || {}, ops = entries(inp.options).map(function (e) { return e[1]; });
    var byClient = {};
    Object.keys(est).forEach(function (k) {
      var e = est[k]; if (!e || !e.client || /-fb$/.test(e.mkt || '')) return;
      (byClient[e.client] = byClient[e.client] || []).push(e);
    });
    function scoreOf(e) {
      if (LG && e.cov) { var gs = LG.goldenScore(LG.attrsFromCov(e.cov, e.sc, e.rows), LG.profileFor(e.client, inp.profiles)); if (gs) return gs.score; }
      return e.score != null ? +e.score : null;
    }
    Object.keys(byClient).sort().forEach(function (c) {
      var feeds = byClient[c], mine = ops.filter(function (q) { return q && lower(q.client) === lower(c); });
      var audits = feeds.map(function (e) { return { t: { cov: e.t || null } }; });
      var st = rolloutStage(roll[c], mine, audits).stage, rank = ROLL_STAGES.indexOf(st);
      var low = feeds.map(function (e) { return { mkt: e.mkt, score: scoreOf(e) }; }).filter(function (x) { return x.score != null && x.score < 85; });
      if (low.length && rank < 2) out.push({ key: 'debrief-first|' + c, client: c,
        why: 'Golden Record under 85 on ' + low.map(function (x) { return String(x.mkt).toUpperCase(); }).join(', ') + ' and not debriefed yet — open with the audit',
        metric: { min: Math.min.apply(null, low.map(function (x) { return x.score; })), markets: low } });
      // the code's industry map first; a brand it does not name ('Retail') reads the industry the scan stored
      var ind = LG ? LG.industryOf(c) : null;
      if ((!ind || ind === 'Retail') && feeds[0].ind) ind = feeds[0].ind;
      var none = feeds.filter(function (e) { return e.ai && e.ai.n === 0; });
      if (APPAREL.indexOf(ind) >= 0 && none.length) out.push({ key: 'ai-gap|' + c, client: c,
        why: ind + ' brand with none of Google\'s six conversational attributes on ' + none.map(function (e) { return String(e.mkt).toUpperCase(); }).join(', ') + ' — Tier 2 is the conversation',
        metric: { markets: none.map(function (e) { return e.mkt; }) } });
    });
    var cad = Array.isArray(inp.schedule) ? inp.schedule : ((inp.schedule && inp.schedule.cadence) || []);
    var sk = {};
    cad.forEach(function (r) {
      if (!r || !r.client || (r.kind !== 'kw' && r.kind !== 'titles')) return;
      if (!((+r.skipRate || 0) >= 30 || (+r.streak || 0) >= 2)) return;
      (sk[r.client] = sk[r.client] || []).push({ mkt: r.mkt, kind: r.kind, skipRate: r.skipRate, streak: r.streak });
    });
    Object.keys(sk).sort().forEach(function (c) {
      out.push({ key: 'batch-to-always-on|' + c, client: c,
        why: 'scheduled ' + sk[c].map(function (t) { return t.kind === 'kw' ? 'keyword' : 'title'; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' + ') + ' batches keep being skipped — propose always-on instead',
        metric: { tasks: sk[c] } });
    });
    var arr = Array.isArray(inp.arrivals) ? inp.arrivals : ((inp.arrivals && inp.arrivals.feeds) || []), pk = prevMonthKey(now), cl = {};
    arr.forEach(function (f) {
      var d = f && f.dob; if (!d || !d.m || !(+d.rows > 0) || /-fb$/.test(f.mkt || '')) return;
      var n = +d.m[pk] || 0;
      if (n / d.rows >= 0.10) (cl[f.client] = cl[f.client] || []).push({ mkt: f.mkt, n: n, rows: +d.rows, pct: pct1(n / d.rows) });
    });
    Object.keys(cl).sort().forEach(function (c) {
      out.push({ key: 'collection-landing|' + c, client: c,
        why: 'a collection landed in ' + pk + ' (' + cl[c].map(function (x) { return String(x.mkt).toUpperCase() + ' ' + x.pct + '%'; }).join(', ') + ' of the catalogue new) — price the new products through the package',
        metric: { month: pk, markets: cl[c] } });
    });
    return out;
  }

  // HOW THE CHANGE IS DELIVERED (services spec §9, with the lead's scope decisions) — read-only
  // data the Roadmap section renders. `owner` names who moves it; nothing here is a store.
  var DELIVERY_PLAN = [
    { n: 1, owner: 'this PR', title: 'Proposals from stored scans + the automatic live count', detail: 'Every client × market audit reads the Golden Record stores at once, then the live feed count turns the estimates exact.' },
    { n: 2, owner: 'this PR', title: 'One rate card, three team tabs', detail: 'ASPL and London AM enter their hours; price and cost are Management-owned on the server.' },
    { n: 3, owner: 'this PR', title: 'Debrief kit', detail: 'Talk track, evidence, two-tone email; Gmail draft, Open in Gmail with the account AM on CC, and the "Ray to confirm" guard on every unconfirmed figure.' },
    { n: 4, owner: 'this PR', title: 'Services rollout tracker', detail: 'Client-scoped, stages derived from the proposals and the debrief record, From → To per account.' },
    { n: 5, owner: 'Ray / Management', title: 'Set the package prices (15 min)', detail: 'attr_pop unit, bundle %, re-use %, monthly floor, package version; one published day rate or the two labelled; "Spark AI" in client copy; 500 characters vs words.' },
    { n: 6, owner: 'ASPL', title: 'Enter the AI team inputs', detail: 'Attended minutes, tokens per product and hours per FeedHero rule for the package lines — clears the draft flags.' },
    { n: 7, owner: 'London AM', title: 'Enter the QC inputs', detail: 'QC share, QC minutes and PM hours per line.' },
    { n: 8, owner: 'Team', title: 'Confirm delivery status per line × industry', detail: 'Live / pilot / building / planned, plus always-on — unblocks the client copy for Tier 2.' },
    { n: 9, owner: 'Next', title: 'Store the parent count per feed', detail: 'The scan keeps the item-group count, so the stored lane converts exactly without a stream.' },
    { n: 10, owner: 'Next', title: 'Description length buckets in content quality', detail: '160 / 300 / 500 / 1,000 characters counted at scan time, so the stored description need is exact.' },
    { n: 11, owner: 'Next', title: '→ Finance', detail: 'File a chosen option into the AI Quote finance tracker.' },
    { n: 12, owner: 'Next', title: 'Deep links + Leadership hub card', detail: 'Open a client\'s proposal from the Golden Record scorecard, the dossier and the Playbook.' },
    { n: 13, owner: 'Next', title: 'Lock the legacy rate card', detail: 'Owner-only writes on /api/tachyon/rates and client scoping on /api/tachyon/quotes.' },
    { n: 14, owner: 'Next', title: 'CC on the Gmail Drafts bridge', detail: 'askdraft carries the AM CC and the Apps Script adds it to the draft (today Open in Gmail carries it).' },
    { n: 15, owner: 'Later', title: 'Always-on routing', detail: 'New product ids go straight to the ASPL queue per client decision; until then the proposal names today\'s cycle.' },
    { n: 16, owner: 'Later', title: 'Service-level hours from the Task Manager', detail: 'A classifier over the book gives real QC hours per line.' }
  ];

  var PricerEngine = { VERSION: '2.0.0', CATALOG: CATALOG, PKG_ROWS: PKG_ROWS, PKG_LINES: PKG_LINES, MKT_LANG: MKT_LANG, DEFAULTS: DEFAULTS,
    rates: rates, tieredUnits: tieredUnits, parentCounter: parentCounter, quote: quote, quoteText: quoteText, fmtGBP: fmtGBP,
    fmtMin: fmtMin, classifyTach: classifyTach, aiBriefRows: aiBriefRows, clientSummary: clientSummary,
    actualsFromBriefs: actualsFromBriefs, overridesWithActuals: overridesWithActuals, LIVE_IDS: LIVE_IDS,
    // services v2
    AIM_ATTRS: AIM_ATTRS, AIM_RATE_DEFAULT: AIM_RATE_DEFAULT, AIM_NEWNESS_DEFAULT: AIM_NEWNESS_DEFAULT, AIM_ROUTE_LABEL: AIM_ROUTE_LABEL,
    aim: { build: aimBuild, newness: aimNewness, hourly: aimHourly, ratesOf: aimRatesOf, routeOk: aimRouteOk, defaults: aimDefaultSources },
    aimDefaultSources: aimDefaultSources, langOf: langOf, targetsOf: targetsOf, profileForIndustry: profileForIndustry,
    TITLE_BITS: TITLE_BITS, GPC_BITS: GPC_BITS, DESC_B: DESC_B, HKEYS: HKEYS, OPTION_LABEL: OPTION_LABEL, OPTION_SUB: OPTION_SUB, GUARD_TXT: GUARD_TXT,
    TEST_COUNTS: TEST_COUNTS, TEST_DEFAULTS: TEST_DEFAULTS, TEST_WHAT: TEST_WHAT,
    REFRESH_FIELDS: REFRESH_FIELDS, REFRESH_DEFAULT_FIELDS: REFRESH_DEFAULT_FIELDS, REFRESH_SIGNALS: REFRESH_SIGNALS, REFRESH_CADENCE: REFRESH_CADENCE,
    BANK_TIERS: BANK_TIERS, TIER_NAME: TIER_NAME, BANK_GIVES: BANK_GIVES, BANK_SEED: BANK_SEED, BANK_STATUS: BANK_STATUS, bankOf: bankOf, bankGives: bankGives, inOption: inOption,
    REFRESH_SHARES: REFRESH_SHARES, REFRESH_PCT_DEFAULT: REFRESH_PCT_DEFAULT, REFRESH_WHAT: REFRESH_WHAT, refreshText: refreshText,
    needCollector: needCollector, composeRates: composeRates, auditStored: auditStored, auditMerge: auditMerge, needsOf: needsOf,
    contractedFrom: contractedFrom, roadmapStatus: roadmapStatus, ROADMAP_SEED: ROADMAP_SEED, packageQuote: packageQuote,
    costModel: costModel, proposalRef: proposalRef, snapshotOption: snapshotOption, proposalText: proposalText, optionsText: optionsText,
    briefTask: briefTask, countedOption: countedOption, rolloutStage: rolloutStage, ROLL_STAGES: ROLL_STAGES, quickWins: quickWins,
    DELIVERY_PLAN: DELIVERY_PLAN };
  g.PricerEngine = PricerEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = PricerEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
