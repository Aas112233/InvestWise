import { it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, sql, eq } from 'drizzle-orm';
import * as schema from '@/db/schema/index';
import { transactions } from '@/db/schema/index';
import { inflowSqlPredicate, outflowSqlPredicate } from '@/lib/ledger-selectors';

it('dump KPI sql', () => {
  const captured: string[] = [];
  const client = postgres('postgres://x:x@localhost:59999/x', { max: 1, connect_timeout: 1, idle_timeout: 1 });
  const db = drizzle(client, { schema, logger: { logQuery: (q) => captured.push(q) } });
  const whereClause = and(sql`${transactions.isDeleted} = false`, sql`${transactions.tenantId} = 'T'`, sql`${transactions.type} = 'Earning'`);
  const flowScope = and(whereClause, sql`${inflowSqlPredicate()} OR ${outflowSqlPredicate()}`);
  try {
    db.select({
      inflow: sql`coalesce(sum(case when ${inflowSqlPredicate()} then ${transactions.amount}::numeric else 0 end), 0)::numeric`,
      outflow: sql`coalesce(sum(case when ${outflowSqlPredicate()} then ${transactions.amount}::numeric else 0 end), 0)::numeric`,
    }).from(transactions).where(flowScope).then(() => {}, () => {});
  } catch (e) { console.log('sync-throw', e); }
  setTimeout(() => {
    console.log('CAPTURED:\n' + captured.join('\n---\n'));
    console.log('EMPTY?', captured.length === 0);
    process.exit(0);
  }, 1500);
});
