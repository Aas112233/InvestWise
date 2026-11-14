/**
 * Per-member-type profit/loss distribution rules (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md).
 *
 * A tenant configures a list of rules, one per member category (the vocabulary in
 * `lib/member-roles.ts`): the category takes its percentage of the MEMBER POOL of
 * every returns/dividend leg, and inside the category the money still splits
 * pro-rata by share number. No rules configured = today's pure pro-rata behavior,
 * byte-identical.
 *
 * This file owns the rule SHAPE and its validation — the single place the settings
 * API, the settings UI and both run engines agree on what a valid rule is. The
 * actual split math lives in `lib/money.ts::splitByTypeAndShares` and never
 * re-validates roles (it trusts the Map this module produces, while still
 * range-checking basis points defensively, like `splitByPercent` does).
 *
 * Percentages are carried as the user typed them (≤2dp) at the storage boundary
 * and converted to integer basis points (`parsePercentBp`) for every computation —
 * the same discipline AGENTS.md §12 requires of all percent math.
 */

import { isMemberRole, type MemberRole } from './member-roles';
import {
  MoneyError,
  parsePercentBp,
  splitByTypeAndShares,
  splitDividendByShares,
  splitEvenlyCents,
  type TypeSplitBlock,
} from './money';

export interface DistributionRule {
  role: MemberRole;
  /** 0 < percent <= 100, at most 2 decimal places, as the user entered it. */
  percent: number;
}

/** Max distinct rules: the vocabulary size. Keeps a hand-crafted payload bounded. */
export const MAX_DISTRIBUTION_RULES = 16;

/**
 * Strict parse of a stored/submitted rule list. Throws `MoneyError` with a stable
 * code — the settings PUT maps it to a 400, and a run route treats a throw as a
 * configuration fault to surface rather than silently mis-splitting money.
 *
 * null / undefined / [] means "not configured" and returns [] (fail to the
 * historical pro-rata behavior).
 */
export function parseDistributionRules(value: unknown): DistributionRule[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new MoneyError('distributionRules must be an array', 'INVALID_RULES_SHAPE');
  }
  if (value.length > MAX_DISTRIBUTION_RULES) {
    throw new MoneyError(
      `distributionRules may hold at most ${MAX_DISTRIBUTION_RULES} entries`,
      'INVALID_RULES_SHAPE',
    );
  }

  const rules: DistributionRule[] = [];
  const seen = new Set<string>();
  let sumBp = 0;

  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new MoneyError('Each distribution rule must be an object', 'INVALID_RULES_SHAPE');
    }
    const entry = raw as { role?: unknown; percent?: unknown };

    if (!isMemberRole(entry.role)) {
      throw new MoneyError(
        `Unknown member category in distribution rules: ${String(entry.role)}`,
        'UNKNOWN_ROLE',
      );
    }
    if (seen.has(entry.role)) {
      throw new MoneyError(
        `Duplicate distribution rule for member category: ${entry.role}`,
        'DUPLICATE_ROLE',
      );
    }
    seen.add(entry.role);

    // parsePercentBp owns the (0, 100] + ≤2dp contract and throws MoneyError.
    const bp = parsePercentBp(entry.percent as string | number, `percent (${entry.role})`);
    sumBp += bp;
    rules.push({ role: entry.role, percent: bp / 100 });
  }

  if (sumBp > 10_000) {
    throw new MoneyError(
      'Distribution rule percentages must not exceed 100% in total',
      'PERCENT_SUM_EXCEEDED',
    );
  }
  return rules;
}

/**
 * Permissive read for GET /api/settings: never fails a page load on garbage a
 * hand-edited row might hold. null/[]/non-array → [], and entries that are not
 * valid rules are dropped (the form then re-validates whatever it shows).
 */
export function sanitizeDistributionRules(value: unknown): DistributionRule[] {
  if (!Array.isArray(value)) return [];
  const out: DistributionRule[] = [];
  const seen = new Set<string>();
  let sumBp = 0;
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as { role?: unknown; percent?: unknown };
    if (!isMemberRole(entry.role) || seen.has(entry.role)) continue;
    if (typeof entry.percent !== 'number' && typeof entry.percent !== 'string') continue;
    let bp: number;
    try {
      bp = parsePercentBp(entry.percent, `percent (${entry.role})`);
    } catch {
      continue;
    }
    if (sumBp + bp > 10_000) continue; // rules past the 100% ceiling are not shown
    seen.add(entry.role);
    sumBp += bp;
    out.push({ role: entry.role, percent: bp / 100 });
  }
  return out;
}

/**
 * Role → basis points map for the split engine. Runs `parseDistributionRules`
 * first so a run route can pass raw jsonb straight in and a corrupted stored
 * config fails loudly instead of mis-splitting money.
 */
export function distributionRulesToBp(value: unknown): Map<MemberRole, number> {
  const rules = parseDistributionRules(value);
  const map = new Map<MemberRole, number>();
  for (const rule of rules) {
    map.set(rule.role, parsePercentBp(rule.percent, `percent (${rule.role})`));
  }
  return map;
}

/** Sum of configured percentages in bp (display helpers show "configured: X%"). */
export function distributionRulesSumBp(rules: DistributionRule[]): number {
  return rules.reduce((acc, r) => acc + parsePercentBp(r.percent, `percent (${r.role})`), 0);
}

/**
 * The exclusive project-scoped category. Lives here (next to the vocabulary) so
 * the dividend roster guard, the member form and the deposit-cap helper all read
 * one constant instead of each hard-coding the string.
 * (2026-11-12: renamed from 'Project Member' with the six-category vocabulary —
 * migration 0029 rewrites any stored row; the constant stays the only source.)
 */
export const PROJECT_MEMBER_ROLE: MemberRole = 'Project Level Member';

export function isProjectMemberRole(role: unknown): boolean {
  return role === PROJECT_MEMBER_ROLE;
}

/* --------------------------------------------------------------------------
 * Per-project override for the Project Level Member category (migration 0030)
 *
 * Each project may carve its own percentage for its Project Level Members —
 * every project is a different kind of deal. The resolution order lives HERE,
 * next to the rule vocabulary, so the run engine, the project API and the
 * member screen can never disagree about what percentage a PM actually gets:
 *
 *   project override  →  club-wide rule (Settings → Financial)  →  unconfigured
 *
 * An override is stored as decimal(5,2) text and parsed with the same
 * `parsePercentBp` contract as everything else — never float math (§12).
 * ------------------------------------------------------------------------ */

/**
 * Parse a stored/submitted project override. null/undefined/'' mean "no
 * override" (club rule applies) and return null; anything else must satisfy
 * the (0, 100] ≤2dp percent contract (MoneyError on violation).
 */
export function parseProjectMemberOverrideBp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  // Callers hand this raw jsonb / request values — anything that is not a
  // plain percent must fail as a MoneyError (mapped to a 400), never as a
  // TypeError from deep inside the cents parser.
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new MoneyError(
      `percent (${PROJECT_MEMBER_ROLE}) must be a string or number`,
      'INVALID_RULES_SHAPE',
    );
  }
  return parsePercentBp(value, `percent (${PROJECT_MEMBER_ROLE})`);
}

/**
 * The rule set a project's returns run must use: the club rules with the
 * Project Level Member entry replaced by the project's own percentage (when
 * set). Returns a NEW map — the caller's club map is never mutated, so one
 * run's project can't leak an override into another's preview.
 *
 * With no club rules at all, an override still works: the PM category carves
 * its block and every other member shares the pro-rata remainder.
 */
export function withProjectMemberOverride(
  clubRulesBp: Map<MemberRole, number>,
  override: unknown,
): Map<MemberRole, number> {
  const bp = parseProjectMemberOverrideBp(override);
  const rules = new Map(clubRulesBp);
  if (bp !== null) rules.set(PROJECT_MEMBER_ROLE, bp);
  return rules;
}

/**
 * The single percentage a Project Level Member actually gets on THIS project
 * — override first, club rule second, null when neither is configured (the
 * member then splits purely pro-rata with the unconfigured pool). The member
 * screen renders exactly this value; the run engine spends exactly these bp.
 */
export function effectiveProjectMemberBp(
  clubRulesBp: Map<MemberRole, number>,
  override: unknown,
): number | null {
  const bp = parseProjectMemberOverrideBp(override);
  if (bp !== null) return bp;
  return clubRulesBp.get(PROJECT_MEMBER_ROLE) ?? null;
}

/**
 * Save-time guard: the club rules OTHER than the PM category, plus the
 * project's effective PM percentage, must still fit inside 100%. A project
 * cannot smuggle in a 90% carve-out next to a 40% Board rule.
 */
export function assertProjectRulesFit(
  clubRulesBp: Map<MemberRole, number>,
  override: unknown,
): void {
  const effective = withProjectMemberOverride(clubRulesBp, override);
  let sumBp = 0;
  for (const bp of effective.values()) sumBp += bp;
  if (sumBp > 10_000) {
    throw new MoneyError(
      'This project\u2019s Project Level Member percentage plus the configured club categories exceed 100% in total',
      'PERCENT_SUM_EXCEEDED',
    );
  }
}

/* ==========================================================================
 * Project types (migration 0032, docs/PROJECT-TYPES_PLAN.md)
 *
 * Two shapes of deal, one resolver:
 *
 *   club_level      Board + Shareholder only. Capital by shares; returns by the
 *                   Settings category rules, with this project's PM override
 *                   merged in — the engine that already shipped, untouched.
 *
 *   extra_investor  Adds Project Level Members on a CONTRACT percentage. The
 *                   contract is carved off the member pool first and split
 *                   equally between the PMs; the remainder is split 100% by
 *                   share number between Board + Shareholder together. Category
 *                   rules do not participate at all — which is exactly why the
 *                   Σ>100 conflict class (v9) cannot exist for this type.
 *
 * Everything here is pure: integer cents in, integer cents out, and a run that
 * cannot reconcile aborts instead of posting a wrong cent. The API, the run
 * route and the modal preview all call `splitProjectPool`, so a preview can
 * never quote a number the ledger will not post.
 * ======================================================================== */

export const PROJECT_TYPES = ['club_level', 'extra_investor'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const DEFAULT_PROJECT_TYPE: ProjectType = 'club_level';

export function isProjectType(value: unknown): value is ProjectType {
  return typeof value === 'string' && (PROJECT_TYPES as readonly string[]).includes(value);
}

/**
 * Strict parse of a stored/submitted type. Missing means 'club_level' — every
 * project created before migration 0032 is one, and the DB default says so.
 * Anything else is a MoneyError so a hand-edited row fails loudly at the run
 * instead of silently falling back to the wrong split.
 */
export function parseProjectType(value: unknown): ProjectType {
  if (value === null || value === undefined || value === '') return DEFAULT_PROJECT_TYPE;
  if (!isProjectType(value)) {
    throw new MoneyError(`Unknown project type: ${String(value)}`, 'UNKNOWN_PROJECT_TYPE');
  }
  return value;
}

/* ---- Capital side of the same contract (Extra Investor) ------------------
 *
 * The budget is the anchor: a PM's contract is a percentage OF THE BUDGET, so
 * the amount is knowable the moment the percentage is typed, before anyone
 * subscribes. That is what makes a PM's funding obligation contractual rather
 * than "whatever the club happened to raise" (D2). Integer cents throughout —
 * one floor leaves at most 1¢ of the budget unassigned, and the club ceiling is
 * derived BY SUBTRACTION so `pm + club === budget` exactly, never re-rounded.
 * ------------------------------------------------------------------------ */

/** Contracted capital for the PM pool: floor(budget × bp ÷ 10_000). */
export function pmCapitalCents(budgetCents: number, pmBp: number): number {
  if (!Number.isInteger(budgetCents) || budgetCents < 0) {
    throw new MoneyError('Budget must be a non-negative integer-cent amount', 'INVALID_AMOUNT');
  }
  if (!Number.isInteger(pmBp) || pmBp <= 0 || pmBp > 10_000) {
    throw new MoneyError('The Project Level Member contract must be a basis-point percent in (0, 10000]', 'INVALID_PERCENT');
  }
  return Math.floor((budgetCents * pmBp) / 10_000);
}

/** What Board + Shareholder fund: budget − PM contract, exact by subtraction. */
export function clubCapitalCeilingCents(budgetCents: number, pmBp: number): number {
  return budgetCents - pmCapitalCents(budgetCents, pmBp);
}

/**
 * Split the contracted capital across k PMs equally (largest-remainder, id
 * order). Returns a per-member obligation map whose values sum to `totalCents`
 * exactly, so the ledger debits the contract to the cent.
 */
export function splitPmCapitalCents(totalCents: number, pmIds: string[]): Map<string, number> {
  return splitEvenlyCents(totalCents, pmIds);
}

/**
 * The same equal split in basis points, for the display column
 * (`project_members.ownership_percentage`): k PMs sharing a 50% contract each
 * read 16.67 / 16.67 / 16.66 — residue in id order, and the stored values sum to
 * exactly the contract. Display only: nothing is ever multiplied back from these
 * figures (§4), the money always comes from `splitPmCapitalCents`.
 */
export function splitPmContractBp(pmBp: number, pmIds: string[]): Map<string, number> {
  if (!Number.isInteger(pmBp) || pmBp <= 0 || pmBp > 10_000) {
    throw new MoneyError('The Project Level Member contract must be a basis-point percent in (0, 10000]', 'INVALID_PERCENT');
  }
  return splitEvenlyCents(pmBp, pmIds);
}

/* ---- The one resolver --------------------------------------------------- */

export interface ProjectSplitMember {
  id: string;
  shares: number;
  /** Membership category from `lib/member-roles` (null/unknown = shareholder). */
  role: string;
}

export interface ProjectSplitOutcome {
  mode: ProjectType;
  /** Amount per participant, id-sorted. Members with 0 cents are omitted. */
  payouts: Array<{ id: string; shares: number; payoutCents: number }>;
  /** Carve-outs for the audit trail / preview strip. Always [] for club_level. */
  typeBlocks: TypeSplitBlock[];
  /** What was split without a carve-out (club remainder, or the whole pool). */
  remainderCents: number;
  /** The PM contract's share of this pool in cents (0 for club_level). */
  pmCarveCents: number;
}

/**
 * Split one member pool (a profit leg, a loss leg, or a preview of either)
 * according to the project's type.
 *
 * club_level   → `splitByTypeAndShares(club rules + this project's PM override)`.
 *                Unchanged behaviour, including the Σ≤100 guard: a club project
 *                still cannot carve more than the pool.
 * extra_investor → PM contract first (equal split between PMs), then the
 *                remainder purely by share number across Board + Shareholder.
 *                PM rows never contribute shares to either side — their contract
 *                replaced shares entirely (§4).
 *
 * Throws `MoneyError` (never returns a partial split) when:
 *   - an Extra Investor project has no contract percentage (PM_PERCENT_REQUIRED);
 *   - the contract claims cents but the project has no PM row
 *     (PM_CONTRACT_WITHOUT_MEMBERS);
 *   - the remainder has cents but no club member holds shares (NO_CLUB_SHARES);
 *   - the payouts do not sum to the pool (SPLIT_UNBALANCED).
 */
export function splitProjectPool(input: {
  projectType: ProjectType;
  poolCents: number;
  members: ProjectSplitMember[];
  /** The tenant's Settings → Financial rules (NOT pre-merged with the override). */
  clubRulesBp: Map<MemberRole, number>;
  /** `projects.project_member_percent` — contract (extra) or PM override (club). */
  projectMemberPercent?: unknown;
}): ProjectSplitOutcome {
  const { projectType, poolCents, members, clubRulesBp } = input;

  if (!Number.isInteger(poolCents) || poolCents <= 0) {
    throw new MoneyError('Total must be a positive integer-cent amount', 'INVALID_AMOUNT');
  }

  if (projectType === 'club_level') {
    const rules = withProjectMemberOverride(clubRulesBp, input.projectMemberPercent);
    // Same guard the run applied before types existed: the effective set (club
    // categories + this project's override) may not exceed the pool.
    assertProjectRulesFit(rules, null);
    const outcome = splitByTypeAndShares(poolCents, members, rules);
    return {
      mode: 'club_level',
      payouts: outcome.payouts,
      typeBlocks: outcome.typeBlocks,
      remainderCents: outcome.remainderCents,
      pmCarveCents: 0,
    };
  }

  const pmBp = parseProjectMemberOverrideBp(input.projectMemberPercent);
  if (pmBp === null) {
    throw new MoneyError(
      'This Extra Investor project has no Project Level Member contract percentage. Set it on the project before distributing returns.',
      'PM_PERCENT_REQUIRED',
    );
  }

  const pmIds = members.filter((m) => isProjectMemberRole(m.role)).map((m) => m.id);
  const pmCarveCents = Math.floor((poolCents * pmBp) / 10_000);

  const payoutCents = new Map<string, number>();
  if (pmCarveCents > 0) {
    if (pmIds.length === 0) {
      throw new MoneyError(
        'This project has a Project Level Member contract but no Project Level Member on it, so the contract cannot be paid.',
        'PM_CONTRACT_WITHOUT_MEMBERS',
      );
    }
    for (const [id, cents] of splitEvenlyCents(pmCarveCents, pmIds)) {
      payoutCents.set(id, cents);
    }
  }

  // Remainder = pool − carve, exact by subtraction (never a second rounding).
  const clubPoolCents = poolCents - pmCarveCents;
  if (clubPoolCents > 0) {
    const clubMembers = members
      .filter((m) => !isProjectMemberRole(m.role))
      .filter((m) => Number.isInteger(m.shares) && m.shares > 0);
    if (clubMembers.length === 0) {
      throw new MoneyError(
        'No Board or Shareholder shares to receive the rest of this pool. Give the contract 100%, or add shares to the club members.',
        'NO_CLUB_SHARES',
      );
    }
    for (const p of splitDividendByShares(clubPoolCents, clubMembers.map((m) => ({ id: m.id, shares: m.shares })))) {
      payoutCents.set(p.id, (payoutCents.get(p.id) ?? 0) + p.payoutCents);
    }
  }

  const sharesById = new Map(members.map((m) => [m.id, Number.isInteger(m.shares) ? m.shares : 0]));
  const payouts = [...payoutCents.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, cents]) => ({ id, shares: sharesById.get(id) ?? 0, payoutCents: cents }));

  const sum = payouts.reduce((acc, p) => acc + p.payoutCents, 0);
  if (sum !== poolCents) {
    throw new MoneyError(
      `Project split does not reconcile: expected ${poolCents} cents, allocated ${sum}`,
      'SPLIT_UNBALANCED',
    );
  }

  const typeBlocks: TypeSplitBlock[] = [];
  if (pmCarveCents > 0) {
    typeBlocks.push({
      role: PROJECT_MEMBER_ROLE,
      bp: pmBp,
      amountCents: pmCarveCents,
      memberCount: pmIds.length,
    });
  }

  return {
    mode: 'extra_investor',
    payouts,
    typeBlocks,
    remainderCents: clubPoolCents,
    pmCarveCents,
  };
}

/**
 * Run-time contract guard, called once per run BEFORE any money is computed so
 * the failure reads as a configuration fault (400) rather than a split error:
 *
 *   - Club Level projects may not carry Project Level Members at all;
 *   - Extra Investor projects with PM rows must have a contract percentage
 *     (a blank one would otherwise silently fall back to nothing).
 *
 * Splitting itself re-checks what it needs; this exists to fail EARLY and with
 * the field the admin has to fix named in the message.
 */
export function assertProjectDistributionContract(input: {
  projectType: ProjectType;
  projectMemberPercent: unknown;
  members: Array<{ role: string }>;
}): void {
  const pmCount = input.members.filter((m) => isProjectMemberRole(m.role)).length;

  if (input.projectType === 'club_level') {
    if (pmCount > 0) {
      throw new MoneyError(
        'A Club Level project cannot include Project Level Members. Switch the project to Extra Investor, or remove them.',
        'PM_NOT_ALLOWED_IN_CLUB_PROJECT',
      );
    }
    return;
  }

  if (pmCount > 0 && parseProjectMemberOverrideBp(input.projectMemberPercent) === null) {
    throw new MoneyError(
      'This Extra Investor project has Project Level Members but no contract percentage. Set it on the project before distributing returns.',
      'PM_PERCENT_REQUIRED',
    );
  }
}

/**
 * Save-time roster gate — the write-side twin of `assertProjectDistributionContract`.
 *
 * It answers the question a Save must never get wrong, because the answer decides
 * which money engine the project will run on later:
 *
 *   Club Level     no Project Level Members, and no project percentage. Both are
 *                  rejected rather than ignored: a stored percent on a club project
 *                  would resurrect the v9 Σ>100 conflict this feature removes.
 *   Extra Investor a PM percentage is mandatory as soon as the roster contains a
 *                  Project Level Member (the contract is the only thing that funds
 *                  and pays them).
 *
 * Takes ROLES rather than member rows so the callers that already hold them (the
 * capital engine, after locking its members) and the callers that must fetch them
 * (an edit that changes no capital) both hit the same rules. MoneyError maps to
 * the API's field-coded 400 (§11).
 */
export function assertProjectTypeRoster(input: {
  projectType: ProjectType;
  projectMemberPercent: unknown;
  participantRoles: Iterable<string>;
}): void {
  const percentBp = parseProjectMemberOverrideBp(input.projectMemberPercent);
  const roles = [...input.participantRoles];
  const hasPm = roles.some(isProjectMemberRole);

  if (input.projectType === 'club_level') {
    if (hasPm) {
      throw new MoneyError(
        "[Field 'shareholders', Code: PM_NOT_ALLOWED_IN_CLUB_PROJECT] A Club Level project can only include Board and Shareholder Members. A Project Level Member makes it an Extra Investor project.",
        'PM_NOT_ALLOWED_IN_CLUB_PROJECT',
      );
    }
    if (percentBp !== null) {
      throw new MoneyError(
        "[Field 'projectMemberPercent', Code: PERCENT_NOT_ALLOWED_IN_CLUB_PROJECT] A Club Level project has no Project Level Members, so it cannot carry a Project Level Member percentage.",
        'PERCENT_NOT_ALLOWED_IN_CLUB_PROJECT',
      );
    }
    return;
  }

  if (hasPm && percentBp === null) {
    throw new MoneyError(
      "[Field 'projectMemberPercent', Code: PM_PERCENT_REQUIRED] An Extra Investor project needs the Project Level Member contract percentage before it can save with a Project Level Member on it.",
      'PM_PERCENT_REQUIRED',
    );
  }
}
