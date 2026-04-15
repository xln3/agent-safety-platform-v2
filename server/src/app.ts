import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import config from './config';
import routes from './routes';
import { successResponse, errorResponse } from './utils/response';
import logger from './utils/logger';

const app = express();

// CORS middleware
const corsOrigins = config.corsOrigins.split(',').map((origin) => origin.trim());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan('dev'));

// Mount API routes
app.use('/api', routes);

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json(
    successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  );
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json(errorResponse('Resource not found', 404));
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', err.message);
  const statusCode = (err as any).statusCode || 500;
  const message = config.nodeEnv === 'production' ? 'Internal server error' : err.message;
  res.status(statusCode).json(errorResponse(message));
});

export default app;
