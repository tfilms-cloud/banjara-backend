import { connectDatabase, disconnectDatabase } from '../config/database';
import { City } from '../models/City';
import { IntercitySettings } from '../models/IntercitySettings';
import { INTERCITY_CLASSES, RouteFare } from '../models/RouteFare';
import { logger } from '../utils/logger';
import { clearCityCache } from '../services/city.service';

/**
 * City to City starter data: served cities, route facts (road km, drive time, tolls)
 * and the settings document. Idempotent and non-destructive: existing rows are never
 * overwritten, so re-running it never undoes values someone has edited.
 *
 * Fares come from the formula in IntercitySettings (Rs 1,500 base + Rs 15/km +
 * Rs 10/min for a car). ⚠️ Check km, minutes, tolls and surcharges before launch.
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

/**
 * Route facts, one way: road km, drive minutes, tolls (PKR) and rough-road surcharge (PKR).
 * The surcharge is only for jeep tracks (e.g. Fairy Meadows, Deosai): drive time already
 * prices ordinary mountain roads such as the KKH, so these sealed-road routes have none.
 */
const ROUTES: Array<{ from: string; to: string; km: number; minutes: number; tolls: number; difficult: number; bid: boolean }> = [
  { from: 'islamabad', to: 'gilgit', km: 600, minutes: 960, tolls: 600, difficult: 0, bid: true },
  { from: 'islamabad', to: 'hunza', km: 700, minutes: 1140, tolls: 600, difficult: 0, bid: true },
  { from: 'islamabad', to: 'skardu', km: 620, minutes: 1200, tolls: 600, difficult: 0, bid: true },
  { from: 'islamabad', to: 'naran', km: 270, minutes: 360, tolls: 400, difficult: 0, bid: true },
  { from: 'islamabad', to: 'chilas', km: 470, minutes: 720, tolls: 600, difficult: 0, bid: true },
  { from: 'islamabad', to: 'murree', km: 60, minutes: 90, tolls: 0, difficult: 0, bid: false },
  { from: 'islamabad', to: 'abbottabad', km: 120, minutes: 150, tolls: 300, difficult: 0, bid: false },
  { from: 'islamabad', to: 'swat', km: 250, minutes: 270, tolls: 300, difficult: 0, bid: true },
  { from: 'islamabad', to: 'lahore', km: 380, minutes: 270, tolls: 1200, difficult: 0, bid: false },
  { from: 'islamabad', to: 'peshawar', km: 185, minutes: 150, tolls: 600, difficult: 0, bid: false },
  { from: 'gilgit', to: 'hunza', km: 100, minutes: 120, tolls: 0, difficult: 0, bid: true },
  { from: 'gilgit', to: 'skardu', km: 170, minutes: 240, tolls: 0, difficult: 0, bid: true },
  { from: 'gilgit', to: 'chilas', km: 130, minutes: 150, tolls: 0, difficult: 0, bid: true },
];

/**
 * Surcharges an earlier version of this seed set on sealed roads (they double-counted the
 * drive-time charge). Rows still holding exactly these values are reset to 0; a value
 * someone has edited since is left alone.
 */
const RETIRED_SURCHARGES: Array<{ from: string; to: string; amount: number }> = [
  { from: 'islamabad', to: 'gilgit', amount: 2000 },
  { from: 'islamabad', to: 'hunza', amount: 2500 },
  { from: 'islamabad', to: 'skardu', amount: 3000 },
  { from: 'islamabad', to: 'naran', amount: 1000 },
  { from: 'islamabad', to: 'chilas', amount: 1500 },
  { from: 'gilgit', to: 'hunza', amount: 800 },
  { from: 'gilgit', to: 'skardu', amount: 1500 },
  { from: 'gilgit', to: 'chilas', amount: 800 },
];

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
    for (const vehicleClass of INTERCITY_CLASSES) {
      const result = await RouteFare.updateOne(
        { fromCityId: ids.get(r.from), toCityId: ids.get(r.to), vehicleClass },
        {
          $setOnInsert: {
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

  let surchargesReset = 0;
  for (const r of RETIRED_SURCHARGES) {
    const result = await RouteFare.updateMany(
      { fromCityId: ids.get(r.from), toCityId: ids.get(r.to), difficultSurcharge: r.amount },
      { $set: { difficultSurcharge: 0 } }
    );
    surchargesReset += result.modifiedCount;
  }
  clearCityCache();
  return { cities: CITIES.length, newRouteFares: routes, surchargesReset };
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
