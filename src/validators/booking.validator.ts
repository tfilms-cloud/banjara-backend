import { z } from 'zod';

export const createBookingSchema = z
  .object({
    bookingType: z.enum(['transport', 'hotel', 'package', 'guide']),
    paymentMethod: z
      .enum([
        'cash',
        'payAtHotel',
        'bankTransfer',
        'easypaisa',
        'jazzcash',
        'raast',
      ])
      .default('bankTransfer'),
    transportBooking: z
      .object({
        tripId: z.string(),
        // Up to 60 so a whole vehicle (bus, coaster) can be hired; seat bookings are
        // limited to 10 in booking.service.
        seats: z.array(z.string()).min(1).max(60),
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
      // Passenger count vs seats depends on the trip's booking mode (by seat, or the
      // whole vehicle), so it is checked in booking.service once the trip is loaded.
      .refine((data) => data.passengerDetails.length <= data.seats.length, {
        message: 'More passengers than seats',
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
    packageBooking: z
      .object({
        itineraryId: z.string().min(1),
        startDate: z.string().min(8),
        travelers: z.number().int().positive().max(200),
        guestDetails: z.object({
          name: z.string().min(2),
          email: z.string().email(),
          phone: z.string().min(10),
          specialRequests: z.string().optional(),
        }),
      })
      .optional(),
    guideBooking: z
      .object({
        providerId: z.string().min(1),
        serviceId: z.string().optional(),
        date: z.string().min(8),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        durationHours: z.number().positive().optional(),
        guests: z.number().int().positive().max(50),
        meetingPoint: z.string().optional(),
        availableLocation: z.string().optional(),
        specialRequest: z.string().optional(),
        guestDetails: z.object({
          name: z.string().min(2),
          email: z.string().email(),
          phone: z.string().min(10),
          specialRequests: z.string().optional(),
        }),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.bookingType === 'package' && !data.packageBooking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Package booking details required',
        path: ['packageBooking'],
      });
    }
    if (data.bookingType === 'hotel' && !data.hotelBooking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hotel booking details required',
        path: ['hotelBooking'],
      });
    }
    if (data.bookingType === 'transport' && !data.transportBooking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Transport booking details required',
        path: ['transportBooking'],
      });
    }
    if (data.bookingType === 'guide' && !data.guideBooking) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Guide booking details required',
        path: ['guideBooking'],
      });
    }
  });
