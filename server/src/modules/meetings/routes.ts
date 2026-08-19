import { Router } from 'express';
import { protect, requirePermission, admin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createMeetingSchema,
  updateMeetingSchema,
  recordAttendanceSchema,
  completeMeetingSchema,
} from './validation.js';
import {
  createMeetingHandler,
  listMeetingsHandler,
  getMeetingByIdHandler,
  updateMeetingHandler,
  startMeetingHandler,
  recordAttendanceHandler,
  completeMeetingHandler,
  deleteMeetingHandler,
} from './controller.js';

import rateLimit from 'express-rate-limit';

const router = Router();

router.use(protect);

const createMeetingLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds window
  max: 3, // limit to 3 requests per 10s per IP/user
  message: { success: false, message: 'Too many meeting requests. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/', requirePermission('MEMBERS', 'READ'), listMeetingsHandler);
router.get('/:id', requirePermission('MEMBERS', 'READ'), getMeetingByIdHandler);
router.post('/', requirePermission('MEMBERS', 'WRITE'), createMeetingLimiter, validate(createMeetingSchema), createMeetingHandler);
router.put('/:id', requirePermission('MEMBERS', 'WRITE'), validate(updateMeetingSchema), updateMeetingHandler);
router.post('/:id/start', requirePermission('MEMBERS', 'WRITE'), startMeetingHandler);
router.post('/:id/attendance', requirePermission('MEMBERS', 'WRITE'), validate(recordAttendanceSchema), recordAttendanceHandler);
router.post('/:id/complete', requirePermission('MEMBERS', 'WRITE'), validate(completeMeetingSchema), completeMeetingHandler);
router.delete('/:id', admin, deleteMeetingHandler);

export const meetingsRouter = router;
