import asyncHandler from 'express-async-handler';
import axios from 'axios';

const LONGCAT_API_URL = 'https://api.longcat.chat/openai/v1/chat/completions';
const API_KEY = process.env.LONGCAT_API_KEY;

// @desc    Query LongCat AI (proxy to hide API key)
// @route   POST /api/ai/query
// @access  Private
const queryAI = asyncHandler(async (req, res) => {
  const { query, options } = req.body;

  if (!query) {
    res.status(400);
    throw new Error('Query is required');
  }

  // Check if API key is configured
  if (!API_KEY) {
    res.status(503);
    throw new Error('AI service not configured. Please contact administrator.');
  }

  try {
    const response = await axios.post(
      LONGCAT_API_URL,
      {
        model: 'longcat',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful financial assistant for InvestWise investment management platform.'
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    res.json({
      success: true,
      data: response.data,
      usage: response.data.usage
    });
  } catch (error) {
    console.error('LongCat API error:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      res.status(401);
      throw new Error('Invalid AI API key');
    } else if (error.response?.status === 429) {
      res.status(429);
      throw new Error('AI service rate limit exceeded');
    } else if (error.code === 'ECONNABORTED') {
      res.status(504);
      throw new Error('AI service timeout');
    } else {
      res.status(500);
      throw new Error('AI service unavailable');
    }
  }
});

// @desc    Check AI service availability
// @route   GET /api/ai/status
// @access  Private
const getAIStatus = asyncHandler(async (req, res) => {
  const isConfigured = !!API_KEY;
  
  res.json({
    available: isConfigured,
    configured: isConfigured,
    service: 'LongCat AI',
    status: isConfigured ? 'ready' : 'not_configured'
  });
});

export { queryAI, getAIStatus };
