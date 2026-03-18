import { query } from '../db';
import { logger } from '../utils/logger';
import { WebhookEvent, SyncRule } from '../types';

export interface RuleMatch {
  rule: SyncRule;
  confidence: number;
  matchedFilters: string[];
}

export class RuleEngine {
  
  /**
   * Process a webhook event and find matching rules
   */
  static async processWebhookEvent(event: WebhookEvent): Promise<void> {
    try {
      logger.info('Rule engine processing event:', { 
        eventId: event.id, 
        platform: event.platform, 
        eventType: event.event_type 
      });
      
      // Find matching rules
      const matches = await RuleEngine.findMatchingRules(event);
      
      if (matches.length === 0) {
        logger.info('No matching rules found for event:', event.id);
        return;
      }
      
      logger.info(`Found ${matches.length} matching rules for event:`, event.id);
      
      // Execute sync for each matching rule (dynamic import to avoid circular dependency)
      const { SyncExecutor } = await import('../sync/executor');
      
      for (const match of matches) {
        try {
          await SyncExecutor.executeSyncRule(match.rule, event);
          logger.info('Sync rule executed successfully:', { 
            ruleId: match.rule.id, 
            eventId: event.id 
          });
        } catch (error) {
          logger.error('Sync rule execution failed:', { 
            ruleId: match.rule.id, 
            eventId: event.id, 
            error 
          });
        }
      }
      
    } catch (error) {
      logger.error('Rule engine processing failed:', error);
      throw error;
    }
  }
  
  /**
   * Find rules that match a webhook event
   */
  static async findMatchingRules(event: WebhookEvent): Promise<RuleMatch[]> {
    try {
      // Get all active rules for the source platform
      const result = await query(`
        SELECT r.*, sc.platform as source_platform, tc.platform as target_platform
        FROM sync_rules r
        JOIN connections sc ON r.source_connection_id = sc.id
        JOIN connections tc ON r.target_connection_id = tc.id
        WHERE r.is_active = true 
        AND sc.platform = $1
        AND sc.is_active = true
        AND tc.is_active = true
      `, [event.platform]);
      
      const rules: SyncRule[] = result.rows.map((row: any) => ({
        ...row,
        source_filter: JSON.parse(row.source_filter || '{}'),
        target_mapping: JSON.parse(row.target_mapping || '{}'),
        webhook_events: JSON.parse(row.webhook_events || '[]'),
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at)
      }));
      
      const matches: RuleMatch[] = [];
      
      for (const rule of rules) {
        const match = await RuleEngine.evaluateRule(rule, event);
        if (match.confidence > 0) {
          matches.push(match);
        }
      }
      
      // Sort by confidence (highest first)
      return matches.sort((a, b) => b.confidence - a.confidence);
      
    } catch (error) {
      logger.error('Failed to find matching rules:', error);
      return [];
    }
  }
  
  /**
   * Evaluate if a rule matches an event
   */
  static async evaluateRule(rule: SyncRule, event: WebhookEvent): Promise<RuleMatch> {
    let confidence = 0;
    const matchedFilters: string[] = [];
    
    try {
      // Check if rule is configured to handle this event type
      if (rule.webhook_events.length > 0) {
        if (rule.webhook_events.includes(event.event_type)) {
          confidence += 50;
          matchedFilters.push('event_type');
        } else {
          // Event type not in allowed list
          return { rule, confidence: 0, matchedFilters: [] };
        }
      } else {
        // No specific event types configured, allow all
        confidence += 25;
      }
      
      // Evaluate source filters
      const filterMatch = await RuleEngine.evaluateFilters(rule.source_filter, event);
      confidence += filterMatch.score;
      matchedFilters.push(...filterMatch.matchedFilters);
      
      // Check if resource is relevant (task/card events)
      if (RuleEngine.isRelevantResourceType(event)) {
        confidence += 25;
        matchedFilters.push('resource_type');
      }
      
      logger.debug('Rule evaluation result:', { 
        ruleId: rule.id, 
        confidence, 
        matchedFilters 
      });
      
      return { rule, confidence, matchedFilters };
      
    } catch (error) {
      logger.error('Rule evaluation failed:', { ruleId: rule.id, error });
      return { rule, confidence: 0, matchedFilters: [] };
    }
  }
  
  /**
   * Evaluate rule filters against event data
   */
  static async evaluateFilters(
    filters: Record<string, any>, 
    event: WebhookEvent
  ): Promise<{ score: number; matchedFilters: string[] }> {
    let score = 0;
    const matchedFilters: string[] = [];
    
    if (!filters || Object.keys(filters).length === 0) {
      return { score: 0, matchedFilters };
    }
    
    try {
      // Project/Board filter
      if (filters.project_id || filters.board_id) {
        const projectId = filters.project_id || filters.board_id;
        if (RuleEngine.matchesProject(event, projectId)) {
          score += 30;
          matchedFilters.push('project');
        }
      }
      
      // Assignee filter
      if (filters.assignee_id) {
        if (RuleEngine.matchesAssignee(event, filters.assignee_id)) {
          score += 20;
          matchedFilters.push('assignee');
        }
      }
      
      // Status filter
      if (filters.status) {
        if (RuleEngine.matchesStatus(event, filters.status)) {
          score += 15;
          matchedFilters.push('status');
        }
      }
      
      // Tags/Labels filter
      if (filters.tags || filters.labels) {
        const tags = filters.tags || filters.labels;
        if (RuleEngine.matchesTags(event, tags)) {
          score += 10;
          matchedFilters.push('tags');
        }
      }
      
      // Custom field filters
      if (filters.custom_fields) {
        const customMatch = RuleEngine.matchesCustomFields(event, filters.custom_fields);
        score += customMatch.score;
        matchedFilters.push(...customMatch.matchedFilters);
      }
      
    } catch (error) {
      logger.error('Filter evaluation failed:', error);
    }
    
    return { score, matchedFilters };
  }
  
  private static matchesProject(event: WebhookEvent, projectId: string): boolean {
    const payload = event.payload;
    
    if (event.platform === 'asana') {
      return payload.resource?.projects?.some((p: any) => p.gid === projectId) ||
             payload.parent?.gid === projectId;
    } else if (event.platform === 'trello') {
      return payload.model?.board?.id === projectId ||
             payload.action?.data?.board?.id === projectId;
    }
    
    return false;
  }
  
  private static matchesAssignee(event: WebhookEvent, assigneeId: string): boolean {
    const payload = event.payload;
    
    if (event.platform === 'asana') {
      return payload.resource?.assignee?.gid === assigneeId;
    } else if (event.platform === 'trello') {
      return payload.action?.member?.id === assigneeId ||
             payload.model?.idMembers?.includes(assigneeId);
    }
    
    return false;
  }
  
  private static matchesStatus(event: WebhookEvent, status: string): boolean {
    const payload = event.payload;
    
    if (event.platform === 'asana') {
      return payload.resource?.completed === (status === 'completed');
    } else if (event.platform === 'trello') {
      return payload.model?.closed === (status === 'closed') ||
             payload.action?.data?.list?.name?.toLowerCase().includes(status.toLowerCase());
    }
    
    return false;
  }
  
  private static matchesTags(event: WebhookEvent, tags: string[]): boolean {
    const payload = event.payload;
    
    if (event.platform === 'asana') {
      const resourceTags = payload.resource?.tags || [];
      return tags.some(tag => 
        resourceTags.some((t: any) => t.name?.toLowerCase().includes(tag.toLowerCase()))
      );
    } else if (event.platform === 'trello') {
      const resourceLabels = payload.model?.labels || payload.action?.data?.card?.labels || [];
      return tags.some(tag => 
        resourceLabels.some((l: any) => l.name?.toLowerCase().includes(tag.toLowerCase()))
      );
    }
    
    return false;
  }
  
  private static matchesCustomFields(
    _event: WebhookEvent, 
    _customFields: Record<string, any>
  ): { score: number; matchedFilters: string[] } {
    let score = 0;
    const matchedFilters: string[] = [];
    
    // Implementation would depend on specific custom field matching logic
    // This is a placeholder for custom field evaluation
    
    return { score, matchedFilters };
  }
  
  private static isRelevantResourceType(event: WebhookEvent): boolean {
    if (event.platform === 'asana') {
      return ['task', 'story'].includes(event.payload.resource?.resource_type);
    } else if (event.platform === 'trello') {
      return ['card'].includes(event.payload.model?.type);
    }
    
    return false;
  }
  
  /**
   * Validate a sync rule configuration
   */
  static async validateRule(rule: Partial<SyncRule>): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Check required fields
      if (!rule.name || rule.name.trim().length === 0) {
        errors.push('Rule name is required');
      }
      
      if (!rule.source_connection_id) {
        errors.push('Source connection is required');
      }
      
      if (!rule.target_connection_id) {
        errors.push('Target connection is required');
      }
      
      if (rule.source_connection_id === rule.target_connection_id) {
        errors.push('Source and target connections must be different');
      }
      
      // Validate connections exist and are active
      if (rule.source_connection_id && rule.target_connection_id) {
        const connectionsResult = await query(`
          SELECT id, platform, is_active FROM connections 
          WHERE id IN ($1, $2)
        `, [rule.source_connection_id, rule.target_connection_id]);
        
        if (connectionsResult.rows.length !== 2) {
          errors.push('One or more connections not found');
        } else {
          const connections = connectionsResult.rows;
          const inactiveConnections = connections.filter((c: any) => !c.is_active);
          
          if (inactiveConnections.length > 0) {
            errors.push('One or more connections are inactive');
          }
        }
      }
      
      // Validate filter format
      if (rule.source_filter) {
        try {
          if (typeof rule.source_filter === 'string') {
            JSON.parse(rule.source_filter);
          }
        } catch {
          errors.push('Invalid source filter format');
        }
      }
      
      // Validate mapping format
      if (rule.target_mapping) {
        try {
          if (typeof rule.target_mapping === 'string') {
            JSON.parse(rule.target_mapping);
          }
        } catch {
          errors.push('Invalid target mapping format');
        }
      }
      
    } catch (error) {
      logger.error('Rule validation failed:', error);
      errors.push('Rule validation failed');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}