import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { updateSettingsSchema } from './validation';
import {
  getSettingsHandler,
  updateSettingsHandler,
  getShareValueStatusHandler,
} from './controller';

const router = Router();

router.get('/', protect, getSettingsHandler);
router.put('/', protect, requirePermission('SETTINGS', 'WRITE'), validate(updateSettingsSchema), updateSettingsHandler);
router.get('/share-value-status', protect, getShareValueStatusHandler);

export { router as settingsRouter };
