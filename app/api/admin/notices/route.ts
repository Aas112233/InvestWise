import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { superAdminActionLog } from '@/db/schema/index';
import { desc, eq } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import { validateNoticeInput } from '@/lib/admin/notice-schema';

export interface BroadcastNotice {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  adminEmail: string;
  createdAt: string;
  expiresAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);

    const db = getDb();
    const rows = await db
      .select()
      .from(superAdminActionLog)
      .where(eq(superAdminActionLog.actionType, 'BROADCAST_NOTICE'))
      .orderBy(desc(superAdminActionLog.createdAt))
      .limit(50);

    const data: BroadcastNotice[] = rows.map((r) => {
      const details = (r.details as Record<string, any>) || {};
      return {
        id: r.id,
        title: details.title || 'System Announcement',
        message: details.message || '',
        severity: (details.severity as any) || 'info',
        active: details.active !== false,
        adminEmail: r.adminEmail,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
        expiresAt: details.expiresAt,
      };
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[GET NOTICES ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve notices', code: 'NOTICES_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);

    const body = await request.json();
    const parsed = validateNoticeInput(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message, code: parsed.code },
        { status: 400 }
      );
    }
    const { title, message, severity, active, expiresAt } = parsed.value as {
      title: string;
      message: string;
      severity: 'info' | 'warning' | 'critical';
      active: boolean;
      expiresAt?: string | null;
    };

    const db = getDb();
    const [inserted] = await db
      .insert(superAdminActionLog)
      .values({
        adminUserId: user.id || null,
        adminEmail: user.email || 'operator@investwise.system',
        actionType: 'BROADCAST_NOTICE',
        targetType: 'PLATFORM_BROADCAST',
        ipAddress: getClientIp(request),
        details: {
          title,
          message,
          severity,
          active: Boolean(active),
          expiresAt: expiresAt ?? null,
        },
      })
      .returning();

    if (!inserted) {
      throw new Error('Failed to create notice');
    }

    return NextResponse.json({
      success: true,
      data: {
        id: inserted.id,
        title,
        message,
        severity,
        active,
        expiresAt: expiresAt ?? null,
        adminEmail: user.email,
        createdAt: inserted.createdAt instanceof Date ? inserted.createdAt.toISOString() : '',
      },
      message: 'Notice broadcasted successfully',
    });
  } catch (error: any) {
    console.error('[CREATE NOTICE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to broadcast notice', code: 'NOTICE_CREATE_FAILED' },
      { status: 500 }
    );
  }
}
