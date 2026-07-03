import asyncHandler from 'express-async-handler';
import { normalizeCurrencyCode } from '../utils/currency.js';
import { getDb } from '../db/connection.js';
import { systemSettings, transactions } from '../db/schema/index.js';
import { eq, count } from 'drizzle-orm';

/**
 * Helper: Get or create the singleton settings row
 */
const getOrCreateSettings = async (db) => {
  const [settings] = await db.select().from(systemSettings).limit(1);
  if (settings) return settings;

  const [newSettings] = await db.insert(systemSettings).values({}).returning();
  return newSettings;
};

/**
 * Helper: Check if any transactions exist and auto-lock share value
 */
const checkAndAutoLockShareValue = async (db, settings) => {
  if (settings.isShareValueLocked) {
    console.log('[SHARE VALUE] Already locked, skipping check');
    return true;
  }

  const [txCount] = await db.select({ count: count() }).from(transactions);
  const transactionCount = Number(txCount.count);
  console.log(`[SHARE VALUE] Transaction count: ${transactionCount}, isLocked before: ${settings.isShareValueLocked}`);

  if (transactionCount > 0) {
    await db.update(systemSettings)
      .set({ isShareValueLocked: true })
      .where(eq(systemSettings.id, settings.id));
    console.log('[SHARE VALUE] Auto-locked share value due to existing transactions');
    return true;
  }
  console.log('[SHARE VALUE] No transactions, share value remains editable');
  return false;
};

// @desc    Get system settings
// @route   GET /api/settings
// @access  Private
const getSettings = asyncHandler(async (req, res) => {
  const db = getDb();
  const settings = await getOrCreateSettings(db);
  await checkAndAutoLockShareValue(db, settings);
  // Re-fetch to get updated state
  const [updated] = await db.select().from(systemSettings).where(eq(systemSettings.id, settings.id)).limit(1);
  res.json(updated);
});

// @desc    Update system settings
// @route   PUT /api/settings
// @access  Private/Admin
const updateSettings = asyncHandler(async (req, res) => {
  const db = getDb();
  const settings = await getOrCreateSettings(db);
  const isLocked = await checkAndAutoLockShareValue(db, settings);

  console.log('[SHARE VALUE UPDATE] Request body:', JSON.stringify(req.body.financial, null, 2));
  console.log('[SHARE VALUE UPDATE] Current locked state:', settings.isShareValueLocked);

  const updateData = {};

  if (req.body.financial) {
    if (req.body.financial.baseCurrency !== undefined) {
      const normalizedCurrency = normalizeCurrencyCode(req.body.financial.baseCurrency);
      if (normalizedCurrency) {
        updateData.baseCurrency = normalizedCurrency;
      }
    }

    if (req.body.financial.shareValueBdt !== undefined) {
      if (isLocked || settings.isShareValueLocked) {
        console.log('[SHARE VALUE UPDATE] REJECTED - Share value is locked');
        res.status(403);
        throw new Error('Share value is permanently locked because transactions exist. It cannot be changed.');
      }
      updateData.shareValueBdt = String(req.body.financial.shareValueBdt);
    }

    // Merge other financial settings (exclude shareValueBdt and isShareValueLocked)
    if (req.body.financial.fiscalYearStart !== undefined) updateData.fiscalYearStart = req.body.financial.fiscalYearStart;
    if (req.body.financial.taxRate !== undefined) updateData.taxRate = String(req.body.financial.taxRate);
    if (req.body.financial.accountingMethod !== undefined) updateData.accountingMethod = req.body.financial.accountingMethod;
  }

  if (req.body.system) {
    if (req.body.system.language !== undefined) updateData.language = req.body.system.language;
    if (req.body.system.theme !== undefined) updateData.theme = req.body.system.theme;
    if (req.body.system.dateFormat !== undefined) updateData.dateFormat = req.body.system.dateFormat;
    if (req.body.system.isMaintenanceMode !== undefined) updateData.isMaintenanceMode = req.body.system.isMaintenanceMode;
    if (req.body.system.refreshInterval !== undefined) updateData.refreshInterval = req.body.system.refreshInterval;
  }

  if (req.user) {
    updateData.lastUpdatedBy = req.user.id || req.user._id;
  }
  updateData.lastUpdatedAt = new Date();

  const [updatedSettings] = await db.update(systemSettings)
    .set(updateData)
    .where(eq(systemSettings.id, settings.id))
    .returning();

  console.log('[SHARE VALUE UPDATE] Saved settings, isShareValueLocked:', updatedSettings.isShareValueLocked);
  res.json(updatedSettings);
});

// @desc    Check if share value is locked
// @route   GET /api/settings/share-value-status
// @access  Private
const getShareValueStatus = asyncHandler(async (req, res) => {
  const db = getDb();
  const settings = await getOrCreateSettings(db);
  const [txCount] = await db.select({ count: count() }).from(transactions);
  const transactionCount = Number(txCount.count);

  if (transactionCount > 0 && !settings.isShareValueLocked) {
    await db.update(systemSettings)
      .set({ isShareValueLocked: true })
      .where(eq(systemSettings.id, settings.id));
  }

  const [updated] = await db.select().from(systemSettings).where(eq(systemSettings.id, settings.id)).limit(1);
  res.json({
    shareValueBdt: updated.shareValueBdt,
    isLocked: updated.isShareValueLocked,
    transactionCount,
  });
});

export { getSettings, updateSettings, getShareValueStatus };
