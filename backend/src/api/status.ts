import { Router } from 'express';
import express from 'express';
import { authenticateToken } from '../utils/auth';
import { StatusTracker } from '../agent/status-tracker';
import { logger } from '../utils/logger';

export const statusRouter = Router();

// Get comprehensive status report
statusRouter.get('/report', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const statusTracker = new StatusTracker(userId);
    const report = await statusTracker.getStatusReport();
    
    res.json(report);
  } catch (error) {
    logger.error('Get status report error:', error);
    res.status(500).json({ error: 'Failed to fetch status report' });
  }
});

// Get sync status overview
statusRouter.get('/sync', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const statusTracker = new StatusTracker(userId);
    const syncStatus = await statusTracker.getSyncStatus();
    
    res.json(syncStatus);
  } catch (error) {
    logger.error('Get sync status error:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

// Get connection health
statusRouter.get('/connections', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const statusTracker = new StatusTracker(userId);
    const connectionHealth = await statusTracker.getConnectionHealth();
    
    res.json(connectionHealth);
  } catch (error) {
    logger.error('Get connection health error:', error);
    res.status(500).json({ error: 'Failed to fetch connection health' });
  }
});

// Get sync history
statusRouter.get('/history', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 20;
    
    const statusTracker = new StatusTracker(userId);
    const history = await statusTracker.getRecentSyncHistory(limit);
    
    res.json(history);
  } catch (error) {
    logger.error('Get sync history error:', error);
    res.status(500).json({ error: 'Failed to fetch sync history' });
  }
});

// Get webhook health
statusRouter.get('/webhooks', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const statusTracker = new StatusTracker(userId);
    const webhookHealth = await statusTracker.getWebhookHealth();
    
    res.json(webhookHealth);
  } catch (error) {
    logger.error('Get webhook health error:', error);
    res.status(500).json({ error: 'Failed to fetch webhook health' });
  }
});

// Get sync statistics
statusRouter.get('/statistics', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const days = parseInt(req.query.days as string) || 7;
    
    const statusTracker = new StatusTracker(userId);
    const statistics = await statusTracker.getSyncStatistics(days);
    
    res.json(statistics);
  } catch (error) {
    logger.error('Get sync statistics error:', error);
    res.status(500).json({ error: 'Failed to fetch sync statistics' });
  }
});