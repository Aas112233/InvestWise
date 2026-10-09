// Equity-transfer lifecycle: amount-only, shares-only, both, and the
// acknowledgement gates. Run against the local dev server with
// `node --env-file=.env.local scripts/harnesses/e2e-equity-transfer.mjs`.
import postgres from 'postgres';

const BASE = 'http://localhost:3000';
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
let failures = 0;
const check = (l, c, extra = '') => {
  if (!c) failures++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${extra ? `  ${extra}` : ''}`);
};

async function login(email) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pass-12345678' }),
  });
  return { status: r.status, cookies: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}

async function transfer(cookies, body) {
  const r = await fetch(`${BASE}/api/finance/equity/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookies },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const member = async (id) => {
  const [m] = await sql`SELECT shares, total_contributed FROM members WHERE id = ${id}`;
  return { shares: Number(m.shares), equity: m.total_contributed };
};

const SRC = '8c564b94-ab38-4856-9bb4-8829cbefe7c4'; // GV-001
const DST = '9f782b90-149c-40d0-ac7b-820a33686604'; // GV-002
const snapshot = { src: await member(SRC), dst: await member(DST) };
console.log('BEFORE', JSON.stringify(snapshot));

const { cookies } = await login('admin@greenvalley.dev');

let ref = 0;
const nextRef = () => `EQT-HARNESS-${++ref}-${Date.now()}`;

// 1. amount-only without acknowledgement is blocked
let res = await transfer(cookies, {
  fromMemberId: SRC,
  transfers: [{ toMemberId: DST, amount: 10 }],
  reason: 'harness amount-only unacked',
  referenceNumber: nextRef(),
});
check('amount-only without ack -> 400 AMOUNT_ONLY_ACKNOWLEDGEMENT_REQUIRED',
  res.status === 400 && res.json.code === 'AMOUNT_ONLY_ACKNOWLEDGEMENT_REQUIRED',
  JSON.stringify(res.json));

// 2. amount-only with acknowledgement moves equity and leaves shares alone
res = await transfer(cookies, {
  fromMemberId: SRC,
  transfers: [{ toMemberId: DST, amount: 10 }],
  reason: 'harness amount-only',
  referenceNumber: nextRef(),
  amountOnlyAcknowledged: true,
});
check('amount-only with ack -> 201', res.status === 201, JSON.stringify(res.json));
let after = { src: await member(SRC), dst: await member(DST) };
check('  source equity -10', Number(after.src.equity) === Number(snapshot.src.equity) - 10, JSON.stringify(after.src));
check('  recipient equity +10', Number(after.dst.equity) === Number(snapshot.dst.equity) + 10, JSON.stringify(after.dst));
check('  shares unchanged', after.src.shares === snapshot.src.shares && after.dst.shares === snapshot.dst.shares);

// 3. a row that moves nothing is rejected
res = await transfer(cookies, {
  fromMemberId: SRC,
  transfers: [{ toMemberId: DST, amount: 0, shares: 0 }],
  reason: 'harness empty row',
  referenceNumber: nextRef(),
});
check('empty row -> 400', res.status === 400, JSON.stringify(res.json));

// 4. shares-only still needs the gift acknowledgement (regression)
res = await transfer(cookies, {
  fromMemberId: SRC,
  transfers: [{ toMemberId: DST, shares: 1 }],
  reason: 'harness shares-only unacked',
  referenceNumber: nextRef(),
});
check('shares-only without ack -> 400 GIFT_ACKNOWLEDGEMENT_REQUIRED',
  res.status === 400 && res.json.code === 'GIFT_ACKNOWLEDGEMENT_REQUIRED', JSON.stringify(res.json));

// 5. shares + amount together moves both
const before5 = await member(SRC);
res = await transfer(cookies, {
  fromMemberId: SRC,
  transfers: [{ toMemberId: DST, amount: 5, shares: 1 }],
  reason: 'harness both',
  referenceNumber: nextRef(),
});
check('shares+amount -> 201', res.status === 201, JSON.stringify(res.json));
const after5src = await member(SRC);
const after5dst = await member(DST);
check('  both legs applied',
  Number(after5src.equity) === Number(before5.equity) - 5 &&
  after5src.shares === before5.shares - 1 &&
  after5dst.shares === snapshot.dst.shares + 1,
  JSON.stringify({ after5src, after5dst }));

// 6. the ledger carries a signed pair per movement
const legs = await sql`
  SELECT reference_number, member_id, amount FROM transactions
  WHERE type = 'Equity-Transfer' AND reference_number LIKE 'EQT-HARNESS-%' ORDER BY reference_number`;
check('  ledger legs recorded', legs.length === 4, JSON.stringify(legs.map((l) => `${l.member_id.slice(0, 4)}:${l.amount}`)));

// Restore the members and remove harness rows
await sql`UPDATE members SET shares = ${snapshot.src.shares}, total_contributed = ${snapshot.src.equity} WHERE id = ${SRC}`;
await sql`UPDATE members SET shares = ${snapshot.dst.shares}, total_contributed = ${snapshot.dst.equity} WHERE id = ${DST}`;
await sql`DELETE FROM transactions WHERE reference_number LIKE 'EQT-HARNESS-%'`;
await sql`DELETE FROM audit_logs WHERE action = 'TRANSFER_EQUITY' AND details::text ILIKE '%harness%'`;
const restored = { src: await member(SRC), dst: await member(DST) };
check('state restored', JSON.stringify(restored.src) === JSON.stringify(snapshot.src) && JSON.stringify(restored.dst) === JSON.stringify(snapshot.dst), JSON.stringify(restored));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
