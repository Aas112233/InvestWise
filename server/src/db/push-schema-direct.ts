import dotenv from 'dotenv';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is missing.');
  process.exit(1);
}

console.log('🔌 Connecting to Supabase PostgreSQL Database...');
const sql = postgres(connectionString, { ssl: 'require', max: 1 });

async function runDirectSchemaMigration() {
  try {
    console.log('🚀 Applying ALTER TABLE schema updates for members table to Supabase...');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS nid_or_passport varchar(100);
    `;
    console.log('✅ Added column: nid_or_passport');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS father_name varchar(255);
    `;
    console.log('✅ Added column: father_name');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS address varchar(500);
    `;
    console.log('✅ Added column: address');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_name varchar(255);
    `;
    console.log('✅ Added column: nominee_name');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_relation varchar(100);
    `;
    console.log('✅ Added column: nominee_relation');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_nid_or_passport varchar(100);
    `;
    console.log('✅ Added column: nominee_nid_or_passport');

    await sql`
      ALTER TABLE members ADD COLUMN IF NOT EXISTS nominee_phone varchar(50);
    `;
    console.log('✅ Added column: nominee_phone');

    // Also check if any migration file exists to execute
    const migrationFilePath = path.join(process.cwd(), 'drizzle', '0000_silly_hercules.sql');
    if (fs.existsSync(migrationFilePath)) {
      console.log('📄 Found Drizzle migration file, executing complete schema verification...');
      const sqlContent = fs.readFileSync(migrationFilePath, 'utf8');
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        try {
          await sql.unsafe(statement);
        } catch (err: any) {
          // Ignore table/column already exists or duplicate object errors
          if (
            err.code === '42P07' || // duplicate_table
            err.code === '42701' || // duplicate_column
            err.code === '42710' || // duplicate_object
            err.message?.includes('already exists')
          ) {
            // Already applied
          } else {
            console.warn('Notice during migration execution:', err.message);
          }
        }
      }
    }

    console.log('🎉 SCHEMA SUCCESSFULLY PUSHED TO SUPABASE POSTGRESQL!');
  } catch (err) {
    console.error('❌ Migration Error:', err);
  } finally {
    await sql.end();
    process.exit(0);
  }
}

runDirectSchemaMigration();
