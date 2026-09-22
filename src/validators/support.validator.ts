import { z } from 'zod';

export const createSupportSchema = z.object({
  category: z.enum([
    'booking',
    'payment',
    'transport',
    'hotel',
    'provider',
    'technical',
    'other',
  ]),
  subject: z.string().min(2).max(200),
  message: z.string().min(1).max(4000),
  bookingId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  // `status` is deliberately absent: a user must not open a ticket pre-resolved.
});

export const updateSupportSchema = z.object({
  status: z.enum(['open', 'inProgress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});
