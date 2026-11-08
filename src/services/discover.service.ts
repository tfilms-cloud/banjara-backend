import { Hotel } from '../models/Hotel';
import { ProviderProfile } from '../models/ProviderProfile';
import { TourItinerary } from '../models/TourItinerary';
import { Trip } from '../models/Trip';
import {
  categoryOptions,
  isKnownCategory,
  matchesCategory,
  residenceClassOf,
  vehicleClassOf,
} from '../discover/categories';
import { applyRefine, discoverOptions, sanitizeRefine } from '../discover/refine';
import type {
  DiscoverCard,
  DiscoverLocation,
  DiscoverResult,
  DiscoverRoute,
  DiscoverService,
} from '../discover/types';
import { escapeRegex } from '../utils/regex';
import { searchGuides } from './guide.service';
import { bookableHotelFilter, searchHotels } from './hotel.service';

// Lean Mongo documents; every field is read defensively below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const CANDIDATE_CAP = 300;
const idOf = (value: unknown): string => String((value as Row | undefined)?._id ?? value ?? '');
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const first = (list: unknown): string | null =>
  Array.isArray(list) ? (list.find((item) => typeof item === 'string' && item) ?? null) : null;
const rated = (rating: unknown): number | null => {
  const value = Number(rating);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** A usable WGS84 point, or null. (0,0) is treated as "not set". */
function point(lat: unknown, lng: unknown, address: string, approximate = false): DiscoverLocation | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180 || (la === 0 && ln === 0)) return null;
  return approximate ? { lat: la, lng: ln, address, approximate: true } : { lat: la, lng: ln, address };
}
/** GeoJSON stores [longitude, latitude]. */
function geoPoint(location: unknown, address: string): DiscoverLocation | null {
  const coords = (location as Row | undefined)?.coordinates;
  return Array.isArray(coords) ? point(coords[1], coords[0], address) : null;
}
/** ~1 km grid: enough to show the area, not a doorstep. */
const blur = (value: number) => Math.round(value * 100) / 100;

/** Today's date in Pakistan (trips are published in local time). */
function pakistanToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(now);
}

function matches(query: string, ...parts: Array<string | undefined>): boolean {
  return !query || parts.join(' ').toLowerCase().includes(query.toLowerCase());
}

/** Search constraints Home hands to Explore. All optional. */
export interface TripSearch {
  from?: string;
  to?: string;
  date?: string;
  returnDate?: string;
  passengers?: number;
  journeyType?: 'one_way' | 'round_trip';
  bookingMode?: 'seat' | 'vehicle';
}
export interface StaySearch {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  children?: number;
  rooms?: number;
}

/** Pin at the first pickup point with coordinates, else at the departure city. */
function tripLocation(trip: Row): DiscoverLocation | null {
  const pickups: Row[] = Array.isArray(trip.pickupPoints) ? trip.pickupPoints : [];
  for (const pickup of pickups) {
    const label = text(pickup.address) || text(pickup.name) || text(trip.origin);
    const found = point(pickup.latitude, pickup.longitude, label);
    if (found) return found;
  }
  return point(trip.originLat, trip.originLng, text(trip.origin));
}
function tripRoute(trip: Row): DiscoverRoute | null {
  const from = point(trip.originLat, trip.originLng, text(trip.origin));
  const to = point(trip.destinationLat, trip.destinationLng, text(trip.destination));
  return from && to
    ? { from: { lat: from.lat, lng: from.lng, name: from.address }, to: { lat: to.lat, lng: to.lng, name: to.address } }
    : null;
}

async function transportCards(
  query: string,
  city: string,
  now: Date,
  search: TripSearch
): Promise<DiscoverCard[]> {
  const today = pakistanToday(now);
  const filter: Row = {
    status: 'scheduled',
    availableSeats: { $gte: Math.max(1, search.passengers ?? 1) },
    price: { $gt: 0 },
    // A requested date in the past can never match; $eq with $gte yields no rows.
    departureDate: search.date ? { $gte: today, $eq: search.date } : { $gte: today },
    // A City to City whole-car ride belongs to one rider; it is never for sale.
    $nor: [{ rideType: 'intercity', bookingMode: 'vehicle' }],
  };
  const destination = search.to || city;
  if (destination) filter.destination = new RegExp(escapeRegex(destination), 'i');
  if (search.from) filter.origin = new RegExp(escapeRegex(search.from), 'i');
  if (search.journeyType) filter.journeyType = search.journeyType;
  if (search.bookingMode) filter.bookingMode = search.bookingMode;
  if (search.returnDate) filter.returnDate = new RegExp(`^${search.returnDate}`);
  const trips: Row[] = await Trip.find(filter)
    .sort({ departureDate: 1, departureTime: 1 })
    .limit(CANDIDATE_CAP)
    .populate('providerId', 'businessName logo rating totalReviews verificationStatus')
    .populate('vehicleId', 'name type images verificationDetails')
    .populate('pickupPoints', 'name address latitude longitude')
    .lean();

  // One listing per vehicle, represented by its lowest fare (Map keeps first-seen order).
  const byVehicle = new Map<string, Row>();
  for (const trip of trips) {
    if (Date.parse(`${trip.departureDate}T${trip.departureTime}:00+05:00`) <= now.getTime()) continue;
    const key = `${idOf(trip.providerId)}-${idOf(trip.vehicleId)}`;
    const current = byVehicle.get(key);
    if (!current || trip.price < current.price) byVehicle.set(key, trip);
  }

  return [...byVehicle.values()]
    .map((trip): DiscoverCard => {
      const provider: Row = trip.providerId ?? {};
      const vehicle: Row = trip.vehicleId ?? {};
      return {
        id: idOf(trip),
        service: 'transport',
        title: text(vehicle.name) || text(vehicle.type) || 'Vehicle',
        subtitle: text(provider.businessName),
        city: text(trip.destination),
        image: first(vehicle.images) ?? (text(provider.logo) || null),
        price: trip.price,
        priceUnit: trip.bookingMode === 'vehicle' ? 'per vehicle' : 'per seat',
        rating: rated(provider.rating),
        reviewCount: Number(provider.totalReviews ?? 0),
        verified: provider.verificationStatus === 'approved',
        tags: [
          `${trip.origin} → ${trip.destination}`,
          ...(Array.isArray(trip.amenities) ? trip.amenities.slice(0, 2) : []),
        ],
        target: { type: 'trip', id: idOf(trip), providerId: idOf(provider) || undefined },
        departsAt: `${trip.departureDate}T${trip.departureTime}`,
        category: vehicleClassOf(vehicle.verificationDetails?.vehicleClass, vehicle.type),
        location: tripLocation(trip),
        route: tripRoute(trip),
      };
    })
    .filter((card) => matches(query, card.title, card.subtitle, card.tags[0]));
}

async function hotelCards(query: string, city: string, stay: StaySearch): Promise<DiscoverCard[]> {
  let hotels: Row[];
  if (stay.checkIn && stay.checkOut) {
    // Dated search: reuse the hotel service so room availability and stay prices match booking.
    const result = await searchHotels({
      destination: city || undefined,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      rooms: stay.rooms ?? 1,
      guests: (stay.adults ?? 1) + (stay.children ?? 0),
      sort: 'rating',
      limit: 100,
    });
    hotels = (result.items as unknown as Row[]).map((hotel) =>
      typeof hotel.toObject === 'function' ? hotel.toObject() : hotel
    );
  } else {
    const filter: Row = { ...bookableHotelFilter() };
    if (city) filter.city = new RegExp(escapeRegex(city), 'i');
    hotels = await Hotel.find(filter).sort({ rating: -1, reviewCount: -1 }).limit(CANDIDATE_CAP).lean();
  }
  return hotels
    .filter((hotel) => matches(query, text(hotel.name), text(hotel.city), text(hotel.address)))
    .map((hotel): DiscoverCard => {
      const amenities: string[] = Array.isArray(hotel.amenities) ? hotel.amenities.map(String) : [];
      const freeCancellation = String(hotel.cancellationPolicy ?? 'free cancellation')
        .toLowerCase()
        .includes('free cancellation');
      const breakfastIncluded = amenities.some((item) => item.toLowerCase().includes('breakfast'));
      return {
        id: idOf(hotel),
        service: 'hotels',
        title: text(hotel.name),
        subtitle: text(hotel.city),
        city: text(hotel.city),
        image: first(hotel.images),
        price: Number(hotel.priceFrom) > 0 ? Number(hotel.priceFrom) : null,
        priceUnit: 'per night',
        rating: rated(hotel.rating),
        reviewCount: Number(hotel.reviewCount ?? 0),
        verified: Boolean(hotel.isVerified),
        tags: [breakfastIncluded ? 'Breakfast included' : '', freeCancellation ? 'Free cancellation' : ''].filter(
          Boolean
        ),
        target: { type: 'hotel', id: idOf(hotel), providerId: idOf(hotel.providerId) || undefined },
        freeCancellation,
        breakfastIncluded,
        category: residenceClassOf(hotel.hotelType),
        location: geoPoint(hotel.location, text(hotel.address) || text(hotel.city)),
      };
    });
}

/** Provider profile locations by id (GeoJSON [lng, lat]). */
async function providerPlaces(ids: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const valid = ids.filter((id) => /^[0-9a-f]{24}$/i.test(id));
  if (!valid.length) return new Map();
  const rows: Row[] = await ProviderProfile.find({ _id: { $in: valid } })
    .select('location')
    .lean();
  const out = new Map<string, { lat: number; lng: number }>();
  for (const row of rows) {
    const found = geoPoint(row.location, '');
    if (found) out.set(idOf(row), { lat: found.lat, lng: found.lng });
  }
  return out;
}

/** Guides: same source the apps used (approved guide profiles). */
async function guideCards(query: string, city: string): Promise<DiscoverCard[]> {
  const rows: Row[] = await searchGuides({});
  const places = await providerPlaces(rows.map((row) => String(row.id ?? row._id ?? '')));
  return rows
    .map((row): DiscoverCard => {
      const guide: Row = row.guide ?? {};
      // searchGuides returns a plain `id` (not `_id`), so idOf() would stringify the whole row.
      const guideId = String(row.id ?? row._id ?? '');
      const place = text(row.city) || text(guide.city);
      const languages = [
        ...new Set(
          [
            ...(Array.isArray(guide.languages)
              ? guide.languages.map((l: unknown) => (typeof l === 'string' ? l : text((l as Row)?.language)))
              : []),
            ...(Array.isArray(guide.regionalLanguages) ? guide.regionalLanguages : []),
            ...(Array.isArray(guide.internationalLanguages) ? guide.internationalLanguages : []),
          ]
            .map(String)
            .filter(Boolean)
        ),
      ];
      const years = Number(guide.yearsExperience ?? row.yearsExperience);
      const gender = text(guide.gender).toLowerCase();
      return {
        id: guideId,
        service: 'guides',
        title: text(guide.fullName) || text(row.businessName) || 'Local guide',
        subtitle: place,
        city: place,
        image: text(row.logo) || text(guide.profilePhoto) || null,
        price: Number(row.fromPrice) > 0 ? Number(row.fromPrice) : null,
        priceUnit: Number(row.fromPrice) > 0 ? 'from · guide service' : null,
        rating: rated(row.rating),
        reviewCount: Number(row.totalReviews ?? 0),
        verified: guide.profileStatus === 'approved',
        tags: [
          years > 0 ? `${years} years of experience` : '',
          ...(Array.isArray(guide.guideTypes) ? guide.guideTypes.map(String) : []),
        ].filter(Boolean),
        target: { type: 'provider', id: guideId, providerId: idOf(row) },
        category: gender === 'male' || gender === 'female' ? gender : undefined,
        languages,
        // Guides often work from home: show the area (≈1 km grid) and the city, never the address.
        location: (() => {
          const found = places.get(guideId);
          return found ? point(blur(found.lat), blur(found.lng), `${place || 'Area'} (approximate area)`, true) : null;
        })(),
      };
    })
    .filter(
      (card) =>
        (!city || card.city.toLowerCase().includes(city.toLowerCase())) &&
        matches(query, card.title, card.city, ...card.tags)
    );
}

/** Tours: published itineraries, as in the apps (not the operator's profile blurb). */
async function tourCards(query: string, city: string): Promise<DiscoverCard[]> {
  const tours: Row[] = await TourItinerary.find({ status: 'published' })
    .sort({ featured: -1, publishedAt: -1, createdAt: -1 })
    .limit(100)
    .populate('providerId', 'businessName logo rating totalReviews verificationStatus location address city')
    .lean();
  return tours
    .map((tour): DiscoverCard => {
      const provider: Row = tour.providerId ?? {};
      const days = Number(tour.durationDays);
      return {
        id: idOf(tour),
        service: 'tours',
        title: text(tour.title) || 'Mountain tour',
        subtitle: text(tour.destination),
        city: text(tour.destination),
        image: text(tour.coverImage) || first(tour.images),
        price: Number(tour.pricePerPerson) > 0 ? Number(tour.pricePerPerson) : null,
        priceUnit: 'per person',
        rating: rated(provider.rating),
        reviewCount: Number(provider.totalReviews ?? 0),
        verified: provider.verificationStatus === 'approved',
        tags: [days > 0 ? `${days} day${days === 1 ? '' : 's'}` : '', text(provider.businessName)].filter(Boolean),
        target: { type: 'provider', id: idOf(tour), providerId: idOf(provider) || undefined },
        category: text(tour.tourType).toLowerCase() || undefined,
        location: geoPoint(provider.location, text(tour.departureLocation) || text(provider.address) || text(tour.destination)),
      };
    })
    .filter(
      (card) =>
        (!city || card.city.toLowerCase().includes(city.toLowerCase())) &&
        matches(query, card.title, card.city, ...card.tags)
    );
}

/** Restaurants: provider profiles offering "restaurant", ranked by visit score. */
async function restaurantCards(query: string, city: string): Promise<DiscoverCard[]> {
  const providers: Row[] = await ProviderProfile.find({
    services: 'restaurant',
    verificationStatus: { $in: ['approved', 'pending'] },
  })
    .sort({ rating: -1, createdAt: -1 })
    .limit(CANDIDATE_CAP)
    .lean();

  return providers
    .map((p) => {
      const d: Row = p.restaurantDetails ?? {};
      const place = text(d.city) || text(p.city);
      const offers = (Array.isArray(d.offers) ? (d.offers as Row[]) : [])
        .filter((o) => o.active !== false && o.title)
        .map((o) => ({
          title: String(o.title),
          type: String(o.type ?? 'offer'),
          discountPercent: Number(o.discountPercent ?? 0),
        }));
      const rating = Number(p.rating ?? 0);
      const reviews = Number(p.totalReviews ?? 0);
      const variety = Array.isArray(d.menuVariety) ? d.menuVariety.length : 0;
      const visitScore = rating * 10 + reviews + variety * 2 + offers.length;
      const card: DiscoverCard = {
        id: idOf(p),
        service: 'restaurants',
        title: text(d.restaurantName) || text(p.businessName) || 'Restaurant',
        subtitle: place,
        city: place,
        image: first(d.images) ?? (text(p.logo) || null),
        price: null,
        priceUnit: null,
        rating: rated(p.rating),
        reviewCount: reviews,
        verified: p.verificationStatus === 'approved',
        tags: Array.isArray(d.cuisineTypes) ? d.cuisineTypes.map(String) : [],
        target: { type: 'provider', id: idOf(p), providerId: idOf(p) },
        offers,
        location:
          point(d.latitude, d.longitude, text(d.address) || text(p.address) || place) ??
          geoPoint(p.location, text(d.address) || text(p.address) || place),
      };
      return { card, visitScore };
    })
    .sort((a, b) => b.visitScore - a.visitScore)
    .map(({ card }) => card)
    .filter(
      (card) =>
        (!city || card.city.toLowerCase().includes(city.toLowerCase())) &&
        matches(query, card.title, card.city, ...card.tags)
    );
}

/** "west,south,east,north" -> numbers, or null when malformed. */
function parseBbox(raw: string | undefined): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (s < -90 || n > 90 || w < -180 || e > 180 || s > n) return null;
  return [w, s, e, n];
}
/** "lat,lng" -> a valid position, or null. */
function parseNear(raw: string | undefined): { lat: number; lng: number } | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
export const DEFAULT_NEAR_RADIUS_KM = 10;
/** Great-circle distance in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function boundsOf(cards: DiscoverCard[]): [[number, number], [number, number]] | null {
  const pins = cards.map((card) => card.location).filter((l): l is DiscoverLocation => !!l);
  if (!pins.length) return null;
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

export async function discover(
  input: TripSearch &
    StaySearch & {
      service: DiscoverService;
      q?: string;
      city?: string;
      category?: string;
      order?: string;
      only?: string;
      view?: 'list' | 'map';
      bbox?: string;
      /** "lat,lng": keep only listings within `radius` km, nearest first. */
      near?: string;
      radius?: number;
      limit: number;
    },
  now: Date = new Date()
): Promise<DiscoverResult> {
  const query = (input.q ?? '').trim();
  const city = (input.city ?? '').trim();
  const { order, only } = sanitizeRefine(
    input.service,
    input.order,
    (input.only ?? '').split(',').map((part) => part.trim())
  );

  const candidates =
    input.service === 'transport'
      ? await transportCards(query, city, now, input)
      : input.service === 'hotels'
        ? await hotelCards(query, city, input)
        : input.service === 'guides'
          ? await guideCards(query, city)
          : input.service === 'tours'
            ? await tourCards(query, city)
            : await restaurantCards(query, city);

  // Unknown categories are ignored, like unsupported order/only values.
  const category = isKnownCategory(input.service, input.category) ? (input.category as string) : null;
  let refined = applyRefine(
    candidates.filter((card) => matchesCategory(card, category)),
    order,
    only
  );
  const isMap = input.view === 'map';
  if (isMap) refined = refined.filter((card) => !!card.location);
  const box = parseBbox(input.bbox);
  if (box) {
    refined = refined.filter(
      (card) =>
        !!card.location &&
        card.location.lng >= box[0] &&
        card.location.lat >= box[1] &&
        card.location.lng <= box[2] &&
        card.location.lat <= box[3]
    );
  }
  const origin = parseNear(input.near);
  const radiusKm = origin ? Math.min(50, Math.max(1, input.radius ?? DEFAULT_NEAR_RADIUS_KM)) : 0;
  if (origin) {
    // Distance is measured to the pin: a ride's pickup point, a stay's address.
    refined = refined
      .filter((card) => !!card.location)
      .map((card) => ({ ...card, distanceKm: Math.round(distanceKm(origin, card.location!) * 10) / 10 }))
      .filter((card) => card.distanceKm <= radiusKm);
    // "Recommended" near me means nearest first; an explicit sort still wins.
    if (order === 'recommended') refined.sort((a, b) => a.distanceKm! - b.distanceKm!);
  }
  const items = refined.slice(0, input.limit);
  return {
    service: input.service,
    total: refined.length,
    items,
    bounds: isMap ? boundsOf(items) : null,
    // Categories come from the unfiltered candidates so every chip stays visible.
    options: { ...discoverOptions(input.service), categories: categoryOptions(input.service, candidates) },
    applied: { order, only, category },
    near: origin ? { ...origin, radiusKm } : null,
  };
}
