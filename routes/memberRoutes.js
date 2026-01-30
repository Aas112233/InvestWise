import express from 'express';
const router = express.Router();
import {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
} from '../controllers/memberController.js';
import { protect, admin, managerOrAdmin } from '../middleware/authMiddleware.js';
import { memberValidation } from '../middleware/validator.js';

router.route('/').get(protect, managerOrAdmin, getMembers).post(protect, admin, memberValidation, createMember);
router
    .route('/:id')
    .get(protect, managerOrAdmin, getMemberById)
    .put(protect, admin, memberValidation, updateMember)
    .delete(protect, admin, deleteMember);

export default router;
