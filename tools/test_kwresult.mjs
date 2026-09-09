#!/usr/bin/env node
// Keyword-optimisation RESULT parsing + verdict (Ray, 9 Sep 2026).
//
// These emails are archived per brand AND surfaced in Email Triage with a verdict chip, so a
// wrong verdict is visible in two places at once. The case that matters most is the inverted
// one: a FALL in CPC/CPA/cost/spend is a win, and naive sign-reading calls it a bad month.
//
// NOTE: no real specimen from Dino has been captured yet — every fixture below is synthetic,
// modelled on the subject shape in CLAUDE.md. Re-run and re-tighten against the first real email.
import { parseKwResult, kwVerdict } from '../cloudflare/feedspark-deck/src/briefmatch.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const mail = (subject, body) => ({ subject, snippet: body || '' });

console.log('\n-- subject shape --');
{
  const r = parseKwResult(mail('Schuh GB x Feedspark - Aug I - Keyword Optimisation'));
  ok('brand parsed', r && r.brand === 'Schuh', r && r.brand);
  ok('market parsed + lowercased', r && r.mkt === 'gb', r && r.mkt);
  ok('period parsed', r && r.period === 'Aug I', r && r.period);
}
{
  const r = parseKwResult(mail('Re: Fwd: Reiss UK x FeedSpark — Sep II — Keyword Optimization'));
  ok('reply/forward prefixes stripped', r && r.brand === 'Reiss', r && r.brand);
  ok('UK normalised to gb', r && r.mkt === 'gb', r && r.mkt);
  ok('US spelling accepted', r && r.period === 'Sep II', r && r.period);
}
ok('unrelated subject ignored', parseKwResult(mail('Lunch tomorrow?')) === null);
ok('near-miss subject ignored', parseKwResult(mail('Schuh GB x Feedspark - Aug I - Feed Audit')) === null);

console.log('\n-- verdict direction --');
ok('signed positive', kwVerdict(['Clicks +23%']).verdict === 'positive');
ok('signed negative', kwVerdict(['Revenue -14%']).verdict === 'negative');
ok('prose up', kwVerdict(['CTR up 12% on the month']).verdict === 'positive');
ok('prose down', kwVerdict(['Conversions fell 9%']).verdict === 'negative');
ok('multiplier over 1', kwVerdict(['ROAS 2.4x vs last period']).verdict === 'positive');
ok('no movement is unknown', kwVerdict(['Clicks steady this period']).verdict === 'unknown');
ok('no lines at all is unknown', kwVerdict([]).verdict === 'unknown');

console.log('\n-- inverted metrics: a fall in cost is a WIN --');
ok('CPC down = positive', kwVerdict(['CPC -18%']).verdict === 'positive', kwVerdict(['CPC -18%']));
ok('CPA down = positive', kwVerdict(['CPA decreased 22%']).verdict === 'positive');
ok('cost down = positive', kwVerdict(['Cost -11% vs Aug']).verdict === 'positive');
ok('spend up = negative', kwVerdict(['Spend +30%']).verdict === 'negative');
ok('CPC up = negative', kwVerdict(['CPC rose 14%']).verdict === 'negative');

console.log('\n-- aggregation --');
ok('2:1 good tips positive', kwVerdict(['Clicks +20%', 'CTR +8%', 'Revenue -3%']).verdict === 'positive');
ok('1:1 is mixed', kwVerdict(['Clicks +20%', 'Revenue -18%']).verdict === 'mixed');
ok('2:1 bad tips negative', kwVerdict(['Clicks -20%', 'CTR -8%', 'Revenue +3%']).verdict === 'negative');

console.log('\n-- end to end --');
{
  const body = [
    'Hi team,', '',
    'Aug I keyword optimisation results for Schuh GB:', '',
    'Clicks +34% vs the prior period',
    'CTR up 11%',
    'CPC -19%',
    'Revenue +28%',
    '', 'Thanks,', 'Dino',
  ].join('\n');
  const r = parseKwResult(mail('Schuh GB x Feedspark - Aug I - Keyword Optimisation', body));
  ok('metric lines extracted', r && r.metrics.length === 4, r && r.metrics);
  ok('verdict positive', r && r.verdict === 'positive', r && r.verdict);
  ok('good count includes the CPC fall', r && r.good === 4, r && { good: r.good, bad: r.bad });
  ok('raw body archived', r && r.raw.includes('Dino'));
}
{
  const body = ['Sep I results for Reiss US:', '', 'Clicks -22%', 'Revenue -17%', 'CPC +9%'].join('\n');
  const r = parseKwResult(mail('Reiss US x Feedspark - Sep I - Keyword Optimisation', body));
  ok('bad month reads negative', r && r.verdict === 'negative', r && r.verdict);
  ok('rising CPC counted against', r && r.bad === 3, r && { good: r.good, bad: r.bad });
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
