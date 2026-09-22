import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Payment } from '../src/models/Payment';
import { Trip } from '../src/models/Trip';
import { Vehicle } from '../src/models/Vehicle';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

// Fault injection: make payment creation fail after the booking and seats are in place,
// which is exactly the "crash between steps" the compensating path must survive.
vi.mock('../src/services/payment.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/payment.service')>();
  return {
    ...actual,
    createPayment: vi.fn().mockRejectedValue(new Error('payment provider down')),
  };
});

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

describe('Phase 3.3 — booking compensation on mid-flow failure', () => {
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

  it('cancels the booking and releases the seats when payment creation fails', async () => {
    const { customer, tripId } = await makeTripFixture(app);

    const res = await authed(app, customer.token).post('/api/bookings').send({
      bookingType: 'transport',
      paymentMethod: 'card',
      transportBooking: {
        tripId,
        seats: ['A1'],
        passengerDetails: [{ name: 'Passenger One', phone: '+920000000001' }],
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    const trip = await Trip.findById(tripId);
    expect(trip?.availableSeats).toBe(10);
    expect(trip?.bookedSeats).toBe(0);

    const bookings = await Booking.find({});
    expect(bookings).toHaveLength(1);
    // The partially-created booking must not be left dangling as pending.
    expect(bookings[0].bookingStatus).toBe('cancelled');

    expect(await Payment.countDocuments({})).toBe(0);
  });
});
