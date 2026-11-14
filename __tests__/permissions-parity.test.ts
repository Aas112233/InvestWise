import { describe, expect, it } from 'vitest';

/**
 * Permission-evaluator drift guard.
 *
 * `hasScreenPermission` exists twice: the canonical copy in `lib/permissions.ts`
 * (used by `app/api/**` via lib/middleware/auth.ts) and the mirror in
 * `server/src/middleware/api.ts` consumed by the delegated handlers. They live
 * apart for the same reason the schema does — the server slice resolves its own
 * module tree, so it cannot import `@/lib` files.
 *
 * The two are NOT structurally identical: the modern copy extracts the
 * inherited-grant rule into a tri-state `parentGrant` (`true` / `false` /
 * `undefined` = fall through to the role baseline), while the server copy
 * inlines it as `if/else if` and lets an `undefined` parent fall off the end
 * into the baseline. They agree today by construction of that fall-through, not
 * because the code is the same — so plain text comparison cannot protect them.
 *
 * This test pins the *behaviour*: for every (role, screen, level) and a matrix
 * of explicit grants, both copies must return the same answer. A future gate
 * change made in only one copy fails here instead of in production.
 */

import { hasScreenPermission as modernHasScreenPermission } from '@/lib/permissions';
import { hasScreenPermission as serverHasScreenPermission } from '../server/src/middleware/api';

const SCREENS = [
  'DASHBOARD', 'MEMBERS', 'MEETINGS', 'GOVERNANCE', 'GOALS', 'DEPOSITS',
  'REQUEST_DEPOSIT', 'TRANSACTIONS', 'DIVIDENDS', 'PAYOUTS', 'EXPENSES',
  'PROJECT_MANAGEMENT', 'FUNDS_MANAGEMENT', 'ANALYSIS', 'REPORTS', 'SETTINGS',
];

const ROLES = ['SuperAdmin', 'Admin', 'Manager', 'Auditor', 'Member', 'member', 'unknown-role'];
const LEVELS = ['READ', 'WRITE', 'MANAGE'] as const;
const GRANTS = [undefined, 'NONE', 'READ', 'WRITE', 'MANAGE'];

type Grants = Record<string, string> | undefined;

/** Explicit-grant matrices that exercise the inheritance rules. */
function permissionMatrices(): Grants[] {
  const matrices: Grants[] = [undefined, {}];
  // Every screen granted at a single uniform level.
  for (const level of GRANTS) {
    if (level === undefined) continue;
    const uniform: Record<string, string> = {};
    for (const screen of SCREENS) uniform[screen] = level;
    matrices.push(uniform);
  }
  // Parent-grant inheritance: MEETINGS/GOVERNANCE inherit from MEMBERS,
  // TRANSACTIONS from DEPOSITS. Drive each parent level while leaving the
  // children unset, then set them explicitly to probe precedence.
  for (const level of GRANTS) {
    if (level === undefined) continue;
    for (const parent of ['MEMBERS', 'DEPOSITS']) {
      matrices.push({ [parent]: level });
    }
    for (const parent of ['MEMBERS', 'DEPOSITS']) {
      matrices.push({ [parent]: level, MEETINGS: 'READ', GOVERNANCE: 'WRITE', TRANSACTIONS: 'MANAGE' });
    }
  }
  return matrices;
}

describe('permission evaluator parity (lib/permissions.ts vs server/src/middleware/api.ts)', () => {
  it('agrees for null / undefined users', () => {
    for (const screen of SCREENS) {
      for (const level of LEVELS) {
        expect(serverHasScreenPermission(null, screen, level)).toBe(
          modernHasScreenPermission(null, screen, level),
        );
        expect(serverHasScreenPermission(undefined, screen, level)).toBe(
          modernHasScreenPermission(undefined, screen, level),
        );
      }
    }
  });

  it('agrees across the full role x screen x level x grant matrix', () => {
    const disagreements: string[] = [];
    for (const permissions of permissionMatrices()) {
      for (const role of ROLES) {
        const user = { role, permissions };
        for (const screen of SCREENS) {
          for (const level of LEVELS) {
            const modern = modernHasScreenPermission(user, screen, level);
            const server = serverHasScreenPermission(user, screen, level);
            if (modern !== server) {
              disagreements.push(
                `role=${role} screen=${screen} level=${level} grant=${permissions?.[screen] ?? '-'} ` +
                  `parent(MEMBERS=${permissions?.MEMBERS ?? '-'},DEPOSITS=${permissions?.DEPOSITS ?? '-'}) ` +
                  `modern=${modern} server=${server}`,
              );
            }
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('pins the parent-inheritance rule both copies implement', () => {
    // A WRITE on MEMBERS grants WRITE on MEETINGS/GOVERNANCE but not MANAGE.
    const writeMembers = { role: 'Manager', permissions: { MEMBERS: 'WRITE' } };
    for (const screen of ['MEETINGS', 'GOVERNANCE']) {
      expect(modernHasScreenPermission(writeMembers, screen, 'WRITE')).toBe(true);
      expect(modernHasScreenPermission(writeMembers, screen, 'MANAGE')).toBe(false);
      expect(serverHasScreenPermission(writeMembers, screen, 'WRITE')).toBe(true);
      expect(serverHasScreenPermission(writeMembers, screen, 'MANAGE')).toBe(false);
    }
    // READ on MEMBERS grants READ only.
    const readMembers = { role: 'Member', permissions: { MEMBERS: 'READ' } };
    expect(modernHasScreenPermission(readMembers, 'MEETINGS', 'READ')).toBe(true);
    expect(modernHasScreenPermission(readMembers, 'MEETINGS', 'WRITE')).toBe(false);
    expect(serverHasScreenPermission(readMembers, 'MEETINGS', 'READ')).toBe(true);
    expect(serverHasScreenPermission(readMembers, 'MEETINGS', 'WRITE')).toBe(false);
    // NONE on the parent does NOT deny outright in either copy — it falls
    // through to the role baseline. Both must agree on that subtlety.
    const noneMembers = { role: 'Manager', permissions: { MEMBERS: 'NONE' } };
    for (const screen of ['MEETINGS', 'GOVERNANCE']) {
      for (const level of LEVELS) {
        expect(serverHasScreenPermission(noneMembers, screen, level)).toBe(
          modernHasScreenPermission(noneMembers, screen, level),
        );
      }
    }
  });

  it('agrees for anonymous and legacy-cased roles', () => {
    for (const role of ['member', 'MEMBER', 'Member', 'manager', 'auditor', 'not-a-role']) {
      for (const screen of ['MEMBERS', 'SETTINGS', 'TRANSACTIONS']) {
        for (const level of LEVELS) {
          expect(serverHasScreenPermission({ role, permissions: {} }, screen, level)).toBe(
            modernHasScreenPermission({ role, permissions: {} }, screen, level),
          );
        }
      }
    }
  });
});
