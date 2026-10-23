/**
 * Business rule: editing a settled deposit moves money by a NET DELTA, never
 * by a debit-then-credit pair.
 *
 * A settled deposit contributes `amount` to its fund's balance and to its
 * member's `totalContributed` exactly once. Editing it therefore has to move
 * those two balances by the DIFFERENCE between the old contribution and the
 * new one.
 *
 * The naive implementation — debit the old amount, then credit the new one as
 * two separate UPDATEs — transiently drives the fund below zero whenever the
 * fund holds less than the old amount. That is not a corner case: a dividend
 * distribution run empties the Deposit Fund, after which the fund legitimately
 * holds less cash than the sum of the deposits recorded against it. Postgres
 * then rejects the whole transaction on `funds_balance_check CHECK (balance >=
 * 0)` and the caller sees an opaque 500 instead of a result.
 *
 * Applying ONE net delta per fund and per member removes the transient
 * negative balance entirely: the balance only ever moves from its current
 * value to its final value, so a fund is never asked to go below zero on the
 * way.
 *
 * The net delta still has to be LEGAL. Two guards live here:
 *
 *   - a fund may never be left below its floor (its minimum balance, and never
 *     below zero — the database enforces the same);
 *   - a member's equity may never go negative — money already invested in a
 *     project is not uncommitted and cannot be reclaimed by editing a
 *     deposit.
 *
 * Both guards produce a clean, client-facing refusal (400) instead of letting
 * the write fail deep inside the transaction.
 *
 * All amounts are integer cents. No float money math anywhere in this file.
 */

/** One side of an edit: what the deposit contributed BEFORE the edit. */
export interface DepositEditBefore {
  /** Was the deposit settled (money actually moved) before the edit? */
  wasCompleted: boolean;
  /** Fund the deposit sat in before the edit (null for a legacy row). */
  oldFundId: string | null;
  /** Member the deposit belonged to before the edit. */
  oldMemberId: string | null;
  /** Amount the deposit contributed before the edit, in cents. */
  oldAmountCents: number;
}

/** The other side of an edit: what the deposit contributes AFTER the edit. */
export interface DepositEditAfter {
  /** Is the deposit settled after the edit? */
  isNowCompleted: boolean;
  /** Fund the deposit sits in after the edit. */
  newFundId: string;
  /** Member the deposit belongs to after the edit. */
  newMemberId: string;
  /** Amount the deposit contributes after the edit, in cents. */
  newAmountCents: number;
}

/**
 * The net balance movement an edit has to apply, keyed by entity id.
 *
 * A key is present with the value 0 when the edit touches that entity but
 * does not move its balance (e.g. a pure date correction on a deposit whose
 * amount did not change) — callers can still see the entity was considered.
 */
export interface DepositEditDelta {
  fundDelta: Map<string, number>;
  memberDelta: Map<string, number>;
}

/**
 * Compute the net balance movement of an edit.
 *
 * The old contribution is removed only if the deposit was actually settled
 * before the edit; the new contribution is added only if it is settled after.
 * Moving a deposit from one member to another therefore debits the old
 * member and credits the new one; settling a previously-pending deposit
 * credits without debiting.
 */
export function computeDepositEditDelta(
  before: DepositEditBefore,
  after: DepositEditAfter,
): DepositEditDelta {
  const fundDelta = new Map<string, number>();
  const memberDelta = new Map<string, number>();

  if (before.wasCompleted) {
    if (before.oldFundId) {
      fundDelta.set(before.oldFundId, (fundDelta.get(before.oldFundId) ?? 0) - before.oldAmountCents);
    }
    if (before.oldMemberId) {
      memberDelta.set(before.oldMemberId, (memberDelta.get(before.oldMemberId) ?? 0) - before.oldAmountCents);
    }
  }

  if (after.isNowCompleted) {
    fundDelta.set(after.newFundId, (fundDelta.get(after.newFundId) ?? 0) + after.newAmountCents);
    memberDelta.set(after.newMemberId, (memberDelta.get(after.newMemberId) ?? 0) + after.newAmountCents);
  }

  return { fundDelta, memberDelta };
}

/** The balance facts needed to check a fund's floor. */
export interface FundBalanceSnapshot {
  id: string;
  name?: string | null;
  /** Current balance, in cents. */
  balanceCents: number;
  /** The fund's minimum balance floor, in cents. */
  minimumBalanceCents: number;
}

/** The balance facts needed to check a member's equity. */
export interface MemberEquitySnapshot {
  id: string;
  name?: string | null;
  /** The member's current total contribution, in cents. */
  equityCents: number;
}

/**
 * A fund whose net delta would push it below its floor.
 *
 * `floorCents` is the effective floor: the fund's minimum balance, never
 * below zero (the database's own CHECK enforces the same).
 */
export interface FundDeficitViolation {
  fundId: string;
  fundName: string;
  /** The balance the fund would be left with. */
  afterCents: number;
  /** The floor it would have fallen below. */
  floorCents: number;
}

/**
 * A member whose net delta would push their equity negative.
 */
export interface EquityViolation {
  memberId: string;
  memberName: string;
  /** The equity the member would be left with. */
  afterCents: number;
}

/** The effective floor for a fund: its minimum balance, never below zero. */
export function fundFloorCents(minimumBalanceCents: number): number {
  return Math.max(minimumBalanceCents, 0);
}

/**
 * Find the first fund whose net debit would drop it below its floor.
 *
 * Only DEBITS are checked: a credit can never violate the floor. The funds
 * are inspected in sorted id order so the refusal is deterministic when more
 * than one fund would break.
 */
export function findFundDeficitViolation(
  fundDelta: Map<string, number>,
  funds: Map<string, FundBalanceSnapshot>,
): FundDeficitViolation | null {
  for (const fundId of [...fundDelta.keys()].sort()) {
    const delta = fundDelta.get(fundId) ?? 0;
    if (delta >= 0) continue;
    const fund = funds.get(fundId);
    if (!fund) continue;
    const afterCents = fund.balanceCents + delta;
    const floorCents = fundFloorCents(fund.minimumBalanceCents);
    if (afterCents < floorCents) {
      return {
        fundId,
        fundName: fund.name ?? 'the fund',
        afterCents,
        floorCents,
      };
    }
  }
  return null;
}

/**
 * Find the first member whose net debit would push their equity negative.
 *
 * Only DEBITS are checked, and the members are inspected in sorted id order
 * so the refusal is deterministic.
 */
export function findEquityViolation(
  memberDelta: Map<string, number>,
  members: Map<string, MemberEquitySnapshot>,
): EquityViolation | null {
  for (const memberId of [...memberDelta.keys()].sort()) {
    const delta = memberDelta.get(memberId) ?? 0;
    if (delta >= 0) continue;
    const member = members.get(memberId);
    if (!member) continue;
    const afterCents = member.equityCents + delta;
    if (afterCents < 0) {
      return {
        memberId,
        memberName: member.name ?? 'the member',
        afterCents,
      };
    }
  }
  return null;
}

/** The deployment facts needed to check a member's invested money. */
export interface DeployedFundsSnapshot {
  id: string;
  name?: string | null;
  /** Does the member carry any open (non-deleted) project investment legs? */
  hasOpenInvestmentLegs: boolean;
}

/**
 * A member whose net debit would pull back money that may already be
 * deployed into a project.
 */
export interface DeployedFundsViolation {
  memberId: string;
  memberName: string;
}

/**
 * Find the first member whose net debit touches money that may already be
 * deployed into a project.
 *
 * The ledger does NOT attribute an investment to the deposit rows that
 * funded it: an investment debits the member's AGGREGATE equity
 * (`totalContributed`), and dividend credits can keep that aggregate
 * positive even when every deposited unit is gone. So once a member
 * carries an open project investment, ANY net reduction of their settled
 * deposits could be reclaiming invested money — and the equity guard above
 * cannot tell the difference.
 *
 * The only safe rule is to refuse the reduction outright: refund the
 * investment (project edit or delete) first, then correct the deposit.
 * Credits — amount increases and settle transitions — stay allowed.
 *
 * Members are inspected in sorted id order so the refusal is deterministic.
 */
export function findDeployedFundsViolation(
  memberDelta: Map<string, number>,
  members: Map<string, DeployedFundsSnapshot>,
): DeployedFundsViolation | null {
  for (const memberId of [...memberDelta.keys()].sort()) {
    const delta = memberDelta.get(memberId) ?? 0;
    if (delta >= 0) continue;
    const member = members.get(memberId);
    if (!member) continue;
    if (member.hasOpenInvestmentLegs) {
      return { memberId, memberName: member.name ?? 'the member' };
    }
  }
  return null;
}

/**
 * The balance a fund holds ACROSS an edit: the balance before it and the
 * balance after it.
 *
 * The edit applied a net delta, so the pre-edit balance is the live
 * post-edit balance minus that delta. It is NOT `live - amount`: a fund can
 * legitimately hold less cash than one deposit row is worth (after a dividend
 * run paid it out), and subtracting the full amount would print a negative
 * "before" balance that never existed.
 */
export function fundBalanceAcrossEdit(
  liveBalanceCents: number,
  deltaCents: number,
): { beforeCents: number; afterCents: number } {
  return {
    beforeCents: liveBalanceCents - deltaCents,
    afterCents: liveBalanceCents,
  };
}

/**
 * Does an edit PRESERVE the row's stored date, rather than introducing a new
 * one?
 *
 * A deposit may be booked ahead for a future month (bulk deposits are
 * created before the money is collected), so its stored date can already be
 * in the future. The general rule — a posting date may not be in the future
 * (lib/tenant-time parseBusinessDate) — exists so a write cannot smuggle in
 * time travel. But an edit that sends back the row's OWN date is not
 * introducing time travel: it is preserving what the row already carries.
 *
 * Without this exemption such a row could never be corrected again — the
 * exact edit it was created for would be permanently impossible.
 *
 * Any OTHER incoming date still goes through the future-date rule.
 */
export function isUnchangedDepositDate(
  incoming: string | Date | null | undefined,
  existing: string | Date | null | undefined,
): boolean {
  if (!incoming || !existing) return false;
  const incomingTime = new Date(incoming).getTime();
  const existingTime = new Date(existing).getTime();
  if (Number.isNaN(incomingTime) || Number.isNaN(existingTime)) return false;
  return incomingTime === existingTime;
}
