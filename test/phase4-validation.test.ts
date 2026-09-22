import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Hotel } from '../src/models/Hotel';
import { PickupPoint } from '../src/models/PickupPoint';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { Review } from '../src/models/Review';
import { Room } from '../src/models/Room';
import { Route } from '../src/models/Route';
import { SupportTicket } from '../src/models/SupportTicket';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';

let bookingCounter = 0;
async function makeReview(app: ReturnType<typeof createApp>) {
  const customer = await makeUser(app, 'customer');
  const provider = await makeUser(app, 'provider');
  bookingCounter += 1;
  const booking = await Booking.create({
    bookingNumber: `TEST-${Date.now()}-${bookingCounter}`,
    customerId: customer.id,
    providerId: provider.providerId,
    bookingType: 'transport',
    subtotal: 1000,
    totalAmount: 1000,
    bookingStatus: 'completed',
    paymentStatus: 'paid',
  });
  const created = await authed(app, customer.token)
    .post('/api/reviews')
    .send({ bookingId: booking._id.toString(), rating: 5, comment: 'Great' });
  if (created.status !== 201) {
    throw new Error(`review create failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  return { customer, provider, reviewId: created.body.data._id as string };
}

describe('Phase 4.1 — write-route validation and privilege boundaries', () => {
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

  it('does not let a customer change a review’s provider/booking/serviceType', async () => {
    const { customer, provider, reviewId } = await makeReview(app);
    const other = await makeUser(app, 'provider');
    const otherBookingId = new mongoose.Types.ObjectId().toString();

    const res = await authed(app, customer.token)
      .put(`/api/reviews/${reviewId}`)
      .send({ providerId: other.providerId, bookingId: otherBookingId, serviceType: 'hotel' });
    expect(res.status).not.toBe(500);

    const review = await Review.findById(reviewId);
    expect(review?.providerId.toString()).toBe(provider.providerId);
    expect(review?.serviceType).toBe('transport');
  });

  it('recomputes provider rating when a review is edited', async () => {
    const { customer, provider, reviewId } = await makeReview(app);

    const before = await ProviderProfile.findById(provider.providerId);
    expect(before?.rating).toBe(5);

    const res = await authed(app, customer.token).put(`/api/reviews/${reviewId}`).send({ rating: 1 });
    expect(res.status).toBe(200);

    const after = await ProviderProfile.findById(provider.providerId);
    expect(after?.rating).toBe(1);
  });

  it('does not let a provider overwrite room availability counters directly', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    const hotel = await Hotel.create({
      providerId: provider.providerId,
      name: 'H',
      hotelType: 'hotel',
      address: 'a',
      city: 'c',
    });
    const room = await Room.create({
      hotelId: hotel._id,
      providerId: provider.providerId,
      name: 'R',
      roomType: 'double',
      bedType: 'queen',
      capacity: 2,
      pricePerNight: 1000,
      totalRooms: 5,
      availableRooms: 5,
    });

    const res = await authed(app, provider.token)
      .put(`/api/rooms/${room._id}`)
      .send({ availableRooms: 0, bookedRooms: 99, pricePerNight: 2000 });
    expect(res.status).not.toBe(500);

    const after = await Room.findById(room._id);
    expect(after?.availableRooms).toBe(5);
    expect(after?.pricePerNight).toBe(2000);
  });

  it('does not let a provider reassign a route', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const other = await makeUser(app, 'provider', { service: 'transport' });
    const route = await Route.create({
      providerId: provider.providerId,
      origin: { name: 'A', latitude: 33, longitude: 73 },
      destination: { name: 'B', latitude: 34, longitude: 74 },
      stops: [],
      distance: 0,
      estimatedDuration: 0,
    });

    const res = await authed(app, provider.token)
      .put(`/api/routes/${route._id}`)
      .send({ providerId: other.providerId, distance: 120 });
    expect(res.status).not.toBe(500);

    const after = await Route.findById(route._id);
    expect(after?.providerId.toString()).toBe(provider.providerId);
    expect(after?.distance).toBe(120);
  });

  it('does not let a provider reassign a pickup point', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const other = await makeUser(app, 'provider', { service: 'transport' });
    const point = await PickupPoint.create({
      providerId: provider.providerId,
      name: 'Stop',
      address: 'Stop',
      latitude: 33,
      longitude: 73,
    });

    const res = await authed(app, provider.token)
      .put(`/api/pickup-points/${point._id}`)
      .send({ providerId: other.providerId, name: 'Renamed' });
    expect(res.status).not.toBe(500);

    const after = await PickupPoint.findById(point._id);
    expect(after?.providerId.toString()).toBe(provider.providerId);
    expect(after?.name).toBe('Renamed');
  });

  it('does not let an admin reassign a support ticket via update', async () => {
    const admin = await makeUser(app, 'admin');
    const customer = await makeUser(app, 'customer');
    const other = await makeUser(app, 'customer');
    const ticket = await SupportTicket.create({
      userId: customer.id,
      category: 'technical',
      subject: 'Help',
      message: 'Problem',
    });

    const res = await authed(app, admin.token)
      .put(`/api/support/${ticket._id}`)
      .send({ userId: other.id, status: 'closed' });
    expect(res.status).not.toBe(500);

    const after = await SupportTicket.findById(ticket._id);
    expect(after?.userId.toString()).toBe(customer.id);
    expect(after?.status).toBe('closed');
  });

  it('handles malformed ids without a 500', async () => {
    const admin = await makeUser(app, 'admin');
    const res = await authed(app, admin.token).put('/api/support/not-an-id').send({ status: 'closed' });
    expect(res.status).toBeLessThan(500);
  });
});
