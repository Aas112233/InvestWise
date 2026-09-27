import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { memberPenalties, members } from '@/db/schema/index';
import { eq, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '@/lib/utils/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const callerRole = normalizeRole(user.role);
    if (callerRole !== 'Admin' && callerRole !== 'Manager' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Administrative privilege required to waive penalties');
    }

    const { id } = await params;
    const body = await request.json();
    const waiveReason = body.waiveReason || body.reason;

    if (!waiveReason || typeof waiveReason !== 'string' || waiveReason.trim().length === 0) {
      throw new ValidationError('A reason is required to waive a penalty');
    }

    const db = getDb();

    const updatedPenalty = await db.transaction(async (tx) => {
      const [penalty] = await tx
        .select()
        .from(memberPenalties)
        .where(eq(memberPenalties.id, id))
        .limit(1);

      if (!penalty) throw new NotFoundError('Penalty');
      if (penalty.status === 'WAIVED') {
        throw new ValidationError('Penalty is already waived');
      }

      const deduction = Number(penalty.calculatedDeduction || 0);

      // Restore member balance if a fund deduction was made
      if (deduction > 0) {
        await tx
          .update(members)
          .set({
            totalContributed: sql<string>`(${members.totalContributed}::numeric + ${deduction})::numeric(15,2)`,
            warningCount: sql<number>`GREATEST(0, COALESCE(${members.warningCount}, 0) - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(members.id, penalty.memberId));
      } else {
        await tx
          .update(members)
          .set({
            warningCount: sql<number>`GREATEST(0, COALESCE(${members.warningCount}, 0) - 1)`,
            updatedAt: new Date(),
          })
          .where(eq(members.id, penalty.memberId));
      }

      const [waived] = await tx
        .update(memberPenalties)
        .set({
          status: 'WAIVED',
          waivedBy: user.id,
          waivedAt: new Date(),
          waiveReason: waiveReason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(memberPenalties.id, id))
        .returning();

      return waived;
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'WAIVE_PENALTY',
      resourceType: 'MemberPenalty',
      resourceId: id,
      details: { waiveReason, restoredDeduction: updatedPenalty?.calculatedDeduction },
    });

    return NextResponse.json({
      success: true,
      data: updatedPenalty,
      message: 'Penalty waived successfully',
    });
  } catch (err: any) {
    console.error('[WAIVE PENALTY ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to waive penalty' },
      { status: err.statusCode || 500 }
    );
  }
}
