// AI shopping demand — the STORE for Google Merchant Center's "AI performance" report
// (AI shopping terms · search intents · product attributes).
//
// Ray, 19 Nov 2026: "build this AI visibility module and how there would be recommendations on the
// back of this report. Keep in mind that I will try to connect with the GMC API to fetch data on a
// daily basis."
//
// Today the report reaches the FCC as an export an AM uploads on /aivis (parsed in the browser by
// docs/aidemand_engine.js). Tomorrow a daily pull writes the SAME record through the SAME two
// functions (cleanUpload → mergeUpload, src 'api') — so nothing downstream changes when the lane does.
//
// One KV key per client × market: aidemand:<client>:<mkt> = { v:1, up:[upload…] }
//   upload = { id, kind 'terms'|'intents'|'attrs', from, to, label, country, category, filter,
//              rows:[{ t, f, ps, sov }], by, at, src 'upload'|'api' }
// f   = the report's own frequency (0–1, relative to the busiest term) or, for attributes, its
//       search-popularity count;
// ps  = "Products showing" (null = the report printed nothing);
// sov = share of voice as a fraction (null = not reported — NEVER read as zero).
// One reading per kind × period: a re-upload of the same week replaces it.

export const KINDS = ['terms', 'intents', 'attrs'];
export const MAX_ROWS = 400;
export const MAX_UPLOADS = 90;

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const numOrNull = (v, lo, hi) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};
const isoDay = (v) => {      // a real calendar day — 2026-02-31 parses, and rolls into March, so it is round-tripped
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return '';
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v ? String(v) : '';
};

export function uploadId(kind, from, to) { return kind + '_' + (from || 'x') + '_' + (to || 'x'); }

export function cleanUpload(u, stamp) {
  if (!u || typeof u !== 'object') return null;
  const kind = KINDS.indexOf(u.kind) >= 0 ? u.kind : '';
  if (!kind || !Array.isArray(u.rows)) return null;
  const from = isoDay(u.from), to = isoDay(u.to);
  if (!from || !to || from > to) return null;            // a reading with no period cannot be trended
  const seen = {}, rows = [];
  for (const r of u.rows) {
    if (rows.length >= MAX_ROWS) break;
    if (!r || typeof r !== 'object') continue;
    const t = str(r.t, 80);
    const k = t.toLowerCase();
    if (!t || seen[k]) continue;
    seen[k] = 1;
    rows.push({
      t,
      f: numOrNull(r.f, 0, kind === 'attrs' ? 1e9 : 1),
      ps: numOrNull(r.ps, 0, 1e8),
      sov: numOrNull(r.sov, 0, 1),
    });
  }
  if (!rows.length) return null;
  const s = stamp || {};
  return {
    id: uploadId(kind, from, to), kind, from, to,
    label: str(u.label, 60), country: str(u.country, 8).toUpperCase(), category: str(u.category, 120), filter: str(u.filter, 80),
    rows, by: str(s.by, 60), at: Number(s.at) || Date.now(), src: s.src === 'api' ? 'api' : 'upload',
  };
}

export function mergeUpload(store, up) {
  const st = store && Array.isArray(store.up) ? store : { v: 1, up: [] };
  const list = st.up.filter((x) => x && x.id !== up.id);
  list.push(up);
  list.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : a.kind < b.kind ? -1 : 1));   // newest period first
  return { v: 1, up: list.slice(0, MAX_UPLOADS) };
}

export function dropUpload(store, id) {
  const st = store && Array.isArray(store.up) ? store : { v: 1, up: [] };
  const list = st.up.filter((x) => x && x.id !== id);
  return { v: 1, up: list, removed: list.length !== st.up.length };
}

export function viewStore(store) { return store && Array.isArray(store.up) ? store.up : []; }
