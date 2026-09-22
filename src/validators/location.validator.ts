import { z } from 'zod';

export const structuredAddressSchema = z.object({
  street: z.string().optional(),
  area: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  formattedAddress: z.string().optional(),
});

export const geoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z
    .tuple([z.number(), z.number()])
    .refine(([lng, lat]) => lng >= -180 && lng <= 180, {
      message: 'Longitude must be between -180 and 180',
    })
    .refine(([lng, lat]) => lat >= -90 && lat <= 90, {
      message: 'Latitude must be between -90 and 90',
    }),
});

export const saveBusinessLocationSchema = z.object({
  address: structuredAddressSchema,
  location: geoPointSchema,
});

export const nearbyBusinessQuerySchema = z.object({
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  radius: z.coerce.number().positive().max(100000).optional().default(5000),
  category: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
});

export const geocodeSearchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().positive().max(10).optional().default(5),
});

export const reverseGeocodeQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
