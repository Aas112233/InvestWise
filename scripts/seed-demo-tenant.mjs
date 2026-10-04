/**
 * Demo tenant seeder — Green Valley Investments (LOCAL DEV ONLY).
 *
 * Generates 2 years of internally-consistent operational data:
 *   tenant, admin + member-linked users, 120 members, 6 funds (all types),
 *   8 projects (+members, updates), ~3.4k transactions (deposits, share
 *   investments, expenses, transfers, withdrawals, project earnings/expenses,
 *   1 dividend run), 24 monthly meetings + attendance + penalties, arrears,
 *   2 fiscal periods, goals, tenant settings.
 *
 * Invariants enforced while generating:
 *   - every fund balance >= minimum_balance(0) at every step (asserted)
 *   - final fund.balance == opening + inflows - outflows (asserted)
 *   - members.total_contributed == sum of their Deposit rows
 *   - globally unique: members.member_id/email, funds.account_number,
 *     transactions.reference_number
 *   - all check-constraint vocabularies respected (dumped from pg_constraint)
 *
 * Deterministic: seeded PRNG — same output every run. Re-runnable: wipes the
 * previous green-valley tenant inside the same transaction.
 *
 * Usage: node scripts/seed-demo-tenant.mjs
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
const rand = mulberry32(20261004);
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;   // inclusive
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ── name pools (Bangladeshi) ────────────────────────────────────────────────
const MALE = ['Rafiq','Jamal','Kamal','Sabbir','Tanvir','Mahmud','Rakib','Sohel','Nasir','Alam','Babul','Jahid','Sumon','Rubel','Shahin','Faisal','Imran','Hasib','Tuhin','Milon','Arif','Jewel','Rashed','Sajib','Nayeem','Rasel','Fahim','Shamim','Roni','Parvez'];
const FEMALE = ['Ayesha','Nusrat','Farzana','Shirin','Ruma','Salma','Nadia','Tahmina','Rashida','Momena','Kamrun','Lubna','Sadia','Mim','Jhumur','Rina','Shefali','Bilkis','Maria','Anwara'];
const SUR = ['Islam','Ahmed','Hossain','Rahman','Chowdhury','Miah','Uddin','Ali','Haque','Sheikh','Molla','Sarker','Biswas','Khan','Talukder','Majumder','Das','Barua','Saha','Dutta','Ghosh','Paul','Nath','Bala','Roy'];
const AREAS = ['Mirpur, Dhaka','Uttara, Dhaka','Dhanmondi, Dhaka','Mohammadpur, Dhaka','Bashundhara R/A, Dhaka','Savar, Dhaka','Gazipur','Narayanganj','Keraniganj, Dhaka','Badda, Dhaka'];
const RELATIONS = ['Wife','Husband','Father','Mother','Brother','Son','Daughter'];
const MEETING_PLACES = ['Main HQ / Online','Green Valley Community Hall, Mirpur','Main HQ / Online','Main HQ / Online'];
const DEPOSIT_METHODS = ['Cash','Cash','Cash','Mobile Banking','Bank','Mobile Banking','Cash','Check'];
const OPS_EXPENSES = ['Office rent','Utility bills (electricity, water)','Staff salary','Stationery & printing','Internet & phone','Accounting software subscription','Transport allowance','Repair & maintenance','Legal & audit fees','Community event refreshments'];

const uuid = () => crypto.randomUUID();
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1, 10, 0, 0));   // 10:00 UTC ≈ 16:00 BST
const addMonths = (y, m, n) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };
const dayIn = (y, m, lo, hi) => new Date(Date.UTC(y, m, ri(lo, hi), 10, ri(0, 59), 0));

// ── timeline ────────────────────────────────────────────────────────────────
const TODAY = new Date('2026-10-04T10:00:00Z');
const START = { y: 2024, m: 9 };            // Oct 2024 (month index 9)
const MONTHS = 24;                          // Oct 2024 … Sep 2026 inclusive
const shareValue = 1000;
const dividendRatePerShare = 420;           // FY2024-25 distribution
const statutoryReservePct = 10;

// ── plan ────────────────────────────────────────────────────────────────────
const memberCount = 120;
// joins: 20 founding in month 0, then 3-7/month until 120 total
const joinPlan = [];
{
  let left = memberCount;
  for (let mm = 0; mm < MONTHS && left > 0; mm++) {
    const n = mm === 0 ? 20 : Math.min(left, ri(3, 7));
    for (let k = 0; k < n; k++) joinPlan.push(mm);
    left -= n;
  }
  while (joinPlan.length < memberCount) joinPlan.push(MONTHS - 1);
}

// problem members: stop paying mid-way (accrue arrears)
const problemMembers = new Set();
while (problemMembers.size < 9) problemMembers.add(ri(20, memberCount - 1));
const stopMonth = new Map();
for (const idx of problemMembers) stopMonth.set(idx, ri(8, MONTHS - 4));

// ── balances (running trackers) ─────────────────────────────────────────────
const bal = { DEPOSIT: 0, PRIMARY: 0, PROJECT: 0, RESERVE: 0, EMERGENCY: 0, OTHER: 0 };
const assertBal = (f) => { if (bal[f] < 0) throw new Error(`Balance went negative for ${f}: ${bal[f]}`); };

// ── build members ───────────────────────────────────────────────────────────
const usedEmails = new Set();
const members = [];
for (let i = 0; i < memberCount; i++) {
  const jm = joinPlan[i];
  const jy = addMonths(START.y, START.m, jm);
  const gender = chance(0.72) ? 'M' : 'F';
  const first = gender === 'M' ? pick(MALE) : pick(FEMALE);
  const name = `${first} ${pick(MALE)} ${pick(SUR)}`;
  let email;
  do { email = `member${i + 1}.${Math.floor(rand() * 9000 + 1000)}@greenvalley.demo`; } while (usedEmails.has(email));
  usedEmails.add(email);
  const founding = jm === 0;
  const target = pick([2000, 2500, 3000, 3500, 4000, 5000]);
  const shares = founding ? ri(20, 50) : ri(10, 30);
  const activeMonths = Math.max(1, MONTHS - jm);
  members.push({
    idx: i,
    memberId: `GV-${String(i + 1).padStart(3, '0')}`,
    name, email,
    phone: `+8801${pick(['7', '8', '9', '6'])}${String(ri(10000000, 99999999))}`,
    shares,
    target,
    founding,
    joinDate: dayIn(jy.y, jy.m, 2, 20),
    joinMonth: jm,
    stopMonth: stopMonth.get(i),          // undefined = pays throughout
    status: stopMonth.has(i) ? (stopMonth.get(i) < MONTHS - 6 ? 'suspended' : 'inactive') : (chance(0.06) ? 'pending' : 'active'),
    fatherName: `${pick(MALE)} ${pick(SUR)}`,
    motherName: `${pick(FEMALE)} ${pick(SUR)}`,
    spouseName: gender === 'M' ? `${pick(FEMALE)} ${pick(SUR)}` : `${pick(MALE)} ${pick(SUR)}`,
    address: pick(AREAS),
    nid: `19${ri(80, 99)}${ri(1000000, 9999999)}`,
    nomineeName: `${pick(FEMALE)} ${pick(SUR)}`,
    nomineeRelation: pick(RELATIONS),
    nomineePhone: `+8801${pick(['7', '8', '9'])}${String(ri(10000000, 99999999))}`,
    activeMonths,
  });
}

// ── transactions + derived rows ─────────────────────────────────────────────
const transactions = [];   // rows for insert
let refCounters = {};
const ref = (prefix) => { refCounters[prefix] = (refCounters[prefix] || 0) + 1; return `TXN-${prefix}-${String(refCounters[prefix]).padStart(5, '0')}`; };

const totals = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
const contributed = new Array(memberCount).fill(0);
const lastDepositMonth = new Array(memberCount).fill(null);
const arrearsRows = [];     // {idx, periodKey, required}
const absenceCount = new Array(memberCount).fill(0);
const projectFin = [];      // per project {earnings, expenses}

// 1) share capital at join → PRIMARY (Investment)
for (const m of members) {
  const amount = m.shares * shareValue;
  bal.PRIMARY += amount;
  transactions.push({
    type: 'Investment', amount,
    description: `Share capital purchase — ${m.shares} shares @ ${shareValue} BDT`,
    category: 'Share Capital', reference_number: ref('INV'),
    date: m.joinDate, status: 'Completed',
    memberIdx: m.idx, fund: 'PRIMARY',
    deposit_method: 'Bank', handling_officer: 'Rafiq Ahmed',
  });
}

// 2) monthly deposits → DEPOSIT (join month … Sep 2026, payment rate, stop for problem members)
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  for (const mem of members) {
    if (mem.joinMonth > mm) continue;
    if (mem.stopMonth !== undefined && mm >= mem.stopMonth) {
      if (mm >= mem.stopMonth && mm <= MONTHS - 1) {
        arrearsRows.push({ idx: mem.idx, periodKey: `${y}-${String(m + 1).padStart(2, '0')}`, required: mem.target });
      }
      continue;
    }
    if (mem.status === 'pending' && mm > mem.joinMonth) continue;   // pending never deposited
    if (!chance(0.9)) {                                             // 10% missed month
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
      description: `Monthly deposit — ${ym(date)}`,
      category: 'Monthly Deposit', reference_number: ref('DEP'),
      date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      deposit_method: pick(DEPOSIT_METHODS), handling_officer: 'Rafiq Ahmed',
      balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 3) withdrawals → DEPOSIT (8 spread across last 18 months, active members only)
const activeIdx = members.filter(m => m.status === 'active' && !m.stopMonth !== undefined ? true : true).map(m => m.idx);
for (let k = 0; k < 8; k++) {
  const mm = ri(6, MONTHS - 1);
  const { y, m } = addMonths(START.y, START.m, mm);
  const mem = members[pick(activeIdx)];
  if (mem.joinMonth > mm) continue;
  const amount = Math.min(mem.target * ri(6, 12), 30000);
  const date = dayIn(y, m, 12, 25);
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= amount; assertBal('DEPOSIT');
  totals.withdrawals += amount;
  transactions.push({
    type: 'Withdrawal', amount,
    description: `Partial withdrawal — member request`,
    category: 'Withdrawal', reference_number: ref('WDR'),
    date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
    deposit_method: 'Bank', handling_officer: 'Rafiq Ahmed',
    balance_before: before, balance_after: bal.DEPOSIT,
  });
}

// 4) projects (8) — funding from DEPOSIT pool, earnings & expenses inside PROJECT pool
const projectDefs = [
  { title: 'Rice Mill Modernization',      category: 'Agri Processing', status: 'Completed',   health: 'Stable',   start: 2,  budget: 900000,  roi: 14 },
  { title: 'River Transport Boat',         category: 'Transport',       status: 'Completed',   health: 'Stable',   start: 4,  budget: 600000,  roi: 11 },
  { title: 'Cold Storage Facility',        category: 'Agri Storage',    status: 'In Progress', health: 'Stable',   start: 7,  budget: 1800000, roi: 16 },
  { title: 'Poultry Farm Expansion',       category: 'Livestock',       status: 'In Progress', health: 'At Risk',  start: 10, budget: 450000,  roi: 9  },
  { title: 'Tailoring Workshop',           category: 'Manufacturing',   status: 'Completed',   health: 'Stable',   start: 13, budget: 320000,  roi: 12 },
  { title: 'Grocery Retail Chain',         category: 'Retail',          status: 'In Progress', health: 'Stable',   start: 16, budget: 750000,  roi: 15 },
  { title: 'Solar Irrigation Pumps',       category: 'Energy',          status: 'Review',      health: 'Stable',   start: 19, budget: 500000,  roi: 13 },
  { title: 'Online Grocery Delivery',      category: 'Retail Tech',     status: 'In Progress', health: 'At Risk',  start: 21, budget: 380000,  roi: 10 },
];
const projects = [];
for (const pd of projectDefs) {
  const initial = Math.round(pd.budget * 0.35 / 10000) * 10000;
  const s = addMonths(START.y, START.m, pd.start);
  const startDate = `${s.y}-${String(s.m + 1).padStart(2, '0')}-${String(ri(3, 15)).padStart(2, '0')}`;
  projects.push({ ...pd, initial, startDate, sY: s.y, sM: s.m, earnings: 0, expenses: 0, returned: false });
}
// fund project starts: DEPOSIT → PROJECT
for (const p of projects) {
  const date = new Date(Date.UTC(p.sY, p.sM, 18, 10, 0, 0));
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= p.initial; assertBal('DEPOSIT');
  bal.PROJECT += p.initial;
  totals.withdrawals += 0; // pool transfer, not a member withdrawal
  transactions.push({
    type: 'Transfer', amount: p.initial,
    description: `Capital allocation to project “${p.title}” (DEPOSIT → PROJECT)`,
    category: 'Project Funding', reference_number: ref('TRF'),
    date, status: 'Completed', fund: 'PROJECT',
    handling_officer: 'Rafiq Ahmed', balance_before: before, balance_after: bal.PROJECT,
  });
}
// project economics: earnings + expenses while running
for (const p of projects) {
  const endM = p.status === 'Completed' ? p.start + ri(8, 11) : MONTHS - 1;
  const nEarnings = ri(3, 5), nExpenses = ri(3, 6);
  let profE = 0, profX = 0;
  for (let k = 0; k < nEarnings; k++) {
    const mm = Math.min(p.start + ri(2, Math.max(2, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(15, 60) * 1000;
    const date = dayIn(y, m, 10, 27);
    const before = bal.PROJECT;
    bal.PROJECT += amount; assertBal('PROJECT');
    profE += amount; totals.earnings += amount;
    transactions.push({
      type: 'Earning', amount,
      description: `Revenue — ${p.title}`,
      category: 'Project Income', reference_number: ref('EAR'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: 'Rafiq Ahmed',
    });
  }
  for (let k = 0; k < nExpenses; k++) {
    const mm = Math.min(p.start + ri(1, Math.max(1, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(8, 45) * 1000;
    if (amount > bal.PROJECT) continue;
    const date = dayIn(y, m, 5, 26);
    const before = bal.PROJECT;
    bal.PROJECT -= amount; assertBal('PROJECT');
    profX += amount; totals.expenses += amount;
    transactions.push({
      type: 'Expense', amount,
      description: `${pick(['Equipment purchase','Raw materials','Labor cost','Transport','Site maintenance','Packaging'])} — ${p.title}`,
      category: 'Project Expense', reference_number: ref('PXP'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: 'Rafiq Ahmed',
    });
  }
  p.earnings = profE; p.expenses = profX;
  if (p.status === 'Completed') {
    // return capital + profit to DEPOSIT pool
    const completionM = Math.min(p.start + 12, MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, completionM);
    const ret = p.initial + Math.max(0, profE - profX - 0);
    const capped = Math.min(ret, bal.PROJECT);
    if (capped > 0) {
      const date = dayIn(y, m, 20, 27);
      const before = bal.PROJECT;
      bal.PROJECT -= capped; assertBal('PROJECT');
      bal.DEPOSIT += capped;
      transactions.push({
        type: 'Transfer', amount: capped,
        description: `Settlement — “${p.title}” returns capital + surplus (PROJECT → DEPOSIT)`,
        category: 'Project Settlement', reference_number: ref('TRF'),
        date, status: 'Completed', fund: 'DEPOSIT',
        handling_officer: 'Rafiq Ahmed', balance_before: before, balance_after: bal.DEPOSIT,
      });
      p.completionDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(ri(20, 27)).padStart(2, '0')}`;
    }
  }
}

// 5) monthly operating expenses → DEPOSIT fund (kept lean so the cash position stays healthy)
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const n = ri(3, 5);
  for (let k = 0; k < n; k++) {
    const amount = ri(2, 14) * 1000;
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
      deposit_method: null, handling_officer: 'Rafiq Ahmed',
      balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 6) statutory reserve + emergency top-ups: DEPOSIT → RESERVE / EMERGENCY
{
  const { y, m } = addMonths(START.y, START.m, 14);   // Dec 2025 (after FY1 close)
  const reserveAmt = Math.min(150000, Math.floor((bal.DEPOSIT - 200000) / 2));
  const emergencyAmt = Math.min(100000, Math.floor((bal.DEPOSIT - 200000) / 2));
  for (const [amt, fund, cat] of [[reserveAmt, 'RESERVE', 'Statutory Reserve'], [emergencyAmt, 'EMERGENCY', 'Emergency Fund Top-up']]) {
    const date = new Date(Date.UTC(y, m, ri(10, 25), 10, 0, 0));
    const before = bal.DEPOSIT;
    bal.DEPOSIT -= amt; assertBal('DEPOSIT');
    bal[fund] += amt;
    transactions.push({
      type: 'Transfer', amount: amt,
      description: `Allocation to ${fund.toLowerCase()} fund (DEPOSIT → ${fund})`,
      category: cat, reference_number: ref('TRF'),
      date, status: 'Completed', fund,
      handling_officer: 'Rafiq Ahmed', balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 7) fiscal year 1 close + dividend run (Jul 2024 → Jun 2025)
const fy1 = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
for (const t of transactions) {
  if (!t.date) continue;
  const inFY1 = t.date >= new Date(Date.UTC(2024, 6, 1)) && t.date < new Date(Date.UTC(2025, 6, 1));
  if (!inFY1) continue;
  if (t.type === 'Deposit') fy1.deposits += t.amount;
  if (t.type === 'Withdrawal') fy1.withdrawals += t.amount;
  if (t.type === 'Earning') fy1.earnings += t.amount;
  if (t.type === 'Expense') fy1.expenses += t.amount;
}
const fy1Net = fy1.deposits + fy1.earnings - fy1.withdrawals - fy1.expenses;
const fy1Reserve = Math.round(fy1Net * statutoryReservePct / 100);
const fy1Distributable = fy1Net - fy1Reserve;
// adaptive rate: distribute what the cash position actually supports (keep a 150k buffer)
const eligibleShares = members.filter(m => m.joinDate < new Date(Date.UTC(2025, 8, 20))).reduce((s, m) => s + m.shares, 0);
const dividendRatePerShareEff = Math.max(100, Math.min(dividendRatePerShare, Math.floor((bal.DEPOSIT - 150000) / Math.max(1, eligibleShares))));
let fy1Distributed = 0;
const dividendDate = new Date(Date.UTC(2025, 8, 20, 10, 0, 0));   // 20 Sep 2025
for (const mem of members) {
  const joinedBeforeFYClose = mem.joinDate < dividendDate;
  if (!joinedBeforeFYClose) continue;
  const amount = mem.shares * dividendRatePerShareEff;
  if (amount > bal.DEPOSIT) continue;
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= amount; assertBal('DEPOSIT');
  fy1Distributed += amount;
  transactions.push({
    type: 'Dividend', amount,
    description: `FY2024-25 dividend — ${mem.shares} shares @ ${dividendRatePerShareEff} BDT`,
    category: 'Dividend', reference_number: ref('DIV'),
    date: dividendDate, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
    deposit_method: 'Bank', handling_officer: 'Rafiq Ahmed',
    balance_before: before, balance_after: bal.DEPOSIT,
  });
}

// ── fiscal periods ──────────────────────────────────────────────────────────
const fy2 = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
for (const t of transactions) {
  if (!t.date) continue;
  const inFY2 = t.date >= new Date(Date.UTC(2025, 6, 1)) && t.date < new Date(Date.UTC(2026, 6, 1));
  if (!inFY2) continue;
  if (t.type === 'Deposit') fy2.deposits += t.amount;
  if (t.type === 'Withdrawal') fy2.withdrawals += t.amount;
  if (t.type === 'Earning') fy2.earnings += t.amount;
  if (t.type === 'Expense') fy2.expenses += t.amount;
}

// ── meetings + attendance + penalties (24 monthly) ──────────────────────────
const meetings = [];
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const completed = !(mm === MONTHS - 1);       // last month still scheduled
  const mtype = mm % 12 === 0 ? 'FOUNDING_MEMBER' : (mm % 3 === 2 ? 'SHAREHOLDER' : 'GENERAL');
  meetings.push({
    title: mtype === 'FOUNDING_MEMBER' ? `Annual General Meeting — ${y}` : `Monthly General Meeting — ${y}-${String(m + 1).padStart(2, '0')}`,
    meeting_type: mtype,
    meeting_date: new Date(Date.UTC(y, m, 5, 15, 0, 0)),
    location: pick(MEETING_PLACES),
    agenda: 'Deposit collection review, project progress, member applications, treasury report.',
    minutes: completed ? 'Attendance recorded; deposits collected; treasury report approved by show of hands.' : null,
    status: completed ? 'COMPLETED' : 'SCHEDULED',
    started_at: completed ? new Date(Date.UTC(y, m, 5, 15, 15, 0)) : null,
    completed_at: completed ? new Date(Date.UTC(y, m, 5, 17, 5, 0)) : null,
    monthIdx: mm,
  });
}

// ── assign derived per-member values ────────────────────────────────────────
const arrearsByMember = new Map();
for (const a of arrearsRows) {
  if (!arrearsByMember.has(a.idx)) arrearsByMember.set(a.idx, []);
  arrearsByMember.get(a.idx).push(a);
}

// ── insert plan ─────────────────────────────────────────────────────────────
const tenantId = uuid();
const adminUserId = uuid();
const memberUserIds = [uuid(), uuid(), uuid()];
const passwordHash = await bcrypt.hash('pass-12345678', 12);
const fundIds = { DEPOSIT: uuid(), PRIMARY: uuid(), PROJECT: uuid(), RESERVE: uuid(), EMERGENCY: uuid(), OTHER: uuid() };
const projectIds = projects.map(() => uuid());
const meetingIds = meetings.map(() => uuid());
const fy1Id = uuid(), fy2Id = uuid();
const memberIds = members.map(() => uuid());

// pick 3 members (active, early joiners) to get user accounts
const userAccessIdx = members.filter(m => m.status === 'active' && m.joinMonth < 6).slice(0, 3).map(m => m.idx);
const userIdFor = new Map(userAccessIdx.map((idx, k) => [idx, memberUserIds[k]]));

const fundMeta = {
  DEPOSIT:  { name: 'Member Deposit Fund',     account: 'GV-FND-001', desc: 'Receives monthly member deposits and operating income.' },
  PRIMARY:  { name: 'Primary Share Capital',   account: 'GV-FND-002', desc: 'Member share capital (primary fund).' },
  PROJECT:  { name: 'Project Investment Pool', account: 'GV-FND-003', desc: 'Capital allocated to income-generating projects.' },
  RESERVE:  { name: 'Statutory Reserve Fund',  account: 'GV-FND-004', desc: 'Mandatory 10% reserve of net surplus.' },
  EMERGENCY:{ name: 'Emergency Fund',          account: 'GV-FND-005', desc: 'Emergency liquidity buffer.' },
  OTHER:    { name: 'General Welfare Fund',    account: 'GV-FND-006', desc: 'Welfare and grant pool (currently unfunded).' },
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

// normalize rows to identical key sets (postgres.js uses the first row's keys)
function mk(cols, src) {
  const o = {};
  for (const c of cols) o[c] = src[c] !== undefined ? src[c] : null;
  return o;
}

console.log('Seeding Green Valley Investments (demo tenant)…');

await sql.begin(async (tx) => {
  // wipe previous run (FK-safe order)
  const prev = await tx`select id from tenants where slug = 'green-valley' limit 1`;
  if (prev.length) {
    const tid = prev[0].id;
    await tx`delete from profit_allocations where tenant_id = ${tid}`;
    await tx`delete from member_arrears where tenant_id = ${tid}`;
    await tx`delete from member_penalties where tenant_id = ${tid}`;
    await tx`delete from meeting_attendees where tenant_id = ${tid}`;
    await tx`delete from meetings where tenant_id = ${tid}`;
    await tx`delete from project_updates where tenant_id = ${tid}`;
    await tx`delete from project_members where tenant_id = ${tid}`;
    await tx`delete from goals where tenant_id = ${tid}`;
    await tx`delete from transactions where tenant_id = ${tid}`;
    await tx`delete from projects where tenant_id = ${tid}`;
    await tx`delete from members where tenant_id = ${tid}`;
    await tx`delete from funds where tenant_id = ${tid}`;
    await tx`delete from system_settings where tenant_id = ${tid}`;
    await tx`delete from fiscal_periods where tenant_id = ${tid}`;
    await tx`delete from users where tenant_id = ${tid}`;
    await tx`delete from tenant_subscriptions where tenant_id = ${tid}`;
    await tx`delete from tenants where id = ${tid}`;
    console.log('Previous green-valley tenant wiped.');
  }

  // 1) tenant
  await tx`insert into tenants (id, slug, name, status, plan, max_users, module_access, created_at, updated_at)
    values (${tenantId}, 'green-valley', 'Green Valley Investments', 'active', 'premium', 150,
      ${JSON.stringify({})}::jsonb, ${createdBase}, ${TODAY})`;

  // 2) users
  const allWrite = Object.fromEntries(['DASHBOARD','MEMBERS','MEETINGS','GOVERNANCE','GOALS','DEPOSITS','REQUEST_DEPOSIT','TRANSACTIONS','DIVIDENDS','EXPENSES','PROJECT_MANAGEMENT','FUNDS_MANAGEMENT','ANALYSIS','REPORTS','SETTINGS'].map(s => [s, 'WRITE']));
  const memberRead = Object.fromEntries(['DASHBOARD','DEPOSITS','PROJECT_MANAGEMENT','ANALYSIS','REPORTS','GOALS','TRANSACTIONS'].map(s => [s, 'READ']));
  const userCols = ['id','name','email','password','role','status','permissions','member_id','tenant_id','created_at','updated_at'];
  const userRows = [
    mk(userCols, {
      id: adminUserId, name: 'Rafiq Ahmed', email: 'admin@greenvalley.dev',
      password: passwordHash, role: 'Admin', status: 'active',
      permissions: allWrite, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY,
    }),
  ];
  for (let k = 0; k < userAccessIdx.length; k++) {
    const m = members[userAccessIdx[k]];
    userRows.push(mk(userCols, {
      id: memberUserIds[k], name: m.name, email: `user.${m.memberId.toLowerCase()}@greenvalley.dev`,
      password: passwordHash, role: 'Member', status: 'active',
      permissions: memberRead, member_id: m.memberId, tenant_id: tenantId,
      created_at: m.joinDate, updated_at: TODAY,
    }));
  }
  await insertChunked(tx, 'users', userRows);

  // 3) funds (PROJECT pool first so projects can link)
  const fundRows = Object.entries(fundMeta).map(([type, meta]) => mk(
    ['id','name','type','status','currency','account_number','balance','minimum_balance','reconciliation_status','handling_officer','description','tenant_id','created_at','updated_at'],
    { id: fundIds[type], name: meta.name, type, status: 'ACTIVE', currency: 'BDT',
      account_number: meta.account, balance: bal[type], minimum_balance: 0,
      reconciliation_status: 'VERIFIED', handling_officer: 'Rafiq Ahmed',
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
      performance_score: Math.max(55, 100 - (arrearsByMember.get(i) || []).length * 4 - Math.floor((absenceCount[i] || 0) / 2) * 5),
      user_id: userIdFor.get(i) || null, has_user_access: userIdFor.has(i),
      tenant_id: tenantId, created_at: m.joinDate, updated_at: TODAY,
    }));

  // 5) fiscal periods
  const fyCols = ['id','year','period_start','period_end','status','total_deposits','total_withdrawals','total_earnings','total_expenses','net_surplus','statutory_reserve','distributable_surplus','actual_distributed','retained_earnings','closed_by','closed_at','notes','tenant_id','created_at','updated_at'];
  const fyRows = [
    mk(fyCols,
      { id: fy1Id, year: 2024, period_start: new Date(Date.UTC(2024, 6, 1)), period_end: new Date(Date.UTC(2025, 5, 30)),
        status: 'CLOSED', total_deposits: fy1.deposits, total_withdrawals: fy1.withdrawals,
        total_earnings: fy1.earnings, total_expenses: fy1.expenses, net_surplus: fy1Net,
        statutory_reserve: fy1Reserve, distributable_surplus: fy1Distributable,
        actual_distributed: fy1Distributed, retained_earnings: fy1Distributable - fy1Distributed,
        closed_by: adminUserId, closed_at: new Date(Date.UTC(2025, 6, 15, 10, 0, 0)),
        notes: 'First operating year (partial, from Oct 2024).', tenant_id: tenantId,
        created_at: createdBase, updated_at: TODAY }),
    mk(fyCols,
      { id: fy2Id, year: 2025, period_start: new Date(Date.UTC(2025, 6, 1)), period_end: new Date(Date.UTC(2026, 5, 30)),
        status: 'OPEN', total_deposits: fy2.deposits, total_withdrawals: fy2.withdrawals,
        total_earnings: fy2.earnings, total_expenses: fy2.expenses, net_surplus: 0,
        statutory_reserve: 0, distributable_surplus: 0, actual_distributed: 0, retained_earnings: 0,
        notes: 'Current fiscal year — open.', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  // 6) projects
  const projectRows = projects.map((p, i) => mk(
    ['id','title','category','description','initial_investment','budget','expected_roi','total_shares','status','health','start_date','completion_date','total_earnings','total_expenses','project_fund_handler','linked_fund_id','current_fund_balance','tenant_id','created_at','updated_at'],
    {
      id: projectIds[i], title: p.title, category: p.category,
      description: `${p.title} — a member-financed ${p.category.toLowerCase()} venture operated under the Green Valley project pool.`,
      initial_investment: p.initial, budget: p.budget, expected_roi: p.roi,
      total_shares: Math.round(p.initial / shareValue), status: p.status, health: p.health,
      start_date: p.startDate, completion_date: p.completionDate || null,
      total_earnings: p.earnings, total_expenses: p.expenses,
      project_fund_handler: 'Rafiq Ahmed', linked_fund_id: fundIds.PROJECT,
      current_fund_balance: p.status === 'Completed' ? 0 : p.initial + p.earnings - p.expenses,
      tenant_id: tenantId, created_at: new Date(Date.UTC(p.sY, p.sM, 2, 6, 0, 0)), updated_at: TODAY,
    }));

  // 7) transactions
  const memberUuidByIdx = memberIds;
  const txnRows = transactions.map(t => mk(
    ['type','amount','description','category','reference_number','date','status','member_id','project_id','fund_id','handling_officer','deposit_method','balance_before','balance_after','created_by','authorized_by','is_deleted','tenant_id','created_at','updated_at'],
    {
      type: t.type, amount: t.amount, description: t.description, category: t.category,
      reference_number: t.reference_number, date: t.date, status: t.status,
      member_id: t.memberIdx !== undefined ? memberUuidByIdx[t.memberIdx] : null,
      project_id: t.projectIdx !== undefined ? projectIds[t.projectIdx] : null,
      fund_id: fundIds[t.fund], handling_officer: t.handling_officer || 'Rafiq Ahmed',
      deposit_method: t.deposit_method ?? null,
      balance_before: t.balance_before ?? null, balance_after: t.balance_after ?? null,
      created_by: adminUserId, authorized_by: adminUserId, is_deleted: false,
      tenant_id: tenantId, created_at: t.date, updated_at: t.date,
    }));

  // 8) project members + updates
  const pmRows = [], puRows = [];
  projects.forEach((p, pi) => {
    const eligible = members.filter(m => m.joinMonth <= p.start).map(m => m.idx);
    const shuffled = [...eligible].sort(() => rand() - 0.5).slice(0, Math.min(ri(15, 40), eligible.length));
    const totalSharesIn = shuffled.reduce((s, idx) => s + Math.max(1, Math.round(members[idx].shares / 4)), 0);
    for (const idx of shuffled) {
      const sharesIn = Math.max(1, Math.round(members[idx].shares / 4));
      pmRows.push(mk(['project_id','member_id','shares_invested','ownership_percentage','created_at'], {
        project_id: projectIds[pi], member_id: memberIds[idx], shares_invested: sharesIn,
        ownership_percentage: Number((sharesIn * 100 / totalSharesIn).toFixed(2)),
        created_at: new Date(Date.UTC(p.sY, p.sM, 3, 6, 0, 0)),
      }));
    }
    const nUpdates = ri(3, 6);
    for (let k = 0; k < nUpdates; k++) {
      const mm = Math.min(p.start + 1 + k * 2, MONTHS - 1);
      const { y, m } = addMonths(START.y, START.m, mm);
      const earning = chance(0.55);
      const amount = earning ? ri(12, 50) * 1000 : ri(6, 30) * 1000;
      puRows.push(mk(['project_id','type','amount','description','date','tenant_id','created_at'], {
        project_id: projectIds[pi], type: earning ? 'Earning' : 'Expense',
        amount, description: earning ? `Revenue update — ${p.title}` : `Cost update — ${p.title}`,
        date: dayIn(y, m, 6, 27), tenant_id: tenantId,
        created_at: dayIn(y, m, 6, 27),
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
    const pool = members.filter(m => m.joinMonth <= mt.monthIdx && m.status !== 'terminated');
    for (const m of pool) {
      const roll = rand();
      let attendance = 'PRESENT';
      if (roll > 0.94) attendance = 'EXCUSED';
      else if (roll > 0.78) attendance = 'ABSENT';
      const depositedThisMonth = !arrearsRows.some(a => a.idx === m.idx && a.periodKey === `${mt.meeting_date.getUTCFullYear()}-${String(mt.meeting_date.getUTCMonth() + 1).padStart(2, '0')}`);
      attendeeRows.push(mk(['meeting_id','member_id','attendance_status','deposit_status','tenant_id','created_at','updated_at'], {
        meeting_id: meetingIds[i], member_id: memberIds[m.idx], attendance_status: attendance,
        deposit_status: attendance === 'PRESENT' ? (depositedThisMonth ? 'PAID' : 'PENDING') : 'PENDING',
        tenant_id: tenantId, created_at: mt.meeting_date, updated_at: mt.meeting_date,
      }));
      if (attendance === 'ABSENT' && chance(0.6)) {
        absenceCount[m.idx] += 1;
        const tier = Math.min(3, absenceCount[m.idx]);
        const type = tier === 1 ? 'VERBAL_WARNING' : tier === 2 ? 'WRITTEN_WARNING' : 'FINE';
        penaltyRows.push(mk(['member_id','meeting_id','tier','title','type','calculated_deduction','status','reason','issued_by','issued_by_name','issued_at','tenant_id','created_at','updated_at'], {
          member_id: memberIds[m.idx], meeting_id: meetingIds[i], tier,
          title: penaltyTierTitle[tier], type,
          calculated_deduction: tier === 3 ? 200 : 0, status: 'ACTIVE',
          reason: `Absent from ${mt.title} without prior excuse.`,
          issued_by: adminUserId, issued_by_name: 'Rafiq Ahmed',
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
      const waived = chance(0.08);
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

  // 11) profit allocations (FY1 dividend)
  const dividendTxnIdx = transactions.findIndex(t => t.type === 'Dividend');
  const allocationRows = [];
  for (const t of transactions) {
    if (t.type !== 'Dividend') continue;
    const m = members[t.memberIdx];
    allocationRows.push(mk(['fiscal_period_id','member_id','allocation_type','amount','shares_at_time','rate_per_share','notes','allocated_by','allocated_at','tenant_id','created_at'], {
      fiscal_period_id: fy1Id, member_id: memberIds[t.memberIdx], allocation_type: 'DIVIDEND',
      amount: t.amount, shares_at_time: m.shares, rate_per_share: dividendRatePerShareEff,
      notes: 'FY2024-25 annual dividend per share.', allocated_by: adminUserId,
      allocated_at: dividendDate, tenant_id: tenantId, created_at: dividendDate,
    }));
  }

  // 12) goals + settings
  const goalCols = ['user_id','title','description','target_amount','current_amount','deadline','status','type','linked_project_id','tenant_id','created_at','updated_at'];
  const goalRows = [
    mk(goalCols,
      { user_id: adminUserId, title: 'Grow membership to 150 members', description: 'Onboarding drive across Mirpur and Uttara chapters.', target_amount: 150, current_amount: 120, deadline: '2027-06-30', status: 'In Progress', type: 'Other', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols,
      { user_id: adminUserId, title: 'Reserve fund to 500,000 BDT', description: 'Reach the statutory reserve comfort level.', target_amount: 500000, current_amount: 150000, deadline: '2027-06-30', status: 'In Progress', type: 'Savings', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols,
      { user_id: adminUserId, title: 'Complete Cold Storage Facility', description: 'Finish construction and begin commercial operations.', target_amount: 1800000, current_amount: 1260000, deadline: '2026-12-31', status: 'In Progress', type: 'Investment', linked_project_id: projectIds[2], tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols,
      { user_id: adminUserId, title: 'First annual dividend distribution', description: 'Distribute FY2024-25 surplus to shareholders.', target_amount: 400000, current_amount: fy1Distributed, deadline: '2025-09-30', status: 'Achieved', type: 'Investment', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  const settingsRows = [mk(
    ['tenant_id','fiscal_year_start','fiscal_year_end','base_currency','share_value_bdt','is_share_value_locked','company_name','company_tagline','company_address','company_email','company_phone','deposit_due_date','monthly_meeting_day','late_deposit_grace_months','inactive_after_months','suspended_after_months','last_updated_by','last_updated_at','created_at','updated_at'],
    { tenant_id: tenantId, fiscal_year_start: 'July', fiscal_year_end: 'June', base_currency: 'BDT',
      share_value_bdt: shareValue, is_share_value_locked: true,
      company_name: 'Green Valley Investments', company_tagline: 'Community-owned growth since 2024',
      company_address: 'House 12, Green Road, Mirpur-1, Dhaka', company_email: 'info@greenvalley.demo',
      company_phone: '+8801711000001', deposit_due_date: 10, monthly_meeting_day: 5,
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
  (select count(*) from profit_allocations where tenant_id = ${tenantId}) as allocations`;
console.log('Seed complete:', cnt[0]);
console.log('Fund balances:', Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, `${v.toLocaleString()} BDT`])));
console.log('FY2024-25: net surplus', fy1Net.toLocaleString(), '| distributed', fy1Distributed.toLocaleString());
console.log('Login: admin@greenvalley.dev / pass-12345678 (role Admin, tenant green-valley)');
await sql.end();
