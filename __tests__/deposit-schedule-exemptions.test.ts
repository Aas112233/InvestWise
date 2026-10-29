/**
 * Phase 3 regression lock — flexible members must stay exempt from the deposit
 * compliance modules.
 *
 * These assert on source text, matching the convention already used by
 * `__tests__/deposit-month-limit.test.ts`: each exemption below is a one-line change
 * that a future refactor can silently drop, and dropping one re-creates a specific
 * documented harm (H1–H3 in docs/DEPOSIT_SCHEDULE_DESIGN.md §7). The behavioural
 * equivalents need a database; this is the guard that runs in CI without one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type FileSpec = { label: string; path: string; content: string };

function read(relativePath: string): FileSpec {
  const absolute = fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  if (!existsSync(absolute)) {
    throw new Error(`${relativePath} is missing — Phase 3 exemption wiring gone.`);
  }
  return { label: relativePath, path: relativePath, content: readFileSync(absolute, 'utf8') };
}

describe('H1 — performance scoring must not grade an obligation the member does not have', () => {
  const source = read('lib/governance/performance.ts').content;

  it('reads deposit_frequency, which it never did before', () => {
    expect(source).toContain('depositFrequency: members.depositFrequency');
  });

  it('asks the single canonical schedule gate', () => {
    expect(source).toContain('resolveDepositScheduleDetailed');
    expect(source).toContain('loadTenantDepositSchedule');
  });

  it('does not evaluate months, read deposits, or apply the 60% weight when exempt', () => {
    expect(source).toContain('for (let i = 0; depositEnforced && i < months; i += 1)');
    expect(source).toContain('const windowDeposits = depositEnforced ? await db');
    // Weights renormalise instead of zero-filling, so a compliant flexible member
    // can still reach 100 rather than being capped at 40.
    // Gated on `depositMeasured`, not `depositEnforced`: a member whose window lies entirely before
    // the tenant adopted monthly has zero evaluated months, and the 100 fallback on `depositScore`
    // would otherwise hand them 60 points for punctuality that was never measured (H2's lesson).
    expect(source).toContain('depositMeasured ? 0.6 * depositScore + 0.4 * attendanceScore : attendanceScore');
    expect(source).toContain('const depositMeasured = depositEnforced && evaluatedMonths > 0;');
  });

  it('reports the rating basis instead of a fabricated deposit score', () => {
    expect(source).toContain('"MONTHLY_PUNCTUALITY" | "NOT_APPLICABLE"');
    expect(source).toContain('score: depositMeasured ? Math.round(depositScore) : null');
  });

  it('never charges a month before the tenant adopted the monthly rule', () => {
    expect(source).toContain('firstEnforcedPeriodKey');
    expect(source).toContain('if (periodKey < scoringFloorPeriodKey) break;');
    expect(source).toContain('depositScheduleChangedAt');
  });
});

describe('H2 — the leaderboard must rank an unscored member last, not first', () => {
  const source = read('app/api/governance/leaderboard/route.ts').content;

  it('orders NULLS LAST explicitly', () => {
    // PostgreSQL sorts NULL first under DESC, so an unscored member used to rank #1.
    expect(source).toContain('DESC NULLS LAST');
  });

  it('never substitutes 100 for a missing score', () => {
    // Asserted against the exact former expression rather than the bare `?? 100`
    // text, which also appears in the comment above it explaining the harm.
    expect(source).not.toContain('Number(r.performanceScore ?? 100)');
    expect(source).toContain('grade: score === null ? null : resolveGrade(score)');
    expect(source).toContain('unrated: score === null');
  });

  it('the client type admits null and the view renders an em dash, not 0%', () => {
    const types = read('types/index.ts').content;
    expect(types).toContain('performanceScore: number | null;');
    const view = read('components/governance/governance-view.tsx').content;
    expect(view).toContain('{l.performanceScore === null ? "—" : `${l.performanceScore}%`}');
  });
});

describe('H3 — switching a live tenant must not orphan its auto-held members', () => {
  const source = read('app/api/settings/route.ts').content;

  it('finds members held by the sweep itself before the switch commits', () => {
    expect(source).toContain('switchingToFlexible');
    expect(source).toContain('MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE');
  });

  it('refuses to switch silently — explicit operator confirmation first', () => {
    expect(source).toContain('data.confirmDepositScheduleSwitch !== true');
    expect(source).toContain('DEPOSIT_SCHEDULE_SWITCH_CONFIRMATION_REQUIRED');
    expect(source).toContain('{ status: 409 }');
  });

  it('releases them only AFTER the settings row commits', () => {
    const commitIndex = source.indexOf('settingsCache.delete(');
    const releaseIndex = source.indexOf("'DEPOSIT_SCHEDULE_SWITCH_TO_FLEXIBLE'");
    expect(commitIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(commitIndex);
  });

  it('touches only sweep-created holds, never an officer-set statusReason', () => {
    const releaseBlock = source.slice(
      source.indexOf('if (switchingToFlexible && heldForNonCompliance.length > 0)'),
      source.indexOf("'DEPOSIT_SCHEDULE_SWITCH_TO_FLEXIBLE'"),
    );
    expect(releaseBlock).toContain('eq(members.statusReason, MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE)');
    expect(releaseBlock).toContain('eq(members.isDeleted, false)');
    expect(releaseBlock).toContain('eq(members.tenantId, tenantId)');
  });

  it('stamps the change instead of leaving the audit column empty', () => {
    expect(source).toContain('updateData.depositScheduleChangedAt = new Date()');
  });
});

/**
 * The defect this block exists to prevent was real: the write paths honoured the
 * tenant-level `system_settings.deposit_schedule`, but governance and the payment
 * matrix only read `members.deposit_frequency`, which defaults to 'monthly' on every
 * row. Switching a tenant to flexible would have accepted their deposits AND kept
 * auto-holding them for deposits the schedule no longer requires — the two halves of
 * one decision disagreeing, which is precisely the failure the single-gate design was
 * built to make impossible.
 */
describe("the tenant-wide schedule reaches governance and reporting, not just the write paths", () => {
  it('governance carries the tenant schedule on the snapshot it already loads', () => {
    const source = read('lib/governance/status-service.ts').content;
    expect(source).toContain('depositSchedule: string;');
    expect(source).toContain('normalizeDepositSchedule(settings.depositSchedule ?? null).schedule');
    // A missing settings row stays monthly: governance must not switch itself off.
    expect(source).toContain('depositSchedule: DEPOSIT_SCHEDULE.MONTHLY,');
  });

  it('the sweep and the payment matrix both ask the tenant-aware gate', () => {
    const governance = read('lib/governance/status-service.ts').content;
    expect(governance).toContain('if (!isMemberObligationEnforced(snapshot, row.depositFrequency)) {');
    const matrix = read('app/api/analytics/analysis/route.ts').content;
    expect(matrix).toContain('isMemberObligationEnforced(');
    expect(matrix).toContain('depositSchedule: systemSettings.depositSchedule,');
  });

  it('the member-frequency-only helper has no production caller left', () => {
    // It answers a different question than "is this member obligated", and every
    // place that needed the second question needed the first by mistake.
    expect(read('app/api/analytics/analysis/route.ts').content).not.toContain('isMonthlySchedule(');
    const governance = read('lib/governance/status-service.ts').content;
    const deprecatedAt = governance.indexOf('@deprecated Use `isMemberObligationEnforced');
    expect(deprecatedAt).toBeGreaterThan(-1);
  });
});

describe('the settings contract exposes the schedule', () => {
  it('absent means monthly on the read side, matching the fail-closed write side', () => {
    const source = read('app/api/settings/route.ts').content;
    expect(source).toContain("depositSchedule: settings.depositSchedule || 'monthly'");
  });

  it('validates the enum rather than storing arbitrary text', () => {
    const source = read('lib/utils/validation.ts').content;
    expect(source).toContain("depositSchedule: z.enum(['monthly', 'flexible']).optional()");
    expect(source).toContain('confirmDepositScheduleSwitch: z.boolean().optional()');
  });
});

/**
 * The model has to be choosable when the organisation is BORN, not only afterwards. Switching it
 * later is deliberately awkward (held members, a 409 acknowledgement), so a society that knows on
 * day one it does not do monthly deposits should not have to pay that switching cost to say so.
 */
describe('signup captures the deposit model', () => {
  it('forwards the chosen schedule into provisioning', () => {
    const route = read('app/api/auth/signup/route.ts').content;
    expect(route).toContain('depositSchedule: oneOf([...DEPOSIT_SCHEDULE_VALUES], \'depositSchedule\')');
    expect(route).toContain('.default(DEFAULT_DEPOSIT_SCHEDULE)');
    // Optional on the wire: an older client still provisions successfully as monthly.
    expect(route).toContain('fiscalYearEnd, depositSchedule }');
  });

  it('writes the column, so the choice survives past the response', () => {
    const provision = read('lib/tenant-provision.ts').content;
    expect(provision).toContain('depositSchedule: financial.depositSchedule');
  });

  it('resolves the schedule before the transaction opens, so a bad one writes nothing', () => {
    // The signup form is public and unauthenticated, so an out-of-vocabulary schedule must not be
    // able to leave a half-provisioned tenant behind. (Provisioning reaches getDb() first, so this
    // ordering is what can be asserted without a live database — the rejection itself is covered
    // against resolveFinancialDefaults in lib/org-setup.test.ts.)
    const provision = read('lib/tenant-provision.ts').content;
    const resolved = provision.indexOf('resolveFinancialDefaults(input.financial)');
    const transaction = provision.indexOf('db.transaction(');
    expect(resolved).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(resolved);
  });

  it('asks the visitor explicitly instead of pre-selecting (§15)', () => {
    const page = read('app/signup/page.tsx').content;
    // The proof is the ABSENCE of a default — the only way this field can be set is by choosing it.
    const defaults = page.slice(page.indexOf('defaultValues: {'), page.indexOf('},', page.indexOf('defaultValues: {')));
    expect(defaults).not.toContain('depositSchedule');
    expect(page).toContain('fiscalYearStart: DEFAULT_FISCAL_YEAR_START');
    // ...and submit is inert while it is unanswered.
    expect(page).toContain('disabled={isSubmitting || !depositSchedule');
    // Renders from the same option list the validator uses, so the two cannot drift.
    expect(page).toContain('DEPOSIT_SCHEDULES.map');
    expect(page).toContain('DEPOSIT_SCHEDULE_VALUES');
  });

  it('reuses the Settings wording rather than inventing a second name for the setting', () => {
    const orgSetup = read('lib/org-setup.ts').content;
    expect(orgSetup).toContain('settings.governance.depositScheduleValue.monthly');
    expect(orgSetup).toContain('settings.governance.depositScheduleHint.flexible');
  });
});
