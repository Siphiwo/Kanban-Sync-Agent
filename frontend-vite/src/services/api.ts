import axios from 'axios';
import { User, Connection, SyncRule, ChatResponse } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth API
export const authAPI = {
  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },
  
  register: async (email: string, name: string, password: string) => {
    const response = await api.post('/auth/register', { email, name, password });
    return response.data;
  }
};

// Connections API
export const connectionsAPI = {
  getConnections: async (): Promise<Connection[]> => {
    const response = await api.get('/connections');
    return response.data;
  },
  
  getConnectionDetails: async (id: string) => {
    const response = await api.get(`/connections/${id}/details`);
    return response.data;
  },
  
  deleteConnection: async (id: string) => {
    const response = await api.delete(`/connections/${id}`);
    return response.data;
  },
  
  testConnection: async (id: string) => {
    const response = await api.post(`/connections/${id}/test`);
    return response.data;
  }
};

// OAuth API
export const oauthAPI = {
  getAsanaAuthUrl: async () => {
    const response = await api.get('/oauth/asana/authorize');
    return response.data;
  },
  
  getTrelloAuthUrl: async () => {
    const response = await api.get('/oauth/trello/authorize');
    return response.data;
  },
  
  getMondayAuthUrl: async () => {
    const response = await api.get('/oauth/monday/authorize');
    return response.data;
  },
  
  getJiraAuthUrl: async () => {
    const response = await api.get('/oauth/jira/authorize');
    return response.data;
  },
  
  connectClickup: async (apiToken: string) => {
    const response = await api.post('/oauth/clickup/connect', { apiToken });
    return response.data;
  },
  
  verifyConnection: async (connectionId: string) => {
    const response = await api.post(`/oauth/verify/${connectionId}`);
    return response.data;
  }
};

// Rules API
export const rulesAPI = {
  getRules: async (): Promise<SyncRule[]> => {
    const response = await api.get('/rules');
    return response.data;
  },
  
  createRule: async (rule: {
    name: string;
    sourceConnectionId: string;
    targetConnectionId: string;
    sourceFilter?: Record<string, any>;
    targetMapping?: Record<string, any>;
    webhookEvents?: string[];
  }) => {
    const response = await api.post('/rules', rule);
    return response.data;
  },
  
  deleteRule: async (id: string) => {
    const response = await api.delete(`/rules/${id}`);
    return response.data;
  }
};

// Sync API
export const syncAPI = {
  executeRule: async (ruleId: string, payload?: Record<string, any>) => {
    const response = await api.post(`/sync/execute/${ruleId}`, payload || {});
    return response.data;
  },
  
  getSyncLogs: async (ruleId: string, limit = 50) => {
    const response = await api.get(`/sync/logs/${ruleId}?limit=${limit}`);
    return response.data;
  }
};

// Status API
export const statusAPI = {
  getReport: async () => {
    const response = await api.get('/status/report');
    return response.data;
  },
  
  getSyncStatus: async () => {
    const response = await api.get('/status/sync');
    return response.data;
  },
  
  getConnectionHealth: async () => {
    const response = await api.get('/status/connections');
    return response.data;
  },
  
  getSyncHistory: async (limit = 20) => {
    const response = await api.get(`/status/history?limit=${limit}`);
    return response.data;
  },
  
  getWebhookHealth: async () => {
    const response = await api.get('/status/webhooks');
    return response.data;
  },
  
  getStatistics: async (days = 7) => {
    const response = await api.get(`/status/statistics?days=${days}`);
    return response.data;
  }
};

// Chat API
export const chatAPI = {
  sendMessage: async (message: string): Promise<ChatResponse> => {
    const response = await api.post('/chat/message', { message });
    return response.data;
  },
  
  getHistory: async (limit = 50) => {
    const response = await api.get(`/chat/history?limit=${limit}`);
    return response.data;
  }
};