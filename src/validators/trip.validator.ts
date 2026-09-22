import { z } from 'zod';

export const createTripSchema = z.object({
  vehicleId: z.string().min(1),
  routeId: z.string().optional(),
  origin: z.string().min(2),
  destination: z.string().min(2),
  departureDate: z.string().min(8),
  departureTime: z.string().min(4),
  arrivalDate: z.string().optional(),
  arrivalTime: z.string().optional(),
  pickupPoints: z.array(z.string()).optional(),
  dropoffPoints: z.array(z.string()).optional(),
  price: z.coerce.number().positive(),
  amenities: z.array(z.string()).optional(),
  description: z.string().optional(),
  journeyType: z.enum(['one_way', 'round_trip']).optional().default('one_way'),
  returnDate: z.string().optional(),
  returnTime: z.string().optional(),
});

/**
 * Provider-editable trip fields. Moderation/system fields (`status`, seat counters,
 * `seatLayout`, `providerId`, `vehicleId`) are deliberately absent.
 */
export const updateTripSchema = z.object({
  routeId: z.string().optional(),
  origin: z.string().min(2).optional(),
  destination: z.string().min(2).optional(),
  departureDate: z.string().min(8).optional(),
  departureTime: z.string().min(4).optional(),
  arrivalDate: z.string().optional(),
  arrivalTime: z.string().optional(),
  pickupPoints: z.array(z.string()).optional(),
  dropoffPoints: z.array(z.string()).optional(),
  price: z.coerce.number().positive().optional(),
  amenities: z.array(z.string()).optional(),
  description: z.string().optional(),
  journeyType: z.enum(['one_way', 'round_trip']).optional(),
  returnDate: z.string().optional(),
  returnTime: z.string().optional(),
});

export const searchTripSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  date: z.string().optional(),
  passengers: z.coerce.number().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  vehicleType: z.string().optional(),
  journeyType: z.enum(['one_way', 'round_trip']).optional(),
  providerId: z.string().optional(),
});
