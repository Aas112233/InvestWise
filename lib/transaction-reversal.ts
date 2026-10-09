/**
 * Pure decision logic for reversing a transaction's fund-balance effect when
 * the transaction is soft-deleted.
 *
 * Why this exists (§12 money integrity): a soft delete must not silently
 * strand a fund movement. Deposits have a dedicated revert path
 * (POST /api/deposits/[id]/revert) which reverses fund + member balances
 * atomically, so the transactions DELETE route refuses to delete a settled
 * deposit and points at that path instead. Other settled movements have no
 * equivalent revert endpoint — if DELETE merely flipped `is_deleted`, the fund
 * would stay permanently debited/credited while the ledger claimed the row no
 * longer existed. So the DELETE handler reverses the effect itself, in the same
 * DB transaction.
 *
 * This module is intentionally pure (no DB, no IO) so the direction rules can
 * be unit-tested and cannot drift from the writers that created the movement.
 *
 * #108: the direction rule is derived from the CANONICAL ledger classifier
 * (lib/reports/data.ts classifyLedgerType) instead of a hand-maintained type
 * list. A credit-side type credited the fund when posted → deleting it debits
 * the fund back; a debit-side type did the opposite. The first version listed
 * only Expense/Transfer Out/Transfer In by hand, so deleting a settled
 * project Earning stranded its credit on the fund balance forever (observed
 * as a +3.00 drift after three earning deletions).
 *
 *   • credit-side (Earning, Investment, Transfer In, …) → DEBIT back (-1)
 *   • debit-side  (Expense, Withdrawal, Dividend, Transfer Out, …) → CREDIT back (+1)
 *   • 0/0 informational or unknown types → 0 (never guess)
 *   • Settlement deposits → owned by the revert route → 0 (refuse-and-redirect)
 *   • Anything unsettled (Pending / Rejected / Request) never moved money → 0
 */
import { classifyLedgerType } from './reports/data';

/** Statuses that mean a movement actually reached the ledger's money. */
export const SETTLED_STATUSES = ['Completed', 'Success'] as const;

/** The subset of transaction fields the reversal decision depends on. */
export interface ReversalInput {
  type: string | null | undefined;
  status: string | null | undefined;
  /** The fund this movement touched, if any. */
  fundId: string | null | undefined;
  /** Movement amount as a decimal string (e.g. "321.00"). */
  amount: string | null | undefined;
}

export interface ReversalDecision {
  /**
   * The fund whose balance must be adjusted, or null when no balance change
   * is required.
   */
  fundId: string | null;
  /**
   * Signed direction of the adjustment: +1 credits the fund, -1 debits it,
   * 0 means no adjustment. Multiplied by the amount to get the delta.
   */
  direction: 1 | 0 | -1;
  /** True when the caller must refuse the delete and redirect to the revert route. */
  requiresRevertPath: boolean;
  /** The reason a refusal is required, when `requiresRevertPath` is true. */
  revertHint?: string;
}

/**
 * Decide how (or whether) to reverse a transaction's balance effect on delete.
 *
 * @param tx the transaction about to be soft-deleted
 * @returns the fund to adjust, the signed direction, and whether this row must
 *          instead go through the deposits revert path.
 */
export function decideReversal(tx: ReversalInput): ReversalDecision {
  const settled =
    tx.status != null && (SETTLED_STATUSES as readonly string[]).includes(tx.status);

  // A settled deposit is owned by POST /api/deposits/[id]/revert, which also
  // reverses member-level balances. This route must not touch it.
  if (tx.type === 'Deposit' && settled) {
    return {
      fundId: null,
      direction: 0,
      requiresRevertPath: true,
      revertHint:
        'Completed deposits cannot be deleted. Revert to request instead (POST /api/deposits/[id]/revert) so fund and member balances are reversed.',
    };
  }

  // Nothing else moved money if it is not settled or has no fund.
  if (!settled || !tx.fundId) {
    return { fundId: null, direction: 0, requiresRevertPath: false };
  }

  // #108: derive the direction from the canonical classifier rather than a
  // hand-maintained list, so the reversal can never drift from the writers.
  const { debit, credit } = classifyLedgerType(tx.type ?? '');
  if (credit === 1) {
    // The posting credited the fund → debit it back.
    return { fundId: tx.fundId, direction: -1, requiresRevertPath: false };
  }
  if (debit === 1) {
    // The posting debited the fund → credit it back.
    return { fundId: tx.fundId, direction: 1, requiresRevertPath: false };
  }
  // 0/0 informational aggregates (e.g. Dividend Distribution) and unknown
  // types are deliberately left alone rather than guessed at — a wrong guess
  // is worse than none.
  return { fundId: null, direction: 0, requiresRevertPath: false };
}

/**
 * Whether the delete must also refund a project's rolled-up `totalExpenses`.
 * Only settled expenses attributed to a project inflate that rollup.
 */
export function shouldRefundProjectExpenses(tx: ReversalInput): boolean {
  const settled =
    tx.status != null && (SETTLED_STATUSES as readonly string[]).includes(tx.status);
  return tx.type === 'Expense' && settled;
}

/**
 * #108b: whether the delete must also refund a project's rolled-up
 * `totalEarnings`. Symmetric with shouldRefundProjectExpenses — only settled
 * earnings attributed to a project inflate that rollup, so deleting one must
 * decrement it or the project overstates revenue forever.
 */
export function shouldRefundProjectEarnings(tx: ReversalInput): boolean {
  const settled =
    tx.status != null && (SETTLED_STATUSES as readonly string[]).includes(tx.status);
  return tx.type === 'Earning' && settled;
}
