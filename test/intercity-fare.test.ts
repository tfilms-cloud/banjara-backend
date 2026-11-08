import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERCITY_SETTINGS } from '../src/models/IntercitySettings';
import { computeFare, haversineKm } from '../src/services/intercityFare.service';
import { nearestCity } from '../src/services/city.service';

const settings = { ...DEFAULT_INTERCITY_SETTINGS };
const islamabad = { lat: 33.6844, lng: 73.0479 };
const gilgit = { lat: 35.9208, lng: 74.3144 };

describe('Intercity fare strategy (pure)', () => {
  it('uses the route fare table when a route matches, with tolls and the mountain surcharge', () => {
    const quote = computeFare(
      {
        vehicleClass: 'car',
        rideType: 'full_car',
        straightLineKm: 270,
        route: { baseFare: 18000, distanceKm: 600, tolls: 400, difficultSurcharge: 2000, bidEnabled: true },
      },
      settings
    );
    expect(quote.source).toBe('route');
    expect(quote.distanceKm).toBe(600);
    expect(quote.lines.map((l) => l.code)).toEqual(['base', 'tolls', 'difficult_route']);
    expect(quote.subtotal).toBe(18000 + 400 + 2000);
    expect(quote.returnLeg).toBe(0);
    expect(quote.bidAllowed).toBe(true);
  });

  it('falls back to base + per-km × road distance × class multiplier', () => {
    const car = computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 100 }, settings);
    // 100 km straight × 1.3 road factor = 130 km; 1500 + 45 × 130 × 1.0
    expect(car.source).toBe('formula');
    expect(car.distanceKm).toBe(130);
    expect(car.subtotal).toBe(1500 + 5850);
    const jeep = computeFare({ vehicleClass: 'jeep', rideType: 'full_car', straightLineKm: 100 }, settings);
    // The multiplier applies to the distance part only.
    expect(jeep.subtotal).toBe(1500 + Math.round((45 * 130 * 1.5) / 10) * 10);
    expect(car.bidAllowed).toBe(settings.bidOnFallback);
  });

  it('round trip adds a return leg plus hourly waiting, or a flat overnight charge', () => {
    const route = { baseFare: 10000, distanceKm: 200, tolls: 0, difficultSurcharge: 0, bidEnabled: false };
    const hourly = computeFare(
      { vehicleClass: 'car', rideType: 'full_car', straightLineKm: 150, route, returnWait: { mode: 'hourly', hours: 3 } },
      settings
    );
    expect(hourly.outbound).toBe(10000);
    expect(hourly.returnLeg).toBe(10000 + 3 * 500);
    expect(hourly.subtotal).toBe(21500);

    const overnight = computeFare(
      { vehicleClass: 'car', rideType: 'full_car', straightLineKm: 150, route, returnWait: { mode: 'overnight', nights: 2 } },
      settings
    );
    expect(overnight.returnLeg).toBe(10000 + 2 * 4000);
    expect(overnight.lines.find((l) => l.code === 'overnight')?.label).toBe('Driver stays 2 nights');
  });

  it('prices shared seats as a fraction of the full-car fare, per seat', () => {
    const route = { baseFare: 10000, distanceKm: 200, tolls: 0, difficultSurcharge: 0, bidEnabled: false };
    const shared = computeFare({ vehicleClass: 'van', rideType: 'shared_seat', seats: 2, straightLineKm: 150, route }, settings);
    expect(shared.subtotal).toBe(2 * 3000);
    expect(shared.lines).toEqual([{ code: 'shared_seats', label: '2 × shared seat', amount: 6000 }]);
  });

  it('never hardcodes a price: a different settings document changes the fare', () => {
    const cheaper = { ...settings, baseFare: 1000, perKm: 30 };
    const quote = computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 100 }, cheaper);
    expect(quote.subtotal).toBe(1000 + 30 * 130);
  });
});

describe('City detection', () => {
  const city = (name: string, lat: number, lng: number, radiusKm = 25) => ({
    name,
    radiusKm,
    location: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
  });
  const cities = [city('Islamabad', 33.6844, 73.0479), city('Rawalpindi', 33.5651, 73.0169), city('Gilgit', 35.9208, 74.3144)];

  it('picks the nearest city whose radius covers the pin', () => {
    expect(nearestCity(cities, { lat: 33.7, lng: 73.05 })?.name).toBe('Islamabad');
    expect(nearestCity(cities, { lat: 33.58, lng: 73.02 })?.name).toBe('Rawalpindi');
    expect(nearestCity(cities, { lat: 35.9, lng: 74.3 })?.name).toBe('Gilgit');
  });

  it('returns null outside every city', () => {
    expect(nearestCity(cities, { lat: 30, lng: 70 })).toBeNull();
  });

  it('measures Islamabad → Gilgit at about 270 km straight-line', () => {
    expect(Math.round(haversineKm(islamabad, gilgit))).toBeGreaterThan(260);
    expect(Math.round(haversineKm(islamabad, gilgit))).toBeLessThan(280);
  });
});
