import { Router } from 'express';
import { protect, requirePermission, admin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createFiscalPeriodSchema,
  closeFiscalPeriodSchema,
  executeProfitAllocationSchema,
} from './validation.js';
import {
  createFiscalPeriodHandler,
  listFiscalPeriodsHandler,
  getFiscalPeriodByIdHandler,
  closeFiscalPeriodHandler,
  reopenFiscalPeriodHandler,
  executeProfitAllocationHandler,
  listProfitAllocationsHandler,
} from './controller.js';

const router = Router();

router.use(protect);

router.get('/periods', requirePermission('FUNDS_MANAGEMENT', 'READ'), listFiscalPeriodsHandler);
router.get('/periods/:id', requirePermission('FUNDS_MANAGEMENT', 'READ'), getFiscalPeriodByIdHandler);
router.post('/periods', requirePermission('SETTINGS', 'WRITE'), validate(createFiscalPeriodSchema), createFiscalPeriodHandler);
router.post('/periods/:id/close', admin, validate(closeFiscalPeriodSchema), closeFiscalPeriodHandler);
router.post('/periods/:id/reopen', admin, reopenFiscalPeriodHandler);

router.post('/periods/:id/allocate-profit', admin, validate(executeProfitAllocationSchema), executeProfitAllocationHandler);
router.get('/periods/:id/allocations', requirePermission('DIVIDENDS', 'READ'), listProfitAllocationsHandler);

export const fiscalRouter = router;
