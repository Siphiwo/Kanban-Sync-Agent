import { readFileSync } from 'fs';
import { join } from 'path';
import { initDatabase, query } from './index';
import { logger } from '../utils/logger';

async function runMigrations() {
  try {
    await initDatabase();
    
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    logger.info('Running database migrations...');
    await query(schema);
    logger.info('Database migrations completed successfully');
    
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();