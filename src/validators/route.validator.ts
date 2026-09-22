import { z } from 'zod';

const placeSchema = z.union([
  z.string().min(1),
  z.object({
    name: z.string().min(1),
    latitude: z.number(),
    longitude: z.number(),
  }),
]);

export const createRouteSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(z.string()).optional(),
  distance: z.coerce.number().optional(),
  distanceKm: z.coerce.number().optional(),
  estimatedDuration: z.coerce.number().optional(),
  durationHours: z.coerce.number().optional(),
});

export const updateRouteSchema = z.object({
  origin: placeSchema.optional(),
  destination: placeSchema.optional(),
  stops: z.array(z.string()).optional(),
  distance: z.coerce.number().optional(),
  distanceKm: z.coerce.number().optional(),
  estimatedDuration: z.coerce.number().optional(),
  durationHours: z.coerce.number().optional(),
});
