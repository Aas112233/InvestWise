import express from 'express';
const router = express.Router();
import {
    getFunds,
    getFundById,
    createFund,
    updateFund
} from '../controllers/fundController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { fundValidation } from '../middleware/businessValidator.js';

// Allow READ access for viewing funds, WRITE for creating/updating
router.route('/').get(protect, requirePermission('FUNDS_MANAGEMENT', 'READ'), getFunds).post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), fundValidation, createFund);
router.route('/:id').get(protect, requirePermission('FUNDS_MANAGEMENT', 'READ'), getFundById).put(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), fundValidation, updateFund);

export default router;
