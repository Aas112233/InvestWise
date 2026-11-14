import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../shared/errors';
import { getDb } from '../../lib/db';
import { funds, members, systemSettings } from '../../db/schema/index';
import { fromCents, parsePositiveAmount, splitByTypeAndShares, toCents } from '@/lib/money';
import { distributionRulesToBp, PROJECT_MEMBER_ROLE } from '@/lib/distribution-rules';

/**
 * Statutory-reserve and payout math for a dividend run.
 *
 * This module exists because the preview endpoint and the payout endpoint used
 * to be separate implementations of the same arithmetic: the modal could show a
 * member breakdown, and the distribution could then pay something different,
 * because only one of them honored a requested reserve percent or reserve fund.
 * Both now call `planDividendRun`, so preview and payout cannot drift.
 *
 * All money is integer cents (`lib/money.ts`), and rates are carried in
 * micro-currency units (1e-6) so the decimal(15,6) `rate_per_share` column is
 * derived by integer arithmetic instead of `payoutCents / (shares * 100)`.
 */

/** 1e-6 currency units per cent: cents * 10_000 = micro units. */
const MICROS_PER_CENT = 10_000;
const MAX_GROSS_CENTS = 100_000_000 * 100;
/** Percent is carried in 1e-2 units (10.00% -> 1000), so the reserve split is integer-only. */
const PERCENT_SCALE = 10_000; // grossCents * pctCents / PERCENT_SCALE

interface DividendMemberSeed {
  id: string;
  memberId: string;
  name: string;
  shares: number;
  /** Membership category (lib/member-roles vocabulary); absent/null = the
   *  standard 'Shareholder Member' category (the members.role column default). */
  role?: string | null;
}

interface DividendPayout {
  id: string;
  memberId: string;
  name: string;
  shares: number;
  /** The member's category — carried through for the preview's Type column. */
  role: string;
  payoutCents: number;
  /** decimal(15,2) string. */
  grossAmount: string;
  /** decimal(15,6) string — this member's realized rate. */
  ratePerShare: string;
}

interface DividendPlan {
  grossCents: number;
  grossAmount: string;
  /** decimal(15,2) string, e.g. "10.00". */
  reservePercent: string;
  reserveCents: number;
  reserveAmount: string;
  netCents: number;
  netDistributable: string;
  totalActiveShares: number;
  /** decimal(15,6) string — run-wide rate. */
  ratePerShare: string;
  payouts: DividendPayout[];
  recipientCount: number;
  totalDistributedCents: number;
  /**
   * Per-category carve-outs of the net pool when the tenant configured
   * member-category rules (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md). Empty when
   * no rules apply — the split then matches the historical pure pro-rata.
   */
  typeBlocks: Array<{ role: string; bp: number; amountCents: number; memberCount: number }>;
  /** What the no-category pro-rata carve-out distributed. */
  remainderCents: number;
}

/** Format integer micro-currency units as a fixed 6-decimal string. */
export function fromMicros(micros: number): string {
  if (!Number.isInteger(micros)) throw new AppError('Rate must be an integer micro amount', 500, 'RATE_PRECISION');
  const negative = micros < 0;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000).padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Exact per-share rate in micro units, rounded half-up. Integer-only inputs. */
function rateMicros(amountCents: number, shareCount: number): number {
  if (shareCount <= 0) return 0;
  return Math.floor((amountCents * MICROS_PER_CENT * 2 + shareCount) / (shareCount * 2));
}

/**
 * Pure plan calculation — no database, no side effects.
 *
 * Invariants enforced here (AGENTS.md §12):
 * - `reserveCents + netCents === grossCents`
 * - `sum(payouts) === netCents` for a partial-reserve run
 */
export function computeDividendPlan(input: {
  grossEarnings: string | number;
  statutoryReservePercent: string | number;
  members: DividendMemberSeed[];
  /**
   * Member-category weights (basis points) from lib/distribution-rules.ts.
   * Absent/empty keeps the run byte-identical to the historical pro-rata.
   */
  rulesBp?: Map<string, number>;
}): DividendPlan {
  const grossCents = parsePositiveAmount(input.grossEarnings, {
    maxCents: MAX_GROSS_CENTS,
    field: 'grossEarnings',
  });

  // Percent in 1e-2 units so the reserve is an exact integer division. Accepts
  // "10", "10.5" or 10.5, but rejects anything outside 0-100 rather than
  // silently retaining a negative or over-100 reserve.
  const pctCents = toCents(
    typeof input.statutoryReservePercent === 'number'
      ? String(input.statutoryReservePercent)
      : input.statutoryReservePercent,
  );
  if (pctCents < 0 || pctCents > 10_000) {
    throw new AppError('Statutory reserve percent must be between 0 and 100', 400, 'INVALID_RESERVE_PERCENT');
  }

  const reserveCents = Math.floor((grossCents * pctCents + PERCENT_SCALE / 2) / PERCENT_SCALE);
  const netCents = grossCents - reserveCents;

  const eligible = input.members
    .filter((m) => Number.isInteger(m.shares) && m.shares > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const totalActiveShares = eligible.reduce((sum, m) => sum + m.shares, 0);

  if (totalActiveShares <= 0) {
    throw new AppError('No active members with shares found, so the dividend cannot be distributed. Add active members with shares in the Members screen first.', 400, 'NO_ELIGIBLE_MEMBERS');
  }

  // A 100% reserve leaves nothing to split; the split engine rejects a
  // non-positive total, so the empty payout set is the correct plan here.
  // splitByTypeAndShares carves each configured member category its percent of
  // the NET pool (pro-rata by shares inside the category, remainder pro-rata
  // outside) — and reduces to the historical splitDividendByShares exactly when
  // no rules are configured. The modal preview posts the SAME plan (this
  // function is shared), so what is shown is what is paid.
  const rulesBp = input.rulesBp ?? new Map<string, number>();
  const outcome =
    netCents > 0
      ? splitByTypeAndShares(
          netCents,
          eligible.map((m) => ({ id: m.id, shares: m.shares, role: m.role ?? 'Shareholder Member' })),
          rulesBp,
        )
      : null;
  const payoutById = new Map((outcome?.payouts ?? []).map((s) => [s.id, s.payoutCents]));

  const payouts: DividendPayout[] = eligible.map((m) => {
    const payoutCents = payoutById.get(m.id) ?? 0;
    return {
      id: m.id,
      memberId: m.memberId,
      name: m.name,
      shares: m.shares,
      role: m.role ?? 'Shareholder Member',
      payoutCents,
      grossAmount: fromCents(payoutCents),
      ratePerShare: fromMicros(rateMicros(payoutCents, m.shares)),
    };
  });

  const recipientCount = payouts.filter((p) => p.payoutCents > 0).length;
  const totalDistributedCents = payouts.reduce((sum, p) => sum + p.payoutCents, 0);

  if (totalDistributedCents !== netCents && netCents > 0) {
    // Never ship a plan that does not balance — this is the split's contract.
    throw new AppError(
      `Dividend split does not reconcile: expected ${netCents} cents, allocated ${totalDistributedCents}`,
      500,
      'DIVIDEND_SPLIT_UNBALANCED',
    );
  }

  return {
    grossCents,
    grossAmount: fromCents(grossCents),
    reservePercent: fromCents(pctCents),
    reserveCents,
    reserveAmount: fromCents(reserveCents),
    netCents,
    netDistributable: fromCents(netCents),
    totalActiveShares,
    ratePerShare: fromMicros(rateMicros(netCents, totalActiveShares)),
    payouts,
    recipientCount,
    totalDistributedCents,
    typeBlocks: outcome?.typeBlocks ?? [],
    remainderCents: outcome?.remainderCents ?? 0,
  };
}

interface DividendRunContext {
  plan: DividendPlan;
  distributableFund: typeof funds.$inferSelect;
  reserveFund: typeof funds.$inferSelect;
}

/**
 * Read and validate everything a run needs — tenant-scoped on every query —
 * then hand it to the pure planner. Used by BOTH the simulation and the
 * distribution so the fund balances, reserve fund and member set they reason
 * about are literally the same rows.
 *
 * The database handle is opened here rather than passed in, following the
 * convention of every other service in this module: the app's `getDb()` is
 * typed against the root schema copy and the two drizzle installs are not
 * structurally interchangeable. Balance checks taken from these reads are
 * advisory — the distribution re-reads and locks the same rows inside its own
 * transaction before moving money.
 */
export async function planDividendRun(
  tenantId: string,
  input: {
    grossEarnings: string | number;
    distributableFundId: string;
    /** Optional explicit overrides; fall back to this tenant's own settings. */
    statutoryReservePercent?: string | number | null;
    reserveFundId?: string | null;
  },
): Promise<DividendRunContext> {
  const db = getDb();

  // The tenant's own settings row: a global limit(1) would apply another
  // tenant's reserve percentage to this run (§6).
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  const reservePercent =
    input.statutoryReservePercent !== undefined &&
    input.statutoryReservePercent !== null &&
    String(input.statutoryReservePercent) !== ''
      ? input.statutoryReservePercent
      : settings?.statutoryReservePercent ?? '10';

  // Member-category rules from Settings → Financial — the SAME stored list the
  // project-returns run reads. A corrupt config fails the run loudly (400)
  // rather than silently mis-splitting the net pool.
  let rulesBp: Map<string, number>;
  try {
    rulesBp = new Map(distributionRulesToBp(settings?.distributionRules ?? null));
  } catch (err) {
    throw new AppError(
      'The configured category distribution rules are invalid — fix Settings → Financial → Returns distribution: ' +
        (err instanceof Error ? err.message : String(err)),
      400,
      'INVALID_DISTRIBUTION_RULES',
    );
  }

  const [distributableFund] = await db
    .select()
    .from(funds)
    .where(and(eq(funds.id, input.distributableFundId), eq(funds.tenantId, tenantId)))
    .limit(1);
  if (!distributableFund) throw new AppError('Distributable fund not found', 404, 'NOT_FOUND');

  // Reserve funds have historically been stored with inconsistent casing
  // ('Reserve' vs 'RESERVE'), and a case-sensitive lookup silently found
  // nothing — which made distribution impossible. Match case-insensitively.
  const reserveConditions = input.reserveFundId
    ? [eq(funds.tenantId, tenantId), eq(funds.id, input.reserveFundId)]
    : [eq(funds.tenantId, tenantId), sql`upper(${funds.type}) = 'RESERVE'`, eq(funds.status, 'ACTIVE')];
  const [reserveFund] = await db
    .select()
    .from(funds)
    .where(and(...reserveConditions))
    .limit(1);

  if (!reserveFund) {
    throw new AppError(
      input.reserveFundId
        ? 'Selected reserve fund not found in this organization'
        : 'No active RESERVE fund found. Create one on the Funds screen before distributing dividends.',
      404,
      'RESERVE_FUND_REQUIRED',
    );
  }
  if (input.reserveFundId && (reserveFund.type ?? '').toUpperCase() !== 'RESERVE') {
    throw new AppError('The selected reserve fund must be a RESERVE type fund', 400, 'INVALID_RESERVE_FUND');
  }

  const memberRows = await db
    .select({
      id: members.id,
      memberId: members.memberId,
      name: members.name,
      role: members.role,
      shares: members.shares,
    })
    .from(members)
    .where(
      and(
        eq(members.tenantId, tenantId),
        eq(members.status, 'active'),
        // Soft-deleted members keep their history but leave the roster — a
        // removed partner must not accrue a new dividend run.
        eq(members.isDeleted, false),
        sql`${members.shares} > 0`,
      ),
    )
    .orderBy(members.name);

  // The exclusive 'Project Member' category never receives club dividends —
  // it is paid only by the project it belongs to (§3.2). Its forced 0 club
  // shares already exclude it via `shares > 0` above; this explicit guard
  // keeps that promise true even if a hand-edited row ever carries shares.
  const memberSeeds: DividendMemberSeed[] = memberRows.filter(
    (m) => (m.role ?? '') !== PROJECT_MEMBER_ROLE,
  );

  const plan = computeDividendPlan({
    grossEarnings: input.grossEarnings,
    statutoryReservePercent: reservePercent,
    members: memberSeeds,
    rulesBp,
  });

  const distributableBalanceCents = toCents(distributableFund.balance ?? '0');
  if (distributableBalanceCents < plan.grossCents) {
    throw new AppError(
      `Insufficient fund balance. Available: ${fromCents(distributableBalanceCents)}, Required: ${plan.grossAmount}`,
      400,
      'INSUFFICIENT_FUND_BALANCE',
    );
  }

  return { plan, distributableFund, reserveFund };
}
