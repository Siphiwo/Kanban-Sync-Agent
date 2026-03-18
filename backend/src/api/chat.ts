import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticateToken } from '../utils/auth';
import { ChatAgent } from '../agent';
import { query } from '../db';
import { logger } from '../utils/logger';
import { DataSanitizer } from '../agent/data-sanitizer';

export const chatRouter = Router();

const chatSchema = z.object({
  message: z.string().min(1)
});

// Send message to chat agent
chatRouter.post('/message', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const { message } = chatSchema.parse(req.body);
    
    const agent = new ChatAgent(userId);
    const response = await agent.processMessage(message);
    
    // Validate response safety before sending
    if (!DataSanitizer.validateResponseSafety(response)) {
      logger.error('Unsafe response detected, sanitizing:', { userId });
      return res.json({
        text: "I can help you with KanbanSync features like connecting platforms, creating sync rules, and checking sync status.",
        intent: 'safety_fallback',
        suggestions: ['Connect to platform', 'Create sync rule', 'Check status', 'Get help']
      });
    }
    
    // Save chat message (only save safe content)
    const safeMessage = message.length > 500 ? message.substring(0, 500) + '...' : message;
    const safeResponse = response.text.length > 1000 ? response.text.substring(0, 1000) + '...' : response.text;
    
    await query(
      'INSERT INTO chat_messages (user_id, message, response, intent) VALUES ($1, $2, $3, $4)',
      [userId, safeMessage, safeResponse, response.intent]
    );
    
    logger.info('Chat message processed:', { userId, intent: response.intent });
    res.json(response);
  } catch (error) {
    logger.error('Chat message error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Get chat history
chatRouter.get('/history', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const result = await query(
      'SELECT message, response, intent, created_at FROM chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    
    res.json(result.rows.reverse());
  } catch (error) {
    logger.error('Get chat history error:', error);
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});