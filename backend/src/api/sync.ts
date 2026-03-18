import { Router } from 'express';
import express from 'express';
import { authenticateToken } from '../utils/auth';
import { SyncExecutor } from '../sync/executor';
import { SyncRule, WebhookEvent } from '../types';
import { query } from '../db';
import { logger } from '../utils/logger';

export const syncRouter = Router();

// Manual sync endpoints
syncRouter.post('/execute/:ruleId', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const ruleId = req.params.ruleId;
    
    // Get the rule
    const ruleResult = await query(`
      SELECT r.*, sc.platform as source_platform, tc.platform as target_platform
      FROM sync_rules r
      JOIN connections sc ON r.source_connection_id = sc.id
      JOIN connections tc ON r.target_connection_id = tc.id
      WHERE r.id = $1 AND r.user_id = $2
    `, [ruleId, userId]);
    
    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sync rule not found' });
    }
    
    const rule: SyncRule = {
      ...ruleResult.rows[0],
      source_filter: JSON.parse(ruleResult.rows[0].source_filter || '{}'),
      target_mapping: JSON.parse(ruleResult.rows[0].target_mapping || '{}'),
      webhook_events: JSON.parse(ruleResult.rows[0].webhook_events || '[]'),
      created_at: new Date(ruleResult.rows[0].created_at),
      updated_at: new Date(ruleResult.rows[0].updated_at)
    };
    
    // Create a mock webhook event for manual execution
    const mockEvent: WebhookEvent = {
      id: `manual_${Date.now()}`,
      platform: rule.source_platform,
      event_type: 'manual_sync',
      resource_id: req.body.taskId || 'manual',
      user_id: userId,
      payload: req.body.payload || {},
      created_at: new Date(),
      processed: false,
      retry_count: 0
    };
    
    const result = await SyncExecutor.executeSyncRule(rule, mockEvent);
    
    res.json(result);
  } catch (error) {
    logger.error('Manual sync execution failed:', error);
    res.status(500).json({ error: 'Sync execution failed' });
  }
});

// Get sync logs
syncRouter.get('/logs/:ruleId', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const ruleId = req.params.ruleId;
    const limit = parseInt(req.query.limit as string) || 50;
    
    // Verify rule belongs to user
    const ruleCheck = await query(
      'SELECT id FROM sync_rules WHERE id = $1 AND user_id = $2',
      [ruleId, userId]
    );
    
    if (ruleCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Sync rule not found' });
    }
    
    const result = await query(`
      SELECT id, status, source_task_id, target_task_id, error_message, sync_data, created_at
      FROM sync_logs 
      WHERE rule_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `, [ruleId, limit]);
    
    const logs = result.rows.map((row: any) => ({
      ...row,
      sync_data: JSON.parse(row.sync_data || '{}'),
      created_at: new Date(row.created_at)
    }));
    
    res.json(logs);
  } catch (error) {
    logger.error('Failed to get sync logs:', error);
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});