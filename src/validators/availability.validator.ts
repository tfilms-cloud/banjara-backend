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
