import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Notification } from '../src/models/Notification';
import { Vehicle } from '../src/models/Vehicle';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

/** Found in the journey test: approving a booking never told the traveller. */
describe('Booking approval notifies the traveller', () => {
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

  async function pendingBooking() {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await Vehicle.create({
      providerId: provider.providerId,
      name: 'Jeep',
      type: 'suv',
      brand: 'Toyota',
      vehicleModel: 'Land Cruiser',
      year: 2019,
      registrationNumber: `GLT-${Date.now()}`,
      seatCount: 5,
      status: 'active',
    });
    const trip = await authed(app, provider.token).post('/api/trips').send({
      vehicleId: vehicle._id.toString(),
      origin: 'Gilgit',
      destination: 'Hunza',
      departureDate: '2030-01-01',
      departureTime: '09:00',
      price: 3500,
    });
    expect(trip.status).toBe(201);
    const booking = await authed(app, customer.token)
      .post('/api/bookings')
      .send({
        bookingType: 'transport',
        paymentMethod: 'cash',
        transportBooking: {
          tripId: trip.body.data._id,
          seats: ['A1'],
          passengerDetails: [{ name: 'Traveller One', phone: '03001234567' }],
        },
      });
    expect(booking.status).toBe(201);
    return { customer, provider, bookingId: booking.body.data._id as string };
  }

  it('sends "Booking confirmed" once when the driver approves', async () => {
    const { customer, provider, bookingId } = await pendingBooking();
    const approve = () =>
      authed(app, provider.token).put(`/api/providers/bookings/${bookingId}/status`).send({ status: 'confirmed' });

    expect((await approve()).status).toBe(200);
    // Approving again changes nothing and must not notify twice.
    expect((await approve()).status).toBe(200);

    const confirmed = await Notification.find({ userId: customer.id, type: 'bookingConfirmed' }).lean();
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].message).toMatch(/approved by the provider/);
  });
});
