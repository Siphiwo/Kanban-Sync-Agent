import { Pool } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool;

export function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    pool.connect((err: any, client: any, release: any) => {
      if (err) {
        logger.error('Database connection failed:', err);
        reject(err);
        return;
      }
      
      logger.info('Database connected successfully');
      release();
      resolve();
    });
  });
}

export function getDb(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export async function query(text: string, params?: any[]): Promise<any> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}