import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticateToken } from '../utils/auth';
import { query } from '../db';
import { logger } from '../utils/logger';

export const rulesRouter = Router();

const createRuleSchema = z.object({
  name: z.string().min(1),
  sourceConnectionId: z.string().uuid(),
  targetConnectionId: z.string().uuid(),
  sourceFilter: z.record(z.any()).default({}),
  targetMapping: z.record(z.any()).default({}),
  webhookEvents: z.array(z.string()).default([])
});

// Get user sync rules
rulesRouter.get('/', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const result = await query(`
      SELECT 
        r.*,
        sc.platform as source_platform,
        tc.platform as target_platform
      FROM sync_rules r
      JOIN connections sc ON r.source_connection_id = sc.id
      JOIN connections tc ON r.target_connection_id = tc.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
    `, [userId]);
    
    res.json(result.rows);
  } catch (error) {
    logger.error('Get rules error:', error);
    res.status(500).json({ error: 'Failed to fetch sync rules' });
  }
});

// Create sync rule
rulesRouter.post('/', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const { name, sourceConnectionId, targetConnectionId, sourceFilter, targetMapping, webhookEvents } = 
      createRuleSchema.parse(req.body);
    
    // Verify connections belong to user
    const connectionsResult = await query(
      'SELECT id FROM connections WHERE id IN ($1, $2) AND user_id = $3',
      [sourceConnectionId, targetConnectionId, userId]
    );
    
    if (connectionsResult.rows.length !== 2) {
      return res.status(400).json({ error: 'Invalid connections' });
    }
    
    const result = await query(`
      INSERT INTO sync_rules (user_id, name, source_connection_id, target_connection_id, source_filter, target_mapping, webhook_events)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [userId, name, sourceConnectionId, targetConnectionId, sourceFilter, targetMapping, webhookEvents]);
    
    logger.info('Sync rule created:', { ruleId: result.rows[0].id, userId });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Create rule error:', error);
    res.status(400).json({ error: 'Failed to create sync rule' });
  }
});

// Delete sync rule
rulesRouter.delete('/:id', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const ruleId = req.params.id;
    
    const result = await query(
      'DELETE FROM sync_rules WHERE id = $1 AND user_id = $2 RETURNING id',
      [ruleId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sync rule not found' });
    }
    
    logger.info('Sync rule deleted:', { ruleId, userId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete rule error:', error);
    res.status(500).json({ error: 'Failed to delete sync rule' });
  }
});