-- Performance optimization indexes for KanbanSync

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Connections table indexes
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_platform ON connections(platform);
CREATE INDEX IF NOT EXISTS idx_connections_active ON connections(is_active);
CREATE INDEX IF NOT EXISTS idx_connections_user_platform ON connections(user_id, platform);

-- Sync rules table indexes
CREATE INDEX IF NOT EXISTS idx_sync_rules_user_id ON sync_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_rules_source_conn ON sync_rules(source_connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_rules_target_conn ON sync_rules(target_connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_rules_active ON sync_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_sync_rules_user_active ON sync_rules(user_id, is_active);

-- Sync logs table indexes
CREATE INDEX IF NOT EXISTS idx_sync_logs_rule_id ON sync_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_logs_rule_status ON sync_logs(rule_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_rule_created ON sync_logs(rule_id, created_at DESC);

-- Webhook events table indexes
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id ON webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_platform ON webhook_events(platform);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user_processed ON webhook_events(user_id, processed);
CREATE INDEX IF NOT EXISTS idx_webhook_events_platform_processed ON webhook_events(platform, processed);

-- Chat messages table indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages(user_id, created_at DESC);

-- Notifications table indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sync_logs_recent_by_rule ON sync_logs(rule_id, created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_pending ON webhook_events(processed, created_at) WHERE processed = false;

-- Partial indexes for better performance
CREATE INDEX IF NOT EXISTS idx_active_connections ON connections(user_id, platform) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_active_rules ON sync_rules(user_id, source_connection_id, target_connection_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_failed_syncs ON sync_logs(rule_id, created_at DESC) WHERE status = 'error';

-- Add constraints for data integrity
ALTER TABLE connections ADD CONSTRAINT chk_platform_valid 
  CHECK (platform IN ('asana', 'trello', 'monday', 'clickup', 'jira'));

ALTER TABLE sync_logs ADD CONSTRAINT chk_status_valid 
  CHECK (status IN ('success', 'error', 'pending'));

-- Update table statistics for better query planning
ANALYZE users;
ANALYZE connections;
ANALYZE sync_rules;
ANALYZE sync_logs;
ANALYZE webhook_events;
ANALYZE chat_messages;
ANALYZE notifications;