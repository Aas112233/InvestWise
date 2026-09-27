import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSql } from '@/db/index';
import { getAuthContext } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';

const TABLES = [
  'members', 'transactions', 'projects', 'funds', 'users',
  'system_settings', 'audit_logs', 'login_attempts', 'sessions',
  'deleted_records', 'blacklisted_tokens', 'global_stats', 'goals',
];

async function performBackup() {
  const sql = getSql();
  const backup: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = await sql.unsafe(`SELECT * FROM ${table}`);
    backup[table] = rows;
  }
  return backup;
}

// POST /api/backup/cron - Cron endpoint (no auth, uses CRON_SECRET)
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    
    if (!cronSecret || !auth || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, message: 'Invalid or missing cron secret' },
        { status: 401 }
      );
    }

    const backup = await performBackup();

    console.log(`[cron] Backup completed: ${TABLES.length} tables at ${new Date().toISOString()}`);

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
    const { user: authUser, error } = await getAuthContext(request);
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

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'daily';
    const download = searchParams.get('download') === 'true';

    const backup = await performBackup();

    const backupData = {
      version: '2.0',
      engine: 'postgresql',
      timestamp: new Date().toISOString(),
      type,
      tables: backup,
    };

    if (download) {
      return new NextResponse(JSON.stringify(backupData), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename=investwise-backup-${new Date().toISOString().split('T')[0]}.json`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      status: 'completed',
      duration: 0,
      tables: TABLES.length,
      timestamp: backupData.timestamp,
    });
  } catch (error: any) {
    console.error('[MANUAL BACKUP ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
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