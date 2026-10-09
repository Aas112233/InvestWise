/**
 * Report data layer (server-only). Every query is tenant-scoped (Rule §6),
 * excludes soft-deleted transactions, and applies the resolved fiscal period
 * to transactional reports. All money summation runs through integer cents
 * from lib/money (Rule §12) — decimal(15,2) strings never touch float math.
 */
import { getDb } from "@/db/index";
import {
  transactions,
  members,
  projects,
  funds,
  users,
  memberPenalties,
} from "@/db/schema/index";
import { aliasedTable, and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { fromCents } from "@/lib/money";
import { SETTLED_DEPOSIT_STATUSES } from "@/lib/ledger-selectors";
import {
  getReportDefinition,
  REPORT_MAX_ROWS,
  type FiscalCalendar,
  type ReportColumn,
  type ReportDefinition,
  type ReportLocale,
  type ReportPeriodParams,
  type ResolvedPeriod,
} from "./catalog";
import { resolveFiscalBounds } from "@/lib/fiscal-periods";
import {
  createServerT,
  decimalToCents,
  formatMoneyWithCurrency,
  formatUtcDate,
  monthKeyLabel,
  sumDecimal,
  type ServerT,
} from "./format";

export interface ReportRequestContext {
  tenantId: string;
  locale: ReportLocale;
  /** Tenant base currency code, e.g. `BDT`. */
  currency: string;
  /** Tenant display date pattern, e.g. `DD/MM/YYYY`. */
  dateFormat: string;
  /** Display name of the requesting user (goes into the document header). */
  generatedBy: string;
  /** Tenant fiscal calendar for Quarterly/Yearly ranges and labels. */
  fiscal: FiscalCalendar;
}

export interface ReportLetterhead {
  name: string;
  tagline?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ReportSummaryEntry {
  labelKey: string;
  value: string;
}

export interface ReportData {
  definition: ReportDefinition;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  summary: ReportSummaryEntry[];
  truncated: boolean;
}

export interface ReportDocument {
  slug: string;
  title: string;
  locale: ReportLocale;
  currency: string;
  /** Tenant display pattern for date cells, e.g. `DD/MM/YYYY`. */
  dateFormat: string;
  letterhead: ReportLetterhead;
  /** Localized period line, e.g. "Period: October 2026" / "As of: 05/10/2026". */
  periodLine: string;
  generatedAt: string;
  generatedBy: string;
  generatedByLabel: string;
  summary: Array<{ label: string; value: string }>;
  columns: Array<{ key: string; label: string; type: ReportColumn["type"]; total?: boolean }>;
  rows: Record<string, string | number | null>[];
  /** Localized "Total" label for the table totals row. */
  totalsLabel: string;
  truncated: boolean;
  truncatedNote: string;
  footerNote: string;
  /** Filename without extension, e.g. `member-history_2026-10-05`. */
  fileBase: string;
}

// Ledger classification (matches the finance modules' cash-movement types).
const INFLOW_TYPES = [
  "Deposit",
  "Earning",
  "Interest",
  "Capital-Injection",
  "Transfer In",
  "Investment",
  "Project Investment",
  // #97: a dividend run moves this much cash INTO the reserve fund and posts
  // this row against it. Left unclassified, the reserve fund's own statement
  // showed less money than the fund held, by exactly every reserve ever swept.
  // It is written only by `app/api/dividends/distribute/route.ts`, always
  // against the reserve fund, so it is never a tenant-wide inflow of new money
  // (the matching `Transfer Out` on the payout fund nets it back to zero).
  "Statutory Reserve",
];
const OUTFLOW_TYPES = ["Expense", "Withdrawal", "Dividend", "Transfer Out"];

/**
 * #62: classify a transaction type into its debit/credit columns.
 *
 * Only a real inflow is a credit and only a real outflow is a debit. A type in
 * BOTH lists, or in NEITHER (an internal transfer, a dividend distribution
 * aggregate, a REJECTED/PENDING slip that slipped past the status filter), must
 * be classified as 0/0 rather than silently defaulting to the credit side —
 * which is what the previous `isInflow || !isOutflow` expression did.
 *
 * Exported for unit testing (the DB-coupled caller is not otherwise reachable).
 */
export function classifyLedgerType(type: string): { debit: number; credit: number } {
  const isInflow = INFLOW_TYPES.includes(type);
  const isOutflow = OUTFLOW_TYPES.includes(type);
  return {
    debit: isOutflow && !isInflow ? 1 : 0,
    credit: isInflow && !isOutflow ? 1 : 0,
  };
}

interface TxRow {
  dateIso: string;
  depositMonth: string;
  reference: string;
  type: string;
  member: string;
  memberCode: string;
  fund: string;
  project: string;
  category: string;
  expenseName: string;
  description: string;
  depositMethod: string;
  amount: string;
  debit: string;
  credit: string;
  runningBalance: string;
  handlingOfficer: string;
  authorizedBy: string;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────
// Shared column definitions (labels resolved per locale at render time)
// ─────────────────────────────────────────────────────────────────────

const C = {
  date: { key: "date", labelKey: "reports.columns.date", type: "date" } as ReportColumn,
  depositMonth: { key: "depositMonth", labelKey: "reports.columns.depositMonth", type: "text" } as ReportColumn,
  reference: { key: "reference", labelKey: "reports.columns.reference", type: "text" } as ReportColumn,
  type: { key: "type", labelKey: "reports.columns.type", type: "text" } as ReportColumn,
  member: { key: "member", labelKey: "reports.columns.member", type: "text" } as ReportColumn,
  memberCode: { key: "memberCode", labelKey: "reports.columns.memberCode", type: "text" } as ReportColumn,
  email: { key: "email", labelKey: "reports.columns.email", type: "text" } as ReportColumn,
  phone: { key: "phone", labelKey: "reports.columns.phone", type: "text" } as ReportColumn,
  role: { key: "role", labelKey: "reports.columns.role", type: "text" } as ReportColumn,
  shares: { key: "shares", labelKey: "reports.columns.shares", type: "number" } as ReportColumn,
  totalContributed: { key: "totalContributed", labelKey: "reports.columns.totalContributed", type: "money", total: true } as ReportColumn,
  joinDate: { key: "joinDate", labelKey: "reports.columns.joinDate", type: "date" } as ReportColumn,
  fund: { key: "fund", labelKey: "reports.columns.fund", type: "text" } as ReportColumn,
  project: { key: "project", labelKey: "reports.columns.project", type: "text" } as ReportColumn,
  category: { key: "category", labelKey: "reports.columns.category", type: "text" } as ReportColumn,
  description: { key: "description", labelKey: "reports.columns.description", type: "text" } as ReportColumn,
  depositMethod: { key: "depositMethod", labelKey: "reports.columns.depositMethod", type: "text" } as ReportColumn,
  amount: { key: "amount", labelKey: "reports.columns.amount", type: "money", total: true } as ReportColumn,
  debit: { key: "debit", labelKey: "reports.columns.debit", type: "money", total: true } as ReportColumn,
  credit: { key: "credit", labelKey: "reports.columns.credit", type: "money", total: true } as ReportColumn,
  runningBalance: { key: "runningBalance", labelKey: "reports.columns.runningBalance", type: "money" } as ReportColumn,
  handlingOfficer: { key: "handlingOfficer", labelKey: "reports.columns.handlingOfficer", type: "text" } as ReportColumn,
  authorizedBy: { key: "authorizedBy", labelKey: "reports.columns.authorizedBy", type: "text" } as ReportColumn,
  status: { key: "status", labelKey: "reports.columns.status", type: "text" } as ReportColumn,
  expenseName: { key: "expenseName", labelKey: "reports.columns.expenseName", type: "text" } as ReportColumn,
  fundName: { key: "fundName", labelKey: "reports.columns.fundName", type: "text" } as ReportColumn,
  fundType: { key: "fundType", labelKey: "reports.columns.fundType", type: "text" } as ReportColumn,
  balance: { key: "balance", labelKey: "reports.columns.balance", type: "money", total: true } as ReportColumn,
  currency: { key: "currency", labelKey: "reports.columns.currency", type: "text" } as ReportColumn,
  custodian: { key: "custodian", labelKey: "reports.columns.custodian", type: "text" } as ReportColumn,
  accountNumber: { key: "accountNumber", labelKey: "reports.columns.accountNumber", type: "text" } as ReportColumn,
  depositsCount: { key: "depositsCount", labelKey: "reports.columns.depositsCount", type: "number" } as ReportColumn,
  totalDeposited: { key: "totalDeposited", labelKey: "reports.columns.totalDeposited", type: "money", total: true } as ReportColumn,
  contributionShare: { key: "contributionShare", labelKey: "reports.columns.contributionShare", type: "number" } as ReportColumn,
  tier: { key: "tier", labelKey: "reports.columns.tier", type: "number" } as ReportColumn,
  penaltyTitle: { key: "penaltyTitle", labelKey: "reports.columns.penaltyTitle", type: "text" } as ReportColumn,
  penaltyType: { key: "penaltyType", labelKey: "reports.columns.penaltyType", type: "text" } as ReportColumn,
  deduction: { key: "deduction", labelKey: "reports.columns.deduction", type: "money", total: true } as ReportColumn,
  issuedAt: { key: "issuedAt", labelKey: "reports.columns.issuedAt", type: "date" } as ReportColumn,
  waivedAt: { key: "waivedAt", labelKey: "reports.columns.waivedAt", type: "date" } as ReportColumn,
  reason: { key: "reason", labelKey: "reports.columns.reason", type: "text" } as ReportColumn,
  waiveReason: { key: "waiveReason", labelKey: "reports.columns.waiveReason", type: "text" } as ReportColumn,
  projectName: { key: "projectName", labelKey: "reports.columns.projectName", type: "text" } as ReportColumn,
  health: { key: "health", labelKey: "reports.columns.health", type: "text" } as ReportColumn,
  initialInvestment: { key: "initialInvestment", labelKey: "reports.columns.initialInvestment", type: "money" } as ReportColumn,
  budget: { key: "budget", labelKey: "reports.columns.budget", type: "money" } as ReportColumn,
  totalEarnings: { key: "totalEarnings", labelKey: "reports.columns.totalEarnings", type: "money", total: true } as ReportColumn,
  totalExpenses: { key: "totalExpenses", labelKey: "reports.columns.totalExpenses", type: "money", total: true } as ReportColumn,
  netProfit: { key: "netProfit", labelKey: "reports.columns.netProfit", type: "money" } as ReportColumn,
  netPosition: { key: "netPosition", labelKey: "reports.columns.netPosition", type: "money" } as ReportColumn,
  fundBalance: { key: "fundBalance", labelKey: "reports.columns.fundBalance", type: "money" } as ReportColumn,
  expectedRoi: { key: "expectedRoi", labelKey: "reports.columns.expectedRoi", type: "number" } as ReportColumn,
  actualRoi: { key: "actualRoi", labelKey: "reports.columns.actualRoi", type: "number" } as ReportColumn,
  variance: { key: "variance", labelKey: "reports.columns.variance", type: "number" } as ReportColumn,
  growthPercentage: { key: "growthPercentage", labelKey: "reports.columns.growthPercentage", type: "number" } as ReportColumn,
  totalShares: { key: "totalShares", labelKey: "reports.columns.totalShares", type: "number" } as ReportColumn,
  startDate: { key: "startDate", labelKey: "reports.columns.startDate", type: "date" } as ReportColumn,
  completionDate: { key: "completionDate", labelKey: "reports.columns.completionDate", type: "date" } as ReportColumn,
};

const S = {
  period: "reports.summary.period",
  asOf: "reports.summary.asOf",
  project: "reports.summary.project",
  member: "reports.summary.member",
  fund: "reports.summary.fund",
  totalInflow: "reports.summary.totalInflow",
  totalOutflow: "reports.summary.totalOutflow",
  netCashFlow: "reports.summary.netCashFlow",
  closingBalance: "reports.summary.closingBalance",
  totalDeposits: "reports.summary.totalDeposits",
  totalContributions: "reports.summary.totalContributions",
  totalRevenue: "reports.summary.totalRevenue",
  totalEarnings: "reports.summary.totalEarnings",
  totalInterest: "reports.summary.totalInterest",
  totalDividends: "reports.summary.totalDividends",
  totalExpenses: "reports.summary.totalExpenses",
  totalProjectExpenses: "reports.summary.totalProjectExpenses",
  totalDisbursements: "reports.summary.totalDisbursements",
  totalPenalties: "reports.summary.totalPenalties",
  totalLiquidity: "reports.summary.totalLiquidity",
  activeFunds: "reports.summary.activeFunds",
  partners: "reports.summary.partners",
  projects: "reports.summary.projects",
  sharesHeld: "reports.summary.sharesHeld",
  totalContributed: "reports.summary.totalContributed",
  rowCount: "reports.summary.rowCount",
};

function emptyToBlank(value: string | null | undefined): string {
  return value ?? "";
}

// ─────────────────────────────────────────────────────────────────────
// Core transaction fetch — tenant-scoped joins, chronological, capped
// ─────────────────────────────────────────────────────────────────────

async function fetchTransactionRows(opts: {
  tenantId: string;
  period?: ResolvedPeriod;
  memberId?: string | null;
  projectId?: string | null;
  fundId?: string | null;
  types?: string[];
}): Promise<{ rows: TxRow[]; truncated: boolean }> {
  const db = getDb();
  const authorizer = aliasedTable(users, "report_authorizer");

  const conditions = [
    eq(transactions.tenantId, opts.tenantId),
    eq(transactions.isDeleted, false),
  ];
  if (opts.period) {
    conditions.push(gte(transactions.date, opts.period.start));
    conditions.push(lte(transactions.date, opts.period.end));
  }
  if (opts.memberId) conditions.push(eq(transactions.memberId, opts.memberId));
  if (opts.projectId) conditions.push(eq(transactions.projectId, opts.projectId));
  if (opts.fundId) conditions.push(eq(transactions.fundId, opts.fundId));
  if (opts.types && opts.types.length > 0) {
    conditions.push(inArray(transactions.type, opts.types));
  }

  const fetched = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      category: transactions.category,
      expenseName: transactions.expenseName,
      description: transactions.description,
      referenceNumber: transactions.referenceNumber,
      depositMonth: transactions.depositMonth,
      depositMethod: transactions.depositMethod,
      handlingOfficer: transactions.handlingOfficer,
      status: transactions.status,
      balanceAfter: transactions.balanceAfter,
      memberName: members.name,
      memberCode: members.memberId,
      fundName: funds.name,
      projectTitle: projects.title,
      authorizedByName: authorizer.name,
    })
    .from(transactions)
    // §6: joined entities must belong to the same tenant — joining on id
    // alone would render another tenant's member/fund/project names.
    .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, opts.tenantId)))
    .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, opts.tenantId)))
    .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, opts.tenantId)))
    .leftJoin(authorizer, eq(transactions.authorizedBy, authorizer.id))
    .where(and(...conditions))
    .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))
    .limit(REPORT_MAX_ROWS + 1);

  const truncated = fetched.length > REPORT_MAX_ROWS;
  const raw = truncated ? fetched.slice(0, REPORT_MAX_ROWS) : fetched;

  let cumulativeCents = 0;
  const rows: TxRow[] = raw.map((r) => {
    const amountCents = decimalToCents(r.amount);
    // #95: an unsettled row (PENDING request, REJECTED slip) is part of the
    // audit trail and stays listed, but it is not money — booking it as a
    // credit made the statement's closing balance exceed the treasury by
    // exactly the rejected amount.
    const settled = (SETTLED_DEPOSIT_STATUSES as readonly string[]).includes(r.status ?? "");
    // #62: explicit debit/credit classification — see classifyLedgerType.
    const { debit: isDebit, credit: isCredit } = classifyLedgerType(r.type);
    const debitCents = settled && isDebit ? amountCents : 0;
    const creditCents = settled && isCredit ? amountCents : 0;
    cumulativeCents += creditCents - debitCents;

    return {
      dateIso: r.date ? new Date(r.date).toISOString() : "",
      depositMonth: r.depositMonth ?? "",
      reference: r.referenceNumber ?? "",
      type: r.type,
      member: emptyToBlank(r.memberName),
      memberCode: emptyToBlank(r.memberCode),
      fund: emptyToBlank(r.fundName),
      project: emptyToBlank(r.projectTitle),
      category: r.category ?? "",
      expenseName: emptyToBlank(r.expenseName),
      description: r.description ?? "",
      depositMethod: r.depositMethod ?? "",
      amount: fromCents(amountCents),
      debit: fromCents(debitCents),
      credit: fromCents(creditCents),
      runningBalance: fromCents(cumulativeCents),
      handlingOfficer: r.handlingOfficer ?? "",
      authorizedBy: r.authorizedByName ?? r.handlingOfficer ?? "",
      status: r.status ?? "",
    };
  });

  return { rows, truncated };
}

// ─────────────────────────────────────────────────────────────────────
// Entity helpers — cross-tenant ids rejected (Rule §6)
// ─────────────────────────────────────────────────────────────────────

async function lookupProjectName(tenantId: string, projectId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return row?.title ?? null;
}

async function lookupMember(tenantId: string, memberId: string): Promise<{ name: string; code: string; shares: number } | null> {
  const db = getDb();
  const [row] = await db
    .select({ name: members.name, code: members.memberId, shares: members.shares })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);
  return row ? { name: row.name, code: row.code, shares: row.shares } : null;
}

async function lookupFund(tenantId: string, fundId: string): Promise<{ name: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ name: funds.name })
    .from(funds)
    .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
    .limit(1);
  return row ? { name: row.name } : null;
}

/**
 * Resolve scoped entity display names for the document summary. A null
 * result for a provided id means the entity does not belong to the tenant
 * (Rule §6 — the route rejects the request).
 */
export async function lookupEntityNames(
  tenantId: string,
  ids: { projectId: string | null; memberId: string | null; fundId: string | null },
): Promise<{ projectName?: string; memberName?: string; fundName?: string }> {
  const project = ids.projectId ? await lookupProjectName(tenantId, ids.projectId) : null;
  const member = ids.memberId ? await lookupMember(tenantId, ids.memberId) : null;
  const fund = ids.fundId ? await lookupFund(tenantId, ids.fundId) : null;
  return {
    projectName: project ?? undefined,
    memberName: member ? `${member.name} (${member.code})` : undefined,
    fundName: fund?.name ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Report builders
// ─────────────────────────────────────────────────────────────────────

interface BuildArgs {
  definition: ReportDefinition;
  ctx: ReportRequestContext;
  period: ResolvedPeriod;
  periodParams: ReportPeriodParams;
  projectId: string | null;
  memberId: string | null;
  fundId: string | null;
}

function entitySummary(args: BuildArgs): ReportSummaryEntry[] {
  const entries: ReportSummaryEntry[] = [];
  if (args.projectId) entries.push({ labelKey: S.project, value: "(project)" });
  if (args.memberId) entries.push({ labelKey: S.member, value: "(member)" });
  if (args.fundId) entries.push({ labelKey: S.fund, value: "(fund)" });
  return entries;
}

async function buildLedger(args: BuildArgs, types?: string[]): Promise<ReportData> {
  const { rows, truncated } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    period: args.period,
    memberId: args.memberId,
    projectId: args.projectId,
    fundId: args.fundId,
    types,
  });

  const columns: ReportColumn[] = [
    C.date, C.depositMonth, C.reference, C.type, C.member, C.fund, C.project,
    C.category, C.description, C.debit, C.credit, C.runningBalance, C.status,
  ];

  const ledgerRows = rows.map((r) => ({
    date: r.dateIso,
    depositMonth: r.depositMonth,
    reference: r.reference,
    type: r.type,
    member: r.member,
    fund: r.fund,
    project: r.project,
    category: r.category,
    description: r.description,
    debit: r.debit,
    credit: r.credit,
    runningBalance: r.runningBalance,
    status: r.status,
  }));

  const totalOutflow = sumDecimal(ledgerRows.map((r) => r.debit));
  const totalInflow = sumDecimal(ledgerRows.map((r) => r.credit));
  const netCents = decimalToCents(totalInflow) - decimalToCents(totalOutflow);
  const closing = ledgerRows.length > 0 ? (ledgerRows[ledgerRows.length - 1]?.runningBalance ?? "0.00") : "0.00";

  return {
    definition: args.definition,
    columns,
    rows: ledgerRows,
    summary: [
      ...entitySummary(args),
      { labelKey: S.totalInflow, value: formatMoneyWithCurrency(totalInflow, args.ctx.currency) },
      { labelKey: S.totalOutflow, value: formatMoneyWithCurrency(totalOutflow, args.ctx.currency) },
      { labelKey: S.netCashFlow, value: formatMoneyWithCurrency(fromCents(netCents), args.ctx.currency) },
      { labelKey: S.closingBalance, value: formatMoneyWithCurrency(closing, args.ctx.currency) },
      { labelKey: S.rowCount, value: String(ledgerRows.length) },
    ],
    truncated,
  };
}

async function buildFundsSummary(args: BuildArgs): Promise<ReportData> {
  const db = getDb();
  const rows = await db
    .select({
      name: funds.name,
      type: funds.type,
      balance: funds.balance,
      currency: funds.currency,
      handlingOfficer: funds.handlingOfficer,
      accountNumber: funds.accountNumber,
      status: funds.status,
    })
    .from(funds)
    .where(and(eq(funds.tenantId, args.ctx.tenantId), eq(funds.status, "ACTIVE")))
    .orderBy(asc(funds.name));

  const data = rows.map((f) => ({
    fundName: f.name,
    fundType: f.type ?? "",
    balance: f.balance ?? "0.00",
    currency: f.currency || args.ctx.currency,
    custodian: f.handlingOfficer ?? "",
    accountNumber: f.accountNumber ?? "",
    status: f.status ?? "",
  }));

  return {
    definition: args.definition,
    columns: [C.fundName, C.fundType, C.balance, C.currency, C.custodian, C.accountNumber, C.status],
    rows: data,
    summary: [
      { labelKey: S.activeFunds, value: String(data.length) },
      { labelKey: S.totalLiquidity, value: sumDecimal(data.map((r) => r.balance)) },
    ],
    truncated: false,
  };
}

async function buildMemberHistory(args: BuildArgs): Promise<ReportData> {
  const memberId = args.memberId as string;
  const member = await lookupMember(args.ctx.tenantId, memberId);

  const { rows, truncated } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    period: args.period,
    memberId,
    types: ["Deposit"],
  });

  const data = rows.map((r) => ({
    date: r.dateIso,
    depositMonth: r.depositMonth,
    reference: r.reference,
    amount: r.amount,
    depositMethod: r.depositMethod,
    fund: r.fund,
    project: r.project,
    status: r.status,
  }));

  const summary: ReportSummaryEntry[] = [];
  if (member) summary.push({ labelKey: S.member, value: `${member.name} (${member.code})` });
  if (member) summary.push({ labelKey: S.sharesHeld, value: String(member.shares) });
  summary.push({ labelKey: S.totalDeposits, value: sumDecimal(data.map((r) => r.amount)) });
  summary.push({ labelKey: S.rowCount, value: String(data.length) });

  return {
    definition: args.definition,
    columns: [C.date, C.depositMonth, C.reference, C.amount, C.depositMethod, C.fund, C.project, C.status],
    rows: data,
    summary,
    truncated,
  };
}

async function buildMemberContribution(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    period: args.period,
    memberId: args.memberId,
    types: ["Deposit"],
  });

  const byMember = new Map<string, { code: string; name: string; shares: number; count: number; totalCents: number }>();
  for (const r of rows) {
    const key = r.memberCode || r.member;
    const entry = byMember.get(key) ?? { code: r.memberCode, name: r.member, shares: 0, count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += decimalToCents(r.amount);
    byMember.set(key, entry);
  }

  const overallCents = [...byMember.values()].reduce((acc, m) => acc + m.totalCents, 0);
  const data = [...byMember.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((m) => {
      const share = overallCents > 0 ? Number(((m.totalCents / overallCents) * 100).toFixed(2)) : 0;
      return {
        memberCode: m.code,
        member: m.name,
        shares: m.shares,
        depositsCount: m.count,
        totalDeposited: fromCents(m.totalCents),
        contributionShare: share,
      };
    });

  return {
    definition: args.definition,
    columns: [C.memberCode, C.member, C.shares, C.depositsCount, C.totalDeposited, C.contributionShare],
    rows: data,
    summary: [
      ...(args.memberId ? [{ labelKey: S.member, value: "(member)" }] : []),
      { labelKey: S.totalContributions, value: fromCents(overallCents) },
      { labelKey: S.partners, value: String(data.length) },
    ],
    truncated,
  };
}

async function buildStakeholderStatement(args: BuildArgs): Promise<ReportData> {
  const db = getDb();
  const conditions = [eq(members.tenantId, args.ctx.tenantId)];
  if (args.memberId) conditions.push(eq(members.id, args.memberId));

  const rows = await db
    .select({
      code: members.memberId,
      name: members.name,
      email: members.email,
      phone: members.phone,
      role: members.role,
      shares: members.shares,
      totalContributed: members.totalContributed,
      joinDate: members.joinDate,
      status: members.status,
    })
    .from(members)
    .where(and(...conditions))
    .orderBy(asc(members.name))
    .limit(REPORT_MAX_ROWS);

  const data = rows.map((m) => ({
    memberCode: m.code ?? "",
    member: m.name,
    email: m.email ?? "",
    phone: m.phone ?? "",
    role: m.role ?? "",
    shares: m.shares,
    totalContributed: m.totalContributed ?? "0.00",
    joinDate: m.joinDate ? new Date(m.joinDate).toISOString() : "",
    status: m.status ?? "",
  }));

  return {
    definition: args.definition,
    columns: [C.memberCode, C.member, C.email, C.phone, C.role, C.shares, C.totalContributed, C.joinDate, C.status],
    rows: data,
    summary: [
      { labelKey: S.partners, value: String(data.length) },
      { labelKey: S.totalContributed, value: sumDecimal(data.map((r) => r.totalContributed)) },
    ],
    truncated: false,
  };
}

async function buildPenaltiesAudit(args: BuildArgs): Promise<ReportData> {
  const db = getDb();
  const conditions = [eq(memberPenalties.tenantId, args.ctx.tenantId)];
  if (args.memberId) conditions.push(eq(memberPenalties.memberId, args.memberId));
  conditions.push(gte(memberPenalties.issuedAt, args.period.start));
  conditions.push(lte(memberPenalties.issuedAt, args.period.end));

  const rows = await db
    .select({
      member: members.name,
      memberCode: members.memberId,
      tier: memberPenalties.tier,
      title: memberPenalties.title,
      type: memberPenalties.type,
      deduction: memberPenalties.calculatedDeduction,
      status: memberPenalties.status,
      reason: memberPenalties.reason,
      issuedAt: memberPenalties.issuedAt,
      waivedAt: memberPenalties.waivedAt,
      waiveReason: memberPenalties.waiveReason,
    })
    .from(memberPenalties)
    .leftJoin(members, and(eq(memberPenalties.memberId, members.id), eq(members.tenantId, args.ctx.tenantId)))
    .where(and(...conditions))
    .orderBy(desc(memberPenalties.issuedAt))
    .limit(REPORT_MAX_ROWS + 1);

  const truncated = rows.length > REPORT_MAX_ROWS;
  const capped = truncated ? rows.slice(0, REPORT_MAX_ROWS) : rows;

  const data = capped.map((p) => ({
    issuedAt: p.issuedAt ? new Date(p.issuedAt).toISOString() : "",
    member: p.member ?? "",
    memberCode: p.memberCode ?? "",
    tier: p.tier,
    penaltyTitle: p.title,
    penaltyType: p.type,
    deduction: p.deduction ?? "0.00",
    status: p.status ?? "",
    reason: p.reason ?? "",
    waivedAt: p.waivedAt ? new Date(p.waivedAt).toISOString() : "",
    waiveReason: p.waiveReason ?? "",
  }));

  const member = args.memberId ? await lookupMember(args.ctx.tenantId, args.memberId) : null;

  const summary: ReportSummaryEntry[] = [];
  if (member) summary.push({ labelKey: S.member, value: `${member.name} (${member.code})` });
  summary.push({ labelKey: S.totalPenalties, value: sumDecimal(data.map((r) => r.deduction)) });
  summary.push({ labelKey: S.rowCount, value: String(data.length) });

  return {
    definition: args.definition,
    columns: [C.issuedAt, C.member, C.memberCode, C.tier, C.penaltyTitle, C.penaltyType, C.deduction, C.status, C.reason, C.waivedAt, C.waiveReason],
    rows: data,
    summary,
    truncated,
  };
}

async function buildTypeLedger(args: BuildArgs, types: string[]): Promise<{ rows: TxRow[]; truncated: boolean }> {
  return fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    period: args.period,
    memberId: args.memberId,
    projectId: args.projectId,
    fundId: args.fundId,
    types,
  });
}

async function buildRevenueAnalytics(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await buildTypeLedger(args, ["Deposit", "Earning", "Interest"]);
  const data = rows.map((r) => ({
    date: r.dateIso, type: r.type, member: r.member, fund: r.fund,
    project: r.project, amount: r.amount, category: r.category, description: r.description,
  }));
  return {
    definition: args.definition,
    columns: [C.date, C.type, C.member, C.fund, C.project, C.amount, C.category, C.description],
    rows: data,
    summary: [
      { labelKey: S.totalRevenue, value: sumDecimal(data.map((r) => r.amount)) },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
  };
}

async function buildSimpleTypeReport(args: BuildArgs, types: string[], summaryKey: string): Promise<ReportData> {
  const { rows, truncated } = await buildTypeLedger(args, types);
  const data = rows.map((r) => ({
    date: r.dateIso, type: r.type, member: r.member, memberCode: r.memberCode, fund: r.fund,
    project: r.project, amount: r.amount, reference: r.reference, category: r.category,
    description: r.description, status: r.status,
  }));
  return {
    definition: args.definition,
    columns: [C.date, C.type, C.member, C.memberCode, C.fund, C.project, C.amount, C.reference, C.description, C.status],
    rows: data,
    summary: [
      { labelKey: summaryKey, value: sumDecimal(data.map((r) => r.amount)) },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
  };
}

async function buildExpenseAudit(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await buildTypeLedger(args, ["Expense"]);
  const data = rows.map((r) => ({
    date: r.dateIso, expenseName: r.expenseName, category: r.category, member: r.member,
    fund: r.fund, project: r.project, amount: r.amount, handlingOfficer: r.handlingOfficer,
    authorizedBy: r.authorizedBy, status: r.status, description: r.description,
  }));
  const summary: ReportSummaryEntry[] = [
    ...(args.projectId ? [{ labelKey: S.project, value: "(project)" }] : []),
    { labelKey: args.projectId ? S.totalProjectExpenses : S.totalExpenses, value: sumDecimal(data.map((r) => r.amount)) },
    { labelKey: S.rowCount, value: String(data.length) },
  ];
  return {
    definition: args.definition,
    columns: [C.date, C.expenseName, C.category, C.member, C.fund, C.project, C.amount, C.handlingOfficer, C.authorizedBy, C.status, C.description],
    rows: data,
    summary,
    truncated,
  };
}

async function buildDisbursements(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await buildTypeLedger(args, ["Project Investment", "Investment"]);
  const data = rows.map((r) => ({
    date: r.dateIso, reference: r.reference, member: r.member, project: r.project,
    fund: r.fund, amount: r.amount, category: r.category, status: r.status, description: r.description,
  }));
  return {
    definition: args.definition,
    columns: [C.date, C.reference, C.member, C.project, C.fund, C.amount, C.category, C.status, C.description],
    rows: data,
    summary: [
      ...(args.projectId ? [{ labelKey: S.project, value: "(project)" }] : []),
      { labelKey: S.totalDisbursements, value: sumDecimal(data.map((r) => r.amount)) },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
  };
}

async function fetchProjects(args: BuildArgs, orderBy: "title" | "roi") {
  const db = getDb();
  const query = db
    .select({
      title: projects.title,
      category: projects.category,
      status: projects.status,
      health: projects.health,
      initialInvestment: projects.initialInvestment,
      budget: projects.budget,
      totalEarnings: projects.totalEarnings,
      totalExpenses: projects.totalExpenses,
      currentFundBalance: projects.currentFundBalance,
      expectedRoi: projects.expectedRoi,
      totalShares: projects.totalShares,
      startDate: projects.startDate,
      completionDate: projects.completionDate,
    })
    .from(projects)
    .where(eq(projects.tenantId, args.ctx.tenantId));
  if (orderBy === "roi") {
    return query.orderBy(desc(projects.expectedRoi)).limit(500);
  }
  return query.orderBy(asc(projects.title)).limit(500);
}

async function buildProjectPerformance(args: BuildArgs): Promise<ReportData> {
  const rows = await fetchProjects(args, "title");
  const data = rows.map((p) => {
    const earningsCents = decimalToCents(p.totalEarnings);
    const expensesCents = decimalToCents(p.totalExpenses);
    return {
      projectName: p.title,
      category: p.category,
      status: p.status,
      health: p.health,
      initialInvestment: p.initialInvestment ?? "0.00",
      budget: p.budget ?? "0.00",
      totalEarnings: fromCents(earningsCents),
      totalExpenses: fromCents(expensesCents),
      netProfit: fromCents(earningsCents - expensesCents),
      fundBalance: p.currentFundBalance ?? "0.00",
      expectedRoi: Number(Number(p.expectedRoi ?? 0).toFixed(2)),
      startDate: p.startDate ? formatIso(p.startDate) : "",
      completionDate: p.completionDate ? formatIso(p.completionDate) : "",
    };
  });
  return {
    definition: args.definition,
    columns: [C.projectName, C.category, C.status, C.health, C.initialInvestment, C.budget, C.totalEarnings, C.totalExpenses, C.netProfit, C.fundBalance, C.expectedRoi, C.startDate, C.completionDate],
    rows: data,
    summary: [
      { labelKey: S.projects, value: String(data.length) },
      { labelKey: S.totalEarnings, value: sumDecimal(data.map((r) => r.totalEarnings)) },
      { labelKey: S.totalExpenses, value: sumDecimal(data.map((r) => r.totalExpenses)) },
    ],
    truncated: false,
  };
}

function formatIso(value: string | Date | null): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

async function buildRoiAnalysis(args: BuildArgs): Promise<ReportData> {
  const rows = await fetchProjects(args, "roi");
  const data = rows.map((p) => {
    const earningsCents = decimalToCents(p.totalEarnings);
    const expensesCents = decimalToCents(p.totalExpenses);
    const netProfitCents = earningsCents - expensesCents;
    const investmentCents = decimalToCents(p.initialInvestment);
    // Ratio (not money) — float is acceptable here; guarded against /0.
    const actualRoi = investmentCents > 0 ? Number(((netProfitCents / investmentCents) * 100).toFixed(2)) : null;
    const expectedRoi = Number(Number(p.expectedRoi ?? 0).toFixed(2));
    return {
      projectName: p.title,
      category: p.category,
      initialInvestment: p.initialInvestment ?? "0.00",
      totalEarnings: fromCents(earningsCents),
      totalExpenses: fromCents(expensesCents),
      netProfit: fromCents(netProfitCents),
      expectedRoi,
      actualRoi,
      variance: actualRoi !== null ? Number((expectedRoi - actualRoi).toFixed(2)) : null,
      status: p.status,
    };
  });
  return {
    definition: args.definition,
    columns: [C.projectName, C.category, C.initialInvestment, C.totalEarnings, C.totalExpenses, C.netProfit, C.expectedRoi, C.actualRoi, C.variance, C.status],
    rows: data,
    summary: [{ labelKey: S.projects, value: String(data.length) }],
    truncated: false,
  };
}

async function buildVentureGrowth(args: BuildArgs): Promise<ReportData> {
  const rows = await fetchProjects(args, "title");
  const data = rows.map((p) => {
    const earningsCents = decimalToCents(p.totalEarnings);
    const expensesCents = decimalToCents(p.totalExpenses);
    const investmentCents = decimalToCents(p.initialInvestment);
    const balanceCents = decimalToCents(p.currentFundBalance);
    const growth = investmentCents > 0
      ? Number((((balanceCents - investmentCents) / investmentCents) * 100).toFixed(2))
      : null;
    return {
      projectName: p.title,
      category: p.category,
      status: p.status,
      initialInvestment: p.initialInvestment ?? "0.00",
      fundBalance: fromCents(balanceCents),
      totalEarnings: fromCents(earningsCents),
      totalExpenses: fromCents(expensesCents),
      netPosition: fromCents(earningsCents - expensesCents),
      growthPercentage: growth,
      totalShares: p.totalShares ?? 0,
      expectedRoi: Number(Number(p.expectedRoi ?? 0).toFixed(2)),
      startDate: p.startDate ? formatIso(p.startDate) : "",
      completionDate: p.completionDate ? formatIso(p.completionDate) : "",
    };
  });
  return {
    definition: args.definition,
    columns: [C.projectName, C.category, C.status, C.initialInvestment, C.fundBalance, C.totalEarnings, C.totalExpenses, C.netPosition, C.growthPercentage, C.totalShares, C.expectedRoi, C.startDate, C.completionDate],
    rows: data,
    summary: [
      { labelKey: S.projects, value: String(data.length) },
      { labelKey: S.totalEarnings, value: sumDecimal(data.map((r) => r.totalEarnings)) },
    ],
    truncated: false,
  };
}

const BUILDERS: Record<string, (args: BuildArgs) => Promise<ReportData>> = {
  "comprehensive-ledger": (a) => buildLedger(a),
  "project-ledger": (a) => buildLedger(a),
  "member-ledger": (a) => buildLedger(a),
  "fund-ledger": (a) => buildLedger(a),
  "funds-summary": buildFundsSummary,
  "member-history": buildMemberHistory,
  "member-contribution": buildMemberContribution,
  "stakeholder-statement": buildStakeholderStatement,
  "penalties-audit": buildPenaltiesAudit,
  "revenue-analytics": buildRevenueAnalytics,
  "earnings-ledger": (a) => buildSimpleTypeReport(a, ["Earning"], S.totalEarnings),
  "interest-accruals": (a) => buildSimpleTypeReport(a, ["Interest"], S.totalInterest),
  "dividend-report": (a) => buildSimpleTypeReport(a, ["Dividend"], S.totalDividends),
  "expense-audit": buildExpenseAudit,
  "project-expense-audit": buildExpenseAudit,
  "disbursements": buildDisbursements,
  "project-performance": buildProjectPerformance,
  "roi-analysis": buildRoiAnalysis,
  "venture-growth": buildVentureGrowth,
};

export async function fetchReportData(
  slug: string,
  ctx: ReportRequestContext,
  period: ResolvedPeriod,
  periodParams: ReportPeriodParams,
  ids: { projectId: string | null; memberId: string | null; fundId: string | null },
): Promise<ReportData> {
  const definition = getReportDefinition(slug);
  if (!definition) {
    throw new Error(`Unknown report type: ${slug}`);
  }
  const builder = BUILDERS[slug];
  if (!builder) {
    throw new Error(`Report type not implemented: ${slug}`);
  }
  return builder({ definition, ctx, period, periodParams, ...ids });
}

// ─────────────────────────────────────────────────────────────────────
// Document assembly — localizes everything a builder needs (Rule §9/§10)
// ─────────────────────────────────────────────────────────────────────

function periodLabel(
  t: ServerT,
  params: ReportPeriodParams,
  dateFormat: string,
  pointInTime: boolean,
  fiscal: FiscalCalendar,
): string {
  if (pointInTime) {
    return `${t("reports.summary.asOf")}: ${formatUtcDate(new Date(), dateFormat)}`;
  }
  const prefix = `${t("reports.summary.period")}: `;
  const periodType = params.periodType || "Monthly";

  if (periodType === "Monthly") {
    const now = new Date();
    const monthKey = params.fiscalMonth || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return prefix + monthKeyLabel(monthKey, t);
  }
  if (periodType === "Quarterly") {
    const quarter = (params.fiscalQuarter || "Q1").toLowerCase();
    const year = params.fiscalYear || String(new Date().getUTCFullYear());
    const bounds = resolveFiscalBounds(Number(year), fiscal.startMonth, fiscal.endMonth);
    return `${prefix}${t(`reports.quarters.${quarter}`)} ${bounds.label}`;
  }
  if (periodType === "Yearly") {
    const year = params.fiscalYear || String(new Date().getUTCFullYear());
    const bounds = resolveFiscalBounds(Number(year), fiscal.startMonth, fiscal.endMonth);
    return `${prefix}${bounds.label} (${formatUtcDate(bounds.periodStart, dateFormat)} – ${formatUtcDate(bounds.periodEnd, dateFormat)})`;
  }
  const start = params.startDate ? formatUtcDate(params.startDate, dateFormat) : "";
  const end = params.endDate ? formatUtcDate(params.endDate, dateFormat) : "";
  return `${prefix}${start} – ${end}`;
}

export function buildReportDocument(
  data: ReportData,
  ctx: ReportRequestContext,
  periodParams: ReportPeriodParams,
  entityNames: { projectName?: string | null; memberName?: string | null; fundName?: string | null },
  letterhead: ReportLetterhead,
): ReportDocument {
  const t = createServerT(ctx.locale);
  const definition = data.definition;
  const now = new Date();

  // Replace summary placeholders with resolved entity names / currency values.
  const summary = data.summary.map((entry) => {
    let value = entry.value;
    if (value === "(project)") value = entityNames.projectName ?? "";
    if (value === "(member)") value = entityNames.memberName ?? "";
    if (value === "(fund)") value = entityNames.fundName ?? "";
    if (/^-?\d+\.\d{2}$/.test(value)) value = formatMoneyWithCurrency(value, ctx.currency);
    return { label: t(entry.labelKey), value };
  });
  if (data.truncated) {
    summary.push({ label: t("reports.summary.truncatedNote"), value: "" });
  }

  return {
    slug: definition.slug,
    title: t(definition.nameKey),
    locale: ctx.locale,
    currency: ctx.currency,
    dateFormat: ctx.dateFormat,
    letterhead,
    periodLine: periodLabel(t, periodParams, ctx.dateFormat, definition.pointInTime === true, ctx.fiscal),
    generatedAt: formatUtcDate(now, `${ctx.dateFormat} HH:mm`),
    generatedBy: ctx.generatedBy,
    generatedByLabel: t("reports.summary.generatedBy"),
    summary,
    columns: data.columns.map((c) => ({
      key: c.key,
      label: t(c.labelKey) + (c.type === "money" ? ` (${ctx.currency})` : ""),
      type: c.type,
      total: c.total === true,
    })),
    rows: data.rows.map((r) =>
      // Empty completion date = project still running — localized label.
      r.completionDate === "" ? { ...r, completionDate: t("reports.columns.ongoing") } : r,
    ),
    totalsLabel: t("reports.summary.total"),
    truncated: data.truncated,
    truncatedNote: t("reports.summary.truncatedNote"),
    footerNote: t("reports.summary.confidential"),
    fileBase: `${definition.slug}_${now.toISOString().slice(0, 10)}`,
  };
}
