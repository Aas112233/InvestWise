// Deposit lifecycle with role separation — the money-critical path, and the
// #72 segregation-of-duties guard.
import postgres from 'postgres';
const BASE = 'http://localhost:3001';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let failures = 0;
const check = (l, c) => { if (!c) failures++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); };

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'pass-12345678' }) });
  return { status: r.status, cookies: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
async function api(method, path, cookies, payload) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookies, 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const gv = (await sql`select id from tenants where name ilike '%green%'`)[0].id;
const memberUser = (await sql`select u.email, m.id as member_id from users u join members m on m.member_id = u.member_id where u.tenant_id=${gv} and u.role='Member' limit 1`)[0];
const memberEmail = memberUser.email;

console.log('=== A. MEMBER submits a deposit request ===');
const member = await login(memberEmail);
check(`member login 200 (${memberEmail})`, member.status === 200);
const M = member.cookies;

const fund = (await sql`select id, name, balance from funds where tenant_id=${gv} and type='DEPOSIT' limit 1`)[0];
const fundBefore = await sql`select balance from funds where id=${fund.id}`;
console.log(`  target fund: ${fund.name} balance=${fundBefore[0].balance}`);

const req = await api('POST', '/api/deposits/request', M, {
  amount: "1234.56", memberId: memberUser.member_id, fundId: fund.id, depositMonth: "2026-10", depositMethod: "Cash",
  referenceNumber: `E2E-SWEEP-${Date.now()}`, notes: 'e2e sweep deposit request',
});
check(`POST /api/deposits/request -> 201/200 (got ${req.status})`, req.status === 200 || req.status === 201);
const ref = req.body?.data?.referenceNumber;
const idRow = ref ? (await sql`select id from transactions where reference_number=${ref} limit 1`)[0] : null;
const dep = { id: idRow?.id, status: req.body?.data?.status, referenceNumber: ref };
console.log(`  created deposit ref=${ref} status=${dep?.status}`);
check('new request is PENDING', String(dep?.status).toUpperCase().includes('PENDING'));

console.log('\n=== B. Fund balance UNCHANGED while PENDING (no phantom money) ===');
const fundAfterReq = await sql`select balance from funds where id=${fund.id}`;
check(`fund unchanged (${fundBefore[0].balance} -> ${fundAfterReq[0].balance})`, String(fundBefore[0].balance) === String(fundAfterReq[0].balance));

console.log('\n=== C. Member CANNOT self-approve (#72 guard) ===');
if (dep?.id) {
  const selfApprove = await api('POST', `/api/deposits/${dep.id}/approve`, M, {});
  console.log(`  member self-approve -> ${selfApprove.status} ${selfApprove.body?.message ?? ''}`);
  check('self-approve rejected (not 200)', selfApprove.status !== 200);
}

console.log('\n=== D. ADMIN approves the member request ===');
const admin = await login('admin@greenvalley.dev');
const A = admin.cookies;
if (dep?.id) {
  const approve = await api('POST', `/api/deposits/${dep.id}/approve`, A, {});
  console.log(`  admin approve -> ${approve.status} ${approve.body?.message ?? ''}`);
  check('admin approve succeeded', approve.status === 200);

  const fundAfterApprove = await sql`select balance from funds where id=${fund.id}`;
  const expected = (Number(fundBefore[0].balance) + 1234.56).toFixed(2);
  console.log(`  fund ${fundBefore[0].balance} -> ${fundAfterApprove[0].balance} (expected ${expected})`);
  check('fund credited by exactly the deposit amount', String(fundAfterApprove[0].balance) === expected);

  const row = (await sql`select status, balance_before, balance_after from transactions where id=${dep.id}`)[0];
  console.log(`  tx status=${row?.status} before=${row?.balance_before} after=${row?.balance_after}`);
  check('tx marked Completed', String(row?.status).toUpperCase().includes('COMPLET'));
  check('balance_after snapshot recorded', row?.balance_after != null);

  console.log('\n=== E. CLEANUP: revert restores the fund exactly ===');
  const rev = await api('POST', `/api/deposits/${dep.id}/revert`, A, { reason: 'e2e sweep cleanup — reversing probe deposit' });
  console.log(`  revert -> ${rev.status} ${rev.body?.message ?? ''}`);
  const fundFinal = await sql`select balance from funds where id=${fund.id}`;
  console.log(`  fund now ${fundFinal[0].balance} (original ${fundBefore[0].balance})`);
  check('revert restored the original fund balance', String(fundFinal[0].balance) === String(fundBefore[0].balance));

  // Fully close the probe: revert leaves the row PENDING, so reject it to make
  // the probe terminal and keep the ledger free of test residue.
  const rej = await api('POST', `/api/deposits/${dep.id}/reject`, A, { rejectionReason: 'e2e sweep cleanup — closing probe request' });
  console.log(`  reject -> ${rej.status} ${rej.body?.message ?? ''}`);

  // Reject is terminal but the row stays live (is_deleted=false) and carries
  // type='Deposit' with a non-settled status — harmless to balances, but it
  // still shows up as probe residue in later integrity sweeps. Retire it for
  // real so this harness leaves the DB exactly as it found it.
  await sql`update transactions set is_deleted = true, updated_at = now() where id = ${dep.id}`;
  const [residue] = await sql`
    select count(*)::int n from transactions
    where id = ${dep.id} and is_deleted = false`;
  check('probe row retired (no residue left behind)', residue.n === 0, `${residue.n} still live`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
