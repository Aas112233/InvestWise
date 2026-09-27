import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, desc, sql, gte, lte, ilike, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check read permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'READ')) {
      throw new ForbiddenError('Read permission required for: DEPOSITS');
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
    const memberId = searchParams.get('memberId');
    const fundId = searchParams.get('fundId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Fail-closed tenant scope (AGENTS.md §6). Previously `if (tenantId)`
    // silently fell through to an unscoped cross-tenant query.
    if (!tenantId) {
      throw new ForbiddenError('Tenant context required');
    }
    conditions.push(sql`${transactions.tenantId} = ${tenantId}`);

    // Only deposit transactions
    conditions.push(sql`${transactions.type} = 'Deposit'`);

    // Soft delete filter
    conditions.push(sql`${transactions.isDeleted} = false`);

    if (memberId) {
      conditions.push(sql`${transactions.memberId} = ${memberId}`);
    }
    if (fundId) {
      conditions.push(sql`${transactions.fundId} = ${fundId}`);
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

    // Aggregate-only mode: the deposits header needs just the summed total for
    // a month. Previously the client fetched up to 1000 full rows (with joins)
    // purely to add them up client-side — a large, wasteful round trip.
    if (searchParams.get('aggregateOnly') === 'true') {
      const [agg] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .where(whereClause);

      return NextResponse.json({
        success: true,
        data: { total: agg?.total ?? '0', count: agg?.count ?? 0 },
      });
    }

    // Single round trip: page rows (with joins) + exact filtered count, plus
    // the SUM for the current filter set so the header never needs a 2nd call.
    const [totalRes, aggRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(whereClause),
      db
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
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
          memberId: transactions.memberId,
          fundId: transactions.fundId,
          handlingOfficer: transactions.handlingOfficer,
          depositMethod: transactions.depositMethod,
          authorizedBy: transactions.authorizedBy,
          balanceBefore: transactions.balanceBefore,
          balanceAfter: transactions.balanceAfter,
          createdAt: transactions.createdAt,
          memberName: members.name,
          memberIdStr: members.memberId,
          fundName: funds.name,
        })
        .from(transactions)
        .leftJoin(members, eq(transactions.memberId, members.id))
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .where(whereClause)
        .orderBy(desc(transactions.date))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      // Filtered SUM — lets the header render without a second request.
      sum: aggRes[0]?.total ?? '0',
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[DEPOSITS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch deposits' },
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

    // Check write permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const body = await request.json();
    const {
      memberId,
      fundId,
      amount,
      description,
      depositMethod,
      referenceNumber,
      date,
    } = body;

    // Share numbers are one-time setup (member creation). Deposits never
    // change them — a non-zero payload is rejected, not silently applied.
    if (Number(body.shares ?? 0) !== 0) {
      throw new ValidationError('Share numbers are locked after member creation and cannot be changed by deposits');
    }

    // Validate required fields
    if (!memberId || !fundId) {
      throw new ValidationError('memberId and fundId are required');
    }

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      throw new ValidationError('Deposit amount must be a positive number');
    }

    // Validate 2 decimal places
    if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
      throw new ValidationError('Amount must have at most 2 decimal places');
    }

    const formattedAmount = depositAmount.toFixed(2);

    const refNumber = referenceNumber || `DEP-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const depositDate = date ? new Date(date) : new Date();

    const db = getDb();

    // Check for duplicate reference number (idempotency)
    const existingDeposit = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.referenceNumber, refNumber), eq(transactions.isDeleted, false)))
      .limit(1);

    if (existingDeposit.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    // Get member with tenant isolation
    const [member] = await db
      .select()
      .from(members)
      .where(and(eq(members.id, memberId), tenantId ? eq(members.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!member) {
      throw new NotFoundError('Member');
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

    const now = new Date();

    // Execute atomic deposit transaction
    await db.transaction(async (tx) => {
      // Update fund balance
      const fundBalance = parseFloat(fund.balance);
      const newFundBalance = (fundBalance + depositAmount).toFixed(2);
      await tx
        .update(funds)
        .set({ balance: newFundBalance, updatedAt: now })
        .where(eq(funds.id, fundId));

      // Update member contributions
      const memberContributed = parseFloat(member.totalContributed || '0');
      const newMemberContributed = (memberContributed + depositAmount).toFixed(2);

      await tx
        .update(members)
        .set({ 
          totalContributed: newMemberContributed,
          lastDepositMonth: depositDate.toISOString().slice(0, 7), // YYYY-MM format
          lastActive: now,
          updatedAt: now,
        })
        .where(eq(members.id, memberId));

      // Create deposit transaction
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Deposit',
        amount: formattedAmount,
        description: description || 'Member deposit',
        category: 'Deposit',
        referenceNumber: refNumber,
        date: depositDate,
        status: 'Completed',
        memberId: memberId,
        fundId: fundId,
        handlingOfficer: user.name,
        depositMethod: depositMethod || null,
        authorizedBy: user.id,
        balanceBefore: fund.balance,
        balanceAfter: newFundBalance,
        createdBy: user.id,
        updatedBy: user.id,
      });
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'RECORD_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: formattedAmount,
        referenceNumber: refNumber,
        depositMethod: depositMethod || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        member: { id: member.id, name: member.name, newTotalContributed: (parseFloat(member.totalContributed || '0') + depositAmount).toFixed(2), shares: member.shares },
        fund: { id: fund.id, name: fund.name, newBalance: (parseFloat(fund.balance) + depositAmount).toFixed(2) },
        amount: formattedAmount,
        date: depositDate.toISOString(),
      },
      message: 'Deposit recorded successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSITS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record deposit' },
      { status: err.statusCode || 500 }
    );
  }
}