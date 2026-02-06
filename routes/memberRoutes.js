import express from 'express';
const router = express.Router();
import {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
    onboardMember,
    recalculateMemberFinancials,
} from '../controllers/memberController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { memberValidation } from '../middleware/validator.js';

// Allow READ access for viewing members, WRITE for creating
router.route('/').get(protect, requirePermission('MEMBERS', 'READ'), getMembers).post(protect, requirePermission('MEMBERS', 'WRITE'), memberValidation, createMember);
router.route('/onboard').post(protect, requirePermission('MEMBERS', 'WRITE'), memberValidation, onboardMember);
router.route('/recalculate-financials').post(protect, requirePermission('MEMBERS', 'WRITE'), recalculateMemberFinancials);
router
    .route('/:id')
    .get(protect, requirePermission('MEMBERS', 'READ'), getMemberById)
    .put(protect, requirePermission('MEMBERS', 'WRITE'), memberValidation, updateMember)
    .delete(protect, requirePermission('MEMBERS', 'WRITE'), deleteMember);

export default router;
