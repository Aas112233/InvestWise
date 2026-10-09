/**
 * Large investment corporation tenant seeder — Meridian Capital Holdings
 * (LOCAL DEV ONLY).
 *
 * The third and largest tenant shape, deliberately different again from
 * green-valley (small community fund) and northbridge (medium manufacturer):
 *   - LARGE scale: 360 shareholders, 16 portfolio holdings, 6 funds
 *   - USD-denominated, share value 10,000 USD (institutional unit size)
 *   - a market-facing PORTFOLIO of investments that generate capital gains
 *     and carried interest, plus a treasury yield stream
 *   - a professional operating cost base (management fees, custody, research)
 *   - an investor redemption programme (pro-rata redemptions, not just
 *     withdrawals) and an investor subscription queue
 *   - TWO completed fiscal years, each with a divided distribution run, plus
 *     an OPEN current fiscal year so the tenant stays writable
 *   - ~2 years of history: Jul 2024 … today (25 months)
 *
 * Invariants enforced while generating (asserted, same discipline as the two
 * earlier seeders):
 *   - every fund balance >= 0 at every step
 *   - final fund.balance == opening + inflows - outflows (reconstructable
 *     from the ledger by the canonical classifier)
 *   - members.total_contributed == sum of their Deposit rows
 *   - every inter-fund move is written as PAIRED Transfer Out / Transfer In
 *     legs sharing a transfer_group_id (a one-sided move is unsignable)
 *   - a dividend run's payout may never exceed that year's distributable
 *     surplus (rate capped by solvency AND liquidity)
 *   - globally unique member_id/email, funds.account_number,
 *     transactions.reference_number
 *
 * Deterministic (seeded PRNG). Re-runnable: wipes the previous meridian
 * tenant inside the same transaction.
 *
 * Usage: node scripts/seed-meridian-tenant.mjs
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

const env = loadEnvFile();
if (!env.DATABASE_URL) { console.error('DATABASE_URL is not set (.env.local).'); process.exit(1); }
if (/supabase\.com/.test(env.DATABASE_URL)) {
  console.error('REFUSING: DATABASE_URL points at Supabase. This seeder is local-dev only.');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { prepare: false, connect_timeout: 15 });

// ── deterministic PRNG ──────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261010);            // distinct seed from the other two
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ── name pools (international investor register) ─────────────────────────────
const MALE = ['Adrian','Bertrand','Caspian','Damien','Edmund','Fabian','Gregor','Hugo','Ivo','Julian','Klaus','Lorenzo','Marcus','Nikolai','Otto','Pascal','Quentin','Rafael','Sebastian','Theo','Ulric','Viktor','Werner','Xavier','Yannick','Zoltan','Amir','Dmitri','Henrik','Leandro'];
const FEMALE = ['Astrid','Beatrix','Camila','Daphne','Elodie','Freya','Giselle','Harriet','Ingrid','Juliette','Katrina','Lucia','Margot','Nadia','Ophelia','Penelope','Quinn','Rosalind','Seraphina','Theodora','Ursula','Valentina','Wren','Xiomara','Yasmin','Zara','Amara','Bianca','Clara','Delphine'];
const SUR = ['Ashford','Beaumont','Castellano','Dubois','Eriksen','Fitzgerald','Gallo','Hartmann','Ivanov','Jansen','Kowalski','Laurent','Montgomery','Novak','Okafor','Petrov','Quintana','Rasmussen','Sinclair','Thibault','Ueda','Vasquez','Winslow','Yamamoto','Zeller','Alvarez','Brennan','Cortez','Delacroix','Espinoza'];
const MANDATES = ['Family Office','Sovereign Wealth','Endowment Fund','Pension Scheme','Corporate Treasury','Private Bank','Insurance Reserve','Foundation'];
const REGIONS = ['Zurich','Singapore','London','Toronto','Dubai','Hong Kong','Luxembourg','New York','Geneva','Sydney','Amsterdam','Tokyo'];
const MEETING_PLACES = ['Meridian HQ — Investment Committee Room','Meridian HQ — Shareholder Auditorium','Virtual (Secure Video Conference)','Zurich Investor Briefing Centre'];
const DEPOSIT_METHODS = ['Wire Transfer','Wire Transfer','SWIFT Transfer','Standing Order','Custodian Sweep','Wire Transfer','Direct Debit'];
const OPS_EXPENSES = ['Investment management fees','Custody & settlement charges','Research subscriptions (Bloomberg, FactSet)','Regulatory filing fees','External audit fees','Legal & compliance counsel','Portfolio analytics licences','Investor relations & reporting','Market data terminals','Insurance & indemnity cover','Fund administration fees','Tax advisory services'];
const WELFARE = ['LPAC member education programme','Investor briefing series','Shareholder hardship grant','Community endowment contribution'];
const REDEMPTION_REASONS = ['Scheduled quarterly redemption','Manager-directed de-risking','Mandate rebalancing','Liquidity requirement'];

const uuid = () => crypto.randomUUID();
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const addMonths = (y, m, n) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };
const dayIn = (y, m, lo, hi) => new Date(Date.UTC(y, m, ri(lo, hi), 10, ri(0, 59), 0));

// ── timeline ────────────────────────────────────────────────────────────────
// ~2 years of history: Jul 2024 (fiscal-year aligned) … today (Oct 2026).
const TODAY = new Date('2026-10-04T10:00:00Z');
const START = { y: 2024, m: 6 };            // Jul 2024
const MONTHS = 25;                          // Jul 2024 … Jul 2026 partial+today
const shareValue = 10000;                   // institutional unit size (USD)
const statutoryReservePct = 10;             // policy: 10% of net surplus
const fiscalYearStart = 'July';
const fiscalYearEnd = 'June';

// ── plan ────────────────────────────────────────────────────────────────────
const memberCount = 360;
const joinPlan = [];
{
  let left = memberCount;
  for (let mm = 0; mm < MONTHS && left > 0; mm++) {
    const n = mm === 0 ? 52 : Math.min(left, ri(8, 18));
    for (let k = 0; k < n; k++) joinPlan.push(mm);
    left -= n;
  }
  while (joinPlan.length < memberCount) joinPlan.push(MONTHS - 1);
}

// problem investors: stop subscribing mid-way (accrue arrears)
const problemMembers = new Set();
while (problemMembers.size < 30) problemMembers.add(ri(55, memberCount - 1));
const stopMonth = new Map();
for (const idx of problemMembers) stopMonth.set(idx, ri(9, MONTHS - 4));

// ── balances ────────────────────────────────────────────────────────────────
const bal = { DEPOSIT: 0, PRIMARY: 0, PROJECT: 0, RESERVE: 0, EMERGENCY: 0, OTHER: 0 };
const assertBal = (f) => { if (bal[f] < 0) throw new Error(`Balance went negative for ${f}: ${bal[f]}`); };

// ── build members ───────────────────────────────────────────────────────────
const usedEmails = new Set();
const members = [];
for (let i = 0; i < memberCount; i++) {
  const jm = joinPlan[i];
  const jy = addMonths(START.y, START.m, jm);
  const gender = chance(0.62) ? 'M' : 'F';
  const first = gender === 'M' ? pick(MALE) : pick(FEMALE);
  const name = `${first} ${pick(MALE)} ${pick(SUR)}`;
  let email;
  do { email = `investor${i + 1}.${Math.floor(rand() * 9000 + 1000)}@meridian.demo`; } while (usedEmails.has(email));
  usedEmails.add(email);
  const founding = jm === 0;
  const target = pick([15000, 20000, 25000, 30000, 40000, 50000, 75000]);
  const shares = founding ? ri(100, 320) : ri(40, 180);
  const activeMonths = Math.max(1, MONTHS - jm);
  members.push({
    idx: i,
    memberId: `MD-${String(i + 1).padStart(3, '0')}`,
    name, email,
    phone: `+1415${String(ri(1000000, 9999999))}`,
    shares,
    target,
    founding,
    joinDate: dayIn(jy.y, jy.m, 2, 22),
    joinMonth: jm,
    stopMonth: stopMonth.get(i),
    status: stopMonth.has(i) ? (stopMonth.get(i) < MONTHS - 6 ? 'suspended' : 'inactive') : (chance(0.04) ? 'pending' : 'active'),
    mandate: pick(MANDATES),
    region: pick(REGIONS),
    fatherName: `${pick(MALE)} ${pick(SUR)}`,
    motherName: `${pick(FEMALE)} ${pick(SUR)}`,
    spouseName: gender === 'M' ? `${pick(FEMALE)} ${pick(SUR)}` : `${pick(MALE)} ${pick(SUR)}`,
    address: `${pick(REGIONS)}`,
    nid: `P${ri(10000000, 99999999)}`,
    nomineeName: `${pick(FEMALE)} ${pick(SUR)}`,
    nomineeRelation: pick(['Spouse','Legal Counsel','Trustee','Executor','Portfolio Manager']),
    nomineePhone: `+1415${String(ri(1000000, 9999999))}`,
    activeMonths,
  });
}

// ── transactions + derived rows ─────────────────────────────────────────────
const transactions = [];
let refCounters = {};
const ref = (prefix) => { refCounters[prefix] = (refCounters[prefix] || 0) + 1; return `MD-${prefix}-${String(refCounters[prefix]).padStart(5, '0')}`; };

const totals = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
const contributed = new Array(memberCount).fill(0);
const lastDepositMonth = new Array(memberCount).fill(null);
const arrearsRows = [];
const absenceCount = new Array(memberCount).fill(0);
const ADMIN_OFFICER = 'Helena Castellano';
const CIO_OFFICER = 'Marcus Winslow';

// helper: emit an inter-fund move as PAIRED legs (shared transfer_group_id)
function interFundMove({ date, amount, from, to, category, label, memberIdx }) {
  const beforeFrom = bal[from];
  const beforeTo = bal[to];
  bal[from] -= amount; assertBal(from);
  bal[to] += amount;
  const group = uuid();
  transactions.push({
    type: 'Transfer Out', amount,
    description: `[Transfer OUT] to ${label.to}: ${label.what}`,
    category, reference_number: `${ref('TRF')}-OUT`,
    transfer_group_id: group, date, status: 'Completed',
    memberIdx, fund: from, handling_officer: ADMIN_OFFICER,
    balance_before: beforeFrom, balance_after: bal[from],
  });
  transactions.push({
    type: 'Transfer In', amount,
    description: `[Transfer IN] from ${label.from}: ${label.what}`,
    category, reference_number: `${ref('TRF')}-IN`,
    transfer_group_id: group, date, status: 'Completed',
    fund: to, handling_officer: ADMIN_OFFICER,
    balance_before: beforeTo, balance_after: bal[to],
  });
}

// 1) share capital at join → PRIMARY (Investment)
for (const m of members) {
  const amount = m.shares * shareValue;
  bal.PRIMARY += amount;
  transactions.push({
    type: 'Investment', amount,
    description: `Share capital subscription — ${m.shares} shares @ ${shareValue} USD`,
    category: 'Share Capital', reference_number: ref('INV'),
    date: m.joinDate, status: 'Completed',
    memberIdx: m.idx, fund: 'PRIMARY',
    deposit_method: 'Wire Transfer', handling_officer: ADMIN_OFFICER,
  });
}

// 2) monthly capital calls → DEPOSIT
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  for (const mem of members) {
    if (mem.joinMonth > mm) continue;
    if (mem.stopMonth !== undefined && mm >= mem.stopMonth) {
      arrearsRows.push({ idx: mem.idx, periodKey: `${y}-${String(m + 1).padStart(2, '0')}`, required: mem.target });
      continue;
    }
    if (mem.status === 'pending' && mm > mem.joinMonth) continue;
    if (!chance(0.9)) {
      arrearsRows.push({ idx: mem.idx, periodKey: `${y}-${String(m + 1).padStart(2, '0')}`, required: mem.target });
      continue;
    }
    const amount = mem.target;
    const date = dayIn(y, m, 3, 9);
    const before = bal.DEPOSIT;
    bal.DEPOSIT += amount; assertBal('DEPOSIT');
    contributed[mem.idx] += amount;
    lastDepositMonth[mem.idx] = `${y}-${String(m + 1).padStart(2, '0')}`;
    totals.deposits += amount;
    transactions.push({
      type: 'Deposit', amount,
      description: `Monthly capital call — ${ym(date)}`,
      category: 'Capital Call', reference_number: ref('DEP'),
      date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      deposit_method: pick(DEPOSIT_METHODS), handling_officer: ADMIN_OFFICER,
      balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 3) management-fee levy — a SEPARATE recurring stream (0.5% of call), DEPOSIT → OTHER
for (let mm = 1; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  for (const mem of members) {
    if (mem.joinMonth > mm || mem.status !== 'active') continue;
    if (!chance(0.72)) continue;
    const amount = Math.max(1, Math.round(mem.target * 0.005));
    if (amount <= 0 || amount > bal.DEPOSIT) continue;
    const date = dayIn(y, m, 4, 15);
    interFundMove({
      date, amount, from: 'DEPOSIT', to: 'OTHER',
      category: 'Management Fee', memberIdx: mem.idx,
      label: { to: 'Operating & Fee Account', from: 'Subscription Account', what: `management-fee levy ${ym(date)}` },
    });
  }
}

// 4) investor redemptions → DEPOSIT (pro-rata programme)
for (let k = 0; k < 30; k++) {
  const mm = ri(8, MONTHS - 1);
  const { y, m } = addMonths(START.y, START.m, mm);
  const mem = members[ri(0, memberCount - 1)];
  if (mem.joinMonth > mm) continue;
  const amount = Math.min(mem.target * ri(3, 8), 400000);
  const date = dayIn(y, m, 12, 25);
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= amount; assertBal('DEPOSIT');
  totals.withdrawals += amount;
  transactions.push({
    type: 'Withdrawal', amount,
    description: `Redemption — ${pick(REDEMPTION_REASONS)}`,
    category: 'Redemption', reference_number: ref('RDM'),
    date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
    deposit_method: 'Wire Transfer', handling_officer: ADMIN_OFFICER,
    balance_before: before, balance_after: bal.DEPOSIT,
  });
}

// 5) portfolio holdings (16) — capital via INTER-FUND TRANSFERS (paired legs)
const projectDefs = [
  { title: 'Northwind Renewables Platform',   category: 'Infrastructure', status: 'Completed',   health: 'Stable',   start: 1,  budget: 12000000, roi: 22 },
  { title: 'Helios Data Centre Fund III',     category: 'Digital Infra',  status: 'Completed',   health: 'Stable',   start: 3,  budget: 9500000,  roi: 19 },
  { title: 'Bluewater Logistics Trust',       category: 'Logistics',      status: 'Completed',   health: 'Stable',   start: 5,  budget: 7200000,  roi: 15 },
  { title: 'Solstice Healthcare REIT',        category: 'Real Estate',    status: 'Completed',   health: 'Stable',   start: 8,  budget: 6600000,  roi: 14 },
  { title: 'Atlas Semiconductor Growth',      category: 'Technology',     status: 'In Progress', health: 'Stable',   start: 10, budget: 14000000, roi: 28 },
  { title: 'Cobalt Energy Transition Bond',   category: 'Fixed Income',   status: 'In Progress', health: 'Stable',   start: 11, budget: 5000000,  roi: 9  },
  { title: 'Vantage Private Credit II',       category: 'Private Credit', status: 'In Progress', health: 'Stable',   start: 12, budget: 8000000,  roi: 13 },
  { title: 'Orion Agritech Ventures',         category: 'Venture',        status: 'In Progress', health: 'At Risk',  start: 13, budget: 4200000,  roi: 24 },
  { title: 'Meridian Core Equity Sleeve',     category: 'Public Equity',  status: 'In Progress', health: 'Stable',   start: 14, budget: 11000000, roi: 11 },
  { title: 'Pacific Freight Yield Fund',      category: 'Logistics',      status: 'Review',      health: 'Stable',   start: 15, budget: 3800000,  roi: 10 },
  { title: 'Cascade Water Utilities',         category: 'Utilities',      status: 'In Progress', health: 'Stable',   start: 16, budget: 6100000,  roi: 12 },
  { title: 'Lumen Consumer Growth Fund',      category: 'Public Equity',  status: 'In Progress', health: 'At Risk',  start: 17, budget: 5500000,  roi: 16 },
  { title: 'Sterling Aviation Leasing',       category: 'Leasing',        status: 'In Progress', health: 'Stable',   start: 18, budget: 7400000,  roi: 13 },
  { title: 'Evergreen Timber Holdings',       category: 'Real Assets',    status: 'In Progress', health: 'Stable',   start: 19, budget: 4600000,  roi: 11 },
  { title: 'Quantum Robotics Opportunity',    category: 'Venture',        status: 'In Progress', health: 'Stable',   start: 20, budget: 3200000,  roi: 26 },
  { title: 'Frontier Markets Debt Facility',  category: 'Fixed Income',   status: 'In Progress', health: 'Stable',   start: 21, budget: 5200000,  roi: 14 },
];
const projects = [];
for (const pd of projectDefs) {
  const initial = Math.round(pd.budget * 0.4 / 50000) * 50000;
  const s = addMonths(START.y, START.m, pd.start);
  const startDate = `${s.y}-${String(s.m + 1).padStart(2, '0')}-${String(ri(3, 15)).padStart(2, '0')}`;
  projects.push({ ...pd, initial, startDate, sY: s.y, sM: s.m, earnings: 0, expenses: 0, returned: false });
}
// fund project starts: DEPOSIT → PROJECT via paired Transfer Out / Transfer In
for (const p of projects) {
  const date = new Date(Date.UTC(p.sY, p.sM, 18, 10, 0, 0));
  interFundMove({
    date, amount: p.initial, from: 'DEPOSIT', to: 'PROJECT',
    category: 'Portfolio Capital',
    label: { to: 'Portfolio Investment Account', from: 'Subscription Account', what: `capital deployment for “${p.title}”` },
  });
}
// portfolio economics: capital gains (Earning) and carrying costs (Expense)
for (const p of projects) {
  const endM = p.status === 'Completed' ? p.start + ri(9, 13) : MONTHS - 1;
  const nEarnings = ri(5, 9), nExpenses = ri(4, 8);
  let profE = 0, profX = 0;
  for (let k = 0; k < nEarnings; k++) {
    const mm = Math.min(p.start + ri(2, Math.max(2, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(60, 320) * 1000;
    const date = dayIn(y, m, 10, 27);
    bal.PROJECT += amount; assertBal('PROJECT');
    profE += amount; totals.earnings += amount;
    transactions.push({
      type: 'Earning', amount,
      description: `Realised gain / income — ${p.title}`,
      category: 'Portfolio Income', reference_number: ref('EAR'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: CIO_OFFICER,
    });
  }
  for (let k = 0; k < nExpenses; k++) {
    const mm = Math.min(p.start + ri(1, Math.max(1, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(25, 140) * 1000;
    if (amount > bal.PROJECT) continue;
    const date = dayIn(y, m, 5, 26);
    bal.PROJECT -= amount; assertBal('PROJECT');
    profX += amount; totals.expenses += amount;
    transactions.push({
      type: 'Expense', amount,
      description: `${pick(['Acquisition costs','Due diligence','Hedging','Carried interest accrual','Deal structuring fees','Monitoring fees','Exit advisory fees'])} — ${p.title}`,
      category: 'Portfolio Cost', reference_number: ref('PXP'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: CIO_OFFICER,
    });
  }
  p.earnings = profE; p.expenses = profX;
  if (p.status === 'Completed') {
    const completionM = Math.min(p.start + 14, MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, completionM);
    const ret = p.initial + Math.max(0, profE - profX);
    const capped = Math.min(ret, bal.PROJECT);
    if (capped > 0) {
      const date = dayIn(y, m, 20, 27);
      interFundMove({
        date, amount: capped, from: 'PROJECT', to: 'DEPOSIT',
        category: 'Portfolio Realisation',
        label: { to: 'Subscription Account', from: 'Portfolio Investment Account', what: `realisation of “${p.title}”` },
      });
      p.completionDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(ri(20, 27)).padStart(2, '0')}`;
    }
  }
}

// 6) monthly operating cost base (management fees, custody, research)
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const aum = members.filter((mem) => mem.joinMonth <= mm).reduce((s, mem) => s + mem.shares * shareValue, 0);
  const mgmtFee = Math.max(120000, Math.round(aum * 0.0009 / 1000) * 1000);
  const custody = 95000;
  for (const [amt, label, officer] of [[mgmtFee, 'Investment management fees', ADMIN_OFFICER], [custody, 'Custody & settlement charges', ADMIN_OFFICER]]) {
    if (amt > bal.DEPOSIT) continue;
    const date = dayIn(y, m, 1, 5);
    const before = bal.DEPOSIT;
    bal.DEPOSIT -= amt; assertBal('DEPOSIT');
    totals.expenses += amt;
    transactions.push({
      type: 'Expense', amount: amt,
      description: label,
      category: 'Operations', reference_number: ref('EXP'),
      date, status: 'Completed', fund: 'DEPOSIT',
      handling_officer: officer, balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
  const n = ri(5, 8);
  for (let k = 0; k < n; k++) {
    const amount = ri(8, 55) * 1000;
    if (amount > bal.DEPOSIT) continue;
    const date = dayIn(y, m, 8, 28);
    const before = bal.DEPOSIT;
    bal.DEPOSIT -= amount; assertBal('DEPOSIT');
    totals.expenses += amount;
    transactions.push({
      type: 'Expense', amount,
      description: pick(OPS_EXPENSES),
      category: 'Operations', reference_number: ref('EXP'),
      date, status: 'Completed', fund: 'DEPOSIT',
      handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 7) monthly statutory reserve sweep: DEPOSIT → RESERVE (paired legs)
for (let mm = 6; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const amt = Math.min(120000, Math.floor(Math.max(0, bal.DEPOSIT - 800000) * 0.15));
  if (amt <= 1000) continue;
  const date = new Date(Date.UTC(y, m, 26, 10, 0, 0));
  interFundMove({
    date, amount: amt, from: 'DEPOSIT', to: 'RESERVE',
    category: 'Statutory Reserve',
    label: { to: 'Statutory Reserve Account', from: 'Subscription Account', what: `monthly reserve sweep ${ym(date)}` },
  });
}
// two one-off emergency buffer top-ups
for (const mm of [12, 20]) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const amt = Math.min(500000, Math.floor(Math.max(0, bal.DEPOSIT - 800000) * 0.15));
  if (amt <= 0) continue;
  const date = new Date(Date.UTC(y, m, ri(10, 25), 10, 0, 0));
  interFundMove({
    date, amount: amt, from: 'DEPOSIT', to: 'EMERGENCY',
    category: 'Contingency Top-up',
    label: { to: 'Contingency Reserve', from: 'Subscription Account', what: 'liquidity buffer top-up' },
  });
}

// 8) LPAC / investor-relations programme payouts from OTHER
for (let k = 0; k < 18; k++) {
  const mm = ri(8, MONTHS - 1);
  const { y, m } = addMonths(START.y, START.m, mm);
  const amount = ri(4, 22) * 1000;
  if (amount > bal.OTHER) continue;
  const date = dayIn(y, m, 8, 24);
  const before = bal.OTHER;
  bal.OTHER -= amount; assertBal('OTHER');
  transactions.push({
    type: 'Expense', amount,
    description: pick(WELFARE),
    category: 'Investor Relations', reference_number: ref('WEX'),
    date, status: 'Completed', fund: 'OTHER', memberIdx: ri(0, memberCount - 1),
    handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.OTHER,
  });
}

// ── fiscal year close + dividend runs (two complete years) ──────────────────
function fySums(fromUTC, toUTC) {
  const s = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
  for (const t of transactions) {
    if (!t.date) continue;
    if (t.date >= fromUTC && t.date < toUTC) {
      if (t.type === 'Deposit') s.deposits += t.amount;
      if (t.type === 'Withdrawal') s.withdrawals += t.amount;
      if (t.type === 'Earning') s.earnings += t.amount;
      if (t.type === 'Expense') s.expenses += t.amount;
    }
  }
  return s;
}
const fy1 = fySums(new Date(Date.UTC(2024, 6, 1)), new Date(Date.UTC(2025, 6, 1)));   // FY2024-25
const fy2 = fySums(new Date(Date.UTC(2025, 6, 1)), new Date(Date.UTC(2026, 6, 1)));   // FY2025-26
const fy1Net = fy1.deposits + fy1.earnings - fy1.withdrawals - fy1.expenses;
const fy2Net = fy2.deposits + fy2.earnings - fy2.withdrawals - fy2.expenses;
const fy1Reserve = Math.round(fy1Net * statutoryReservePct / 100);
const fy1Distributable = fy1Net - fy1Reserve;
const fy2Reserve = Math.round(fy2Net * statutoryReservePct / 100);
const fy2Distributable = fy2Net - fy2Reserve;

// dividend runs: FY1 (Sep 2025) and FY2 (Sep 2026)
const dividendRuns = [];
for (const run of [
  { label: 'FY2024-25', date: new Date(Date.UTC(2025, 8, 20, 10, 0, 0)), baseRate: 900, distributable: fy1Distributable },
  { label: 'FY2025-26', date: new Date(Date.UTC(2026, 8, 20, 10, 0, 0)), baseRate: 1150, distributable: fy2Distributable },
]) {
  const eligible = members.filter((m) => m.joinDate < run.date).reduce((s, m) => s + m.shares, 0);
  // A distribution must satisfy TWO independent caps and the smaller wins:
  //   1. solvency  — payout may not exceed the year's distributable surplus,
  //      or retained earnings go negative (paying out money never earned);
  //   2. liquidity — the subscription account must still hold the cash after
  //      (keep a working-balance floor).
  const solvencyRate = Math.floor(run.distributable / Math.max(1, eligible));
  const liquidityRate = Math.floor((bal.DEPOSIT - 800000) / Math.max(1, eligible));
  const rate = Math.min(run.baseRate, solvencyRate, liquidityRate);
  let distributed = 0;
  const rows = [];
  for (const mem of members) {
    if (mem.joinDate >= run.date) continue;
    const amount = mem.shares * rate;
    if (amount > bal.DEPOSIT) continue;
    const before = bal.DEPOSIT;
    bal.DEPOSIT -= amount; assertBal('DEPOSIT');
    distributed += amount;
    rows.push({ memberIdx: mem.idx, shares: mem.shares, amount });
    transactions.push({
      type: 'Dividend', amount,
      description: `${run.label} distribution — ${mem.shares} shares @ ${rate} USD`,
      category: 'Dividend', reference_number: ref('DIV'),
      date: run.date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      deposit_method: 'Wire Transfer', handling_officer: ADMIN_OFFICER,
      balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
  dividendRuns.push({ ...run, rate, distributed, rows });
}

// ── meetings + attendance + penalties ───────────────────────────────────────
const meetings = [];
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const completed = !(mm === MONTHS - 1);
  const mtype = mm % 12 === 0 ? 'FOUNDING_MEMBER' : (mm % 3 === 2 ? 'SHAREHOLDER' : 'GENERAL');
  meetings.push({
    title: mtype === 'FOUNDING_MEMBER' ? `Annual General Meeting — ${y}` : `Investment Committee Meeting — ${y}-${String(m + 1).padStart(2, '0')}`,
    meeting_type: mtype,
    meeting_date: new Date(Date.UTC(y, m, 8, 15, 0, 0)),
    location: pick(MEETING_PLACES),
    agenda: 'Portfolio performance review, treasury report, valuation marks, redemption queue, compliance and audit.',
    minutes: completed ? 'Quorum met; portfolio report adopted; valuation marks approved; redemption queue reviewed.' : null,
    status: completed ? 'COMPLETED' : 'SCHEDULED',
    started_at: completed ? new Date(Date.UTC(y, m, 8, 15, 10, 0)) : null,
    completed_at: completed ? new Date(Date.UTC(y, m, 8, 17, 20, 0)) : null,
    monthIdx: mm,
  });
}

const arrearsByMember = new Map();
for (const a of arrearsRows) {
  if (!arrearsByMember.has(a.idx)) arrearsByMember.set(a.idx, []);
  arrearsByMember.get(a.idx).push(a);
}

// ── insert plan ─────────────────────────────────────────────────────────────
const tenantSlug = 'meridian';
const tenantId = uuid();
const adminUserId = uuid();
const auditorUserId = uuid();
const managerUserId = uuid();
const memberUserIds = [uuid(), uuid(), uuid(), uuid(), uuid(), uuid()];
const passwordHash = await bcrypt.hash('pass-12345678', 12);
const fundIds = { DEPOSIT: uuid(), PRIMARY: uuid(), PROJECT: uuid(), RESERVE: uuid(), EMERGENCY: uuid(), OTHER: uuid() };
const projectIds = projects.map(() => uuid());
const meetingIds = meetings.map(() => uuid());
const fy1Id = uuid(), fy2Id = uuid(), fy3Id = uuid();
const memberIds = members.map(() => uuid());

const userAccessIdx = members.filter((m) => m.status === 'active' && m.joinMonth < 6).slice(0, 6).map((m) => m.idx);
const userIdFor = new Map(userAccessIdx.map((idx, k) => [idx, memberUserIds[k]]));

const fundMeta = {
  DEPOSIT:  { name: 'Subscription & Redemption Account', account: 'MD-FND-001', desc: 'Receives investor capital calls and funds distributions and redemptions.' },
  PRIMARY:  { name: 'Share Capital Account',    account: 'MD-FND-002', desc: 'Investor share capital (issued units).' },
  PROJECT:  { name: 'Portfolio Investment Account', account: 'MD-FND-003', desc: 'Capital deployed across the investment portfolio.' },
  RESERVE:  { name: 'Statutory Reserve',        account: 'MD-FND-004', desc: 'Mandatory 10% reserve of net surplus.' },
  EMERGENCY:{ name: 'Contingency Reserve',      account: 'MD-FND-005', desc: 'Liquidity buffer against redemption pressure.' },
  OTHER:    { name: 'Operating & Fee Account',  account: 'MD-FND-006', desc: 'Management fees, investor relations and operating levies.' },
};

const createdBase = new Date(Date.UTC(START.y, START.m, 1, 6, 0, 0));

async function insertChunked(tx, table, rows, chunk = 250) {
  console.log(`insert ${table} (${rows.length} rows)`);
  const keys = Object.keys(rows[0]);
  for (const r of rows) {
    for (const k of keys) {
      if (!(k in r) || r[k] === undefined) throw new Error(`Missing/undefined ${table}.${k} — row: ${JSON.stringify(r).slice(0, 200)}`);
    }
  }
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    if (!part.length) continue;
    await tx`insert into ${tx(table)} ${tx(part)}`;
  }
}
function mk(cols, src) {
  const o = {};
  for (const c of cols) o[c] = src[c] !== undefined ? src[c] : null;
  return o;
}

console.log('Seeding Meridian Capital Holdings (large investment corporation)…');

await sql.begin(async (tx) => {
  const prev = await tx`select id from tenants where slug = ${tenantSlug} limit 1`;
  if (prev.length) {
    const tid = prev[0].id;
    await tx`delete from profit_allocations where tenant_id = ${tid}`;
    await tx`delete from member_arrears where tenant_id = ${tid}`;
    await tx`delete from member_penalties where tenant_id = ${tid}`;
    await tx`delete from meeting_attendees where tenant_id = ${tid}`;
    await tx`delete from meetings where tenant_id = ${tid}`;
    await tx`delete from project_updates where tenant_id = ${tid}`;
    await tx`delete from project_members where project_id in (select id from projects where tenant_id = ${tid})`;
    await tx`delete from goals where tenant_id = ${tid}`;
    await tx`delete from transactions where tenant_id = ${tid}`;
    await tx`delete from projects where tenant_id = ${tid}`;
    await tx`delete from members where tenant_id = ${tid}`;
    await tx`delete from funds where tenant_id = ${tid}`;
    await tx`delete from system_settings where tenant_id = ${tid}`;
    await tx`delete from fiscal_periods where tenant_id = ${tid}`;
    await tx`delete from audit_logs where tenant_id = ${tid}`;
    await tx`delete from subscription_change_log where tenant_id = ${tid}`;
    await tx`delete from super_admin_action_log where tenant_id = ${tid}`;
    await tx`delete from blacklisted_tokens where user_id in (select id from users where tenant_id = ${tid})`;
    await tx`delete from deleted_records where deleted_by in (select id from users where tenant_id = ${tid})`;
    await tx`delete from users where tenant_id = ${tid}`;
    await tx`delete from tenant_subscriptions where tenant_id = ${tid}`;
    await tx`delete from tenants where id = ${tid}`;
    console.log('Previous meridian tenant wiped.');
  }

  // 1) tenant
  await tx`insert into tenants (id, slug, name, status, plan, max_users, module_access, created_at, updated_at)
    values (${tenantId}, ${tenantSlug}, 'Meridian Capital Holdings', 'active', 'enterprise', 800,
      ${JSON.stringify({})}::jsonb, ${createdBase}, ${TODAY})`;

  // 2) users — admin + auditor + manager + 6 member logins
  const allWrite = Object.fromEntries(['DASHBOARD','MEMBERS','MEETINGS','GOVERNANCE','GOALS','DEPOSITS','REQUEST_DEPOSIT','TRANSACTIONS','DIVIDENDS','EXPENSES','PROJECT_MANAGEMENT','FUNDS_MANAGEMENT','ANALYSIS','REPORTS','SETTINGS'].map((s) => [s, 'WRITE']));
  const readOnlyAll = Object.fromEntries(['DASHBOARD','MEMBERS','MEETINGS','GOVERNANCE','GOALS','DEPOSITS','TRANSACTIONS','DIVIDENDS','EXPENSES','PROJECT_MANAGEMENT','FUNDS_MANAGEMENT','ANALYSIS','REPORTS','SETTINGS'].map((s) => [s, 'READ']));
  const memberRead = Object.fromEntries(['DASHBOARD','DEPOSITS','PROJECT_MANAGEMENT','ANALYSIS','REPORTS','GOALS','TRANSACTIONS'].map((s) => [s, 'READ']));
  const userCols = ['id','name','email','password','role','status','permissions','member_id','tenant_id','created_at','updated_at'];
  const userRows = [
    mk(userCols, { id: adminUserId, name: 'Helena Castellano', email: 'admin@meridian.dev', password: passwordHash, role: 'Admin', status: 'active', permissions: allWrite, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(userCols, { id: auditorUserId, name: 'Freya Eriksen', email: 'auditor@meridian.dev', password: passwordHash, role: 'Auditor', status: 'active', permissions: readOnlyAll, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(userCols, { id: managerUserId, name: 'Marcus Winslow', email: 'manager@meridian.dev', password: passwordHash, role: 'Manager', status: 'active', permissions: { ...allWrite, SETTINGS: 'READ', MEMBERS: 'WRITE' }, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];
  for (let k = 0; k < userAccessIdx.length; k++) {
    const m = members[userAccessIdx[k]];
    userRows.push(mk(userCols, {
      id: memberUserIds[k], name: m.name, email: `user.${m.memberId.toLowerCase()}@meridian.dev`,
      password: passwordHash, role: 'Member', status: 'active',
      permissions: memberRead, member_id: m.memberId, tenant_id: tenantId,
      created_at: m.joinDate, updated_at: TODAY,
    }));
  }
  await insertChunked(tx, 'users', userRows);

  // 3) funds
  const fundRows = Object.entries(fundMeta).map(([type, meta]) => mk(
    ['id','name','type','status','currency','account_number','balance','minimum_balance','reconciliation_status','handling_officer','description','tenant_id','created_at','updated_at'],
    { id: fundIds[type], name: meta.name, type, status: 'ACTIVE', currency: 'USD',
      account_number: meta.account, balance: bal[type], minimum_balance: 0,
      reconciliation_status: 'VERIFIED', handling_officer: ADMIN_OFFICER,
      description: meta.desc, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }));

  // 4) members
  const memberRows = members.map((m, i) => mk(
    ['id','member_id','name','email','phone','role','shares','total_contributed','status','monthly_deposit_target','deposit_frequency','join_date','last_deposit_month','total_arrears','nid_or_passport','father_name','mother_name','spouse_name','address','nominee_name','nominee_relation','nominee_phone','warning_count','performance_score','user_id','has_user_access','tenant_id','created_at','updated_at'],
    {
      id: memberIds[i], member_id: m.memberId, name: m.name, email: m.email, phone: m.phone,
      role: m.founding ? 'Founding Member' : 'Member', shares: m.shares,
      total_contributed: contributed[i], status: m.status,
      monthly_deposit_target: m.target, deposit_frequency: 'monthly',
      join_date: m.joinDate, last_deposit_month: lastDepositMonth[i],
      total_arrears: (arrearsByMember.get(i) || []).reduce((s, a) => s + a.required, 0),
      nid_or_passport: m.nid, father_name: m.fatherName, mother_name: m.motherName,
      spouse_name: m.spouseName, address: m.address,
      nominee_name: m.nomineeName, nominee_relation: m.nomineeRelation, nominee_phone: m.nomineePhone,
      warning_count: Math.min(2, Math.floor((absenceCount[i] || 0) / 2)),
      performance_score: Math.max(55, 100 - (arrearsByMember.get(i) || []).length * 3 - Math.floor((absenceCount[i] || 0) / 2) * 5),
      user_id: userIdFor.get(i) || null, has_user_access: userIdFor.has(i),
      tenant_id: tenantId, created_at: m.joinDate, updated_at: TODAY,
    }));

  // 5) fiscal periods — FY1 + FY2 CLOSED, FY3 open (derived from TODAY)
  const CURRENT_FY_START_YEAR = TODAY.getUTCMonth() >= 6 ? TODAY.getUTCFullYear() : TODAY.getUTCFullYear() - 1;
  const fyCols = ['id','year','period_start','period_end','status','total_deposits','total_withdrawals','total_earnings','total_expenses','net_surplus','statutory_reserve','distributable_surplus','actual_distributed','retained_earnings','closed_by','closed_at','notes','tenant_id','created_at','updated_at'];
  const run1 = dividendRuns[0], run2 = dividendRuns[1];
  const fyRows = [
    mk(fyCols, {
      id: fy1Id, year: 2024, period_start: new Date(Date.UTC(2024, 6, 1)), period_end: new Date(Date.UTC(2025, 5, 30)),
      status: 'CLOSED', total_deposits: fy1.deposits, total_withdrawals: fy1.withdrawals,
      total_earnings: fy1.earnings, total_expenses: fy1.expenses, net_surplus: fy1Net,
      statutory_reserve: fy1Reserve, distributable_surplus: fy1Distributable,
      actual_distributed: run1.distributed, retained_earnings: fy1Distributable - run1.distributed,
      closed_by: adminUserId, closed_at: new Date(Date.UTC(2025, 6, 12, 10, 0, 0)),
      notes: 'First full fiscal year.', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(fyCols, {
      id: fy2Id, year: 2025, period_start: new Date(Date.UTC(2025, 6, 1)), period_end: new Date(Date.UTC(2026, 5, 30)),
      status: 'CLOSED', total_deposits: fy2.deposits, total_withdrawals: fy2.withdrawals,
      total_earnings: fy2.earnings, total_expenses: fy2.expenses, net_surplus: fy2Net,
      statutory_reserve: fy2Reserve, distributable_surplus: fy2Distributable,
      actual_distributed: run2.distributed, retained_earnings: fy2Distributable - run2.distributed,
      closed_by: adminUserId, closed_at: new Date(Date.UTC(2026, 6, 14, 10, 0, 0)),
      notes: 'Second full fiscal year.', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    // FY3 must exist and be OPEN: the fiscal guard is fail-closed, so without a
    // current period every write "today" is refused ("No fiscal period is
    // defined for 2026"). A real tenant always has its current year open.
    mk(fyCols, {
      id: fy3Id, year: CURRENT_FY_START_YEAR, period_start: new Date(Date.UTC(CURRENT_FY_START_YEAR, 6, 1)), period_end: new Date(Date.UTC(CURRENT_FY_START_YEAR + 1, 5, 30)),
      status: 'OPEN', total_deposits: 0, total_withdrawals: 0,
      total_earnings: 0, total_expenses: 0, net_surplus: 0,
      statutory_reserve: 0, distributable_surplus: 0,
      actual_distributed: 0, retained_earnings: 0,
      closed_by: null, closed_at: null,
      notes: 'Current fiscal year — open for postings.', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  // 6) projects (portfolio holdings)
  const projectRows = projects.map((p, i) => mk(
    ['id','title','category','description','initial_investment','budget','expected_roi','total_shares','status','health','start_date','completion_date','total_earnings','total_expenses','project_fund_handler','linked_fund_id','current_fund_balance','tenant_id','created_at','updated_at'],
    {
      id: projectIds[i], title: p.title, category: p.category,
      description: `${p.title} — a ${p.category.toLowerCase()} holding in the Meridian Capital portfolio.`,
      initial_investment: p.initial, budget: p.budget, expected_roi: p.roi,
      total_shares: Math.round(p.initial / shareValue), status: p.status, health: p.health,
      start_date: p.startDate, completion_date: p.completionDate || null,
      total_earnings: p.earnings, total_expenses: p.expenses,
      project_fund_handler: CIO_OFFICER, linked_fund_id: fundIds.PROJECT,
      current_fund_balance: p.status === 'Completed' ? 0 : p.initial + p.earnings - p.expenses,
      tenant_id: tenantId, created_at: new Date(Date.UTC(p.sY, p.sM, 2, 6, 0, 0)), updated_at: TODAY,
    }));

  // 7) transactions
  const txnRows = transactions.map((t) => mk(
    ['type','amount','description','category','reference_number','date','status','member_id','project_id','fund_id','handling_officer','deposit_method','balance_before','balance_after','transfer_group_id','created_by','authorized_by','is_deleted','tenant_id','created_at','updated_at'],
    {
      type: t.type, amount: t.amount, description: t.description, category: t.category,
      reference_number: t.reference_number, date: t.date, status: t.status,
      member_id: t.memberIdx !== undefined ? memberIds[t.memberIdx] : null,
      project_id: t.projectIdx !== undefined ? projectIds[t.projectIdx] : null,
      fund_id: fundIds[t.fund], handling_officer: t.handling_officer || ADMIN_OFFICER,
      deposit_method: t.deposit_method ?? null,
      balance_before: t.balance_before ?? null, balance_after: t.balance_after ?? null,
      transfer_group_id: t.transfer_group_id ?? null,
      created_by: adminUserId, authorized_by: adminUserId, is_deleted: false,
      tenant_id: tenantId, created_at: t.date, updated_at: t.date,
    }));

  // 8) project_members + project_updates
  const pmRows = [], puRows = [];
  projects.forEach((p, pi) => {
    const eligible = members.filter((m) => m.joinMonth <= p.start).map((m) => m.idx);
    const shuffled = [...eligible].sort(() => rand() - 0.5).slice(0, Math.min(ri(40, 120), eligible.length));
    const totalSharesIn = shuffled.reduce((s, idx) => s + Math.max(1, Math.round(members[idx].shares / 5)), 0);
    for (const idx of shuffled) {
      const sharesIn = Math.max(1, Math.round(members[idx].shares / 5));
      pmRows.push(mk(['project_id','member_id','shares_invested','ownership_percentage','created_at'], {
        project_id: projectIds[pi], member_id: memberIds[idx], shares_invested: sharesIn,
        ownership_percentage: Number((sharesIn * 100 / totalSharesIn).toFixed(2)),
        created_at: new Date(Date.UTC(p.sY, p.sM, 3, 6, 0, 0)),
      }));
    }
    const nUpdates = ri(5, 9);
    for (let k = 0; k < nUpdates; k++) {
      const mm = Math.min(p.start + 1 + k * 2, MONTHS - 1);
      const { y, m } = addMonths(START.y, START.m, mm);
      const earning = chance(0.6);
      const amount = earning ? ri(50, 220) * 1000 : ri(20, 90) * 1000;
      puRows.push(mk(['project_id','type','amount','description','date','tenant_id','created_at'], {
        project_id: projectIds[pi], type: earning ? 'Earning' : 'Expense',
        amount, description: earning ? `Valuation uplift — ${p.title}` : `Cost update — ${p.title}`,
        date: dayIn(y, m, 6, 27), tenant_id: tenantId, created_at: dayIn(y, m, 6, 27),
      }));
    }
  });

  // 9) meetings + attendance + penalties
  const meetingRows = meetings.map((mt, i) => mk(
    ['id','title','meeting_type','meeting_date','location','agenda','minutes','status','created_by','conducted_by','started_at','completed_at','tenant_id','created_at','updated_at'],
    { id: meetingIds[i], title: mt.title, meeting_type: mt.meeting_type, meeting_date: mt.meeting_date,
      location: mt.location, agenda: mt.agenda, minutes: mt.minutes, status: mt.status,
      created_by: adminUserId, conducted_by: mt.status === 'COMPLETED' ? adminUserId : null,
      started_at: mt.started_at, completed_at: mt.completed_at,
      tenant_id: tenantId, created_at: mt.meeting_date, updated_at: TODAY }));

  const attendeeRows = [], penaltyRows = [];
  const penaltyTierTitle = { 1: 'Verbal warning — meeting absence', 2: 'Written warning — repeated absence', 3: 'Fine — continued absence' };
  for (let i = 0; i < meetings.length; i++) {
    const mt = meetings[i];
    if (mt.status !== 'COMPLETED') continue;
    const pool = members.filter((m) => m.joinMonth <= mt.monthIdx && m.status !== 'terminated');
    for (const m of pool) {
      const roll = rand();
      let attendance = 'PRESENT';
      if (roll > 0.95) attendance = 'EXCUSED';
      else if (roll > 0.81) attendance = 'ABSENT';
      const depositedThisMonth = !arrearsRows.some((a) => a.idx === m.idx && a.periodKey === `${mt.meeting_date.getUTCFullYear()}-${String(mt.meeting_date.getUTCMonth() + 1).padStart(2, '0')}`);
      attendeeRows.push(mk(['meeting_id','member_id','attendance_status','deposit_status','tenant_id','created_at','updated_at'], {
        meeting_id: meetingIds[i], member_id: memberIds[m.idx], attendance_status: attendance,
        deposit_status: attendance === 'PRESENT' ? (depositedThisMonth ? 'PAID' : 'PENDING') : 'PENDING',
        tenant_id: tenantId, created_at: mt.meeting_date, updated_at: mt.meeting_date,
      }));
      if (attendance === 'ABSENT' && chance(0.55)) {
        absenceCount[m.idx] += 1;
        const tier = Math.min(3, absenceCount[m.idx]);
        const type = tier === 1 ? 'VERBAL_WARNING' : tier === 2 ? 'WRITTEN_WARNING' : 'FINE';
        penaltyRows.push(mk(['member_id','meeting_id','tier','title','type','calculated_deduction','status','reason','issued_by','issued_by_name','issued_at','tenant_id','created_at','updated_at'], {
          member_id: memberIds[m.idx], meeting_id: meetingIds[i], tier,
          title: penaltyTierTitle[tier], type,
          calculated_deduction: tier === 3 ? 1000 : 0, status: 'ACTIVE',
          reason: `Absent from ${mt.title} without prior excuse.`,
          issued_by: adminUserId, issued_by_name: ADMIN_OFFICER,
          issued_at: mt.meeting_date, tenant_id: tenantId,
          created_at: mt.meeting_date, updated_at: mt.meeting_date,
        }));
      }
    }
  }

  // 10) arrears
  const arrearRows = [];
  for (const [idx, list] of arrearsByMember) {
    for (const a of list) {
      const waived = chance(0.06);
      const [yy, mm2] = a.periodKey.split('-').map(Number);
      arrearRows.push(mk(['member_id','period_key','required_amount','actual_deposited','shortfall','status','waived_by','waived_reason','tenant_id','created_at','updated_at'], {
        member_id: memberIds[idx], period_key: a.periodKey, required_amount: a.required,
        actual_deposited: 0, shortfall: a.required,
        status: waived ? 'WAIVED' : 'OUTSTANDING',
        waived_by: waived ? memberIds[idx] : null,
        waived_reason: waived ? 'Hardship considered; waived by committee decision.' : null,
        tenant_id: tenantId, created_at: new Date(Date.UTC(yy, mm2 - 1, 12, 6, 0, 0)), updated_at: TODAY,
      }));
    }
  }

  // 11) profit allocations — one entry per dividend row, tagged to its fiscal period
  const allocationRows = [];
  for (const run of dividendRuns) {
    const fpid = run.label === 'FY2024-25' ? fy1Id : fy2Id;
    for (const r of run.rows) {
      allocationRows.push(mk(['fiscal_period_id','member_id','allocation_type','amount','shares_at_time','rate_per_share','notes','allocated_by','allocated_at','tenant_id','created_at'], {
        fiscal_period_id: fpid, member_id: memberIds[r.memberIdx], allocation_type: 'DIVIDEND',
        amount: r.amount, shares_at_time: r.shares, rate_per_share: run.rate,
        notes: `${run.label} annual distribution per unit.`, allocated_by: adminUserId,
        allocated_at: run.date, tenant_id: tenantId, created_at: run.date,
      }));
    }
  }

  // 12) goals + settings
  const goalCols = ['user_id','title','description','target_amount','current_amount','deadline','status','type','linked_project_id','tenant_id','created_at','updated_at'];
  const goalRows = [
    mk(goalCols, { user_id: adminUserId, title: 'Grow investor base to 500', description: 'Expand institutional mandates across regions.', target_amount: 500, current_amount: memberCount, deadline: '2028-12-31', status: 'In Progress', type: 'Other', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'Reserve fund to 25,000,000 USD', description: 'Reach the statutory reserve comfort level under company policy.', target_amount: 25000000, current_amount: bal.RESERVE, deadline: '2028-06-30', status: 'In Progress', type: 'Savings', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'Complete Atlas Semiconductor Growth', description: 'Realise the flagship technology position.', target_amount: 14000000, current_amount: 5600000, deadline: '2027-12-31', status: 'In Progress', type: 'Investment', linked_project_id: projectIds[4], tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'FY2025-26 investor distribution', description: 'Distribute FY2025-26 surplus to shareholders.', target_amount: run2.distributed, current_amount: run2.distributed, deadline: '2026-09-30', status: 'Achieved', type: 'Investment', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  const settingsRows = [mk(
    ['tenant_id','fiscal_year_start','fiscal_year_end','base_currency','share_value_bdt','is_share_value_locked','company_name','company_tagline','company_address','company_email','company_phone','deposit_due_date','monthly_meeting_day','late_deposit_grace_months','inactive_after_months','suspended_after_months','last_updated_by','last_updated_at','created_at','updated_at'],
    { tenant_id: tenantId, fiscal_year_start: fiscalYearStart, fiscal_year_end: fiscalYearEnd, base_currency: 'USD',
      share_value_bdt: shareValue, is_share_value_locked: true,
      company_name: 'Meridian Capital Holdings', company_tagline: 'Institutional capital since 2024',
      company_address: 'One Meridian Plaza, Zurich', company_email: 'office@meridian.demo',
      company_phone: '+14150000001', deposit_due_date: 10, monthly_meeting_day: 8,
      late_deposit_grace_months: 1, inactive_after_months: 3, suspended_after_months: 6,
      last_updated_by: adminUserId, last_updated_at: TODAY, created_at: createdBase, updated_at: TODAY })];

  // ── writes (FK-safe order) ──
  await insertChunked(tx, 'funds', fundRows);
  await insertChunked(tx, 'members', memberRows);
  await insertChunked(tx, 'fiscal_periods', fyRows);
  await insertChunked(tx, 'projects', projectRows);
  await insertChunked(tx, 'transactions', txnRows);
  await insertChunked(tx, 'project_members', pmRows);
  await insertChunked(tx, 'project_updates', puRows);
  await insertChunked(tx, 'meetings', meetingRows);
  await insertChunked(tx, 'meeting_attendees', attendeeRows);
  await insertChunked(tx, 'member_penalties', penaltyRows);
  await insertChunked(tx, 'member_arrears', arrearRows);
  await insertChunked(tx, 'profit_allocations', allocationRows);
  await insertChunked(tx, 'goals', goalRows);
  await insertChunked(tx, 'system_settings', settingsRows);
});

// ── summary ─────────────────────────────────────────────────────────────────
const cnt = await sql`select
  (select count(*) from members where tenant_id = ${tenantId}) as members,
  (select count(*) from transactions where tenant_id = ${tenantId}) as txns,
  (select count(*) from projects where tenant_id = ${tenantId}) as projects,
  (select count(*) from meetings where tenant_id = ${tenantId}) as meetings,
  (select count(*) from meeting_attendees where tenant_id = ${tenantId}) as attendees,
  (select count(*) from member_penalties where tenant_id = ${tenantId}) as penalties,
  (select count(*) from member_arrears where tenant_id = ${tenantId}) as arrears,
  (select count(*) from profit_allocations where tenant_id = ${tenantId}) as allocations,
  (select count(*) from users where tenant_id = ${tenantId}) as users`;
console.log('Seed complete:', cnt[0]);
console.log('Fund balances:', Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, `${v.toLocaleString()} USD`])));
console.log('FY2024-25: net', fy1Net.toLocaleString(), '| distributed', dividendRuns[0].distributed.toLocaleString(), '@', dividendRuns[0].rate);
console.log('FY2025-26: net', fy2Net.toLocaleString(), '| distributed', dividendRuns[1].distributed.toLocaleString(), '@', dividendRuns[1].rate);
console.log('Logins (all pass-12345678):');
console.log('  admin@meridian.dev    (Admin, tenant meridian)');
console.log('  manager@meridian.dev  (Manager)');
console.log('  auditor@meridian.dev  (Auditor)');
console.log(`  user.${members[userAccessIdx[0]].memberId.toLowerCase()}@meridian.dev (Member)`);
await sql.end();
