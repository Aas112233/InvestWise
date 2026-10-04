import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { MoneyError } from '@/lib/money';
import { planDividendRun } from '@/server/modules/finance/dividend-engine';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

/**
 * POST /api/dividends/calculate — preview a dividend run without writing.
 *
 * The plan comes from the same `planDividendRun` the distribution route uses,
 * so a preview cannot show one set of numbers and then pay another. Anything
 * the caller may override (reserve percent, reserve fund) is honored here and
 * honored identically there; previously this route silently ignored both, while
 * the modal offered both.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: the simulation reads funds, settings and the member
    // roster — a null tenant would otherwise enumerate every tenant's books.
    const scopedTenantId = requireTenant(tenantId, user);

    if (!hasScreenPermission(user, 'DIVIDENDS', 'READ')) {
      throw new ForbiddenError('Read permission required for: DIVIDENDS');
    }

    const body = await request.json();
    const { grossEarnings, distributableFundId, statutoryReservePercent, reserveFundId, fiscalPeriodId } = body;

    if (!grossEarnings || !distributableFundId) {
      throw new ValidationError('grossEarnings and distributableFundId are required');
    }
    if (typeof grossEarnings !== 'string' && typeof grossEarnings !== 'number') {
      throw new ValidationError('grossEarnings must be a number or numeric string');
    }

    const { plan, distributableFund, reserveFund } = await planDividendRun(scopedTenantId, {
      grossEarnings,
      distributableFundId: String(distributableFundId),
      statutoryReservePercent:
        statutoryReservePercent === undefined || statutoryReservePercent === null || statutoryReservePercent === ''
          ? null
          : String(statutoryReservePercent),
      reserveFundId: reserveFundId ? String(reserveFundId) : null,
    });

    return NextResponse.json({
      success: true,
      data: {
        grossEarnings: plan.grossAmount,
        statutoryReservePercent: plan.reservePercent,
        statutoryReserveAmount: plan.reserveAmount,
        netDistributable: plan.netDistributable,
        totalActiveShares: plan.totalActiveShares,
        ratePerShare: plan.ratePerShare,
        reserveFund: { id: reserveFund.id, name: reserveFund.name },
        distributableFund: {
          id: distributableFund.id,
          name: distributableFund.name,
          balance: distributableFund.balance,
        },
        // Contract with the distribution modal: `memberBreakdown`, keyed by
        // `memberId` (uuid) with the human-readable code in `memberIdStr`.
        memberBreakdown: plan.payouts.map((p) => ({
          memberId: p.id,
          memberIdStr: p.memberId,
          name: p.name,
          shares: p.shares,
          grossAmount: p.grossAmount,
          ratePerShare: p.ratePerShare,
        })),
        recipientCount: plan.recipientCount,
        fiscalPeriodId: fiscalPeriodId || null,
        isSimulation: true,
      },
      message: 'Dividend calculation completed (simulation)',
    });
  } catch (err: unknown) {
    console.error('[DIVIDEND CALCULATE ERROR]', err);
    const e = err as { statusCode?: number; message?: string };
    // Money validation is a 400, not a 500: a bad amount is the caller's
    // mistake and the real reason must reach the toast (§11).
    if (err instanceof MoneyError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, message: e.message || 'Failed to calculate dividend' },
      { status: e.statusCode || 500 },
    );
  }
}
