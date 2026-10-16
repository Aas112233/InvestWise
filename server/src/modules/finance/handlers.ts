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

    let budgets: [BucketOutcome, BucketOutcome];
    try {
      budgets = await Promise.all([
        consumeBucket(
          bucketKey('bulk-deposit:user', `${tenantId}:${user.id}`),
          BULK_DEPOSIT_USER_LIMIT,
          BULK_DEPOSIT_RATE_WINDOW_SECS,
        ),
        consumeBucket(
          bucketKey('bulk-deposit:tenant', tenantId),
          BULK_DEPOSIT_TENANT_LIMIT,
          BULK_DEPOSIT_RATE_WINDOW_SECS,
        ),
      ]);
    } catch {
      console.error('[BULK_DEPOSIT] rate counter unavailable, denying request');
      return Response.json(
        { success: false, message: 'Bulk deposits are temporarily unavailable. Please try again.', code: 'RATE_LIMIT_UNAVAILABLE' },
        { status: 503 },
      );
    }

    const blocked = budgets.filter((budget) => !budget.ok);
    if (blocked.length > 0) {
      const retryAfter = Math.max(...blocked.map((budget) => budget.retryAfterSec));
      return Response.json(
        { success: false, message: 'Too many bulk deposit attempts. Please try again later.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

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
