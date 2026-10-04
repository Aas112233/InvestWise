/**
 * The member-role vocabulary: the single list the form, the create endpoint and
 * the update endpoint all read, so a value one of them accepts cannot be
 * rejected by another.
 *
 * This is a *membership category*, not a login role. Authorization never reads
 * it — `canViewMemberPII` and every screen permission take the viewer's user
 * role from `users.role`, normalized by lib/roles.ts. Keeping the two lists
 * separate is why `Admin` here is a category label with no privilege attached.
 *
 * `Administrator` and `Audit` used to appear here alongside `Admin` and next to
 * the localized `Auditor` label, so the picker rendered two identical "Admin"
 * rows and offered a stale "Audit". Nothing in the database stores either value,
 * so they are gone rather than mapped.
 */

export const MEMBER_ROLES = [
  'Admin',
  'Manager',
  'Auditor',
  'Investor',
  'Associate Member',
  'Founding Member',
  'Board Member',
  'Member',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

const LABEL_KEY: Record<MemberRole, string> = {
  Admin: 'members.adminRole',
  Manager: 'members.managerRole',
  Auditor: 'members.auditRole',
  Investor: 'members.investorRole',
  'Associate Member': 'roles.associateMember',
  'Founding Member': 'roles.foundingMember',
  'Board Member': 'roles.boardMember',
  Member: 'members.memberRole',
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Label key for a role already known to be in the vocabulary (the picker). */
export function memberRoleLabel(role: MemberRole): string {
  return LABEL_KEY[role];
}

/**
 * i18n key for a stored value, or null for one outside the vocabulary.
 *
 * Renderers need the null so a legacy or hand-edited row still shows its own
 * text instead of silently reading as "Member" on screen.
 */
export function memberRoleLabelKey(role: unknown): string | null {
  return isMemberRole(role) ? LABEL_KEY[role] : null;
}

/**
 * Localized label for a stored role, falling back to the stored text itself.
 *
 * The list renders member rows straight from the database, and a row holding a
 * value outside the picker (a seeded or hand-edited category) must show what it
 * actually says rather than render as "Member".
 */
export function memberRoleDisplay(role: unknown, t: (key: string) => string): string {
  const key = memberRoleLabelKey(role);
  return key ? t(key) : String(role ?? '');
}
