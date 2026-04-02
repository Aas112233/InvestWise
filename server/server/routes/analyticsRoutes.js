import express from 'express';
import { getStats, triggerRecalculate } from '../controllers/analyticsController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import cache from '../utils/cache.js';

const router = express.Router();

// Cache analytics stats for 1 minute (frequently accessed, changes rarely)
router.get('/stats', protect, cache.middleware('analytics:stats', 60 * 1000), getStats);
router.post('/recalculate', protect, admin, triggerRecalculate);

export default router;
