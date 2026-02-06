import SystemSettings from '../models/SystemSettings.js';
import asyncHandler from 'express-async-handler';

// @desc    Get system settings
// @route   GET /api/settings
// @access  Private
const getSettings = asyncHandler(async (req, res) => {
    const settings = await SystemSettings.getSettings();
    res.json(settings);
});

// @desc    Update system settings
// @route   PUT /api/settings
// @access  Private/Admin
const updateSettings = asyncHandler(async (req, res) => {
    const settings = await SystemSettings.getSettings();

    // Deep merge or specific field updates
    if (req.body.financial) {
        settings.financial = { ...settings.financial, ...req.body.financial };
    }

    if (req.body.system) {
        settings.system = { ...settings.system, ...req.body.system };
    }

    if (req.user) {
        settings.lastUpdatedBy = req.user._id;
    }

    settings.lastUpdatedAt = Date.now();

    const updatedSettings = await settings.save();
    res.json(updatedSettings);
});

export {
    getSettings,
    updateSettings
};
