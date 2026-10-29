import { apiError } from '@/lib/utils/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members, systemSettings } from '@/db/schema/index';
import { normalizePaymentMethods, isAllowedDepositMethod } from '@/lib/payment-methods';
import { DEPOSIT_FUND_REQUIRED_MESSAGE, DEPOSIT_REQUEST_CATEGORY, isDepositFund } from '@/lib/deposit-fund';
import { findDepositMonthOccupant, depositMonthConflictMessage } from '@/lib/deposit-month-limit';
import { resolveDepositScheduleDetailed } from '@/lib/deposit-schedule/schedule';
import { eq, and, sql } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents, MAX_AMOUNT } from '@/lib/money';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import crypto from 'node:crypto';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: deposit requests move money — null tenant must 403 so the
    // member/fund lookups below can never run unscoped.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check write permission for REQUEST_DEPOSIT
    if (!hasScreenPermission(user, 'REQUEST_DEPOSIT', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: REQUEST_DEPOSIT');
    }

    const body = await readJsonBody(request);
    const {
      memberId,
      fundId,
      amount,
      depositMethod,
      notes,
      depositMonth,
    } = body;

    // Validate required fields
    if (!memberId || !fundId) {
      throw new ValidationError('memberId and fundId are required');
    }

    // Deposit month (YYYY-MM): the month the payment is FOR, chosen in the
    // request form. Validation is server-side, never trusted (§6); optional
    // so older clients and scripts stay working — approval falls back to the
    // request date when absent.
    let depositMonthKey: string | null = null;
    if (depositMonth !== undefined && depositMonth !== null && depositMonth !== "") {
      if (typeof depositMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth)) {
        throw new ValidationError("[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format");
      }
      depositMonthKey = depositMonth;
    }
    // Effective month this request will occupy: the explicit selection, or
    // the request-date month the approval falls back to. The one-per-month
    // rule is enforced against this key so a month-less client cannot
    // sidestep it.
    const effectiveMonthKey = depositMonthKey ?? new Date().toISOString().slice(0, 7);

    // Integer-cents parsing (§12 — never parseFloat float math on money).
    // Legacy message precedence is preserved: a clean decimal(15,2) literal
    // parses exactly in cents; anything else keeps the old split between
    // "positive number" (non-numeric / zero / negative) and "2 decimal
    // places" (numeric but over-precise, e.g. 1.999 or 1e3).
    let amountCents: number | null = null;
    if (/^\d+(\.\d{1,2})?$/.test(String(amount ?? ''))) {
      try {
        amountCents = toCents(String(amount));
      } catch {
        amountCents = null;
      }
    }
    if (amountCents === null || amountCents <= 0) {
      const numeric = Number(amount);
      if (Number.isFinite(numeric) && numeric > 0) {
        throw new ValidationError('Amount must have at most 2 decimal places');
      }
      throw new ValidationError('Deposit amount must be a positive number');
    }

    // Same ceiling as POST /api/deposits. Approval copies the requested amount
    // onto the settled Deposit row without re-checking it, so without this a
    // request above the module maximum could be approved into the ledger while
    // the identical amount entered directly is refused.
    if (amountCents > MAX_AMOUNT * 100) {
      throw new ValidationError(
        `[Field 'amount', Code: too_big] Deposit amount may not exceed ${fromCents(MAX_AMOUNT * 100)}`,
      );
    }

    const formattedAmount = fromCents(amountCents);
    const refNumber = `DEP-REQ-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const db = getDb();

    // Reference/member/fund lookups are independent of each other (all keyed
    // off the request payload) — batch them into one round-trip group instead
    // of three sequential ones. Error checks below preserve the original
    // precedence (duplicate ref → missing member → missing fund → month
    // already taken).
    const [existingDeposit, [member], [fund], [pmSettings]] = await Promise.all([
      // Duplicate reference number check (idempotency, tenant-scoped so one
      // tenant cannot squat or probe another tenant's reference).
      db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.referenceNumber, refNumber),
            eq(transactions.isDeleted, false),
            eq(transactions.tenantId, scopedTenantId),
          ),
        )
        .limit(1),
      // Member with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .limit(1),
      // Fund with tenant isolation (§6 hard predicate).
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      // Tenant-configured payment methods + deposit schedule — validates
      // depositMethod and resolves the one-deposit-per-month rule below.
      db
        .select({
          paymentMethods: systemSettings.paymentMethods,
          depositSchedule: systemSettings.depositSchedule,
        })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1),
      // The month-occupancy check needs the member row resolved first, so it runs
      // just below. It was only ever a fast path — the authoritative check is the
      // in-transaction one, under the member FOR UPDATE lock.
    ]);

    if (existingDeposit.length > 0) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    if (!member) {
      throw new NotFoundError('Member');
    }

    if (!fund) {
      throw new NotFoundError('Fund');
    }

    // Check if member is active
    if (member.status !== 'active') {
      throw new ValidationError('Member is not active');
    }

    // A deposit request funds the member's deposit container — a PROJECT or
    // RESERVE fund would book member money as that container's own.
    if (!isDepositFund(fund)) {
      throw new ValidationError(DEPOSIT_FUND_REQUIRED_MESSAGE);
    }

    // Check if fund is active
    if (fund.status !== 'ACTIVE') {
      throw new ValidationError('Fund is not active');
    }

    // Deposit schedule for this member: 'monthly' reserves the month, 'flexible'
    // does not. Resolved from rows already fetched — no extra query.
    const depositSchedule = resolveDepositScheduleDetailed({
      tenantSchedule: pmSettings?.depositSchedule ?? null,
      memberDepositFrequency: member.depositFrequency ?? null,
    });

    // One deposit per member per month (§12) — MONTHLY ONLY. The member already
    // deposited for, or has a pending request for, the month this request is FOR —
    // approving a second one would double-count their contribution. Free the month
    // first: reject/approve the pending request or revert the settled deposit.
    if (depositSchedule.enforced) {
      const monthOccupant = await findDepositMonthOccupant(db, {
        tenantId: scopedTenantId,
        memberId,
        depositMonthKey: effectiveMonthKey,
      });
      if (monthOccupant) {
        throw new ValidationError(depositMonthConflictMessage(effectiveMonthKey, monthOccupant));
      }
    }

    // Payment method must be one this tenant configured (Settings →
    // Governance), a legacy/internal value, or absent. The old fixed DB
    // CHECK rejected half the picker's vocabulary — validation moved to the
    // tenant's own list, not a constant.
    if (!isAllowedDepositMethod(depositMethod ?? null, normalizePaymentMethods(pmSettings?.paymentMethods))) {
      throw new ValidationError("[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first");
    }

    const now = new Date();

    // Create pending deposit request transaction (tenant is mandatory — never
    // insert a NULL-tenant orphan row that no tenant filter can see).
    await db.transaction(async (tx) => {
      // Lock the member row so two concurrent requests for the same member
      // serialize, then re-check the month under that lock (the outer
      // fast-path races). Same locking discipline as the direct-deposit
      // route — the lock makes this check authoritative.
      const [lockedMember] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedMember) throw new NotFoundError('Member');

      // Asserted inside the transaction, mirroring POST /api/deposits (:477).
      // This route had no fiscal guard at all while the APPROVE path does, so a
      // member could file against a closed fiscal year, sit in the queue for
      // review, and only then be refused — the officer's time and the member's
      // payment proof both wasted. Checked against the month the request is FOR
      // (the period the money will occupy) rather than the filing date, so a
      // back-dated request into a still-open month keeps working. The 15th at
      // midday is deliberate: it can never roll into a neighbouring month under
      // any tenant timezone.
      await assertFiscalPeriodOpen(tx, scopedTenantId, new Date(`${effectiveMonthKey}-15T12:00:00`));

      const monthOccupant = await findDepositMonthOccupant(tx, {
        tenantId: scopedTenantId,
        memberId,
        depositMonthKey: effectiveMonthKey,
        // Flexible members reserve no month — the guard returns null without
        // querying. Monthly keeps the authoritative lock-protected check.
        enforced: depositSchedule.enforced,
      });
      if (monthOccupant) {
        throw new ValidationError(depositMonthConflictMessage(effectiveMonthKey, monthOccupant));
      }

      await tx.insert(transactions).values({
        tenantId: scopedTenantId,
        type: 'Deposit',
        amount: formattedAmount,
        description: notes || 'Member deposit request',
        category: DEPOSIT_REQUEST_CATEGORY,
        referenceNumber: refNumber,
        date: now,
        status: 'PENDING',
        memberId: memberId,
        fundId: fundId,
        handlingOfficer: user.name,
        depositMethod: depositMethod || null,
        depositMonth: depositMonthKey,
        authorizedBy: user.id,
        balanceBefore: fund.balance,
        balanceAfter: fund.balance, // Balance unchanged for pending
        createdBy: user.id,
        updatedBy: user.id,
      });
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
      action: 'REQUEST_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: formattedAmount,
        depositMethod: depositMethod || null,
        depositMonth: depositMonthKey,
        notes: notes || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        member: { id: member.id, name: member.name },
        fund: { id: fund.id, name: fund.name },
        amount: formattedAmount,
        status: 'PENDING',
        date: now.toISOString(),
      },
      message: 'Deposit request submitted successfully. Awaiting approval.',
    });
  } catch (err: any) {
    console.error('[DEPOSIT REQUEST ERROR]', err);
    return apiError(err, 'Failed to submit deposit request');
  }
}