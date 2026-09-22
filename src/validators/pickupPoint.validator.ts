import { z } from 'zod';

export const updatePickupPointSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  description: z.string().optional(),
  landmark: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  images: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});
