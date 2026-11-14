/**
 * Member TYPE lock (2026-11-12): once a member has any transaction, changing
 * their category between economically distinct types is refused — the same
 * discipline that locks share numbers, because since the category rules
 * (docs/MEMBER-TYPE-DISTRIBUTION_PLAN.md) a member's type decides which
 * percentage of every member pool their category carves. An editable type
 * would be an editable split: flip someone into the 20%-carve-out category
 * the day before a run and the immutability of the ledger never gets tested.
 *
 * SCOPE (user decision): the money categories — Board Member, Shareholder
 * Member, Project Level Member — lock. The access titles (Admin, Manager,
 * Auditor) stay freely swappable, because electing an officer is governance,
 * not a redistribution. Any change with a money category on EITHER side is
 * therefore locked once transactions exist: money→money (re-slicing),
 * money→access (dropping a depositor out of their carve-out changes the
 * pro-rata remainder) and access→money (smuggling a member into a carve-out)
 * all move the same money.
 *
 * ESCAPE HATCH (user decision): an Admin may still change a locked type by
 * sending an explicit reason, which lands in the audit trail. This policy is
 * the single owner of that decision shape; the route enforces WHO may use it
 * (authz Admin, §6/RBAC) and the ledger evidence (count-then-write under the
 * member row lock) mirrors the shares guard in PUT /api/members/[id].
 */

import { type MemberRole } from './member-roles';

/** Categories that describe access, not money — freely reassignable. */
export const ACCESS_ONLY_ROLES: readonly MemberRole[] = ['Admin', 'Manager', 'Auditor'];

export function isAccessOnlyRole(role: unknown): boolean {
  return ACCESS_ONLY_ROLES.includes(role as MemberRole);
}

/**
 * A stored empty/NULL role is the default economic category (the members.role
 * column default since the six-category vocabulary, migration 0029) — so a
 * null→'Shareholder Member' "change" is not one and must not trip the lock.
 * Values outside the vocabulary (legacy rows) normalize to themselves and are
 * treated as money roles: fail CLOSED, the admin override stays the door.
 */
export function normalizeMemberRole(role: unknown): string {
  return typeof role === 'string' && role.trim() !== '' ? role.trim() : 'Shareholder Member';
}

export type RoleLockDecision =
  /** No category change requested (absent/blank payload, or the same type). */
  | { kind: 'unchanged' }
  /** A change, but between access titles — always allowed. */
  | { kind: 'free' }
  /** A change that moves member economics; locked once transactions exist. */
  | { kind: 'lock-required' };

/**
 * Pure decision: given the stored role and the submitted role (raw payload
 * value — undefined/'' mean "leave alone", matching memberRoleField), what
 * kind of change is this? The caller owns the transaction-exists evidence and
 * the override; this function owns the vocabulary split, in one place, for
 * the API and the member form alike.
 */
export function decideRoleLock(currentRole: unknown, nextRole: unknown): RoleLockDecision {
  if (nextRole === undefined || nextRole === null || nextRole === '') return { kind: 'unchanged' };
  const from = normalizeMemberRole(currentRole);
  const to = normalizeMemberRole(nextRole);
  if (from === to) return { kind: 'unchanged' };
  if (isAccessOnlyRole(from) && isAccessOnlyRole(to)) return { kind: 'free' };
  return { kind: 'lock-required' };
}
