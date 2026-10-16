/**
 * Single writer for the share-value lock flag.
 *
 * `isShareValueLocked` is a §12 financial invariant: once it is true,
 * `shareValueBdt` is immutable for the tenant, so every later money calc that
 * divides by share value is frozen to that rate. Two read handlers used to flip
 * it in place (the settings GET and the share-value-status GET) without an
 * audit row, so an operator could not reconstruct when the lock engaged or
 * which user's request tripped it. Both now call this, and this always leaves
 * a trail.
 */
import { and, count, eq } from 'drizzle-orm';
import { getDb } from '@/db/index';
import { systemSettings, transactions } from '@/db/schema/index';
import { logAudit } from '@/lib/utils/audit';

type SystemSettingRow = typeof systemSettings.$inferSelect;

export interface ShareValueLockState {
  /** The tenant's settings row, or `null` when it has none yet. */
  settings: SystemSettingRow | null;
  transactionCount: number;
}

/**
 * Locks the tenant's share value when ledger history exists but the flag has
 * not been set yet, and returns the settings row as it now stands together with
 * the transaction count the decision was based on.
 */
export async function ensureShareValueLocked(
  tenantId: string,
  actor: { id?: string; name?: string } | null,
): Promise<ShareValueLockState> {
  const db = getDb();
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.tenantId, tenantId))
    .limit(1);

  if (!settings) return { settings: null, transactionCount: 0 };

  const [txResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), eq(transactions.isDeleted, false)));

  const transactionCount = Number(txResult?.count ?? 0);
  if (settings.isShareValueLocked || transactionCount === 0) {
    return { settings, transactionCount };
  }

  const now = new Date();
  await db
    .update(systemSettings)
    .set({ isShareValueLocked: true, updatedAt: now })
    .where(eq(systemSettings.id, settings.id));

  await logAudit({
    user: actor,
    tenantId,
    action: 'SHARE_VALUE_AUTO_LOCKED',
    resourceType: 'Settings',
    resourceId: settings.id,
    details: { transactionCount },
    before: { isShareValueLocked: false },
    after: { isShareValueLocked: true },
  });

  return { settings: { ...settings, isShareValueLocked: true, updatedAt: now }, transactionCount };
}
