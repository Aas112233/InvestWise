import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { tenants, users } from '@/db/schema/index';
import { eq, desc, count, inArray } from 'drizzle-orm';
import { AppError, AuthError, ForbiddenError, NotFoundError, ConflictError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';

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
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const skip = (page - 1) * limit;
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    const db = getDb();

    const conditions = [];
    if (search) {
      conditions.push(
        (eq(tenants.name, search) as any)
      );
    }
    if (status) {
      conditions.push(eq(tenants.status, status));
    }

    const whereClause = conditions.length > 0 ? conditions[0] : undefined;

    const [totalResult, tenantRows] = await Promise.all([
      db.select({ count: count() }).from(tenants).where(whereClause),
      db
        .select()
        .from(tenants)
        .where(whereClause)
        .orderBy(desc(tenants.createdAt))
        .limit(limit)
        .offset(skip),
    ]);

    const tenantIds = tenantRows.map(row => row.id).filter((id): id is string => typeof id === 'string');
    const userCounts: Record<string, number> = {};
    if (tenantIds.length > 0) {
      const userCountRows = await db
        .select({ tenantId: users.tenantId, count: count() })
        .from(users)
        .where(inArray(users.tenantId, tenantIds))
        .groupBy(users.tenantId);

      for (const row of userCountRows) {
        if (row.tenantId) {
          userCounts[row.tenantId] = Number(row.count || 0);
        }
      }
    }

    const total = Number(totalResult[0]?.count ?? 0);
    const pages = Math.ceil(total / limit) || 1;

    const data = tenantRows.map(row => toTenantResponse(row, userCounts[row.id as string]));

    return NextResponse.json({
      data,
      meta: {
        total,
        page,
        limit,
        pages,
        hasNext: page < pages,
        hasPrev: page > 1,
        from: data.length > 0 ? skip + 1 : 0,
        to: skip + data.length,
      },
    });
  } catch (error: any) {
    console.error('[GET TENANTS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get tenants', code: 'TENANTS_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);

    requireSuperAdmin(user);

    const body = await request.json();
    const { slug, name, plan = 'standard', maxUsers = 100 } = body;

    if (!slug || !name) {
      return NextResponse.json(
        { success: false, message: 'Slug and name are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check for existing slug
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (existing) {
      throw new ConflictError('A tenant with this slug already exists');
    }

    const [created] = await db
      .insert(tenants)
      .values({
        slug,
        name,
        plan,
        maxUsers,
        status: 'active',
        isMaintenanceMode: false,
      })
      .returning();

    if (!created) {
      throw new AppError('Failed to create tenant', 500);
    }

    return NextResponse.json(
      {
        success: true,
        data: { tenant: toTenantResponse(created) },
        message: 'Tenant created successfully',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[CREATE TENANT ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConflictError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to create tenant', code: 'TENANT_CREATE_FAILED' },
      { status: 500 }
    );
  }
}