// Live verification for the tenant-level user management surface
// (GET /api/auth/users paginated + PATCH/POST /api/auth/users/[id]).
// Run against the local dev server: node scripts/harnesses/verify-tenant-users.mjs
const PORTS = [3001];
let BASE = null;
for (const p of PORTS) {
  try {
    const r = await fetch(`http://localhost:${p}/api/auth/login`, { method: 'OPTIONS' });
    if (r.status < 500) { BASE = `http://localhost:${p}`; break; }
  } catch {}
}
if (!BASE) { console.error('No dev server on 3000/3001'); process.exit(1); }
console.log('BASE =', BASE);

let failures = 0;
const check = (label, cond, extra) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra !== undefined && !cond ? ' :: ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, cookies, body };
}
async function send(method, path, cookies, payload) {
  const r = await await fetch(`${BASE}${path}`, {
    method, headers: { Cookie: cookies, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const stamp = Date.now();
const TEST_EMAIL = `qa-usermgmt-${stamp}@greenvalley.dev`;
const PW_OLD = 'Pass@12345';
const PW_NEW = 'Pass@67890';

console.log('\n=== 1. logins ===');
const admin = await login('admin@greenvalley.dev', 'pass-12345678');
check('tenant admin login', admin.status === 200, admin.body);
const A = admin.cookies;
const mgr = await login('admin@meridian.dev', 'pass-12345678');
check('other-tenant admin login', mgr.status === 200, mgr.body);
const M = mgr.cookies;

console.log('\n=== 2. GET /api/auth/users ===');
const legacy = await send('GET', '/api/auth/users', A);
check('bare call still returns array (dropdown compat)', Array.isArray(legacy.body), legacy.body);
const pag = await send('GET', '/api/auth/users?page=1&limit=2&sortBy=name&sortOrder=asc', A);
check('paginated envelope meta.total', pag.status === 200 && pag.body?.meta?.total >= 1, pag.body);
check('paginated respects limit=2', Array.isArray(pag.body?.data) && pag.body.data.length <= 2, pag.body);
const search = await send('GET', '/api/auth/users?page=1&search=Rafiq', A);
check('search filters by name', search.body?.data?.every((u) => /rafiq/i.test(u.name + u.email)), search.body);
const badSort = await send('GET', '/api/auth/users?page=1&sortBy=password', A);
check('non-whitelisted sortBy falls back safely', badSort.status === 200, badSort.body);

console.log('\n=== 3. create user in own tenant ===');
const created = await send('POST', '/api/auth/register', A, {
  name: 'QA UserMgmt', email: TEST_EMAIL, password: PW_OLD, role: 'Member',
});
check('register 201', created.status === 201, created.body);
const uid = created.body?.data?.user?.id;

console.log('\n=== 4. PATCH guards ===');
const xtenant = await send('PATCH', `/api/auth/users/${uid}`, M, { name: 'Hacked' });
check('cross-tenant PATCH -> 404', xtenant.status === 404, xtenant.body);
const mint = await send('PATCH', `/api/auth/users/${uid}`, A, { role: 'SuperAdmin' });
check('SuperAdmin assignment rejected (400)', mint.status === 400, mint.body);
const self = await send('PATCH', `/api/auth/users/${admin.body?.id}`, A, { status: 'suspended' });
check('self-deactivation blocked (409)', self.status === 409, self.body);
const rolePerm = await send('PATCH', `/api/auth/users/${uid}`, A, {
  role: 'Manager', permissions: { DEPOSITS: 'READ', MEMBERS: 'NONE', EVIL: 'WRITE' },
});
check('role+permissions PATCH (unknown screen rejected 400)', rolePerm.status === 400, rolePerm.body);
const rolePerm2 = await send('PATCH', `/api/auth/users/${uid}`, A, {
  role: 'Manager', permissions: { DEPOSITS: 'READ', MEMBERS: 'NONE' },
});
check('role+permissions PATCH valid -> 200', rolePerm2.status === 200, rolePerm2.body);
check('permissions persisted', rolePerm2.body?.data?.permissions?.DEPOSITS === 'READ' && rolePerm2.body?.data?.permissions?.MEMBERS === 'NONE', rolePerm2.body);

console.log('\n=== 5. Manager cannot mutate ===');
const mgrDir = await login('manager@meridian.dev', 'pass-12345678');
if (mgrDir.status === 200) {
  const denied = await send('PATCH', `/api/auth/users/${uid}`, mgrDir.cookies, { role: 'Admin' });
  check('Manager PATCH -> 403', denied.status === 403, denied.body);
  const view = await send('GET', '/api/auth/users?page=1', mgrDir.cookies);
  check('Manager GET paginated -> 200', view.status === 200, view.body);
} else {
  console.log('  SKIP  manager@meridian login failed (not seeded?)');
}

console.log('\n=== 6. password reset + status enforcement ===');
const badPw = await send('POST', `/api/auth/users/${uid}`, A, { password: 'weak' });
check('weak password -> 400', badPw.status === 400, badPw.body);
const reset = await send('POST', `/api/auth/users/${uid}`, A, { password: PW_NEW });
check('reset -> 200', reset.status === 200, reset.body);
const loginOld = await login(TEST_EMAIL, PW_OLD);
check('old password rejected', loginOld.status !== 200, loginOld.body);
const loginNew = await login(TEST_EMAIL, PW_NEW);
check('new password works', loginNew.status === 200, loginNew.body);
const deactivate = await send('PATCH', `/api/auth/users/${uid}`, A, { status: 'suspended' });
check('deactivate -> 200', deactivate.status === 200, deactivate.body);
const loginSuspended = await login(TEST_EMAIL, PW_NEW);
check('suspended user cannot sign in', loginSuspended.status !== 200, loginSuspended.body);

console.log('\n=== 7. cleanup (platform delete) ===');
const su = await login('superadmin@investwise.com', 'pass-12345678');
if (su.status === 200 && uid) {
  const del = await send('DELETE', `/api/admin/users?userId=${uid}`, su.cookies);
  check('delete QA user via platform console', del.status === 200, del.body);
} else {
  console.log('  SKIP  superadmin login unavailable — QA user left suspended:', TEST_EMAIL);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
