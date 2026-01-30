import express from 'express';
import { getStats, triggerRecalculate } from '../controllers/analyticsController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/stats', protect, getStats);
router.post('/recalculate', protect, admin, triggerRecalculate);

export default router;
