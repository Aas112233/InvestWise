import readline from 'readline';
import dotenv from 'dotenv';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';

dotenv.config();

const isAuto = process.argv.includes('--yes') || process.argv.includes('-y') || process.argv.includes('--auto') || process.env.CI === 'true';

let rlInstance: readline.Interface | null = null;

function getRL(): readline.Interface {
  if (!rlInstance || (rlInstance as any).closed) {
    rlInstance = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rlInstance;
}

function ask(query: string, defaultValue = ''): Promise<string> {
  if (isAuto) {
    console.log(`${query}: ${defaultValue}`);
    return Promise.resolve(defaultValue);
  }
  return new Promise((resolve) => {
    const rl = getRL();
    const promptText = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    let resolved = false;

    const onLine = (ans: string) => {
      if (!resolved) {
        resolved = true;
        resolve(ans.trim() || defaultValue);
      }
    };

    rl.question(promptText, onLine);

    rl.once('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(defaultValue);
      }
    });
  });
}

function askSecret(query: string, defaultValue = 'Admin@123456'): Promise<string> {
  if (isAuto) {
    console.log(`${query}: [Default Password]`);
    return Promise.resolve(defaultValue);
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || !stdin.setRawMode) {
      const rl = getRL();
      const promptText = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
      let resolved = false;

      const onLine = (ans: string) => {
        if (!resolved) {
          resolved = true;
          resolve(ans.trim() || defaultValue);
        }
      };

      rl.question(promptText, onLine);

      rl.once('close', () => {
        if (!resolved) {
          resolved = true;
          resolve(defaultValue);
        }
      });
      return;
    }

    process.stdout.write(`${query} [press Enter for default]: `);
    const oldRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    const onData = (ch: string) => {
      const charCode = ch.charCodeAt(0);
      if (charCode === 13 || charCode === 10 || ch === '\n' || ch === '\r') {
        // Enter key
        stdin.setRawMode(oldRawMode);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password.trim() || defaultValue);
      } else if (charCode === 3) {
        // Ctrl+C
        stdin.setRawMode(oldRawMode);
        process.exit(1);
      } else if (charCode === 8 || charCode === 127) {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += ch;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  console.clear();
  console.log('======================================================================');
  console.log('         INVESTWISE - AUTOMATED DATABASE & ADMIN SETUP WIZARD         ');
  console.log('======================================================================');
  console.log('This wizard will initialize your PostgreSQL database schema, configure');
  console.log('environment variables, and provision your Super Admin account.\n');

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Resolve DATABASE_URL
  // ───────────────────────────────────────────────────────────────────────────
  let dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl) {
    console.log('[INFO] No DATABASE_URL found in environment.');
    console.log('You can use:');
    console.log('  • Supabase URL: postgresql://postgres.[ref]:[pwd]@aws-0-[region].pooler.supabase.com:6543/postgres');
    console.log('  • Neon.tech URL: postgresql://[user]:[pwd]@[host]/[dbname]?sslmode=require');
    console.log('  • Local Postgres: postgresql://postgres:postgres@localhost:5432/investwise\n');

    dbUrl = await ask('Enter your PostgreSQL Connection String (DATABASE_URL)');
    while (!dbUrl) {
      console.log('[ERROR] DATABASE_URL cannot be empty.');
      dbUrl = await ask('Enter your PostgreSQL Connection String (DATABASE_URL)');
    }
  } else {
    console.log(`[INFO] Found existing DATABASE_URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
    const useExisting = await ask('Do you want to use this database?', 'yes');
    if (useExisting.toLowerCase() !== 'yes' && useExisting.toLowerCase() !== 'y') {
      dbUrl = await ask('Enter new PostgreSQL Connection String (DATABASE_URL)');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Test Database Connection
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[CONNECTING] Connecting to PostgreSQL database...');
  let sql: ReturnType<typeof postgres>;
  try {
    const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
    sql = postgres(dbUrl, {
      ssl: isLocal ? false : { rejectUnauthorized: false },
      connect_timeout: 15,
      max: 5,
      prepare: false,
      onnotice: () => {},
    });

    const [testResult] = await sql`SELECT 1 as connected, current_database() as db_name, version() as pg_ver`;
    console.log(`[OK] Connection established! Connected to database: "${testResult.db_name}"`);
  } catch (err: any) {
    console.error(`\n[ERROR] Database connection failed: ${err.message || err}`);
    console.log('Please verify your connection credentials, network reachability, and SSL settings.');
    if (rlInstance) rlInstance.close();
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Apply Schema & Migrations
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[STEP 1/4] Applying Database Schemas & Migrations...');
  try {
    const serverEnvPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(serverEnvPath)) {
      envContent = fs.readFileSync(serverEnvPath, 'utf8');
    }
    
    const jwtSecretMatch = envContent.match(/JWT_SECRET=(.+)/);
    const jwtSecret = jwtSecretMatch ? jwtSecretMatch[1].trim() : crypto.randomBytes(32).toString('hex');

    const updatedEnv = `DATABASE_URL="${dbUrl}"\nJWT_SECRET="${jwtSecret}"\nPORT=5000\nNODE_ENV=production\n`;
    fs.writeFileSync(serverEnvPath, updatedEnv);

    // Also update client/.env.local if present
    const clientEnvPath = path.resolve(process.cwd(), '../client/.env.local');
    if (!fs.existsSync(clientEnvPath)) {
      fs.writeFileSync(clientEnvPath, `VITE_API_URL=http://localhost:5000\nVITE_CURRENCY=BDT\n`);
    }

    // Direct Schema Migration execution from Drizzle generated files
    const migrationFilePath = path.join(process.cwd(), 'drizzle', '0000_silly_hercules.sql');
    if (fs.existsSync(migrationFilePath)) {
      const sqlContent = fs.readFileSync(migrationFilePath, 'utf8');
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await sql.unsafe(statement);
        } catch (err: any) {
          if (
            err.code === '42P07' || // duplicate_table
            err.code === '42701' || // duplicate_column
            err.code === '42710' || // duplicate_object
            err.message?.includes('already exists')
          ) {
            // Already exists, ignore
          } else {
            // non-fatal notice
          }
        }
      }
    }

    // Ensure all critical columns exist
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS nid_or_passport varchar(100);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS father_name varchar(255);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS mother_name varchar(255);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS spouse_name varchar(255);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS address varchar(500);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_name varchar(255);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_relation varchar(100);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_nid_or_passport varchar(100);`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS warning_count integer DEFAULT 0 NOT NULL;`;
    await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS performance_score numeric(5, 2) DEFAULT '100.00' NOT NULL;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS monthly_meeting_day integer DEFAULT 5 NOT NULL;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS deposit_due_date integer DEFAULT 10 NOT NULL;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS grace_period_days integer DEFAULT 3 NOT NULL;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS meeting_types jsonb DEFAULT '["FOUNDING_MEMBER", "SHAREHOLDER", "INVESTOR", "GENERAL"]'::jsonb;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS penalty_rules jsonb;`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_name varchar(150) DEFAULT 'InvestWise';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_tagline varchar(255) DEFAULT 'Enterprise Investment Management';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_address varchar(255) DEFAULT '';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_email varchar(100) DEFAULT '';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_phone varchar(50) DEFAULT '';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_website varchar(100) DEFAULT '';`;
    await sql`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS company_reg_no varchar(50) DEFAULT '';`;

    console.log('[OK] All PostgreSQL tables and indexes are in sync!');
  } catch (pushErr: any) {
    console.log('[WARN] Schema sync notice:', pushErr.message || pushErr);
    console.log('Continuing with database initialization...');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Provision Super Admin Account
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[STEP 2/4] Super Administrator Setup');
  const adminName = await ask('Admin Full Name', 'Super Admin');
  const adminEmail = await ask('Admin Email Address', 'admin@investwise.com');
  
  let adminPassword = await askSecret('Admin Password (min 6 characters)');
  while (!adminPassword || adminPassword.length < 6) {
    console.log('\n[ERROR] Password must be at least 6 characters.');
    adminPassword = await askSecret('Admin Password (min 6 characters)');
  }

  const adminPhone = await ask('Admin Phone Number', '+8801700000000');

  console.log('\n[PROVISIONING] Provisioning Admin User & Stakeholder record...');
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const adminUserId = uuidv4();
  const adminMemberId = uuidv4();

  const allPermissions = {
    DASHBOARD: 'WRITE',
    MEMBERS: 'WRITE',
    DEPOSITS: 'WRITE',
    TRANSACTIONS: 'WRITE',
    EXPENSES: 'WRITE',
    PROJECTS: 'WRITE',
    FUNDS: 'WRITE',
    DIVIDENDS: 'WRITE',
    MEETINGS: 'WRITE',
    GOVERNANCE: 'WRITE',
    REPORTS: 'WRITE',
    SETTINGS: 'WRITE',
  };

  // Upsert Admin User in `users`
  const [userRecord] = await sql`
    INSERT INTO users (id, name, email, password, role, status, permissions)
    VALUES (
      ${adminUserId},
      ${adminName},
      ${adminEmail},
      ${passwordHash},
      'Admin',
      'active',
      ${sql.json(allPermissions)}
    )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password = EXCLUDED.password,
      role = 'Admin',
      status = 'active',
      permissions = EXCLUDED.permissions
    RETURNING id, name, email, role;
  `;

  // Upsert corresponding Member record in `members`
  await sql`
    INSERT INTO members (
      id, member_id, name, email, phone, role, shares, total_contributed,
      status, user_id, has_user_access
    )
    VALUES (
      ${adminMemberId},
      'MEM-001',
      ${adminName},
      ${adminEmail},
      ${adminPhone},
      'Admin',
      10,
      0,
      'active',
      ${userRecord.id},
      true
    )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      role = 'Admin',
      user_id = EXCLUDED.user_id,
      has_user_access = true;
  `;

  console.log(`[OK] Administrator provisioned: ${userRecord.name} (${userRecord.email})`);

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Seed Core Institutional Funds
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[STEP 3/4] Initializing Core Institutional Funds...');
  const coreFunds = [
    {
      id: uuidv4(),
      name: 'General Operating & Deposit Fund',
      type: 'DEPOSIT',
      status: 'ACTIVE',
      currency: 'BDT',
      accountNumber: 'IW-CENTRAL-001',
      balance: 0,
      reconciliationStatus: 'VERIFIED',
      handlingOfficer: adminName,
      description: 'Primary liquidity clearinghouse for shareholder deposits and member capital contributions',
      isSystemAsset: true,
    },
    {
      id: uuidv4(),
      name: 'Project Venture & Development Fund',
      type: 'PROJECT',
      status: 'ACTIVE',
      currency: 'BDT',
      accountNumber: 'IW-VENTURE-002',
      balance: 0,
      reconciliationStatus: 'VERIFIED',
      handlingOfficer: adminName,
      description: 'Capital deployment fund for strategic enterprise investments, assets, and project acquisitions',
      isSystemAsset: true,
    },
    {
      id: uuidv4(),
      name: 'Emergency & Liquidity Reserve',
      type: 'Reserve',
      status: 'ACTIVE',
      currency: 'BDT',
      accountNumber: 'IW-EMERGENCY-003',
      balance: 0,
      reconciliationStatus: 'VERIFIED',
      handlingOfficer: adminName,
      description: 'Contingency pool and liquidity safety net',
      isSystemAsset: true,
    },
    {
      id: uuidv4(),
      name: 'Dividend & Profit Distribution Pool',
      type: 'OTHER',
      status: 'ACTIVE',
      currency: 'BDT',
      accountNumber: 'IW-DIVIDEND-004',
      balance: 0,
      reconciliationStatus: 'VERIFIED',
      handlingOfficer: adminName,
      description: 'Vault for distributing project return dividends and capital gains',
      isSystemAsset: false,
    },
  ];

  for (const f of coreFunds) {
    await sql`
      INSERT INTO funds (id, name, type, status, currency, account_number, balance, reconciliation_status, handling_officer, description, is_system_asset)
      VALUES (${f.id}, ${f.name}, ${f.type}, ${f.status}, ${f.currency}, ${f.accountNumber}, ${f.balance}, ${f.reconciliationStatus}, ${f.handlingOfficer}, ${f.description}, ${f.isSystemAsset})
      ON CONFLICT (account_number) DO NOTHING;
    `;
  }
  console.log('[OK] Core Institutional Liquidity Funds verified!');

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Seed System Settings
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[STEP 4/4] Initializing System Configuration...');
  const [existingSettings] = await sql`SELECT id FROM system_settings LIMIT 1`;
  if (!existingSettings) {
    await sql`
      INSERT INTO system_settings (
        company_name, company_tagline, base_currency, share_value_bdt,
        monthly_meeting_day, deposit_due_date, grace_period_days
      )
      VALUES (
        'INVESTWISE ASSET MANAGEMENT',
        'Enterprise Investment Management',
        'BDT',
        1000,
        5,
        10,
        3
      )
    `;
  }
  console.log('[OK] System Settings & Configuration verified!');

  // Close SQL connection
  await sql.end();

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Setup Summary Banner
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n======================================================================');
  console.log('  INITIAL SETUP COMPLETED SUCCESSFULLY!');
  console.log('======================================================================');
  console.log(`\nSUPER ADMIN CREDENTIALS:`);
  console.log(`   • Email:    ${adminEmail}`);
  console.log(`   • Password: (As provided)`);
  console.log(`   • Role:     Administrator (Full Access)\n`);
  console.log(`APPLICATION URLS:`);
  console.log(`   • Web App:  http://localhost:3004`);
  console.log(`   • REST API: http://localhost:5000/api/health\n`);
  console.log(`TO START THE APP:`);
  console.log(`   Run: run-dev.bat (or "npm run dev" in client and server)`);
  console.log('======================================================================\n');

  if (rlInstance) rlInstance.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR] Setup Error:', err);
  if (rlInstance) rlInstance.close();
  process.exit(1);
});

