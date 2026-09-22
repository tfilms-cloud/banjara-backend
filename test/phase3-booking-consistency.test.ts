import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Trip } from '../src/models/Trip';
import { Vehicle } from '../src/models/Vehicle';
import { Payment } from '../src/models/Payment';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';
import { isReplicaSetHello, supportsTransactions } from '../src/config/database';

async function makePaidTransportBooking(app: ReturnType<typeof createApp>) {
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
  const tripRes = await authed(app, provider.token).post('/api/trips').send({
    vehicleId: vehicle._id.toString(),
    origin: 'Islamabad',
    destination: 'Gilgit',
    departureDate: '2030-01-01',
    departureTime: '08:00',
    price: 5000,
  });
  const tripId = tripRes.body.data._id as string;

  const bookingRes = await authed(app, customer.token).post('/api/bookings').send({
    bookingType: 'transport',
    paymentMethod: 'card',
    transportBooking: {
      tripId,
      seats: ['A1'],
      passengerDetails: [{ name: 'Passenger One', phone: '+920000000001' }],
    },
  });
  if (bookingRes.status !== 201) {
    throw new Error(`booking create failed: ${bookingRes.status} ${JSON.stringify(bookingRes.body)}`);
  }
  return { customer, provider, tripId, bookingId: bookingRes.body.data._id as string };
}

describe('Phase 3.3 — booking flow consistency / idempotency', () => {
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

  it('is idempotent when a cancellation is retried concurrently', async () => {
    const { customer, tripId, bookingId } = await makePaidTransportBooking(app);

    const attempts = Array.from({ length: 8 }, () =>
      authed(app, customer.token).put(`/api/bookings/${bookingId}/cancel`)
    );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);

    expect(statuses.every((status) => status === 200)).toBe(true);

    const trip = await Trip.findById(tripId);
    expect(trip!.availableSeats).toBe(10);
    expect(trip!.bookedSeats).toBe(0);

    const payment = await Payment.findOne({ bookingId });
    expect(payment?.status).toBe('refunded');
  });

  it('detects a replica set from the hello response', () => {
    expect(isReplicaSetHello({ setName: 'rs0' })).toBe(true);
    expect(isReplicaSetHello({})).toBe(false);
    expect(isReplicaSetHello(null)).toBe(false);
  });

  it('reports transaction support on the in-memory replica set', async () => {
    expect(await supportsTransactions()).toBe(true);
  });
});
