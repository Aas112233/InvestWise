import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/db/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { requireTenant } from '@/lib/tenant';
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

// Constant-time bearer comparison (SEV-024): plain !== leaks the secret
// prefix through response timing.
function isValidCronSecret(cronSecret: string, auth: string | null): boolean {
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const presented = Buffer.from(auth.slice(7));
  const expected = Buffer.from(`Bearer ${cronSecret}`.slice(7));
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

// POST /api/backup/cron - Cron endpoint (no auth, uses CRON_SECRET)
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!cronSecret || !isValidCronSecret(cronSecret, auth)) {
      return NextResponse.json(
        { success: false, message: 'Invalid or missing cron secret' },
        { status: 401 }
      );
    }

    // ponytail: this endpoint historically materialized every table into
    // memory and discarded it (DATA-021 DoS amplifier). The durable backup is
    // the R2 pg_dump workflow; the cron hook stays as a liveness signal only.
    console.log(`[cron] Backup ping at ${new Date().toISOString()}`);

    return NextResponse.json({
      success: true,
      status: 'completed',
      tables: TABLES.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[CRON BACKUP ERROR]', error);
    return NextResponse.json(
      { success: false, message: 'Backup failed', code: 'BACKUP_FAILED' },
      { status: 500 }
    );
  }
}

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

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'daily';
    const download = searchParams.get('download') === 'true';

    const backup = await performBackup(scopedTenantId);
    const counts = rowCounts(backup);

    // logAudit never throws; tenantId rides in details until the writer
    // itself is tenant-scoped (API-023).
    await logAudit({
      user: { id: authUser.id, name: authUser.name },
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