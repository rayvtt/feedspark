/**
 * tools/test_instr.mjs — the ⓘ that hides the explainer prose.
 *
 * Ray, 17 Sep 2026, crossing out the verdict under a chart and the caveat under the displacement
 * card: "the red-crossed text is not needed at all - so hide it (same thing for rest of FCC
 * module) in a [i] icon".
 *
 * The FCC already had this layer for instructional subtext; what it could not do was carry the
 * lines Ray crossed out. Three things decide whether it reads as one control or as clutter, and
 * all three are pinned here:
 *
 *   1. ONE ⓘ PER CARD. A card whose verdict and its caveat are two elements would otherwise grow
 *      two toggles in one header.
 *   2. A STABLE KEY. These lines carry live numbers, so the old text hash minted a new key on
 *      every render and the remembered state was lost the moment a figure moved.
 *   3. THE STATE IS RE-APPLIED, not set once. A card that re-renders replaces these elements, and
 *      a new node without the class comes back visible — which is exactly the text he crossed out
 *      reappearing on the next keystroke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const W = fs.readFileSync(path.join(ROOT, 'docs', 'instr_collapse.html'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  x ' + m); } };

console.log('-- the widget: one toggle per card, on the card\'s own heading');
ok(/\[data-instr\]/.test(W),
  'a page marks a line for collapse with data-instr — an explicit opt-in, not a blanket class '
  + 'sweep that would also hide Feed Chat\'s answer, which IS the reply to a question');
ok(/function box\(el\)\{[\s\S]{0,160}closest\('section,\.card,header,article'\)/.test(W),
  'collapsible lines are grouped by the card they sit in');
ok(/if\(!c\.__instrBtn\)mount\(c,el\);/.test(W) && /c\.__instrBtn=b;/.test(W),
  'so a card grows exactly one toggle, however many lines it carries');
ok(/var h=head\(c\);\n  if\(h\)h\.appendChild\(b\);/.test(W),
  'and it rides that card\'s heading rather than sitting on its own line');
ok(/function head\(c\)\{[\s\S]{0,200}box\(h\)===c\?h:null/.test(W),
  'a heading belonging to something nested deeper inside the card is not borrowed for it');
ok(/its own function, because a handler closing over a loop's `var` would see the LAST card/.test(W),
  'the click handler is mounted in its own function — a closure over the loop variable would '
  + 'have made every toggle operate the last card on the page');

console.log('-- the key is stable, because the text is not');
ok(/function keyOf\(c,el\)\{[\s\S]{0,200}c\.id\|\|\(head\(c\)/.test(W),
  'the remembered key is the card\'s id or its heading — never the prose, which carries live '
  + 'numbers and would mint a new key on every render');
ok(/location\.pathname\+'#'\+base/.test(W), 'and it is scoped to the page, so two modules never collide');
ok(!/var id=hash\(txt\)/.test(W), 'the old text-hash key is gone');
ok(/localStorage/.test(W) && /fcc-instr-open/.test(W),
  'open blocks are remembered per DEVICE — what one screen has been shown is not a team fact');

console.log('-- a re-render must not bring the hidden text back');
ok(/\/\/ re-applied on every pass, not just at birth/.test(W) && /state\(c,!!open\[c\.__instrKey\]\);/.test(W),
  'every pass re-applies the group\'s state to whatever nodes are there now');
ok(/function state\(c,on\)\{[\s\S]{0,200}classList\.toggle\('instr-hide',!on\)/.test(W),
  'and the state is the one class the CSS acts on');
ok(/new MutationObserver/.test(W), 'late-rendered content still gets its toggle');
ok(/data-no-collapse/.test(W), 'and any single line can opt out of the whole mechanism');

console.log('-- the lines Ray crossed out, and their siblings across the FCC');
const TM = read('FeedSpark_TaskManager.html');
ok(/id="dpverdict" data-instr/.test(TM), 'Task Manager: the displacement verdict collapses');
ok(/id="dpcov" data-instr/.test(TM), 'Task Manager: and the coverage caveat under it');
ok(/id="cverdict" data-instr/.test(TM), 'Task Manager: and the chart\'s verdict line');
ok(/<ol data-instr>/.test(read('FeedSpark_Volume.html')),
  'Volume: "How these volume movements are tracked" collapses');
ok(/<ol data-instr>/.test(read('FeedSpark_Overlays.html')),
  'Overlays: "How overlays are detected" collapses');
ok(/<ol data-instr>/.test(read('FeedSpark_Schedule.html')),
  'Schedule: "How the skip cadence is counted" collapses');
ok(/class="ch" style="margin:0" data-instr/.test(read('FeedSpark_AIQuote.html')),
  'AI Quote: "How the numbers work" collapses');

// what must NOT be swept up: the chatbot's verdict is the answer to the question asked
ok(!/data-instr/.test(read('FeedSpark_FeedChat.html')),
  'Feed Chat\'s .verdict is the ANSWER, not an explainer — nothing there is collapsed, which is '
  + 'why the opt-in is explicit rather than a class-wide rule');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
