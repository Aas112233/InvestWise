import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members, systemSettings } from '@/db/schema/index';
import { normalizePaymentMethods, isAllowedDepositMethod } from '@/lib/payment-methods';
import { DEPOSIT_FUND_REQUIRED_MESSAGE, DEPOSIT_REQUEST_CATEGORY, isDepositFund } from '@/lib/deposit-fund';
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
import {
  findDepositMonthOccupant,
  findDepositMonthOccupants,
  depositMonthConflictMessage,
} from '@/lib/deposit-month-limit';
import { resolveDepositScheduleDetailed } from '@/lib/deposit-schedule/schedule';
import { and, eq, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';
import crypto from 'node:crypto';
import { apiError } from '@/lib/utils/api-error';

// Screen permissions: shared RBAC evaluator (lib/permissions.ts).
// Batch ceiling — one pending request per row, all inserted in a single
// transaction so a partial batch can never half-submit.
const MAX_BATCH = 100;

// Bulk sibling of POST /api/deposits/request. Same contract per row (PENDING
// slip awaiting approval — never a direct, balance-moving deposit), submitted
// as one batch: common fund + deposit month + payment method, per-row member,
// amount and TRX ID. All validation mirrors the single-request route (§6 —
// never trust client input; every row is checked server-side).
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
    const { fundId, depositMethod, depositMonth, deposits } = body;

    if (!fundId) {
      throw new ValidationError('fundId is required');
    }
    if (!Array.isArray(deposits) || deposits.length === 0) {
      throw new ValidationError('At least one deposit request row is required');
    }
    if (deposits.length > MAX_BATCH) {
      throw new ValidationError(`A batch may contain at most ${MAX_BATCH} deposit requests`);
    }

    // Deposit month (YYYY-MM): the month the payments are FOR — same optional
    // contract as the single-request route; approval falls back to the request
    // date when absent.
    let depositMonthKey: string | null = null;
    if (depositMonth !== undefined && depositMonth !== null && depositMonth !== '') {
      if (typeof depositMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth)) {
        throw new ValidationError("[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format");
      }
      depositMonthKey = depositMonth;
    }
    // Effective month the whole batch is FOR: the explicit selection, or the
    // request-date month the approval falls back to. The one-per-month rule
    // is enforced against this key so a month-less client cannot sidestep it.
    const effectiveMonthKey = depositMonthKey ?? new Date().toISOString().slice(0, 7);

    // Per-row validation with the single route's amount semantics (integer
    // cents, 2dp ceiling, positive). Errors name the row so the user can fix
    // exactly the offending entry.
    const rows = deposits.map((row: any, i: number) => {
      const rowNo = i + 1;
      const memberId = typeof row?.memberId === 'string' ? row.memberId : '';
      const trxId = typeof row?.trxId === 'string' ? row.trxId.trim() : '';
      const rawAmount = String(row?.amount ?? '');
      if (!memberId) {
        throw new ValidationError(`Row ${rowNo}: memberId is required`);
      }
      if (!trxId) {
        throw new ValidationError(`Row ${rowNo}: TRX ID is required`);
      }
      if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
        const numeric = Number(rawAmount);
        if (Number.isFinite(numeric) && numeric > 0) {
          throw new ValidationError(`Row ${rowNo}: Amount must have at most 2 decimal places`);
        }
        throw new ValidationError(`Row ${rowNo}: Deposit amount must be a positive number`);
      }
      let amountCents: number;
      try {
        amountCents = toCents(rawAmount);
      } catch {
        throw new ValidationError(`Row ${rowNo}: Deposit amount must be a positive number`);
      }
      if (amountCents <= 0) {
        throw new ValidationError(`Row ${rowNo}: Deposit amount must be a positive number`);
      }
      return { memberId, trxId, amount: fromCents(amountCents) };
    });

    // The within-batch duplicate guard lives AFTER the member rows are read, so
    // it can be skipped for flexible members (multiple deposits per month are
    // legitimate for them). See `seenBatchMembers` below the member lookup.
    const db = getDb();
    const now = new Date();
    // Unique reference per request (same shape as the single route).
    const prepared = rows.map((r) => ({
      ...r,
      referenceNumber: `DEP-REQ-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    }));

    // Reference/member/fund lookups are independent — one round-trip group.
    // Members are fetched once for the whole batch (tenant-scoped) and matched
    // locally.
    const [[fund], [pmSettings], memberRows] = await Promise.all([
      db
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .limit(1),
      db
        .select({
          paymentMethods: systemSettings.paymentMethods,
          depositSchedule: systemSettings.depositSchedule,
        })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1),
      db
        .select({ id: members.id, status: members.status, name: members.name, depositFrequency: members.depositFrequency })
        .from(members)
        .where(
          and(
            inArray(members.id, [...new Set(prepared.map((r) => r.memberId))]),
            eq(members.tenantId, scopedTenantId),
          ),
        ),
      // The month-occupancy check is per-member and needs the member rows, so it
      // runs below rather than in this group. It was only ever a fast path — the
      // authoritative check is the in-transaction one, under the member locks.
    ]);

    if (!fund) {
      throw new NotFoundError('Fund');
    }
    // Same rule as the single request form: member money lands in the deposit
    // container, never in a PROJECT / RESERVE fund.
    if (!isDepositFund(fund)) {
      throw new ValidationError(DEPOSIT_FUND_REQUIRED_MESSAGE);
    }
    if (fund.status !== 'ACTIVE') {
      throw new ValidationError('Fund is not active');
    }

    const memberById = new Map(memberRows.map((m) => [m.id, m]));
    prepared.forEach((r, i) => {
      const member = memberById.get(r.memberId);
      if (!member) {
        throw new NotFoundError(`Member (row ${i + 1})`);
      }
      if (member.status !== 'active') {
        throw new ValidationError(`Member is not active (row ${i + 1})`);
      }
    });

    /**
     * Per-member schedule. A batch can MIX monthly and flexible members (tenant
     * default plus a member-level cadence), so enforcement is partitioned per
     * member rather than applied to the batch as a whole: a flexible member must
     * not inherit a monthly restriction, and a monthly member must not inherit a
     * flexible exemption.
     */
    const distinctMemberIds = [...new Set(prepared.map((r) => r.memberId))];
    const enforcedSet = new Set(
      distinctMemberIds.filter((id) => resolveDepositScheduleDetailed({
        tenantSchedule: pmSettings?.depositSchedule ?? null,
        memberDepositFrequency: memberById.get(id)?.depositFrequency ?? null,
      }).enforced),
    );

    // Within-batch guard (§12), MONTHLY members only: the whole batch shares one
    // effective month, so two rows for the same member would create two requests
    // for that month. The in-transaction re-check cannot see rows inserted later
    // in the same tx (one insert statement), so this set is the only guard.
    const seenBatchMembers = new Set<string>();
    rows.forEach((r, i) => {
      if (!enforcedSet.has(r.memberId)) return;
      if (seenBatchMembers.has(r.memberId)) {
        throw new ValidationError(
          `Row ${i + 1}: this member already has a deposit request for ${effectiveMonthKey} in this batch. Only one deposit per member per month is allowed.`,
        );
      }
      seenBatchMembers.add(r.memberId);
    });

    // One deposit per member per month (§12), MONTHLY members only: fail the batch
    // naming the first offending row — approving any of these requests would
    // double-count the member's contribution for the month.
    const monthOccupants = enforcedSet.size === 0
      ? []
      : await findDepositMonthOccupants(db, {
          tenantId: scopedTenantId,
          memberIds: [...enforcedSet],
          depositMonthKey: effectiveMonthKey,
        });
    const occupantByMember = new Map(monthOccupants.map((o) => [o.memberId, o]));
    rows.forEach((r, i) => {
      const occupant = occupantByMember.get(r.memberId);
      if (occupant) {
        throw new ValidationError(`Row ${i + 1}: ${depositMonthConflictMessage(effectiveMonthKey, occupant)}`);
      }
    });

    // Payment method must be one this tenant configured (Settings →
    // Governance), a legacy/internal value, or absent — same rule as the
    // single-request route.
    if (!isAllowedDepositMethod(depositMethod ?? null, normalizePaymentMethods(pmSettings?.paymentMethods))) {
      throw new ValidationError("[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first");
    }

    // Duplicate reference check (idempotency, tenant-scoped) — batched over
    // the whole batch.
    const [existing] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          inArray(transactions.referenceNumber, prepared.map((r) => r.referenceNumber)),
          eq(transactions.isDeleted, false),
          eq(transactions.tenantId, scopedTenantId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ValidationError('Transaction with this reference number already exists');
    }

    // All-or-nothing insert of pending deposit requests (tenant is mandatory —
    // never insert a NULL-tenant orphan row that no tenant filter can see).
    await db.transaction(async (tx) => {
      // Lock every distinct member row so concurrent batches touching the
      // same members serialize, then re-check each member's month under the
      // locks (the outer fast-path races). The within-batch duplicate set
      // above covers rows this tx cannot yet see.
      await tx
        .select({ id: members.id })
        .from(members)
        .where(and(inArray(members.id, distinctMemberIds), eq(members.tenantId, scopedTenantId)))
        .for('update');

      // Authoritative re-check under the member locks — MONTHLY members only.
      // Flexible members reserve no month, so they are excluded from the query
      // entirely rather than relying on the guard to forgive them.
      const occupants = enforcedSet.size === 0
        ? []
        : await findDepositMonthOccupants(tx, {
            tenantId: scopedTenantId,
            memberIds: [...enforcedSet],
            depositMonthKey: effectiveMonthKey,
          });
      if (occupants.length > 0) {
        const occupantByMember = new Map(occupants.map((o) => [o.memberId, o]));
        for (const [i, r] of prepared.entries()) {
          const occupant = occupantByMember.get(r.memberId);
          if (occupant) {
            throw new ValidationError(`Row ${i + 1}: ${depositMonthConflictMessage(effectiveMonthKey, occupant)}`);
          }
        }
      }

      // Same guard as the single-request route: a bulk batch filed against a
      // closed fiscal year used to be accepted and then refused row-by-row at
      // approval, so an entire spreadsheet of proof could sit in the queue for
      // days before anyone found out none of it could ever be posted. Asserted
      // inside the transaction, on the 15th at midday so no tenant timezone can
      // roll it into a neighbouring month.
      await assertFiscalPeriodOpen(tx, scopedTenantId, new Date(`${effectiveMonthKey}-15T12:00:00`));

      await tx.insert(transactions).values(
        prepared.map((r) => ({
          tenantId: scopedTenantId,
          type: 'Deposit',
          amount: r.amount,
          // TRX id + proof travel in `notes`, same as the single request route
          // (the request contract carries no dedicated proof fields).
          description: `TRX ID: ${r.trxId}`,
          category: DEPOSIT_REQUEST_CATEGORY,
          referenceNumber: r.referenceNumber,
          date: now,
          status: 'PENDING',
          memberId: r.memberId,
          fundId: fundId,
          handlingOfficer: user.name,
          depositMethod: depositMethod || null,
          depositMonth: depositMonthKey,
          authorizedBy: user.id,
          balanceBefore: fund.balance,
          balanceAfter: fund.balance, // Balance unchanged for pending
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    });

    // One audit entry per request (same granularity as the single route).
    await Promise.all(
      prepared.map((r) =>
        logAudit({
          user: { id: user.id, name: user.name },
          tenantId,
          action: 'REQUEST_DEPOSIT',
          resourceType: 'Transaction',
          resourceId: r.referenceNumber,
          details: {
            memberId: r.memberId,
            memberName: memberById.get(r.memberId)?.name ?? null,
            fundId: fund.id,
            fundName: fund.name,
            amount: r.amount,
            depositMethod: depositMethod || null,
            depositMonth: depositMonthKey,
            notes: `TRX ID: ${r.trxId}`,
            bulk: true,
          },
        }),
      ),
    );

    return NextResponse.json({
      success: true,
      data: {
        count: prepared.length,
        status: 'PENDING',
        references: prepared.map((r) => r.referenceNumber),
      },
      message: `${prepared.length} deposit request(s) submitted successfully. Awaiting approval.`,
    });
  } catch (err: any) {
    console.error('[DEPOSIT REQUEST BULK ERROR]', err);
    return apiError(err, 'Failed to submit deposit requests');
  }
}
