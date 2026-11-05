import { z } from 'zod';

const tourTypeEnum = z.enum(['trek', 'expedition', 'summit']);
const difficultyEnum = z.enum(['easy', 'moderate', 'hard']);
const statusEnum = z.enum(['draft', 'pending', 'published', 'rejected']);

const daySchema = z.object({
  dayNumber: z.coerce.number().int().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
});

export const createTourItinerarySchema = z.object({
  title: z.string().min(2).max(160),
  tourType: tourTypeEnum,
  summary: z.string().min(10).max(300),
  description: z.string().min(20).max(8000),
  destination: z.string().min(2).max(120),
  region: z.string().max(120).optional(),
  durationDays: z.coerce.number().int().min(1).max(90),
  durationNights: z.coerce.number().int().min(0).max(90).optional(),
  difficulty: difficultyEnum.optional(),
  maxParticipants: z.coerce.number().int().min(1).max(200),
  pricePerPerson: z.coerce.number().min(0),
  currency: z.string().optional().default('PKR'),
  included: z.array(z.string()).optional().default([]),
  excluded: z.array(z.string()).optional().default([]),
  days: z.array(daySchema).optional().default([]),
  coverImage: z.string().min(1),
  images: z.array(z.string()).optional().default([]),
  departureLocation: z.string().max(160).optional(),
  bestSeason: z.string().max(120).optional(),
  submitForReview: z.boolean().optional().default(false),
});

export const updateTourItinerarySchema = createTourItinerarySchema.partial().extend({
  submitForReview: z.boolean().optional(),
});

export const adminModerateItinerarySchema = z.object({
  action: z.enum(['approve', 'reject', 'feature', 'unfeature', 'unpublish']),
  reason: z.string().min(5).max(500).optional(),
});

export const listTourItineraryQuerySchema = z.object({
  tourType: tourTypeEnum.optional(),
  status: statusEnum.optional(),
  providerId: z.string().optional(),
  featured: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
