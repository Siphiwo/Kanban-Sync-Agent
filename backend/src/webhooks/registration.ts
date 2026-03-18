import { AsanaSkill } from '../skills/asana-skill';
import { TrelloSkill } from '../skills/trello-skill';
import { SkillManager } from '../skills/skill-manager';
import { logger } from '../utils/logger';
import { query } from '../db';

export interface WebhookRegistration {
  id: string;
  user_id: string;
  connection_id: string;
  platform: 'asana' | 'trello';
  webhook_id: string;
  webhook_url: string;
  is_active: boolean;
  created_at: Date;
}

export class WebhookRegistrationService {
  
  /**
   * Register webhooks for a user's connection
   */
  static async registerWebhook(
    userId: string, 
    connectionId: string, 
    platform: 'asana' | 'trello'
  ): Promise<WebhookRegistration | null> {
    try {
      const skill = await SkillManager.getSkill(userId, platform);
      if (!skill) {
        throw new Error(`Failed to get ${platform} skill for user`);
      }
      
      const webhookUrl = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/webhooks/${platform}`;
      
      let webhookId: string;
      
      if (platform === 'asana') {
        webhookId = await WebhookRegistrationService.registerAsanaWebhook(
          skill as AsanaSkill, 
          webhookUrl
        );
      } else if (platform === 'trello') {
        webhookId = await WebhookRegistrationService.registerTrelloWebhook(
          skill as TrelloSkill, 
          webhookUrl
        );
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      
      // Store webhook registration in database
      const result = await query(`
        INSERT INTO webhook_registrations (user_id, connection_id, platform, webhook_id, webhook_url, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        RETURNING *
      `, [userId, connectionId, platform, webhookId, webhookUrl]);
      
      const registration: WebhookRegistration = {
        ...result.rows[0],
        created_at: new Date(result.rows[0].created_at)
      };
      
      logger.info('Webhook registered successfully:', { 
        userId, 
        platform, 
        webhookId 
      });
      
      return registration;
      
    } catch (error) {
      logger.error('Webhook registration failed:', { userId, platform, error });
      return null;
    }
  }
  
  private static async registerAsanaWebhook(
    skill: AsanaSkill, 
    webhookUrl: string
  ): Promise<string> {
    try {
      // Get the first workspace to register webhook for
      const workspaces = await skill.getWorkspaces();
      if (workspaces.length === 0) {
        throw new Error('No Asana workspaces available');
      }
      
      const workspace = workspaces[0];
      
      // Register webhook with Asana
      const response = await (skill as any).client.post('/webhooks', {
        data: {
          resource: workspace.gid,
          target: webhookUrl,
          filters: [
            { resource_type: 'task', action: 'changed' },
            { resource_type: 'task', action: 'added' },
            { resource_type: 'task', action: 'removed' }
          ]
        }
      });
      
      return response.data.data.gid;
      
    } catch (error) {
      logger.error('Asana webhook registration failed:', error);
      throw error;
    }
  }
  
  private static async registerTrelloWebhook(
    skill: TrelloSkill, 
    webhookUrl: string
  ): Promise<string> {
    try {
      // Get user's boards to register webhook for the first one
      const boards = await skill.getBoards();
      if (boards.length === 0) {
        throw new Error('No Trello boards available');
      }
      
      const board = boards[0];
      
      // Register webhook with Trello
      const params = new URLSearchParams({
        ...(skill as any).getAuthParams(),
        callbackURL: webhookUrl,
        idModel: board.id,
        description: 'KanbanSync Webhook'
      });
      
      const response = await (skill as any).client.post(`/webhooks?${params}`);
      
      return response.data.id;
      
    } catch (error) {
      logger.error('Trello webhook registration failed:', error);
      throw error;
    }
  }
  
  /**
   * Unregister a webhook
   */
  static async unregisterWebhook(
    userId: string, 
    registrationId: string
  ): Promise<boolean> {
    try {
      // Get webhook registration
      const result = await query(
        'SELECT * FROM webhook_registrations WHERE id = $1 AND user_id = $2',
        [registrationId, userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Webhook registration not found');
      }
      
      const registration = result.rows[0];
      const skill = await SkillManager.getSkill(userId, registration.platform);
      
      if (!skill) {
        throw new Error(`Failed to get ${registration.platform} skill`);
      }
      
      // Unregister from platform
      if (registration.platform === 'asana') {
        await (skill as any).client.delete(`/webhooks/${registration.webhook_id}`);
      } else if (registration.platform === 'trello') {
        const params = new URLSearchParams((skill as any).getAuthParams());
        await (skill as any).client.delete(`/webhooks/${registration.webhook_id}?${params}`);
      }
      
      // Mark as inactive in database
      await query(
        'UPDATE webhook_registrations SET is_active = false WHERE id = $1',
        [registrationId]
      );
      
      logger.info('Webhook unregistered successfully:', { 
        userId, 
        platform: registration.platform, 
        webhookId: registration.webhook_id 
      });
      
      return true;
      
    } catch (error) {
      logger.error('Webhook unregistration failed:', { userId, registrationId, error });
      return false;
    }
  }
  
  /**
   * Get user's webhook registrations
   */
  static async getUserWebhooks(userId: string): Promise<WebhookRegistration[]> {
    try {
      const result = await query(
        'SELECT * FROM webhook_registrations WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      
      return result.rows.map(row => ({
        ...row,
        created_at: new Date(row.created_at)
      }));
      
    } catch (error) {
      logger.error('Failed to get user webhooks:', error);
      return [];
    }
  }
  
  /**
   * Auto-register webhooks for new connections
   */
  static async autoRegisterForConnection(
    userId: string, 
    connectionId: string, 
    platform: 'asana' | 'trello'
  ): Promise<void> {
    try {
      // Check if webhook already exists for this connection
      const existing = await query(
        'SELECT id FROM webhook_registrations WHERE connection_id = $1 AND is_active = true',
        [connectionId]
      );
      
      if (existing.rows.length > 0) {
        logger.info('Webhook already exists for connection:', connectionId);
        return;
      }
      
      // Register new webhook
      const registration = await WebhookRegistrationService.registerWebhook(
        userId, 
        connectionId, 
        platform
      );
      
      if (registration) {
        logger.info('Auto-registered webhook for new connection:', { 
          connectionId, 
          webhookId: registration.webhook_id 
        });
      }
      
    } catch (error) {
      logger.error('Auto webhook registration failed:', { userId, connectionId, error });
    }
  }
}