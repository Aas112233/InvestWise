import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import type { getDb } from '@/db/index';
import { funds, members, projectMembers, transactions } from '@/db/schema/index';
import { toCents, fromCents, formatPercentBp, MoneyError } from '@/lib/money';

import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { assertMemberNotSuspended } from '@/lib/member-display';
import {
  PROJECT_MEMBER_ROLE,
  assertProjectTypeRoster,
  parseProjectMemberOverrideBp,
  pmCapitalCents,
  splitPmCapitalCents,
  splitPmContractBp,
  type ProjectType,
} from '@/lib/distribution-rules';

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Shared project capital movements (Option A): invested capital is deducted
 * from member deposit EQUITY and physically moved from a named source deposit
 * fund into the project's fund, with the double entry enforced in one
 * direction for invest and the exact reverse for refund. Create, re-capitalise
 * (edit) and delete all run through here so the three can never drift.
 */

export interface CapitalShareholder {
  memberId: string;
  /**
   * Share number. A Project Level Member row of an Extra Investor project holds
   * NONE (its capital is the contract, derived from the project percentage), so
   * 0 is legal for exactly those rows; every other row still needs ≥ 1.
   */
  shares: number;
  sourceFundId?: string | null;
}

export interface InvestedShareholder {
  memberId: string;
  memberName: string;
  shares: number;
  investmentCents: number;
  investmentFormatted: string;
  ownershipPercentage: string;
  memberEquityBefore: string;
  memberEquityAfter: string;
  sourceFundId: string | null;
  /**
   * Contracted capital on a Project Level Member row of an Extra Investor
   * project (migration 0032): the amount that actually left the member's fund,
   * which their share number does NOT describe. null on every club row.
   */
  pmCapitalCents: number | null;
}

interface FundLedgerRow {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  balanceCents: number;
  minimumCents: number;
  committedCents: number;
}

export interface InvestResult {
  totalCents: number;
  totalShares: number;
  shareholders: InvestedShareholder[];
  /**
   * PM contract capital actually funded (0 on a club project or a roster with no
   * PM row) and the club capital next to it: `club + contract === total`, which
   * is the line the pre-save summary and the audit trail both quote.
   */
  contractCents: number;
  clubCapitalCents: number;
}

/**
 * Validate and apply an investment allocation: deducts each member's equity,
 * debits the named source funds and credits the destination fund. Everything
 * is validated before the first write so a failure leaves no partial movement.
 */
export async function investProjectCapital(
  tx: DbTransaction,
  opts: {
    tenantId: string;
    shareValue: number;
    destinationFundId: string | null;
    /** Budget ceiling in cents; capital raised may never exceed it. */
    budgetCents: number;
    shareholders: CapitalShareholder[];
    now: Date;
    /**
     * The project being (re-)capitalised, when it already exists. Omitted on
     * create — the new project has no bindings yet, so ANY existing binding of
     * a Project Member is a violation by definition.
     */
    currentProjectId?: string | null;
    /**
     * Project type (migration 0032). Drives WHO FUNDS BY WHAT:
     *   club_level      every row is shares × share value; a Project Level
     *                   Member row is refused outright.
     *   extra_investor  every Project Level Member row funds its equal share of
     *                   `floor(budget × projectMemberPercent)` and holds no
     *                   shares; Board + Shareholder rows stay on shares and may
     *                   together fund at most `budget − contract`.
     * The amount is never taken from the client: the contract is one percentage
     * per project, so the server derives every PM obligation from it (§6 server-first).
     */
    projectType: ProjectType;
    /** `projects.project_member_percent` — the contract (extra investor only). */
    projectMemberPercent?: unknown;
  },
): Promise<InvestResult> {
  const {
    tenantId,
    shareValue,
    destinationFundId,
    budgetCents,
    shareholders,
    now,
    currentProjectId = null,
    projectType,
    projectMemberPercent = null,
  } = opts;

  const totalShares = shareholders.reduce((acc, s) => acc + s.shares, 0);

  const seenMemberIds = new Set<string>();
  for (const s of shareholders) {
    if (seenMemberIds.has(s.memberId)) {
      throw new ValidationError('Duplicate member found in project shareholder list');
    }
    seenMemberIds.add(s.memberId);
  }

  const shareholderIds = shareholders.map((s) => s.memberId).sort();
  const lockedMembers = shareholderIds.length
    ? await tx
         .select({ id: members.id, name: members.name, status: members.status, role: members.role, totalContributed: members.totalContributed })
        .from(members)
        .where(and(inArray(members.id, shareholderIds), eq(members.tenantId, tenantId)))
        .orderBy(members.id)
        .for('update')
    : [];
  const memberById = new Map(lockedMembers.map((m) => [m.id, m]));

  /* ---- Project type (migration 0032): who funds, and with what ------------
   * Roles are trustworthy only here — the member rows are locked and
   * tenant-scoped above — so the roster/type check lives in this one function
   * and the create and re-capitalise paths cannot drift apart.
   *
   * The PM contract AMOUNT is never taken from the client: it is derived here
   * from the project's budget and its one contract percentage, so a crafted
   * payload cannot fund a Project Level Member with an amount the club never
   * agreed (§6: the client only orchestrates UI state).
   * ------------------------------------------------------------------------ */
  try {
    assertProjectTypeRoster({
      projectType,
      projectMemberPercent,
      participantRoles: shareholders.map((s) => memberById.get(s.memberId)?.role ?? ''),
    });
  } catch (err) {
    // The rule owner speaks MoneyError with the §11 field format already in the
    // message; the API layer must see a 400, never a 500.
    if (err instanceof MoneyError) throw new ValidationError(err.message);
    throw err;
  }

  const pmIds = shareholders
    .filter((s) => memberById.get(s.memberId)?.role === PROJECT_MEMBER_ROLE)
    .map((s) => s.memberId)
    .sort();
  const pmBp = projectType === 'extra_investor' ? parseProjectMemberOverrideBp(projectMemberPercent) : null;
  // A contract percentage with no PM row on this roster funds nothing — the
  // ceiling below therefore always describes money that actually moves, and the
  // run (not the Save) is what refuses to DISTRIBUTE an unpayable contract.
  const contractCents = pmIds.length > 0 && pmBp !== null ? pmCapitalCents(budgetCents, pmBp) : 0;
  const contractByPm = contractCents > 0 ? splitPmCapitalCents(contractCents, pmIds) : new Map<string, number>();
  const contractBpByPm =
    pmBp !== null && pmIds.length > 0 && contractCents > 0 ? splitPmContractBp(pmBp, pmIds) : new Map<string, number>();
  const clubCeilingCents = budgetCents - contractCents;

  // Shares mean one thing per side of the contract: a PM row funds by contract
  // and holds none, everything else funds by shares and needs at least one.
  for (const s of shareholders) {
    const member = memberById.get(s.memberId);
    if (member?.role === PROJECT_MEMBER_ROLE && s.shares !== 0) {
      throw new ValidationError(
        `[Field 'shareholders.shares', Code: PM_HOLDS_NO_SHARES] '${member.name}' is a ${PROJECT_MEMBER_ROLE} and funds this project with its contract percentage, not with shares. Set its shares to 0.`,
      );
    }
    if (member?.role !== PROJECT_MEMBER_ROLE && s.shares < 1) {
      throw new ValidationError(
        `[Field 'shareholders.shares', Code: INVALID_SHARES] '${member?.name ?? s.memberId}' needs at least 1 share. Only a ${PROJECT_MEMBER_ROLE} may hold none.`,
      );
    }
  }

  // Capital that lands in no fund is capital that exists nowhere: the equity
  // and source-fund debits below would have no counter-entry (§12). The contract
  // counts here even though it buys no shares — it is real money into the fund.
  const plannedCents =
    shareholders.reduce((acc, s) => acc + toCents(s.shares * shareValue), 0) + contractCents;
  if (plannedCents > 0 && !destinationFundId) {
    throw new ValidationError(
      'Select a fund for the project capital — a project without a linked fund cannot hold an investment.',
    );
  }

  // One-project invariant (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §3.2): a
  // Project Member belongs to exactly one project and can never be invested
  // into another. Create and re-capitalise BOTH funnel through this function,
  // so this single check is the whole enforcement — project_members stays the
  // source of truth (no extra column). Rows are locked above, so a concurrent
  // second binding cannot slip between read and write.
  const projectMemberIds = shareholderIds.filter(
    (id) => memberById.get(id)?.role === PROJECT_MEMBER_ROLE,
  );
  if (projectMemberIds.length > 0) {
    const foreignBindings = await tx
      .select({ memberId: projectMembers.memberId, projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(
        currentProjectId
          ? and(inArray(projectMembers.memberId, projectMemberIds), ne(projectMembers.projectId, currentProjectId))
          : inArray(projectMembers.memberId, projectMemberIds),
      )
      .limit(1);
    if (foreignBindings.length > 0) {
      const violator = memberById.get(foreignBindings[0]!.memberId);
      throw new ValidationError(
        `'${violator?.name ?? foreignBindings[0]!.memberId}' is a ${PROJECT_MEMBER_ROLE} — it belongs to exactly ` +
          `one project and cannot invest in another. Remove it from its current project first.`,
      );
    }
  }

  // Invested capital must physically leave a deposit fund, otherwise the same
  // cash sits in the deposit fund AND the project fund and the treasury
  // overstates assets. Sources and the destination are locked together in ONE
  // deterministic-order statement.
  if (shareholders.length > 0) {
    const missingSource = shareholders.filter((s) => !s.sourceFundId);
    if (missingSource.length > 0) {
      throw new ValidationError(
        "[Field 'shareholders.sourceFundId', Code: required] Select the deposit fund each shareholder's capital is drawn from.",
      );
    }
  }

  const sourceFunds = new Map<string, FundLedgerRow>();
  const fundIdsToLock = new Set<string>();
  for (const sh of shareholders) {
    // A source equal to the destination must still be locked, or its balance
    // would be validated from a stale read.
    if (sh.sourceFundId) fundIdsToLock.add(sh.sourceFundId);
  }
  if (fundIdsToLock.size > 0 && destinationFundId) fundIdsToLock.add(destinationFundId);

  if (fundIdsToLock.size > 0) {
    const lockedFunds = await tx
      .select({
        id: funds.id,
        name: funds.name,
        status: funds.status,
        type: funds.type,
        balance: funds.balance,
        minimumBalance: funds.minimumBalance,
      })
      .from(funds)
      .where(and(inArray(funds.id, [...fundIdsToLock]), eq(funds.tenantId, tenantId)))
      .orderBy(funds.id)
      .for('update');
    for (const f of lockedFunds) {
      sourceFunds.set(f.id, {
        id: f.id,
        name: f.name,
        status: f.status,
        type: f.type,
        balanceCents: toCents(f.balance ?? '0'),
        minimumCents: toCents(f.minimumBalance ?? '0'),
        committedCents: 0,
      });
    }
  }

  let totalCents = 0;
  const processed: InvestedShareholder[] = [];

  for (const sh of shareholders) {
    const member = memberById.get(sh.memberId);
    if (!member) {
      throw new ValidationError(`Member not found: ${sh.memberId}`);
    }
    // Suspended members cannot be (re-)invested into a project — the equity
    // deduction below would move a suspended member's money into the pool.
    assertMemberNotSuspended(member, 'investing in a project');

    // A Project Level Member of an Extra Investor project funds its derived
    // contract amount; everybody else buys shares. Both are integer cents, and
    // both draw from a real fund below.
    const contractForThisPm = contractByPm.get(member.id);
    const requiredAmountCents = contractForThisPm ?? toCents(sh.shares * shareValue);
    totalCents += requiredAmountCents;

    const availableCents = toCents(member.totalContributed ?? '0');
    if (availableCents < requiredAmountCents) {
      throw new ValidationError(
        `Member '${member.name}' has insufficient deposit balance (Available: ${fromCents(availableCents)}, Required: ${fromCents(requiredAmountCents)})`,
      );
    }

    // The source must be a different fund from the destination: drawing from it
    // would credit the project fund with no matching debit anywhere.
    let sourceFundId: string | null = null;
    if (requiredAmountCents > 0) {
      const candidate = sh.sourceFundId ?? null;
      if (!candidate || candidate === destinationFundId) {
        throw new ValidationError(
          `Select a deposit fund for '${member.name}'s ${fromCents(requiredAmountCents)} investment that is different from the project's fund — capital must leave a real fund.`,
        );
      }
      const fund = sourceFunds.get(candidate);
      if (!fund) {
        throw new ForbiddenError(`Source fund does not belong to this tenant: ${candidate}`);
      }
      if ((fund.status ?? '').toUpperCase() !== 'ACTIVE') {
        throw new ValidationError(`Source fund '${fund.name}' is not active`);
      }
      if ((fund.type ?? '').toUpperCase() === 'PROJECT') {
        throw new ValidationError(
          `Source fund '${fund.name}' is a project fund. Invested capital must come from a deposit fund.`,
        );
      }
      if (fund.balanceCents - fund.committedCents - requiredAmountCents < fund.minimumCents) {
        throw new ValidationError(
          `Insufficient balance in '${fund.name}' for this investment (Available: ${fromCents(fund.balanceCents - fund.committedCents)}, Required: ${fromCents(requiredAmountCents)}, Minimum reserve: ${fromCents(fund.minimumCents)})`,
        );
      }
      fund.committedCents += requiredAmountCents;
      sourceFundId = fund.id;
    }

    processed.push({
      memberId: member.id,
      memberName: member.name,
      shares: sh.shares,
      investmentCents: requiredAmountCents,
      investmentFormatted: fromCents(requiredAmountCents),
      // A PM's stake is its slice of the contract, not a share ratio — the two
      // pots are different sizes, and one number must never describe both.
      ownershipPercentage:
        contractBpByPm.get(member.id) !== undefined
          ? formatPercentBp(contractBpByPm.get(member.id)!)
          : totalShares > 0
            ? ((sh.shares / totalShares) * 100).toFixed(2)
            : '0.00',
      memberEquityBefore: fromCents(availableCents),
      memberEquityAfter: fromCents(availableCents - requiredAmountCents),
      sourceFundId,
      pmCapitalCents: contractForThisPm ?? null,
    });
  }

  // Budget is the ceiling on capital raised: members cannot subscribe more
  // than the project declares. With a PM contract in play the same invariant
  // reads "club shares may not exceed what the contract leaves" — say so,
  // because "your shares are over budget" is misleading when the budget was
  // already spoken for by the contract.
  if (totalCents > budgetCents) {
    if (contractCents > 0) {
      throw new ValidationError(
        `Board and Shareholder capital (${fromCents(totalCents - contractCents)}) exceeds what the Project Level Member contract leaves of the budget (${fromCents(clubCeilingCents)}). Contract: ${fromCents(contractCents)} of ${fromCents(budgetCents)}.`,
      );
    }
    throw new ValidationError(
      `Total shareholder investment (${fromCents(totalCents)}) cannot exceed the project budget (${fromCents(budgetCents)}).`,
    );
  }

  // One grouped debit per source fund: it loses exactly the capital its
  // shareholders invested.
  for (const fund of sourceFunds.values()) {
    if (fund.committedCents > 0) {
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric - ${fund.committedCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, fund.id), eq(funds.tenantId, tenantId)));
    }
  }

  if (processed.length > 0) {
    // Grouped equity deduction under the locks held above. The §6 tenant
    // predicate stays in the WHERE — a VALUES join must never widen the scope.
    await tx.execute(sql`
      UPDATE ${members} AS m
      SET total_contributed = v.balance::numeric,
          updated_at = ${now.toISOString()}::timestamptz
      FROM (VALUES ${sql.join(
        processed.map((ps) => sql`(${ps.memberId}::uuid, ${ps.memberEquityAfter}::numeric)`),
        sql`, `,
      )}) AS v(id, balance)
      WHERE m.id = v.id AND m.tenant_id = ${tenantId}
    `);
  }

  if (destinationFundId && totalCents > 0) {
    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric + ${totalCents / 100})::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, destinationFundId), eq(funds.tenantId, tenantId)));
  }

  return {
    totalCents,
    totalShares,
    shareholders: processed,
    contractCents,
    clubCapitalCents: totalCents - contractCents,
  };
}

export interface RefundResult {
  refundedCents: number;
  /** Refundable capital whose source fund was never recorded (pre-0015 rows). */
  untrackedCents: number;
  shareholderCount: number;
}

/**
 * Reverse an investment allocation: restores member equity, re-credits each
 * recorded source fund and debits the destination fund. Investment ledger rows
 * are soft-deleted, never removed (§12).
 */
export async function refundProjectCapital(
  tx: DbTransaction,
  opts: {
    tenantId: string;
    projectId: string;
    destinationFundId: string | null;
    actorId: string;
    reason: string;
    /** Delete detaches the rows so the project's NO ACTION FK can be dropped. */
    detachFromProject?: boolean;
    now: Date;
  },
): Promise<RefundResult> {
  const { tenantId, projectId, destinationFundId, actorId, reason, detachFromProject = false, now } = opts;

  const legs = await tx
    .select({
      id: transactions.id,
      memberId: transactions.memberId,
      sourceFundId: transactions.sourceFundId,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(
      eq(transactions.projectId, projectId),
      eq(transactions.tenantId, tenantId),
      eq(transactions.isDeleted, false),
      eq(transactions.type, 'Project Investment'),
    ));

  let refundedCents = 0;
  let untrackedCents = 0;
  const refundByMember = new Map<string, number>();
  const refundBySourceFund = new Map<string, number>();
  for (const leg of legs) {
    const cents = toCents(leg.amount ?? '0');
    refundedCents += cents;
    if (leg.memberId) {
      refundByMember.set(leg.memberId, (refundByMember.get(leg.memberId) ?? 0) + cents);
    }
    if (leg.sourceFundId) {
      refundBySourceFund.set(leg.sourceFundId, (refundBySourceFund.get(leg.sourceFundId) ?? 0) + cents);
    } else {
      untrackedCents += cents;
    }
  }

  if (refundedCents === 0) {
    return { refundedCents: 0, untrackedCents: 0, shareholderCount: 0 };
  }

  // Debit the destination fund — the capital leaves the project. Refuse if it
  // no longer holds the amount (already spent), so a refund can never invent
  // cash. A fund the capital was never credited into (no link) is skipped.
  if (destinationFundId) {
    const [fund] = await tx
      .select({ id: funds.id, name: funds.name, balance: funds.balance })
      .from(funds)
      .where(and(eq(funds.id, destinationFundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!fund) throw new NotFoundError('Destination Fund');
    if (toCents(fund.balance ?? '0') < refundedCents) {
      throw new ValidationError(
        `Linked fund "${fund.name}" no longer holds the project capital (${fromCents(refundedCents)}); it was already spent and cannot be returned by reversing the investment.`,
      );
    }
    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric - ${refundedCents / 100})::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, destinationFundId), eq(funds.tenantId, tenantId)));
  }

  // Credit each source deposit fund back by exactly what it lost.
  // ponytail: legs recorded before migration 0015 have no source fund, so their
  // cash cannot be traced back and only equity is restored for them.
  for (const [sourceFundId, cents] of refundBySourceFund) {
    if (cents <= 0) continue;
    const [source] = await tx
      .select({ id: funds.id })
      .from(funds)
      .where(and(eq(funds.id, sourceFundId), eq(funds.tenantId, tenantId)))
      .for('update')
      .limit(1);
    if (!source) throw new NotFoundError('Source Fund');
    await tx
      .update(funds)
      .set({
        balance: sql`(${funds.balance}::numeric + ${cents / 100})::numeric(15,2)`,
        updatedAt: now,
      })
      .where(and(eq(funds.id, sourceFundId), eq(funds.tenantId, tenantId)));
  }

  const memberIds = [...refundByMember.keys()].sort();
  if (memberIds.length > 0) {
    await tx
      .select({ id: members.id })
      .from(members)
      .where(and(inArray(members.id, memberIds), eq(members.tenantId, tenantId)))
      .orderBy(members.id)
      .for('update');
    await tx.execute(sql`
      UPDATE ${members} AS m
      SET total_contributed = (m.total_contributed::numeric + v.amt::numeric)::numeric(15,2),
          updated_at = ${now.toISOString()}::timestamptz
      FROM (VALUES ${sql.join(
        memberIds.map((mid) => sql`(${mid}::uuid, ${(refundByMember.get(mid) ?? 0) / 100}::numeric)`),
        sql`, `,
      )}) AS v(id, amt)
      WHERE m.id = v.id AND m.tenant_id = ${tenantId}
    `);
  }

  const legIds = legs.map((l) => l.id);
  await tx
    .update(transactions)
    .set({
      isDeleted: true,
      deletedAt: now,
      deletedBy: actorId,
      updatedBy: actorId,
      updatedAt: now,
      status: 'Deleted',
      projectId: detachFromProject ? null : projectId,
      deletionReason: reason,
    })
    .where(and(inArray(transactions.id, legIds), eq(transactions.tenantId, tenantId)));

  return { refundedCents, untrackedCents, shareholderCount: memberIds.length };
}
