import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { fiscalPeriods, members, systemSettings, transactions, DEFAULT_MEETING_TYPES, DEFAULT_PENALTY_RULES } from '@/db/schema/index';
import { MEMBER_STATUS_REASON } from '@/lib/governance/status-rules';
import { DEPOSIT_SCHEDULE } from '@/lib/deposit-schedule/schedule';
import { eq, and, count } from 'drizzle-orm';
import { getAuthContext, type AuthenticatedUser } from '@/lib/middleware/auth';
import { normalizeRole } from '@/lib/roles';
import { AuthError, ForbiddenError, LockedError, ValidationError, readJsonBody } from '@/lib/utils/errors';
import { updateSettingsSchema, UpdateSettingsInput } from '@/lib/utils/validation';
import { fiscalYearEndForStart } from '@/lib/fiscal-periods';
import { normalizePaymentMethods } from '@/lib/payment-methods';
import { logAudit } from '@/lib/utils/audit';
import { ensureShareValueLocked } from '@/lib/utils/share-value-lock';

const SETTINGS_CACHE_TTL = 5 * 60_000; // 5 minutes
// Cache is PER-TENANT — a shared singleton key leaked tenant A's settings
// (currency, share value, penalty rules) to tenant B.
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
      // Absent (pre-0025 row) is monthly: the write path fails closed the same way,
      // so the form must not show a blank or an implied 'flexible'.
      depositSchedule: settings.depositSchedule || 'monthly',
      depositScheduleChangedAt: settings.depositScheduleChangedAt ?? null,
      depositNearDuplicateWindowDays: settings.depositNearDuplicateWindowDays ?? 3,
      // null = the R2 approval threshold is disabled for this tenant.
      depositFlexApprovalAbove: settings.depositFlexApprovalAbove ?? null,
      lateDepositGraceMonths: settings.lateDepositGraceMonths ?? 1,
      inactiveAfterMonths: settings.inactiveAfterMonths ?? 3,
      suspendedAfterMonths: settings.suspendedAfterMonths ?? 6,
      meetingTypes: settings.meetingTypes && settings.meetingTypes.length > 0 ? settings.meetingTypes : DEFAULT_MEETING_TYPES,
      penaltyRules: settings.penaltyRules && settings.penaltyRules.length > 0 ? settings.penaltyRules : DEFAULT_PENALTY_RULES,
      // Tenant-configured payment methods for the deposit forms; normalizes
      // null/garbage jsonb to the platform defaults instead of shipping an
      // empty picker.
      paymentMethods: normalizePaymentMethods(settings.paymentMethods),
    },
    system: {
      language: settings.language || 'English',
      refreshInterval: settings.refreshInterval || 'Real-time',
      theme: settings.theme || 'Light',
      dateFormat: settings.dateFormat || 'DD/MM/YYYY',
      timezone: settings.timezone || 'Asia/Dhaka',
      isMaintenanceMode: Boolean(settings.isMaintenanceMode),
    },
  };
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
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    // §6: settings are one-row-per-tenant. No tenant context → no settings.
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    const cacheKey = `settings:${tenantId}`;

    // Check cache
    const cached = settingsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data);
    }

    const db = getDb();

    // Auto-lock share value if transactions exist (this tenant only). The
    // helper returns the fresh settings row, so no second read is needed.
    let settings = (await ensureShareValueLocked(tenantId, user)).settings;

    if (!settings) {
      const [created] = await db
        .insert(systemSettings)
        .values({ tenantId })
        .returning();
      if (!created) throw new Error('Failed to initialize tenant settings');
      settings = created;
    }

    const responseData = formatSettingsResponse(settings);

    // Cache the response
    settingsCache.set(cacheKey, {
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
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json(
        { success: false, message: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    if (!tenantId) throw new ForbiddenError('Tenant context required');

    // Check WRITE permission for SETTINGS
    if (!hasSettingsWritePermission(user)) {
      throw new ForbiddenError('Write permission required for: SETTINGS');
    }

    const body = await readJsonBody(request);
    
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

    let current = (
      await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, tenantId))
        .limit(1)
    )[0];
    if (!current) {
      const [inserted] = await db
        .insert(systemSettings)
        .values({ tenantId })
        .returning();
      current = inserted;
    }
    
    // current is guaranteed to exist at this point
    const currentSettings = current!;

    if (data.financial?.fiscalYearStart !== undefined || data.financial?.fiscalYearEnd !== undefined) {
      const nextStart = data.financial.fiscalYearStart ?? currentSettings.fiscalYearStart ?? 'July';
      const nextEnd = data.financial.fiscalYearEnd ?? currentSettings.fiscalYearEnd ?? 'June';
      // The merged pair must form a FULL 12-month fiscal year: end = the month
      // before start. A zod superRefine covers the both-present payload case,
      // but a single-field patch still combines with the STORED month here —
      // and a short span (Jan→Mar) is what turned Analysis into 12 bars over 3
      // months of data plus fake MISSED cells for months outside the year.
      if (fiscalYearEndForStart(nextStart) !== nextEnd) {
        throw new ValidationError('The fiscal year end month must be the month before the start month (a full 12-month year)');
      }
      const fiscalConfigChanged =
        nextStart !== (currentSettings.fiscalYearStart || 'July') ||
        nextEnd !== (currentSettings.fiscalYearEnd || 'June');
      if (fiscalConfigChanged) {
        const [existingPeriod] = await db
          .select({ id: fiscalPeriods.id })
          .from(fiscalPeriods)
          .where(eq(fiscalPeriods.tenantId, tenantId))
          .limit(1);
        if (existingPeriod) {
          throw new LockedError('Fiscal year start and end months cannot be changed once a fiscal period exists — they apply to newly created periods.');
        }
      }
    }

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
          throw new LockedError('Share value is locked because transactions already exist for this tenant — it derives from ledger history and cannot be changed.');
        }
        updateData.shareValueBdt = String(data.financial.shareValueBdt);
      }
      if (data.financial.isShareValueLocked !== undefined) {
        // §12 share-value lock: the flag derives from ledger history, so a
        // client can never write it back off once transactions exist (the
        // auto-lock on GET/POST would otherwise be silently reversible).
        // Unlocking is only meaningful with an empty ledger, where the next
        // transaction re-locks it.
        if (data.financial.isShareValueLocked === false) {
          const [txCount] = await db
            .select({ count: count() })
            .from(transactions)
            .where(and(eq(transactions.tenantId, tenantId), eq(transactions.isDeleted, false)));
          if (Number(txCount?.count ?? 0) > 0) {
            throw new ValidationError("[Field 'isShareValueLocked', Code: SHARE_VALUE_LOCKED] The share value lock derives from ledger history — transactions already exist for this tenant, so it cannot be unlocked");
          }
        }
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
      if (data.system.timezone !== undefined) {
        updateData.timezone = data.system.timezone;
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
      if (data.governance.lateDepositGraceMonths !== undefined) {
        updateData.lateDepositGraceMonths = data.governance.lateDepositGraceMonths;
      }
      if (data.governance.inactiveAfterMonths !== undefined) {
        updateData.inactiveAfterMonths = data.governance.inactiveAfterMonths;
      }
      if (data.governance.suspendedAfterMonths !== undefined) {
        updateData.suspendedAfterMonths = data.governance.suspendedAfterMonths;
      }
      if (data.governance.meetingTypes !== undefined) {
        updateData.meetingTypes = data.governance.meetingTypes;
      }
      if (data.governance.paymentMethods !== undefined) {
        updateData.paymentMethods = normalizePaymentMethods(data.governance.paymentMethods);
      }
      if (data.governance.penaltyRules !== undefined) {
        updateData.penaltyRules = data.governance.penaltyRules;
      }
      if (data.governance.depositSchedule !== undefined) {
        updateData.depositSchedule = data.governance.depositSchedule;
      }
      if (data.governance.depositNearDuplicateWindowDays !== undefined) {
        updateData.depositNearDuplicateWindowDays = data.governance.depositNearDuplicateWindowDays;
      }
      if (data.governance.depositFlexApprovalAbove !== undefined) {
        // Explicit null is meaningful: it DISABLES the threshold. Do not coalesce it.
        updateData.depositFlexApprovalAbove = data.governance.depositFlexApprovalAbove;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(formatSettingsResponse(currentSettings));
    }

    // The hold/suspend ordering invariant must hold on the MERGED row, not just
    // the incoming payload — a partial update that only moves one threshold can
    // otherwise invert the lifecycle.
    if (
      updateData.inactiveAfterMonths !== undefined ||
      updateData.suspendedAfterMonths !== undefined
    ) {
      const mergedInactive = Number(
        updateData.inactiveAfterMonths ?? currentSettings.inactiveAfterMonths ?? 3,
      );
      const mergedSuspended = Number(
        updateData.suspendedAfterMonths ?? currentSettings.suspendedAfterMonths ?? 6,
      );
      if (mergedSuspended <= mergedInactive) {
        return NextResponse.json(
          {
            success: false,
            message: `[Field 'suspendedAfterMonths', Code: INVALID_THRESHOLD_ORDER] Must be greater than inactiveAfterMonths (${mergedInactive}); received ${mergedSuspended}.`,
            code: 'VALIDATION_ERROR',
          },
          { status: 400 },
        );
      }
    }

    // ── Deposit schedule switch (spec §8, finding H3) ────────────────────────
    // The governance sweep skips non-monthly members BEFORE it can evaluate a
    // restore, so a member auto-held with statusReason = DEPOSIT_NON_COMPLIANCE
    // would stay inactive forever the moment the tenant went flexible: nothing
    // would ever restore them. The switch is therefore their release, and a status
    // change on real members must be acknowledged rather than fall out of saving a
    // settings form.
    const switchingToFlexible =
      updateData.depositSchedule === DEPOSIT_SCHEDULE.FLEXIBLE
      && (currentSettings.depositSchedule ?? 'monthly') !== DEPOSIT_SCHEDULE.FLEXIBLE;

    // Stamp the moment of an actual change, in either direction. Never backfilled
    // by the migration — a timestamp for a switch that did not happen would make
    // the audit trail lie.
    if (
      updateData.depositSchedule !== undefined
      && (currentSettings.depositSchedule ?? 'monthly') !== updateData.depositSchedule
    ) {
      updateData.depositScheduleChangedAt = new Date();
    }

    let heldForNonCompliance: Array<{ id: string; memberId: string; name: string }> = [];
    if (switchingToFlexible) {
      heldForNonCompliance = await db
        .select({ id: members.id, memberId: members.memberId, name: members.name })
        .from(members)
        .where(and(
          // §6 tenant scope; soft-deleted members are never revived.
          eq(members.tenantId, tenantId),
          eq(members.isDeleted, false),
          eq(members.statusReason, MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE),
        ))
        .orderBy(members.name);

      if (heldForNonCompliance.length > 0 && data.confirmDepositScheduleSwitch !== true) {
        return NextResponse.json(
          {
            success: false,
            code: 'DEPOSIT_SCHEDULE_SWITCH_CONFIRMATION_REQUIRED',
            message:
              `[Field 'depositSchedule', Code: SWITCH_CONFIRMATION_REQUIRED] `
              + `${heldForNonCompliance.length} member(s) are currently held for deposit `
              + `non-compliance. A flexible schedule stops evaluating that obligation, so `
              + `these holds will not be lifted automatically. Resubmit with `
              + `confirmDepositScheduleSwitch = true to switch and release them.`,
            data: {
              heldMemberCount: heldForNonCompliance.length,
              heldMembers: heldForNonCompliance,
            },
          },
          { status: 409 },
        );
      }
    }

    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(systemSettings)
      .set(updateData)
      .where(and(eq(systemSettings.id, currentSettings.id), eq(systemSettings.tenantId, tenantId)))
      .returning();

    // Invalidate settings cache
    settingsCache.delete(`settings:${tenantId}`);

    // Release the holds the switch has made unenforceable. Deliberately AFTER the
    // settings row commits: a settings write that failed must not leave members
    // released under a schedule that never took effect. Only rows carrying the
    // sweep's own reason are touched — an officer-set hold is left alone.
    if (switchingToFlexible && heldForNonCompliance.length > 0) {
      const released = await db
        .update(members)
        .set({ status: 'active', statusReason: null, updatedAt: new Date() })
        .where(and(
          eq(members.tenantId, tenantId),
          eq(members.isDeleted, false),
          eq(members.statusReason, MEMBER_STATUS_REASON.DEPOSIT_NON_COMPLIANCE),
        ))
        .returning({ id: members.id });

      await logAudit({
        tenantId,
        user: { id: user.id, name: user.name || user.email },
        action: 'UPDATE_SETTINGS',
        resourceType: 'MEMBER',
        // No single resource: this entry covers a set of releases, and the
        // affected ids are listed in `details`.
        details: {
          reason: 'DEPOSIT_SCHEDULE_SWITCH_TO_FLEXIBLE',
          releasedHoldCount: released.length,
          releasedMemberIds: released.map((r) => r.id),
        },
        status: 'SUCCESS',
      });
    }

    // Audit log — `logAudit` takes a nested `user` object; passing flat
    // userId/userName silently wrote the row with no actor recorded.
    // Zero extra queries: `currentSettings` is the row read for the merge
    // above; `updated` is the UPDATE's .returning().
    await logAudit({
      tenantId,
      user: { id: user.id, name: user.name || user.email },
      action: 'UPDATE_SETTINGS',
      resourceType: 'SYSTEM_SETTINGS',
      resourceId: updated?.id,
      details: {
        updatedFields: Object.keys(updateData),
      },
      before: currentSettings,
      after: updated,
      status: 'SUCCESS',
    });

    return NextResponse.json(formatSettingsResponse(updated));
  } catch (error: any) {
    console.error('[UPDATE SETTINGS ERROR]', error);
    
    // ValidationError is surfaced with its real §11 message — falling through
    // here would mask it as a generic 500 ("never a masked error", §11).
    if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof LockedError || error instanceof ValidationError) {
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