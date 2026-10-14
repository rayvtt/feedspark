/*
 * ONE PROJECT PLAN, TWO BRANDS (Ray, 14 Oct 2026, with the sheet open: "only on Mon[soon]/
 * Access[orize] … project plans because both brands are actually merged inside one project plan,
 * which is this spreadsheet. So for these two brands, the way it works should be: the initial
 * brands, MON or ACC, should be indicated in column B of the project plan sheet. Every task that
 * goes into this plan should be done for both brands at once, unless a manual task is created
 * within the workflows and the brand is selected individually; then it should be done only for
 * that brand and marked in the Google Sheet accordingly.").
 *
 * PLAN_SHEETS has mapped Monsoon AND Accessorize to one workbook since the day they were wired,
 * and /api/plan/live hands the SAME parsed array to both (`out[brand] = seen[id]`) — so every one
 * of the 38 rows the team has already marked `Mon` / `MON` / `MONSOON` / `Acc` / `ACC` by hand sat
 * on BOTH boards, and the monthly block the sheet duplicates per brand under its own
 * `Monsoon UK` / `Accessorize UK` headers read as fourteen tasks on each. The convention Ray
 * describes is therefore not new — it is in the sheet, in five spellings, and the FCC was the only
 * reader ignoring it.
 *
 * THE DEFAULT IS BOTH, AND THAT IS WHAT A BLANK CELL MEANS. Column B is not a brand column: of
 * 891 rows it holds row numbers (`1`, `1.1`, `14,5`), section headers, and notes (`PPC`,
 * `Single group`, `Bazaar`, `UK & US`, `Q1 - Spring Clean`, `[with vs. Without Colour Trend]`).
 * So a cell is read as attribution ONLY when it NAMES a brand that shares this workbook, and
 * everything else — including a cell nobody filled in — leaves the row on both boards, which is
 * exactly the behaviour every row has today. A reading that cannot be made is never guessed.
 *
 * GENERAL, NOT A MONSOON SPECIAL CASE: the Estée Lauder group shares a workbook across five
 * brands and Jo Malone's stands alone. The rules below take the brands sharing the sheet as data,
 * so a sheet with one brand can never attribute anything (nothing to tell apart) and the ELC
 * workbook gains the same reading for free — a cell reading `MAC` is a MAC row and a cell reading
 * anything else is all five brands', as it is now.
 */

// A brand's own short token — what the team writes in the cell and what a one-brand row written
// from Workflow stamps back. Ray named MON and ACC; everything else derives from the brand's own
// first word, and a derivation two brands on one sheet would share is refused in favour of the
// full name (a token that cannot be told apart is worse than a long one).
const NAMED_TOKENS = { 'Monsoon': 'MON', 'Accessorize': 'ACC' };

export function foldName(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// the brands wired to one workbook, in a stable order
export function brandsOnSheet(map, id) {
  if (!map || !id) return [];
  return Object.keys(map).filter((b) => map[b] === id).sort();
}

export function brandToken(brand, brands) {
  const name = String(brand || '');
  if (NAMED_TOKENS[name]) return NAMED_TOKENS[name];
  const first = foldName(name).split(' ')[0] || '';
  if (first.length < 3) return name;
  const tok = first.slice(0, 3);
  // Another brand on the same sheet whose OWN token is these three letters => no token, use the
  // full name: a token that cannot be told apart is worse than a long one. Compared against the
  // other brand's resolved token (its named one, else its own derivation) without recursing.
  const tokenOf = (b) => NAMED_TOKENS[b] || (foldName(b).split(' ')[0] || '').slice(0, 3);
  const clash = (brands || []).some((b) => b !== name && foldName(tokenOf(b)) === tok);
  return clash ? name : tok.toUpperCase();
}

// Does one piece of a cell name this brand? Its own token, its full name, or an opening run of
// its first word at least three characters long ("Mon" → Monsoon, "Acc" → Accessorize). The
// piece must be a PREFIX of the brand — not merely share letters — so "Bazaar" is not Benefit
// and "UK" is not anything.
function pieceNames(piece, brand, brands) {
  const p = foldName(piece);
  if (!p) return false;
  if (p === foldName(brandToken(brand, brands))) return true;
  const full = foldName(brand);
  if (p === full) return true;
  const first = full.split(' ')[0] || '';
  return p.length >= 3 && first.length >= p.length && first.slice(0, p.length) === p;
}

// WHICH BRANDS A CELL NAMES — [] when it names none (= every brand on the sheet).
// Separators are the ones the sheet actually uses: "&", ",", "/", "+", "and", whitespace.
export function readCellBrands(cell, brands) {
  const list = brands || [];
  if (list.length < 2) return [];
  const raw = String(cell == null ? '' : cell);
  if (!raw.trim()) return [];
  const pieces = foldName(raw).split(' ').filter((w) => w && w !== 'and');
  if (!pieces.length) return [];
  const out = [];
  list.forEach((b) => { if (pieces.some((p) => pieceNames(p, b, list))) out.push(b); });
  return out;
}

// A plan ROW's brands, read from the columns LEFT of its task text (column B on this sheet) so a
// brand mentioned INSIDE a task ("Confirm new WoW with MON & ACC") is never read as attribution.
export function rowBrands(row, taskCol, brands) {
  const list = brands || [];
  if (list.length < 2) return [];
  const stop = Math.min(taskCol >= 0 ? taskCol : 0, 4);
  for (let k = 0; k < stop; k++) {
    const got = readCellBrands((row || [])[k], list);
    if (got.length) return got;
  }
  return [];
}

// WHOSE BOARD A ROW BELONGS ON. A row naming no brand belongs to every brand on the sheet — the
// default Ray stated and the behaviour of every row before this shipped, so a cache parsed by an
// older worker (no `br` on any row) reads exactly as it did.
export function rowIsFor(task, brand) {
  const br = task && task.br;
  if (!Array.isArray(br) || !br.length) return true;
  return br.indexOf(brand) >= 0;
}

export function tasksForBrand(tasks, brand) {
  return (tasks || []).filter((t) => rowIsFor(t, brand));
}

// Serve one brand's view of a shared workbook's parse. The whole parse stays in KV (the Playbook,
// the cron warm and the due-today reminder all read it by sheet id); only the serve is split.
export function splitPlanCache(cached, brand, brands) {
  if (!cached || !Array.isArray(cached.tasks)) return cached;
  if (!brands || brands.length < 2) return cached;
  const mine = tasksForBrand(cached.tasks, brand);
  if (mine.length === cached.tasks.length) return cached;
  return Object.assign({}, cached, { tasks: mine, shared: brands.length, ofRows: cached.tasks.length });
}

// WHAT A NEW ROW WRITES INTO THE BRAND COLUMN. A task raised for ONE brand of a shared workbook
// is marked with that brand's token; a task for both is left BLANK, because blank already means
// both by Ray's own rule and inventing a joint token the sheet uses on six of 891 rows would be
// writing a convention nobody agreed.
export function appendToken(client, brands) {
  const list = brands || [];
  if (list.length < 2) return '';
  if (list.indexOf(client) < 0) return '';
  return brandToken(client, list);
}

// IS A NEW ROW ALREADY IN THE SHEET? On a shared workbook a row's identity is its task text AND
// whose work it is: Monsoon and Accessorize legitimately carry the same wording, so the existing
// task-text-only guard would skip the second brand's copy for ever. An existing row that names NO
// brand covers every brand, so it does cover this one. An existing one-brand row does NOT cover a
// joint row — that would silently drop the other brand's half, and the standing rule here is that
// a duplicate left showing twice is visible and one click to merge while swallowed work is not.
export function rowCovered(have, task, token) {
  const seen = have && have[task];
  if (!seen) return false;
  if (seen.any) return true;                 // a blank-brand row already covers every brand
  if (!token) return false;                  // this row is for both; a one-brand row is not it
  return !!(seen.tok && seen.tok[token]);
}
export function noteRow(have, task, token) {
  const seen = (have[task] = have[task] || { any: false, tok: {} });
  if (!token) seen.any = true; else seen.tok[token] = true;
}
