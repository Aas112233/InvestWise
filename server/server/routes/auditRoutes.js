import express from 'express';
const router = express.Router();
import { getAuditLogs, getAuditMetadata, getNotifications } from '../controllers/auditController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

router.route('/').get(protect, admin, getAuditLogs);
router.route('/metadata').get(protect, admin, getAuditMetadata);
router.route('/notifications').get(protect, admin, getNotifications);

export default router;
