/**
 * Governance deposit-compliance + member-status orchestration.
 *
 * Every read and write here is scoped by `tenantId` (§6). The legacy Express
 * engine in `server/src/modules/governance/performance.ts` queries `members`
 * and `system_settings` with NO tenant filter and would sweep every tenant at
 * once — that behaviour is deliberately not ported.
 *
 * Money is integer cents end to end. Period keys are 'YYYY-MM' in UTC.
 */

import { getDb } from "@/db/index";
import { auditLogs, memberPayoutPlans, members, systemSettings, tenants, transactions } from "@/db/schema/index";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { toCents } from "../money";
import {
  DEPOSIT_SCHEDULE,
  isMonthlyDepositFrequency,
  normalizeDepositSchedule,
  resolveDepositScheduleDetailed,
} from "../deposit-schedule/schedule";
import { DEFAULT_SHARE_VALUE_CENTS, resolveShareValueCents } from "../shares";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { logAudit } from "../utils/audit";
import {
  DEFAULT_GOVERNANCE_RULES,
  DEPOSIT_COMPLIANCE,
  GovernanceRuleError,
  MEMBER_STATUS,
  MEMBER_STATUS_REASON,
  allocateDepositsToPeriods,
  addMonthsToPeriodKey,
  evaluatePeriodDeposits,
  evaluateStatusTransition,
  firstEnforcedPeriodKey,
  hasOutstandingObligation,
  MAX_WINDOW_MONTHS,
  isMemberStatusReason,
  isValidPeriodKey,
  monthsSincePeriodKey,
  normalizeGovernanceRules,
  parsePeriodKey,
  resolveDepositDeadline,
  resolveRequiredMonthlyCents,
  toPeriodKey,
  type DepositCompliance,
  type GovernanceRules,
  type MemberStatus,
  type MemberStatusReason,
  type MonthEvaluation,
  type PeriodRequirement,
  type StatusEvaluation,
  type StatusTransition,
} from "./status-rules";

// MAX_WINDOW_MONTHS is imported above, from the module whose guard loop it protects.

/** Members on a non-monthly schedule are not judged by a monthly rule. The vocabulary itself
 * is owned by `lib/deposit-schedule/schedule.ts` — one source of truth shared with the
 * duplicate guard, performance scoring, the leaderboard and the analysis matrix. */

export interface GovernanceRulesSnapshot {
  rules: GovernanceRules;
  shareValueCents: number;
  /** True when a stored value was out of range and defaults were substituted. */
  usedDefaults: boolean;
  problem?: string;
  /**
   * This tenant's configured deposit schedule ('monthly' | 'flexible').
   *
   * Part of the snapshot because governance is judged against the TENANT's schedule
   * as well as the member's own cadence. Without it a tenant could switch to
   * flexible in Settings and still have every member auto-held for "missing"
   * monthly deposits, because `members.deposit_frequency` defaults to 'monthly' and
   * would keep saying so. Fail-closed: an absent or unrecognised value is monthly.
   */
  depositSchedule: string;
  /**
   * When this tenant last SWITCHED its deposit schedule, or null when it never has.
   *
   * Read from the settings row already fetched here, so it costs no query. It exists because
   * `deposit_schedule_changed_at` was previously written and then read by nothing, which left one
   * direction of switching able to invent arrears: a tenant that ran flexible for two years and
   * then chose monthly would have its whole lookback window judged as monthly, writing PARTIAL /
   * MISSED for months nobody ever owed, and could auto-hold members on the very next sweep.
   * `firstEnforcedPeriodKey` turns it into the month the obligation actually began.
   */
  depositScheduleChangedAt: Date | null;
}

/**
 * Is this member subject to the enforced monthly obligation?
 *
 * THE question governance, the payment matrix and scoring all need the same answer
 * to. Flexible if EITHER the tenant switched the book over OR the member's own
 * cadence is non-monthly — see `lib/deposit-schedule/schedule.ts` for why tenant
 * wins over the stored per-member default.
 */
export function isMemberObligationEnforced(
  snapshot: { depositSchedule?: string | null },
  depositFrequency: string | null | undefined,
): boolean {
  return resolveDepositScheduleDetailed({
    tenantSchedule: snapshot.depositSchedule,
    memberDepositFrequency: depositFrequency,
  }).enforced;
}

/**
 * Read this tenant's governance rules.
 *
 * A hand-edited or corrupted row must not take the nightly sweep down, so an
 * out-of-range value falls back to defaults and reports `problem` for the
 * caller to surface. Never throws.
 */
export async function getGovernanceRules(tenantId: string): Promise<GovernanceRulesSnapshot> {
  const db = getDb();
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  if (!settings) {
    return {
      rules: { ...DEFAULT_GOVERNANCE_RULES },
      shareValueCents: DEFAULT_SHARE_VALUE_CENTS,
      usedDefaults: true,
      // No settings row ⇒ monthly. Governance stays ON rather than silently
      // exempting a tenant whose row has not been provisioned.
      depositSchedule: DEPOSIT_SCHEDULE.MONTHLY,
      // No row ⇒ nothing to clamp: the window stays the rule-derived one.
      depositScheduleChangedAt: null,
    };
  }

  let rules = { ...DEFAULT_GOVERNANCE_RULES };
  let usedDefaults = false;
  let problem: string | undefined;
  try {
    rules = normalizeGovernanceRules({
      depositDueDate: settings.depositDueDate ?? undefined,
      gracePeriodDays: settings.gracePeriodDays ?? undefined,
      lateDepositGraceMonths: settings.lateDepositGraceMonths ?? undefined,
      inactiveAfterMonths: settings.inactiveAfterMonths ?? undefined,
      suspendedAfterMonths: settings.suspendedAfterMonths ?? undefined,
    });
  } catch (error) {
    if (error instanceof GovernanceRuleError) {
      usedDefaults = true;
      problem = error.message;
    } else {
      throw error;
    }
  }

  let shareValueCents = DEFAULT_SHARE_VALUE_CENTS;
  try {
    shareValueCents = resolveShareValueCents(settings);
  } catch {
    usedDefaults = true;
    problem = problem ?? "shareValueBdt is not a positive amount; using the default";
  }

  return {
    rules,
    shareValueCents,
    usedDefaults,
    problem,
    // Read from the row already fetched — no extra query. An unrecognised stored
    // value fails closed to monthly, so governance is never switched off by accident.
    depositSchedule: normalizeDepositSchedule(settings.depositSchedule ?? null).schedule,
    // Same row, same query. A junk value becomes an Invalid Date inside
    // obligationStartPeriodKey and falls back to no clamp, so this can never switch
    // governance off by accident.
    depositScheduleChangedAt: settings.depositScheduleChangedAt ?? null,
  };
}

export interface MemberStatusSnapshot {
  memberId: string;
  memberCode: string;
  name: string;
  status: MemberStatus;
  /** Why the member is not active (null when active). */
  statusReason: MemberStatusReason | null;
  shares: number;
  requiredCents: number;
  monthsWithoutDeposit: number;
  suspensionEligible: boolean;
  reinstateRecommended: boolean;
  transition: StatusTransition;
  nextStatus: MemberStatus;
  /** True when the sweep may persist `nextStatus` without an admin. */
  autoApply: boolean;
  /** Set when the member is judged on a schedule these monthly rules skip. */
  skippedFrequency?: string;
}

export interface PeriodReport extends MonthEvaluation {
  compliance: DepositCompliance;
}

interface MemberRow {
  id: string;
  memberId: string;
  name: string;
  status: string | null;
  statusReason: string | null;
  shares: number;
  monthlyDepositTarget: string | null;
  depositFrequency: string | null;
  joinDate: Date | null;
  lastDepositMonth: string | null;
}

function selectMemberColumns() {
  return {
    id: members.id,
    memberId: members.memberId,
    name: members.name,
    status: members.status,
    statusReason: members.statusReason,
    shares: members.shares,
    monthlyDepositTarget: members.monthlyDepositTarget,
    depositFrequency: members.depositFrequency,
    joinDate: members.joinDate,
    lastDepositMonth: members.lastDepositMonth,
  };
}

interface DepositLegRow {
  memberId: string | null;
  date: Date | null;
  amount: string;
}

function buildPeriodRequirements(
  fromPeriodKey: string,
  toPeriodKeyInclusive: string,
  requiredCents: number,
): PeriodRequirement[] {
  // An empty window is a real state, not a caller mistake: `firstEnforcedPeriodKey` returns a start
  // AFTER the as-of month when the tenant adopted monthly so recently that no period has become
  // owed yet. Without this guard the loop below never reaches `to`, runs to its guard limit, and
  // hands back ~60 FUTURE periods — which the deadline filter then ignores, so it looked harmless
  // while quietly evaluating a member against money that has not been demanded.
  if (fromPeriodKey > toPeriodKeyInclusive) return [];

  const requirements: PeriodRequirement[] = [];
  let cursor = fromPeriodKey;
  // Guard against a malformed cursor looping forever.
  for (let guard = 0; guard <= MAX_WINDOW_MONTHS; guard += 1) {
    requirements.push({ periodKey: cursor, requiredCents: requiredCents });
    if (cursor === toPeriodKeyInclusive) break;
    cursor = addMonthsToPeriodKey(cursor, 1);
  }
  return requirements;
}

function windowStartDate(fromPeriodKey: string): Date {
  const { year, month } = parsePeriodKey(fromPeriodKey);
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export interface MemberEvaluation {
  memberId: string;
  requiredCents: number;
  monthsWithoutDeposit: number;
  hasQualifyingDeposit: boolean;
  periods: PeriodReport[];
  unallocatedCents: number;
  outstandingCents: number;
  evaluation: StatusEvaluation;
}

/**
 * Evaluate one member's compliance from already-loaded deposit legs.
 *
 * `hasQualifyingDeposit` means "no period that is actually due still owes
 * money". A period only counts once its deadline has passed, so a member is
 * never held for a month that has not come round yet.
 */
export function evaluateMemberFromLegs(
  member: MemberRow,
  legs: Array<{ date: Date; amountCents: number }>,
  snapshot: GovernanceRulesSnapshot,
  asOf: Date,
  windowMonths: number,
): MemberEvaluation {
  const { rules, shareValueCents } = snapshot;
  const requiredCents = resolveRequiredMonthlyCents(member, shareValueCents);
  const asOfPeriodKey = toPeriodKey(asOf);
  // Same helper the deposit-legs query uses, so the months judged and the months
  // loaded cannot disagree — a wider judgement window would report unloaded
  // history as missing money.
  const firstPeriodKey = firstEnforcedPeriodKey({
    asOfPeriodKey,
    windowMonths,
    depositSchedule: snapshot.depositSchedule,
    changedAt: snapshot.depositScheduleChangedAt,
  });

  const requirements = buildPeriodRequirements(firstPeriodKey, asOfPeriodKey, requiredCents);
  const { allocations, unallocatedCents } = allocateDepositsToPeriods(legs, requirements, rules.lateDepositGraceMonths);

  const periods: PeriodReport[] = allocations.map((allocation) => {
    const evaluation = evaluatePeriodDeposits(
      allocation.periodKey,
      allocation.legs,
      allocation.requiredCents,
      rules,
    );
    return {
      ...evaluation,
      // The waterfall settles by cents; compliance still judges timeliness.
      depositedCents: allocation.allocatedCents,
      shortfallCents: allocation.shortfallCents,
    };
  });

  // Months without a deposit = since the most recent period that was actually
  // settled. Falls back to the join month for a member who never paid.
  let lastSettledPeriodKey: string | null = null;
  for (const period of periods) {
    if (period.shortfallCents === 0 && period.depositedCents > 0) {
      lastSettledPeriodKey = period.periodKey;
    }
  }
  const anchorPeriodKey =
    lastSettledPeriodKey ??
    (member.lastDepositMonth && isValidPeriodKey(member.lastDepositMonth)
      ? member.lastDepositMonth
      : member.joinDate
        ? toPeriodKey(member.joinDate)
        : asOfPeriodKey);
  const monthsWithoutDeposit = monthsSincePeriodKey(anchorPeriodKey, asOf);

  // Only periods whose deadline has passed are grounds for holding a member.
  const duePeriods = periods.filter((p) => asOf.getTime() > p.deadline.getTime());
  const hasQualifyingDeposit = !hasOutstandingObligation(duePeriods);

  const currentStatus = (member.status ?? MEMBER_STATUS.ACTIVE) as MemberStatus;
  // Carry the stored reason so the sweep can tell a hold it owns apart from a
  // non-deposit state (equity transferred out, manual admin hold) it must not
  // auto-restore.
  const statusReason = isMemberStatusReason(member.statusReason) ? member.statusReason : null;
  const evaluation = evaluateStatusTransition({
    currentStatus,
    statusReason,
    monthsWithoutDeposit,
    hasQualifyingDeposit,
    rules,
  });

  return {
    memberId: member.id,
    requiredCents,
    monthsWithoutDeposit,
    hasQualifyingDeposit,
    periods,
    unallocatedCents,
    outstandingCents: duePeriods.reduce((sum, p) => sum + p.shortfallCents, 0),
    evaluation,
  };
}

/**
 * True when the member's deposit schedule is the monthly one the governance
 * sweep (and the Analysis regularity matrix) evaluates against. Any other
 * schedule — quarterly, semi-annual, ad-hoc — is skipped by the monthly
 * rules, so a non-monthly member must never accrue monthly MISSED cells.
 */
/**
 * @deprecated Use `isMemberObligationEnforced(snapshot, depositFrequency)` instead.
 *
 * This answers only "what does the member's own row say", and every production
 * consumer of it was a bug once the tenant-level schedule existed: `members
 * .deposit_frequency` defaults to 'monthly' on every row, so a tenant that switched
 * to flexible would still have been governed, auto-held and shown a matrix full of
 * fake MISSED cells. It is kept solely because the byte-equivalence test asserts the
 * port, and must not gain new callers.
 */
export function isMonthlySchedule(depositFrequency: string | null | undefined): boolean {
  return isMonthlyDepositFrequency(depositFrequency);
}

/** How far back a member's history must reach to be judged correctly. */
function requiredWindowMonths(rules: GovernanceRules): number {
  return Math.min(
    MAX_WINDOW_MONTHS,
    Math.max(6, rules.lateDepositGraceMonths + 2, rules.inactiveAfterMonths + 2),
  );
}

/** Every tenant member, paged in bounded chunks so the sweep cannot miss rows. */
async function loadAllTenantMembers(tenantId: string): Promise<MemberRow[]> {
  const PAGE = 100;
  const collected: MemberRow[] = [];
  for (let page = 1; ; page += 1) {
    const { rows, total } = await loadTenantMembers(tenantId, { page, limit: PAGE });
    collected.push(...rows);
    if (collected.length >= total || rows.length === 0) break;
  }
  return collected;
}

/** Deposit legs for a specific set of members, grouped in memory. */
async function loadDepositLegsForMembers(
  tenantId: string,
  memberIds: string[],
  asOf: Date,
  windowMonths: number,
  snapshot: GovernanceRulesSnapshot,
): Promise<Map<string, Array<{ date: Date; amountCents: number }>>> {
  const empty = new Map<string, Array<{ date: Date; amountCents: number }>>();
  if (memberIds.length === 0) return empty;

  const db = getDb();
  // Must stay identical to the window `evaluateMemberFromLegs` builds. If this query were
  // narrowed further than the judgement, a month with money in it would come back empty and be
  // reported as MISSED — so the window is computed by one function, not copied here.
  const windowStart = windowStartDate(
    firstEnforcedPeriodKey({
      asOfPeriodKey: toPeriodKey(asOf),
      windowMonths,
      depositSchedule: snapshot.depositSchedule,
      changedAt: snapshot.depositScheduleChangedAt,
    }),
  );

  const legRows = await db
    .select({
      memberId: transactions.memberId,
      date: transactions.date,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        // §6: the tenant scope is the load-bearing filter here.
        eq(transactions.tenantId, tenantId),
        eq(transactions.type, "Deposit"),
        inArray(transactions.status, ["Completed"]),
        // §12: soft-deleted rows never count as payment.
        eq(transactions.isDeleted, false),
        inArray(transactions.memberId, memberIds),
        gte(transactions.date, windowStart),
        lte(transactions.date, asOf),
      ),
    );

  const legsByMember = new Map<string, Array<{ date: Date; amountCents: number }>>();
  for (const row of legRows as DepositLegRow[]) {
    if (!row.memberId || !row.date) continue;
    const list = legsByMember.get(row.memberId) ?? [];
    list.push({ date: row.date, amountCents: toCents(row.amount) });
    legsByMember.set(row.memberId, list);
  }
  return legsByMember;
}

interface MemberQuery {
  search?: string | null;
  status?: string | null;
  page?: number;
  limit?: number;
}

/**
 * Paginated tenant member rows.
 *
 * Filtering happens in SQL so the deposit legs are only loaded for the page
 * actually being rendered — a large tenant must not drag every member's
 * deposit history through memory on every page view.
 */
async function loadTenantMembers(
  tenantId: string,
  query: MemberQuery = {},
): Promise<{ rows: MemberRow[]; total: number }> {
  const db = getDb();
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));

  const filters = [eq(members.tenantId, tenantId)];
  if (query.status) {
    filters.push(eq(members.status, query.status));
  }
  if (query.search) {
    const term = `%${query.search}%`;
    filters.push(or(ilike(members.name, term), ilike(members.memberId, term))!);
  }
  const where = and(...filters);

  const [rows, totalRes] = await Promise.all([
    db
      .select(selectMemberColumns())
      .from(members)
      .where(where)
      .orderBy(asc(members.name))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)::int` }).from(members).where(where),
  ]);

  return { rows, total: Number(totalRes[0]?.count ?? 0) };
}

function toStatusSnapshot(
  member: MemberRow,
  result: MemberEvaluation,
  tenantSchedule?: string,
): MemberStatusSnapshot {
  return {
    memberId: member.id,
    memberCode: member.memberId,
    name: member.name,
    status: result.evaluation.currentStatus,
    statusReason: isMemberStatusReason(member.statusReason) ? member.statusReason : null,
    shares: Number(member.shares ?? 0),
    requiredCents: result.requiredCents,
    monthsWithoutDeposit: result.monthsWithoutDeposit,
    suspensionEligible: result.evaluation.suspensionEligible,
    reinstateRecommended: result.evaluation.reinstateRecommended,
    transition: result.evaluation.transition,
    nextStatus: result.evaluation.nextStatus,
    autoApply: result.evaluation.autoApply,
    // Reports WHY the member was not judged: their own cadence, or the tenant-wide
    // switch. Without the tenant case a flexible book would report these members as
    // if they were on 'monthly' and simply had no history.
    skippedFrequency: isMemberObligationEnforced(
      { depositSchedule: tenantSchedule ?? DEPOSIT_SCHEDULE.MONTHLY },
      member.depositFrequency,
    )
      ? undefined
      : tenantSchedule === DEPOSIT_SCHEDULE.FLEXIBLE
        ? "flexible-schedule"
        : (member.depositFrequency ?? "unknown"),
  };
}

export interface MemberGovernancePage {
  members: MemberStatusSnapshot[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  rules: GovernanceRules;
  rulesProblem?: string;
}

/** Paginated governance view of the tenant's members. Read-only. */
export async function listMemberGovernanceStatuses(
  tenantId: string,
  options: { asOf?: Date } & MemberQuery = {},
): Promise<MemberGovernancePage> {
  const asOf = options.asOf ?? new Date();
  const snapshot = await getGovernanceRules(tenantId);
  const windowMonths = requiredWindowMonths(snapshot.rules);

  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const { rows: memberRows, total } = await loadTenantMembers(tenantId, {
    search: options.search,
    status: options.status,
    page,
    limit,
  });

  const legsByMember = await loadDepositLegsForMembers(
    tenantId,
    memberRows.map((m) => m.id),
    asOf,
    windowMonths,
    snapshot,
  );

  const members = memberRows.map((member) => {
    const result = evaluateMemberFromLegs(member, legsByMember.get(member.id) ?? [], snapshot, asOf, windowMonths);
    return toStatusSnapshot(member, result, snapshot.depositSchedule);
  });

  return {
    members,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    rules: snapshot.rules,
    ...(snapshot.problem ? { rulesProblem: snapshot.problem } : {}),
  };
}

export interface MemberDepositHistory {
  member: {
    id: string;
    memberCode: string;
    name: string;
    status: MemberStatus;
    /** Why the member is not active (null when active). */
    statusReason: MemberStatusReason | null;
    shares: number;
    joinDate: Date | null;
    depositFrequency: string | null;
  };
  requiredCents: number;
  monthsWithoutDeposit: number;
  hasQualifyingDeposit: boolean;
  outstandingCents: number;
  unallocatedCents: number;
  suspensionEligible: boolean;
  reinstateRecommended: boolean;
  transition: StatusTransition;
  /** Newest period first. */
  periods: PeriodReport[];
}

/**
 * Per-member deposit history with a per-period compliance verdict.
 *
 * `months` is clamped to 1..MAX_WINDOW_MONTHS. Returned newest-first so the
 * table can render without a client-side reverse.
 */
export async function getMemberDepositHistory(
  tenantId: string,
  memberId: string,
  options: { months?: number; asOf?: Date } = {},
): Promise<MemberDepositHistory> {
  const db = getDb();
  const asOf = options.asOf ?? new Date();
  const months = Math.min(MAX_WINDOW_MONTHS, Math.max(1, Math.trunc(options.months ?? 12)));

  const [member] = await db
    .select(selectMemberColumns())
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);

  // A cross-tenant id must be indistinguishable from a missing one.
  if (!member) throw new NotFoundError("Member");

  const snapshot = await getGovernanceRules(tenantId);
  const windowMonths = Math.max(months, requiredWindowMonths(snapshot.rules));
  const legsByMember = await loadDepositLegsForMembers(tenantId, [member.id], asOf, windowMonths, snapshot);

  const result = evaluateMemberFromLegs(member, legsByMember.get(member.id) ?? [], snapshot, asOf, windowMonths);
  const visiblePeriods = result.periods.filter((p) => {
    const cutoff = addMonthsToPeriodKey(toPeriodKey(asOf), -(months - 1));
    return p.periodKey >= cutoff;
  });

  return {
    member: {
      id: member.id,
      memberCode: member.memberId,
      name: member.name,
      status: result.evaluation.currentStatus,
      statusReason: isMemberStatusReason(member.statusReason) ? member.statusReason : null,
      shares: Number(member.shares ?? 0),
      joinDate: member.joinDate,
      depositFrequency: member.depositFrequency,
    },
    requiredCents: result.requiredCents,
    monthsWithoutDeposit: result.monthsWithoutDeposit,
    hasQualifyingDeposit: result.hasQualifyingDeposit,
    outstandingCents: result.outstandingCents,
    unallocatedCents: result.unallocatedCents,
    suspensionEligible: result.evaluation.suspensionEligible,
    reinstateRecommended: result.evaluation.reinstateRecommended,
    transition: result.evaluation.transition,
    periods: [...visiblePeriods].reverse(),
  };
}

export interface SweepResult {
  scanned: number;
  held: number;
  restored: number;
  suspensionEligible: number;
  reinstateRecommended: number;
  skippedNonMonthly: number;
  /** Tenants are swept one at a time; the cron passes an explicit id. */
  changes: Array<{
    memberId: string;
    memberCode: string;
    name: string;
    from: MemberStatus;
    to: MemberStatus;
    monthsWithoutDeposit: number;
  }>;
  rules: GovernanceRules;
  rulesProblem?: string;
}

/**
 * Apply the automatic half of the status lifecycle for one tenant.
 *
 * Automatic: active -> inactive (hold) past `inactiveAfterMonths`, and
 * inactive -> active once no due period owes money.
 * Never automatic: any move into or out of `suspended`. Suspension blocks
 * portal login, so the sweep only reports eligibility.
 *
 * Idempotent — a member already in the target state is not rewritten.
 */
export async function sweepMemberStatuses(
  tenantId: string,
  options: { asOf?: Date; actor?: { id?: string; name?: string } | null } = {},
): Promise<SweepResult> {
  const asOf = options.asOf ?? new Date();
  const snapshot = await getGovernanceRules(tenantId);
  const windowMonths = requiredWindowMonths(snapshot.rules);
  const memberRows = await loadAllTenantMembers(tenantId);
  const legsByMember = await loadDepositLegsForMembers(
    tenantId,
    memberRows.map((m) => m.id),
    asOf,
    windowMonths,
    snapshot,
  );

  const pending: Array<{ row: MemberRow; snapshot: MemberStatusSnapshot }> = [];
  let suspensionEligible = 0;
  let reinstateRecommended = 0;
  let skippedNonMonthly = 0;

  for (const row of memberRows) {
    // Tenant schedule counts, not only the member's own cadence: a tenant that
    // switched to flexible must not keep having members auto-held for deposits the
    // schedule no longer requires. Members on a monthly cadence in a flexible
    // tenant are exempt too, because the tenant decision governs the book.
    if (!isMemberObligationEnforced(snapshot, row.depositFrequency)) {
      skippedNonMonthly += 1;
      continue;
    }
    const result = evaluateMemberFromLegs(row, legsByMember.get(row.id) ?? [], snapshot, asOf, windowMonths);
    const statusSnapshot = toStatusSnapshot(row, result, snapshot.depositSchedule);
    if (statusSnapshot.suspensionEligible) suspensionEligible += 1;
    if (statusSnapshot.reinstateRecommended) reinstateRecommended += 1;
    if (statusSnapshot.autoApply) pending.push({ row, snapshot: statusSnapshot });
  }

  if (pending.length === 0) {
    return {
      scanned: memberRows.length,
      held: 0,
      restored: 0,
      suspensionEligible,
      reinstateRecommended,
      skippedNonMonthly,
      changes: [],
      rules: snapshot.rules,
      ...(snapshot.problem ? { rulesProblem: snapshot.problem } : {}),
    };
  }

  const db = getDb();
  const changes: SweepResult["changes"] = [];

  await db.transaction(async (tx) => {
    for (const { row, snapshot: statusSnapshot } of pending) {
      const from = statusSnapshot.status;
      const to = statusSnapshot.nextStatus;
      // Re-assert both halves of the tenant scope on the write (§6).
      await tx
        .update(members)
        .set({
          status: to,
          // The sweep only ever applies AUTO_HOLD (deposit-driven) or
          // AUTO_RESTORE, so the reason is deterministic: a hold stamps the
          // deposit cause, a restore clears it so an active member never
          // carries a stale reason.
          statusReason:
            to === MEMBER_STATUS.INACTIVE ? MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE : null,
          updatedAt: asOf,
        })
        .where(and(eq(members.id, row.id), eq(members.tenantId, tenantId)));

      changes.push({
        memberId: row.id,
        memberCode: row.memberId,
        name: row.name,
        from,
        to,
        monthsWithoutDeposit: statusSnapshot.monthsWithoutDeposit,
      });

      await tx.insert(auditLogs).values({
        userId: options.actor?.id ?? null,
        userName: options.actor?.name ?? "Governance sweep",
        tenantId,
        action: to === MEMBER_STATUS.INACTIVE ? "MEMBER_AUTO_HELD" : "MEMBER_AUTO_RESTORED",
        resourceType: "Member",
        resourceId: row.id,
        details: {
          fromStatus: from,
          toStatus: to,
          monthsWithoutDeposit: statusSnapshot.monthsWithoutDeposit,
          thresholds: {
            inactiveAfterMonths: snapshot.rules.inactiveAfterMonths,
            suspendedAfterMonths: snapshot.rules.suspendedAfterMonths,
          },
        },
        status: "SUCCESS",
      });
    }
  });

  const held = changes.filter((c) => c.to === MEMBER_STATUS.INACTIVE).length;
  return {
    scanned: memberRows.length,
    held,
    restored: changes.length - held,
    suspensionEligible,
    reinstateRecommended,
    skippedNonMonthly,
    changes,
    rules: snapshot.rules,
    ...(snapshot.problem ? { rulesProblem: snapshot.problem } : {}),
  };
}

export interface AdminStatusActionResult {
  memberId: string;
  memberCode: string;
  name: string;
  from: MemberStatus;
  to: MemberStatus;
}

async function loadTenantMember(tenantId: string, memberId: string): Promise<MemberRow> {
  const db = getDb();
  const [row] = await db
    .select(selectMemberColumns())
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new NotFoundError("Member");
  return row;
}

/** Admin confirms a suspension. Blocks portal login until reinstated. */
export async function suspendMember(
  tenantId: string,
  memberId: string,
  actor: { id?: string; name?: string },
  reason: string,
): Promise<AdminStatusActionResult> {
  const trimmed = reason?.trim();
  if (!trimmed) throw new ValidationError("A reason is required to suspend a member");

  const row = await loadTenantMember(tenantId, memberId);
  const from = (row.status ?? MEMBER_STATUS.ACTIVE) as MemberStatus;
  if (from === MEMBER_STATUS.SUSPENDED) {
    throw new ConflictError("Member is already suspended");
  }

  const db = getDb();
  await db
    .update(members)
    .set({
      status: MEMBER_STATUS.SUSPENDED,
      // Suspension is always a hand-made admin decision; record why the member
      // is frozen so the sweep never mistakes it for a deposit hold.
      statusReason: MEMBER_STATUS_REASON.ADMIN_MANUAL,
      updatedAt: new Date(),
    })
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)));

  await logAudit({
    user: actor,
    tenantId,
    action: "MEMBER_SUSPENDED",
    resourceType: "Member",
    resourceId: memberId,
    details: { memberCode: row.memberId, memberName: row.name, fromStatus: from, reason: trimmed },
  });

  return { memberId, memberCode: row.memberId, name: row.name, from, to: MEMBER_STATUS.SUSPENDED };
}

/** Admin reinstates a held or suspended member. */
export async function reinstateMember(
  tenantId: string,
  memberId: string,
  actor: { id?: string; name?: string },
  reason: string,
): Promise<AdminStatusActionResult> {
  const trimmed = reason?.trim();
  if (!trimmed) throw new ValidationError("A reason is required to reinstate a member");

  const row = await loadTenantMember(tenantId, memberId);
  const from = (row.status ?? MEMBER_STATUS.ACTIVE) as MemberStatus;
  if (from === MEMBER_STATUS.ACTIVE) {
    throw new ConflictError("Member is already active");
  }

  // An open payout plan has already reserved this member's balance and may have
  // paid part of it out. Reinstating now would hand back money the settlement
  // owes while the plan keeps running, so the plan must be cancelled first.
  const [openPlan] = await getDb()
    .select({ id: memberPayoutPlans.id, totalAmount: memberPayoutPlans.totalAmount })
    .from(memberPayoutPlans)
    .where(
      and(
        eq(memberPayoutPlans.tenantId, tenantId),
        eq(memberPayoutPlans.memberId, memberId),
        eq(memberPayoutPlans.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (openPlan) {
    throw new ConflictError(
      "This member has an open payout plan (exit settlement). Cancel the plan before reinstating them.",
    );
  }

  const db = getDb();
  await db
    .update(members)
    .set({
      status: MEMBER_STATUS.ACTIVE,
      // Back to active: no reason to record.
      statusReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)));

  await logAudit({
    user: actor,
    tenantId,
    action: "MEMBER_REINSTATED",
    resourceType: "Member",
    resourceId: memberId,
    details: { memberCode: row.memberId, memberName: row.name, fromStatus: from, reason: trimmed },
  });

  return { memberId, memberCode: row.memberId, name: row.name, from, to: MEMBER_STATUS.ACTIVE };
}

/**
 * Sweep every active tenant, one tenant at a time.
 *
 * Deliberately sequential: each tenant's sweep reads and writes its own rows,
 * and a single failing tenant must not abort the others — its error is captured
 * and reported so the cron response shows partial success rather than pretending
 * the whole run was clean.
 */
export async function sweepAllGovernanceTenants(
  options: { asOf?: Date; actor?: { id?: string; name?: string } | null } = {},
): Promise<{ tenantsSwept: number; totals: { held: number; restored: number; suspensionEligible: number; reinstateRecommended: number }; results: Array<{ tenantId: string; ok: boolean; held: number; restored: number; suspensionEligible: number; reinstateRecommended: number; error?: string }> }> {
  const db = getDb();
  const tenantRows = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.status, "active"));

  const results: Awaited<ReturnType<typeof sweepAllGovernanceTenants>>["results"] = [];
  const totals = { held: 0, restored: 0, suspensionEligible: 0, reinstateRecommended: 0 };

  for (const tenant of tenantRows) {
    try {
      const result = await sweepMemberStatuses(tenant.id, options);
      totals.held += result.held;
      totals.restored += result.restored;
      totals.suspensionEligible += result.suspensionEligible;
      totals.reinstateRecommended += result.reinstateRecommended;
      results.push({
        tenantId: tenant.id,
        ok: true,
        held: result.held,
        restored: result.restored,
        suspensionEligible: result.suspensionEligible,
        reinstateRecommended: result.reinstateRecommended,
      });
    } catch (error) {
      console.error(`[GOVERNANCE SWEEP] tenant ${tenant.slug} failed:`, error);
      results.push({
        tenantId: tenant.id,
        ok: false,
        held: 0,
        restored: 0,
        suspensionEligible: 0,
        reinstateRecommended: 0,
        error: (error as Error)?.message ?? "unknown error",
      });
    }
  }

  return { tenantsSwept: results.filter((r) => r.ok).length, totals, results };
}

/** Deadline for a period, re-exported so route handlers need one import. */
export { resolveDepositDeadline, resolveRequiredMonthlyCents, DEPOSIT_COMPLIANCE, MEMBER_STATUS };
