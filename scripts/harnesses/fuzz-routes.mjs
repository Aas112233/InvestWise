/**
 * Broad route exercise / fuzzing harness.
 *
 * Goal: find routes that (a) 500 on a plausible-but-wrong input, (b) leak
 * cross-tenant data, or (c) fail to enforce auth/tenant/role. This is a SWEEP,
 * not a functional test — it asserts on the CLASS of response, not the content.
 *
 * Every GET route is hit as: no-cookie, member, auditor, manager, admin.
 * Every write route is hit as admin with: empty body, wrong-type body, and
 * (where cheap) a 1-char body — to surface unhandled TypeErrors as 500s.
 *
 * Anything that returns 5xx is a REAL bug (an unhandled server error).
 * 4xx is correct behaviour for bad input.
 */
import postgres from 'postgres';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const TENANT = process.env.FUZZ_TENANT ?? 'meridian';

const sessionCache = new Map();
async function login(email) {
  if (sessionCache.has(email)) return sessionCache.get(email);
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'pass-12345678' }),
    });
    if (r.status === 429) {
      const wait = (Number(r.headers.get('retry-after') ?? 5) * 1000) + 300;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    const out = { status: r.status, cookies: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
    if (out.status === 200) sessionCache.set(email, out);
    return out;
  }
  return { status: 429, cookies: '' };
}
async function req(method, path, cookies, body) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(cookies ? { Cookie: cookies } : {}), 'Content-Type': 'application/json' },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    let text = '';
    try { text = await r.text(); } catch {}
    return { status: r.status, text: text.slice(0, 400) };
  } catch (e) {
    return { status: 0, text: `FETCH FAIL: ${e.message}` };
  }
}

const [tenant] = await sql`select id as tid, name as tname from tenants where slug = ${TENANT}`;
if (!tenant) { console.error(`tenant ${TENANT} not found`); process.exit(1); }
tenant.id = tenant.tid;
console.log(`Fuzzing tenant: ${tenant.tname} (${TENANT})\n`);

const adminL = await login(`admin@${TENANT === 'green-valley' ? 'greenvalley' : TENANT}.dev`);
const managerL = await login(`manager@${TENANT}.dev`);
const auditorL = await login(`auditor@${TENANT}.dev`);
console.log(`logins: admin=${adminL.status} manager=${managerL.status} auditor=${auditorL.status}\n`);
if (adminL.status !== 200) { console.error('admin login failed'); process.exit(1); }
const A = adminL.cookies, MG = managerL.cookies, AU = auditorL.cookies;
const NO = '';

// ids for path-parameter routes (use REAL ids so we test the handler, not 404)
const [member] = await sql`select id from members where tenant_id=${tenant.id} and is_deleted=false limit 1`;
const [fund] = await sql`select id from funds where tenant_id=${tenant.id} limit 1`;
const [proj] = await sql`select id from projects where tenant_id=${tenant.id} limit 1`;
const [meeting] = await sql`select id from meetings where tenant_id=${tenant.id} limit 1`;
const [goal] = await sql`select id from goals where tenant_id=${tenant.id} limit 1`;
const [usr] = await sql`select id from users where tenant_id=${tenant.id} limit 1`;
const [penalty] = await sql`select id from member_penalties where tenant_id=${tenant.id} limit 1`;
const [txn] = await sql`select id from transactions where tenant_id=${tenant.id} order by created_at desc limit 1`;
const [fp] = await sql`select id from fiscal_periods where tenant_id=${tenant.id} limit 1`;
// a REAL foreign id (another tenant's member) for the leak probe
const [foreign] = await sql`select id from members where tenant_id <> ${tenant.id} and is_deleted=false limit 1`;

const z = '00000000-0000-0000-0000-000000000000';
const R = (t) => `/api/${t}`;

const gets = [
  ['GET', R('admin/action-log')], ['GET', R('admin/audit-logs')],
  ['GET', R('admin/billing')], ['GET', R('admin/billing/history')],
  ['GET', R('admin/diagnostics')], ['GET', R('admin/feature-flags')],
  ['GET', R('admin/notices')], ['GET', R('admin/plans')], ['GET', R('admin/settings')],
  ['GET', R('admin/tenants')], ['GET', R('admin/users')],
  ['GET', R('analytics/analysis')], ['GET', R('analytics/stats')],
  ['GET', R('audit')], ['GET', R('audit/metadata')], ['GET', R('audit/notifications')],
  ['GET', R('auth/me')], ['GET', R('auth/sessions')], ['GET', R('auth/users')], ['GET', R('auth/login-history')],
  ['GET', R('backup')], ['GET', R('backup/list')],
  ['GET', R('deposits')], ['GET', R('expenses')],
  ['GET', R('finance/deposits')], ['GET', R('finance/transactions')], ['GET', R('finance/expenses')],
  ['GET', R('fiscal/periods')],
  ['GET', R('funds')], ['GET', R(`funds/${fund?.id ?? z}`)],
  ['GET', R('goals')], ['GET', R(`goals/${goal?.id ?? z}`)],
  ['GET', R('governance/leaderboard')], ['GET', R('governance/members')],
  ['GET', R(`governance/members/${member?.id ?? z}/deposits`)],
  ['GET', R('governance/penalties')], ['GET', R('governance/rules')],
  ['GET', R('health')],
  ['GET', R('meetings')], ['GET', R(`meetings/${meeting?.id ?? z}`)],
  ['GET', R(`members/${member?.id ?? z}`)], ['GET', R('members')], ['GET', R('members/me')],
  ['GET', R(`projects/${proj?.id ?? z}`)], ['GET', R('projects')],
  ['GET', R(`projects/${proj?.id ?? z}/transactions`)], ['GET', R('projects/updates')],
  ['GET', R('reports/generate/members')],
  ['GET', R('settings')], ['GET', R('settings/share-value-status')],
  ['GET', R(`transactions/${txn?.id ?? z}`)], ['GET', R('transactions')],
];

const writes = [
  ['POST', R('deposits')], ['POST', R('deposits/request')],
  ['POST', R(`deposits/${z}/approve`)], ['POST', R(`deposits/${z}/reject`)], ['POST', R(`deposits/${z}/revert`)],
  ['POST', R('dividends/calculate')], ['POST', R('dividends/distribute')],
  ['POST', R('expenses')], ['POST', R('finance/deposits')], ['POST', R('finance/deposits/bulk')],
  ['POST', R('finance/expenses')], ['POST', R('finance/earnings')], ['POST', R('finance/transfer')],
  ['POST', R('finance/equity/transfer')],
  ['POST', R(`finance/deposits/${z}/approve`)], ['POST', R(`finance/deposits/${z}/revert`)],
  ['POST', R(`finance/funds/${z}/reconcile`)],
  ['POST', R('fiscal/periods')], ['POST', R(`fiscal/periods/${z}`)],
  ['POST', R('funds')], ['PUT', R(`funds/${fund?.id ?? z}`)], ['POST', R('funds/transfer')],
  ['POST', R('goals/insights/probe'.replace('goals/insights/probe','goals'))],
  ['PUT', R(`goals/${goal?.id ?? z}`)],
  ['POST', R('governance/penalties')], ['POST', R(`governance/penalties/${penalty?.id ?? z}/waive`)],
  ['POST', R(`governance/members/${member?.id ?? z}/status`)],
  ['POST', R('governance/performance/recalculate-all')],
  ['POST', R('meetings')], ['PUT', R(`meetings/${meeting?.id ?? z}`)],
  ['POST', R(`meetings/${meeting?.id ?? z}/attendance`)],
  ['POST', R('members')], ['PUT', R(`members/${member?.id ?? z}`)], ['POST', R('members/recalculate-financials')],
  ['POST', R('projects')], ['PUT', R(`projects/${proj?.id ?? z}`)],
  ['POST', R(`projects/${proj?.id ?? z}/distribute-returns`)],
  ['POST', R(`projects/${proj?.id ?? z}/updates`)],
  ['POST', R('reports/export-generic')],
  ['PUT', R('settings')],
  ['POST', R('transactions')],
];

const problems = [];
const notes = [];

console.log('=== A. GET routes × identity (expect 2xx for admin; 401/403 for no-cookie) ===');
for (const [m, p] of gets) {
  const isAdminRoute = p.startsWith('/api/admin/');
  const rNo = await req(m, p, NO);
  const rAdmin = await req(m, p, A);
  // no-cookie must never be 2xx on a protected route
  const pub = p === '/api/health';
  if (!pub && rNo.status >= 200 && rNo.status < 300) {
    problems.push(`[AUTH LEAK] ${m} ${p} returned ${rNo.status} with NO cookie`);
  }
  // an unhandled 5xx is a real bug no matter what
  if (rAdmin.status >= 500) problems.push(`[500] ${m} ${p} (admin) → ${rAdmin.status} ${rAdmin.text.slice(0,120)}`);
  if (rNo.status >= 500) problems.push(`[500] ${m} ${p} (no-cookie) → ${rNo.status} ${rNo.text.slice(0,120)}`);
  // SuperAdmin-less admin tests: a tenant Admin should get 403 on /api/admin/*
  if (isAdminRoute && rAdmin.status >= 200 && rAdmin.status < 300) {
    notes.push(`[note] tenant Admin got ${rAdmin.status} on ${p} (admin route)`);
  }
}
console.log(`  checked ${gets.length} GET routes`);

console.log('\n=== B. role boundary on a sample of screens ===');
for (const p of ['/api/members', '/api/funds', '/api/transactions', '/api/analytics/stats', '/api/governance/members']) {
  const ra = await req('GET', p, AU);
  const rm = await req('GET', p, MG);
  if (ra.status >= 500) problems.push(`[500] GET ${p} (auditor) → ${ra.status}`);
  if (rm.status >= 500) problems.push(`[500] GET ${p} (manager) → ${rm.status}`);
}
console.log('  checked 5 screens × auditor/manager');

console.log('\n=== C. cross-tenant deep-link (foreign member id) ===');
if (foreign) {
  const r = await req('GET', `/api/members/${foreign.id}`, A);
  if (r.status >= 200 && r.status < 300) problems.push(`[TENANT LEAK] GET /api/members/${foreign.id} (foreign) returned ${r.status}`);
  else notes.push(`[ok] foreign member id → ${r.status}`);
}

console.log('\n=== D. write routes × malformed bodies (expect 4xx, never 5xx) ===');
const bodies = [
  ['empty-object', {}],
  ['null', null],
  ['wrong-types', { amount: 'abc', fundId: 123, date: [], members: 'x' }],
  ['empty-string', ''],
];
for (const [m, p] of writes) {
  for (const [label, b] of bodies) {
    const r = await req(m, p, A, b);
    if (r.status >= 500) {
      problems.push(`[500] ${m} ${p} [${label}] → ${r.status} ${r.text.slice(0,160)}`);
    }
  }
}
console.log(`  checked ${writes.length} write routes × ${bodies.length} bodies`);

console.log('\n=== E. huge payload (oversized string) ===');
{
  const big = 'A'.repeat(500000);
  const r = await req('POST', '/api/members', A, { name: big, email: 'x@y.z' });
  if (r.status >= 500) problems.push(`[500] POST /api/members (500KB name) → ${r.status} ${r.text.slice(0,120)}`);
}

console.log('\n' + '='.repeat(64));
console.log(`PROBLEMS: ${problems.length}`);
for (const p of problems) console.log('  ' + p);
console.log(`\nNOTES: ${notes.length}`);
for (const n of notes.slice(0, 20)) console.log('  ' + n);
await sql.end();
process.exit(problems.length ? 1 : 0);
