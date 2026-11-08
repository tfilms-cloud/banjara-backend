import { Types } from 'mongoose';
import { ProviderProfile } from '../models/ProviderProfile';
import { Trip } from '../models/Trip';
import { Vehicle, type IVehicle } from '../models/Vehicle';
import type { IntercityClass } from '../models/RouteFare';
import type { IRideRequest } from '../models/RideRequest';
import type { IIntercitySettings } from '../models/IntercitySettings';
import { haversineKm } from './intercityFare.service';

/**
 * Which drivers may see a City to City request. A driver qualifies when they:
 *  - are an approved transport provider who opted in to intercity rides,
 *  - live in the pickup city, are within the matching radius of the pickup, or list a
 *    preferred route that starts in the pickup city,
 *  - have an active vehicle of the requested class with enough seats,
 *  - accept shared rides (for a shared request),
 *  - have not declined it, were not dropped from it, and are not already on another
 *    intercity trip around that time.
 */

/** Vehicle types (Vehicle.type) → the intercity class they can serve. */
export function intercityClassOf(vehicleType: string): IntercityClass | null {
  switch (vehicleType) {
    case 'car':
      return 'car';
    case 'suv':
      return 'suv';
    case 'jeep':
      return 'jeep';
    case 'van':
      return 'van';
    case 'minibus':
    case 'coaster':
    case 'tourVehicle':
      return 'coaster';
    default:
      return null;
  }
}

/** A driver can't take two intercity trips this close together. */
const BUSY_WINDOW_MS = 3 * 60 * 60 * 1000;

type MatchRequest = Pick<
  IRideRequest,
  'pickup' | 'vehicleClass' | 'passengers' | 'rideType' | 'departAt' | 'declinedBy' | 'excludedProviderIds'
> & { searchRadiusKm?: number };

export interface MatchedDriver {
  providerId: string;
  userId: string;
  vehicle: Pick<IVehicle, '_id' | 'type' | 'seatCount' | 'name' | 'registrationNumber'>;
  /** Home city or preferred route matches (shown first). */
  preferred: boolean;
}

export async function findEligibleDrivers(
  request: MatchRequest,
  settings: Pick<IIntercitySettings, 'matchRadiusKm'>,
  options: { onlyProviderId?: string } = {}
): Promise<MatchedDriver[]> {
  const skip = [...(request.declinedBy ?? []), ...(request.excludedProviderIds ?? [])].map(String);
  const filter: Record<string, unknown> = {
    services: 'transport',
    verificationStatus: 'approved',
    'intercity.enabled': true,
  };
  if (options.onlyProviderId) filter._id = new Types.ObjectId(options.onlyProviderId);
  const providers = await ProviderProfile.find(filter).select('userId intercity location').lean();

  const pickupCity = String(request.pickup.cityId);
  const pickupPoint = { lat: request.pickup.lat, lng: request.pickup.lng };
  // Distance first: a driver with a pinned location is in range when within the request's
  // current search radius (10 → 20 → 30 → 50 km steps). A driver with no pin falls back
  // to home city / a preferred route starting in the pickup city.
  const radiusKm = request.searchRadiusKm ?? settings.matchRadiusKm;
  const nearby = providers.filter((p) => {
    if (skip.includes(String(p._id))) return false;
    const ic = (p as { intercity?: { homeCityId?: unknown; preferredRoutes?: Array<{ fromCityId?: unknown }>; acceptsShared?: boolean } }).intercity ?? {};
    if (request.rideType === 'shared_seat' && !ic.acceptsShared) return false;
    const coords = p.location?.coordinates;
    if (coords?.length === 2 && (coords[0] !== 0 || coords[1] !== 0)) {
      return haversineKm(pickupPoint, { lat: coords[1], lng: coords[0] }) <= radiusKm;
    }
    if (String(ic.homeCityId ?? '') === pickupCity) return true;
    return (ic.preferredRoutes ?? []).some((r) => String(r.fromCityId ?? '') === pickupCity);
  });
  if (!nearby.length) return [];

  const ids = nearby.map((p) => p._id);
  const vehicles = await Vehicle.find({ providerId: { $in: ids }, status: 'active' })
    .select('providerId type seatCount name registrationNumber')
    .lean();
  const departAt = new Date(request.departAt).getTime();
  const busy = await Trip.find({
    providerId: { $in: ids },
    rideType: 'intercity',
    status: { $in: ['scheduled', 'boarding', 'departed', 'inTransit'] },
    'intercity.departAt': { $gte: new Date(departAt - BUSY_WINDOW_MS), $lte: new Date(departAt + BUSY_WINDOW_MS) },
  })
    .select('providerId')
    .lean();
  const busyIds = new Set(busy.map((t) => String(t.providerId)));

  const matches: MatchedDriver[] = [];
  for (const p of nearby) {
    if (busyIds.has(String(p._id))) continue;
    const vehicle = vehicles.find(
      (v) =>
        String(v.providerId) === String(p._id) &&
        intercityClassOf(v.type) === request.vehicleClass &&
        v.seatCount >= request.passengers
    );
    if (!vehicle) continue;
    const ic = (p as { intercity?: { homeCityId?: unknown; preferredRoutes?: Array<{ fromCityId?: unknown }> } }).intercity ?? {};
    matches.push({
      providerId: String(p._id),
      userId: String(p.userId),
      vehicle,
      preferred:
        String(ic.homeCityId ?? '') === pickupCity ||
        (ic.preferredRoutes ?? []).some((r) => String(r.fromCityId ?? '') === pickupCity),
    });
  }
  return matches.sort((a, b) => Number(b.preferred) - Number(a.preferred));
}
