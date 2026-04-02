import AuditLog from '../models/AuditLog.js';

/**
 * Logs a system action to the database.
 * 
 * @param {Object} params - The log parameters.
 * @param {Object} params.req - Express request object (optional, for IP/User extraction).
 * @param {Object} params.user - User object (if req not provided or to override).
 * @param {String} params.action - The action name (e.g. 'LOGIN', 'CREATE').
 * @param {String} params.resourceType - The target resource (e.g. 'Project', 'Fund').
 * @param {String} params.resourceId - ID of the target resource.
 * @param {Object|String} params.details - Details about the change (e.g. diff, reason).
 * @param {String} params.status - 'SUCCESS', 'FAILURE', or 'WARNING'.
 */
export const logAudit = async ({
    req = null,
    user = null,
    action,
    resourceType = 'System',
    resourceId = null,
    details = {},
    status = 'SUCCESS'
}) => {
    try {
        const currentUser = user || (req ? req.user : null);
        const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : 'SYSTEM';
        const userAgent = req ? req.get('User-Agent') : 'Internal';

        await AuditLog.create({
            user: currentUser ? currentUser._id : null,
            userName: currentUser ? currentUser.name : 'System/Guest',
            action,
            resourceType,
            resourceId,
            details,
            ipAddress: ip,
            userAgent,
            status
        });
    } catch (error) {
        console.error('Audit Logging Failed:', error);
        // We don't want to crash the app if logging fails, just error to console
    }
};
