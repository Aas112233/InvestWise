import { getDb } from '../db/connection.js';
import { auditLogs } from '../db/schema/index.js';

/**
 * Logs a system action to the database.
 *
 * @param params - The log parameters.
 * @param params.req - Express request object (optional, for IP/User extraction).
 * @param params.user - User object (if req not provided or to override).
 * @param params.action - The action name (e.g. 'LOGIN', 'CREATE').
 * @param params.resourceType - The target resource (e.g. 'Project', 'Fund').
 * @param params.resourceId - ID of the target resource.
 * @param params.details - Details about the change (e.g. diff, reason).
 * @param params.status - 'SUCCESS', 'FAILURE', or 'WARNING'.
 */
export const logAudit = async ({
  req = null,
  user = null,
  action,
  resourceType = 'System',
  resourceId = null,
  details = {},
  status = 'SUCCESS'
}: {
  req?: { user?: { _id: string; name?: string }; headers: Record<string, string | string[] | undefined>; socket: { remoteAddress: string }; get: (header: string) => string | undefined } | null;
  user?: { _id: string; name?: string } | null;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  details?: unknown;
  status?: string;
}) => {
  try {
    const db = getDb();
    const currentUser = user || (req ? req.user : null);
    const ip = req ? (req.headers['x-forwarded-for'] as string | undefined || req.socket.remoteAddress) : 'SYSTEM';
    const userAgent = req ? req.get('User-Agent') : 'Internal';

    await db.insert(auditLogs).values({
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
