import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { memberPenalties, members, meetings, systemSettings, funds, DEFAULT_PENALTY_RULES, PenaltyRuleConfig } from '@/db/schema/index';
import { memberDisplayNameSql } from '@/lib/member-display';
import { eq, and, desc, sql, ilike } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { getPaginationParams, formatPaginatedResponse } from '@/lib/utils/types';
import { AppError, NotFoundError, ValidationError, ForbiddenError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents, roundToCents, parsePositiveAmount, MoneyError } from '@/lib/money';
import { apiError } from '@/lib/utils/api-error';
import { escapeLikePattern } from '@/lib/utils/validation';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: penalties are tenant business data — fail closed without a tenant context.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    // Clamp pagination at the boundary — unbounded limit returns the whole
    // tenant penalty book plus its count in one response.
    const page = Math.min(1000, Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)); // page bounded: a huge `page` is an OFFSET walk Postgres still does
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
    const skip = (page - 1) * limit;
    const tier = searchParams.get('tier');
    const status = searchParams.get('status');
    const memberId = searchParams.get('memberId');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [
      // §6: tenant scope — never list penalties outside the caller's tenant.
      sql`${memberPenalties.tenantId} = ${tenantId}`,
    ];

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
      conditions.push(sql`(${memberPenalties.title} ILIKE ${'%' + escapeLikePattern(search) + '%'} OR ${memberPenalties.reason} ILIKE ${'%' + escapeLikePattern(search) + '%'})`);
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
          memberName: memberDisplayNameSql,
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
        .leftJoin(members, and(eq(memberPenalties.memberId, members.id), eq(members.tenantId, tenantId)))
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
    return apiError(err, 'Failed to fetch penalties');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6: penalties are tenant business data — fail closed without a tenant context.
    if (!tenantId) {
      return NextResponse.json({ success: false, message: 'Tenant context required' }, { status: 403 });
    }

    // A penalty debits members.totalContributed, so it is a money write and
    // must respect the GOVERNANCE grant rather than a bare "not a Member" test
    // (the Auditor role is read-only by baseline, lib/roles.ts).
    if (!hasScreenPermission(user, 'GOVERNANCE', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: GOVERNANCE');
    }

    const body = await readJsonBody(request);
    const { memberId, meetingId, tier, title, type, deductionAmount, isPercentage, fundId, reason } = body;

    if (!memberId || tier === undefined || tier === null || !reason) {
      throw new ValidationError('memberId, tier, and reason are required');
    }
    if (!Number.isInteger(tier) || tier < 1 || tier > 10) {
      throw new ValidationError('tier must be an integer between 1 and 10');
    }
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1000) {
      throw new ValidationError('reason must be a non-empty string of at most 1000 characters');
    }
    if (title !== undefined && title !== null && (typeof title !== 'string' || title.length > 200)) {
      throw new ValidationError('title must be a string of at most 200 characters');
    }

    const db = getDb();

    const result = await db.transaction(async (tx) => {
      // 1. Verify member (§6: must belong to the caller's tenant)
      const [member] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
        .limit(1);

      if (!member) throw new NotFoundError('Member');

      // Optional foreign keys are untrusted request input. Validate ownership
      // before inserting them; otherwise the penalty's references can cross
      // tenants even though the penalty row itself is scoped.
      if (meetingId) {
        const [meeting] = await tx
          .select({ id: meetings.id })
          .from(meetings)
          .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
          .limit(1);
        if (!meeting) throw new NotFoundError('Meeting');
      }
      if (fundId) {
        const [ownedFund] = await tx
          .select({ id: funds.id })
          .from(funds)
          .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
          .limit(1);
        if (!ownedFund) throw new NotFoundError('Fund');
      }

      // 2. Fetch penalty rules configuration (§6: scoped to the tenant's settings row)
      const [settings] = await tx
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1);
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

      // §12 money rule (audit 07 M-6): parse the nominal deduction with the
      // same cents discipline as the finance core — never float math on a raw
      // body value. Percentages are 2dp values in [0, 100] (stored as percent
      // cents: 12.5% = 1250); fixed amounts respect the global ceiling.
      let nominalCents: number;
      if (deductionAmount !== undefined && deductionAmount !== null) {
        nominalCents = parsePositiveAmount(deductionAmount, { field: 'deductionAmount', minCents: 0 });
        if (penaltyIsPercentage && nominalCents > 100_00) {
          throw new ValidationError('deductionAmount percentage cannot exceed 100');
        }
      } else {
        nominalCents = toCents(tierRule.deductionAmount ?? 0);
        if (nominalCents < 0) {
          throw new ValidationError('Configured penalty deduction cannot be negative');
        }
      }
      const nominalDeduction = fromCents(nominalCents);

      let calculatedCents = 0;
      let targetFundId = fundId || null;

      if (penaltyType === 'FUND_DEDUCTION' || (penaltyType === 'SUSPENSION' && nominalCents > 0)) {
        const memberContributedCents = toCents(member.totalContributed ?? '0');
        calculatedCents = penaltyIsPercentage
          ? roundToCents((memberContributedCents * nominalCents) / 100_00)
          : nominalCents;

        if (calculatedCents > 0) {
          const calculatedDeduction = fromCents(calculatedCents);
          if (!targetFundId) {
            const [defaultFund] = await tx
              .select({ id: funds.id })
              .from(funds)
              // §6: default fund must come from the caller's tenant
              .where(and(eq(funds.status, 'ACTIVE'), eq(funds.tenantId, tenantId)))
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
          tenantId,
          memberId,
          meetingId: meetingId || null,
          tier,
          title: penaltyTitle,
          type: penaltyType,
          deductionAmount: nominalDeduction,
          isPercentage: penaltyIsPercentage,
          calculatedDeduction: fromCents(calculatedCents),
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
      tenantId,
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: 'Penalty issued successfully',
    }, { status: 201 });
  } catch (err: any) {
    console.error('[PENALTIES POST ERROR]', err);
    // Money validation is a 400, not a 500 (same mapping as dividends).
    if (err instanceof MoneyError) {
      return NextResponse.json({ success: false, message: err.message, code: err.code }, { status: 400 });
    }
    return apiError(err, 'Failed to issue penalty');
  }
}
