import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/db/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { requireTenant } from '@/lib/tenant';
import { guard } from '@/lib/guarded-route';
import { logAudit } from '@/lib/utils/audit';
import { AppError, AuthError, ForbiddenError } from '@/lib/utils/errors';

// ponytail: export set is the minimum tenant-scoped business slice. Tables
// holding credentials or unscoped secrets are deliberately absent: users
// (bcrypt hashes), sessions (live ids), blacklisted_tokens (raw JWTs),
// login_attempts (IPs), deleted_records and global_stats (no tenant_id
// column — see DATA-029). Platform-wide backups go through the R2 pg_dump
// workflow, never this endpoint.
const TABLES = [
  'members', 'transactions', 'projects', 'funds',
  'system_settings', 'audit_logs', 'goals',
] as const;

async function performBackup(tenantId: string) {
  const sql = getSql();
  const backup: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    backup[table] = [...(await sql`SELECT * FROM ${sql(table)} WHERE tenant_id = ${tenantId}`)];
  }
  return backup;
}

function rowCounts(backup: Record<string, unknown[]>): Record<string, number> {
  return Object.fromEntries(TABLES.map((t) => [t, backup[t]?.length ?? 0]));
}

// POST /api/backup (the CRON_SECRET liveness ping that used to live here) has
// moved to app/api/cron/backup/route.ts. It could never execute at this path:
// the edge only exempts /api/cron/* from the session check, so a scheduler
// presenting just `Authorization: Bearer $CRON_SECRET` was rejected here before
// the secret was ever compared. Do NOT re-add this path to PUBLIC_PATHS to
// "make it work" — that is how a money-adjacent route becomes unauthenticated.

// GET /api/backup/manual - Manual backup (admin only)
export async function GET(request: NextRequest) {
  try {
    const { user: authUser, tenantId, error } = await getAuthContext(request);
    if (error || !authUser) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Backup is an Admin / platform-operator operation.
    const callerRole = normalizeRole(authUser.role);
    if (callerRole !== 'Admin' && callerRole !== 'SuperAdmin') {
      throw new ForbiddenError('Admin access required');
    }

    // Fail closed: tenant Admins export only their own slice; platform
    // operators (null tenant) must use /api/admin, never this endpoint.
    const scopedTenantId = requireTenant(tenantId, authUser);

    // Seven sequential unbounded `SELECT *` over the tenant's whole dataset,
    // fully materialised and JSON.stringify'd for ?download=true. One stolen
    // Admin session otherwise yields a complete data exfiltration loop and a
    // memory-per-request DoS at the same time.
    const limited = await guard(request, 'export', { user: authUser.id, tenant: scopedTenantId });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'daily';
    const download = searchParams.get('download') === 'true';

    const backup = await performBackup(scopedTenantId);
    const counts = rowCounts(backup);

    // A bulk PII export must be filterable by tenant in the audit trail.
    await logAudit({
      user: { id: authUser.id, name: authUser.name },
      tenantId: scopedTenantId,
      action: 'EXPORT_BACKUP',
      resourceType: 'Backup',
      details: { tenantId: scopedTenantId, type, download, rowCounts: counts },
    });

    const backupData = {
      version: '2.0',
      engine: 'postgresql',
      timestamp: new Date().toISOString(),
      type,
      tenantId: scopedTenantId,
      tables: backup,
    };

    if (download) {
      return new NextResponse(JSON.stringify(backupData), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=investwise-backup-${scopedTenantId}-${new Date().toISOString().split('T')[0]}.json`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      status: 'completed',
      duration: 0,
      tables: TABLES.length,
      rowCounts: counts,
      timestamp: backupData.timestamp,
    });
  } catch (error: any) {
    console.error('[MANUAL BACKUP ERROR]', error);
    
    if (error instanceof AppError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Backup failed', code: 'BACKUP_FAILED' },
      { status: 500 }
    );
  }
}