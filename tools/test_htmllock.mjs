#!/usr/bin/env node
/* tools/test_htmllock.mjs — WHO CAN OPEN A GOLDEN RECORD ⬇ HTML (Ray, 8 Oct 2026: "make the HTML download a bit more secure, so it
   will need the client email address to open … the email addresses associated with alias hobbycraft@feedspark.com").
   The client domain is read off the dossier and the SENDERS on the client's tickets (src/htmllock.js); this pins the reading
   on sender shapes taken from the real queues (client staff, its agencies, our own team, free mail), the worker route and
   the page wiring. No real address is in here. Run: node tools/test_htmllock.mjs */
import { readFileSync } from 'fs';
import * as HL from '../cloudflare/feedspark-deck/src/htmllock.js';
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };

const HC = ['jane@hobbycraft.co.uk', 'Ann Smith <ann@hobbycraft.co.uk>', 'raj@hobbycraft.co.uk', 'x@publicismedia.com', 'y@publicismedia.com', 'z@sparkfoundryww.com',
  'ray@feedspark.com', 'steven@feedspark.com', 'p@performics.com', 'someone@gmail.com'];
const hc = HL.lockDomains('Hobbycraft', '', HC);
t('Hobbycraft: the client domain is the sender domain named after the brand — never the agencies, FeedSpark or free mail', hc.domains.map((d) => d.d).join() === 'hobbycraft.co.uk' && hc.domains[0].src === 'tickets' && hc.domains[0].n === 3, hc);
t('…and the staff domain is FeedSpark', hc.staff === 'feedspark.com');
const dz = HL.lockDomains('Accessorize', 'monsoon.co.uk', ['a@monsoon.co.uk', 'b@monsoon.co.uk', 'c@agency.com']);
t('a brand that mails from another domain (Accessorize from monsoon.co.uk) takes the dossier\'s domain first', dz.domains[0].d === 'monsoon.co.uk' && dz.domains[0].src === 'dossier' && dz.domains[0].n === 2, dz);
const gs = HL.lockDomains('Northwind', '', ['a@nw-retail.com', 'b@nw-retail.com', 'c@nw-retail.com', 'd@agency.com']);
t('no dossier and no sender named after the brand: the busiest outside sender, marked a GUESS for the AM', gs.domains.length === 1 && gs.domains[0].d === 'nw-retail.com' && gs.domains[0].src === 'guess', gs);
t('…but one stray message is not enough to guess', HL.lockDomains('Northwind', '', ['a@one.com']).domains.length === 0);
t('nothing on record → nothing proposed (the dialog asks)', HL.lockDomains('Reiss', '', []).domains.length === 0 && HL.lockDomains('Reiss', '', ['ray@feedspark.com', 'x@gmail.com']).domains.length === 0);
t('a subdomain sender is its registrable domain', HL.lockDomains('Reiss', '', ['a@uk.reiss.com', 'b@mail.reiss.com']).domains.map((d) => d.d).join() === 'reiss.com');
t('schuh.co.uk reads as schuh; an accented brand folds', HL.domainLabel('schuh.co.uk') === 'schuh' && HL.fold('Estée') === 'estee');
t('the dossier domain normalises (www, scheme, path, an address) and FeedSpark is never a client domain',
  HL.lockDomains('Reiss', 'https://www.reiss.com/shop', []).domains[0].d === 'reiss.com' && HL.lockDomains('Reiss', 'feedspark.com', []).domains.length === 0 && HL.normDomain('jane@reiss.com') === 'reiss.com');
t('a dossier domain is not repeated by its own senders', HL.lockDomains('Reiss', 'reiss.com', ['a@reiss.com']).domains.length === 1);

const W = readFileSync(new URL('../cloudflare/feedspark-deck/src/worker.js', import.meta.url), 'utf8');
const route = W.slice(W.indexOf("path === '/api/golden/readers'"), W.indexOf("path === '/api/golden/history'"));
t('the worker route reads the dossier domain and the client\'s ticket senders (row[7]) through lockDomains', /import \{ lockDomains \} from "\.\/htmllock\.js"/.test(W) && /tmtick:/.test(route) && /r\[7\]/.test(route) && /lockDomains\(client/.test(route) && /\.dom/.test(route));
t('…scoped like every client read', /accessOf\(env, request\)/.test(route) && /clientMatch\(acc\.clients, client\)/.test(route) && /403/.test(route));
const P = readFileSync(new URL('../docs/FeedSpark_GoldenRecord.html', import.meta.url), 'utf8');
t('the page asks /api/golden/readers, encrypts with AES-GCM under PBKDF2 per domain and always adds feedspark.com',
  /\/api\/golden\/readers\?client=/.test(P) && /name: 'PBKDF2'/.test(P) && /name: 'AES-GCM'/.test(P) && /doms\.concat\(\['feedspark\.com'\]\)/.test(P) && /LOCK_ITER = 200000/.test(P));
t('the opener sends nothing anywhere — no fetch inside lockOpen', (() => { const a = P.indexOf('function lockOpen()'), b = P.indexOf('function lockShell('); const s = P.slice(a, b); return a > 0 && b > a && !/fetch\(|XMLHttpRequest|sendBeacon/.test(s); })());
t('the plain document is reachable only through the harness switch', /if \(window\.__grPlainExport\) return saveHtml/.test(P) && /lockDialog\(r\)/.test(P));
console.log(`html lock: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
