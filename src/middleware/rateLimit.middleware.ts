import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import type { AuthRequest } from './auth.middleware';

const isDev = env.NODE_ENV === 'development';
const isTest = env.NODE_ENV === 'test';

/**
 * Rate limiters intentionally skip in tests: the default store is process-local, and a
 * full suite legitimately issues more auth requests than a production window allows.
 * Task-specific throttles (e.g. the per-account password-reset throttle) are implemented
 * in the service layer and are still exercised in tests.
 */
const skipInTest = () => isTest;

/** Global API limiter. Dev is much higher so Expo HMR / screen remounts don't brick the API. */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
    errors: [],
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 200 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    success: false,
    message: 'Too many auth attempts, please try again later',
    errors: [],
  },
});

/** Per-user upload limiter — keyed by authenticated user id (the route requires auth). */
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'anonymous',
  message: {
    success: false,
    message: 'Too many uploads, please try again later',
    errors: [],
  },
});
