import { Types } from 'mongoose';
import { env } from '../config/env';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import { RideRequest, type IRideRequest } from '../models/RideRequest';
import { PickupPoint } from '../models/PickupPoint';
import { Trip, type ISeat } from '../models/Trip';
import { Vehicle } from '../models/Vehicle';
import { INTERCITY_CLASSES, type IntercityClass } from '../models/RouteFare';
import { getIO } from '../sockets/socket';
import { AppError, assertFound } from '../utils/AppError';
import { log } from '../utils/logger';
import * as bookingService from './booking.service';
import { fareOnlyPricing } from './booking.service';
import { assertCanTakeRides, getDriverBalance } from './driverBalance.service';
import { getCity, listActiveCities, publicCity, resolveCity } from './city.service';
import { computeFare, findRouteFare, getIntercitySettings, haversineKm, type ReturnWait } from './intercityFare.service';
import { findEligibleDrivers, intercityClassOf } from './intercityMatching.service';
import * as notificationService from './notification.service';

/* ------------------------------------------------------------------ */
/* Feature switch                                                      */
/* ------------------------------------------------------------------ */

/** Env INTERCITY_ENABLED is the hard kill switch; settings.enabled the runtime one. */
export async function isIntercityEnabled() {
  if (!env.INTERCITY_ENABLED) return false;
  return (await getIntercitySettings()).enabled;
}

export async function assertIntercityEnabled() {
  if (!(await isIntercityEnabled())) throw new AppError('Not found', 404);
  return getIntercitySettings();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface PlaceInput {
  address: string;
  lat: number;
  lng: number;
}

export interface QuoteInput {
  pickup: PlaceInput;
  dropoff: PlaceInput;
  vehicleClass: IntercityClass;
  rideType: 'full_car' | 'shared_seat';
  passengers: number;
  journeyType: 'one_way' | 'round_trip';
  returnTrip?: { departAt: string; waitMode: 'hourly' | 'overnight'; waitHours?: number; nights?: number };
}

/** Search radius steps (km), smallest first. */
export function radiusSteps(settings: { radiusStepsKm?: number[]; matchRadiusKm: number }) {
  const steps = [...new Set((settings.radiusStepsKm ?? []).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  return steps.length ? steps : [settings.matchRadiusKm];
}

/** Trip dates/times are Pakistan local strings, like every other trip. */
function pakistanParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function buildSeatLayout(seatCount: number): ISeat[] {
  return Array.from({ length: seatCount }, (_, i) => {
    const row = Math.floor(i / 4) + 1;
    const column = (i % 4) + 1;
    return { seatNumber: `${String.fromCharCode(64 + row)}${column}`, row, column, type: 'standard', status: 'available' };
  });
}

function returnWaitOf(input: QuoteInput['returnTrip'], journeyType: string): ReturnWait | null {
  if (journeyType !== 'round_trip' || !input) return null;
  return input.waitMode === 'overnight'
    ? { mode: 'overnight', nights: Math.max(1, Number(input.nights ?? 1)) }
    : { mode: 'hourly', hours: Math.max(0, Number(input.waitHours ?? 0)) };
}

/** Cities, distance and the fare for a request. */
async function priceRequest(input: QuoteInput) {
  const settings = await getIntercitySettings();
  const [from, to] = await Promise.all([resolveCity(input.pickup), resolveCity(input.dropoff)]);
  if (!from) throw new AppError('Pickup is outside the cities we serve for City to City rides.', 422);
  if (!to) throw new AppError('Drop-off is outside the cities we serve for City to City rides.', 422);
  if (String(from._id) === String(to._id)) {
    throw new AppError(`Pickup and drop-off are both in ${from.name}. City to City rides go between two cities.`, 422);
  }
  if (input.rideType === 'shared_seat' && input.journeyType === 'round_trip') {
    throw new AppError('Round trips are for a full car. Book each way as a shared seat instead.', 422);
  }
  const maxSeats = settings.classSeats[input.vehicleClass] ?? 4;
  if (input.passengers > maxSeats) {
    throw new AppError(`A ${input.vehicleClass} takes up to ${maxSeats} passengers.`, 422);
  }
  const route = await findRouteFare(String(from._id), String(to._id), input.vehicleClass);
  const quote = computeFare(
    {
      vehicleClass: input.vehicleClass,
      rideType: input.rideType,
      seats: input.passengers,
      straightLineKm: haversineKm(input.pickup, input.dropoff),
      route,
      returnWait: returnWaitOf(input.returnTrip, input.journeyType),
    },
    settings
  );
  return { settings, from, to, quote, durationMinutes: quote.durationMinutes };
}

/* ------------------------------------------------------------------ */
/* Public: config, cities, quote                                       */
/* ------------------------------------------------------------------ */

export async function getPublicConfig() {
  const enabled = await isIntercityEnabled();
  if (!enabled) return { enabled: false };
  const s = await getIntercitySettings();
  return {
    enabled: true,
    classes: INTERCITY_CLASSES.map((key) => ({ key, seats: s.classSeats[key] })),
    minLeadMinutes: s.minLeadMinutes,
    freeCancelMinutes: s.freeCancelMinutes,
    noShowWaitMinutes: s.noShowWaitMinutes,
    minOfferPercent: s.minOfferPercent,
    waitingPerHour: s.waitingPerHour,
    overnightCharge: s.overnightCharge,
  };
}

export async function listCities() {
  await assertIntercityEnabled();
  return (await listActiveCities()).map(publicCity);
}

export async function quote(input: QuoteInput) {
  await assertIntercityEnabled();
  const { from, to, quote: fare } = await priceRequest(input);
  const pricing = fareOnlyPricing(fare.subtotal);
  return {
    fromCity: publicCity(from),
    toCity: publicCity(to),
    // Includes durationMinutes: the route's drive time, or an estimate from distance.
    ...fare,
    tax: pricing.tax,
    serviceFee: pricing.serviceFee,
    total: pricing.totalAmount,
  };
}

/* ------------------------------------------------------------------ */
/* Rider: requests                                                     */
/* ------------------------------------------------------------------ */

export interface CreateRequestInput extends QuoteInput {
  bookNow: boolean;
  departAt?: string;
  luggage?: { bags?: number; large?: number };
  passengerName: string;
  passengerPhone: string;
  notes?: string;
  /** Rider's own price (bid mode). */
  offerAmount?: number;
}

export async function createRequest(customerId: string, input: CreateRequestInput) {
  const settings = await assertIntercityEnabled();
  const now = Date.now();
  let departAt: Date;
  if (input.bookNow) {
    departAt = new Date(now);
  } else {
    departAt = new Date(String(input.departAt ?? ''));
    if (Number.isNaN(departAt.getTime())) throw new AppError('Choose a departure time.', 422);
    if (departAt.getTime() < now + settings.minLeadMinutes * 60_000) {
      throw new AppError(`Schedule at least ${settings.minLeadMinutes} minutes ahead, or choose "Leave now".`, 422);
    }
  }
  let returnTrip: IRideRequest['returnTrip'];
  if (input.journeyType === 'round_trip') {
    const back = new Date(String(input.returnTrip?.departAt ?? ''));
    if (!input.returnTrip || Number.isNaN(back.getTime()) || back <= departAt) {
      throw new AppError('Choose a return time after the departure.', 422);
    }
    returnTrip = {
      departAt: back,
      waitMode: input.returnTrip.waitMode,
      waitHours: input.returnTrip.waitMode === 'hourly' ? Number(input.returnTrip.waitHours ?? 0) : undefined,
      nights: input.returnTrip.waitMode === 'overnight' ? Number(input.returnTrip.nights ?? 1) : undefined,
    };
  }

  const { from, to, quote: fare } = await priceRequest(input);
  let fareMode: 'fixed' | 'bid' = 'fixed';
  if (input.offerAmount !== undefined) {
    if (!fare.bidAllowed) throw new AppError('Offering your own price is not available on this route.', 422);
    const floor = Math.ceil((fare.subtotal * settings.minOfferPercent) / 100);
    if (input.offerAmount < floor) throw new AppError(`Offer at least Rs ${floor.toLocaleString('en-PK')}.`, 422);
    fareMode = 'bid';
  }

  const expiresAt = input.bookNow ? new Date(now + settings.requestTtlMinutes * 60_000) : departAt;
  // Start with the smallest radius that has a driver (10 → 20 → 30 → 50 km).
  const pickup = { ...input.pickup, cityId: from._id, cityName: from.name };
  const steps = radiusSteps(settings);
  let searchRadiusKm = steps[steps.length - 1];
  for (const step of steps) {
    const probe = {
      pickup,
      vehicleClass: input.vehicleClass,
      passengers: input.passengers,
      rideType: input.rideType,
      departAt,
      declinedBy: [],
      excludedProviderIds: [],
      searchRadiusKm: step,
    };
    if ((await findEligibleDrivers(probe, settings)).length) {
      searchRadiusKm = step;
      break;
    }
  }
  const request = await RideRequest.create({
    searchRadiusKm,
    customerId,
    status: 'open',
    rideType: input.rideType,
    journeyType: input.journeyType,
    pickup,
    dropoff: { ...input.dropoff, cityId: to._id, cityName: to.name },
    departAt,
    bookNow: input.bookNow,
    returnTrip,
    vehicleClass: input.vehicleClass,
    passengers: input.passengers,
    luggage: { bags: Number(input.luggage?.bags ?? 0), large: Number(input.luggage?.large ?? 0) },
    passengerName: input.passengerName.trim(),
    passengerPhone: input.passengerPhone.trim(),
    notes: input.notes?.trim() || undefined,
    quote: fare,
    fareMode,
    riderOffer: fareMode === 'bid' ? input.offerAmount : undefined,
    expiresAt,
  });
  await notifyDrivers(request);
  return serializeForRider(request);
}

/** Tell every eligible driver not told yet. */
async function notifyDrivers(request: InstanceType<typeof RideRequest>) {
  const settings = await getIntercitySettings();
  const drivers = await findEligibleDrivers(request, settings);
  const told = new Set(request.notifiedProviderIds.map(String));
  const fresh = drivers.filter((d) => !told.has(d.providerId));
  if (!fresh.length) return;
  request.notifiedProviderIds.push(...fresh.map((d) => new Types.ObjectId(d.providerId)));
  await RideRequest.updateOne({ _id: request._id }, { $addToSet: { notifiedProviderIds: { $each: fresh.map((d) => d.providerId) } } });
  const when = request.bookNow ? 'now' : pakistanParts(request.departAt).date + ' ' + pakistanParts(request.departAt).time;
  await Promise.all(
    fresh.map((d) =>
      notificationService
        .createNotification({
          userId: d.userId,
          type: 'intercityRequest',
          title: `City to City: ${request.pickup.cityName} → ${request.dropoff.cityName}`,
          message: `${request.passengers} passenger${request.passengers === 1 ? '' : 's'}, ${when}. Rs ${(request.riderOffer ?? request.quote.subtotal).toLocaleString('en-PK')}.`,
          data: { rideRequestId: request._id.toString() },
        })
        .catch((err) => log().error({ err, requestId: request._id.toString() }, '[intercity] driver notification failed'))
    )
  );
}

function publicOffer(offer: IRideRequest['offers'][number], provider?: Record<string, unknown>, vehicle?: Record<string, unknown>) {
  return {
    id: offer._id.toString(),
    amount: offer.amount,
    kind: offer.kind,
    status: offer.status,
    createdAt: offer.createdAt,
    driver: provider
      ? {
          providerId: String(provider._id),
          name: String(provider.businessName || provider.ownerName || 'Driver'),
          rating: Number(provider.rating ?? 0),
          totalReviews: Number(provider.totalReviews ?? 0),
        }
      : null,
    vehicle: vehicle ? { name: vehicle.name, type: vehicle.type, seats: vehicle.seatCount } : null,
  };
}

async function serializeForRider(request: InstanceType<typeof RideRequest> | IRideRequest) {
  const doc = 'toObject' in request ? (request as InstanceType<typeof RideRequest>).toObject() : request;
  const providerIds = doc.offers.map((o) => o.providerId);
  const vehicleIds = doc.offers.map((o) => o.vehicleId);
  const [providers, vehicles] = await Promise.all([
    ProviderProfile.find({ _id: { $in: providerIds } }).select('businessName ownerName rating totalReviews').lean(),
    Vehicle.find({ _id: { $in: vehicleIds } }).select('name type seatCount').lean(),
  ]);
  // Once a driver is chosen, the agreed price is what the rider pays.
  const chosen = doc.offers.find((o) => doc.chosenOfferId && String(o._id) === String(doc.chosenOfferId));
  const pricing = fareOnlyPricing(chosen?.amount ?? doc.riderOffer ?? doc.quote.subtotal);
  const steps = radiusSteps(await getIntercitySettings());
  return {
    id: doc._id.toString(),
    status: doc.status,
    rideType: doc.rideType,
    journeyType: doc.journeyType,
    pickup: { address: doc.pickup.address, lat: doc.pickup.lat, lng: doc.pickup.lng, city: doc.pickup.cityName },
    dropoff: { address: doc.dropoff.address, lat: doc.dropoff.lat, lng: doc.dropoff.lng, city: doc.dropoff.cityName },
    departAt: doc.departAt,
    bookNow: doc.bookNow,
    returnTrip: doc.returnTrip ?? null,
    vehicleClass: doc.vehicleClass,
    passengers: doc.passengers,
    luggage: doc.luggage,
    quote: doc.quote,
    fareMode: doc.fareMode,
    riderOffer: doc.riderOffer ?? null,
    estimate: { subtotal: pricing.subtotal, tax: pricing.tax, serviceFee: pricing.serviceFee, total: pricing.totalAmount },
    offers: doc.offers
      .filter((o) => o.status === 'pending' || o.status === 'chosen')
      .map((o) =>
        publicOffer(
          o,
          providers.find((p) => String(p._id) === String(o.providerId)) as Record<string, unknown> | undefined,
          vehicles.find((v) => String(v._id) === String(o.vehicleId)) as Record<string, unknown> | undefined
        )
      ),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    returnBookingId: doc.returnBookingId ? String(doc.returnBookingId) : null,
    tripId: doc.tripId ? String(doc.tripId) : null,
    returnTripId: doc.returnTripId ? String(doc.returnTripId) : null,
    searchRadiusKm: doc.searchRadiusKm ?? null,
    nextRadiusKm: nextStep(doc.searchRadiusKm, steps),
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}

function nextStep(current: number | undefined, steps: number[]) {
  return steps.find((s) => s > (current ?? 0)) ?? null;
}

/** "Search wider": move an open request to the next radius step and tell the new drivers. */
export async function widenSearch(customerId: string, id: string) {
  const settings = await assertIntercityEnabled();
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  if (request.status !== 'open') throw new AppError('This request is no longer open.', 409);
  const next = nextStep(request.searchRadiusKm, radiusSteps(settings));
  if (!next) throw new AppError(`Already searching the widest area (${request.searchRadiusKm} km).`, 409);
  request.searchRadiusKm = next;
  await request.save();
  await notifyDrivers(request);
  return serializeForRider(request);
}

/**
 * The rider's map: drivers who take City to City rides and listed rides leaving near a
 * point. Without a radius it widens 10 → 20 → 30 → 50 km until something is found.
 * Driver positions are their registered location rounded to ~1 km (often a home).
 */
export async function nearbyRides(input: { lat: number; lng: number; vehicleClass?: IntercityClass; radiusKm?: number }) {
  const settings = await assertIntercityEnabled();
  const steps = radiusSteps(settings);
  const max = steps[steps.length - 1];
  const tryRadii = input.radiusKm ? [Math.min(Math.max(1, input.radiusKm), max)] : steps;
  const point = { lat: input.lat, lng: input.lng };
  let found: { drivers: Awaited<ReturnType<typeof nearbyDrivers>>; rides: Awaited<ReturnType<typeof nearbyListedRides>> } = { drivers: [], rides: [] };
  let radiusKm = tryRadii[tryRadii.length - 1];
  for (const r of tryRadii) {
    const [drivers, rides] = await Promise.all([nearbyDrivers(point, r, input.vehicleClass), nearbyListedRides(point, r)]);
    if (drivers.length || rides.length || r === tryRadii[tryRadii.length - 1]) {
      found = { drivers, rides };
      radiusKm = r;
      break;
    }
  }
  return {
    radiusKm,
    steps,
    widened: !input.radiusKm && radiusKm !== steps[0],
    nextRadiusKm: nextStep(radiusKm, steps),
    ...found,
  };
}

const EARTH_KM = 6378.1;
const round1km = (n: number) => Math.round(n * 100) / 100;

async function nearbyDrivers(point: { lat: number; lng: number }, radiusKm: number, vehicleClass?: IntercityClass) {
  const providers = await ProviderProfile.find({
    services: 'transport',
    verificationStatus: 'approved',
    'intercity.enabled': true,
    location: { $geoWithin: { $centerSphere: [[point.lng, point.lat], radiusKm / EARTH_KM] } },
  })
    .select('businessName ownerName rating totalReviews location')
    .limit(100)
    .lean();
  if (!providers.length) return [];
  const vehicles = await Vehicle.find({ providerId: { $in: providers.map((p) => p._id) }, status: 'active' })
    .select('providerId type seatCount')
    .lean();
  const out = [];
  for (const p of providers) {
    const coords = p.location?.coordinates;
    if (!coords || coords.length !== 2 || (coords[0] === 0 && coords[1] === 0)) continue;
    const own = vehicles
      .filter((v) => String(v.providerId) === String(p._id))
      .map((v) => ({ class: intercityClassOf(v.type), seats: v.seatCount }))
      .filter((v): v is { class: IntercityClass; seats: number } => Boolean(v.class));
    const usable = vehicleClass ? own.filter((v) => v.class === vehicleClass) : own;
    if (!usable.length) continue;
    out.push({
      providerId: String(p._id),
      name: String(p.businessName || p.ownerName || 'Driver'),
      rating: Number(p.rating ?? 0),
      totalReviews: Number(p.totalReviews ?? 0),
      vehicles: usable,
      approxLat: round1km(coords[1]),
      approxLng: round1km(coords[0]),
      distanceKm: Math.round(haversineKm(point, { lat: coords[1], lng: coords[0] }) * 10) / 10,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 50);
}

/** Published rides (and open shared City to City seats) leaving within the radius, from today. */
async function nearbyListedRides(point: { lat: number; lng: number }, radiusKm: number) {
  const today = pakistanParts(new Date()).date;
  const points = await PickupPoint.find({
    active: { $ne: false },
    location: { $geoWithin: { $centerSphere: [[point.lng, point.lat], radiusKm / EARTH_KM] } },
  })
    .select('_id latitude longitude name')
    .limit(500)
    .lean();
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((point.lat * Math.PI) / 180));
  const trips = await Trip.find({
    status: 'scheduled',
    availableSeats: { $gt: 0 },
    departureDate: { $gte: today },
    $nor: [{ rideType: 'intercity', bookingMode: 'vehicle' }],
    $or: [
      { pickupPoints: { $in: points.map((p) => p._id) } },
      { originLat: { $gte: point.lat - dLat, $lte: point.lat + dLat }, originLng: { $gte: point.lng - dLng, $lte: point.lng + dLng } },
    ],
  })
    .sort({ departureDate: 1, departureTime: 1 })
    .limit(100)
    .lean();
  const out = [];
  for (const t of trips) {
    // Nearest boarding spot within the radius: a pickup point, else the trip's origin.
    const candidates = [
      ...points.filter((p) => t.pickupPoints.some((id) => String(id) === String(p._id))).map((p) => ({ lat: p.latitude, lng: p.longitude, name: p.name })),
      ...(Number.isFinite(t.originLat) && Number.isFinite(t.originLng) ? [{ lat: t.originLat as number, lng: t.originLng as number, name: t.origin }] : []),
    ]
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => ({ ...c, km: haversineKm(point, c) }))
      .filter((c) => c.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
    if (!candidates.length) continue;
    out.push({
      tripId: String(t._id),
      route: `${t.origin} → ${t.destination}`,
      departureDate: t.departureDate,
      departureTime: t.departureTime,
      price: t.price,
      bookingMode: t.bookingMode,
      seatsLeft: t.availableSeats,
      rideType: t.rideType ?? 'scheduled',
      boardAt: candidates[0].name,
      lat: candidates[0].lat,
      lng: candidates[0].lng,
      distanceKm: Math.round(candidates[0].km * 10) / 10,
    });
  }
  return out.slice(0, 50);
}

export async function listMyRequests(customerId: string) {
  await assertIntercityEnabled();
  const requests = await RideRequest.find({ customerId }).sort({ createdAt: -1 }).limit(50).lean<IRideRequest[]>();
  return Promise.all(requests.map((r) => serializeForRider(r)));
}

export async function getMyRequest(customerId: string, id: string) {
  await assertIntercityEnabled();
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  return serializeForRider(request);
}

export async function cancelRequest(customerId: string, id: string) {
  await assertIntercityEnabled();
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  if (request.status === 'matched' && request.bookingId) {
    // A booked ride is cancelled through its booking (the cancellation window applies).
    await bookingService.cancelBooking(String(request.bookingId), { id: customerId, role: 'customer' });
    return serializeForRider(assertFound(await RideRequest.findById(id), 'Ride request not found'));
  }
  if (request.status !== 'open') return serializeForRider(request);
  request.status = 'cancelled';
  await request.save();
  return serializeForRider(request);
}

/* ------------------------------------------------------------------ */
/* Rider picks an offer → ordinary intercity Trip + Booking            */
/* ------------------------------------------------------------------ */

async function createIntercityTrip(input: {
  providerId: string;
  vehicleId: string;
  seatCount: number;
  fromName: string;
  toName: string;
  fromCityId: Types.ObjectId;
  toCityId: Types.ObjectId;
  fromPoint: { lat: number; lng: number };
  toPoint: { lat: number; lng: number };
  departAt: Date;
  durationMinutes: number;
  price: number;
  bookingMode: 'seat' | 'vehicle';
  rideRequestId: Types.ObjectId;
  leg: 'outbound' | 'return';
}) {
  const depart = pakistanParts(input.departAt);
  const arrive = input.durationMinutes > 0 ? pakistanParts(new Date(input.departAt.getTime() + input.durationMinutes * 60_000)) : null;
  return Trip.create({
    providerId: input.providerId,
    vehicleId: input.vehicleId,
    // City names only: the rider's door-to-door addresses stay on the (private) booking.
    origin: input.fromName,
    destination: input.toName,
    originLat: input.fromPoint.lat,
    originLng: input.fromPoint.lng,
    destinationLat: input.toPoint.lat,
    destinationLng: input.toPoint.lng,
    departureDate: depart.date,
    departureTime: depart.time,
    arrivalDate: arrive?.date,
    arrivalTime: arrive?.time,
    pickupPoints: [],
    dropoffPoints: [],
    price: input.price,
    totalSeats: input.seatCount,
    availableSeats: input.seatCount,
    bookedSeats: 0,
    seatLayout: buildSeatLayout(input.seatCount),
    journeyType: 'one_way',
    bookingMode: input.bookingMode,
    status: 'scheduled',
    rideType: 'intercity',
    rideRequestId: input.rideRequestId,
    intercity: { fromCityId: input.fromCityId, toCityId: input.toCityId, departAt: input.departAt, leg: input.leg },
  });
}

async function bookIntercityTrip(input: {
  customerId: string;
  trip: InstanceType<typeof Trip>;
  request: InstanceType<typeof RideRequest>;
  seats: number;
  from: IRideRequest['pickup'];
  to: IRideRequest['dropoff'];
  leg: 'outbound' | 'return';
  fareLines: unknown;
}) {
  const { trip, request } = input;
  const seatNumbers =
    trip.bookingMode === 'vehicle'
      ? trip.seatLayout.map((s) => s.seatNumber)
      : trip.seatLayout
          .filter((s) => s.status === 'available')
          .slice(0, input.seats)
          .map((s) => s.seatNumber);
  if (seatNumbers.length < input.seats) throw new AppError('Not enough seats left on that trip.', 409);
  const passengerDetails =
    trip.bookingMode === 'vehicle'
      ? [{ name: request.passengerName, phone: request.passengerPhone }]
      : seatNumbers.map((_, i) => ({
          name: i === 0 ? request.passengerName : `${request.passengerName} (guest ${i})`,
          phone: i === 0 ? request.passengerPhone : undefined,
        }));
  const created = (await bookingService.createBooking(input.customerId, {
    bookingType: 'transport',
    paymentMethod: 'cash',
    transportBooking: { tripId: String(trip._id), seats: seatNumbers, passengerDetails },
  })) as { _id: unknown; subtotal?: number };
  const bookingId = String(created._id);
  // The lines come from the quote; when the agreed price differs (counter-offer, rider's
  // own offer, per-seat rounding) a line makes them add up to what is actually charged.
  const lines = [...(input.fareLines as Array<{ code: string; label: string; amount: number }>)];
  const difference = Number(created.subtotal ?? 0) - lines.reduce((sum, l) => sum + l.amount, 0);
  if (difference !== 0) {
    lines.push({ code: 'agreed_price', label: difference > 0 ? 'Agreed with driver (extra)' : 'Agreed with driver (discount)', amount: difference });
  }
  await Booking.updateOne(
    { _id: bookingId },
    {
      $set: {
        fareBreakdown: { leg: input.leg, lines },
        'transportBooking.intercity': {
          rideRequestId: String(request._id),
          leg: input.leg,
          rideType: request.rideType,
          pickupAddress: input.from.address,
          pickupLat: input.from.lat,
          pickupLng: input.from.lng,
          dropoffAddress: input.to.address,
          dropoffLat: input.to.lat,
          dropoffLng: input.to.lng,
          luggage: request.luggage,
          passengers: request.passengers,
          notes: request.notes,
        },
      },
    }
  );
  return bookingId;
}

export async function chooseOffer(customerId: string, id: string, offerId: string) {
  await assertIntercityEnabled();
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  if (request.status !== 'open') throw new AppError('This request is no longer open.', 409);
  const offer = request.offers.find((o) => o._id.toString() === offerId);
  if (!offer || offer.status !== 'pending') throw new AppError('That offer is no longer available.', 409);

  // The driver must still qualify (vehicle active, not busy, still opted in).
  const settings = await getIntercitySettings();
  const still = await findEligibleDrivers(request, settings, { onlyProviderId: String(offer.providerId) });
  const vehicle = await Vehicle.findById(offer.vehicleId).select('seatCount status providerId type').lean();
  if (!still.length || !vehicle || vehicle.status !== 'active' || String(vehicle.providerId) !== String(offer.providerId)) {
    offer.status = 'withdrawn';
    await request.save();
    throw new AppError('That driver is no longer available. Choose another offer.', 409);
  }

  // Claim the request first so two clicks can't book twice.
  const claimed = await RideRequest.findOneAndUpdate(
    { _id: request._id, status: 'open' },
    { $set: { status: 'matched', chosenOfferId: offer._id } },
    { new: true }
  );
  if (!claimed) throw new AppError('This request is no longer open.', 409);

  // Agreed price split across the legs in proportion to the quote.
  const ratio = request.quote.subtotal > 0 ? offer.amount / request.quote.subtotal : 1;
  const outboundAmount = Math.round(request.quote.outbound * ratio);
  const returnAmount = Math.max(0, offer.amount - outboundAmount);
  const fromCity = await getCity(String(request.pickup.cityId));
  const toCity = await getCity(String(request.dropoff.cityId));
  const route = await findRouteFare(String(request.pickup.cityId), String(request.dropoff.cityId), request.vehicleClass);
  const shared = request.rideType === 'shared_seat';
  const created: { trips: string[]; bookings: string[] } = { trips: [], bookings: [] };

  try {
    const outboundTrip = await createIntercityTrip({
      providerId: String(offer.providerId),
      vehicleId: String(offer.vehicleId),
      seatCount: vehicle.seatCount,
      fromName: request.pickup.cityName,
      toName: request.dropoff.cityName,
      fromCityId: request.pickup.cityId,
      toCityId: request.dropoff.cityId,
      fromPoint: fromCity ? { lat: fromCity.location.coordinates[1], lng: fromCity.location.coordinates[0] } : request.pickup,
      toPoint: toCity ? { lat: toCity.location.coordinates[1], lng: toCity.location.coordinates[0] } : request.dropoff,
      departAt: request.departAt,
      durationMinutes: route?.durationMinutes ?? 0,
      price: shared ? Math.round(outboundAmount / request.passengers) : outboundAmount,
      bookingMode: shared ? 'seat' : 'vehicle',
      rideRequestId: request._id,
      leg: 'outbound',
    });
    created.trips.push(String(outboundTrip._id));
    const bookingId = await bookIntercityTrip({
      customerId,
      trip: outboundTrip,
      request,
      seats: request.passengers,
      from: request.pickup,
      to: request.dropoff,
      leg: 'outbound',
      fareLines: request.quote.lines.filter((l) => !['return_leg', 'waiting', 'overnight'].includes(l.code)),
    });
    created.bookings.push(bookingId);

    let returnTripId: string | undefined;
    let returnBookingId: string | undefined;
    if (request.journeyType === 'round_trip' && request.returnTrip) {
      const returnTrip = await createIntercityTrip({
        providerId: String(offer.providerId),
        vehicleId: String(offer.vehicleId),
        seatCount: vehicle.seatCount,
        fromName: request.dropoff.cityName,
        toName: request.pickup.cityName,
        fromCityId: request.dropoff.cityId,
        toCityId: request.pickup.cityId,
        fromPoint: request.dropoff,
        toPoint: request.pickup,
        departAt: request.returnTrip.departAt,
        durationMinutes: route?.durationMinutes ?? 0,
        price: returnAmount,
        bookingMode: 'vehicle',
        rideRequestId: request._id,
        leg: 'return',
      });
      returnTripId = String(returnTrip._id);
      created.trips.push(returnTripId);
      returnBookingId = await bookIntercityTrip({
        customerId,
        trip: returnTrip,
        request,
        seats: request.passengers,
        from: request.dropoff,
        to: request.pickup,
        leg: 'return',
        fareLines: request.quote.lines.filter((l) => ['return_leg', 'waiting', 'overnight'].includes(l.code)),
      });
      created.bookings.push(returnBookingId);
      await Booking.updateOne({ _id: bookingId }, { $set: { returnBookingId } });
      await Booking.updateOne({ _id: returnBookingId }, { $set: { outboundBookingId: bookingId } });
    }

    // The driver already said yes: confirm through the normal provider path.
    for (const id of created.bookings) {
      await bookingService.updateProviderBookingStatus(id, String(offer.providerId), 'confirmed');
    }

    for (const o of claimed.offers) {
      o.status = o._id.toString() === offerId ? 'chosen' : o.status === 'pending' ? 'declined' : o.status;
    }
    claimed.tripId = outboundTrip._id;
    claimed.bookingId = new Types.ObjectId(bookingId);
    if (returnTripId) claimed.returnTripId = new Types.ObjectId(returnTripId);
    if (returnBookingId) claimed.returnBookingId = new Types.ObjectId(returnBookingId);
    await claimed.save();
  } catch (error) {
    // Undo everything so the request can be retried.
    for (const bookingId of created.bookings) {
      await bookingService
        .cancelBooking(bookingId, { id: customerId, role: 'customer' }, { silent: true })
        .catch((err) => log().error({ err, bookingId }, '[intercity] compensation cancel failed'));
    }
    await Trip.deleteMany({ _id: { $in: created.trips } }).catch(() => undefined);
    await RideRequest.updateOne({ _id: request._id }, { $set: { status: 'open' }, $unset: { chosenOfferId: 1 } });
    throw error;
  }

  // Tell the drivers (the chosen one is also told through the booking confirmation).
  const providers = await ProviderProfile.find({ _id: { $in: claimed.offers.map((o) => o.providerId) } }).select('userId').lean();
  for (const o of claimed.offers) {
    const userId = providers.find((p) => String(p._id) === String(o.providerId))?.userId;
    if (!userId) continue;
    const chosen = o._id.toString() === offerId;
    await notificationService
      .createNotification({
        userId: String(userId),
        type: chosen ? 'intercityChosen' : 'intercityTaken',
        title: chosen ? 'Your offer was accepted' : 'Ride taken',
        message: chosen
          ? `${request.pickup.cityName} → ${request.dropoff.cityName} is booked with you.`
          : `The rider chose another driver for ${request.pickup.cityName} → ${request.dropoff.cityName}.`,
        data: chosen ? { bookingId: String(claimed.bookingId), rideRequestId: id } : { rideRequestId: id },
      })
      .catch(() => undefined);
  }
  return serializeForRider(claimed);
}

/* ------------------------------------------------------------------ */
/* Driver side                                                         */
/* ------------------------------------------------------------------ */

export async function getDriverSettings(providerId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId).select('intercity services').lean(), 'Provider not found');
  const ic = (profile as { intercity?: Record<string, unknown> }).intercity ?? {};
  return {
    enabled: Boolean(ic.enabled),
    homeCityId: ic.homeCityId ? String(ic.homeCityId) : null,
    preferredRoutes: ((ic.preferredRoutes as Array<{ fromCityId: unknown; toCityId: unknown }>) ?? []).map((r) => ({
      fromCityId: String(r.fromCityId),
      toCityId: String(r.toCityId),
    })),
    acceptsShared: Boolean(ic.acceptsShared),
    featureEnabled: await isIntercityEnabled(),
  };
}

export async function updateDriverSettings(
  providerId: string,
  input: { enabled: boolean; homeCityId?: string | null; preferredRoutes?: Array<{ fromCityId: string; toCityId: string }>; acceptsShared?: boolean }
) {
  await assertIntercityEnabled();
  const profile = assertFound(await ProviderProfile.findById(providerId).select('services verificationStatus'), 'Provider not found');
  if (!(profile.services ?? []).includes('transport')) throw new AppError('City to City rides are for drivers.', 403);
  const cityIds = [input.homeCityId, ...(input.preferredRoutes ?? []).flatMap((r) => [r.fromCityId, r.toCityId])].filter(Boolean) as string[];
  for (const cityId of cityIds) {
    if (!(await getCity(cityId))) throw new AppError('Choose cities from the list.', 422);
  }
  if (input.enabled && !input.homeCityId) throw new AppError('Choose your home city to receive City to City rides.', 422);
  await ProviderProfile.updateOne(
    { _id: providerId },
    {
      $set: {
        intercity: {
          enabled: input.enabled,
          homeCityId: input.homeCityId || undefined,
          preferredRoutes: (input.preferredRoutes ?? []).filter((r) => r.fromCityId !== r.toCityId),
          acceptsShared: Boolean(input.acceptsShared),
        },
      },
    }
  );
  return getDriverSettings(providerId);
}

function serializeForDriver(request: IRideRequest, providerId: string) {
  const mine = request.offers.find((o) => String(o.providerId) === providerId && o.status !== 'withdrawn');
  return {
    id: request._id.toString(),
    status: request.status,
    rideType: request.rideType,
    journeyType: request.journeyType,
    route: `${request.pickup.cityName} → ${request.dropoff.cityName}`,
    // Exact addresses only once the ride is booked with this driver (they're on the booking).
    pickupArea: request.pickup.cityName,
    dropoffArea: request.dropoff.cityName,
    departAt: request.departAt,
    bookNow: request.bookNow,
    returnTrip: request.returnTrip ?? null,
    vehicleClass: request.vehicleClass,
    passengers: request.passengers,
    luggage: request.luggage,
    distanceKm: request.quote.distanceKm,
    fare: request.riderOffer ?? request.quote.subtotal,
    fareMode: request.fareMode,
    canCounter: request.quote.bidAllowed,
    myOffer: mine ? { id: mine._id.toString(), amount: mine.amount, kind: mine.kind, status: mine.status } : null,
    expiresAt: request.expiresAt,
  };
}

export async function driverFeed(providerId: string) {
  const settings = await assertIntercityEnabled();
  const open = await RideRequest.find({
    status: 'open',
    expiresAt: { $gt: new Date() },
    declinedBy: { $ne: new Types.ObjectId(providerId) },
    excludedProviderIds: { $ne: new Types.ObjectId(providerId) },
  })
    .sort({ departAt: 1 })
    .limit(100)
    .lean<IRideRequest[]>();
  const requests = [];
  for (const request of open) {
    if ((await findEligibleDrivers(request, settings, { onlyProviderId: providerId })).length) {
      requests.push(serializeForDriver(request, providerId));
    }
  }
  const upcoming = await Trip.find({
    providerId,
    rideType: 'intercity',
    status: { $in: ['scheduled', 'boarding', 'departed', 'inTransit'] },
  })
    .sort({ 'intercity.departAt': 1 })
    .limit(50)
    .lean();
  const bookings = await Booking.find({ 'transportBooking.tripId': { $in: upcoming.map((t) => String(t._id)) }, bookingStatus: { $in: ['pending', 'confirmed'] } })
    .select('_id bookingNumber transportBooking.tripId totalAmount bookingStatus')
    .lean();
  return {
    requests,
    upcoming: upcoming.map((t) => ({
      tripId: String(t._id),
      route: `${t.origin} → ${t.destination}`,
      departAt: (t as { intercity?: { departAt?: Date } }).intercity?.departAt ?? null,
      leg: (t as { intercity?: { leg?: string } }).intercity?.leg ?? 'outbound',
      status: t.status,
      bookingMode: t.bookingMode,
      seatsLeft: t.availableSeats,
      bookings: bookings
        .filter((b) => (b.transportBooking as { tripId?: string } | undefined)?.tripId === String(t._id))
        .map((b) => ({ id: String(b._id), number: b.bookingNumber, total: b.totalAmount, status: b.bookingStatus })),
    })),
    // What the driver owes BANJARA; when blocked, `requests` is empty and `message` says why.
    balance: await balanceBanner(providerId),
  };
}

async function balanceBanner(providerId: string) {
  const b = await getDriverBalance(providerId);
  return {
    owed: b.owed,
    pendingPayments: b.pendingPayments,
    blocked: b.blocked,
    message: b.message,
    maxDriverDue: b.maxDriverDue,
    commissionPercent: b.commissionPercent,
  };
}

export async function respondToRequest(
  providerId: string,
  id: string,
  input: { action: 'accept' | 'decline' | 'counter'; amount?: number; vehicleId?: string }
) {
  const settings = await assertIntercityEnabled();
  // Say plainly when unpaid commission is the reason (matching would just hide the request).
  await assertCanTakeRides(providerId);
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (request.status !== 'open' || request.expiresAt.getTime() <= Date.now()) {
    throw new AppError('This request is no longer open.', 409);
  }
  const eligible = await findEligibleDrivers(request, settings, { onlyProviderId: providerId });
  if (!eligible.length) throw new AppError('This request is not available to you.', 403);

  // One live offer per driver: a new answer replaces the old one.
  for (const o of request.offers) {
    if (String(o.providerId) === providerId && o.status === 'pending') o.status = 'withdrawn';
  }
  if (input.action === 'decline') {
    request.declinedBy.push(new Types.ObjectId(providerId));
    await request.save();
    return { declined: true };
  }

  let vehicleId = eligible[0].vehicle._id.toString();
  if (input.vehicleId) {
    const own = await Vehicle.findById(input.vehicleId).select('providerId status type seatCount').lean();
    if (
      !own ||
      String(own.providerId) !== providerId ||
      own.status !== 'active' ||
      intercityClassOf(own.type) !== request.vehicleClass ||
      own.seatCount < request.passengers
    ) {
      throw new AppError('Choose an active vehicle of the requested class.', 422);
    }
    vehicleId = input.vehicleId;
  }
  const listed = request.riderOffer ?? request.quote.subtotal;
  let amount = listed;
  if (input.action === 'counter') {
    if (!request.quote.bidAllowed) throw new AppError('Counter-offers are not available on this route.', 422);
    amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Enter your price.', 422);
    // Keep counters sensible: between the rider's floor and twice the quote.
    const floor = Math.ceil((request.quote.subtotal * settings.minOfferPercent) / 100);
    if (amount < floor || amount > request.quote.subtotal * 2) {
      throw new AppError(`Offer between Rs ${floor.toLocaleString('en-PK')} and Rs ${(request.quote.subtotal * 2).toLocaleString('en-PK')}.`, 422);
    }
  }
  request.offers.push({
    _id: new Types.ObjectId(),
    providerId: new Types.ObjectId(providerId),
    vehicleId: new Types.ObjectId(vehicleId),
    amount,
    kind: input.action === 'counter' ? 'counter' : 'accept',
    status: 'pending',
    createdAt: new Date(),
  });
  await request.save();
  await notificationService
    .createNotification({
      userId: String(request.customerId),
      type: 'intercityOffer',
      title: 'A driver answered your ride request',
      message: `Rs ${amount.toLocaleString('en-PK')} for ${request.pickup.cityName} → ${request.dropoff.cityName}.`,
      data: { rideRequestId: id },
    })
    .catch(() => undefined);
  return serializeForDriver(request.toObject(), providerId);
}

/* ------------------------------------------------------------------ */
/* Trip day: status, no-show, tracking                                 */
/* ------------------------------------------------------------------ */

async function ownIntercityTrip(providerId: string, tripId: string) {
  const trip = assertFound(await Trip.findById(tripId), 'Trip not found');
  if (String(trip.providerId) !== providerId || trip.rideType !== 'intercity') throw new AppError('Trip not found', 404);
  return trip;
}

/** scheduled → departed (picked up) → completed. Completing finishes its bookings. */
export async function setTripStatus(providerId: string, tripId: string, status: 'departed' | 'completed') {
  await assertIntercityEnabled();
  const trip = await ownIntercityTrip(providerId, tripId);
  const allowed: Record<string, string[]> = { departed: ['scheduled', 'boarding'], completed: ['departed', 'inTransit'] };
  if (!allowed[status].includes(trip.status)) throw new AppError(`This trip can't move from ${trip.status} to ${status}.`, 409);
  trip.status = status;
  await trip.save();
  if (status === 'completed') {
    const bookings = await Booking.find({ 'transportBooking.tripId': tripId, bookingStatus: 'confirmed' }).select('_id').lean();
    for (const b of bookings) {
      await bookingService.updateProviderBookingStatus(String(b._id), providerId, 'completed');
    }
  }
  getIO()?.to(`trip:${tripId}`).emit('tripStatusUpdate', { tripId, status, updatedAt: new Date().toISOString() });
  return { tripId, status };
}

/** The rider didn't show: allowed once the no-show wait after pickup time has passed. */
export async function markNoShow(providerId: string, bookingId: string) {
  const settings = await assertIntercityEnabled();
  const booking = assertFound(await Booking.findById(bookingId), 'Booking not found');
  if (String(booking.providerId) !== providerId) throw new AppError('Booking not found', 404);
  const tripId = booking.transportBooking?.tripId;
  const trip = tripId ? await ownIntercityTrip(providerId, tripId) : null;
  if (!trip || booking.bookingStatus !== 'confirmed' || !['scheduled', 'boarding'].includes(trip.status)) {
    throw new AppError('Only a confirmed ride that has not started can be marked as a no-show.', 409);
  }
  const departAt = (trip as { intercity?: { departAt?: Date } }).intercity?.departAt;
  const opensAt = new Date((departAt?.getTime() ?? 0) + settings.noShowWaitMinutes * 60_000);
  if (Date.now() < opensAt.getTime()) {
    throw new AppError(`You can mark a no-show after waiting ${settings.noShowWaitMinutes} minutes past pickup time.`, 409);
  }
  return bookingService.cancelBooking(bookingId, { id: '', role: 'provider', providerId }, { reason: 'no_show' });
}

export interface LocationPoint {
  lat: number;
  lng: number;
  at: string;
  speed?: number;
  heading?: number;
}

/**
 * Buffered locations from the driver's device (sent in a batch after a signal gap).
 * Keeps the newest as the trip's last known position and relays it live.
 */
export async function recordLocations(providerId: string, tripId: string, points: LocationPoint[]) {
  const trip = await ownIntercityTrip(providerId, tripId);
  const valid = points
    .map((p) => ({ ...p, time: new Date(p.at).getTime() }))
    .filter((p) => Number.isFinite(p.time) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && p.time <= Date.now() + 60_000)
    .sort((a, b) => a.time - b.time);
  if (!valid.length) return { accepted: 0, lastLocation: trip.lastLocation ?? null };
  const latest = valid[valid.length - 1];
  const known = trip.lastLocation?.at ? new Date(trip.lastLocation.at).getTime() : 0;
  if (latest.time > known) {
    const lastLocation = {
      lat: latest.lat,
      lng: latest.lng,
      at: new Date(latest.time),
      ...(Number.isFinite(latest.speed) ? { speed: latest.speed } : {}),
      ...(Number.isFinite(latest.heading) ? { heading: latest.heading } : {}),
    };
    await Trip.updateOne({ _id: tripId }, { $set: { lastLocation } });
    getIO()
      ?.to(`trip:${tripId}`)
      .emit('driverLocationUpdate', {
        tripId,
        latitude: lastLocation.lat,
        longitude: lastLocation.lng,
        ...(lastLocation.speed !== undefined ? { speed: lastLocation.speed } : {}),
        ...(lastLocation.heading !== undefined ? { heading: lastLocation.heading } : {}),
        updatedAt: lastLocation.at.toISOString(),
      });
    return { accepted: valid.length, lastLocation };
  }
  return { accepted: valid.length, lastLocation: trip.lastLocation ?? null };
}

/** Last known driver position, for the rider (with a live booking), the driver or an admin. */
export async function getTripLocation(tripId: string, requester: { id: string; role: string; providerId?: string }) {
  const trip = assertFound(await Trip.findById(tripId).select('providerId rideType lastLocation status').lean(), 'Trip not found');
  if (trip.rideType !== 'intercity') throw new AppError('Trip not found', 404);
  const isDriver = requester.role === 'provider' && requester.providerId === String(trip.providerId);
  const isRider =
    requester.role === 'customer' &&
    (await Booking.exists({ 'transportBooking.tripId': tripId, customerId: requester.id, bookingStatus: { $nin: ['cancelled', 'expired'] } }));
  if (!isDriver && !isRider && requester.role !== 'admin') throw new AppError('Trip not found', 404);
  return { tripId, status: trip.status, lastLocation: trip.lastLocation ?? null };
}

/* ------------------------------------------------------------------ */
/* Cancellations, re-matching, expiry                                  */
/* ------------------------------------------------------------------ */

/**
 * Called after an intercity booking is cancelled. Cancels the linked other leg; when the
 * driver cancelled, reopens the request for other drivers (the driver is excluded).
 */
export async function afterIntercityCancel(
  booking: { _id: unknown; transportBooking?: { tripId?: string; intercity?: { rideRequestId?: string } }; outboundBookingId?: unknown; returnBookingId?: unknown },
  requester: { id: string; role: string; providerId?: string },
  reason?: string
) {
  const tripId = booking.transportBooking?.tripId;
  const requestId = booking.transportBooking?.intercity?.rideRequestId;
  if (tripId) {
    const remaining = await Booking.exists({ 'transportBooking.tripId': tripId, bookingStatus: { $in: ['pending', 'confirmed', 'payment_verification'] } });
    if (!remaining) await Trip.updateOne({ _id: tripId, status: { $in: ['scheduled', 'boarding'] } }, { $set: { status: 'cancelled' } });
  }
  // The other leg of a round trip goes with it.
  for (const other of [booking.returnBookingId, booking.outboundBookingId]) {
    if (!other) continue;
    const linked = await Booking.findById(other).select('bookingStatus').lean();
    if (linked && !['cancelled', 'expired', 'completed'].includes(linked.bookingStatus)) {
      await bookingService.cancelBooking(String(other), requester, { silent: true, reason });
    }
  }
  if (!requestId) return;
  const request = await RideRequest.findById(requestId);
  if (!request || request.status !== 'matched') return;

  const byDriver = requester.role === 'provider' && reason !== 'no_show';
  if (byDriver && request.departAt.getTime() > Date.now() && request.rideType === 'full_car') {
    // Re-match: drop this driver and look again.
    const chosen = request.offers.find((o) => String(o._id) === String(request.chosenOfferId));
    if (chosen) {
      chosen.status = 'withdrawn';
      request.excludedProviderIds.push(chosen.providerId);
    }
    request.status = 'open';
    request.chosenOfferId = undefined;
    request.tripId = undefined;
    request.bookingId = undefined;
    request.returnTripId = undefined;
    request.returnBookingId = undefined;
    request.expiresAt = request.bookNow ? new Date(Date.now() + 30 * 60_000) : request.departAt;
    await request.save();
    await notificationService
      .createNotification({
        userId: String(request.customerId),
        type: 'intercityRematch',
        title: 'Your driver cancelled',
        message: `We're finding another driver for ${request.pickup.cityName} → ${request.dropoff.cityName}.`,
        data: { rideRequestId: requestId },
      })
      .catch(() => undefined);
    await notifyDrivers(request);
    return;
  }
  request.status = 'cancelled';
  await request.save();
}

bookingService.registerIntercityCancelHook((booking, requester, reason) =>
  afterIntercityCancel(booking as Parameters<typeof afterIntercityCancel>[0], requester, reason)
);

/** Scheduler: close requests nobody took in time. */
export async function expireOpenRequests(now = new Date()) {
  if (!(await isIntercityEnabled())) return 0;
  const stale = await RideRequest.find({ status: 'open', expiresAt: { $lte: now } }).select('_id customerId pickup dropoff').lean();
  for (const r of stale) {
    const updated = await RideRequest.updateOne({ _id: r._id, status: 'open' }, { $set: { status: 'expired' } });
    if (!updated.modifiedCount) continue;
    await notificationService
      .createNotification({
        userId: String(r.customerId),
        type: 'intercityExpired',
        title: 'No driver took your ride',
        message: `Your request ${r.pickup.cityName} → ${r.dropoff.cityName} expired. Try another time or vehicle.`,
        data: { rideRequestId: String(r._id) },
      })
      .catch(() => undefined);
  }
  return stale.length;
}

/* ------------------------------------------------------------------ */
/* Shared rides: open seats on intercity trips                         */
/* ------------------------------------------------------------------ */

/** Shared intercity trips on this city pair near this time with enough free seats. */
export async function findSharedTrips(input: { fromCityId: string; toCityId: string; departAt: string; passengers: number }) {
  const settings = await assertIntercityEnabled();
  const at = new Date(input.departAt);
  if (Number.isNaN(at.getTime())) throw new AppError('Choose a departure time.', 422);
  const window = settings.sharedWindowMinutes * 60_000;
  const trips = await Trip.find({
    rideType: 'intercity',
    bookingMode: 'seat',
    status: 'scheduled',
    'intercity.fromCityId': input.fromCityId,
    'intercity.toCityId': input.toCityId,
    'intercity.departAt': { $gte: new Date(Math.max(Date.now(), at.getTime() - window)), $lte: new Date(at.getTime() + window) },
    availableSeats: { $gte: Math.max(1, input.passengers) },
  })
    .sort({ 'intercity.departAt': 1 })
    .populate('providerId', 'businessName ownerName rating totalReviews')
    .populate('vehicleId', 'name type seatCount')
    .limit(20)
    .lean();
  return trips.map((t) => {
    const provider = t.providerId as unknown as Record<string, unknown> | null;
    const vehicle = t.vehicleId as unknown as Record<string, unknown> | null;
    return {
      tripId: String(t._id),
      route: `${t.origin} → ${t.destination}`,
      departAt: (t as { intercity?: { departAt?: Date } }).intercity?.departAt ?? null,
      pricePerSeat: t.price,
      seatsLeft: t.availableSeats,
      freeSeats: t.seatLayout.filter((s) => s.status === 'available').map((s) => s.seatNumber),
      driver: provider ? { name: String(provider.businessName || provider.ownerName || 'Driver'), rating: Number(provider.rating ?? 0) } : null,
      vehicle: vehicle ? { name: vehicle.name, type: vehicle.type, seats: vehicle.seatCount } : null,
    };
  });
}

/** Shared trips the rider's request could join (used on the request page). */
export async function sharedTripsForRequest(customerId: string, id: string) {
  const request = assertFound(await RideRequest.findById(id).lean<IRideRequest>(), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  if (request.rideType !== 'shared_seat') return [];
  return findSharedTrips({
    fromCityId: String(request.pickup.cityId),
    toCityId: String(request.dropoff.cityId),
    departAt: request.departAt.toISOString(),
    passengers: request.passengers,
  });
}

/**
 * Join an open shared trip with this request's seats: an ordinary seat booking on that
 * trip (the existing atomic seat reservation stops overfilling), confirmed by its driver.
 */
export async function joinSharedTrip(customerId: string, id: string, tripId: string) {
  await assertIntercityEnabled();
  const request = assertFound(await RideRequest.findById(id), 'Ride request not found');
  if (String(request.customerId) !== customerId) throw new AppError('Ride request not found', 404);
  if (request.status !== 'open' || request.rideType !== 'shared_seat') throw new AppError('This request is no longer open.', 409);
  const trip = assertFound(await Trip.findById(tripId), 'Trip not found');
  const ic = (trip as { intercity?: { fromCityId?: unknown; toCityId?: unknown } }).intercity;
  if (
    trip.rideType !== 'intercity' ||
    trip.bookingMode !== 'seat' ||
    trip.status !== 'scheduled' ||
    String(ic?.fromCityId) !== String(request.pickup.cityId) ||
    String(ic?.toCityId) !== String(request.dropoff.cityId)
  ) {
    throw new AppError('That trip is not available for this request.', 409);
  }
  const free = trip.seatLayout.filter((s) => s.status === 'available').slice(0, request.passengers);
  if (free.length < request.passengers) throw new AppError('Not enough seats left on that trip.', 409);
  const claimed = await RideRequest.findOneAndUpdate({ _id: request._id, status: 'open' }, { $set: { status: 'matched' } }, { new: true });
  if (!claimed) throw new AppError('This request is no longer open.', 409);
  try {
    const bookingId = await bookIntercityTrip({
      customerId,
      trip,
      request,
      seats: request.passengers,
      from: request.pickup,
      to: request.dropoff,
      leg: 'outbound',
      fareLines: [{ code: 'shared_seats', label: `${request.passengers} × shared seat`, amount: trip.price * request.passengers }],
    });
    claimed.tripId = trip._id;
    claimed.bookingId = new Types.ObjectId(bookingId);
    await claimed.save();
    return serializeForRider(claimed);
  } catch (error) {
    await RideRequest.updateOne({ _id: request._id }, { $set: { status: 'open' } });
    throw error;
  }
}
