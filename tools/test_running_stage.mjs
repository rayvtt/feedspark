#!/usr/bin/env node
/*
 * TEST RUNNING ⏱ — the unattended lane (Ray, 15 Sep 2026: "any A/B test or single test … is
 * missing a stage — 'test running', after done by ASPL, between done by ASPL and analysis").
 * The Gmail scanner moves tickets without anyone watching, so it has to reach the SAME stage
 * the page would: ASPL finishing a test records Done — ASPL *and* Test running, a go-live
 * starts the run rather than the analysis, and only a read-out puts a ticket in Analysis.
 * Also pins the stage roster the page renders, so worker and page can never disagree on it.
 * Wired into qa_gate, presync and validate.yml.
 */
import { readFileSync } from 'node:fs';
import { matchGmailToBriefs } from '../cloudflare/feedspark-deck/src/briefmatch.js';

const html = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
let fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('FAIL  ' + name + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
  else console.log('PASS  ' + name);
};

// ---- the page's stage roster: running sits between done and analysis, exactly once
const stages = [...html.matchAll(/\['([a-z]+)','[^']+','#[0-9A-Fa-f]{6}'\]/g)].map((m) => m[1]);
t('page stage order', stages, ['intake', 'briefed', 'progress', 'blocked', 'done', 'running', 'analysis', 'confirmed']);
t('the board reserves a lane per stage', /repeat\((\d+),minmax/.exec(html)[1], String(stages.length));
t('running is an AM-court stage in the page', /var COURT=\{[^}]*running:'AM'/.test(html), true);
t('…and carries no stage SLA (the run window is its dwell)', /SLA_STAGE=\{[^}]*running/.test(html), false);

const now = Date.now();
const brief = (id, task, status) => ({ id, client: 'Reiss', code: 'reis-gb', task, status,
  created: now - 3 * 86400000, due: '30092026', aspl: 'Dinesh', comms: [],
  hist: [{ s: 'briefed', t: now - 3 * 86400000 }] });
const msg = (id, snippet) => ({ id, from: 'Dinesh <dinesh@aroxo.com>', subject: 'Re: [FS Brief] Reiss',
  snippet: '[ibfref:' + id.split('|')[0] + '] ' + snippet, date: now });
const run = (b, m) => { const briefs = { [b.id]: b }; matchGmailToBriefs(briefs, [m], { aspl: ['Dinesh'] }); return briefs[b.id]; };

// ---- ASPL finishes a TEST: both steps recorded, in order
const done = run(brief('IB1', 'Keyword optimisation - Dresses', 'briefed'),
  msg('IB1', 'Hi Ray, the keyword optimisation has been completed. Thanks Dinesh'));
t('a completion on a test records Done — ASPL then Test running', [done.status, done.hist.map((h) => h.s)],
  ['running', ['briefed', 'done', 'running']]);

// ---- ASPL finishes an ORDINARY brief: nothing extra
const plain = run(brief('IB2', 'Custom label refresh', 'briefed'),
  msg('IB2', 'Hi Ray, this has been completed. Thanks Dinesh'));
t('an ordinary brief still ends at Done — ASPL', [plain.status, plain.hist.map((h) => h.s)],
  ['done', ['briefed', 'done']]);

// ---- go-live starts the RUN, not the analysis
const live = run(brief('IB3', 'Title A/B test - Coats', 'progress'),
  msg('IB3', 'Hi Ray, the test is now live on the feed.'));
t('a go-live reply starts the run', live.status, 'running');
t('…and stamps the run clock + the analysis due date', [!!live.liveAt, live.due !== '30092026'], [true, true]);

// ---- a read-out ends the run from wherever the ticket sits
const readout = run(Object.assign(brief('IB4', 'Keyword optimisation - Knitwear', 'running'), { liveAt: now - 20 * 86400000 }),
  msg('IB4', 'Hi Ray, Result: +12.4% clicks vs control for the knitwear keyword optimisation.'));
t('a read-out moves a running test into Analysis', readout.status, 'analysis');
t('…and files the result on the ticket', /^Result:/.test(readout.comms[readout.comms.length - 1].note), true);

// ---- a pickup is still just a pickup
const ack = run(brief('IB5', 'Keyword optimisation - Coats', 'briefed'),
  msg('IB5', 'Hi Ray, We will do the needful and update you. Thanks Dinesh'));
t('a pickup never reaches the run stage', ack.status, 'progress');

console.log(fail ? '\n' + fail + ' FAILED' : '\n✓ test-running stage: worker and page agree across ' + 11 + ' checks');
process.exit(fail ? 1 : 0);
