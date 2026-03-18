import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticateToken } from '../utils/auth';
import { NotificationSystem } from '../agent/notifications';
import { logger } from '../utils/logger';

export const notificationsRouter = Router();

const updatePreferencesSchema = z.object({
  syncSuccess: z.boolean().optional(),
  syncErrors: z.boolean().optional(),
  connectionIssues: z.boolean().optional(),
  weeklyReports: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional()
});

// Get user notifications
notificationsRouter.get('/', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    const unreadOnly = req.query.unreadOnly === 'true';
    
    const notificationSystem = new NotificationSystem(userId);
    const notifications = await notificationSystem.getNotifications(limit, unreadOnly);
    
    res.json(notifications);
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
notificationsRouter.patch('/:id/read', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const notificationId = req.params.id;
    
    const notificationSystem = new NotificationSystem(userId);
    await notificationSystem.markAsRead(notificationId);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
notificationsRouter.patch('/read-all', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const notificationSystem = new NotificationSystem(userId);
    await notificationSystem.markAllAsRead();
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Mark all notifications as read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Get notification preferences
notificationsRouter.get('/preferences', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const notificationSystem = new NotificationSystem(userId);
    const preferences = await notificationSystem.getNotificationPreferences();
    
    res.json(preferences);
  } catch (error) {
    logger.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Failed to fetch notification preferences' });
  }
});

// Update notification preferences
notificationsRouter.put('/preferences', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const preferences = updatePreferencesSchema.parse(req.body);
    
    const notificationSystem = new NotificationSystem(userId);
    await notificationSystem.updateNotificationPreferences(preferences);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});