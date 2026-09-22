import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const isDev = env.NODE_ENV === 'development';

/** Global API limiter. Dev is much higher so Expo HMR / screen remounts don't brick the API. */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: {
    success: false,
    message: 'Too many auth attempts, please try again later',
    errors: [],
  },
});
