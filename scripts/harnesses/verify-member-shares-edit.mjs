// Live verification for editable member shares (no transaction linkage) and
// the server-side share lock once any transaction links to the member.
const BASE = process.env.BASE_URL || 'http://localhost:3001';
let failures = 0;
const check = (label, cond, extra) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 250) : ''}`);
};

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { status: r.status, cookies };
}
async function send(method, path, cookies, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { Cookie: cookies, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const A = (await login('admin@greenvalley.dev', 'pass-12345678')).cookies;

console.log('\n=== 1. classify members by linkage ===');
const list = await send('GET', '/api/members?page=1&limit=100&withTotals=1', A);
const rows = list.body?.data ?? [];
const withTxn = rows.find((m) => m.hasTransactions === true);
const free = rows.find((m) => m.hasTransactions === false);
console.log(`  directory: ${rows.length} rows, free(no-txn)=${free?.memberId ?? 'none'}, with-txn=${withTxn?.memberId ?? 'none'}`);

let tempId = null;
let target = free;
if (!target) {
  const created = await send('POST', '/api/members', A, {
    name: 'QA Shares Temp', email: `qa-shares-${Date.now()}@greenvalley.dev`,
    phone: '01700000000', shares: 10,
  });
  check('temp no-txn member created', created.status === 201 || created.status === 200, created.body);
  target = created.body?.data;
  tempId = target?.id;
}

console.log('\n=== 2. shares EDITABLE while no transaction linkage ===');
const orig = Number(target.shares);
const upd = await send('PUT', `/api/members/${target.id}`, A, { shares: orig + 5 });
check('PUT shares -> 200', upd.status === 200, upd.body);
check('shares persisted', Number(upd.body?.data?.shares) === orig + 5, upd.body?.data?.shares);
const revert = await send('PUT', `/api/members/${target.id}`, A, { shares: orig });
check('shares reverted to original', revert.status === 200 && Number(revert.body?.data?.shares) === orig, revert.body?.data);

console.log('\n=== 3. shares LOCKED once transactions exist ===');
if (withTxn) {
  const locked = await send('PUT', `/api/members/${withTxn.id}`, A, { shares: Number(withTxn.shares) + 1 });
  check('PUT shares on linked member -> 423', locked.status === 423, locked.body);
  check('lock message unmasked (§11)', typeof locked.body?.message === 'string' && /locked/i.test(locked.body.message), locked.body);
  const verify = await send('GET', `/api/members/${withTxn.id}`, A);
  check('linked member shares unchanged', Number(verify.body?.data?.shares) === Number(withTxn.shares), verify.body?.data?.shares);
} else {
  console.log('  SKIP  no member with transactions found');
}

console.log('\n=== 4. profile edit alongside shares (no regression) ===');
if (target) {
  const before = await send('GET', `/api/members/${target.id}`, A);
  const origAddress = before.body?.data?.address ?? null;
  const both = await send('PUT', `/api/members/${target.id}`, A, { shares: orig, address: 'QA verify street' });
  check('shares + profile in one PUT -> 200', both.status === 200, both.body);
  check('address written', both.body?.data?.address === 'QA verify street', both.body?.data?.address);
  await send('PUT', `/api/members/${target.id}`, A, { address: origAddress });
}

if (tempId) {
  const del = await send('DELETE', `/api/members/${tempId}`, A);
  console.log(`\ncleanup: temp member delete -> ${del.status}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures ? 1 : 0);
