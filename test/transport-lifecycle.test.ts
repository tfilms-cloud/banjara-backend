import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Notification } from '../src/models/Notification';
import { Payment } from '../src/models/Payment';
import { Vehicle } from '../src/models/Vehicle';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';

/** Gaps found in the transport journey test, now closed. */
describe('Transport lifecycle: approval, cash and completion', () => {
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

  async function vehicleFor(provider: TestUser, status: 'pending' | 'active', type = 'suv') {
    return Vehicle.create({
      providerId: provider.providerId,
      name: 'Land Cruiser',
      type,
      brand: 'Toyota',
      vehicleModel: 'Land Cruiser',
      year: 2019,
      registrationNumber: `GLT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      seatCount: 5,
      status,
    });
  }

  async function confirmedCashBooking() {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await vehicleFor(provider, 'active');
    const trip = await authed(app, provider.token).post('/api/trips').send({
      vehicleId: vehicle._id.toString(),
      origin: 'Gilgit',
      destination: 'Hunza',
      departureDate: '2030-01-01',
      departureTime: '09:00',
      price: 3500,
    });
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
    const bookingId = booking.body.data._id as string;
    await authed(app, provider.token).put(`/api/providers/bookings/${bookingId}/status`).send({ status: 'confirmed' });
    return { customer, provider, bookingId };
  }

  it("approving a transport driver also approves the vehicle they registered", async () => {
    const admin = await makeUser(app, 'admin');
    const driver = await makeUser(app, 'provider', { service: 'transport', approved: false });
    const vehicle = await vehicleFor(driver, 'pending');

    const res = await authed(app, admin.token).put(`/api/admin/providers/${driver.providerId}/approve`).send({});
    expect(res.status).toBe(200);

    const after = await Vehicle.findById(vehicle._id);
    expect(after?.status).toBe('active');
    expect(after?.approvedBy?.toString()).toBe(admin.id);
  });

  it('a driver can record cash as received, once, and the traveller is told', async () => {
    const { customer, provider, bookingId } = await confirmedCashBooking();
    const mark = () => authed(app, provider.token).put(`/api/providers/bookings/${bookingId}/cash-received`).send({});

    const res = await mark();
    expect(res.status).toBe(200);
    expect(res.body.data.paymentStatus).toBe('paid');
    expect((await mark()).status).toBe(200); // repeat is harmless

    const booking = await Booking.findById(bookingId);
    const payment = await Payment.findById(booking!.paymentId);
    expect(payment?.status).toBe('paid');
    expect(payment?.confirmedBy?.toString()).toBe(provider.id);
    expect(await Notification.countDocuments({ userId: customer.id, type: 'paymentConfirmed' })).toBe(1);
  });

  it('another driver cannot record cash for a booking that is not theirs', async () => {
    const { bookingId } = await confirmedCashBooking();
    const other = await makeUser(app, 'provider', { service: 'transport' });
    const res = await authed(app, other.token).put(`/api/providers/bookings/${bookingId}/cash-received`).send({});
    expect(res.status).toBe(403);
  });

  it('cash cannot be recorded before the booking is approved', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await vehicleFor(provider, 'active');
    const trip = await authed(app, provider.token).post('/api/trips').send({
      vehicleId: vehicle._id.toString(),
      origin: 'Gilgit',
      destination: 'Hunza',
      departureDate: '2030-01-01',
      departureTime: '09:00',
      price: 3500,
    });
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
    const res = await authed(app, provider.token)
      .put(`/api/providers/bookings/${booking.body.data._id}/cash-received`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('completing a trip notifies the traveller', async () => {
    const { customer, provider, bookingId } = await confirmedCashBooking();
    const res = await authed(app, provider.token)
      .put(`/api/providers/bookings/${bookingId}/status`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ userId: customer.id, type: 'bookingCompleted' })).toBe(1);
  });

  async function tripFor(provider: TestUser, bookingMode: 'seat' | 'vehicle', price: number) {
    const vehicle = await vehicleFor(provider, 'active');
    const trip = await authed(app, provider.token).post('/api/trips').send({
      vehicleId: vehicle._id.toString(),
      origin: 'Gilgit',
      destination: 'Hunza',
      departureDate: '2030-01-01',
      departureTime: '09:00',
      price,
      bookingMode,
    });
    expect(trip.status).toBe(201);
    return trip.body.data as { _id: string; totalSeats: number; seatLayout: { seatNumber: string }[] };
  }

  const book = (customer: TestUser, tripId: string, seats: string[], names: string[]) =>
    authed(app, customer.token)
      .post('/api/bookings')
      .send({
        bookingType: 'transport',
        paymentMethod: 'cash',
        transportBooking: { tripId, seats, passengerDetails: names.map((name) => ({ name })) },
      });

  it('a whole-vehicle hire takes every seat and charges the vehicle fare once', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const trip = await tripFor(provider, 'vehicle', 20000);
    const all = trip.seatLayout.map((s) => s.seatNumber);

    const res = await book(customer, trip._id, all, ['Lead Traveller']);
    expect(res.status).toBe(201);
    // 20,000 + 10% tax + 200 fee, not 20,000 × 5 seats.
    expect(res.body.data.totalAmount).toBe(22200);
  });

  it('a whole-vehicle trip refuses a partial booking and frees the seats again', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const trip = await tripFor(provider, 'vehicle', 20000);
    const all = trip.seatLayout.map((s) => s.seatNumber);

    expect((await book(customer, trip._id, all.slice(0, 2), ['Lead Traveller'])).status).toBe(422);
    // Nothing is left held: the full hire still goes through.
    expect((await book(customer, trip._id, all, ['Lead Traveller'])).status).toBe(201);
  });

  it('a seat booking still needs one passenger per seat', async () => {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const trip = await tripFor(provider, 'seat', 3500);
    const res = await book(customer, trip._id, ['A1', 'A2'], ['Only One']);
    expect(res.status).toBe(422);
    expect((await book(customer, trip._id, ['A1', 'A2'], ['One', 'Two'])).status).toBe(201);
  });

  it('a jeep is stored as a jeep, not an SUV', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await vehicleFor(provider, 'pending', 'jeep');
    expect(vehicle.type).toBe('jeep');
  });
});
