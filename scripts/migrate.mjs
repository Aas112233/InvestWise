import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const postgres = require(path.join(repoRoot, 'node_modules', 'postgres'));

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

const env = loadEnvFile();
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in .env.local or .env');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { prepare: false, connect_timeout: 15 });

async function run() {
  console.log('Running database migrations from db/migrations/ ...');
  const migrationsDir = path.join(repoRoot, 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Migration ledger (schema_migrations): records which files have been
  // applied so a re-deploy only ever runs what it has not run yet. Per-file
  // idempotency (IF NOT EXISTS / guarded DO blocks) remains the second line
  // of defense — any file can still be re-run by hand without harm.
  const ledgerReg = await sql`SELECT to_regclass('public.schema_migrations') AS reg`;
  const ledgerExisted = ledgerReg[0]?.reg != null;
  if (!ledgerExisted) {
    console.log('Creating migration ledger table: schema_migrations...');
    await sql`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "filename"   text PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `;
  }

  // Ledger freshly created AND the base schema already exists: this is an
  // existing database that predates the ledger. Migrations 0001-0008 are
  // recorded as applied WITHOUT re-running — their effects are already in the
  // schema (the oldest of them predate the ledger entirely). On a fresh
  // database (no transactions table yet) everything runs in order instead.
  if (!ledgerExisted) {
    const baseReg = await sql`SELECT to_regclass('public.transactions') AS reg`;
    if (baseReg[0]?.reg != null) {
      const predatesLedger = files.filter(f => /^000[1-8]_/.test(f));
      for (const file of predatesLedger) {
        await sql`INSERT INTO "schema_migrations" ("filename") VALUES (${file}) ON CONFLICT ("filename") DO NOTHING`;
        console.log(`[SKIP] ${file} recorded as applied (existing database; effects predate the ledger).`);
      }
    }
  }

  const applied = new Set(
    (await sql`SELECT filename FROM "schema_migrations"`).map(r => r.filename),
  );

  // Migrations FAIL FAST. A migration that is caught-and-continued leaves the
  // schema half-applied while the process still exits 0 — the next deploy then
  // runs against a schema nobody can describe. An error here stops the run.
  // Files are recorded in the ledger only after they succeed, so a failed run
  // retries the same file on the next deploy (safe: files are idempotent).
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[SKIP] ${file} already applied (recorded in schema_migrations).`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`Applying migration: ${file}...`);
    try {
      await sql.unsafe(content);
      await sql`INSERT INTO "schema_migrations" ("filename") VALUES (${file}) ON CONFLICT ("filename") DO NOTHING`;
      console.log(`[OK] ${file} applied successfully.`);
    } catch (err) {
      console.error(`[FAIL] Migration ${file} failed:`, err.message);
      await sql.end();
      process.exit(1);
    }
  }

  // Explicit safety check on system_settings columns. This one is a
  // follow-up backfill, not a migration, so it must not silently pass either.
  try {
    await sql`
      ALTER TABLE "system_settings"
        ADD COLUMN IF NOT EXISTS "late_deposit_grace_months" integer DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "inactive_after_months"     integer DEFAULT 3,
        ADD COLUMN IF NOT EXISTS "suspended_after_months"    integer DEFAULT 6;
    `;
    await sql`UPDATE "system_settings" SET "late_deposit_grace_months" = 1 WHERE "late_deposit_grace_months" IS NULL;`;
    await sql`UPDATE "system_settings" SET "inactive_after_months"     = 3 WHERE "inactive_after_months" IS NULL;`;
    await sql`UPDATE "system_settings" SET "suspended_after_months"    = 6 WHERE "suspended_after_months" IS NULL;`;
    console.log('[OK] Verified system_settings columns.');
  } catch (err) {
    console.error('[FAIL] system_settings verification failed:', err.message);
    await sql.end();
    process.exit(1);
  }

  await sql.end();
  console.log('Migration process finished.');
}

run().catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
