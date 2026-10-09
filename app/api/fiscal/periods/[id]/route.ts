import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { auditLogs, fiscalPeriods, systemSettings, transactions } from '@/db/schema/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, readJsonUnknown } from '@/lib/utils/errors';
import { computeFiscalPeriodTotals } from '@/lib/fiscal-totals';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close'), notes: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('reopen') }),
]);

function responseError(error: unknown, fallback: string) {
  const err = error as { message?: string; statusCode?: number; code?: string };
  return NextResponse.json(
    { success: false, message: err.message || fallback, code: err.code || 'INTERNAL_ERROR' },
    { status: err.statusCode || 500 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, 'FISCAL', 'WRITE')) throw new ForbiddenError('Write permission required for: FISCAL');

    const { id } = await params;
    const parsed = actionSchema.safeParse(await readJsonUnknown(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(`[Field '${issue?.path.join('.') || 'action'}', Code: ${issue?.code || 'invalid'}] ${issue?.message || 'Invalid action'}`);
    }

    const db = getDb();
    const result = await db.transaction(async (tx) => {
      // Read the immutable year first, then take the same advisory lock used by
      // posts and period creation before locking the period row. This ordering
      // prevents a close from racing a post or deadlocking against it.
      const [yearRow] = await tx
        .select({ year: fiscalPeriods.year })
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.tenantId, scopedTenantId)))
        .limit(1);
      if (!yearRow) throw new NotFoundError('Fiscal period');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopedTenantId}), ${yearRow.year})`);

      const [period] = await tx
        .select()
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!period) throw new NotFoundError('Fiscal period');
      const now = new Date();

      if (parsed.data.action === 'reopen') {
        if (period.status !== 'CLOSED') throw new ConflictError('Only a closed fiscal period can be reopened');
        const [updated] = await tx
          .update(fiscalPeriods)
          .set({ status: 'OPEN', closedBy: null, closedAt: null, updatedAt: now })
          .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.tenantId, scopedTenantId)))
          .returning();
        await tx.insert(auditLogs).values({
          tenantId: scopedTenantId,
          userId: user.id,
          userName: user.name,
          action: 'REOPEN_FISCAL_PERIOD',
          resourceType: 'FiscalPeriod',
          resourceId: id,
          details: { year: period.year },
          status: 'SUCCESS',
        });
        return updated;
      }

      if (period.status === 'CLOSED') throw new ConflictError('Fiscal period is already closed');

      const [pending] = await tx
        .select({ total: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, scopedTenantId),
            eq(transactions.isDeleted, false),
            inArray(transactions.status, ['PENDING', 'Pending', 'Requested', 'Awaiting Approval', 'Processing']),
            gte(transactions.date, period.periodStart),
            lte(transactions.date, period.periodEnd),
          ),
        );
      if (Number(pending?.total || 0) > 0) {
        throw new ConflictError('Resolve pending transactions in this period before closing it');
      }

      const [settings] = await tx
        .select({ statutoryReservePercent: systemSettings.statutoryReservePercent })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1);
      const reservePercent = settings?.statutoryReservePercent || '10';

      // Shared with the GET path (lib/fiscal-totals.ts) so an OPEN period's
      // preview and its eventual close can never drift apart.
      const totals = await computeFiscalPeriodTotals(
        tx,
        scopedTenantId,
        period.periodStart,
        period.periodEnd,
        reservePercent,
      );

      const [updated] = await tx
        .update(fiscalPeriods)
        .set({
          status: 'CLOSED',
          totalDeposits: totals.totalDeposits || '0.00',
          totalWithdrawals: totals.totalWithdrawals || '0.00',
          totalEarnings: totals.totalEarnings || '0.00',
          totalExpenses: totals.totalExpenses || '0.00',
          netSurplus: totals.netSurplus || '0.00',
          statutoryReserve: totals.statutoryReserve || '0.00',
          distributableSurplus: totals.distributableSurplus || '0.00',
          retainedEarnings: sql`GREATEST(0::numeric, ${totals.distributableSurplus || '0.00'}::numeric - COALESCE(${fiscalPeriods.actualDistributed}, 0))`,
          closedBy: user.id,
          closedAt: now,
          notes: parsed.data.notes || period.notes,
          updatedAt: now,
        })
        .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.tenantId, scopedTenantId)))
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: scopedTenantId,
        userId: user.id,
        userName: user.name,
        action: 'CLOSE_FISCAL_PERIOD',
        resourceType: 'FiscalPeriod',
        resourceId: id,
        details: {
          year: period.year,
          totalEarnings: totals.totalEarnings || '0.00',
          totalExpenses: totals.totalExpenses || '0.00',
          netSurplus: totals.netSurplus || '0.00',
          dividendRunReserve: totals.runReserve || '0.00',
          dividendRunDistributed: totals.runDistributed || '0.00',
          distributableSurplus: totals.distributableSurplus || '0.00',
          statutoryReserve: totals.statutoryReserve || '0.00',
        },
        status: 'SUCCESS',
      });
      return updated;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[FISCAL PERIOD ACTION ERROR]', error);
    return responseError(error, 'Failed to update fiscal period');
  }
}
