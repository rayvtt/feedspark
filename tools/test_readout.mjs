#!/usr/bin/env node
/*
 * READ-OUT EXTRACTION — one corpus, BOTH copies (Ray, 21 Sep 2026: Vimalesh answered the Silk
 * brief REIS-20260811-02 on its own thread — "Impressions: 4.63% Increase / Clicks: 5.18%
 * Increase" — and asked for the result on the Keywords Calendar and in Intake).
 *
 * The worker (briefmatch.js › extractResult) and the Workflow page (extractResultTxt) each
 * carry the extractor: the worker runs it on the Gmail push, the page runs it when a result
 * email is pasted into the update router. They must answer identically or the same email
 * files differently depending on which door it came through. This lifts the page's copy out
 * of the HTML by name and asserts parity across the corpus.
 *
 * Nothing covered this function before, which is how a read-out that silently dropped half its
 * figures reached the Brief Ledger. Wired into qa_gate, presync and validate.yml.
 */
import { readFileSync } from 'node:fs';
import { extractResult } from '../cloudflare/feedspark-deck/src/briefmatch.js';

const html = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
function liftPage() {
  const at = html.indexOf('  function extractResultTxt(text){');
  if (at < 0) throw new Error('could not find extractResultTxt in the page');
  // brace-match from the function's opening {
  let i = html.indexOf('{', at), depth = 0, end = -1;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('could not brace-match extractResultTxt');
  return html.slice(at, end);
}
const extractResultTxt = new Function(`${liftPage()} return extractResultTxt;`)();

// the REAL email, as Vimalesh sent it and as Gmail's push collapses it
const SILK = `The optimised SKUs results:
  • Impressions: 4.63% Increase
  • Clicks: 5.18% Increase

Traffic   Before live 09/08/2026 - 29/08/2026   After live 30/08/2026 - 19/09/2026
Impr      615,205     643,674     4.63%
Clicks    13,351      14,043

These results demonstrate as adding Keywords to the feeds is triggering higher exposure of the
products. Please let us know if you have any questions or need further information.`;

const CASES = [
  // the specimen this exists for — both figures, both labelled
  ['the Silk read-out as sent', SILK, '+4.63% impressions · +5.18% clicks'],
  ['…and as Gmail collapses it', SILK.replace(/\s+/g, ' '), '+4.63% impressions · +5.18% clicks'],
  // the heading "…results:" must not short-circuit and swallow the rest
  ['a results heading alone never wins', 'Please find the results:\n• Clicks: 2% increase',
    '+2% clicks'],
  // the prose house style ASPL also uses — must not regress
  ['prose house style', 'We saw a 15.35% uplift in impressions and a 13.4% uplift in clicks.',
    '+15.35% impressions · +13.4% clicks'],
  ['uplift-of form', 'an uplift of 9.55% in impressions', '+9.55% impressions'],
  ['a decline keeps its sign', 'Clicks: 3.2% decrease', '-3.2% clicks'],
  ['the same figure seen twice reports once, labelled',
    'Impressions: 4% increase. Later: a 4% increase was recorded.', '+4% impressions'],
  // prose fallbacks, unchanged
  ['no-figure read-out falls back to prose', 'Result: no lift — rolled back', 'no lift — rolled back'],
  ['explicit Result: with a bare %', 'Result: +12% CTR', '+12% CTR'],
  ['a no-lift call still reads', 'We saw no significant change in CTR this period',
    'no significant change in CTR this period'],
  // a bare % is never a result
  ['a bare % never counts', 'we tested 50% of the range', ''],
  ['an empty body is not a result', '', ''],
];

let pass = 0; const fails = [];
for (const [name, text, want] of CASES) {
  const w = extractResult(text), p = extractResultTxt(text);
  if (w !== want) fails.push(`${name}\n      worker got  ${JSON.stringify(w)}\n      want        ${JSON.stringify(want)}`);
  else if (p !== w) fails.push(`${name} — PAGE DISAGREES\n      worker ${JSON.stringify(w)}\n      page   ${JSON.stringify(p)}`);
  else { pass++; console.log('  ✓ ' + name); }
}
console.log(fails.length ? `\n${pass} passed, ${fails.length} failed` : `\n${pass} passed, 0 failed`);
fails.forEach((f) => console.log('  ✗ ' + f));
if (fails.length) process.exit(1);
console.log('PASS');
