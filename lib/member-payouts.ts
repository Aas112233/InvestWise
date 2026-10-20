/**
 * Suspended-member exit settlement ("payout").
 *
 * Money rules this module enforces (agreed with the product owner, 2026-10-16):
 *
 * - The payout is the member's FREE BALANCE (`members.total_contributed`, which
 *   is already net of capital invested in projects) — never shares × share
 *   value, because shares are a fixed onboarding allocation and do not track
 *   money held (see lib/shares.ts).
 * - Creating a plan RESERVES that balance in the member's favour: their balance
 *   drops to zero and the plan owns it. No cash moves yet, so the fund is
 *   untouched until a phase is actually paid. Because the balance is now zero,
 *   the existing deposit-revert rule (free balance must cover a reversal)
 *   automatically protects reserved money — no extra lock needed.
 * - Each phase moves cash only when an officer presses Pay: one 'Withdrawal'
 *   ledger row + one fund debit, in the same transaction (§12). Nothing is ever
 *   auto-posted, because the handover happens outside the app.
 * - Capital still inside an unsettled project cannot be paid from the deposit
 *   fund (that would spend other members' money). The plan stays open until the
 *   project settles; whatever the settlement credits is reserved as a top-up
 *   phase by `topUpPayoutPlan`.
 * - Shares are zeroed only when the plan COMPLETES — that is the "member exit
 *   settlement" lib/shares.ts allows as a legitimate share mutation.
 *
 * Access: `DIVIDENDS` WRITE, the grant the app already uses for disbursing to
 * members (`transferEquity` uses it too). A dedicated screen key would need
 * role defaults nobody has decided yet.
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import {
  funds,
  memberPayoutInstallments,
  memberPayoutPlans,
  members,
  projects,
  projectMembers,
  systemSettings,
  transactions,
} from '@/db/schema/index';
import { logAudit } from '@/lib/utils/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { fromCents, toCents } from '@/lib/money';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import { DEPOSIT_FUND_REQUIRED_MESSAGE, isDepositFund } from '@/lib/deposit-fund';
import { MEMBER_STATUS } from '@/lib/governance/status-rules';
import { memberDisplayName } from '@/lib/member-display';
import {
  buildPayoutSchedule,
  earliestFirstDueDate,
  type PayoutInstallmentPlan,
} from '@/lib/payout-schedule';
import { PAYOUT_INSTALLMENT_STATUS, PAYOUT_PLAN_STATUS } from '@/db/schema/member_payouts';

const ACTIVE = PAYOUT_PLAN_STATUS.ACTIVE;

interface Actor {
  id: string;
  name: string;
}

type PlanRow = typeof memberPayoutPlans.$inferSelect;
type InstallmentRow = typeof memberPayoutInstallments.$inferSelect;
/** Same structural type the fiscal guard uses, so helpers accept tx or db. */
type Queryable = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** Unique per plan+sequence, so a retry can never create a second withdrawal for one phase. */
function payoutReference(planId: string, sequence: number): string {
  return `PO-${planId.slice(0, 8)}-${String(sequence).padStart(3, '0')}`;
}

function mapPlan(plan: PlanRow, extra: Record<string, unknown> = {}) {
  return {
    id: plan.id,
    memberId: plan.memberId,
    status: plan.status,
    totalAmount: plan.totalAmount,
    paidAmount: plan.paidAmount,
    remainingAmount: fromCents(toCents(plan.totalAmount ?? '0') - toCents(plan.paidAmount ?? '0')),
    installmentCount: plan.installmentCount,
    intervalMonths: plan.intervalMonths,
    firstDueDate: plan.firstDueDate,
    sourceFundId: plan.sourceFundId,
    reason: plan.reason,
    createdAt: plan.createdAt,
    cancelledAt: plan.cancelledAt,
    cancelReason: plan.cancelReason,
    ...extra,
  };
}

function mapInstallment(row: InstallmentRow) {
  return {
    id: row.id,
    sequence: row.sequence,
    dueDate: row.dueDate,
    amount: row.amount,
    status: row.status,
    paidAt: row.paidAt,
    transactionId: row.transactionId,
  };
}

/**
 * Does this member still have capital parked in a project that has not been
 * settled? `projects.is_locked` is flipped once by settle-and-close and never
 * cleared, and project deletion removes the membership rows — so an unlocked
 * membership is exactly "money still inside a live project".
 */
async function openProjectCapitalExists(
  executor: Queryable,
  tenantId: string,
  memberId: string,
): Promise<boolean> {
  const [hit] = await executor
    .select({ id: projectMembers.memberId })
    .from(projectMembers)
    .innerJoin(projects, and(eq(projects.id, projectMembers.projectId), eq(projects.tenantId, tenantId)))
    .where(and(eq(projectMembers.memberId, memberId), eq(projects.isLocked, false)))
    .limit(1);
  return !!hit;
}

/** Locks the fund then the member — the order every other money path uses, to avoid deadlocks. */
async function lockFundAndMember(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  tenantId: string,
  fundId: string,
  memberId: string,
) {
  const [fund] = await tx
    .select()
    .from(funds)
    .where(and(eq(funds.id, fundId), eq(funds.tenantId, tenantId)))
    .for('update')
    .limit(1);
  if (!fund) throw new NotFoundError('Fund');

  const [member] = await tx
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId), eq(members.isDeleted, false)))
    .for('update')
    .limit(1);
  if (!member) throw new NotFoundError('Member');

  return { fund, member };
}

export interface CreatePayoutPlanInput {
  tenantId: string;
  user: Actor;
  memberId: string;
  sourceFundId: string;
  installmentCount: number;
  intervalMonths: number;
  firstDueDate: Date;
  reason: string;
}

/**
 * Creates a payout plan for a SUSPENDED member and reserves their whole free
 * balance for it. The reserved amount is decided by the ledger, not typed in:
 * that removes the entire class of "paid more than the member holds".
 */
export async function createPayoutPlan(input: CreatePayoutPlanInput) {
  const db = getDb();
  const now = new Date();

  let plan: PlanRow;
  let installments: PayoutInstallmentPlan[];
  let reservedCents: number;
  let memberName: string | null;

  try {
    const result = await db.transaction(async (tx) => {
      const { fund, member } = await lockFundAndMember(tx, input.tenantId, input.sourceFundId, input.memberId);

      if (!isDepositFund(fund)) {
        throw new ValidationError(DEPOSIT_FUND_REQUIRED_MESSAGE);
      }
      if (fund.status !== 'ACTIVE') {
        throw new ValidationError(`Fund is not active: ${fund.name}`);
      }
      if (member.status !== MEMBER_STATUS.SUSPENDED) {
        throw new ValidationError(
          `[Field 'member', Code: NOT_SUSPENDED] ${member.name ?? 'This member'} is not suspended. Suspend the member before settling their exit.`,
        );
      }

      const freeCents = toCents(member.totalContributed ?? '0');
      if (freeCents <= 0) {
        throw new ValidationError(
          `[Field 'member', Code: NOTHING_TO_PAY] This member holds no free balance. Money still inside a project is paid after that project is settled — settle it first, then use "Add project return".`,
        );
      }

      const [settings] = await tx
        .select({ withdrawalNoticeDays: systemSettings.withdrawalNoticeDays })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, input.tenantId))
        .limit(1);
      const noticeDays = Number(settings?.withdrawalNoticeDays ?? 0) || 0;
      const earliest = earliestFirstDueDate(now, noticeDays);
      if (input.firstDueDate.getTime() < earliest.getTime()) {
        throw new ValidationError(
          `[Field 'firstDueDate', Code: NOTICE_PERIOD_REQUIRED] The first installment must be on or after ${earliest.toISOString().slice(0, 10)} — the withdrawal notice period is ${noticeDays} day(s).`,
        );
      }

      const schedule = buildPayoutSchedule({
        totalCents: freeCents,
        installmentCount: input.installmentCount,
        intervalMonths: input.intervalMonths,
        firstDueDate: input.firstDueDate,
      });

      const [created] = await tx
        .insert(memberPayoutPlans)
        .values({
          tenantId: input.tenantId,
          memberId: member.id,
          status: ACTIVE,
          totalAmount: fromCents(freeCents),
          paidAmount: fromCents(0),
          installmentCount: schedule.length,
          intervalMonths: input.intervalMonths,
          firstDueDate: input.firstDueDate,
          sourceFundId: fund.id,
          reason: input.reason.trim(),
          createdBy: input.user.id,
          updatedBy: input.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new ValidationError('Failed to create payout plan');

      await tx.insert(memberPayoutInstallments).values(
        schedule.map((phase) => ({
          tenantId: input.tenantId,
          planId: created.id,
          sequence: phase.sequence,
          dueDate: phase.dueDate,
          amount: fromCents(phase.amountCents),
          status: PAYOUT_INSTALLMENT_STATUS.SCHEDULED,
          createdBy: input.user.id,
          updatedBy: input.user.id,
          createdAt: now,
          updatedAt: now,
        })),
      );

      // Reserve: the balance becomes the plan's obligation, not spendable money.
      await tx
        .update(members)
        .set({ totalContributed: fromCents(0), updatedAt: now })
        .where(and(eq(members.id, member.id), eq(members.tenantId, input.tenantId)));

      return { created, schedule, member, freeCents };
    });

    plan = result.created;
    installments = result.schedule;
    reservedCents = result.freeCents;
    memberName = result.member.name ?? null;
  } catch (err: any) {
    // The partial unique index on (member_id) WHERE status = 'ACTIVE' is the
    // race guard; translate its violation into the same 409 the pre-check gives.
    if (err?.code === '23505') {
      throw new ConflictError('This member already has an open payout plan. Cancel it before creating another.');
    }
    throw err;
  }

  await logAudit({
    user: { id: input.user.id, name: input.user.name },
    tenantId: input.tenantId,
    action: 'CREATE_PAYOUT_PLAN',
    resourceType: 'MemberPayout',
    resourceId: plan.id,
    details: {
      memberId: plan.memberId,
      memberName,
      reservedAmount: fromCents(reservedCents),
      installmentCount: installments.length,
      intervalMonths: plan.intervalMonths,
      firstDueDate: plan.firstDueDate,
      sourceFundId: plan.sourceFundId,
      reason: plan.reason,
    },
    before: { totalContributed: fromCents(reservedCents) },
    after: { totalContributed: fromCents(0), planId: plan.id, status: ACTIVE },
  });

  return { plan: mapPlan(plan), installments };
}

export interface PayInstallmentInput {
  tenantId: string;
  user: Actor;
  planId: string;
}

/**
 * Pays the oldest unpaid phase: one 'Withdrawal' ledger row plus the fund debit,
 * atomically. Only ever the LOWEST unpaid sequence, so phases cannot run ahead
 * of the agreed schedule.
 */
export async function payPayoutInstallment(input: PayInstallmentInput) {
  const db = getDb();
  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(memberPayoutPlans)
      .where(and(eq(memberPayoutPlans.id, input.planId), eq(memberPayoutPlans.tenantId, input.tenantId)))
      .for('update')
      .limit(1);
    if (!plan) throw new NotFoundError('Payout plan');
    if (plan.status !== ACTIVE) {
      throw new ConflictError(`This payout plan is ${plan.status} and cannot be paid.`);
    }

    const { fund, member } = await lockFundAndMember(tx, input.tenantId, plan.sourceFundId, plan.memberId);

    const [phase] = await tx
      .select()
      .from(memberPayoutInstallments)
      .where(
        and(
          eq(memberPayoutInstallments.planId, plan.id),
          eq(memberPayoutInstallments.status, PAYOUT_INSTALLMENT_STATUS.SCHEDULED),
        ),
      )
      .orderBy(asc(memberPayoutInstallments.sequence))
      .for('update')
      .limit(1);
    if (!phase) throw new ConflictError('Every installment of this plan is already paid.');

    const amountCents = toCents(phase.amount ?? '0');
    const fundBalanceCents = toCents(fund.balance ?? '0');
    const minReserveCents = toCents(fund.minimumBalance ?? '0');
    const fundAfterCents = fundBalanceCents - amountCents;
    if (fundAfterCents < minReserveCents) {
      throw new ValidationError(
        `Cannot pay this installment: paying ${fromCents(amountCents)} would drop ${fund.name} below its minimum reserve (${fromCents(minReserveCents)}). Move money in, or reschedule the plan.`,
      );
    }

    // A payout removes a completed money movement from the period, so it is
    // serialized against fiscal close like any other posting.
    await assertFiscalPeriodOpen(tx, input.tenantId, now);

    const [ledgerRow] = await tx
      .insert(transactions)
      .values({
        tenantId: input.tenantId,
        type: 'Withdrawal',
        amount: fromCents(amountCents),
        description: `Member payout ${memberDisplayName(member.name, member.status)} — installment ${phase.sequence} of ${plan.installmentCount}: ${plan.reason}`,
        category: 'Member Payout',
        referenceNumber: payoutReference(plan.id, phase.sequence),
        date: now,
        submittedDate: now,
        status: 'Completed',
        memberId: member.id,
        projectId: null,
        fundId: fund.id,
        handlingOfficer: input.user.name,
        authorizedBy: input.user.id,
        createdBy: input.user.id,
        updatedBy: input.user.id,
        balanceBefore: fromCents(fundBalanceCents),
        balanceAfter: fromCents(fundAfterCents),
      })
      .returning();
    if (!ledgerRow) throw new ValidationError('Failed to record the payout withdrawal.');

    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric - ${amountCents / 100})::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, fund.id), eq(funds.tenantId, input.tenantId)));

    await tx
      .update(memberPayoutInstallments)
      .set({
        status: PAYOUT_INSTALLMENT_STATUS.PAID,
        paidAt: now,
        transactionId: ledgerRow.id,
        updatedBy: input.user.id,
        updatedAt: now,
      })
      .where(eq(memberPayoutInstallments.id, phase.id));

    const paidAfterCents = toCents(plan.paidAmount ?? '0') + amountCents;
    const [remaining] = await tx
      .select({ n: count() })
      .from(memberPayoutInstallments)
      .where(
        and(
          eq(memberPayoutInstallments.planId, plan.id),
          eq(memberPayoutInstallments.status, PAYOUT_INSTALLMENT_STATUS.SCHEDULED),
        ),
      );
    const memberFreeCents = toCents(member.totalContributed ?? '0');
    const stillInProject = await openProjectCapitalExists(tx, input.tenantId, member.id);
    const completes =
      Number(remaining?.n ?? 0) === 0 && memberFreeCents === 0 && !stillInProject;

    await tx
      .update(memberPayoutPlans)
      .set({
        paidAmount: fromCents(paidAfterCents),
        status: completes ? PAYOUT_PLAN_STATUS.COMPLETED : ACTIVE,
        updatedBy: input.user.id,
        updatedAt: now,
      })
      .where(eq(memberPayoutPlans.id, plan.id));

    if (completes) {
      // The exit settlement is the one legitimate share mutation (lib/shares.ts):
      // a settled-out member keeps no ownership in the organisation.
      await tx
        .update(members)
        .set({ shares: 0, updatedAt: now })
        .where(and(eq(members.id, member.id), eq(members.tenantId, input.tenantId)));
    }

    return {
      plan,
      phase,
      fund,
      member,
      ledgerRow,
      amountCents,
      fundAfterCents,
      paidAfterCents,
      completes,
      stillInProject,
    };
  });

  await logAudit({
    user: { id: input.user.id, name: input.user.name },
    tenantId: input.tenantId,
    action: 'PAY_PAYOUT_INSTALLMENT',
    resourceType: 'MemberPayout',
    resourceId: outcome.plan.id,
    details: {
      memberId: outcome.member.id,
      memberName: outcome.member.name,
      installment: outcome.phase.sequence,
      of: outcome.plan.installmentCount,
      amount: fromCents(outcome.amountCents),
      fund: outcome.fund.name,
      fundBalanceAfter: fromCents(outcome.fundAfterCents),
      transactionId: outcome.ledgerRow.id,
      referenceNumber: outcome.ledgerRow.referenceNumber,
      planStatusAfter: outcome.completes ? PAYOUT_PLAN_STATUS.COMPLETED : ACTIVE,
      awaitingProjectSettlement: !outcome.completes && outcome.stillInProject,
    },
  });

  return {
    planId: outcome.plan.id,
    // The row was read before the update, so report the state it was written to.
    installment: {
      ...mapInstallment(outcome.phase),
      status: PAYOUT_INSTALLMENT_STATUS.PAID,
      paidAt: now,
      transactionId: outcome.ledgerRow.id,
    },
    transactionId: outcome.ledgerRow.id,
    fundBalance: fromCents(outcome.fundAfterCents),
    paidAmount: fromCents(outcome.paidAfterCents),
    completed: outcome.completes,
    awaitingProjectSettlement: !outcome.completes && outcome.stillInProject,
  };
}

/**
 * Reserves money the member earned AFTER the plan was created (a settled
 * project's return lands on their balance) and adds it as one more phase, due
 * immediately. Without this, a member whose capital was inside a project could
 * never be fully paid.
 */
export async function topUpPayoutPlan(input: { tenantId: string; user: Actor; planId: string }) {
  const db = getDb();
  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(memberPayoutPlans)
      .where(and(eq(memberPayoutPlans.id, input.planId), eq(memberPayoutPlans.tenantId, input.tenantId)))
      .for('update')
      .limit(1);
    if (!plan) throw new NotFoundError('Payout plan');
    if (plan.status !== ACTIVE) {
      throw new ConflictError(`This payout plan is ${plan.status}; it can no longer be topped up.`);
    }

    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, plan.memberId), eq(members.tenantId, input.tenantId)))
      .for('update')
      .limit(1);
    if (!member) throw new NotFoundError('Member');

    const freeCents = toCents(member.totalContributed ?? '0');
    if (freeCents <= 0) {
      throw new ConflictError('This member has no balance left to add — the plan already covers everything they hold.');
    }

    const [last] = await tx
      .select({ sequence: memberPayoutInstallments.sequence })
      .from(memberPayoutInstallments)
      .where(eq(memberPayoutInstallments.planId, plan.id))
      .orderBy(sql`${memberPayoutInstallments.sequence} DESC`)
      .limit(1);
    const sequence = Number(last?.sequence ?? 0) + 1;

    const [phase] = await tx
      .insert(memberPayoutInstallments)
      .values({
        tenantId: input.tenantId,
        planId: plan.id,
        sequence,
        dueDate: now,
        amount: fromCents(freeCents),
        status: PAYOUT_INSTALLMENT_STATUS.SCHEDULED,
        createdBy: input.user.id,
        updatedBy: input.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!phase) throw new ValidationError('Failed to add the top-up installment.');

    await tx
      .update(memberPayoutPlans)
      .set({
        totalAmount: sql`(${memberPayoutPlans.totalAmount}::numeric + ${freeCents / 100})::numeric(15,2)`,
        installmentCount: sequence,
        updatedBy: input.user.id,
        updatedAt: now,
      })
      .where(eq(memberPayoutPlans.id, plan.id));

    await tx
      .update(members)
      .set({ totalContributed: fromCents(0), updatedAt: now })
      .where(and(eq(members.id, member.id), eq(members.tenantId, input.tenantId)));

    return { plan, member, phase, freeCents };
  });

  await logAudit({
    user: { id: input.user.id, name: input.user.name },
    tenantId: input.tenantId,
    action: 'TOP_UP_PAYOUT_PLAN',
    resourceType: 'MemberPayout',
    resourceId: outcome.plan.id,
    details: {
      memberId: outcome.member.id,
      memberName: outcome.member.name,
      addedAmount: fromCents(outcome.freeCents),
      installment: outcome.phase.sequence,
      source: 'Project settlement credited after the plan was created',
    },
  });

  return { planId: outcome.plan.id, installment: mapInstallment(outcome.phase), addedAmount: fromCents(outcome.freeCents) };
}

/**
 * Cancels an open plan and hands the unpaid remainder back to the member.
 * Phases already paid stay in the ledger — a cancel is never a rewind of money
 * that changed hands.
 */
export async function cancelPayoutPlan(input: {
  tenantId: string;
  user: Actor;
  planId: string;
  reason: string;
}) {
  const db = getDb();
  const now = new Date();

  const outcome = await db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(memberPayoutPlans)
      .where(and(eq(memberPayoutPlans.id, input.planId), eq(memberPayoutPlans.tenantId, input.tenantId)))
      .for('update')
      .limit(1);
    if (!plan) throw new NotFoundError('Payout plan');
    if (plan.status !== ACTIVE) {
      throw new ConflictError(`This payout plan is ${plan.status} and cannot be cancelled.`);
    }

    const [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.id, plan.memberId), eq(members.tenantId, input.tenantId)))
      .for('update')
      .limit(1);
    if (!member) throw new NotFoundError('Member');

    const unpaidCents = toCents(plan.totalAmount ?? '0') - toCents(plan.paidAmount ?? '0');

    await tx
      .update(memberPayoutInstallments)
      .set({ status: PAYOUT_INSTALLMENT_STATUS.CANCELLED, updatedBy: input.user.id, updatedAt: now })
      .where(
        and(
          eq(memberPayoutInstallments.planId, plan.id),
          eq(memberPayoutInstallments.status, PAYOUT_INSTALLMENT_STATUS.SCHEDULED),
        ),
      );

    await tx
      .update(memberPayoutPlans)
      .set({
        status: PAYOUT_PLAN_STATUS.CANCELLED,
        cancelledAt: now,
        cancelReason: input.reason.trim(),
        updatedBy: input.user.id,
        updatedAt: now,
      })
      .where(eq(memberPayoutPlans.id, plan.id));

    if (unpaidCents > 0) {
      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${unpaidCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(members.id, member.id), eq(members.tenantId, input.tenantId)));
    }

    return { plan, member, unpaidCents };
  });

  await logAudit({
    user: { id: input.user.id, name: input.user.name },
    tenantId: input.tenantId,
    action: 'CANCEL_PAYOUT_PLAN',
    resourceType: 'MemberPayout',
    resourceId: outcome.plan.id,
    details: {
      memberId: outcome.member.id,
      memberName: outcome.member.name,
      returnedToMember: fromCents(outcome.unpaidCents),
      paidBeforeCancel: outcome.plan.paidAmount,
      reason: input.reason.trim(),
    },
  });

  return {
    planId: outcome.plan.id,
    returnedToMember: fromCents(outcome.unpaidCents),
    status: PAYOUT_PLAN_STATUS.CANCELLED,
  };
}

export interface PayoutListParams {
  tenantId: string;
  page: number;
  limit: number;
  search?: string | null;
  status?: string | null;
  memberId?: string | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Tenant-scoped plan list with member/fund labels and phase progress. */
export async function listPayoutPlans(params: PayoutListParams) {
  const db = getDb();
  const skip = (params.page - 1) * params.limit;

  const conditions = [eq(memberPayoutPlans.tenantId, params.tenantId)];
  if (params.status && params.status !== 'All') {
    conditions.push(eq(memberPayoutPlans.status, params.status));
  }
  if (params.memberId) {
    conditions.push(eq(memberPayoutPlans.memberId, params.memberId));
  }
  if (params.search) {
    const like = `%${params.search.trim()}%`;
    conditions.push(
      sql`(EXISTS (SELECT 1 FROM ${members} mm WHERE mm.id = ${memberPayoutPlans.memberId}
        AND mm.tenant_id = ${params.tenantId}
        AND (mm.name ILIKE ${like} OR mm.member_id ILIKE ${like}))
        OR ${memberPayoutPlans.reason} ILIKE ${like})`,
    );
  }
  const whereClause = and(...conditions);

  const SORT_COLUMNS: Record<string, unknown> = {
    createdAt: memberPayoutPlans.createdAt,
    totalAmount: memberPayoutPlans.totalAmount,
    firstDueDate: memberPayoutPlans.firstDueDate,
    status: memberPayoutPlans.status,
    memberName: members.name,
  };
  const sortColumn = (SORT_COLUMNS[params.sortBy ?? 'createdAt'] as typeof memberPayoutPlans.createdAt)
    ?? memberPayoutPlans.createdAt;
  // Any column a header offers is sortable, including the joined member name.
  const direction = params.sortOrder === 'asc' ? asc : desc;

  const [totalRes, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memberPayoutPlans)
      .where(whereClause),
    db
      .select({
        plan: memberPayoutPlans,
        memberName: members.name,
        memberCode: members.memberId,
        memberStatus: members.status,
        fundName: funds.name,
      })
      .from(memberPayoutPlans)
      .leftJoin(members, and(eq(members.id, memberPayoutPlans.memberId), eq(members.tenantId, params.tenantId)))
      .leftJoin(funds, and(eq(funds.id, memberPayoutPlans.sourceFundId), eq(funds.tenantId, params.tenantId)))
      .where(whereClause)
      .orderBy(direction(sortColumn as any), desc(memberPayoutPlans.createdAt))
      .limit(params.limit)
      .offset(skip),
  ]);

  const planIds = rows.map((r) => r.plan.id);
  const phases = planIds.length
    ? await db
        .select({
          planId: memberPayoutInstallments.planId,
          sequence: memberPayoutInstallments.sequence,
          dueDate: memberPayoutInstallments.dueDate,
          amount: memberPayoutInstallments.amount,
          status: memberPayoutInstallments.status,
          paidAt: memberPayoutInstallments.paidAt,
          transactionId: memberPayoutInstallments.transactionId,
          id: memberPayoutInstallments.id,
        })
        .from(memberPayoutInstallments)
        .where(inArray(memberPayoutInstallments.planId, planIds))
        .orderBy(asc(memberPayoutInstallments.planId), asc(memberPayoutInstallments.sequence))
    : [];

  const byPlan = new Map<string, InstallmentRow[]>();
  for (const phase of phases) {
    const list = byPlan.get(phase.planId) ?? [];
    list.push(phase as InstallmentRow);
    byPlan.set(phase.planId, list);
  }

  const now = new Date();
  const data = rows.map((r) => {
    const list = byPlan.get(r.plan.id) ?? [];
    const scheduled = list.filter((p) => p.status === PAYOUT_INSTALLMENT_STATUS.SCHEDULED);
    const next = scheduled[0];
    return mapPlan(r.plan, {
      memberName: r.memberName,
      memberCode: r.memberCode,
      memberStatus: r.memberStatus,
      fundName: r.fundName,
      installments: list.map(mapInstallment),
      scheduledCount: scheduled.length,
      // Drives the "due now" badge; phases are never auto-paid, so due simply
      // means "an officer can press Pay".
      nextDue: next ? { ...mapInstallment(next), isDue: next.dueDate.getTime() <= now.getTime() } : null,
    });
  });

  return { data, total: Number(totalRes[0]?.count ?? 0), page: params.page, limit: params.limit };
}

/** One plan with its phases, member and fund labels. */
export async function getPayoutPlan(tenantId: string, planId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      plan: memberPayoutPlans,
      memberName: members.name,
      memberCode: members.memberId,
      memberStatus: members.status,
      memberFreeBalance: members.totalContributed,
      fundName: funds.name,
    })
    .from(memberPayoutPlans)
    .leftJoin(members, and(eq(members.id, memberPayoutPlans.memberId), eq(members.tenantId, tenantId)))
    .leftJoin(funds, and(eq(funds.id, memberPayoutPlans.sourceFundId), eq(funds.tenantId, tenantId)))
    .where(and(eq(memberPayoutPlans.id, planId), eq(memberPayoutPlans.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError('Payout plan');

  const installments = await db
    .select()
    .from(memberPayoutInstallments)
    .where(eq(memberPayoutInstallments.planId, planId))
    .orderBy(asc(memberPayoutInstallments.sequence));

  return mapPlan(row.plan, {
    memberName: row.memberName,
    memberCode: row.memberCode,
    memberStatus: row.memberStatus,
    memberFreeBalance: row.memberFreeBalance,
    fundName: row.fundName,
    awaitingProjectSettlement:
      row.plan.status === ACTIVE && toCents(row.memberFreeBalance ?? '0') === 0
        ? await openProjectCapitalExists(db, tenantId, row.plan.memberId)
        : false,
    installments: installments.map(mapInstallment),
  });
}
