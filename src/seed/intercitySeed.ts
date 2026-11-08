import { connectDatabase, disconnectDatabase } from '../config/database';
import { City } from '../models/City';
import { IntercitySettings } from '../models/IntercitySettings';
import { RouteFare, type IntercityClass } from '../models/RouteFare';
import { logger } from '../utils/logger';
import { clearCityCache } from '../services/city.service';

/**
 * City to City starter data: served cities, sample route fares and the settings
 * document. Idempotent and non-destructive: existing rows are never overwritten, so
 * re-running it never undoes prices someone has edited.
 *
 * ⚠️ FARES ARE PLACEHOLDERS. Replace them with real prices before launch.
 */

const CITIES = [
  // Islamabad and Rawalpindi are one metro area: a ride between them is not intercity.
  { slug: 'islamabad', name: 'Islamabad / Rawalpindi', aliases: ['islamabad', 'rawalpindi', 'pindi'], province: 'ICT / Punjab', lat: 33.6252, lng: 73.0324, radiusKm: 30 },
  { slug: 'lahore', name: 'Lahore', aliases: [], province: 'Punjab', lat: 31.5204, lng: 74.3587, radiusKm: 30 },
  { slug: 'peshawar', name: 'Peshawar', aliases: [], province: 'Khyber Pakhtunkhwa', lat: 34.0151, lng: 71.5249, radiusKm: 25 },
  { slug: 'abbottabad', name: 'Abbottabad', aliases: [], province: 'Khyber Pakhtunkhwa', lat: 34.1463, lng: 73.2117, radiusKm: 15 },
  { slug: 'murree', name: 'Murree', aliases: [], province: 'Punjab', lat: 33.9076, lng: 73.3943, radiusKm: 12 },
  { slug: 'swat', name: 'Swat (Mingora)', aliases: ['swat', 'mingora'], province: 'Khyber Pakhtunkhwa', lat: 34.7717, lng: 72.3602, radiusKm: 25 },
  { slug: 'naran', name: 'Naran', aliases: ['kaghan'], province: 'Khyber Pakhtunkhwa', lat: 34.9092, lng: 73.6497, radiusKm: 15 },
  { slug: 'chilas', name: 'Chilas', aliases: [], province: 'Gilgit-Baltistan', lat: 35.4205, lng: 74.098, radiusKm: 15 },
  { slug: 'gilgit', name: 'Gilgit', aliases: [], province: 'Gilgit-Baltistan', lat: 35.9208, lng: 74.3144, radiusKm: 20 },
  { slug: 'hunza', name: 'Hunza (Karimabad)', aliases: ['hunza', 'karimabad', 'aliabad'], province: 'Gilgit-Baltistan', lat: 36.3167, lng: 74.65, radiusKm: 20 },
  { slug: 'skardu', name: 'Skardu', aliases: [], province: 'Gilgit-Baltistan', lat: 35.2971, lng: 75.6335, radiusKm: 20 },
  { slug: 'karachi', name: 'Karachi', aliases: [], province: 'Sindh', lat: 24.8607, lng: 67.0011, radiusKm: 40 },
];

/** Placeholder full-car fares (PKR, one way). Other classes = car × the class multiplier. */
const ROUTES: Array<{ from: string; to: string; km: number; minutes: number; car: number; tolls: number; difficult: number; bid: boolean }> = [
  { from: 'islamabad', to: 'gilgit', km: 600, minutes: 960, car: 18000, tolls: 600, difficult: 2000, bid: true },
  { from: 'islamabad', to: 'hunza', km: 700, minutes: 1140, car: 22000, tolls: 600, difficult: 2500, bid: true },
  { from: 'islamabad', to: 'skardu', km: 620, minutes: 1200, car: 22000, tolls: 600, difficult: 3000, bid: true },
  { from: 'islamabad', to: 'naran', km: 270, minutes: 360, car: 9000, tolls: 400, difficult: 1000, bid: true },
  { from: 'islamabad', to: 'chilas', km: 470, minutes: 720, car: 15000, tolls: 600, difficult: 1500, bid: true },
  { from: 'islamabad', to: 'murree', km: 60, minutes: 90, car: 3500, tolls: 0, difficult: 0, bid: false },
  { from: 'islamabad', to: 'abbottabad', km: 120, minutes: 150, car: 4500, tolls: 300, difficult: 0, bid: false },
  { from: 'islamabad', to: 'swat', km: 250, minutes: 270, car: 8000, tolls: 300, difficult: 0, bid: true },
  { from: 'islamabad', to: 'lahore', km: 380, minutes: 270, car: 9500, tolls: 1200, difficult: 0, bid: false },
  { from: 'islamabad', to: 'peshawar', km: 185, minutes: 150, car: 6000, tolls: 600, difficult: 0, bid: false },
  { from: 'gilgit', to: 'hunza', km: 100, minutes: 120, car: 4500, tolls: 0, difficult: 800, bid: true },
  { from: 'gilgit', to: 'skardu', km: 170, minutes: 240, car: 7000, tolls: 0, difficult: 1500, bid: true },
  { from: 'gilgit', to: 'chilas', km: 130, minutes: 150, car: 5000, tolls: 0, difficult: 800, bid: true },
];

const CLASS_FACTOR: Record<IntercityClass, number> = { car: 1, suv: 1.4, jeep: 1.5, van: 1.8, coaster: 2.6 };

export async function applyIntercitySeed() {
  await IntercitySettings.updateOne({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true });

  const ids = new Map<string, string>();
  for (const c of CITIES) {
    const city = await City.findOneAndUpdate(
      { slug: c.slug },
      {
        $setOnInsert: {
          slug: c.slug,
          name: c.name,
          aliases: c.aliases,
          province: c.province,
          location: { type: 'Point', coordinates: [c.lng, c.lat] },
          radiusKm: c.radiusKm,
          active: true,
        },
      },
      { upsert: true, new: true }
    );
    ids.set(c.slug, String(city._id));
  }

  let routes = 0;
  for (const r of ROUTES) {
    for (const [vehicleClass, factor] of Object.entries(CLASS_FACTOR) as Array<[IntercityClass, number]>) {
      const result = await RouteFare.updateOne(
        { fromCityId: ids.get(r.from), toCityId: ids.get(r.to), vehicleClass },
        {
          $setOnInsert: {
            baseFare: Math.round((r.car * factor) / 100) * 100,
            distanceKm: r.km,
            durationMinutes: r.minutes,
            tolls: r.tolls,
            difficultSurcharge: r.difficult,
            bidEnabled: r.bid,
            bothWays: true,
            active: true,
          },
        },
        { upsert: true }
      );
      routes += result.upsertedCount;
    }
  }
  clearCityCache();
  return { cities: CITIES.length, newRouteFares: routes };
}

if (require.main === module) {
  (async () => {
    await connectDatabase();
    try {
      const result = await applyIntercitySeed();
      logger.info(result, '[seed:intercity] done');
    } finally {
      await disconnectDatabase();
    }
  })().catch((err) => {
    logger.error({ err }, '[seed:intercity] failed');
    process.exit(1);
  });
}
