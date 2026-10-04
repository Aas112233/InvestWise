import { NextRequest, NextResponse } from 'next/server';
import { getDb, withDbRetry } from '@/db/index';
import { superAdminActionLog } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import { logSuperAdminAction } from '@/lib/superadmin-service';
import { validateNoticeInput, NOTICE_SEVERITIES } from '@/lib/admin/notice-schema';

type Params = { params: Promise<{ id: string }> };

async function loadNotice(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(superAdminActionLog)
    .where(eq(superAdminActionLog.id, id))
    .limit(1);
  if (!row || row.actionType !== 'BROADCAST_NOTICE') return null;
  return row;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);
    const { id } = await params;
    const row = await loadNotice(id);
    if (!row) {
      return NextResponse.json(
        { success: false, message: 'Notice not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
    const details = (row.details as Record<string, unknown>) || {};
    return NextResponse.json({
      success: true,
      data: {
        id: row.id,
        title: details.title ?? '',
        message: details.message ?? '',
        severity: details.severity ?? 'info',
        active: details.active !== false,
        expiresAt: details.expiresAt ?? null,
        adminEmail: row.adminEmail,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
      },
    });
  } catch (error: any) {
    console.error('[GET NOTICE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve notice', code: 'NOTICE_READ_FAILED' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);
    const { id } = await params;

    const body = await request.json();
    const parsed = validateNoticeInput(body, { partial: true });
    if (!parsed.ok) {
      return NextResponse.json(
        { success: false, message: parsed.message, code: parsed.code },
        { status: 400 }
      );
    }

    const existing = await loadNotice(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: 'Notice not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const prev = ((existing.details as Record<string, unknown>) || {}) as Record<string, unknown>;
    const next = { ...prev, ...parsed.value };
    if (next.severity && !NOTICE_SEVERITIES.includes(next.severity as any)) {
      return NextResponse.json(
        {
          success: false,
          message: `[Field 'severity', Code: invalid_enum] Expected one of ${NOTICE_SEVERITIES.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const [updated] = await withDbRetry(() =>
      db
        .update(superAdminActionLog)
        .set({ details: next as unknown as Record<string, unknown> })
        .where(eq(superAdminActionLog.id, id))
        .returning()
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, message: 'Notice not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    await logSuperAdminAction({
      context: {
        adminUserId: user.id || null,
        adminEmail: user.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'BROADCAST_NOTICE_EDIT',
      targetType: 'PLATFORM_BROADCAST',
      targetId: id,
      details: { changed: Object.keys(parsed.value) },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        title: next.title ?? '',
        message: next.message ?? '',
        severity: next.severity ?? 'info',
        active: next.active !== false,
        expiresAt: next.expiresAt ?? null,
      },
      message: 'Notice updated',
    });
  } catch (error: any) {
    console.error('[UPDATE NOTICE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to update notice', code: 'NOTICE_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}

/**
 * Retract a broadcast. The content row is removed, but a durable
 * BROADCAST_NOTICE_RETRACTED record captures exactly what was withdrawn and who
 * withdrew it — deleting the only trace of a public announcement would leave
 * the retraction itself unprovable.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuthUser(request);
    requireSuperAdmin(user);
    const { id } = await params;

    const existing = await loadNotice(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, message: 'Notice not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const details = (existing.details as Record<string, unknown>) || {};
    const db = getDb();
    await withDbRetry(() =>
      db.delete(superAdminActionLog).where(eq(superAdminActionLog.id, id))
    );

    await logSuperAdminAction({
      context: {
        adminUserId: user.id || null,
        adminEmail: user.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'BROADCAST_NOTICE_RETRACTED',
      targetType: 'PLATFORM_BROADCAST',
      targetId: id,
      details: {
        title: details.title ?? null,
        severity: details.severity ?? null,
        retractedAt: new Date().toISOString(),
        originallyPostedBy: existing.adminEmail,
        originallyPostedAt:
          existing.createdAt instanceof Date ? existing.createdAt.toISOString() : null,
      },
    });

    return NextResponse.json({ success: true, message: 'Notice retracted' });
  } catch (error: any) {
    console.error('[DELETE NOTICE ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to retract notice', code: 'NOTICE_DELETE_FAILED' },
      { status: 500 }
    );
  }
}
