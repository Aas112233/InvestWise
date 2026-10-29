// One-shot codemod (audit 07 M-3): rewrite the catch-block error passthrough
//   return NextResponse.json(
//     { success: false, message: <v>.message || 'Fallback' },
//     { status: <v>.statusCode || 500 }
//   );
// to the masking helper  `return apiError(<v>, 'Fallback');`
// and add the import. Only the exact 500-passthrough shape is rewritten:
// fixed-status responses, extra-field bodies, and non-error `.message`
// fields (parsed.message etc.) are left untouched and reported as leftovers.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'app/api');
const IMPORT_LINE = "import { apiError } from '@/lib/utils/api-error';";

const RE = /return NextResponse\.json\(\s*\{\s*success:\s*false,\s*message:\s*(err|e|error)\.message\s*(?:\|\|\s*(?:'([^']*)'|"([^"]*)"))?\s*,?\s*\}\s*,\s*\{\s*status:\s*\1\.statusCode\s*(?:\|\||\?\?)\s*500\s*,?\s*\}\s*,?\s*\);/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name === 'route.ts') out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let changedFiles = 0;
let totalReplacements = 0;
const noFallback = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = src.replace(RE, (m, v, sq, dq) => {
    count += 1;
    const fallback = sq !== undefined ? `'${sq}'` : dq !== undefined ? `"${dq}"` : null;
    if (fallback === null) noFallback.push(path.relative('.', file));
    return `return apiError(${v}, ${fallback ?? "'Request failed'"});`;
  });
  if (count === 0) continue;

  let withImport = next;
  if (!next.includes('api-error')) {
    const lines = withImport.split('\n');
    let lastImport = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (/^import .+;$/.test(lines[i]) || /^} from '.+';$/.test(lines[i])) lastImport = i;
    }
    if (lastImport >= 0) lines.splice(lastImport + 1, 0, IMPORT_LINE);
    else lines.unshift(IMPORT_LINE);
    withImport = lines.join('\n');
  }

  fs.writeFileSync(file, withImport);
  changedFiles += 1;
  totalReplacements += count;
}

console.log(`files changed: ${changedFiles}, catch blocks rewritten: ${totalReplacements}`);
if (noFallback.length) console.log(`blocks with no fallback text (generic 'Request failed' used) in ${noFallback.length} place(s)`);

// Leftover scan: any remaining statusCode-500 passthrough shapes for manual review.
const leftoverRe = /(err|e|error)\.statusCode\s*(?:\|\||\?\?)\s*500/g;
const leftovers = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(leftoverRe);
  if (hits) leftovers.push(`${path.relative('.', file)} (${hits.length})`);
}
console.log('leftover statusCode-500 passthrough sites for manual review:');
for (const l of leftovers) console.log('  ' + l);
