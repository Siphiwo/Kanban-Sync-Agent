import { logger } from '../utils/logger';

export interface Intent {
  name: string;
  confidence: number;
  parameters: Record<string, any>;
}

export interface IntentPattern {
  name: string;
  patterns: string[];
  parameters?: string[];
}

export class IntentParser {
  private static readonly INTENT_PATTERNS: IntentPattern[] = [
    {
      name: 'connect',
      patterns: [
        'connect to {platform}',
        'add {platform} connection',
        'link {platform}',
        'setup {platform}',
        'integrate with {platform}',
        'connect {platform} account'
      ],
      parameters: ['platform']
    },
    {
      name: 'setup_webhook',
      patterns: [
        'setup webhook',
        'configure webhook',
        'enable webhook',
        'create webhook',
        'register webhook'
      ]
    },
    {
      name: 'map_fields',
      patterns: [
        'map fields',
        'field mapping',
        'configure mapping',
        'setup field mapping',
        'map {source} to {target}',
        'how to map fields'
      ],
      parameters: ['source', 'target']
    },
    {
      name: 'create_rule',
      patterns: [
        'create rule',
        'setup sync',
        'sync {source} to {target}',
        'create sync rule',
        'setup sync rule',
        'sync from {source} to {target}',
        'sync {source} with {target}',
        'create sync between {source} and {target}'
      ],
      parameters: ['source', 'target']
    },
    {
      name: 'get_status',
      patterns: [
        'status',
        'sync status',
        'check status',
        'how is sync going',
        'sync health',
        'connection status',
        'show status',
        'what\'s the status'
      ]
    },
    {
      name: 'list_rules',
      patterns: [
        'list rules',
        'show rules',
        'my rules',
        'sync rules',
        'what rules do i have',
        'show my sync rules'
      ]
    },
    {
      name: 'list_connections',
      patterns: [
        'list connections',
        'show connections',
        'my connections',
        'connected platforms',
        'what platforms am i connected to',
        'show my platforms'
      ]
    },
    {
      name: 'help',
      patterns: [
        'help',
        'what can you do',
        'how to use',
        'commands',
        'what are my options',
        'how does this work'
      ]
    },
    {
      name: 'troubleshoot',
      patterns: [
        'sync not working',
        'sync failed',
        'error',
        'problem with sync',
        'sync issue',
        'troubleshoot',
        'fix sync',
        'why isn\'t sync working'
      ]
    }
  ];

  private static readonly PLATFORMS = [
    'asana', 'trello', 'monday', 'clickup', 'jira', 'notion', 'slack'
  ];

  /**
   * Parse user message and extract intent with confidence score
   */
  static parseIntent(message: string): Intent {
    const normalizedMessage = IntentParser.normalizeMessage(message);
    let bestMatch: Intent = { name: 'general', confidence: 0, parameters: {} };

    for (const intentPattern of IntentParser.INTENT_PATTERNS) {
      const match = IntentParser.matchPattern(normalizedMessage, intentPattern);
      if (match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
    }

    // If no strong match found, try fuzzy matching
    if (bestMatch.confidence < 0.6) {
      const fuzzyMatch = IntentParser.fuzzyMatch(normalizedMessage);
      if (fuzzyMatch.confidence > bestMatch.confidence) {
        bestMatch = fuzzyMatch;
      }
    }

    logger.debug('Intent parsed:', { 
      message: normalizedMessage, 
      intent: bestMatch.name, 
      confidence: bestMatch.confidence,
      parameters: bestMatch.parameters
    });

    return bestMatch;
  }

  /**
   * Normalize message for better matching
   */
  private static normalizeMessage(message: string): string {
    return message
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Match message against intent patterns
   */
  private static matchPattern(message: string, pattern: IntentPattern): Intent {
    let maxConfidence = 0;
    let bestParameters: Record<string, any> = {};

    for (const patternStr of pattern.patterns) {
      const match = IntentParser.matchSinglePattern(message, patternStr, pattern.parameters);
      if (match.confidence > maxConfidence) {
        maxConfidence = match.confidence;
        bestParameters = match.parameters;
      }
    }

    return {
      name: pattern.name,
      confidence: maxConfidence,
      parameters: bestParameters
    };
  }

  /**
   * Match message against a single pattern
   */
  private static matchSinglePattern(
    message: string, 
    pattern: string, 
    paramNames?: string[]
  ): { confidence: number; parameters: Record<string, any> } {
    const parameters: Record<string, any> = {};
    
    // Convert pattern to regex, handling parameters
    let regexPattern = pattern
      .replace(/\{(\w+)\}/g, (match, paramName) => {
        if (paramName === 'platform') {
          return `(${IntentParser.PLATFORMS.join('|')})`;
        }
        return '(\\w+)';
      })
      .replace(/\s+/g, '\\s+');

    const regex = new RegExp(regexPattern, 'i');
    const match = message.match(regex);

    if (match) {
      // Extract parameters
      if (paramNames && match.length > 1) {
        paramNames.forEach((paramName, index) => {
          if (match[index + 1]) {
            parameters[paramName] = match[index + 1];
          }
        });
      }

      // Calculate confidence based on match coverage
      const matchedLength = match[0].length;
      const messageLength = message.length;
      const coverage = matchedLength / messageLength;
      
      return {
        confidence: Math.min(0.9, coverage * 1.2), // Cap at 0.9, boost coverage
        parameters
      };
    }

    // Try partial matching for keywords
    const patternWords = pattern.replace(/\{(\w+)\}/g, '').split(/\s+/).filter(w => w.length > 2);
    const messageWords = message.split(/\s+/);
    
    let matchedWords = 0;
    for (const patternWord of patternWords) {
      if (messageWords.some(messageWord => 
        messageWord.includes(patternWord) || patternWord.includes(messageWord)
      )) {
        matchedWords++;
      }
    }

    const partialConfidence = patternWords.length > 0 ? matchedWords / patternWords.length : 0;
    
    // Extract platform parameters from message
    if (paramNames?.includes('platform')) {
      for (const platform of IntentParser.PLATFORMS) {
        if (message.includes(platform)) {
          parameters.platform = platform;
          break;
        }
      }
    }

    return {
      confidence: partialConfidence * 0.7, // Reduce confidence for partial matches
      parameters
    };
  }

  /**
   * Fuzzy matching for common variations and typos
   */
  private static fuzzyMatch(message: string): Intent {
    const fuzzyRules = [
      { keywords: ['sync', 'synchronize'], intent: 'create_rule', confidence: 0.5 },
      { keywords: ['connect', 'connection', 'link'], intent: 'connect', confidence: 0.5 },
      { keywords: ['status', 'health', 'check'], intent: 'get_status', confidence: 0.5 },
      { keywords: ['rule', 'rules'], intent: 'list_rules', confidence: 0.4 },
      { keywords: ['platform', 'platforms'], intent: 'list_connections', confidence: 0.4 },
      { keywords: ['help', 'assist', 'guide'], intent: 'help', confidence: 0.4 },
      { keywords: ['error', 'problem', 'issue', 'broken'], intent: 'troubleshoot', confidence: 0.5 },
      { keywords: ['webhook', 'hook'], intent: 'setup_webhook', confidence: 0.5 },
      { keywords: ['map', 'mapping', 'field'], intent: 'map_fields', confidence: 0.5 }
    ];

    let bestMatch: Intent = { name: 'general', confidence: 0, parameters: {} };

    for (const rule of fuzzyRules) {
      let matchCount = 0;
      for (const keyword of rule.keywords) {
        if (message.includes(keyword)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const confidence = (matchCount / rule.keywords.length) * rule.confidence;
        if (confidence > bestMatch.confidence) {
          bestMatch = {
            name: rule.intent,
            confidence,
            parameters: IntentParser.extractPlatformParameters(message)
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Extract platform parameters from message
   */
  private static extractPlatformParameters(message: string): Record<string, any> {
    const parameters: Record<string, any> = {};
    const foundPlatforms: string[] = [];

    for (const platform of IntentParser.PLATFORMS) {
      if (message.includes(platform)) {
        foundPlatforms.push(platform);
      }
    }

    if (foundPlatforms.length >= 1) {
      parameters.source = foundPlatforms[0];
    }
    if (foundPlatforms.length >= 2) {
      parameters.target = foundPlatforms[1];
    }
    if (foundPlatforms.length === 1) {
      parameters.platform = foundPlatforms[0];
    }

    return parameters;
  }

  /**
   * Get suggested follow-up questions based on intent
   */
  static getSuggestions(intent: string): string[] {
    const suggestions: Record<string, string[]> = {
      connect: [
        'Connect to Asana',
        'Connect to Trello',
        'Show my connections'
      ],
      create_rule: [
        'Sync Asana to Trello',
        'Create rule with filters',
        'Map custom fields'
      ],
      get_status: [
        'Show sync history',
        'Check connection health',
        'View recent errors'
      ],
      list_rules: [
        'Create new rule',
        'Edit existing rule',
        'Disable rule'
      ],
      help: [
        'How to connect platforms',
        'How to create sync rules',
        'Troubleshoot sync issues'
      ],
      general: [
        'Connect to a platform',
        'Create sync rule',
        'Check sync status',
        'Get help'
      ]
    };

    return suggestions[intent] || suggestions.general;
  }
}