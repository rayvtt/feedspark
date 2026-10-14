/*
 * Serve the worker's own engine files to a file:// page under Playwright.
 *
 * A page that loads <script src="/kwcal/engine.js"> is loading a file the WORKER serves; from a
 * file:// origin that path resolves to the filesystem root and 404s, so the global never
 * defines and the page dies on boot. Harnesses have each been routing these by hand
 * (test_guardcards, check_images), which works until a page gains its first engine dependency
 * and every sweep that renders it breaks at once — which is exactly what happened when the
 * Keyword Calendar started loading its tie from a served engine.
 *
 * The map is READ OUT OF THE WORKER, never written here, so a new engine route is covered the
 * day it ships rather than the day someone remembers this file. The routes are deliberately
 * real network fulfils, not pre-injected globals: the page's own <script src> has to fetch and
 * define, because serving an EMPTY 200 for an engine is a failure that has actually shipped
 * (docs/IMAGES.md), and pre-injection hides it.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');

function engineMap() {
  const w = fs.readFileSync(path.join(REPO, 'cloudflare/feedspark-deck/src/worker.js'), 'utf8');
  const imports = {};
  for (const m of w.matchAll(/import\s+(\w+)\s+from\s+"\.\.\/\.\.\/\.\.\/(docs\/[\w./-]+\.js)"/g)) imports[m[1]] = m[2];
  const out = {};
  const re = /path === '(\/[\w-]+\/(?:engine|studio|pixels|levers)\.js)'[\s\S]{0,220}?new Response\((\w+)/g;
  for (const m of w.matchAll(re)) if (imports[m[2]]) out[m[1]] = imports[m[2]];
  return out;
}

/** Install one route per served engine on a Playwright page or context. */
async function installEngineRoutes(target, map) {
  const m = map || engineMap();
  for (const [url, file] of Object.entries(m)) {
    const abs = path.join(REPO, file);
    if (!fs.existsSync(abs)) continue;
    await target.route('**' + url, (r) => r.fulfill({ path: abs, contentType: 'application/javascript; charset=utf-8' }));
  }
  return m;
}

module.exports = { engineMap, installEngineRoutes };
