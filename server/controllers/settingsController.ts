import asyncHandler from 'express-async-handler';
import { getDb } from '../db/connection.js';
import { systemSettings, transactions } from '../db/schema/index.js';
import { eq, count } from 'drizzle-orm';
import { normalizeCurrencyCode } from '../utils/currency.js';

// ---------------------------------------------------------------------------
// Helper – ensure exactly one settings row exists (singleton pattern)
// ---------------------------------------------------------------------------
const ensureSettings = async () => {
  const db = getDb();
  let [settings] = await db.select().from(systemSettings).limit(1);

  if (!settings) {
    const [created] = await db
      .insert(systemSettings)
      .values({})
      .returning();
    settings = created;
  }

  return settings;
};

// ---------------------------------------------------------------------------
// Helper – auto-lock share value when transactions already exist
// Returns the (possibly just-locked) settings row.
// ---------------------------------------------------------------------------
const checkAndAutoLockShareValue = async () => {
  const db = getDb();
  const settings = await ensureSettings();

  if (settings.isShareValueLocked) {
    console.log('[SHARE VALUE] Already locked, skipping check');
    return settings;
  }

  const [{ count: txCount }] = await db
    .select({ count: count() })
    .from(transactions);

  console.log(
    `[SHARE VALUE] Transaction count: ${txCount}, isLocked before: ${settings.isShareValueLocked}`,
  );

  if (Number(txCount) > 0) {
    const [updated] = await db
      .update(systemSettings)
      .set({ isShareValueLocked: true })
      .where(eq(systemSettings.id, settings.id))
      .returning();

    console.log('[SHARE VALUE] Auto-locked share value due to existing transactions');
    return updated;
  }

  console.log('[SHARE VALUE] No transactions, share value remains editable');
  return settings;
};

// ---------------------------------------------------------------------------
// Helper – safely extract the authenticated user
// ---------------------------------------------------------------------------
const getReqUser = (req: any): { _id: string } | null => req.user ?? null;

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------
const getSettings = asyncHandler(async (req, res) => {
  const settings = await checkAndAutoLockShareValue();
  res.json(settings);
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------
const updateSettings = asyncHandler(async (req, res) => {
  const db = getDb();

  // Ensure settings row exists and auto-lock if needed
  const lockedSettings = await checkAndAutoLockShareValue();
  const isLocked = lockedSettings.isShareValueLocked;

  console.log(
    '[SHARE VALUE UPDATE] Request body:',
    JSON.stringify(req.body, null, 2),
  );
  console.log(
    '[SHARE VALUE UPDATE] Current locked state:',
    isLocked,
  );

  // Build the update payload – fields are top-level in the Drizzle schema
  const updateData: Record<string, any> = {};

  if (req.body.financial) {
    // Handle baseCurrency normalization
    if (req.body.financial.baseCurrency !== undefined) {
      const normalized = normalizeCurrencyCode(req.body.financial.baseCurrency);
      if (normalized) {
        updateData.baseCurrency = normalized;
      }
    }

    // Handle shareValueBdt – reject if locked
    if (req.body.financial.shareValueBdt !== undefined) {
      if (isLocked) {
        console.log('[SHARE VALUE UPDATE] REJECTED - Share value is locked');
        res.status(403);
        throw new Error(
          'Share value is permanently locked because transactions exist. It cannot be changed.',
        );
      }
      updateData.shareValueBdt = String(Number(req.body.financial.shareValueBdt));
      console.log(
        '[SHARE VALUE UPDATE] Updated share value to:',
        updateData.shareValueBdt,
      );
    }

    // Merge other financial fields (isShareValueLocked is never accepted from client)
    const { shareValueBdt, isShareValueLocked, baseCurrency, ...otherFinancial } = req.body.financial;
    for (const [key, val] of Object.entries(otherFinancial)) {
      if (val !== undefined) {
        updateData[key] = val;
      }
    }
  }

  if (req.body.system) {
    for (const [key, val] of Object.entries(req.body.system)) {
      if (val !== undefined) {
        updateData[key] = val;
      }
    }
  }

  const user = getReqUser(req);
  if (user) {
    updateData.lastUpdatedBy = user._id;
  }
  updateData.lastUpdatedAt = new Date();

  if (Object.keys(updateData).length > 0) {
    const [updatedSettings] = await db
      .update(systemSettings)
      .set(updateData)
      .where(eq(systemSettings.id, lockedSettings.id))
      .returning();

    console.log(
      '[SHARE VALUE UPDATE] Saved settings, isShareValueLocked:',
      updatedSettings.isShareValueLocked,
    );

    res.json(updatedSettings);
  } else {
    res.json(lockedSettings);
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/share-value-status
// ---------------------------------------------------------------------------
const getShareValueStatus = asyncHandler(async (req, res) => {
  const db = getDb();
  const settings = await ensureSettings();

  const [{ count: txCount }] = await db
    .select({ count: count() })
    .from(transactions);

  // Auto-lock if transactions exist but not yet flagged
  if (Number(txCount) > 0 && !settings.isShareValueLocked) {
    await db
      .update(systemSettings)
      .set({ isShareValueLocked: true })
      .where(eq(systemSettings.id, settings.id));
    settings.isShareValueLocked = true;
  }

  res.json({
    shareValueBdt: settings.shareValueBdt,
    isLocked: settings.isShareValueLocked,
    transactionCount: Number(txCount),
  });
});

export { getSettings, updateSettings, getShareValueStatus };
