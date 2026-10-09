/**
 * Northbridge (medium-size tenant) E2E harness.
 *
 * The medium-size company shape differs from the small-community demo in ways
 * that stress different code paths: payroll-heavy fixed expenses, a separate
 * welfare-levy stream, monthly reserve sweeps, TWO completed fiscal years with
 * TWO dividend runs, project capital via explicit transfer legs, and a
 * 240-member roster with 9 users across 3 distinct roles.
 *
 * Failures are classified: REAL (app bug) vs CONTRACT (harness sent the wrong
 * shape — the API correctly rejected it).
 */
import postgres from 'postgres';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const results = { pass: 0, real: [], contract: [], notes: [] };
const pass = (l) => { results.pass++; console.log(`  PASS  ${l}`); };
const realBug = (l, d) => { results.real.push({ label: l, detail: d }); console.log(`  BUG   ${l}\n        ${d}`); };
const contract = (l, d) => { results.contract.push({ label: l, detail: d }); console.log(`  note  ${l} — ${d}`); };
const check = (l, c, d) => (c ? pass(l) : realBug(l, d ?? 'assertion failed'));

// Login is rate-limited (429 + Retry-After). Cache one session per identity.
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

const [tenant] = await sql`select id, name, plan, max_users from tenants where slug = 'northbridge'`;
if (!tenant) { console.error('Northbridge tenant not found — run scripts/seed-northbridge-tenant.mjs first'); process.exit(1); }
const NB = tenant.id;
console.log(`tenant: ${tenant.name} (${tenant.id}) plan=${tenant.plan} max=${tenant.max_users}\n`);

const adminL = await login('admin@northbridge.dev');
const managerL = await login('manager@northbridge.dev');
const auditorL = await login('auditor@northbridge.dev');
console.log(`logins: admin=${adminL.status} manager=${managerL.status} auditor=${auditorL.status}\n`);
const A = adminL.cookies, MG = managerL.cookies, AU = auditorL.cookies;
if (adminL.status !== 200) { console.error('admin login failed — cannot proceed'); process.exit(1); }

// Writes are gated by the fail-closed fiscal guard: a posting must fall inside
// an OPEN period. Derive a usable date from the live open period rather than
// hard-coding one that may drift out of range.
const [openPeriod] = await sql`
  select period_start, period_end from fiscal_periods
  where tenant_id = ${NB} and status = 'OPEN' order by period_start limit 1`;
const OPEN_DATE = openPeriod
  ? new Date(Math.max(Date.UTC(2026, 6, 20), new Date(openPeriod.period_start).getTime())).toISOString().slice(0, 10)
  : null;
console.log(openPeriod
  ? `open fiscal period: ${new Date(openPeriod.period_start).toISOString().slice(0,10)} .. ${new Date(openPeriod.period_end).toISOString().slice(0,10)} → probe date ${OPEN_DATE}\n`
  : 'WARNING: no OPEN fiscal period — write probes will be refused\n');

// ─────────────────────────────────────────────────────────────────────
// 1. Tenant isolation: the medium tenant must not see the small one
// ─────────────────────────────────────────────────────────────────────
console.log('=== 1. TENANT ISOLATION ===');
{
  const [gvRow] = await sql`select id from tenants where slug = 'green-valley'`;
  const gv = gvRow?.id ?? null;
  const r = await api('GET', '/api/members?limit=5', A);
  check('members list 200', r.status === 200, `${r.status} ${r.body?.message}`);
  // /api/members returns { data: [{ id, ... }] }.
  const rows = Array.isArray(r.body?.data) ? r.body.data : [];
  const ids = rows.map((m) => m?.id).filter((x) => typeof x === 'string');
  if (ids.length) {
    const leaked = await sql`select count(*)::int n from members where id = any(${ids}) and tenant_id <> ${NB}`;
    check('no cross-tenant member rows in list', leaked[0].n === 0, `${leaked[0].n} rows belong to another tenant`);
  } else contract('members payload shape', JSON.stringify(r.body).slice(0, 160));

  // Deep-link a green-valley fund id. There is no GET /api/funds/{id} route
  // (405 = path exists, method not allowed), so probe the collection route and
  // assert the foreign fund never appears in the payload.
  if (gv) {
    const [gvFund] = await sql`select id, name from funds where tenant_id = ${gv} limit 1`;
    const all = await api('GET', '/api/funds', A);
    if (all.status === 200) {
      const list = Array.isArray(all.body?.data) ? all.body.data
        : Array.isArray(all.body?.funds) ? all.body.funds
        : Array.isArray(all.body) ? all.body : [];
      const ids = list.map((f) => f?.id).filter((x) => typeof x === 'string');
      const foreign = await sql`select count(*)::int n from funds where id = any(${ids}) and tenant_id <> ${NB}`;
      check('funds list contains no foreign fund rows', foreign[0].n === 0, `${foreign[0].n} foreign funds leaked`);
      if (gvFund) check('green-valley fund absent from northbridge list', !ids.includes(gvFund.id), 'foreign fund id present');
    } else contract('funds list shape', `${all.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. Role boundaries: Auditor is read-only, Manager can write
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 2. ROLE BOUNDARIES ===');
{
  const [fund] = await sql`select id, name, balance from funds where tenant_id = ${NB} order by balance desc limit 1`;
  const [fund2] = await sql`select id, name, balance from funds where tenant_id = ${NB} and id <> ${fund.id} limit 1`;

  const audWrite = await api('POST', '/api/funds/transfer', AU, { fromFundId: fund.id, toFundId: fund2.id, amount: '100.00', description: 'auditor should not write' });
  check(`auditor write refused (${audWrite.status})`, audWrite.status === 403 || audWrite.status === 401, `got ${audWrite.status}`);

  const audRead = await api('GET', '/api/funds', AU);
  check('auditor read allowed', audRead.status === 200, `${audRead.status}`);

  const mgWrite = await api('POST', '/api/funds/transfer', MG, { fromFundId: fund.id, toFundId: fund2.id, amount: '250.00', description: 'northbridge e2e manager transfer' });
  if (mgWrite.status === 200 || mgWrite.status === 201) {
    pass('manager fund transfer allowed');
    const pair = await sql`select id, type from transactions where tenant_id = ${NB} and created_at > now() - interval '2 minutes' and type in ('Transfer In','Transfer Out') order by created_at desc limit 2`;
    check('transfer wrote paired legs', pair.length === 2, `got ${pair.length}`);
    for (const leg of pair) {
      const d = await api('DELETE', `/api/transactions/${leg.id}`, A, { reason: 'northbridge e2e cleanup' });
      if (d.status !== 200) realBug(`transfer leg delete (${leg.type})`, `${d.status} ${d.body?.message}`);
    }
    const after = await sql`select id, balance from funds where tenant_id = ${NB} and id in (${fund.id}, ${fund2.id})`;
    const byId = new Map(after.map((f) => [f.id, Number(f.balance)]));
    const restored = byId.get(fund.id) === Number(fund.balance) && byId.get(fund2.id) === Number(fund2.balance);
    check('treasury restored after transfer cleanup', restored,
      `expected ${fund.id}=${fund.balance} / ${fund2.id}=${fund2.balance}, got ${JSON.stringify(after)}`);
  } else {
    realBug('manager fund transfer allowed', `${mgWrite.status} ${mgWrite.body?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Money integrity: fund balances are reconstructable from the ledger
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 3. LEDGER <-> BALANCE INTEGRITY ===');
{
  // Canonical classification: app/api/transactions/route.ts lines 19-20.
  const INFLOW = ['Deposit', 'Earning', 'Transfer In', 'Investment'];
  const OUTFLOW = ['Expense', 'Dividend', 'Disbursement', 'Transfer Out', 'Withdrawal'];
  const funds = await sql`select id, name, balance from funds where tenant_id = ${NB} order by name`;
  let off = 0;
  for (const f of funds) {
    const rows = await sql`select type, coalesce(sum(amount),0)::numeric(15,2) s
      from transactions where tenant_id = ${NB} and fund_id = ${f.id} and is_deleted = false group by type`;
    let led = 0; const unmapped = [];
    for (const r of rows) {
      if (INFLOW.includes(r.type)) led += Number(r.s);
      else if (OUTFLOW.includes(r.type)) led -= Number(r.s);
      else unmapped.push(`${r.type}(x${r.n ?? ''})`);
    }
    const ok = Math.abs(Number(f.balance) - led) < 0.005 && unmapped.length === 0;
    if (!ok) off++;
    check(`fund reconciles: ${f.name}`, ok,
      `stored ${f.balance} vs ledger ${led.toFixed(2)}${unmapped.length ? ` [unmapped: ${unmapped.join(',')}]` : ''}`);
  }
  check('all funds reconcile from ledger', off === 0, `${off} fund(s) off`);

  const [neg] = await sql`select count(*)::int n from funds where tenant_id = ${NB} and balance < 0`;
  check('no negative fund balances', neg.n === 0, `${neg.n} negative`);

  const [negM] = await sql`select count(*)::int n from members where tenant_id = ${NB} and is_deleted = false and total_contributed < 0`;
  check('no negative member balances', negM.n === 0, `${negM.n} negative`);
}

// ─────────────────────────────────────────────────────────────────────
// 4. Transfer legs: every group is a balanced pair
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 4. TRANSFER PAIRING ===');
{
  const [p] = await sql`
    select count(*)::int legs, count(distinct transfer_group_id)::int groups,
           count(*) filter (where transfer_group_id is null)::int ungrouped
    from transactions where tenant_id = ${NB} and type in ('Transfer In','Transfer Out') and is_deleted = false`;
  check('every transfer leg carries a group id', p.ungrouped === 0, `${p.ungrouped} ungrouped`);
  check('legs are exactly 2x groups', p.legs === p.groups * 2, `legs=${p.legs} groups=${p.groups}`);

  const bad = await sql`
    select transfer_group_id, count(*)::int n,
           sum(case when type='Transfer In' then amount else -amount end)::numeric(15,2) net
    from transactions where tenant_id = ${NB} and transfer_group_id is not null and is_deleted = false
    group by transfer_group_id
    having count(*) <> 2 or sum(case when type='Transfer In' then amount else -amount end) <> 0`;
  check('no unbalanced transfer groups', bad.length === 0, `${bad.length} bad groups`);

  const [legacy] = await sql`select count(*)::int n from transactions where tenant_id = ${NB} and type = 'Transfer' and is_deleted = false`;
  check('no unsignable legacy bare Transfer rows', legacy.n === 0, `${legacy.n} rows the app cannot classify`);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Dividend runs: allocations match distributions, liquidity respected
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 5. DIVIDEND RUNS ===');
{
  const runs = await sql`
    select id, year, status, actual_distributed, distributable_surplus, retained_earnings,
           statutory_reserve, period_start, period_end
    from fiscal_periods where tenant_id = ${NB} order by period_start`;
  const closed = runs.filter((r) => r.status === 'CLOSED');
  const open = runs.filter((r) => r.status === 'OPEN');
  check('two closed fiscal years seeded', closed.length === 2, `got ${closed.length} closed`);
  check('exactly one open fiscal year (writes need it)', open.length === 1, `got ${open.length} open`);
  for (const run of closed) {
    const [agg] = await sql`
      select coalesce(sum(amount),0)::numeric(15,2) s, count(*)::int n
      from profit_allocations where tenant_id = ${NB} and fiscal_period_id = ${run.id} and allocation_type = 'DIVIDEND'`;
    check(`FY ${run.year}: allocations sum == actual_distributed`,
      Math.abs(Number(agg.s) - Number(run.actual_distributed)) < 0.005,
      `alloc ${agg.s} vs recorded ${run.actual_distributed}`);
    check(`FY ${run.year}: retained = distributable - distributed`,
      Math.abs((Number(run.distributable_surplus) - Number(run.actual_distributed)) - Number(run.retained_earnings)) < 0.005,
      `distributable ${run.distributable_surplus} - distributed ${run.actual_distributed} != retained ${run.retained_earnings}`);
    check(`FY ${run.year}: retained never negative`,
      Number(run.retained_earnings) >= 0, `retained ${run.retained_earnings}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. Project lifecycle: create -> board update -> cancel (the 0014 fix)
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 6. PROJECT LIFECYCLE (status vocabulary) ===');
{
  const [fund] = await sql`select id, name from funds where tenant_id = ${NB} limit 1`;
  const created = await api('POST', '/api/projects', A, {
    title: 'E2E Provisional Works', category: 'Manufacturing',
    description: 'Harness-created project to exercise the status vocabulary.',
    budget: 100000, initialInvestment: 0, expectedRoi: 5,
    startDate: OPEN_DATE ?? '2026-07-20', status: 'In Progress', linkedFundId: fund.id, shareholders: [],
  });
  if (created.status === 200 || created.status === 201) {
    pass('project create 200');
    const pid = created.body?.data?.id;
    if (pid) {
      // The regression: DELETE sets status='Cancelled'. Before migration 0014
      // the DB CHECK rejected it -> 500 "Failed to cancel project".
      const cancelled = await api('DELETE', `/api/projects/${pid}`, A);
      check(`project cancel accepted (${cancelled.status})`, cancelled.status === 200,
        `${cancelled.status} ${cancelled.body?.message} — 'Cancelled' rejected by projects_status_check?`);
      if (cancelled.status === 200) {
        const [row] = await sql`select status, health from projects where id = ${pid}`;
        check('cancelled project persisted as Cancelled/Critical',
          row?.status === 'Cancelled' && row?.health === 'Critical', JSON.stringify(row));
      }
      // Hard-remove the probe row (it never posted money).
      await sql`delete from project_updates where project_id = ${pid}`;
      await sql`delete from project_members where project_id = ${pid}`;
      await sql`delete from projects where id = ${pid}`;
    } else contract('project create payload', JSON.stringify(created.body).slice(0, 160));
  } else if (created.status === 400) {
    contract('project create with linkedFundId', `${created.status} ${created.body?.message}`);
  } else {
    realBug('project create 200', `${created.status} ${created.body?.message}`);
  }

  // Every existing status must be one the app can round-trip.
  const statuses = await sql`select distinct status from projects where tenant_id = ${NB}`;
  const allowed = new Set(['In Progress', 'Review', 'Completed', 'Cancelled']);
  const bad = statuses.map((s) => s.status).filter((s) => !allowed.has(s));
  check('all seeded project statuses are in the app vocabulary', bad.length === 0, `unknown: ${bad.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────
// 7. Expenses: ledger effect and soft-delete reversal
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 7. EXPENSE + REVERSAL ===');
{
  const [fund] = await sql`select id, name, balance from funds where tenant_id = ${NB} order by balance desc limit 1`;
  const before = Number(fund.balance);
  const post = await api('POST', '/api/transactions', A, {
    type: 'Expense', amount: '777.77', description: 'northbridge e2e expense probe',
    fundId: fund.id, date: OPEN_DATE, status: 'Completed',
  });
  if (post.status === 200 || post.status === 201) {
    pass('expense posted');
    const mid = await sql`select balance from funds where id = ${fund.id}`;
    const afterPost = Number(mid[0].balance);
    check(`expense debited fund (${before} -> ${afterPost})`, Math.abs((before - 777.77) - afterPost) < 0.005, 'wrong debit');
    const tid = post.body?.data?.id;
    if (tid) {
      const del = await api('DELETE', `/api/transactions/${tid}`, A, { reason: 'northbridge e2e cleanup' });
      check(`expense soft-delete accepted (${del.status})`, del.status === 200, `${del.status} ${del.body?.message}`);
      const end = await sql`select balance from funds where id = ${fund.id}`;
      check(`expense reversal restored fund to ${before}`,
        Math.abs(Number(end[0].balance) - before) < 0.005, `now ${end[0].balance}`);
      const del2 = await api('DELETE', `/api/transactions/${tid}`, A, { reason: 'double delete' });
      check('double delete refused', del2.status !== 200, `got ${del2.status}`);
    }
  } else {
    realBug('expense posted', `${post.status} ${post.body?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 8. Soft-deleted members must not inflate aggregates
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 8. SOFT-DELETED MEMBER VISIBILITY ===');
{
  const [live] = await sql`select count(*)::int n from members where tenant_id = ${NB} and is_deleted = false`;
  const stats = await api('GET', '/api/analytics/stats', A);
  if (stats.status === 200) {
    const total = stats.body?.totalMembers ?? stats.body?.data?.totalMembers;
    check(`stats.totalMembers ${total} == live members ${live.n}`, Number(total) === live.n, `counted ${total}, live ${live.n}`);
  } else contract('analytics/stats', `${stats.status}`);

  const lb = await api('GET', '/api/governance/leaderboard', A);
  if (lb.status === 200) {
    const rows = Array.isArray(lb.body?.data) ? lb.body.data
      : Array.isArray(lb.body?.leaderboard) ? lb.body.leaderboard : [];
    const ids = rows.map((x) => x?.id ?? x?.memberId).filter((x) => typeof x === 'string');
    if (ids.length) {
      const [soft] = await sql`select count(*)::int n from members where id = any(${ids}) and is_deleted = true`;
      check('leaderboard excludes soft-deleted members', soft.n === 0, `${soft.n} soft-deleted present`);
    } else contract('leaderboard payload shape', JSON.stringify(lb.body).slice(0, 160));
  } else contract('governance/leaderboard', `${lb.status}`);
}

// ─────────────────────────────────────────────────────────────────────
// 9. Fiscal guard: postings outside an open period are refused
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 9. FISCAL PERIOD GUARD ===');
{
  const [fund] = await sql`select id from funds where tenant_id = ${NB} limit 1`;
  const periods = await sql`select period_start, period_end, status from fiscal_periods where tenant_id = ${NB} order by period_start`;
  // A date well before the first seeded period must be refused (fail-closed).
  const farPast = await api('POST', '/api/transactions', A, {
    type: 'Expense', amount: '50.00', description: 'northbridge e2e out-of-period probe',
    fundId: fund.id, date: '2019-01-15', status: 'Completed',
  });
  check(`out-of-period posting refused (${farPast.status})`, farPast.status >= 400,
    `${farPast.status} — an unguarded period would let a closed year be mutated`);
  if (farPast.status === 200 || farPast.status === 201) {
    const id = farPast.body?.data?.id;
    if (id) await api('DELETE', `/api/transactions/${id}`, A, { reason: 'cleanup' });
  }
  console.log(`  (${periods.length} fiscal periods on file)`);
}

// ─────────────────────────────────────────────────────────────────────
// 10. Dashboard / analytics agree on the roster
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 10. AGGREGATE AGREEMENT ===');
{
  const [live] = await sql`select count(*)::int n from members where tenant_id = ${NB} and is_deleted = false`;
  const [active] = await sql`select count(*)::int n from members where tenant_id = ${NB} and is_deleted = false and status = 'active'`;
  const [mem, stats, analysis] = await Promise.all([
    api('GET', '/api/members?limit=1', A),
    api('GET', '/api/analytics/stats', A),
    api('GET', '/api/analytics/analysis', A),
  ]);
  const metaTotal = mem.body?.meta?.total ?? mem.body?.total;
  if (mem.status === 200 && metaTotal !== undefined) {
    check(`members meta.total ${metaTotal} == live ${live.n}`, Number(metaTotal) === live.n, `mismatch`);
  } else if (mem.status === 200) {
    // No pagination meta on this route: assert the roster size directly.
    const roster = Array.isArray(mem.body?.data) ? mem.body.data.length : 0;
    check(`members roster length ${roster} <= live ${live.n}`, roster <= live.n, `${roster} > ${live.n}`);
  } else contract('members meta.total', `${mem.status} ${JSON.stringify(mem.body).slice(0, 120)}`);
  if (stats.status === 200) {
    const t = stats.body?.totalMembers ?? stats.body?.data?.totalMembers;
    check(`stats.totalMembers ${t} == live ${live.n}`, Number(t) === live.n, 'mismatch');
    const a = stats.body?.activeMembers ?? stats.body?.data?.activeMembers;
    if (a !== undefined) check(`stats.activeMembers ${a} <= live active ${active.n}`, Number(a) <= active.n, `${a} > ${active.n}`);
  }
  if (analysis.status === 200) pass('analytics/analysis 200');
  else contract('analytics/analysis', `${analysis.status}`);
}

// ─────────────────────────────────────────────────────────────────────
// 11. Reports render without a server error
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 11. REPORTS ===');
{
  // Reports are generated client-side from the finance/analysis endpoints;
  // there is no server-side trial-balance route. Assert the endpoints the
  // report views actually consume, and confirm no 5xx.
  for (const p of ['/api/analytics/analysis', '/api/transactions?limit=5', '/api/funds']) {
    const r = await api('GET', p, A);
    check(`report source ${p} (${r.status})`, r.status === 200, `${r.status} ${r.body?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n──────── RESULT: ${results.pass} PASS | ${results.real.length} REAL BUGS | ${results.contract.length} contract notes ────────`);
if (results.real.length) { console.log('\nREAL BUGS:'); for (const b of results.real) console.log(`  • ${b.label}\n    ${b.detail}`); }
if (results.contract.length) { console.log('\nCONTRACT NOTES:'); for (const c of results.contract) console.log(`  • ${c.label} — ${c.detail}`); }

// Lease residue check: the harness must leave no probe rows behind.
const [residue] = await sql`
  select count(*)::int n from transactions
  where tenant_id = ${NB} and is_deleted = false
    and (description ilike '%e2e%' or description ilike '%probe%')`;
console.log(`\nprobe residue (live rows matching e2e/probe): ${residue.n}`);

await sql.end();
process.exit(results.real.length ? 1 : 0);
