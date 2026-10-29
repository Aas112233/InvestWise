// Second-pass codemod (audit 07 M-3): same rewrite as codemod-api-error.mjs
// but for catch shapes that carry an extra `code:` field or a variable
// fallback — payouts family, fiscal helpers, members/me + members/[id].
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'app/api');
const IMPORT_LINE = "import { apiError } from '@/lib/utils/api-error';";

const RE = /return NextResponse\.json\(\s*\{\s*success:\s*false,\s*message:\s*(err|e|error)\.message\s*\|\|\s*('([^']*)'|"([^"]*)"|[a-zA-Z_$][\w$]*)\s*(?:,\s*code:\s*\1\.code(?:\s*(?:\?\?|\|\|)\s*'[^']*')?)?\s*,?\s*\}\s*,\s*\{\s*status:\s*\1\.statusCode\s*(?:\|\||\?\?)\s*500\s*,?\s*\}\s*,?\s*\);/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name === 'route.ts') out.push(p);
  }
  return out;
}

let changedFiles = 0;
let total = 0;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  let count = 0;
  const next = src.replace(RE, (m, v, fallback) => {
    count += 1;
    return `return apiError(${v}, ${fallback});`;
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
  total += count;
  console.log(`rewrote ${count} in ${path.relative('.', file)}`);
}
console.log(`files changed: ${changedFiles}, catch blocks rewritten: ${total}`);

// Final leftover scan.
const leftoverRe = /(err|e|error)\.statusCode\s*(?:\|\||\?\?)\s*500/g;
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(leftoverRe);
  if (hits) console.log(`leftover: ${path.relative('.', file)} (${hits.length})`);
}
