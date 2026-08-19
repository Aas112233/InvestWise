import { getDb } from '../../config/database.js';
import {
  memberPenalties,
  members,
  funds,
  transactions,
  systemSettings,
  auditLogs,
  DEFAULT_PENALTY_RULES,
  type PenaltyRuleConfig,
} from '../../db/schema/index.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { NotFoundError, AppError } from '../../shared/errors.js';
import { getPaginationParams, formatPaginatedResponse } from '../../shared/types.js';
import { recalculateMemberPerformance } from './performance.js';

export interface IssuePenaltyInput {
  memberId: string;
  meetingId?: string;
  tier: 1 | 2 | 3 | 4;
  title?: string;
  type?: 'VERBAL_WARNING' | 'FUND_DEDUCTION' | 'SUSPENSION';
  deductionAmount?: number;
  isPercentage?: boolean;
  fundId?: string;
  reason: string;
}

export interface WaivePenaltyInput {
  waiveReason: string;
}

export async function issuePenalty(data: IssuePenaltyInput, userId: string, userName: string) {
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. Lock member record
    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, data.memberId))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');

    // 2. Fetch system settings for tier rules
    const [settings] = await tx.select().from(systemSettings).limit(1);
    const configuredRules = (settings?.penaltyRules as PenaltyRuleConfig[] | undefined) || DEFAULT_PENALTY_RULES;
    const tierRule = configuredRules.find((r) => r.tier === data.tier) || configuredRules[data.tier - 1] || {
      tier: data.tier,
      title: `Tier ${data.tier} Penalty`,
      type: data.tier === 1 ? 'VERBAL_WARNING' : data.tier === 4 ? 'SUSPENSION' : 'FUND_DEDUCTION',
      deductionAmount: data.tier === 2 ? 50 : data.tier === 3 ? 200 : data.tier === 4 ? 500 : 0,
      isPercentage: false,
    };

    const penaltyType = data.type || tierRule.type;
    const penaltyTitle = data.title || tierRule.title;
    const isPercentage = data.isPercentage ?? tierRule.isPercentage ?? false;

    const nominalDeduction = data.deductionAmount !== undefined ? data.deductionAmount : (tierRule.deductionAmount ?? 0);
    let calculatedDeduction = 0;
    let transactionId: string | null = null;
    let targetFundId = data.fundId || null;

    // 3. Handle financial fund deduction
    if (penaltyType === 'FUND_DEDUCTION' || (penaltyType === 'SUSPENSION' && nominalDeduction > 0)) {
      const memberContributed = Number(member.totalContributed ?? 0);

      if (isPercentage) {
        calculatedDeduction = Math.round((memberContributed * (nominalDeduction / 100)) * 100) / 100;
      } else {
        calculatedDeduction = nominalDeduction;
      }

      if (calculatedDeduction > 0) {
        // Find default fund if none provided
        if (!targetFundId) {
          const [defaultFund] = await tx
            .select({ id: funds.id, name: funds.name })
            .from(funds)
            .where(eq(funds.status, 'ACTIVE'))
            .limit(1);

          if (defaultFund) {
            targetFundId = defaultFund.id;
          }
        }

        // Atomically debit member's totalContributed
        await tx
          .update(members)
          .set({
            totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${calculatedDeduction}))::numeric(15,2)`,
            updatedAt: new Date(),
          })
          .where(eq(members.id, member.id));

        // Create transaction record for audit/accounting
        if (targetFundId) {
          const [fundRow] = await tx
            .select()
            .from(funds)
            .where(eq(funds.id, targetFundId))
            .for('update')
            .limit(1);

          if (fundRow) {
            const fundBal = Number(fundRow.balance);
            const [txn] = await tx
              .insert(transactions)
              .values({
                type: 'Withdrawal',
                amount: calculatedDeduction.toFixed(2),
                description: `[PENALTY_TIER_${data.tier}] ${penaltyTitle}: ${data.reason}`,
                category: 'Penalty',
                memberId: member.id,
                fundId: targetFundId,
                status: 'Completed',
                handlingOfficer: userName,
                authorizedBy: userId,
                createdBy: userId,
                updatedBy: userId,
                balanceBefore: fundBal.toFixed(2),
                balanceAfter: fundBal.toFixed(2),
              })
              .returning();

            transactionId = txn.id;
          }
        }
      }
    }

    // 4. Handle member status update if suspension
    if (penaltyType === 'SUSPENSION') {
      await tx
        .update(members)
        .set({
          status: 'suspended',
          updatedAt: new Date(),
        })
        .where(eq(members.id, member.id));
    }

    // 5. Increment warning count
    await tx
      .update(members)
      .set({
        warningCount: sql<number>`${members.warningCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(members.id, member.id));

    // 6. Insert penalty record
    const [penalty] = await tx
      .insert(memberPenalties)
      .values({
        memberId: member.id,
        meetingId: data.meetingId || null,
        tier: data.tier,
        title: penaltyTitle,
        type: penaltyType,
        deductionAmount: nominalDeduction.toFixed(2),
        isPercentage,
        calculatedDeduction: calculatedDeduction.toFixed(2),
        transactionId,
        fundId: targetFundId,
        status: 'ACTIVE',
        reason: data.reason,
        issuedBy: userId,
      })
      .returning();

    // 7. Audit log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'ISSUE_PENALTY',
      resourceType: 'MemberPenalty',
      resourceId: penalty.id,
      details: {
        memberId: member.id,
        memberName: member.name,
        tier: data.tier,
        type: penaltyType,
        calculatedDeduction,
        reason: data.reason,
      },
      status: 'SUCCESS',
    });

    // 8. Recompute member performance score
    setTimeout(async () => {
      try {
        await recalculateMemberPerformance(member.id);
      } catch (err) {
        console.error('Failed to recalculate performance score post penalty:', err);
      }
    }, 50);

    return {
      ...penalty,
      calculatedDeduction,
      memberName: member.name,
      warningCount: member.warningCount + 1,
    };
  });
}

export async function waivePenalty(
  penaltyId: string,
  data: WaivePenaltyInput,
  userId: string,
  userName: string,
) {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [penalty] = await tx
      .select()
      .from(memberPenalties)
      .where(eq(memberPenalties.id, penaltyId))
      .for('update')
      .limit(1);

    if (!penalty) throw new NotFoundError('Penalty');
    if (penalty.status === 'WAIVED') {
      throw new AppError('Penalty is already waived', 400, 'PENALTY_ALREADY_WAIVED');
    }

    const [member] = await tx
      .select()
      .from(members)
      .where(eq(members.id, penalty.memberId))
      .for('update')
      .limit(1);

    if (!member) throw new NotFoundError('Member');

    // 1. If financial deduction was applied, refund to member's totalContributed
    const deducted = Number(penalty.calculatedDeduction ?? 0);
    if (deducted > 0) {
      await tx
        .update(members)
        .set({
          totalContributed: sql<string>`(${members.totalContributed}::numeric + ${deducted})::numeric(15,2)`,
          updatedAt: new Date(),
        })
        .where(eq(members.id, member.id));

      if (penalty.fundId) {
        const [fund] = await tx.select().from(funds).where(eq(funds.id, penalty.fundId)).limit(1);
        const fundBal = Number(fund?.balance ?? 0);

        await tx.insert(transactions).values({
          type: 'Deposit',
          amount: deducted.toFixed(2),
          description: `[WAIVER_REFUND] Penalty Tier ${penalty.tier} waived: ${data.waiveReason}`,
          category: 'Penalty Refund',
          memberId: member.id,
          fundId: penalty.fundId,
          status: 'Completed',
          handlingOfficer: userName,
          authorizedBy: userId,
          createdBy: userId,
          updatedBy: userId,
          balanceBefore: fundBal.toFixed(2),
          balanceAfter: fundBal.toFixed(2),
        });
      }
    }

    // 2. Decrement member warning count
    await tx
      .update(members)
      .set({
        warningCount: sql<number>`GREATEST(0, ${members.warningCount} - 1)`,
        updatedAt: new Date(),
      })
      .where(eq(members.id, member.id));

    // 3. If suspended by this penalty and no other active Tier 4 penalties exist, reinstate active status
    if (penalty.type === 'SUSPENSION') {
      const otherTier4 = await tx
        .select({ id: memberPenalties.id })
        .from(memberPenalties)
        .where(
          and(
            eq(memberPenalties.memberId, member.id),
            eq(memberPenalties.tier, 4),
            eq(memberPenalties.status, 'ACTIVE'),
            sql`${memberPenalties.id} != ${penalty.id}`,
          ),
        )
        .limit(1);

      if (otherTier4.length === 0 && member.status === 'suspended') {
        await tx
          .update(members)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(members.id, member.id));
      }
    }

    // 4. Mark penalty as WAIVED
    const [waived] = await tx
      .update(memberPenalties)
      .set({
        status: 'WAIVED',
        waivedBy: userId,
        waivedAt: new Date(),
        waiveReason: data.waiveReason,
        updatedAt: new Date(),
      })
      .where(eq(memberPenalties.id, penaltyId))
      .returning();

    // 5. Audit Log
    await tx.insert(auditLogs).values({
      userId,
      userName,
      action: 'WAIVE_PENALTY',
      resourceType: 'MemberPenalty',
      resourceId: penaltyId,
      details: {
        memberId: member.id,
        tier: penalty.tier,
        refundedAmount: deducted,
        waiveReason: data.waiveReason,
      },
      status: 'SUCCESS',
    });

    // 6. Recalculate score
    setTimeout(async () => {
      try {
        await recalculateMemberPerformance(member.id);
      } catch (err) {
        console.error('Failed to recalculate performance score post penalty waiver:', err);
      }
    }, 50);

    return waived;
  });
}

export async function listMemberPenalties(query: Record<string, string | undefined>) {
  const db = getDb();
  const { page, limit, skip } = getPaginationParams(query);

  const conditions = [];

  if (query.memberId) {
    conditions.push(eq(memberPenalties.memberId, query.memberId));
  }
  if (query.meetingId) {
    conditions.push(eq(memberPenalties.meetingId, query.meetingId));
  }
  if (query.status) {
    conditions.push(eq(memberPenalties.status, query.status));
  }
  if (query.tier) {
    conditions.push(eq(memberPenalties.tier, parseInt(query.tier, 10)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count & Paginated Rows in parallel
  const [[countResult], rows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(memberPenalties)
      .where(whereClause),
    db
      .select({
        id: memberPenalties.id,
        memberId: memberPenalties.memberId,
        meetingId: memberPenalties.meetingId,
        tier: memberPenalties.tier,
        title: memberPenalties.title,
        type: memberPenalties.type,
        deductionAmount: memberPenalties.deductionAmount,
        isPercentage: memberPenalties.isPercentage,
        calculatedDeduction: memberPenalties.calculatedDeduction,
        transactionId: memberPenalties.transactionId,
        fundId: memberPenalties.fundId,
        status: memberPenalties.status,
        reason: memberPenalties.reason,
        issuedBy: memberPenalties.issuedBy,
        issuedAt: memberPenalties.issuedAt,
        waivedBy: memberPenalties.waivedBy,
        waivedAt: memberPenalties.waivedAt,
        waiveReason: memberPenalties.waiveReason,
        createdAt: memberPenalties.createdAt,
        updatedAt: memberPenalties.updatedAt,
        memberName: members.name,
        memberDisplayId: members.memberId,
        memberEmail: members.email,
      })
      .from(memberPenalties)
      .innerJoin(members, eq(memberPenalties.memberId, members.id))
      .where(whereClause)
      .orderBy(desc(memberPenalties.createdAt))
      .limit(limit)
      .offset(skip),
  ]);

  const total = Number(countResult?.count ?? 0);

  const data = rows.map((r) => ({
    ...r,
    deductionAmount: Number(r.deductionAmount ?? 0),
    calculatedDeduction: Number(r.calculatedDeduction ?? 0),
  }));

  return formatPaginatedResponse(data, page, limit, total);
}

export async function getMemberPenaltySummary(memberId: string) {
  const db = getDb();

  const [member] = await db
    .select({
      id: members.id,
      name: members.name,
      memberId: members.memberId,
      warningCount: members.warningCount,
      performanceScore: members.performanceScore,
      status: members.status,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);

  if (!member) throw new NotFoundError('Member');

  const penalties = await db
    .select()
    .from(memberPenalties)
    .where(eq(memberPenalties.memberId, memberId))
    .orderBy(desc(memberPenalties.createdAt));

  const active = penalties.filter((p) => p.status === 'ACTIVE');
  const waived = penalties.filter((p) => p.status === 'WAIVED');
  const totalDeducted = penalties
    .filter((p) => p.status === 'ACTIVE')
    .reduce((sum, p) => sum + Number(p.calculatedDeduction ?? 0), 0);

  return {
    member,
    activePenaltiesCount: active.length,
    waivedPenaltiesCount: waived.length,
    totalDeductedAmount: Number(totalDeducted.toFixed(2)),
    penalties: penalties.map((p) => ({
      ...p,
      deductionAmount: Number(p.deductionAmount ?? 0),
      calculatedDeduction: Number(p.calculatedDeduction ?? 0),
    })),
  };
}
