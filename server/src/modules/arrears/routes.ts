import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { calculateArrearsSchema, waiveArrearSchema } from './validation';
import {
  calculateArrearsHandler,
  listArrearsHandler,
  waiveArrearHandler,
  getMemberArrearsHandler,
} from './controller';

const router = Router();

router.use(protect);

router.get('/', requirePermission('DEPOSITS', 'READ'), listArrearsHandler);
router.post('/calculate', requirePermission('DEPOSITS', 'WRITE'), validate(calculateArrearsSchema), calculateArrearsHandler);
router.post('/:id/waive', requirePermission('SETTINGS', 'WRITE'), validate(waiveArrearSchema), waiveArrearHandler);
router.get('/member/:memberId', requirePermission('DEPOSITS', 'READ'), getMemberArrearsHandler);

export const arrearsRouter = router;
