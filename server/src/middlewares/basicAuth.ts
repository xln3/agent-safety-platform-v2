/**
 * Optional HTTP Basic Auth — gates the entire app when BASIC_AUTH_USER and
 * BASIC_AUTH_PASS are both set in the environment. When either is missing the
 * middleware is a no-op, so local development is never affected.
 *
 * Used to protect public-IP demo deployments where the .env carries upstream
 * API keys (Dify, aihubmix, doubao). Without this, anyone with the URL could
 * create an agent and burn tokens.
 */

import { Request, Response, NextFunction } from 'express';

const REALM = 'Agent Safety Platform';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedUser = process.env.BASIC_AUTH_USER || '';
  const expectedPass = process.env.BASIC_AUTH_PASS || '';
  if (!expectedUser || !expectedPass) {
    return next();
  }

  // Bypass health check so liveness probes don't get gated.
  if (req.path === '/api/health') return next();

  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
    res.status(401).send('Authentication required');
    return;
  }

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  } catch {
    res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
    res.status(401).send('Invalid credentials');
    return;
  }

  const idx = decoded.indexOf(':');
  if (idx === -1) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
    res.status(401).send('Invalid credentials');
    return;
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
    return next();
  }

  res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
  res.status(401).send('Invalid credentials');
}

export default basicAuth;
