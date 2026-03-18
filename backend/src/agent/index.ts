import { query } from '../db';
import { logger } from '../utils/logger';
import { IntentParser, Intent } from './intent-parser';
import { SetupWizard } from './setup-wizard';
import { StatusTracker } from './status-tracker';
import { NotificationSystem } from './notifications';
import { SecurityGuard } from './security-guard';

export interface ChatResponse {
  text: string;
  intent?: string;
  confidence?: number;
  actions?: any[];
  suggestions?: string[];
  data?: Record<string, any>;
}

export interface ConversationContext {
  userId: string;
  currentIntent?: string;
  wizardActive?: boolean;
  lastInteraction?: Date;
  sessionData?: Record<string, any>;
}

export class ChatAgent {
  private userId: string;
  private context: ConversationContext;
  private setupWizard: SetupWizard;
  private statusTracker: StatusTracker;
  private notifications: NotificationSystem;

  constructor(userId: string) {
    this.userId = userId;
    this.context = { userId };
    this.setupWizard = new SetupWizard(userId);
    this.statusTracker = new StatusTracker(userId);
    this.notifications = new NotificationSystem(userId);
  }

  async processMessage(message: string): Promise<ChatResponse> {
    try {
      // Sanitize input
      const sanitizedMessage = SecurityGuard.sanitizeInput(message);
      
      // Security validation
      const securityCheck = SecurityGuard.validateMessage(sanitizedMessage, this.userId);
      if (!securityCheck.isValid) {
        SecurityGuard.logSecurityIncident(this.userId, sanitizedMessage, securityCheck);
        return {
          text: SecurityGuard.generateSecurityResponse(securityCheck),
          intent: 'security_violation',
          confidence: 1.0,
          suggestions: ['Connect to platform', 'Create sync rule', 'Check status', 'Get help']
        };
      }

      // Parse intent with confidence scoring
      const intent = IntentParser.parseIntent(sanitizedMessage);
      
      logger.info('Processing chat message:', { 
        userId: this.userId, 
        intent: intent.name, 
        confidence: intent.confidence 
      });

      // Update conversation context
      this.context.currentIntent = intent.name;
      this.context.lastInteraction = new Date();

      // Check if wizard is active
      const wizardState = await this.setupWizard.getWizardState();
      if (wizardState && !await this.setupWizard.isWizardCompleted()) {
        return await this.handleWizardFlow(intent, sanitizedMessage);
      }

      // Route to appropriate handler based on intent
      switch (intent.name) {
        case 'connect':
          return await this.handleConnect(intent);
        case 'setup_webhook':
          return await this.handleSetupWebhook(intent);
        case 'map_fields':
          return await this.handleMapFields(intent);
        case 'create_rule':
          return await this.handleCreateRule(intent);
        case 'get_status':
          return await this.handleGetStatus(intent);
        case 'list_rules':
          return await this.handleListRules(intent);
        case 'list_connections':
          return await this.handleListConnections();
        case 'troubleshoot':
          return await this.handleTroubleshoot(intent);
        case 'help':
          return this.handleHelp(intent);
        default:
          return this.handleGeneral(intent, sanitizedMessage);
      }
    } catch (error) {
      logger.error('Chat agent error:', error);
      return {
        text: 'Sorry, I encountered an error processing your request. Please try again.',
        intent: 'error'
      };
    }
  }

  private async handleWizardFlow(intent: Intent, message: string): Promise<ChatResponse> {
    try {
      const wizardState = await this.setupWizard.getWizardState();
      if (!wizardState) {
        return this.handleGeneral(intent, message);
      }

      // Check if user wants to exit wizard
      if (message.toLowerCase().includes('cancel') || message.toLowerCase().includes('exit')) {
        await this.setupWizard.resetWizard();
        return {
          text: 'Setup wizard cancelled. You can start again anytime by saying "create sync rule" or "setup sync".',
          intent: 'wizard_cancelled',
          suggestions: IntentParser.getSuggestions('general')
        };
      }

      // Get next step instructions
      const { step, instructions, actions } = await this.setupWizard.getNextStepInstructions();
      
      return {
        text: `**${step.title}**\n\n${instructions}`,
        intent: 'wizard_step',
        actions,
        data: { 
          wizardStep: step.id, 
          currentStep: wizardState.currentStep,
          totalSteps: wizardState.steps.length 
        }
      };
    } catch (error) {
      logger.error('Wizard flow error:', error);
      return {
        text: 'There was an issue with the setup wizard. Let me help you in a different way.',
        intent: 'wizard_error',
        suggestions: IntentParser.getSuggestions('create_rule')
      };
    }
  }

  private async handleConnect(intent: Intent): Promise<ChatResponse> {
    const platform = intent.parameters.platform;
    
    if (platform) {
      // Check if already connected
      const connections = await this.getUserConnections();
      const existingConnection = connections.find((c: any) => c.platform === platform);
      
      if (existingConnection && existingConnection.is_active) {
        return {
          text: `You're already connected to ${platform}. Your connection is active and working.`,
          intent: 'connect',
          suggestions: ['Create sync rule', 'Check status', 'List connections']
        };
      }

      return {
        text: `Let's connect you to ${platform}. You'll be redirected to authorize KanbanSync to access your ${platform} account.`,
        intent: 'connect',
        actions: [{ type: 'oauth_redirect', platform, url: `/api/oauth/${platform}` }],
        suggestions: ['Connect to another platform', 'Create sync rule']
      };
    }

    const connections = await this.getUserConnections();
    const connectedPlatforms = connections.map((c: any) => c.platform).join(', ');
    
    return {
      text: `I can help you connect to platforms like Asana, Trello, and more. ${connections.length > 0 ? `You're currently connected to: ${connectedPlatforms}.` : 'You haven\'t connected any platforms yet.'}

Which platform would you like to connect to?`,
      intent: 'connect',
      actions: [
        { type: 'platform_selection', platforms: ['asana', 'trello'] }
      ],
      suggestions: ['Connect to Asana', 'Connect to Trello', 'Show my connections']
    };
  }

  private async handleSetupWebhook(intent: Intent): Promise<ChatResponse> {
    const connections = await this.getUserConnections();
    
    if (connections.length === 0) {
      return {
        text: 'You need to connect to at least one platform before setting up webhooks. Would you like to connect to a platform first?',
        intent: 'setup_webhook',
        actions: [{ type: 'redirect', path: '/connections' }],
        suggestions: ['Connect to Asana', 'Connect to Trello']
      };
    }

    return {
      text: 'Webhooks enable real-time sync by notifying KanbanSync when tasks change. I can help you set up webhooks for your connected platforms.',
      intent: 'setup_webhook',
      actions: [{ type: 'redirect', path: '/connections' }],
      suggestions: ['Check webhook status', 'Create sync rule']
    };
  }

  private async handleMapFields(intent: Intent): Promise<ChatResponse> {
    const { source, target } = intent.parameters;
    
    if (source && target) {
      return {
        text: `I'll help you map fields between ${source} and ${target}. Field mapping determines how task information is transferred between platforms.

Common mappings include:
• Task title/name
• Description/notes  
• Status/completion
• Assignee
• Due dates
• Tags/labels`,
        intent: 'map_fields',
        actions: [{ type: 'configure_mapping', source, target }],
        suggestions: ['Use default mappings', 'Create sync rule']
      };
    }

    return {
      text: 'Field mapping lets you control how task information is transferred between platforms. Which platforms would you like to map fields between?',
      intent: 'map_fields',
      suggestions: ['Map Asana to Trello', 'Map Trello to Asana', 'Show my connections']
    };
  }

  private async handleCreateRule(intent: Intent): Promise<ChatResponse> {
    const connections = await this.getUserConnections();
    
    if (connections.length < 2) {
      const connectedPlatforms = connections.map((c: any) => c.platform).join(', ');
      
      return {
        text: `To create sync rules, you need at least 2 platform connections. ${connections.length > 0 ? `You currently have: ${connectedPlatforms}.` : 'You haven\'t connected any platforms yet.'} 

Would you like me to guide you through the setup process?`,
        intent: 'create_rule',
        actions: [{ type: 'start_wizard' }],
        suggestions: ['Start setup wizard', 'Connect to platform', 'Get help']
      };
    }

    const { source, target } = intent.parameters;
    
    if (source && target) {
      // Start wizard with pre-selected platforms
      const wizardState = await this.setupWizard.startWizard({ source, target });
      const { step, instructions, actions } = await this.setupWizard.getNextStepInstructions();
      
      return {
        text: `Great! I'll help you create a sync rule from ${source} to ${target}.\n\n**${step.title}**\n\n${instructions}`,
        intent: 'create_rule',
        actions,
        data: { wizardActive: true, wizardStep: step.id }
      };
    }

    // Start general wizard
    const wizardState = await this.setupWizard.startWizard();
    const { step, instructions, actions } = await this.setupWizard.getNextStepInstructions();
    
    return {
      text: `I'll guide you through creating a sync rule step by step.\n\n**${step.title}**\n\n${instructions}`,
      intent: 'create_rule',
      actions,
      data: { wizardActive: true, wizardStep: step.id }
    };
  }

  private async handleGetStatus(intent: Intent): Promise<ChatResponse> {
    try {
      const statusReport = await this.statusTracker.getStatusReport();
      
      const statusText = this.formatStatusReport(statusReport);
      
      return {
        text: statusText,
        intent: 'get_status',
        data: statusReport,
        suggestions: ['View sync history', 'Check connections', 'Get detailed report']
      };
    } catch (error) {
      logger.error('Failed to get status:', error);
      return {
        text: 'I couldn\'t retrieve your sync status right now. Please try again in a moment.',
        intent: 'get_status',
        suggestions: ['Try again', 'Check connections', 'Get help']
      };
    }
  }

  private async handleListRules(intent: Intent): Promise<ChatResponse> {
    const rules = await this.getUserRules();
    
    if (rules.length === 0) {
      return {
        text: 'You don\'t have any sync rules set up yet. Would you like to create one?',
        intent: 'list_rules',
        actions: [{ type: 'start_wizard' }],
        suggestions: ['Create sync rule', 'Connect platforms', 'Get help']
      };
    }

    const ruleList = rules.map((r: any) => 
      `• **${r.name}** (${r.source_platform} → ${r.target_platform}) - ${r.is_active ? 'Active' : 'Inactive'}`
    ).join('\n');
    
    return {
      text: `Your sync rules:\n\n${ruleList}`,
      intent: 'list_rules',
      actions: [{ type: 'redirect', path: '/rules' }],
      suggestions: ['Create new rule', 'Edit rule', 'Check sync status']
    };
  }

  private async handleListConnections(): Promise<ChatResponse> {
    const connections = await this.getUserConnections();
    
    if (connections.length === 0) {
      return {
        text: 'You haven\'t connected any platforms yet. Would you like to connect to Asana, Trello, or another platform?',
        intent: 'list_connections',
        actions: [{ type: 'redirect', path: '/connections' }],
        suggestions: ['Connect to Asana', 'Connect to Trello', 'Get help']
      };
    }

    const platformList = connections.map((c: any) => 
      `• **${c.platform}** - ${c.is_active ? '✅ Active' : '❌ Inactive'}`
    ).join('\n');
    
    return {
      text: `Your connected platforms:\n\n${platformList}`,
      intent: 'list_connections',
      actions: [{ type: 'redirect', path: '/connections' }],
      suggestions: ['Connect another platform', 'Create sync rule', 'Check status']
    };
  }

  private async handleTroubleshoot(intent: Intent): Promise<ChatResponse> {
    try {
      const statusReport = await this.statusTracker.getStatusReport();
      const issues = this.identifyIssues(statusReport);
      
      if (issues.length === 0) {
        return {
          text: 'Good news! I don\'t see any major issues with your sync setup. Everything appears to be working normally.',
          intent: 'troubleshoot',
          suggestions: ['Check detailed status', 'View sync history', 'Get help']
        };
      }

      const troubleshootText = `I found some issues that might be affecting your sync:\n\n${issues.join('\n\n')}`;
      
      return {
        text: troubleshootText,
        intent: 'troubleshoot',
        data: { issues },
        suggestions: ['Fix connections', 'Check webhooks', 'View error logs']
      };
    } catch (error) {
      logger.error('Troubleshoot error:', error);
      return {
        text: 'I\'m having trouble diagnosing issues right now. Please check your connections and try again.',
        intent: 'troubleshoot',
        suggestions: ['Check connections', 'Try again', 'Get help']
      };
    }
  }

  private handleHelp(intent: Intent): ChatResponse {
    return {
      text: `I'm your KanbanSync assistant! I can help you with:

**🔗 Connecting Platforms**
"Connect to Asana" or "Connect to Trello"

**⚙️ Setting Up Sync**
"Create sync rule" or "Sync Asana to Trello"

**📊 Checking Status**
"Show status" or "Check sync health"

**🔧 Managing Rules**
"List my rules" or "Show connections"

**🚨 Troubleshooting**
"Sync not working" or "Fix errors"

Just ask me in natural language - I understand variations and can guide you through any process!`,
      intent: 'help',
      suggestions: ['Connect to platform', 'Create sync rule', 'Check status', 'List connections']
    };
  }

  private handleGeneral(intent: Intent, message: string): ChatResponse {
    const suggestions = IntentParser.getSuggestions(intent.name);
    
    return {
      text: `I'm here to help you sync tasks between platforms. I can help you connect platforms, create sync rules, check status, and troubleshoot issues.

Try asking: "Connect to Asana", "Create sync rule", or "Show my status"`,
      intent: 'general',
      confidence: intent.confidence,
      suggestions
    };
  }

  private formatStatusReport(report: any): string {
    const { overview, connections, recommendations } = report;
    
    // Sanitize sensitive data from status report
    const sanitizedConnections = connections.map((conn: any) => ({
      platform: conn.platform,
      status: conn.status,
      isActive: conn.isActive
      // Exclude lastUsed, errorCount, and other potentially sensitive data
    }));
    
    let statusText = `**📊 Sync Status Overview**\n\n`;
    statusText += `• **Rules:** ${overview.activeRules}/${overview.totalRules} active\n`;
    statusText += `• **Success Rate:** ${overview.successRate}%\n`;
    statusText += `• **Total Syncs:** ${overview.totalSyncs} (${overview.successfulSyncs} successful, ${overview.failedSyncs} failed)\n`;
    
    if (overview.lastSyncTime) {
      const timeSince = Math.round((Date.now() - overview.lastSyncTime.getTime()) / (1000 * 60));
      statusText += `• **Last Sync:** ${timeSince} minutes ago\n`;
    }

    statusText += `\n**🔗 Connections**\n`;
    sanitizedConnections.forEach((conn: any) => {
      const statusIcon = conn.status === 'healthy' ? '✅' : conn.status === 'warning' ? '⚠️' : '❌';
      statusText += `• ${statusIcon} **${conn.platform}** - ${conn.isActive ? 'Active' : 'Inactive'}\n`;
    });

    if (recommendations.length > 0) {
      statusText += `\n**💡 Recommendations**\n`;
      // Limit and sanitize recommendations
      const safeRecommendations = recommendations.slice(0, 3).map((rec: string) => 
        rec.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[ID]')
      );
      safeRecommendations.forEach((rec: string) => {
        statusText += `• ${rec}\n`;
      });
    }

    return statusText;
  }

  private identifyIssues(report: any): string[] {
    const issues: string[] = [];
    const { overview, connections, webhookHealth } = report;

    // Check success rate
    if (overview.successRate < 80 && overview.totalSyncs > 5) {
      issues.push('🔴 **Low Success Rate**: Your sync success rate is below 80%. This indicates recurring sync problems.');
    }

    // Check inactive connections
    const inactiveConnections = connections.filter((c: any) => !c.isActive);
    if (inactiveConnections.length > 0) {
      issues.push(`🔴 **Inactive Connections**: ${inactiveConnections.map((c: any) => c.platform).join(', ')} connection(s) are inactive. Please reauthorize these platforms.`);
    }

    // Check connection errors
    const errorConnections = connections.filter((c: any) => c.status === 'error');
    if (errorConnections.length > 0) {
      issues.push(`🔴 **Connection Errors**: ${errorConnections.map((c: any) => c.platform).join(', ')} have recent errors. Check your platform credentials.`);
    }

    // Check webhook health
    const unhealthyWebhooks = webhookHealth.filter((w: any) => w.status !== 'healthy');
    if (unhealthyWebhooks.length > 0) {
      issues.push(`⚠️ **Webhook Issues**: Webhooks for ${unhealthyWebhooks.map((w: any) => w.platform).join(', ')} are not working properly. This may delay sync updates.`);
    }

    return issues;
  }

  private async getUserConnections() {
    const result = await query(
      'SELECT platform, is_active FROM connections WHERE user_id = $1',
      [this.userId]
    );
    return result.rows;
  }

  private async getUserRules() {
    const result = await query(`
      SELECT r.name, r.is_active, sc.platform as source_platform, tc.platform as target_platform
      FROM sync_rules r
      JOIN connections sc ON r.source_connection_id = sc.id
      JOIN connections tc ON r.target_connection_id = tc.id
      WHERE r.user_id = $1
    `, [this.userId]);
    return result.rows;
  }
}