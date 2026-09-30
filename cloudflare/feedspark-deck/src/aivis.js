// AI VISIBILITY — the asking half (Ray, 29 Sep 2026: "lets build 2 AI Surface visibility tracker
// real-time"). One shopper question to one AI answer engine with its live web search on, streamed back
// to the page as it happens (the searches it runs, the sources it reads, the answer as it is written)
// and normalised into ONE shape whatever the surface:
//   { ok, none, err, text, cites:[{u,t}], results:[{u,t}], searches:[q], usage:{i,o,ws}, model, stop, ms }
// cites = the sources the answer CITES; results = every source the surface READ. Reading an answer —
// is the brand named, is its site cited, who else is — is docs/aivis_engine.js, in the browser, so a
// stored run can be re-read later with a different competitor list.
//
// FIVE SURFACES, each switched on by its own Worker secret and never by a guess:
//   claude      ANTHROPIC_API_KEY   Messages API, web_search_20260209 called directly, streamed
//   chatgpt     OPENAI_API_KEY      Responses API, web_search tool (location defaults to the US unless sent)
//   perplexity  PERPLEXITY_API_KEY  Agent API (/v1/agent) — Sonar chat completions ended 27 Sep 2026
//   aimode      SERPAPI_KEY         SerpApi engine=google_ai_mode — the real Google AI Mode page
//   aio         SERPAPI_KEY         SerpApi engine=google → ai_overview (+ the page_token follow-up)
// Models are overridable without a redeploy: AIVIS_CLAUDE_MODEL, AIVIS_OPENAI_MODEL, AIVIS_PPLX_MODEL.
// Pure except for the injected fetch — tools/test_aivis.mjs runs every adapter against stub responses.

export const SURFACES = [
  { k: 'chatgpt', n: 'ChatGPT', by: 'OpenAI · Responses API + web search', key: 'OPENAI_API_KEY' },
  { k: 'aimode', n: 'Google AI Mode', by: 'Google · read through SerpApi', key: 'SERPAPI_KEY' },
  { k: 'aio', n: 'AI Overviews', by: 'Google Search · read through SerpApi', key: 'SERPAPI_KEY' },
  { k: 'perplexity', n: 'Perplexity', by: 'Perplexity · Agent API + web search', key: 'PERPLEXITY_API_KEY' },
  { k: 'claude', n: 'Claude', by: 'Anthropic · Messages API + web search', key: 'ANTHROPIC_API_KEY' },
];
export const SURFACE_KEYS = SURFACES.map((s) => s.k);
export const DEFAULT_MODELS = { claude: 'claude-opus-5-5', chatgpt: 'gpt-5.5', perplexity: 'perplexity/sonar' };

// the estate's markets: where the shopper is (search location), what language the question is asked in
// (`in` = the English phrase, `inL` = the market's own where a template exists for it)
export const MARKETS = {
  gb: { cc: 'GB', country: 'United Kingdom', lang: 'en', gl: 'uk', hl: 'en', city: 'London', tz: 'Europe/London', in: 'in the UK' },
  ie: { cc: 'IE', country: 'Ireland', lang: 'en', gl: 'ie', hl: 'en', city: 'Dublin', tz: 'Europe/Dublin', in: 'in Ireland' },
  us: { cc: 'US', country: 'United States', lang: 'en', gl: 'us', hl: 'en', city: 'New York', tz: 'America/New_York', in: 'in the US' },
  ca: { cc: 'CA', country: 'Canada', lang: 'en', gl: 'ca', hl: 'en', city: 'Toronto', tz: 'America/Toronto', in: 'in Canada' },
  au: { cc: 'AU', country: 'Australia', lang: 'en', gl: 'au', hl: 'en', city: 'Sydney', tz: 'Australia/Sydney', in: 'in Australia' },
  de: { cc: 'DE', country: 'Germany', lang: 'de', gl: 'de', hl: 'de', city: 'Berlin', tz: 'Europe/Berlin', in: 'in Germany', inL: 'in Deutschland' },
  at: { cc: 'AT', country: 'Austria', lang: 'de', gl: 'at', hl: 'de', city: 'Vienna', tz: 'Europe/Vienna', in: 'in Austria', inL: 'in Österreich' },
  ch: { cc: 'CH', country: 'Switzerland', lang: 'de', gl: 'ch', hl: 'de', city: 'Zurich', tz: 'Europe/Zurich', in: 'in Switzerland', inL: 'in der Schweiz' },
  nl: { cc: 'NL', country: 'Netherlands', lang: 'nl', gl: 'nl', hl: 'nl', city: 'Amsterdam', tz: 'Europe/Amsterdam', in: 'in the Netherlands' },
  be: { cc: 'BE', country: 'Belgium', lang: 'nl', gl: 'be', hl: 'nl', city: 'Brussels', tz: 'Europe/Brussels', in: 'in Belgium' },
  benl: { cc: 'BE', country: 'Belgium', lang: 'nl', gl: 'be', hl: 'nl', city: 'Brussels', tz: 'Europe/Brussels', in: 'in Belgium' },
  befr: { cc: 'BE', country: 'Belgium', lang: 'fr', gl: 'be', hl: 'fr', city: 'Brussels', tz: 'Europe/Brussels', in: 'in Belgium' },
  fr: { cc: 'FR', country: 'France', lang: 'fr', gl: 'fr', hl: 'fr', city: 'Paris', tz: 'Europe/Paris', in: 'in France' },
  es: { cc: 'ES', country: 'Spain', lang: 'es', gl: 'es', hl: 'es', city: 'Madrid', tz: 'Europe/Madrid', in: 'in Spain' },
  it: { cc: 'IT', country: 'Italy', lang: 'it', gl: 'it', hl: 'it', city: 'Rome', tz: 'Europe/Rome', in: 'in Italy' },
  pt: { cc: 'PT', country: 'Portugal', lang: 'pt', gl: 'pt', hl: 'pt', city: 'Lisbon', tz: 'Europe/Lisbon', in: 'in Portugal' },
  dk: { cc: 'DK', country: 'Denmark', lang: 'da', gl: 'dk', hl: 'da', city: 'Copenhagen', tz: 'Europe/Copenhagen', in: 'in Denmark' },
  se: { cc: 'SE', country: 'Sweden', lang: 'sv', gl: 'se', hl: 'sv', city: 'Stockholm', tz: 'Europe/Stockholm', in: 'in Sweden' },
  fi: { cc: 'FI', country: 'Finland', lang: 'fi', gl: 'fi', hl: 'fi', city: 'Helsinki', tz: 'Europe/Helsinki', in: 'in Finland' },
  pl: { cc: 'PL', country: 'Poland', lang: 'pl', gl: 'pl', hl: 'pl', city: 'Warsaw', tz: 'Europe/Warsaw', in: 'in Poland' },
  cz: { cc: 'CZ', country: 'Czechia', lang: 'cs', gl: 'cz', hl: 'cs', city: 'Prague', tz: 'Europe/Prague', in: 'in the Czech Republic' },
  sk: { cc: 'SK', country: 'Slovakia', lang: 'sk', gl: 'sk', hl: 'sk', city: 'Bratislava', tz: 'Europe/Bratislava', in: 'in Slovakia' },
  ro: { cc: 'RO', country: 'Romania', lang: 'ro', gl: 'ro', hl: 'ro', city: 'Bucharest', tz: 'Europe/Bucharest', in: 'in Romania' },
  gr: { cc: 'GR', country: 'Greece', lang: 'el', gl: 'gr', hl: 'el', city: 'Athens', tz: 'Europe/Athens', in: 'in Greece' },
  uae: { cc: 'AE', country: 'United Arab Emirates', lang: 'en', gl: 'ae', hl: 'en', city: 'Dubai', tz: 'Asia/Dubai', in: 'in the UAE' },
  sa: { cc: 'SA', country: 'Saudi Arabia', lang: 'en', gl: 'sa', hl: 'en', city: 'Riyadh', tz: 'Asia/Riyadh', in: 'in Saudi Arabia' },
  kw: { cc: 'KW', country: 'Kuwait', lang: 'en', gl: 'kw', hl: 'en', city: 'Kuwait City', tz: 'Asia/Kuwait', in: 'in Kuwait' },
  hk: { cc: 'HK', country: 'Hong Kong', lang: 'en', gl: 'hk', hl: 'en', city: 'Hong Kong', tz: 'Asia/Hong_Kong', in: 'in Hong Kong' },
  sg: { cc: 'SG', country: 'Singapore', lang: 'en', gl: 'sg', hl: 'en', city: 'Singapore', tz: 'Asia/Singapore', in: 'in Singapore' },
  eu: { cc: null, country: 'Europe', lang: 'en', gl: null, hl: 'en', city: null, tz: null, in: 'in Europe' },
};
export function mktMeta(m) { return MARKETS[String(m || '').toLowerCase()] || MARKETS.gb; }
// a Google Shopping market this tracker can ask about (a Meta catalogue feed has no shopper question)
export function aivisMarket(m) { const k = String(m || '').toLowerCase(); return !/-fb$/.test(k) && !!MARKETS[k]; }

export function modelOf(env, s) {
  if (s === 'claude') return (env && env.AIVIS_CLAUDE_MODEL) || DEFAULT_MODELS.claude;
  if (s === 'chatgpt') return (env && env.AIVIS_OPENAI_MODEL) || DEFAULT_MODELS.chatgpt;
  if (s === 'perplexity') return (env && env.AIVIS_PPLX_MODEL) || DEFAULT_MODELS.perplexity;
  return s === 'aimode' ? 'google_ai_mode' : (s === 'aio' ? 'google · ai_overview' : null);
}
// which surfaces are switched on — the secret's NAME, never its value
export function surfaceStatus(env) {
  return SURFACES.map((s) => ({ k: s.k, n: s.n, by: s.by, key: s.key, on: !!(env && env[s.key]), model: modelOf(env, s.k) }));
}

// ---- small helpers ------------------------------------------------------------------------------------------
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function dedupe(list) {
  const seen = {}, out = [];
  (list || []).forEach((x) => {
    if (!x || !x.u || !/^https?:\/\//i.test(x.u)) return;
    const k = x.u.replace(/#.*$/, '').replace(/[?&](utm_[a-z]+|srsltid|gclid)=[^&]*/gi, '').replace(/\/+$/, '').toLowerCase();
    if (seen[k] != null) { if (!out[seen[k]].t && x.t) out[seen[k]].t = str(x.t, 200); return; }
    seen[k] = out.length; out.push({ u: str(x.u, 500), t: str(x.t || '', 200) });
  });
  return out;
}
function systemPrompt(meta, now) {
  const d = new Date(now || Date.now()).toISOString().slice(0, 10);
  return 'Today is ' + d + '. You are helping a shopper' + (meta && meta.country && meta.cc ? ' in ' + meta.country : '') +
    '. Answer their question the way you would for anyone asking: helpfully and concisely, recommending specific brands, retailers or products where that helps, and using web search for current information.';
}

// ---- SSE: the Anthropic stream, parsed incrementally ---------------------------------------------------------
export function sseReader(onEvent) {
  let buf = '';
  function flush(chunk) {
    const lines = chunk.split(/\r?\n/);
    let data = '';
    lines.forEach((l) => { if (l.startsWith('data:')) data += (data ? '\n' : '') + l.slice(5).replace(/^ /, ''); });
    if (!data || data === '[DONE]') return;
    try { onEvent(JSON.parse(data)); } catch (e) { /* a malformed frame is skipped, never fatal */ }
  }
  return {
    push(text) {
      buf += text;
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const m = buf.slice(i).match(/^\r?\n\r?\n/);
        flush(buf.slice(0, i)); buf = buf.slice(i + (m ? m[0].length : 2));
      }
    },
    end() { if (buf.trim()) flush(buf); buf = ''; },
  };
}
// rebuilds the assistant message block by block the way the SDK accumulator does, so a pause_turn can send it
// back exactly as received, and emits the live moments (a search run, sources read, answer text) as they land
export function claudeAcc(emit) {
  const A = { blocks: [], json: {}, stop: null, usage: {}, error: null, model: null };
  const say = emit || (() => {});
  function usage(u) {
    if (!u) return;
    if (u.input_tokens != null) A.usage.i = Math.max(A.usage.i || 0, u.input_tokens | 0);
    if (u.cache_read_input_tokens != null) A.usage.cr = Math.max(A.usage.cr || 0, u.cache_read_input_tokens | 0);
    if (u.output_tokens != null) A.usage.o = Math.max(A.usage.o || 0, u.output_tokens | 0);
    if (u.server_tool_use && u.server_tool_use.web_search_requests != null) A.usage.ws = Math.max(A.usage.ws || 0, u.server_tool_use.web_search_requests | 0);
  }
  A.on = (ev) => {
    const t = ev && ev.type;
    if (t === 'message_start') { const m = ev.message || {}; A.model = m.model || A.model; usage(m.usage); }
    else if (t === 'content_block_start') {
      const b = JSON.parse(JSON.stringify(ev.content_block || {}));
      A.blocks[ev.index] = b;
      if (b.type === 'server_tool_use' || b.type === 'tool_use') A.json[ev.index] = '';
      if (b.type === 'web_search_tool_result') {
        const c = b.content;
        if (Array.isArray(c)) say({ t: 'sources', n: c.length, urls: c.slice(0, 10).map((r) => str(r && r.url, 300)) });
        else if (c && c.error_code) say({ t: 'note', d: 'search error: ' + str(c.error_code, 60) });
      }
    } else if (t === 'content_block_delta') {
      const b = A.blocks[ev.index], d = ev.delta || {};
      if (!b) return;
      if (d.type === 'text_delta') { b.text = (b.text || '') + (d.text || ''); if (d.text) say({ t: 'text', d: d.text }); }
      else if (d.type === 'input_json_delta') A.json[ev.index] = (A.json[ev.index] || '') + (d.partial_json || '');
      else if (d.type === 'citations_delta') { if (!Array.isArray(b.citations)) b.citations = []; b.citations.push(d.citation); }
      else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
      else if (d.type === 'signature_delta') b.signature = d.signature;
    } else if (t === 'content_block_stop') {
      const b = A.blocks[ev.index];
      if (b && A.json[ev.index] != null) {
        if (A.json[ev.index]) { try { b.input = JSON.parse(A.json[ev.index]); } catch (e) { b.input = b.input || {}; } }
        else if (!b.input) b.input = {};
        delete A.json[ev.index];
        if (b.type === 'server_tool_use' && b.name === 'web_search' && b.input && b.input.query) say({ t: 'search', q: str(b.input.query, 200) });
      }
    } else if (t === 'message_delta') { if (ev.delta && ev.delta.stop_reason) A.stop = ev.delta.stop_reason; usage(ev.usage); }
    else if (t === 'error') A.error = str((ev.error && (ev.error.message || ev.error.type)) || 'stream error', 200);
  };
  A.content = () => A.blocks.filter(Boolean);
  return A;
}
// every assistant turn's blocks → the one shape. The answer is the text AFTER the first search result (the
// "I'll search for…" preamble is not the answer); an answer that never searched keeps all its text.
export function normClaude(turns) {
  const all = [].concat(...(turns || []).map((t) => t || []));
  const first = all.findIndex((b) => b && b.type === 'web_search_tool_result');
  let txt = all.filter((b, i) => b && b.type === 'text' && (first < 0 || i > first));
  if (!txt.map((b) => b.text || '').join('').trim()) txt = all.filter((b) => b && b.type === 'text');
  const cites = [], results = [], searches = [], errs = [];
  txt.forEach((b) => (Array.isArray(b.citations) ? b.citations : []).forEach((c) => { if (c && c.url) cites.push({ u: c.url, t: c.title }); }));
  all.forEach((b) => {
    if (!b) return;
    if (b.type === 'server_tool_use' && b.name === 'web_search' && b.input && b.input.query) searches.push(str(b.input.query, 200));
    if (b.type === 'web_search_tool_result') {
      if (Array.isArray(b.content)) b.content.forEach((r) => { if (r && r.url) results.push({ u: r.url, t: r.title }); });
      else if (b.content && b.content.error_code) errs.push(str(b.content.error_code, 60));
    }
  });
  return { text: txt.map((b) => b.text || '').join('').trim(), cites: dedupe(cites), results: dedupe(results), searches: searches.slice(0, 8), errs };
}
export function claudeBody(q, meta, env, now, history) {
  const tool = { type: 'web_search_20260209', name: 'web_search', max_uses: 4, allowed_callers: ['direct'] };
  if (meta && meta.cc) tool.user_location = { type: 'approximate', country: meta.cc, city: meta.city || undefined, timezone: meta.tz || undefined };
  return {
    model: modelOf(env, 'claude'), max_tokens: 8000, stream: true,
    output_config: { effort: 'low' },
    system: systemPrompt(meta, now), tools: [tool],
    messages: [{ role: 'user', content: q }].concat(history || []),
  };
}

// ---- ChatGPT: the Responses API ------------------------------------------------------------------------------
export function openaiBody(q, meta, env, now) {
  const tool = { type: 'web_search', search_context_size: 'medium' };
  // the tool's location falls back to the UNITED STATES when none is sent — always send the market's
  if (meta && meta.cc) tool.user_location = { type: 'approximate', country: meta.cc, city: meta.city || undefined, timezone: meta.tz || undefined };
  return { model: modelOf(env, 'chatgpt'), instructions: systemPrompt(meta, now), input: q, tools: [tool], tool_choice: 'required', include: ['web_search_call.action.sources'] };
}
export function normOpenAI(j) {
  j = j || {};
  if (j.error && (j.error.message || j.error.code)) return { err: str(j.error.message || j.error.code, 200) };
  let text = '';
  const cites = [], results = [], searches = [];
  (j.output || []).forEach((it) => {
    if (!it) return;
    if (it.type === 'web_search_call') {
      const a = it.action || {};
      if (a.query) searches.push(str(a.query, 200));
      (a.queries || []).forEach((x) => { if (x && searches.indexOf(x) < 0) searches.push(str(x, 200)); });
      (a.sources || []).forEach((s) => { if (s && s.url) results.push({ u: s.url, t: s.title || '' }); });
      if (a.url) results.push({ u: a.url, t: '' });
    } else if (it.type === 'message') {
      (it.content || []).forEach((c) => {
        if (!c || c.type !== 'output_text') return;
        text += (text ? '\n\n' : '') + (c.text || '');
        (c.annotations || []).forEach((an) => { if (an && an.type === 'url_citation' && an.url) cites.push({ u: an.url, t: an.title }); });
      });
    }
  });
  const inc = j.status === 'incomplete' && j.incomplete_details ? str(j.incomplete_details.reason, 60) : null;
  if (!text.trim() && j.status && j.status !== 'completed') return { err: 'OpenAI answered ' + j.status + (inc ? ' (' + inc + ')' : '') };
  return { text: text.trim(), cites: dedupe(cites), results: dedupe(results), searches: searches.slice(0, 8), stop: inc || j.status || null,
    usage: j.usage ? { i: j.usage.input_tokens | 0, o: j.usage.output_tokens | 0 } : null };
}

// ---- Perplexity: the Agent API (Sonar chat completions ended 27 Sep 2026) --------------------------------------
export function pplxBody(q, meta, env) {
  const tool = { type: 'web_search', search_context_size: 'medium' };
  if (meta && meta.cc) tool.user_location = { country: meta.cc, city: meta.city || undefined };
  return { model: modelOf(env, 'perplexity'), input: q, tools: [tool] };
}
export function normPerplexity(j) {
  j = j || {};
  if (j.error && (j.error.message || typeof j.error === 'string')) return { err: str(j.error.message || j.error, 200) };
  let text = '';
  const byId = {}, results = [], searches = [], annCites = [];
  (j.output || []).forEach((it) => {
    if (!it) return;
    if (it.type === 'search_results') {
      (it.queries || []).forEach((x) => searches.push(str(x, 200)));
      (it.results || []).forEach((r) => { if (r && r.url) { results.push({ u: r.url, t: r.title }); if (r.id != null) byId[String(r.id)] = { u: r.url, t: r.title }; } });
    } else if (it.type === 'message') {
      (it.content || []).forEach((c) => {
        if (!c || c.type !== 'output_text') return;
        text += (text ? '\n\n' : '') + (c.text || '');
        (c.annotations || []).forEach((an) => { if (an && an.url) annCites.push({ u: an.url, t: an.title }); });
      });
    }
  });
  // [1] / [web:1] markers point at a search result's id; with no markers and no annotations, every result the
  // answer was written from is its source list (what Perplexity shows beside the answer)
  const cites = annCites.slice();
  const re = /\[(?:web:)?(\d{1,3})\]/g; let m;
  while ((m = re.exec(text))) { const r = byId[m[1]]; if (r) cites.push(r); }
  if (!text.trim() && j.status && j.status !== 'completed') return { err: 'Perplexity answered ' + j.status };
  return { text: text.trim(), cites: dedupe(cites.length ? cites : results), results: dedupe(results), searches: searches.slice(0, 8), stop: j.status || null };
}

// ---- Google AI Mode + AI Overviews through SerpApi ---------------------------------------------------------------
export function serpUrl(engine, params, env) {
  const u = new URL('https://serpapi.com/search');
  u.searchParams.set('engine', engine);
  Object.keys(params).forEach((k) => { if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]); });
  u.searchParams.set('api_key', (env && env.SERPAPI_KEY) || '');
  return u.toString();
}
// SerpApi's text_blocks nest (a list item can hold its own list and text_blocks) — walked in order
function walkBlocks(blocks, depth, out) {
  (blocks || []).forEach((b) => {
    if (!b) return;
    const pad = depth ? '  '.repeat(depth - 1) + '- ' : '';
    if (b.type === 'heading' && b.snippet) out.push('\n' + b.snippet);
    else if (b.type === 'table' && Array.isArray(b.table)) b.table.forEach((row) => out.push((row || []).join(' | ')));
    else if (b.snippet || b.title) out.push(pad + [b.title, b.snippet].filter(Boolean).join(': '));
    if (Array.isArray(b.list)) walkBlocks(b.list, depth + 1, out);
    if (Array.isArray(b.text_blocks)) walkBlocks(b.text_blocks, depth + 1, out);
  });
  return out;
}
export function normSerpAnswer(o) {
  o = o || {};
  const text = String(o.reconstructed_markdown || walkBlocks(o.text_blocks, 0, []).join('\n')).trim();
  const refs = (o.references || []).map((r) => ({ u: r && r.link, t: (r && (r.title || r.source)) || '' }));
  return { text, cites: dedupe(refs), results: dedupe(refs) };
}
// an `error` on a 200 ("Google hasn't returned any results…") means Google showed no answer — not a failure
export function normAiMode(j) {
  j = j || {};
  const o = normSerpAnswer(j);
  if (j.error && !o.text) return /hasn.?t returned|no results|didn.?t return|not available/i.test(String(j.error)) ? { none: true, note: str(j.error, 200) } : { err: str(j.error, 200) };
  if (!o.text) return { none: true, note: 'Google showed no AI Mode answer' };
  return o;
}
export function normAio(j) {
  const a = (j && j.ai_overview) || null;
  if (!a) return (j && j.error && !/hasn.?t returned|no results/i.test(String(j.error))) ? { err: str(j.error, 200) } : { none: true, note: 'Google showed no AI Overview for this search' };
  const o = normSerpAnswer(a);
  if (a.error && !o.text) return { none: true, note: str(a.error, 200) };
  if (!o.text) return { none: true, note: 'Google showed no AI Overview for this search' };
  return o;
}

// ---- ask one surface ------------------------------------------------------------------------------------------
const RETRY = { 429: 1, 500: 1, 502: 1, 503: 1, 529: 1 };
async function post(fetchFn, url, headers, body) {
  let r = null;
  for (let i = 0; i < 2; i++) {
    r = await fetchFn(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify(body) });
    if (!RETRY[r.status] || i) break;
    await new Promise((res) => setTimeout(res, 2500));
  }
  return r;
}
async function httpErr(r, who) {
  let t = ''; try { t = await r.text(); } catch (e) {}
  let msg = t;
  try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.type || j.error)) || j.message || t; } catch (e) {}
  const hint = r.status === 401 || r.status === 403 ? ' — check the ' + who + ' key' : (r.status === 429 ? ' — rate limited, try fewer at once' : '');
  return 'HTTP ' + r.status + hint + (msg ? ': ' + str(typeof msg === 'string' ? msg : JSON.stringify(msg), 180) : '');
}

// req = { s, q, mkt, now }; emit(event) streams the live moments; resolves to the normalised result
export async function ask(fetchFn, env, req, emit) {
  const say = emit || (() => {});
  const t0 = Date.now();
  const s = req.s, meta = mktMeta(req.mkt), q = str(req.q, 400).trim();
  const def = SURFACES.find((x) => x.k === s);
  const done = (o) => Object.assign({ ok: !o.err, none: !!o.none, err: o.err || null, text: '', cites: [], results: [], searches: [], usage: null, model: modelOf(env, s), stop: null }, o, { ms: Date.now() - t0 });
  if (!def) return done({ err: 'unknown surface' });
  if (!q) return done({ err: 'empty question' });
  if (!env || !env[def.key]) return done({ err: 'not connected — set the ' + def.key + ' Worker secret' });
  try {
    if (s === 'claude') {
      const turns = [], tot = { i: 0, o: 0, ws: 0 };
      let history = [], acc = null;
      for (let loop = 0; loop < 3; loop++) {
        const r = await post(fetchFn, 'https://api.anthropic.com/v1/messages',
          { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, claudeBody(q, meta, env, req.now, history));
        if (!r.ok) return done({ err: await httpErr(r, 'Anthropic') });
        acc = claudeAcc(say);
        const rd = sseReader(acc.on), dec = new TextDecoder();
        if (r.body && r.body.getReader) {
          const reader = r.body.getReader();
          for (;;) { const x = await reader.read(); if (x.done) break; rd.push(dec.decode(x.value, { stream: true })); }
          rd.push(dec.decode()); rd.end();
        } else { rd.push(await r.text()); rd.end(); }
        if (acc.error) return done({ err: 'Claude stream: ' + acc.error });
        turns.push(acc.content());
        tot.i += acc.usage.i || 0; tot.o += acc.usage.o || 0; tot.ws += acc.usage.ws || 0;   // a resumed turn bills again
        // a long search turn can pause — send the paused turn back unchanged and the server resumes it
        if (acc.stop !== 'pause_turn') break;
        say({ t: 'note', d: 'long search — resuming' });
        history = history.concat([{ role: 'assistant', content: acc.content() }]);
      }
      const o = normClaude(turns);
      if (acc.stop === 'refusal') return done(Object.assign(o, { err: 'Claude declined to answer', stop: 'refusal' }));
      return done(Object.assign(o, { stop: acc.stop, model: acc.model || modelOf(env, s), usage: tot }));
    }
    if (s === 'chatgpt') {
      say({ t: 'note', d: 'asking ChatGPT (answers arrive whole)' });
      const r = await post(fetchFn, 'https://api.openai.com/v1/responses', { authorization: 'Bearer ' + env.OPENAI_API_KEY }, openaiBody(q, meta, env, req.now));
      if (!r.ok) return done({ err: await httpErr(r, 'OpenAI') });
      const o = normOpenAI(await r.json());
      (o.searches || []).forEach((x) => say({ t: 'search', q: x }));
      if (o.text) say({ t: 'text', d: o.text });
      return done(o);
    }
    if (s === 'perplexity') {
      say({ t: 'note', d: 'asking Perplexity (answers arrive whole)' });
      const r = await post(fetchFn, 'https://api.perplexity.ai/v1/agent', { authorization: 'Bearer ' + env.PERPLEXITY_API_KEY }, pplxBody(q, meta, env));
      if (!r.ok) return done({ err: await httpErr(r, 'Perplexity') });
      const o = normPerplexity(await r.json());
      (o.searches || []).forEach((x) => say({ t: 'search', q: x }));
      if (o.text) say({ t: 'text', d: o.text });
      return done(o);
    }
    if (s === 'aimode' || s === 'aio') {
      const p = { q, gl: meta.gl, hl: meta.hl, no_cache: 'true' };
      say({ t: 'search', q });
      const r = await fetchFn(serpUrl(s === 'aimode' ? 'google_ai_mode' : 'google', p, env));
      if (!r.ok) return done({ err: await httpErr(r, 'SerpApi') });
      let j = await r.json();
      // an AI Overview can come back as a token only — fetch it NOW, the token lasts about a minute
      if (s === 'aio' && j && j.ai_overview && j.ai_overview.page_token && !(j.ai_overview.text_blocks || []).length) {
        say({ t: 'note', d: 'fetching the AI Overview' });
        const r2 = await fetchFn(serpUrl('google_ai_overview', { page_token: j.ai_overview.page_token }, env));
        if (!r2.ok) return done({ err: await httpErr(r2, 'SerpApi') });
        const j2 = await r2.json();
        j = { ai_overview: j2.ai_overview || null, error: j2.error };
      }
      const o = s === 'aimode' ? normAiMode(j) : normAio(j);
      if (o.results && o.results.length) say({ t: 'sources', n: o.results.length, urls: o.results.slice(0, 10).map((x) => x.u) });
      if (o.text) say({ t: 'text', d: o.text });
      return done(o);
    }
  } catch (e) {
    return done({ err: 'could not reach ' + def.n + ': ' + str((e && e.message) || e, 160) });
  }
  return done({ err: 'unknown surface' });
}

// ---- what the store accepts ----------------------------------------------------------------------------------------
export const QTYPES = ['cat', 'buy', 'brand', 'custom'];
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
function links(list, n) { return (Array.isArray(list) ? list : []).slice(0, n).map((x) => ({ u: str(x && x.u, 500), t: str(x && x.t, 200) })).filter((x) => /^https?:\/\//i.test(x.u)); }
export function sanitizeCell(c) {
  c = c || {};
  const s = SURFACE_KEYS.indexOf(c.s) >= 0 ? c.s : null;
  if (!s) return null;
  const u = c.usage && typeof c.usage === 'object' ? { i: int(c.usage.i, 0, 5e6), o: int(c.usage.o, 0, 5e6), ws: int(c.usage.ws, 0, 99) } : null;
  return {
    qid: str(c.qid, 48), q: str(c.q, 400), type: QTYPES.indexOf(c.type) >= 0 ? c.type : 'custom', s,
    ok: !!c.ok, none: !!c.none, err: c.err ? str(c.err, 200) : null, note: c.note ? str(c.note, 200) : null,
    text: str(c.text, 6000), cites: links(c.cites, 30), results: links(c.results, 40),
    searches: (Array.isArray(c.searches) ? c.searches : []).slice(0, 8).map((x) => str(x, 200)),
    usage: u, model: str(c.model, 48), ms: int(c.ms, 0, 6e5), at: int(c.at, 0, 9e15),
  };
}
export function sanitizeRun(run) {
  run = run || {};
  const id = /^r\d{13}[a-z0-9]{0,6}$/.test(String(run.id || '')) ? String(run.id) : null;
  const mkt = String(run.mkt || '').toLowerCase();
  if (!id || !aivisMarket(mkt)) return null;
  return { v: 1, id, mkt, at: int(run.at, 0, 9e15), final: !!run.final,
    sv: (Array.isArray(run.sv) ? run.sv : []).filter((k) => SURFACE_KEYS.indexOf(k) >= 0).slice(0, SURFACE_KEYS.length),
    cells: (Array.isArray(run.cells) ? run.cells : []).slice(0, 300).map(sanitizeCell).filter(Boolean) };
}
// the run's headline, carried in the KV key's METADATA (≤1 KB) so the history lists with no value reads
export function sanitizeSum(sum) {
  function one(o) { return o && typeof o === 'object' ? { n: int(o.n, 0, 999), a: int(o.a, 0, 999), u: int(o.u, 0, 999), v: num(o.v), s: num(o.s), c: num(o.c), p: num(o.p) } : null; }
  const out = { all: one(sum && sum.all), by: {} };
  SURFACE_KEYS.forEach((k) => { if (sum && sum.by && sum.by[k]) out.by[k] = one(sum.by[k]); });
  return out;
}
export function sanitizeCfg(cfg) {
  cfg = cfg || {};
  const q = {};
  Object.keys(cfg.q || {}).forEach((m) => {
    if (!aivisMarket(m)) return;
    q[m.toLowerCase()] = (Array.isArray(cfg.q[m]) ? cfg.q[m] : []).slice(0, 40).map((x) => ({
      id: str(x && x.id, 48) || ('q' + Math.random().toString(36).slice(2, 9)), q: str(x && x.q, 400).trim(),
      type: QTYPES.indexOf(x && x.type) >= 0 ? x.type : 'custom', on: !(x && x.on === false), src: x && x.src ? str(x.src, 200) : undefined,
    })).filter((x) => x.q);
  });
  const clean = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => str(x, len).trim()).filter(Boolean).slice(0, n);
  return {
    q,
    comps: (Array.isArray(cfg.comps) ? cfg.comps : []).slice(0, 30).map((c) => ({ n: str(c && c.n, 60).trim(), a: clean(c && c.a, 6, 60), d: clean(c && c.d, 6, 120) })).filter((c) => c.n),
    doms: clean(cfg.doms, 10, 120), alias: clean(cfg.alias, 6, 60),
    sv: (Array.isArray(cfg.sv) ? cfg.sv : []).filter((k) => SURFACE_KEYS.indexOf(k) >= 0),
  };
}
