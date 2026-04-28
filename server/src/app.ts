import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import config from './config';
import routes from './routes';
import { openapiSpec } from './openapi/spec';
import { successResponse, errorResponse } from './utils/response';
import logger from './utils/logger';
import basicAuth from './middlewares/basicAuth';

const app = express();

// helmet defaults disable inline scripts / styles which break the Vite-built
// SPA bundle. Loosen CSP to what the bundle needs while keeping every other
// helmet protection intact.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS middleware — public-IP demos need to whitelist the deployed origin via
// CORS_ORIGINS env (comma-separated).
const corsOrigins = config.corsOrigins.split(',').map((origin) => origin.trim());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Optional HTTP Basic Auth — wraps every route below. No-op unless
// BASIC_AUTH_USER + BASIC_AUTH_PASS are both set.
app.use(basicAuth);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan('dev'));

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json(
    successResponse({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  );
});

// Public API documentation — must be mounted before the Bearer auth gate so
// integrators can browse the doc without a token. Calling APIs from the
// "Try it out" panel still requires the token via the Authorize button.
app.get('/api/docs.json', (_req: Request, res: Response) => {
  res.json(openapiSpec);
});
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: '智能体安全评估平台 API',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      tagsSorter: 'alpha',
    },
  }),
);

// Bearer token auth
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!config.apiToken) return next();
  if (req.path === '/health') return next();
  if (req.path === '/docs.json' || req.path.startsWith('/docs')) return next();
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${config.apiToken}`) return next();
  res.status(401).json({ code: 401, message: '未授权，请提供有效的 API Token', data: null });
});

// Mount API routes
app.use('/api', routes);

// ---------------------------------------------------------------------------
// SPA static serving (single-port public deployment)
//
// When the frontend is built (npm run build → /dist), Express serves it as
// static assets and falls back to index.html for client-side routes. This lets
// us expose only port 3002 publicly, instead of 3002 + 5173.
//
// Directory resolution (the server can be invoked from either /server or root):
//   1. ../../dist (repo root /dist) — the standard layout
//   2. ../dist — when server/ has been re-rooted somewhere else
//   3. process.env.FRONTEND_DIST — explicit override
// ---------------------------------------------------------------------------
const distCandidates = [
  process.env.FRONTEND_DIST,
  path.resolve(__dirname, '..', '..', '..', 'dist'),
  path.resolve(__dirname, '..', '..', 'dist'),
].filter((p): p is string => !!p && fs.existsSync(p));

if (distCandidates.length > 0) {
  const distDir = distCandidates[0];
  logger.info(`Serving SPA static bundle from ${distDir}`);
  app.use(express.static(distDir));
  // SPA history fallback — every non-/api GET returns index.html so React Router
  // can take over.
  app.get(/^\/(?!api(?:\/|$)).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  logger.info('SPA dist not found — frontend must be served separately (vite dev)');
}

// 404 handler — only reached when no SPA bundle is mounted
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
