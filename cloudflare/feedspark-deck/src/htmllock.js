/* WHO CAN OPEN A CLIENT DOCUMENT (Ray, 8 Oct 2026: "Shall we make the HTML download a bit more secure, so it will need the
 * client email address to open the HTML to view it - the email addresses associated with alias hobbycraft@feedspark.com
 * (Same for other clients)"; then, choosing: the WHOLE client domain, encrypted, and any @feedspark.com).
 *
 * The Task Manager's client master holds only the team alias (client_email = hobbycraft@feedspark.com); the client's real
 * addresses are the SENDERS on the tickets that alias receives (KV tmtick:<client>, row[7] = from_email). So a client's
 * domain is read, strongest first, off:
 *   1. the brand dossier's own `dom` (the AM set it — authoritative),
 *   2. a sender domain whose name IS the brand (jane@hobbycraft.co.uk → hobbycraft) — the same label read detectClient uses,
 *   3. failing both, the busiest outside sender domain, marked a GUESS for the AM to confirm in the dialog.
 * FeedSpark's own domains, free mail and nothing-else are never a client domain. Pure: the worker route and the harness
 * share it. Nothing here is stored — the page asks once per download and the AM can edit the list before it is used. */
export const LOCK_STAFF = 'feedspark.com';
export const LOCK_INTERNAL = ['feedspark.com', 'aroxo.com', 'feedhero.net'];
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail)\./;

export function fold(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
export function normDomain(d) {
  const v = String(d || '').trim().toLowerCase().replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
}
export function domainOfEmail(e) { const m = /@([a-z0-9.-]+\.[a-z]{2,})\s*>?\s*$/i.exec(String(e || '').trim()); return m ? normDomain(m[1]) : ''; }
// the registrable part's name: schuh.co.uk → schuh, uk.reiss.com → reiss
export function domainLabel(d) {
  const p = normDomain(d).split('.'); if (p.length < 2) return '';
  let cut = 1;
  if (p.length >= 3 && p[p.length - 1].length <= 3 && /^(co|com|org|net|ac|gov|ltd|plc|edu)$/.test(p[p.length - 2])) cut = 2;
  return fold(p.slice(0, p.length - cut).pop() || '');
}
export function isInternal(d) { const v = normDomain(d); return !v || LOCK_INTERNAL.some((x) => v === x || v.endsWith('.' + x)); }
// the registrable domain — mail.hobbycraft.co.uk and hobbycraft.co.uk are one client domain
export function baseDomain(d) {
  const p = normDomain(d).split('.'); if (p.length < 2) return '';
  const two = p.length >= 3 && p[p.length - 1].length <= 3 && /^(co|com|org|net|ac|gov|ltd|plc|edu)$/.test(p[p.length - 2]);
  return p.slice(-(two ? 3 : 2)).join('.');
}
export function lockDomains(client, dossierDom, senders) {
  const out = [], seen = {}, add = (d, src, n) => { const b = baseDomain(d); if (!b || seen[b] || isInternal(b)) return; seen[b] = 1; out.push({ d: b, src: src, n: n || 0 }); };
  const name = fold(client);
  const cnt = {};
  (senders || []).forEach((e) => { const d = baseDomain(domainOfEmail(e)); if (!d || isInternal(d) || FREEMAIL.test(d)) return; cnt[d] = (cnt[d] || 0) + 1; });
  if (normDomain(dossierDom)) add(dossierDom, 'dossier', cnt[baseDomain(dossierDom)] || 0);
  Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).forEach((d) => {
    const l = domainLabel(d);
    if (l.length >= 3 && name.length >= 3 && (l.indexOf(name) >= 0 || name.indexOf(l) >= 0)) add(d, 'tickets', cnt[d]);
  });
  if (!out.length) { const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; if (top && cnt[top] >= 2) add(top, 'guess', cnt[top]); }
  return { domains: out.slice(0, 4), staff: LOCK_STAFF, senders: Object.keys(cnt).length };
}
