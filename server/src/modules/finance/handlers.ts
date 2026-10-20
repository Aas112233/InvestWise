import { NextRequest, NextResponse } from 'next/server';
import {
  requireAnyPermission,
  requireDepositWritePermission,
  requirePermission,
  requireTenant,
  validateBody,
  validateQuery,
  errorResponse,
  assertUuid,
  jsonError,
  type SessionUser,
} from '@/server/middleware/api';
import {
  depositSchema,
  bulkDepositSchema,
  depositMonthStatusQuerySchema,
  expenseSchema,
  earningSchema,
  transferSchema,
  equityTransferSchema,
  deleteTransactionSchema,
  transactionQuerySchema,
  revertDepositSchema,
} from './validation';
import * as finance from './service';
import { bucketKey, consumeBucket, type BucketOutcome } from '@/lib/rate-limit';

const BULK_DEPOSIT_MAX_BODY_BYTES = 256 * 1024;
const BULK_DEPOSIT_USER_LIMIT = 12;
const BULK_DEPOSIT_TENANT_LIMIT = 60;
const BULK_DEPOSIT_RATE_WINDOW_SECS = 60;

// The month grid is a read the bulk sheet re-issues only when the desk changes
// member or financial year, so a normal user stays far below this. The ceiling
// exists because the endpoint resolves one member per call: unbounded, it is a
// cheap way to enumerate a tenant's members and their payment history.
const MONTH_STATUS_USER_LIMIT = 60;
const MONTH_STATUS_TENANT_LIMIT = 300;
const MONTH_STATUS_RATE_WINDOW_SECS = 60;

/** A two-dimension abuse budget: per user AND per tenant. */
interface RateLimitBudget {
  scope: string;
  userLimit: number;
  tenantLimit: number;
  windowSecs: number;
  /** Message when the counter store is unreachable (fail CLOSED). */
  unavailableMessage: string;
  /** Message when the budget is spent. */
  limitedMessage: string;
}

/**
 * Spend one request from both budgets, or return the response to send instead.
 *
 * Both dimensions are checked because either alone is trivially bypassed: a
 * per-user ceiling lets one tenant's 40 clerks multiply it, and a per-tenant
 * ceiling lets one clerk starve the desk. A counter failure DENIES — a
 * throttle that fails open is a log, not a control.
 */
async function enforceRateLimit(
  budget: RateLimitBudget,
  tenantId: string,
  userId: string,
): Promise<Response | null> {
  let buckets: [BucketOutcome, BucketOutcome];
  try {
    buckets = await Promise.all([
      consumeBucket(
        bucketKey(`${budget.scope}:user`, `${tenantId}:${userId}`),
        budget.userLimit,
        budget.windowSecs,
      ),
      consumeBucket(bucketKey(`${budget.scope}:tenant`, tenantId), budget.tenantLimit, budget.windowSecs),
    ]);
  } catch {
    console.error(`[${budget.scope}] rate counter unavailable, denying request`);
    return Response.json(
      { success: false, message: budget.unavailableMessage, code: 'RATE_LIMIT_UNAVAILABLE' },
      { status: 503 },
    );
  }

  const blocked = buckets.filter((bucket) => !bucket.ok);
  if (blocked.length > 0) {
    const retryAfter = Math.max(...blocked.map((bucket) => bucket.retryAfterSec));
    return Response.json(
      { success: false, message: budget.limitedMessage, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  return null;
}

const BULK_DEPOSIT_BUDGET: RateLimitBudget = {
  scope: 'bulk-deposit',
  userLimit: BULK_DEPOSIT_USER_LIMIT,
  tenantLimit: BULK_DEPOSIT_TENANT_LIMIT,
  windowSecs: BULK_DEPOSIT_RATE_WINDOW_SECS,
  unavailableMessage: 'Bulk deposits are temporarily unavailable. Please try again.',
  limitedMessage: 'Too many bulk deposit attempts. Please try again later.',
};

const MONTH_STATUS_BUDGET: RateLimitBudget = {
  scope: 'deposit-month-status',
  userLimit: MONTH_STATUS_USER_LIMIT,
  tenantLimit: MONTH_STATUS_TENANT_LIMIT,
  windowSecs: MONTH_STATUS_RATE_WINDOW_SECS,
  unavailableMessage: 'Deposit months are temporarily unavailable. Please try again.',
  limitedMessage: 'Too many requests for deposit months. Please try again later.',
};

/**
 * Financial API — Next.js App Router route handlers.
 * Mounted at /api/finance/* (mirrors server/src/modules/finance/routes.ts).
 * Every handler: session guard -> Zod validation -> tenant-safe service call
 * -> universal error payload on failure.
 */

export async function handleGetTransactions(request: NextRequest) {
  try {
    const user = await requireAnyPermission(['TRANSACTIONS', 'DEPOSITS', 'REQUEST_DEPOSIT'], 'READ');
    const tenantId = requireTenant(user);
    const query = validateQuery(request, transactionQuerySchema);
    const result = await finance.getTransactions(query as unknown as Record<string, string | undefined>, tenantId);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleAddDeposit(request: NextRequest) {
  try {
    const body = await validateBody(request, depositSchema);
    const user = await requireDepositWritePermission(body.status ?? undefined);
    const result = await finance.addDeposit(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleBulkAddDeposits(request: NextRequest) {
  try {
    const user = await requirePermission('DEPOSITS', 'WRITE');
    const tenantId = requireTenant(user);

    const limited = await enforceRateLimit(BULK_DEPOSIT_BUDGET, tenantId, user.id);
    if (limited) return limited;

    const body = await validateBody(request, bulkDepositSchema, {
      maxBytes: BULK_DEPOSIT_MAX_BODY_BYTES,
      requireJsonContentType: true,
    });
    const result = await finance.bulkAddDeposits(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * GET /api/finance/deposits/month-status?memberId=&fiscalYear=
 *
 * The month grid behind the single-member bulk collection: which of the
 * member's fiscal-year months already hold a deposit. Read permission (not
 * write) so an officer reviewing the desk can open the sheet, while the POST
 * that follows still demands DEPOSITS WRITE.
 */
export async function handleGetMemberDepositMonths(request: NextRequest) {
  try {
    const user = await requirePermission('DEPOSITS', 'READ');
    const tenantId = requireTenant(user);

    const limited = await enforceRateLimit(MONTH_STATUS_BUDGET, tenantId, user.id);
    if (limited) return limited;

    const query = validateQuery(request, depositMonthStatusQuerySchema);
    const result = await finance.getMemberDepositMonths(query, user as SessionUser);
    return Response.json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleEditDeposit(request: NextRequest, id: string) {
  try {
    const body = await validateBody(request, depositSchema);
    assertUuid(id);
    const user = await requireDepositWritePermission(body.status ?? undefined);
    const result = await finance.editDeposit(id, body, user as SessionUser);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleApproveDeposit(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    const user = await requirePermission('DEPOSITS', 'WRITE');
    const result = await finance.approveDeposit(id, user as SessionUser);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleRevertDeposit(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    const body = await validateBody(request, revertDepositSchema);
    const user = await requirePermission('DEPOSITS', 'WRITE');
    const result = await finance.revertDeposit(id, body.reason, user as SessionUser);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleAddExpense(request: NextRequest) {
  try {
    const body = await validateBody(request, expenseSchema);
    const user = await requirePermission('EXPENSES', 'WRITE');
    const result = await finance.addExpense(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleEditExpense(request: NextRequest, id: string) {
  try {
    const body = await validateBody(request, expenseSchema);
    assertUuid(id);
    const user = await requirePermission('EXPENSES', 'WRITE');
    const result = await finance.editExpense(id, body, user as SessionUser);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleAddEarning(request: NextRequest) {
  try {
    const body = await validateBody(request, earningSchema);
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const result = await finance.addEarning(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleDeleteTransaction(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    const body = await validateBody(request, deleteTransactionSchema);
    const user = await requireAnyPermission(['TRANSACTIONS', 'DEPOSITS', 'REQUEST_DEPOSIT'], 'WRITE');
    const result = await finance.deleteTransaction(id, body.reason, user as SessionUser);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleTransferFunds(request: NextRequest) {
  try {
    const body = await validateBody(request, transferSchema);
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const result = await finance.transferFunds(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleTransferEquity(request: NextRequest) {
  try {
    const body = await validateBody(request, equityTransferSchema);
    const user = await requirePermission('DIVIDENDS', 'WRITE');
    // Narrations are stored canonically (English) and localized at render time
    // by lib/ledger-description.ts, so no locale is needed here.
    const result = await finance.transferEquity(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleReconcileFund(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const result = await finance.reconcileFund(id, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export function methodNotAllowed(): Response {
  return jsonError('Method not allowed', 405, 'METHOD_NOT_ALLOWED');
}
