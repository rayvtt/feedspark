#!/usr/bin/env node
// Keyword-optimisation RESULT parsing + verdict (Ray, 9 Sep 2026).
//
// These emails are archived per brand AND surfaced in Email Triage with a verdict chip, so a
// wrong verdict is visible in two places at once. The case that matters most is the inverted
// one: a FALL in CPC/CPA/cost/spend is a win, and naive sign-reading calls it a bad month.
//
// NOTE: no real specimen from Dino has been captured yet — every fixture below is synthetic,
// modelled on the subject shape in CLAUDE.md. Re-run and re-tighten against the first real email.
import { readFileSync } from 'node:fs';
import { parseKwResult, kwVerdict, kwWindow } from '../cloudflare/feedspark-deck/src/briefmatch.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};
const mail = (subject, body) => ({ subject, snippet: body || '' });

/* ---- THE REAL SPECIMEN (Ray, 9 Oct 2026) -------------------------------------------------
   Dino's Knit Zip Cardigan read-out, to superdry@feedspark.com with Ray copied, reproduced as
   the screenshot shows it. Its SUBJECT names no brand, no market and no "Keyword Optimisation";
   the title line is the fifth line of the BODY, in curly quotes. This email was dropped by the
   Gmail search, by the Apps Script's own gate and by this parser — three times, each enough. */
const SUPERDRY_SUBJ = 'Fwd: Knit Zip Cardigan - KW Feed Insertion';
const SUPERDRY_BODY = [
  'Hi Everyone,', '',
  'I hope you are well', '',
  '\u201c Superdry GB x Feedspark - Zip Knit Cardigan - Keyword Optimisation \u201d', '',
  'Please find below the results of the Keywords Optimisation Test,', '',
  'The Keywords Optimisation Test was about embedding Keywords in your feeds.', '',
  'Here\u2019s a summary of the key details:', '',
  '  *   Batch Size: 14 Products',
  '  *   Campaign Duration: 2 Weeks (Sep 24, 2026 to Oct 07, 2026)',
  '  *   Attached: Include all products', '',
  'Batch impact results for Superdry GB',
  '14 / 14 Active/ Products in Test',
  '0 SKU In Other Batch',
  '14 Days active',
  '218% Total uplift',
  '7,202 Estimated monthly impression uplift',
  '146 Estimated monthly clicks uplift', '',
  'The optimised SKUs results:', '',
  '  *   Impressions: 218.39% Increase',
  '  *   Clicks: 62.96% Increase',
].join('\n');

console.log('\n-- the title line in the BODY, not the subject (the real Superdry specimen) --');
{
  const r = parseKwResult(mail(SUPERDRY_SUBJ, SUPERDRY_BODY));
  ok('the read-out is parsed at all (it was dropped entirely)', !!r);
  ok('brand read off the body line', r && r.brand === 'Superdry', r && r.brand);
  ok('market read off the body line', r && r.mkt === 'gb', r && r.mkt);
  ok('the batch name is the period', r && r.period === 'Zip Knit Cardigan', r && r.period);
  ok('and it says the title came from the body', r && r.src === 'body', r && r.src);
  ok('both stated figures are captured',
    r && r.metrics.filter((t) => /218\.39|62\.96/.test(t)).length === 2, r && r.metrics);
  ok('a read-out of two increases reads positive', r && r.verdict === 'positive', r && r.verdict);
  ok('the raw body is archived whole', r && /Batch Size: 14 Products/.test(r.raw));
}
{
  // the subject still wins where it carries the line — nothing already working moves
  const r = parseKwResult(mail('Schuh GB x Feedspark - Aug I - Keyword Optimisation',
    '\u201c Reiss DE x Feedspark - Denim - Keyword Optimisation \u201d\nImpressions: 4% Increase'));
  ok('a subject that names the batch still wins over the body', r && r.brand === 'Schuh', r && r.brand);
  ok('…and is recorded as having come from the subject', r && r.src === 'subject', r && r.src);
}
{
  // an OLD result quoted deep in a forwarded thread must not re-date today's email
  const deep = 'Thanks, noted.\n' + 'x\n'.repeat(400)
    + '\u201c Monsoon GB x Feedspark - Aug I - Keyword Optimisation \u201d';
  ok('a title line far down a forwarded thread is not read', parseKwResult(mail('Re: catch-up', deep)) === null);
  const prose = 'We discussed how the Superdry GB x Feedspark - Aug I - Keyword Optimisation batch went, '
    + 'and agreed to look again next week once the second cohort has had a fortnight to settle down properly.';
  ok('a prose sentence running into the phrase is not a title line', parseKwResult(mail('Call notes', prose)) === null);
  ok('an ordinary email is still refused', parseKwResult(mail('Lunch tomorrow?', 'see you at one')) === null);
}

console.log('\n-- the window the email states, never one inferred --');
{
  const r = parseKwResult(mail(SUPERDRY_SUBJ, SUPERDRY_BODY));
  const d = (t) => new Date(t).toISOString().slice(0, 10);
  ok('the campaign window is read off the email\u2019s own words',
    r && r.win && d(r.win.a) === '2026-09-24' && d(r.win.b) === '2026-10-07',
    r && r.win && [d(r.win.a), d(r.win.b)]);
  ok('a read-out stating no window claims none',
    !parseKwResult(mail('Schuh GB x Feedspark - Aug I - Keyword Optimisation', 'Clicks: 4% Increase')).win);
  ok('24 Sep 2026 reads the same as Sep 24, 2026',
    JSON.stringify(kwWindow('Campaign Duration: 2 Weeks (24 Sep 2026 - 07 Oct 2026)'))
    === JSON.stringify(kwWindow('Campaign Duration: 2 Weeks (Sep 24, 2026 to Oct 07, 2026)')));
  ok('a backwards window is refused', kwWindow('Campaign Duration: (Oct 07, 2026 to Sep 24, 2026)') === null);
  ok('a year-long window is a misread, not a campaign',
    kwWindow('Campaign Duration: (Jan 01, 2026 to Dec 31, 2026)') === null);
  ok('an unreadable duration line claims nothing',
    kwWindow('Campaign Duration: 2 Weeks (about a fortnight)') === null);
}

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

// The backfill guards live inside worker.js's push handler, which is a Cloudflare module
// (default export + HTML text-module imports) and cannot be imported into plain node. These
// are SOURCE-LEVEL assertions, not behavioural ones — they pin that the guards exist and sit
// in the right order, which is what a careless edit would break.
console.log('\n-- backfill guards (source-level) --');
{
  const src = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
  const declared = src.indexOf('const backfill = body.backfill === true');
  const skipTriage = src.indexOf('if (backfill) continue;     // a backfill sweep only harvests');
  const skipRow = src.indexOf('if (backfill) continue;\n            if (!seen[m.id])');
  ok('backfill flag is read from the push body', declared > 0);
  ok('backfilled results skip the triage row', skipRow > 0);
  ok('backfill ignores ordinary mail', skipTriage > 0);
  ok('the flag is declared before both guards', declared > 0 && declared < skipRow && declared < skipTriage,
     { declared, skipRow, skipTriage });
  ok('archive cap raised to hold a year', /kwres\.slice\(0, 2000\)/.test(src));
  ok('triage queue cap left alone at 120', /stored\.slice\(0, 120\)/.test(src));
}

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
