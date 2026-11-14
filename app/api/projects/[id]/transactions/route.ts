import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, members, funds, users } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireProjectContext } from '../../_helpers';
import { apiError } from '@/lib/utils/api-error';

// Bounded page size — a long-running project accumulates thousands of ledger
// rows; the old shape returned every one of them in a single payload.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 200;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireProjectContext(request);
    if ('error' in ctx) return ctx.error;
    const { tenantId } = ctx;

    const { id } = await params;

    const url = new URL(request.url);
    const page = Math.min(1000, Math.max(1, Number(url.searchParams.get('page')) || 1)); // page bounded: a huge `page` is an OFFSET walk Postgres still does
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE),
    );

    const db = getDb();
    const where = and(
      eq(transactions.tenantId, tenantId),
      eq(transactions.projectId, id),
      eq(transactions.isDeleted, false),
    );

    const rows = await db
      .select({
        id: transactions.id,
        referenceNumber: transactions.referenceNumber,
        docNumber: transactions.docNumber,
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
        handlingOfficer: transactions.handlingOfficer,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, tenantId)))
      .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, tenantId)))
      .where(where)
      .orderBy(desc(transactions.createdAt), desc(transactions.date), desc(transactions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totalRow] = await db.select({ total: count() }).from(transactions).where(where);

    return NextResponse.json({
      success: true,
      data: rows,
      meta: { page, pageSize, total: totalRow?.total ?? 0 },
    });
  } catch (err: unknown) {
    console.error('[PROJECT TRANSACTIONS ERROR]', err);
    const e = err as { message?: string; statusCode?: number };
    return apiError(e, 'Failed to fetch project transactions');
  }
}
