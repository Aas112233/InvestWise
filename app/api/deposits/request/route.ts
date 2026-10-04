import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
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
    // §6 fail-closed: deposit requests move money — null tenant must 403 so the
    // member/fund lookups below can never run unscoped.
    const scopedTenantId = requireTenant(tenantId, user);

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
      depositMonth,
    } = body;

    // Validate required fields
    if (!memberId || !fundId) {
      throw new ValidationError('memberId and fundId are required');
    }

    // Deposit month (YYYY-MM): the month the payment is FOR, chosen in the
    // request form. Validation is server-side, never trusted (§6); optional
    // so older clients and scripts stay working — approval falls back to the
    // request date when absent.
    let depositMonthKey: string | null = null;
    if (depositMonth !== undefined && depositMonth !== null && depositMonth !== "") {
      if (typeof depositMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth)) {
        throw new ValidationError("[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format");
      }
      depositMonthKey = depositMonth;
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

    // Reference/member/fund lookups are independent of each other (all keyed
    // off the request payload) — batch them into one round-trip group instead
    // of three sequential ones. Error checks below preserve the original
    // precedence (duplicate ref → missing member → missing fund).
    const [existingDeposit, [member], [fund]] = await Promise.all([
      // Duplicate reference number check (idempotency, tenant-scoped so one
      // tenant cannot squat or probe another tenant's reference).
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
      // Member with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .limit(1),
      // Fund with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
    ]);

    if (existingDeposit.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    if (!member) {
      throw new NotFoundError('Member');
    }

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

    // Create pending deposit request transaction (tenant is mandatory — never
    // insert a NULL-tenant orphan row that no tenant filter can see).
    await db.transaction(async (tx) => {
      await tx.insert(transactions).values({
        tenantId: scopedTenantId,
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
        depositMonth: depositMonthKey,
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
        depositMonth: depositMonthKey,
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