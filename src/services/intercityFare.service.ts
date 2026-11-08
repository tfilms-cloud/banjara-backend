import { IntercitySettings, DEFAULT_INTERCITY_SETTINGS, type IIntercitySettings } from '../models/IntercitySettings';
import { RouteFare, type IRouteFare, type IntercityClass } from '../models/RouteFare';

/**
 * City to City fare strategy. It only works out the ride subtotal (what the driver
 * earns before BANJARA's tax and service fee); booking.service's calcPricing adds those
 * exactly as for every other booking, so the existing pricing is untouched.
 */

export type FareSettings = Pick<
  IIntercitySettings,
  | 'baseFare'
  | 'ratePerKm'
  | 'ratePerMinute'
  | 'minimumFare'
  | 'roadFactor'
  | 'fallbackSpeedKmh'
  | 'classMultipliers'
  | 'sharedSeatFraction'
  | 'waitingPerHour'
  | 'overnightCharge'
  | 'bidOnFallback'
>;

/** Route facts used by the formula (the row's stored price, if any, is ignored). */
export type FareRoute = Pick<IRouteFare, 'distanceKm' | 'durationMinutes' | 'tolls' | 'difficultSurcharge' | 'bidEnabled'>;

export type ReturnWait = { mode: 'hourly'; hours: number } | { mode: 'overnight'; nights: number };

export interface FareInput {
  vehicleClass: IntercityClass;
  rideType: 'full_car' | 'shared_seat';
  /** Shared rides: seats booked. Ignored for a full car. */
  seats?: number;
  /** Door-to-door straight-line km; used when the route has no fixed fare. */
  straightLineKm: number;
  route?: FareRoute | null;
  /** Round trip: how the driver waits before the return leg. */
  returnWait?: ReturnWait | null;
}

export interface FareLine {
  code:
    | 'base'
    | 'distance'
    | 'time'
    | 'minimum'
    | 'tolls'
    | 'difficult_route'
    | 'return_leg'
    | 'waiting'
    | 'overnight'
    | 'shared_seats';
  label: string;
  amount: number;
}

export interface FareQuote {
  /** Where km and time came from: a known route, or an estimate from straight-line distance. */
  source: 'route' | 'formula';
  distanceKm: number;
  durationMinutes: number;
  lines: FareLine[];
  /** Outbound leg (incl. its extras). */
  outbound: number;
  /** Return leg + waiting/overnight; 0 for one-way. */
  returnLeg: number;
  subtotal: number;
  /** Riders may offer their own price. */
  bidAllowed: boolean;
}

/** Fares are quoted in whole tens of rupees. */
const roundFare = (value: number) => Math.round(value / 10) * 10;

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** "960" -> "16 h", "150" -> "2 h 30 min". */
function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/**
 * Pure: the fare for one request.
 *
 *   F = max(minimumFare, baseFare + km × ratePerKm + minutes × ratePerMinute) × class + tolls + surcharge
 *
 * Road km and drive time come from the route when known, otherwise from the straight-line
 * distance (× roadFactor) at fallbackSpeedKmh. Each line is rounded to Rs 10 and the fare
 * is their sum, so the breakdown always adds up to the total.
 */
export function computeFare(input: FareInput, settings: FareSettings): FareQuote {
  const multiplier = settings.classMultipliers[input.vehicleClass] ?? 1;
  const route = input.route ?? null;
  const distanceKm = route?.distanceKm || Math.round(input.straightLineKm * settings.roadFactor);
  const durationMinutes =
    route?.durationMinutes || Math.round((distanceKm / Math.max(5, settings.fallbackSpeedKmh)) * 60);

  const base = roundFare(settings.baseFare * multiplier);
  const distance = roundFare(distanceKm * settings.ratePerKm * multiplier);
  const time = roundFare(durationMinutes * settings.ratePerMinute * multiplier);
  const lines: FareLine[] = [
    { code: 'base', label: 'Base fare', amount: base },
    { code: 'distance', label: `${distanceKm} km`, amount: distance },
    { code: 'time', label: `About ${durationLabel(durationMinutes)} driving`, amount: time },
  ];
  // Short trips still cost the driver most of a day: never go below the minimum fare.
  const minimum = roundFare(settings.minimumFare * multiplier);
  const formula = base + distance + time;
  if (formula < minimum) lines.push({ code: 'minimum', label: 'Minimum fare top-up', amount: minimum - formula });
  if (route && route.tolls > 0) lines.push({ code: 'tolls', label: 'Tolls', amount: roundFare(route.tolls) });
  if (route && route.difficultSurcharge > 0) {
    lines.push({ code: 'difficult_route', label: 'Rough road surcharge', amount: roundFare(route.difficultSurcharge) });
  }
  const leg = lines.reduce((sum, line) => sum + line.amount, 0);

  let returnLeg = 0;
  if (input.returnWait) {
    lines.push({ code: 'return_leg', label: 'Return journey', amount: leg });
    returnLeg += leg;
    if (input.returnWait.mode === 'hourly') {
      const hours = Math.max(0, Math.ceil(input.returnWait.hours));
      if (hours > 0) {
        const waiting = roundFare(settings.waitingPerHour * hours);
        lines.push({ code: 'waiting', label: `Driver waits ${hours} h`, amount: waiting });
        returnLeg += waiting;
      }
    } else {
      const nights = Math.max(1, Math.ceil(input.returnWait.nights));
      const overnight = roundFare(settings.overnightCharge * nights);
      lines.push({ code: 'overnight', label: `Driver stays ${nights} night${nights === 1 ? '' : 's'}`, amount: overnight });
      returnLeg += overnight;
    }
  }

  let outbound = leg;
  if (input.rideType === 'shared_seat') {
    // A shared seat is a fraction of the full-car fare, per seat. (Round trips are
    // full-car only, so there is never a return leg here.)
    const seats = Math.max(1, Math.floor(input.seats ?? 1));
    const perSeat = roundFare(leg * settings.sharedSeatFraction);
    lines.splice(0, lines.length, { code: 'shared_seats', label: `${seats} × shared seat`, amount: perSeat * seats });
    outbound = perSeat * seats;
    returnLeg = 0;
  }

  return {
    source: route ? 'route' : 'formula',
    distanceKm,
    durationMinutes,
    lines,
    outbound,
    returnLeg,
    subtotal: outbound + returnLeg,
    bidAllowed: input.route ? input.route.bidEnabled : settings.bidOnFallback,
  };
}

/** Per-seat price of a shared seat (what a shared intercity trip charges per seat). */
export function sharedSeatPrice(quote: FareQuote, seats: number) {
  return Math.round(quote.outbound / Math.max(1, seats));
}

/** Rider cancelling inside the free-cancellation window before departure? Pure. */
export function isLateCancellation(departAt: Date | undefined, freeCancelMinutes: number, now = Date.now()) {
  if (!departAt) return false;
  return new Date(departAt).getTime() - now < freeCancelMinutes * 60_000;
}

/** The settings document, created with defaults the first time. */
export async function getIntercitySettings(): Promise<IIntercitySettings> {
  const found = await IntercitySettings.findOne({ key: 'default' }).lean<IIntercitySettings>();
  // A document saved before a setting existed lacks that field (lean skips defaults).
  if (found) return { ...DEFAULT_INTERCITY_SETTINGS, ...found } as IIntercitySettings;
  try {
    return (await IntercitySettings.create({ key: 'default' })).toObject();
  } catch {
    // Another request created it at the same moment.
    const again = await IntercitySettings.findOne({ key: 'default' }).lean<IIntercitySettings>();
    return again ?? ({ ...DEFAULT_INTERCITY_SETTINGS, key: 'default' } as IIntercitySettings);
  }
}

/** The fixed fare for A → B in this class (or B → A when it applies both ways). */
export async function findRouteFare(fromCityId: string, toCityId: string, vehicleClass: IntercityClass) {
  const direct = await RouteFare.findOne({ fromCityId, toCityId, vehicleClass, active: true }).lean<IRouteFare>();
  if (direct) return direct;
  return RouteFare.findOne({
    fromCityId: toCityId,
    toCityId: fromCityId,
    vehicleClass,
    active: true,
    bothWays: true,
  }).lean<IRouteFare>();
}
