import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members } from '@/db/schema/index';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { ForbiddenError } from '@/lib/utils/errors';

// Ported from server/src/modules/governance/performance.ts (resolveGrade)
function resolveGrade(score: number): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: the leaderboard is derived from tenant members — fail closed without a tenant context.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const db = getDb();
    const rows = await db
      .select({
        id: members.id,
        name: members.name,
        memberId: members.memberId,
        email: members.email,
        role: members.role,
        shares: members.shares,
        avatar: members.avatar,
        warningCount: members.warningCount,
        performanceScore: members.performanceScore,
        status: members.status,
      })
      .from(members)
      // Soft-deleted members must never be ranked. A legacy row can still
      // carry status='active' after removal, so the isDeleted predicate is
      // required in addition to the status filter.
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.isDeleted, false),
        eq(members.status, 'active'),
      ))
      // NULLS LAST is not cosmetic: PostgreSQL sorts NULL first under DESC, so an
      // unscored member used to be ranked #1 AND rendered below as 100/A+ by the
      // `?? 100` fallback. An unrated member is now ranked last and reported as
      // unrated instead of being handed a top grade they never earned.
      .orderBy(
        sql`${members.performanceScore} DESC NULLS LAST`,
        sql`${members.shares} DESC`,
      );

    const data = rows.map((r, idx) => {
      // Never fabricate a score. `null` means "not yet evaluated", which is a
      // different fact from "scored 0" and must not be presented as either 100 or 0.
      const score = r.performanceScore === null || r.performanceScore === ''
        ? null
        : Number(r.performanceScore);
      return {
        rank: idx + 1,
        ...r,
        performanceScore: score,
        grade: score === null ? null : resolveGrade(score),
        unrated: score === null,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('[GOVERNANCE LEADERBOARD GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
