import { z } from 'zod';

export const createFavoriteSchema = z.object({
  targetType: z.enum(['trip', 'hotel', 'provider']),
  targetId: z.string().min(1),
});
