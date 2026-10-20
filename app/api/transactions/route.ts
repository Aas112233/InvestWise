import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users, systemSettings } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { normalizePaymentMethods, isAllowedDepositMethod } from '@/lib/payment-methods';
import { eq, and, desc, sql, ilike, gte, lte, count, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents, parsePositiveAmount } from '@/lib/money';
import { endOfRangeUtc } from '@/lib/formatters';
import { inflowSqlPredicate, outflowSqlPredicate } from '@/lib/ledger-selectors';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';

// §12: single source of truth for the inflow/outflow classification — the GET
// aggregates and the POST balance direction must never disagree. A type in
// neither list cannot be signed, so the POST rejects it instead of posting a
// ledger row with no balance trail.
const INFLOW_TYPES = ['Deposit', 'Earning', 'Transfer In', 'Investment'];
const OUTFLOW_TYPES = ['Expense', 'Dividend', 'Disbursement', 'Transfer Out', 'Withdrawal'];

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: the ledger is tenant business data — null tenant must
    // 403 instead of aggregating every tenant's inflow/outflow.
    const scopedTenantId = requireTenant(tenantId, user);

    const { searchParams } = new URL(request.url);
    // Clamp pagination at the boundary: an unbounded `limit` lets an
    // authenticated caller force a full-tenant scan across three LEFT JOINs
    // plus count/SUM aggregates, and a large `page` produces a huge OFFSET.
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
    const skip = (page - 1) * limit;

    const type = searchParams.get('type');
    const fundId = searchParams.get('fundId');
    const projectId = searchParams.get('projectId');
    const memberId = searchParams.get('memberId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';
    const hasProject = searchParams.get('hasProject') === 'true';

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Filter out soft-deleted by default
    if (!includeDeleted) {
      conditions.push(sql`${transactions.isDeleted} = false`);
    }

    // Unconditional tenant predicate — scopedTenantId already 403s on null.
    conditions.push(sql`${transactions.tenantId} = ${scopedTenantId}`);
    if (type && type !== 'All') {
      // A fund transfer is posted as a paired `Transfer Out` / `Transfer In`
      // row; the screen's "Fund Transfer" filter value is the aggregate label,
      // not a stored type, so it must match both legs instead of exact-matching
      // a type that never exists (it returned an empty ledger).
      if (type === 'Transfer') {
        conditions.push(inArray(transactions.type, ['Transfer In', 'Transfer Out']));
      } else {
        conditions.push(sql`${transactions.type} = ${type}`);
      }
    }
    if (fundId) {
      conditions.push(sql`${transactions.fundId} = ${fundId}`);
    }
    if (projectId) {
      conditions.push(sql`${transactions.projectId} = ${projectId}`);
    } else if (hasProject) {
      conditions.push(sql`${transactions.projectId} IS NOT NULL`);
    }
    if (memberId) {
      conditions.push(sql`${transactions.memberId} = ${memberId}`);
    }
    if (status) {
      conditions.push(sql`${transactions.status} = ${status}`);
    }
    if (startDate) {
      conditions.push(gte(transactions.date, new Date(startDate)));
    }
    if (endDate) {
      // Date-only end is inclusive of the whole day (see endOfRangeUtc).
      conditions.push(lte(transactions.date, endOfRangeUtc(endDate)));
    }
    if (search) {
      const term = search.trim();
      if (term) {
        // Full transaction id → exact PK lookup (index scan, no fuzzy matching).
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (UUID_RE.test(term)) {
          conditions.push(sql`${transactions.id} = ${term}`);
        } else {
          // Reference # / partial id / description / member-name contains-search.
          // All arms are served by pg_trgm GIN indexes (idx_trans_ref_trgm,
          // idx_trans_desc_trgm, idx_trans_id_text_trgm, idx_members_name_trgm)
          // — no seq scan. Member name is matched via a correlated EXISTS, not a
          // bare members.name reference: this same whereClause also runs on the
          // count/inflow/outflow aggregates, which do NOT join members. A direct
          // `"members"."name"` there fails with Postgres 42P01 (missing FROM-
          // clause entry) and 500s every non-UUID search. EXISTS is join-agnostic
          // and still asserts tenancy through the member link (§6).
          const like = `%${term}%`;
          conditions.push(sql`(
            ${transactions.referenceNumber} ILIKE ${like}
            OR ${transactions.description} ILIKE ${like}
            OR ${transactions.id}::text ILIKE ${like}
            OR EXISTS (
              SELECT 1 FROM ${members}
              WHERE ${members.id} = ${transactions.memberId}
                AND ${members.tenantId} = ${scopedTenantId}
                AND ${members.name} ILIKE ${like}
            )
          )`);
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Aggregate queries for inflow & outflow.
    //
    // The flow KPIs are computed against `whereClause + flowScope`, NOT the bare
    // whereClause: the table filter is user-driven (a fund, a month, a search
    // term) while the KPI must always mean the same thing. Adding the scope here
    // is what stops a PENDING/REJECTED deposit or an internal `Transfer In` from
    // being counted as member money (report issues 27 / 47).
    const flowScope = and(whereClause, sql`${inflowSqlPredicate()} OR ${outflowSqlPredicate()}`);
    const [totalRes, sumRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(whereClause),
      db
        .select({
          // ::numeric (never ::float): the sum is exact decimal(15,2) in
          // Postgres; drizzle returns it as a string and we convert below in
          // integer cents (§12).
          //
          // `Transfer In`/`Transfer Out` are deliberately absent — they move
          // money between the tenant's own funds, so including them inflated
          // both sides of an internal movement. `Deposit` additionally requires
          // a settled status: an unsettled request is not collected cash.
          inflow: sql<string>`coalesce(sum(case when ${inflowSqlPredicate()} then ${transactions.amount}::numeric else 0 end), 0)::numeric`,
          outflow: sql<string>`coalesce(sum(case when ${outflowSqlPredicate()} then ${transactions.amount}::numeric else 0 end), 0)::numeric`,
        })
        .from(transactions)
        .where(flowScope),
      db
        .select({
          id: transactions.id,
          referenceNumber: transactions.referenceNumber,
          transferGroupId: transactions.transferGroupId,
          date: transactions.date,
          type: transactions.type,
          category: transactions.category,
          amount: transactions.amount,
          status: transactions.status,
          description: transactions.description,
          memberId: transactions.memberId,
          memberName: memberDisplayNameSql,
          memberCode: members.memberId,
          fundId: transactions.fundId,
          fundName: funds.name,
          projectId: transactions.projectId,
          projectName: projects.title,
          handlingOfficer: transactions.handlingOfficer,
          depositMethod: transactions.depositMethod,
          authorizedBy: transactions.authorizedBy,
          isDeleted: transactions.isDeleted,
          deletionReason: transactions.deletionReason,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        // §6: joined entities must belong to the same tenant — joining on id
        // alone would render another tenant's member/fund/project names.
        .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, scopedTenantId)))
        .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, scopedTenantId)))
        .leftJoin(projects, and(eq(transactions.projectId, projects.id), eq(projects.tenantId, scopedTenantId)))
        .where(whereClause)
        // Newest first, with a deterministic tiebreaker so rows sharing a date
        // never shuffle between requests/pages (report issue 17: the ledger
        // looked "insertion-ordered" because same-day rows had no defined
        // order and Postgres was free to return them however it liked).
        .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;
    // Convert the exact numeric string in integer cents, then surface cents/100
    // as a number — the dashboard client (app/transactions/page.tsx,
    // components/transactions, components/dividends) types these as numbers.
    // This is 2dp-safe: the SQL sum is exact decimal arithmetic, cents are
    // integers, and a single /100 of an integer-cent total cannot drift at
    // display precision (formatMoney rounds to 2dp). Net flow is subtracted in
    // cents, never in floats (§12).
    const inflowCents = toCents(sumRes[0]?.inflow ?? '0');
    const outflowCents = toCents(sumRes[0]?.outflow ?? '0');
    const totalInflow = inflowCents / 100;
    const totalOutflow = outflowCents / 100;

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      metrics: {
        totalInflow,
        totalOutflow,
        netFlow: (inflowCents - outflowCents) / 100,
      },
    });
  } catch (err: any) {
    console.error('[TRANSACTIONS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch transactions' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: generic transactions write ledger rows — null tenant must
    // 403 instead of inserting NULL-tenant orphans. Cross-tenant fund/member/
    // project ids are rejected below.
    const scopedTenantId = requireTenant(tenantId, user);

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to record transactions');
    }

    const body = await readJsonBody(request);
    const {
      type,
      amount,
      description,
      category,
      fundId,
      memberId,
      projectId,
      date,
      depositMethod,
      referenceNumber,
    } = body;

    if (!type) {
      throw new ValidationError("[Field 'type', Code: required] Transaction type is required");
    }
    if (!description) {
      throw new ValidationError("[Field 'description', Code: required] Description is required");
    }

    // §12: integer-cents parsing (never Number(amount) float math) — the same
    // validator the deposit route uses. Rejects non-finite, >2dp, and
    // non-positive input with a field-pinned error.
    let amountCents: number;
    try {
      amountCents = parsePositiveAmount(amount);
    } catch {
      throw new ValidationError("[Field 'amount', Code: invalid_string] Amount must be a positive number with at most 2 decimal places");
    }
    const formattedAmount = fromCents(amountCents);

    // §12: the generic route moves funds.balance, so the type must sign the
    // movement — an unclassifiable type is rejected rather than posted.
    const isInflow = INFLOW_TYPES.includes(type);
    const isOutflow = OUTFLOW_TYPES.includes(type);
    if (!isInflow && !isOutflow) {
      throw new ValidationError(`[Field 'type', Code: invalid_enum] Unknown transaction type — must be one of: ${[...INFLOW_TYPES, ...OUTFLOW_TYPES].join(', ')}`);
    }

    // §12: a ledger post without a fund can never produce balanceBefore/
    // balanceAfter or move funds.balance — reject instead of inserting an
    // orphan row.
    if (!fundId) {
      throw new ValidationError("[Field 'fundId', Code: required] Fund is required — every transaction must post against a fund");
    }

    const db = getDb();
    const refNum = referenceNumber || `TXN-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

    // §6: referenced entities must belong to the caller's tenant — otherwise a
    // crafted fundId/memberId/projectId links this tenant's ledger row to
    // another tenant's entities (and leaks their existence via NotFound vs ok).
    if (fundId) {
      const [fund] = await db
        .select({ id: funds.id })
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1);
      if (!fund) throw new ValidationError("[Field 'fundId', Code: cross_tenant] Fund does not belong to this tenant");
    }
    if (memberId) {
      const [member] = await db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .limit(1);
      if (!member) throw new ValidationError("[Field 'memberId', Code: cross_tenant] Member does not belong to this tenant");
    }
    if (projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, scopedTenantId)))
        .limit(1);
      if (!project) throw new ValidationError("[Field 'projectId', Code: cross_tenant] Project does not belong to this tenant");
    }

    // Optional payment method must be one the tenant configured (Settings →
    // Governance) or a legacy/internal value; the 'Manual' default below is
    // always allowed. Replaces the fixed DB CHECK that could not track
    // per-tenant data and 500'd on valid names.
    if (depositMethod) {
      const [pmSettings] = await db
        .select({ paymentMethods: systemSettings.paymentMethods })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1);
      if (!isAllowedDepositMethod(String(depositMethod), normalizePaymentMethods(pmSettings?.paymentMethods))) {
        throw new ValidationError("[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first");
      }
    }

    const transactionDate = date ? new Date(date) : new Date();
    // Deposit-route pattern (§12): the fund row is locked FOR UPDATE and
    // re-read INSIDE the tx, balanceBefore/balanceAfter are computed from the
    // locked balance, and the funds.balance write is atomic SQL arithmetic —
    // a concurrent deposit, transfer, or expense can never lose an update.
    const created = await db.transaction(async (tx) => {
      await assertFiscalPeriodOpen(tx, scopedTenantId, transactionDate);

      const [lockedFund] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedFund) throw new NotFoundError('Fund');

      const fundBalanceCents = toCents(lockedFund.balance ?? '0');
      // Inflow credits the fund, outflow debits it — one signed step keeps all
      // arithmetic in integer cents (§12).
      const deltaCents = isInflow ? amountCents : -amountCents;
      const newFundBalanceCents = fundBalanceCents + deltaCents;

      // Move the fund balance (atomic — SQL reads the locked row's live value).
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${deltaCents / 100})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)));

      const [inserted] = await tx
        .insert(transactions)
        .values({
          tenantId: scopedTenantId,
          type,
          amount: formattedAmount,
          description: description.trim(),
          category: category || 'General',
          referenceNumber: refNum,
          fundId,
          memberId: memberId || null,
          projectId: projectId || null,
          date: transactionDate,
          status: 'Completed',
          depositMethod: depositMethod || 'Manual',
          handlingOfficer: user.name,
          authorizedBy: user.id,
          balanceBefore: fromCents(fundBalanceCents),
          balanceAfter: fromCents(newFundBalanceCents),
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();

      // Enforce Rule §12: auto-lock share value once transactions exist (§6:
      // tenant-scoped — a global predicate would lock every tenant because one
      // tenant transacted).
      await tx
        .update(systemSettings)
        .set({ isShareValueLocked: true, updatedAt: new Date() })
        .where(and(eq(systemSettings.tenantId, scopedTenantId), eq(systemSettings.isShareValueLocked, false)));
      return inserted;
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: scopedTenantId,
      action: 'RECORD_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: created?.id,
      details: { type, amount: formattedAmount, referenceNumber: refNum },
    });

    return NextResponse.json({
      success: true,
      data: created,
      message: 'Transaction recorded successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[TRANSACTIONS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record transaction' },
      { status: err.statusCode || 500 }
    );
  }
}
