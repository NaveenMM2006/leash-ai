import { CSRF_HEADER } from '@leash/shared';
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { isValidCsrfToken } from '../modules/auth/sessions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const VERCEL_DOMAIN = /^https:\/\/[a-z0-9_.-]+\.vercel\.app$/i;

/** Checks whether a request origin matches an allowed origin (supports exact, *.vercel.app, and custom wildcards). */
export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  try {
    const parsed = new URL(origin).origin;
    if (VERCEL_DOMAIN.test(parsed)) return true;
    for (const allowed of allowedOrigins) {
      if (allowed === parsed) return true;
      if (allowed.includes('*')) {
        const regexStr = '^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        if (new RegExp(regexStr, 'i').test(parsed)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Handles CORS headers for allowed origins and responds to OPTIONS preflights.
 * Disallowed origins receive no CORS headers so browsers block unauthorized cross-origin requests.
 */
export function corsMiddleware(allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-csrf-token, x-request-id, sec-fetch-site',
      );
      res.setHeader('Access-Control-Expose-Headers', 'x-request-id');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * Layer 1 — origin check for state-changing browser requests. A request that
 * declares a foreign Origin, or is marked cross-site by Sec-Fetch-Site, is
 * refused. Requests with neither header are not from a browser and so are not
 * a CSRF vector; they still need the CSRF token on authenticated routes.
 */
export function originGuard(allowedOrigins: string[]): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin !== undefined && !isOriginAllowed(origin, allowedOrigins)) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-origin request refused');
    }
    const fetchSite = req.get('sec-fetch-site');
    if (
      origin === undefined &&
      fetchSite !== undefined &&
      fetchSite !== 'same-origin' &&
      fetchSite !== 'none'
    ) {
      const referer = req.get('referer');
      if (referer && isOriginAllowed(referer, allowedOrigins)) {
        return next();
      }
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Cross-site request refused');
    }
    next();
  };
}

/**
 * Layer 2 — JSON-only bodies. HTML forms cannot send application/json without
 * a CORS preflight, which this server never approves.
 */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const hasBody =
    Number(req.get('content-length') ?? 0) > 0 || req.get('transfer-encoding') !== undefined;
  if (hasBody && !req.is('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json');
  }
  next();
};

/** Layer 3 — session-bound CSRF token on every authenticated state-changing request. */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.auth || !isValidCsrfToken(req.auth.sessionToken, req.get(CSRF_HEADER))) {
    throw new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token');
  }
  next();
};
