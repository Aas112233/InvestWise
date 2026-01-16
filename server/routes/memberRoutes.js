import express from 'express';
const router = express.Router();
import {
    getMembers,
    getMemberById,
    createMember,
    updateMember,
    deleteMember,
} from '../controllers/memberController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { memberValidation } from '../middleware/validator.js';

router.route('/').get(protect, getMembers).post(protect, memberValidation, createMember);
router
    .route('/:id')
    .get(protect, getMemberById)
    .put(protect, memberValidation, updateMember)
    .delete(protect, admin, deleteMember);

export default router;
