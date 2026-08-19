import { Router } from 'express';
import { protect } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { aiLimiter } from '../../middleware/rate-limiter.js';
import { chatCompletionSchema } from './validation.js';
import { chatCompletionHandler } from './controller.js';

const router = Router();

router.use(protect);

router.post('/query', aiLimiter, validate(chatCompletionSchema), chatCompletionHandler);

export const aiRouter = router;
