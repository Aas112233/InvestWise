import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, withDbRetry } from '@/db/index';
import { platformSettings, PLATFORM_SETTINGS_ID } from '@/db/schema/index';
import { eq } from 'drizzle-orm';
import { AuthError, ForbiddenError } from '@/lib/utils/errors';
import { requireAuthUser, requireSuperAdmin } from '@/lib/admin-guard';
import { getClientIp } from '@/lib/request-meta';
import { logSuperAdminAction } from '@/lib/superadmin-service';

const settingsUpdateSchema = z
  .object({
    platformName: z.string().trim().min(1).max(120).optional(),
    supportEmail: z
      .string()
      .trim()
      .email("[Field 'supportEmail', Code: invalid_email] Enter a valid email address")
      .max(255)
      .optional(),
    supportPhone: z.string().trim().max(40).optional(),
    defaultTrialDays: z
      .number()
      .int()
      .min(1, 'Trial length must be at least 1 day')
      .max(365, 'Trial length must be at most 365 days')
      .optional(),
    defaultCurrency: z
      .string()
      .trim()
      .length(3, 'Currency must be a 3-letter code')
      .regex(/^[A-Za-z]{3}$/, 'Currency must be a 3-letter code')
      .optional(),
    defaultTimezone: z.string().trim().min(1).max(60).optional(),
    allowPublicRegistration: z.boolean().optional(),
    globalMaintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one setting must be provided',
  });

function fieldError(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || 'body';
  return {
    success: false,
    message: `[Field '${field}', Code: ${issue?.code || 'invalid_type'}] ${issue?.message || 'Invalid input'}`,
    code: 'VALIDATION_ERROR',
  };
}

export async function GET(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const db = getDb();
    let [row] = await withDbRetry(() =>
      db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
        .limit(1)
    );

    // Self-heal: migration 0003 seeds the row, but a database restored from a
    // dump taken before it would otherwise 404 the whole settings screen.
    if (!row) {
      [row] = await withDbRetry(() =>
        db
          .insert(platformSettings)
          .values({ id: PLATFORM_SETTINGS_ID })
          .returning()
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...row,
        updatedAt: row!.updatedAt instanceof Date ? row!.updatedAt.toISOString() : '',
      },
    });
  } catch (error: unknown) {
    console.error('[PLATFORM SETTINGS GET ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to load platform settings', code: 'SETTINGS_FAILED' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const platformUser = await requireAuthUser(request);
    requireSuperAdmin(platformUser);

    const parsed = settingsUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(fieldError(parsed.error), { status: 400 });
    }
    const patch = parsed.data;

    if (patch.globalMaintenanceMode === true && !patch.maintenanceMessage?.trim()) {
      // Turning the platform dark with no explanation strands every user.
      return NextResponse.json(
        {
          success: false,
          message:
            "[Field 'maintenanceMessage', Code: required] A message is required while platform maintenance is on",
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const db = getDb();
    const [before] = await withDbRetry(() =>
      db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
        .limit(1)
    );

    const [row] = await withDbRetry(() =>
      db
        .insert(platformSettings)
        .values({ id: PLATFORM_SETTINGS_ID, ...patch, updatedAt: new Date() })
        .onConflictDoUpdate({ target: platformSettings.id, set: { ...patch, updatedAt: new Date() } })
        .returning()
    );

    await logSuperAdminAction({
      context: {
        adminUserId: platformUser.id,
        adminEmail: platformUser.email,
        ipAddress: getClientIp(request),
      },
      actionType: 'PLATFORM_SETTINGS_UPDATE',
      targetType: 'Platform',
      targetId: String(PLATFORM_SETTINGS_ID),
      details: {
        changed: Object.keys(patch),
        from: Object.fromEntries(
          Object.keys(patch).map((k) => [
            k,
            (before as Record<string, unknown> | undefined)?.[k] ?? null,
          ])
        ),
        to: patch,
      },
    });

    return NextResponse.json({
      success: true,
      data: { ...row, updatedAt: row!.updatedAt instanceof Date ? row!.updatedAt.toISOString() : '' },
      message: 'Platform settings saved',
    });
  } catch (error: unknown) {
    console.error('[PLATFORM SETTINGS PATCH ERROR]', error);
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      const e = error as { message: string; code?: string; statusCode?: number };
      return NextResponse.json(
        { success: false, message: e.message, code: e.code },
        { status: e.statusCode ?? 403 }
      );
    }
    return NextResponse.json(
      { success: false, message: 'Failed to save platform settings', code: 'SETTINGS_SAVE_FAILED' },
      { status: 500 }
    );
  }
}
