import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERCITY_SETTINGS } from '../src/models/IntercitySettings';
import { computeFare, haversineKm } from '../src/services/intercityFare.service';
import { nearestCity } from '../src/services/city.service';

const settings = { ...DEFAULT_INTERCITY_SETTINGS };
const islamabad = { lat: 33.6844, lng: 73.0479 };
const gilgit = { lat: 35.9208, lng: 74.3144 };

describe('Intercity fare formula (pure)', () => {
  const sum = (lines: { amount: number }[]) => lines.reduce((total, line) => total + line.amount, 0);

  it('uses the defaults agreed for a car: Rs 1,500 base + Rs 15/km + Rs 10/min, minimum Rs 3,000', () => {
    expect(settings.baseFare).toBe(1500);
    expect(settings.ratePerKm).toBe(15);
    expect(settings.ratePerMinute).toBe(10);
    expect(settings.minimumFare).toBe(3000);
  });

  it('prices a known route from its km and drive time, then adds tolls and the surcharge', () => {
    const quote = computeFare(
      {
        vehicleClass: 'car',
        rideType: 'full_car',
        straightLineKm: 270,
        route: { distanceKm: 600, durationMinutes: 960, tolls: 600, difficultSurcharge: 2000, bidEnabled: true },
      },
      settings
    );
    // Islamabad → Gilgit: 1500 + 600 × 15 + 960 × 10 = 20,100, + 600 tolls + 2,000 surcharge.
    expect(quote.source).toBe('route');
    expect(quote.distanceKm).toBe(600);
    expect(quote.durationMinutes).toBe(960);
    expect(quote.lines.map((l) => [l.code, l.amount])).toEqual([
      ['base', 1500],
      ['distance', 9000],
      ['time', 9600],
      ['tolls', 600],
      ['difficult_route', 2000],
    ]);
    expect(quote.lines.find((l) => l.code === 'time')?.label).toBe('About 16 h driving');
    expect(quote.subtotal).toBe(22700);
    expect(quote.returnLeg).toBe(0);
    expect(quote.bidAllowed).toBe(true);
  });

  it('estimates km and drive time without a route, and multiplies every part by the vehicle class', () => {
    const car = computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 100 }, settings);
    // 100 km straight × 1.3 = 130 road km; 130 km at 45 km/h ≈ 173 min.
    expect(car.source).toBe('formula');
    expect(car.distanceKm).toBe(130);
    expect(car.durationMinutes).toBe(173);
    expect(car.subtotal).toBe(1500 + 1950 + 1730);
    expect(car.bidAllowed).toBe(settings.bidOnFallback);

    const jeep = computeFare({ vehicleClass: 'jeep', rideType: 'full_car', straightLineKm: 100 }, settings);
    // × 1.5 on base, distance and time, each rounded to Rs 10.
    expect(jeep.lines.map((l) => l.amount)).toEqual([2250, 2930, 2600]);
    expect(jeep.subtotal).toBe(7780);
  });

  it('tops short trips up to the minimum fare (scaled by class)', () => {
    const car = computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 10 }, settings);
    expect(car.lines.find((l) => l.code === 'minimum')?.amount).toBe(1130);
    expect(car.subtotal).toBe(3000);
    const coaster = computeFare({ vehicleClass: 'coaster', rideType: 'full_car', straightLineKm: 10 }, settings);
    expect(coaster.subtotal).toBe(3000 * 2.6);
    // A trip that already clears the minimum gets no top-up line.
    const murree = computeFare(
      {
        vehicleClass: 'car',
        rideType: 'full_car',
        straightLineKm: 40,
        route: { distanceKm: 60, durationMinutes: 90, tolls: 0, difficultSurcharge: 0, bidEnabled: false },
      },
      settings
    );
    expect(murree.lines.some((l) => l.code === 'minimum')).toBe(false);
    expect(murree.subtotal).toBe(3300);
  });

  it('round trip adds a return leg plus hourly waiting, or a flat overnight charge', () => {
    const route = { distanceKm: 200, durationMinutes: 180, tolls: 0, difficultSurcharge: 0, bidEnabled: false };
    const leg = 1500 + 3000 + 1800;
    const hourly = computeFare(
      { vehicleClass: 'car', rideType: 'full_car', straightLineKm: 150, route, returnWait: { mode: 'hourly', hours: 3 } },
      settings
    );
    expect(hourly.outbound).toBe(leg);
    expect(hourly.returnLeg).toBe(leg + 3 * 500);
    expect(hourly.subtotal).toBe(2 * leg + 1500);

    const overnight = computeFare(
      { vehicleClass: 'car', rideType: 'full_car', straightLineKm: 150, route, returnWait: { mode: 'overnight', nights: 2 } },
      settings
    );
    expect(overnight.returnLeg).toBe(leg + 2 * 4000);
    expect(overnight.lines.find((l) => l.code === 'overnight')?.label).toBe('Driver stays 2 nights');
  });

  it('prices shared seats as a fraction of the full-car fare, per seat', () => {
    const route = { distanceKm: 200, durationMinutes: 180, tolls: 0, difficultSurcharge: 0, bidEnabled: false };
    const shared = computeFare({ vehicleClass: 'van', rideType: 'shared_seat', seats: 2, straightLineKm: 150, route }, settings);
    // Van full car: (1500 + 3000 + 1800) × 1.8 = 11,340; a seat is 30% = 3,400 (rounded).
    expect(shared.subtotal).toBe(2 * 3400);
    expect(shared.lines).toEqual([{ code: 'shared_seats', label: '2 × shared seat', amount: 6800 }]);
  });

  it('the breakdown always adds up to the fare', () => {
    for (const vehicleClass of ['car', 'suv', 'jeep', 'van', 'coaster'] as const) {
      for (const straightLineKm of [5, 37, 120, 333]) {
        const quote = computeFare({ vehicleClass, rideType: 'full_car', straightLineKm }, settings);
        expect(sum(quote.lines), `${vehicleClass} ${straightLineKm}`).toBe(quote.subtotal);
      }
    }
  });

  it('ignores a price stored on an old route row: the formula is the only source', () => {
    const route = { baseFare: 99999, distanceKm: 60, durationMinutes: 90, tolls: 0, difficultSurcharge: 0, bidEnabled: false };
    expect(computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 40, route }, settings).subtotal).toBe(3300);
  });

  it('never hardcodes a price: a different settings document changes the fare', () => {
    const cheaper = { ...settings, baseFare: 1000, ratePerKm: 10, ratePerMinute: 5 };
    const quote = computeFare({ vehicleClass: 'car', rideType: 'full_car', straightLineKm: 100 }, cheaper);
    expect(quote.subtotal).toBe(1000 + 1300 + 870);
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
