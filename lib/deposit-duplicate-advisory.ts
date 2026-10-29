/**
 * R1 — near-duplicate deposit ADVISORY (docs/DEPOSIT_SCHEDULE_DESIGN.md §8).
 *
 * Why this exists
 * ---------------
 * The one-deposit-per-month rule was, without anyone intending it, a ceiling on
 * data-entry error: the same member could not receive the same amount twice in a
 * month. Removing that rule for flexible tenants removes the accident as well. This
 * module replaces the accident with a deliberate control, so the flexible schedule
 * does not silently become "nothing checks anything".
 *
 * It is ADVISORY and never blocks, by design. Two identical payments inside a few
 * days are legitimate for a flexible member ( instalments, two members' cash
 * collected together, a partner paying for someone else). Rejecting them would
 * rebuild the restriction the schedule exists to remove, so the officer is warned
 * and the event is written to the audit trail — the control is visibility, not a
 * gate.
 *
 * Money semantics are untouched: this module only reads.
 */

import { and, eq, gte, lt, ne } from 'drizzle-orm';
import type { getDb } from '@/db/index';
import { transactions } from '@/db/schema/index';
import { fromCents } from './money';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Matches are capped so a bad window value cannot return an unbounded result set. */
const MAX_ADVISORY_MATCHES = 5;

type DbLike = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export interface NearDuplicateInput {
  tenantId: string;
  memberId: string;
  /** Integer cents (§12) for consistency with every other deposit guard. */
  amountCents: number;
  collectedDate: Date;
  /** `system_settings.deposit_near_duplicate_window_days`. <= 0 disables the check. */
  windowDays: number | null | undefined;
  /** Set when re-checking an existing row so it cannot match itself. */
  excludeId?: string | null;
}

export interface NearDuplicateMatch {
  id: string;
  referenceNumber: string | null;
  date: string | null;
  amount: string | null;
  /** Absolute whole-day distance from `collectedDate`, for the officer-facing message. */
  daysApart: number;
}

/**
 * Inclusive lower / exclusive upper bound around the collected date.
 *
 * Returns null when the check is disabled, so callers have one explicit "off" value
 * instead of a magic zero-date query. A nullish or non-finite window is treated as
 * DISABLED rather than as "match everything": an unset setting must never turn into
 * a warning on every single deposit.
 */
export function nearDuplicateWindowBounds(
  collectedDate: Date,
  windowDays: number | null | undefined,
): { from: Date; to: Date } | null {
  const days = Number(windowDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const rounded = Math.trunc(days);
  // Symmetric: the typographical repeat is as likely to have been recorded a day
  // earlier as a day later, and an asymmetric window would miss half of them.
  return {
    from: new Date(collectedDate.getTime() - rounded * DAY_MS),
    to: new Date(collectedDate.getTime() + rounded * DAY_MS),
  };
}

/**
 * Settled deposits for the SAME member at the SAME amount inside the window.
 *
 * Only `Completed` rows are considered: a pending request has moved no money, so
 * warning about it would train officers to ignore the warning. Soft-deleted rows are
 * excluded (§12) and the tenant predicate is mandatory (§6).
 */
export async function findNearDuplicateDeposits(
  db: unknown,
  input: NearDuplicateInput,
): Promise<NearDuplicateMatch[]> {
  const bounds = nearDuplicateWindowBounds(input.collectedDate, input.windowDays);
  if (!bounds) return [];
  if (!input.memberId || !Number.isInteger(input.amountCents) || input.amountCents <= 0) return [];

  const rows = await (db as DbLike)
    .select({
      id: transactions.id,
      referenceNumber: transactions.referenceNumber,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(
      // §6 tenant scope, §12 soft delete — same predicates as every other guard.
      eq(transactions.tenantId, input.tenantId),
      eq(transactions.memberId, input.memberId),
      eq(transactions.type, 'Deposit'),
      eq(transactions.status, 'Completed'),
      eq(transactions.isDeleted, false),
      // Compared in the canonical decimal text the insert wrote, so 500.00 matches
      // 500.00 and not 500.001.
      eq(transactions.amount, fromCents(input.amountCents)),
      gte(transactions.date, bounds.from),
      lt(transactions.date, bounds.to),
      // Re-checking an existing row must never match itself.
      input.excludeId ? ne(transactions.id, input.excludeId) : undefined,
    ))
    .limit(MAX_ADVISORY_MATCHES);

  return rows.map((row) => ({
    id: row.id,
    referenceNumber: row.referenceNumber ?? null,
    date: row.date ? new Date(row.date as Date).toISOString() : null,
    amount: row.amount ?? null,
    daysApart: row.date ? daysBetween(row.date as Date, input.collectedDate) : 0,
  }));
}

/** Whole-day absolute distance, floored — a "3 day" window means 3, not 3.9. */
function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(new Date(a).getTime() - new Date(b).getTime()) / DAY_MS);
}

/**
 * Officer-facing advisory text, or null when there is nothing to say.
 *
 * §11 shape is not used here: this is not a validation failure, and reusing the
 * `[Field ..., Code: ...]` error format for a warning would make it read as a
 * rejection to the client and to the error-toast handler.
 */
export function nearDuplicateAdvisory(matches: NearDuplicateMatch[]): string | null {
  const first = matches.at(0);
  if (!first) return null;
  const when = first.date ? new Date(first.date).toISOString().slice(0, 10) : 'an earlier date';
  const ref = first.referenceNumber ? ` (Ref: ${first.referenceNumber})` : '';
  const more = matches.length > 1 ? ` and ${matches.length - 1} more` : '';
  return (
    `Possible duplicate: this member already has a completed deposit of the same amount on `
    + `${when}${ref}${more}. Recorded anyway — flexible members may deposit more than once. `
    + `Check the ledger if this was not intended.`
  );
}
