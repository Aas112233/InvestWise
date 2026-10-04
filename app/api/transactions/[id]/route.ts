import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, projects, users } from '@/db/schema/index';
import { eq, and } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: tenant business data — fail closed without tenant context.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const { id } = await params;
    const db = getDb();

    const [tx] = await db
      .select({
        id: transactions.id,
        referenceNumber: transactions.referenceNumber,
        date: transactions.date,
        type: transactions.type,
        category: transactions.category,
        amount: transactions.amount,
        status: transactions.status,
        description: transactions.description,
        memberId: transactions.memberId,
        memberName: members.name,
        memberCode: members.memberId,
        fundId: transactions.fundId,
        fundName: funds.name,
        projectId: transactions.projectId,
        projectName: projects.title,
        handlingOfficer: transactions.handlingOfficer,
        depositMethod: transactions.depositMethod,
        authorizedBy: transactions.authorizedBy,
        authorizerName: users.name,
        isDeleted: transactions.isDeleted,
        deletedAt: transactions.deletedAt,
        deletionReason: transactions.deletionReason,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(members, eq(transactions.memberId, members.id))
      .leftJoin(funds, eq(transactions.fundId, funds.id))
      .leftJoin(projects, eq(transactions.projectId, projects.id))
      .leftJoin(users, eq(transactions.authorizedBy, users.id))
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .limit(1);

    if (!tx) throw new NotFoundError('Transaction');

    return NextResponse.json({
      success: true,
      data: tx,
    });
  } catch (err: any) {
    console.error('[TRANSACTION GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch transaction' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin privilege required to soft-delete transactions');
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || body.deletionReason;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new ValidationError('A deletion reason is required per financial compliance rules');
    }

    const db = getDb();

    const [existing] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Transaction');
    if (existing.isDeleted) {
      throw new ValidationError('Transaction is already deleted');
    }

    // Real-money guard (deposits spec): Completed/Success deposits moved real
    // money and cannot be deleted — they must be reverted to request first
    // (POST /api/deposits/[id]/revert), which reverses fund/member balances
    // atomically. Deleting here would orphan the ledger from balances.
    if (
      existing.type === 'Deposit' &&
      (existing.status === 'Completed' || existing.status === 'Success')
    ) {
      throw new ValidationError(
        'Completed deposits cannot be deleted. Revert to request instead (POST /api/deposits/[id]/revert) so fund and member balances are reversed.',
      );
    }

    // Rule §12: Soft delete only — transactions use isDeleted + deletedBy/deletionReason, never hard delete
    const [softDeleted] = await db
      .update(transactions)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: user.id,
        deletionReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)))
      .returning();

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'SOFT_DELETE_TRANSACTION',
      resourceType: 'Transaction',
      resourceId: id,
      details: { reason: reason.trim(), referenceNumber: existing.referenceNumber },
    });

    return NextResponse.json({
      success: true,
      data: softDeleted,
      message: 'Transaction successfully soft-deleted with audit logging',
    });
  } catch (err: any) {
    console.error('[TRANSACTION DELETE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to soft-delete transaction' },
      { status: err.statusCode || 500 }
    );
  }
}
