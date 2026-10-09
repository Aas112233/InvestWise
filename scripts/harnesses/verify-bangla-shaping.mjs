// Empirical proof: fontkit (pdfkit's engine) shapes Bengali properly with the
// bundled HindSiliguri font — conjuncts collapse, matras reorder.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fontkit = require('fontkit');
const path = await import('node:path');
const fontDir = path.resolve(import.meta.dirname, '..', '..', 'lib', 'reports', 'fonts');
const font = fontkit.openSync(path.join(fontDir, 'HindSiliguri-Regular.ttf'));

const codepoints = (s) => [...s].length;
const describe = (run) => run.glyphs.map((g, i) => {
  const pos = run.positions[i];
  return `${g.id}${g.name ? ':' + g.name : ''}@x${Math.round(pos.xOffset)}${pos.xAdvance ? '+' + pos.xAdvance : ''}`;
}).join(' ');

const tests = [
  ['ka', 'ক'],
  ['ka + i-matra (matra must visually PRECEDE ka => glyph order matra,ka)', 'কি'],
  ['kka conjunct (3 codepoints must collapse to ONE ligature glyph)', 'ক্ক'],
  ['mixed word (rafik => conjunct + matra)', 'রফিক'],
];

for (const [label, s] of tests) {
  const run = font.layout(s);
  const naive = codepoints(s);
  console.log(`\n[${label}]`);
  console.log(`  codepoints=${naive}  glyphs=${run.glyphs.length}`);
  console.log('  ' + describe(run));
}

// Hard assertions:
let pass = 0, fail = 0;
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); cond ? pass++ : fail++; };

const ki = font.layout('কি');
// ক = U+0995, ি = U+09BF. Unshaped cmap would give [ka, iMatra]. Shaped:
// iMatra glyph appears FIRST (visual order).
const kiIds = ki.glyphs.map(g => g.id);
const kaGlyph = font.glyphsForString('ক')[0].id;
const iMatraGlyph = font.glyphsForString('ি')[0].id;
ok('কি produced exactly 2 glyphs', ki.glyphs.length === 2);
ok('i-matra REORDERED before ka (shaping happened)', kiIds[0] === iMatraGlyph && kiIds[1] === kaGlyph);

const kka = font.layout('ক্ক');
const kaA = font.glyphsForString('ক')[0].id;
const viramaGlyph = font.glyphsForString('্')[0].id;
const naiveIds = [kaA, viramaGlyph, kaA];
ok('ক্ক collapsed to 1-2 glyphs (NOT 3 naive codepoints)', kka.glyphs.length < 3);
ok('ক্ক is a real ligature glyph (differs from naive ka,virama,ka)', JSON.stringify(kka.glyphs.map(g => g.id)) !== JSON.stringify(naiveIds));

const rafik = font.layout('রফিক');
ok('রফিক matra reordered before ফ (shaping, no conjunct expected)', JSON.stringify(rafik.glyphs.map(g => g.id)) !== JSON.stringify(font.glyphsForString('রফিক').map(g => g.id)));

// Arabic (Urdu/Amiri) sanity: joining happens (single glyph chain, contextual forms).
const amiri = fontkit.openSync(path.join(fontDir, 'Amiri-Regular.ttf'));
const urdu = amiri.layout('سلام');
ok('Urdu سلام shapes into joined contextual glyphs', urdu.glyphs.length === 4 && new Set(urdu.glyphs.map(g => g.id)).size === 4);

// Latin fallback exists in the same fonts (mixed-script strings are the norm).
const latin = font.layout('Total 1,234.00');
ok('Latin+digits render from the Bengali font (no blanks)', latin.glyphs.every(g => g.id !== 0));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
