// Full end-to-end sweep: login, then exercise every flow touched this session
// through the real HTTP surface the UI calls. Read-only where possible.
import postgres from 'postgres';
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const ok = (b) => (b ? 'PASS' : 'FAIL');
let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${ok(cond)}  ${label}`); };

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, cookies, jar: res.headers.getSetCookie?.() ?? [] };
}
async function GET(path, cookies) {
  const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookies } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
async function send(method, path, cookies, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookies, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

console.log('=== 1. LOGIN (admin) ===');
const admin = await login('admin@greenvalley.dev', 'pass-12345678');
check('admin login 200', admin.status === 200);
const A = admin.cookies;

console.log('\n=== 2. CORE PAGE DATA (every dashboard-relevant endpoint) ===');
const endpoints = [
  ['/api/analytics/stats', 'dashboard stats'],
  ['/api/analytics/analysis', 'analysis'],
  ['/api/members', 'members'],
  ['/api/funds', 'funds'],
  ['/api/deposits', 'deposits'],
  ['/api/transactions', 'transactions'],
  ['/api/projects', 'projects'],
  ['/api/goals', 'goals'],
  ['/api/expenses', 'expenses'],
  ['/api/fiscal/periods', 'fiscal periods'],
  ['/api/governance/leaderboard', 'leaderboard'],
  ['/api/audit', 'audit'],
  ['/api/settings', 'settings'],
];
for (const [path, label] of endpoints) {
  const r = await GET(path, A);
  check(`${label.padEnd(20)} ${path} -> ${r.status} success=${r.body?.success}`, r.status === 200 && r.body?.success !== false);
}

console.log('\n=== 3. NEW FEATURE: report viewer JSON (#32) ===');
for (const slug of ['comprehensive-ledger', 'funds-summary', 'member-contribution', 'revenue-analytics', 'expense-audit', 'project-performance']) {
  const r = await GET(`/api/reports/generate/${slug}?format=json&periodType=Yearly&fiscalYear=2026&locale=en`, A);
  const doc = r.body?.data;
  check(`${slug.padEnd(22)} rows=${String(doc?.rows?.length ?? '-').padStart(4)} cols=${doc?.columns?.length ?? '-'}`, r.status === 200 && !!doc && Array.isArray(doc.columns) && Array.isArray(doc.rows) && doc.columns.length > 0);
}

console.log('\n=== 4. NEW FEATURE: goal progress source (#48) ===');
{
  const r = await GET('/api/goals', A);
  const rows = r.body?.data ?? [];
  check(`goals expose progressSource (${rows.length} rows)`, rows.length > 0 && rows.every((g) => !!g.progressSource));
  check('all Manual by default', rows.every((g) => g.progressSource === 'Manual'));
}

console.log('\n=== 5. DB INTEGRITY (post-migration) ===');
const gv = (await sql`select id from tenants where name ilike '%green%'`)[0]?.id;
const col = await sql`select column_name, column_default from information_schema.columns where table_name='goals' and column_name='progress_source'`;
check('goals.progress_source column exists', col.length === 1);
const cons = await sql`select 1 from pg_constraint where conname='goals_progress_source_check'`;
check('goals_progress_source_check exists', cons.length === 1);
const dupRef = await sql`
  select reference_number, count(*)::int n from transactions
  where tenant_id=${gv} and is_deleted=false and reference_number is not null
  group by 1 having count(*) > 1 limit 5`;
check('no duplicate (tenant, reference) groups', dupRef.length === 0);
const orphan = await sql`
  select count(*)::int n from transactions t
  left join funds f on f.id=t.fund_id
  where t.tenant_id=${gv} and t.is_deleted=false and t.fund_id is not null and f.id is null`;
check('no transactions pointing at a missing fund', orphan[0].n === 0);

console.log('\n=== 6. TENANT ISOLATION (§6 fail-closed) ===');
const noTenant = await GET('/api/members', '');
check('no cookie -> not 200', noTenant.status !== 200);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
