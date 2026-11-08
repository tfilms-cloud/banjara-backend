/** Public contract of GET /api/discover — one card shape for every Explore service. */
export const DISCOVER_SERVICES = ['transport', 'hotels', 'tours', 'guides', 'restaurants'] as const;
export type DiscoverService = (typeof DISCOVER_SERVICES)[number];

export type DiscoverSort = 'recommended' | 'price' | 'rating' | 'soonest';
export type DiscoverToggle = 'topRated' | 'verified' | 'freeCancel' | 'breakfast';

export interface DiscoverTarget {
  /** What the client should open. Clients build their own route from this. */
  type: 'trip' | 'hotel' | 'provider';
  id: string;
  providerId?: string;
}

/** Where a listing is, for map pins. Coordinates are WGS84 degrees. */
export interface DiscoverLocation {
  lat: number;
  lng: number;
  address: string;
  /** True when the position is deliberately blurred (e.g. a guide's home area). */
  approximate?: boolean;
}

export interface DiscoverRoute {
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
}

export interface DiscoverCard {
  id: string;
  service: DiscoverService;
  title: string;
  subtitle: string;
  city: string;
  image: string | null;
  price: number | null;
  priceUnit: string | null;
  rating: number | null;
  reviewCount: number;
  verified: boolean;
  tags: string[];
  target: DiscoverTarget;
  /** Transport only: ISO-like "YYYY-MM-DDTHH:mm" departure (Pakistan local time). */
  departsAt?: string;
  /** Per-service sub-type: vehicle class, residence type, guide gender or tour type. */
  category?: string;
  /** Pin position, or null when the listing has no usable coordinates. */
  location?: DiscoverLocation | null;
  /** Transport only: departure and destination points, to draw the route. */
  route?: DiscoverRoute | null;
  /** Restaurants: active sales/offers/discounts. */
  offers?: Array<{ title: string; type: string; discountPercent: number }>;
  /** Guides: spoken languages. */
  languages?: string[];
  freeCancellation?: boolean;
  breakfastIncluded?: boolean;
  /** Only with `near`: straight-line distance (km, 1 decimal) from the visitor to the pin. */
  distanceKm?: number;
}

export interface DiscoverOptions {
  sorts: Array<{ id: DiscoverSort; label: string }>;
  toggles: Array<{ id: DiscoverToggle; label: string }>;
  /** Sub-types that currently have listings (vehicle class, residence, gender, tour type). */
  categories: Array<{ id: string; label: string }>;
}

export interface DiscoverResult {
  service: DiscoverService;
  total: number;
  items: DiscoverCard[];
  /** Which chips this service offers — clients render these instead of hard-coding them. */
  options: DiscoverOptions;
  applied: { order: DiscoverSort; only: DiscoverToggle[]; category: string | null };
  /** Map view only: [[south, west], [north, east]] around the returned pins. */
  bounds: [[number, number], [number, number]] | null;
  /** The "near me" search that was applied, or null. */
  near: { lat: number; lng: number; radiusKm: number } | null;
}
