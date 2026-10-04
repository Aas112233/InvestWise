import type { NextRequest } from 'next/server';
import {
  requirePermission,
  requireSession,
  requireTenant,
  validateQuery,
  errorResponse,
  assertUuid,
} from '@/server/middleware/api';
import { listMembers } from './service';
import * as fundsService from '../funds/service';
import * as projectsService from '../projects/service';
import { z } from 'zod';

/** Read-side handlers: /api/members, /api/funds, /api/projects. */

const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  // Dropdown feeds request up to 500 rows (see useMemberOptions); tables
  // stay at 10-100. Cap is a hard ceiling, not a default.
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
  status: z.string().optional(),
  role: z.string().optional(),
  // Directory-only: asks the service to compute the per-row ledger aggregates
  // (deposits total, last deposit month, expected dividend). Dropdown feeds
  // omit it so 500-row member picks stay on the cheap path.
  withTotals: z.string().optional(),
});

export async function handleListMembers(request: NextRequest) {
  try {
    const user = await requireSession();
    const query = validateQuery(request, listMembersQuerySchema);
    // Fail-closed tenant resolution: platform operators must use /api/admin.
    const tenantId = requireTenant(user);
    const result = await listMembers(query, user.role, user.id, tenantId);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

const listFundsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  // Dropdown feeds request up to 200 rows (see useFundOptions).
  limit: z.coerce.number().int().min(1).max(200).optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  type: z.string().optional(),
  status: z.string().optional(),
});

export async function handleListFunds(request: NextRequest) {
  try {
    const user = await requireSession();
    const query = validateQuery(request, listFundsQuerySchema);
    const tenantId = requireTenant(user);
    const result = await fundsService.listFunds(query.type, query.status, query as unknown as Record<string, string | undefined>, tenantId);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleCreateFund(request: NextRequest) {
  try {
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const tenantId = requireTenant(user);
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name || '').trim();
    if (!name) {
      return Response.json(
        { success: false, message: "[Field 'name', Code: REQUIRED] Fund name is required", code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const fund = await fundsService.createFund(
      {
        name,
        type: (body.type as 'DEPOSIT' | 'PRIMARY' | 'PROJECT' | 'RESERVE' | 'OTHER') || 'OTHER',
        description: body.description ? String(body.description) : undefined,
        handlingOfficer: body.handlingOfficer ? String(body.handlingOfficer) : undefined,
        accountNumber: body.accountNumber ? String(body.accountNumber) : undefined,
        initialBalance: body.initialBalance !== undefined && body.initialBalance !== '' ? Number(body.initialBalance) : undefined,
        minimumBalance: body.minimumBalance !== undefined && body.minimumBalance !== '' ? Number(body.minimumBalance) : undefined,
      },
      user,
      tenantId,
    );
    return Response.json(fund, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleUpdateFund(request: NextRequest, id: string) {
  try {
    assertUuid(id);
    const user = await requirePermission('FUNDS_MANAGEMENT', 'WRITE');
    const tenantId = requireTenant(user);
    const body = (await request.json()) as Record<string, unknown>;
    const fund = await fundsService.updateFund(id, body as never, tenantId);
    return Response.json(fund);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleListProjects(request: NextRequest) {
  try {
    // Fail-closed tenant resolution: platform operators must use /api/admin.
    const user = await requireSession();
    const tenantId = requireTenant(user);
    const url = new URL(request.url);
    const fundId = url.searchParams.get('fundId') || undefined;
    const status = url.searchParams.get('status') || undefined;
    const result = await projectsService.listProjects({ fundId, status }, tenantId);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
