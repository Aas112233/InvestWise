import { Router } from 'express';

import { protect, requirePermission, admin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createMemberSchema, updateMemberSchema, onboardMemberSchema } from './validation.js';
import {
  getMembers,
  getMemberByIdHandler,
  createMemberHandler,
  updateMemberHandler,
  deleteMemberHandler,
  onboardMemberHandler,
  recalculateMemberFinancialsHandler,
} from './controller.js';

const router = Router();

// All routes require authentication
router.use(protect);

// --- Specific routes (must come before parameterized /:id) ---

// POST /onboard  — create member + optional user account
router.post(
  '/onboard',
  requirePermission('MEMBERS', 'WRITE'),
  validate(onboardMemberSchema),
  onboardMemberHandler,
);

// POST /recalculate-financials  — admin only
router.post(
  '/recalculate-financials',
  admin,
  recalculateMemberFinancialsHandler,
);

// --- CRUD routes ---

// GET /  — list members
router.get(
  '/',
  requirePermission('MEMBERS', 'READ'),
  getMembers,
);

// POST /  — create a member
router.post(
  '/',
  requirePermission('MEMBERS', 'WRITE'),
  validate(createMemberSchema),
  createMemberHandler,
);

// GET /:id  — get single member
router.get(
  '/:id',
  requirePermission('MEMBERS', 'READ'),
  getMemberByIdHandler,
);

// PUT /:id  — update a member
router.put(
  '/:id',
  requirePermission('MEMBERS', 'WRITE'),
  validate(updateMemberSchema),
  updateMemberHandler,
);

// DELETE /:id  — delete a member (safety checks enforced in service)
router.delete(
  '/:id',
  requirePermission('MEMBERS', 'WRITE'),
  deleteMemberHandler,
);

export default router;
