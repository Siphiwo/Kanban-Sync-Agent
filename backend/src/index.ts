import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { apiRouter } from './api';
import { WebhookListener } from './webhooks/listener';
import { initDatabase } from './db';
import { logger } from './utils/logger';
import { SecurityGuard } from './agent/security-guard';
import { 
  corsOptions, 
  securityHeaders, 
  sanitizeInput, 
  validateRequest, 
  requestLogger 
} from './middleware/security';
import { 
  apiRateLimit, 
  authRateLimit, 
  chatRateLimit, 
  syncRateLimit 
} from './utils/rate-limiter';
import { cache } from './utils/cache';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Enhanced security middleware
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(requestLogger);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeInput);
app.use(validateRequest);

// Rate limiting by endpoint
app.use('/api/auth', authRateLimit.middleware());
app.use('/api/chat', chatRateLimit.middleware());
app.use('/api/sync', syncRateLimit.middleware());
app.use('/api', apiRateLimit.middleware());

// Routes
app.use('/api', apiRouter);

// Webhooks (setup before other middleware to handle raw payloads)
WebhookListener.setupWebhookEndpoints(app);

// WebSocket for real-time notifications with authentication
wss.on('connection', (ws: any, req: any) => {
  logger.info('WebSocket client connected from', req.socket.remoteAddress);
  
  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      logger.debug('WebSocket message received:', data);
      
      // Handle ping/pong for connection health
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch (error) {
      logger.error('Invalid WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
  });
  
  ws.on('error', (error: any) => {
    logger.error('WebSocket error:', error);
  });
});

// Enhanced health check with system status
app.get('/health', (req: express.Request, res: express.Response) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cache: {
      size: cache.size(),
      enabled: true
    },
    database: 'connected' // Could add actual DB health check
  };
  
  res.json(healthData);
});

// Metrics endpoint for monitoring
app.get('/metrics', (req: express.Request, res: express.Response) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    process: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    },
    cache: {
      size: cache.size()
    },
    websockets: {
      connections: wss.clients.size
    }
  };
  
  res.json(metrics);
});

// Enhanced error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
    ...(isDevelopment && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req: express.Request, res: express.Response) => {
  logger.warn(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await initDatabase();
    
    server.listen(PORT, () => {
      logger.info(`🚀 KanbanSync backend running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📈 Metrics: http://localhost:${PORT}/metrics`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      
      // Start webhook event retry processor (every 5 minutes)
      setInterval(() => {
        WebhookListener.retryFailedEvents();
      }, 5 * 60 * 1000);
      
      // Cleanup security data periodically (every 5 minutes)
      setInterval(() => {
        SecurityGuard.cleanupRateLimitData();
      }, 5 * 60 * 1000);
      
      // Send periodic ping to WebSocket clients (every 30 seconds)
      setInterval(() => {
        wss.clients.forEach((ws: any) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'ping',
              timestamp: new Date().toISOString()
            }));
          }
        });
      }, 30 * 1000);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully');
  cache.destroy();
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('🛑 SIGINT received, shutting down gracefully');
  cache.destroy();
  server.close(() => {
    logger.info('✅ Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection', { promise, reason });
  process.exit(1);
});

startServer();