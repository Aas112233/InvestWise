import { getDb } from '../../config/database.js';
import { systemSettings, transactions } from '../../db/schema/index.js';
import { eq, count } from 'drizzle-orm';
import { LockedError } from '../../shared/errors.js';
import type { UpdateSettingsInput } from './validation.js';
import { cache } from '../../lib/cache.js';

const SETTINGS_CACHE_KEY = 'settings:singleton';
const SETTINGS_CACHE_TTL = 5 * 60_000; // 5 minutes

interface ShareValueStatus {
  isLocked: boolean;
  transactionCount: number;
}

/**
 * Retrieve the singleton system settings row.
 * Creates a default row if none exists yet.
 */
export async function getSettings(): Promise<Record<string, unknown>> {
  // Auto-lock share value if transactions exist (enforced on every read before caching)
  await checkAndAutoLockShareValue();

  return cache.getOrSet(
    SETTINGS_CACHE_KEY,
    async () => {
      const db = getDb();
      const [settings] = await db.select().from(systemSettings).limit(1);

      if (!settings) {
        const [created] = await db.insert(systemSettings).values({}).returning();
        return created;
      }

      return settings;
    },
    SETTINGS_CACHE_TTL,
  );
}

/**
 * Partially update system settings.
 * Throws LockedError if the caller attempts to change shareValueBdt
 * while the share value is locked.
 */
export async function updateSettings(data: UpdateSettingsInput): Promise<Record<string, unknown>> {
  const db = getDb();

  let [current] = await db.select().from(systemSettings).limit(1);
  if (!current) {
    [current] = await db.insert(systemSettings).values({}).returning();
  }

  const updateData: Record<string, unknown> = {};

  // Flatten financial group
  if (data.financial) {
    if (data.financial.fiscalYearStart !== undefined) {
      updateData.fiscalYearStart = data.financial.fiscalYearStart;
    }
    if (data.financial.baseCurrency !== undefined) {
      updateData.baseCurrency = data.financial.baseCurrency;
    }
    if (data.financial.taxRate !== undefined) {
      updateData.taxRate = String(data.financial.taxRate);
    }
    if (data.financial.accountingMethod !== undefined) {
      updateData.accountingMethod = data.financial.accountingMethod;
    }
    if (data.financial.shareValueBdt !== undefined) {
      if (current.isShareValueLocked) {
        throw new LockedError('Share value is locked and cannot be changed');
      }
      updateData.shareValueBdt = String(data.financial.shareValueBdt);
    }
    if (data.financial.isShareValueLocked !== undefined) {
      updateData.isShareValueLocked = data.financial.isShareValueLocked;
    }
    if (data.financial.withdrawalLimitPercent !== undefined) {
      updateData.withdrawalLimitPercent = String(data.financial.withdrawalLimitPercent);
    }
    if (data.financial.withdrawalNoticeDays !== undefined) {
      updateData.withdrawalNoticeDays = data.financial.withdrawalNoticeDays;
    }
    if (data.financial.maxWithdrawalPerRequest !== undefined) {
      updateData.maxWithdrawalPerRequest = String(data.financial.maxWithdrawalPerRequest);
    }
    if (data.financial.statutoryReservePercent !== undefined) {
      updateData.statutoryReservePercent = String(data.financial.statutoryReservePercent);
    }
    if (data.financial.fiscalYearEnd !== undefined) {
      updateData.fiscalYearEnd = data.financial.fiscalYearEnd;
    }
  }

  // Flatten system group
  if (data.system) {
    if (data.system.language !== undefined) {
      updateData.language = data.system.language;
    }
    if (data.system.refreshInterval !== undefined) {
      updateData.refreshInterval = data.system.refreshInterval;
    }
    if (data.system.theme !== undefined) {
      updateData.theme = data.system.theme;
    }
    if (data.system.dateFormat !== undefined) {
      updateData.dateFormat = data.system.dateFormat;
    }
    if (data.system.isMaintenanceMode !== undefined) {
      updateData.isMaintenanceMode = data.system.isMaintenanceMode;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return current;
  }

  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(systemSettings)
    .set(updateData)
    .where(eq(systemSettings.id, current.id))
    .returning();

  // Invalidate settings cache so next request fetches fresh data
  cache.del(SETTINGS_CACHE_KEY);
  return updated;
}

/**
 * Check whether the share value is locked.
 * Auto-locks it if transactions exist but the setting is not yet locked.
 */
export async function getShareValueStatus(): Promise<ShareValueStatus> {
  const db = getDb();

  const [settings] = await db.select().from(systemSettings).limit(1);
  if (!settings) {
    return { isLocked: false, transactionCount: 0 };
  }

  const [txResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.isDeleted, false));

  const transactionCount = Number(txResult?.count ?? 0);
  let isLocked = Boolean(settings.isShareValueLocked);

  // Auto-lock if transactions exist but not yet locked
  if (transactionCount > 0 && !isLocked) {
    await db
      .update(systemSettings)
      .set({ isShareValueLocked: true, updatedAt: new Date() })
      .where(eq(systemSettings.id, settings.id));

    isLocked = true;
  }

  return { isLocked, transactionCount };
}

/**
 * Idempotent helper that locks the share value if transactions exist.
 * Useful as a post-seed / post-migration safety net.
 */
export async function checkAndAutoLockShareValue(): Promise<void> {
  const db = getDb();

  const [settings] = await db
    .select({ id: systemSettings.id, isShareValueLocked: systemSettings.isShareValueLocked })
    .from(systemSettings)
    .limit(1);

  if (!settings || settings.isShareValueLocked) return;

  const [txResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.isDeleted, false));

  if (Number(txResult?.count ?? 0) > 0) {
    await db
      .update(systemSettings)
      .set({ isShareValueLocked: true, updatedAt: new Date() })
      .where(eq(systemSettings.id, settings.id));
  }
}
