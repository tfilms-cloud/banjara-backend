import { env } from '../config/env';
import { log } from '../utils/logger';

/**
 * Driving directions between two points, from an OSRM server (env OSRM_URL). Used to show
 * "3.2 km by road · about 9 min" and the road route from a visitor to a ride's pickup.
 * Answers are cached briefly; when the routing server is slow or down this returns null and
 * the clients fall back to straight-line distance.
 */

export type LatLng = { lat: number; lng: number };
export type DrivingRoute = {
  distanceKm: number;
  durationMin: number;
  /** [lat, lng] pairs along the road, simplified for drawing. */
  path: Array<[number, number]>;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 6000;
/** Enough points to follow the road on a city/valley map without a huge response. */
const MAX_POINTS = 400;

const cache = new Map<string, { at: number; route: DrivingRoute | null }>();

/** ~11 m precision: nearby requests share a cache entry. */
const keyOf = (from: LatLng, to: LatLng) =>
  [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(',');

function thin(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length <= MAX_POINTS) return points;
  const step = (points.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => points[Math.round(i * step)]);
}

export function clearDirectionsCache() {
  cache.clear();
}

export async function getDrivingRoute(
  from: LatLng,
  to: LatLng,
  fetchImpl: typeof fetch = fetch
): Promise<DrivingRoute | null> {
  const key = keyOf(from, to);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.route;

  const base = env.OSRM_URL.replace(/\/+$/, '');
  const url =
    `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&alternatives=false&steps=false';
  let route: DrivingRoute | null = null;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': env.GEOCODER_USER_AGENT },
    });
    if (response.ok) {
      const data = (await response.json()) as {
        code?: string;
        routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: number[][] } }>;
      };
      const best = data.routes?.[0];
      const coordinates = best?.geometry?.coordinates;
      if (data.code === 'Ok' && best && coordinates?.length) {
        route = {
          distanceKm: Math.round(((best.distance ?? 0) / 1000) * 10) / 10,
          durationMin: Math.max(1, Math.round((best.duration ?? 0) / 60)),
          path: thin(coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
        };
      }
    } else {
      log().warn({ status: response.status }, '[directions] routing server refused the request');
    }
  } catch (err) {
    log().warn({ err: (err as Error).message }, '[directions] routing server unavailable');
    // Don't cache failures: the next request may succeed.
    return null;
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), route });
  return route;
}
