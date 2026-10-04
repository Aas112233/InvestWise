import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, users } from '@/db/schema/index';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireProjectContext } from '../../_helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireProjectContext(request);
    if ('error' in ctx) return ctx.error;
    const { tenantId } = ctx;

    const { id } = await params;
    const db = getDb();

    const rows = await db
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
        handlingOfficer: transactions.handlingOfficer,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, tenantId)))
      .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, tenantId)))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          eq(transactions.projectId, id),
          eq(transactions.isDeleted, false),
        ),
      )
      .orderBy(desc(transactions.date));

    return NextResponse.json({
      success: true,
      data: rows,
    });
  } catch (err: unknown) {
    console.error('[PROJECT TRANSACTIONS ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to fetch project transactions' },
      { status: e.statusCode || 500 },
    );
  }
}
