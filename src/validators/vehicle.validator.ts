import { z } from 'zod';

export const createVehicleSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['van', 'bus', 'car', 'minibus', 'tourVehicle', 'coaster', 'suv', 'other']),
  brand: z.string().min(1).optional(),
  vehicleModel: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  year: z.coerce.number().int().min(1980).max(2100),
  registrationNumber: z.string().min(2),
  seatCount: z.coerce.number().int().positive().optional(),
  totalSeats: z.coerce.number().int().positive().optional(),
  amenities: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  seatConfiguration: z
    .object({
      rows: z.number().int().positive().optional(),
      seatsPerRow: z.number().int().positive().optional(),
      layoutType: z.string().optional(),
    })
    .optional(),
}).refine((data) => (data.seatCount ?? data.totalSeats ?? 0) >= 1, {
  message: 'Total seats must be at least 1',
  path: ['seatCount'],
});

export const rejectVehicleSchema = z.object({
  reason: z.string().min(5, 'Rejection reason is required'),
});

export const suspendVehicleSchema = z.object({
  reason: z.string().optional(),
});
