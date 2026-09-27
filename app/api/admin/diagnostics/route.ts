import { NextRequest, NextResponse } from 'next/server';
import { getDb, getSql } from '@/db/index';
import { tenants, users, auditLogs, transactions } from '@/db/schema/index';
import { count, eq } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);

    // Liveness probe: a real query round-trip measuring actual latency in ms
    const probeStart = Date.now();
    const sql = getSql();
    let dbReachable = false;
    let dbVersion = 'PostgreSQL';
    let latencyMs = 0;

    try {
      const versionResult = await sql`SELECT version() AS version`;
      latencyMs = Date.now() - probeStart;
      dbReachable = true;
      if (versionResult[0]?.version) {
        dbVersion = String(versionResult[0].version).split(' on ')[0] || 'PostgreSQL';
      }
    } catch (dbErr) {
      console.error('[DIAGNOSTICS DB PROBE ERROR]', dbErr);
      dbReachable = false;
      latencyMs = Date.now() - probeStart;
    }

    const db = getDb();

    // Query platform stats safely
    let tenantTotal = 0;
    let tenantActive = 0;
    let tenantSuspended = 0;
    let userTotal = 0;
    let auditLogTotal = 0;
    let transactionTotal = 0;

    if (dbReachable) {
      const [
        totalTenantsResult,
        activeTenantsResult,
        suspendedTenantsResult,
        usersResult,
        auditLogsResult,
        transactionsResult,
      ] = await Promise.allSettled([
        db.select({ count: count() }).from(tenants),
        db.select({ count: count() }).from(tenants).where(eq(tenants.status, 'active')),
        db.select({ count: count() }).from(tenants).where(eq(tenants.status, 'suspended')),
        db.select({ count: count() }).from(users),
        db.select({ count: count() }).from(auditLogs),
        db.select({ count: count() }).from(transactions),
      ]);

      if (totalTenantsResult.status === 'fulfilled') {
        tenantTotal = Number(totalTenantsResult.value[0]?.count ?? 0);
      }
      if (activeTenantsResult.status === 'fulfilled') {
        tenantActive = Number(activeTenantsResult.value[0]?.count ?? 0);
      }
      if (suspendedTenantsResult.status === 'fulfilled') {
        tenantSuspended = Number(suspendedTenantsResult.value[0]?.count ?? 0);
      }
      if (usersResult.status === 'fulfilled') {
        userTotal = Number(usersResult.value[0]?.count ?? 0);
      }
      if (auditLogsResult.status === 'fulfilled') {
        auditLogTotal = Number(auditLogsResult.value[0]?.count ?? 0);
      }
      if (transactionsResult.status === 'fulfilled') {
        transactionTotal = Number(transactionsResult.value[0]?.count ?? 0);
      }
    }

    const DEGRADED_LATENCY_MS = 3000;
    const platformStatus = !dbReachable
      ? 'Unreachable'
      : latencyMs > DEGRADED_LATENCY_MS
        ? 'Degraded'
        : 'Operational';

    const memUsage = process.memoryUsage();

    return NextResponse.json({
      success: true,
      data: {
        status: platformStatus,
        uptime: platformStatus,
        checks: {
          database: {
            reachable: dbReachable,
            latencyMs,
            engine: dbVersion,
          },
          security: {
            jwtConfigured: Boolean(process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET),
            multiTenancyIsolation: 'STRICT_ROW_SCOPED',
            roleModel: 'RBAC_CANONICAL',
          },
          process: {
            nodeVersion: process.version,
            uptimeSeconds: Math.floor(process.uptime()),
            memoryRssMb: Math.round(memUsage.rss / (1024 * 1024)),
            memoryHeapMb: Math.round(memUsage.heapUsed / (1024 * 1024)),
          },
        },
        metrics: {
          tenants: {
            total: tenantTotal,
            active: tenantActive,
            suspended: tenantSuspended,
          },
          users: {
            total: userTotal,
          },
          auditLogs: {
            total: auditLogTotal,
          },
          transactions: {
            total: transactionTotal,
          },
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[DIAGNOSTICS ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Diagnostics probe failed', code: 'DIAGNOSTICS_FAILED' },
      { status: 500 }
    );
  }
}
