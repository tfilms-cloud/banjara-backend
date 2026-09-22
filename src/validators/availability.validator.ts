import { z } from 'zod';

/**
 * Provider-editable inventory for a single night. `bookedRooms` is booking-driven and
 * `availableRooms` is derived — neither may be set by a provider.
 */
export const updateAvailabilitySchema = z.object({
  date: z.string().min(8),
  totalRooms: z.number().int().nonnegative().optional(),
  blockedRooms: z.number().int().nonnegative().optional(),
  priceOverride: z.number().nonnegative().optional(),
});

export const roomBlockSchema = z.object({
  roomId: z.string().min(1),
  date: z.string().min(8),
  count: z.number().int().positive(),
});

export const bulkAvailabilitySchema = z.object({
  roomId: z.string().min(1),
  from: z.string().min(8),
  to: z.string().min(8),
  totalRooms: z.number().int().nonnegative().optional(),
  priceOverride: z.number().nonnegative().optional(),
  block: z.boolean().optional(),
  unblock: z.boolean().optional(),
  blockCount: z.number().int().positive().optional(),
});
