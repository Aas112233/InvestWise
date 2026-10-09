import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, funds, projects, transactions } from '@/db/schema/index';
import { eq, and, count, sql } from 'drizzle-orm';
import { AuthError, ForbiddenError, NotFoundError, readJsonBody } from '@/lib/utils/errors';
import { requireSuperAdmin, requireAuthUser } from '@/lib/admin-guard';
import { resolveModuleAccess } from '@/lib/tenant-modules';
import { forceDeleteTenant, logSuperAdminAction } from '@/lib/superadmin-service';
import { getClientIp } from '@/lib/request-meta';

interface TenantResponse {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  isMaintenanceMode: boolean;
  maxUsers: number;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
}

function toTenantResponse(row: Record<string, unknown>, userCount?: number): TenantResponse {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    status: row.status as string,
    plan: row.plan as string,
    isMaintenanceMode: Boolean(row.isMaintenanceMode),
    maxUsers: Number(row.maxUsers || 100),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : '',
    userCount,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);

    const { id } = await params;
    const db = getDb();

    const [target] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!target) {
      throw new NotFoundError('Tenant');
    }

    const tenantUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.tenantId, id))
      .limit(50);

    const [userCountResult, fundsCountResult, projectsCountResult, reserveAgg, txAgg, txCountResult] =
      await Promise.all([
        db.select({ count: count() }).from(users).where(eq(users.tenantId, id)),
        db.select({ count: count() }).from(funds).where(eq(funds.tenantId, id)),
        db.select({ count: count() }).from(projects).where(eq(projects.tenantId, id)),
        // Reserve balance lives on funds; flow amounts live on transactions.
        // Deliberately two queries: joining them would fan out to
        // funds x transactions and multiply every SUM.
        db
          .select({ netReserve: sql<string>`coalesce(sum(${funds.balance}::numeric), 0)` })
          .from(funds)
          .where(eq(funds.tenantId, id)),
        db
          .select({
            totalDeposits: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'Deposit'), 0)`,
            totalWithdrawals: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'Withdrawal'), 0)`,
            totalExpenses: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'Expense'), 0)`,
            totalDividends: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'Dividend'), 0)`,
          })
          .from(transactions)
          .where(and(eq(transactions.tenantId, id), eq(transactions.isDeleted, false))),
        db
          .select({ count: count() })
          .from(transactions)
          .where(and(eq(transactions.tenantId, id), eq(transactions.isDeleted, false))),
      ]);

    const totalUsers = Number(userCountResult[0]?.count ?? 0);
    const totalFunds = Number(fundsCountResult[0]?.count ?? 0);
    const totalProjects = Number(projectsCountResult[0]?.count ?? 0);
    const flow = txAgg[0];

    return NextResponse.json({
      success: true,
      data: {
        tenant: toTenantResponse(target, totalUsers),
        moduleAccess: resolveModuleAccess(target.moduleAccess),
        stats: {
          totalUsers,
          totalFunds,
          totalProjects,
          totalTransactions: Number(txCountResult[0]?.count ?? 0),
        },
        financials: {
          // decimal(15,2) crosses the wire as a string — never a JS float.
          totalDeposits: flow?.totalDeposits ?? '0',
          totalWithdrawals: flow?.totalWithdrawals ?? '0',
          totalExpenses: flow?.totalExpenses ?? '0',
          totalDividends: flow?.totalDividends ?? '0',
          netReserveBalance: reserveAgg[0]?.netReserve ?? '0',
        },
        users: tenantUsers.map(u => ({
          ...u,
          createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : '',
        })),
      },
    });
  } catch (error: any) {
    console.error('[GET TENANT DETAIL ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load tenant details', code: 'TENANT_DETAIL_FAILED' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const { id } = await params;
    const body = await readJsonBody(request);
    const { status, isMaintenanceMode, name, plan, maxUsers, reason } = body;

    const db = getDb();

    const [target] = await db
      .select({
        id: tenants.id,
        status: tenants.status,
        slug: tenants.slug,
        name: tenants.name,
        plan: tenants.plan,
        maxUsers: tenants.maxUsers,
        isMaintenanceMode: tenants.isMaintenanceMode,
      })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!target) {
      throw new NotFoundError('Tenant');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) {
        return NextResponse.json(
          { success: false, message: 'Invalid status. Must be active or suspended', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      // Prevent suspending the default tenant
      if (target.slug === 'default' && status === 'suspended') {
        return NextResponse.json(
          { success: false, message: 'Cannot suspend the default tenant', code: 'FORBIDDEN' },
          { status: 403 }
        );
      }

      updateData.status = status;
    }

    if (isMaintenanceMode !== undefined) {
      updateData.isMaintenanceMode = Boolean(isMaintenanceMode);
    }

    // Field validation before any write — these values used to reach Postgres
    // raw (a string maxUsers or 10MB name became an opaque 500, §11).
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 255) {
        return NextResponse.json(
          {
            success: false,
            message: "[Field 'name', Code: too_long] Name must be a string between 2 and 255 characters",
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }

    if (plan !== undefined) {
      if (typeof plan !== 'string' || !/^[a-z0-9-]{2,100}$/.test(plan)) {
        return NextResponse.json(
          {
            success: false,
            message: "[Field 'plan', Code: invalid_format] Plan must be 2-100 characters, lowercase letters, digits and dashes",
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        );
      }
      updateData.plan = plan;
    }

    if (maxUsers !== undefined) {
      if (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 100_000) {
        return NextResponse.json(
          {
            success: false,
            message: "[Field 'maxUsers', Code: out_of_range] Must be an integer between 1 and 100000",
            code: 'VALIDATION_ERROR',
          },
          { status: 400 }
        );
      }
      updateData.maxUsers = maxUsers;
    }

    if (Object.keys(updateData).length === 1) { // only updatedAt
      return NextResponse.json(toTenantResponse(target));
    }

    const [updated] = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Tenant');
    }

    // Audit (§6, pre-flight #4): suspending a tenant, moving it off a paid
    // plan or changing its seat cap is exactly the kind of platform action
    // that must be attributable — this route previously wrote no audit row.
    await logSuperAdminAction({
      context: { adminUserId: user.id, adminEmail: user.email, ipAddress: getClientIp(request) },
      actionType: 'TENANT_UPDATE',
      targetType: 'Tenant',
      targetId: id,
      tenantId: id,
      details: {
        reason: typeof reason === 'string' ? reason.slice(0, 500) : null,
        from: {
          status: target.status,
          plan: target.plan,
          maxUsers: target.maxUsers,
          isMaintenanceMode: target.isMaintenanceMode,
          name: target.name,
        },
        to: {
          status: updated.status,
          plan: updated.plan,
          maxUsers: updated.maxUsers,
          isMaintenanceMode: updated.isMaintenanceMode,
          name: updated.name,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: { tenant: toTenantResponse(updated) },
      message: 'Tenant updated successfully',
    });
  } catch (error: any) {
    console.error('[UPDATE TENANT ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to update tenant', code: 'TENANT_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const { id } = await params;

    // Prevent deleting the default tenant
    const db = getDb();
    const [target] = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!target) {
      throw new NotFoundError('Tenant');
    }

    if (target.slug === 'default') {
      return NextResponse.json(
        { success: false, message: 'Cannot delete the default tenant', code: 'FORBIDDEN' },
        { status: 403 }
      );
    }

    // ?force=true = platform wipe: every tenant-scoped row, its users, and the
    // tenant itself, in one transaction, plus a TENANT_FORCE_DELETE audit row.
    // Without it this stays a guarded delete that refuses on any remaining data.
    if (request.nextUrl.searchParams.get('force') === 'true') {
      await forceDeleteTenant(id, {
        adminUserId: user.id || null,
        adminEmail: user.email,
        ipAddress: getClientIp(request),
      });

      return NextResponse.json({
        success: true,
        message: 'Tenant force deleted',
      });
    }

    // Check if tenant has users
    const [userCountResult] = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.tenantId, id));

    if (Number(userCountResult?.count ?? 0) > 0) {
      return NextResponse.json(
        { success: false, message: 'Cannot delete tenant with existing users. Transfer or delete users first.', code: 'CONFLICT' },
        { status: 409 }
      );
    }

    await db.delete(tenants).where(eq(tenants.id, id));

    return NextResponse.json({
      success: true,
      message: 'Tenant deleted successfully',
    });
  } catch (error: any) {
    console.error('[DELETE TENANT ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    // 23503 = a row still references the tenant. Name the constraint instead of
    // masking it as "Failed to delete tenant" (§11).
    if (error?.code === '23503') {
      return NextResponse.json(
        { success: false, message: `Cannot delete tenant: ${error.detail || error.message}`, code: 'CONFLICT' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to delete tenant', code: 'TENANT_DELETE_FAILED' },
      { status: 500 }
    );
  }
}