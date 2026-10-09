import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createFundSchema, updateFundSchema } from './validation';
import { getFunds, getFundById, createFund, updateFund } from './controller';

const router = Router();

router
  .route('/')
  .get(protect, getFunds)
  .post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(createFundSchema), createFund);

router
  .route('/:id')
  .get(protect, getFundById)
  .put(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(updateFundSchema), updateFund);

export { router as fundRouter };
