import { z } from 'zod';

export const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().min(1).max(5),
  comment: z.string().optional(),
  categories: z.record(z.string(), z.number().min(1).max(5)).optional(),
});

export const updateReviewSchema = z.object({
  rating: z.number().min(1).max(5).optional(),
  comment: z.string().optional(),
  categories: z.record(z.string(), z.number().min(1).max(5)).optional(),
});

export const replyReviewSchema = z.object({
  reply: z.string().min(2),
});
