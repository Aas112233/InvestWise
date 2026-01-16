import express from 'express';
const router = express.Router();
import {
    getFunds,
    getFundById,
    createFund,
    updateFund
} from '../controllers/fundController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import { fundValidation } from '../middleware/businessValidator.js';

router.route('/').get(protect, getFunds).post(protect, admin, fundValidation, createFund);
router.route('/:id').get(protect, getFundById).put(protect, admin, fundValidation, updateFund);

export default router;
