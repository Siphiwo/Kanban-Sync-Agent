import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticateToken } from '../utils/auth';
import { SetupWizard } from '../agent/setup-wizard';
import { logger } from '../utils/logger';

export const wizardRouter = Router();

const startWizardSchema = z.object({
  source: z.string().optional(),
  target: z.string().optional()
});

const completeStepSchema = z.object({
  stepId: z.string(),
  data: z.record(z.any())
});

// Start setup wizard
wizardRouter.post('/start', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const { source, target } = startWizardSchema.parse(req.body);
    
    const wizard = new SetupWizard(userId);
    const wizardState = await wizard.startWizard(source && target ? { source, target } : undefined);
    
    res.json(wizardState);
  } catch (error) {
    logger.error('Start wizard error:', error);
    res.status(500).json({ error: 'Failed to start setup wizard' });
  }
});

// Get wizard state
wizardRouter.get('/state', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const wizard = new SetupWizard(userId);
    const wizardState = await wizard.getWizardState();
    
    if (!wizardState) {
      return res.status(404).json({ error: 'No active wizard session' });
    }
    
    res.json(wizardState);
  } catch (error) {
    logger.error('Get wizard state error:', error);
    res.status(500).json({ error: 'Failed to fetch wizard state' });
  }
});

// Get next step instructions
wizardRouter.get('/next-step', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const wizard = new SetupWizard(userId);
    const nextStep = await wizard.getNextStepInstructions();
    
    res.json(nextStep);
  } catch (error) {
    logger.error('Get next step error:', error);
    res.status(500).json({ error: 'Failed to get next step instructions' });
  }
});

// Complete wizard step
wizardRouter.post('/complete-step', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    const { stepId, data } = completeStepSchema.parse(req.body);
    
    const wizard = new SetupWizard(userId);
    const updatedState = await wizard.completeStep(stepId, data);
    
    res.json(updatedState);
  } catch (error) {
    logger.error('Complete step error:', error);
    res.status(500).json({ error: 'Failed to complete wizard step' });
  }
});

// Check if wizard is completed
wizardRouter.get('/completed', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const wizard = new SetupWizard(userId);
    const isCompleted = await wizard.isWizardCompleted();
    
    res.json({ completed: isCompleted });
  } catch (error) {
    logger.error('Check wizard completion error:', error);
    res.status(500).json({ error: 'Failed to check wizard completion' });
  }
});

// Reset wizard
wizardRouter.delete('/reset', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.user!.userId;
    
    const wizard = new SetupWizard(userId);
    await wizard.resetWizard();
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Reset wizard error:', error);
    res.status(500).json({ error: 'Failed to reset wizard' });
  }
});