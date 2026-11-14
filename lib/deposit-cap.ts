/**
 * The Project-Member deposit cap — one owner of the rule, called from every
 * path that credits a member's deposit equity (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md §3.2).
 *
 * Semantics (user-confirmed):
 *  - the cap is a LIFETIME ceiling on cumulative credited deposits, not on the
 *    live balance — a withdrawal or a project investment does NOT free headroom;
 *  - "cumulative deposits" is DERIVED FROM THE LEDGER, exactly the way the
 *    deleted-transaction restore path derives equity: SUM of live, settled
 *    ('Completed'/'Success') `Deposit` rows. No parallel counter can drift;
 *    a reverted deposit (status back to PENDING) releases its amount because
 *    it demonstrably no longer credits anyone;
 *  - only the exclusive 'Project Member' category carries a cap. A member row
 *    that IS a Project Member but has no cap (hand-edited legacy) fails CLOSED:
 *    deposits are refused with a clear message rather than silently unlimited;
 *  - the helper re-reads the member row FOR UPDATE inside the caller's
 *    transaction, so it is safe from paths that already hold the lock
 *    (same tx = no-op re-lock) and from ones that do not, alike.
 */

import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { members, transactions } from '@/db/schema/index';
import { fromCents, toCents } from '@/lib/money';
import { PROJECT_MEMBER_ROLE } from '@/lib/distribution-rules';
import { ValidationError } from '@/lib/utils/errors';

type DbTransaction = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * Pure arithmetic of the cap decision, split out so the money rule itself is
 * unit-testable without a database. `newCents` may be 0 (validate whatever the
 * ledger already holds — the restore path's shape).
 */
export function evaluateDepositCap(opts: {
  role: unknown;
  /** decimal(15,2) string (or null) from the member row. */
  cap: string | number | null | undefined;
  cumulativeCents: number;
  newCents: number;
}): { exempt: boolean; projectedCents: number; capCents: number | null } {
  if (opts.role !== PROJECT_MEMBER_ROLE) return { exempt: true, projectedCents: 0, capCents: null };
  const capCents = opts.cap === null || opts.cap === undefined || (opts.cap as unknown) === '' ? null : toCents(opts.cap);
  const projectedCents = opts.cumulativeCents + opts.newCents;
  return { exempt: false, projectedCents, capCents };
}

type SqlExecutor = Pick<DbTransaction, 'execute'>;

/**
 * The member's cumulative credited deposits, derived from the ledger — the ONE
 * owner of that SUM predicate (the same 'Deposit' + settled + live shape the
 * restore path uses). Exported so the member detail sheet can show cap usage
 * without any second copy of the money definition drifting into a display file.
 */
export async function cumulativeCreditedDepositsCents(
  db: SqlExecutor,
  opts: { tenantId: string; memberId: string },
): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT COALESCE(SUM(amount::numeric), 0) as total
        FROM transactions
        WHERE member_id = ${opts.memberId}
          AND tenant_id = ${opts.tenantId}
          AND type = 'Deposit'
          AND status IN ('Completed', 'Success')
          AND is_deleted = false`,
  )) as unknown as Array<{ total: string }>;
  return toCents(rows[0]?.total ?? '0');
}

/**
 * Throw unless crediting `newCents` keeps the member inside their cap.
 * Non-Project-Members return immediately (the exempt decision needs only the
 * member row — read under the lock, which is one indexed PK select on a row
 * the caller's tx usually has hot).
 */
export async function assertDepositWithinCap(
  tx: DbTransaction,
  opts: { tenantId: string; memberId: string; newCents: number; context: string },
): Promise<void> {
  const { tenantId, memberId, newCents, context } = opts;
  if (!Number.isInteger(newCents) || newCents < 0) {
    throw new ValidationError(`[Field 'amount', Code: invalid_amount] Deposit-cap check needs integer cents >= 0`);
  }

  const [member] = await tx
    .select({ id: members.id, name: members.name, role: members.role, depositCap: members.depositCap })
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .for('update')
    .limit(1);
  if (!member) return; // the caller validates existence; nothing to cap here
  if (member.role !== PROJECT_MEMBER_ROLE) return; // exempt — no cap concept

  const cumulativeCents = await cumulativeCreditedDepositsCents(tx, { tenantId, memberId });

  const decision = evaluateDepositCap({ role: member.role, cap: member.depositCap, cumulativeCents, newCents });
  if (decision.capCents === null) {
    // Fail closed: a Project Member row without a configured cap cannot take
    // money in — set the cap before recording a deposit.
    throw new ValidationError(
      `[Field 'depositCap', Code: DEPOSIT_CAP_MISSING] ${member.name} is a Project Member with no deposit ` +
        `cap configured — set the cap on the member before ${context}.`,
    );
  }
  if (decision.projectedCents > decision.capCents) {
    throw new ValidationError(
      `[Field 'amount', Code: DEPOSIT_CAP_EXCEEDED] ${member.name}'s cumulative deposits would reach ` +
        `${fromCents(decision.projectedCents)} — above the Project Member cap of ${fromCents(decision.capCents)}. ` +
        `Headroom left: ${fromCents(Math.max(0, decision.capCents - cumulativeCents))}.`,
    );
  }
}
