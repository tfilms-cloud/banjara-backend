import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  password: z.string().min(6),
  role: z.enum(['customer', 'provider']).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
  newPassword: z.string().min(6),
});
