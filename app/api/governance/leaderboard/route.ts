import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { members } from '@/db/schema/index';
import { eq, and, desc } from 'drizzle-orm';
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
      .where(and(eq(members.tenantId, tenantId), eq(members.status, 'active')))
      .orderBy(desc(members.performanceScore), desc(members.shares));

    const data = rows.map((r, idx) => {
      const score = Number(r.performanceScore ?? 100);
      return { rank: idx + 1, ...r, performanceScore: score, grade: resolveGrade(score) };
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
