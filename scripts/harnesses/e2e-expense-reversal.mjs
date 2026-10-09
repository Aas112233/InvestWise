/**
 * Focused E2E: expense soft-delete MUST reverse the fund debit (and refund the
 * linked project's totalExpenses). Exercises the live DELETE route end-to-end.
 * Self-cleaning: the probe expense is soft-deleted by the very call under test.
 */
import postgres from 'postgres';

const BASE = 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

let pass = 0; const bugs = [];
const ok = (l) => { pass++; console.log(`  PASS  ${l}`); };
const bug = (l, d) => { bugs.push({ l, d }); console.log(`  BUG   ${l}\n        ${d}`); };
const check = (l, c, d) => (c ? ok(l) : bug(l, d ?? 'assertion failed'));

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass-12345678' }),
  });
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
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
const A = await login('admin@greenvalley.dev');

// Pick a fund + member + project for the probe.
const fund = (await sql`select id, name, balance from funds where tenant_id=${gv} and status='ACTIVE' and name='Primary Share Capital'`)[0];
const member = (await sql`select id from members where tenant_id=${gv} limit 1`)[0];
const project = (await sql`select id, title, total_expenses from projects where tenant_id=${gv} and total_expenses is not null limit 1`)[0];
console.log(`fund=${fund?.name} member=${member?.id?.slice(0, 8)} project=${project?.title}\n`);

// Snapshot.
const fundBefore = Number(fund.balance);
const projBefore = Number(project.total_expenses);
console.log(`before: fund=${fundBefore.toFixed(2)} project.totalExpenses=${projBefore.toFixed(2)}\n`);

// --- 1. Create a probe expense (debits fund, inflates project) ---
console.log('=== 1. CREATE PROBE EXPENSE ===');
const create = await api('POST', '/api/expenses', A, {
  fundId: fund.id, projectId: project.id, memberId: member.id,
  amount: '777.77', category: 'Office', expenseName: 'E2E reversal probe',
  description: 'e2e reversal probe', date: new Date().toISOString(),
});
check('expense created 200/201', create.status === 200 || create.status === 201,
  `${create.status} ${create.body?.message}`);
const ref = create.body?.data?.referenceNumber;
console.log(`  ref=${ref}`);

const fundAfterCreate = (await sql`select balance from funds where id=${fund.id}`)[0].balance;
const projAfterCreate = (await sql`select total_expenses from projects where id=${project.id}`)[0].total_expenses;
check(`fund debited by 777.77 (${fundBefore} -> ${fundAfterCreate})`,
  Number(fundAfterCreate) === fundBefore - 777.77, 'wrong debit');
check(`project inflated by 777.77 (${projBefore} -> ${projAfterCreate})`,
  Number(projAfterCreate) === projBefore + 777.77, 'wrong project inflation');

// --- 2. Locate the row id ---
const row = (await sql`select id from transactions where tenant_id=${gv} and reference_number=${ref}`)[0];
console.log(`\n  probe tx id=${row?.id}`);

// --- 3. DELETE it — the fix must reverse balances ---
console.log('\n=== 2. SOFT-DELETE → BALANCES MUST REVERSE ===');
const del = await api('DELETE', `/api/transactions/${row.id}`, A, { reason: 'e2e reversal probe cleanup' });
check('delete 200', del.status === 200, `${del.status} ${del.body?.message}`);
console.log(`  balanceReversed flag = ${del.body?.balanceReversed}`);

const fundAfterDel = (await sql`select balance from funds where id=${fund.id}`)[0].balance;
const projAfterDel = (await sql`select total_expenses from projects where id=${project.id}`)[0].total_expenses;
check(`fund REVERSED back to ${fundBefore} (got ${fundAfterDel})`,
  Number(fundAfterDel) === fundBefore, `expected ${fundBefore}, got ${fundAfterDel}`);
check(`project REVERSED back to ${projBefore} (got ${projAfterDel})`,
  Number(projAfterDel) === projBefore, `expected ${projBefore}, got ${projAfterDel}`);

const rowAfter = (await sql`select is_deleted, deletion_reason from transactions where id=${row.id}`)[0];
check('row soft-deleted', rowAfter.is_deleted === true, 'not soft-deleted');

// --- 4. Idempotency: deleting again must not double-reverse ---
console.log('\n=== 3. DOUBLE-DELETE MUST NOT DOUBLE-REVERSE ===');
const del2 = await api('DELETE', `/api/transactions/${row.id}`, A, { reason: 'again' });
check('second delete rejected (400/404/409)', [400, 404, 409].includes(del2.status), `got ${del2.status}`);
const fundAfterDel2 = (await sql`select balance from funds where id=${fund.id}`)[0].balance;
check(`fund unchanged on re-delete guard (${fundAfterDel2})`, Number(fundAfterDel2) === fundBefore, 'fund moved on second delete');

console.log('\n──────────────────────────────');
console.log(`PASS ${pass}   REAL BUGS ${bugs.length}`);
bugs.forEach((b) => console.log(`  • ${b.l}: ${b.d}`));

await sql.end();
process.exit(bugs.length ? 1 : 0);
