import { z } from 'zod';

export const createHotelSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  hotelType: z.enum(['hotel', 'resort', 'guestHouse', 'lodge']),
  address: z.string().min(3),
  city: z.string().min(2),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  cancellationPolicy: z.string().optional(),
  priceFrom: z.number().optional(),
});

export const searchHotelSchema = z.object({
  destination: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guests: z.coerce.number().optional(),
  rooms: z.coerce.number().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  hotelType: z.string().optional(),
  minRating: z.coerce.number().optional(),
  amenities: z.string().optional(),
});
