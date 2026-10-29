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
import {
  addMonthsToPeriodKey,
  firstEnforcedPeriodKey,
  resolveDepositDeadline,
  toPeriodKey,
  type GovernanceRules,
} from "./status-rules";
import { getGovernanceRules, resolveRequiredMonthlyCents } from "./status-service";
import { loadTenantDepositSchedule } from "../deposit-schedule/lookup";
import { resolveDepositScheduleDetailed } from "../deposit-schedule/schedule";

export interface PerformanceBreakdown {
  memberId: string;
  name: string;
  overallScore: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  /**
   * 'MONTHLY_PUNCTUALITY' — the 60% deposit-punctuality weight applies.
   * 'NOT_APPLICABLE'  — the member is on a FLEXIBLE deposit schedule, carries no
   * monthly obligation, and is therefore rated on attendance alone (penalties are
   * still deducted). Reporting a fabricated 0 here would grade a fully compliant
   * member as failing a rule that does not apply to them; reporting 100 would
   * credit them for something never required. Neither is honest, so the value is
   * null and the basis is stated.
   */
  depositRating: "MONTHLY_PUNCTUALITY" | "NOT_APPLICABLE";
  depositMetrics: {
    /** null when the member's schedule does not rate deposits (see `depositRating`). */
    score: number | null;
    /** 60 when rated; null when the deposit weight is removed and attendance is 100%. */
    weight: 60 | null;
    evaluatedMonths: number;
    onTimeMonths: number;
    lateMonths: number;
    missedMonths: number;
  };
  attendanceMetrics: {
    score: number;
    /**
     * 40 when punctuality is rated; 100 when it is not. Attendance carries the whole grade for a
     * member whose deposit punctuality cannot be measured, and the breakdown said `40` either way —
     * which read as "the other 60 points exist somewhere" on the governance screen.
     */
    weight: 40 | 100;
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
      depositFrequency: members.depositFrequency,
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

  /**
   * H1 — a FLEXIBLE member carries no monthly deposit obligation, so punctuality
   * must not be measured for them. Before this guard the scoring engine read only
   * `shares` / `monthlyDepositTarget` and never `depositFrequency`, so a member who
   * deposited faithfully every week was graded on a target they were never required
   * to hit: `depositScore` 0 ⇒ overall ≤ 40 ⇒ grade D/F written to their record.
   * The governance sweep already honoured this exemption (`status-service.ts:612`);
   * scoring was the one module that had been forgotten.
   */
  const { tenantSchedule, depositScheduleChangedAt } = await loadTenantDepositSchedule(db, tenantId);
  const depositSchedule = resolveDepositScheduleDetailed({
    tenantSchedule,
    memberDepositFrequency: member.depositFrequency,
  });
  const depositEnforced = depositSchedule.enforced;

  const joinDate = member.joinDate ?? new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  const months = Math.max(1, Math.min(36, Math.trunc(evaluationMonths)));

  /**
   * Earliest month scoring may charge an obligation in — the same helper the governance sweep uses,
   * so a tenant that switched from flexible to monthly cannot be graded on months it never
   * required anyone to pay into.
   *
   * Computed from `months` (the window the loop below actually walks) rather than the raw
   * `evaluationMonths` argument: a floor derived from a wider window can land earlier than the loop
   * start and silently stop clamping anything.
   */
  const scoringFloorPeriodKey = firstEnforcedPeriodKey({
    asOfPeriodKey: toPeriodKey(asOf),
    windowMonths: months,
    depositSchedule: tenantSchedule,
    changedAt: depositScheduleChangedAt,
  });

  // ── 1. Deposit punctuality (60%) ──────────────────────────────────────────
  const windowStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - months, 1));

  const windowDeposits = depositEnforced ? await db
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
    .orderBy(transactions.date)
    // Not enforced ⇒ no deposit rows are read at all. The scoring path for a
    // flexible member must not depend on, or be slowed by, money movement it will
    // never look at.
    : [];

  const legs = windowDeposits
    .filter((d) => d.date !== null)
    .map((d) => ({ date: new Date(d.date as Date), amountCents: toCents(d.amount) }));

  let onTimeMonths = 0;
  let lateMonths = 0;
  let missedMonths = 0;
  let evaluatedMonths = 0;

  // Flexible members are not evaluated month-by-month at all: `evaluatedMonths`
  // stays 0 and the deposit weight is dropped from the overall score below.
  for (let i = 0; depositEnforced && i < months; i += 1) {
    const periodKey = addMonthsToPeriodKey(toPeriodKey(asOf), -i);

    // Months before the member joined are not judged against them.
    if (periodKey < toPeriodKey(joinDate)) break;

    // Nor months before the tenant adopted the monthly rule. Without this, switching from
    // flexible to monthly grades a compliant member as absent for every pre-switch month in the
    // window — `missedMonths` inflates and the punctuality score collapses on a book that owed
    // nothing. `break`, not `continue`: the loop walks backwards, so everything older also falls
    // before the switch.
    if (periodKey < scoringFloorPeriodKey) break;

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
  /**
   * "Nothing was measurable" is NOT "perfectly punctual".
   *
   * `depositScore` above falls back to 100 so the arithmetic stays finite, but that fallback must
   * never buy a member 60 points of grade. It used to be reachable only for a fully flexible
   * member (already excluded by `depositEnforced`); the schedule floor makes it reachable for a
   * monthly tenant whose entire window predates its own switch, and a member who joined after the
   * window opened. All three are graded on attendance alone, exactly like the flexible path — same
   * principle as the leaderboard's NULL score (H2): an unmeasured member must not be ranked as if
   * they had been measured and excelled.
   */
  const depositMeasured = depositEnforced && evaluatedMonths > 0;

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
  // Monthly members: 60% punctuality + 40% attendance. Where punctuality cannot be measured —
  // flexible schedule, or a monthly window that lies entirely before the tenant adopted monthly,
  // or a member who joined after the window opened — the deposit weight is removed and the member
  // is graded on attendance alone. The weights RENORMALISE rather than being zero-filled, so nobody
  // is marked down for a requirement they did not have and nobody is handed 60 points for a
  // requirement that was never measured (see `depositMeasured`).
  const rawScore = depositMeasured ? 0.6 * depositScore + 0.4 * attendanceScore : attendanceScore;
  const overallScore = Math.max(0, Math.min(100, Number((rawScore - penaltyPointsDeduction).toFixed(2))));

  return {
    memberId,
    name: member.name,
    overallScore,
    grade: resolveGrade(overallScore),
    // Reported from `depositMeasured`, not `depositEnforced`: claiming MONTHLY_PUNCTUALITY with
    // zero evaluated months would tell an admin the member was measured and scored, when in fact
    // nothing was measurable — the same misreading the NULL leaderboard score fixed (H2).
    depositRating: depositMeasured ? "MONTHLY_PUNCTUALITY" : "NOT_APPLICABLE",
    depositMetrics: {
      score: depositMeasured ? Math.round(depositScore) : null,
      weight: depositMeasured ? 60 : null,
      evaluatedMonths,
      onTimeMonths,
      lateMonths,
      missedMonths,
    },
    attendanceMetrics: {
      score: Math.round(attendanceScore),
      // The weight the member's grade actually carries. Reporting a constant 40 while attendance
      // carried the whole score made an unmeasured member's grade look like it had a deposit
      // component it did not have.
      weight: depositMeasured ? 40 : 100,
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

/**
 * Recalculate every ACTIVE member in one tenant, in bounded pages.
 *
 * NOT monthly-only, and must not become so: a flexible member still earns an
 * attendance-based score and still carries penalty deductions, so they need
 * recalculating too. What `calculateMemberPerformance` now does per member is skip
 * the deposit-punctuality measurement for flexible schedules — skipping the whole
 * member here would freeze their score at whatever it was before the switch.
 */
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
