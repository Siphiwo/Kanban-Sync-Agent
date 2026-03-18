import { query } from '../db';
import { logger } from '../utils/logger';

export interface Notification {
  id: string;
  userId: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: Date;
}

export interface NotificationPreferences {
  userId: string;
  syncSuccess: boolean;
  syncErrors: boolean;
  connectionIssues: boolean;
  weeklyReports: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
}

export class NotificationSystem {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Send a success notification
   */
  async notifySuccess(title: string, message: string, data?: Record<string, any>): Promise<void> {
    const preferences = await this.getNotificationPreferences();
    
    if (preferences.syncSuccess) {
      await this.createNotification('success', title, message, data);
    }
  }

  /**
   * Send an error notification
   */
  async notifyError(title: string, message: string, data?: Record<string, any>): Promise<void> {
    const preferences = await this.getNotificationPreferences();
    
    if (preferences.syncErrors) {
      await this.createNotification('error', title, message, data);
    }
  }

  /**
   * Send a warning notification
   */
  async notifyWarning(title: string, message: string, data?: Record<string, any>): Promise<void> {
    const preferences = await this.getNotificationPreferences();
    
    if (preferences.connectionIssues) {
      await this.createNotification('warning', title, message, data);
    }
  }

  /**
   * Send an info notification
   */
  async notifyInfo(title: string, message: string, data?: Record<string, any>): Promise<void> {
    await this.createNotification('info', title, message, data);
  }

  /**
   * Get user notifications
   */
  async getNotifications(limit: number = 50, unreadOnly: boolean = false): Promise<Notification[]> {
    try {
      const whereClause = unreadOnly ? 'WHERE user_id = $1 AND read = false' : 'WHERE user_id = $1';
      
      const result = await query(`
        SELECT * FROM notifications 
        ${whereClause}
        ORDER BY created_at DESC 
        LIMIT $2
      `, [this.userId, limit]);

      return result.rows.map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        message: row.message,
        data: row.data ? JSON.parse(row.data) : undefined,
        read: row.read,
        createdAt: new Date(row.created_at)
      }));
    } catch (error) {
      logger.error('Failed to get notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    try {
      await query(
        'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
        [notificationId, this.userId]
      );
    } catch (error) {
      logger.error('Failed to mark notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    try {
      await query(
        'UPDATE notifications SET read = true WHERE user_id = $1',
        [this.userId]
      );
    } catch (error) {
      logger.error('Failed to mark all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Get notification preferences
   */
  async getNotificationPreferences(): Promise<NotificationPreferences> {
    try {
      const result = await query(
        'SELECT * FROM notification_preferences WHERE user_id = $1',
        [this.userId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          userId: row.user_id,
          syncSuccess: row.sync_success,
          syncErrors: row.sync_errors,
          connectionIssues: row.connection_issues,
          weeklyReports: row.weekly_reports,
          emailNotifications: row.email_notifications,
          pushNotifications: row.push_notifications
        };
      }

      // Return default preferences
      return {
        userId: this.userId,
        syncSuccess: false, // Don't spam with success notifications by default
        syncErrors: true,
        connectionIssues: true,
        weeklyReports: true,
        emailNotifications: false,
        pushNotifications: true
      };
    } catch (error) {
      logger.error('Failed to get notification preferences:', error);
      throw error;
    }
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<void> {
    try {
      await query(`
        INSERT INTO notification_preferences (
          user_id, sync_success, sync_errors, connection_issues, 
          weekly_reports, email_notifications, push_notifications
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          sync_success = COALESCE($2, notification_preferences.sync_success),
          sync_errors = COALESCE($3, notification_preferences.sync_errors),
          connection_issues = COALESCE($4, notification_preferences.connection_issues),
          weekly_reports = COALESCE($5, notification_preferences.weekly_reports),
          email_notifications = COALESCE($6, notification_preferences.email_notifications),
          push_notifications = COALESCE($7, notification_preferences.push_notifications),
          updated_at = CURRENT_TIMESTAMP
      `, [
        this.userId,
        preferences.syncSuccess,
        preferences.syncErrors,
        preferences.connectionIssues,
        preferences.weeklyReports,
        preferences.emailNotifications,
        preferences.pushNotifications
      ]);
    } catch (error) {
      logger.error('Failed to update notification preferences:', error);
      throw error;
    }
  }

  /**
   * Create a notification
   */
  private async createNotification(
    type: 'success' | 'error' | 'warning' | 'info',
    title: string,
    message: string,
    data?: Record<string, any>
  ): Promise<void> {
    try {
      const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      await query(`
        INSERT INTO notifications (id, user_id, type, title, message, data, read)
        VALUES ($1, $2, $3, $4, $5, $6, false)
      `, [
        notificationId,
        this.userId,
        type,
        title,
        message,
        data ? JSON.stringify(data) : null
      ]);

      logger.info('Notification created:', { 
        userId: this.userId, 
        type, 
        title 
      });
    } catch (error) {
      logger.error('Failed to create notification:', error);
      throw error;
    }
  }

  /**
   * Format sync success message
   */
  static formatSyncSuccess(
    ruleName: string, 
    sourcePlatform: string, 
    targetPlatform: string, 
    taskCount: number = 1
  ): { title: string; message: string } {
    return {
      title: 'Sync Completed Successfully',
      message: `${taskCount} task${taskCount > 1 ? 's' : ''} synced from ${sourcePlatform} to ${targetPlatform} using rule "${ruleName}".`
    };
  }

  /**
   * Format sync error message
   */
  static formatSyncError(
    ruleName: string, 
    sourcePlatform: string, 
    targetPlatform: string, 
    error: string
  ): { title: string; message: string } {
    return {
      title: 'Sync Failed',
      message: `Failed to sync from ${sourcePlatform} to ${targetPlatform} using rule "${ruleName}". Error: ${error}`
    };
  }

  /**
   * Format connection issue message
   */
  static formatConnectionIssue(platform: string, issue: string): { title: string; message: string } {
    return {
      title: `${platform} Connection Issue`,
      message: `There's an issue with your ${platform} connection: ${issue}. Please check your connection settings.`
    };
  }

  /**
   * Format webhook issue message
   */
  static formatWebhookIssue(platform: string): { title: string; message: string } {
    return {
      title: `${platform} Webhook Issue`,
      message: `Webhooks for ${platform} are not working properly. Real-time sync may be delayed. Please check webhook configuration.`
    };
  }

  /**
   * Format rule created message
   */
  static formatRuleCreated(
    ruleName: string, 
    sourcePlatform: string, 
    targetPlatform: string
  ): { title: string; message: string } {
    return {
      title: 'Sync Rule Created',
      message: `New sync rule "${ruleName}" created to sync from ${sourcePlatform} to ${targetPlatform}.`
    };
  }

  /**
   * Format weekly report message
   */
  static formatWeeklyReport(
    totalSyncs: number, 
    successRate: number, 
    activeRules: number
  ): { title: string; message: string } {
    return {
      title: 'Weekly Sync Report',
      message: `This week: ${totalSyncs} syncs completed with ${successRate}% success rate across ${activeRules} active rules.`
    };
  }

  /**
   * Send batch notifications for multiple events
   */
  async sendBatchNotifications(notifications: Array<{
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    data?: Record<string, any>;
  }>): Promise<void> {
    const preferences = await this.getNotificationPreferences();
    
    for (const notification of notifications) {
      // Check if this type of notification is enabled
      let shouldSend = false;
      
      switch (notification.type) {
        case 'success':
          shouldSend = preferences.syncSuccess;
          break;
        case 'error':
          shouldSend = preferences.syncErrors;
          break;
        case 'warning':
          shouldSend = preferences.connectionIssues;
          break;
        case 'info':
          shouldSend = true; // Always send info notifications
          break;
      }

      if (shouldSend) {
        await this.createNotification(
          notification.type,
          notification.title,
          notification.message,
          notification.data
        );
      }
    }
  }

  /**
   * Clean up old notifications
   */
  async cleanupOldNotifications(daysToKeep: number = 30): Promise<void> {
    try {
      await query(`
        DELETE FROM notifications 
        WHERE user_id = $1 
        AND created_at < NOW() - INTERVAL '${daysToKeep} days'
      `, [this.userId]);

      logger.info('Old notifications cleaned up:', { 
        userId: this.userId, 
        daysToKeep 
      });
    } catch (error) {
      logger.error('Failed to cleanup old notifications:', error);
      throw error;
    }
  }
}