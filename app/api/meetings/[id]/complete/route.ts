import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { meetings, meetingAttendees, members, memberPenalties, systemSettings } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { NotFoundError, ForbiddenError, ValidationError, readJsonBody } from '@/lib/utils/errors';

/**
 * POST /api/meetings/[id]/complete
 *
 * Finalize a meeting: mark it COMPLETED, stamp completedAt/conductedBy, and
 * evaluate penalties for every recorded ABSENT attendee.
 *
 * This route is the target of `completeMutation` in app/meetings/page.tsx
 * ("Finalize & Complete Meeting"). The penalty evaluation runs here because the
 * meeting is the event that crystallises an absence into a sanction — doing it
 * at attendance-save time would penalise a member who is merely mid-meeting.
 *
 * Idempotent: re-completing a COMPLETED meeting does not re-issue penalties
 * (guarded by the (member_id, meeting_id) uniqueness on member_penalties).
 */

/** §6 guard: tenant business route — resolve tenantId or fail closed. */
async function requireTenantContext(request: NextRequest) {
  const { user, tenantId, error } = await getAuthContext(request);
  if (error || !user) {
    return { error: error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 }) } as const;
  }
  if (!tenantId) {
    return { error: NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 }) } as const;
  }
  return { user, tenantId } as const;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireTenantContext(request);
    if ('error' in ctx) return ctx.error;
    const { user, tenantId } = ctx;

    if (!hasScreenPermission(user, 'MEETINGS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: MEETINGS');
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    const notes: string | undefined = typeof body?.notes === 'string' ? body.notes : undefined;

    const db = getDb();

    const result = await db.transaction(async (tx) => {
      const [meeting] = await tx
        .select()
        .from(meetings)
        .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
        .limit(1);
      if (!meeting) throw new NotFoundError('Meeting');

      const alreadyCompleted = meeting.status === 'COMPLETED';

      const now = new Date();
      const [updated] = await tx
        .update(meetings)
        .set({
          status: 'COMPLETED',
          completedAt: meeting.completedAt ?? now,
          startedAt: meeting.startedAt ?? now,
          conductedBy: meeting.conductedBy ?? user.id,
          updatedBy: user.id,
          updatedAt: now,
          ...(notes !== undefined ? { notes: notes.trim() || null } : {}),
        })
        .where(and(eq(meetings.id, id), eq(meetings.tenantId, tenantId)))
        .returning();

      // Evaluate penalties for recorded absences. Tier escalates with the
      // member's existing warning count (1 verbal / 2 written / 3+ fine),
      // mirroring the governance penalty vocabulary.
      const rulesRow = await tx
        .select({ penaltyRules: systemSettings.penaltyRules })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1);
      const configured = Array.isArray(rulesRow[0]?.penaltyRules) ? rulesRow[0]!.penaltyRules : null;
      const fineAmount = (tier: number): number => {
        if (configured) {
          const rule = (configured as Array<{ tier?: number; deductionAmount?: number }>).find((r) => r?.tier === tier);
          if (rule && typeof rule.deductionAmount === 'number') return rule.deductionAmount;
        }
        return 0;
      };

      const absentees = await tx
        .select({
          memberId: meetingAttendees.memberId,
          memberName: memberDisplayNameSql,
          warningCount: members.warningCount,
        })
        .from(meetingAttendees)
        .innerJoin(
          members,
          and(eq(meetingAttendees.memberId, members.id), eq(members.tenantId, tenantId)),
        )
        .where(
          and(
            eq(meetingAttendees.meetingId, id),
            eq(meetingAttendees.tenantId, tenantId),
            eq(meetingAttendees.attendanceStatus, 'ABSENT'),
            isNotNull(meetingAttendees.memberId),
          ),
        );

      let issued = 0;
      let existing = 0;
      for (const a of absentees) {
        // Skip if a penalty for this member/meeting already exists — keeps the
        // endpoint idempotent on repeated "finalize" clicks.
        const [dupe] = await tx
          .select({ id: memberPenalties.id })
          .from(memberPenalties)
          .where(
            and(
              eq(memberPenalties.tenantId, tenantId),
              eq(memberPenalties.meetingId, id),
              eq(memberPenalties.memberId, a.memberId),
            ),
          )
          .limit(1);
        if (dupe) { existing += 1; continue; }

        const tier = Math.max(1, Math.min(3, (a.warningCount ?? 0) + 1));
        const type = tier === 1 ? 'VERBAL_WARNING' : tier === 2 ? 'WRITTEN_WARNING' : 'FINE';
        const title =
          tier === 1 ? 'Verbal warning — meeting absence'
          : tier === 2 ? 'Written warning — repeated absence'
          : 'Fine — continued absence';

        await tx.insert(memberPenalties).values({
          tenantId,
          memberId: a.memberId,
          meetingId: id,
          tier,
          type,
          title,
          reason: `Absent from “${meeting.title}” without prior excuse.`,
          calculatedDeduction: tier === 3 ? String(fineAmount(3)) : '0',
          status: 'ACTIVE',
          issuedBy: user.id,
          issuedAt: now,
        });
        issued += 1;
      }

      return { meeting: updated, beforeMeeting: meeting, issued, existing, absentees: absentees.length, alreadyCompleted };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'COMPLETE_MEETING',
      resourceType: 'Meeting',
      resourceId: id,
      details: {
        penaltiesIssued: result.issued,
        penaltiesSkipped: result.existing,
        absentees: result.absentees,
        reCompleted: result.alreadyCompleted,
      },
      // Zero extra queries: both rows come from the transaction above —
      // `beforeMeeting` (locked pre-completion row) and `meeting` (updated).
      before: result.beforeMeeting,
      after: result.meeting,
    });

    return NextResponse.json({
      success: true,
      data: result.meeting,
      message: result.alreadyCompleted
        ? 'Meeting was already completed'
        : 'Meeting finalized and penalties evaluated',
      meta: {
        penaltiesIssued: result.issued,
        penaltiesSkipped: result.existing,
        absentees: result.absentees,
      },
    });
  } catch (err: any) {
    console.error('[MEETING COMPLETE ERROR]', err);
    return apiError(err, 'Failed to finalize meeting');
  }
}
