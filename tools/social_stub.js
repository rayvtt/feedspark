// The stub the browser tripwires (check_mobile.js, check_darkmode.js, check_social.js) hand the /social page:
// its four engines, served the way the worker serves them, an EMPTY feed roster (so the page opens on its
// demo products, which it draws itself — nothing here is a client's product) and an empty shared state.
// The lines only answer on the Social page (a guard on the file name), so no other page under the same
// tripwire is ever served an engine it never asked for.
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'docs');
function stubLines(opts) {
  opts = opts || {};
  const src = (f) => JSON.stringify(fs.readFileSync(path.join(D, f), 'utf8'));
  const txt = (body, type) => 'return Promise.resolve(new Response(' + body + ',{status:200,headers:{"content-type":"' + type + '"}}));';
  return " if(/Social/.test(location.pathname)){\n"
    + "  if(url.indexOf('/social/engine.js')>=0)" + txt(src('social_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/overlays/studio.js')>=0)" + txt(src('overlay_studio_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/overlays/engine.js')>=0)" + txt(src('overlay_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/feedlab/engine.js')>=0)" + txt(src('feedlab_engine.js'), 'application/javascript') + "\n"
    + "  if(url.indexOf('/api/feed/clients')>=0)return j({clients:" + JSON.stringify(opts.clients || {}) + "});\n"
    + "  if(url.indexOf('/api/state')>=0){if(opts&&opts.method==='PUT'){var b=JSON.parse(opts.body);window.__socPut=(window.__socPut||[]).concat([b]);return j(b);}return j({socialdpa:{}});}\n"
    + " }\n";
}
module.exports = { stubLines };
