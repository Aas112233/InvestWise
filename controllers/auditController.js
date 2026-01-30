import asyncHandler from 'express-async-handler';
import AuditLog from '../models/AuditLog.js';

// @desc    Get system audit logs
// @route   GET /api/audit
// @access  Private (Admin Only)
const getAuditLogs = asyncHandler(async (req, res) => {
    const pageSize = 20;
    const page = Number(req.query.page) || 1;

    const query = {};

    // Filters
    if (req.query.action) {
        query.action = { $regex: req.query.action, $options: 'i' };
    }

    if (req.query.resourceType) {
        query.resourceType = req.query.resourceType;
    }

    if (req.query.startDate && req.query.endDate) {
        query.createdAt = {
            $gte: new Date(req.query.startDate),
            $lte: new Date(req.query.endDate)
        };
    }

    if (req.query.search) {
        query.$or = [
            { userName: { $regex: req.query.search, $options: 'i' } },
            { details: { $regex: req.query.search, $options: 'i' } }
        ];
    }

    const count = await AuditLog.countDocuments(query);
    const logs = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .limit(pageSize)
        .skip(pageSize * (page - 1))
        .populate('user', 'name email role'); // optional populate, though we store snapshot name

    res.json({
        logs,
        page,
        pages: Math.ceil(count / pageSize),
        total: count
    });
});

// @desc    Get supported actions/resources for filtering
// @route   GET /api/audit/metadata
// @access  Private (Admin Only)
const getAuditMetadata = asyncHandler(async (req, res) => {
    const actions = await AuditLog.distinct('action');
    const resources = await AuditLog.distinct('resourceType');

    res.json({ actions, resources });
});

// @desc    Get recent notifications (last 2 days)
// @route   GET /api/audit/notifications
// @access  Private (Admin Only)
const getNotifications = asyncHandler(async (req, res) => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Filter for impactful actions (adjust regex as needed based on your action naming convention)
    // We want CREATE, UPDATE, DELETE, etc., but maybe not LOGIN.
    // Common prefixes: CREATE_, UPDATE_, DELETE_, ADD_
    const query = {
        createdAt: { $gte: twoDaysAgo },
        action: { $regex: /^(CREATE|UPDATE|DELETE|ADD|EDIT)/, $options: 'i' }
    };

    const count = await AuditLog.countDocuments(query);
    const notifications = await AuditLog.find(query)
        .sort({ createdAt: -1 })
        .limit(20); // Cap at 20 recent notifications to display in dropdown

    res.json({
        count,
        notifications
    });
});

export { getAuditLogs, getAuditMetadata, getNotifications };
