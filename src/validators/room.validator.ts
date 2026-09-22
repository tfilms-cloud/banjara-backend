import { z } from 'zod';

export const createRoomSchema = z.object({
  hotelId: z.string().min(1),
  name: z.string().min(2),
  roomType: z.enum(['single', 'double', 'twin', 'deluxe', 'suite', 'family']),
  bedType: z.string().min(2),
  capacity: z.number().int().positive(),
  size: z.number().optional(),
  pricePerNight: z.number().positive(),
  totalRooms: z.number().int().positive(),
  amenities: z.array(z.string()).optional(),
  breakfastIncluded: z.boolean().optional(),
  cancellationPolicy: z.string().optional(),
  images: z.array(z.string()).optional(),
});

export const updateRoomSchema = createRoomSchema.partial().omit({ hotelId: true }).extend({
  sizeSqm: z.number().optional(),
  quantity: z.number().int().positive().optional(),
  freeCancellation: z.boolean().optional(),
  available: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
