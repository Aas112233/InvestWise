import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members } from '@/db/schema/index';
import { eq, and, desc, sql, gte, lte, ilike, inArray } from 'drizzle-orm';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';
import crypto from 'node:crypto';

export async function GET(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: without tenant context every filter below would collapse
    // to an unscoped cross-tenant query. Platform operators use /api/admin.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check read permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'READ')) {
      throw new ForbiddenError('Read permission required for: DEPOSITS');
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;
    const memberId = searchParams.get('memberId');
    const fundId = searchParams.get('fundId');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    // Month filter: matches the month a deposit is FOR — the same value the
    // Month column renders (explicit form selection, collected-date fallback),
    // so filtering and display can never disagree. Takes precedence over the
    // raw collected-date range.
    const depositMonthParam = searchParams.get('depositMonth');
    const search = searchParams.get('search');

    const db = getDb();
    const conditions: ReturnType<typeof sql>[] = [];

    // Fail-closed tenant scope (AGENTS.md §6). scopedTenantId already 403s on
    // null via requireTenant above — the push below is unconditional.
    conditions.push(sql`${transactions.tenantId} = ${scopedTenantId}`);

    // Only deposit transactions
    conditions.push(sql`${transactions.type} = 'Deposit'`);

    // Soft delete filter
    conditions.push(sql`${transactions.isDeleted} = false`);

    if (memberId) {
      conditions.push(sql`${transactions.memberId} = ${memberId}`);
    }
    if (fundId) {
      conditions.push(sql`${transactions.fundId} = ${fundId}`);
    }
    if (status) {
      conditions.push(sql`${transactions.status} = ${status}`);
    }
    if (depositMonthParam) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonthParam)) {
        throw new ValidationError("[Field 'depositMonth', Code: invalid_string] Deposit month filter must be in YYYY-MM format");
      }
      conditions.push(
        sql`COALESCE(${transactions.depositMonth}, to_char(${transactions.date} AT TIME ZONE 'UTC', 'YYYY-MM')) = ${depositMonthParam}`,
      );
    } else {
      if (startDate) {
        conditions.push(gte(transactions.date, new Date(startDate)));
      }
      if (endDate) {
        conditions.push(lte(transactions.date, new Date(endDate)));
      }
    }
    if (search) {
      conditions.push(sql`(${transactions.description} ILIKE ${'%' + search + '%'} OR ${transactions.referenceNumber} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Aggregate-only mode: the deposits header needs just the summed total for
    // a month. Previously the client fetched up to 1000 full rows (with joins)
    // purely to add them up client-side — a large, wasteful round trip.
    if (searchParams.get('aggregateOnly') === 'true') {
      const [agg] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .where(whereClause);

      return NextResponse.json({
        success: true,
        data: { total: agg?.total ?? '0', count: agg?.count ?? 0 },
      });
    }

    // Single round trip: page rows (with joins) + exact filtered count, plus
    // the SUM for the current filter set so the header never needs a 2nd call.
    const [totalRes, aggRes, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(whereClause),
      db
        .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
        .from(transactions)
        .where(whereClause),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          description: transactions.description,
          category: transactions.category,
          referenceNumber: transactions.referenceNumber,
          date: transactions.date,
          submittedDate: transactions.submittedDate,
          status: transactions.status,
          memberId: transactions.memberId,
          fundId: transactions.fundId,
          handlingOfficer: transactions.handlingOfficer,
          depositMethod: transactions.depositMethod,
          depositMonth: transactions.depositMonth,
          authorizedBy: transactions.authorizedBy,
          balanceBefore: transactions.balanceBefore,
          balanceAfter: transactions.balanceAfter,
          createdAt: transactions.createdAt,
          memberName: members.name,
          memberIdStr: members.memberId,
          fundName: funds.name,
        })
        .from(transactions)
        .leftJoin(members, eq(transactions.memberId, members.id))
        .leftJoin(funds, eq(transactions.fundId, funds.id))
        .where(whereClause)
        .orderBy(desc(transactions.date))
        .limit(limit)
        .offset(skip),
    ]);

    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      success: true,
      data: rows,
      // Filtered SUM — lets the header render without a second request.
      sum: aggRes[0]?.total ?? '0',
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('[DEPOSITS GET ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to fetch deposits' },
      { status: err.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, tenantId, error } = await getAuthContext(request);
    if (error || !user) {
      return error || NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    // §6 fail-closed: POST writes money — null tenant must 403, never fall
    // through to unscoped member/fund lookups. Platform ops use /api/admin.
    const scopedTenantId = requireTenant(tenantId, user);

    // Check write permission for DEPOSITS
    if (!hasScreenPermission(user, 'DEPOSITS', 'WRITE')) {
      throw new ForbiddenError('Write permission required for: DEPOSITS');
    }

    const body = await request.json();
    const {
      memberId,
      fundId,
      amount,
      description,
      depositMethod,
      referenceNumber,
      date,
      collectedDate,
      submittedDate,
      depositMonth,
    } = body;

    // Share numbers are one-time setup (member creation). Deposits never
    // change them — a non-zero payload is rejected, not silently applied.
    if (Number(body.shares ?? 0) !== 0) {
      throw new ValidationError('Share numbers are locked after member creation and cannot be changed by deposits');
    }

    // Validate required fields
    if (!memberId || !fundId) {
      throw new ValidationError('memberId and fundId are required');
    }

    // Validate 2 decimal places first for a field-pinned §11 error.
    if (!/^\d+(\.\d{1,2})?$/.test(amount.toString())) {
      throw new ValidationError("[Field 'amount', Code: invalid_string] Amount must have at most 2 decimal places");
    }

    // Integer-cents parsing (§12 — never float arithmetic on money).
    let amountCents: number;
    try {
      amountCents = toCents(amount.toString());
    } catch {
      throw new ValidationError("[Field 'amount', Code: invalid_string] Deposit amount must be a positive number");
    }
    if (amountCents <= 0) {
      throw new ValidationError("[Field 'amount', Code: too_small] Deposit amount must be a positive number");
    }

    const formattedAmount = fromCents(amountCents);

    const refNumber = referenceNumber || `DEP-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    // Collected date (money received) is canonical — drives ledger, month,
    // lastDepositMonth. Allows past dates for back-entry. Submission date
    // (recorded) defaults to now, settable for back-entry.
    const collectedRaw = collectedDate ?? date;
    const collectedParsed = collectedRaw ? new Date(collectedRaw) : new Date();
    if (Number.isNaN(collectedParsed.getTime())) {
      throw new ValidationError("[Field 'collectedDate', Code: invalid_date] Collected date is invalid");
    }
    const depositDate = collectedParsed;
    const submittedParsed = submittedDate ? new Date(submittedDate) : new Date();
    if (Number.isNaN(submittedParsed.getTime())) {
      throw new ValidationError("[Field 'submittedDate', Code: invalid_date] Submission date is invalid");
    }
    const submissionDate = submittedParsed;
    // Deposit month: the form selects it explicitly (month + year dropdowns)
    // so back-entry can record the month the deposit is FOR, independent of
    // when cash was collected. Falls back to the collected-date month for
    // callers that don't send it (bulk flow, requests). Format is validated,
    // never trusted (§6 server-first).
    let depositMonthKey: string;
    if (depositMonth !== undefined && depositMonth !== null && depositMonth !== "") {
      if (typeof depositMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(depositMonth)) {
        throw new ValidationError("[Field 'depositMonth', Code: invalid_string] Deposit month must be in YYYY-MM format");
      }
      depositMonthKey = depositMonth;
    } else {
      depositMonthKey = depositDate.toISOString().slice(0, 7); // YYYY-MM
    }

    const db = getDb();

    // Reference/member/fund lookups are independent of each other (all keyed
    // off the request payload) — batch them into one round-trip group instead
    // of three sequential ones. Error checks below preserve the original
    // precedence (duplicate ref → missing member → missing fund).
    const [existingDeposit, [member], [fund]] = await Promise.all([
      // Duplicate reference number check (idempotency, tenant-scoped: a
      // global check leaks existence of other tenants' refs + lets one tenant
      // squat another's idempotency key).
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
      // Member with tenant isolation (§6: hard tenant predicate — a
      // fail-open fallback here lets one tenant resolve another's member).
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

    const now = new Date();

    // Execute atomic deposit transaction (§6: every write re-asserts the
    // tenant — a read-scoped fund/member followed by an id-only update would
    // let a cross-tenant id slip through between check and write).
    // Bulletproofing (Funds module spec): the fund and member rows are locked
    // (FOR UPDATE, sorted order to avoid deadlocks) and re-read INSIDE the tx,
    // and balance writes are atomic SQL arithmetic — a concurrent deposit,
    // transfer, or expense can never lose an update. The outer unlocked read
    // only serves the existence checks above. All math in integer cents (§12).
    const { newFundBalance, newMemberContributed } = await db.transaction(async (tx) => {
      const [lockedFund] = await tx
        .select()
        .from(funds)
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      const [lockedMember] = await tx
        .select()
        .from(members)
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)))
        .for('update')
        .limit(1);
      if (!lockedFund) throw new NotFoundError('Fund');
      if (!lockedMember) throw new NotFoundError('Member');

      const fundBalanceCents = toCents(lockedFund.balance ?? '0');
      const memberContributedCents = toCents(lockedMember.totalContributed ?? '0');
      const newFundBalanceCents = fundBalanceCents + amountCents;
      const newMemberContributedCents = memberContributedCents + amountCents;

      // Update fund balance (atomic — SQL reads the locked row's live value).
      await tx
        .update(funds)
        .set({
          balance: sql`(${funds.balance}::numeric + ${amountCents / 100})::numeric(15,2)`,
          updatedAt: now,
        })
        .where(and(eq(funds.id, fundId), eq(funds.tenantId, scopedTenantId)));

      await tx
        .update(members)
        .set({
          totalContributed: sql`(${members.totalContributed}::numeric + ${amountCents / 100})::numeric(15,2)`,
          lastDepositMonth: depositMonthKey,
          lastActive: now,
          updatedAt: now,
        })
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)));

      // Create deposit transaction — date = collected, submittedDate = recorded.
      await tx.insert(transactions).values({
        tenantId: scopedTenantId,
        type: 'Deposit',
        amount: formattedAmount,
        description: description || 'Member deposit',
        category: 'Deposit',
        referenceNumber: refNumber,
        date: depositDate,
        submittedDate: submissionDate,
        status: 'Completed',
        memberId: memberId,
        fundId: fundId,
        handlingOfficer: user.name,
        depositMethod: depositMethod || null,
        depositMonth: depositMonthKey,
        authorizedBy: user.id,
        balanceBefore: fromCents(fundBalanceCents),
        balanceAfter: fromCents(newFundBalanceCents),
        createdBy: user.id,
        updatedBy: user.id,
      });

      return {
        newFundBalance: fromCents(newFundBalanceCents),
        newMemberContributed: fromCents(newMemberContributedCents),
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      action: 'RECORD_DEPOSIT',
      resourceType: 'Transaction',
      resourceId: refNumber,
      details: {
        memberId: member.id,
        memberName: member.name,
        fundId: fund.id,
        fundName: fund.name,
        amount: formattedAmount,
        referenceNumber: refNumber,
        depositMethod: depositMethod || null,
        collectedDate: depositDate.toISOString(),
        submittedDate: submissionDate.toISOString(),
        depositMonth: depositMonthKey,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: refNumber,
        member: { id: member.id, name: member.name, newTotalContributed: newMemberContributed, shares: member.shares },
        fund: { id: fund.id, name: fund.name, newBalance: newFundBalance },
        amount: formattedAmount,
        date: depositDate.toISOString(),
        collectedDate: depositDate.toISOString(),
        submittedDate: submissionDate.toISOString(),
        depositMonth: depositMonthKey,
      },
      message: 'Deposit recorded successfully',
    });
  } catch (err: any) {
    console.error('[DEPOSITS POST ERROR]', err);
    return NextResponse.json(
      { success: false, message: err.message || 'Failed to record deposit' },
      { status: err.statusCode || 500 }
    );
  }
}