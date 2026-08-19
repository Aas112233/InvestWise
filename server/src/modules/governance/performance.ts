import { getDb } from '../../config/database.js';
import {
  members,
  meetings,
  meetingAttendees,
  memberPenalties,
  transactions,
  systemSettings,
  auditLogs,
} from '../../db/schema/index.js';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { NotFoundError } from '../../shared/errors.js';

export interface PerformanceBreakdown {
  memberId: string;
  name: string;
  overallScore: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  depositMetrics: {
    score: number;
    weight: number;
    evaluatedMonths: number;
    onTimeMonths: number;
    lateMonths: number;
    missedMonths: number;
  };
  attendanceMetrics: {
    score: number;
    weight: number;
    totalCompletedMeetings: number;
    presentCount: number;
    excusedCount: number;
    absentCount: number;
  };
  penaltyMetrics: {
    activePenaltiesCount: number;
    totalDeductionPoints: number;
    tierBreakdown: { tier1: number; tier2: number; tier3: number; tier4: number };
  };
}

function resolveGrade(score: number): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export async function calculateMemberPerformance(
  memberId: string,
  evaluationMonths: number = 6,
): Promise<PerformanceBreakdown> {
  const db = getDb();

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) throw new NotFoundError('Member');

  const [settings] = await db.select().from(systemSettings).limit(1);
  const depositDueDate = settings?.depositDueDate ?? 10;
  const gracePeriodDays = settings?.gracePeriodDays ?? 3;
  const shareValue = Number(settings?.shareValueBdt ?? 1000);
  const requiredMonthlyAmount = shareValue * Math.max(1, Number(member.shares || 1));

  const now = new Date();
  const joinDate = member.joinDate ? new Date(member.joinDate) : new Date(now.getFullYear(), 0, 1);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. DEPOSIT PUNCTUALITY (60% Weight) — Single window query
  // ─────────────────────────────────────────────────────────────────────────
  let onTimeMonths = 0;
  let lateMonths = 0;
  let missedMonths = 0;
  let evaluatedMonths = 0;

  const windowStartDate = new Date(now.getFullYear(), now.getMonth() - evaluationMonths, 1);
  const windowDeposits = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.memberId, memberId),
        eq(transactions.type, 'Deposit'),
        inArray(transactions.status, ['Completed']),
        eq(transactions.isDeleted, false),
        sql`${transactions.date} >= ${windowStartDate.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(transactions.date);

  for (let i = 0; i < evaluationMonths; i++) {
    const monthTargetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);

    // If month is prior to member's join month, stop evaluating older months
    if (
      monthTargetDate.getFullYear() < joinDate.getFullYear() ||
      (monthTargetDate.getFullYear() === joinDate.getFullYear() &&
        monthTargetDate.getMonth() < joinDate.getMonth())
    ) {
      break;
    }

    evaluatedMonths++;
    const year = monthTargetDate.getFullYear();
    const month = monthTargetDate.getMonth();

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const deadlineDate = new Date(year, month, Math.min(28, depositDueDate + gracePeriodDays), 23, 59, 59, 999);

    const monthDeposits = windowDeposits.filter((d) => {
      const dDate = d.date ? new Date(d.date) : new Date();
      return dDate >= startOfMonth && dDate <= endOfMonth;
    });

    const totalDeposited = monthDeposits.reduce((sum, d) => sum + Number(d.amount), 0);

    if (totalDeposited >= requiredMonthlyAmount) {
      const earliest = monthDeposits[0]?.date ? new Date(monthDeposits[0].date) : new Date();
      if (earliest <= deadlineDate) {
        onTimeMonths++;
      } else {
        lateMonths++;
      }
    } else if (totalDeposited > 0) {
      lateMonths++;
    } else {
      missedMonths++;
    }
  }

  const depositScore = evaluatedMonths > 0 ? (onTimeMonths / evaluatedMonths) * 100 : 100;

  // ─────────────────────────────────────────────────────────────────────────
  // 2. MEETING ATTENDANCE (40% Weight)
  // ─────────────────────────────────────────────────────────────────────────
  const completedMeetings = await db
    .select({
      id: meetings.id,
      meetingDate: meetings.meetingDate,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.status, 'COMPLETED'),
        sql`${meetings.meetingDate} >= ${joinDate.toISOString()}::timestamptz`,
      ),
    );

  let presentCount = 0;
  let excusedCount = 0;
  let absentCount = 0;

  if (completedMeetings.length > 0) {
    const meetingIds = completedMeetings.map((m) => m.id);

    const attendeeRows = await db
      .select()
      .from(meetingAttendees)
      .where(
        and(
          eq(meetingAttendees.memberId, memberId),
          inArray(meetingAttendees.meetingId, meetingIds),
        ),
      );

    const attendeeMap = new Map(attendeeRows.map((r) => [r.meetingId, r.attendanceStatus]));

    for (const m of completedMeetings) {
      const status = attendeeMap.get(m.id) || 'ABSENT';
      if (status === 'PRESENT') {
        presentCount++;
      } else if (status === 'EXCUSED') {
        excusedCount++;
      } else {
        absentCount++;
      }
    }
  }

  const attendanceScore =
    completedMeetings.length > 0
      ? ((presentCount + excusedCount * 0.8) / completedMeetings.length) * 100
      : 100;

  // ─────────────────────────────────────────────────────────────────────────
  // 3. PENALTY POINTS DEDUCTION
  // ─────────────────────────────────────────────────────────────────────────
  const activePenalties = await db
    .select()
    .from(memberPenalties)
    .where(
      and(
        eq(memberPenalties.memberId, memberId),
        eq(memberPenalties.status, 'ACTIVE'),
      ),
    );

  const tierBreakdown = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
  let penaltyPointsDeduction = 0;

  for (const p of activePenalties) {
    if (p.tier === 1) {
      tierBreakdown.tier1++;
      penaltyPointsDeduction += 5;
    } else if (p.tier === 2) {
      tierBreakdown.tier2++;
      penaltyPointsDeduction += 10;
    } else if (p.tier === 3) {
      tierBreakdown.tier3++;
      penaltyPointsDeduction += 20;
    } else if (p.tier >= 4) {
      tierBreakdown.tier4++;
      penaltyPointsDeduction += 35;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. OVERALL SCORE
  // ─────────────────────────────────────────────────────────────────────────
  const rawScore = 0.6 * depositScore + 0.4 * attendanceScore;
  const overallScore = Math.max(0, Math.min(100, Number((rawScore - penaltyPointsDeduction).toFixed(2))));

  return {
    memberId,
    name: member.name,
    overallScore,
    grade: resolveGrade(overallScore),
    depositMetrics: {
      score: Math.round(depositScore),
      weight: 60,
      evaluatedMonths,
      onTimeMonths,
      lateMonths,
      missedMonths,
    },
    attendanceMetrics: {
      score: Math.round(attendanceScore),
      weight: 40,
      totalCompletedMeetings: completedMeetings.length,
      presentCount,
      excusedCount,
      absentCount,
    },
    penaltyMetrics: {
      activePenaltiesCount: activePenalties.length,
      totalDeductionPoints: penaltyPointsDeduction,
      tierBreakdown,
    },
  };
}

export async function recalculateMemberPerformance(memberId: string): Promise<number> {
  const db = getDb();
  const breakdown = await calculateMemberPerformance(memberId);

  await db
    .update(members)
    .set({
      performanceScore: breakdown.overallScore.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(members.id, memberId));

  return breakdown.overallScore;
}

export async function recalculateAllMembersPerformance(): Promise<{ updatedCount: number }> {
  const db = getDb();

  const activeMembers = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.status, 'active'));

  for (const m of activeMembers) {
    await recalculateMemberPerformance(m.id);
  }

  return { updatedCount: activeMembers.length };
}

export async function getGovernanceLeaderboard() {
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
    .where(eq(members.status, 'active'))
    .orderBy(desc(members.performanceScore), desc(members.shares));

  const totalMembers = rows.length;
  const avgScore = totalMembers > 0 ? rows.reduce((s, r) => s + Number(r.performanceScore ?? 100), 0) / totalMembers : 100;
  const highPerformers = rows.filter((r) => Number(r.performanceScore) >= 85).length;
  const atRisk = rows.filter((r) => Number(r.performanceScore) < 60).length;

  return {
    summary: {
      totalMembers,
      averageScore: Number(avgScore.toFixed(1)),
      highPerformersCount: highPerformers,
      atRiskCount: atRisk,
    },
    rankings: rows.map((r, idx) => {
      const scoreNum = Number(r.performanceScore ?? 100);
      return {
        rank: idx + 1,
        ...r,
        performanceScore: scoreNum,
        grade: resolveGrade(scoreNum),
      };
    }),
  };
}

export async function manuallyAdjustMemberScore(
  memberId: string,
  newScore: number,
  reason?: string,
  userId?: string,
  userName?: string,
): Promise<{ memberId: string; performanceScore: number; grade: string }> {
  const db = getDb();
  const clamped = Math.max(0, Math.min(100, Math.round(newScore * 100) / 100));

  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) throw new NotFoundError('Member');

  const previousScore = Number(member.performanceScore ?? 100);

  await db
    .update(members)
    .set({
      performanceScore: clamped.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(members.id, memberId));

  if (userId) {
    await db.insert(auditLogs).values({
      userId,
      userName: userName || 'Admin',
      action: 'MANUAL_SCORE_ADJUSTMENT',
      resourceType: 'Member',
      resourceId: memberId,
      details: {
        memberName: member.name,
        previousScore,
        newScore: clamped,
        reason: reason || 'Manual score adjustment',
      },
      status: 'SUCCESS',
    });
  }

  return {
    memberId,
    performanceScore: clamped,
    grade: resolveGrade(clamped),
  };
}
