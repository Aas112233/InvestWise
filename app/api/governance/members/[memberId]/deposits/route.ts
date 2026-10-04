import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { getMemberDepositHistory } from '@/lib/governance/status-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/governance/members/[memberId]/deposits — deposit history with a
 * per-period compliance verdict.
 *
 * `months` (default 12, max 60) bounds the window. Amounts cross the wire as
 * integer cents; the client formats for display but never recomputes the
 * verdicts, which are decided server-side.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (normalizeRole(user.role) === 'Member') {
      return NextResponse.json(
        { success: false, message: 'Insufficient permissions to view deposit history' },
        { status: 403 },
      );
    }
    // §6: fail closed without a tenant context.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const { memberId } = await params;
    const { searchParams } = new URL(request.url);
    const history = await getMemberDepositHistory(tenantId, memberId, {
      months: parseInt(searchParams.get('months') || '12', 10),
    });

    return NextResponse.json({ success: true, data: history });
  } catch (err: any) {
    console.error('[GOVERNANCE MEMBER DEPOSITS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch deposit history' },
      { status: err.statusCode || 500 },
    );
  }
}
