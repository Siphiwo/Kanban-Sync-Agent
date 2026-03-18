/**
 * Data sanitization utilities to prevent sensitive information leakage
 */
export class DataSanitizer {
  
  /**
   * Remove sensitive fields from objects before sending to client
   */
  static sanitizeObject(obj: any, allowedFields: string[]): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => DataSanitizer.sanitizeObject(item, allowedFields));
    }

    const sanitized: any = {};
    for (const field of allowedFields) {
      if (obj.hasOwnProperty(field)) {
        sanitized[field] = obj[field];
      }
    }

    return sanitized;
  }

  /**
   * Sanitize connection data for client responses
   */
  static sanitizeConnection(connection: any): any {
    return DataSanitizer.sanitizeObject(connection, [
      'id',
      'platform', 
      'is_active',
      'created_at'
      // Exclude: access_token, refresh_token, platform_user_id, expires_at
    ]);
  }

  /**
   * Sanitize sync rule data for client responses
   */
  static sanitizeSyncRule(rule: any): any {
    return DataSanitizer.sanitizeObject(rule, [
      'id',
      'name',
      'source_platform',
      'target_platform',
      'is_active',
      'created_at',
      'updated_at'
      // Exclude: source_filter, target_mapping (may contain sensitive filters)
    ]);
  }

  /**
   * Sanitize sync log data for client responses
   */
  static sanitizeSyncLog(log: any): any {
    const sanitized = DataSanitizer.sanitizeObject(log, [
      'id',
      'status',
      'source_platform',
      'target_platform',
      'created_at'
      // Exclude: source_task_id, target_task_id, sync_data, error_message (may contain sensitive data)
    ]);

    // Add safe summary information
    if (log.sync_data) {
      sanitized.action = log.sync_data.action || 'unknown';
      sanitized.fieldCount = log.sync_data.mappedFields?.length || 0;
    }

    return sanitized;
  }

  /**
   * Sanitize error messages to remove sensitive information
   */
  static sanitizeErrorMessage(error: string): string {
    if (!error) return error;

    return error
      // Remove UUIDs
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[ID]')
      // Remove API keys/tokens
      .replace(/\b[A-Za-z0-9]{20,}\b/g, '[TOKEN]')
      // Remove URLs with sensitive info
      .replace(/https?:\/\/[^\s]+/g, '[URL]')
      // Remove email addresses
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      // Remove file paths
      .replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]')
      .replace(/\/[^\s]+/g, '[PATH]')
      // Limit length
      .substring(0, 200);
  }

  /**
   * Sanitize notification data for client responses
   */
  static sanitizeNotification(notification: any): any {
    const sanitized = DataSanitizer.sanitizeObject(notification, [
      'id',
      'type',
      'title',
      'message',
      'read',
      'created_at'
    ]);

    // Sanitize message content
    if (sanitized.message) {
      sanitized.message = DataSanitizer.sanitizeErrorMessage(sanitized.message);
    }

    return sanitized;
  }

  /**
   * Remove sensitive data from status reports
   */
  static sanitizeStatusReport(report: any): any {
    const sanitized = {
      overview: DataSanitizer.sanitizeObject(report.overview, [
        'totalRules',
        'activeRules',
        'totalSyncs',
        'successfulSyncs',
        'failedSyncs',
        'successRate',
        'lastSyncTime'
      ]),
      connections: report.connections?.map((conn: any) => 
        DataSanitizer.sanitizeObject(conn, [
          'platform',
          'isActive',
          'status'
        ])
      ) || [],
      recentHistory: report.recentHistory?.map((log: any) => 
        DataSanitizer.sanitizeSyncLog(log)
      ) || [],
      webhookHealth: report.webhookHealth?.map((webhook: any) =>
        DataSanitizer.sanitizeObject(webhook, [
          'platform',
          'isConfigured',
          'eventCount24h',
          'status'
        ])
      ) || [],
      recommendations: report.recommendations?.slice(0, 5).map((rec: string) =>
        DataSanitizer.sanitizeErrorMessage(rec)
      ) || []
    };

    return sanitized;
  }

  /**
   * Validate that response data doesn't contain sensitive patterns
   */
  static validateResponseSafety(response: any): boolean {
    const responseStr = JSON.stringify(response).toLowerCase();
    
    const sensitivePatterns = [
      /access_token/,
      /refresh_token/,
      /password/,
      /secret/,
      /private_key/,
      /api_key/,
      /bearer\s+[a-z0-9]+/,
      /authorization:\s*[a-z0-9]+/,
      /x-api-key:\s*[a-z0-9]+/
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(responseStr)) {
        return false;
      }
    }

    return true;
  }
}