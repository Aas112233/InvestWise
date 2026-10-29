import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members } from '@/db/schema/index';
import { and, eq, or, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { NotFoundError } from '@/lib/utils/errors';

// GET /api/members/me — the caller's OWN member record (ports the Express
// /members/me route that never carried over to Next). Matched by the explicit
// userId link first, then the users.member_id code, then the email. This is
// identity data about the requester, so PII masking does not apply; deleted
// members are not resurrected.
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = requireTenant(user.tenantId, user);

    const conds = [eq(members.userId, user.id), eq(members.memberId, user.memberId ?? '')];
    if (user.email) conds.push(eq(members.email, user.email));

    const db = getDb();
    const [member] = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.isDeleted, false), or(...conds)))
      .orderBy(sql`CASE WHEN ${members.userId} = ${user.id} THEN 0 ELSE 1 END`)
      .limit(1);
    if (!member) throw new NotFoundError('Member profile for this login');

    return NextResponse.json({ success: true, data: member });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string; code?: string };
    return apiError(e, 'Failed to fetch member profile');
  }
}
