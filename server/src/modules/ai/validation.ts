import { z } from 'zod';

export const chatCompletionSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1, 'Content cannot be empty'),
      }),
    )
    .min(1, 'At least one message is required'),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(4096).optional(),
});
