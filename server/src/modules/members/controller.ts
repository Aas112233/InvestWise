import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import {
  listMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  onboardMember,
  recalculateFinancials,
} from './service.js';
import type { ListMembersQuery } from './service.js';

// ---------------------------------------------------------------------------
// GET /api/members — paginated list
// Frontend: response.data.map(...), response.meta.total
// ---------------------------------------------------------------------------
export const getMembers = asyncHandler(async (req: Request, res: Response) => {
  const params: ListMembersQuery = {
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    search: req.query.search as string | undefined,
    status: req.query.status as string | undefined,
    role: req.query.role as string | undefined,
  };

  const result = await listMembers(params);

  // Frontend expects { data, meta } at top level
  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/members/:id — single member
// Frontend: uses result directly
// ---------------------------------------------------------------------------
export const getMemberByIdHandler = asyncHandler(async (req: Request, res: Response) => {
  const member = await getMemberById(req.params.id as string);
  res.json(member);
});

// ---------------------------------------------------------------------------
// POST /api/members — create
// Frontend: setMembers(prev => [newItem, ...prev])
// ---------------------------------------------------------------------------
export const createMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const member = await createMember(req.body);
  res.status(201).json(member);
});

// ---------------------------------------------------------------------------
// PUT /api/members/:id — update
// Frontend: const standardized = { ...updated, id: updated._id || updated.id }
// ---------------------------------------------------------------------------
export const updateMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const member = await updateMember(req.params.id as string, req.body);
  res.json(member);
});

// ---------------------------------------------------------------------------
// DELETE /api/members/:id — delete
// Frontend: e.response?.data?.message for errors
// ---------------------------------------------------------------------------
export const deleteMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await deleteMember(req.params.id as string);
  res.json({ message: result.message });
});

// ---------------------------------------------------------------------------
// POST /api/members/onboard — create member + optional user
// Frontend: const standardized = { ...newItem, id: newItem._id || newItem.id }
// ---------------------------------------------------------------------------
export const onboardMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await onboardMember(req.body);
  res.status(201).json(result);
});

// ---------------------------------------------------------------------------
// POST /api/members/recalculate-financials — admin utility
// Frontend: showNotification(res.message)
// ---------------------------------------------------------------------------
export const recalculateMemberFinancialsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await recalculateFinancials();
  res.json({ message: `Recalculation complete — ${result.updated} members updated` });
});

// ── Arrears (requires DB migration — member columns pending) ─────────────
