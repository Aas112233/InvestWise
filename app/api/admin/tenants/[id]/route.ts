import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users, funds, projects } from '@/db/schema/index';
import { eq, count } from 'drizzle-orm';
import { AuthError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import { requireSuperAdmin, requireAuthUser } from '@/lib/admin-guard';

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

    const [userCountResult, fundsCountResult, projectsCountResult] = await Promise.all([
      db.select({ count: count() }).from(users).where(eq(users.tenantId, id)),
      db.select({ count: count() }).from(funds).where(eq(funds.tenantId, id)),
      db.select({ count: count() }).from(projects).where(eq(projects.tenantId, id)),
    ]);

    const totalUsers = Number(userCountResult[0]?.count ?? 0);
    const totalFunds = Number(fundsCountResult[0]?.count ?? 0);
    const totalProjects = Number(projectsCountResult[0]?.count ?? 0);

    return NextResponse.json({
      success: true,
      data: {
        tenant: toTenantResponse(target, totalUsers),
        stats: {
          totalUsers,
          totalFunds,
          totalProjects,
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
    const body = await request.json();
    const { status, isMaintenanceMode, name, plan, maxUsers } = body;

    const db = getDb();

    const [target] = await db
      .select({ id: tenants.id, status: tenants.status, slug: tenants.slug })
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

    if (name !== undefined) {
      updateData.name = name;
    }

    if (plan !== undefined) {
      updateData.plan = plan;
    }

    if (maxUsers !== undefined) {
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

    return NextResponse.json(
      { success: false, message: 'Failed to delete tenant', code: 'TENANT_DELETE_FAILED' },
      { status: 500 }
    );
  }
}