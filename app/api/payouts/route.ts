import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { ForbiddenError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { createPayoutPlan, listPayoutPlans } from '@/lib/member-payouts';
import { MAX_PAYOUT_INSTALLMENTS, MAX_PAYOUT_INTERVAL_MONTHS } from '@/lib/payout-schedule';

// Payouts are member exit settlements — a cash handover, not a dividend run.
// They get their own PAYOUTS screen grant so a treasurer can be allowed to
// distribute dividends without being able to settle a member out.
const READ = 'PAYOUTS';

const createSchema = z.object({
  memberId: z.string().uuid('memberId must be a valid member id'),
  sourceFundId: z.string().uuid('sourceFundId must be a valid fund id'),
  installmentCount: z.coerce.number().int().min(1).max(MAX_PAYOUT_INSTALLMENTS).default(1),
  intervalMonths: z.coerce.number().int().min(1).max(MAX_PAYOUT_INTERVAL_MONTHS).default(1),
  // Wire dates are ISO yyyy-mm-dd (§8); stored as UTC midnight.
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'firstDueDate must be YYYY-MM-DD'),
  reason: z.string().trim().min(1, 'A reason is required').max(500),
});

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, READ, 'READ')) {
      throw new ForbiddenError(`Read permission required for: ${READ}`);
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));

    const result = await listPayoutPlans({
      tenantId: scopedTenantId,
      page,
      limit,
      search: searchParams.get('search'),
      status: searchParams.get('status'),
      memberId: searchParams.get('memberId'),
      sortBy: searchParams.get('sortBy') || 'createdAt',
      sortOrder: searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc',
    });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[PAYOUTS LIST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch payout plans', code: err.code ?? 'PAYOUTS_LIST_FAILED' },
      { status: err.statusCode || 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const scopedTenantId = requireTenant(tenantId, user);
    if (!hasScreenPermission(user, READ, 'WRITE')) {
      throw new ForbiddenError(`Write permission required for: ${READ}`);
    }

    const parsed = createSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(
        `[Field '${issue?.path?.join('.') ?? 'body'}', Code: INVALID] ${issue?.message ?? 'Invalid payout plan payload'}`,
      );
    }
    const data = parsed.data;

    const result = await createPayoutPlan({
      tenantId: scopedTenantId,
      user: { id: user.id, name: user.name },
      memberId: data.memberId,
      sourceFundId: data.sourceFundId,
      installmentCount: data.installmentCount,
      intervalMonths: data.intervalMonths,
      firstDueDate: new Date(`${data.firstDueDate}T00:00:00.000Z`),
      reason: data.reason,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    console.error('[PAYOUTS CREATE ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to create payout plan', code: err.code ?? 'PAYOUT_CREATE_FAILED' },
      { status: err.statusCode || 500 },
    );
  }
}
