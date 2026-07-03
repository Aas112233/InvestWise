import express from 'express';
const router = express.Router();
import {
 getMembers,
 getMemberById,
 createMember,
 updateMember,
 deleteMember
} from '../controllers/memberController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { memberValidation } from '../middleware/businessValidator.js';
import cache from '../utils/cache.js';

// Allow READ access for viewing members, WRITE for creating/updating
router.route('/').get(protect, requirePermission('MEMBERS', 'READ'), cache.middleware('members:list', cache.CACHE_TTL.SHORT), getMembers).post(protect, requirePermission('MEMBERS', 'WRITE'), memberValidation, createMember);
router.route('/:id').get(protect, requirePermission('MEMBERS', 'READ'), getMemberById).put(protect, requirePermission('MEMBERS', 'WRITE'), memberValidation, updateMember).delete(protect, requirePermission('MEMBERS', 'WRITE'), deleteMember);

export default router;