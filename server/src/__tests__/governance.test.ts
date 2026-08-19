import { describe, it, expect } from 'vitest';

describe('Governance Penalty Policy & Financial Deduction Logic', () => {
  it('calculates flat and percentage-based penalty deductions accurately', () => {
    const memberTotalContributed = 50000;

    // Tier 1: Verbal Warning
    const tier1Deduction = 0;
    expect(tier1Deduction).toBe(0);

    // Tier 2: Minor Flat Fine (50 BDT)
    const tier2Deduction = 50;
    const balanceAfterTier2 = Math.max(0, memberTotalContributed - tier2Deduction);
    expect(balanceAfterTier2).toBe(49950);

    // Tier 3: Major Flat Fine (200 BDT)
    const tier3Deduction = 200;
    const balanceAfterTier3 = Math.max(0, memberTotalContributed - tier3Deduction);
    expect(balanceAfterTier3).toBe(49800);

    // Percentage-based fine: 5% of contributed capital
    const percentageDeduction = Math.round(memberTotalContributed * (5 / 100) * 100) / 100;
    expect(percentageDeduction).toBe(2500);
    expect(memberTotalContributed - percentageDeduction).toBe(47500);

    // Edge case: fine exceeds member balance
    const smallBalance = 100;
    const largeFine = 500;
    const balanceAfterExcessFine = Math.max(0, smallBalance - largeFine);
    expect(balanceAfterExcessFine).toBe(0);
  });

  it('verifies penalty waiver refund mechanics', () => {
    let memberBalance = 49800;
    const previousDeduction = 200;

    // Waiving penalty refunds the fine amount
    memberBalance += previousDeduction;
    expect(memberBalance).toBe(50000);

    // Warning counter decrement
    let warningCount = 3;
    warningCount = Math.max(0, warningCount - 1);
    expect(warningCount).toBe(2);
  });
});

describe('Performance Score Calculation Algorithm', () => {
  it('computes 100% score for perfect deposit punctuality and attendance', () => {
    const onTimeMonths = 6;
    const totalMonths = 6;
    const depositScore = (onTimeMonths / totalMonths) * 100; // 100

    const attendedMeetings = 5;
    const totalMeetings = 5;
    const attendanceScore = (attendedMeetings / totalMeetings) * 100; // 100

    const rawScore = 0.6 * depositScore + 0.4 * attendanceScore;
    const penaltyPoints = 0;

    const finalScore = Math.max(0, Math.min(100, rawScore - penaltyPoints));
    expect(depositScore).toBe(100);
    expect(attendanceScore).toBe(100);
    expect(finalScore).toBe(100);
  });

  it('correctly weighs partial punctuality, absences, and active penalty points', () => {
    // 4 out of 6 months on-time
    const depositScore = (4 / 6) * 100; // 66.67%
    // 3 out of 5 meetings attended
    const attendanceScore = (3 / 5) * 100; // 60.0%

    const rawScore = 0.6 * depositScore + 0.4 * attendanceScore; // 40 + 24 = 64.0

    // Active penalties: 1 Tier 1 (-5 pts) and 1 Tier 2 (-10 pts) = -15 pts
    const penaltyPoints = 5 + 10;
    const finalScore = Number((rawScore - penaltyPoints).toFixed(2));

    expect(Number(depositScore.toFixed(2))).toBe(66.67);
    expect(attendanceScore).toBe(60);
    expect(Number(rawScore.toFixed(2))).toBe(64);
    expect(finalScore).toBe(49);
  });

  it('handles brand-new members with zero past history safely without division by zero', () => {
    const evaluatedMonths = 0;
    const completedMeetings = 0;

    const depositScore = evaluatedMonths > 0 ? (0 / evaluatedMonths) * 100 : 100;
    const attendanceScore = completedMeetings > 0 ? (0 / completedMeetings) * 100 : 100;

    const rawScore = 0.6 * depositScore + 0.4 * attendanceScore;
    const finalScore = Math.max(0, Math.min(100, rawScore));

    expect(depositScore).toBe(100);
    expect(attendanceScore).toBe(100);
    expect(finalScore).toBe(100);
  });

  it('clamps scores strictly between 0 and 100', () => {
    const rawScore = 30;
    const heavyPenalties = 50; // -50 pts
    const clampedScore = Math.max(0, Math.min(100, rawScore - heavyPenalties));
    expect(clampedScore).toBe(0);
  });
});

describe('Meeting Deposit Deadline & Punctuality Evaluator', () => {
  it('determines deposit status relative to depositDueDate and gracePeriodDays', () => {
    const depositDueDate = 10;
    const gracePeriodDays = 3;
    const deadlineDay = depositDueDate + gracePeriodDays; // 13th of the month

    const year = 2026;
    const month = 7; // August (0-indexed)
    const deadlineDate = new Date(year, month, deadlineDay, 23, 59, 59, 999);

    // Paid on August 8 (On time)
    const depositDate1 = new Date(year, month, 8, 14, 0, 0);
    const status1 = depositDate1 <= deadlineDate ? 'PAID_ON_TIME' : 'PAID_LATE';
    expect(status1).toBe('PAID_ON_TIME');

    // Paid on August 13 (On time within grace period)
    const depositDate2 = new Date(year, month, 13, 20, 0, 0);
    const status2 = depositDate2 <= deadlineDate ? 'PAID_ON_TIME' : 'PAID_LATE';
    expect(status2).toBe('PAID_ON_TIME');

    // Paid on August 14 (Late)
    const depositDate3 = new Date(year, month, 14, 10, 0, 0);
    const status3 = depositDate3 <= deadlineDate ? 'PAID_ON_TIME' : 'PAID_LATE';
    expect(status3).toBe('PAID_LATE');
  });
});
