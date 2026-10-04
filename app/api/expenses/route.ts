import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, projects, members, users, systemSettings } from '@/db/schema/index';
import { eq, and, desc, sql, gte, lte, ilike } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { toCents, fromCents } from '@/lib/money';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: expense ledger is tenant business data — null tenant must
    // 403 instead of returning every tenant's expenses.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check read permission for EXPENSES
    if (!hasScreenPermission(user, 'EXPENSES', 'READ')) {
      throw new ForbiddenError('Read permission required for: EXPENSES');
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
    const fundId = searchParams.get('fundId');
    const projectId = searchParams.get('projectId');
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Unconditional tenant predicate — scopedTenantId already 403s on null.
    conditions.push(sql`${transactions.tenantId} = ${scopedTenantId}`);

    // Only expense transactions
    conditions.push(sql`${transactions.type} = 'Expense'`);

    // Soft delete filter
    conditions.push(sql`${transactions.isDeleted} = false`);

    if (fundId) {
      conditions.push(sql`${transactions.fundId} = ${fundId}`);
    }
    if (projectId) {
      conditions.push(sql`${transactions.projectId} = ${projectId}`);
    }
    if (category) {
      conditions.push(sql`${transactions.category} = ${category}`);
    }
    if (status) {
      conditions.push(sql`${transactions.status} = ${status}`);
    }
    if (startDate) {
      conditions.push(gte(transactions.date, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(transactions.date, new Date(endDate)));
    }
    if (search) {
      conditions.push(sql`(${transactions.description} ILIKE ${'%' + search + '%'} OR ${transactions.referenceNumber} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(whereClause),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          description: transactions.description,
          expenseName: transactions.expenseName,
          category: transactions.category,
          referenceNumber: transactions.referenceNumber,
          date: transactions.date,
          status: transactions.status,
          fundId: transactions.fundId,
          projectId: transactions.projectId,
          memberId: transactions.memberId,
          handlingOfficer: transactions.handlingOfficer,
          authorizedBy: transactions.authorizedBy,
          balanceBefore: transactions.balanceBefore,
          balanceAfter: transactions.balanceAfter,
          createdAt: transactions.createdAt,
          fundName: funds.name,
          projectTitle: projects.title,
          memberName: members.name,
          approvedByName: users.name,
        })
        .from(transactions)
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .leftJoin(projects, eq(transactions.projectId, projects.id))
        // §6: joined entities must belong to the same tenant — joining on id
        // alone would render another tenant's member/approver names.
        .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, scopedTenantId)))
        .leftJoin(users, and(eq(transactions.authorizedBy, users.id), eq(users.tenantId, scopedTenantId)))
        .where(whereClause)
        .orderBy(desc(transactions.date))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[EXPENSES GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch expenses' },
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
    // §6 fail-closed: expenses move money — null tenant must 403 so the
    // idempotency + fund/project lookups below can never run unscoped.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check write permission for EXPENSES
    if (!hasScreenPermission(user, 'EXPENSES', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: EXPENSES');
    }

    const body = await request.json();
    const {
      fundId,
      projectId,
      amount,
      category,
      expenseName,
      memberId,
      approvedBy,
      description,
      receiptUrl,
      date,
      referenceNumber,
    } = body;

    // Validate required fields
    if (!fundId) {
      throw new ValidationError('fundId is required');
    }

    if (!category) {
      throw new ValidationError('category is required');
    }

    // Expenses module spec: an expense carries a distinct name and is
    // submitted against the member who incurred it.
    if (typeof expenseName !== 'string' || !expenseName.trim()) {
      throw new ValidationError("[Field 'expenseName', Code: required] Expense name is required");
    }
    if (expenseName.trim().length > 255) {
      throw new ValidationError("[Field 'expenseName', Code: too_long] Expense name must be at most 255 characters");
    }
    if (!memberId) {
      throw new ValidationError("[Field 'memberId', Code: required] Expense by member is required");
    }

    const expenseAmount = parseFloat(amount);
    if (isNaN(expenseAmount) || expenseAmount <= 0) {
      throw new ValidationError('Expense amount must be a positive number');
    }

    // Validate 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
      throw new ValidationError('Amount must have at most 2 decimal places');
    }

    const formattedAmount = expenseAmount.toFixed(2);
    const refNumber = referenceNumber || `EXP-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const expenseDate = date ? new Date(date) : new Date();

    const db = getDb();

    // Reference/fund/project/member/approver lookups are independent of each
    // other (all keyed off the request payload) — batch them into one
    // round-trip group instead of up to five sequential ones. Error checks
    // below preserve the original precedence. An absent optional id can never
    // satisfy the lookup (sql false → no row), matching the skip behavior.
    const [existingExpense, [fund], [project], [member], [approver]] = await Promise.all([
      // Duplicate reference number check (idempotency, tenant-scoped).
      db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.referenceNumber, refNumber),
            eq(transactions.isDeleted, false),
            eq(transactions.tenantId, scopedTenantId),
          ),
        )
        .limit(1),
      // Fund with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      // Project with tenant isolation (§6: must belong to the same tenant).
      db
        .select()
        .from(projects)
        .where(
          projectId
            ? and(eq(projects.id, projectId), eq(projects.tenantId, scopedTenantId))
            : sql`false`
        )
        .limit(1),
      // Expense-by member with tenant isolation (§6).
      db
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .limit(1),
      // Approver must be a user of the same tenant (§6). Absent → the
      // submitting user records themselves as approver.
      db
        .select({ id: users.id })
        .from(users)
        .where(
          approvedBy
            ? and(eq(users.id, approvedBy), eq(users.tenantId, scopedTenantId))
            : sql`false`
        )
        .limit(1),
    ]);

    if (existingExpense.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    if (!fund) {
      throw new NotFoundError('Fund');
    }

    // Check if fund is active
    if (fund.status !== 'ACTIVE') {
      throw new ValidationError('Fund is not active');
    }

    // Check if fund has sufficient balance above minimum
    const fundBalance = parseFloat(fund.balance);
    const fundMinBalance = parseFloat(fund.minimumBalance || '0');
    const availableBalance = fundBalance - fundMinBalance;

    if (availableBalance < expenseAmount) {
      throw new ValidationError(
        `Insufficient available balance in fund. Available (above minimum): ${availableBalance.toFixed(2)}, Required: ${formattedAmount}`
      );
    }

    // Project was already resolved in the parallel lookup batch above; a
    // provided-but-unknown project still fails here.
    if (projectId && !project) {
      throw new NotFoundError('Project');
    }

    if (!member) {
      throw new ValidationError("[Field 'memberId', Code: cross_tenant] Member does not belong to this tenant");
    }

    if (approvedBy && !approver) {
      throw new ValidationError("[Field 'approvedBy', Code: cross_tenant] Approver does not belong to this tenant");
    }

    const now = new Date();

    // Execute atomic expense transaction (§6: every write re-asserts the
    // tenant — id-only updates would debit another tenant's fund/project).
    // Bulletproofing (Funds module spec): the fund row is locked (FOR UPDATE)
    // and re-read INSIDE the tx — the outer read is stale-prone — and the
    // balance write is atomic SQL arithmetic, so a concurrent deposit,
    // transfer, or expense can never lose an update (§12).
    const { newFundBalance, newProjectExpenses } = await db.transaction(async (tx) => {
      const [lockedFund] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedFund) throw new NotFoundError('Fund');

      const expenseCents = toCents(formattedAmount);
      const fundBalanceCents = toCents(lockedFund.balance ?? '0');
      const fundMinBalanceCents = toCents(lockedFund.minimumBalance ?? '0');
      if (fundBalanceCents - fundMinBalanceCents < expenseCents) {
        throw new ValidationError(
          `Insufficient available balance in fund. Available (above minimum): ${fromCents(fundBalanceCents - fundMinBalanceCents)}, Required: ${formattedAmount}`
        );
      }
      const newFundBalanceCents = fundBalanceCents - expenseCents;

      // Debit fund balance (atomic — SQL reads the locked row's live value).
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric - ${expenseCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)));

      // Create expense transaction
      await tx.insert(transactions).values({
        tenantId: scopedTenantId,
        type: 'Expense',
        amount: formattedAmount,
        description: description || 'Operational expense',
        expenseName: expenseName.trim(),
        category: category,
        referenceNumber: refNumber,
        date: expenseDate,
        status: 'Completed',
        fundId: fundId,
        projectId: projectId || null,
        memberId: memberId,
        handlingOfficer: user.name,
        authorizedBy: approvedBy || user.id,
        balanceBefore: fromCents(fundBalanceCents),
        balanceAfter: fromCents(newFundBalanceCents),
        createdBy: user.id,
        updatedBy: user.id,
      });

      // Update project expenses if linked (§6 tenant-scoped write, atomic).
      let newProjectExpenses: string | null = null;
      if (project) {
        newProjectExpenses = fromCents(toCents(project.totalExpenses || '0') + expenseCents);
        await tx
          .update(projects)
          .set({
            totalExpenses: sql`(coalesce(${projects.totalExpenses}, 0) + ${expenseCents / 100})::numeric(15,2)`,
            updatedAt: now,
          })
          .where(and(eq(projects.id, projectId), eq(projects.tenantId, scopedTenantId)));
      }

      return { newFundBalance: fromCents(newFundBalanceCents), newProjectExpenses };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'RECORD_EXPENSE',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        fundId: fund.id,
        fundName: fund.name,
        projectId: project?.id,
        projectTitle: project?.title,
        memberId,
        approvedBy: approvedBy || user.id,
        expenseName: expenseName.trim(),
        amount: formattedAmount,
        category,
        description: description || null,
        receiptUrl: receiptUrl || null,
        referenceNumber: refNumber,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        fund: { id: fund.id, name: fund.name, newBalance: newFundBalance },
        project: project ? { id: project.id, title: project.title, newTotalExpenses: newProjectExpenses } : null,
        amount: formattedAmount,
        category,
        description: description || null,
        receiptUrl: receiptUrl || null,
        date: expenseDate.toISOString(),
      },
      message: 'Expense recorded successfully',
    });
  } catch (err: any) {
    console.error('[EXPENSES POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record expense' },
      { status: err.statusCode || 500 }
    );
  }
}