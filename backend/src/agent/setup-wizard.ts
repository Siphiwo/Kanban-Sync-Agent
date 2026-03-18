import { query } from '../db';
import { logger } from '../utils/logger';
import { SkillManager } from '../skills/skill-manager';

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  data?: Record<string, any>;
}

export interface WizardState {
  userId: string;
  currentStep: number;
  steps: WizardStep[];
  context: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export class SetupWizard {
  private userId: string;
  private state: WizardState | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Start a new setup wizard session
   */
  async startWizard(platforms?: { source?: string; target?: string }): Promise<WizardState> {
    try {
      const steps = this.createWizardSteps(platforms);
      
      this.state = {
        userId: this.userId,
        currentStep: 0,
        steps,
        context: platforms || {},
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.saveWizardState();
      
      logger.info('Setup wizard started:', { 
        userId: this.userId, 
        platforms 
      });

      return this.state;
    } catch (error) {
      logger.error('Failed to start setup wizard:', error);
      throw error;
    }
  }

  /**
   * Get current wizard state
   */
  async getWizardState(): Promise<WizardState | null> {
    if (this.state) {
      return this.state;
    }

    try {
      const result = await query(
        'SELECT * FROM wizard_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [this.userId]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.state = {
          userId: row.user_id,
          currentStep: row.current_step,
          steps: JSON.parse(row.steps),
          context: JSON.parse(row.context),
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        };
      }

      return this.state;
    } catch (error) {
      logger.error('Failed to get wizard state:', error);
      return null;
    }
  }

  /**
   * Process wizard step completion
   */
  async completeStep(stepId: string, data: Record<string, any>): Promise<WizardState> {
    const state = await this.getWizardState();
    if (!state) {
      throw new Error('No active wizard session');
    }

    const stepIndex = state.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) {
      throw new Error('Invalid step ID');
    }

    // Mark step as completed and store data
    state.steps[stepIndex].completed = true;
    state.steps[stepIndex].data = data;

    // Update context with step data
    Object.assign(state.context, data);

    // Move to next step if current
    if (stepIndex === state.currentStep) {
      state.currentStep = Math.min(state.currentStep + 1, state.steps.length - 1);
    }

    state.updatedAt = new Date();
    this.state = state;

    await this.saveWizardState();

    logger.info('Wizard step completed:', { 
      userId: this.userId, 
      stepId, 
      currentStep: state.currentStep 
    });

    return state;
  }

  /**
   * Get next step instructions
   */
  async getNextStepInstructions(): Promise<{ step: WizardStep; instructions: string; actions?: any[] }> {
    const state = await this.getWizardState();
    if (!state) {
      throw new Error('No active wizard session');
    }

    const currentStep = state.steps[state.currentStep];
    if (!currentStep) {
      throw new Error('Wizard completed');
    }

    const instructions = await this.generateStepInstructions(currentStep, state);
    const actions = await this.generateStepActions(currentStep, state);

    return {
      step: currentStep,
      instructions,
      actions
    };
  }

  /**
   * Check if wizard is completed
   */
  async isWizardCompleted(): Promise<boolean> {
    const state = await this.getWizardState();
    if (!state) {
      return false;
    }

    return state.steps.every(step => step.completed);
  }

  /**
   * Reset wizard state
   */
  async resetWizard(): Promise<void> {
    try {
      await query(
        'DELETE FROM wizard_sessions WHERE user_id = $1',
        [this.userId]
      );
      
      this.state = null;
      
      logger.info('Wizard reset:', { userId: this.userId });
    } catch (error) {
      logger.error('Failed to reset wizard:', error);
      throw error;
    }
  }

  /**
   * Create wizard steps based on context
   */
  private createWizardSteps(platforms?: { source?: string; target?: string }): WizardStep[] {
    const steps: WizardStep[] = [
      {
        id: 'platform_selection',
        title: 'Select Platforms',
        description: 'Choose source and target platforms for sync',
        completed: false
      },
      {
        id: 'source_oauth',
        title: 'Connect Source Platform',
        description: 'Authenticate with your source platform',
        completed: false
      },
      {
        id: 'target_oauth',
        title: 'Connect Target Platform',
        description: 'Authenticate with your target platform',
        completed: false
      },
      {
        id: 'workspace_selection',
        title: 'Select Workspaces',
        description: 'Choose workspaces/boards to sync',
        completed: false
      },
      {
        id: 'webhook_setup',
        title: 'Setup Webhooks',
        description: 'Configure real-time sync notifications',
        completed: false
      },
      {
        id: 'field_mapping',
        title: 'Map Fields',
        description: 'Configure how fields are mapped between platforms',
        completed: false
      },
      {
        id: 'rule_creation',
        title: 'Create Sync Rule',
        description: 'Finalize your sync configuration',
        completed: false
      }
    ];

    // Pre-populate platform selection if provided
    if (platforms?.source && platforms?.target) {
      steps[0].completed = true;
      steps[0].data = platforms;
    }

    return steps;
  }

  /**
   * Generate step-specific instructions
   */
  private async generateStepInstructions(step: WizardStep, state: WizardState): Promise<string> {
    switch (step.id) {
      case 'platform_selection':
        return this.getPlatformSelectionInstructions();
      
      case 'source_oauth':
        return this.getOAuthInstructions('source', state.context.source);
      
      case 'target_oauth':
        return this.getOAuthInstructions('target', state.context.target);
      
      case 'workspace_selection':
        return await this.getWorkspaceSelectionInstructions(state);
      
      case 'webhook_setup':
        return this.getWebhookSetupInstructions(state);
      
      case 'field_mapping':
        return this.getFieldMappingInstructions(state);
      
      case 'rule_creation':
        return this.getRuleCreationInstructions(state);
      
      default:
        return 'Please complete this step to continue.';
    }
  }

  /**
   * Generate step-specific actions
   */
  private async generateStepActions(step: WizardStep, state: WizardState): Promise<any[]> {
    switch (step.id) {
      case 'platform_selection':
        return [
          { type: 'select_platform', label: 'Choose Source Platform', options: ['asana', 'trello'] },
          { type: 'select_platform', label: 'Choose Target Platform', options: ['asana', 'trello'] }
        ];
      
      case 'source_oauth':
      case 'target_oauth':
        const platform = step.id === 'source_oauth' ? state.context.source : state.context.target;
        return [
          { type: 'oauth_redirect', platform, url: `/api/oauth/${platform}` }
        ];
      
      case 'workspace_selection':
        return await this.getWorkspaceActions(state);
      
      case 'webhook_setup':
        return [
          { type: 'setup_webhook', platform: state.context.source },
          { type: 'setup_webhook', platform: state.context.target }
        ];
      
      case 'field_mapping':
        return [
          { type: 'configure_mapping', source: state.context.source, target: state.context.target }
        ];
      
      case 'rule_creation':
        return [
          { type: 'create_rule', data: state.context }
        ];
      
      default:
        return [];
    }
  }

  private getPlatformSelectionInstructions(): string {
    return `Let's set up sync between two platforms. 

First, choose your source platform (where tasks will be synced FROM) and target platform (where tasks will be synced TO).

Available platforms:
• Asana - Project management with tasks, subtasks, and custom fields
• Trello - Kanban boards with cards and lists

Which platforms would you like to sync?`;
  }

  private getOAuthInstructions(type: 'source' | 'target', platform: string): string {
    return `Now let's connect to your ${platform} account.

You'll be redirected to ${platform} to authorize KanbanSync to access your account. This allows us to:
• Read your projects/boards and tasks/cards
• Create and update tasks/cards
• Set up webhooks for real-time sync

Click the button below to connect your ${type} platform.`;
  }

  private async getWorkspaceSelectionInstructions(state: WizardState): Promise<string> {
    const { source, target } = state.context;
    
    return `Great! Now let's choose which workspaces/boards to sync.

For ${source}: Select the workspace and project you want to sync FROM
For ${target}: Select the workspace and board/project you want to sync TO

This determines which tasks will be included in the sync.`;
  }

  private getWebhookSetupInstructions(state: WizardState): string {
    return `Now let's set up webhooks for real-time sync.

Webhooks notify KanbanSync immediately when tasks change, ensuring your platforms stay in sync automatically.

We'll configure webhooks for both platforms to monitor:
• Task creation and updates
• Status changes
• Assignment changes
• Due date changes`;
  }

  private getFieldMappingInstructions(state: WizardState): string {
    const { source, target } = state.context;
    
    return `Let's configure how fields are mapped between ${source} and ${target}.

We'll set up mappings for:
• Task title/name
• Description/notes
• Status/completion
• Assignee
• Due dates
• Tags/labels
• Custom fields

You can use our smart defaults or customize the mappings.`;
  }

  private getRuleCreationInstructions(state: WizardState): string {
    return `Almost done! Let's create your sync rule.

Review your configuration:
• Source: ${state.context.source}
• Target: ${state.context.target}
• Workspaces: Selected
• Webhooks: Configured
• Field mappings: Set up

Give your sync rule a name and any additional filters, then we'll activate it!`;
  }

  private async getWorkspaceActions(state: WizardState): Promise<any[]> {
    const actions: any[] = [];
    
    try {
      // Get source platform workspaces
      if (state.context.source) {
        const sourceSkill = await SkillManager.getSkill(this.userId, state.context.source);
        if (sourceSkill) {
          let workspaces: any[] = [];
          
          if (state.context.source === 'asana' && 'getWorkspaces' in sourceSkill) {
            workspaces = await (sourceSkill as any).getWorkspaces();
          } else if (state.context.source === 'trello' && 'getBoards' in sourceSkill) {
            workspaces = await (sourceSkill as any).getBoards();
          }
          
          if (workspaces.length > 0) {
            actions.push({
              type: 'select_workspace',
              platform: state.context.source,
              label: `Select ${state.context.source} workspace`,
              options: workspaces.map((w: any) => ({ id: w.gid || w.id, name: w.name }))
            });
          }
        }
      }

      // Get target platform workspaces
      if (state.context.target) {
        const targetSkill = await SkillManager.getSkill(this.userId, state.context.target);
        if (targetSkill) {
          let workspaces: any[] = [];
          
          if (state.context.target === 'asana' && 'getWorkspaces' in targetSkill) {
            workspaces = await (targetSkill as any).getWorkspaces();
          } else if (state.context.target === 'trello' && 'getBoards' in targetSkill) {
            workspaces = await (targetSkill as any).getBoards();
          }
          
          if (workspaces.length > 0) {
            actions.push({
              type: 'select_workspace',
              platform: state.context.target,
              label: `Select ${state.context.target} workspace`,
              options: workspaces.map((w: any) => ({ id: w.gid || w.id, name: w.name }))
            });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to get workspace actions:', error);
    }

    return actions;
  }

  /**
   * Save wizard state to database
   */
  private async saveWizardState(): Promise<void> {
    if (!this.state) {
      return;
    }

    try {
      await query(`
        INSERT INTO wizard_sessions (user_id, current_step, steps, context, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          current_step = $2,
          steps = $3,
          context = $4,
          updated_at = $6
      `, [
        this.state.userId,
        this.state.currentStep,
        JSON.stringify(this.state.steps),
        JSON.stringify(this.state.context),
        this.state.createdAt,
        this.state.updatedAt
      ]);
    } catch (error) {
      logger.error('Failed to save wizard state:', error);
      throw error;
    }
  }
}