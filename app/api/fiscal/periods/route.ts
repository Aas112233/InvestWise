import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { fiscalPeriods, systemSettings } from '@/db/schema/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ConflictError, ForbiddenError, ValidationError, readJsonUnknown } from '@/lib/utils/errors';
import { logAudit } from '@/lib/utils/audit';
import { resolveFiscalBounds } from '@/lib/fiscal-periods';
import { computeFiscalPeriodTotals } from '@/lib/fiscal-totals';
import { apiError } from '@/lib/utils/api-error';

const createPeriodSchema = z.object({
  startYear: z.number().int().min(1900).max(9998),
  notes: z.string().trim().max(1000).optional(),
});

function responseError(error: unknown, fallback: string) {
  const err = error as { message?: string; statusCode?: number; code?: string };
  return apiError(err, fallback);
}

function fiscalLabel(start: Date, end: Date): string {
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  return endYear === startYear ? String(startYear) : `${startYear}-${String(endYear % 100).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, 'FISCAL', 'READ')) throw new ForbiddenError('Read permission required for: FISCAL');

    const db = getDb();
    const [settings] = await db
      .select({
        fiscalYearStart: systemSettings.fiscalYearStart,
        fiscalYearEnd: systemSettings.fiscalYearEnd,
        statutoryReservePercent: systemSettings.statutoryReservePercent,
      })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, scopedTenantId))
      .limit(1);
    const rows = await db
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.tenantId, scopedTenantId))
      .orderBy(desc(fiscalPeriods.year), desc(fiscalPeriods.periodStart));

    // #52: OPEN periods carry the all-zero snapshot they were created with, so
    // the FY table disagreed with the ledger (earnings/expenses/reserve). A
    // closed period's stored totals are authoritative; an open one is recomputed
    // live with the close endpoint's own formula.
    const reservePercent = settings?.statutoryReservePercent || '10';
    const liveTotals = new Map<string, Awaited<ReturnType<typeof computeFiscalPeriodTotals>>>();
    await Promise.all(
      rows
        .filter((period) => period.status !== 'CLOSED')
        .map(async (period) => {
          liveTotals.set(
            period.id,
            await computeFiscalPeriodTotals(
              db,
              scopedTenantId,
              period.periodStart,
              period.periodEnd,
              reservePercent,
            ),
          );
        }),
    );

    return NextResponse.json({
      success: true,
      data: rows.map((period) => {
        const live = liveTotals.get(period.id);
        return {
          ...period,
          fiscalLabel: fiscalLabel(period.periodStart, period.periodEnd),
          totalDeposits: (live?.totalDeposits ?? period.totalDeposits) ?? '0.00',
          totalWithdrawals: (live?.totalWithdrawals ?? period.totalWithdrawals) ?? '0.00',
          totalEarnings: (live?.totalEarnings ?? period.totalEarnings) ?? '0.00',
          totalExpenses: (live?.totalExpenses ?? period.totalExpenses) ?? '0.00',
          netSurplus: (live?.netSurplus ?? period.netSurplus) ?? '0.00',
          statutoryReserve: (live?.statutoryReserve ?? period.statutoryReserve) ?? '0.00',
          distributableSurplus: (live?.distributableSurplus ?? period.distributableSurplus) ?? '0.00',
          actualDistributed: period.actualDistributed ?? '0.00',
          retainedEarnings: period.retainedEarnings ?? '0.00',
        };
      }),
      fiscalYearStart: settings?.fiscalYearStart || 'July',
      fiscalYearEnd: settings?.fiscalYearEnd || 'June',
    });
  } catch (error) {
    console.error('[FISCAL PERIODS GET ERROR]', error);
    return responseError(error, 'Failed to fetch fiscal periods');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, 'FISCAL', 'WRITE')) throw new ForbiddenError('Write permission required for: FISCAL');

    const parsed = createPeriodSchema.safeParse(await readJsonUnknown(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(`[Field '${issue?.path.join('.') || 'body'}', Code: ${issue?.code || 'invalid'}] ${issue?.message || 'Invalid fiscal period'}`);
    }

    const db = getDb();
    const [settings] = await db
      .select({ fiscalYearStart: systemSettings.fiscalYearStart, fiscalYearEnd: systemSettings.fiscalYearEnd })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, scopedTenantId))
      .limit(1);
    let bounds;
    try {
      bounds = resolveFiscalBounds(
        parsed.data.startYear,
        settings?.fiscalYearStart || 'July',
        settings?.fiscalYearEnd || 'June',
      );
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }

    const [created] = await db.transaction(async (tx) => {
      // Serialize onboarding for this tenant/year before checking for overlap.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scopedTenantId}), ${parsed.data.startYear})`);
      const [overlap] = await tx
        .select({ id: fiscalPeriods.id })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, scopedTenantId),
            lte(fiscalPeriods.periodStart, bounds.periodEnd),
            gte(fiscalPeriods.periodEnd, bounds.periodStart),
          ),
        )
        .limit(1);
      if (overlap) throw new ConflictError('This fiscal year overlaps an existing fiscal period');

      return tx
        .insert(fiscalPeriods)
        .values({
          tenantId: scopedTenantId,
          year: bounds.year,
          periodStart: bounds.periodStart,
          periodEnd: bounds.periodEnd,
          status: 'OPEN',
          notes: parsed.data.notes || null,
        })
        .returning();
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId: scopedTenantId,
      action: 'CREATE_FISCAL_PERIOD',
      resourceType: 'FiscalPeriod',
      resourceId: created?.id,
      details: { year: bounds.year, fiscalLabel: bounds.label, periodStart: bounds.periodStart, periodEnd: bounds.periodEnd },
    });

    return NextResponse.json({ success: true, data: { ...created, fiscalLabel: bounds.label } }, { status: 201 });
  } catch (error) {
    console.error('[FISCAL PERIODS POST ERROR]', error);
    return responseError(error, 'Failed to create fiscal period');
  }
}
