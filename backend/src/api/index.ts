import { Router } from 'express';
import { authRouter } from './auth';
import { connectionsRouter } from './connections';
import { rulesRouter } from './rules';
import { chatRouter } from './chat';
import { oauthRouter } from './oauth';
import { syncRouter } from './sync';
import { notificationsRouter } from './notifications';
import { statusRouter } from './status';
import { wizardRouter } from './wizard';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/connections', connectionsRouter);
apiRouter.use('/rules', rulesRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/oauth', oauthRouter);
apiRouter.use('/sync', syncRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/status', statusRouter);
apiRouter.use('/wizard', wizardRouter);