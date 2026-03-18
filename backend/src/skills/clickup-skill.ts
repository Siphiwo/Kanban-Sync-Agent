import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  status: {
    id: string;
    status: string;
    color: string;
  };
  assignees: Array<{
    id: string;
    username: string;
    email: string;
  }>;
  due_date?: string;
  start_date?: string;
  priority?: {
    id: string;
    priority: string;
    color: string;
  };
  tags: Array<{
    name: string;
    tag_fg: string;
    tag_bg: string;
  }>;
  custom_fields: Array<{
    id: string;
    name: string;
    type: string;
    value?: any;
  }>;
  date_created: string;
  date_updated: string;
}

export interface ClickUpList {
  id: string;
  name: string;
  orderindex: number;
  status?: string;
  priority?: any;
  assignee?: any;
  task_count?: number;
  due_date?: string;
  start_date?: string;
  folder: {
    id: string;
    name: string;
  };
  space: {
    id: string;
    name: string;
  };
  statuses: Array<{
    id: string;
    status: string;
    orderindex: number;
    color: string;
    type: string;
  }>;
}

export interface ClickUpWorkspace {
  id: string;
  name: string;
  color: string;
  avatar?: string;
  members: Array<{
    user: {
      id: string;
      username: string;
      email: string;
    };
  }>;
}

export class ClickUpSkill {
  private client: AxiosInstance;
  private apiToken: string;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
    this.client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      headers: {
        'Authorization': apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add retry logic for rate limiting
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 60;
          logger.warn(`ClickUp rate limit hit, retrying after ${retryAfter}s`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  static async authenticate(apiToken: string): Promise<string> {
    try {
      // ClickUp uses API tokens, so we just verify the token works
      const client = axios.create({
        baseURL: 'https://api.clickup.com/api/v2',
        headers: {
          'Authorization': apiToken,
          'Content-Type': 'application/json'
        }
      });

      await client.get('/user');
      return apiToken;
    } catch (error) {
      logger.error('ClickUp API token verification error:', error);
      throw new Error('Invalid ClickUp API token');
    }
  }

  async getWorkspaces(): Promise<ClickUpWorkspace[]> {
    try {
      const response = await this.client.get('/team');
      return response.data.teams;
    } catch (error) {
      logger.error('Failed to get ClickUp workspaces:', error);
      throw new Error('Failed to fetch workspaces');
    }
  }

  async getLists(workspaceId: string, folderId?: string): Promise<ClickUpList[]> {
    try {
      let url = `/team/${workspaceId}/list`;
      if (folderId) {
        url = `/folder/${folderId}/list`;
      }

      const response = await this.client.get(url);
      return response.data.lists;
    } catch (error) {
      logger.error('Failed to get ClickUp lists:', error);
      throw new Error('Failed to fetch lists');
    }
  }

  async getTasks(listId: string, filters: Record<string, any> = {}): Promise<ClickUpTask[]> {
    try {
      const params = new URLSearchParams({
        include_closed: filters.include_closed || 'false',
        page: filters.page || '0',
        order_by: filters.order_by || 'created',
        reverse: filters.reverse || 'false',
        subtasks: filters.subtasks || 'false',
        statuses: filters.statuses || '',
        include_markdown_description: 'false',
        custom_fields: 'true',
        list_id: listId
      });

      const response = await this.client.get(`/list/${listId}/task?${params}`);
      return response.data.tasks;
    } catch (error) {
      logger.error('Failed to get ClickUp tasks:', error);
      throw new Error('Failed to fetch tasks');
    }
  }

  async createTask(listId: string, taskData: {
    name: string;
    description?: string;
    assignees?: string[];
    tags?: string[];
    status?: string;
    priority?: number;
    due_date?: number;
    start_date?: number;
    custom_fields?: Array<{
      id: string;
      value: any;
    }>;
  }): Promise<ClickUpTask> {
    try {
      const data = {
        name: taskData.name,
        description: taskData.description,
        assignees: taskData.assignees,
        tags: taskData.tags,
        status: taskData.status,
        priority: taskData.priority,
        due_date: taskData.due_date,
        start_date: taskData.start_date,
        custom_fields: taskData.custom_fields
      };

      const response = await this.client.post(`/list/${listId}/task`, data);
      return response.data;
    } catch (error) {
      logger.error('Failed to create ClickUp task:', error);
      throw new Error('Failed to create task');
    }
  }

  async updateTask(taskId: string, updates: Partial<{
    name: string;
    description: string;
    status: string;
    priority: number;
    due_date: number;
    start_date: number;
    assignees: {
      add: string[];
      rem: string[];
    };
    custom_fields: Array<{
      id: string;
      value: any;
    }>;
  }>): Promise<ClickUpTask> {
    try {
      const response = await this.client.put(`/task/${taskId}`, updates);
      return response.data;
    } catch (error) {
      logger.error('Failed to update ClickUp task:', error);
      throw new Error('Failed to update task');
    }
  }

  async getFieldSchema(listId?: string): Promise<any> {
    const fields: Record<string, any> = {
      name: { type: 'text', required: true },
      description: { type: 'text', required: false },
      status: { type: 'status', required: false, options: [] },
      priority: { type: 'priority', required: false },
      due_date: { type: 'date', required: false },
      start_date: { type: 'date', required: false },
      assignees: { type: 'array', required: false },
      tags: { type: 'array', required: false }
    };

    if (listId) {
      try {
        // Get custom fields for the list
        const response = await this.client.get(`/list/${listId}/field`);
        const customFields = response.data.fields;

        customFields.forEach((field: any) => {
          fields[`custom_field_${field.id}`] = {
            type: this.mapFieldType(field.type),
            name: field.name,
            required: field.required || false,
            options: field.type_config?.options || undefined
          };
        });

        // Get available statuses
        const listResponse = await this.client.get(`/list/${listId}`);
        const statuses = listResponse.data.statuses;
        
        if (statuses && statuses.length > 0) {
          fields.status.options = statuses.map((status: any) => ({
            id: status.id,
            name: status.status,
            color: status.color
          }));
        }
      } catch (error) {
        logger.error('Failed to get ClickUp list schema:', error);
      }
    }

    return fields;
  }

  private mapFieldType(clickupType: string): string {
    const typeMap: Record<string, string> = {
      'text': 'text',
      'textarea': 'text',
      'number': 'number',
      'currency': 'number',
      'dropdown': 'select',
      'labels': 'array',
      'users': 'user',
      'date': 'date',
      'checkbox': 'boolean',
      'rating': 'number',
      'email': 'email',
      'phone': 'phone',
      'url': 'url',
      'location': 'text',
      'formula': 'text'
    };

    return typeMap[clickupType] || 'text';
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.client.get('/user');
      return true;
    } catch (error) {
      logger.error('ClickUp connection verification failed:', error);
      return false;
    }
  }
}