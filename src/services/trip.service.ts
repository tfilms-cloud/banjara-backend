import { Route } from '../models/Route';
import { PickupPoint } from '../models/PickupPoint';
import { Trip, type ISeat } from '../models/Trip';
import { Vehicle } from '../models/Vehicle';
import { AppError, assertFound } from '../utils/AppError';
import { resolvePlaceCoordinates } from '../utils/geoPlaces';
import { getPagination, paginatedResult } from '../utils/pagination';
import { assertTransportProvider } from './provider.service';
import mongoose from 'mongoose';

function buildSeatLayout(seatCount: number): ISeat[] {
  const seats: ISeat[] = [];
  const cols = 4;
  for (let i = 0; i < seatCount; i++) {
    const row = Math.floor(i / cols) + 1;
    const column = (i % cols) + 1;
    seats.push({
      seatNumber: `${String.fromCharCode(64 + row)}${column}`,
      row,
      column,
      type: 'standard',
      status: 'available',
    });
  }
  return seats;
}

/** Accept existing PickupPoint ids or free-text names from the provider app. */
async function resolvePickupPointIds(providerId: string, values: string[] = []) {
  const ids: mongoose.Types.ObjectId[] = [];

  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (!value) continue;

    if (mongoose.isValidObjectId(value)) {
      const existing = await PickupPoint.findOne({ _id: value, providerId });
      if (!existing) {
        throw new AppError(`Pickup point not found: ${value}`, 422);
      }
      await ensurePickupCoordinates(existing);
      ids.push(existing._id);
      continue;
    }

    const byName = await PickupPoint.findOne({
      providerId,
      name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });

    if (byName) {
      await ensurePickupCoordinates(byName, value);
      ids.push(byName._id);
      continue;
    }

    // Provider typed a place name — geocode (curated + Nominatim) then create.
    const coords = (await resolvePlaceCoordinates(value)) ?? { latitude: 0, longitude: 0 };
    const created = await PickupPoint.create({
      providerId,
      name: value,
      address: value,
      latitude: coords.latitude,
      longitude: coords.longitude,
      active: true,
    });
    ids.push(created._id);
  }

  return ids;
}

async function ensurePickupCoordinates(
  point: InstanceType<typeof PickupPoint>,
  ...extraLabels: string[]
) {
  const badCoords =
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    (point.latitude === 0 && point.longitude === 0);
  if (!badCoords) return point;

  const coords = await resolvePlaceCoordinates(
    ...extraLabels,
    point.name,
    point.address,
    point.landmark
  );
  if (!coords) return point;

  point.latitude = coords.latitude;
  point.longitude = coords.longitude;
  await point.save();
  return point;
}

function placeFromInput(value: unknown): { name: string; latitude: number; longitude: number } {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      name: String(record.name ?? record.city ?? record.label ?? '').trim(),
      latitude: Number(record.latitude ?? 0),
      longitude: Number(record.longitude ?? 0),
    };
  }
  return { name: String(value ?? '').trim(), latitude: 0, longitude: 0 };
}

async function withCoordinates(place: { name: string; latitude: number; longitude: number }) {
  const missing =
    !Number.isFinite(place.latitude) ||
    !Number.isFinite(place.longitude) ||
    (place.latitude === 0 && place.longitude === 0);
  if (!missing || !place.name) return place;
  const coords = await resolvePlaceCoordinates(place.name);
  if (!coords) return place;
  return { ...place, latitude: coords.latitude, longitude: coords.longitude };
}

export async function createRoute(providerId: string, input: Record<string, unknown>) {
  const origin = await withCoordinates(placeFromInput(input.origin));
  const destination = await withCoordinates(placeFromInput(input.destination));
  if (!origin.name || !destination.name) {
    throw new AppError('Origin and destination are required', 422);
  }
  if (origin.name.toLowerCase() === destination.name.toLowerCase()) {
    throw new AppError('Origin and destination must be different', 422);
  }
  return Route.create({
    providerId,
    origin,
    destination,
    stops: Array.isArray(input.stops) ? input.stops.map(String).filter(Boolean) : [],
    distance: Number(input.distance ?? input.distanceKm ?? 0),
    estimatedDuration: Number(input.estimatedDuration ?? input.durationHours ?? 0),
  });
}

export async function listRoutes(providerId?: string) {
  return Route.find(providerId ? { providerId } : {}).sort({ createdAt: -1 });
}

export async function getRoute(id: string) {
  return assertFound(await Route.findById(id), 'Route not found');
}

export async function updateRoute(providerId: string, id: string, patch: Record<string, unknown>) {
  const route = assertFound(await Route.findById(id), 'Route not found');
  if (route.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  Object.assign(route, patch);
  await route.save();
  return route;
}

export async function deleteRoute(providerId: string, id: string) {
  const route = assertFound(await Route.findById(id), 'Route not found');
  if (route.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  await route.deleteOne();
  return { deleted: true };
}

export async function createPickupPoint(providerId: string, input: Record<string, unknown>) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new AppError('Pickup name is required', 422);
  const address = String(input.address ?? name).trim() || name;
  let latitude = Number(input.latitude);
  let longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
    const coords = await resolvePlaceCoordinates(name, address);
    latitude = coords?.latitude ?? 0;
    longitude = coords?.longitude ?? 0;
  }
  return PickupPoint.create({
    providerId,
    name,
    address,
    description: input.description ? String(input.description) : undefined,
    landmark: input.landmark ? String(input.landmark) : undefined,
    latitude,
    longitude,
    active: input.active !== false,
  });
}

export async function listPickupPoints(providerId?: string) {
  return PickupPoint.find(providerId ? { providerId } : { active: true }).sort({ name: 1 });
}

export async function updatePickupPoint(providerId: string, id: string, patch: Record<string, unknown>) {
  const point = assertFound(await PickupPoint.findById(id), 'Pickup point not found');
  if (point.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  Object.assign(point, patch);
  await point.save();
  return point;
}

export async function deletePickupPoint(providerId: string, id: string) {
  const point = assertFound(await PickupPoint.findById(id), 'Pickup point not found');
  if (point.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  await point.deleteOne();
  return { deleted: true };
}

export async function createTrip(
  providerId: string,
  input: {
    vehicleId: string;
    routeId?: string;
    origin: string;
    destination: string;
    departureDate: string;
    departureTime: string;
    arrivalDate?: string;
    arrivalTime?: string;
    pickupPoints?: string[];
    dropoffPoints?: string[];
    price: number;
    amenities?: string[];
    description?: string;
    journeyType?: 'one_way' | 'round_trip';
    returnDate?: string;
    returnTime?: string;
  }
) {
  await assertTransportProvider(providerId);
  const vehicle = assertFound(await Vehicle.findById(input.vehicleId), 'Vehicle not found');
  if (vehicle.providerId.toString() !== providerId) throw new AppError('Invalid vehicle', 403);
  if (vehicle.status !== 'active') {
    throw new AppError('Only approved active vehicles can be used for new trips', 422);
  }

  const journeyType = input.journeyType === 'round_trip' ? 'round_trip' : 'one_way';
  if (journeyType === 'round_trip' && (!input.returnDate || !input.returnTime)) {
    throw new AppError('Round trip needs a return date and return time', 422);
  }

  const pickupPointIds = await resolvePickupPointIds(providerId, input.pickupPoints);
  const dropoffPointIds = await resolvePickupPointIds(providerId, input.dropoffPoints);

  const seatLayout = buildSeatLayout(vehicle.seatCount);
  return Trip.create({
    providerId,
    vehicleId: vehicle._id,
    routeId: input.routeId,
    origin: input.origin,
    destination: input.destination,
    departureDate: input.departureDate,
    departureTime: input.departureTime,
    arrivalDate: input.arrivalDate,
    arrivalTime: input.arrivalTime,
    pickupPoints: pickupPointIds,
    dropoffPoints: dropoffPointIds,
    price: input.price,
    totalSeats: vehicle.seatCount,
    availableSeats: vehicle.seatCount,
    bookedSeats: 0,
    seatLayout,
    amenities: input.amenities ?? vehicle.amenities,
    description: input.description,
    journeyType,
    returnDate: journeyType === 'round_trip' ? input.returnDate : undefined,
    returnTime: journeyType === 'round_trip' ? input.returnTime : undefined,
    status: 'scheduled',
  });
}

export async function searchTrips(query: Record<string, unknown>) {
  const { page, limit, skip } = getPagination(query);
  const filter: Record<string, unknown> = { status: { $nin: ['cancelled'] } };

  if (query.origin) filter.origin = new RegExp(String(query.origin), 'i');
  if (query.destination) filter.destination = new RegExp(String(query.destination), 'i');
  if (query.date) filter.departureDate = query.date;
  if (query.journeyType === 'one_way' || query.journeyType === 'round_trip') {
    filter.journeyType = query.journeyType;
  }
  if (query.providerId) {
    filter.providerId = String(query.providerId);
  }
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) (filter.price as Record<string, number>).$gte = Number(query.minPrice);
    if (query.maxPrice) (filter.price as Record<string, number>).$lte = Number(query.maxPrice);
  }

  let sort: Record<string, 1 | -1> = { departureTime: 1 };
  if (query.sort === 'priceLowToHigh') sort = { price: 1 };
  if (query.sort === 'priceHighToLow') sort = { price: -1 };
  if (query.sort === 'departureTime') sort = { departureTime: 1 };

  const [items, total] = await Promise.all([
    Trip.find(filter)
      .populate(
        'providerId',
        'businessName logo rating totalReviews verificationStatus phone email description'
      )
      .populate('vehicleId')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    Trip.countDocuments(filter),
  ]);

  return paginatedResult(items, total, page, limit);
}

export async function listTrips(providerId?: string) {
  return Trip.find(providerId ? { providerId } : {})
    .populate(
      'providerId',
      'businessName logo rating totalReviews verificationStatus phone email description'
    )
    .populate('vehicleId')
    .sort({ departureDate: 1, departureTime: 1 });
}

export async function getTrip(id: string) {
  const trip = assertFound(
    await Trip.findById(id).populate('providerId').populate('vehicleId').populate('pickupPoints'),
    'Trip not found'
  );

  // Backfill 0,0 pickups so maps work for older free-text stops
  const pickups = Array.isArray(trip.pickupPoints) ? trip.pickupPoints : [];
  for (const point of pickups) {
    if (point && typeof point === 'object' && 'latitude' in point) {
      await ensurePickupCoordinates(point as InstanceType<typeof PickupPoint>);
    }
  }

  return trip;
}

export async function updateTrip(providerId: string, id: string, patch: Record<string, unknown>) {
  const trip = assertFound(await Trip.findById(id), 'Trip not found');
  if (trip.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  Object.assign(trip, patch);
  await trip.save();
  return trip;
}

export async function deleteTrip(providerId: string, id: string) {
  const trip = assertFound(await Trip.findById(id), 'Trip not found');
  if (trip.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  trip.status = 'cancelled';
  await trip.save();
  return trip;
}
