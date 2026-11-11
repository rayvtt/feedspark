/* tools/lib/pwsettle.js — wait for a CONDITION, never a duration.
 *
 * Why this exists. Three /golden browser tripwires — check_grplanbrief, check_grtext,
 * check_grplanedit — went red intermittently on `main` itself, which made every session's
 * presync red for reasons unrelated to whatever it was shipping. Measured 11 Nov 2026 by
 * interleaving a clean origin/main worktree against a feature branch on the same machine:
 * check_grplanbrief failed 4 of 5 runs on MAIN and 0 of 5 on the branch. Run alone it had
 * passed 8/8, which is why running one in isolation is the wrong experiment.
 *
 * The cause in every case was the same, and it was in the harness, not the page. Each of
 * them pressed something and then slept — `await page.waitForTimeout(800)` — and asserted
 * whatever the DOM happened to hold. /golden's action-plan board needs TWO async reads to
 * land (`/api/briefs` and `/api/state?ns=grplan`), each re-rendering the panel when it
 * resolves, so 800ms is a guess at how fast the machine is. On a loaded machine the read
 * arrived after the assertion and the card still read "→ Brief in Workflow"; the next
 * block then saw the previous block's ticket turn up, which is exactly what the failure
 * logs showed. A longer sleep would only move the cliff.
 *
 *   settle(page, sel)   the page has STOPPED CHANGING: the container exists and no
 *                       mutation has landed inside it for a quiet window. Scales with the
 *                       machine instead of betting against it.
 *   served(page, ...k)  the harness's own fetch stub has ANSWERED those reads (the stub
 *                       counts them on window.__served), so a wait can be about the reads
 *                       the page is actually waiting on rather than about the clock.
 *   dialogs(page)       ONE persistent dialog handler with a queue of expected replies.
 *
 * On `dialogs`: check_grtext crashed under presync with "dialog.accept: Cannot accept
 * dialog which is already handled!". It registered `page.once('dialog', …)` before each
 * prompt, and a `once` that never fires STAYS REGISTERED — so a click whose dialog was
 * slow left its handler behind, and the next dialog was answered by both the stale handler
 * and the fresh one. The second accept throws and takes the run down. One handler that
 * reads from a queue cannot do that, and an unconsumed reply is a visible leak rather than
 * a crash three blocks later.
 */
'use strict';

const QUIET = 180;        // no mutation for this long = the render has finished
const BUDGET = 20000;     // ...but never wait for ever: a hang is a failure, not a pass

/* The container is waited for, then watched. It is the node the page RE-RENDERS INTO
 * (#det-panel on /golden), not the content, so it survives every re-render; if it is
 * replaced wholesale the observer simply goes quiet, which ends the wait on a settled DOM.
 * Resolves `{ms, mutations}` so a caller can report what it waited for. */
async function settle(page, sel, opts) {
  const o = opts || {};
  const quiet = o.quiet || QUIET, budget = o.budget || BUDGET;
  if (sel) await page.waitForSelector(sel, { timeout: budget });
  return page.evaluate(([s, q, b]) => new Promise((res) => {
    const el = s ? document.querySelector(s) : document.body;
    if (!el) return res({ ms: 0, mutations: 0, missing: true });
    const t0 = Date.now();
    let n = 0, timer = null, hard = null, mo = null;
    const done = () => { clearTimeout(timer); clearTimeout(hard); if (mo) mo.disconnect();
      // one frame, so a render queued in a microtask has painted before we read the DOM
      requestAnimationFrame(() => res({ ms: Date.now() - t0, mutations: n })); };
    mo = new MutationObserver((recs) => { n += recs.length; clearTimeout(timer); timer = setTimeout(done, q); });
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    timer = setTimeout(done, q);
    hard = setTimeout(done, b);
  }), [sel || null, quiet, budget]);
}

/* The reads the page is waiting on, counted by the harness's own stub. Pair this with the
 * stub helper below so a harness never has to guess how long a fetch chain takes. */
function served(page, ...keys) {
  return page.waitForFunction((ks) => {
    const s = window.__served || {};
    return ks.every((k) => (s[k] || 0) > 0);
  }, keys, { timeout: BUDGET });
}

/* THE ONE THAT ACTUALLY FIXED IT. `served` + `settle` cut check_grplanbrief from 4-in-5 to
 * 3-in-20, which is better and still broken: both reads can be answered and the DOM can be
 * quiet while the panel still holds the FIRST render, because the re-render those reads
 * trigger had not started inside the quiet window. The condition that is actually true when
 * the board is readable is "the panel has been written again SINCE the last read was
 * answered" — so the init script counts panel writes, `count()` records the count at the
 * moment each read is answered, and this waits for one more.
 *
 * Install both halves with `instrument(panelSelector)` inside page.addInitScript, and call
 * the `count(key)` it defines when the stub answers a read. */
function instrumentSrc(panelId) {
  return `
    window.__served = {}; window.__renders = 0; window.__servedRenders = 0;
    window.__count = function (k) {
      window.__served[k] = (window.__served[k] || 0) + 1;
      window.__servedRenders = window.__renders;        // a render after THIS is the one that read it
    };
    (function attach() {
      var root = document.documentElement;              // null while the init script runs
      if (!root) return requestAnimationFrame(attach);
      new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var m = recs[i];
          if (m.type === 'childList' && m.target && m.target.id === ${JSON.stringify(panelId)}) window.__renders++;
        }
      }).observe(root, { childList: true, subtree: true });
      window.__watching = 1;                            // so a harness can assert it attached
    })();
  `;
}

/* the panel has been re-rendered since the last read was answered */
function repainted(page) {
  return page.waitForFunction(() => window.__renders > window.__servedRenders, null, { timeout: BUDGET });
}

/* ONE dialog handler, a queue of replies. expect(reply) queues one; a dialog with nothing
 * queued is accepted (a prompt nobody planned for must not hang the run) and recorded, so
 * `unexpected` can be asserted on. `pending()` reports replies that were queued and never
 * used — a click that did not open the prompt it was supposed to, which is a real finding
 * and used to show up as a crash in a later, unrelated block. */
function dialogs(page) {
  const q = [], seen = [], extra = [];
  page.on('dialog', async (d) => {
    const r = q.shift();
    seen.push({ type: d.type(), message: d.message() });
    if (r === undefined) extra.push(d.message());
    try { if (r === null) await d.dismiss(); else await d.accept(r === undefined ? '' : r); }
    catch (e) { /* the dialog went away on its own; nothing to answer */ }
  });
  return {
    expect(reply) { q.push(reply === undefined ? '' : reply); return this; },
    dismissNext() { q.push(null); return this; },
    pending() { return q.length; },
    unexpected() { return extra.slice(); },
    seen() { return seen.slice(); },
  };
}

/* ---- THE ROOT CAUSE, AND THE FIX ----------------------------------------------------
 * All three harnesses carried their fixtures across a reload through WEB STORAGE ON A
 * file:// PAGE — localStorage in check_grplanbrief, sessionStorage in the other two:
 *
 *     seed(store, briefs)  ->  localStorage.setItem('__store', …)
 *     open()               ->  goto('about:blank'); goto('file://…')
 *     init script          ->  JSON.parse(localStorage.getItem('__store') || '{}')
 *
 * Chromium gives a file:// page an opaque origin and does not guarantee web storage on it,
 * so that read comes back EMPTY now and then. Measured here on 11 Nov 2026: 1 of 24 seed →
 * reload → read cycles saw `{store: 0, briefs: 0}` — nothing at all — and the board then
 * correctly rendered "No task briefed yet", which the assertions read as the page failing
 * to tie a ticket. Under presync's load it was far worse: 4 of 5 runs of check_grplanbrief
 * on main. It is ONE cause behind all three tripwires, not three timing bugs, and no amount
 * of waiting fixes it — the data never arrived.
 *
 * So the fixture stops travelling through the browser. It stays in NODE and the page asks
 * for it through a Playwright binding, which is reinstalled on every navigation (verified)
 * and cannot be dropped by a storage partition. Writes come back the same way, so a value
 * the page saved survives the next reload because Node is holding it.
 *
 *     const fx = await bridge(ctx, { grplan: {}, briefs: {} });   // node side
 *     ...addInitScript(bridgeSrc())                               // page side
 *     fx.set({ grplan: store, briefs: briefs });                  // seeding is a local assignment
 *     fx.get().grplan                                             // and reading it needs no page call
 */
async function bridge(ctx, initial) {
  let state = JSON.parse(JSON.stringify(initial || {}));
  const puts = [];
  await ctx.exposeFunction('__fxGet', () => state);
  await ctx.exposeFunction('__fxPut', (ns, val) => { state[ns] = val; puts.push({ ns, val }); return true; });
  return {
    get: () => state,
    set(next) { state = JSON.parse(JSON.stringify(next)); return this; },
    patch(ns, val) { state[ns] = JSON.parse(JSON.stringify(val)); return this; },
    puts: () => puts.slice(),
    clearPuts() { puts.length = 0; return this; },
  };
}

/* The page half. Put it in an init script BEFORE the fetch stub; the stub then answers a
 * read with `window.__fxReady.then(f => …)` instead of reaching for storage. `window.__fx`
 * mirrors the fixture for assertions that already read it synchronously. */
function bridgeSrc() {
  return `
    window.__fxReady = (typeof window.__fxGet === 'function')
      ? window.__fxGet().then(function (f) { window.__fx = f || {}; return window.__fx; })
      : Promise.reject(new Error('pwsettle bridge: __fxGet was not installed'));
    window.__fxReady.catch(function () {});
    window.__fxSave = function (ns, val) { if (window.__fx) window.__fx[ns] = val; return window.__fxPut(ns, val); };
  `;
}

module.exports = { settle, served, repainted, dialogs, instrumentSrc, bridge, bridgeSrc, QUIET, BUDGET };
