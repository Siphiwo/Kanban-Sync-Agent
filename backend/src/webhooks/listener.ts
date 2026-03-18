import crypto from 'crypto';
import { Express } from 'express';
import express from 'express';
import { logger } from '../utils/logger';
import { query } from '../db';
import { WebhookEvent } from '../types';

export class WebhookListener {
  
  static setupWebhookEndpoints(app: Express): void {
    // Asana webhook endpoint
    app.post('/api/webhooks/asana', express.raw({ type: 'application/json' }), async (req, res) => {
      try {
        const signature = req.headers['x-hook-signature'] as string;
        const payload = JSON.parse(req.body.toString());
        
        logger.info('Asana webhook received:', { 
          signature: signature?.substring(0, 10) + '...', 
          eventCount: payload.events?.length || 0 
        });
        
        // Verify webhook signature
        if (!WebhookListener.verifyAsanaSignature(req.body, signature)) {
          logger.warn('Invalid Asana webhook signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        // Handle webhook handshake
        if (req.headers['x-hook-secret']) {
          logger.info('Asana webhook handshake received');
          return res.status(200).json({ 
            message: 'Webhook registered successfully' 
          });
        }
        
        // Process events
        if (payload.events && Array.isArray(payload.events)) {
          for (const event of payload.events) {
            await WebhookListener.queueWebhookEvent({
              platform: 'asana',
              event_type: event.action || 'unknown',
              resource_id: event.resource?.gid || 'unknown',
              user_id: event.user?.gid,
              payload: event,
              signature
            });
          }
        }
        
        res.status(200).json({ received: true, processed: payload.events?.length || 0 });
      } catch (error) {
        logger.error('Asana webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    });
    
    // Trello webhook endpoint
    app.post('/api/webhooks/trello', express.json(), async (req, res) => {
      try {
        const payload = req.body;
        
        logger.info('Trello webhook received:', { 
          action: payload.action?.type,
          modelType: payload.model?.type 
        });
        
        // Trello doesn't use signatures by default, but we can verify the callback URL
        // In production, you'd want to implement additional security measures
        
        await WebhookListener.queueWebhookEvent({
          platform: 'trello',
          event_type: payload.action?.type || 'unknown',
          resource_id: payload.model?.id || 'unknown',
          user_id: payload.action?.memberCreator?.id,
          payload: payload
        });
        
        res.status(200).json({ received: true });
      } catch (error) {
        logger.error('Trello webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    });
    
    logger.info('Webhook endpoints configured');
  }
  
  static verifyAsanaSignature(payload: Buffer, signature: string): boolean {
    if (!signature || !process.env.WEBHOOK_SECRET) {
      return false;
    }
    
    try {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
      
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      logger.error('Signature verification error:', error);
      return false;
    }
  }
  
  static async queueWebhookEvent(eventData: Omit<WebhookEvent, 'id' | 'created_at' | 'processed' | 'retry_count'>): Promise<void> {
    try {
      const eventId = crypto.randomUUID();
      
      await query(`
        INSERT INTO webhook_events (
          id, platform, event_type, resource_id, user_id, payload, signature, processed, retry_count
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 0)
      `, [
        eventId,
        eventData.platform,
        eventData.event_type,
        eventData.resource_id,
        eventData.user_id,
        JSON.stringify(eventData.payload),
        eventData.signature
      ]);
      
      logger.info('Webhook event queued:', { 
        eventId, 
        platform: eventData.platform, 
        eventType: eventData.event_type 
      });
      
      // Process immediately (in production, you might want to use a job queue)
      setImmediate(() => WebhookListener.processWebhookEvent(eventId));
      
    } catch (error) {
      logger.error('Failed to queue webhook event:', error);
      throw error;
    }
  }
  
  static async processWebhookEvent(eventId: string): Promise<void> {
    try {
      const result = await query(
        'SELECT * FROM webhook_events WHERE id = $1 AND processed = false',
        [eventId]
      );
      
      if (result.rows.length === 0) {
        logger.warn('Webhook event not found or already processed:', eventId);
        return;
      }
      
      const event: WebhookEvent = {
        ...result.rows[0],
        payload: JSON.parse(result.rows[0].payload),
        created_at: new Date(result.rows[0].created_at)
      };
      
      logger.info('Processing webhook event:', { 
        eventId: event.id, 
        platform: event.platform, 
        eventType: event.event_type 
      });
      
      // Find matching rules and execute sync (dynamic import to avoid circular dependency)
      const { RuleEngine } = await import('../rules/engine');
      await RuleEngine.processWebhookEvent(event);
      
      // Mark as processed
      await query(
        'UPDATE webhook_events SET processed = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [eventId]
      );
      
      logger.info('Webhook event processed successfully:', eventId);
      
    } catch (error) {
      logger.error('Webhook event processing failed:', { eventId, error });
      
      // Increment retry count
      await query(`
        UPDATE webhook_events 
        SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [eventId]);
      
      // Retry with exponential backoff (max 3 retries)
      const retryResult = await query(
        'SELECT retry_count FROM webhook_events WHERE id = $1',
        [eventId]
      );
      
      const retryCount = retryResult.rows[0]?.retry_count || 0;
      
      if (retryCount < 3) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        logger.info(`Retrying webhook event in ${delay}ms:`, eventId);
        
        setTimeout(() => {
          WebhookListener.processWebhookEvent(eventId);
        }, delay);
      } else {
        logger.error('Webhook event failed after max retries:', eventId);
        
        // Move to dead letter queue
        await query(`
          UPDATE webhook_events 
          SET processed = true, error_message = $2, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $1
        `, [eventId, error instanceof Error ? error.message : 'Unknown error']);
      }
    }
  }
  
  static async getUnprocessedEvents(limit: number = 100): Promise<WebhookEvent[]> {
    try {
      const result = await query(`
        SELECT * FROM webhook_events 
        WHERE processed = false AND retry_count < 3
        ORDER BY created_at ASC 
        LIMIT $1
      `, [limit]);
      
      return result.rows.map(row => ({
        ...row,
        payload: JSON.parse(row.payload),
        created_at: new Date(row.created_at)
      }));
    } catch (error) {
      logger.error('Failed to get unprocessed events:', error);
      return [];
    }
  }
  
  static async retryFailedEvents(): Promise<void> {
    try {
      const events = await WebhookListener.getUnprocessedEvents();
      
      logger.info(`Retrying ${events.length} failed webhook events`);
      
      for (const event of events) {
        await WebhookListener.processWebhookEvent(event.id);
      }
    } catch (error) {
      logger.error('Failed to retry webhook events:', error);
    }
  }
}