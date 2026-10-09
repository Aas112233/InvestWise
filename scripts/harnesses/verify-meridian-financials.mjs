import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require(path.resolve('node_modules/postgres'));
const sql = postgres('postgresql://postgres:postgres@localhost:5432/investwise', { prepare: false });
let fails = 0;
const ok = (l,c,d='') => { console.log((c?'PASS  ':'FAIL  ')+l+(d?` — ${d}`:'')); if(!c) fails++; };
const [t] = await sql`select id,name from tenants where slug='meridian'`;
const T = t.id;

// A) member.total_contributed == sum of that member's Deposit rows
const badContrib = await sql`
  select m.id from members m
  left join transactions tx on tx.member_id=m.id and tx.tenant_id=${T} and tx.type='Deposit'
       and tx.status in ('Completed','Success') and tx.is_deleted=false
  where m.tenant_id=${T} and m.is_deleted=false
  group by m.id, m.total_contributed
  having m.total_contributed <> coalesce(sum(tx.amount),0)`;
ok('member.total_contributed == sum(Deposit rows)', badContrib.length===0, `${badContrib.length} mismatched of 360`);

// B) fiscal summarisation + solvency
const fy = await sql`select year, net_surplus, statutory_reserve, distributable_surplus, actual_distributed, retained_earnings, status from fiscal_periods where tenant_id=${T} order by year`;
for (const f of fy) {
  if (f.status==='CLOSED') {
    ok(`FY${f.year} retained >= 0`, Number(f.retained_earnings)>=0, `retained ${f.retained_earnings} = distrib ${f.distributable_surplus} - paid ${f.actual_distributed}`);
    ok(`FY${f.year} distributable == net - reserve`, Number(f.distributable_surplus)===Number(f.net_surplus)-Number(f.statutory_reserve), `${f.distributable_surplus}`);
    ok(`FY${f.year} reserve == 10% of net`, Number(f.statutory_reserve)===Math.round(Number(f.net_surplus)*0.10), `${f.statutory_reserve}`);
    ok(`FY${f.year} payout <= distributable`, Number(f.actual_distributed)<=Number(f.distributable_surplus), `${f.actual_distributed} <= ${f.distributable_surplus}`);
  } else ok(`FY${f.year} is OPEN (current year)`, true);
}

// C) Dividend rows grouped by the YEAR LABEL in the description (matches how the
// seeder attributes a post-close distribution to the year it refers to).
const divByLabel = await sql`select
    substring(description from 'FY(\\d{4})') as lbl, coalesce(sum(amount),0)::numeric(15,2) s, count(*)::int n
  from transactions where tenant_id=${T} and type='Dividend' and status in ('Completed','Success') and is_deleted=false
  group by 1`;
const dbl = Object.fromEntries(divByLabel.map(r=>[r.lbl, r]));
const f1 = fy.find(f=>f.year===2024), f2 = fy.find(f=>f.year===2025);
ok('FY2024-25 dividends == actual_distributed', Number(dbl['2024']?.s)===Number(f1.actual_distributed), `${dbl['2024']?.s} vs ${f1.actual_distributed} (${dbl['2024']?.n} rows)`);
ok('FY2025-26 dividends == actual_distributed', Number(dbl['2025']?.s)===Number(f2.actual_distributed), `${dbl['2025']?.s} vs ${f2.actual_distributed} (${dbl['2025']?.n} rows)`);

// D) profit_allocations == dividend sum per fiscal period
const alloc = await sql`select fiscal_period_id, coalesce(sum(amount),0)::numeric(15,2) s from profit_allocations where tenant_id=${T} group by fiscal_period_id`;
const [fp1] = await sql`select id from fiscal_periods where tenant_id=${T} and year=2024`;
const [fp2] = await sql`select id from fiscal_periods where tenant_id=${T} and year=2025`;
const aByFp = Object.fromEntries(alloc.map(a=>[a.fiscal_period_id, Number(a.s)]));
ok('FY2024-25 allocations == that year\'s dividends', aByFp[fp1.id]===Number(f1.actual_distributed), `${aByFp[fp1.id]} vs ${f1.actual_distributed}`);
ok('FY2025-26 allocations == that year\'s dividends', aByFp[fp2.id]===Number(f2.actual_distributed), `${aByFp[fp2.id]} vs ${f2.actual_distributed}`);

// E) per-share rate consistency: each dividend row == shares * rate
const rateRows = await sql`select description, amount, count(*)::int n from transactions
  where tenant_id=${T} and type='Dividend' and is_deleted=false group by description, amount order by amount`;
let rateOk = true;
for (const r of rateRows) {
  const m = r.description.match(/(\d+) shares @ (\d+) USD/); if(!m){rateOk=false;continue;}
  if (Number(m[1])*Number(m[2]) !== Number(r.amount)) rateOk=false;
}
ok('every dividend row == shares x rate (per-unit math)', rateOk, `${rateRows.length} distinct payouts checked`);

// F) vocabulary + currency + uniqueness
const [st] = await sql`select count(*)::int n from members where tenant_id=${T} and status not in ('active','pending','suspended','inactive','terminated')`;
ok('all member statuses in vocabulary', st.n===0);
const [pr] = await sql`select count(*)::int n from projects where tenant_id=${T} and status not in ('In Progress','Review','Completed','Cancelled')`;
ok('all project statuses in vocabulary', pr.n===0);
const [fn] = await sql`select count(*)::int n from funds where tenant_id=${T} and currency<>'USD'`;
ok('all funds in USD', fn.n===0);
const [dm] = await sql`select count(*)::int n from (select member_id from members where tenant_id=${T} group by member_id having count(*)>1) x`;
ok('unique member_id within tenant', dm.n===0);
const [de] = await sql`select count(*)::int n from (select email from members where tenant_id=${T} group by email having count(*)>1) x`;
ok('unique member email within tenant', de.n===0);
const [da] = await sql`select count(*)::int n from (select account_number from funds where tenant_id=${T} group by account_number having count(*)>1) x`;
ok('unique fund account_number within tenant', da.n===0);

// G) 2 years of history present
const [span] = await sql`select min(date)::date a, max(date)::date b, count(*)::int n from transactions where tenant_id=${T} and is_deleted=false`;
ok('~2 years of transaction history', (new Date(span.b)-new Date(span.a))/86400000 > 600, `${span.a} … ${span.b} (${span.n} txns)`);

const [glob] = await sql`select coalesce(sum(balance),0)::numeric(18,2) s from funds where tenant_id=${T}`;
ok('fund balances sum (AUM)', Number(glob.s) > 0, `${Number(glob.s).toLocaleString()} USD across 6 funds`);

console.log(fails===0?'\nALL MERIDIAN FINANCIAL CHECKS PASS':`\n${fails} CHECKS FAILED`);
await sql.end();
process.exit(fails?1:0);
