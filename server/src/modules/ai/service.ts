import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';

const DEFAULT_API_URL = 'https://api.longcat.chat/openai/v1/chat/completions';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export async function forwardChatCompletion(input: ChatCompletionInput) {
  const apiKey = env.LONGCAT_API_KEY || process.env.LONGCAT_API_KEY || '';

  if (!apiKey) {
    throw new AppError(
      'AI Assistant is not configured on the server. Please set LONGCAT_API_KEY in environment.',
      503,
      'AI_NOT_CONFIGURED',
    );
  }

  const apiUrl = process.env.LONGCAT_API_URL || DEFAULT_API_URL;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: input.model || 'gpt-4o-mini',
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError(`AI API returned error ${response.status}: ${errorText}`, 502, 'AI_UPSTREAM_ERROR');
    }

    const data = await response.json();
    return data;
  } catch (err: unknown) {
    if (err instanceof AppError) throw err;
    throw new AppError(`Failed to communicate with AI provider: ${err instanceof Error ? err.message : String(err)}`, 502, 'AI_FETCH_FAILED');
  }
}
