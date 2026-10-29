/**
 * R2 — flexible-deposit approval threshold (docs/DEPOSIT_SCHEDULE_DESIGN.md §8).
 *
 * Pure decision, no database and no money mutation, because the thing it decides is
 * whether real money posts as settled or waits for a second officer. That call belongs
 * somewhere it can be tested exhaustively, not embedded in a request handler.
 *
 * Why it exists
 * -------------
 * Removing the one-deposit-per-month lock also removes, by accident, the ceiling it
 * placed on data-entry error: a mistyped 10,000,000 used to be impossible to post twice,
 * and now posts once straight into `funds.balance` and `members.totalContributed`, where
 * undoing it means a revert that debits both again. R2 caps that blast radius by routing
 * large flexible deposits into the existing request → approve flow, so a second officer
 * confirms the number before any balance moves.
 *
 * It never applies to a monthly tenant. The month lock already bounds the damage there,
 * and changing how a monthly deposit posts would break the guarantee this whole feature
 * is built around.
 */

import { toCents } from '../money';

export interface FlexApprovalDecision {
  /** True ⇒ file as a pending request; no balance, contribution or activity is written. */
  postsAsPending: boolean;
  /** Resolved threshold in integer cents, or null when the control is disabled. */
  thresholdCents: number | null;
  /** Why the control did not apply, for the audit trail. Null when it applied. */
  reason: 'MONTHLY_SCHEDULE' | 'NOT_CONFIGURED' | 'INVALID_CONFIGURED_VALUE' | 'BELOW_THRESHOLD' | null;
}

/**
 * @param enforced         whether the member is on the enforced monthly schedule
 * @param approvalAbove    `system_settings.deposit_flex_approval_above` (decimal string)
 * @param amountCents      this deposit, integer cents
 */
export function resolveFlexApprovalDecision(input: {
  enforced: boolean;
  approvalAbove: string | number | null | undefined;
  amountCents: number;
}): FlexApprovalDecision {
  const raw = input.approvalAbove;
  const isSet = raw !== null && raw !== undefined && String(raw).trim() !== '';

  let thresholdCents: number | null = null;
  if (isSet) {
    // toCents throws on junk rather than guessing, so an unusable stored value must
    // not take deposits down — it disables the control instead.
    try {
      const parsed = toCents(String(raw));
      thresholdCents = Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    } catch {
      thresholdCents = null;
    }
  }

  // Monthly is checked FIRST and is absolute: a stale threshold left in settings must
  // never change how a monthly deposit posts.
  if (input.enforced) {
    return { postsAsPending: false, thresholdCents, reason: 'MONTHLY_SCHEDULE' };
  }
  if (thresholdCents === null) {
    return {
      postsAsPending: false,
      thresholdCents: null,
      reason: isSet ? 'INVALID_CONFIGURED_VALUE' : 'NOT_CONFIGURED',
    };
  }
  if (!(Number.isInteger(input.amountCents) && input.amountCents > 0)) {
    // Nothing to protect: the caller's own amount validation rejects this, and an
    // unparseable amount must not be silently escalated into an approval queue.
    return { postsAsPending: false, thresholdCents, reason: 'BELOW_THRESHOLD' };
  }

  return input.amountCents > thresholdCents
    ? { postsAsPending: true, thresholdCents, reason: null }
    : { postsAsPending: false, thresholdCents, reason: 'BELOW_THRESHOLD' };
}
