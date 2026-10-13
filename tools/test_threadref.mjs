/* FIND THE EMAIL THREAD — the REF is the query.
 *
 * Ray, 13 Oct 2026, over the Workflow ticket modal with "✉ Find the email thread" ringed in red:
 * "i think find email in thread option should search gmail box with REF - automatically rather
 * than email name".
 *
 * The link searched the brief's SUBJECT WORDS — client + the first eight words of the task — on a
 * belief, written into the code's own comment, that Gmail tokenises a hyphenated ref into
 * date-looking fragments and so searches badly. Ray disproved that in his own mailbox in the same
 * message: REIS-20260929-01 typed into Gmail returns the thread with the ref highlighted in the
 * subject, because every [FS Brief] carries [ibfref:<REF>] and every reply keeps it.
 *
 * Why it matters beyond a click: words match by RESEMBLANCE. A brand's sibling briefs share their
 * scaffolding ("Keywords Optimisation - <theme> - …"), so one ticket's link could land in another
 * ticket's thread — the same failure mode that collapsed three Reiss themes onto one record. A ref
 * names one ticket and nothing else.
 *
 * The functions are LIFTED OUT OF THE PAGE BY NAME and run, so a rename reports itself instead of
 * crashing the run, and the assertions are about what the link and the resolver really build.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../docs/FeedSpark_Workflow.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (got !== undefined ? '  got: ' + JSON.stringify(got) : '')); }
};

/* lift a top-level `function name(...)` out of the page and make it callable */
function lift(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return null;
  const end = html.indexOf('\n  }', at) >= 0 && html.indexOf('\n  }', at) < html.indexOf('\n}', at) + 1
    ? html.indexOf('\n  }', at) + 4 : html.indexOf('}', html.indexOf('return', at)) + 1;
  try { return new Function(html.slice(at, end) + '\nreturn ' + name + ';')(); } catch (e) { return null; }
}

// the real ticket from Ray's screenshot
const B = { id: 'REIS-20260929-01', code: 'reiss-gb', client: 'Reiss',
            task: 'bring in size_type from source feed' };

console.log('\n-- the query the link builds --');
const refQ = lift('threadRefQuery');
ok('threadRefQuery is on the page', !!refQ);
ok('…and it IS the ref', !!refQ && refQ(B) === 'REIS-20260929-01', refQ && refQ(B));
ok('…unquoted, the exact string Ray typed into Gmail', !!refQ && !/["']/.test(refQ(B)), refQ && refQ(B));
ok('…and carries no task words — a sibling brief can never answer to it',
   !!refQ && !/size_type|source|feed/i.test(refQ(B)), refQ && refQ(B));
ok('a brief with no ref yields nothing rather than a bad query',
   !!refQ && refQ({ client: 'Reiss', task: 'x' }) === '', refQ && refQ({ client: 'Reiss', task: 'x' }));

console.log('\n-- the link itself --');
const link = /id="m-thread"[\s\S]{0,400}?<\/a>'/.exec(html);
ok('the modal still carries the thread link', !!link);
ok('its href is built from threadRefQuery', !!link && /threadRefQuery\(b\)/.test(link[0]), link && link[0].slice(0, 160));
ok('…with the subject-words search only as the fallback',
   !!link && /threadRefQuery\(b\)\|\|threadQuery\(b\)/.test(link[0]));
ok('it still opens Gmail search', !!link && /mail\.google\.com\/mail\/#search\//.test(link[0]));
ok('the query is URL-encoded', !!link && /encodeURIComponent\(threadRefQuery/.test(link[0]));
// the tooltip used to assert the OPPOSITE of what Ray measured — it must not say that again
ok('the tooltip names the ref it searches for', !!link && /title="Searches Gmail for '\+esc\(b\.id\)/.test(link[0]));
ok('…and no longer claims the ID searches badly in Gmail', !!link && !/search badly/i.test(link[0]));

console.log('\n-- the server resolver reads the ref first --');
const lad = /fetch\('\/api\/gmail\/thread\?q='[\s\S]{0,400}?\)\n/.exec(html);
ok('the resolver still calls the lookup route', !!lad);
// read the rungs by splitting on the query separator, not by a paren-counting regex
const order = lad ? lad[0].split("&q='+encodeURIComponent(").slice(1)
  .map((seg) => seg.replace(/\)(?:\+'|\)|\n)[\s\S]*$/, '').replace(/\)$/, '').trim() + (/^threadRefQuery\(b|^threadQuery\(b/.test(seg) ? ')' : '')) : [];
if (lad) {
  const first = /\?q='\+encodeURIComponent\(([\s\S]*?)\)\+'&q=/.exec(lad[0]);
  if (first) order.unshift(first[1].trim());
}
ok('it leads with the ibfref token — FCC brief mail and nothing else',
   order[0] === "'\"ibfref:'+b.id+'\"'", order[0]);
ok('then the bare ref', order[1] === 'threadRefQuery(b)', order[1]);
ok('then the ibfcode', order[2] === "'\"ibfcode:'+b.code+'\"'", order[2]);
ok('and the subject words LAST, for a brief raised before refs', order[3] === 'threadQuery(b)', order[3]);
ok('four rungs, so no rung was dropped on the way', order.length === 4, order.length);

console.log('\n-- the words search survives as that last resort --');
const wordQ = lift('threadQuery');
ok('threadQuery is still on the page', !!wordQ);
ok('…and still searches the subject by client + task words',
   !!wordQ && wordQ(B) === 'subject:("Reiss" "bring in size type from source feed")', wordQ && wordQ(B));

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' + pass + ' passed' : '✓ all green  ' + pass + ' passed, 0 failed') + '\n');
process.exit(fail ? 1 : 0);
