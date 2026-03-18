import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: any;
    status: {
      id: string;
      name: string;
      statusCategory: {
        id: number;
        key: string;
        colorName: string;
      };
    };
    assignee?: {
      accountId: string;
      displayName: string;
      emailAddress: string;
    };
    reporter?: {
      accountId: string;
      displayName: string;
      emailAddress: string;
    };
    priority?: {
      id: string;
      name: string;
      iconUrl: string;
    };
    labels: string[];
    duedate?: string;
    created: string;
    updated: string;
    issuetype: {
      id: string;
      name: string;
      iconUrl: string;
    };
    project: {
      id: string;
      key: string;
      name: string;
    };
    [key: string]: any; // For custom fields
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  lead?: {
    accountId: string;
    displayName: string;
  };
  projectTypeKey: string;
  simplified: boolean;
  style: string;
  isPrivate: boolean;
  issueTypes: Array<{
    id: string;
    name: string;
    description: string;
    iconUrl: string;
    subtask: boolean;
  }>;
}

export interface JiraWorkspace {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl: string;
}

export class JiraSkill {
  private client: AxiosInstance;
  private accessToken: string;
  private cloudId: string;

  constructor(accessToken: string, cloudId?: string) {
    this.accessToken = accessToken;
    this.cloudId = cloudId || '';
    
    this.client = axios.create({
      baseURL: cloudId ? `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3` : 'https://api.atlassian.com',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
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
          logger.warn(`Jira rate limit hit, retrying after ${retryAfter}s`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  static async authenticate(code: string, redirectUri: string): Promise<{ accessToken: string; cloudId: string }> {
    try {
      // Exchange code for access token
      const tokenResponse = await axios.post('https://auth.atlassian.com/oauth/token', {
        grant_type: 'authorization_code',
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        code: code,
        redirect_uri: redirectUri
      });

      const accessToken = tokenResponse.data.access_token;

      // Get accessible resources (cloud instances)
      const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });

      const resources = resourcesResponse.data;
      if (resources.length === 0) {
        throw new Error('No accessible Jira instances found');
      }

      // Use the first available cloud instance
      const cloudId = resources[0].id;

      return { accessToken, cloudId };
    } catch (error) {
      logger.error('Jira OAuth error:', error);
      throw new Error('Failed to authenticate with Jira');
    }
  }

  async getWorkspaces(): Promise<JiraWorkspace[]> {
    try {
      const response = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      return response.data.map((resource: any) => ({
        id: resource.id,
        url: resource.url,
        name: resource.name,
        scopes: resource.scopes,
        avatarUrl: resource.avatarUrl
      }));
    } catch (error) {
      logger.error('Failed to get Jira workspaces:', error);
      throw new Error('Failed to fetch workspaces');
    }
  }

  async getProjects(): Promise<JiraProject[]> {
    try {
      const response = await this.client.get('/project/search?expand=description,lead,issueTypes');
      return response.data.values;
    } catch (error) {
      logger.error('Failed to get Jira projects:', error);
      throw new Error('Failed to fetch projects');
    }
  }

  async getIssues(projectKey: string, filters: Record<string, any> = {}): Promise<JiraIssue[]> {
    try {
      const jql = this.buildJQL(projectKey, filters);
      const params = new URLSearchParams({
        jql,
        maxResults: (filters.maxResults || 100).toString(),
        startAt: (filters.startAt || 0).toString(),
        expand: 'names,schema,operations,editmeta,changelog,renderedFields'
      });

      const response = await this.client.get(`/search?${params}`);
      return response.data.issues;
    } catch (error) {
      logger.error('Failed to get Jira issues:', error);
      throw new Error('Failed to fetch issues');
    }
  }

  private buildJQL(projectKey: string, filters: Record<string, any>): string {
    let jql = `project = "${projectKey}"`;

    if (filters.status) {
      jql += ` AND status = "${filters.status}"`;
    }

    if (filters.assignee) {
      jql += ` AND assignee = "${filters.assignee}"`;
    }

    if (filters.issueType) {
      jql += ` AND issuetype = "${filters.issueType}"`;
    }

    if (filters.labels && filters.labels.length > 0) {
      const labelFilter = filters.labels.map((label: string) => `"${label}"`).join(',');
      jql += ` AND labels in (${labelFilter})`;
    }

    jql += ' ORDER BY created DESC';

    return jql;
  }

  async createIssue(projectKey: string, issueData: {
    summary: string;
    description?: string;
    issueType: string;
    assignee?: string;
    priority?: string;
    labels?: string[];
    duedate?: string;
    customFields?: Record<string, any>;
  }): Promise<JiraIssue> {
    try {
      const fields: any = {
        project: { key: projectKey },
        summary: issueData.summary,
        issuetype: { name: issueData.issueType }
      };

      if (issueData.description) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: issueData.description
                }
              ]
            }
          ]
        };
      }

      if (issueData.assignee) {
        fields.assignee = { accountId: issueData.assignee };
      }

      if (issueData.priority) {
        fields.priority = { name: issueData.priority };
      }

      if (issueData.labels && issueData.labels.length > 0) {
        fields.labels = issueData.labels;
      }

      if (issueData.duedate) {
        fields.duedate = issueData.duedate;
      }

      // Add custom fields
      if (issueData.customFields) {
        Object.assign(fields, issueData.customFields);
      }

      const response = await this.client.post('/issue', { fields });
      
      // Fetch the created issue with full details
      const createdIssue = await this.client.get(`/issue/${response.data.key}?expand=names,schema,operations,editmeta,changelog,renderedFields`);
      return createdIssue.data;
    } catch (error) {
      logger.error('Failed to create Jira issue:', error);
      throw new Error('Failed to create issue');
    }
  }

  async updateIssue(issueKey: string, updates: Partial<{
    summary: string;
    description: string;
    assignee: string;
    priority: string;
    labels: string[];
    duedate: string;
    status: string;
    customFields: Record<string, any>;
  }>): Promise<JiraIssue> {
    try {
      const fields: any = {};

      if (updates.summary) {
        fields.summary = updates.summary;
      }

      if (updates.description) {
        fields.description = {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: updates.description
                }
              ]
            }
          ]
        };
      }

      if (updates.assignee) {
        fields.assignee = { accountId: updates.assignee };
      }

      if (updates.priority) {
        fields.priority = { name: updates.priority };
      }

      if (updates.labels) {
        fields.labels = updates.labels;
      }

      if (updates.duedate) {
        fields.duedate = updates.duedate;
      }

      // Add custom fields
      if (updates.customFields) {
        Object.assign(fields, updates.customFields);
      }

      // Update fields
      if (Object.keys(fields).length > 0) {
        await this.client.put(`/issue/${issueKey}`, { fields });
      }

      // Handle status transition separately
      if (updates.status) {
        await this.transitionIssue(issueKey, updates.status);
      }

      // Fetch updated issue
      const updatedIssue = await this.client.get(`/issue/${issueKey}?expand=names,schema,operations,editmeta,changelog,renderedFields`);
      return updatedIssue.data;
    } catch (error) {
      logger.error('Failed to update Jira issue:', error);
      throw new Error('Failed to update issue');
    }
  }

  private async transitionIssue(issueKey: string, targetStatus: string): Promise<void> {
    try {
      // Get available transitions
      const transitionsResponse = await this.client.get(`/issue/${issueKey}/transitions`);
      const transitions = transitionsResponse.data.transitions;

      // Find transition to target status
      const transition = transitions.find((t: any) => 
        t.to.name.toLowerCase() === targetStatus.toLowerCase()
      );

      if (!transition) {
        logger.warn(`No transition found to status "${targetStatus}" for issue ${issueKey}`);
        return;
      }

      // Execute transition
      await this.client.post(`/issue/${issueKey}/transitions`, {
        transition: { id: transition.id }
      });
    } catch (error) {
      logger.error('Failed to transition Jira issue:', error);
      throw new Error('Failed to transition issue status');
    }
  }

  async getFieldSchema(projectKey?: string): Promise<any> {
    const fields: Record<string, any> = {
      summary: { type: 'text', required: true },
      description: { type: 'text', required: false },
      issuetype: { type: 'select', required: true, options: [] },
      assignee: { type: 'user', required: false },
      priority: { type: 'select', required: false, options: [] },
      labels: { type: 'array', required: false },
      duedate: { type: 'date', required: false }
    };

    if (projectKey) {
      try {
        // Get create metadata for the project
        const response = await this.client.get(`/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes.fields`);
        const project = response.data.projects[0];

        if (project && project.issuetypes.length > 0) {
          const issueType = project.issuetypes[0]; // Use first issue type as default
          const fieldMeta = issueType.fields;

          // Add issue types
          fields.issuetype.options = project.issuetypes.map((type: any) => ({
            id: type.id,
            name: type.name,
            description: type.description
          }));

          // Process custom fields
          Object.entries(fieldMeta).forEach(([fieldId, fieldInfo]: [string, any]) => {
            if (fieldId.startsWith('customfield_')) {
              fields[fieldId] = {
                type: this.mapFieldType(fieldInfo.schema?.type || 'string'),
                name: fieldInfo.name,
                required: fieldInfo.required || false,
                allowedValues: fieldInfo.allowedValues || undefined
              };
            }
          });

          // Get priorities
          const prioritiesResponse = await this.client.get('/priority');
          fields.priority.options = prioritiesResponse.data.map((priority: any) => ({
            id: priority.id,
            name: priority.name,
            description: priority.description
          }));
        }
      } catch (error) {
        logger.error('Failed to get Jira project schema:', error);
      }
    }

    return fields;
  }

  private mapFieldType(jiraType: string): string {
    const typeMap: Record<string, string> = {
      'string': 'text',
      'number': 'number',
      'date': 'date',
      'datetime': 'datetime',
      'option': 'select',
      'array': 'array',
      'user': 'user',
      'group': 'group',
      'version': 'select',
      'priority': 'select',
      'resolution': 'select',
      'status': 'status',
      'issuetype': 'select',
      'project': 'select'
    };

    return typeMap[jiraType] || 'text';
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.client.get('/myself');
      return true;
    } catch (error) {
      logger.error('Jira connection verification failed:', error);
      return false;
    }
  }
}