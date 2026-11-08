import { z } from 'zod';
import { DISCOVER_SERVICES } from '../discover/types';

const optionalText = (max: number) => z.string().trim().max(max).optional().catch(undefined);
const optionalCount = (max: number) => z.coerce.number().int().min(1).max(max).optional().catch(undefined);
/** A real calendar date as YYYY-MM-DD. */
const optionalDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    })
    .optional()
    .catch(undefined);

export const discoverQuerySchema = z.object({
  service: z.enum(DISCOVER_SERVICES).default('transport'),
  q: z.string().trim().max(160).optional(),
  city: z.string().trim().max(100).optional(),
  /** Sort id. Unknown ids fall back to "recommended". */
  order: z.string().max(32).optional(),
  /** "map" returns only listings that have a location, plus their bounds. */
  view: z.enum(['list', 'map']).default('list').catch('list'),
  /** Map viewport as "west,south,east,north" (degrees). Invalid values are ignored. */
  bbox: z.string().max(100).optional().catch(undefined),
  /** "Near me": the visitor's position as "lat,lng". Invalid values are ignored. */
  near: z.string().max(60).optional().catch(undefined),
  /** Radius for `near`, in km (1–50, default 10). */
  radius: z.coerce.number().min(1).max(50).optional().catch(undefined),
  /** Sub-type filter, e.g. "jeep", "guest_house", "female", "trek". */
  category: z.string().trim().max(32).optional(),
  /** Comma-separated quick-filter ids, e.g. "verified,topRated". */
  only: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(40),

  // Search constraints carried over from Home. Invalid values are dropped, never an error.
  /** Transport: departure and destination city, travel date, party size, trip style. */
  from: optionalText(100),
  to: optionalText(100),
  date: optionalDate(),
  returnDate: optionalDate(),
  passengers: optionalCount(100),
  journeyType: z.enum(['one_way', 'round_trip']).optional().catch(undefined),
  bookingMode: z.enum(['seat', 'vehicle']).optional().catch(undefined),
  /** Hotels: stay dates, guests and rooms (availability is checked when both dates are set). */
  checkIn: optionalDate(),
  checkOut: optionalDate(),
  adults: optionalCount(100),
  children: z.coerce.number().int().min(0).max(100).optional().catch(undefined),
  rooms: optionalCount(50),
});
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;
