#!/usr/bin/env node
/*
 * Reply classifier — one corpus, BOTH copies (Ray, 11 Sep 2026: "when Dinesh said 'we will do
 * the needful and update you' … it means the ticket has been picked up and is in progress").
 * The worker (briefmatch.js) and the Workflow page each carry the classifier; this test lifts
 * the page's copy out of the HTML by name and asserts it answers identically to the module's,
 * so the two can never drift. Wired into qa_gate, presync and validate.yml.
 */
import { readFileSync } from 'node:fs';
import { classifyReply as workerClassify } from '../cloudflare/feedspark-deck/src/briefmatch.js';

const html = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
const lift = (name, kind) => {
  const re = kind === 'var'
    ? new RegExp('\\n\\s*var ' + name + '=(/[\\s\\S]*?/i);')
    : new RegExp('\\n\\s*function ' + name + '\\([\\s\\S]*?\\n  \\}');
  const m = re.exec(html);
  if (!m) throw new Error('could not lift ' + name + ' out of the page');
  return m[0];
};
const pageSrc = ['DONE_WORD_RE', 'SUBCONJ_RE', 'NEAR_FUT_RE', 'ACK_RE'].map((n) => lift(n, 'var')).join('\n')
  + '\n' + lift('classifyReply') + '\nreturn classifyReply;';
const pageClassify = new Function(pageSrc)();

// Ray's real replies first, then the phrasings the old matcher got wrong.
const CORPUS = [
  // --- the ticket Ray flagged: both replies are PICKUPS, neither is a completion
  ['Hi Ray, We will do the needful and update you. @vimal a please pickup and update once it has been completed Thanks Dinesh Kumar Tech Support', 'ack'],
  ['Hi Ray, We will complete the keyword optimisation and update you once it is completed. Could you please confirm whether we can pause or remove the keywords from the batches and briefs listed below?', 'ack'],
  // --- genuine completions
  ['Hi Ray, this has been completed and pushed live.', 'done'],
  ['We have completed the 200 MASK titles.', 'done'],
  ['Done ✅', 'done'],
  ['All titles are now live in FeedHero.', 'done'],
  ['Overlay actioned yesterday, QA passed.', 'done'],
  ['Task finished, sample shared with the AM.', 'done'],
  ['Please note this is now live.', 'done'],          // a polite prefix must not hide a completion
  // --- promises, conditions and questions: never a completion
  ['This will be done by Friday.', 'ack'],
  ['It should be completed today.', 'ack'],
  ['Will update you once done.', 'ack'],
  ['Can you confirm if it is completed?', 'ack'],
  ['Not completed yet — waiting on the feed refresh.', 'ack'],
  ['Picking this up now.', 'ack'],
  ['Noted, on it.', 'ack'],
  ['We are working on it, ETA Thursday.', 'ack'],
  // --- neither
  ['Which market should this cover?', ''],
  ['Thanks Ray.', ''],
  // --- the live-feed trap: talking about a live feed is not a finished task
  ['The Reiss live feed has 25,000 products in it.', ''],
  // --- the quoted original must never vote (it carries the brief's own words)
  ['Will pick this up. From: Ray Vu Sent: 10 September 2026 Subject: [FS Brief] … DEFINITION OF DONE Overlay live in FeedHero, QA completed', 'ack'],
];

let fail = 0;
for (const [text, want] of CORPUS) {
  const w = workerClassify(text), pg = pageClassify(text);
  const label = text.length > 64 ? text.slice(0, 61) + '…' : text;
  if (w !== want) { fail++; console.log('FAIL  worker: "' + label + '" → ' + JSON.stringify(w) + ', want ' + JSON.stringify(want)); }
  else if (pg !== w) { fail++; console.log('FAIL  page disagrees with worker on "' + label + '": ' + JSON.stringify(pg) + ' vs ' + JSON.stringify(w)); }
  else console.log('PASS  ' + (want || 'neither').padEnd(5) + ' · ' + label);
}
console.log(fail ? '\n' + fail + ' FAILED' : '\n✓ reply classifier: worker and page agree across ' + CORPUS.length + ' cases');
process.exit(fail ? 1 : 0);
