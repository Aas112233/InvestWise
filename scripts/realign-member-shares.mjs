/**
 * One-time realign of member share numbers onto the canonical formula:
 *
 *   shares = floor(totalContributed / shareValueBdt)
 *
 * Only members WITH at least one non-deleted transaction are touched — a
 * member without transactions is still in the one-time-setup phase and keeps
 * its manually assigned count. Share numbers are locked once transactions
 * exist (deposits never change them), so this run is the single aligned
 * snapshot; afterwards the invariant simply holds.
 *
 * Idempotent: re-running reports 0 changes. Local-only — never deploy-run.
 *
 * Usage:
 *   npm run shares:realign -- --dry   # print what would change, write nothing
 *   npm run shares:realign            # apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const postgres = require(path.join(repoRoot, 'node_modules', 'postgres'));

const DRY = process.argv.includes('--dry');
const DEFAULT_SHARE_VALUE_CENTS = 100_000; // 1000.00 BDT per share

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

/** Exact cents from a Postgres numeric(15,2) string — no float math. */
function toCents(value) {
  const s = String(value ?? '0').trim() || '0';
  const m = s.match(/^(-?\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`Unparseable amount: ${s}`);
  const sign = m[1].startsWith('-') ? -1 : 1;
  const whole = Math.abs(parseInt(m[1], 10));
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return sign * (whole * 100 + frac);
}

const env = loadEnvFile();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (.env.local).');
  process.exit(1);
}
const sql = postgres(env.DATABASE_URL, { prepare: false, connect_timeout: 15 });

try {
  const settings = await sql`select tenant_id, share_value_bdt from system_settings`;
  const centsByTenant = new Map();
  for (const row of settings) {
    const cents = toCents(row.share_value_bdt ?? '1000');
    if (cents <= 0) {
      throw new Error(`Tenant ${row.tenant_id ?? 'default'} has a non-positive share value (${row.share_value_bdt}). Fix it before realigning.`);
    }
    if (row.tenant_id) centsByTenant.set(row.tenant_id, cents);
  }

  const members = await sql`
    select m.id, m.tenant_id, m.member_id, m.name, m.shares, m.total_contributed,
           (select count(*) from transactions t
             where t.member_id = m.id and t.is_deleted = false) as txn_count
    from members m
    order by m.tenant_id, m.member_id
  `;

  let scanned = 0;
  let locked = 0;
  let changed = 0;
  const byTenant = new Map();

  for (const member of members) {
    scanned += 1;
    if (Number(member.txn_count) <= 0) continue; // still in setup phase
    locked += 1;
    const shareValueCents = centsByTenant.get(member.tenant_id) ?? DEFAULT_SHARE_VALUE_CENTS;
    const expected = Math.floor(toCents(member.total_contributed) / shareValueCents);
    if (expected === member.shares) continue;

    changed += 1;
    const key = member.tenant_id ?? 'default';
    const t = byTenant.get(key) ?? { changed: 0 };
    t.changed += 1;
    byTenant.set(key, t);
    console.log(`[change] ${member.member_id} ${member.name}: ${member.shares} -> ${expected} shares (contributed ${member.total_contributed})`);
    if (!DRY) {
      await sql`update members set shares = ${expected}, updated_at = now() where id = ${member.id}`;
    }
  }

  console.log('');
  console.log(`scanned: ${scanned} members; locked (with transactions): ${locked}; ${DRY ? 'would change' : 'changed'}: ${changed}`);
  for (const [tenantId, t] of byTenant) console.log(`  tenant ${tenantId}: ${t.changed}`);
  if (DRY) console.log('dry run — nothing was written. Re-run without --dry to apply.');
} finally {
  await sql.end({ timeout: 5 });
}
