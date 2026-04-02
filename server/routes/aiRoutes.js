import express from 'express';
import { queryAI, getAIStatus } from '../controllers/aiController.js';
import { protect } from '../middleware/authMiddleware.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// AI query endpoint (requires authentication)
router.post('/query', protect, apiLimiter, queryAI);

// AI status check (requires authentication)
router.get('/status', protect, getAIStatus);

export default router;
