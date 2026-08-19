import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const sql = postgres(connectionString, { ssl: 'require', max: 1 });

async function checkAllConstraints() {
  const tables = ['members', 'transactions', 'meetings', 'meeting_attendees', 'member_penalties', 'projects'];
  for (const t of tables) {
    const res = await sql`
      SELECT conname, pg_get_constraintdef(oid)
      FROM pg_constraint
      WHERE conrelid = ${t}::regclass;
    `;
    console.log(`\n--- Constraints for ${t} ---`);
    console.log(res);
  }
  await sql.end();
}

checkAllConstraints();
