import SystemSettings from '../models/SystemSettings.js';
import asyncHandler from 'express-async-handler';
import Transaction from '../models/Transaction.js';

/**
 * Helper: Check if any transactions exist and auto-lock share value
 */
const checkAndAutoLockShareValue = async (settings) => {
    if (settings.financial.isShareValueLocked) {
        console.log('[SHARE VALUE] Already locked, skipping check');
        return true;
    }

    const transactionCount = await Transaction.countDocuments({});
    console.log(`[SHARE VALUE] Transaction count: ${transactionCount}, isLocked before: ${settings.financial.isShareValueLocked}`);

    if (transactionCount > 0) {
        settings.financial.isShareValueLocked = true;
        await settings.save();
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
    const settings = await SystemSettings.getSettings();
    // Auto-lock if transactions exist
    await checkAndAutoLockShareValue(settings);
    res.json(settings);
});

// @desc    Update system settings
// @route   PUT /api/settings
// @access  Private/Admin
const updateSettings = asyncHandler(async (req, res) => {
    const settings = await SystemSettings.getSettings();

    // Auto-lock check first - THIS RUNS BEFORE ANY UPDATES
    const isLocked = await checkAndAutoLockShareValue(settings);

    console.log('[SHARE VALUE UPDATE] Request body:', JSON.stringify(req.body.financial, null, 2));
    console.log('[SHARE VALUE UPDATE] Current locked state:', settings.financial.isShareValueLocked);

    // Deep merge or specific field updates
    if (req.body.financial) {
        // Check if trying to update share value
        if (req.body.financial.shareValueBdt !== undefined) {
            // If locked, reject the change
            if (isLocked || settings.financial.isShareValueLocked) {
                console.log('[SHARE VALUE UPDATE] REJECTED - Share value is locked');
                res.status(403);
                throw new Error('Share value is permanently locked because transactions exist. It cannot be changed.');
            }

            // Update the share value (only if not locked)
            settings.financial.shareValueBdt = Number(req.body.financial.shareValueBdt);
            console.log('[SHARE VALUE UPDATE] Updated share value to:', settings.financial.shareValueBdt);
        }

        // Merge other financial settings - EXCLUDE shareValueBdt and isShareValueLocked
        // isShareValueLocked can ONLY be set by the backend auto-lock mechanism
        const { shareValueBdt, isShareValueLocked, ...otherFinancial } = req.body.financial;
        if (Object.keys(otherFinancial).length > 0) {
            settings.financial = { ...settings.financial, ...otherFinancial };
        }
    }

    if (req.body.system) {
        settings.system = { ...settings.system, ...req.body.system };
    }

    if (req.user) {
        settings.lastUpdatedBy = req.user._id;
    }

    settings.lastUpdatedAt = Date.now();

    const updatedSettings = await settings.save();
    console.log('[SHARE VALUE UPDATE] Saved settings, isShareValueLocked:', updatedSettings.financial.isShareValueLocked);
    res.json(updatedSettings);
});

// @desc    Check if share value is locked
// @route   GET /api/settings/share-value-status
// @access  Private
const getShareValueStatus = asyncHandler(async (req, res) => {
    const settings = await SystemSettings.getSettings();
    const transactionCount = await Transaction.countDocuments({});

    // Auto-lock if transactions exist but flag isn't set yet
    if (transactionCount > 0 && !settings.financial.isShareValueLocked) {
        settings.financial.isShareValueLocked = true;
        await settings.save();
    }

    res.json({
        shareValueBdt: settings.financial.shareValueBdt,
        isLocked: settings.financial.isShareValueLocked,
        transactionCount
    });
});

export {
    getSettings,
    updateSettings,
    getShareValueStatus
};
