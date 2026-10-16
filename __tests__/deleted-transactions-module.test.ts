import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guard for the admin recovery desk (view + restore soft-deleted
 * transactions). Locks in the invariants that make it safe to expose:
 *
 *  • tenant-scoped reads/writes (§6) — the desk lists one tenant's retracted
 *    money and never another's;
 *  • Admin/SuperAdmin only — restoring a retracted money movement is an admin
 *    act, so a Manager/Auditor with TRANSACTIONS read must not reach it;
 *  • the restore re-applies the INVERSE of the delete reversal (else the fund
 *    silently disagrees with the restored ledger row);
 *  • the restore re-checks the fiscal period (a closed year is immutable).
 *
 * Source-level so it needs no database.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string) => readFileSync(`${root}${p}`, 'utf8');

describe('deleted-transactions recovery desk', () => {
  const listPath = 'app/api/transactions/deleted/route.ts';
  const restorePath = 'app/api/transactions/deleted/[id]/restore/route.ts';

  it('exposes the list + restore endpoints', () => {
    expect(existsSync(`${root}${listPath}`)).toBe(true);
    expect(existsSync(`${root}${restorePath}`)).toBe(true);
  });

  it('lists only this tenant’s soft-deleted rows', () => {
    const src = read(listPath);
    expect(src).toMatch(/requireTenant\(/);
    // Canonical soft-delete state, not the incomplete deleted_records archive.
    expect(src).toMatch(/transactions\.isDeleted.*true|isDeleted.*=\s*true/);
    expect(src).toMatch(/transactions\.tenantId.*scopedTenantId/);
  });

  it('gates the desk to Admin/SuperAdmin on the server', () => {
    for (const p of [listPath, restorePath]) {
      const src = read(p);
      expect(src).toMatch(/callerRole !== 'Admin'/);
      expect(src).toMatch(/callerRole !== 'SuperAdmin'/);
      expect(src).toMatch(/ForbiddenError/);
    }
  });

  it('restores by re-applying the inverse of the delete reversal', () => {
    const src = read(restorePath);
    expect(src).toMatch(/decideReversal\(/);
    // Negated direction — the delete applied +direction, restore applies -direction.
    expect(src).toMatch(/-\s*reversal\.direction/);
  });

  it('refuses to restore into a closed fiscal period', () => {
    expect(read(restorePath)).toMatch(/assertFiscalPeriodOpen\(/);
  });

  it('re-asserts the tenant on every restore write', () => {
    const src = read(restorePath);
    expect(src).toMatch(/eq\(transactions\.tenantId,\s*\w+\)/);
    expect(src).toMatch(/eq\(funds\.tenantId,\s*\w+\)/);
    expect(src).toMatch(/eq\(members\.tenantId,\s*\w+\)/);
    expect(src).toMatch(/eq\(projects\.tenantId,\s*\w+\)/);
  });

  it('is reachable from the sidebar only for Admin/SuperAdmin', () => {
    expect(read('components/layout/navigation.ts')).toMatch(/TRANSACTIONS_DELETED/);
    const sidebar = read('components/layout/sidebar.tsx');
    expect(sidebar).toMatch(/id === "TRANSACTIONS_DELETED"/);
  });
});
