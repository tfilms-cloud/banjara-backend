import { ProviderProfile } from '../models/ProviderProfile';
import { AppError, assertFound } from '../utils/AppError';
import { matchCuratedPlaces } from '../utils/curatedPlaces';
import { getPagination } from '../utils/pagination';
import { env } from '../config/env';

export type StructuredAddress = {
  street?: string;
  area?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  formattedAddress?: string;
};

export type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

function assertValidPoint(location: GeoPoint) {
  if (location.type !== 'Point') {
    throw new AppError('GeoJSON type must be Point', 422);
  }
  const [lng, lat] = location.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new AppError('Coordinates must be valid numbers', 422);
  }
  if (lng < -180 || lng > 180) {
    throw new AppError('Longitude must be between -180 and 180', 422);
  }
  if (lat < -90 || lat > 90) {
    throw new AppError('Latitude must be between -90 and 90', 422);
  }
  if (lng === 0 && lat === 0) {
    throw new AppError('Please select a real business location on the map', 422);
  }
}

function toLocationPayload(profile: InstanceType<typeof ProviderProfile>) {
  const [longitude, latitude] = profile.location?.coordinates ?? [0, 0];
  return {
    businessId: profile._id.toString(),
    businessName: profile.businessName,
    address: profile.structuredAddress ?? {
      city: profile.city,
      formattedAddress: profile.address,
      country: 'Pakistan',
    },
    location: profile.location ?? { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
    latitude,
    longitude,
    locationUpdatedAt: profile.locationUpdatedAt ?? null,
  };
}

export async function getBusinessLocation(businessId: string) {
  const profile = assertFound(await ProviderProfile.findById(businessId), 'Business not found');
  return toLocationPayload(profile);
}

export async function getMyBusinessLocation(userId: string) {
  const profile = assertFound(
    await ProviderProfile.findOne({ userId }),
    'Business profile not found'
  );
  return toLocationPayload(profile);
}

export async function saveBusinessLocation(
  userId: string,
  businessId: string | 'me',
  input: { address: StructuredAddress; location: GeoPoint }
) {
  assertValidPoint(input.location);

  const filter =
    businessId === 'me'
      ? { userId }
      : { _id: businessId, userId };

  const profile = assertFound(await ProviderProfile.findOne(filter), 'Business not found');

  const formatted =
    input.address.formattedAddress?.trim() ||
    [input.address.street, input.address.area, input.address.city, input.address.region, input.address.country]
      .filter(Boolean)
      .join(', ');

  profile.structuredAddress = {
    street: input.address.street ?? '',
    area: input.address.area ?? '',
    city: input.address.city ?? profile.city,
    region: input.address.region ?? '',
    postalCode: input.address.postalCode ?? '',
    country: input.address.country ?? 'Pakistan',
    formattedAddress: formatted,
  };
  profile.address = formatted || profile.address;
  if (input.address.city?.trim()) {
    profile.city = input.address.city.trim();
  }
  profile.location = {
    type: 'Point',
    coordinates: [input.location.coordinates[0], input.location.coordinates[1]],
  };
  profile.locationUpdatedAt = new Date();
  await profile.save();

  return toLocationPayload(profile);
}

export async function findNearbyBusinesses(query: {
  longitude: number;
  latitude: number;
  radius?: number;
  category?: string;
  page?: number;
  limit?: number;
}) {
  const radius = query.radius ?? 5000;
  const { page, limit, skip } = getPagination(query);

  const match: Record<string, unknown> = { verificationStatus: 'approved' };
  if (query.category) match.services = query.category;

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [query.longitude, query.latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radius,
        spherical: true,
        query: match,
      },
    },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await ProviderProfile.aggregate(pipeline as never[]);
  const items = (result?.items ?? []) as Array<{
    _id: { toString(): string };
    businessName: string;
    services: string[];
    city: string;
    address: string;
    structuredAddress?: StructuredAddress;
    location?: GeoPoint;
    rating: number;
    distanceMeters: number;
  }>;
  const total = result?.total?.[0]?.count ?? 0;

  return {
    items: items.map((item) => ({
      business: {
        id: item._id.toString(),
        businessName: item.businessName,
        services: item.services,
        city: item.city,
        address: item.structuredAddress ?? { formattedAddress: item.address, city: item.city },
        location: item.location,
        rating: item.rating,
      },
      distanceMeters: Math.round(item.distanceMeters),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * Free place autocomplete for Pakistan:
 * 1) Curated BANJARA places (instant, consistent names)
 * 2) Photon (Komoot / OSM) — strong autocomplete, no API key
 * 3) Nominatim fallback — fills gaps
 */
export async function searchPlaces(q: string, limit = 8) {
  const query = q.trim();
  if (query.length < 2) return [];

  const curated = matchCuratedPlaces(query, limit);
  const remaining = Math.max(0, limit - curated.length);

  const [photon, nominatim] = await Promise.all([
    remaining > 0 ? searchPhoton(query, remaining + 2).catch(() => []) : Promise.resolve([]),
    remaining > 0 ? searchNominatim(query, Math.min(4, remaining + 1)).catch(() => []) : Promise.resolve([]),
  ]);

  const merged = [...curated];
  const seen = new Set(
    curated.map((p) => normalizeKey(`${p.name}|${p.latitude.toFixed(3)}|${p.longitude.toFixed(3)}`))
  );

  for (const place of [...photon, ...nominatim]) {
    const key = normalizeKey(`${place.name}|${place.latitude.toFixed(3)}|${place.longitude.toFixed(3)}`);
    const nameKey = normalizeKey(place.name);
    if (seen.has(key) || seen.has(nameKey)) continue;
    seen.add(key);
    seen.add(nameKey);
    merged.push(place);
    if (merged.length >= limit) break;
  }

  return merged.slice(0, limit);
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function searchPhoton(q: string, limit: number) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', 'en');
  // Bias toward northern Pakistan / Islamabad corridor
  url.searchParams.set('lat', '33.6844');
  url.searchParams.set('lon', '73.0479');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': env.GEOCODER_USER_AGENT || 'BanjaraApp/1.0 (support@banjara.app)',
      Accept: 'application/json',
    },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, string | number | undefined>;
    }>;
  };

  return (data.features ?? [])
    .map((feature) => {
      const props = feature.properties ?? {};
      const [longitude, latitude] = feature.geometry?.coordinates ?? [NaN, NaN];
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      // Prefer Pakistan / nearby results when country is present
      const country = String(props.country ?? '');
      if (country && !/pakistan|پاکستان/i.test(country) && !/pk/i.test(String(props.countrycode ?? ''))) {
        return null;
      }
      const name = String(props.name || props.city || props.street || 'Place');
      const city = String(props.city || props.town || props.village || props.county || '');
      const region = String(props.state || props.county || '');
      const formatted = [name, props.street, city, region, country || 'Pakistan']
        .filter(Boolean)
        .filter((part, i, arr) => arr.indexOf(part) === i)
        .join(', ');

      return {
        name,
        address: {
          street: String(props.street ?? ''),
          area: String(props.district || props.suburb || ''),
          city,
          region,
          postalCode: String(props.postcode ?? ''),
          country: country || 'Pakistan',
          formattedAddress: formatted,
        },
        latitude,
        longitude,
        location: {
          type: 'Point' as const,
          coordinates: [longitude, latitude] as [number, number],
        },
        source: 'photon' as const,
      };
    })
    .filter(Boolean) as Array<ReturnType<typeof mapNominatimResult> & { source: 'photon' }>;
}

async function searchNominatim(q: string, limit: number) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('countrycodes', 'pk');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': env.GEOCODER_USER_AGENT || 'BanjaraApp/1.0 (support@banjara.app)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) return [];

  const rows = (await response.json()) as Array<{
    display_name: string;
    lat: string;
    lon: string;
    address?: Record<string, string>;
  }>;

  return rows.map((row) => ({ ...mapNominatimResult(row), source: 'nominatim' as const }));
}

export async function reverseGeocode(latitude: number, longitude: number) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': env.GEOCODER_USER_AGENT || 'BanjaraApp/1.0 (support@banjara.app)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new AppError('Could not resolve address for this location', 502);
  }

  const row = (await response.json()) as {
    display_name?: string;
    lat?: string;
    lon?: string;
    address?: Record<string, string>;
    error?: string;
  };

  if (row.error || !row.lat || !row.lon) {
    throw new AppError('No address found for this map position', 404);
  }

  return mapNominatimResult({
    display_name: row.display_name ?? '',
    lat: row.lat,
    lon: row.lon,
    address: row.address,
  });
}

function mapNominatimResult(row: {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}) {
  const a = row.address ?? {};
  const latitude = Number(row.lat);
  const longitude = Number(row.lon);
  const address: StructuredAddress = {
    street: [a.road, a.house_number].filter(Boolean).join(' ') || a.pedestrian || '',
    area: a.suburb || a.neighbourhood || a.village || a.town || '',
    city: a.city || a.town || a.municipality || a.county || a.state_district || '',
    region: a.state || a.region || '',
    postalCode: a.postcode || '',
    country: a.country || 'Pakistan',
    formattedAddress: row.display_name,
  };

  return {
    name: a.tourism || a.hotel || a.amenity || a.building || address.area || address.city || 'Selected place',
    address,
    latitude,
    longitude,
    location: {
      type: 'Point' as const,
      coordinates: [longitude, latitude] as [number, number],
    },
  };
}
