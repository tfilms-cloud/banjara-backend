import { City, type ICity } from '../models/City';
import { haversineKm } from './intercityFare.service';

/** Cities change rarely; a short cache keeps pin lookups off the database. */
let cache: { at: number; cities: ICity[] } | null = null;
const CACHE_MS = 60_000;

export async function listActiveCities(): Promise<ICity[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cities;
  const cities = await City.find({ active: true }).sort({ name: 1 }).lean<ICity[]>();
  cache = { at: Date.now(), cities };
  return cities;
}

/** For tests and after edits. */
export function clearCityCache() {
  cache = null;
}

export function cityPoint(city: Pick<ICity, 'location'>) {
  const [lng, lat] = city.location.coordinates;
  return { lat, lng };
}

/** Pure: the nearest city whose radius covers the point, or null. */
export function nearestCity<T extends Pick<ICity, 'location' | 'radiusKm'>>(
  cities: T[],
  point: { lat: number; lng: number }
): T | null {
  let best: { city: T; km: number } | null = null;
  for (const city of cities) {
    const km = haversineKm(point, cityPoint(city));
    if (km <= city.radiusKm && (!best || km < best.km)) best = { city, km };
  }
  return best?.city ?? null;
}

/** The served city a pin falls in. */
export async function resolveCity(point: { lat: number; lng: number }) {
  return nearestCity(await listActiveCities(), point);
}

export async function getCity(id: string) {
  const cities = await listActiveCities();
  return cities.find((city) => city._id.toString() === id) ?? null;
}

export function publicCity(city: ICity) {
  const { lat, lng } = cityPoint(city);
  return { id: city._id.toString(), name: city.name, province: city.province, lat, lng, radiusKm: city.radiusKm };
}
