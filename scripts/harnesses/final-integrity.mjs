import postgres from 'postgres';
const sql = postgres('postgresql://postgres:postgres@localhost:5432/investwise', { prepare: false });
// Canonical rule from lib/reports/data.ts (the finance modules' cash-movement
// classification, itself the reference implementation for classifyLedgerType).
// This verifier used to carry a second, drifted copy of the classifier and it
// flagged the two dividend-run rows as "unmapped" — a FALSE POSITIVE, because
// the app had already classified them deliberately (issue #97):
//
//   * `Statutory Reserve` is CREDIT (inflow): a run moves the reserve share of
//     the gross INTO the reserve fund and posts this row against it. Without
//     it the reserve fund's own ledger ends `reserveAmount` short of the cash
//     it holds. The matching `Transfer Out -RESERVE-OUT` leg sits on the PAYOUT
//     fund, so tenant-wide the move nets to zero (no new money) — which is why
//     it belongs in the fund-balance rule but not in a KPI inflow headline.
//   * `Dividend Distribution` is 0/0 (informational): it is the run-level
//     ROLLUP of the per-member `Dividend` rows on the SAME fund, so signing it
//     would count the same money twice. It is carried for reporting only.
//
// Verified empirically: with this rule green-valley's Member Deposit Fund
// reconciles at 3,425,172 and its Statutory Reserve Fund at 168,400; crediting
// the rollup would put the deposit fund 164,928 adrift and excluding the
// reserve row would put the reserve fund 18,400 adrift.
const SETTLED = ['Completed', 'Success'];
const INFLOW_ALWAYS = ['Earning', 'Investment', 'Transfer In', 'Statutory Reserve'];
const OUTFLOW_ALWAYS = ['Expense', 'Disbursement', 'Transfer Out', 'Withdrawal'];
const INFLOW_SETTLED = ['Deposit'];
const OUTFLOW_SETTLED = ['Dividend'];
// Informational rollups: present in live data, deliberately sign 0/0.
const IGNORED_TYPES = ['Dividend Distribution'];

let fails = 0;
const ok = (l, c, d='') => { console.log((c?'PASS  ':'FAIL  ')+l+(d?` — ${d}`:'')); if(!c) fails++; };

for (const slug of ['green-valley','northbridge','meridian']) {
  const [t] = await sql`select id, name from tenants where slug=${slug}`;
  console.log(`\n===== ${slug} (${t.name}) =====`);
  const funds = await sql`select id, name, balance from funds where tenant_id=${t.id} order by name`;
  for (const f of funds) {
    const rows = await sql`select type, status, coalesce(sum(amount),0)::numeric(15,2) s, count(*)::int n
      from transactions where tenant_id=${t.id} and fund_id=${f.id} and is_deleted=false
      group by type, status`;
    let led=0; const un=[];
    for (const r of rows){
      const settled = SETTLED.includes(r.status);
      if (INFLOW_ALWAYS.includes(r.type)) led += Number(r.s);
      else if (OUTFLOW_ALWAYS.includes(r.type)) led -= Number(r.s);
      else if (INFLOW_SETTLED.includes(r.type)) { if (settled) led += Number(r.s); }
      else if (OUTFLOW_SETTLED.includes(r.type)) { if (settled) led -= Number(r.s); }
      else if (IGNORED_TYPES.includes(r.type)) { /* informational rollup — 0/0 */ }
      else un.push(`${r.type}/${r.status}(x${r.n})`);
    }
    ok(`fund ${f.name} reconciles`, Math.abs(Number(f.balance)-led)<0.005 && un.length===0,
      un.length?`unmapped ${un.join(',')}`:`${f.balance} vs ${led.toFixed(2)}`);
  }
  const [r1] = await sql`select count(*)::int n from funds where tenant_id=${t.id} and balance<0`;
  ok('no negative fund balances', r1.n===0);
  const [r2] = await sql`select count(*)::int n from members where tenant_id=${t.id} and is_deleted=false and total_contributed<0`;
  ok('no negative member balances', r2.n===0);
  const [r3] = await sql`select count(*)::int n from transactions where tenant_id=${t.id} and is_deleted=false and fund_id is null and type not in ('Deposit','Withdrawal')`;
  ok('no orphan fund references', r3.n===0);
  const [r4] = await sql`select count(*)::int n from (select reference_number from transactions where tenant_id=${t.id} and is_deleted=false and reference_number is not null group by reference_number having count(*)>1) x`;
  ok('no duplicate live references', r4.n===0);
  const [r5] = await sql`select count(*)::int n from transactions where tenant_id=${t.id} and type='Transfer' and is_deleted=false`;
  ok('no unsignable bare Transfer rows', r5.n===0);
  // Residue means a LIVE, balance-affecting probe row: a settled deposit row
  // from a harness would already show up as a reconciliation failure above.
  const [r6] = await sql`select count(*)::int n from transactions
    where tenant_id=${t.id} and is_deleted=false and status in ('Completed','Success')
      and (description ilike '%e2e%' or description ilike '%probe%')`;
  ok('no live settled probe residue', r6.n===0, `${r6.n} rows`);
  // fiscal coverage
  const [r7] = await sql`select count(*)::int n from fiscal_periods where tenant_id=${t.id} and status='OPEN' and now() between period_start and period_end`;
  ok('an OPEN fiscal period covers today', r7.n===1, `${r7.n} open periods now`);
  // unpaired transfer groups
  const bad = await sql`select transfer_group_id from transactions where tenant_id=${t.id} and transfer_group_id is not null and is_deleted=false group by transfer_group_id having count(*)<>2 or sum(case when type='Transfer In' then amount else -amount end)<>0`;
  ok('all transfer groups paired & balanced', bad.length===0, `${bad.length} bad`);
  // tenant isolation on members
  const [r8] = await sql`select count(*)::int n from members m where m.tenant_id <> ${t.id} and m.is_deleted=false and m.total_contributed < 0`;
  ok('(cross-tenant sanity) no negative contributions anywhere', r8.n===0);
}
console.log(`\n${fails===0?'ALL INTEGRITY CHECKS PASS':fails+' CHECKS FAILED'}`);
await sql.end();
process.exit(fails?1:0);
