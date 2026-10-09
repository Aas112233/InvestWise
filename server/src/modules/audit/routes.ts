import { Router } from 'express';
import { protect, admin } from '../../middleware/auth';
import {
  getAuditLogsHandler,
  getAuditMetadataHandler,
  getNotificationsHandler,
} from './controller';

const router = Router();

router.get('/', protect, admin, getAuditLogsHandler);
router.get('/metadata', protect, admin, getAuditMetadataHandler);
router.get('/notifications', protect, admin, getNotificationsHandler);

export { router as auditRouter };
