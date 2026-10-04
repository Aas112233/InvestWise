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
import { auditLogs, members, systemSettings, tenants, transactions } from "@/db/schema/index";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { toCents } from "../money";
import { DEFAULT_SHARE_VALUE_CENTS, resolveShareValueCents, sharesToCents } from "../shares";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { logAudit } from "../utils/audit";
import {
  DEFAULT_GOVERNANCE_RULES,
  DEPOSIT_COMPLIANCE,
  GovernanceRuleError,
  MEMBER_STATUS,
  allocateDepositsToPeriods,
  addMonthsToPeriodKey,
  evaluatePeriodDeposits,
  evaluateStatusTransition,
  hasOutstandingObligation,
  isValidPeriodKey,
  monthsSincePeriodKey,
  normalizeGovernanceRules,
  parsePeriodKey,
  resolveDepositDeadline,
  toPeriodKey,
  type DepositCompliance,
  type GovernanceRules,
  type MemberStatus,
  type MonthEvaluation,
  type PeriodRequirement,
  type StatusEvaluation,
  type StatusTransition,
} from "./status-rules";

const MAX_WINDOW_MONTHS = 60;

/** Members on a non-monthly schedule are not judged by a monthly rule. */
const MONTHLY_FREQUENCIES = new Set(["monthly", "month", "1"]);

export interface GovernanceRulesSnapshot {
  rules: GovernanceRules;
  shareValueCents: number;
  /** True when a stored value was out of range and defaults were substituted. */
  usedDefaults: boolean;
  problem?: string;
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

  return { rules, shareValueCents, usedDefaults, problem };
}

/**
 * Monthly obligation for a member, in cents.
 *
 * An explicit `monthlyDepositTarget` always wins. Otherwise the requirement is
 * share value × shares, floored at one share so a member recorded with 0 shares
 * still carries an obligation instead of silently passing every month.
 */
export function resolveRequiredMonthlyCents(
  member: { shares?: number | null; monthlyDepositTarget?: string | number | null },
  shareValueCents: number,
): number {
  const target = member.monthlyDepositTarget;
  if (target !== null && target !== undefined && target !== "") {
    const cents = toCents(target);
    if (cents > 0) return cents;
  }
  const shares = Number(member.shares ?? 0);
  return sharesToCents(Math.max(1, Number.isFinite(shares) ? Math.trunc(shares) : 1), shareValueCents);
}

export interface MemberStatusSnapshot {
  memberId: string;
  memberCode: string;
  name: string;
  status: MemberStatus;
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
  const firstPeriodKey = addMonthsToPeriodKey(asOfPeriodKey, -(windowMonths - 1));

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
  const evaluation = evaluateStatusTransition({
    currentStatus,
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

function isMonthlySchedule(depositFrequency: string | null | undefined): boolean {
  if (!depositFrequency) return true;
  return MONTHLY_FREQUENCIES.has(String(depositFrequency).trim().toLowerCase());
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
): Promise<Map<string, Array<{ date: Date; amountCents: number }>>> {
  const empty = new Map<string, Array<{ date: Date; amountCents: number }>>();
  if (memberIds.length === 0) return empty;

  const db = getDb();
  const windowStart = windowStartDate(addMonthsToPeriodKey(toPeriodKey(asOf), -(windowMonths - 1)));

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

function toStatusSnapshot(member: MemberRow, result: MemberEvaluation): MemberStatusSnapshot {
  return {
    memberId: member.id,
    memberCode: member.memberId,
    name: member.name,
    status: result.evaluation.currentStatus,
    shares: Number(member.shares ?? 0),
    requiredCents: result.requiredCents,
    monthsWithoutDeposit: result.monthsWithoutDeposit,
    suspensionEligible: result.evaluation.suspensionEligible,
    reinstateRecommended: result.evaluation.reinstateRecommended,
    transition: result.evaluation.transition,
    nextStatus: result.evaluation.nextStatus,
    autoApply: result.evaluation.autoApply,
    skippedFrequency: isMonthlySchedule(member.depositFrequency)
      ? undefined
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
  );

  const members = memberRows.map((member) => {
    const result = evaluateMemberFromLegs(member, legsByMember.get(member.id) ?? [], snapshot, asOf, windowMonths);
    return toStatusSnapshot(member, result);
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
  const legsByMember = await loadDepositLegsForMembers(tenantId, [member.id], asOf, windowMonths);

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
  );

  const pending: Array<{ row: MemberRow; snapshot: MemberStatusSnapshot }> = [];
  let suspensionEligible = 0;
  let reinstateRecommended = 0;
  let skippedNonMonthly = 0;

  for (const row of memberRows) {
    if (!isMonthlySchedule(row.depositFrequency)) {
      skippedNonMonthly += 1;
      continue;
    }
    const result = evaluateMemberFromLegs(row, legsByMember.get(row.id) ?? [], snapshot, asOf, windowMonths);
    const statusSnapshot = toStatusSnapshot(row, result);
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
        .set({ status: to, updatedAt: asOf })
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
    .set({ status: MEMBER_STATUS.SUSPENDED, updatedAt: new Date() })
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

  const db = getDb();
  await db
    .update(members)
    .set({ status: MEMBER_STATUS.ACTIVE, updatedAt: new Date() })
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
export { resolveDepositDeadline, DEPOSIT_COMPLIANCE, MEMBER_STATUS };
