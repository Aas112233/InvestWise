import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check write permission for REQUEST_DEPOSIT
    if (!hasScreenPermission(user, 'REQUEST_DEPOSIT', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: REQUEST_DEPOSIT');
    }

    const body = await request.json();
    const {
      memberId,
      fundId,
      amount,
      depositMethod,
      notes,
    } = body;

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
    const refNumber = `DEP-REQ-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

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

    // Check if member is active
    if (member.status !== 'active') {
      throw new ValidationError('Member is not active');
    }

    // Check if fund is active
    if (fund.status !== 'ACTIVE') {
      throw new ValidationError('Fund is not active');
    }

    const now = new Date();

    // Create pending deposit request transaction
    await db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        tenantId: tenantId || null,
        type: 'Deposit',
        amount: formattedAmount,
        description: notes || 'Member deposit request',
        category: 'Deposit Request',
        referenceNumber: refNumber,
        date: now,
        status: 'PENDING',
        memberId: memberId,
        fundId: fundId,
        handlingOfficer: user.name,
        depositMethod: depositMethod || null,
        authorizedBy: user.id,
        balanceBefore: fund.balance,
        balanceAfter: fund.balance, // Balance unchanged for pending
        createdBy: user.id,
        updatedBy: user.id,
      });
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'REQUEST_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: formattedAmount,
        depositMethod: depositMethod || null,
        notes: notes || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        member: { id: member.id, name: member.name },
        fund: { id: fund.id, name: fund.name },
        amount: formattedAmount,
        status: 'PENDING',
        date: now.toISOString(),
      },
      message: 'Deposit request submitted successfully. Awaiting approval.',
    });
  } catch (err: any) {
    console.error('[DEPOSIT REQUEST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to submit deposit request' },
      { status: err.statusCode || 500 }
    );
  }
}