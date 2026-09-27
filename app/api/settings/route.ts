import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { systemSettings, transactions } from '@/db/schema/index';
import { eq, count } from 'drizzle-orm';
import { getAuthContext, type AuthenticatedUser } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError, LockedError } from '@/lib/utils/errors';
import { updateSettingsSchema, UpdateSettingsInput } from '@/lib/utils/validation';

const SETTINGS_CACHE_KEY = 'settings:singleton';
const SETTINGS_CACHE_TTL = 5 * 60_000; // 5 minutes
const settingsCache = new Map<string, { data: any; expiresAt: number }>();

function formatSettingsResponse(settings: any): Record<string, unknown> {
  if (!settings) return {};
  return {
    ...settings,
    organization: {
      companyName: settings.companyName || 'InvestWise',
      companyTagline: settings.companyTagline || 'Enterprise Investment Management',
      companyAddress: settings.companyAddress || '',
      companyEmail: settings.companyEmail || '',
      companyPhone: settings.companyPhone || '',
      companyWebsite: settings.companyWebsite || '',
      companyRegNo: settings.companyRegNo || '',
    },
    financial: {
      fiscalYearStart: settings.fiscalYearStart || 'July',
      fiscalYearEnd: settings.fiscalYearEnd || 'June',
      baseCurrency: settings.baseCurrency || '',
      taxRate: Number(settings.taxRate || 15.0),
      accountingMethod: settings.accountingMethod || 'Cash',
      shareValueBdt: Number(settings.shareValueBdt || 1000),
      isShareValueLocked: Boolean(settings.isShareValueLocked),
      withdrawalLimitPercent: Number(settings.withdrawalLimitPercent || 25),
      withdrawalNoticeDays: Number(settings.withdrawalNoticeDays || 30),
      maxWithdrawalPerRequest: Number(settings.maxWithdrawalPerRequest || 100000),
      statutoryReservePercent: Number(settings.statutoryReservePercent || 10),
      lastFiscalCloseDate: settings.lastFiscalCloseDate,
    },
    governance: {
      monthlyMeetingDay: settings.monthlyMeetingDay || 5,
      depositDueDate: settings.depositDueDate || 10,
      gracePeriodDays: settings.gracePeriodDays || 3,
      meetingTypes: settings.meetingTypes,
      penaltyRules: settings.penaltyRules,
    },
    system: {
      language: settings.language || 'English',
      refreshInterval: settings.refreshInterval || 'Real-time',
      theme: settings.theme || 'System Default',
      dateFormat: settings.dateFormat || 'DD/MM/YYYY',
      isMaintenanceMode: Boolean(settings.isMaintenanceMode),
    },
  };
}

async function checkAndAutoLockShareValue() {
  const db = getDb();
  const [settings] = await db
    .select({ id: systemSettings.id, isShareValueLocked: systemSettings.isShareValueLocked })
    .from(systemSettings)
    .limit(1);

  if (!settings || settings.isShareValueLocked) return;

  const [txResult] = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.isDeleted, false));

  if (Number(txResult?.count ?? 0) > 0) {
    await db
      .update(systemSettings)
      .set({ isShareValueLocked: true, updatedAt: new Date() })
      .where(eq(systemSettings.id, settings.id));
  }
}

function hasSettingsWritePermission(user: AuthenticatedUser): boolean {
  const role = normalizeRole(user.role);
  const userPermissions = user.permissions ?? {};

  if (role === 'SuperAdmin' || role === 'Admin') {
    return true;
  }
  const explicit = userPermissions?.['SETTINGS'];
  if (explicit === 'WRITE') return true;
  if (explicit === 'NONE') return false;
  return false; // Managers and below cannot write SETTINGS
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Check cache
    const cached = settingsCache.get(SETTINGS_CACHE_KEY);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    // Auto-lock share value if transactions exist
    await checkAndAutoLockShareValue();

    const db = getDb();
    const [settings] = await db.select().from(systemSettings).limit(1);

    let responseData: Record<string, unknown>;
    if (!settings) {
      const [created] = await db.insert(systemSettings).values({}).returning();
      responseData = formatSettingsResponse(created);
    } else {
      responseData = formatSettingsResponse(settings);
    }

    // Cache the response
    settingsCache.set(SETTINGS_CACHE_KEY, {
      data: responseData,
      expiresAt: Date.now() + SETTINGS_CACHE_TTL,
    });

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('[GET SETTINGS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to get settings', code: 'SETTINGS_FAILED' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Check WRITE permission for SETTINGS
    if (!hasSettingsWritePermission(user)) {
      throw new ForbiddenError('Write permission required for: SETTINGS');
    }

    const body = await request.json();
    
    // Validate input
    const validation = updateSettingsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Validation failed', 
          code: 'VALIDATION_ERROR',
          details: validation.error.flatten().fieldErrors 
        },
        { status: 400 }
      );
    }

    const data: UpdateSettingsInput = validation.data;
    const db = getDb();

    let current = (await db.select().from(systemSettings).limit(1))[0];
    if (!current) {
      const [inserted] = await db.insert(systemSettings).values({}).returning();
      current = inserted;
    }
    
    // current is guaranteed to exist at this point
    const currentSettings = current!;

    const updateData: Record<string, unknown> = {};

    // Flatten organization group
    if (data.organization) {
      if (data.organization.companyName !== undefined) {
        updateData.companyName = data.organization.companyName;
      }
      if (data.organization.companyTagline !== undefined) {
        updateData.companyTagline = data.organization.companyTagline;
      }
      if (data.organization.companyAddress !== undefined) {
        updateData.companyAddress = data.organization.companyAddress;
      }
      if (data.organization.companyEmail !== undefined) {
        updateData.companyEmail = data.organization.companyEmail;
      }
      if (data.organization.companyPhone !== undefined) {
        updateData.companyPhone = data.organization.companyPhone;
      }
      if (data.organization.companyWebsite !== undefined) {
        updateData.companyWebsite = data.organization.companyWebsite;
      }
      if (data.organization.companyRegNo !== undefined) {
        updateData.companyRegNo = data.organization.companyRegNo;
      }
    }

    // Flatten financial group
    if (data.financial) {
      if (data.financial.fiscalYearStart !== undefined) {
        updateData.fiscalYearStart = data.financial.fiscalYearStart;
      }
      if (data.financial.baseCurrency !== undefined) {
        updateData.baseCurrency = data.financial.baseCurrency;
      }
      if (data.financial.taxRate !== undefined) {
        updateData.taxRate = String(data.financial.taxRate);
      }
      if (data.financial.accountingMethod !== undefined) {
        updateData.accountingMethod = data.financial.accountingMethod;
      }
      if (data.financial.shareValueBdt !== undefined) {
        if (currentSettings.isShareValueLocked) {
          throw new LockedError('Share value is locked and cannot be changed');
        }
        updateData.shareValueBdt = String(data.financial.shareValueBdt);
      }
      if (data.financial.isShareValueLocked !== undefined) {
        updateData.isShareValueLocked = data.financial.isShareValueLocked;
      }
      if (data.financial.withdrawalLimitPercent !== undefined) {
        updateData.withdrawalLimitPercent = String(data.financial.withdrawalLimitPercent);
      }
      if (data.financial.withdrawalNoticeDays !== undefined) {
        updateData.withdrawalNoticeDays = data.financial.withdrawalNoticeDays;
      }
      if (data.financial.maxWithdrawalPerRequest !== undefined) {
        updateData.maxWithdrawalPerRequest = String(data.financial.maxWithdrawalPerRequest);
      }
      if (data.financial.statutoryReservePercent !== undefined) {
        updateData.statutoryReservePercent = String(data.financial.statutoryReservePercent);
      }
      if (data.financial.fiscalYearEnd !== undefined) {
        updateData.fiscalYearEnd = data.financial.fiscalYearEnd;
      }
    }

    // Flatten system group
    if (data.system) {
      if (data.system.language !== undefined) {
        updateData.language = data.system.language;
      }
      if (data.system.refreshInterval !== undefined) {
        updateData.refreshInterval = data.system.refreshInterval;
      }
      if (data.system.theme !== undefined) {
        updateData.theme = data.system.theme;
      }
      if (data.system.dateFormat !== undefined) {
        updateData.dateFormat = data.system.dateFormat;
      }
      if (data.system.isMaintenanceMode !== undefined) {
        updateData.isMaintenanceMode = data.system.isMaintenanceMode;
      }
    }

    // Flatten governance group
    if (data.governance) {
      if (data.governance.monthlyMeetingDay !== undefined) {
        updateData.monthlyMeetingDay = data.governance.monthlyMeetingDay;
      }
      if (data.governance.depositDueDate !== undefined) {
        updateData.depositDueDate = data.governance.depositDueDate;
      }
      if (data.governance.gracePeriodDays !== undefined) {
        updateData.gracePeriodDays = data.governance.gracePeriodDays;
      }
      if (data.governance.meetingTypes !== undefined) {
        updateData.meetingTypes = data.governance.meetingTypes;
      }
      if (data.governance.penaltyRules !== undefined) {
        updateData.penaltyRules = data.governance.penaltyRules;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(formatSettingsResponse(currentSettings));
    }

    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(systemSettings)
      .set(updateData)
      .where(eq(systemSettings.id, currentSettings.id))
      .returning();

    // Invalidate settings cache
    settingsCache.delete(SETTINGS_CACHE_KEY);

    return NextResponse.json(formatSettingsResponse(updated));
  } catch (error: any) {
    console.error('[UPDATE SETTINGS ERROR]', error);
    
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof LockedError) {
      return NextResponse.json(
        { success: false, message: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Failed to update settings', code: 'SETTINGS_UPDATE_FAILED' },
      { status: 500 }
    );
  }
}