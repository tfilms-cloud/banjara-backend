import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Favorite } from '../src/models/Favorite';
import { Hotel } from '../src/models/Hotel';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { Review } from '../src/models/Review';
import { Room } from '../src/models/Room';
import { RoomAvailability } from '../src/models/RoomAvailability';
import { SupportTicket } from '../src/models/SupportTicket';
import { User } from '../src/models/User';
import { Vehicle } from '../src/models/Vehicle';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser } from './helpers/auth';
import { requestResetToken } from './helpers/reset';

describe('Audit regressions — bypass probes', () => {
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

  it('vehicle update cannot reassign ownership or moderation audit fields', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const other = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await Vehicle.create({
      providerId: provider.providerId,
      name: 'Bus',
      type: 'bus',
      brand: 'Hino',
      vehicleModel: 'AK',
      year: 2021,
      registrationNumber: `REG-${Date.now()}`,
      seatCount: 20,
    });

    const res = await authed(app, provider.token)
      .put(`/api/vehicles/${vehicle._id}`)
      .send({
        providerId: other.providerId,
        suspendedBy: other.id,
        rejectedBy: other.id,
        status: 'active',
        name: 'Renamed',
      });
    expect(res.status).not.toBe(500);

    const after = await Vehicle.findById(vehicle._id);
    expect(after?.providerId.toString()).toBe(provider.providerId);
    expect(after?.suspendedBy).toBeUndefined();
    expect(after?.rejectedBy).toBeUndefined();
    expect(after?.status).toBe('pending');
    expect(after?.name).toBe('Renamed');
  });

  it('favorite creation cannot be attributed to another user', async () => {
    const customer = await makeUser(app, 'customer');
    const other = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).post('/api/favorites').send({
      userId: other.id,
      targetType: 'trip',
      targetId: new mongoose.Types.ObjectId().toString(),
    });

    expect(res.status).toBe(201);
    const favorite = await Favorite.findOne({});
    expect(favorite?.userId.toString()).toBe(customer.id);
  });

  it('password change validates its body instead of 500ing', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).put('/api/users/me/password').send({});
    expect(res.status).toBeLessThan(500);
  });

  it('provider update cannot set verificationStatus', async () => {
    const provider = await makeUser(app, 'provider', { approved: false });

    await authed(app, provider.token).put('/api/providers/me').send({ verificationStatus: 'approved' });

    const profile = await ProviderProfile.findById(provider.providerId);
    expect(profile?.verificationStatus).toBe('pending');
  });

  it('hotel update cannot change moderation status', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    const hotel = await Hotel.create({
      providerId: provider.providerId,
      name: 'H',
      hotelType: 'hotel',
      address: 'a',
      city: 'c',
      status: 'draft',
      approvalStatus: 'pending',
      isVerified: false,
    });

    await authed(app, provider.token)
      .put(`/api/hotels/${hotel._id}`)
      .send({ status: 'active', approvalStatus: 'approved', isVerified: true, rating: 5 });

    const after = await Hotel.findById(hotel._id);
    expect(after?.status).toBe('draft');
    expect(after?.approvalStatus).toBe('pending');
    expect(after?.isVerified).toBe(false);
    expect(after?.rating).toBe(0);
  });

  it('user update cannot change email to an existing account', async () => {
    const a = await makeUser(app, 'customer');
    const b = await makeUser(app, 'customer');

    const res = await authed(app, a.token).put('/api/users/me').send({ email: b.email });
    expect(res.status).toBe(409);

    const after = await User.findById(a.id);
    expect(after?.email).toBe(a.email);
  });

  it('cannot edit another customer’s review', async () => {
    const owner = await makeUser(app, 'customer');
    const other = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const booking = await Booking.create({
      bookingNumber: `AUDIT-${Date.now()}`,
      customerId: owner.id,
      providerId: provider.providerId,
      bookingType: 'transport',
      subtotal: 100,
      totalAmount: 100,
      bookingStatus: 'completed',
      paymentStatus: 'paid',
    });
    const created = await authed(app, owner.token)
      .post('/api/reviews')
      .send({ bookingId: booking._id.toString(), rating: 5 });

    const res = await authed(app, other.token)
      .put(`/api/reviews/${created.body.data._id}`)
      .send({ rating: 1 });
    expect(res.status).toBe(403);

    const review = await Review.findById(created.body.data._id);
    expect(review?.rating).toBe(5);
  });

  it('cannot cancel another customer’s booking', async () => {
    const owner = await makeUser(app, 'customer');
    const other = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider');
    const booking = await Booking.create({
      bookingNumber: `AUDIT-${Date.now()}`,
      customerId: owner.id,
      providerId: provider.providerId,
      bookingType: 'transport',
      subtotal: 100,
      totalAmount: 100,
      bookingStatus: 'confirmed',
      paymentStatus: 'paid',
    });

    const res = await authed(app, other.token).put(`/api/bookings/${booking._id}/cancel`);
    expect(res.status).toBe(403);

    const after = await Booking.findById(booking._id);
    expect(after?.bookingStatus).toBe('confirmed');
  });

  it('a reset token cannot be used for a different account', async () => {
    const victim = await makeUser(app, 'customer');
    const attacker = await makeUser(app, 'customer');
    const token = await requestResetToken(app, victim.email);
    expect(token).toBeTruthy();

    const cross = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: attacker.email, code: token, newPassword: 'NewPass123' });
    expect(cross.status).toBe(400);

    const legitimate = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: victim.email, code: token, newPassword: 'NewPass123' });
    expect(legitimate.status).toBe(200);
  });

  it('a second forgot-password within the cooldown does not invalidate the first token', async () => {
    const user = await makeUser(app, 'customer');
    const first = await requestResetToken(app, user.email);
    expect(first).toBeTruthy();

    await request(app).post('/api/auth/forgot-password').send({ email: user.email });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: user.email, code: first, newPassword: 'NewPass123' });
    expect(res.status).toBe(200);
  });

  it('a negative block count cannot inflate availability', async () => {
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
    await RoomAvailability.create({
      roomId: room._id,
      date: '2030-01-01',
      totalRooms: 5,
      bookedRooms: 0,
      blockedRooms: 0,
      availableRooms: 5,
    });

    const res = await authed(app, provider.token).post('/api/availability/block').send({
      roomId: room._id.toString(),
      date: '2030-01-01',
      count: -3,
    });
    expect(res.status).toBeLessThan(500);

    const day = await RoomAvailability.findOne({ roomId: room._id, date: '2030-01-01' });
    expect(day?.blockedRooms).toBe(0);
    expect(day?.availableRooms).toBe(5);
  });

  it('support ticket creation cannot self-set status', async () => {
    const customer = await makeUser(app, 'customer');

    const res = await authed(app, customer.token).post('/api/support').send({
      category: 'technical',
      subject: 'Help',
      message: 'Problem',
      status: 'resolved',
      priority: 'high',
    });
    expect(res.status).toBe(201);

    const ticket = await SupportTicket.findOne({});
    expect(ticket?.status).toBe('open');
  });
});
