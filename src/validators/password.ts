import { z } from 'zod';

/**
 * Rule for every password a user chooses (register, reset, change). Login is not
 * checked against it, so accounts created under the older 6-character rule still
 * sign in. 72 is bcrypt's input limit; longer input would be silently truncated.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');
