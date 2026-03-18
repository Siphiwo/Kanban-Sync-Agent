import { Router } from 'express';
import express from 'express';
import { authenticateToken } from '../utils/auth';
import { AsanaSkill } from '../skills/asana-skill';
import { TrelloSkill } from '../skills/trello-skill';
import { decrypt } from './oauth';
import { query } from '../db';
import { logger } from '../utils/logger';

export const connectionsRouter = Router();

// Get user connections
connectionsRouter.get('/', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const result = await query(
      'SELECT id, platform, platform_user_id, is_active, created_at FROM connections WHERE user_id = $1',
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    logger.error('Get connections error:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Get connection details with platform data
connectionsRouter.get('/:id/details', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const connectionId = req.params.id;
    
    const result = await query(
      'SELECT platform, access_token, is_active FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    const connection = result.rows[0];
    
    if (!connection.is_active) {
      return res.status(400).json({ error: 'Connection is inactive' });
    }
    
    const decryptedToken = decrypt(connection.access_token);
    let platformData = {};
    
    try {
      if (connection.platform === 'asana') {
        const asanaSkill = new AsanaSkill(decryptedToken);
        const workspaces = await asanaSkill.getWorkspaces();
        platformData = { workspaces };
      } else if (connection.platform === 'trello') {
        const trelloSkill = new TrelloSkill(decryptedToken);
        const boards = await trelloSkill.getBoards();
        platformData = { boards };
      }
    } catch (error) {
      logger.error('Failed to fetch platform data:', error);
      // Mark connection as inactive if API calls fail
      await query(
        'UPDATE connections SET is_active = false WHERE id = $1',
        [connectionId]
      );
      return res.status(400).json({ error: 'Connection is no longer valid' });
    }
    
    res.json({
      platform: connection.platform,
      data: platformData
    });
  } catch (error) {
    logger.error('Get connection details error:', error);
    res.status(500).json({ error: 'Failed to fetch connection details' });
  }
});

// Delete connection
connectionsRouter.delete('/:id', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const connectionId = req.params.id;
    
    const result = await query(
      'DELETE FROM connections WHERE id = $1 AND user_id = $2 RETURNING id',
      [connectionId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    logger.info('Connection deleted:', { connectionId, userId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete connection error:', error);
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

// Test connection
connectionsRouter.post('/:id/test', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const connectionId = req.params.id;
    
    const result = await query(
      'SELECT platform, access_token FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    const connection = result.rows[0];
    const decryptedToken = decrypt(connection.access_token);
    
    let isValid = false;
    let testData = {};
    
    try {
      if (connection.platform === 'asana') {
        const asanaSkill = new AsanaSkill(decryptedToken);
        isValid = await asanaSkill.verifyConnection();
        if (isValid) {
          const workspaces = await asanaSkill.getWorkspaces();
          testData = { workspaces: workspaces.slice(0, 3) }; // Limit for test
        }
      } else if (connection.platform === 'trello') {
        const trelloSkill = new TrelloSkill(decryptedToken);
        isValid = await trelloSkill.verifyConnection();
        if (isValid) {
          const boards = await trelloSkill.getBoards();
          testData = { boards: boards.slice(0, 3) }; // Limit for test
        }
      }
    } catch (error) {
      logger.error('Connection test failed:', error);
      isValid = false;
    }
    
    // Update connection status
    await query(
      'UPDATE connections SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [isValid, connectionId]
    );
    
    res.json({ 
      valid: isValid, 
      data: isValid ? testData : null 
    });
  } catch (error) {
    logger.error('Test connection error:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});