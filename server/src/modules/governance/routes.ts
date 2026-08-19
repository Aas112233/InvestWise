import { Router } from 'express';
import { protect, requirePermission, admin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { issuePenaltySchema, waivePenaltySchema, adjustScoreSchema } from './validation.js';
import {
  issuePenaltyHandler,
  waivePenaltyHandler,
  listPenaltiesHandler,
  getMemberPenaltySummaryHandler,
  getMemberPerformanceHandler,
  recalculateMemberPerformanceHandler,
  recalculateAllPerformanceHandler,
  getGovernanceLeaderboardHandler,
  adjustMemberPerformanceHandler,
} from './controller.js';

const router = Router();

router.use(protect);

// Penalties
router.get('/penalties', requirePermission('MEMBERS', 'READ'), listPenaltiesHandler);
router.get('/penalties/member/:memberId', requirePermission('MEMBERS', 'READ'), getMemberPenaltySummaryHandler);
router.post('/penalties', requirePermission('MEMBERS', 'WRITE'), validate(issuePenaltySchema), issuePenaltyHandler);
router.post('/penalties/:id/waive', admin, validate(waivePenaltySchema), waivePenaltyHandler);

// Performance & Leaderboard
router.get('/leaderboard', requirePermission('MEMBERS', 'READ'), getGovernanceLeaderboardHandler);
router.get('/performance/member/:memberId', requirePermission('MEMBERS', 'READ'), getMemberPerformanceHandler);
router.post('/performance/member/:memberId/recalculate', requirePermission('MEMBERS', 'WRITE'), recalculateMemberPerformanceHandler);
router.post('/performance/member/:memberId/adjust', requirePermission('MEMBERS', 'WRITE'), validate(adjustScoreSchema), adjustMemberPerformanceHandler);
router.post('/performance/recalculate-all', admin, recalculateAllPerformanceHandler);

export const governanceRouter = router;
