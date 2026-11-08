import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { buildDemoCatalog } from '../src/seed/demoCatalog';
import { applyDemoCatalog } from '../src/seed/demoDatabase';
import { applyRefine, discoverOptions, sanitizeRefine } from '../src/discover/refine';
import { matchesCategory, residenceClassOf, vehicleClassOf } from '../src/discover/categories';
import type { DiscoverCard } from '../src/discover/types';
import { setupTestDb, teardownTestDb } from './helpers/db';

const card = (id: string, patch: Partial<DiscoverCard> = {}): DiscoverCard => ({
  id,
  service: 'hotels',
  title: id,
  subtitle: '',
  city: '',
  image: null,
  price: 1000,
  priceUnit: 'per night',
  rating: 4,
  reviewCount: 1,
  verified: false,
  tags: [],
  target: { type: 'hotel', id },
  ...patch,
});
const ids = (cards: DiscoverCard[]) => cards.map((c) => c.id);

describe('discover refine rules', () => {
  const hotels = [
    card('a', { price: 9000, rating: 4.8, verified: true, freeCancellation: true }),
    card('b', { price: 4000, rating: 3.9, verified: false, breakfastIncluded: true }),
    card('c', { price: 6000, rating: 4.2, verified: true }),
  ];

  it('sorts by price and rating without mutating the input', () => {
    const copy = [...hotels];
    expect(ids(applyRefine(hotels, 'price', []))).toEqual(['b', 'c', 'a']);
    expect(ids(applyRefine(hotels, 'rating', []))).toEqual(['a', 'c', 'b']);
    expect(hotels).toEqual(copy);
  });

  it('combines toggles as AND filters and keeps recommended order', () => {
    expect(ids(applyRefine(hotels, 'recommended', ['topRated', 'verified']))).toEqual(['a', 'c']);
    expect(ids(applyRefine(hotels, 'recommended', ['freeCancel', 'verified']))).toEqual(['a']);
    expect(ids(applyRefine(hotels, 'recommended', ['breakfast']))).toEqual(['b']);
    expect(ids(applyRefine(hotels, 'recommended', []))).toEqual(['a', 'b', 'c']);
  });

  it('sorts transport by departure time and treats missing ratings as 0', () => {
    const trips = [
      card('t1', { departsAt: '2026-11-05T09:00' }),
      card('t2', { departsAt: '2026-11-06T07:00' }),
      card('t3', { departsAt: '2026-11-05T06:00' }),
    ];
    expect(ids(applyRefine(trips, 'soonest', []))).toEqual(['t3', 't1', 't2']);
    const rated = [card('x', { rating: null }), card('y', { rating: 4.5 })];
    expect(ids(applyRefine(rated, 'rating', []))).toEqual(['y', 'x']);
    expect(ids(applyRefine(rated, 'recommended', ['topRated']))).toEqual(['y']);
  });

  it('only offers each service its own chips; tours offer none', () => {
    expect(discoverOptions('tours')).toEqual({ sorts: [], toggles: [] });
    expect(discoverOptions('hotels')!.toggles.map((t) => t.id)).toContain('freeCancel');
    expect(discoverOptions('guides')!.toggles.map((t) => t.id)).not.toContain('freeCancel');
    expect(sanitizeRefine('guides', 'price', ['freeCancel', 'topRated'])).toEqual({
      order: 'recommended',
      only: ['topRated'],
    });
    expect(sanitizeRefine('tours', 'price', ['verified'])).toEqual({ order: 'recommended', only: [] });
    expect(sanitizeRefine('hotels', 'nonsense', ['bogus'])).toEqual({ order: 'recommended', only: [] });
  });
});

describe('discover categories', () => {
  it('maps vehicle classes like the apps did', () => {
    expect(vehicleClassOf('minibus')).toBe('mini_bus');
    expect(vehicleClassOf('Mini-Bus')).toBe('mini_bus');
    expect(vehicleClassOf('private')).toBe('car');
    expect(vehicleClassOf(undefined, 'jeep')).toBe('jeep');
    expect(vehicleClassOf('', 'coaster')).toBe('other');
    expect(vehicleClassOf('suv', 'van')).toBe('suv');
  });
  it('maps hotel types to residence classes', () => {
    expect(residenceClassOf('guestHouse')).toBe('guest_house');
    expect(residenceClassOf('lodge')).toBe('lodge');
    expect(residenceClassOf('homestay')).toBe('lodge');
    expect(residenceClassOf('resort')).toBe('hotel');
  });
  it('keeps guides without a stated gender under every gender', () => {
    const guide = card('g', { service: 'guides', category: undefined });
    expect(matchesCategory(guide, 'female')).toBe(true);
    expect(matchesCategory(card('h', { service: 'hotels', category: 'lodge' }), 'hotel')).toBe(false);
    expect(matchesCategory(card('h', { category: 'lodge' }), null)).toBe(true);
  });
});

describe('GET /api/discover', () => {
  const app = createApp();
  beforeAll(async () => {
    await setupTestDb();
    const plan = buildDemoCatalog({
      now: new Date(),
      passwordHash: await bcrypt.hash('Discover-test-password!', 4),
      image: (user, folder, photo) => `https://images.example.test/${folder}/${user}/${photo}.jpg`,
    });
    await applyDemoCatalog(plan);
  });
  afterAll(teardownTestDb);

  const get = (query: Record<string, string | number>) => request(app).get('/api/discover').query(query);

  it('returns normalized cards plus the chip options for every service', async () => {
    for (const service of ['transport', 'hotels', 'tours', 'guides', 'restaurants']) {
      const res = await get({ service });
      expect(res.status, service).toBe(200);
      const data = res.body.data;
      expect(data.service).toBe(service);
      expect(data.total).toBeGreaterThanOrEqual(data.items.length);
      expect(data.items.length, `${service} should have demo listings`).toBeGreaterThan(0);
      for (const item of data.items) {
        expect(item).toMatchObject({ id: expect.any(String), service, title: expect.any(String) });
        expect(item.target.id).toBeTruthy();
      }
      // ids become React keys on the web, so they must be real, unique strings
      const itemIds: string[] = data.items.map((item: DiscoverCard) => item.id);
      expect(itemIds.every((id) => /^[0-9a-f]{24}$/.test(id)), `${service} ids`).toBe(true);
      expect(new Set(itemIds).size, `${service} ids unique`).toBe(itemIds.length);
      if (service === 'tours') expect(data.options.sorts).toEqual([]);
      else expect(data.options.sorts.length).toBeGreaterThan(1);
      if (service === 'restaurants') expect(data.options.categories).toEqual([]);
      else expect(data.options.categories.length, `${service} categories`).toBeGreaterThan(0);
    }
  });

  it('defaults to transport and rejects unknown services', async () => {
    expect((await get({})).body.data.service).toBe('transport');
    expect((await get({ service: 'spaceships' })).status).toBe(422);
  });

  it('applies cheapest ordering and the verified filter to hotels', async () => {
    const cheap = await get({ service: 'hotels', order: 'price' });
    const prices: number[] = cheap.body.data.items.map((i: DiscoverCard) => i.price ?? 0);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(cheap.body.data.applied.order).toBe('price');

    const verified = await get({ service: 'hotels', only: 'verified' });
    expect(verified.body.data.items.every((i: DiscoverCard) => i.verified)).toBe(true);
  });

  it('ignores options a service does not offer instead of failing', async () => {
    const res = await get({ service: 'guides', order: 'price', only: 'freeCancel,topRated' });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toEqual({ order: 'recommended', only: ['topRated'], category: null });
  });

  it('lists only future, bookable trips, one per vehicle', async () => {
    const res = await get({ service: 'transport', order: 'soonest' });
    const items: DiscoverCard[] = res.body.data.items;
    const departures = items.map((i) => i.departsAt ?? '');
    expect(departures).toEqual([...departures].sort());
    expect(items.every((i) => Date.parse(`${i.departsAt}:00+05:00`) > Date.now())).toBe(true);
    expect(items.every((i) => (i.price ?? 0) > 0)).toBe(true);
  });

  it('filters by category and ignores unknown ones', async () => {
    const all = await get({ service: 'hotels' });
    const categories: Array<{ id: string }> = all.body.data.options.categories;
    expect(categories.length).toBeGreaterThan(0);
    for (const { id } of categories) {
      const res = await get({ service: 'hotels', category: id });
      expect(res.body.data.items.length).toBeGreaterThan(0);
      expect(res.body.data.items.every((i: DiscoverCard) => i.category === id)).toBe(true);
      expect(res.body.data.applied.category).toBe(id);
      // every chip stays visible while one is selected
      expect(res.body.data.options.categories).toEqual(categories);
    }
    const bogus = await get({ service: 'hotels', category: 'spaceship' });
    expect(bogus.body.data.applied.category).toBeNull();
    expect(bogus.body.data.total).toBe(all.body.data.total);
  });

  it('classifies transport by vehicle class and tours by tour type', async () => {
    const transport = await get({ service: 'transport' });
    expect(transport.body.data.items.every((i: DiscoverCard) => !!i.category)).toBe(true);
    const tours = await get({ service: 'tours' });
    const types: Array<{ id: string }> = tours.body.data.options.categories;
    expect(types.length).toBeGreaterThan(0);
    const one = await get({ service: 'tours', category: types[0].id });
    expect(one.body.data.items.every((i: DiscoverCard) => i.category === types[0].id)).toBe(true);
  });

  it('narrows transport by route, date, party size and booking mode', async () => {
    const all = await get({ service: 'transport', limit: 100 });
    const sample: DiscoverCard = all.body.data.items[0];
    const [origin, destination] = sample.tags[0].split(' → ');
    const date = (sample.departsAt as string).slice(0, 10);

    const hit = await get({ service: 'transport', from: origin, to: destination, date, passengers: 1 });
    expect(hit.status).toBe(200);
    expect(hit.body.data.items.map((i: DiscoverCard) => i.id)).toContain(sample.id);
    expect(
      hit.body.data.items.every((i: DiscoverCard) => i.tags[0].startsWith(origin) && i.departsAt!.startsWith(date))
    ).toBe(true);

    expect((await get({ service: 'transport', from: 'Atlantis' })).body.data.total).toBe(0);
    expect((await get({ service: 'transport', passengers: 100 })).body.data.total).toBe(0);
    // a date in the past never matches
    expect((await get({ service: 'transport', date: '2020-01-01' })).body.data.total).toBe(0);
    const seat = await get({ service: 'transport', bookingMode: 'seat' });
    const vehicle = await get({ service: 'transport', bookingMode: 'vehicle' });
    expect(seat.body.data.total + vehicle.body.data.total).toBe(all.body.data.total);
  });

  it('drops malformed search constraints instead of failing', async () => {
    const res = await get({
      service: 'transport',
      date: '2026-13-45',
      returnDate: 'tomorrow',
      passengers: 'many',
      bookingMode: 'teleport',
      checkIn: 'x',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe((await get({ service: 'transport' })).body.data.total);
  });

  it('checks stay availability for dated hotel searches', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const undated = await get({ service: 'hotels', limit: 100 });
    const dated = await get({ service: 'hotels', checkIn: day(5), checkOut: day(7), adults: 2, rooms: 1, limit: 100 });
    expect(dated.status).toBe(200);
    const known = new Set(undated.body.data.items.map((i: DiscoverCard) => i.id));
    expect(dated.body.data.items.every((i: DiscoverCard) => known.has(i.id))).toBe(true);
    // check-out before check-in cannot be satisfied
    const reversed = await get({ service: 'hotels', checkIn: day(7), checkOut: day(5) });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.total).toBe(0);
  });

  it('returns map pins with addresses for every service', async () => {
    for (const service of ['transport', 'hotels', 'tours', 'guides', 'restaurants']) {
      const res = await get({ service, view: 'map', limit: 100 });
      expect(res.status, service).toBe(200);
      const items: DiscoverCard[] = res.body.data.items;
      expect(items.length, `${service} pins`).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.location, `${service} ${item.title}`).toBeTruthy();
        expect(Math.abs(item.location!.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(item.location!.lng)).toBeLessThanOrEqual(180);
        expect(item.location!.address.length).toBeGreaterThan(0);
      }
      const [[south, west], [north, east]] = res.body.data.bounds;
      expect(items.every((i) => i.location!.lat >= south && i.location!.lat <= north)).toBe(true);
      expect(items.every((i) => i.location!.lng >= west && i.location!.lng <= east)).toBe(true);
    }
    // list view carries no bounds
    expect((await get({ service: 'hotels' })).body.data.bounds).toBeNull();
  });

  it('blurs guide locations to an area and never exposes an address', async () => {
    const res = await get({ service: 'guides', view: 'map' });
    for (const guide of res.body.data.items as DiscoverCard[]) {
      expect(guide.location!.approximate).toBe(true);
      expect(guide.location!.address).toMatch(/approximate area/);
      // two decimals ≈ 1 km grid
      expect(Math.round(guide.location!.lat * 100) / 100).toBe(guide.location!.lat);
      expect(Math.round(guide.location!.lng * 100) / 100).toBe(guide.location!.lng);
    }
  });

  it('draws a route for rides and keeps map filters identical to the list', async () => {
    const list = await get({ service: 'transport', only: 'verified', limit: 100 });
    const map = await get({ service: 'transport', only: 'verified', view: 'map', limit: 100 });
    expect(map.body.data.items.map((i: DiscoverCard) => i.id).sort()).toEqual(
      list.body.data.items.filter((i: DiscoverCard) => i.location).map((i: DiscoverCard) => i.id).sort()
    );
    const withRoute = map.body.data.items.filter((i: DiscoverCard) => i.route);
    expect(withRoute.length).toBeGreaterThan(0);
    expect(withRoute[0].route.from.name).toBeTruthy();
    expect(withRoute[0].route.to.lat).toEqual(expect.any(Number));
  });

  it('restricts pins to the map viewport and ignores a malformed one', async () => {
    const all = await get({ service: 'hotels', view: 'map' });
    const north = all.body.data.items.filter((i: DiscoverCard) => i.location!.lat > 36);
    expect(north.length).toBeGreaterThan(0);
    expect(north.length).toBeLessThan(all.body.data.items.length);
    const box = await get({ service: 'hotels', view: 'map', bbox: '70,36,80,37' });
    expect(box.body.data.items.map((i: DiscoverCard) => i.id).sort()).toEqual(
      north.map((i: DiscoverCard) => i.id).sort()
    );
    const empty = await get({ service: 'hotels', view: 'map', bbox: '0,0,1,1' });
    expect(empty.body.data.total).toBe(0);
    expect(empty.body.data.bounds).toBeNull();
    for (const bad of ['nonsense', '1,2,3', '10,50,20,40', '-200,0,0,0']) {
      const res = await get({ service: 'hotels', view: 'map', bbox: bad });
      expect(res.status, bad).toBe(200);
      expect(res.body.data.total, bad).toBe(all.body.data.total);
    }
  });

  it('finds listings near the visitor within a radius, nearest first', async () => {
    const all = await get({ service: 'transport', view: 'map', limit: 300 });
    expect(all.body.data.near).toBeNull();
    const pin = all.body.data.items[0].location;
    const near = `${pin.lat},${pin.lng}`;

    const close = await get({ service: 'transport', view: 'map', near, limit: 300 });
    expect(close.status).toBe(200);
    expect(close.body.data.near).toEqual({ lat: pin.lat, lng: pin.lng, radiusKm: 10 });
    const items: DiscoverCard[] = close.body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => typeof i.distanceKm === 'number' && i.distanceKm <= 10)).toBe(true);
    const distances = items.map((i) => i.distanceKm!);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(items[0].distanceKm).toBe(0);

    // A wider radius never returns fewer rides; the radius is clamped to 1–50 km.
    const wide = await get({ service: 'transport', view: 'map', near, radius: 20, limit: 300 });
    expect(wide.body.data.near.radiusKm).toBe(20);
    expect(wide.body.data.total).toBeGreaterThanOrEqual(close.body.data.total);
    const clamped = await get({ service: 'transport', near, radius: 999 });
    expect(clamped.body.data.near.radiusKm).toBe(10);

    // Somewhere with no listings at all (mid-Atlantic) is an empty result, not an error.
    const nowhere = await get({ service: 'transport', near: '0,-30' });
    expect(nowhere.body.data.total).toBe(0);
    for (const bad of ['nonsense', '91,0', '1,2,3']) {
      const res = await get({ service: 'transport', near: bad });
      expect(res.status, bad).toBe(200);
      expect(res.body.data.near, bad).toBeNull();
    }
  });

  it('treats search text literally and respects the limit', async () => {
    const res = await get({ service: 'hotels', q: '(a+)+$', limit: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    const limited = await get({ service: 'hotels', limit: 1 });
    expect(limited.body.data.items.length).toBeLessThanOrEqual(1);
    expect(limited.body.data.total).toBeGreaterThanOrEqual(limited.body.data.items.length);
  });
});
