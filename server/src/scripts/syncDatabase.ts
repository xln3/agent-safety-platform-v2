import 'dotenv/config';
import sequelize from '../config/database';
import { syncDatabase } from '../models';
import logger from '../utils/logger';

const FORCE_FLAG = process.argv.includes('--force');

async function main(): Promise<void> {
  try {
    // Verify database connection
    await sequelize.authenticate();
    logger.info('Database connection established successfully');

    if (FORCE_FLAG) {
      logger.warn('WARNING: Running with --force flag. This will DROP ALL TABLES and recreate them.');
      logger.warn('All existing data will be lost. Waiting 3 seconds...');
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));

      await syncDatabase({ force: true });
      logger.info('Database synced with { force: true } - all tables recreated');
    } else {
      await syncDatabase({ alter: true });
      logger.info('Database synced with { alter: true } - tables altered to match models');
    }

    logger.info('Database sync completed successfully');
  } catch (error: any) {
    logger.error('Database sync failed:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    logger.info('Database connection closed');
  }
}

main();
