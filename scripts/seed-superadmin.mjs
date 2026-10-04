/**
 * Bootstrap seed for the multi-tenant foundation (migration 0001).
 * Idempotent: safe to re-run. Reads .env.local directly so it needs no deps
 * beyond node, postgres and bcryptjs (already installed).
 *
 * Usage: npm run db:seed
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const postgres = require(path.join(repoRoot, 'node_modules', 'postgres'));
const bcrypt = require(path.join(repoRoot, 'node_modules', 'bcryptjs'));

function loadEnvFile() {
  const env = { ...process.env };
  for (const file of ['.env.local', '.env']) {
    const p = path.join(repoRoot, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return env;
}

const SCREENS = ['DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS', 'REQUEST_DEPOSIT', 'TRANSACTIONS', 'DIVIDENDS', 'EXPENSES', 'PROJECT_MANAGEMENT', 'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS'];

// Development convenience only — rejected outright when NODE_ENV=production.
const DEV_DEFAULT_PASSWORD = 'pass-12345678';

const env = loadEnvFile();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (.env.local).');
  process.exit(1);
}
const EMAIL = (env.SUPERADMIN_EMAIL || 'superadmin@investwise.com').toLowerCase().trim();

// The update branch below re-writes the password on every run, so an absent
// SUPERADMIN_PASSWORD in production would silently reset the only platform
// operator to a value that is committed to this file in public. Fail closed on
// that path instead. Local seeding keeps the convenience default.
const isProduction = (env.NODE_ENV || '').trim().toLowerCase() === 'production';
const configured = env.SUPERADMIN_PASSWORD;
if (!configured || configured === DEV_DEFAULT_PASSWORD) {
  if (isProduction) {
    console.error(
      'SUPERADMIN_PASSWORD must be set to a unique strong value before seeding in production ' +
        '(this script resets the operator password on every run).'
    );
    process.exit(1);
  }
  if (!configured) {
    console.warn('SUPERADMIN_PASSWORD is not set — using the development default. Never do this in production.');
  }
}
const PASSWORD = configured || DEV_DEFAULT_PASSWORD;

const sql = postgres(env.DATABASE_URL, { prepare: false, connect_timeout: 15 });

try {
  await sql`insert into tenants (slug, name, status, plan) values ('default', 'Default Organization', 'active', 'standard') on conflict (slug) do nothing`;

  const hash = await bcrypt.hash(PASSWORD, 12);
  const perms = Object.fromEntries(SCREENS.map((s) => [s, 'WRITE']));
  const existing = await sql`select id from users where email = ${EMAIL} limit 1`;
  if (existing.length > 0) {
    await sql`update users set password = ${hash}, role = 'SuperAdmin', status = 'active', permissions = ${sql.json(perms)}, updated_at = now() where email = ${EMAIL}`;
    console.log('superadmin updated:', EMAIL);
  } else {
    await sql`insert into users (id, name, email, password, role, status, permissions) values (${crypto.randomUUID()}, 'SuperAdmin', ${EMAIL}, ${hash}, 'SuperAdmin', 'active', ${sql.json(perms)})`;
    console.log('superadmin created:', EMAIL);
  }

  await sql`insert into subscription_plans (slug, name, price_monthly, max_users, features, is_active) values
    ('standard', 'Standard', '0', 100, '{"members": true, "funds": true, "reports": true}', true),
    ('premium', 'Premium', '4990', 1000, '{"members": true, "funds": true, "reports": true, "api": true, "priority": true}', true)
    on conflict (slug) do nothing`;

  await sql`insert into tenant_subscriptions (tenant_id, status)
    select id, 'active' from tenants where slug = 'default'
    and not exists (select 1 from tenant_subscriptions where tenant_id = tenants.id)`;

  console.log('seed complete');
} finally {
  await sql.end();
}
