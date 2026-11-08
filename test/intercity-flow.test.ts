import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { Booking } from '../src/models/Booking';
import { IntercitySettings } from '../src/models/IntercitySettings';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { RideRequest } from '../src/models/RideRequest';
import { Trip } from '../src/models/Trip';
import { Vehicle } from '../src/models/Vehicle';
import { applyIntercitySeed } from '../src/seed/intercitySeed';
import { expireOpenRequests } from '../src/services/intercityRequest.service';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';

/** City to City end to end, through the real API. */
describe('City to City rides', () => {
  const app = createApp();
  const previousFlag = env.INTERCITY_ENABLED;

  const ISLAMABAD = { address: 'F-7 Markaz, Islamabad', lat: 33.7215, lng: 73.0433 };
  const GILGIT = { address: 'Jutial, Gilgit', lat: 35.9081, lng: 74.3523 };
  const LAHORE = { address: 'Gulberg, Lahore', lat: 31.5204, lng: 74.3587 };
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

  let cities: Array<{ id: string; name: string }> = [];
  const cityId = (name: string) => cities.find((c) => c.name.startsWith(name))!.id;

  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    env.INTERCITY_ENABLED = previousFlag;
    await teardownTestDb();
  });
  beforeEach(async () => {
    env.INTERCITY_ENABLED = true;
    await clearDatabase();
    await applyIntercitySeed();
    cities = (await authed(app).get('/api/intercity/cities')).body.data;
  });

  async function driver(options: { type?: string; seats?: number; shared?: boolean; home?: string } = {}) {
    const user = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await Vehicle.create({
      providerId: user.providerId,
      name: 'Corolla',
      type: options.type ?? 'car',
      brand: 'Toyota',
      vehicleModel: 'Corolla',
      year: 2020,
      registrationNumber: `ICT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      seatCount: options.seats ?? 4,
      status: 'active',
    });
    const settings = await authed(app, user.token)
      .put('/api/intercity/driver/settings')
      .send({ enabled: true, homeCityId: cityId(options.home ?? 'Islamabad'), acceptsShared: Boolean(options.shared) });
    expect(settings.status).toBe(200);
    return { ...user, vehicleId: vehicle._id.toString() };
  }

  const requestRide = (rider: TestUser, body: Record<string, unknown> = {}) =>
    authed(app, rider.token)
      .post('/api/intercity/requests')
      .send({
        pickup: ISLAMABAD,
        dropoff: GILGIT,
        vehicleClass: 'car',
        rideType: 'full_car',
        passengers: 2,
        journeyType: 'one_way',
        bookNow: false,
        departAt: inHours(24),
        luggage: { bags: 2, large: 1 },
        passengerName: 'Sara Ahmed',
        passengerPhone: '03007654321',
        ...body,
      });

  const feed = async (d: TestUser) => (await authed(app, d.token).get('/api/intercity/driver/requests')).body.data;

  it('is invisible while switched off (env kill switch or settings toggle)', async () => {
    env.INTERCITY_ENABLED = false;
    expect((await authed(app).get('/api/intercity/config')).body.data).toEqual({ enabled: false });
    expect((await authed(app).post('/api/intercity/quote').send({ pickup: ISLAMABAD, dropoff: GILGIT, vehicleClass: 'car', passengers: 1 })).status).toBe(404);

    env.INTERCITY_ENABLED = true;
    await IntercitySettings.updateOne({ key: 'default' }, { enabled: false });
    expect((await authed(app).get('/api/intercity/config')).body.data.enabled).toBe(false);
    const rider = await makeUser(app, 'customer');
    expect((await requestRide(rider)).status).toBe(404);
  });

  it('quotes from the route fare table, detects cities and rejects same-city or unserved pins', async () => {
    const quote = await authed(app)
      .post('/api/intercity/quote')
      .send({ pickup: ISLAMABAD, dropoff: GILGIT, vehicleClass: 'car', passengers: 2 });
    expect(quote.status).toBe(200);
    const config = (await authed(app).get('/api/intercity/config')).body.data;
    expect(config.classes.map((c: { key: string }) => c.key)).toEqual(['car', 'suv', 'jeep', 'van', 'coaster']);
    expect(quote.body.data.fromCity.name).toMatch(/Islamabad/);
    expect(quote.body.data.toCity.name).toBe('Gilgit');
    expect(quote.body.data.source).toBe('route');
    // Seeded placeholder: 18,000 + 600 tolls + 2,000 mountain surcharge.
    expect(quote.body.data.subtotal).toBe(20600);
    expect(quote.body.data.total).toBe(20600 + 2060 + 200);

    const sameCity = await authed(app)
      .post('/api/intercity/quote')
      .send({ pickup: ISLAMABAD, dropoff: { address: 'Saddar, Rawalpindi', lat: 33.5973, lng: 73.0442 }, vehicleClass: 'car', passengers: 1 });
    expect(sameCity.status).toBe(422);

    const nowhere = await authed(app)
      .post('/api/intercity/quote')
      .send({ pickup: ISLAMABAD, dropoff: { address: 'Desert', lat: 28, lng: 66 }, vehicleClass: 'car', passengers: 1 });
    expect(nowhere.status).toBe(422);
  });

  it('full booking: request → matched drivers → counter-offer → rider picks → trip → tracking → completed', async () => {
    const rider = await makeUser(app, 'customer');
    const near = await driver();
    const notOptedIn = await makeUser(app, 'provider', { service: 'transport' });
    const farAway = await driver({ home: 'Lahore' });
    await ProviderProfile.updateOne({ _id: farAway.providerId }, { location: { type: 'Point', coordinates: [LAHORE.lng, LAHORE.lat] } });
    const wrongClass = await driver({ type: 'van', seats: 12 });

    const created = await requestRide(rider);
    expect(created.status).toBe(201);
    const requestId = created.body.data.id;
    expect(created.body.data.quote.subtotal).toBe(20600);

    // Only the opted-in driver near the pickup city, with a car, sees it — clearly labelled.
    const seen = await feed(near);
    expect(seen.requests).toHaveLength(1);
    expect(seen.requests[0]).toMatchObject({ route: expect.stringMatching(/Islamabad.*→ Gilgit/), passengers: 2, luggage: { bags: 2, large: 1 }, fare: 20600 });
    // Exact addresses stay private until the ride is booked.
    expect(JSON.stringify(seen.requests[0])).not.toContain('F-7');
    expect((await authed(app, notOptedIn.token).get('/api/intercity/driver/requests')).status).toBe(200);
    expect((await feed(notOptedIn)).requests).toHaveLength(0);
    expect((await feed(farAway)).requests).toHaveLength(0);
    expect((await feed(wrongClass)).requests).toHaveLength(0);

    // Bid mode is on for this route: the driver counters.
    const counter = await authed(app, near.token)
      .post(`/api/intercity/driver/requests/${requestId}/respond`)
      .send({ action: 'counter', amount: 22000 });
    expect(counter.status).toBe(200);
    const view = (await authed(app, rider.token).get(`/api/intercity/requests/${requestId}`)).body.data;
    expect(view.offers).toHaveLength(1);
    expect(view.offers[0]).toMatchObject({ amount: 22000, kind: 'counter' });

    const chosen = await authed(app, rider.token)
      .post(`/api/intercity/requests/${requestId}/choose`)
      .send({ offerId: view.offers[0].id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.data.status).toBe('matched');
    // The rider now sees the agreed price, not the original quote.
    expect(chosen.body.data.estimate).toEqual({ subtotal: 22000, tax: 2200, serviceFee: 200, total: 24400 });

    // It is now an ordinary, confirmed transport booking on an intercity trip.
    const booking = await Booking.findById(chosen.body.data.bookingId).lean();
    expect(booking).toMatchObject({ bookingType: 'transport', bookingStatus: 'confirmed', subtotal: 22000, tax: 2200, serviceFee: 200 });
    // The breakdown adds up to what is charged: quote lines + the counter-offer difference.
    const lines = (booking as { fareBreakdown?: { lines: Array<{ code: string; amount: number }> } }).fareBreakdown!.lines;
    expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(22000);
    expect(lines.at(-1)).toMatchObject({ code: 'agreed_price', amount: 1400 });
    expect(booking?.transportBooking?.intercity).toMatchObject({ pickupAddress: ISLAMABAD.address, dropoffAddress: GILGIT.address, passengers: 2 });
    const trip = await Trip.findById(booking!.transportBooking!.tripId).lean();
    expect(trip).toMatchObject({ rideType: 'intercity', bookingMode: 'vehicle', status: 'scheduled', availableSeats: 0 });

    // A private whole-car ride never shows up in public trip search.
    const search = await authed(app).get('/api/trips/search').query({ destination: 'Gilgit' });
    expect(search.body.data.items.map((t: { _id: string }) => t._id)).not.toContain(String(trip!._id));

    // Driver's upcoming list; start the trip; buffered points arrive after a signal gap.
    const upcoming = (await feed(near)).upcoming;
    expect(upcoming[0]).toMatchObject({ tripId: String(trip!._id), status: 'scheduled' });
    expect((await authed(app, near.token).put(`/api/intercity/driver/trips/${trip!._id}/status`).send({ status: 'departed' })).status).toBe(200);
    const t0 = Date.now() - 10 * 60_000;
    const batch = await authed(app, near.token)
      .post(`/api/intercity/trips/${trip!._id}/locations`)
      .send({
        points: [
          { lat: 34.9, lng: 73.65, at: new Date(t0 + 120_000).toISOString() },
          { lat: 34.8, lng: 73.6, at: new Date(t0).toISOString() },
          { lat: 35.0, lng: 73.7, at: new Date(t0 + 240_000).toISOString() },
        ],
      });
    expect(batch.body.data.accepted).toBe(3);
    // An older batch arriving late never moves the car backwards.
    await authed(app, near.token)
      .post(`/api/intercity/trips/${trip!._id}/locations`)
      .send({ points: [{ lat: 34.0, lng: 73.0, at: new Date(t0 - 60_000).toISOString() }] });
    const location = await authed(app, rider.token).get(`/api/intercity/trips/${trip!._id}/location`);
    expect(location.body.data.lastLocation).toMatchObject({ lat: 35.0, lng: 73.7 });
    // A stranger can't see it.
    const stranger = await makeUser(app, 'customer');
    expect((await authed(app, stranger.token).get(`/api/intercity/trips/${trip!._id}/location`)).status).toBe(404);

    expect((await authed(app, near.token).put(`/api/intercity/driver/trips/${trip!._id}/status`).send({ status: 'completed' })).status).toBe(200);
    expect((await Booking.findById(booking!._id).lean())?.bookingStatus).toBe('completed');
  });

  it('enforces the lead time and the lowest rider offer', async () => {
    const rider = await makeUser(app, 'customer');
    const tooSoon = await requestRide(rider, { departAt: inHours(1) });
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body.message).toMatch(/120 minutes/);
    expect((await requestRide(rider, { bookNow: true, departAt: undefined })).status).toBe(201);

    const lowball = await requestRide(rider, { offerAmount: 5000 });
    expect(lowball.status).toBe(422);
    expect((await requestRide(rider, { offerAmount: 16000 })).status).toBe(201);
    // No bidding on a route that doesn't allow it (Islamabad → Lahore).
    expect((await requestRide(rider, { dropoff: LAHORE, offerAmount: 9000 })).status).toBe(422);
  });

  it('round trip: linked return leg priced with waiting; cancelling one leg cancels both', async () => {
    const rider = await makeUser(app, 'customer');
    const d = await driver();
    const created = await requestRide(rider, {
      journeyType: 'round_trip',
      returnTrip: { departAt: inHours(30), waitMode: 'hourly', waitHours: 4 },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.quote.returnLeg).toBe(20600 + 4 * 500);
    const id = created.body.data.id;
    await authed(app, d.token).post(`/api/intercity/driver/requests/${id}/respond`).send({ action: 'accept' });
    const offerId = (await authed(app, rider.token).get(`/api/intercity/requests/${id}`)).body.data.offers[0].id;
    const chosen = (await authed(app, rider.token).post(`/api/intercity/requests/${id}/choose`).send({ offerId })).body.data;

    const outbound = await Booking.findById(chosen.bookingId).lean();
    const back = await Booking.findById(chosen.returnBookingId).lean();
    expect(outbound?.subtotal).toBe(20600);
    expect(back?.subtotal).toBe(20600 + 2000);
    expect(String(outbound?.returnBookingId)).toBe(chosen.returnBookingId);
    expect(String(back?.outboundBookingId)).toBe(chosen.bookingId);
    const backTrip = await Trip.findById(back!.transportBooking!.tripId).lean();
    expect(backTrip).toMatchObject({ origin: 'Gilgit', destination: expect.stringMatching(/Islamabad/), rideType: 'intercity' });
    expect(backTrip?.intercity?.leg).toBe('return');

    // Rider cancels a day ahead: free, and the return leg goes too.
    expect((await authed(app, rider.token).put(`/api/bookings/${chosen.bookingId}/cancel`)).status).toBe(200);
    expect(await Booking.findById(chosen.bookingId).lean()).toMatchObject({ bookingStatus: 'cancelled', lateCancellation: false, cancellationReason: 'rider_cancelled' });
    expect((await Booking.findById(chosen.returnBookingId).lean())?.bookingStatus).toBe('cancelled');
  });

  it('records a late rider cancellation, allows a no-show only after the wait, and re-matches when a driver cancels', async () => {
    const rider = await makeUser(app, 'customer');
    const first = await driver();
    const second = await driver();

    const book = async () => {
      const id = (await requestRide(rider)).body.data.id;
      await authed(app, first.token).post(`/api/intercity/driver/requests/${id}/respond`).send({ action: 'accept' });
      const offerId = (await authed(app, rider.token).get(`/api/intercity/requests/${id}`)).body.data.offers[0].id;
      const chosen = (await authed(app, rider.token).post(`/api/intercity/requests/${id}/choose`).send({ offerId })).body.data;
      return { id, bookingId: chosen.bookingId as string };
    };

    // Late: the ride leaves in an hour (inside the 3-hour free window).
    const late = await book();
    const lateTrip = (await Booking.findById(late.bookingId).lean())!.transportBooking!.tripId;
    await Trip.updateOne({ _id: lateTrip }, { 'intercity.departAt': new Date(Date.now() + 60 * 60_000) });
    await authed(app, rider.token).put(`/api/bookings/${late.bookingId}/cancel`);
    expect((await Booking.findById(late.bookingId).lean())?.lateCancellation).toBe(true);

    // No-show: refused before pickup time + 30 min, allowed after.
    const ns = await book();
    const nsTrip = (await Booking.findById(ns.bookingId).lean())!.transportBooking!.tripId;
    await Trip.updateOne({ _id: nsTrip }, { 'intercity.departAt': new Date(Date.now() - 10 * 60_000) });
    expect((await authed(app, first.token).post(`/api/intercity/driver/bookings/${ns.bookingId}/no-show`)).status).toBe(409);
    await Trip.updateOne({ _id: nsTrip }, { 'intercity.departAt': new Date(Date.now() - 40 * 60_000) });
    expect((await authed(app, first.token).post(`/api/intercity/driver/bookings/${ns.bookingId}/no-show`)).status).toBe(200);
    expect((await Booking.findById(ns.bookingId).lean())?.cancellationReason).toBe('no_show');

    // Driver cancels a booked ride: the request reopens for other drivers, not for them.
    const rm = await book();
    expect((await authed(app, first.token).put(`/api/providers/bookings/${rm.bookingId}/status`).send({ status: 'cancelled' })).status).toBe(200);
    const reopened = await RideRequest.findById(rm.id).lean();
    expect(reopened?.status).toBe('open');
    expect(reopened?.excludedProviderIds.map(String)).toContain(first.providerId);
    expect((await feed(first)).requests.map((r: { id: string }) => r.id)).not.toContain(rm.id);
    expect((await feed(second)).requests.map((r: { id: string }) => r.id)).toContain(rm.id);
  });

  it('shared rides group riders on one vehicle without exceeding its seats', async () => {
    const d = await driver({ type: 'van', seats: 4, shared: true });
    const ask = (rider: TestUser, passengers: number) =>
      requestRide(rider, { rideType: 'shared_seat', vehicleClass: 'van', passengers, departAt: inHours(24) });

    // First rider: a driver accepts, which opens a 4-seat shared trip with 2 seats taken.
    const a = await makeUser(app, 'customer');
    const aReq = (await ask(a, 2)).body.data;
    expect(aReq.quote.lines[0].code).toBe('shared_seats');
    await authed(app, d.token).post(`/api/intercity/driver/requests/${aReq.id}/respond`).send({ action: 'accept' });
    const offerId = (await authed(app, a.token).get(`/api/intercity/requests/${aReq.id}`)).body.data.offers[0].id;
    const aBooked = (await authed(app, a.token).post(`/api/intercity/requests/${aReq.id}/choose`).send({ offerId })).body.data;
    const sharedTrip = await Trip.findById((await Booking.findById(aBooked.bookingId).lean())!.transportBooking!.tripId).lean();
    expect(sharedTrip).toMatchObject({ bookingMode: 'seat', availableSeats: 2, totalSeats: 4 });

    // Two more riders want the last 2 seats at the same moment: only one gets them.
    const b = await makeUser(app, 'customer');
    const c = await makeUser(app, 'customer');
    const bReq = (await ask(b, 2)).body.data;
    const cReq = (await ask(c, 2)).body.data;
    const options = (await authed(app, b.token).get(`/api/intercity/requests/${bReq.id}/shared-trips`)).body.data;
    expect(options.map((t: { tripId: string }) => t.tripId)).toContain(String(sharedTrip!._id));
    const [bJoin, cJoin] = await Promise.all([
      authed(app, b.token).post(`/api/intercity/requests/${bReq.id}/join`).send({ tripId: String(sharedTrip!._id) }),
      authed(app, c.token).post(`/api/intercity/requests/${cReq.id}/join`).send({ tripId: String(sharedTrip!._id) }),
    ]);
    expect([bJoin.status, cJoin.status].sort(), JSON.stringify([bJoin.body, cJoin.body])).toEqual([200, 409]);
    const after = await Trip.findById(sharedTrip!._id).lean();
    expect(after?.availableSeats).toBe(0);
    expect(after?.seatLayout.filter((s) => s.status !== 'available')).toHaveLength(4);
    // The loser's request is still open for drivers.
    const loser = bJoin.status === 409 ? bReq.id : cReq.id;
    expect((await RideRequest.findById(loser).lean())?.status).toBe('open');

    // A full trip is no longer offered.
    const d2 = await makeUser(app, 'customer');
    const dReq = (await ask(d2, 1)).body.data;
    expect((await authed(app, d2.token).get(`/api/intercity/requests/${dReq.id}/shared-trips`)).body.data).toHaveLength(0);
  });

  it('expires requests nobody took', async () => {
    const rider = await makeUser(app, 'customer');
    const id = (await requestRide(rider, { bookNow: true, departAt: undefined })).body.data.id;
    await RideRequest.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await expireOpenRequests()).toBe(1);
    expect((await RideRequest.findById(id).lean())?.status).toBe('expired');
  });

  /** Puts a driver's registered location at a point (km away from the F-7 pickup). */
  const placeDriver = (d: { providerId?: string }, lat: number, lng: number) =>
    ProviderProfile.updateOne({ _id: d.providerId }, { location: { type: 'Point', coordinates: [lng, lat] } });
  // From F-7 Islamabad: Saddar Rawalpindi ≈ 14 km, Taxila ≈ 24 km, Murree ≈ 40 km.
  const RAWALPINDI = [33.5973, 73.0442] as const;
  const MURREE = [33.9076, 73.3943] as const;

  it('the map widens 10 → 20 → 30 → 50 km until it finds drivers or listed rides', async () => {
    const d = await driver();
    await placeDriver(d, ...RAWALPINDI);
    const auto = (await authed(app).get('/api/intercity/nearby').query({ lat: ISLAMABAD.lat, lng: ISLAMABAD.lng })).body.data;
    expect(auto).toMatchObject({ radiusKm: 20, widened: true, steps: [10, 20, 30, 50], nextRadiusKm: 30 });
    expect(auto.drivers).toHaveLength(1);
    // Rounded to ~1 km: never the driver's exact pin.
    expect(auto.drivers[0]).toMatchObject({ approxLat: 33.6, approxLng: 73.04, vehicles: [{ class: 'car', seats: 4 }] });
    expect(auto.drivers[0].distanceKm).toBeGreaterThan(10);

    // A chosen radius is respected (nothing within 10 km).
    const ten = (await authed(app).get('/api/intercity/nearby').query({ lat: ISLAMABAD.lat, lng: ISLAMABAD.lng, radiusKm: 10 })).body.data;
    expect(ten).toMatchObject({ radiusKm: 10, widened: false, drivers: [], rides: [] });
    // Class filter.
    expect((await authed(app).get('/api/intercity/nearby').query({ lat: ISLAMABAD.lat, lng: ISLAMABAD.lng, vehicleClass: 'van' })).body.data.drivers).toHaveLength(0);

    // Listed (published) rides boarding nearby show up too.
    const owner = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await Vehicle.create({
      providerId: owner.providerId, name: 'Hiace', type: 'van', brand: 'Toyota', vehicleModel: 'Hiace', year: 2021,
      registrationNumber: `LIST-${Date.now()}`, seatCount: 12, status: 'active',
    });
    await Trip.create({
      providerId: owner.providerId, vehicleId: vehicle._id, origin: 'Islamabad', destination: 'Gilgit',
      originLat: 33.7, originLng: 73.05, departureDate: '2099-01-01', departureTime: '06:00', price: 4500,
      totalSeats: 12, availableSeats: 12, seatLayout: [],
    });
    const withRide = (await authed(app).get('/api/intercity/nearby').query({ lat: ISLAMABAD.lat, lng: ISLAMABAD.lng })).body.data;
    expect(withRide.radiusKm).toBe(10);
    expect(withRide.rides[0]).toMatchObject({ route: 'Islamabad → Gilgit', price: 4500, seatsLeft: 12 });
  });

  it('a request starts at the smallest radius with a driver and the rider can search wider', async () => {
    const rider = await makeUser(app, 'customer');
    const near = await driver();
    const far = await driver();
    await placeDriver(far, ...MURREE);

    const req = (await requestRide(rider)).body.data;
    expect(req).toMatchObject({ searchRadiusKm: 10, nextRadiusKm: 20 });
    expect((await feed(near)).requests).toHaveLength(1);
    expect((await feed(far)).requests).toHaveLength(0);

    for (const step of [20, 30, 50]) {
      const widened = await authed(app, rider.token).post(`/api/intercity/requests/${req.id}/widen`);
      expect(widened.body.data.searchRadiusKm).toBe(step);
    }
    // At 50 km the Murree driver (≈ 40 km away) gets it.
    expect((await feed(far)).requests.map((r: { id: string }) => r.id)).toContain(req.id);
    const tooFar = await authed(app, rider.token).post(`/api/intercity/requests/${req.id}/widen`);
    expect(tooFar.status).toBe(409);
    expect(tooFar.body.message).toMatch(/widest area \(50 km\)/);
  });

  it('with nobody near, a request opens at the first radius that reaches a driver', async () => {
    const rider = await makeUser(app, 'customer');
    const d = await driver();
    await placeDriver(d, ...RAWALPINDI);
    expect((await requestRide(rider)).body.data.searchRadiusKm).toBe(20);
  });

  it('settings saved before a field existed fall back to its default', async () => {
    // An older settings document without radiusStepsKm (written straight to the collection).
    await IntercitySettings.collection.updateOne({ key: 'default' }, { $unset: { radiusStepsKm: '' } });
    const n = (await authed(app).get('/api/intercity/nearby').query({ lat: ISLAMABAD.lat, lng: ISLAMABAD.lng })).body.data;
    expect(n.steps).toEqual([10, 20, 30, 50]);
  });
});
