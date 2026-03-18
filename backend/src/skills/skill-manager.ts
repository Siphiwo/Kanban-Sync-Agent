import { AsanaSkill } from './asana-skill';
import { TrelloSkill } from './trello-skill';
import { MondaySkill } from './monday-skill';
import { ClickUpSkill } from './clickup-skill';
import { JiraSkill } from './jira-skill';
import { decrypt } from '../api/oauth';
import { query } from '../db';
import { logger } from '../utils/logger';

export type PlatformSkill = AsanaSkill | TrelloSkill | MondaySkill | ClickUpSkill | JiraSkill;

export class SkillManager {
  
  /**
   * Get a skill instance for a user's connection
   */
  static async getSkill(userId: string, platform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira'): Promise<PlatformSkill | null> {
    try {
      const result = await query(
        'SELECT access_token, platform_config, is_active FROM connections WHERE user_id = $1 AND platform = $2',
        [userId, platform]
      );
      
      if (result.rows.length === 0 || !result.rows[0].is_active) {
        return null;
      }
      
      const decryptedToken = decrypt(result.rows[0].access_token);
      const platformConfig = result.rows[0].platform_config ? JSON.parse(result.rows[0].platform_config) : {};
      
      switch (platform) {
        case 'asana':
          return new AsanaSkill(decryptedToken);
        case 'trello':
          return new TrelloSkill(decryptedToken);
        case 'monday':
          return new MondaySkill(decryptedToken);
        case 'clickup':
          return new ClickUpSkill(decryptedToken);
        case 'jira':
          return new JiraSkill(decryptedToken, platformConfig.cloudId);
        default:
          return null;
      }
    } catch (error) {
      logger.error('Failed to get skill:', error);
      return null;
    }
  }

  /**
   * Get all active skills for a user
   */
  static async getUserSkills(userId: string): Promise<{ platform: string; skill: PlatformSkill }[]> {
    try {
      const result = await query(
        'SELECT platform, access_token, platform_config FROM connections WHERE user_id = $1 AND is_active = true',
        [userId]
      );
      
      const skills: { platform: string; skill: PlatformSkill }[] = [];
      
      for (const connection of result.rows) {
        const decryptedToken = decrypt(connection.access_token);
        const platformConfig = connection.platform_config ? JSON.parse(connection.platform_config) : {};
        let skill: PlatformSkill | null = null;
        
        switch (connection.platform) {
          case 'asana':
            skill = new AsanaSkill(decryptedToken);
            break;
          case 'trello':
            skill = new TrelloSkill(decryptedToken);
            break;
          case 'monday':
            skill = new MondaySkill(decryptedToken);
            break;
          case 'clickup':
            skill = new ClickUpSkill(decryptedToken);
            break;
          case 'jira':
            skill = new JiraSkill(decryptedToken, platformConfig.cloudId);
            break;
        }
        
        if (skill) {
          skills.push({ platform: connection.platform, skill });
        }
      }
      
      return skills;
    } catch (error) {
      logger.error('Failed to get user skills:', error);
      return [];
    }
  }

  /**
   * Verify all connections for a user
   */
  static async verifyUserConnections(userId: string): Promise<{ platform: string; valid: boolean }[]> {
    const skills = await this.getUserSkills(userId);
    const results: { platform: string; valid: boolean }[] = [];
    
    for (const { platform, skill } of skills) {
      try {
        const isValid = await skill.verifyConnection();
        results.push({ platform, valid: isValid });
        
        // Update connection status in database
        await query(
          'UPDATE connections SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND platform = $3',
          [isValid, userId, platform]
        );
      } catch (error) {
        logger.error(`Failed to verify ${platform} connection:`, error);
        results.push({ platform, valid: false });
        
        // Mark as inactive
        await query(
          'UPDATE connections SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND platform = $2',
          [userId, platform]
        );
      }
    }
    
    return results;
  }

  /**
   * Get available platforms and their connection status
   */
  static async getPlatformStatus(userId: string): Promise<{
    platform: string;
    connected: boolean;
    active: boolean;
    displayName: string;
    available: boolean;
  }[]> {
    const platforms = [
      { id: 'asana', name: 'Asana', available: true },
      { id: 'trello', name: 'Trello', available: true },
      { id: 'monday', name: 'Monday.com', available: true },
      { id: 'clickup', name: 'ClickUp', available: true },
      { id: 'jira', name: 'Jira', available: true }
    ];
    
    const connections = await query(
      'SELECT platform, is_active FROM connections WHERE user_id = $1',
      [userId]
    );
    
    const connectionMap = new Map();
    connections.rows.forEach((conn: any) => {
      connectionMap.set(conn.platform, conn.is_active);
    });
    
    return platforms.map(platform => ({
      platform: platform.id,
      connected: connectionMap.has(platform.id),
      active: connectionMap.get(platform.id) || false,
      displayName: platform.name,
      available: platform.available
    }));
  }
}