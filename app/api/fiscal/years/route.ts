import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { fiscalPeriods } from '@/db/schema/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';

/**
 * Which fiscal years exist for this tenant and whether each is open for
 * posting.
 *
 * Deliberately readable by every authenticated member of the tenant, unlike
 * GET /api/fiscal/periods, which gates on FISCAL READ because it returns
 * recomputed ledger totals. This carries only a year and a status, and the
 * deposit forms need it: without it they can only offer years guessed from the
 * calendar, which lets a clerk pick a year that was never created or is closed
 * and then get rejected at submit.
 *
 * It narrows the UI, it never authorises a write — `assertFiscalPeriodOpen`
 * (lib/fiscal-guard.ts) is still the gate on every posting.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);

    const rows = await getDb()
      .select({ year: fiscalPeriods.year, status: fiscalPeriods.status })
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.tenantId, scopedTenantId))
      .orderBy(desc(fiscalPeriods.year));

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[FISCAL YEARS GET ERROR]', error);
    const err = error as { message?: string; statusCode?: number; code?: string };
    return NextResponse.json(
      {
        success: false,
        message: err?.message || 'Failed to fetch fiscal years',
        code: err?.code || 'INTERNAL_ERROR',
      },
      { status: err?.statusCode || 500 },
    );
  }
}
