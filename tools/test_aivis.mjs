// AI VISIBILITY harness (pure node, CI-safe). Ray, 29 Sep 2026: "lets build 2 AI Surface visibility
// tracker real-time".
//
// Pins (1) the reading engine (docs/aivis_engine.js) — whose site a cited domain is, which brands an
// answer names and in what order, the three honesty rules (branded questions never count toward
// visibility, a surface that showed no answer is not "not named", cost only where billing is published),
// shopper questions from a product-type tree; (2) the asking half (src/aivis.js) — every surface's
// request shape and its answer normalised from stub responses shaped on each provider's documented
// payload, incl. a Claude stream with a pause_turn and SerpApi's AI Overview page_token; (3) the
// /api/aivis route LIFTED out of worker.js and run against a stub KV (scope, the aivis grant, a run's
// headline in the key's metadata, only the author deletes, the NDJSON stream); (4) the wiring; and
// that no answer, run or question set is committed.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as A from '../cloudflare/feedspark-deck/src/aivis.js';
import { MODULES } from '../cloudflare/feedspark-deck/src/access.js';
import { MIG_SEED } from '../cloudflare/feedspark-deck/src/migration.js';
const require = createRequire(import.meta.url);
const E = require('../docs/aivis_engine.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const WK = read('cloudflare/feedspark-deck/src/worker.js');
const PG = read('docs/FeedSpark_AIVisibility.html');
let pass = 0, fail = 0;
const t = (n, ok, why) => { if (ok) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (why ? ' — ' + why : '')); } };

console.log('· domains — whose site a cited source is');
t('hostOf drops scheme, www and port', E.hostOf('https://www.schuh.co.uk:443/mens/?x=1') === 'schuh.co.uk' && E.hostOf('uk.accessorize.com/bags') === 'uk.accessorize.com');
t('regDomain knows a two-level suffix', E.regDomain('shop.schuh.co.uk') === 'schuh.co.uk' && E.regDomain('uk.accessorize.com') === 'accessorize.com' && E.regDomain('www.petsathome.com') === 'petsathome.com');
t('cleanUrl strips ChatGPT / Google tracking, keeps the rest', E.cleanUrl('https://reiss.com/p/1?utm_source=chatgpt.com&colour=navy&srsltid=AB#top') === 'https://reiss.com/p/1?colour=navy');
const ctx = E.brandCtx('Reiss', { comps: [{ n: 'Whistles' }, { n: 'Me+Em', d: ['meandem.com'] }, { n: 'Next' }, { n: 'Abercrombie & Fitch' }], domains: ['reiss-outlet.com'] });
t('a domain named after the brand is its own site with no setup', E.classify('https://www.reiss.com/gb/en/p/1', ctx) === 'own' && E.classify('reiss.de', ctx) === 'own');
t('a configured domain is own too', E.classify('https://reiss-outlet.com/x', ctx) === 'own');
t('a competitor by name slug or by its listed domain', E.classify('whistles.com', ctx) === 'comp' && E.classify('https://www.meandem.com/', ctx) === 'comp');
t('retailer / publisher / forum / review / reference classes', E.classify('amazon.co.uk', ctx) === 'retail' && E.classify('vogue.co.uk', ctx) === 'press' && E.classify('reddit.com', ctx) === 'social' && E.classify('uk.trustpilot.com', ctx) === 'review' && E.classify('en.wikipedia.org', ctx) === 'ref');
t('anything else is "other" — never guessed into a class', E.classify('somerandomblog.net', ctx) === 'other');

console.log('· names in an answer');
const txt = 'For cashmere, **Whistles** is great value. Reiss has the Albany jumper; Me+Em and Abercrombie and Fitch also do well. Shop next season at Next.';
const men = E.mentions(txt, ctx);
t('every tracked brand, in the order it is FIRST named', men.map((m) => m.n).join('|') === 'Whistles|Reiss|Me+Em|Abercrombie & Fitch|Next', men.map((m) => m.n).join('|'));
t('rank = position among the tracked brands named', men.find((m) => m.own).rank === 2);
t('"&" matches "and"', men.some((m) => m.n === 'Abercrombie & Fitch'));
t('a common-word brand only counts capitalised ("next season" is not Next)', E.mentions('Buy it next week.', ctx).length === 0 && E.mentions('Buy it at Next.', ctx).length === 1);
t('a name inside another word is not a mention', E.mentions('Reissue the order', ctx).length === 0);
t('the brand\'s own domain in the text reads as a mention', E.mentions('see reiss.com for sizes', ctx).some((m) => m.own));
t('a question naming the brand is BRANDED', E.isBranded('Is Reiss good for suits?', ctx) && !E.isBranded('Best suits in the UK?', ctx) && E.isBranded({ q: 'x', type: 'brand' }, ctx));
const cands = E.candidates('1. **Hobbs** – classic.\n2. **Jigsaw**: modern cuts.\n- **Best overall**: Reiss\n**Whistles** again\n3. Boden - bright prints.', ctx);
t('untracked brand-looking names from bold and list heads', cands.indexOf('Hobbs') >= 0 && cands.indexOf('Jigsaw') >= 0 && cands.indexOf('Boden') >= 0);
t('tracked names and heading words are not candidates', cands.indexOf('Whistles') < 0 && cands.indexOf('Reiss') < 0 && cands.indexOf('Best overall') < 0);

console.log('· one answer, then a run — the honesty rules');
const cell = (s, q, text, cites, o) => Object.assign({ s, q, qid: 'q' + q.length, type: 'cat', ok: true, text, cites: cites || [], results: [] }, o || {});
const cells = [
  cell('claude', 'Best cashmere jumpers UK?', 'Try Whistles, then Reiss.', [{ u: 'https://www.reiss.com/p/1', t: 'Reiss' }, { u: 'https://vogue.co.uk/a' }]),
  cell('claude', 'Best wool coats UK?', 'Whistles and Hobbs lead.', [{ u: 'https://whistles.com/c' }], { results: [{ u: 'https://reiss.com/coats' }] }),
  cell('chatgpt', 'Best cashmere jumpers UK?', 'Reiss is the pick.', [{ u: 'https://amazon.co.uk/x' }]),
  cell('chatgpt', 'Is Reiss good quality?', 'Reiss is well made.', [{ u: 'https://reiss.com/about' }], { type: 'brand' }),
  cell('aio', 'Best wool coats UK?', '', [], { none: true, note: 'Google showed no AI Overview' }),
  cell('perplexity', 'Best wool coats UK?', '', [], { ok: false, err: 'HTTP 429' }),
];
const an = cells.map((c) => E.analyse(c, ctx));
t('named, position and own-site citation read off one answer', an[0].named && an[0].pos === 2 && an[0].ownCited && an[0].of === 2);
t('a site READ but not cited is told apart', !an[1].ownCited && an[1].ownSeen && !an[1].named);
t('a branded question is marked branded', an[3].branded && an[3].ownCited);
const sm = E.summarise(an, ctx);
t('visibility counts UNBRANDED answers only (2 of 3)', sm.all.u === 3 && sm.all.named === 2 && sm.all.vis === 66.7, JSON.stringify(sm.all));
t('no AI answer and a failure are out of every rate, counted apart', sm.all.n === 6 && sm.all.ans === 4 && sm.all.none === 1 && sm.all.err === 1);
t('own site cited over every answer, branded included (2 of 4)', sm.all.cited === 2 && sm.all.cite === 50);
t('share of voice = the brand\'s mentions over every tracked brand\'s (2 of 4)', sm.all.sov === 50, String(sm.all.sov));
t('average position when named', sm.all.pos === 1.5);
t('per surface too', sm.by.claude.vis === 50 && sm.by.chatgpt.vis === 100 && sm.by.aio.none === 1 && sm.by.perplexity.err === 1);
t('brands table carries the tracked brand even at zero', sm.brands[0].own === false || sm.brands.some((b) => b.own && b.u === 2));
t('domains ranked by answers citing them', sm.doms[0].cited >= sm.doms[sm.doms.length - 1].cited && sm.doms.some((d) => d.h === 'reiss.com' && d.cls === 'own'));
const cp = E.compact(sm);
t('the stored headline is small — five surfaces fit KV metadata', JSON.stringify(A.sanitizeSum(Object.assign({}, cp, { by: { claude: cp.by.claude, chatgpt: cp.by.chatgpt, aio: cp.by.aio, perplexity: cp.by.perplexity, aimode: cp.by.claude } }))).length < 700);

console.log('· products — a cited product page, or a product named by its own title');
const idx = E.prodIndex([{ id: 'A1', t: 'Reiss Albany Cashmere Crew Neck Jumper Navy', l: 'https://www.reiss.com/gb/en/p/albany-navy/A1/' }, { id: 'B2', t: 'Reiss Tux Wool Blazer', l: 'https://www.reiss.com/p/tux/B2' }], ctx);
const ph = E.prodHits({ text: 'The albany cashmere crew is lovely.', cites: [{ u: 'https://reiss.com/p/tux/B2?utm_source=chatgpt.com' }] }, idx, ctx);
t('a cited product page matches on its path, tracking stripped', ph.some((p) => p.id === 'B2' && p.how === 'linked'));
t('a product named by its title core (brand removed, 3 words)', ph.some((p) => p.id === 'A1' && p.how === 'named'));
t('no feed index, no product claims', E.prodHits({ text: 'x' }, null, ctx).length === 0);

console.log('· shopper questions from the product-type tree');
const pt = [['Women > Knitwear > Cashmere Jumpers', 900], ['Men > Suits', 800], ['Women > Dresses > All', 700], ['Women > Knitwear > Cashmere Jumpers > Sale', 10], ['Accessories > Bags', 300], ['Reiss', 5]];
const qs = E.suggestQueries(pt, ctx, A.MARKETS.gb, 4);
t('leaf phrase takes the gender from the path', qs[0].q === "What are the best women's cashmere jumpers to buy online in the UK?", qs[0].q);
t('a generic leaf ("All") falls back to its parent', qs.some((q) => /women's dresses/.test(q.q)));
t('an acronym survives lower-casing', E.leafPhrase('Men > T-Shirts > UGG Boots') === "men's UGG boots");
t('a duplicate phrase is asked once', qs.filter((q) => /cashmere jumpers/.test(q.q) && q.type !== 'brand').length === 1);
t('every third question asks where to buy', qs[2].type === 'buy' && /Where is the best place to buy/.test(qs[2].q));
t('two BRANDED questions close the set — the second against the first competitor', qs.filter((q) => q.type === 'brand').length === 2 && qs.some((q) => /Reiss or Whistles/.test(q.q)));
const de = E.suggestQueries([['Damen > Schuhe > Sneaker', 50]], E.brandCtx('Schuh'), A.MARKETS.de, 2);
t('a German market is asked in German', /^Was sind die besten Damen Sneaker, die man in Deutschland online kaufen kann\?$/.test(de[0].q), de[0].q);
t('no tree = only the branded questions', E.suggestQueries([], ctx, A.MARKETS.gb, 4).every((q) => q.type === 'brand'));

console.log('· cost — only where the billing is published');
t('Claude at list price + $10 per 1,000 searches', E.costOf('claude', { i: 20000, o: 1500, ws: 2 }, 'claude-opus-5-5') === 0.13);
t('every other surface: no guessed price', E.costOf('chatgpt', { i: 1, o: 1 }) === null && E.costOf('aio', null) === null);
t('starter competitor lists exist for the roster brands, as plain names', E.compSeed('House of Bruar').length > 3 && E.compSeed('Unknown Co').length === 0);

console.log('· the asking half — request shapes');
const SECRET = 'sk-test-7f3a9c';
const env = { ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: SECRET, PERPLEXITY_API_KEY: SECRET, SERPAPI_KEY: SECRET };
const cb = A.claudeBody('q', A.MARKETS.gb, {}, Date.UTC(2026, 8, 29));
t('Claude: web_search_20260209 called directly, capped, located in the market', cb.tools[0].type === 'web_search_20260209' && cb.tools[0].allowed_callers[0] === 'direct' && cb.tools[0].max_uses === 4 && cb.tools[0].user_location.country === 'GB' && cb.tools[0].user_location.type === 'approximate');
t('Claude: the current model, streamed, effort set explicitly', cb.model === 'claude-opus-5-5' && cb.stream === true && cb.output_config.effort === 'low' && !('thinking' in cb) && /2026-09-29/.test(cb.system));
t('a model override needs no redeploy', A.claudeBody('q', A.MARKETS.gb, { AIVIS_CLAUDE_MODEL: 'claude-sonnet-5-5' }).model === 'claude-sonnet-5-5');
t('no country (eu) = no location sent', !A.claudeBody('q', A.MARKETS.eu, {}).tools[0].user_location);
const ob = A.openaiBody('q', A.MARKETS.gb, {});
t('ChatGPT: the location is ALWAYS sent (it falls back to the US)', ob.tools[0].type === 'web_search' && ob.tools[0].user_location.country === 'GB' && ob.tool_choice === 'required' && ob.include[0] === 'web_search_call.action.sources');
const pb = A.pplxBody('q', A.MARKETS.de, {});
t('Perplexity: the Agent API with its web search tool', pb.model === 'perplexity/sonar' && pb.tools[0].type === 'web_search' && pb.tools[0].user_location.country === 'DE');
t('SerpApi: gl + hl from the market, never cached', /engine=google_ai_mode/.test(A.serpUrl('google_ai_mode', { q: 'x', gl: 'uk', hl: 'en', no_cache: 'true' }, env)) && /gl=uk/.test(A.serpUrl('google_ai_mode', { gl: 'uk' }, env)));
t('surface status names the secret, never its value', A.surfaceStatus(env).every((s) => s.on && s.key && JSON.stringify(s).indexOf(SECRET) < 0) && A.surfaceStatus({}).every((s) => !s.on));
t('a Meta catalogue market is refused', !A.aivisMarket('gb-fb') && A.aivisMarket('gb') && A.aivisMarket('befr') && !A.aivisMarket('zz'));

console.log('· the asking half — each surface answered from stub responses');
const sse = (events) => events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join('');
const streamOf = (text, cut) => new ReadableStream({ start(c) { const b = new TextEncoder().encode(text); const n = cut || 97; for (let i = 0; i < b.length; i += n) c.enqueue(b.slice(i, i + n)); c.close(); } });
const CLAUDE_TURN = (stop, extra) => sse([
  { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 1200 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: "I'll search for that." } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"best cash' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'mere jumpers uk"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://www.reiss.com/p/1', title: 'Reiss', encrypted_content: 'x' }, { type: 'web_search_result', url: 'https://vogue.co.uk/a', title: 'Vogue', encrypted_content: 'y' }] } },
  { type: 'content_block_stop', index: 2 },
  { type: 'content_block_start', index: 3, content_block: { type: 'text', text: '', citations: null } },
  { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Reiss makes a lovely jumper' } },
  { type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://www.reiss.com/p/1', title: 'Reiss', encrypted_index: 'e', cited_text: '…' } } },
  { type: 'content_block_stop', index: 3 },
].concat(extra || [], [{ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 300, server_tool_use: { web_search_requests: 1 } } }, { type: 'message_stop' }]));
function stubFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = routes.shift();
    if (!r) throw new Error('no stub for ' + url);
    if (r.throw) throw new Error(r.throw);
    if (r.sse != null) return new Response(streamOf(r.sse), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    return new Response(typeof r.json === 'string' ? r.json : JSON.stringify(r.json), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls;
  return f;
}
const evs = [];
let f = stubFetch([{ sse: CLAUDE_TURN('end_turn') }]);
let r = await A.ask(f, env, { s: 'claude', q: 'Best cashmere jumpers UK?', mkt: 'gb' }, (e) => evs.push(e));
t('Claude stream: the answer is the text AFTER the first search, not the preamble', r.ok && r.text === 'Reiss makes a lovely jumper', r.text);
t('Claude stream: cites from citations_delta, results from the search block, the query from input_json_delta', r.cites.length === 1 && r.cites[0].u === 'https://www.reiss.com/p/1' && r.results.length === 2 && r.searches[0] === 'best cashmere jumpers uk');
t('Claude stream: usage incl. web searches', r.usage.i === 1200 && r.usage.o === 300 && r.usage.ws === 1);
t('Claude stream: live moments emitted in order — search, sources, text', evs.map((e) => e.t).filter((x, i, a) => a.indexOf(x) === i).join(',') === 'text,search,sources' && evs.some((e) => e.t === 'search' && e.q === 'best cashmere jumpers uk'));
f = stubFetch([{ sse: CLAUDE_TURN('pause_turn') }, { sse: sse([{ type: 'message_start', message: { usage: { input_tokens: 1500 } } }, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' and Whistles too.' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 40 } }]) }]);
r = await A.ask(f, env, { s: 'claude', q: 'q', mkt: 'gb' });
const cont = f.calls[1].body.messages;
t('pause_turn: the paused turn goes back UNCHANGED — search result encrypted_content, citations and all', cont.length === 2 && cont[1].role === 'assistant' && cont[1].content[2].content[0].encrypted_content === 'x' && cont[1].content[3].citations.length === 1 && cont[1].content[1].input.query === 'best cashmere jumpers uk');
t('pause_turn: the answer joins both turns and the usage sums', r.text === 'Reiss makes a lovely jumper and Whistles too.' && r.usage.i === 2700 && r.usage.o === 340, r.text + ' ' + JSON.stringify(r.usage));
f = stubFetch([{ sse: CLAUDE_TURN('refusal') }]);
r = await A.ask(f, env, { s: 'claude', q: 'q', mkt: 'gb' });
t('a refusal is a failed answer that says so', !r.ok && /declined/.test(r.err));
f = stubFetch([{ status: 401, json: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
r = await A.ask(f, env, { s: 'claude', q: 'q', mkt: 'gb' });
t('an HTTP error names the key to check', !r.ok && /HTTP 401 — check the Anthropic key/.test(r.err) && /invalid x-api-key/.test(r.err));
r = await A.ask(stubFetch([]), {}, { s: 'claude', q: 'q', mkt: 'gb' });
t('no secret = "not connected", and nothing is called', !r.ok && /not connected — set the ANTHROPIC_API_KEY/.test(r.err));
f = stubFetch([{ json: { status: 'completed', output: [
  { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'best cashmere uk', sources: [{ type: 'url', url: 'https://www.reiss.com/a' }, { type: 'url', url: 'https://hobbs.com/b' }] } },
  { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url: 'https://www.reiss.com/a' } },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Reiss and Hobbs.', annotations: [{ type: 'url_citation', url: 'https://www.reiss.com/a?utm_source=openai', title: 'Reiss', start_index: 0, end_index: 5 }] }] }],
  usage: { input_tokens: 900, output_tokens: 120 } } }]);
r = await A.ask(f, env, { s: 'chatgpt', q: 'q', mkt: 'gb' });
t('ChatGPT: the message item, not the first output item; url_citation annotations', r.ok && r.text === 'Reiss and Hobbs.' && r.cites.length === 1 && r.results.length === 2 && r.searches[0] === 'best cashmere uk');
t('ChatGPT: posted with the bearer key to /v1/responses', f.calls[0].url === 'https://api.openai.com/v1/responses' && f.calls[0].init.headers.authorization === 'Bearer ' + SECRET);
r = A.normOpenAI({ status: 'failed', error: { message: 'model overloaded' }, output: [] });
t('ChatGPT: a failure in the body is a failure', !!r.err && /overloaded/.test(r.err));
f = stubFetch([{ json: { status: 'completed', output: [
  { type: 'search_results', queries: ['best wool coats uk'], results: [{ id: 1, url: 'https://whistles.com/c', title: 'Whistles' }, { id: 2, url: 'https://reiss.com/c', title: 'Reiss' }, { id: 3, url: 'https://x.com/z', title: 'X' }] },
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Whistles [1] and Reiss [web:2].', annotations: [] }] }] } }]);
r = await A.ask(f, env, { s: 'perplexity', q: 'q', mkt: 'gb' });
t('Perplexity: [n] and [web:n] markers map to the results they cite', r.ok && r.cites.length === 2 && r.cites[1].u === 'https://reiss.com/c' && r.results.length === 3 && f.calls[0].url === 'https://api.perplexity.ai/v1/agent');
r = A.normPerplexity({ output: [{ type: 'search_results', results: [{ id: 1, url: 'https://a.com' }] }, { type: 'message', content: [{ type: 'output_text', text: 'no markers' }] }] });
t('Perplexity: no markers = the results it was written from are its sources', r.cites.length === 1);
f = stubFetch([{ json: { search_metadata: { status: 'Success' }, text_blocks: [{ type: 'heading', snippet: 'Top picks' }, { type: 'list', list: [{ title: 'Reiss', snippet: 'tailoring', list: [{ snippet: 'nested' }] }] }], references: [{ title: 'Reiss', link: 'https://reiss.com/x', source: 'Reiss', index: 0 }] } }]);
r = await A.ask(f, env, { s: 'aimode', q: 'q', mkt: 'gb' });
t('AI Mode: nested text_blocks walked in order, references are the sources', r.ok && /Top picks/.test(r.text) && /- Reiss: tailoring/.test(r.text) && /nested/.test(r.text) && r.cites[0].u === 'https://reiss.com/x' && /no_cache=true/.test(f.calls[0].url));
r = A.normAiMode({ search_metadata: { status: 'Success' }, error: "Google hasn't returned any results for this query." });
t('AI Mode: an "error" on a 200 that says Google showed nothing is NO ANSWER, not a failure', r.none && !r.err);
f = stubFetch([{ json: { ai_overview: { page_token: 'tok', serpapi_link: 'x' } } }, { json: { ai_overview: { text_blocks: [{ type: 'paragraph', snippet: 'Whistles is popular.' }], references: [{ link: 'https://whistles.com/a', title: 'W' }] } } }]);
r = await A.ask(f, env, { s: 'aio', q: 'q', mkt: 'gb' });
t('AI Overview: a token-only overview is fetched straight away with google_ai_overview', r.ok && r.text === 'Whistles is popular.' && /engine=google_ai_overview/.test(f.calls[1].url) && /page_token=tok/.test(f.calls[1].url));
r = await A.ask(stubFetch([{ json: { organic_results: [] } }]), env, { s: 'aio', q: 'q', mkt: 'gb' });
t('AI Overview: no overview on the page = no answer', r.ok && r.none && /no AI Overview/.test(r.note));
r = await A.ask(stubFetch([{ throw: 'socket hang up' }]), env, { s: 'chatgpt', q: 'q', mkt: 'gb' });
t('a network failure is a failed answer, never a thrown error', !r.ok && /could not reach ChatGPT/.test(r.err));

console.log('· what the store accepts');
t('a run needs a well-formed id and a Google Shopping market', !A.sanitizeRun({ id: 'x', mkt: 'gb' }) && !A.sanitizeRun({ id: 'r1759000000000ab', mkt: 'gb-fb' }) && !!A.sanitizeRun({ id: 'r1759000000000ab', mkt: 'gb', cells: [] }));
const sc = A.sanitizeCell({ s: 'claude', q: 'q'.repeat(900), text: 't'.repeat(9000), cites: Array(40).fill({ u: 'https://a.com', t: 'x' }).concat([{ u: 'javascript:alert(1)' }]), usage: { i: 1e9 } });
t('a cell is clamped: question 400, answer 6000, 30 cites, only http(s) links, usage bounded', sc.q.length === 400 && sc.text.length === 6000 && sc.cites.length === 30 && sc.usage.i === 5e6);
t('an unknown surface is dropped', A.sanitizeCell({ s: 'bing' }) === null);
const cfg = A.sanitizeCfg({ q: { gb: [{ q: ' hi ', type: 'zzz' }, { q: '' }], 'gb-fb': [{ q: 'x' }] }, comps: [{ n: 'Hobbs', d: ['hobbs.com'] }, { n: '' }], sv: ['claude', 'bing'] });
t('the setup is clamped: questions per real market, types from the list, empty rows gone', cfg.q.gb.length === 1 && cfg.q.gb[0].q === 'hi' && cfg.q.gb[0].type === 'custom' && !cfg.q['gb-fb'] && cfg.comps.length === 1 && cfg.sv.join() === 'claude');

console.log('· the route — lifted out of worker.js, run against a stub KV');
const start = WK.indexOf("    if (path === '/api/aivis' || path.startsWith('/api/aivis/')) {");
let depth = 0, end = -1;
for (let i = WK.indexOf('{', start); i < WK.length; i++) { const ch = WK[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } } }
t('the route block is found', start > 0 && end > start);
const block = WK.slice(start, end);
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const routeFn = new AsyncFn('path', 'url', 'request', 'env', 'ctx', 'accessOf', 'clientMatch', 'moduleAllowed', 'feedRoster', 'json', 'who', 'logActivity', 'AIVIS', 'CORS', 'fetch', block + '\nreturn null;');
function kvStub() {
  const m = new Map();
  return { m,
    async get(k, type) { const v = m.get(k); if (!v) return null; return type === 'json' ? JSON.parse(v.value) : v.value; },
    async put(k, value, o) { m.set(k, { value, metadata: (o && o.metadata) || null }); },
    async delete(k) { m.delete(k); },
    async list({ prefix, limit }) { const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit || 1000).map((name) => ({ name, metadata: m.get(name).metadata })); return { keys, list_complete: true }; } };
}
const jsonR = (d, s) => new Response(JSON.stringify(d), { status: s || 200, headers: { 'content-type': 'application/json' } });
const KV = kvStub(), logs = [];
async function call(method, p, body, who0, acc0, fetch0) {
  const url = new URL('https://x' + p);
  const request = new Request(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } });
  const acc = acc0 || { owner: true, clients: null, modules: null };
  const ctxs = { waits: [], waitUntil(p) { this.waits.push(p); } };
  const res = await routeFn(url.pathname, url, request, Object.assign({ EDITS: KV }, env), ctxs, async () => acc, (cl, n) => !cl || cl.indexOf(n) >= 0,
    (mods, s) => !mods || mods.indexOf(s) >= 0, async () => [{ client: 'Reiss', mkt: 'gb' }, { client: 'Reiss', mkt: 'gb-fb' }, { client: 'Schuh', mkt: 'gb' }, { client: 'Schuh', mkt: 'de' }],
    jsonR, () => who0 || 'ray@feedspark.com', (c, e, rq, a, d) => logs.push(a + ' ' + (d || '')), A, {}, fetch0 || stubFetch([]));
  return { res, ctxs };
}
let { res } = await call('GET', '/api/aivis');
let d = await res.json();
t('GET: surfaces (names only), markets, brands with their Google markets — Meta left out', d.ok && d.surfaces.length === 5 && d.brands.length === 2 && d.brands[0].markets.join() === 'gb' && d.brands[1].markets.join() === 'gb,de' && !JSON.stringify(d).includes(SECRET));
const run = { id: 'r1759140000000abcd', at: 1759140000000, mkt: 'gb', sv: ['claude'], final: true, cells: [cells[0]] };
({ res } = await call('PUT', '/api/aivis/run?client=Reiss', { run, sum: E.compact(E.summarise([an[0]], ctx)) }, 'steven@feedspark.com'));
d = await res.json();
const stored = KV.m.get('aivisrun:Reiss:r1759140000000abcd');
t('PUT run: stored under aivisrun:<client>:<id>, the headline in the key\'s METADATA', d.ok && stored && stored.metadata.sum.all.v === 100 && stored.metadata.by === 'steven@feedspark.com' && stored.metadata.f === 1 && JSON.stringify(stored.metadata).length <= 1000);
t('PUT run: a final run is logged once as activity', logs.some((l) => /^aivis-run Reiss GB · 1 answers/.test(l)));
({ res } = await call('GET', '/api/aivis?client=Reiss'));
d = await res.json();
t('GET client: history from the key list (no value reads) + the latest run in full', d.runs.length === 1 && d.runs[0].sum.all.v === 100 && d.last && d.last.id === run.id && d.cfg === null);
({ res } = await call('GET', '/api/aivis'));
d = await res.json();
t('GET: a brand carries its last run for the brand picker', d.brands[0].last && d.brands[0].last.id === run.id && d.brands[0].runs === 1);
({ res } = await call('DELETE', '/api/aivis/run?client=Reiss&run=' + run.id, null, 'dino@feedspark.com', { owner: false, clients: null, modules: null }));
t('DELETE: only the person who ran it (or the owner) removes a run', res.status === 403 && KV.m.has('aivisrun:Reiss:' + run.id));
({ res } = await call('DELETE', '/api/aivis/run?client=Reiss&run=' + run.id, null, 'steven@feedspark.com', { owner: false, clients: null, modules: null }));
t('DELETE: the author can', res.status === 200 && !KV.m.has('aivisrun:Reiss:' + run.id));
({ res } = await call('GET', '/api/aivis?client=Schuh', null, 'x@feedspark.com', { owner: false, clients: ['Reiss'], modules: null }));
t('scope: a client outside the signin\'s scope is refused', res.status === 403);
({ res } = await call('PUT', '/api/aivis?client=Reiss', { cfg: { q: { gb: [{ q: 'hi' }] } } }, 'x@feedspark.com', { owner: false, clients: null, modules: ['workflow'] }));
t('grant: saving without the aivis grant is refused (asking spends money)', res.status === 403);
({ res } = await call('PUT', '/api/aivis?client=Reiss', { cfg: { q: { gb: [{ q: 'hi' }] }, comps: [{ n: 'Hobbs' }] } }));
t('PUT setup: sanitized and stamped', res.status === 200 && JSON.parse(KV.m.get('aiviscfg:Reiss').value).comps[0].n === 'Hobbs' && JSON.parse(KV.m.get('aiviscfg:Reiss').value).by === 'ray@feedspark.com');
({ res } = await call('POST', '/api/aivis/ask', { client: 'Reiss', market: 'gb-fb', s: 'claude', q: 'x' }));
t('ask: a Meta market is refused before anything is asked', res.status === 400);
({ res } = await call('POST', '/api/aivis/ask', { client: 'Schuh', market: 'gb', s: 'claude', q: 'x' }, 'x@feedspark.com', { owner: false, clients: ['Reiss'], modules: null }));
t('ask: out of scope is refused', res.status === 403);
const askFetch = stubFetch([{ sse: CLAUDE_TURN('end_turn') }]);
let ctxs;
({ res, ctxs } = await call('POST', '/api/aivis/ask', { client: 'Reiss', market: 'gb', s: 'claude', q: 'Best cashmere jumpers UK?' }, null, null, askFetch));
const body = await res.text();
await Promise.all(ctxs.waits);
const lines = body.trim().split('\n').map((l) => JSON.parse(l));
t('ask: streamed as NDJSON — start, the live moments, then done with the normalised answer', /ndjson/.test(res.headers.get('content-type')) && lines[0].t === 'start' && lines[0].model === 'claude-opus-5-5' && lines.some((l) => l.t === 'search') && lines[lines.length - 1].t === 'done' && lines[lines.length - 1].r.text === 'Reiss makes a lovely jumper');
t('ask: the question reached Claude with the market\'s location', askFetch.calls[0].body.tools[0].user_location.country === 'GB' && askFetch.calls[0].body.messages[0].content === 'Best cashmere jumpers UK?');

console.log('· wiring');
t('worker imports the page, the engine and src/aivis.js', /import AIVIS_PAGE from "..\/..\/..\/docs\/FeedSpark_AIVisibility.html"/.test(WK) && /import AIVIS_ENGINE_SRC from "..\/..\/..\/docs\/aivis_engine.js"/.test(WK) && /import \* as AIVIS from ".\/aivis.js"/.test(WK));
t('page route + engine route', /'\/aivis':\s+\{ html: AIVIS_PAGE, slug: 'aivis' \}/.test(WK) && /path === '\/aivis\/engine.js'/.test(WK));
t('grantable module + migration seed + roadmap twin', MODULES.some((m) => m.slug === 'aivis' && m.path === '/aivis') && MIG_SEED.some((m) => m.p === '/aivis') && /\{p:'\/aivis',n:'AI visibility'/.test(read('docs/FeedSpark_Transformation.html')));
t('the engine is served as text (the *_engine.js rule)', /\*\*\/\*_engine\.js/.test(read('wrangler.toml')));
t('every nav carries the AI visibility link; this page marks it on', /href="\/aivis" class="tbm on"/.test(PG) && /href="\/aivis" class="tbm"/.test(read('docs/FeedSpark_Workflow.html')));
t('the page loads its engine by fetch (tripwires can hand it over) and asks through the stream', /loadEngine\('\/aivis\/engine\.js', 'AIVis'/.test(PG) && /fetch\('\/api\/aivis\/ask'/.test(PG) && /getReader\(\)/.test(PG));
t('the page runs with bounded concurrency, per surface too', /var CONC = 4, PER_SURFACE = 2/.test(PG));
t('a big run asks first, with Claude\'s planning cost', /n > BIG_RUN && !confirm\(/.test(PG) && /CLAUDE_TYPICAL/.test(PG));
t('the page loads the shared stylesheet', /<link rel="stylesheet" href="\/design\/fcc.css">/.test(PG));
t('a hover-free answer drawer that closes on Esc and becomes a sheet on a phone', /id="ap"/.test(PG) && /e.key === 'Escape' && S.sel >= 0/.test(PG) && /@media\(max-width:760px\)\{\s*\.ap\{top:auto/.test(PG));

console.log('· no client data in git');
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n');
t('no stored run or answer file is committed', !tracked.some((f) => /aivis/i.test(f) && /\.json$/.test(f)));
t('the engine and the adapters carry no answer text or figures of a real run', !/aivisrun:[A-Z]/.test(read('docs/aivis_engine.js')) && !/"text":/.test(read('cloudflare/feedspark-deck/src/aivis.js')));

console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' assertions' + (fail ? ', ' + fail + ' failed' : ''));
process.exit(fail ? 1 : 0);
