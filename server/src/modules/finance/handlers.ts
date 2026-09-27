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
  dividendSchema,
  equityTransferSchema,
  deleteTransactionSchema,
  transactionQuerySchema,
  type DividendPayload,
} from './validation.js';
import * as finance from './service.js';

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
    const body = await validateBody(request, bulkDepositSchema);
    const user = await requirePermission('DEPOSITS', 'WRITE');
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

export async function handleDistributeDividends(request: NextRequest) {
  try {
    const body = await validateBody<DividendPayload>(request, dividendSchema);
    const user = await requirePermission('DIVIDENDS', 'WRITE');
    const result = await finance.distributeDividends(body, user as SessionUser);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleTransferEquity(request: NextRequest) {
  try {
    const body = await validateBody(request, equityTransferSchema);
    const user = await requirePermission('DIVIDENDS', 'WRITE');
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
