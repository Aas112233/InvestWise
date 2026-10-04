/**
 * Member PII visibility — single source of truth used by BOTH the member list
 * (server/src/modules/members/service.ts) and the member detail endpoint
 * (app/api/members/[id]/route.ts). Previously the list masked phone/address
 * while the detail endpoint returned the full row (NID, nominee data, spouse)
 * to anyone with MEMBERS READ. Keep them in lockstep here.
 */

/** Fields considered sensitive PII on a member record. */
const SENSITIVE_FIELDS = [
  'phone',
  'address',
  'fatherName',
  'motherName',
  'spouseName',
  'nidOrPassport',
  'nomineeName',
  'nomineeRelation',
  'nomineeNidOrPassport',
  'nomineePhone',
] as const;

export type MemberWithPII = {
  userId?: string | null;
  phone?: string | null;
  address?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  spouseName?: string | null;
  nidOrPassport?: string | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  nomineeNidOrPassport?: string | null;
  nomineePhone?: string | null;
  /**
   * Set by `maskMemberPII` on a masked copy. Real values are never sent to a
   * viewer who may not see them, so without this flag the UI cannot tell
   * "hidden from you" apart from "the member never gave us this" — and would
   * render both as an empty cell.
   */
  piiMasked?: boolean;
};

/**
 * Admin/Manager see full PII; a member always sees their own record.
 * Every other role (incl. Auditor) gets the masked shape.
 */
export function canViewMemberPII(
  role: string | undefined,
  memberUserId: string | null | undefined,
  userId: string | undefined,
): boolean {
  if (role === 'Admin' || role === 'Manager') return true;
  return Boolean(userId && memberUserId && memberUserId === userId);
}

/**
 * Returns a copy with sensitive fields stripped when the viewer lacks access,
 * stamped with `piiMasked` so renderers can label the cell as hidden instead
 * of blank. Deliberately strips rather than substitutes asterisks: the real
 * value never leaves the server, so a masked response cannot be read, copied
 * or scraped out of a browser's network tab.
 */
export function maskMemberPII<T extends MemberWithPII>(member: T, canView: boolean): T {
  if (canView) return member;
  const masked = { ...member };
  for (const field of SENSITIVE_FIELDS) {
    (masked as Record<string, unknown>)[field] = undefined;
  }
  masked.piiMasked = true;
  return masked;
}
