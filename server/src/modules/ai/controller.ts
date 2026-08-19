import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as aiService from './service.js';

export const chatCompletionHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await aiService.forwardChatCompletion(req.body);
  res.json(result);
});
