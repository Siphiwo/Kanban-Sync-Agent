import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { query } from '../db';

export interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  completed: boolean;
  assignee?: {
    gid: string;
    name: string;
  };
  due_on?: string;
  tags?: Array<{
    gid: string;
    name: string;
  }>;
  custom_fields?: Array<{
    gid: string;
    name: string;
    type: string;
    text_value?: string;
    number_value?: number;
    enum_value?: {
      gid: string;
      name: string;
    };
  }>;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
  color?: string;
  notes?: string;
}

export class AsanaSkill {
  private client: AxiosInstance;
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: 'https://app.asana.com/api/1.0',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 1;
          logger.warn(`Asana rate limit hit, retrying after ${retryAfter}s`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  static async authenticate(code: string, redirectUri: string): Promise<string> {
    try {
      const response = await axios.post('https://app.asana.com/-/oauth_token', {
        grant_type: 'authorization_code',
        client_id: process.env.ASANA_CLIENT_ID,
        client_secret: process.env.ASANA_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code: code
      });

      return response.data.access_token;
    } catch (error) {
      logger.error('Asana OAuth error:', error);
      throw new Error('Failed to authenticate with Asana');
    }
  }

  async getWorkspaces(): Promise<AsanaWorkspace[]> {
    try {
      const response = await this.client.get('/workspaces');
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Asana workspaces:', error);
      throw new Error('Failed to fetch workspaces');
    }
  }

  async getProjects(workspaceId: string): Promise<AsanaProject[]> {
    try {
      const response = await this.client.get(`/projects?workspace=${workspaceId}`);
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Asana projects:', error);
      throw new Error('Failed to fetch projects');
    }
  }

  async getTasks(projectId: string, filters: Record<string, any> = {}): Promise<AsanaTask[]> {
    try {
      const params = new URLSearchParams({
        project: projectId,
        opt_fields: 'gid,name,notes,completed,assignee.gid,assignee.name,due_on,tags.gid,tags.name,custom_fields.gid,custom_fields.name,custom_fields.type,custom_fields.text_value,custom_fields.number_value,custom_fields.enum_value.gid,custom_fields.enum_value.name',
        ...filters
      });

      const response = await this.client.get(`/tasks?${params}`);
      return response.data.data;
    } catch (error) {
      logger.error('Failed to get Asana tasks:', error);
      throw new Error('Failed to fetch tasks');
    }
  }

  async createTask(projectId: string, taskData: {
    name: string;
    notes?: string;
    assignee?: string;
    due_on?: string;
    tags?: string[];
    custom_fields?: Record<string, any>;
  }): Promise<AsanaTask> {
    try {
      const data = {
        data: {
          name: taskData.name,
          notes: taskData.notes,
          projects: [projectId],
          assignee: taskData.assignee,
          due_on: taskData.due_on,
          tags: taskData.tags,
          custom_fields: taskData.custom_fields
        }
      };

      const response = await this.client.post('/tasks', data);
      return response.data.data;
    } catch (error) {
      logger.error('Failed to create Asana task:', error);
      throw new Error('Failed to create task');
    }
  }

  async updateTask(taskId: string, updates: Partial<{
    name: string;
    notes: string;
    completed: boolean;
    assignee: string;
    due_on: string;
    tags: string[];
    custom_fields: Record<string, any>;
  }>): Promise<AsanaTask> {
    try {
      const data = { data: updates };
      const response = await this.client.put(`/tasks/${taskId}`, data);
      return response.data.data;
    } catch (error) {
      logger.error('Failed to update Asana task:', error);
      throw new Error('Failed to update task');
    }
  }

  async getFieldSchema(projectId?: string): Promise<any> {
    try {
      const fields = {
        name: { type: 'text', required: true },
        notes: { type: 'text', required: false },
        completed: { type: 'boolean', required: false },
        assignee: { type: 'user', required: false },
        due_on: { type: 'date', required: false },
        tags: { type: 'array', required: false }
      };

      // Get custom fields if project specified
      if (projectId) {
        const response = await this.client.get(`/projects/${projectId}/custom_field_settings`);
        const customFields = response.data.data;
        
        customFields.forEach((field: any) => {
          fields[`custom_field_${field.custom_field.gid}`] = {
            type: field.custom_field.type,
            name: field.custom_field.name,
            required: field.is_important || false
          };
        });
      }

      return fields;
    } catch (error) {
      logger.error('Failed to get Asana field schema:', error);
      throw new Error('Failed to fetch field schema');
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.client.get('/users/me');
      return true;
    } catch (error) {
      logger.error('Asana connection verification failed:', error);
      return false;
    }
  }
}