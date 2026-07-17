import { Router } from 'express';
import { protect, admin } from '../../middleware/auth.js';
import { getStatsHandler, triggerRecalculateHandler } from './controller.js';

const router = Router();

router.get('/stats', protect, getStatsHandler);
router.post('/recalculate', protect, admin, triggerRecalculateHandler);

export { router as analyticsRouter };
