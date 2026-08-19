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

function formatSettingsResponse(settings: any): Record<string, unknown> {
  if (!settings) return {};
  return {
    ...settings,
    organization: {
      companyName: settings.companyName || 'InvestWise',
      companyTagline: settings.companyTagline || 'Enterprise Investment Management',
      companyAddress: settings.companyAddress || '',
      companyEmail: settings.companyEmail || '',
      companyPhone: settings.companyPhone || '',
      companyWebsite: settings.companyWebsite || '',
      companyRegNo: settings.companyRegNo || '',
    },
    financial: {
      fiscalYearStart: settings.fiscalYearStart || 'July',
      fiscalYearEnd: settings.fiscalYearEnd || 'June',
      baseCurrency: settings.baseCurrency || '',
      taxRate: Number(settings.taxRate || 15.0),
      accountingMethod: settings.accountingMethod || 'Cash',
      shareValueBdt: Number(settings.shareValueBdt || 1000),
      isShareValueLocked: Boolean(settings.isShareValueLocked),
      withdrawalLimitPercent: Number(settings.withdrawalLimitPercent || 25),
      withdrawalNoticeDays: Number(settings.withdrawalNoticeDays || 30),
      maxWithdrawalPerRequest: Number(settings.maxWithdrawalPerRequest || 100000),
      statutoryReservePercent: Number(settings.statutoryReservePercent || 10),
      lastFiscalCloseDate: settings.lastFiscalCloseDate,
    },
    governance: {
      monthlyMeetingDay: settings.monthlyMeetingDay || 5,
      depositDueDate: settings.depositDueDate || 10,
      gracePeriodDays: settings.gracePeriodDays || 3,
      meetingTypes: settings.meetingTypes,
      penaltyRules: settings.penaltyRules,
    },
    system: {
      language: settings.language || 'English',
      refreshInterval: settings.refreshInterval || 'Real-time',
      theme: settings.theme || 'System Default',
      dateFormat: settings.dateFormat || 'DD/MM/YYYY',
      isMaintenanceMode: Boolean(settings.isMaintenanceMode),
    },
  };
}

/**
 * Retrieve the singleton system settings row.
 * Creates a default row if none exists yet.
 */
export async function getSettings(): Promise<Record<string, unknown>> {
  return cache.getOrSet(
    SETTINGS_CACHE_KEY,
    async () => {
      // Auto-lock share value if transactions exist
      await checkAndAutoLockShareValue();

      const db = getDb();
      const [settings] = await db.select().from(systemSettings).limit(1);

      if (!settings) {
        const [created] = await db.insert(systemSettings).values({}).returning();
        return formatSettingsResponse(created);
      }

      return formatSettingsResponse(settings);
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

  // Flatten organization group
  if (data.organization) {
    if (data.organization.companyName !== undefined) {
      updateData.companyName = data.organization.companyName;
    }
    if (data.organization.companyTagline !== undefined) {
      updateData.companyTagline = data.organization.companyTagline;
    }
    if (data.organization.companyAddress !== undefined) {
      updateData.companyAddress = data.organization.companyAddress;
    }
    if (data.organization.companyEmail !== undefined) {
      updateData.companyEmail = data.organization.companyEmail;
    }
    if (data.organization.companyPhone !== undefined) {
      updateData.companyPhone = data.organization.companyPhone;
    }
    if (data.organization.companyWebsite !== undefined) {
      updateData.companyWebsite = data.organization.companyWebsite;
    }
    if (data.organization.companyRegNo !== undefined) {
      updateData.companyRegNo = data.organization.companyRegNo;
    }
  }

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

  // Flatten governance group
  if (data.governance) {
    if (data.governance.monthlyMeetingDay !== undefined) {
      updateData.monthlyMeetingDay = data.governance.monthlyMeetingDay;
    }
    if (data.governance.depositDueDate !== undefined) {
      updateData.depositDueDate = data.governance.depositDueDate;
    }
    if (data.governance.gracePeriodDays !== undefined) {
      updateData.gracePeriodDays = data.governance.gracePeriodDays;
    }
    if (data.governance.meetingTypes !== undefined) {
      updateData.meetingTypes = data.governance.meetingTypes;
    }
    if (data.governance.penaltyRules !== undefined) {
      updateData.penaltyRules = data.governance.penaltyRules;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return formatSettingsResponse(current);
  }

  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(systemSettings)
    .set(updateData)
    .where(eq(systemSettings.id, current.id))
    .returning();

  // Invalidate settings cache so next request fetches fresh data
  cache.del(SETTINGS_CACHE_KEY);
  return formatSettingsResponse(updated);
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
