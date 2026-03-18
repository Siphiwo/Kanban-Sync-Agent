import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface MondayItem {
  id: string;
  name: string;
  state: string;
  column_values: Array<{
    id: string;
    title: string;
    type: string;
    text?: string;
    value?: any;
  }>;
  creator_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MondayBoard {
  id: string;
  name: string;
  description?: string;
  state: string;
  board_kind: string;
  columns: Array<{
    id: string;
    title: string;
    type: string;
    settings_str?: string;
  }>;
}

export interface MondayWorkspace {
  id: string;
  name: string;
  kind: string;
  description?: string;
}

export class MondaySkill {
  private client: AxiosInstance;
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: 'https://api.monday.com/v2',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'API-Version': '2023-10'
      },
      timeout: 30000
    });

    // Add retry logic for rate limiting
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'] || 60;
          logger.warn(`Monday.com rate limit hit, retrying after ${retryAfter}s`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  static async authenticate(code: string, redirectUri: string): Promise<string> {
    try {
      const response = await axios.post('https://auth.monday.com/oauth2/token', {
        client_id: process.env.MONDAY_CLIENT_ID,
        client_secret: process.env.MONDAY_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code: code
      });

      return response.data.access_token;
    } catch (error) {
      logger.error('Monday.com OAuth error:', error);
      throw new Error('Failed to authenticate with Monday.com');
    }
  }

  private async graphqlQuery(query: string, variables?: Record<string, any>): Promise<any> {
    try {
      const response = await this.client.post('/', {
        query,
        variables
      });

      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      logger.error('Monday.com GraphQL query failed:', error);
      throw error;
    }
  }

  async getWorkspaces(): Promise<MondayWorkspace[]> {
    const query = `
      query {
        workspaces {
          id
          name
          kind
          description
        }
      }
    `;

    try {
      const data = await this.graphqlQuery(query);
      return data.workspaces;
    } catch (error) {
      logger.error('Failed to get Monday.com workspaces:', error);
      throw new Error('Failed to fetch workspaces');
    }
  }

  async getBoards(workspaceId?: string): Promise<MondayBoard[]> {
    const query = `
      query($workspaceIds: [Int]) {
        boards(workspace_ids: $workspaceIds) {
          id
          name
          description
          state
          board_kind
          columns {
            id
            title
            type
            settings_str
          }
        }
      }
    `;

    try {
      const variables = workspaceId ? { workspaceIds: [parseInt(workspaceId)] } : undefined;
      const data = await this.graphqlQuery(query, variables);
      return data.boards;
    } catch (error) {
      logger.error('Failed to get Monday.com boards:', error);
      throw new Error('Failed to fetch boards');
    }
  }

  async getItems(boardId: string, filters: Record<string, any> = {}): Promise<MondayItem[]> {
    const query = `
      query($boardId: [Int!], $limit: Int) {
        boards(ids: $boardId) {
          items(limit: $limit) {
            id
            name
            state
            column_values {
              id
              title
              type
              text
              value
            }
            creator_id
            created_at
            updated_at
          }
        }
      }
    `;

    try {
      const variables = {
        boardId: [parseInt(boardId)],
        limit: filters.limit || 100
      };
      
      const data = await this.graphqlQuery(query, variables);
      return data.boards[0]?.items || [];
    } catch (error) {
      logger.error('Failed to get Monday.com items:', error);
      throw new Error('Failed to fetch items');
    }
  }

  async createItem(boardId: string, itemData: {
    name: string;
    columnValues?: Record<string, any>;
    groupId?: string;
  }): Promise<MondayItem> {
    const mutation = `
      mutation($boardId: Int!, $itemName: String!, $columnValues: JSON, $groupId: String) {
        create_item(
          board_id: $boardId, 
          item_name: $itemName, 
          column_values: $columnValues,
          group_id: $groupId
        ) {
          id
          name
          state
          column_values {
            id
            title
            type
            text
            value
          }
          created_at
        }
      }
    `;

    try {
      const variables = {
        boardId: parseInt(boardId),
        itemName: itemData.name,
        columnValues: itemData.columnValues ? JSON.stringify(itemData.columnValues) : undefined,
        groupId: itemData.groupId
      };

      const data = await this.graphqlQuery(mutation, variables);
      return data.create_item;
    } catch (error) {
      logger.error('Failed to create Monday.com item:', error);
      throw new Error('Failed to create item');
    }
  }

  async updateItem(itemId: string, updates: Partial<{
    name: string;
    columnValues: Record<string, any>;
  }>): Promise<MondayItem> {
    const mutations: string[] = [];
    const variables: Record<string, any> = { itemId: parseInt(itemId) };

    if (updates.name) {
      mutations.push(`
        change_item_name: change_simple_column_value(
          item_id: $itemId,
          column_id: "name",
          value: $itemName
        ) { id }
      `);
      variables.itemName = updates.name;
    }

    if (updates.columnValues) {
      mutations.push(`
        change_column_values: change_multiple_column_values(
          item_id: $itemId,
          column_values: $columnValues
        ) { id }
      `);
      variables.columnValues = JSON.stringify(updates.columnValues);
    }

    if (mutations.length === 0) {
      throw new Error('No updates provided');
    }

    const mutation = `
      mutation($itemId: Int!, $itemName: String, $columnValues: JSON) {
        ${mutations.join('\n')}
        
        item: items(ids: [$itemId]) {
          id
          name
          state
          column_values {
            id
            title
            type
            text
            value
          }
          updated_at
        }
      }
    `;

    try {
      const data = await this.graphqlQuery(mutation, variables);
      return data.item[0];
    } catch (error) {
      logger.error('Failed to update Monday.com item:', error);
      throw new Error('Failed to update item');
    }
  }

  async getFieldSchema(boardId?: string): Promise<any> {
    const fields = {
      name: { type: 'text', required: true },
      state: { type: 'status', required: false }
    };

    if (boardId) {
      try {
        const query = `
          query($boardId: [Int!]) {
            boards(ids: $boardId) {
              columns {
                id
                title
                type
                settings_str
              }
            }
          }
        `;

        const data = await this.graphqlQuery(query, { boardId: [parseInt(boardId)] });
        const columns = data.boards[0]?.columns || [];

        columns.forEach((column: any) => {
          fields[`column_${column.id}`] = {
            type: this.mapColumnType(column.type),
            name: column.title,
            required: false,
            settings: column.settings_str ? JSON.parse(column.settings_str) : undefined
          };
        });
      } catch (error) {
        logger.error('Failed to get Monday.com board schema:', error);
      }
    }

    return fields;
  }

  private mapColumnType(mondayType: string): string {
    const typeMap: Record<string, string> = {
      'text': 'text',
      'long-text': 'text',
      'numbers': 'number',
      'status': 'status',
      'dropdown': 'select',
      'people': 'user',
      'date': 'date',
      'timeline': 'daterange',
      'checkbox': 'boolean',
      'rating': 'number',
      'email': 'email',
      'phone': 'phone',
      'link': 'url'
    };

    return typeMap[mondayType] || 'text';
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const query = `
        query {
          me {
            id
            name
          }
        }
      `;
      
      await this.graphqlQuery(query);
      return true;
    } catch (error) {
      logger.error('Monday.com connection verification failed:', error);
      return false;
    }
  }
}