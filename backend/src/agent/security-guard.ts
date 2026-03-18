import { logger } from '../utils/logger';

export interface SecurityCheck {
  isValid: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export class SecurityGuard {
  private static readonly MAX_MESSAGE_LENGTH = 2000;
  private static readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private static readonly MAX_REQUESTS_PER_WINDOW = 10;
  
  // Track user request rates
  private static userRequestCounts = new Map<string, { count: number; windowStart: number }>();

  /**
   * Comprehensive security validation for chat messages
   */
  static validateMessage(message: string, userId: string): SecurityCheck {
    // Rate limiting check
    const rateLimitCheck = SecurityGuard.checkRateLimit(userId);
    if (!rateLimitCheck.isValid) {
      return rateLimitCheck;
    }

    // Length validation
    if (message.length > SecurityGuard.MAX_MESSAGE_LENGTH) {
      logger.warn('Message too long:', { userId, length: message.length });
      return {
        isValid: false,
        reason: 'Message exceeds maximum length',
        riskLevel: 'medium'
      };
    }

    // Prompt injection detection
    const injectionCheck = SecurityGuard.detectPromptInjection(message);
    if (!injectionCheck.isValid) {
      logger.warn('Prompt injection detected:', { userId, message: message.substring(0, 100) });
      return injectionCheck;
    }

    // Sensitive information extraction attempts
    const sensitiveCheck = SecurityGuard.detectSensitiveQueries(message);
    if (!sensitiveCheck.isValid) {
      logger.warn('Sensitive information query detected:', { userId, message: message.substring(0, 100) });
      return sensitiveCheck;
    }

    // Malicious pattern detection
    const maliciousCheck = SecurityGuard.detectMaliciousPatterns(message);
    if (!maliciousCheck.isValid) {
      logger.warn('Malicious pattern detected:', { userId, message: message.substring(0, 100) });
      return maliciousCheck;
    }

    return { isValid: true, riskLevel: 'low' };
  }

  /**
   * Rate limiting to prevent abuse
   */
  private static checkRateLimit(userId: string): SecurityCheck {
    const now = Date.now();
    const userRequests = SecurityGuard.userRequestCounts.get(userId);

    if (!userRequests || now - userRequests.windowStart > SecurityGuard.RATE_LIMIT_WINDOW) {
      // New window or first request
      SecurityGuard.userRequestCounts.set(userId, { count: 1, windowStart: now });
      return { isValid: true, riskLevel: 'low' };
    }

    if (userRequests.count >= SecurityGuard.MAX_REQUESTS_PER_WINDOW) {
      return {
        isValid: false,
        reason: 'Rate limit exceeded. Please wait before sending more messages.',
        riskLevel: 'high'
      };
    }

    // Increment count
    userRequests.count++;
    return { isValid: true, riskLevel: 'low' };
  }

  /**
   * Detect prompt injection attempts
   */
  private static detectPromptInjection(message: string): SecurityCheck {
    const lowerMessage = message.toLowerCase();
    
    // Common prompt injection patterns
    const injectionPatterns = [
      // System prompt manipulation
      /ignore\s+(previous|all)\s+(instructions|prompts|rules)/i,
      /forget\s+(everything|all)\s+(above|before|previous)/i,
      /you\s+are\s+now\s+a\s+different/i,
      /act\s+as\s+(if\s+you\s+are\s+)?a\s+different/i,
      /pretend\s+(to\s+be\s+)?a\s+different/i,
      /roleplay\s+as/i,
      
      // System information extraction
      /what\s+(is\s+)?your\s+(system\s+)?(prompt|instructions|rules)/i,
      /show\s+me\s+your\s+(system\s+)?(prompt|instructions|code)/i,
      /reveal\s+your\s+(system\s+)?(prompt|instructions|configuration)/i,
      /tell\s+me\s+about\s+your\s+(system\s+)?(prompt|instructions|implementation)/i,
      
      // Jailbreak attempts
      /\[system\]/i,
      /\[\/system\]/i,
      /\<system\>/i,
      /\<\/system\>/i,
      /sudo\s+mode/i,
      /developer\s+mode/i,
      /debug\s+mode/i,
      /admin\s+mode/i,
      
      // Code execution attempts
      /execute\s+(code|command|script)/i,
      /run\s+(code|command|script)/i,
      /eval\s*\(/i,
      /exec\s*\(/i,
      
      // Bypass attempts
      /bypass\s+(security|safety|restrictions)/i,
      /override\s+(security|safety|restrictions)/i,
      /disable\s+(security|safety|restrictions)/i,
      
      // Instruction manipulation
      /new\s+instructions?:/i,
      /updated\s+instructions?:/i,
      /additional\s+instructions?:/i,
      /special\s+instructions?:/i,
    ];

    for (const pattern of injectionPatterns) {
      if (pattern.test(message)) {
        return {
          isValid: false,
          reason: 'Potential prompt injection detected',
          riskLevel: 'high'
        };
      }
    }

    // Check for excessive special characters (obfuscation attempts)
    const specialCharCount = (message.match(/[^\w\s.,!?-]/g) || []).length;
    const specialCharRatio = specialCharCount / message.length;
    
    if (specialCharRatio > 0.3 && message.length > 50) {
      return {
        isValid: false,
        reason: 'Suspicious character patterns detected',
        riskLevel: 'medium'
      };
    }

    return { isValid: true, riskLevel: 'low' };
  }

  /**
   * Detect attempts to extract sensitive information
   */
  private static detectSensitiveQueries(message: string): SecurityCheck {
    const lowerMessage = message.toLowerCase();
    
    const sensitivePatterns = [
      // Database/API keys
      /show\s+me\s+(database|api|secret|private)\s+keys?/i,
      /what\s+(is\s+)?your\s+(database|api|secret|private)\s+key/i,
      /reveal\s+(database|api|secret|private)\s+keys?/i,
      
      // User data
      /show\s+me\s+(all\s+)?user\s+(data|information|details)/i,
      /list\s+(all\s+)?users?/i,
      /dump\s+(user\s+)?database/i,
      /export\s+(user\s+)?data/i,
      
      // System information
      /show\s+me\s+(system|server|environment)\s+(variables|config|settings)/i,
      /what\s+(is\s+)?your\s+(system|server|environment)\s+configuration/i,
      /reveal\s+(system|server|environment)\s+details/i,
      
      // Authentication
      /show\s+me\s+(passwords|tokens|credentials)/i,
      /what\s+(are\s+)?the\s+(passwords|tokens|credentials)/i,
      /reveal\s+(authentication|login)\s+details/i,
      
      // Internal paths/structure
      /show\s+me\s+(file\s+)?structure/i,
      /list\s+(all\s+)?files?/i,
      /show\s+me\s+(source\s+)?code/i,
      /reveal\s+internal\s+structure/i,
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(message)) {
        return {
          isValid: false,
          reason: 'Attempt to access sensitive information detected',
          riskLevel: 'high'
        };
      }
    }

    return { isValid: true, riskLevel: 'low' };
  }

  /**
   * Detect other malicious patterns
   */
  private static detectMaliciousPatterns(message: string): SecurityCheck {
    const lowerMessage = message.toLowerCase();
    
    const maliciousPatterns = [
      // SQL injection attempts
      /union\s+select/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /insert\s+into/i,
      /update\s+.*\s+set/i,
      
      // XSS attempts
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      
      // Path traversal
      /\.\.\//,
      /\.\.\\/,
      
      // Command injection
      /;\s*(rm|del|format|shutdown)/i,
      /\|\s*(rm|del|format|shutdown)/i,
      /&&\s*(rm|del|format|shutdown)/i,
      
      // Social engineering
      /urgent\s+security\s+update/i,
      /immediate\s+action\s+required/i,
      /verify\s+your\s+account/i,
      /suspended\s+account/i,
    ];

    for (const pattern of maliciousPatterns) {
      if (pattern.test(message)) {
        return {
          isValid: false,
          reason: 'Malicious pattern detected',
          riskLevel: 'high'
        };
      }
    }

    return { isValid: true, riskLevel: 'low' };
  }

  /**
   * Sanitize user input
   */
  static sanitizeInput(input: string): string {
    return input
      .trim()
      .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, SecurityGuard.MAX_MESSAGE_LENGTH); // Enforce length limit
  }

  /**
   * Generate safe error response for security violations
   */
  static generateSecurityResponse(check: SecurityCheck): string {
    switch (check.riskLevel) {
      case 'high':
        return "I can't process that request. Please ask me about KanbanSync features like connecting platforms, creating sync rules, or checking sync status.";
      case 'medium':
        return "I didn't understand that request. I can help you with syncing tasks between platforms, managing connections, and checking sync status.";
      default:
        return "I'm here to help with KanbanSync. Try asking about connecting platforms, creating sync rules, or checking your sync status.";
    }
  }

  /**
   * Log security incidents for monitoring
   */
  static logSecurityIncident(userId: string, message: string, check: SecurityCheck): void {
    logger.warn('Security incident detected:', {
      userId,
      riskLevel: check.riskLevel,
      reason: check.reason,
      messagePreview: message.substring(0, 100),
      timestamp: new Date().toISOString()
    });

    // In production, you might want to:
    // - Send alerts to security team
    // - Update user risk scores
    // - Implement progressive restrictions
    // - Store incidents in security audit log
  }

  /**
   * Clean up old rate limit data
   */
  static cleanupRateLimitData(): void {
    const now = Date.now();
    for (const [userId, data] of SecurityGuard.userRequestCounts.entries()) {
      if (now - data.windowStart > SecurityGuard.RATE_LIMIT_WINDOW * 2) {
        SecurityGuard.userRequestCounts.delete(userId);
      }
    }
  }
}