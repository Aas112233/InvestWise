/**
 * Member performance scoring.
 *
 * Tenant-scoped port of `server/src/modules/governance/performance.ts`. The
 * legacy implementation queries `members`, `meetings`, `meeting_attendees` and
 * `member_penalties` with NO tenant filter at all, so on a shared database it
 * scores and writes members belonging to every tenant. Every query here carries
 * `eq(<table>.tenantId, tenantId)`.
 *
 * Scoring model (unchanged from legacy, so existing scores stay comparable):
 *   deposit punctuality  60%  on-time months / evaluated months
 *   meeting attendance   40%  PRESENT=1, EXCUSED=0.8, ABSENT=0
 *   penalty points             tier1=5, tier2=10, tier3=20, tier4+=35, subtracted
 *
 * KNOWN DELIBERATE DIFFERENCE FROM GOVERNANCE COMPLIANCE
 * Punctuality here buckets a deposit by the month it LANDED, whereas
 * `status-rules.allocateDepositsToPeriods` credits a late deposit to the period
 * it SETTLES (so a January payment made in February counts for January). That
 * difference is intentional for now: the governance grace setting is new, and
 * retroactively re-grading every member's history would move published scores
 * without anyone asking. Revisit once the grace rule has run for a full cycle.
 */

import { getDb } from "@/db/index";
import { memberPenalties, members, meetingAttendees, meetings, transactions } from "@/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { toCents } from "../money";
import { NotFoundError } from "../utils/errors";
import { logAudit } from "../utils/audit";
import { addMonthsToPeriodKey, resolveDepositDeadline, toPeriodKey, type GovernanceRules } from "./status-rules";
import { getGovernanceRules, resolveRequiredMonthlyCents } from "./status-service";

export interface PerformanceBreakdown {
  memberId: string;
  name: string;
  overallScore: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  depositMetrics: {
    score: number;
    weight: 60;
    evaluatedMonths: number;
    onTimeMonths: number;
    lateMonths: number;
    missedMonths: number;
  };
  attendanceMetrics: {
    score: number;
    weight: 40;
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

export function resolveGrade(score: number): PerformanceBreakdown["grade"] {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export async function calculateMemberPerformance(
  tenantId: string,
  memberId: string,
  evaluationMonths = 6,
  asOf: Date = new Date(),
): Promise<PerformanceBreakdown> {
  const db = getDb();

  const [member] = await db
    .select({
      id: members.id,
      name: members.name,
      shares: members.shares,
      monthlyDepositTarget: members.monthlyDepositTarget,
      joinDate: members.joinDate,
    })
    .from(members)
    // §6: member must belong to the caller's tenant.
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);

  // A cross-tenant id is indistinguishable from a missing one.
  if (!member) throw new NotFoundError("Member");

  const snapshot = await getGovernanceRules(tenantId);
  const rules: GovernanceRules = snapshot.rules;
  const requiredMonthlyCents = resolveRequiredMonthlyCents(
    { shares: member.shares, monthlyDepositTarget: member.monthlyDepositTarget },
    snapshot.shareValueCents,
  );

  const joinDate = member.joinDate ?? new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  const months = Math.max(1, Math.min(36, Math.trunc(evaluationMonths)));

  // ── 1. Deposit punctuality (60%) ──────────────────────────────────────────
  const windowStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - months, 1));

  const windowDeposits = await db
    .select({ date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.memberId, memberId),
        eq(transactions.type, "Deposit"),
        inArray(transactions.status, ["Completed"]),
        // §12: soft-deleted rows never count as payment.
        eq(transactions.isDeleted, false),
        sql`${transactions.date} >= ${windowStart.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(transactions.date);

  const legs = windowDeposits
    .filter((d) => d.date !== null)
    .map((d) => ({ date: new Date(d.date as Date), amountCents: toCents(d.amount) }));

  let onTimeMonths = 0;
  let lateMonths = 0;
  let missedMonths = 0;
  let evaluatedMonths = 0;

  for (let i = 0; i < months; i += 1) {
    const periodKey = addMonthsToPeriodKey(toPeriodKey(asOf), -i);

    // Months before the member joined are not judged against them.
    if (periodKey < toPeriodKey(joinDate)) break;

    evaluatedMonths += 1;

    // Legacy buckets by the deposit's own landing month — see the header note.
    const monthLegs = legs.filter((l) => toPeriodKey(l.date) === periodKey);
    const totalCents = monthLegs.reduce((sum, l) => sum + l.amountCents, 0);
    const deadline = resolveDepositDeadline(periodKey, rules);

    if (totalCents >= requiredMonthlyCents) {
      const earliest = monthLegs[0]?.date;
      if (earliest && earliest.getTime() <= deadline.getTime()) {
        onTimeMonths += 1;
      } else {
        lateMonths += 1;
      }
    } else if (totalCents > 0) {
      lateMonths += 1;
    } else {
      missedMonths += 1;
    }
  }

  const depositScore = evaluatedMonths > 0 ? (onTimeMonths / evaluatedMonths) * 100 : 100;

  // ── 2. Meeting attendance (40%) ──────────────────────────────────────────
  const completedMeetings = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        // §6: tenant scope was missing entirely in the legacy engine.
        eq(meetings.tenantId, tenantId),
        eq(meetings.status, "COMPLETED"),
        sql`${meetings.meetingDate} >= ${new Date(joinDate).toISOString()}::timestamptz`,
      ),
    );

  let presentCount = 0;
  let excusedCount = 0;
  let absentCount = 0;

  if (completedMeetings.length > 0) {
    const meetingIds = completedMeetings.map((m) => m.id);
    const attendeeRows = await db
      .select({
        meetingId: meetingAttendees.meetingId,
        attendanceStatus: meetingAttendees.attendanceStatus,
      })
      .from(meetingAttendees)
      .where(
        and(
          // §6: tenant scope was missing in the legacy engine.
          eq(meetingAttendees.tenantId, tenantId),
          eq(meetingAttendees.memberId, memberId),
          inArray(meetingAttendees.meetingId, meetingIds),
        ),
      );

    const attendeeMap = new Map(attendeeRows.map((r) => [r.meetingId, r.attendanceStatus]));
    for (const m of completedMeetings) {
      const status = attendeeMap.get(m.id) ?? "ABSENT";
      if (status === "PRESENT") presentCount += 1;
      else if (status === "EXCUSED") excusedCount += 1;
      else absentCount += 1;
    }
  }

  const attendanceScore =
    completedMeetings.length > 0
      ? ((presentCount + excusedCount * 0.8) / completedMeetings.length) * 100
      : 100;

  // ── 3. Penalty deduction ─────────────────────────────────────────────────
  const activePenalties = await db
    .select({ tier: memberPenalties.tier })
    .from(memberPenalties)
    .where(
      and(
        // §6: tenant scope was missing in the legacy engine.
        eq(memberPenalties.tenantId, tenantId),
        eq(memberPenalties.memberId, memberId),
        eq(memberPenalties.status, "ACTIVE"),
      ),
    );

  const tierBreakdown = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
  let penaltyPointsDeduction = 0;
  for (const p of activePenalties) {
    if (p.tier === 1) {
      tierBreakdown.tier1 += 1;
      penaltyPointsDeduction += 5;
    } else if (p.tier === 2) {
      tierBreakdown.tier2 += 1;
      penaltyPointsDeduction += 10;
    } else if (p.tier === 3) {
      tierBreakdown.tier3 += 1;
      penaltyPointsDeduction += 20;
    } else {
      tierBreakdown.tier4 += 1;
      penaltyPointsDeduction += 35;
    }
  }

  // ── 4. Overall ───────────────────────────────────────────────────────────
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

export async function recalculateMemberPerformance(
  tenantId: string,
  memberId: string,
): Promise<number> {
  const db = getDb();
  const breakdown = await calculateMemberPerformance(tenantId, memberId);

  await db
    .update(members)
    .set({ performanceScore: breakdown.overallScore.toFixed(2), updatedAt: new Date() })
    // §6: tenant scope re-asserted on the write.
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)));

  return breakdown.overallScore;
}

/** Recalculate every monthly member in one tenant, in bounded pages. */
export async function recalculateAllMembersPerformance(
  tenantId: string,
): Promise<{ updatedCount: number }> {
  const db = getDb();
  const PAGE = 100;
  const updated = new Set<string>();

  for (let page = 1; ; page += 1) {
    const rows = await db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          // §6: the legacy engine had no tenant filter here and scored every
          // tenant's members.
          eq(members.tenantId, tenantId),
          eq(members.status, "active"),
        ),
      )
      .limit(PAGE)
      .offset((page - 1) * PAGE);

    if (rows.length === 0) break;
    for (const row of rows) {
      await recalculateMemberPerformance(tenantId, row.id);
      updated.add(row.id);
    }
    if (rows.length < PAGE) break;
  }

  return { updatedCount: updated.size };
}

/** Admin-initiated manual score override, always audit-logged. */
export async function manuallyAdjustMemberScore(
  tenantId: string,
  memberId: string,
  newScore: number,
  reason: string,
  actor: { id?: string; name?: string },
): Promise<{ memberId: string; performanceScore: number; grade: string }> {
  const db = getDb();
  const clamped = Math.max(0, Math.min(100, Math.round(newScore * 100) / 100));

  const [member] = await db
    .select({ name: members.name, performanceScore: members.performanceScore })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);

  if (!member) throw new NotFoundError("Member");

  const previousScore = Number(member.performanceScore ?? 100);

  await db
    .update(members)
    .set({ performanceScore: clamped.toFixed(2), updatedAt: new Date() })
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)));

  await logAudit({
    user: actor,
    tenantId,
    action: "MANUAL_SCORE_ADJUSTMENT",
    resourceType: "Member",
    resourceId: memberId,
    details: { memberName: member.name, previousScore, newScore: clamped, reason },
  });

  return { memberId, performanceScore: clamped, grade: resolveGrade(clamped) };
}
