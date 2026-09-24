/*
 * MODULE-BY-MODULE MIGRATION STATUS (Ray, 24 Sep 2026: "We'll ship module by module. Therefore, when
 * other AMs start using the dashboard, each module needs to be highlighted if it has been migrated or
 * not").
 *
 * The management tracker (/transformation) keeps each module's migration status in the SAME KV store
 * as the rest of the roadmap (`transform`, key `mod:<path>`), which only granted signins can read.
 * Every AM needs to SEE the status on the modules they use, so GET /api/migration/status serves a
 * tiny public projection of it — the state and the planned month per module, nothing else (no notes,
 * no names, no checklist) — and docs/migration_widget.html paints it onto every app page's nav and
 * topbar.
 *
 * MIG_SEED is the module list with each module's planned month. The page carries a twin (RM.modules
 * in docs/FeedSpark_Transformation.html) so it renders with no network; tools/test_transform.mjs
 * asserts the two lists are identical, path for path.
 */

// states, in the order a module moves through them
export const MIG_STATES = ['legacy', 'owned', 'migrating', 'migrated'];

// p = the module's route (what the nav links to), n = its name, w = wave, m = planned month
export const MIG_SEED = [
  { p: '/feedchat', n: 'Feed Chat', w: 0, m: '2027-01' },
  { p: '/volume', n: 'Product volume', w: 1, m: '2027-02' },
  { p: '/overlays', n: 'Overlays', w: 1, m: '2027-02' },
  { p: '/images', n: 'Image library', w: 1, m: '2027-02' },
  { p: '/feedlab', n: 'Feed Lab', w: 1, m: '2027-02' },
  { p: '/deck-builder', n: 'Deck generator', w: 1, m: '2027-02' },
  { p: '/labels', n: 'Label Guard', w: 2, m: '2027-02' },
  { p: '/ptypes', n: 'PT Guard', w: 2, m: '2027-02' },
  { p: '/golden', n: 'Golden Record', w: 2, m: '2027-02' },
  { p: '/schedule', n: 'Scheduled work', w: 2, m: '2027-02' },
  { p: '/roas', n: 'ROAS', w: 2, m: '2027-02' },
  { p: '/kwcal', n: 'Keyword calendar', w: 3, m: '2027-03' },
  { p: '/aiquote', n: 'AI Quote', w: 3, m: '2027-03' },
  { p: '/pricer', n: 'Pricer', w: 3, m: '2027-03' },
  { p: '/tasks', n: 'FS Task Manager', w: 3, m: '2027-03' },
  { p: '/leadership', n: 'Leadership', w: 3, m: '2027-03' },
  { p: '/activity', n: 'Activity & Build Log', w: 3, m: '2027-03' },
  { p: '/workflow', n: 'Workflow & Playbook', w: 4, m: '2027-03' },
  { p: '/', n: 'Command center', w: 4, m: '2027-03' },
  { p: '/transformation', n: 'Transformation', w: 4, m: '2027-03' },
];

// the public projection every signin may read: {on, modules:{path:{n, st, m, at}}}
// `on` = management's switch (cfg:badges) for showing the badges to AMs at all
export function migrationView(data) {
  const d = data || {};
  const cfg = d['cfg:badges'];
  const out = { on: !(cfg && cfg.on === false), modules: {} };
  for (const s of MIG_SEED) {
    const r = d['mod:' + s.p] || {};
    const st = MIG_STATES.indexOf(r.st) >= 0 ? r.st : 'legacy';
    const m = /^\d{4}-\d{2}$/.test(String(r.m || '')) ? r.m : s.m;
    out.modules[s.p] = { n: s.n, st, m, at: Number(r.at) || 0 };
  }
  return out;
}

// which module a URL path belongs to (sub-pages ride their parent: /leadership/roadmap -> /leadership)
export function migrationPathOf(path) {
  const p = String(path || '/').replace(/\/+$/, '') || '/';
  if (p === '/') return '/';
  const hit = MIG_SEED.filter((s) => s.p !== '/' && (p === s.p || p.indexOf(s.p + '/') === 0))[0];
  return hit ? hit.p : null;
}
