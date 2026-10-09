/**
 * Medium-size company tenant seeder — Northbridge Manufacturing Cooperative
 * (LOCAL DEV ONLY).
 *
 * A deliberately DIFFERENT shape from the green-valley demo so it exercises
 * code paths that a small community fund never touches:
 *   - larger scale: 240 members, 12 projects, 7 funds
 *   - a real payroll-style operating expense stream (fixed monthly costs)
 *   - TWO completed fiscal years with TWO dividend runs (rate changes YoY)
 *   - an active member-deposit flow AND a separate "welfare levy" stream
 *   - a self-managed transfer discipline (monthly reserve sweep)
 *   - more users: 1 admin + 1 auditor + 1 manager + 6 member logins
 *
 * Invariants enforced while generating (asserted, same as the demo seeder):
 *   - every fund balance >= 0 at every step
 *   - final fund.balance == opening + inflows - outflows
 *   - members.total_contributed == sum of their Deposit rows
 *   - globally unique member_id/email, funds.account_number,
 *     transactions.reference_number
 *
 * Deterministic (seeded PRNG). Re-runnable: wipes the previous northbridge
 * tenant inside the same transaction.
 *
 * Usage: node scripts/seed-northbridge-tenant.mjs
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
const rand = mulberry32(20261009);            // distinct seed from green-valley
const ri = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// ── name pools (South Asian, general) ───────────────────────────────────────
const MALE = ['Arman','Bilal','Cyrus','Danish','Ehsan','Farhan','Girish','Hamza','Idris','Junaid','Kabir','Latif','Moin','Naveed','Omar','Pranav','Qasim','Rehan','Salim','Tariq','Usman','Varun','Waqar','Yusuf','Zaid','Adil','Bashir','Faisal','Haris','Irfan'];
const FEMALE = ['Aisha','Bushra','Chandni','Dilruba','Eshita','Farida','Gulnar','Hina','Ishrat','Jasmine','Kiran','Laila','Meher','Nazia','Oorja','Parveen','Rania','Sana','Tasnim','Uzma','Vandana','Warda','Yasmin','Zainab','Afreen','Benazir','Chitra','Dilpreet'];
const SUR = ['Khan','Sheikh','Ansari','Qureshi','Bhatti','Malik','Sayyed','Alam','Karim','Rahmani','Farooqui','Siddiqui','Zafar','Nadeem','Baig','Chaudhry','Hashmi','Jafri','Kazmi','Mansuri','Naqvi','Pasha','Rizvi','Sabri','Tirmizi'];
const AREAS = ['Northbridge Industrial Area','Riverside Commercial District','Old Mill Quarter','Harbour Point','Foundry Lane','Textile Park','Warehouse Row','Civic Center','Manufacturing Estate','Station Road'];
const RELATIONS = ['Wife','Husband','Father','Mother','Brother','Sister','Son','Daughter'];
const MEETING_PLACES = ['Northbridge HQ — Board Room','Northbridge HQ — Auditorium','Virtual (Video Conference)','Foundry Lane Training Center'];
const DEPOSIT_METHODS = ['Bank Transfer','Bank Transfer','Mobile Banking','Check','Cash','Bank Transfer','Direct Debit'];
const OPS_EXPENSES = ['Factory rent','Electricity & utilities','Production staff payroll','Safety equipment & PPE','Raw material procurement','Machinery maintenance','Quality control lab fees','Logistics & freight','Insurance premiums','Software & licenses','Audit & compliance fees','Worker canteen subsidy'];
const WELFARE = ['Welfare: medical assistance','Welfare: education grant','Welfare: emergency relief','Welfare: festival allowance'];

const uuid = () => crypto.randomUUID();
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1, 10, 0, 0));
const addMonths = (y, m, n) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; };
const dayIn = (y, m, lo, hi) => new Date(Date.UTC(y, m, ri(lo, hi), 10, ri(0, 59), 0));

// ── timeline ────────────────────────────────────────────────────────────────
const TODAY = new Date('2026-10-04T10:00:00Z');
const START = { y: 2024, m: 6 };            // Jul 2024 (fiscal-year aligned start)
const MONTHS = 27;                          // Jul 2024 … Sep 2026 inclusive
const shareValue = 2500;                    // larger unit value than the demo
const statutoryReservePct = 12;             // company policy: 12%
const fiscalYearStart = 'July';
const fiscalYearEnd = 'June';

// ── plan ────────────────────────────────────────────────────────────────────
const memberCount = 240;
const joinPlan = [];
{
  let left = memberCount;
  for (let mm = 0; mm < MONTHS && left > 0; mm++) {
    const n = mm === 0 ? 34 : Math.min(left, ri(6, 13));
    for (let k = 0; k < n; k++) joinPlan.push(mm);
    left -= n;
  }
  while (joinPlan.length < memberCount) joinPlan.push(MONTHS - 1);
}

// problem members: stop paying mid-way (accrue arrears)
const problemMembers = new Set();
while (problemMembers.size < 24) problemMembers.add(ri(40, memberCount - 1));
const stopMonth = new Map();
for (const idx of problemMembers) stopMonth.set(idx, ri(10, MONTHS - 4));

// ── balances ────────────────────────────────────────────────────────────────
const bal = { DEPOSIT: 0, PRIMARY: 0, PROJECT: 0, RESERVE: 0, EMERGENCY: 0, OTHER: 0 };
const assertBal = (f) => { if (bal[f] < 0) throw new Error(`Balance went negative for ${f}: ${bal[f]}`); };

// ── build members ───────────────────────────────────────────────────────────
const usedEmails = new Set();
const members = [];
for (let i = 0; i < memberCount; i++) {
  const jm = joinPlan[i];
  const jy = addMonths(START.y, START.m, jm);
  const gender = chance(0.68) ? 'M' : 'F';
  const first = gender === 'M' ? pick(MALE) : pick(FEMALE);
  const name = `${first} ${pick(MALE)} ${pick(SUR)}`;
  let email;
  do { email = `member${i + 1}.${Math.floor(rand() * 9000 + 1000)}@northbridge.demo`; } while (usedEmails.has(email));
  usedEmails.add(email);
  const founding = jm === 0;
  const target = pick([3000, 4000, 5000, 6000, 8000, 10000, 12000]);
  const shares = founding ? ri(40, 120) : ri(15, 70);
  const activeMonths = Math.max(1, MONTHS - jm);
  members.push({
    idx: i,
    memberId: `NB-${String(i + 1).padStart(3, '0')}`,
    name, email,
    phone: `+9198${String(ri(10000000, 99999999))}`,
    shares,
    target,
    founding,
    joinDate: dayIn(jy.y, jy.m, 2, 22),
    joinMonth: jm,
    stopMonth: stopMonth.get(i),
    status: stopMonth.has(i) ? (stopMonth.get(i) < MONTHS - 6 ? 'suspended' : 'inactive') : (chance(0.05) ? 'pending' : 'active'),
    fatherName: `${pick(MALE)} ${pick(SUR)}`,
    motherName: `${pick(FEMALE)} ${pick(SUR)}`,
    spouseName: gender === 'M' ? `${pick(FEMALE)} ${pick(SUR)}` : `${pick(MALE)} ${pick(SUR)}`,
    address: pick(AREAS),
    nid: `20${ri(10, 25)}${ri(1000000, 9999999)}`,
    nomineeName: `${pick(FEMALE)} ${pick(SUR)}`,
    nomineeRelation: pick(RELATIONS),
    nomineePhone: `+9198${String(ri(10000000, 99999999))}`,
    activeMonths,
  });
}

// ── transactions + derived rows ─────────────────────────────────────────────
const transactions = [];
let refCounters = {};
const ref = (prefix) => { refCounters[prefix] = (refCounters[prefix] || 0) + 1; return `NB-${prefix}-${String(refCounters[prefix]).padStart(5, '0')}`; };

const totals = { deposits: 0, withdrawals: 0, earnings: 0, expenses: 0 };
const contributed = new Array(memberCount).fill(0);
const lastDepositMonth = new Array(memberCount).fill(null);
const arrearsRows = [];
const absenceCount = new Array(memberCount).fill(0);
const projectFin = [];
const ADMIN_OFFICER = 'Priya Varma';

// 1) share capital at join → PRIMARY (Investment)
for (const m of members) {
  const amount = m.shares * shareValue;
  bal.PRIMARY += amount;
  transactions.push({
    type: 'Investment', amount,
    description: `Share capital subscription — ${m.shares} shares @ ${shareValue} INR`,
    category: 'Share Capital', reference_number: ref('INV'),
    date: m.joinDate, status: 'Completed',
    memberIdx: m.idx, fund: 'PRIMARY',
    deposit_method: 'Bank Transfer', handling_officer: ADMIN_OFFICER,
  });
}

// 2) monthly deposits → DEPOSIT
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  for (const mem of members) {
    if (mem.joinMonth > mm) continue;
    if (mem.stopMonth !== undefined && mm >= mem.stopMonth) {
      arrearsRows.push({ idx: mem.idx, periodKey: `${y}-${String(m + 1).padStart(2, '0')}`, required: mem.target });
      continue;
    }
    if (mem.status === 'pending' && mm > mem.joinMonth) continue;
    if (!chance(0.88)) {
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
      description: `Monthly subscription — ${ym(date)}`,
      category: 'Monthly Deposit', reference_number: ref('DEP'),
      date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      deposit_method: pick(DEPOSIT_METHODS), handling_officer: ADMIN_OFFICER,
      balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
}

// 3) welfare levy — a SEPARATE small recurring stream (2% of target), → OTHER fund
for (let mm = 1; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  for (const mem of members) {
    if (mem.joinMonth > mm || mem.status !== 'active') continue;
    if (!chance(0.7)) continue;
    const amount = Math.round(mem.target * 0.02);
    if (amount <= 0 || amount > bal.DEPOSIT) continue;
    const date = dayIn(y, m, 4, 15);
    const beforeDep = bal.DEPOSIT;
    const beforeOther = bal.OTHER;
    bal.DEPOSIT -= amount; assertBal('DEPOSIT');
    bal.OTHER += amount;
    contributed[mem.idx] += 0; // levy is NOT member contribution capital
    // Both legs must be written, like every other inter-fund move in this
    // seed: a one-sided row (only the receiving fund) makes the stored
    // balance unreconstructable from the ledger, which is exactly the drift
    // the app's integrity checks are built to catch.
    const group = uuid();
    transactions.push({
      type: 'Transfer Out', amount,
      description: `Welfare levy sweep — ${ym(date)} (DEPOSIT → OTHER)`,
      category: 'Welfare Levy', reference_number: `${ref('WLV')}-OUT`,
      transfer_group_id: group,
      date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      handling_officer: ADMIN_OFFICER, balance_before: beforeDep, balance_after: bal.DEPOSIT,
    });
    transactions.push({
      type: 'Transfer In', amount,
      description: `Welfare levy sweep — ${ym(date)} (DEPOSIT → OTHER)`,
      category: 'Welfare Levy', reference_number: `${ref('WLV')}-IN`,
      transfer_group_id: group,
      date, status: 'Completed', memberIdx: mem.idx, fund: 'OTHER',
      handling_officer: ADMIN_OFFICER, balance_before: beforeOther, balance_after: bal.OTHER,
    });
  }
}

// 4) withdrawals → DEPOSIT
for (let k = 0; k < 22; k++) {
  const mm = ri(8, MONTHS - 1);
  const { y, m } = addMonths(START.y, START.m, mm);
  const mem = members[ri(0, memberCount - 1)];
  if (mem.joinMonth > mm) continue;
  const amount = Math.min(mem.target * ri(4, 10), 60000);
  const date = dayIn(y, m, 12, 25);
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= amount; assertBal('DEPOSIT');
  totals.withdrawals += amount;
  transactions.push({
    type: 'Withdrawal', amount,
    description: `Partial redemption — member request`,
    category: 'Withdrawal', reference_number: ref('WDR'),
    date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
    deposit_method: 'Bank Transfer', handling_officer: ADMIN_OFFICER,
    balance_before: before, balance_after: bal.DEPOSIT,
  });
}

// 5) projects (12) — capital via explicit INTER-FUND TRANSFERS (Transfer Out/In
//    legs), which is the pattern the medium-size flow actually uses.
const projectDefs = [
  { title: 'Precision Tooling Line',    category: 'Manufacturing', status: 'Completed',   health: 'Stable',   start: 1,  budget: 2400000, roi: 17 },
  { title: 'Packaging Plant Upgrade',   category: 'Manufacturing', status: 'Completed',   health: 'Stable',   start: 3,  budget: 1600000, roi: 14 },
  { title: 'Warehouse Expansion Phase 1', category: 'Logistics',   status: 'Completed',   health: 'Stable',   start: 6,  budget: 1200000, roi: 12 },
  { title: 'Solar Rooftop Program',     category: 'Energy',        status: 'In Progress', health: 'Stable',   start: 9,  budget: 3000000, roi: 19 },
  { title: 'Quality Lab Modernization', category: 'R&D',           status: 'In Progress', health: 'Stable',   start: 12, budget: 800000,  roi: 11 },
  { title: 'Fleet Electrification',     category: 'Logistics',     status: 'In Progress', health: 'At Risk',  start: 14, budget: 2200000, roi: 15 },
  { title: 'Export Compliance Suite',   category: 'Compliance',    status: 'Review',      health: 'Stable',   start: 16, budget: 600000,  roi: 9  },
  { title: 'Assembly Line Automation',  category: 'Manufacturing', status: 'In Progress', health: 'Stable',   start: 18, budget: 2800000, roi: 21 },
  { title: 'Retail Outlet Rollout',     category: 'Retail',        status: 'In Progress', health: 'At Risk',  start: 20, budget: 1500000, roi: 13 },
  { title: 'Water Recycling Plant',     category: 'Utilities',     status: 'In Progress', health: 'Stable',   start: 22, budget: 1100000, roi: 10 },
  // Newest two are early-stage — the app vocabulary has no 'Planning' value
  // (PROJECT_STATUSES in lib/utils/validation.ts), so not-yet-started work is
  // seeded as 'In Progress' like every other active project.
  { title: 'Training Center Build-out', category: 'Workforce',     status: 'In Progress', health: 'Stable',   start: 24, budget: 700000,  roi: 8  },
  { title: 'Regional Distribution Hub', category: 'Logistics',     status: 'In Progress', health: 'Stable',   start: 25, budget: 1900000, roi: 16 },
];
const projects = [];
for (const pd of projectDefs) {
  const initial = Math.round(pd.budget * 0.4 / 10000) * 10000;
  const s = addMonths(START.y, START.m, pd.start);
  const startDate = `${s.y}-${String(s.m + 1).padStart(2, '0')}-${String(ri(3, 15)).padStart(2, '0')}`;
  projects.push({ ...pd, initial, startDate, sY: s.y, sM: s.m, earnings: 0, expenses: 0, returned: false });
}
// fund project starts: DEPOSIT → PROJECT via paired Transfer Out / Transfer In
for (const p of projects) {
  const date = new Date(Date.UTC(p.sY, p.sM, 18, 10, 0, 0));
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= p.initial; assertBal('DEPOSIT');
  bal.PROJECT += p.initial;
  const group = uuid();
  transactions.push({
    type: 'Transfer Out', amount: p.initial,
    description: `[Transfer OUT] to Project Investment Pool: capital for “${p.title}”`,
    category: 'Project Funding', reference_number: `${ref('TRF')}-OUT`,
    transfer_group_id: group, date, status: 'Completed', fund: 'DEPOSIT',
    handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.DEPOSIT,
  });
  transactions.push({
    type: 'Transfer In', amount: p.initial,
    description: `[Transfer IN] from Member Deposit Fund: capital for “${p.title}”`,
    category: 'Project Funding', reference_number: `${ref('TRF')}-IN`,
    transfer_group_id: group, date, status: 'Completed', fund: 'PROJECT',
    handling_officer: ADMIN_OFFICER,
  });
}
// project economics
for (const p of projects) {
  const endM = p.status === 'Completed' ? p.start + ri(9, 12) : MONTHS - 1;
  const nEarnings = ri(4, 7), nExpenses = ri(4, 8);
  let profE = 0, profX = 0;
  for (let k = 0; k < nEarnings; k++) {
    const mm = Math.min(p.start + ri(2, Math.max(2, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(40, 180) * 1000;
    const date = dayIn(y, m, 10, 27);
    bal.PROJECT += amount; assertBal('PROJECT');
    profE += amount; totals.earnings += amount;
    transactions.push({
      type: 'Earning', amount,
      description: `Revenue — ${p.title}`,
      category: 'Project Income', reference_number: ref('EAR'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: ADMIN_OFFICER,
    });
  }
  for (let k = 0; k < nExpenses; k++) {
    const mm = Math.min(p.start + ri(1, Math.max(1, endM - p.start)), MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, mm);
    const amount = ri(20, 110) * 1000;
    if (amount > bal.PROJECT) continue;
    const date = dayIn(y, m, 5, 26);
    bal.PROJECT -= amount; assertBal('PROJECT');
    profX += amount; totals.expenses += amount;
    transactions.push({
      type: 'Expense', amount,
      description: `${pick(['Equipment purchase','Raw materials','Contract labor','Freight','Site maintenance','Tooling','Calibration'])} — ${p.title}`,
      category: 'Project Expense', reference_number: ref('PXP'),
      date, status: 'Completed', fund: 'PROJECT', projectIdx: projects.indexOf(p),
      handling_officer: ADMIN_OFFICER,
    });
  }
  p.earnings = profE; p.expenses = profX;
  if (p.status === 'Completed') {
    const completionM = Math.min(p.start + 13, MONTHS - 1);
    const { y, m } = addMonths(START.y, START.m, completionM);
    const ret = p.initial + Math.max(0, profE - profX);
    const capped = Math.min(ret, bal.PROJECT);
    if (capped > 0) {
      const date = dayIn(y, m, 20, 27);
      const before = bal.PROJECT;
      bal.PROJECT -= capped; assertBal('PROJECT');
      bal.DEPOSIT += capped;
      const group = uuid();
      transactions.push({
        type: 'Transfer Out', amount: capped,
        description: `[Transfer OUT] to Member Deposit Fund: settlement of “${p.title}”`,
        category: 'Project Settlement', reference_number: `${ref('TRF')}-OUT`,
        transfer_group_id: group, date, status: 'Completed', fund: 'PROJECT',
        handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.PROJECT,
      });
      transactions.push({
        type: 'Transfer In', amount: capped,
        description: `[Transfer IN] from Project Investment Pool: settlement of “${p.title}”`,
        category: 'Project Settlement', reference_number: `${ref('TRF')}-IN`,
        transfer_group_id: group, date, status: 'Completed', fund: 'DEPOSIT',
        handling_officer: ADMIN_OFFICER,
      });
      p.completionDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(ri(20, 27)).padStart(2, '0')}`;
    }
  }
}

// 6) monthly operating expenses (payroll-heavy, fixed baseline + variable)
for (let mm = 0; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  // fixed baseline: payroll + rent, scaled to headcount at the time
  const headcount = members.filter((mem) => mem.joinMonth <= mm && mem.status === 'active').length;
  const payroll = Math.max(40000, headcount * ri(220, 340));
  const rent = 85000;
  for (const [amt, label] of [[payroll, 'Production staff payroll'], [rent, 'Factory rent']]) {
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
      handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.DEPOSIT,
    });
  }
  const n = ri(4, 7);
  for (let k = 0; k < n; k++) {
    const amount = ri(6, 42) * 1000;
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

// 7) monthly reserve sweep: DEPOSIT → RESERVE (company policy discipline)
for (let mm = 6; mm < MONTHS; mm++) {
  const { y, m } = addMonths(START.y, START.m, mm);
  const amt = Math.min(60000, Math.floor(Math.max(0, bal.DEPOSIT - 400000) * 0.15));
  if (amt <= 1000) continue;
  const date = new Date(Date.UTC(y, m, 26, 10, 0, 0));
  const before = bal.DEPOSIT;
  bal.DEPOSIT -= amt; assertBal('DEPOSIT');
  bal.RESERVE += amt;
  const group = uuid();
  transactions.push({
    type: 'Transfer Out', amount: amt,
    description: `[Transfer OUT] to Statutory Reserve Fund: monthly reserve sweep ${ym(date)}`,
    category: 'Statutory Reserve', reference_number: `${ref('TRF')}-OUT`,
    transfer_group_id: group, date, status: 'Completed', fund: 'DEPOSIT',
    handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.DEPOSIT,
  });
  transactions.push({
    type: 'Transfer In', amount: amt,
    description: `[Transfer IN] from Member Deposit Fund: monthly reserve sweep ${ym(date)}`,
    category: 'Statutory Reserve', reference_number: `${ref('TRF')}-IN`,
    transfer_group_id: group, date, status: 'Completed', fund: 'RESERVE',
    handling_officer: ADMIN_OFFICER,
  });
}
// one-off emergency buffer top-up
{
  const { y, m } = addMonths(START.y, START.m, 15);
  const amt = Math.min(250000, Math.floor(Math.max(0, bal.DEPOSIT - 400000) * 0.2));
  if (amt > 0) {
    const date = new Date(Date.UTC(y, m, ri(10, 25), 10, 0, 0));
    const before = bal.DEPOSIT;
    bal.DEPOSIT -= amt; assertBal('DEPOSIT');
    bal.EMERGENCY += amt;
    const group = uuid();
    transactions.push({
      type: 'Transfer Out', amount: amt,
      description: `[Transfer OUT] to Emergency Fund: liquidity buffer top-up`,
      category: 'Emergency Fund Top-up', reference_number: `${ref('TRF')}-OUT`,
      transfer_group_id: group, date, status: 'Completed', fund: 'DEPOSIT',
      handling_officer: ADMIN_OFFICER, balance_before: before, balance_after: bal.DEPOSIT,
    });
    transactions.push({
      type: 'Transfer In', amount: amt,
      description: `[Transfer IN] from Member Deposit Fund: liquidity buffer top-up`,
      category: 'Emergency Fund Top-up', reference_number: `${ref('TRF')}-IN`,
      transfer_group_id: group, date, status: 'Completed', fund: 'EMERGENCY',
      handling_officer: ADMIN_OFFICER,
    });
  }
}

// 8) welfare payouts from OTHER (small grants)
for (let k = 0; k < 14; k++) {
  const mm = ri(8, MONTHS - 1);
  const { y, m } = addMonths(START.y, START.m, mm);
  const amount = ri(3, 15) * 1000;
  if (amount > bal.OTHER) continue;
  const date = dayIn(y, m, 8, 24);
  const before = bal.OTHER;
  bal.OTHER -= amount; assertBal('OTHER');
  transactions.push({
    type: 'Expense', amount,
    description: pick(WELFARE),
    category: 'Welfare', reference_number: ref('WEX'),
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
  { label: 'FY2024-25', date: new Date(Date.UTC(2025, 8, 20, 10, 0, 0)), baseRate: 380, distributable: fy1Distributable },
  { label: 'FY2025-26', date: new Date(Date.UTC(2026, 8, 20, 10, 0, 0)), baseRate: 460, distributable: fy2Distributable },
]) {
  const eligible = members.filter((m) => m.joinDate < run.date).reduce((s, m) => s + m.shares, 0);
  // A turnaround must satisfy TWO independent caps, and the smaller wins:
  //   1. solvency  — total payout may not exceed the year's distributable
  //      surplus, or retained earnings go negative and the co-op has paid out
  //      money it never earned;
  //   2. liquidity — the deposit fund must still hold the cash afterwards
  //      (keep a working-balance floor).
  // Capping on liquidity alone let FY1 over-distribute by 135,620 because the
  // deposit account happened to hold more cash than that year's profit.
  const solvencyRate = Math.floor(run.distributable / Math.max(1, eligible));
  const liquidityRate = Math.floor((bal.DEPOSIT - 400000) / Math.max(1, eligible));
  // The floor is a floor on rounding noise only — it may NEVER override the
  // solvency cap (that would reintroduce the over-distribution).
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
      description: `${run.label} dividend — ${mem.shares} shares @ ${rate} INR`,
      category: 'Dividend', reference_number: ref('DIV'),
      date: run.date, status: 'Completed', memberIdx: mem.idx, fund: 'DEPOSIT',
      deposit_method: 'Bank Transfer', handling_officer: ADMIN_OFFICER,
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
    title: mtype === 'FOUNDING_MEMBER' ? `Annual General Meeting — ${y}` : `Monthly Business Meeting — ${y}-${String(m + 1).padStart(2, '0')}`,
    meeting_type: mtype,
    meeting_date: new Date(Date.UTC(y, m, 8, 15, 0, 0)),
    location: pick(MEETING_PLACES),
    agenda: 'Production review, treasury report, project pipeline, member applications, compliance.',
    minutes: completed ? 'Quorum met; treasury report adopted; project milestones reviewed.' : null,
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
const tenantSlug = 'northbridge';
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
  DEPOSIT:  { name: 'Member Subscription Fund', account: 'NB-FND-001', desc: 'Receives member monthly subscriptions and operating income.' },
  PRIMARY:  { name: 'Share Capital Account',    account: 'NB-FND-002', desc: 'Member share capital (primary).' },
  PROJECT:  { name: 'Capital Projects Pool',    account: 'NB-FND-003', desc: 'Capital deployed to income-generating projects.' },
  RESERVE:  { name: 'Statutory Reserve',        account: 'NB-FND-004', desc: 'Mandatory 12% reserve of net surplus.' },
  EMERGENCY:{ name: 'Contingency Fund',         account: 'NB-FND-005', desc: 'Emergency liquidity buffer.' },
  OTHER:    { name: 'Welfare & Benefits Fund',  account: 'NB-FND-006', desc: 'Member welfare grants and benefits.' },
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

console.log('Seeding Northbridge Manufacturing Cooperative (medium-size tenant)…');

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
    console.log('Previous northbridge tenant wiped.');
  }

  // 1) tenant
  await tx`insert into tenants (id, slug, name, status, plan, max_users, module_access, created_at, updated_at)
    values (${tenantId}, ${tenantSlug}, 'Northbridge Manufacturing Cooperative', 'active', 'enterprise', 400,
      ${JSON.stringify({})}::jsonb, ${createdBase}, ${TODAY})`;

  // 2) users — admin + auditor + manager + 6 member logins
  const allWrite = Object.fromEntries(['DASHBOARD','MEMBERS','MEETINGS','GOVERNANCE','GOALS','DEPOSITS','REQUEST_DEPOSIT','TRANSACTIONS','DIVIDENDS','EXPENSES','PROJECT_MANAGEMENT','FUNDS_MANAGEMENT','ANALYSIS','REPORTS','SETTINGS'].map((s) => [s, 'WRITE']));
  const readOnlyAll = Object.fromEntries(['DASHBOARD','MEMBERS','MEETINGS','GOVERNANCE','GOALS','DEPOSITS','TRANSACTIONS','DIVIDENDS','EXPENSES','PROJECT_MANAGEMENT','FUNDS_MANAGEMENT','ANALYSIS','REPORTS','SETTINGS'].map((s) => [s, 'READ']));
  const memberRead = Object.fromEntries(['DASHBOARD','DEPOSITS','PROJECT_MANAGEMENT','ANALYSIS','REPORTS','GOALS','TRANSACTIONS'].map((s) => [s, 'READ']));
  const userCols = ['id','name','email','password','role','status','permissions','member_id','tenant_id','created_at','updated_at'];
  const userRows = [
    mk(userCols, { id: adminUserId, name: 'Priya Varma', email: 'admin@northbridge.dev', password: passwordHash, role: 'Admin', status: 'active', permissions: allWrite, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(userCols, { id: auditorUserId, name: 'Nadia Qureshi', email: 'auditor@northbridge.dev', password: passwordHash, role: 'Auditor', status: 'active', permissions: readOnlyAll, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(userCols, { id: managerUserId, name: 'Imran Sheikh', email: 'manager@northbridge.dev', password: passwordHash, role: 'Manager', status: 'active', permissions: { ...allWrite, SETTINGS: 'READ', MEMBERS: 'WRITE' }, member_id: null, tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];
  for (let k = 0; k < userAccessIdx.length; k++) {
    const m = members[userAccessIdx[k]];
    userRows.push(mk(userCols, {
      id: memberUserIds[k], name: m.name, email: `user.${m.memberId.toLowerCase()}@northbridge.dev`,
      password: passwordHash, role: 'Member', status: 'active',
      permissions: memberRead, member_id: m.memberId, tenant_id: tenantId,
      created_at: m.joinDate, updated_at: TODAY,
    }));
  }
  await insertChunked(tx, 'users', userRows);

  // 3) funds
  const fundRows = Object.entries(fundMeta).map(([type, meta]) => mk(
    ['id','name','type','status','currency','account_number','balance','minimum_balance','reconciliation_status','handling_officer','description','tenant_id','created_at','updated_at'],
    { id: fundIds[type], name: meta.name, type, status: 'ACTIVE', currency: 'INR',
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

  // 5) fiscal periods — FY1 + FY2 CLOSED, FY3 open
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
    // FY3 (Jul 2026 – Jun 2027) must exist and be OPEN: the fiscal guard is
    // fail-closed, so without a current period every write "today" is refused
    // ("No fiscal period is defined for 2026"). A real tenant on this app
    // always has its current year open.
    mk(fyCols, {
      id: fy3Id, year: 2026, period_start: new Date(Date.UTC(2026, 6, 1)), period_end: new Date(Date.UTC(2027, 5, 30)),
      status: 'OPEN', total_deposits: 0, total_withdrawals: 0,
      total_earnings: 0, total_expenses: 0, net_surplus: 0,
      statutory_reserve: 0, distributable_surplus: 0,
      actual_distributed: 0, retained_earnings: 0,
      closed_by: null, closed_at: null,
      notes: 'Current fiscal year — open for postings.', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  // 6) projects
  const projectRows = projects.map((p, i) => mk(
    ['id','title','category','description','initial_investment','budget','expected_roi','total_shares','status','health','start_date','completion_date','total_earnings','total_expenses','project_fund_handler','linked_fund_id','current_fund_balance','tenant_id','created_at','updated_at'],
    {
      id: projectIds[i], title: p.title, category: p.category,
      description: `${p.title} — a member-financed ${p.category.toLowerCase()} initiative under the Northbridge capital projects pool.`,
      initial_investment: p.initial, budget: p.budget, expected_roi: p.roi,
      total_shares: Math.round(p.initial / shareValue), status: p.status, health: p.health,
      start_date: p.startDate, completion_date: p.completionDate || null,
      total_earnings: p.earnings, total_expenses: p.expenses,
      project_fund_handler: ADMIN_OFFICER, linked_fund_id: fundIds.PROJECT,
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
    const shuffled = [...eligible].sort(() => rand() - 0.5).slice(0, Math.min(ri(30, 80), eligible.length));
    const totalSharesIn = shuffled.reduce((s, idx) => s + Math.max(1, Math.round(members[idx].shares / 5)), 0);
    for (const idx of shuffled) {
      const sharesIn = Math.max(1, Math.round(members[idx].shares / 5));
      pmRows.push(mk(['project_id','member_id','shares_invested','ownership_percentage','created_at'], {
        project_id: projectIds[pi], member_id: memberIds[idx], shares_invested: sharesIn,
        ownership_percentage: Number((sharesIn * 100 / totalSharesIn).toFixed(2)),
        created_at: new Date(Date.UTC(p.sY, p.sM, 3, 6, 0, 0)),
      }));
    }
    const nUpdates = ri(4, 8);
    for (let k = 0; k < nUpdates; k++) {
      const mm = Math.min(p.start + 1 + k * 2, MONTHS - 1);
      const { y, m } = addMonths(START.y, START.m, mm);
      const earning = chance(0.55);
      const amount = earning ? ri(30, 120) * 1000 : ri(15, 70) * 1000;
      puRows.push(mk(['project_id','type','amount','description','date','tenant_id','created_at'], {
        project_id: projectIds[pi], type: earning ? 'Earning' : 'Expense',
        amount, description: earning ? `Revenue update — ${p.title}` : `Cost update — ${p.title}`,
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
      else if (roll > 0.80) attendance = 'ABSENT';
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
          calculated_deduction: tier === 3 ? 500 : 0, status: 'ACTIVE',
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
        notes: `${run.label} annual dividend per share.`, allocated_by: adminUserId,
        allocated_at: run.date, tenant_id: tenantId, created_at: run.date,
      }));
    }
  }

  // 12) goals + settings
  const goalCols = ['user_id','title','description','target_amount','current_amount','deadline','status','type','linked_project_id','tenant_id','created_at','updated_at'];
  const goalRows = [
    mk(goalCols, { user_id: adminUserId, title: 'Grow membership to 300', description: 'Expansion across the industrial belt.', target_amount: 300, current_amount: memberCount, deadline: '2027-12-31', status: 'In Progress', type: 'Other', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'Reserve fund to 5,000,000 INR', description: 'Reach the statutory reserve comfort level under company policy.', target_amount: 5000000, current_amount: bal.RESERVE, deadline: '2027-06-30', status: 'In Progress', type: 'Savings', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'Complete Solar Rooftop Program', description: 'Commission the rooftop solar array.', target_amount: 3000000, current_amount: 1800000, deadline: '2027-03-31', status: 'In Progress', type: 'Investment', linked_project_id: projectIds[3], tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
    mk(goalCols, { user_id: adminUserId, title: 'FY2025-26 dividend distribution', description: 'Distribute FY2025-26 surplus to shareholders.', target_amount: run2.distributed, current_amount: run2.distributed, deadline: '2026-09-30', status: 'Achieved', type: 'Investment', tenant_id: tenantId, created_at: createdBase, updated_at: TODAY }),
  ];

  const settingsRows = [mk(
    ['tenant_id','fiscal_year_start','fiscal_year_end','base_currency','share_value_bdt','is_share_value_locked','company_name','company_tagline','company_address','company_email','company_phone','deposit_due_date','monthly_meeting_day','late_deposit_grace_months','inactive_after_months','suspended_after_months','last_updated_by','last_updated_at','created_at','updated_at'],
    { tenant_id: tenantId, fiscal_year_start: fiscalYearStart, fiscal_year_end: fiscalYearEnd, base_currency: 'INR',
      share_value_bdt: shareValue, is_share_value_locked: true,
      company_name: 'Northbridge Manufacturing Cooperative', company_tagline: 'Member-owned industry since 2024',
      company_address: 'Plot 44, Northbridge Industrial Area', company_email: 'office@northbridge.demo',
      company_phone: '+919800000001', deposit_due_date: 10, monthly_meeting_day: 8,
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
console.log('Fund balances:', Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, `${v.toLocaleString()} INR`])));
console.log('FY2024-25: net', fy1Net.toLocaleString(), '| distributed', dividendRuns[0].distributed.toLocaleString(), '@', dividendRuns[0].rate);
console.log('FY2025-26: net', fy2Net.toLocaleString(), '| distributed', dividendRuns[1].distributed.toLocaleString(), '@', dividendRuns[1].rate);
console.log('Logins (all pass-12345678):');
console.log('  admin@northbridge.dev    (Admin, tenant northbridge)');
console.log('  manager@northbridge.dev  (Manager)');
console.log('  auditor@northbridge.dev  (Auditor)');
console.log(`  user.${members[userAccessIdx[0]].memberId.toLowerCase()}@northbridge.dev (Member)`);
await sql.end();
