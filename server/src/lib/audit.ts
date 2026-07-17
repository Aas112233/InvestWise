import { getDb } from '../config/database.js';
import { auditLogs } from '../db/schema/index.js';

interface AuditParams {
  user?: { id?: string; name?: string } | null;
  req?: { ip?: string; headers?: Record<string, string | undefined> } | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: unknown;
  status?: string;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const db = getDb();
    const ip = params.req?.ip || params.req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null;
    const userAgent = params.req?.headers?.['user-agent'] || null;

    await db.insert(auditLogs).values({
      userId: params.user?.id || null,
      userName: params.user?.name || null,
      action: params.action,
      resourceType: params.resourceType || 'System',
      resourceId: params.resourceId || null,
      details: typeof params.details === 'string' ? { message: params.details } : (params.details as any) || null,
      ipAddress: ip,
      userAgent,
      status: params.status || 'SUCCESS',
    });
  } catch (error) {
    console.error('Audit log failed:', error);
  }
}
