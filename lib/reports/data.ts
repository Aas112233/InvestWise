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
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { fromCents, toCents } from "@/lib/money";
import { SETTLED_DEPOSIT_STATUSES } from "@/lib/ledger-selectors";
import { memberDisplayNameSql } from "@/lib/member-display";
import { ledgerRef } from "@/lib/doc-number";
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
import { translateLedgerDescription } from "@/lib/ledger-description";
import {
  getCategoryLabel,
  getFundTypeLabel,
  getHealthLabel,
  getPenaltyTypeLabel,
  getRoleLabel,
  getTransactionStatusLabel,
  getTransactionTypeLabel,
} from "@/lib/transaction-labels";

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
  /**
   * Authoritative totals for the `total: true` columns, computed over the
   * FULL filtered set — the table is capped at REPORT_MAX_ROWS, a totals row
   * that re-summed the listed rows would silently understate it (#103,
   * exporter edition). Exporters and the viewer render these, falling back
   * to summing the rows only when a builder did not provide them.
   */
  columnTotals?: Record<string, string>;
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
  /** Full-set totals for the `total` columns (see ReportData.columnTotals). */
  columnTotals?: Record<string, string>;
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
  /** Member's internal id (null for fund-only rows) — lets builders resolve per-member data. */
  memberId: string | null;
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
  // Member lifecycle state (active/suspended/…) — deliberately a separate key
  // from the transaction `status` so it is not run through the transaction
  // status mapper in buildReportDocument.
  memberStatus: { key: "memberStatus", labelKey: "reports.columns.status", type: "text" } as ReportColumn,
  expenseName: { key: "expenseName", labelKey: "reports.columns.expenseName", type: "text" } as ReportColumn,
  fundName: { key: "fundName", labelKey: "reports.columns.fundName", type: "text" } as ReportColumn,
  fundType: { key: "fundType", labelKey: "reports.columns.fundType", type: "text" } as ReportColumn,
  // No totals row: fund balances can sit in different currencies, and a
  // single grand total would add amounts the currency cannot mix.
  balance: { key: "balance", labelKey: "reports.columns.balance", type: "money" } as ReportColumn,
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
  waivedPenalties: "reports.summary.waivedPenalties",
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

/**
 * #103: a capped statement's summary must describe the whole period, not the
 * rows the table happened to list. Built from the same arrays
 * `classifyLedgerType` reads (inflow-and-not-outflow, settled only), so the SQL
 * aggregate cannot drift from the per-row classifier.
 */
function signedSumSql(side: "inflow" | "outflow") {
  const own = side === "inflow" ? INFLOW_TYPES : OUTFLOW_TYPES;
  const opposite = side === "inflow" ? OUTFLOW_TYPES : INFLOW_TYPES;
  const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
  return sql`coalesce(sum(case when ${transactions.type} in (${list(own)}) \
and ${transactions.type} not in (${list(opposite)}) \
and ${transactions.status} in (${list([...SETTLED_DEPOSIT_STATUSES])}) \
then ${transactions.amount}::numeric else 0::numeric end), 0)`;
}

async function fetchTransactionRows(opts: {
  tenantId: string;
  /** Active report locale — ledger narrations are localized at render time. */
  locale: ReportLocale;
  period?: ResolvedPeriod;
  /** Selected member ids; empty/absent = no per-member filter (whole book). */
  memberIds?: string[] | null;
  projectId?: string | null;
  fundId?: string | null;
  types?: string[];
  /**
   * Read member-by-member (A's block, then B's block) instead of interleaving
   * members chronologically — builders set this when the explicit member
   * scope covers more than one member (see shouldGroupByMember).
   */
  groupByMember?: boolean;
}): Promise<{
  rows: TxRow[];
  truncated: boolean;
  /** Net settled movements before the period, for the running-balance seed. */
  openingBalance: string;
  totals: { inflow: string; outflow: string; amount: string; rowCount: number };
}> {
  const db = getDb();
  const t = createServerT(opts.locale);
  const authorizer = aliasedTable(users, "report_authorizer");

  // Scope (tenant, soft-delete, member/project/fund/type) is shared by the
  // row query, the full-set totals and the opening-balance aggregate; the
  // period bounds apply to the rows and totals only.
  const scopeConditions = [
    eq(transactions.tenantId, opts.tenantId),
    eq(transactions.isDeleted, false),
  ];
  if (opts.memberIds && opts.memberIds.length > 0) {
    scopeConditions.push(inArray(transactions.memberId, opts.memberIds));
  }
  if (opts.projectId) scopeConditions.push(eq(transactions.projectId, opts.projectId));
  if (opts.fundId) scopeConditions.push(eq(transactions.fundId, opts.fundId));
  if (opts.types && opts.types.length > 0) {
    scopeConditions.push(inArray(transactions.type, opts.types));
  }
  const conditions = opts.period
    ? [...scopeConditions, gte(transactions.date, opts.period.start), lte(transactions.date, opts.period.end)]
    : scopeConditions;

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
      docNumber: transactions.docNumber,
      depositMonth: transactions.depositMonth,
      depositMethod: transactions.depositMethod,
       handlingOfficer: transactions.handlingOfficer,
       status: transactions.status,
       memberId: transactions.memberId,
       memberName: memberDisplayNameSql,
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
     .leftJoin(authorizer, and(eq(transactions.authorizedBy, authorizer.id), eq(authorizer.tenantId, opts.tenantId)))
    .where(and(...conditions))
    .orderBy(
      // Date-first order interleaves members' rows (A, B, A, B) when several
      // members are in scope — group by member instead, chronological order
      // is kept inside each member's block.
      ...(opts.groupByMember ? [asc(members.name)] : []),
      asc(transactions.date),
      asc(transactions.createdAt),
      asc(transactions.id),
    )
    .limit(REPORT_MAX_ROWS + 1);

  const truncated = fetched.length > REPORT_MAX_ROWS;
  const raw = truncated ? fetched.slice(0, REPORT_MAX_ROWS) : fetched;

  // Seed the running balance from the money that moved BEFORE the period —
  // a cumulative built from zero printed the period's NET movement under a
  // "Running Balance" / "Closing Balance" label.
  let openingCents = 0;
  if (opts.period) {
    const [opening] = await db
      .select({
        inflow: sql<string>`${signedSumSql("inflow")}::text`,
        outflow: sql<string>`${signedSumSql("outflow")}::text`,
      })
      .from(transactions)
      .where(and(...scopeConditions, lt(transactions.date, opts.period.start)));
    openingCents = decimalToCents(opening?.inflow) - decimalToCents(opening?.outflow);
  }
  let cumulativeCents = openingCents;
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
      // Every report column keyed "reference" across the ledger, deposits,
      // expenses, dividends and FY statements reads from this one line, so this
      // is where doc_number (DEP-2026-00042) replaced reference_number as the
      // printed reference. Blank fallback preserved on purpose: an empty cell in
      // a PDF/Excel export, not an em dash.
      reference: ledgerRef(r, ""),
      type: r.type,
      memberId: r.memberId,
      member: emptyToBlank(r.memberName),
      memberCode: emptyToBlank(r.memberCode),
      fund: emptyToBlank(r.fundName),
      project: emptyToBlank(r.projectTitle),
      category: r.category ?? "",
      expenseName: emptyToBlank(r.expenseName),
      // Stored narrations are canonical English; localize them for display so
      // the ledger reads in the viewer's language (Rule §9/§10).
      description: translateLedgerDescription(r.description, t),
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

  // One aggregate over the FULL filtered set (no joins, no limit): the table
  // may be capped, the money figures must not be (#103). `amount` sums every
  // listed-type row (including unsettled) — it is the full-set value of the
  // Amount column, so the exporter totals row can stop re-summing capped rows.
  const [totals] = await db
    .select({
      inflow: sql<string>`${signedSumSql("inflow")}::text`,
      outflow: sql<string>`${signedSumSql("outflow")}::text`,
      amount: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)::text`,
      rowCount: count(),
    })
    .from(transactions)
    .where(and(...conditions));

  return {
    rows,
    truncated,
    openingBalance: fromCents(openingCents),
    totals: {
      inflow: totals?.inflow ?? "0.00",
      outflow: totals?.outflow ?? "0.00",
      amount: totals?.amount ?? "0.00",
      rowCount: Number(totals?.rowCount ?? 0),
    },
  };
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

// Directory lookups exclude soft-deleted members (schema contract: the
// directory/dropdown reads filter isDeleted = false) — a deleted member is
// NOT a valid report target, so lookupEntityNames rejects the id and the
// route 400s. Historical ledger rows still resolve names via the unfiltered
// leftJoin, which is what should happen.
async function lookupMember(tenantId: string, memberId: string): Promise<{ name: string; code: string; shares: number } | null> {
  const db = getDb();
  const [row] = await db
    .select({ name: memberDisplayNameSql, code: members.memberId, shares: members.shares })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId), eq(members.isDeleted, false)))
    .limit(1);
  return row ? { name: row.name, code: row.code, shares: row.shares } : null;
}

/** Batched sibling of lookupMember — one query for a member scope list. */
async function lookupMembers(
  tenantId: string,
  memberIds: string[],
): Promise<Map<string, { name: string; code: string; shares: number }>> {
  const db = getDb();
  const rows = await db
    .select({ id: members.id, name: memberDisplayNameSql, code: members.memberId, shares: members.shares })
    .from(members)
    .where(and(inArray(members.id, memberIds), eq(members.tenantId, tenantId), eq(members.isDeleted, false)));
  return new Map(rows.map((r) => [r.id, { name: r.name, code: r.code, shares: r.shares }]));
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
 * Resolve scoped entity display names for the document summary. A missing
 * name for a provided id means the entity does not belong to the tenant
 * (Rule §6 — the route rejects the request). The member scope is a list:
 * the joined line is capped so a 40-member export does not bloat the header.
 */
export async function lookupEntityNames(
  tenantId: string,
  ids: { projectId: string | null; memberIds: string[] | null; fundId: string | null },
): Promise<{ projectName?: string; memberName?: string; fundName?: string }> {
  const project = ids.projectId ? await lookupProjectName(tenantId, ids.projectId) : null;
  let memberName: string | undefined;
  if (ids.memberIds && ids.memberIds.length > 0) {
    const found = await lookupMembers(tenantId, ids.memberIds);
    if (ids.memberIds.some((id) => !found.has(id))) {
      // Cross-tenant or unknown id — empty marker the route rejects.
      memberName = "";
    } else {
      const names = ids.memberIds.map((id) => {
        const m = found.get(id)!;
        return `${m.name} (${m.code})`;
      });
      // 3 names is the cap: this line sits in the summary strip, the PDF
      // header and an Excel merged cell — beyond that it stops reading.
      memberName = names.length > 3 ? `${names.slice(0, 3).join(", ")} (+${names.length - 3})` : names.join(", ");
    }
  }
  const fund = ids.fundId ? await lookupFund(tenantId, ids.fundId) : null;
  return {
    projectName: project ?? undefined,
    memberName,
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
  projectId: string | null;
  /** Selected member ids; null = no per-member filter (whole book or "All"). */
  memberIds: string[] | null;
  /** The user explicitly scoped members (an id list or the "All" sentinel). */
  memberScoped: boolean;
  fundId: string | null;
}

/**
 * An explicit member scope covering more than one member (2+ ids, or the
 * "all" sentinel) is read member-by-member; chronological order alone
 * interleaves members' rows. Single-member and member-unscoped reports
 * keep the plain chronological order.
 */
export function shouldGroupByMember(args: Pick<BuildArgs, "memberIds" | "memberScoped">): boolean {
  return args.memberScoped && !(args.memberIds && args.memberIds.length === 1);
}

function entitySummary(args: BuildArgs): ReportSummaryEntry[] {
  const entries: ReportSummaryEntry[] = [];
  if (args.projectId) entries.push({ labelKey: S.project, value: "(project)" });
  // Covers one / many / "all" — the value is swapped for the resolved member
  // line (joined names or the localized "All members") in buildReportDocument.
  if (args.memberScoped) entries.push({ labelKey: S.member, value: "(member)" });
  if (args.fundId) entries.push({ labelKey: S.fund, value: "(fund)" });
  return entries;
}

async function buildLedger(args: BuildArgs, types?: string[]): Promise<ReportData> {
  const { rows, truncated, openingBalance, totals } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    locale: args.ctx.locale,
    period: args.period,
    memberIds: args.memberIds,
    projectId: args.projectId,
    fundId: args.fundId,
    types,
    groupByMember: shouldGroupByMember(args),
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

  // #103: totals and closing balance come from the aggregate over the whole
  // period. Summing the listed rows silently understated a capped statement —
  // `meridian`'s FY2025 ledger has 7,505 rows against a 5,000-row cap, so the
  // signed "Closing Balance" was missing 2,505 movements. The closing balance
  // is OPENING + period net: a cumulative built from zero printed the period's
  // delta under a "balance" label.
  const totalOutflow = totals.outflow;
  const totalInflow = totals.inflow;
  const netCents = decimalToCents(totalInflow) - decimalToCents(totalOutflow);
  const closing = fromCents(decimalToCents(openingBalance) + netCents);

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
       { labelKey: S.rowCount, value: String(totals.rowCount) },
     ],
     truncated,
     // Debit/credit totals = the full-set aggregates (the settled
     // classification is exactly what the per-row debit/credit columns hold).
     columnTotals: { debit: totalOutflow, credit: totalInflow },
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

  // One liquidity total PER currency — funds can hold different base
  // currencies, and a single grand total would add BDT to USD.
  const centsByCurrency = new Map<string, number>();
  for (const r of data) {
    centsByCurrency.set(r.currency, (centsByCurrency.get(r.currency) ?? 0) + toCents(r.balance));
  }
  const liquidity = [...centsByCurrency.entries()].map(([currency, cents]) => ({
    labelKey: S.totalLiquidity,
    value: formatMoneyWithCurrency(fromCents(cents), currency),
  }));

  return {
    definition: args.definition,
    columns: [C.fundName, C.fundType, C.balance, C.currency, C.custodian, C.accountNumber, C.status],
    rows: data,
    summary: [{ labelKey: S.activeFunds, value: String(data.length) }, ...liquidity],
    truncated: false,
  };
}

async function buildMemberHistory(args: BuildArgs): Promise<ReportData> {
  const memberIds = args.memberIds ?? [];
  // A single member keeps the personal summary line (name + shares held);
  // a list or "all" falls back to the joined "(member)" placeholder, which
  // buildReportDocument resolves via lookupEntityNames.
  const firstId = memberIds.length === 1 ? memberIds[0] : undefined;
  const member = firstId ? await lookupMember(args.ctx.tenantId, firstId) : null;

  const { rows, truncated, totals } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    locale: args.ctx.locale,
    period: args.period,
    memberIds,
    types: ["Deposit"],
    groupByMember: shouldGroupByMember(args),
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
  if (member) {
    summary.push({ labelKey: S.member, value: `${member.name} (${member.code})` });
    summary.push({ labelKey: S.sharesHeld, value: String(member.shares) });
  } else if (args.memberScoped) {
    summary.push({ labelKey: S.member, value: "(member)" });
  }
  // #95's rule, second door: this report listed PENDING requests and REJECTED
  // slips and then summed `amount` over every listed row, so a member's
  // "Total Deposits" was more than the money they had actually paid in.
  summary.push({ labelKey: S.totalDeposits, value: totals.inflow });
  summary.push({ labelKey: S.rowCount, value: String(data.length) });

  return {
    definition: args.definition,
    columns: [C.date, C.depositMonth, C.reference, C.amount, C.depositMethod, C.fund, C.project, C.status],
    rows: data,
    summary,
    truncated,
    columnTotals: { amount: totals.amount },
  };
}

async function buildMemberContribution(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    locale: args.ctx.locale,
    period: args.period,
    memberIds: args.memberIds,
    types: ["Deposit"],
  });

  const byMember = new Map<string, { id: string | null; code: string; name: string; count: number; totalCents: number }>();
  for (const r of rows) {
    // #95's rule: an unsettled request is not a contribution.
    if (!(SETTLED_DEPOSIT_STATUSES as readonly string[]).includes(r.status ?? "")) continue;
    const key = r.memberCode || r.member;
    const entry = byMember.get(key) ?? { id: r.memberId, code: r.memberCode, name: r.member, count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += decimalToCents(r.amount);
    byMember.set(key, entry);
  }

  // Share positions come from the members table (batched, tenant-scoped) —
  // they were hard-coded 0 in the first cut of this report.
  const idsWithMembers = [...byMember.values()].map((m) => m.id).filter((id): id is string => Boolean(id));
  const sharesById = idsWithMembers.length > 0 ? await lookupMembers(args.ctx.tenantId, idsWithMembers) : new Map<string, { name: string; code: string; shares: number }>();

  const overallCents = [...byMember.values()].reduce((acc, m) => acc + m.totalCents, 0);
  const data = [...byMember.values()]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((m) => {
      const share = overallCents > 0 ? Number(((m.totalCents / overallCents) * 100).toFixed(2)) : 0;
      return {
        memberCode: m.code,
        member: m.name,
        shares: m.id ? (sharesById.get(m.id)?.shares ?? 0) : 0,
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
      ...(args.memberScoped ? [{ labelKey: S.member, value: "(member)" }] : []),
      { labelKey: S.totalContributions, value: fromCents(overallCents) },
      { labelKey: S.partners, value: String(data.length) },
    ],
    truncated,
  };
}

async function buildStakeholderStatement(args: BuildArgs): Promise<ReportData> {
  const db = getDb();
  const conditions = [
    eq(members.tenantId, args.ctx.tenantId),
    // §7: a stakeholder statement is a DIRECTORY read — soft-deleted members
    // are no longer stakeholders (historical ledgers still show their rows).
    eq(members.isDeleted, false),
  ];
  if (args.memberIds && args.memberIds.length > 0) conditions.push(inArray(members.id, args.memberIds));

  // limit+1 + flag, like every other capped read — a 5,400-member tenant
  // used to get a silently short statement with no cap note.
  const fetched = await db
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
    .limit(REPORT_MAX_ROWS + 1);

  const truncated = fetched.length > REPORT_MAX_ROWS;
  const rows = truncated ? fetched.slice(0, REPORT_MAX_ROWS) : fetched;

  const data = rows.map((m) => ({
    memberCode: m.code ?? "",
    member: m.name,
    email: m.email ?? "",
    phone: m.phone ?? "",
    role: m.role ?? "",
    shares: m.shares,
    totalContributed: m.totalContributed ?? "0.00",
    joinDate: m.joinDate ? new Date(m.joinDate).toISOString() : "",
    // Stored as `memberStatus` (not `status`) so buildReportDocument localizes
    // it via members.statusLabels instead of the transaction status mapper.
    memberStatus: m.status ?? "",
  }));

  return {
    definition: args.definition,
    columns: [C.memberCode, C.member, C.email, C.phone, C.role, C.shares, C.totalContributed, C.joinDate, C.memberStatus],
    rows: data,
    summary: [
      { labelKey: S.partners, value: String(data.length) },
      { labelKey: S.totalContributed, value: sumDecimal(data.map((r) => r.totalContributed)) },
    ],
    truncated,
    columnTotals: { totalContributed: sumDecimal(data.map((r) => r.totalContributed)) },
  };
}

async function buildPenaltiesAudit(args: BuildArgs): Promise<ReportData> {
  const db = getDb();
  const conditions = [eq(memberPenalties.tenantId, args.ctx.tenantId)];
  if (args.memberIds && args.memberIds.length > 0) conditions.push(inArray(memberPenalties.memberId, args.memberIds));
  conditions.push(gte(memberPenalties.issuedAt, args.period.start));
  conditions.push(lte(memberPenalties.issuedAt, args.period.end));

  const rows = await db
    .select({
      member: memberDisplayNameSql,
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
    .orderBy(
      // Multi-member scope: member blocks first (newest first inside each),
      // same readability rule as the ledgers.
      ...(shouldGroupByMember(args) ? [asc(members.name)] : []),
      desc(memberPenalties.issuedAt),
    )
    .limit(REPORT_MAX_ROWS + 1);

  const truncated = rows.length > REPORT_MAX_ROWS;
  const capped = truncated ? rows.slice(0, REPORT_MAX_ROWS) : rows;

  // Full-set (uncapped) deduction totals, split by status: a waived penalty
  // is audited history, not a live deduction — summing it into "Total Penalty
  // Deductions" overstated the money taken (same class of error as #95 for
  // unsettled transactions).
  const [deductionTotals] = await db
    .select({
      active: sql<string>`coalesce(sum(case when ${memberPenalties.status} = 'ACTIVE' then ${memberPenalties.calculatedDeduction}::numeric else 0::numeric end), 0)::text`,
      waived: sql<string>`coalesce(sum(case when ${memberPenalties.status} = 'WAIVED' then ${memberPenalties.calculatedDeduction}::numeric else 0::numeric end), 0)::text`,
    })
    .from(memberPenalties)
    .where(and(...conditions));

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

  // Single-member scope keeps the resolved name; a list or "all" uses the
  // joined "(member)" placeholder resolved in buildReportDocument.
  const penaltyMemberIds = args.memberIds ?? [];
  const firstId = penaltyMemberIds.length === 1 ? penaltyMemberIds[0] : undefined;
  const member = firstId ? await lookupMember(args.ctx.tenantId, firstId) : null;

  const summary: ReportSummaryEntry[] = [];
  if (member) summary.push({ labelKey: S.member, value: `${member.name} (${member.code})` });
  else if (args.memberScoped) summary.push({ labelKey: S.member, value: "(member)" });
  summary.push({ labelKey: S.totalPenalties, value: deductionTotals?.active ?? "0.00" });
  const waivedTotal = deductionTotals?.waived ?? "0.00";
  if (decimalToCents(waivedTotal) > 0) {
    summary.push({ labelKey: S.waivedPenalties, value: waivedTotal });
  }
  summary.push({ labelKey: S.rowCount, value: String(data.length) });

  return {
    definition: args.definition,
    columns: [C.issuedAt, C.member, C.memberCode, C.tier, C.penaltyTitle, C.penaltyType, C.deduction, C.status, C.reason, C.waivedAt, C.waiveReason],
    rows: data,
    summary,
    truncated,
    // The table lists every status; the totals row counts the active deductions.
    columnTotals: { deduction: deductionTotals?.active ?? "0.00" },
  };
}

/**
 * Shared fetch for the single-column "amount" reports. Returns the full-set
 * Amount total (`amountTotal`) so callers can put the uncapped figure in the
 * summary and the totals row instead of re-summing the capped rows.
 */
async function buildTypeLedger(
  args: BuildArgs,
  types: string[],
): Promise<{ rows: TxRow[]; truncated: boolean; amountTotal: string }> {
  const result = await fetchTransactionRows({
    tenantId: args.ctx.tenantId,
    locale: args.ctx.locale,
    period: args.period,
    memberIds: args.memberIds,
    projectId: args.projectId,
    fundId: args.fundId,
    types,
    groupByMember: shouldGroupByMember(args),
  });
  return { rows: result.rows, truncated: result.truncated, amountTotal: result.totals.amount };
}

async function buildRevenueAnalytics(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated, amountTotal } = await buildTypeLedger(args, ["Deposit", "Earning", "Interest"]);
  const data = rows.map((r) => ({
    date: r.dateIso, type: r.type, member: r.member, fund: r.fund,
    project: r.project, amount: r.amount, category: r.category, description: r.description,
  }));
  return {
    definition: args.definition,
    columns: [C.date, C.type, C.member, C.fund, C.project, C.amount, C.category, C.description],
    rows: data,
    summary: [
      { labelKey: S.totalRevenue, value: amountTotal },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
    columnTotals: { amount: amountTotal },
  };
}

async function buildSimpleTypeReport(args: BuildArgs, types: string[], summaryKey: string): Promise<ReportData> {
  const { rows, truncated, amountTotal } = await buildTypeLedger(args, types);
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
      { labelKey: summaryKey, value: amountTotal },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
    columnTotals: { amount: amountTotal },
  };
}

async function buildExpenseAudit(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated, amountTotal } = await buildTypeLedger(args, ["Expense"]);
  const data = rows.map((r) => ({
    date: r.dateIso, expenseName: r.expenseName, category: r.category, member: r.member,
    fund: r.fund, project: r.project, amount: r.amount, handlingOfficer: r.handlingOfficer,
    authorizedBy: r.authorizedBy, status: r.status, description: r.description,
  }));
  const summary: ReportSummaryEntry[] = [
    ...(args.projectId ? [{ labelKey: S.project, value: "(project)" }] : []),
    { labelKey: args.projectId ? S.totalProjectExpenses : S.totalExpenses, value: amountTotal },
    { labelKey: S.rowCount, value: String(data.length) },
  ];
  return {
    definition: args.definition,
    columns: [C.date, C.expenseName, C.category, C.member, C.fund, C.project, C.amount, C.handlingOfficer, C.authorizedBy, C.status, C.description],
    rows: data,
    summary,
    truncated,
    columnTotals: { amount: amountTotal },
  };
}

async function buildDisbursements(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated, amountTotal } = await buildTypeLedger(args, ["Project Investment", "Investment"]);
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
      { labelKey: S.totalDisbursements, value: amountTotal },
      { labelKey: S.rowCount, value: String(data.length) },
    ],
    truncated,
    columnTotals: { amount: amountTotal },
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
  // Same cap discipline as every other report read: limit+1, honest flag.
  const fetched =
    orderBy === "roi"
      ? await query.orderBy(desc(projects.expectedRoi)).limit(REPORT_MAX_ROWS + 1)
      : await query.orderBy(asc(projects.title)).limit(REPORT_MAX_ROWS + 1);
  const truncated = fetched.length > REPORT_MAX_ROWS;
  return { rows: truncated ? fetched.slice(0, REPORT_MAX_ROWS) : fetched, truncated };
}

async function buildProjectPerformance(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await fetchProjects(args, "title");
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
    truncated,
  };
}

function formatIso(value: string | Date | null): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

async function buildRoiAnalysis(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await fetchProjects(args, "roi");
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
    truncated,
  };
}

async function buildVentureGrowth(args: BuildArgs): Promise<ReportData> {
  const { rows, truncated } = await fetchProjects(args, "title");
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
    truncated,
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
  ids: { projectId: string | null; memberIds: string[] | null; memberScoped: boolean; fundId: string | null },
): Promise<ReportData> {
  const definition = getReportDefinition(slug);
  if (!definition) {
    throw new Error(`Unknown report type: ${slug}`);
  }
  const builder = BUILDERS[slug];
  if (!builder) {
    throw new Error(`Report type not implemented: ${slug}`);
  }
  return builder({ definition, ctx, period, ...ids });
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
  // The truncation note is NOT a summary entry: it renders as the viewer's
  // amber alert and the file footers' dedicated line — a second (empty-value)
  // summary row used to print it twice in Excel/PDF.

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
    rows: data.rows.map((r) => {
      const out: Record<string, string | number | null> = { ...r };
      // Raw DB enum values are canonical English; localize them the same way
      // the transactions screen does (Rule §9/§10) so the exported files and
      // the in-app viewer read in the active locale. Unknown values pass
      // through verbatim — they are stored data, not UI copy.
      if (typeof out.type === "string" && out.type) out.type = getTransactionTypeLabel(out.type, t);
      if (typeof out.status === "string" && out.status) out.status = getTransactionStatusLabel(out.status, t);
      // The remaining enum-like columns: categories, fund types, member roles,
      // project health and penalty kinds are all stored as canonical English.
      if (typeof out.category === "string" && out.category) out.category = getCategoryLabel(out.category, t);
      if (typeof out.fundType === "string" && out.fundType) out.fundType = getFundTypeLabel(out.fundType, t);
      if (typeof out.role === "string" && out.role) out.role = getRoleLabel(out.role, t);
      if (typeof out.health === "string" && out.health) out.health = getHealthLabel(out.health, t);
      if (typeof out.penaltyType === "string" && out.penaltyType)
        out.penaltyType = getPenaltyTypeLabel(out.penaltyType, t);
      // Member lifecycle state (stakeholder statement): the members module's
      // own status labels, not the transaction status mapper. Unknown values
      // (a new lifecycle state added later) pass through verbatim.
      if (typeof out.memberStatus === "string" && out.memberStatus) {
        const key = `members.statusLabels.${out.memberStatus}`;
        const translated = t(key);
        out.memberStatus = translated === key ? out.memberStatus : translated;
      }
      // Empty completion date = project still running — localized label.
      if (out.completionDate === "") out.completionDate = t("reports.columns.ongoing");
      return out;
    }),
    totalsLabel: t("reports.summary.total"),
    columnTotals: data.columnTotals,
    truncated: data.truncated,
    truncatedNote: t("reports.summary.truncatedNote", { max: REPORT_MAX_ROWS.toLocaleString("en-US") }),
    footerNote: t("reports.summary.confidential"),
    fileBase: `${definition.slug}_${now.toISOString().slice(0, 10)}`,
  };
}
