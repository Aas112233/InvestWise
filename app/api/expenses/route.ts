import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, projects, systemSettings } from '@/db/schema/index';
import { eq, and, desc, sql, gte, lte, ilike } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
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

    if (tenantId) {
      conditions.push(sql`${transactions.tenantId} = ${tenantId}`);
    }

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
          category: transactions.category,
          referenceNumber: transactions.referenceNumber,
          date: transactions.date,
          status: transactions.status,
          fundId: transactions.fundId,
          projectId: transactions.projectId,
          handlingOfficer: transactions.handlingOfficer,
          authorizedBy: transactions.authorizedBy,
          balanceBefore: transactions.balanceBefore,
          balanceAfter: transactions.balanceAfter,
          createdAt: transactions.createdAt,
          fundName: funds.name,
          projectTitle: projects.title,
        })
        .from(transactions)
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .leftJoin(projects, eq(transactions.projectId, projects.id))
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

    // Check for duplicate reference number (idempotency)
    const existingExpense = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.referenceNumber, refNumber), eq(transactions.isDeleted, false)))
      .limit(1);

    if (existingExpense.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    // Get fund with tenant isolation
    const [fund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, fundId), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

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

    // Validate project if provided
    let project = null;
    if (projectId) {
      const [p] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), tenantId ? eq(projects.tenantId, tenantId) : sql`true`))
        .limit(1);
      project = p;
      if (!project) {
        throw new NotFoundError('Project');
      }
    }

    const now = new Date();

    // Execute atomic expense transaction
    await db.transaction(async (tx) => {
      // Debit fund balance
      const newFundBalance = (fundBalance - expenseAmount).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newFundBalance, updatedAt: now })
        .where(eq(funds.id, fundId));

      // Create expense transaction
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Expense',
        amount: formattedAmount,
        description: description || 'Operational expense',
        category: category,
        referenceNumber: refNumber,
        date: expenseDate,
        status: 'Completed',
        fundId: fundId,
        projectId: projectId || null,
        handlingOfficer: user.name,
        authorizedBy: user.id,
        balanceBefore: fund.balance,
        balanceAfter: newFundBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });

      // Update project expenses if linked
      if (project) {
        const projectExpenses = parseFloat(project.totalExpenses || '0');
        const newProjectExpenses = (projectExpenses + expenseAmount).toFixed(2);
        await tx
          .update(projects)
          .set({ totalExpenses: newProjectExpenses, updatedAt: now })
          .where(eq(projects.id, projectId));
      }
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
        fund: { id: fund.id, name: fund.name, newBalance: (fundBalance - expenseAmount).toFixed(2) },
        project: project ? { id: project.id, title: project.title, newTotalExpenses: (parseFloat(project.totalExpenses || '0') + expenseAmount).toFixed(2) } : null,
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