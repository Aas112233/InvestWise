import express from 'express';
import { getSettings, updateSettings, getShareValueStatus } from '../controllers/settingsController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/')
 .get(protect, getSettings)
 .put(protect, admin, updateSettings);

router.route('/share-value-status')
 .get(protect, getShareValueStatus);

export default router;
