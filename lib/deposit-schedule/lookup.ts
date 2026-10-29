/**
 * Database-backed schedule lookup.
 *
 * `schedule.ts` is pure and takes plain values; this is the thin data layer that fetches the two
 * values that decide it (`system_settings.deposit_schedule` + `members.deposit_frequency`) for
 * the deposit write paths, so no route or service re-implements the query and each one silently
 * disagrees about what "flexible" means.
 *
 * The `db` argument is REQUIRED and callers pass their own transaction handle, because:
 *   1. the resolved schedule must be read inside the same transaction that writes the deposit —
 *      otherwise a concurrent settings switch could be honoured for part of a batch; and
 *   2. this codebase runs two drizzle instances (root 0.45 and server/ 0.38) whose transaction
 *      objects are runtime-compatible but not type-compatible. The same bridge used by
 *      lib/deposit-month-limit.ts and lib/fiscal-guard.ts keeps ONE source of truth instead of
 *      a server-local copy that could drift.
 *
 * Neither lookup may throw. A tenant whose settings row has not been provisioned must still be
 * able to take a legitimate deposit: absent values fail closed to MONTHLY inside schedule.ts.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { getDb } from '@/db/index';
import { members, systemSettings } from '@/db/schema/index';
import { normalizeDepositSchedule, resolveDepositScheduleDetailed, type DepositScheduleResolution } from './schedule';

type DbLike = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

function asQueryable(db: unknown): DbLike {
  return db as DbLike;
}

/**
 * This tenant's configured schedule, when it last switched, plus a `problem` if the stored value
 * is corrupt.
 *
 * `depositScheduleChangedAt` rides along on the same row read because the scoring and governance
 * paths need it to decide where the monthly obligation BEGAN — a tenant that switched from
 * flexible last month cannot be judged on the twelve months before that switch. It costs no extra
 * query, and keeping it here means no consumer has to remember to fetch it separately.
 */
export async function loadTenantDepositSchedule(
  db: unknown,
  tenantId: string,
): Promise<{ tenantSchedule: string | null; depositScheduleChangedAt: Date | null; problem?: string }> {
  const rows = await asQueryable(db)
    .select({
      depositSchedule: systemSettings.depositSchedule,
      depositScheduleChangedAt: systemSettings.depositScheduleChangedAt,
    })
    .from(systemSettings)
    // §6: tenant scope on every business-table read.
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  const tenantSchedule = rows[0]?.depositSchedule ?? null;
  const depositScheduleChangedAt = rows[0]?.depositScheduleChangedAt ?? null;
  const normalised = normalizeDepositSchedule(tenantSchedule);
  return normalised.problem
    ? { tenantSchedule, depositScheduleChangedAt, problem: normalised.problem }
    : { tenantSchedule, depositScheduleChangedAt };
}

/**
 * Resolve the schedule governing one member in one tenant.
 *
 * A missing settings row or member row resolves to MONTHLY (the strict state): both fields read
 * as absent and schedule.ts fails closed. A caller that needs the member to exist already
 * asserts it separately — this must not become a second 404 path.
 */
export async function loadMemberDepositSchedule(
  db: unknown,
  args: { tenantId: string; memberId: string },
): Promise<DepositScheduleResolution> {
  const [memberRows, settingsRows] = await Promise.all([
    asQueryable(db)
      .select({ depositFrequency: members.depositFrequency })
      .from(members)
      .where(and(eq(members.id, args.memberId), eq(members.tenantId, args.tenantId)))
      .limit(1),
    asQueryable(db)
      .select({ depositSchedule: systemSettings.depositSchedule })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, args.tenantId))
      .limit(1),
  ]);

  return resolveDepositScheduleDetailed({
    tenantSchedule: settingsRows[0]?.depositSchedule ?? null,
    memberDepositFrequency: memberRows[0]?.depositFrequency ?? null,
  });
}

/**
 * Batch variant for bulk deposits: one settings read plus one member read, not N of each.
 *
 * Members absent from the result fall back to the tenant schedule when looked up, so a bulk row
 * referencing a soft-deleted or foreign member cannot smuggle itself onto the laxer path.
 */
export async function loadMemberDepositSchedules(
  db: unknown,
  args: { tenantId: string; memberIds: string[] },
): Promise<Map<string, DepositScheduleResolution>> {
  const uniqueIds = [...new Set(args.memberIds)];
  const [memberRows, settingsRows] = await Promise.all([
    uniqueIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; depositFrequency: string | null }>)
      : asQueryable(db)
          .select({ id: members.id, depositFrequency: members.depositFrequency })
          .from(members)
          .where(and(eq(members.tenantId, args.tenantId), inArray(members.id, uniqueIds))),
    asQueryable(db)
      .select({ depositSchedule: systemSettings.depositSchedule })
      .from(systemSettings)
      .where(eq(systemSettings.tenantId, args.tenantId))
      .limit(1),
  ]);

  const tenantSchedule = settingsRows[0]?.depositSchedule ?? null;
  const byId = new Map<string, DepositScheduleResolution>();
  for (const row of memberRows as Array<{ id: string; depositFrequency: string | null }>) {
    byId.set(row.id, resolveDepositScheduleDetailed({
      tenantSchedule,
      memberDepositFrequency: row.depositFrequency,
    }));
  }
  return byId;
}
