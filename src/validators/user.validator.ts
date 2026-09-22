import { z } from 'zod';

/**
 * Fields a user may change about themselves.
 *
 * Deliberately NOT permitted: `role`, `status`, `passwordHash`, `refreshTokenHash`,
 * `_id`, `createdAt`, `updatedAt`. Zod strips unknown keys and the validation
 * middleware replaces `req.body` with the parsed object, so those cannot reach the
 * service. `user.service.updateMe` additionally builds its update document from named
 * fields as a second line of defence.
 */
export const userUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(30).optional(),
  email: z.string().email().optional(),
  avatar: z.string().url().optional().or(z.literal('')),
  preferences: z.record(z.string(), z.unknown()).optional(),
});
