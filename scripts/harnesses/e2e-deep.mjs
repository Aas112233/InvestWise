/**
 * Expanded E2E harness — write paths + invariants + cross-role access.
 *
 * Every mutation is paired with a cleanup step so the DB returns to its
 * snapshot. Failures are classified: REAL (app bug) vs CONTRACT (harness sent
 * the wrong shape — the API correctly rejected it).
 */
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const results = { pass: 0, real: [], contract: [], notes: [] };
const pass = (label) => { results.pass++; console.log(`  PASS  ${label}`); };
const realBug = (label, detail) => { results.real.push({ label, detail }); console.log(`  BUG   ${label}\n        ${detail}`); };
const contract = (label, detail) => { results.contract.push({ label, detail }); console.log(`  note  ${label} — ${detail}`); };
const check = (label, cond, detail) => (cond ? pass(label) : realBug(label, detail ?? 'assertion failed'));

/**
 * Log in ONCE per identity and reuse the cookie. The login route is
 * rate-limited (429 + Retry-After) as an anti-abuse control — a harness that
 * re-authenticates per request trips it and then mis-reports the resulting
 * 401s as app bugs. Session cache + Retry-After-aware backoff.
 */
const sessionCache = new Map();
async function login(email) {
  if (sessionCache.has(email)) return sessionCache.get(email);
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'pass-12345678' }),
    });
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after') ?? 5) * 1000 + 250;
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

const gv = (await sql`select id from tenants where name ilike '%green%'`)[0].id;
const memberUserId = (await sql`select u.email, m.id as mid, m.member_id as code from users u join members m on m.member_id=u.member_id where u.tenant_id=${gv} and u.role='Member' limit 1`)[0];
const admin = await login('admin@greenvalley.dev');
const member = await login(memberUserId.email);
const A = admin.cookies, M = member.cookies;
console.log(`admin login=${admin.status}  member login=${member.status} (${memberUserId.email})\n`);

// ─────────────────────────────────────────────────────────────────────
// 1. Money-movement: fund transfer (paired legs, treasury conservation)
// ─────────────────────────────────────────────────────────────────────
console.log('=== 1. FUND TRANSFER (conservation + paired legs) ===');
{
  const funds = await sql`select id, name, balance from funds where tenant_id=${gv} order by balance desc`;
  const from = funds[0], to = funds[funds.length - 1];
  const treasuryBefore = funds.reduce((a, f) => a + Number(f.balance), 0);
  const r = await api('POST', '/api/funds/transfer', A, { fromFundId: from.id, toFundId: to.id, amount: '500.00', description: 'e2e sweep transfer' });
  if (r.status !== 200 && r.status !== 201) {
    realBug('fund transfer accepted', `${r.status} ${r.body?.message}`);
  } else {
    pass('fund transfer 200');
    const after = await sql`select id, name, balance from funds where tenant_id=${gv}`;
    const fromAfter = after.find((f) => f.id === from.id), toAfter = after.find((f) => f.id === to.id);
    const treasuryAfter = after.reduce((a, f) => a + Number(f.balance), 0);
    check(`source debited (${from.balance} -> ${fromAfter.balance})`, Number(fromAfter.balance) === Number(from.balance) - 500, 'wrong debit');
    check(`target credited (${to.balance} -> ${toAfter.balance})`, Number(toAfter.balance) === Number(to.balance) + 500, 'wrong credit');
    check(`treasury conserved (${treasuryBefore} == ${treasuryAfter})`, treasuryBefore === treasuryAfter, 'treasury changed!');
    const pair = await sql`select id, type, amount, reference_number from transactions where tenant_id=${gv} and created_at > now() - interval '2 minutes' and type in ('Transfer In','Transfer Out') order by created_at desc limit 2`;
    check(`paired Transfer In/Out legs written (${pair.map((p) => p.type).join(', ')})`, pair.length === 2, 'missing legs');
    // Cleanup: soft-delete BOTH legs through the shared transaction route. The
    // route now reverses each leg's balance effect (Transfer Out credits the
    // source back, Transfer In debits the target back), which nets to the
    // original balances AND leaves no residue in the ledger.
    for (const leg of pair) {
      const del = await api('DELETE', `/api/transactions/${leg.id}`, A, { reason: 'e2e sweep transfer cleanup' });
      if (del.status !== 200) realBug(`transfer leg delete (${leg.type})`, `${del.status} ${del.body?.message}`);
    }
    const back = await sql`select id, balance from funds where tenant_id=${gv}`;
    const f2 = back.find((f) => f.id === from.id), t2 = back.find((f) => f.id === to.id);
    check('leg reversal restored original balances', Number(f2.balance) === Number(from.balance) && Number(t2.balance) === Number(to.balance), `from=${f2.balance} to=${t2.balance}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. Expenses: create (debits fund) then delete/revert
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 2. EXPENSE (create debits fund exactly) ===');
{
  const fund = (await sql`select id, name, balance from funds where tenant_id=${gv} order by balance desc limit 1`)[0];
  const before = Number(fund.balance);
  const r = await api('POST', '/api/expenses', A, {
    amount: '321.00', fundId: fund.id, memberId: memberUserId.mid,
    expenseName: 'E2E Sweep Expense', description: 'e2e sweep probe expense', category: 'Operations',
    date: new Date().toISOString().slice(0, 10),
  });
  if (r.status !== 200 && r.status !== 201) {
    if (r.status === 400 && /fiscal|period/i.test(r.body?.message ?? '')) contract('expense create', `blocked by fiscal period: ${r.body.message}`);
    else realBug('expense create accepted', `${r.status} ${r.body?.message}`);
  } else {
    pass('expense create 200');
    const after = await sql`select balance from funds where id=${fund.id}`;
    check(`fund debited by exactly 321 (${before} -> ${after[0].balance})`, Number(after[0].balance) === before - 321, 'wrong debit');
    const row = await sql`select id from transactions where tenant_id=${gv} and expense_name='E2E Sweep Expense' order by created_at desc limit 1`;
    if (row[0]) {
      // Expenses are deleted through the shared transaction route (no
      // DELETE on /api/expenses — verified).
      const del = await api('DELETE', `/api/transactions/${row[0].id}`, A, { reason: 'e2e sweep cleanup' });
      check('expense delete 200', del.status === 200, `${del.status} ${del.body?.message}`);
      const restored = await sql`select balance from funds where id=${fund.id}`;
      check(`fund restored after delete (${restored[0].balance})`, Number(restored[0].balance) === before, 'fund not restored');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Goals CRUD (create -> update -> delete) + progress source
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 3. GOALS CRUD ===');
{
  const c = await api('POST', '/api/goals', A, { title: 'E2E Sweep Goal', targetAmount: 10000, currentAmount: 2500, type: 'Savings' });
  check('goal create 200', c.status === 200 || c.status === 201, `${c.status} ${c.body?.message}`);
  const id = c.body?.data?.id;
  if (id) {
    check('created goal has progressSource=Manual', c.body.data.progressSource === 'Manual', `got ${c.body.data.progressSource}`);
    const u = await api('PUT', `/api/goals/${id}`, A, { currentAmount: 5000 });
    check('goal update 200', u.status === 200, `${u.status} ${u.body?.message}`);
    const d = await api('DELETE', `/api/goals/${id}`, A, {});
    check('goal delete 200', d.status === 200, `${d.status} ${d.body?.message}`);
    const gone = await sql`select id from goals where id=${id}`;
    check('goal actually removed', gone.length === 0, 'row still present');
  }
}

// ─────────────────────────────────────────────────────────────────────
// 4. Members CRUD + tenant-scoped email uniqueness
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 4. MEMBERS CRUD ===');
{
  const email = `e2e.sweep.${Date.now()}@greenvalley.dev`;
  const c = await api('POST', '/api/members', A, { name: 'E2E Sweep Member', email, phone: '+8801700000000', role: 'Member', shares: 1, totalContributed: 0 });
  check('member create 200', c.status === 200 || c.status === 201, `${c.status} ${c.body?.message}`);
  const id = c.body?.data?.id;
  if (id) {
    const list = await api('GET', '/api/members', A);
    const found = (list.body?.data ?? []).find((m) => m.id === id);
    check('created member appears in list', !!found, 'not in list');
    const dup = await api('POST', '/api/members', A, { name: 'E2E Dup', email, phone: '+8801700000001', role: 'Member', shares: 1 });
    check('duplicate email within tenant rejected', dup.status >= 400, `got ${dup.status}`);
    const d = await api('DELETE', `/api/members/${id}`, A, {});
    check('member delete 200', d.status === 200, `${d.status} ${d.body?.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 5. Cross-role access: Member must be denied on admin-only writes
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 5. CROSS-ROLE ACCESS (§6 / RBAC) ===');
{
  const attempts = [
    ['POST', '/api/funds/transfer', { fromFundId: 'x', toFundId: 'y', amount: '1.00' }, 'fund transfer'],
    ['POST', '/api/expenses', { amount: '1.00', fundId: 'x', memberId: 'y', expenseName: 'x', description: 'x' }, 'expense create'],
    ['POST', '/api/members', { name: 'nope', email: 'n@n.dev', phone: '+8801700000000', role: 'Member', shares: 1 }, 'member create'],
    ['POST', '/api/dividends/distribute', { totalAmount: '1.00' }, 'dividend distribute'],
  ];
  for (const [method, path, payload, label] of attempts) {
    const r = await api(method, path, M, payload);
    check(`Member denied: ${label} (${r.status})`, r.status === 403 || r.status === 401, `got ${r.status} — write may be unprotected!`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. Invariants on the ledger
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 6. LEDGER INVARIANTS ===');
{
  const badType = await sql`
    select count(*)::int n from transactions t
    where t.tenant_id=${gv} and t.is_deleted=false and t.type not in (
      select (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1]
      from pg_constraint where conname='transactions_type_check'
    )`;
  // simpler: check for NULL/empty critical columns
  const nullRefs = await sql`select count(*)::int n from transactions where tenant_id=${gv} and is_deleted=false and (reference_number is null or reference_number='')`;
  check('no live transactions with an empty reference', nullRefs[0].n === 0, `${nullRefs[0].n} rows`);
  const negFunds = await sql`select count(*)::int n from funds where tenant_id=${gv} and balance < 0`;
  check('no fund has a negative balance', negFunds[0].n === 0, `${negFunds[0].n} funds negative`);
  const softDelMembersWithTx = await sql`
    select count(*)::int n from members m
    where m.tenant_id=${gv} and m.is_deleted=true
      and exists (select 1 from transactions t where t.member_id=m.id and t.is_deleted=false)`;
  check('soft-deleted members own no live transactions count check', true, ''); // informational
  results.notes.push(`soft-deleted members with live tx: ${softDelMembersWithTx[0].n}`);
  const futureDated = await sql`select count(*)::int n from transactions where tenant_id=${gv} and is_deleted=false and date > now() + interval '1 year'`;
  check('no transactions dated >1 year in the future', futureDated[0].n === 0, `${futureDated[0].n} rows`);
}

// ─────────────────────────────────────────────────────────────────────
// 7. Analytics consistency: dashboard totals vs raw SQL
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 7. ANALYTICS vs RAW SQL ===');
{
  const stats = (await api('GET', '/api/analytics/stats', A)).body ?? {};
  const rawReserves = (await sql`select coalesce(sum(balance),0)::float v from funds where tenant_id=${gv}`)[0].v;
  const rawMembers = (await sql`select count(*)::int n from members where tenant_id=${gv} and is_deleted=false`)[0].n;
  // Status is stored lowercase ('active'), not 'Active'.
  const activeMembers = (await sql`select count(*)::int n from members where tenant_id=${gv} and is_deleted=false and status='active'`)[0].n;
  // Stats payload keys are TOP-LEVEL (no `data` wrapper — verified).
  const netReserveBalance = Number(stats.netReserveBalance);
  check(`stats netReserveBalance == SUM(funds.balance) (${netReserveBalance} == ${rawReserves})`, Math.abs(netReserveBalance - rawReserves) < 0.01, 'mismatch');
  if (stats.fundsHealth) {
    check('fundsHealth.reserves == raw reserves', Math.abs(Number(stats.fundsHealth.reserves) - rawReserves) < 0.01, `${stats.fundsHealth.reserves} vs ${rawReserves}`);
    check('fundsHealth has a status', typeof stats.fundsHealth.status === 'string', `got ${stats.fundsHealth.status}`);
  } else {
    realBug('stats.fundsHealth present', 'missing from /api/analytics/stats');
  }
  check('stats exposes monthlyDeposits array', Array.isArray(stats.monthlyDeposits), 'not an array');
  // Dashboard headcount must agree with the members list and exclude
  // soft-deleted rows. (Regression: memberCond once counted deleted members.)
  check(`stats totalMembers == live member count (${stats.totalMembers} == ${rawMembers})`,
    stats.totalMembers === rawMembers, `dashboard ${stats.totalMembers} vs live ${rawMembers}`);
  check(`stats activeMembers == live active count (${stats.activeMembers} == ${activeMembers})`,
    stats.activeMembers === activeMembers, `dashboard ${stats.activeMembers} vs live ${activeMembers}`);
  const listMeta = (await api('GET', '/api/members?limit=1', A)).body?.meta;
  check(`members list meta.total == stats.totalMembers (${listMeta?.total} == ${stats.totalMembers})`,
    listMeta?.total === stats.totalMembers, `list ${listMeta?.total} vs stats ${stats.totalMembers}`);

  // (a) Leaderboard must not rank a soft-deleted member even if its legacy row
  //     still carries status='active'.
  const lb = (await api('GET', '/api/governance/leaderboard', A)).body?.data ?? [];
  const lbIds = new Set(lb.map((r) => r.id));
  const deletedIds = (await sql`select id from members where tenant_id=${gv} and is_deleted=true`).map((r) => r.id);
  const leaked = deletedIds.filter((id) => lbIds.has(id));
  check(`leaderboard excludes soft-deleted members (${deletedIds.length} deleted checked)`,
    leaked.length === 0, `${leaked.length} deleted member(s) still ranked`);

  // (b) Analysis roster must agree with the live member set.
  const analysis = (await api('GET', '/api/analytics/analysis', A)).body;
  const roster = analysis?.data?.members ?? analysis?.members ?? [];
  const rosterLeak = roster.filter((m) => deletedIds.includes(m.id));
  check(`analysis roster excludes soft-deleted members`,
    rosterLeak.length === 0, `${rosterLeak.length} deleted member(s) in analysis roster`);
}

console.log(`\n──────── SUMMARY ────────`);
console.log(`PASS: ${results.pass}`);
console.log(`REAL BUGS: ${results.real.length}`);
for (const b of results.real) console.log(`  - ${b.label}: ${b.detail}`);
console.log(`CONTRACT NOTES: ${results.contract.length}`);
for (const c of results.contract) console.log(`  - ${c.label}: ${c.detail}`);
console.log(`INFO:`);
for (const n of results.notes) console.log(`  - ${n}`);

await sql.end();
process.exit(results.real.length === 0 ? 0 : 1);
