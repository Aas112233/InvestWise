import express from 'express';
const router = express.Router();
import {
 getGoals,
 getGoalById,
 createGoal,
 updateGoal,
 deleteGoal
} from '../controllers/goalController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { goalValidation } from '../middleware/businessValidator.js';
import cache from '../utils/cache.js';

// Allow READ access for viewing goals, WRITE for creating/updating
router.route('/').get(protect, requirePermission('GOALS', 'READ'), cache.middleware('goals:list', cache.CACHE_TTL.SHORT), getGoals).post(protect, requirePermission('GOALS', 'WRITE'), goalValidation, createGoal);
router.route('/:id').get(protect, requirePermission('GOALS', 'READ'), getGoalById).put(protect, requirePermission('GOALS', 'WRITE'), goalValidation, updateGoal).delete(protect, requirePermission('GOALS', 'WRITE'), deleteGoal);

export default router;