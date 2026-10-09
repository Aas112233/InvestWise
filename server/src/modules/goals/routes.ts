import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createGoalSchema, updateGoalSchema } from './validation';
import { getGoals, getGoalById, createGoal, updateGoal, deleteGoal } from './controller';

const router = Router();

router
  .route('/')
  .get(protect, requirePermission('GOALS', 'READ'), getGoals)
  .post(protect, requirePermission('GOALS', 'WRITE'), validate(createGoalSchema), createGoal);

router
  .route('/:id')
  .get(protect, requirePermission('GOALS', 'READ'), getGoalById)
  .put(protect, requirePermission('GOALS', 'WRITE'), validate(updateGoalSchema), updateGoal)
  .delete(protect, requirePermission('GOALS', 'WRITE'), deleteGoal);

export { router as goalRouter };
