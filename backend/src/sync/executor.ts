import { Router } from 'express';
import express from 'express';
import { authenticateToken } from '../utils/auth';
import { SkillManager, PlatformSkill } from '../skills/skill-manager';
import { FieldMapperMCP, SyncContext } from '../mcp/field-mapper';
import { AsanaSkill, AsanaTask } from '../skills/asana-skill';
import { TrelloSkill, TrelloCard } from '../skills/trello-skill';
import { MondaySkill, MondayItem } from '../skills/monday-skill';
import { ClickUpSkill, ClickUpTask } from '../skills/clickup-skill';
import { JiraSkill, JiraIssue } from '../skills/jira-skill';
import { SyncRule, WebhookEvent } from '../types';
import { query } from '../db';
import { logger } from '../utils/logger';
import { NotificationSystem } from '../agent/notifications';

export const syncRouter = Router();

export interface SyncResult {
  success: boolean;
  sourceTaskId: string;
  targetTaskId?: string;
  error?: string;
  syncData: Record<string, any>;
}

type PlatformData = AsanaTask | TrelloCard | MondayItem | ClickUpTask | JiraIssue;
type PlatformType = 'asana' | 'trello' | 'monday' | 'clickup' | 'jira';

export class SyncExecutor {
  
  /**
   * Execute a sync rule based on a webhook event
   */
  static async executeSyncRule(rule: SyncRule, event: WebhookEvent): Promise<SyncResult> {
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      logger.info('Executing sync rule:', { 
        syncId, 
        ruleId: rule.id, 
        eventId: event.id 
      });
      
      // Get source and target skills
      const sourceSkill = await SkillManager.getSkill(rule.user_id, rule.source_platform as PlatformType);
      const targetSkill = await SkillManager.getSkill(rule.user_id, rule.target_platform as PlatformType);
      
      if (!sourceSkill || !targetSkill) {
        throw new Error('Failed to initialize platform skills');
      }
      
      // Get the source task/card data
      const sourceData = await SyncExecutor.getSourceData(
        sourceSkill, 
        rule.source_platform as PlatformType, 
        event
      );
      
      if (!sourceData) {
        throw new Error('Failed to fetch source task data');
      }
      
      // Get source task ID based on platform
      const sourceTaskId = SyncExecutor.getTaskId(sourceData, rule.source_platform as PlatformType);
      
      // Check for existing sync to avoid duplicates
      const existingSync = await SyncExecutor.findExistingSync(rule.id, sourceTaskId);
      
      let targetTaskId: string | undefined;
      let syncData: Record<string, any> = {};
      
      if (existingSync) {
        // Update existing task
        logger.info('Updating existing synced task:', { 
          syncId, 
          existingTargetId: existingSync.target_task_id 
        });
        
        const mappedData = await SyncExecutor.mapFields(
          sourceData, 
          sourceSkill, 
          targetSkill, 
          rule
        );
        
        targetTaskId = await SyncExecutor.updateTargetTask(
          targetSkill, 
          rule.target_platform as PlatformType, 
          existingSync.target_task_id, 
          mappedData
        );
        
        syncData = { action: 'update', mappedFields: Object.keys(mappedData) };
        
      } else {
        // Create new task
        logger.info('Creating new synced task:', syncId);
        
        const mappedData = await SyncExecutor.mapFields(
          sourceData, 
          sourceSkill, 
          targetSkill, 
          rule
        );
        
        targetTaskId = await SyncExecutor.createTargetTask(
          targetSkill, 
          rule.target_platform as PlatformType, 
          mappedData, 
          rule
        );
        
        syncData = { action: 'create', mappedFields: Object.keys(mappedData) };
      }
      
      // Log sync result
      await SyncExecutor.logSyncResult({
        success: true,
        sourceTaskId,
        targetTaskId,
        syncData
      }, rule.id);

      // Send success notification
      const notifications = new NotificationSystem(rule.user_id);
      const { title, message } = NotificationSystem.formatSyncSuccess(
        rule.name,
        rule.source_platform,
        rule.target_platform
      );
      await notifications.notifySuccess(title, message, {
        ruleId: rule.id,
        sourceTaskId,
        targetTaskId,
        syncData
      });
      
      logger.info('Sync rule executed successfully:', { 
        syncId, 
        sourceTaskId, 
        targetTaskId 
      });
      
      return {
        success: true,
        sourceTaskId,
        targetTaskId,
        syncData
      };
      
    } catch (error) {
      logger.error('Sync rule execution failed:', { syncId, error });
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Log sync error
      await SyncExecutor.logSyncResult({
        success: false,
        sourceTaskId: event.resource_id,
        error: errorMessage,
        syncData: { syncId, eventId: event.id }
      }, rule.id);

      // Send error notification
      const notifications = new NotificationSystem(rule.user_id);
      const { title, message } = NotificationSystem.formatSyncError(
        rule.name,
        rule.source_platform,
        rule.target_platform,
        errorMessage
      );
      await notifications.notifyError(title, message, {
        ruleId: rule.id,
        sourceTaskId: event.resource_id,
        error: errorMessage,
        syncData: { syncId, eventId: event.id }
      });
      
      return {
        success: false,
        sourceTaskId: event.resource_id,
        error: errorMessage,
        syncData: { syncId, eventId: event.id }
      };
    }
  }
  
  private static getTaskId(data: PlatformData, platform: PlatformType): string {
    switch (platform) {
      case 'asana':
        return (data as AsanaTask).gid;
      case 'trello':
        return (data as TrelloCard).id;
      case 'monday':
        return (data as MondayItem).id;
      case 'clickup':
        return (data as ClickUpTask).id;
      case 'jira':
        return (data as JiraIssue).id;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  
  private static async getSourceData(
    skill: PlatformSkill, 
    platform: PlatformType, 
    event: WebhookEvent
  ): Promise<PlatformData | null> {
    try {
      switch (platform) {
        case 'asana':
          if (skill instanceof AsanaSkill) {
            const response = await (skill as any).client.get(`/tasks/${event.resource_id}?opt_fields=gid,name,notes,completed,assignee.gid,assignee.name,due_on,tags.gid,tags.name,custom_fields`);
            return response.data.data;
          }
          break;
        case 'trello':
          if (skill instanceof TrelloSkill) {
            const params = new URLSearchParams((skill as any).getAuthParams());
            const response = await (skill as any).client.get(`/cards/${event.resource_id}?${params}&customFieldItems=true&members=true&labels=true`);
            return response.data;
          }
          break;
        case 'monday':
          if (skill instanceof MondaySkill) {
            const items = await skill.getItems(event.resource_id);
            return items.length > 0 ? items[0] : null;
          }
          break;
        case 'clickup':
          if (skill instanceof ClickUpSkill) {
            const response = await (skill as any).client.get(`/task/${event.resource_id}`);
            return response.data;
          }
          break;
        case 'jira':
          if (skill instanceof JiraSkill) {
            const response = await (skill as any).client.get(`/issue/${event.resource_id}?expand=names,schema,operations,editmeta,changelog,renderedFields`);
            return response.data;
          }
          break;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get source data:', error);
      return null;
    }
  }
  
  private static async mapFields(
    sourceData: PlatformData,
    sourceSkill: PlatformSkill,
    targetSkill: PlatformSkill,
    rule: SyncRule
  ): Promise<Record<string, any>> {
    try {
      // Create sync context
      const context: SyncContext = {
        sourceSkill,
        targetSkill,
        sourcePlatform: rule.source_platform as PlatformType,
        targetPlatform: rule.target_platform as PlatformType,
        fieldMappings: []
      };
      
      // Use custom mappings if provided, otherwise use default mappings
      if (rule.target_mapping && Object.keys(rule.target_mapping).length > 0) {
        // Convert target_mapping to field mappings format
        context.fieldMappings = Object.entries(rule.target_mapping).map(([targetField, sourceField]) => ({
          sourceField: sourceField as string,
          targetField,
          transformation: 'direct' as const
        }));
      } else {
        // Generate default mappings
        const sourceSchema = await sourceSkill.getFieldSchema();
        const targetSchema = await targetSkill.getFieldSchema();
        
        context.fieldMappings = await FieldMapperMCP.generateMappings(
          sourceSchema,
          targetSchema,
          rule.source_platform as PlatformType,
          rule.target_platform as PlatformType
        );
      }
      
      // Apply field mappings
      const mappedData = await FieldMapperMCP.mapFields(sourceData, context);
      
      logger.debug('Field mapping completed:', { 
        sourceFields: Object.keys(sourceData), 
        mappedFields: Object.keys(mappedData) 
      });
      
      return mappedData;
      
    } catch (error) {
      logger.error('Field mapping failed:', error);
      throw new Error('Failed to map fields between platforms');
    }
  }
  
  private static async createTargetTask(
    skill: PlatformSkill,
    platform: PlatformType,
    mappedData: Record<string, any>,
    rule: SyncRule
  ): Promise<string> {
    try {
      switch (platform) {
        case 'asana':
          if (skill instanceof AsanaSkill) {
            const workspaces = await skill.getWorkspaces();
            if (workspaces.length === 0) {
              throw new Error('No Asana workspaces available');
            }
            
            const projects = await skill.getProjects(workspaces[0].gid);
            if (projects.length === 0) {
              throw new Error('No Asana projects available');
            }
            
            const targetProjectId = rule.target_mapping?.project_id || projects[0].gid;
            
            const task = await skill.createTask(targetProjectId, {
              name: mappedData.name,
              notes: mappedData.notes,
              assignee: mappedData.assignee,
              due_on: mappedData.due_on,
              tags: mappedData.tags,
              custom_fields: mappedData.custom_fields
            });
            
            return task.gid;
          }
          break;
          
        case 'trello':
          if (skill instanceof TrelloSkill) {
            const boards = await skill.getBoards();
            if (boards.length === 0) {
              throw new Error('No Trello boards available');
            }
            
            const lists = await skill.getLists(boards[0].id);
            if (lists.length === 0) {
              throw new Error('No Trello lists available');
            }
            
            const targetListId = rule.target_mapping?.list_id || lists[0].id;
            
            const card = await skill.createCard(targetListId, {
              name: mappedData.name,
              desc: mappedData.desc,
              due: mappedData.due,
              idMembers: mappedData.idMembers,
              idLabels: mappedData.idLabels,
              customFields: mappedData.customFields
            });
            
            return card.id;
          }
          break;
          
        case 'monday':
          if (skill instanceof MondaySkill) {
            const boards = await skill.getBoards();
            if (boards.length === 0) {
              throw new Error('No Monday.com boards available');
            }
            
            const targetBoardId = rule.target_mapping?.board_id || boards[0].id;
            
            const item = await skill.createItem(targetBoardId, {
              name: mappedData.name,
              columnValues: mappedData.columnValues
            });
            
            return item.id;
          }
          break;
          
        case 'clickup':
          if (skill instanceof ClickUpSkill) {
            const workspaces = await skill.getWorkspaces();
            if (workspaces.length === 0) {
              throw new Error('No ClickUp workspaces available');
            }
            
            const lists = await skill.getLists(workspaces[0].id);
            if (lists.length === 0) {
              throw new Error('No ClickUp lists available');
            }
            
            const targetListId = rule.target_mapping?.list_id || lists[0].id;
            
            const task = await skill.createTask(targetListId, {
              name: mappedData.name,
              description: mappedData.description,
              assignees: mappedData.assignees,
              tags: mappedData.tags,
              status: mappedData.status,
              priority: mappedData.priority,
              due_date: mappedData.due_date,
              start_date: mappedData.start_date,
              custom_fields: mappedData.custom_fields
            });
            
            return task.id;
          }
          break;
          
        case 'jira':
          if (skill instanceof JiraSkill) {
            const projects = await skill.getProjects();
            if (projects.length === 0) {
              throw new Error('No Jira projects available');
            }
            
            const targetProjectKey = rule.target_mapping?.project_key || projects[0].key;
            
            const issue = await skill.createIssue(targetProjectKey, {
              summary: mappedData.summary || mappedData.name,
              description: mappedData.description,
              issueType: mappedData.issueType || 'Task',
              assignee: mappedData.assignee,
              priority: mappedData.priority,
              labels: mappedData.labels,
              duedate: mappedData.duedate,
              customFields: mappedData.customFields
            });
            
            return issue.id;
          }
          break;
      }
      
      throw new Error(`Unsupported target platform: ${platform}`);
      
    } catch (error) {
      logger.error('Failed to create target task:', error);
      throw error;
    }
  }
  
  private static async updateTargetTask(
    skill: PlatformSkill,
    platform: PlatformType,
    taskId: string,
    mappedData: Record<string, any>
  ): Promise<string> {
    try {
      switch (platform) {
        case 'asana':
          if (skill instanceof AsanaSkill) {
            await skill.updateTask(taskId, {
              name: mappedData.name,
              notes: mappedData.notes,
              completed: mappedData.completed,
              assignee: mappedData.assignee,
              due_on: mappedData.due_on,
              tags: mappedData.tags,
              custom_fields: mappedData.custom_fields
            });
            return taskId;
          }
          break;
          
        case 'trello':
          if (skill instanceof TrelloSkill) {
            await skill.updateCard(taskId, {
              name: mappedData.name,
              desc: mappedData.desc,
              closed: mappedData.closed,
              due: mappedData.due,
              idMembers: mappedData.idMembers,
              idLabels: mappedData.idLabels,
              customFields: mappedData.customFields
            });
            return taskId;
          }
          break;
          
        case 'monday':
          if (skill instanceof MondaySkill) {
            await skill.updateItem(taskId, {
              name: mappedData.name,
              columnValues: mappedData.columnValues
            });
            return taskId;
          }
          break;
          
        case 'clickup':
          if (skill instanceof ClickUpSkill) {
            await skill.updateTask(taskId, {
              name: mappedData.name,
              description: mappedData.description,
              status: mappedData.status,
              priority: mappedData.priority,
              due_date: mappedData.due_date,
              start_date: mappedData.start_date,
              assignees: mappedData.assignees,
              custom_fields: mappedData.custom_fields
            });
            return taskId;
          }
          break;
          
        case 'jira':
          if (skill instanceof JiraSkill) {
            await skill.updateIssue(taskId, {
              summary: mappedData.summary || mappedData.name,
              description: mappedData.description,
              assignee: mappedData.assignee,
              priority: mappedData.priority,
              labels: mappedData.labels,
              duedate: mappedData.duedate,
              status: mappedData.status,
              customFields: mappedData.customFields
            });
            return taskId;
          }
          break;
      }
      
      throw new Error(`Unsupported target platform: ${platform}`);
      
    } catch (error) {
      logger.error('Failed to update target task:', error);
      throw error;
    }
  }
  
  private static async findExistingSync(ruleId: string, sourceTaskId: string): Promise<any> {
    try {
      const result = await query(
        'SELECT target_task_id FROM sync_logs WHERE rule_id = $1 AND source_task_id = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
        [ruleId, sourceTaskId, 'success']
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Failed to find existing sync:', error);
      return null;
    }
  }
  
  private static async logSyncResult(result: SyncResult, ruleId: string): Promise<void> {
    try {
      await query(`
        INSERT INTO sync_logs (rule_id, status, source_task_id, target_task_id, error_message, sync_data)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        ruleId,
        result.success ? 'success' : 'error',
        result.sourceTaskId,
        result.targetTaskId,
        result.error,
        JSON.stringify(result.syncData)
      ]);
    } catch (error) {
      logger.error('Failed to log sync result:', error);
    }
  }
}

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