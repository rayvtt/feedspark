/*
 * Tachyon Pricer engine — pure quote maths for the /pricer module. UMD like feedlab_engine:
 * browser (globalThis.PricerEngine) + node tests run the exact same file. No imports, no DOM.
 *
 * Commercial model (v1):
 *   one-off  = setup hours (ASPL + AM QC + PM, per optimisation) rounded UP to 8h retainer
 *              blocks × block £  +  Tachyon processing (unit £/SKU × volume through the
 *              MARGINAL tier ladder — each band priced like tax brackets)
 *   monthly  = monitoring hours/mo (block-rounded unless "absorb into existing retainer")
 *              + optional refresh processing (newPct of volume × unit £/SKU each month)
 *   sla      = longest selected lead time + 2 working days per extra optimisation (stagger)
 * All prices ex-VAT; the page labels +VAT.
 */
(function (g) {
  'use strict';

  // The Tachyon catalogue ("What We Do") — 13 optimisations in 7 groups. Hours/unit rates are
  // DRAFT defaults: the collaborative rate card (KV `tachyonrates`) overrides every field, and
  // the module flags rows still on draft values. id keys are stable — KV merges hang off them.
  var CATALOG = [
    { id: 'title_gen',      grp: 'AI Titles',                    name: 'AI Product Title Generation',            aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.08, lead: 10 },
    { id: 'title_short',    grp: 'AI Titles',                    name: 'AI Short Title Generation',              aspl: 4,  qc: 2, pm: 1, mon: 1, unit: 0.05, lead: 7 },
    { id: 'title_intent',   grp: 'AI Titles',                    name: 'Title with AI Search Intent',            aspl: 8,  qc: 4, pm: 2, mon: 2, unit: 0.12, lead: 12 },
    { id: 'desc_gen',       grp: 'AI Description',               name: 'AI Product Description Generation',      aspl: 8,  qc: 4, pm: 3, mon: 3, unit: 0.15, lead: 14 },
    { id: 'desc_pro',       grp: 'AI Description',               name: 'AI Description Pro (Compare & Q/A)',     aspl: 12, qc: 6, pm: 3, mon: 4, unit: 0.25, lead: 18 },
    { id: 'predesc_attr',   grp: 'AI Pre-Description',           name: 'AI Pre-Description (Highlighting Attributes)', aspl: 6, qc: 3, pm: 2, mon: 2, unit: 0.10, lead: 10 },
    { id: 'predesc',        grp: 'AI Pre-Description',           name: 'AI Pre-Description',                     aspl: 5,  qc: 2, pm: 2, mon: 2, unit: 0.08, lead: 8 },
    { id: 'highlights',     grp: 'Product Highlights & Details', name: 'AI Product Highlights',                  aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.10, lead: 10 },
    { id: 'details',        grp: 'Product Highlights & Details', name: 'AI Product Details',                     aspl: 6,  qc: 3, pm: 2, mon: 2, unit: 0.10, lead: 10 },
    { id: 'keywords',       grp: 'AI Keywords',                  name: 'AI Keyword Generation',                  aspl: 5,  qc: 3, pm: 2, mon: 2, unit: 0.06, lead: 8 },
    { id: 'visual_attr',    grp: 'AI Visual Attributes',         name: 'AI Visual Attribute Extraction',         aspl: 10, qc: 5, pm: 3, mon: 3, unit: 0.20, lead: 15 },
    { id: 'gpc',            grp: 'GPC Mapping & PT',             name: 'AI GPC Mapping',                         aspl: 6,  qc: 3, pm: 2, mon: 1, unit: 0.05, lead: 8 },
    { id: 'pt_class',       grp: 'GPC Mapping & PT',             name: 'AI Product Type Classification',         aspl: 6,  qc: 3, pm: 2, mon: 1, unit: 0.05, lead: 8 }
  ];

  // Retainer + tier defaults (rate card can override all of it).
  // blockGBP/blockHours = the London ratecard (£585+VAT per 8h → £73.125/h).
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

  // marginal tier maths: each band of volume pays unit × band multiplier
  function tieredUnits(volume, tiers) {
    tiers = tiers && tiers.length ? tiers : DEFAULTS.tiers;
    var left = Math.max(0, Math.floor(+volume || 0)), prev = 0, units = 0, bands = [];
    for (var i = 0; i < tiers.length && left > 0; i++) {
      var cap = tiers[i].upTo, take = Math.min(left, cap - prev);
      if (take > 0) { units += take * tiers[i].x; bands.push({ from: prev, upTo: Math.min(cap, prev + take), x: tiers[i].x, skus: take }); left -= take; prev += take; }
      else prev = cap;
    }
    return { units: units, bands: bands };
  }

  // The quote. picks = [optimisation ids]; opts = { volume, rateOverrides, blockGBP, blockHours,
  // tiers, absorbMonitoring, refreshPct (0-1 of volume reprocessed monthly), client, market }
  function quote(picks, opts) {
    opts = opts || {};
    var R = {}; rates(opts.rateOverrides).forEach(function (r) { R[r.id] = r; });
    var rows = (picks || []).map(function (id) { return R[id]; }).filter(Boolean);
    var blockGBP = isFinite(+opts.blockGBP) && +opts.blockGBP > 0 ? +opts.blockGBP : DEFAULTS.blockGBP;
    var blockHours = isFinite(+opts.blockHours) && +opts.blockHours > 0 ? +opts.blockHours : DEFAULTS.blockHours;
    var vol = Math.max(0, Math.floor(+opts.volume || 0));
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
    return { picks: rows.map(function (r) { return r.id; }), volume: vol, tier: tv,
      blockGBP: blockGBP, blockHours: blockHours, lines: lines,
      oneOff: oneOff, monthly: monthly, slaDays: sla, draftRates: draft,
      client: opts.client || '', market: opts.market || '' };
  }

  // client-ready quote text (ex-VAT figures; "+VAT" spelled out — never invent VAT-inclusive)
  function fmtGBP(n) { return '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function quoteText(q) {
    var L = [];
    L.push('TACHYON AI OPTIMISATION — ' + (q.client || 'Client') + (q.market ? ' (' + q.market.toUpperCase() + ')' : ''));
    L.push('Volume: ' + q.volume.toLocaleString('en-GB') + ' SKUs');
    L.push('');
    q.lines.forEach(function (l) {
      L.push('· ' + l.name + ' — setup ' + l.hours + 'h · Tachyon ' + fmtGBP(l.tachyon) + ' · live in ~' + l.lead + ' working days');
    });
    L.push('');
    L.push('ONE-OFF SETUP');
    L.push('  Team setup: ' + q.oneOff.hours + 'h (ASPL ' + q.oneOff.byRole.aspl + ' · QC ' + q.oneOff.byRole.qc + ' · PM ' + q.oneOff.byRole.pm + ') = ' + q.oneOff.blocks + ' × ' + fmtGBP(q.blockGBP) + ' block = ' + fmtGBP(q.oneOff.blockCost) + ' +VAT');
    L.push('  Tachyon processing (volume-tiered): ' + fmtGBP(q.oneOff.tachyon) + ' +VAT');
    L.push('  One-off total: ' + fmtGBP(q.oneOff.total) + ' +VAT');
    L.push('');
    L.push('ONGOING (MONTHLY)');
    if (q.monthly.absorbed) L.push('  Monitoring: ' + q.monthly.monHours + 'h/mo — absorbed into the existing retainer');
    else L.push('  Monitoring: ' + q.monthly.monHours + 'h/mo = ' + q.monthly.blocks + ' × ' + fmtGBP(q.blockGBP) + ' = ' + fmtGBP(q.monthly.blockCost) + ' +VAT');
    if (q.monthly.refreshPct > 0) L.push('  New/refreshed SKUs (~' + Math.round(q.monthly.refreshPct * 100) + '%/mo): ' + fmtGBP(q.monthly.refreshTachyon) + ' +VAT');
    L.push('  Monthly total: ' + fmtGBP(q.monthly.total) + ' +VAT');
    L.push('');
    L.push('Live in ~' + q.slaDays + ' working days from sign-off.');
    if (q.draftRates) L.push('[DRAFT RATES — hours/unit prices pending confirmation in the FCC rate card]');
    return L.join('\n');
  }

  // ---- AI-brief detection: the Pricer finds AI work by SCANNING TASK TITLES ------------
  // (Ray: tracking lives here, not in the Workflow pipeline). classifyTach maps wording to a
  // catalogue id; aiBriefRows joins every scanned-or-tracked brief with its tracking record.
  function classifyTach(t) {
    t = String(t || '').toLowerCase();
    if (!/\bai\b|tachyon/.test(t)) return '';
    if (/short title/.test(t)) return 'title_short';
    if (/search intent/.test(t)) return 'title_intent';
    if (/pre.?desc/.test(t)) return /attribute/.test(t) ? 'predesc_attr' : 'predesc';
    if (/description pro|q\/?a|compare/.test(t)) return 'desc_pro';
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
  // pm, mon, tokens, volDone, catsDone, t}). A brief joins the table when its TITLE scans as
  // AI work or a track record exists; the track's explicit tach overrides the scan.
  function aiBriefRows(briefs, track) {
    track = track || {};
    var rows = [];
    Object.keys(briefs || {}).forEach(function (k) {
      var b = briefs[k]; if (!b) return;
      var scanned = classifyTach(b.task);
      var tr = track[k] || {};
      if (!scanned && !tr.tach && !Object.keys(tr).length) return;
      var done = b.status === 'done' || b.status === 'confirmed' || b.status === 'analysis';
      rows.push({ bid: k, client: b.client || '', task: b.task || '', status: b.status || 'intake', done: done,
        created: +b.created || 0, tach: tr.tach || scanned || '',
        aspl: +tr.aspl || 0, qc: +tr.qc || 0, pm: +tr.pm || 0, mon: +tr.mon || 0,
        tokens: +tr.tokens || 0, volDone: +tr.volDone || 0, catsDone: String(tr.catsDone || '') });
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
  function actualsFromBriefs(briefs, track) {
    var acc = {};
    Object.keys(briefs || {}).forEach(function (k) {
      var b = briefs[k]; if (!b) return;
      var tr = (track || {})[k] || {};
      // track record wins; a brief-embedded tag (the retired Workflow tagging) still counts;
      // otherwise the TITLE SCAN decides — same rule that builds the tracking table
      var tach = (typeof tr.tach === 'string' && tr.tach) || (typeof b.tach === 'string' && b.tach) || classifyTach(b.task);
      if (!tach) return;
      var h = { aspl: +tr.aspl || +(b.hours || {}).aspl || 0, qc: +tr.qc || +(b.hours || {}).qc || 0,
        pm: +tr.pm || +(b.hours || {}).pm || 0, mon: +tr.mon || +(b.hours || {}).mon || 0 };
      var any = h.aspl > 0 || h.qc > 0 || h.pm > 0 || h.mon > 0;
      var tokens = +tr.tokens || 0, volDone = +tr.volDone || 0;
      if (!any && !(tokens > 0 && volDone > 0)) return;
      var a = acc[tach] = acc[tach] || { n: 0, aspl: 0, qc: 0, pm: 0, mon: 0, leadN: 0, lead: 0, tok: 0, vol: 0 };
      if (any) { a.n++; ['aspl', 'qc', 'pm', 'mon'].forEach(function (f) { a[f] += Math.max(0, h[f]); }); }
      if (tokens > 0 && volDone > 0) { a.tok += tokens; a.vol += volDone; }
      var t0 = 0, t1 = 0;
      (b.hist || []).forEach(function (e) {
        if (e.s === 'briefed' && !t0) t0 = +e.t || 0;
        if ((e.s === 'done' || e.s === 'confirmed' || e.s === 'analysis') && !t1) t1 = +e.t || 0;
      });
      if (any && t0 && t1 && t1 > t0) { a.leadN++; a.lead += (t1 - t0) / 86400000; }
    });
    var out = {};
    Object.keys(acc).forEach(function (id) {
      var a = acc[id];
      if (!a.n && !a.vol) return;
      out[id] = { n: a.n,
        aspl: a.n ? round2(a.aspl / a.n) : 0, qc: a.n ? round2(a.qc / a.n) : 0,
        pm: a.n ? round2(a.pm / a.n) : 0, mon: a.n ? round2(a.mon / a.n) : 0,
        lead: a.leadN ? Math.max(1, Math.round(a.lead / a.leadN)) : null,
        tokPerSku: a.vol > 0 ? round2(a.tok / a.vol) : null, volDone: a.vol };
    });
    return out;
  }
  // rate-card overrides with actuals layered on top (unit £ stays commercial — actuals only
  // ever replace HOURS + lead, never the per-SKU price)
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

  var PricerEngine = { VERSION: '1.2.0', CATALOG: CATALOG, DEFAULTS: DEFAULTS,
    rates: rates, tieredUnits: tieredUnits, quote: quote, quoteText: quoteText, fmtGBP: fmtGBP,
    classifyTach: classifyTach, aiBriefRows: aiBriefRows,
    actualsFromBriefs: actualsFromBriefs, overridesWithActuals: overridesWithActuals };
  g.PricerEngine = PricerEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = PricerEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
