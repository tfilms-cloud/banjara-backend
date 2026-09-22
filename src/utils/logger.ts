import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logger. JSON in production, human-readable in development.
 *
 * Redaction is configured explicitly rather than relying on remembering to strip fields
 * before logging — these values must never reach a log sink.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: undefined,
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'refreshTokenHash',
      'refreshToken',
      'accessToken',
      'token',
      'code',
      'authorization',
      'req.headers.authorization',
      'headers.authorization',
      'SUPABASE_SERVICE_ROLE_KEY',
      '*.password',
      '*.newPassword',
      '*.passwordHash',
      '*.refreshTokenHash',
      '*.refreshToken',
      '*.accessToken',
      '*.token',
      '*.authorization',
    ],
    censor: '[redacted]',
  },
});

type RequestContext = { requestId: string };
export const requestContext = new AsyncLocalStorage<RequestContext>();

/** Returns a logger bound to the current request id when one is in scope. */
export function log(): pino.Logger {
  const store = requestContext.getStore();
  return store ? logger.child({ requestId: store.requestId }) : logger;
}
