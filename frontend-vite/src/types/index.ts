export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Connection {
  id: string;
  platform: Platform;
  platform_user_id: string;
  is_active: boolean;
  created_at: string;
}

export interface SyncRule {
  id: string;
  name: string;
  source_connection_id: string;
  target_connection_id: string;
  source_platform: Platform;
  target_platform: Platform;
  source_filter: Record<string, any>;
  target_mapping: Record<string, any>;
  webhook_events: string[];
  is_active: boolean;
  created_at: string;
}

export interface SyncLog {
  id: string;
  status: 'success' | 'error' | 'pending';
  source_task_id: string;
  target_task_id?: string;
  error_message?: string;
  sync_data: Record<string, any>;
  created_at: string;
}

export interface SyncHistory {
  id: string;
  rule_id: string;
  rule_name: string;
  source_platform: string;
  target_platform: string;
  status: 'success' | 'error' | 'pending';
  source_task_id?: string;
  target_task_id?: string;
  error_message?: string;
  sync_data: Record<string, any>;
  created_at: Date;
}

export interface SyncStatistics {
  total_syncs: number;
  successful_syncs: number;
  failed_syncs: number;
  success_rate: number;
  avg_sync_time: number;
  daily_stats: Array<{
    date: string;
    syncs: number;
    success_rate: number;
  }>;
}

export interface StatusReport {
  sync_status: {
    total_rules: number;
    active_rules: number;
    total_syncs_today: number;
    success_rate_today: number;
    last_sync: Date | null;
  };
  connection_health: Array<{
    platform: string;
    status: 'healthy' | 'warning' | 'error';
    last_check: Date;
    error_message?: string;
  }>;
  recent_errors: Array<{
    id: string;
    rule_name: string;
    error_message: string;
    created_at: Date;
  }>;
  recommendations: string[];
}

export interface ChatMessage {
  message: string;
  response: string;
  intent?: string;
  created_at: string;
}

export interface ChatResponse {
  text: string;
  intent?: string;
  actions?: Array<{
    type: string;
    path?: string;
  }>;
}

export type Platform = 'asana' | 'trello' | 'monday' | 'clickup' | 'jira';