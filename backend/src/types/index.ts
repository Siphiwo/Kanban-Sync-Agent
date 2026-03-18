export interface User {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface Connection {
  id: string;
  user_id: string;
  platform: Platform;
  platform_user_id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SyncRule {
  id: string;
  user_id: string;
  name: string;
  source_connection_id: string;
  target_connection_id: string;
  source_platform: 'asana' | 'trello';
  target_platform: 'asana' | 'trello';
  source_filter: Record<string, any>;
  target_mapping: Record<string, any>;
  is_active: boolean;
  webhook_events: string[];
  created_at: Date;
  updated_at: Date;
}

export interface SyncLog {
  id: string;
  rule_id: string;
  status: 'success' | 'error' | 'pending';
  source_task_id: string;
  target_task_id?: string;
  error_message?: string;
  sync_data: Record<string, any>;
  created_at: Date;
}

export interface WebhookEvent {
  id: string;
  platform: 'asana' | 'trello';
  event_type: string;
  resource_id: string;
  user_id?: string;
  payload: Record<string, any>;
  signature?: string;
  created_at: Date;
  processed: boolean;
  retry_count: number;
}

export type Platform = 'asana' | 'trello' | 'monday' | 'clickup' | 'jira';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  assignee?: string;
  due_date?: Date;
  labels?: string[];
  custom_fields?: Record<string, any>;
  platform_data: Record<string, any>;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  message: string;
  response: string;
  intent?: string;
  created_at: Date;
}

export interface WebhookPayload {
  platform: Platform;
  event_type: string;
  task_id: string;
  data: Record<string, any>;
}