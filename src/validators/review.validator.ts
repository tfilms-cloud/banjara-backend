import { z } from 'zod';

const star = z.coerce.number().int().min(1).max(5);

export const createReviewSchema = z
  .object({
    bookingId: z.string().min(1),
    /** Overall fallback if dual ratings omitted (legacy clients). */
    rating: star.optional(),
    paymentRating: star.optional(),
    serviceRating: star.optional(),
    comment: z.string().max(800).optional(),
    paymentComment: z.string().max(400).optional(),
    serviceComment: z.string().max(400).optional(),
    categories: z.record(z.string(), star).optional(),
  })
  .superRefine((data, ctx) => {
    const hasDual = data.paymentRating != null && data.serviceRating != null;
    const hasOverall = data.rating != null;
    if (!hasDual && !hasOverall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide paymentRating and serviceRating (or a single rating)',
        path: ['paymentRating'],
      });
    }
  });

export const updateReviewSchema = z.object({
  rating: star.optional(),
  paymentRating: star.optional(),
  serviceRating: star.optional(),
  comment: z.string().max(800).optional(),
  paymentComment: z.string().max(400).optional(),
  serviceComment: z.string().max(400).optional(),
  categories: z.record(z.string(), star).optional(),
});

export const replyReviewSchema = z.object({
  reply: z.string().min(2).max(1000),
});
