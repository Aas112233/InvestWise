/**
 * Sequential project reference codes (migration 0031) — the project module's
 * counterpart of member codes (MEM-XXXX). Until now projects carried only an
 * unreadable UUID and a free-text title that is NOT unique, so two clubs
 * named "Building A" were indistinguishable in lists, pickers, receipts and
 * the audit trail.
 *
 * The rules are deliberately the member-code rules, in one place:
 *  - PRJ-XXXX, sequential PER TENANT (the unique index lives on
 *    (tenant_id, project_code));
 *  - only codes matching the strict shape feed MAX+1, so a hand-edited or
 *    legacy row can never break the CAST;
 *  - the code is IMMUTABLE: the update schema does not accept it, and no
 *    route writes it after insert;
 *  - the UUID stays the real key — the ledger references projects by id,
 *    this label is for humans (docs, audit, receipts, conversation).
 */

import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { projects } from '@/db/schema/index';

type DbHandle = ReturnType<typeof getDb>;

/** 4-or-more digits: unlike a strict {4} shape this keeps working past
 *  PRJ-9999 — the MAX+1 window never loses its own history mid-stream. */
const PROJECT_CODE_SHAPE = '^PRJ-[0-9]{4,}$';

/** Pure next-number step, split out so the format rule is unit-testable. */
export function nextProjectCode(maxNum: number): string {
  if (!Number.isInteger(maxNum) || maxNum < 0) {
    throw new Error('project code MAX+1 requires a non-negative integer');
  }
  return `PRJ-${String(maxNum + 1).padStart(4, '0')}`;
}

/**
 * Next code for the tenant. Called OUTSIDE the create transaction and
 * RECOMPUTED on the clash retry (the rival row has committed by then, so the
 * fresh code is strictly higher) — exactly the member-code discipline.
 */
export async function generateProjectCode(db: DbHandle, tenantId: string): Promise<string> {
  const [row] = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${projects.projectCode} FROM 5) AS INTEGER)), 0)`,
    })
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), sql`${projects.projectCode} ~ ${PROJECT_CODE_SHAPE}`));
  return nextProjectCode(Number(row?.maxNum ?? 0));
}

/**
 * True only when a failed insert is OUR code's unique clash — a retry with a
 * recomputed code fixes that, while every OTHER 23505 (e.g. a duplicate
 * fund/ledger constraint) must surface unchanged instead of being retried.
 * Drizzle may wrap the driver error, so read code/constraint from the error,
 * its cause, and the message text (the member route's proven detector).
 */
export function isProjectCodeClash(e: unknown): boolean {
  const err = (e ?? {}) as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
    message?: unknown;
  };
  const code = err.code ?? err.cause?.code;
  if (code !== '23505') return false;
  const haystack = [
    err.constraint ?? '',
    err.cause?.constraint ?? '',
    typeof err.message === 'string' ? err.message : '',
  ].join(' ');
  return haystack.includes('projects_tenant_code_key');
}
