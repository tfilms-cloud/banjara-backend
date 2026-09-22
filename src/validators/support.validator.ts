import { z } from 'zod';

export const updateSupportSchema = z.object({
  status: z.enum(['open', 'inProgress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});
