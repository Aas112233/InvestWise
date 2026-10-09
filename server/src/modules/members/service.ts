import { eq, and, ilike, or, sql, desc, asc, type SQL, type SQLWrapper } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import { members, transactions, profitAllocations, fiscalPeriods } from '../../db/schema/index';
import { getPaginationParams, formatPaginatedResponse } from '../../middleware/api';
import { AppError } from '../../shared/errors';
import { canViewMemberPII, maskMemberPII, canViewMemberReviewData, maskMemberReviewData } from '@/lib/member-privacy';

/** Member directory — paginated list with contributed totals + masking. */

/**
 * Columns the table may sort on. Derived keys (`totalDeposited`,
 * `expectedDividend`) are resolved to their ledger expressions at query time,
 * so sorting always orders by what the row actually displays rather than by a
 * stale stored approximation of it.
 */
const SORTABLE_COLUMNS: Record<string, unknown> = {
  name: members.name,
  memberId: members.memberId,
  email: members.email,
  shares: members.shares,
  totalContributed: members.totalContributed,
  status: members.status,
  createdAt: members.createdAt,
};

const MEMBER_FIELDS = {
  id: members.id,
  memberId: members.memberId,
  name: members.name,
  email: members.email,
  phone: members.phone,
  role: members.role,
  shares: members.shares,
  totalContributed: members.totalContributed,
  status: members.status,
  avatar: members.avatar,
  joinDate: members.joinDate,
  totalArrears: members.totalArrears,
  // Governance review data — the directory's Warnings column renders this.
  // It was missing from the select, so every row displayed 0 regardless of
  // what the governance sweep had recorded (a silently lying table column).
  warningCount: members.warningCount,
  performanceScore: members.performanceScore,
  hasUserAccess: members.hasUserAccess,
  userId: members.userId,
  nomineeName: members.nomineeName,
  nomineeRelation: members.nomineeRelation,
  nomineePhone: members.nomineePhone,
  nomineeNidOrPassport: members.nomineeNidOrPassport,
  createdAt: members.createdAt,
};

/**
 * Per-member deposits-only total, summed from the ledger.
 *
 * Deliberately NOT `members.totalContributed`: that column is member *equity*
 * (dividend payouts are added to it on distribution), so presenting it as
 * "total contributed" overstates what the member actually deposited. The SUM is
 * exact numeric math on the DB side — no JS float anywhere near the money
 * (§12). Both predicates are required: the row set must stay inside the
 * member's own tenant even though the outer query is already scoped (§6).
 *
 * The outer reference is written with LITERAL quoted identifiers, not
 * interpolated Drizzle table objects. Drizzle de-qualifies a `sql` fragment's
 * column refs when the table object is also the query's FROM target — it emits
 * `"member_id" = "id"` / `"tenant_id" = "tenant_id"`, and inside the subquery's
 * scope those bare names bind to `transactions` (the inner table), making the
 * predicate a tautology. The result was a silently-zero column for every row.
 * Quoting `"members"."id"` by hand keeps the correlation pointing at the
 * member row. (Verified: the per-member total now reconciles to the ledger.)
 */
const totalDepositedExpr: SQL = sql`ROUND(COALESCE((
  SELECT SUM(t.amount::numeric)
  FROM transactions t
  WHERE t.member_id = "members"."id"
    AND t.tenant_id = "members"."tenant_id"
    AND t.type = 'Deposit'
    AND t.status IN ('Completed', 'Success')
    AND t.is_deleted = false
), 0), 2)`;

/**
 * Latest month a completed deposit is FOR — stored deposit_month first,
 * collected-date month only for legacy rows without one. Uses the same literal
 * outer-reference technique as `totalDepositedExpr` (see above).
 */
const lastDepositMonthExpr = sql<string>`(
  SELECT MAX(COALESCE(t.deposit_month, TO_CHAR(t.date AT TIME ZONE 'UTC', 'YYYY-MM')))
  FROM transactions t
  WHERE t.member_id = "members"."id"
    AND t.tenant_id = "members"."tenant_id"
    AND t.type = 'Deposit'
    AND t.status IN ('Completed', 'Success')
    AND t.is_deleted = false
)`;

/**
 * Declared run rate: the per-share rate of the most recent CLOSED fiscal
 * period belonging to this tenant's members. There is no forward-looking
 * dividend rate in the schema, so the directory projects the last declared
 * rate rather than inventing one — and returns null (rendered as an explicit
 * "no dividend declared yet") until the first dividend run exists.
 *
 * Tenancy is asserted through the member link because this module's schema
 * copy of `fiscal_periods`/`profit_allocations` carries no `tenantId` column
 * (it has drifted from the root schema). Scoping via a typed FK is both
 * correct and honest about that drift (§6).
 */
async function latestDeclaredRate(
  db: ReturnType<typeof getDb>,
  tenantId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ rate: profitAllocations.ratePerShare })
    .from(profitAllocations)
    .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, profitAllocations.fiscalPeriodId))
    .innerJoin(members, eq(members.id, profitAllocations.memberId))
    .where(and(eq(members.tenantId, tenantId), eq(fiscalPeriods.status, 'CLOSED')))
    .orderBy(desc(fiscalPeriods.periodEnd), desc(profitAllocations.allocatedAt))
    .limit(1);
  return row?.rate ?? null;
}

/** shares × declared run rate, rounded to money precision on the DB side. */
const expectedDividendExpr = (rate: string): SQL =>
  sql`ROUND(${members.shares}::numeric * ${rate}::numeric, 2)`;

export async function listMembers(
  params: { page?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string; status?: string; role?: string; withTotals?: string },
  userRole?: string,
  userId?: string,
  tenantId?: string | null,
) {
  const db = getDb();
  const { page, limit, skip, sortBy, sortOrder } = getPaginationParams(params as Record<string, string | undefined>, {
    sortBy: 'createdAt',
    sortOrder: 'desc',
    maxLimit: 500, // dropdown feeds fetch up to 500 members
  });

  // Fail-closed tenant scope (AGENTS.md §6). Every business query is
  // tenant-scoped; a missing tenantId is a programming error, never a
  // silent cross-tenant read. Platform operators reach the admin console
  // instead (requireTenant throws 403 before we get here).
  if (!tenantId) {
    throw new AppError('Tenant context required', 403, 'TENANT_REQUIRED');
  }

  // Soft-deleted members are excluded from the directory and every dropdown
  // feed (they share this list). Their ledger/penalty rows survive for audit.
  const conditions: (SQLWrapper | undefined)[] = [eq(members.tenantId, tenantId), eq(members.isDeleted, false)];

  if (params.search) {
    // Escape LIKE wildcards so user input like "50%" matches literally.
    const pattern = `%${params.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(or(ilike(members.name, pattern), ilike(members.email, pattern), ilike(members.memberId, pattern)));
  }
  if (params.status) conditions.push(eq(members.status, params.status));
  if (params.role) conditions.push(eq(members.role, params.role));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Aggregate columns cost a correlated subquery per row, so they are opt-in:
  // only the directory asks for them. The dropdown feed (limit 500, every
  // member form in the app) stays on the cheap path. Sorting by a derived
  // column forces the expression on, whether or not the caller asked for it.
  const withTotals = params.withTotals === '1' || params.withTotals === 'true';
  const derivedSort = sortBy === 'totalDeposited' || sortBy === 'expectedDividend';
  const aggregates = withTotals || derivedSort;

  const rate = aggregates ? await latestDeclaredRate(db, tenantId) : null;
  const expectedDividend: SQL = rate !== null ? expectedDividendExpr(rate) : sql`NULL`;

  // Derived columns sort by their ledger expression; everything else by its
  // stored column. NULL is emitted (not a subquery) when aggregates are off,
  // so the response shape stays stable for callers.
  const sortTarget: SQLWrapper =
    (sortBy === 'totalDeposited'
      ? totalDepositedExpr
      : sortBy === 'expectedDividend'
        ? expectedDividend
        : (SORTABLE_COLUMNS[sortBy] as SQL | undefined)) ?? members.createdAt;
  const orderBy = sortOrder === 'asc' ? asc(sortTarget) : desc(sortTarget);

  const rows = await db
    .select({
      ...MEMBER_FIELDS,
      totalCount: sql<number>`COUNT(*) OVER()`,
      // Directory rows carry this so the UI can disable Delete for members
      // with financial history (the DELETE route enforces the same rule).
      // EXISTS over the memberId-leading index — a probe per row, even at
      // the 500-row dropdown cap. The outer reference is a literal quoted
      // identifier for the same de-qualification reason as
      // `totalDepositedExpr` above (interpolating `${members.id}` emitted a
      // bare `"id"` that bound to the inner `t` table, so this always
      // returned false).
      hasTransactions: sql<boolean>`EXISTS (SELECT 1 FROM transactions t WHERE t.member_id = "members"."id")`,
      // Stored member equity (deposits + reinvested dividends). Kept for the
      // detail sheet; the directory's "Total Contributed" uses the derived
      // deposits-only total below.
      totalDeposits: sql<string>`COALESCE(${members.totalContributed}, '0.00')`,
      totalDeposited: (aggregates ? totalDepositedExpr : sql`NULL`) as SQL<string | null>,
      // Derived, and it replaces the stored `members.lastDepositMonth` in the
      // response: one month field, and it can never disagree with the deposit
      // total next to it. The stored column is written on deposit approval and
      // lags after a ledger correction or reversal.
      lastDepositMonth: (aggregates ? lastDepositMonthExpr : sql`NULL`) as SQL<string | null>,
      expectedDividend: expectedDividend as SQL<string | null>,
    })
    .from(members)
    .where(whereClause)
    .orderBy(orderBy)
    .limit(limit)
    .offset(skip);

  const totalCount = rows.length > 0 ? Number(rows[0]?.totalCount ?? 0) : 0;

  // PII policy shared with GET /api/members/[id] (lib/member-privacy.ts):
  // Admin/Manager see everything; a member sees their own record; everyone
  // else (incl. Auditor) gets the masked shape. Review metrics (warnings,
  // performance) are Admin/Manager-only on top of that — the directory hides
  // the column, and now the payload does too.
  const canReview = canViewMemberReviewData(userRole);
  const data = rows.map(({ totalCount: _totalCount, ...rest }) =>
    maskMemberReviewData(maskMemberPII(rest, canViewMemberPII(userRole, rest.userId, userId)), canReview),
  );

  return formatPaginatedResponse(data, page, limit, totalCount);
}
