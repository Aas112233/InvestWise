import { sql } from 'drizzle-orm';
import { members } from '@/db/schema/index';
import { ValidationError } from '@/lib/utils/errors';

/**
 * One definition of how a member's name appears in the UI: a SUSPENDED member
 * is always marked so the name itself identifies them everywhere it shows —
 * lists, dropdowns, receipts, toasts, the analysis matrix.
 *
 * Two entry points, one rule:
 *  - `memberDisplayNameSql`  — server-side, for `members` table selects/joins
 *    (every row API that surfaces a member name uses this).
 *  - `memberDisplayName()`   — client-side (and JS object paths) where a
 *    member object with `status` is already in hand.
 *
 * The stored `name` is never modified — only the display form.
 */
export const SUSPENDED_SUFFIX = ' (Suspended)';

/** SQL expression: `members.name`, with the suffix when the member is suspended. */
export const memberDisplayNameSql = sql<string>`
  case
    when ${members.status} = 'suspended' then ${members.name} || ${SUSPENDED_SUFFIX}
    else ${members.name}
  end
`;

export function isSuspendedStatus(status?: string | null): boolean {
  return status === 'suspended';
}

/**
 * Server-side eligibility gate: a SUSPENDED member is excluded from financial
 * and membership writes (deposits, deposit requests, approvals, project
 * investment, expenses, share division, attendance, user linking). Call it
 * right after the member row is loaded (or re-locked inside a transaction).
 *
 * `operation` names the action in the error message so the operator knows
 * exactly what was blocked and why. Throws the root `ValidationError` (400) —
 * both the Next.js API tree and the legacy kernel's `errorResponse` map it
 * through `normalizeError`, so one helper serves both.
 */
export function assertMemberNotSuspended(
  member: { name?: string | null; status?: string | null } | null | undefined,
  operation: string,
): void {
  if (member && isSuspendedStatus(member.status)) {
    const label = (member.name ?? 'Member').trim();
    throw new ValidationError(
      `[Field 'member', Code: member_suspended] ${label} is suspended — ${operation} is not allowed for suspended members. Reinstate the member (or reject their pending items) first.`,
    );
  }
}

/** JS form of the same rule, for objects that already carry `status`. */
export function memberDisplayName(
  name: string | null | undefined,
  status?: string | null,
): string {
  const base = (name ?? '').trim();
  if (!base) return base;
  return isSuspendedStatus(status) ? `${base}${SUSPENDED_SUFFIX}` : base;
}
