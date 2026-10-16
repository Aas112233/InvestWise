import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/index';
import { transactions, funds, members, systemSettings } from '@/db/schema/index';
import { normalizePaymentMethods, isAllowedDepositMethod } from '@/lib/payment-methods';
import { DEPOSIT_FUND_REQUIRED_MESSAGE, isDepositFund } from '@/lib/deposit-fund';
import { findDepositMonthOccupant, depositMonthConflictMessage } from '@/lib/deposit-month-limit';
import { eq, and, asc, desc, sql, gte, lte, ilike, inArray } from 'drizzle-orm';
import { SETTLED_DEPOSIT_STATUSES } from '@/lib/ledger-selectors';
import { getAuthContext } from '@/lib/middleware/auth';
import { requireTenant } from '@/lib/tenant';
import { hasScreenPermission } from '@/lib/permissions';
import { logAudit } from '@/lib/utils/audit';
import { ValidationError, ForbiddenError, NotFoundError, LockedError, readJsonBody } from '@/lib/utils/errors';
import { toCents, fromCents } from '@/lib/money';
import { endOfRangeUtc } from '@/lib/formatters';

/** Single-deposit ceiling = the shared money-module maximum (10,000,000). */
const MAX_AMOUNT_CENTS = 10_000_000 * 100;
import { assertFiscalPeriodOpen } from '@/lib/fiscal-guard';
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
    // Clamp pagination at the boundary: an unbounded `limit` lets an
    // authenticated caller force a full-tenant scan across the member/fund
    // joins plus count/SUM aggregates, and a large `page` produces a huge
    // OFFSET that Postgres still walks. The UI needs ≤500 for its pickers.
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '20', 10) || 20));
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
    // Header sort runs here, not in the browser: the desk paginates, so a
    // client-side sort only ever reorders the 20 loaded rows of a 1,500-row
    // filter set and looks like nothing happened (AGENTS.md §2).
    const sortBy = searchParams.get('sortBy') || 'date';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    // The "Collected this month" header is a MONEY figure, so it must never be
    // computed from the same unfiltered predicate as the audit table below it.
    // The table legitimately lists non-settled rows (an officer reviews direct
    // pending deposits there), but summing those into "collected" made the
    // header disagree with the fund balance on the same screen — and with the
    // Dashboard, the Analysis page and the Transactions KPI, each of which had
    // its own predicate and its own answer (report issues 27 / 47). Callers
    // that want the money total pass `settledOnly=true`; the row list does not.
    const settledOnly = searchParams.get('settledOnly') === 'true';

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
    if (status && status !== 'All') {
      // 'Completed' is the desk's one "verified money" option, but settled
      // deposits are recorded as either 'Completed' or 'Success' — the shared
      // settled set (lib/ledger-selectors.ts). Matching only the literal value
      // dropped every 'Success' row from the filter while the unfiltered table
      // still listed them.
      const settled = status === 'Completed' || status === 'Success';
      conditions.push(
        settled
          ? inArray(transactions.status, [...SETTLED_DEPOSIT_STATUSES])
          : sql`${transactions.status} = ${status}`,
      );
    }
    // Pending deposit REQUESTS (category 'Deposit Request', status 'PENDING')
    // belong to the Request Deposit screen's inbox, not the management desk
    // table — the desk lists settled/rejected deposits and direct (non-request)
    // pending deposits such as reverted ones. Completed requests stay on BOTH
    // screens: once approved they are real, settled money and part of the
    // ledger. The Request Deposit screen passes no flag and sees everything.
    // NULL-safe: a NULL status/category row is never a pending request.
    if (searchParams.get('excludePendingRequests') === 'true' && !(status && status !== 'All')) {
      conditions.push(
        sql`NOT (COALESCE(${transactions.status}, '') = 'PENDING' AND COALESCE(${transactions.category}, '') = 'Deposit Request')`,
      );
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
        // Date-only end is inclusive of the whole day (see endOfRangeUtc).
        conditions.push(lte(transactions.date, endOfRangeUtc(endDate)));
      }
    }
    if (search) {
      const term = search.trim();
      if (term) {
        // The desk renders Member, Member ID, Reference and Notes columns, so
        // search covers all four — matching only reference/description returned
        // zero rows for a member's name, which reads as a broken filter.
        // Same shape as the transactions list (see app/api/transactions/route.ts).
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (UUID_RE.test(term)) {
          conditions.push(sql`${transactions.id} = ${term}`);
        } else {
          const like = `%${term}%`;
          conditions.push(sql`(
            ${transactions.referenceNumber} ILIKE ${like}
            OR ${transactions.description} ILIKE ${like}
            OR ${transactions.id}::text ILIKE ${like}
            OR EXISTS (
              SELECT 1 FROM ${members}
              WHERE ${members.id} = ${transactions.memberId}
                AND ${members.tenantId} = ${scopedTenantId}
                AND (${members.name} ILIKE ${like} OR ${members.memberId} ILIKE ${like})
            )
          )`);
        }
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    // The money-aggregate predicate: the row predicate, narrowed to settled
    // rows when the caller asks for a "collected" figure. Kept separate from
    // `whereClause` so the table can still list PENDING/REJECTED rows.
    const sumWhereClause = settledOnly
      ? and(whereClause, sql`${transactions.status} IN ('Completed', 'Success')`)
      : whereClause;

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
        .where(sumWhereClause);

      return NextResponse.json({
        success: true,
        data: { total: agg?.total ?? '0', count: agg?.count ?? 0 },
      });
    }

    // Deterministic newest-first by default; an explicit header sort wins, and
    // the createdAt/id tail keeps paging stable so a page never repeats or
    // skips a row when the primary key ties.
    const SORT_COLUMNS: Record<string, unknown> = {
      date: transactions.date,
      createdAt: transactions.createdAt,
      amount: transactions.amount,
      status: transactions.status,
      referenceNumber: transactions.referenceNumber,
      memberName: members.name,
      fundName: funds.name,
    };
    const sortColumn = (SORT_COLUMNS[sortBy] as typeof transactions.date) ?? transactions.date;
    const direction = sortOrder === 'asc' ? asc : desc;

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
        .where(sumWhereClause),
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
        // Relation joins stay in the transaction's tenant; a malformed or
        // legacy cross-tenant FK can never disclose another tenant's labels.
        .leftJoin(members, and(eq(transactions.memberId, members.id), eq(members.tenantId, scopedTenantId)))
        .leftJoin(funds, and(eq(transactions.fundId, funds.id), eq(funds.tenantId, scopedTenantId)))
        .where(whereClause)
        .orderBy(direction(sortColumn), desc(transactions.createdAt), desc(transactions.id))
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

    const body = await readJsonBody(request);
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
      throw new ValidationError('Share numbers are locked after member creation and cannot be changed by deposits. Adjust shares by editing the member in the Members screen.');
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
    // Upper bound (§12 / report issue 23). Without this the single-deposit path
    // accepted a 999,999,999,999 typo and pushed the fund balance to ~1 trillion
    // — one keystroke could destroy the books. The ceiling matches the shared
    // MAX_AMOUNT used by parsePositiveAmount and the Zod schemas.
    if (amountCents > MAX_AMOUNT_CENTS) {
      throw new ValidationError(
        `[Field 'amount', Code: too_big] Deposit amount may not exceed ${fromCents(MAX_AMOUNT_CENTS)}`,
      );
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
    // precedence (duplicate ref → missing member → missing fund → month
    // already taken). The duplicate-ref check here is only a fast-path
    // defense: the authoritative guard is the in-transaction re-check + ON
    // CONFLICT handling below, because two concurrent posts can both pass an
    // outside-the-tx check.
    const [existingDeposit, [member], [fund], [pmSettings], monthOccupant] = await Promise.all([
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
      // Tenant-configured payment methods — validates depositMethod below.
      db
        .select({ paymentMethods: systemSettings.paymentMethods })
        .from(systemSettings)
        .where(eq(systemSettings.tenantId, scopedTenantId))
        .limit(1),
      // One deposit per member per month (§12): the month this deposit is FOR
      // must be free for this member (settled deposit or pending request
      // occupies it; reverted/rejected rows do not). Fast-path only — the
      // authoritative re-check runs inside the transaction below, where the
      // member row is locked, so two concurrent posts for the same member and
      // month can never both book it.
      findDepositMonthOccupant(db, {
        tenantId: scopedTenantId,
        memberId,
        depositMonthKey,
      }),
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

    // One deposit per member per month (§12). The member has already
    // deposited (or has a pending request) for the month this entry is FOR —
    // posting a second one would double-count their contribution and the
    // fund balance. Free the month first: reject/approve the pending request
    // or revert the settled deposit.
    if (monthOccupant) {
      throw new ValidationError(depositMonthConflictMessage(depositMonthKey, monthOccupant));
    }

    if (!isDepositFund(fund)) {
      throw new ValidationError(DEPOSIT_FUND_REQUIRED_MESSAGE);
    }

    // depositMethod must be a method this tenant configured (Settings →
    // Governance), a legacy/internal value, or absent — a fixed DB CHECK
    // cannot track per-tenant data, so the gate lives here now.
    if (!isAllowedDepositMethod(depositMethod ?? null, normalizePaymentMethods(pmSettings?.paymentMethods))) {
      throw new ValidationError("[Field 'depositMethod', Code: invalid_payment_method] Unknown payment method — configure it in Settings → Governance first");
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
    const { transactionId, newFundBalance, newMemberContributed } = await db.transaction(async (tx) => {
      await assertFiscalPeriodOpen(tx, scopedTenantId, depositDate);
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

      // §12 idempotency: re-check the reference INSIDE the tx (the outer
      // pre-check races with concurrent posts). Any duplicate found here or by
      // the unique index below aborts the whole tx, so balances can never be
      // credited twice for one reference number.
      const [dupRef] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.referenceNumber, refNumber),
            eq(transactions.isDeleted, false),
            eq(transactions.tenantId, scopedTenantId),
          ),
        )
        .limit(1);
      if (dupRef) {
        throw new ValidationError("[Field 'referenceNumber', Code: DUPLICATE] Transaction with this reference number already exists");
      }

      // §12 one-deposit-per-month: authoritative re-check inside the tx. The
      // member row is locked FOR UPDATE above, so concurrent posts for the
      // same member serialize here and a month can never be double-booked
      // (the outer fast-path can race). A reverted direct deposit
      // (category 'Deposit' + PENDING) does not occupy its month, so the
      // revert→re-approve cycle keeps working.
      const monthOccupant = await findDepositMonthOccupant(tx, {
        tenantId: scopedTenantId,
        memberId,
        depositMonthKey,
      });
      if (monthOccupant) {
        throw new ValidationError(depositMonthConflictMessage(depositMonthKey, monthOccupant));
      }

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
          lastDepositMonth: sql`GREATEST(COALESCE(${members.lastDepositMonth}, ''), ${depositMonthKey})`,
          lastActive: now,
          updatedAt: now,
        })
        .where(and(eq(members.id, memberId), eq(members.tenantId, scopedTenantId)));

      // Create deposit transaction — date = collected, submittedDate = recorded.
      // ON CONFLICT with NO named target: uq_trans_tenant_reference is a
      // partial unique index ((tenant_id, reference_number) WHERE is_deleted =
      // false AND reference_number IS NOT NULL) added by migration — naming
      // columns before it exists would fail with 42P10 and break every
      // deposit. A bare ON CONFLICT DO NOTHING absorbs the 23505 from that
      // index (it only ever swallows unique violations) whether or not the
      // migration has run; the empty returning() below is the mapping.
      const [inserted] = await tx
        .insert(transactions)
        .values({
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
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        // 23505 (unique_violation): a concurrent request committed the same
        // reference number between the pre-check and this insert — the tx
        // (fund/member balances included) rolls back with it.
        throw new ValidationError("[Field 'referenceNumber', Code: DUPLICATE] Transaction with this reference number already exists");
      }

      return {
        // The created row's id is what the printable receipt tab needs
        // (/print/deposit/<id> → GET /transactions/<id>). The client opens
        // that tab only after this response lands, so the window never
        // appears for a request the server refused.
        transactionId: inserted.id,
        newFundBalance: fromCents(newFundBalanceCents),
        newMemberContributed: fromCents(newMemberContributedCents),
      };
    });

    await logAudit({
      user: { id: user.id, name: user.name },
      tenantId,
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
        id: transactionId,
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
