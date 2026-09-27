import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    // Check write permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const { id } = await params;
    const db = getDb();

    // Get the pending deposit transaction
    const [deposit] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.isDeleted, false), tenantId ? eq(transactions.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!deposit) {
      throw new NotFoundError('Deposit transaction');
    }

    if (deposit.status !== 'PENDING') {
      throw new ValidationError('Only pending deposits can be rejected');
    }

    if (deposit.type !== 'Deposit') {
      throw new ValidationError('Transaction is not a deposit');
    }

    const body = await request.json();
    const { rejectionReason } = body;

    if (!rejectionReason || rejectionReason.trim().length === 0) {
      throw new ValidationError('Rejection reason is required');
    }

    // Get fund with tenant isolation
    const [fund] = await db
      .select()
      .from(funds)
      .where(and(eq(funds.id, deposit.fundId!), tenantId ? eq(funds.tenantId, tenantId) : sql`true`))
      .limit(1);

    if (!fund) {
      throw new NotFoundError('Fund');
    }

    // Get member with tenant isolation
    let member = null;
    if (deposit.memberId) {
      const [m] = await db
        .select()
        .from(members)
        .where(and(eq(members.id, deposit.memberId), tenantId ? eq(members.tenantId, tenantId) : sql`true`))
        .limit(1);
      member = m;
    }

    const now = new Date();

    // Update deposit transaction status to REJECTED
    await db
      .update(transactions)
      .set({
        status: 'REJECTED',
        description: `${deposit.description} - REJECTED: ${rejectionReason.trim()}`,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(transactions.id, id));

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'REJECT_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: id,
      details: {
        memberId: member?.id,
        memberName: member?.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: deposit.amount,
        referenceNumber: deposit.referenceNumber,
        rejectionReason: rejectionReason.trim(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: deposit.referenceNumber,
        status: 'REJECTED',
        rejectionReason: rejectionReason.trim(),
      },
      message: 'Deposit rejected successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSIT REJECT ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to reject deposit' },
      { status: err.statusCode || 500 }
    );
  }
}