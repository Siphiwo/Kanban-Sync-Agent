import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import { authenticateToken } from '../utils/auth';
import { AsanaSkill } from '../skills/asana-skill';
import { TrelloSkill } from '../skills/trello-skill';
import { MondaySkill } from '../skills/monday-skill';
import { ClickUpSkill } from '../skills/clickup-skill';
import { JiraSkill } from '../skills/jira-skill';
import { query } from '../db';
import { logger } from '../utils/logger';

export const oauthRouter = Router();

// Encryption helpers
function encrypt(text: string): string {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(process.env.JWT_SECRET!, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher(algorithm, key);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText: string): string {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(process.env.JWT_SECRET!, 'salt', 32);
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipher(algorithm, key);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Asana OAuth
oauthRouter.get('/asana/authorize', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const clientId = process.env.ASANA_CLIENT_ID;
    // Force HTTPS in production
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/asana/callback`;
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in session or database for verification
    const authUrl = `https://app.asana.com/-/oauth_authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
    
    res.json({ authUrl, state });
  } catch (error) {
    logger.error('Asana OAuth authorize error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

oauthRouter.get('/asana/callback', async (req: express.Request, res: express.Response) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=${error}`);
    }
    
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_code`);
    }
    
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/asana/callback`;
    const accessToken = await AsanaSkill.authenticate(code as string, redirectUri);
    
    // Get user info to store connection
    const asanaSkill = new AsanaSkill(accessToken);
    const workspaces = await asanaSkill.getWorkspaces();
    
    if (workspaces.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_workspaces`);
    }
    
    // For now, we'll need the user ID from the frontend
    // In a real implementation, you'd store the state with user ID
    const userId = req.query.user_id as string;
    
    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_user`);
    }
    
    // Store encrypted token
    const encryptedToken = encrypt(accessToken);
    
    await query(`
      INSERT INTO connections (user_id, platform, platform_user_id, access_token, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET access_token = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
    `, [userId, 'asana', workspaces[0].gid, encryptedToken, true]);
    
    logger.info('Asana connection created:', { userId, workspaceId: workspaces[0].gid });
    res.redirect(`${process.env.FRONTEND_URL}/connections?success=asana`);
  } catch (error) {
    logger.error('Asana OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/connections?error=callback_failed`);
  }
});

// Trello OAuth
oauthRouter.get('/trello/authorize', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const apiKey = process.env.TRELLO_API_KEY;
    const appName = 'KanbanSync';
    const scope = 'read,write';
    const expiration = 'never';
    // Force HTTPS in production
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/trello/callback`;
    
    const authUrl = `https://trello.com/1/authorize?key=${apiKey}&name=${encodeURIComponent(appName)}&scope=${scope}&expiration=${expiration}&response_type=token&callback_method=fragment&return_url=${encodeURIComponent(redirectUri)}`;
    
    res.json({ authUrl });
  } catch (error) {
    logger.error('Trello OAuth authorize error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

oauthRouter.get('/trello/callback', async (req: express.Request, res: express.Response) => {
  try {
    // Trello returns token in URL fragment, so we need to handle it on frontend
    // This endpoint serves the callback page that extracts the token
    const callbackHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Trello Authorization</title>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://kanban-sync-agent-production.up.railway.app;">
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .loader {
            text-align: center;
          }
          .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #0079bf;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="loader">
          <div class="spinner"></div>
          <p>Connecting to Trello...</p>
        </div>
        <script>
          const fragment = window.location.hash.substring(1);
          const params = new URLSearchParams(fragment);
          const token = params.get('token');
          
          if (token) {
            // Get userId from localStorage (set by frontend before OAuth)
            const userId = localStorage.getItem('kanbansync_user_id');
            const authToken = localStorage.getItem('kanbansync_auth_token');
            
            if (userId && authToken) {
              // Send token to backend
              fetch('/api/oauth/trello/store', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({ token, userId })
              }).then(response => {
                if (response.ok) {
                  window.location.href = '${process.env.FRONTEND_URL}/connections?success=trello';
                } else {
                  window.location.href = '${process.env.FRONTEND_URL}/connections?error=store_failed';
                }
              }).catch(() => {
                window.location.href = '${process.env.FRONTEND_URL}/connections?error=store_failed';
              });
            } else {
              window.location.href = '${process.env.FRONTEND_URL}/connections?error=no_user';
            }
          } else {
            window.location.href = '${process.env.FRONTEND_URL}/connections?error=no_token';
          }
        </script>
      </body>
      </html>
    `;
    
    // Override CSP for this specific response
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self';");
    res.send(callbackHtml);
  } catch (error) {
    logger.error('Trello OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/connections?error=callback_failed`);
  }
});

oauthRouter.post('/trello/store', async (req: express.Request, res: express.Response) => {
  try {
    const { token, userId } = req.body;
    
    if (!token || !userId) {
      return res.status(400).json({ error: 'Missing token or user ID' });
    }
    
    // Verify token works
    const trelloSkill = new TrelloSkill(token);
    const boards = await trelloSkill.getBoards();
    
    if (boards.length === 0) {
      return res.status(400).json({ error: 'No boards found' });
    }
    
    // Store encrypted token
    const encryptedToken = encrypt(token);
    
    await query(`
      INSERT INTO connections (user_id, platform, platform_user_id, access_token, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET access_token = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
    `, [userId, 'trello', 'trello_user', encryptedToken, true]);
    
    logger.info('Trello connection created:', { userId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Trello OAuth store error:', error);
    res.status(500).json({ error: 'Failed to store connection' });
  }
});

// Connection verification
oauthRouter.post('/verify/:connectionId', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const userId = (req as any).user!.userId;
    const connectionId = req.params.connectionId;
    
    const result = await query(
      'SELECT platform, access_token, platform_config FROM connections WHERE id = $1 AND user_id = $2',
      [connectionId, userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    const connection = result.rows[0];
    const decryptedToken = decrypt(connection.access_token);
    const platformConfig = connection.platform_config ? JSON.parse(connection.platform_config) : {};
    
    let isValid = false;
    
    if (connection.platform === 'asana') {
      const asanaSkill = new AsanaSkill(decryptedToken);
      isValid = await asanaSkill.verifyConnection();
    } else if (connection.platform === 'trello') {
      const trelloSkill = new TrelloSkill(decryptedToken);
      isValid = await trelloSkill.verifyConnection();
    } else if (connection.platform === 'monday') {
      const mondaySkill = new MondaySkill(decryptedToken);
      isValid = await mondaySkill.verifyConnection();
    } else if (connection.platform === 'clickup') {
      const clickupSkill = new ClickUpSkill(decryptedToken);
      isValid = await clickupSkill.verifyConnection();
    } else if (connection.platform === 'jira') {
      const jiraSkill = new JiraSkill(decryptedToken, platformConfig.cloudId);
      isValid = await jiraSkill.verifyConnection();
    }
    
    // Update connection status
    await query(
      'UPDATE connections SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [isValid, connectionId]
    );
    
    res.json({ valid: isValid });
  } catch (error) {
    logger.error('Connection verification error:', error);
    res.status(500).json({ error: 'Failed to verify connection' });
  }
});

// Monday.com OAuth
oauthRouter.get('/monday/authorize', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const clientId = process.env.MONDAY_CLIENT_ID;
    // Force HTTPS in production
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/monday/callback`;
    const state = crypto.randomBytes(32).toString('hex');
    
    const authUrl = `https://auth.monday.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    
    res.json({ authUrl, state });
  } catch (error) {
    logger.error('Monday.com OAuth authorize error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

oauthRouter.get('/monday/callback', async (req: express.Request, res: express.Response) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=${error}`);
    }
    
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_code`);
    }
    
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/monday/callback`;
    const accessToken = await MondaySkill.authenticate(code as string, redirectUri);
    
    // Get user info to store connection
    const mondaySkill = new MondaySkill(accessToken);
    const workspaces = await mondaySkill.getWorkspaces();
    
    if (workspaces.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_workspaces`);
    }
    
    const userId = req.query.user_id as string;
    
    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_user`);
    }
    
    // Store encrypted token
    const encryptedToken = encrypt(accessToken);
    
    await query(`
      INSERT INTO connections (user_id, platform, platform_user_id, access_token, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET access_token = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
    `, [userId, 'monday', workspaces[0].id, encryptedToken, true]);
    
    logger.info('Monday.com connection created:', { userId, workspaceId: workspaces[0].id });
    res.redirect(`${process.env.FRONTEND_URL}/connections?success=monday`);
  } catch (error) {
    logger.error('Monday.com OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/connections?error=callback_failed`);
  }
});

// ClickUp API Token Setup
oauthRouter.post('/clickup/connect', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const { apiToken } = req.body;
    const userId = (req as any).user!.userId;
    
    if (!apiToken) {
      return res.status(400).json({ error: 'API token is required' });
    }
    
    // Verify token works
    const clickupSkill = new ClickUpSkill(apiToken);
    const workspaces = await clickupSkill.getWorkspaces();
    
    if (workspaces.length === 0) {
      return res.status(400).json({ error: 'No workspaces found' });
    }
    
    // Store encrypted token
    const encryptedToken = encrypt(apiToken);
    
    await query(`
      INSERT INTO connections (user_id, platform, platform_user_id, access_token, is_active)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET access_token = $4, is_active = $5, updated_at = CURRENT_TIMESTAMP
    `, [userId, 'clickup', workspaces[0].id, encryptedToken, true]);
    
    logger.info('ClickUp connection created:', { userId, workspaceId: workspaces[0].id });
    res.json({ success: true, workspaces });
  } catch (error) {
    logger.error('ClickUp connection error:', error);
    res.status(500).json({ error: 'Failed to connect to ClickUp' });
  }
});

// Jira OAuth
oauthRouter.get('/jira/authorize', authenticateToken, async (req: express.Request, res: express.Response) => {
  try {
    const clientId = process.env.JIRA_CLIENT_ID;
    // Force HTTPS in production
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/jira/callback`;
    const state = crypto.randomBytes(32).toString('hex');
    const scope = 'read:jira-work write:jira-work manage:jira-project';
    
    const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code&prompt=consent`;
    
    res.json({ authUrl, state });
  } catch (error) {
    logger.error('Jira OAuth authorize error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

oauthRouter.get('/jira/callback', async (req: express.Request, res: express.Response) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=${error}`);
    }
    
    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_code`);
    }
    
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${req.get('host')}/api/oauth/jira/callback`;
    const { accessToken, cloudId } = await JiraSkill.authenticate(code as string, redirectUri);
    
    // Get user info to store connection
    const jiraSkill = new JiraSkill(accessToken, cloudId);
    const workspaces = await jiraSkill.getWorkspaces();
    
    if (workspaces.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_workspaces`);
    }
    
    const userId = req.query.user_id as string;
    
    if (!userId) {
      return res.redirect(`${process.env.FRONTEND_URL}/connections?error=no_user`);
    }
    
    // Store encrypted token with cloud ID in platform_config
    const encryptedToken = encrypt(accessToken);
    const platformConfig = JSON.stringify({ cloudId });
    
    await query(`
      INSERT INTO connections (user_id, platform, platform_user_id, access_token, platform_config, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, platform) 
      DO UPDATE SET access_token = $4, platform_config = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
    `, [userId, 'jira', cloudId, encryptedToken, platformConfig, true]);
    
    logger.info('Jira connection created:', { userId, cloudId });
    res.redirect(`${process.env.FRONTEND_URL}/connections?success=jira`);
  } catch (error) {
    logger.error('Jira OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/connections?error=callback_failed`);
  }
});

export { encrypt, decrypt };