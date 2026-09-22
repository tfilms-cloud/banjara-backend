import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Trip } from '../src/models/Trip';
import { Vehicle } from '../src/models/Vehicle';
import { Booking } from '../src/models/Booking';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';
import { recomputeTripSeatCounters } from '../src/services/booking.service';

async function makeTripFixture(app: ReturnType<typeof createApp>) {
  const customer = await makeUser(app, 'customer');
  const provider = await makeUser(app, 'provider', { service: 'transport' });
  const vehicle = await Vehicle.create({
    providerId: provider.providerId,
    name: `Bus ${Date.now()}`,
    type: 'bus',
    brand: 'Hino',
    vehicleModel: 'AK',
    year: 2021,
    registrationNumber: `REG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    seatCount: 10,
    status: 'active',
  });
  const res = await authed(app, provider.token).post('/api/trips').send({
    vehicleId: vehicle._id.toString(),
    origin: 'Islamabad',
    destination: 'Gilgit',
    departureDate: '2030-01-01',
    departureTime: '08:00',
    price: 5000,
  });
  if (res.status !== 201) throw new Error(`trip create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { customer, provider, tripId: res.body.data._id as string };
}

function bookingBody(tripId: string, seats: string[], passengerCount = seats.length) {
  return {
    bookingType: 'transport',
    paymentMethod: 'card',
    transportBooking: {
      tripId,
      seats,
      passengerDetails: Array.from({ length: passengerCount }, (_, i) => ({
        name: `Passenger ${i + 1}`,
        phone: '+920000000001',
      })),
    },
  };
}

describe('Phase 3.1 — atomic seat reservation', () => {
  const app = createApp();

  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await clearDatabase();
  });

  it('allows exactly one of many simultaneous bookings for the same seat', async () => {
    const { customer, tripId } = await makeTripFixture(app);
    const N = 12;

    const attempts = Array.from({ length: N }, (_, i) =>
      authed(app, customer.token)
        .post('/api/bookings')
        .send(bookingBody(tripId, ['A1'], 1))
    );

    const results = await Promise.allSettled(attempts);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
    const successes = statuses.filter((s) => s === 201).length;
    const conflicts = statuses.filter((s) => s === 409).length;

    expect(successes).toBe(1);
    expect(conflicts).toBe(N - 1);

    const trip = await Trip.findById(tripId);
    const a1 = trip!.seatLayout.filter((s) => s.seatNumber === 'A1');
    expect(a1).toHaveLength(1);
    expect(a1[0].status).toBe('booked');
    expect(trip!.availableSeats).toBe(9);
    expect(trip!.bookedSeats).toBe(1);

    const bookings = await Booking.find({ 'transportBooking.tripId': tripId });
    expect(bookings).toHaveLength(1);

    // Counters must be consistent with seatLayout (no drift after the race).
    const repaired = await recomputeTripSeatCounters(tripId);
    expect(repaired.availableSeats).toBe(9);
    expect(repaired.bookedSeats).toBe(1);
  });

  it('fails the whole request and reserves nothing when one seat is taken', async () => {
    const { customer, tripId } = await makeTripFixture(app);

    const first = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['A1'], 1));
    expect(first.status).toBe(201);

    const res = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['A2', 'A1'], 2));
    expect(res.status).toBe(409);

    const trip = await Trip.findById(tripId);
    const a2 = trip!.seatLayout.find((s) => s.seatNumber === 'A2');
    expect(a2?.status).toBe('available');
    expect(trip!.availableSeats).toBe(9);
  });

  it('rejects duplicate seat numbers at the validator', async () => {
    const { customer, tripId } = await makeTripFixture(app);
    const res = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['A1', 'A1'], 2));
    expect(res.status).toBe(422);
  });

  it('rejects a passenger count that does not match the seat count', async () => {
    const { customer, tripId } = await makeTripFixture(app);
    const res = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['A1', 'A2'], 1));
    expect(res.status).toBe(422);
  });

  it('rejects a non-existent seat and leaves counters unchanged', async () => {
    const { customer, tripId } = await makeTripFixture(app);
    const res = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['Z9'], 1));
    expect(res.status).toBe(400);

    const trip = await Trip.findById(tripId);
    expect(trip!.availableSeats).toBe(10);
    expect(trip!.bookedSeats).toBe(0);
  });

  it('rejects booking on a cancelled trip', async () => {
    const { customer, provider, tripId } = await makeTripFixture(app);
    await authed(app, provider.token).delete(`/api/trips/${tripId}`);

    const res = await authed(app, customer.token)
      .post('/api/bookings')
      .send(bookingBody(tripId, ['A1'], 1));
    expect(res.status).toBe(400);
  });
});
