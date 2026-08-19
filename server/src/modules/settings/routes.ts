import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { updateSettingsSchema } from './validation.js';
import {
  getSettingsHandler,
  updateSettingsHandler,
  getShareValueStatusHandler,
} from './controller.js';

const router = Router();

router.get('/', protect, getSettingsHandler);
router.put('/', protect, requirePermission('SETTINGS', 'WRITE'), validate(updateSettingsSchema), updateSettingsHandler);
router.get('/share-value-status', protect, getShareValueStatusHandler);

export { router as settingsRouter };
