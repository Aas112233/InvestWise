const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

// lib/ included for route-adjacent helpers that produce response messages
// (e.g. lib/transaction-reversal.ts revertHint, lib/governance/*).
const files = [...walk('app/api'), ...walk('server/src'), ...walk('lib')];
const errors = {};       // class -> Map(msg -> Set(files))
const success = new Set();
const inline = new Set();
const templated = new Set();

const CLASSES = 'ValidationError|NotFoundError|ForbiddenError|ConflictError|AuthError|LockedError|AppError|ServiceUnavailableError';

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // 1) throw new XError('msg' [, 'CODE'])
  const reThrow = new RegExp("throw new (" + CLASSES + ")\\(\\s*(['\"])([\\s\\S]*?)\\2(?:\\s*,\\s*(['\"])([^'\"]+)\\4)?", 'g');
  let m;
  while ((m = reThrow.exec(src))) {
    const cls = m[1], msg = m[3], code = m[5] || '';
    if (!errors[cls]) errors[cls] = new Map();
    const key = msg + (code ? ' [' + code + ']' : '');
    if (!errors[cls].has(key)) errors[cls].set(key, new Set());
    errors[cls].get(key).add(f);
  }
  // 2) throw new XError(`tmpl ${x}`)
  const reThrowT = new RegExp("throw new (" + CLASSES + ")\\(`([^`]+)`", 'g');
  while ((m = reThrowT.exec(src))) {
    templated.add(m[1] + ': ' + m[2]);
  }
  // 3) message: '...' in JSON envelopes
  const reMsg = /message:\s*(['"])([^'"]{3,})\1/g;
  while ((m = reMsg.exec(src))) {
    const msg = m[2];
    const before = src.slice(Math.max(0, m.index - 120), m.index);
    if (/success:\s*false/.test(before)) inline.add(msg);
    else success.add(msg);
  }
  // 4) message: `tmpl` in JSON envelopes
  const reMsgT = /message:\s*`([^`]+)`/g;
  while ((m = reMsgT.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 120), m.index);
    if (/success:\s*false/.test(before)) templated.add('inline-error: ' + m[1]);
    else templated.add('success: ' + m[1]);
  }
  // 5) revertHint: the delete-refusal message thrown via variable
  //    (throw new ValidationError(reversal.revertHint!)). Audit-log `details`
  //    are NOT response messages and are deliberately not scanned.
  const reHint = /revertHint:\s*(['"])([^'"]{10,})\1/g;
  while ((m = reHint.exec(src))) {
    errors.ValidationError = errors.ValidationError || new Map();
    const key = m[2];
    if (!errors.ValidationError.has(key)) errors.ValidationError.set(key, new Set());
    errors.ValidationError.get(key).add(f);
  }
}

// Postgres error mappings (server/src/shared/errors.ts)
const PG_MAP = {
  '23505': ['409', 'DUPLICATE_KEY', 'A record with that value already exists (duplicate key).'],
  '23503': ['409', 'FK_VIOLATION', 'This action would violate a database relationship constraint.'],
  '23502': ['400', 'NOT_NULL_VIOLATION', 'A required field is missing (not-null violation).'],
  '23514': ['400', 'CHECK_VIOLATION', 'The value provided does not meet the required constraints.'],
  '22003': ['400', 'NUMERIC_OVERFLOW', 'A numeric value is out of range.'],
  '40001': ['503', 'TRANSACTION_CONFLICT', 'Database transaction conflict. Please retry.'],
  '40P01': ['503', 'DEADLOCK', 'Deadlock detected. Please retry.'],
  '08006': ['503', 'DB_CONNECTION_ERROR', 'Database connection lost. Please try again.'],
  '57014': ['504', 'QUERY_TIMEOUT', 'Database query timed out. Please try again.'],
};

// DB-mapped messages that leaked into the success/inline buckets — reclassify
const dbMessages = new Set(Object.values(PG_MAP).map((v) => v[2]));
dbMessages.add('An unexpected error occurred');

const lines = [];
const w = (s = '') => lines.push(s);

w('# InvestWise — API Response Message Catalog');
w('');
w('Generated from `app/api/**` + `server/src/**` (all route handlers and service throws).');
w('Source: `scripts/extract-api-messages.cjs`.');
w('');
w('## 1. Response envelope + error taxonomy');
w('');
w('Every response is `{ success, data?, message?, code? }`. Errors carry an HTTP status');
w('from the thrown error class (`lib/utils/errors.ts` for app routes,');
w('`server/src/shared/errors.ts` for finance-module routes — same taxonomy):');
w('');
w('| Class | Status | Code | Default message |');
w('|---|---|---|---|');
w('| ValidationError | 400 | VALIDATION_ERROR | (per-call) |');
w('| AuthError | 401 | UNAUTHORIZED | (per-call) |');
w('| ForbiddenError | 403 | FORBIDDEN | Insufficient permissions |');
w('| NotFoundError | 404 | NOT_FOUND | `<Resource> not found` |');
w('| ConflictError | 409 | CONFLICT | (per-call) |');
w('| LockedError | 423 | LOCKED | (per-call) |');
w('| ServiceUnavailableError | 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable |');
w('| AppError | 500 | INTERNAL_ERROR | (per-call) |');
w('');
w('Field-level validation errors follow AGENTS.md §11:');
w('`[Field \'<field>\', Code: <code>] <message>` — e.g.');
w('`[Field \'amount\', Code: too_small] Deposit amount must be a positive number`.');
w('');
w('**Postgres SQLSTATE → response mapping** (`normalizeError`, server/src/shared/errors.ts):');
w('');
w('| SQLSTATE | Status | Code | Message |');
w('|---|---|---|---|');
for (const [code, [status, c, msg]] of Object.entries(PG_MAP)) {
  w(`| ${code} | ${status} | ${c} | ${msg} |`);
}
w('| (unmapped) | 500 | INTERNAL_ERROR | An unexpected error occurred |');
w('');
w('---');
w('');

// Error classes
const classMeta = {
  ValidationError: ['400', 'Bad request — input validation'],
  AuthError: ['401', 'Authentication failure / session issues'],
  ForbiddenError: ['403', 'Permission denied'],
  NotFoundError: ['404', 'Resource not found'],
  ConflictError: ['409', 'State conflict / duplicate'],
  LockedError: ['423', 'Locked — immutable state'],
  AppError: ['varies', 'Explicit app-level error (status per call)'],
};

let sectionNo = 0;
for (const [cls, msgs] of Object.entries(errors)) {
  const [status, desc] = classMeta[cls] || ['?', ''];
  sectionNo += 1;
  let keys = [...msgs.keys()].sort();
  // NotFoundError(resource) renders as `${resource} not found`
  if (cls === 'NotFoundError') {
    keys = keys.map((k) => k.replace(/ \[[A-Z_]+\]$/, '') + ' not found').sort();
  }
  w(`## 2.${sectionNo} ${cls} — ${keys.length} unique messages (HTTP ${status})`);
  w('');
  w(`_${desc}_`);
  w('');
  for (const key of keys) {
    w(`- \`${key}\``);
  }
  w('');
}

w('---');
w('');
w(`## 3. Success response messages — ${success.size + [...templated].filter((t) => t.startsWith('success:')).length} unique`);
w('');
w('(2xx envelopes; DB-mapped messages excluded — see section 1.)');
w('');
const successClean = [...success].filter((s) => !dbMessages.has(s)).sort();
for (const s of successClean) w(`- ${s}`);
for (const t of [...templated].filter((t) => t.startsWith('success:')).sort()) {
  w(`- \`${t.slice('success: '.length)}\``);
}
w('');
w('---');
w('');
w(`## 4. Inline error envelopes (raw \`{ success: false, message }\` responses) — ${inline.size + [...templated].filter((t) => t.startsWith('inline-error:')).length} unique`);
w('');
w('These bypass the error classes and write the envelope directly (mostly');
w('auth guards, middleware, 501 stubs and catch-block fallbacks).');
w('');
for (const s of [...inline].filter((s) => !dbMessages.has(s)).sort()) w(`- ${s}`);
for (const t of [...templated].filter((t) => t.startsWith('inline-error:')).sort()) {
  w(`- \`${t.slice('inline-error: '.length)}\``);
}
w('');
w('---');
w('');
w(`## 5. Template-literal error throws — ${[...templated].filter((t) => !t.startsWith('success:') && !t.startsWith('inline-error:')).length} unique`);
w('');
w('Messages built with interpolation at throw time (rendered value varies):');
w('');
for (const t of [...templated].filter((t) => !t.startsWith('success:') && !t.startsWith('inline-error:')).sort()) {
  w(`- \`${t}\``);
}
w('');
w('---');
w('');
w('## 6. Observations');
w('');
w('- **§11 field-error format is used consistently** on validation paths:');
w('  `[Field \'<field>\', Code: <code>] <message>` (deposits, members, settings,');
w('  dividends, projects, auth). Plain-message ValidationErrors coexist with');
w('  them — the format is applied where a specific field is at fault.');
w('- **403 vocabulary is inconsistent** — three phrasings for the same concept:');
w('  `Read permission required for: <SCREEN>` / `Write permission required for:');
w('  <SCREEN>` (screen-permission guards), `Admin access required` / `Admin or');
w('  Manager access required` (role guards), and `Insufficient permissions to');
w('  <verb> <noun>` (meetings/governance). Worth converging on one pattern.');
w('- **NotFoundError is consistent**: `<Resource> not found`, resource named');
w('  per call site (23 resources). Two casing variants exist for the same');
w('  resource in transfer flows (`Source fund` vs `Source Fund`) — cosmetic.');
w('- **DB errors are deliberately generic** (9 SQLSTATE mappings in');
w('  `server/src/shared/errors.ts`); raw driver messages never reach clients.');
w('- **Success messages are human sentences**, uniformly phrased');
w('  (`<Verb>ed successfully`); a few carry extra guidance');
w('  (member soft-delete explains retention).');
w('- **Inline error envelopes (103)** bypass the error classes — mostly auth');
w('  guards, middleware (CSRF/401), 501 stubs (backup restore), and');
w('  catch-block fallbacks. Migrating them to the class taxonomy would');
w('  centralize status-code handling.');
w('- **Templated throws (26)** interpolate entity names/amounts into business');
w('  errors (insufficient balance, equity-transfer guards) — the richest');
w('  messages in the API.');
w('');

fs.writeFileSync('docs/API_RESPONSE_MESSAGES.md', lines.join('\n'));
const totalErrors = Object.values(errors).reduce((a, m) => a + m.size, 0);
console.log('written docs/API_RESPONSE_MESSAGES.md');
console.log('error classes:', totalErrors, '| success:', successClean.length + [...templated].filter(t=>t.startsWith('success:')).length,
  '| inline:', inline.size + [...templated].filter(t=>t.startsWith('inline-error:')).length,
  '| templated throws:', [...templated].filter(t=>!t.startsWith('success:')&&!t.startsWith('inline-error:')).length);
