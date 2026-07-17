import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createFundSchema, updateFundSchema } from './validation.js';
import { getFunds, getFundById, createFund, updateFund } from './controller.js';

const router = Router();

router
  .route('/')
  .get(protect, requirePermission('FUNDS_MANAGEMENT', 'READ'), getFunds)
  .post(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(createFundSchema), createFund);

router
  .route('/:id')
  .get(protect, requirePermission('FUNDS_MANAGEMENT', 'READ'), getFundById)
  .put(protect, requirePermission('FUNDS_MANAGEMENT', 'WRITE'), validate(updateFundSchema), updateFund);

export { router as fundRouter };
