import { z } from 'zod';

export const cnicVerifyBodySchema = z.object({
  cnicNumber: z.string().min(13).max(20),
  fatherName: z.string().min(2).max(80),
  expiryDate: z.string().min(8).max(32),
});
