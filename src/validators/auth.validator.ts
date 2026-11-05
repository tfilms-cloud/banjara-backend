import { z } from 'zod';
import { newPasswordSchema } from './password';

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  password: newPasswordSchema,
  role: z.enum(['customer', 'provider']).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

export const refreshSchema = z.object({
  // Optional: browser sessions send it as an httpOnly cookie instead.
  refreshToken: z.string().min(10).max(4096).optional(),
});

/** A 6-digit authenticator code or an 8-character recovery code like `7KQ2-M9XD`. */
const mfaCode = z.string().trim().min(6).max(12);

export const loginMfaSchema = z.object({
  mfaToken: z.string().min(10).max(2048),
  code: mfaCode,
});

export const twoFactorEnableSchema = z.object({ code: mfaCode });

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(200),
  code: mfaCode,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  newPassword: newPasswordSchema,
});
