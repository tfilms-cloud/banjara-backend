import { z } from 'zod';

export const createBookingSchema = z.object({
  bookingType: z.enum(['transport', 'hotel', 'package']),
  paymentMethod: z.enum(['card', 'mobileWallet', 'cash', 'payAtHotel']).default('card'),
  transportBooking: z
    .object({
      tripId: z.string(),
      seats: z.array(z.string()).min(1).max(10),
      pickupPoint: z.string().optional(),
      dropoffPoint: z.string().optional(),
      passengerDetails: z
        .array(
          z.object({
            name: z.string().min(2),
            phone: z.string().optional(),
          })
        )
        .min(1)
        .max(10),
    })
    .refine((data) => new Set(data.seats).size === data.seats.length, {
      message: 'Duplicate seat numbers are not allowed',
      path: ['seats'],
    })
    .refine((data) => data.passengerDetails.length === data.seats.length, {
      message: 'Number of passengers must match number of seats',
      path: ['passengerDetails'],
    })
    .optional(),
  hotelBooking: z
    .object({
      hotelId: z.string(),
      roomId: z.string(),
      checkIn: z.string(),
      checkOut: z.string(),
      rooms: z.number().int().positive(),
      guests: z.number().int().positive(),
      guestDetails: z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(10),
        specialRequests: z.string().optional(),
      }),
    })
    .optional(),
});
