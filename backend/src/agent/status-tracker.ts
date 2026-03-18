import { query } from '../db';
import { logger } from '../utils/logger';
import { DataSanitizer } from './data-sanitizer';

export interface SyncStatus {
  totalRules: number;
  activeRules: number;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  successRate: number;
  lastSyncTime?: Date;
  recentErrors: SyncError[];
}

export interface ConnectionHealth {
  platform: string;
  isActive: boolean;
  lastUsed?: Date;
  errorCount: number;
  status: 'healthy' | 'warning' | 'error';
}

export interface SyncError {
  id: string;
  ruleId: string;
  ruleName: string;
  errorMessage: string;
  sourceTaskId: string;
  createdAt: Date;
  retryCount: number;
}

export interface SyncHistory {
  id: string;
  ruleId: string;
  ruleName: string;
  status: 'success' | 'error' | 'pending';
  sourceTaskId: string;
  targetTaskId?: string;
  sourcePlatform: string;
  targetPlatform: string;
  syncData: Record<string, any>;
  createdAt: Date;
  duration?: number;
}

export interface StatusReport {
  overview: SyncStatus;
  connections: ConnectionHealth[];
  recentHistory: SyncHistory[];
  webhookHealth: WebhookHealth[];
  recommendations: string[];
}

export interface WebhookHealth {
  platform: string;
  isConfigured: boolean;
  lastReceived?: Date;
  eventCount24h: number;
  status: 'healthy' | 'warning' | 'error';
}

export class StatusTracker {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Get comprehensive status report
   */
  async getStatusReport(): Promise<StatusReport> {
    try {
      const [overview, connections, recentHistory, webhookHealth] = await Promise.all([
        this.getSyncStatus(),
        this.getConnectionHealth(),
        this.getRecentSyncHistory(20),
        this.getWebhookHealth()
      ]);

      const recommendations = this.generateRecommendations(overview, connections, webhookHealth);

      const report = {
        overview,
        connections,
        recentHistory,
        webhookHealth,
        recommendations
      };

      // Sanitize the report before returning
      return DataSanitizer.sanitizeStatusReport(report);
    } catch (error) {
      logger.error('Failed to get status report:', error);
      throw error;
    }
  }

  /**
   * Get sync status overview
   */
  async getSyncStatus(): Promise<SyncStatus> {
    try {
      // Get rule counts
      const rulesResult = await query(`
        SELECT 
          COUNT(*) as total_rules,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_rules
        FROM sync_rules 
        WHERE user_id = $1
      `, [this.userId]);

      const { total_rules, active_rules } = rulesResult.rows[0] || { total_rules: 0, active_rules: 0 };

      // Get sync statistics for last 30 days
      const syncStatsResult = await query(`
        SELECT 
          COUNT(*) as total_syncs,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_syncs,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_syncs,
          MAX(created_at) as last_sync_time
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        WHERE sr.user_id = $1 
        AND sl.created_at >= NOW() - INTERVAL '30 days'
      `, [this.userId]);

      const { total_syncs, successful_syncs, failed_syncs, last_sync_time } = syncStatsResult.rows[0] || { 
        total_syncs: 0, 
        successful_syncs: 0, 
        failed_syncs: 0, 
        last_sync_time: null 
      };

      // Get recent errors
      const recentErrors = await this.getRecentErrors(5);

      const successRate = total_syncs > 0 ? (successful_syncs / total_syncs) * 100 : 0;

      return {
        totalRules: parseInt(total_rules) || 0,
        activeRules: parseInt(active_rules) || 0,
        totalSyncs: parseInt(total_syncs) || 0,
        successfulSyncs: parseInt(successful_syncs) || 0,
        failedSyncs: parseInt(failed_syncs) || 0,
        successRate: Math.round(successRate * 100) / 100,
        lastSyncTime: last_sync_time ? new Date(last_sync_time) : undefined,
        recentErrors
      };
    } catch (error) {
      logger.error('Failed to get sync status:', error);
      // Return empty status instead of throwing
      return {
        totalRules: 0,
        activeRules: 0,
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        successRate: 0,
        recentErrors: []
      };
    }
  }

  /**
   * Get connection health status
   */
  async getConnectionHealth(): Promise<ConnectionHealth[]> {
    try {
      const result = await query(`
        SELECT 
          c.platform,
          c.is_active,
          c.updated_at as last_used,
          COALESCE(error_counts.error_count, 0) as error_count
        FROM connections c
        LEFT JOIN (
          SELECT 
            sr.source_connection_id as connection_id,
            COUNT(*) as error_count
          FROM sync_logs sl
          JOIN sync_rules sr ON sl.rule_id = sr.id
          WHERE sl.status = 'error' 
          AND sl.created_at >= NOW() - INTERVAL '7 days'
          GROUP BY sr.source_connection_id
          
          UNION ALL
          
          SELECT 
            sr.target_connection_id as connection_id,
            COUNT(*) as error_count
          FROM sync_logs sl
          JOIN sync_rules sr ON sl.rule_id = sr.id
          WHERE sl.status = 'error' 
          AND sl.created_at >= NOW() - INTERVAL '7 days'
          GROUP BY sr.target_connection_id
        ) error_counts ON c.id = error_counts.connection_id
        WHERE c.user_id = $1
        GROUP BY c.platform, c.is_active, c.updated_at, error_counts.error_count
      `, [this.userId]);

      return result.rows.map((row: any) => {
        const errorCount = parseInt(row.error_count);
        let status: 'healthy' | 'warning' | 'error' = 'healthy';

        if (!row.is_active) {
          status = 'error';
        } else if (errorCount > 10) {
          status = 'error';
        } else if (errorCount > 3) {
          status = 'warning';
        }

        return {
          platform: row.platform,
          isActive: row.is_active,
          lastUsed: row.last_used ? new Date(row.last_used) : undefined,
          errorCount,
          status
        };
      });
    } catch (error) {
      logger.error('Failed to get connection health:', error);
      throw error;
    }
  }

  /**
   * Get recent sync history
   */
  async getRecentSyncHistory(limit: number = 20): Promise<SyncHistory[]> {
    try {
      const result = await query(`
        SELECT 
          sl.id,
          sl.rule_id,
          sr.name as rule_name,
          sl.status,
          sl.source_task_id,
          sl.target_task_id,
          sc.platform as source_platform,
          tc.platform as target_platform,
          sl.sync_data,
          sl.created_at,
          EXTRACT(EPOCH FROM (sl.updated_at - sl.created_at)) as duration
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        JOIN connections sc ON sr.source_connection_id = sc.id
        JOIN connections tc ON sr.target_connection_id = tc.id
        WHERE sr.user_id = $1
        ORDER BY sl.created_at DESC
        LIMIT $2
      `, [this.userId, limit]);

      return result.rows.map((row: any) => ({
        id: row.id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        status: row.status,
        sourceTaskId: row.source_task_id,
        targetTaskId: row.target_task_id,
        sourcePlatform: row.source_platform,
        targetPlatform: row.target_platform,
        syncData: JSON.parse(row.sync_data || '{}'),
        createdAt: new Date(row.created_at),
        duration: row.duration ? parseFloat(row.duration) : undefined
      }));
    } catch (error) {
      logger.error('Failed to get sync history:', error);
      // Return empty array instead of throwing
      return [];
    }
  }

  /**
   * Get webhook health status
   */
  async getWebhookHealth(): Promise<WebhookHealth[]> {
    try {
      // Get platforms with active connections
      const connectionsResult = await query(`
        SELECT DISTINCT platform 
        FROM connections 
        WHERE user_id = $1 AND is_active = true
      `, [this.userId]);

      const platforms = connectionsResult.rows.map((row: any) => row.platform);
      const webhookHealth: WebhookHealth[] = [];

      for (const platform of platforms) {
        // Check webhook events in last 24 hours
        const webhookResult = await query(`
          SELECT 
            COUNT(*) as event_count,
            MAX(created_at) as last_received
          FROM webhook_events 
          WHERE platform = $1 
          AND created_at >= NOW() - INTERVAL '24 hours'
        `, [platform]);

        const { event_count, last_received } = webhookResult.rows[0];
        const eventCount24h = parseInt(event_count);

        let status: 'healthy' | 'warning' | 'error' = 'healthy';
        const isConfigured = eventCount24h > 0 || last_received !== null;

        if (!isConfigured) {
          status = 'warning';
        } else if (last_received && new Date(last_received) < new Date(Date.now() - 6 * 60 * 60 * 1000)) {
          // No events in last 6 hours
          status = 'warning';
        }

        webhookHealth.push({
          platform,
          isConfigured,
          lastReceived: last_received ? new Date(last_received) : undefined,
          eventCount24h,
          status
        });
      }

      return webhookHealth;
    } catch (error) {
      logger.error('Failed to get webhook health:', error);
      throw error;
    }
  }

  /**
   * Get recent sync errors
   */
  async getRecentErrors(limit: number = 10): Promise<SyncError[]> {
    try {
      const result = await query(`
        SELECT 
          sl.id,
          sl.rule_id,
          sr.name as rule_name,
          sl.error_message,
          sl.source_task_id,
          sl.created_at,
          COALESCE(we.retry_count, 0) as retry_count
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        LEFT JOIN webhook_events we ON sl.source_task_id = we.resource_id
        WHERE sr.user_id = $1 
        AND sl.status = 'error'
        ORDER BY sl.created_at DESC
        LIMIT $2
      `, [this.userId, limit]);

      return result.rows.map((row: any) => ({
        id: row.id,
        ruleId: row.rule_id,
        ruleName: row.rule_name,
        errorMessage: row.error_message,
        sourceTaskId: row.source_task_id,
        createdAt: new Date(row.created_at),
        retryCount: parseInt(row.retry_count)
      }));
    } catch (error) {
      logger.error('Failed to get recent errors:', error);
      throw error;
    }
  }

  /**
   * Generate recommendations based on status
   */
  private generateRecommendations(
    overview: SyncStatus,
    connections: ConnectionHealth[],
    webhookHealth: WebhookHealth[]
  ): string[] {
    const recommendations: string[] = [];

    // Check success rate
    if (overview.successRate < 80 && overview.totalSyncs > 5) {
      recommendations.push('Your sync success rate is below 80%. Check recent errors and connection health.');
    }

    // Check inactive connections
    const inactiveConnections = connections.filter(c => !c.isActive);
    if (inactiveConnections.length > 0) {
      recommendations.push(`You have ${inactiveConnections.length} inactive connection(s). Reauthorize to resume syncing.`);
    }

    // Check connections with errors
    const errorConnections = connections.filter(c => c.status === 'error');
    if (errorConnections.length > 0) {
      recommendations.push(`${errorConnections.length} connection(s) have recent errors. Check your platform credentials.`);
    }

    // Check webhook health
    const unhealthyWebhooks = webhookHealth.filter(w => w.status !== 'healthy');
    if (unhealthyWebhooks.length > 0) {
      recommendations.push('Some webhooks are not working properly. This may delay sync updates.');
    }

    // Check if no rules are active
    if (overview.activeRules === 0 && overview.totalRules > 0) {
      recommendations.push('All your sync rules are disabled. Enable rules to start syncing.');
    }

    // Check if no recent syncs
    if (overview.lastSyncTime && overview.lastSyncTime < new Date(Date.now() - 24 * 60 * 60 * 1000)) {
      recommendations.push('No syncs in the last 24 hours. Check if your rules are configured correctly.');
    }

    // Positive recommendations
    if (recommendations.length === 0) {
      if (overview.successRate >= 95) {
        recommendations.push('Great! Your sync is working perfectly with a high success rate.');
      } else if (overview.successRate >= 80) {
        recommendations.push('Your sync is working well. Monitor for any occasional errors.');
      }
    }

    return recommendations;
  }

  /**
   * Get sync statistics for a specific time period
   */
  async getSyncStatistics(days: number = 7): Promise<{
    dailyStats: Array<{ date: string; syncs: number; errors: number }>;
    topErrors: Array<{ error: string; count: number }>;
    rulePerformance: Array<{ ruleName: string; successRate: number; totalSyncs: number }>;
  }> {
    try {
      // Daily statistics
      const dailyStatsResult = await query(`
        SELECT 
          DATE(sl.created_at) as date,
          COUNT(*) as syncs,
          COUNT(CASE WHEN sl.status = 'error' THEN 1 END) as errors
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        WHERE sr.user_id = $1 
        AND sl.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(sl.created_at)
        ORDER BY date DESC
      `, [this.userId]);

      // Top errors
      const topErrorsResult = await query(`
        SELECT 
          sl.error_message as error,
          COUNT(*) as count
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        WHERE sr.user_id = $1 
        AND sl.status = 'error'
        AND sl.created_at >= NOW() - INTERVAL '${days} days'
        AND sl.error_message IS NOT NULL
        GROUP BY sl.error_message
        ORDER BY count DESC
        LIMIT 5
      `, [this.userId]);

      // Rule performance
      const rulePerformanceResult = await query(`
        SELECT 
          sr.name as rule_name,
          COUNT(*) as total_syncs,
          COUNT(CASE WHEN sl.status = 'success' THEN 1 END) as successful_syncs
        FROM sync_logs sl
        JOIN sync_rules sr ON sl.rule_id = sr.id
        WHERE sr.user_id = $1 
        AND sl.created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY sr.id, sr.name
        HAVING COUNT(*) > 0
        ORDER BY total_syncs DESC
      `, [this.userId]);

      return {
        dailyStats: dailyStatsResult.rows.map((row: any) => ({
          date: row.date,
          syncs: parseInt(row.syncs),
          errors: parseInt(row.errors)
        })),
        topErrors: topErrorsResult.rows.map((row: any) => ({
          error: row.error,
          count: parseInt(row.count)
        })),
        rulePerformance: rulePerformanceResult.rows.map((row: any) => ({
          ruleName: row.rule_name,
          successRate: Math.round((parseInt(row.successful_syncs) / parseInt(row.total_syncs)) * 100),
          totalSyncs: parseInt(row.total_syncs)
        }))
      };
    } catch (error) {
      logger.error('Failed to get sync statistics:', error);
      throw error;
    }
  }
}