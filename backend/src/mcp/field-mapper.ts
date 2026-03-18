import { AsanaSkill, AsanaTask } from '../skills/asana-skill';
import { TrelloSkill, TrelloCard } from '../skills/trello-skill';
import { MondaySkill, MondayItem } from '../skills/monday-skill';
import { ClickUpSkill, ClickUpTask } from '../skills/clickup-skill';
import { JiraSkill, JiraIssue } from '../skills/jira-skill';
import { logger } from '../utils/logger';

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  transformation?: 'direct' | 'date_format' | 'status_map' | 'custom';
  transformationConfig?: Record<string, any>;
}

export interface SyncContext {
  sourceSkill: AsanaSkill | TrelloSkill | MondaySkill | ClickUpSkill | JiraSkill;
  targetSkill: AsanaSkill | TrelloSkill | MondaySkill | ClickUpSkill | JiraSkill;
  sourcePlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira';
  targetPlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira';
  fieldMappings: FieldMapping[];
}

export class FieldMapperMCP {
  
  /**
   * Complex field mapping operation between different platforms
   */
  static async mapFields(
    sourceData: AsanaTask | TrelloCard | MondayItem | ClickUpTask | JiraIssue, 
    context: SyncContext
  ): Promise<Record<string, any>> {
    try {
      const mappedData: Record<string, any> = {};
      
      for (const mapping of context.fieldMappings) {
        const sourceValue = this.extractFieldValue(sourceData, mapping.sourceField, context.sourcePlatform);
        
        if (sourceValue !== undefined && sourceValue !== null) {
          const transformedValue = await this.transformValue(
            sourceValue, 
            mapping.transformation || 'direct',
            mapping.transformationConfig || {},
            context
          );
          
          this.setFieldValue(mappedData, mapping.targetField, transformedValue, context.targetPlatform);
        }
      }
      
      return mappedData;
    } catch (error) {
      logger.error('Field mapping failed:', error);
      throw new Error('Failed to map fields between platforms');
    }
  }

  /**
   * Generate intelligent field mappings between platforms
   */
  static async generateMappings(
    sourceSchema: Record<string, any>,
    targetSchema: Record<string, any>,
    sourcePlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira',
    targetPlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira'
  ): Promise<FieldMapping[]> {
    const mappings: FieldMapping[] = [];
    
    // Standard field mappings
    const standardMappings = this.getStandardMappings(sourcePlatform, targetPlatform);
    mappings.push(...standardMappings);
    
    // Smart matching for custom fields
    const customMappings = this.matchCustomFields(sourceSchema, targetSchema);
    mappings.push(...customMappings);
    
    return mappings;
  }

  private static extractFieldValue(
    data: AsanaTask | TrelloCard | MondayItem | ClickUpTask | JiraIssue, 
    fieldPath: string, 
    platform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira'
  ): any {
    const parts = fieldPath.split('.');
    let value: any = data;
    
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  private static setFieldValue(
    data: Record<string, any>, 
    fieldPath: string, 
    value: any, 
    platform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira'
  ): void {
    const parts = fieldPath.split('.');
    let current = data;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  private static async transformValue(
    value: any, 
    transformation: string, 
    config: Record<string, any>,
    context: SyncContext
  ): Promise<any> {
    switch (transformation) {
      case 'direct':
        return value;
        
      case 'date_format':
        if (typeof value === 'string') {
          const date = new Date(value);
          return config.format === 'iso' ? date.toISOString() : date.toISOString().split('T')[0];
        }
        return value;
        
      case 'status_map':
        const statusMap = config.statusMap || {};
        return statusMap[value] || value;
        
      case 'custom':
        // Custom transformation logic can be added here
        return await this.executeCustomTransformation(value, config, context);
        
      default:
        return value;
    }
  }

  private static async executeCustomTransformation(
    value: any, 
    config: Record<string, any>,
    context: SyncContext
  ): Promise<any> {
    // Placeholder for custom transformation logic
    // This could include API calls, complex data processing, etc.
    logger.debug('Executing custom transformation:', { value, config });
    return value;
  }

  private static getStandardMappings(
    sourcePlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira',
    targetPlatform: 'asana' | 'trello' | 'monday' | 'clickup' | 'jira'
  ): FieldMapping[] {
    const mappings: FieldMapping[] = [];
    
    // Asana to other platforms
    if (sourcePlatform === 'asana') {
      if (targetPlatform === 'trello') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'notes', targetField: 'desc' },
          { sourceField: 'completed', targetField: 'closed' },
          { sourceField: 'due_on', targetField: 'due', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'monday') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'notes', targetField: 'column_values.text' },
          { sourceField: 'completed', targetField: 'state', transformation: 'status_map' },
          { sourceField: 'due_on', targetField: 'column_values.date', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'clickup') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'notes', targetField: 'description' },
          { sourceField: 'completed', targetField: 'status', transformation: 'status_map' },
          { sourceField: 'due_on', targetField: 'due_date', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'jira') {
        mappings.push(
          { sourceField: 'name', targetField: 'fields.summary' },
          { sourceField: 'notes', targetField: 'fields.description' },
          { sourceField: 'completed', targetField: 'fields.status', transformation: 'status_map' },
          { sourceField: 'due_on', targetField: 'fields.duedate', transformation: 'date_format' }
        );
      }
    }
    
    // Trello to other platforms
    else if (sourcePlatform === 'trello') {
      if (targetPlatform === 'asana') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'desc', targetField: 'notes' },
          { sourceField: 'closed', targetField: 'completed' },
          { sourceField: 'due', targetField: 'due_on', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'monday') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'desc', targetField: 'column_values.text' },
          { sourceField: 'closed', targetField: 'state', transformation: 'status_map' },
          { sourceField: 'due', targetField: 'column_values.date', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'clickup') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'desc', targetField: 'description' },
          { sourceField: 'closed', targetField: 'status', transformation: 'status_map' },
          { sourceField: 'due', targetField: 'due_date', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'jira') {
        mappings.push(
          { sourceField: 'name', targetField: 'fields.summary' },
          { sourceField: 'desc', targetField: 'fields.description' },
          { sourceField: 'closed', targetField: 'fields.status', transformation: 'status_map' },
          { sourceField: 'due', targetField: 'fields.duedate', transformation: 'date_format' }
        );
      }
    }
    
    // Monday to other platforms
    else if (sourcePlatform === 'monday') {
      if (targetPlatform === 'asana') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'column_values.text', targetField: 'notes' },
          { sourceField: 'state', targetField: 'completed', transformation: 'status_map' }
        );
      } else if (targetPlatform === 'trello') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'column_values.text', targetField: 'desc' },
          { sourceField: 'state', targetField: 'closed', transformation: 'status_map' }
        );
      } else if (targetPlatform === 'clickup') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'column_values.text', targetField: 'description' },
          { sourceField: 'state', targetField: 'status', transformation: 'status_map' }
        );
      } else if (targetPlatform === 'jira') {
        mappings.push(
          { sourceField: 'name', targetField: 'fields.summary' },
          { sourceField: 'column_values.text', targetField: 'fields.description' },
          { sourceField: 'state', targetField: 'fields.status', transformation: 'status_map' }
        );
      }
    }
    
    // ClickUp to other platforms
    else if (sourcePlatform === 'clickup') {
      if (targetPlatform === 'asana') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'description', targetField: 'notes' },
          { sourceField: 'status.status', targetField: 'completed', transformation: 'status_map' },
          { sourceField: 'due_date', targetField: 'due_on', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'trello') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'description', targetField: 'desc' },
          { sourceField: 'status.status', targetField: 'closed', transformation: 'status_map' },
          { sourceField: 'due_date', targetField: 'due', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'monday') {
        mappings.push(
          { sourceField: 'name', targetField: 'name' },
          { sourceField: 'description', targetField: 'column_values.text' },
          { sourceField: 'status.status', targetField: 'state', transformation: 'status_map' }
        );
      } else if (targetPlatform === 'jira') {
        mappings.push(
          { sourceField: 'name', targetField: 'fields.summary' },
          { sourceField: 'description', targetField: 'fields.description' },
          { sourceField: 'status.status', targetField: 'fields.status', transformation: 'status_map' },
          { sourceField: 'due_date', targetField: 'fields.duedate', transformation: 'date_format' }
        );
      }
    }
    
    // Jira to other platforms
    else if (sourcePlatform === 'jira') {
      if (targetPlatform === 'asana') {
        mappings.push(
          { sourceField: 'fields.summary', targetField: 'name' },
          { sourceField: 'fields.description', targetField: 'notes' },
          { sourceField: 'fields.status.name', targetField: 'completed', transformation: 'status_map' },
          { sourceField: 'fields.duedate', targetField: 'due_on', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'trello') {
        mappings.push(
          { sourceField: 'fields.summary', targetField: 'name' },
          { sourceField: 'fields.description', targetField: 'desc' },
          { sourceField: 'fields.status.name', targetField: 'closed', transformation: 'status_map' },
          { sourceField: 'fields.duedate', targetField: 'due', transformation: 'date_format' }
        );
      } else if (targetPlatform === 'monday') {
        mappings.push(
          { sourceField: 'fields.summary', targetField: 'name' },
          { sourceField: 'fields.description', targetField: 'column_values.text' },
          { sourceField: 'fields.status.name', targetField: 'state', transformation: 'status_map' }
        );
      } else if (targetPlatform === 'clickup') {
        mappings.push(
          { sourceField: 'fields.summary', targetField: 'name' },
          { sourceField: 'fields.description', targetField: 'description' },
          { sourceField: 'fields.status.name', targetField: 'status', transformation: 'status_map' },
          { sourceField: 'fields.duedate', targetField: 'due_date', transformation: 'date_format' }
        );
      }
    }
    
    return mappings;
  }

  private static matchCustomFields(
    sourceSchema: Record<string, any>,
    targetSchema: Record<string, any>
  ): FieldMapping[] {
    const mappings: FieldMapping[] = [];
    
    // Simple name-based matching for custom fields
    for (const [sourceField, sourceConfig] of Object.entries(sourceSchema)) {
      if (sourceField.startsWith('custom_field_')) {
        for (const [targetField, targetConfig] of Object.entries(targetSchema)) {
          if (targetField.startsWith('custom_field_') && 
              sourceConfig.name && targetConfig.name &&
              sourceConfig.name.toLowerCase() === targetConfig.name.toLowerCase()) {
            
            mappings.push({
              sourceField,
              targetField,
              transformation: this.getTransformationForTypes(sourceConfig.type, targetConfig.type)
            });
            break;
          }
        }
      }
    }
    
    return mappings;
  }

  private static getTransformationForTypes(sourceType: string, targetType: string): 'direct' | 'date_format' | 'status_map' {
    if (sourceType === targetType) {
      return 'direct';
    }
    
    if ((sourceType === 'date' || targetType === 'date')) {
      return 'date_format';
    }
    
    if ((sourceType === 'enum' || targetType === 'enum')) {
      return 'status_map';
    }
    
    return 'direct';
  }

  /**
   * Validate that a mapping configuration is valid
   */
  static validateMappings(
    mappings: FieldMapping[],
    sourceSchema: Record<string, any>,
    targetSchema: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    for (const mapping of mappings) {
      // Check if source field exists
      if (!sourceSchema[mapping.sourceField]) {
        errors.push(`Source field '${mapping.sourceField}' not found in schema`);
      }
      
      // Check if target field exists
      if (!targetSchema[mapping.targetField]) {
        errors.push(`Target field '${mapping.targetField}' not found in schema`);
      }
      
      // Validate transformation config
      if (mapping.transformation === 'status_map' && 
          (!mapping.transformationConfig || !mapping.transformationConfig.statusMap)) {
        errors.push(`Status map transformation requires statusMap configuration for field '${mapping.sourceField}'`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}