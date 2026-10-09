// Live E2E: enhanced SuperAdmin tenant onboarding (#105).
// Proves the onboard route passes financial config + extra funds through to
// provisioning, the tenant lands fully configured, and cleanup restores state.
import postgres from 'postgres';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? ` — ${detail}` : ''));
  cond ? pass++ : fail++;
};
const sql = postgres('postgresql://postgres:postgres@localhost:5432/investwise', { prepare: false });

const STAMP = Date.now().toString(36);
const SLUG = `e2e-onb-${STAMP}`;
const EMAIL = `onb-admin-${STAMP}@e2e.test`;

let cookie = '';
const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@investwise.com', password: 'pass-12345678' }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  cookie = setCookie.split(';')[0];
  ok('superadmin login', res.status === 200 && cookie.length > 10, `status=${res.status}`);
};
await login();

// Pre-clean: any e2e-onb-* tenants left by an earlier aborted run.
const stale = await sql`select id from tenants where slug like 'e2e-onb-%'`;
for (const t of stale) {
  await fetch(`${BASE}/api/admin/tenants/${t.id}?force=true`, { method: 'DELETE', headers: { cookie } });
}
if (stale.length > 0) console.log(`pre-cleaned ${stale.length} stale e2e tenant(s)`);

// 1. Onboard with the FULL payload the enhanced panel now sends.
const res = await fetch(`${BASE}/api/admin/tenants/onboard`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({
    name: 'E2E Onboard Test Org',
    slug: SLUG,
    plan: 'standard',
    maxUsers: 55,
    adminName: 'Onboard Tester',
    adminEmail: EMAIL,
    adminPassword: 'Str0ng!Passw0rd',
    financial: {
      baseCurrency: 'USD',
      shareValue: '2500.00',
      dateFormat: 'MM/DD/YYYY',
      fiscalYearStart: 'October',
      fiscalYearEnd: 'September',
    },
    funds: [
      { name: 'Welfare Fund', type: 'OTHER' },
      { name: 'Building Fund', type: 'PRIMARY' },
    ],
  }),
});
const body = await res.json().catch(() => ({}));
ok('onboard returns 201', res.status === 201, `status=${res.status} msg=${body.message ?? ''}`);
ok('response carries tenantId+slug+adminEmail', !!body.data?.tenantId && body.data?.slug === SLUG && body.data?.adminEmail === EMAIL);

const tenantId = body.data?.tenantId;

// 2. DB verification — everything provisioned as configured.
if (tenantId) {
  const [t] = await sql`select name, slug, plan, max_users, status from tenants where id=${tenantId}`;
  ok('tenant row correct', !!t && t.name === 'E2E Onboard Test Org' && t.plan === 'standard' && t.max_users === 55 && t.status === 'active');

  const [s] = await sql`select base_currency, share_value_bdt, date_format, fiscal_year_start, fiscal_year_end, company_name from system_settings where tenant_id=${tenantId}`;
  ok('financial settings persisted', !!s && s.base_currency === 'USD' && String(s.share_value_bdt) === '2500.00'
    && s.date_format === 'MM/DD/YYYY' && s.fiscal_year_start === 'October' && s.fiscal_year_end === 'September',
    s ? `${s.base_currency} ${s.share_value_bdt} ${s.date_format} ${s.fiscal_year_start}-${s.fiscal_year_end}` : 'missing');

  const funds = await sql`select name, type, account_number, balance from funds where tenant_id=${tenantId} order by account_number`;
  ok('4 default + 2 extra funds seeded', funds.length === 6, `${funds.length} funds`);
  ok('extra fund names landed', funds.some((f) => f.name === 'Welfare Fund') && funds.some((f) => f.name === 'Building Fund'));
  ok('account numbers carry slug', funds.every((f) => String(f.account_number).startsWith(SLUG.toUpperCase() + '-')));
  ok('no fund holds money at birth (§12)', funds.every((f) => Number(f.balance) === 0));

  const [u] = await sql`select name, email, role, status from users where tenant_id=${tenantId}`;
  ok('org admin created', !!u && u.email === EMAIL && u.role === 'Admin' && u.status === 'active', u?.email ?? 'missing');

  const [sub] = await sql`select status from tenant_subscriptions where tenant_id=${tenantId}`;
  ok('14-day trial attached', !!sub && sub.status === 'trial');

  const [log] = await sql`select action, actor_user_id from subscription_change_log where tenant_id=${tenantId}`;
  ok('subscription change log written', !!log && log.action === 'TENANT_ONBOARDED' && log.actor_user_id !== null);

  // 3. Validation path: an invalid financial field must fail with 400 and
  // leave no partial tenant behind. ('2500' is VALID — the regex allows
  // integer amounts and provisioning normalizes to 2500.00 — so use three
  // decimals, which genuinely violates the money format.)
  const bad = await fetch(`${BASE}/api/admin/tenants/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'E2E Bad Money Org', slug: SLUG + '-bad', adminEmail: `bad-${STAMP}@e2e.test`,
      adminPassword: 'Str0ng!Passw0rd', financial: { shareValue: '2500.123' },
    }),
  });
  const badBody = await bad.json().catch(() => ({}));
  ok('invalid shareValue rejected 400', bad.status === 400, `status=${bad.status} msg=${badBody.message ?? ''}`);
  const [ghost] = await sql`select id from tenants where slug=${SLUG + '-bad'}`;
  ok('failed run leaves no partial tenant', !ghost);

  // 4. Conflict path: duplicate slug must 409.
  const dup = await fetch(`${BASE}/api/admin/tenants/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: 'E2E Dup', slug: SLUG, adminEmail: `dup-${STAMP}@e2e.test`, adminPassword: 'Str0ng!Passw0rd' }),
  });
  ok('duplicate slug rejected 409', dup.status === 409, `status=${dup.status}`);

  // 5. Non-superadmin must be refused (use an org admin of another tenant).
  const memberLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@greenvalley.dev', password: 'pass-12345678' }),
  });
  const memberCookie = (memberLogin.headers.get('set-cookie') ?? '').split(';')[0];
  const forbidden = await fetch(`${BASE}/api/admin/tenants/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: memberCookie },
    body: JSON.stringify({ name: 'Nope', adminEmail: `nope-${STAMP}@e2e.test`, adminPassword: 'Str0ng!Passw0rd' }),
  });
  ok('non-superadmin refused', forbidden.status === 403, `status=${forbidden.status}`);

  // 6. Cleanup: force delete restores pre-test state.
  const del = await fetch(`${BASE}/api/admin/tenants/${tenantId}?force=true`, {
    method: 'DELETE',
    headers: { cookie },
  });
  ok('force delete cleanup', del.status === 200 || del.status === 204, `status=${del.status}`);
  const [gone] = await sql`select id from tenants where id=${tenantId}`;
  ok('tenant fully removed', !gone);
} else {
  ok('skip DB checks (no tenantId)', false);
}

console.log(`\n${fail === 0 ? 'ALL ONBOARDING E2E PASS' : fail + ' FAILURES'} (${pass} pass)`);
await sql.end();
process.exit(fail ? 1 : 0);
