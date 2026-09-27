import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { memberPenalties, members, systemSettings, funds, DEFAULT_PENALTY_RULES, PenaltyRuleConfig } from '@/db/schema/index';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { logAudit } from '@/lib/utils/audit';
import { getPaginationParams, formatPaginatedResponse } from '@/lib/utils/types';
import { AppError, NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
    const tier = searchParams.get('tier');
    const status = searchParams.get('status');
    const memberId = searchParams.get('memberId');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    if (tier) {
      conditions.push(sql`${memberPenalties.tier} = ${parseInt(tier, 10)}`);
    }
    if (status) {
      conditions.push(sql`${memberPenalties.status} = ${status}`);
    }
    if (memberId) {
      conditions.push(sql`${memberPenalties.memberId} = ${memberId}`);
    }
    if (search) {
      conditions.push(sql`(${memberPenalties.title} ILIKE ${'%' + search + '%'} OR ${memberPenalties.reason} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(memberPenalties)
        .where(whereClause),
      db
        .select({
          id: memberPenalties.id,
          memberId: memberPenalties.memberId,
          memberName: members.name,
          memberCode: members.memberId,
          meetingId: memberPenalties.meetingId,
          tier: memberPenalties.tier,
          title: memberPenalties.title,
          type: memberPenalties.type,
          deductionAmount: memberPenalties.deductionAmount,
          isPercentage: memberPenalties.isPercentage,
          calculatedDeduction: memberPenalties.calculatedDeduction,
          status: memberPenalties.status,
          reason: memberPenalties.reason,
          issuedAt: memberPenalties.issuedAt,
          waivedAt: memberPenalties.waivedAt,
          waiveReason: memberPenalties.waiveReason,
          createdAt: memberPenalties.createdAt,
        })
        .from(memberPenalties)
        .leftJoin(members, eq(memberPenalties.memberId, members.id))
        .where(whereClause)
        .orderBy(desc(memberPenalties.createdAt))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[PENALTIES GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch penalties' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    if (normalizeRole(user.role) === 'Member') {
      throw new ForbiddenError('Insufficient permissions to issue penalties');
    }

    const body = await request.json();
    const { memberId, meetingId, tier, title, type, deductionAmount, isPercentage, fundId, reason } = body;

    if (!memberId || !tier || !reason) {
      throw new ValidationError('memberId, tier, and reason are required');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
      // 1. Verify member
      const [member] = await tx
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);

      if (!member) throw new NotFoundError('Member');

      // 2. Fetch penalty rules configuration
      const [settings] = await tx.select().from(systemSettings).limit(1);
      const configuredRules = (settings?.penaltyRules as PenaltyRuleConfig[] | undefined) || DEFAULT_PENALTY_RULES;
      const tierRule = configuredRules.find((r) => r.tier === tier) || {
        tier,
        title: `Tier ${tier} Penalty`,
        type: tier === 1 ? 'VERBAL_WARNING' : tier === 4 ? 'SUSPENSION' : 'FUND_DEDUCTION',
        deductionAmount: tier === 2 ? 50 : tier === 3 ? 200 : tier === 4 ? 500 : 0,
        isPercentage: false,
      };

      const penaltyType = type || tierRule.type;
      const penaltyTitle = title || tierRule.title;
      const penaltyIsPercentage = isPercentage ?? tierRule.isPercentage ?? false;
      const nominalDeduction = deductionAmount !== undefined ? deductionAmount : (tierRule.deductionAmount ?? 0);

      let calculatedDeduction = 0;
      let targetFundId = fundId || null;

      if (penaltyType === 'FUND_DEDUCTION' || (penaltyType === 'SUSPENSION' && nominalDeduction > 0)) {
        const memberContributed = Number(member.totalContributed ?? 0);
        if (penaltyIsPercentage) {
          calculatedDeduction = Math.round(memberContributed * (nominalDeduction / 100) * 100) / 100;
        } else {
          calculatedDeduction = nominalDeduction;
        }

        if (calculatedDeduction > 0) {
          if (!targetFundId) {
            const [defaultFund] = await tx
              .select({ id: funds.id })
              .from(funds)
              .where(eq(funds.status, 'ACTIVE'))
              .limit(1);
            if (defaultFund) targetFundId = defaultFund.id;
          }

          // Debit member contribution
          await tx
            .update(members)
            .set({
              totalContributed: sql<string>`GREATEST(0, (${members.totalContributed}::numeric - ${calculatedDeduction}))::numeric(15,2)`,
              warningCount: sql<number>`COALESCE(${members.warningCount}, 0) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(members.id, member.id));
        }
      } else {
        // Increment warning count
        await tx
          .update(members)
          .set({
            warningCount: sql<number>`COALESCE(${members.warningCount}, 0) + 1`,
            updatedAt: new Date(),
          })
          .where(eq(members.id, member.id));
      }

      // Insert penalty
      const [penalty] = await tx
        .insert(memberPenalties)
        .values({
          memberId,
          meetingId: meetingId || null,
          tier,
          title: penaltyTitle,
          type: penaltyType,
          deductionAmount: String(nominalDeduction),
          isPercentage: penaltyIsPercentage,
          calculatedDeduction: String(calculatedDeduction),
          fundId: targetFundId,
          status: 'ACTIVE',
          reason,
          issuedBy: user.id,
          issuedAt: new Date(),
        })
        .returning();

      return penalty;
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'ISSUE_PENALTY',
      resourceType: 'MemberPenalty',
      resourceId: result?.id,
      details: { memberId, tier, calculatedDeduction: result?.calculatedDeduction },
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Penalty issued successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[PENALTIES POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to issue penalty' },
      { status: err.statusCode || 500 }
    );
  }
}
