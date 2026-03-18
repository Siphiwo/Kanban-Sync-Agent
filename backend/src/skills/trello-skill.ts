import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  due?: string;
  idMembers: string[];
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  customFieldItems?: Array<{
    id: string;
    value: any;
    idCustomField: string;
  }>;
}

export interface TrelloBoard {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}

export class TrelloSkill {
  private client: AxiosInstance;
  private apiKey: string;
  private token: string;

  constructor(token: string) {
    this.apiKey = process.env.TRELLO_API_KEY!;
    this.token = token;
    
    this.client = axios.create({
      baseURL: 'https://api.trello.com/1',
      timeout: 30000
    });

    // Add retry logic
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 429) {
          logger.warn('Trello rate limit hit, retrying after 1s');
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.client.request(error.config);
        }
        throw error;
      }
    );
  }

  static async authenticate(code: string, redirectUri: string): Promise<string> {
    try {
      const response = await axios.post('https://trello.com/1/OAuthGetAccessToken', {
        oauth_verifier: code,
        oauth_token: process.env.TRELLO_API_KEY,
        oauth_token_secret: process.env.TRELLO_API_SECRET
      });

      // Parse the response (Trello returns URL-encoded data)
      const params = new URLSearchParams(response.data);
      return params.get('oauth_token')!;
    } catch (error) {
      logger.error('Trello OAuth error:', error);
      throw new Error('Failed to authenticate with Trello');
    }
  }

  private getAuthParams(): Record<string, string> {
    return {
      key: this.apiKey,
      token: this.token
    };
  }

  async getBoards(): Promise<TrelloBoard[]> {
    try {
      const params = new URLSearchParams(this.getAuthParams());
      const response = await this.client.get(`/members/me/boards?${params}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get Trello boards:', error);
      throw new Error('Failed to fetch boards');
    }
  }

  async getLists(boardId: string): Promise<TrelloList[]> {
    try {
      const params = new URLSearchParams(this.getAuthParams());
      const response = await this.client.get(`/boards/${boardId}/lists?${params}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get Trello lists:', error);
      throw new Error('Failed to fetch lists');
    }
  }

  async getCards(listId: string, filters: Record<string, any> = {}): Promise<TrelloCard[]> {
    try {
      const params = new URLSearchParams({
        ...this.getAuthParams(),
        ...filters
      });
      
      const response = await this.client.get(`/lists/${listId}/cards?${params}&customFieldItems=true&members=true&labels=true`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get Trello cards:', error);
      throw new Error('Failed to fetch cards');
    }
  }

  async createCard(listId: string, cardData: {
    name: string;
    desc?: string;
    due?: string;
    idMembers?: string[];
    idLabels?: string[];
    customFields?: Record<string, any>;
  }): Promise<TrelloCard> {
    try {
      const data = {
        ...this.getAuthParams(),
        idList: listId,
        name: cardData.name,
        desc: cardData.desc,
        due: cardData.due,
        idMembers: cardData.idMembers?.join(','),
        idLabels: cardData.idLabels?.join(',')
      };

      const response = await this.client.post('/cards', data);
      
      // Handle custom fields separately if provided
      if (cardData.customFields) {
        await this.updateCardCustomFields(response.data.id, cardData.customFields);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to create Trello card:', error);
      throw new Error('Failed to create card');
    }
  }

  async updateCard(cardId: string, updates: Partial<{
    name: string;
    desc: string;
    closed: boolean;
    due: string;
    idMembers: string[];
    idLabels: string[];
    customFields: Record<string, any>;
  }>): Promise<TrelloCard> {
    try {
      const data: any = {
        ...this.getAuthParams()
      };

      // Add non-array fields directly
      if (updates.name) data.name = updates.name;
      if (updates.desc) data.desc = updates.desc;
      if (updates.closed !== undefined) data.closed = updates.closed;
      if (updates.due) data.due = updates.due;

      // Convert arrays to comma-separated strings for Trello API
      if (updates.idMembers) {
        data.idMembers = updates.idMembers.join(',');
      }
      if (updates.idLabels) {
        data.idLabels = updates.idLabels.join(',');
      }

      const response = await this.client.put(`/cards/${cardId}`, data);
      
      // Handle custom fields separately if provided
      if (updates.customFields) {
        await this.updateCardCustomFields(cardId, updates.customFields);
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to update Trello card:', error);
      throw new Error('Failed to update card');
    }
  }

  private async updateCardCustomFields(cardId: string, customFields: Record<string, any>): Promise<void> {
    try {
      for (const [fieldId, value] of Object.entries(customFields)) {
        const data = {
          ...this.getAuthParams(),
          value: JSON.stringify(value)
        };
        
        await this.client.put(`/cards/${cardId}/customField/${fieldId}/item`, data);
      }
    } catch (error) {
      logger.error('Failed to update Trello custom fields:', error);
      throw new Error('Failed to update custom fields');
    }
  }

  async getFieldSchema(boardId?: string): Promise<any> {
    try {
      const fields = {
        name: { type: 'text', required: true },
        desc: { type: 'text', required: false },
        closed: { type: 'boolean', required: false },
        due: { type: 'date', required: false },
        idMembers: { type: 'array', required: false },
        idLabels: { type: 'array', required: false }
      };

      // Get custom fields if board specified
      if (boardId) {
        const params = new URLSearchParams(this.getAuthParams());
        const response = await this.client.get(`/boards/${boardId}/customFields?${params}`);
        const customFields = response.data;
        
        customFields.forEach((field: any) => {
          fields[`custom_field_${field.id}`] = {
            type: field.type,
            name: field.name,
            required: false
          };
        });
      }

      return fields;
    } catch (error) {
      logger.error('Failed to get Trello field schema:', error);
      throw new Error('Failed to fetch field schema');
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const params = new URLSearchParams(this.getAuthParams());
      await this.client.get(`/members/me?${params}`);
      return true;
    } catch (error) {
      logger.error('Trello connection verification failed:', error);
      return false;
    }
  }
}