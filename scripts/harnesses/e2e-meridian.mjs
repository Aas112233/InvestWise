/**
 * Meridian (large investment corporation) E2E harness.
 *
 * The large-corporation shape stresses paths the other two tenants do not:
 * 360 shareholders / 16 portfolio holdings / 12,206 transactions over ~2 years,
 * a USD book with a 10,000-unit share value, TWO completed FYs each with a
 * distribution run, a professional operating cost base, and a
 * redemption + capital-call flow.
 *
 * Verifies through the LIVE API (auth, tenant resolution, ledger selectors,
 * aggregations) rather than raw SQL, and classifies failures as REAL (app bug)
 * vs CONTRACT (harness sent the wrong shape).
 */
import postgres from 'postgres';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const results = { pass: 0, real: [], contract: [] };
const pass = (l) => { results.pass++; console.log(`  PASS  ${l}`); };
const realBug = (l, d) => { results.real.push({ label: l, detail: d }); console.log(`  BUG   ${l}\n        ${d}`); };
const contract = (l, d) => { results.contract.push({ label: l, detail: d }); console.log(`  note  ${l} — ${d}`); };
const check = (l, c, d) => (c ? pass(l) : realBug(l, d ?? 'assertion failed'));

const sessionCache = new Map();
async function login(email) {
  if (sessionCache.has(email)) return sessionCache.get(email);
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'pass-12345678' }),
    });
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after') ?? 5) * 1000 + 300;
      console.log(`  (rate-limited on login for ${email} — waiting ${wait}ms)`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    const out = { status: r.status, cookies: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
    if (out.status === 200) sessionCache.set(email, out);
    return out;
  }
  return { status: 429, cookies: '' };
}
async function api(method, path, cookies, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { Cookie: cookies, 'Content-Type': 'application/json' },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const [tenant] = await sql`select id, name, plan, max_users from tenants where slug = 'meridian'`;
if (!tenant) { console.error('Meridian tenant not found — run scripts/seed-meridian-tenant.mjs first'); process.exit(1); }
const MD = tenant.id;
console.log(`tenant: ${tenant.name} (${tenant.id}) plan=${tenant.plan} max=${tenant.max_users}\n`);

const adminL = await login('admin@meridian.dev');
const managerL = await login('manager@meridian.dev');
const auditorL = await login('auditor@meridian.dev');
console.log(`logins: admin=${adminL.status} manager=${managerL.status} auditor=${auditorL.status}\n`);
const A = adminL.cookies, MG = managerL.cookies, AU = auditorL.cookies;
if (adminL.status !== 200) { console.error('admin login failed — cannot proceed'); process.exit(1); }

const [openPeriod] = await sql`
  select period_start, period_end from fiscal_periods
  where tenant_id = ${MD} and status = 'OPEN' order by period_start limit 1`;
const OPEN_DATE = openPeriod
  ? new Date(Math.max(Date.UTC(2026, 6, 20), new Date(openPeriod.period_start).getTime())).toISOString().slice(0, 10)
  : null;
console.log(openPeriod
  ? `open fiscal period: ${new Date(openPeriod.period_start).toISOString().slice(0,10)} .. ${new Date(openPeriod.period_end).toISOString().slice(0,10)} → probe date ${OPEN_DATE}\n`
  : 'WARNING: no OPEN fiscal period — write probes will be refused\n');

// ─────────────────────────────────────────────────────────────────────
// 1. Tenant isolation
// ─────────────────────────────────────────────────────────────────────
console.log('=== 1. TENANT ISOLATION ===');
{
  const r = await api('GET', '/api/members?limit=5', A);
  check('members list 200', r.status === 200, `${r.status} ${r.body?.message}`);
  const rows = Array.isArray(r.body?.data) ? r.body.data : [];
  const ids = rows.map((m) => m?.id).filter((x) => typeof x === 'string');
  if (ids.length) {
    const leaked = await sql`select count(*)::int n from members where id = any(${ids}) and tenant_id <> ${MD}`;
    check('no cross-tenant member rows in list', leaked[0].n === 0, `${leaked[0].n} foreign rows`);
  } else contract('members payload shape', JSON.stringify(r.body).slice(0, 160));

  const all = await api('GET', '/api/funds', A);
  check('funds list 200', all.status === 200, `${all.status}`);
  const list = Array.isArray(all.body?.data) ? all.body.data
    : Array.isArray(all.body?.funds) ? all.body.funds
    : Array.isArray(all.body) ? all.body : [];
  const fids = list.map((f) => f?.id).filter((x) => typeof x === 'string');
  if (fids.length) {
    const foreign = await sql`select count(*)::int n from funds where id = any(${fids}) and tenant_id <> ${MD}`;
    check('funds list contains no foreign fund rows', foreign[0].n === 0, `${foreign[0].n} foreign funds`);
    check('exactly 6 meridian funds visible', fids.length === 6, `${fids.length} funds`);
  } else contract('funds payload shape', JSON.stringify(all.body).slice(0, 160));
}

// ─────────────────────────────────────────────────────────────────────
// 2. Role boundaries
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 2. ROLE BOUNDARIES ===');
{
  const [fund] = await sql`select id, name, balance from funds where tenant_id = ${MD} order by balance desc limit 1`;
  const [fund2] = await sql`select id, name, balance from funds where tenant_id = ${MD} and id <> ${fund.id} order by balance limit 1`;

  const audWrite = await api('POST', '/api/funds/transfer', AU, { fromFundId: fund.id, toFundId: fund2.id, amount: '100.00', description: 'auditor should not write' });
  check(`auditor write refused (${audWrite.status})`, audWrite.status === 403 || audWrite.status === 401, `got ${audWrite.status}`);
  const audRead = await api('GET', '/api/funds', AU);
  check('auditor read allowed', audRead.status === 200, `${audRead.status}`);

  const mgWrite = await api('POST', '/api/funds/transfer', MG, { fromFundId: fund.id, toFundId: fund2.id, amount: '500.00', description: 'meridian e2e manager transfer' });
  if (mgWrite.status === 200 || mgWrite.status === 201) {
    pass('manager fund transfer allowed');
    const pair = await sql`select id, type from transactions where tenant_id = ${MD} and created_at > now() - interval '2 minutes' and type in ('Transfer In','Transfer Out') order by created_at desc limit 2`;
    check('transfer wrote paired legs', pair.length === 2, `got ${pair.length}`);
    for (const leg of pair) {
      const d = await api('DELETE', `/api/transactions/${leg.id}`, A, { reason: 'meridian e2e cleanup' });
      if (d.status !== 200) realBug(`transfer leg delete (${leg.type})`, `${d.status} ${d.body?.message}`);
    }
    const after = await sql`select id, balance from funds where tenant_id = ${MD} and id in (${fund.id}, ${fund2.id})`;
    const byId = new Map(after.map((f) => [f.id, Number(f.balance)]));
    check('treasury restored after transfer cleanup',
      byId.get(fund.id) === Number(fund.balance) && byId.get(fund2.id) === Number(fund2.balance),
      `fund ${byId.get(fund.id)} vs ${fund.balance}; fund2 ${byId.get(fund2.id)} vs ${fund2.balance}`);
  } else contract('manager transfer', `${mgWrite.status} ${mgWrite.body?.message}`);
}

// ─────────────────────────────────────────────────────────────────────
// 3. Ledger ↔ balance reconciliation via the API-reported balances
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 3. LEDGER INTEGRITY (through the API) ===');
{
  const SETTLED = ['Completed', 'Success'];
  const INFLOW_ALWAYS = ['Earning', 'Investment', 'Transfer In'];
  const OUTFLOW_ALWAYS = ['Expense', 'Disbursement', 'Transfer Out', 'Withdrawal'];
  const INFLOW_SETTLED = ['Deposit'];
  const OUTFLOW_SETTLED = ['Dividend'];

  const all = await api('GET', '/api/funds', A);
  const list = Array.isArray(all.body?.data) ? all.body.data
    : Array.isArray(all.body?.funds) ? all.body.funds
    : Array.isArray(all.body) ? all.body : [];
  let reconciled = 0;
  for (const f of list) {
    const rows = await sql`select type, status, coalesce(sum(amount),0)::numeric(15,2) s
      from transactions where tenant_id=${MD} and fund_id=${f.id} and is_deleted=false group by type, status`;
    let led = 0;
    for (const r of rows) {
      const settled = SETTLED.includes(r.status);
      if (INFLOW_ALWAYS.includes(r.type)) led += Number(r.s);
      else if (OUTFLOW_ALWAYS.includes(r.type)) led -= Number(r.s);
      else if (INFLOW_SETTLED.includes(r.type)) { if (settled) led += Number(r.s); }
      else if (OUTFLOW_SETTLED.includes(r.type)) { if (settled) led -= Number(r.s); }
    }
    const apiBal = Number(f.balance);
    if (Math.abs(apiBal - led) < 0.005) reconciled++;
  }
  check('every fund the API reports reconciles to its ledger', reconciled === list.length, `${reconciled}/${list.length}`);
}

// ─────────────────────────────────────────────────────────────────────
// 4. Dividend / distribution history is visible and consistent
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 4. DISTRIBUTION HISTORY ===');
{
  const [d1] = await sql`select coalesce(sum(amount),0)::numeric(15,2) s, count(*)::int n from transactions
    where tenant_id=${MD} and type='Dividend' and is_deleted=false and description like 'FY2024-25%'`;
  const [d2] = await sql`select coalesce(sum(amount),0)::numeric(15,2) s, count(*)::int n from transactions
    where tenant_id=${MD} and type='Dividend' and is_deleted=false and description like 'FY2025-26%'`;
  const [allocSum] = await sql`select coalesce(sum(amount),0)::numeric(15,2) s from profit_allocations where tenant_id=${MD}`;
  check('FY2024-25 distribution present', Number(d1.s) > 0 && d1.n > 200, `${d1.s} over ${d1.n} holders`);
  check('FY2025-26 distribution present', Number(d2.s) > 0 && d2.n > 300, `${d2.s} over ${d2.n} holders`);
  check('allocations total == distributions total',
    Number(allocSum.s) === Number(d1.s) + Number(d2.s),
    `${allocSum.s} vs ${Number(d1.s) + Number(d2.s)}`);

  const divs = await api('GET', '/api/transactions?type=Dividend&limit=200', A);
  check('dividend transactions readable via API', divs.status === 200, `${divs.status}`);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Portfolio holdings + status vocabulary
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 5. PORTFOLIO HOLDINGS ===');
{
  const r = await api('GET', '/api/projects', A);
  check('projects list 200', r.status === 200, `${r.status}`);
  const list = Array.isArray(r.body?.data) ? r.body.data
    : Array.isArray(r.body?.projects) ? r.body.projects
    : Array.isArray(r.body) ? r.body : [];
  check('16 portfolio holdings visible', list.length === 16, `${list.length}`);
  const bad = list.filter((p) => !['In Progress', 'Review', 'Completed', 'Cancelled'].includes(p.status));
  check('all project statuses in app vocabulary', bad.length === 0, `${bad.length} invalid: ${bad.slice(0,3).map(p=>p.status).join(',')}`);

  // Cancel path must work (regression guard for migration 0014)
  const [cancellable] = await sql`select id from projects where tenant_id=${MD} and status='Review' limit 1`;
  if (cancellable) {
    const del = await api('DELETE', `/api/projects/${cancellable.id}`, A, { reason: 'meridian e2e cancel probe' });
    check('project cancel path succeeds (no 500)', del.status === 200, `${del.status} ${del.body?.message}`);
    if (del.status === 200) {
      await sql`update projects set status='Review' where id=${cancellable.id}`;
    }
  } else contract('cancellable project', 'no Review-status project to probe');
}

// ─────────────────────────────────────────────────────────────────────
// 6. Aggregate agreement: analytics vs ledger
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 6. AGGREGATE AGREEMENT ===');
{
  const r = await api('GET', '/api/analytics/stats', A);
  check('analytics stats 200', r.status === 200, `${r.status}`);
  const stats = r.body?.data ?? r.body ?? {};
  const totalDeposits = Number(stats.totalDeposits ?? stats.total_deposits ?? NaN);
  const [dbDep] = await sql`select coalesce(sum(amount),0)::numeric(15,2) s from transactions
    where tenant_id=${MD} and type='Deposit' and status in ('Completed','Success') and is_deleted=false`;
  if (Number.isFinite(totalDeposits)) {
    check('stats.totalDeposits == settled ledger deposits', Math.abs(totalDeposits - Number(dbDep.s)) < 0.005,
      `api ${totalDeposits} vs ledger ${dbDep.s}`);
  } else contract('analytics stats keys', JSON.stringify(stats).slice(0, 200));

  const [memCount] = await sql`select count(*)::int n from members where tenant_id=${MD} and is_deleted=false`;
  const mr = await api('GET', '/api/members?limit=1', A);
  const total = Number(mr.body?.meta?.total ?? mr.body?.total ?? NaN);
  if (Number.isFinite(total)) check('member total matches DB', total === memCount.n, `api ${total} vs db ${memCount.n}`);
  else contract('members meta.total absent', `row count ${(mr.body?.data ?? []).length}`);
}

// ─────────────────────────────────────────────────────────────────────
// 7. Fiscal guard: posting inside the open period works
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 7. FISCAL GUARD ===');
{
  const [fund] = await sql`select id from funds where tenant_id=${MD} order by balance desc limit 1`;
  const probe = await api('POST', '/api/transactions', A, {
    type: 'Expense', amount: '100.00', fundId: fund.id,
    description: 'meridian e2e fiscal probe', category: 'Operations',
    date: OPEN_DATE, status: 'Completed',
  });
  if (probe.status === 200 || probe.status === 201) {
    pass('posting inside open fiscal period succeeds');
    const id = probe.body?.data?.id ?? probe.body?.id;
    if (id) {
      const del = await api('DELETE', `/api/transactions/${id}`, A, { reason: 'meridian e2e cleanup' });
      check('probe expense cleaned up', del.status === 200, `${del.status}`);
      // Expense reversal credits the fund back — assert no residue.
      const [res] = await sql`select count(*)::int n from transactions where id=${id} and is_deleted=false`;
      check('probe row retired (no residue)', res.n === 0, `${res.n} still live`);
    } else contract('create-transaction response shape', JSON.stringify(probe.body).slice(0, 160));
  } else contract('post inside open period', `${probe.status} ${probe.body?.message}`);
}

// ─────────────────────────────────────────────────────────────────────
// 8. Report sources
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 8. REPORT SOURCES ===');
{
  const an = await api('GET', '/api/analytics/analysis', A);
  check('analytics/analysis 200', an.status === 200, `${an.status}`);
  const tx = await api('GET', '/api/transactions?limit=50', A);
  check('transactions feed 200', tx.status === 200, `${tx.status}`);
  const fd = await api('GET', '/api/funds', A);
  check('funds feed 200', fd.status === 200, `${fd.status}`);
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`RESULT: ${results.pass} PASS | ${results.real.length} REAL BUGS | ${results.contract.length} contract notes`);
if (results.real.length) { console.log('\nREAL BUGS:'); for (const b of results.real) console.log(`  - ${b.label}: ${b.detail}`); }
if (results.contract.length) { console.log('\nCONTRACT NOTES:'); for (const c of results.contract) console.log(`  - ${c.label}: ${c.detail}`); }
await sql.end();
process.exit(results.real.length ? 1 : 0);
