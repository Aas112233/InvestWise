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

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    console.log(`Applying migration: ${file}...`);
    try {
      await sql.unsafe(content);
      console.log(`[OK] ${file} applied successfully.`);
    } catch (err) {
      console.error(`[WARN] Migration ${file} notice:`, err.message);
    }
  }

  // Explicit safety check on system_settings columns
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
    console.error('[ERROR] system_settings verification failed:', err.message);
  }

  await sql.end();
  console.log('Migration process finished.');
}

run().catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
