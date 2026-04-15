import 'dotenv/config';
import app from './app';
import sequelize from './config/database';
import { syncDatabase } from './models';
import config from './config';
import logger from './utils/logger';

async function main(): Promise<void> {
  // Verify database connection
  await sequelize.authenticate();
  logger.info('Database connection established successfully');

  // Sync models with database
  if (config.nodeEnv === 'development') {
    await syncDatabase({ alter: true });
    logger.info('Database synced with { alter: true }');
  } else {
    await syncDatabase();
    logger.info('Database synced');
  }

  // Start HTTP server
  const port = config.server.port;
  app.listen(port, () => {
    logger.info(`Agent Safety Evaluation Platform server running on port ${port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Health check: http://localhost:${port}/api/health`);
  });
}

main().catch((error) => {
  logger.error('Failed to start server:', error.message);
  process.exit(1);
});
