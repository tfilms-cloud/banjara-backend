import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { buildDemoCatalog, demoId, DEMO_CATEGORIES, addDays } from '../src/seed/demoCatalog';
import { applyDemoCatalog } from '../src/seed/demoDatabase';
import { assertLocalDemoSeedAllowed } from '../src/seed/demo';
import { User } from '../src/models/User';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { Trip } from '../src/models/Trip';
import { RoomAvailability } from '../src/models/RoomAvailability';
import { signTokenPair } from '../src/utils/jwt';
import { setupTestDb, teardownTestDb } from './helpers/db';

describe('Insert-only demo marketplace', () => {
  const password = 'Demo-unit-test-password!';
  const now = new Date();
  const app = createApp();
  let plan: ReturnType<typeof buildDemoCatalog>;
  let originalId: string;
  let original: string;
  beforeAll(async () => {
    await setupTestDb();
    plan = buildDemoCatalog({ now, passwordHash: await bcrypt.hash(password, 4),
      image: (user, folder, photo) => `https://images.example.test/${folder}/${user}/${photo}.jpg` });
    const user = await User.create({ name: 'Existing real customer', email: 'existing@example.test',
      phone: '03001111111', passwordHash: await bcrypt.hash('existing', 4), role: 'customer', status: 'active' });
    originalId = String(user._id);
    original = JSON.stringify(await User.findById(user._id).select('+passwordHash').lean());
    await applyDemoCatalog(plan);
  });
  afterAll(teardownTestDb);

  it('publishes all five categories and keeps all twenty credentials usable', async () => {
    for (const category of DEMO_CATEGORIES) {
      const response = await request(app).get('/api/providers/catalog').query({ service: category });
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(4);
      expect(response.body.data.every((row: { logo: string }) => row.logo.startsWith('https://'))).toBe(true);
    }
    for (const account of plan.accounts) {
      const response = await request(app).post('/api/auth/login').send({ email: account.email, password });
      expect(response.status, account.email).toBe(200);
      expect(response.body.data.user.providerId).toBe(account.providerId);
      const token = response.body.data.tokens.accessToken;
      const me = await request(app).get('/api/providers/me').set('Authorization', `Bearer ${token}`);
      expect(me.status).toBe(200);
      expect(me.body.data.verificationStatus).toBe('approved');
      if (account.category === 'transport') expect(me.body.data.onboardingProgress.completed).toBe(true);
    }
  });

  it('exposes bookable transport, dated rooms, published tours and available guides through customer APIs', async () => {
    const tripResponse = await request(app).get('/api/trips/search').query({ limit: 100 });
    expect(tripResponse.status).toBe(200);
    expect(tripResponse.body.data.items).toHaveLength(16);
    expect(tripResponse.body.data.items.every((trip: { availableSeats: number }) => trip.availableSeats > 0)).toBe(true);
    expect(await RoomAvailability.countDocuments()).toBe(480);
    const hotels = await request(app).get('/api/hotels');
    expect(hotels.status).toBe(200);
    expect(hotels.body.data).toHaveLength(4);
    const rooms = await request(app).get(`/api/rooms/hotel/${demoId('hotel-hotel-1')}`)
      .query({ checkIn: addDays(plan.today, 1), checkOut: addDays(plan.today, 3), rooms: 1, guests: 2 });
    expect(rooms.status).toBe(200);
    expect(rooms.body.data).toHaveLength(2);
    const tours = await request(app).get('/api/tour-itineraries');
    expect(tours.status).toBe(200);
    expect(tours.body.data.items).toHaveLength(8);
    const guides = await request(app).get('/api/guides').query({ date: addDays(plan.today, 1), guests: 2 });
    expect(guides.status).toBe(200);
    expect(guides.body.data).toHaveLength(4);
    for (const account of plan.accounts.filter(row => row.category === 'travelGuide')) {
      const available = await request(app).get(`/api/guides/${account.providerId}/availability`);
      expect(available.status).toBe(200);
    }
  });

  it('allows customers to book transport, a room, a package and a guide using the seeded availability', async () => {
    const token = signTokenPair({ sub: originalId, role: 'customer', email: 'existing@example.test' }).accessToken;
    const guestDetails = { name: 'Demo Traveler', email: 'existing@example.test', phone: '03001111111' };
    const create = (body: Record<string, unknown>) => request(app).post('/api/bookings')
      .set('Authorization', `Bearer ${token}`).send(body);
    const transport = await create({ bookingType: 'transport', paymentMethod: 'bankTransfer',
      transportBooking: { tripId: String(demoId(`trip-transport-1-${plan.today}-1`)), seats: ['A1'],
        passengerDetails: [{ name: guestDetails.name, phone: guestDetails.phone }] } });
    expect(transport.status, JSON.stringify(transport.body)).toBe(201);
    const initiation = await request(app).post(`/api/payments/${transport.body.data.paymentId}/initiate`)
      .set('Authorization', `Bearer ${token}`).send({ method: 'bankTransfer', accountId: String(demoId('account-transport-1')) });
    expect(initiation.status, JSON.stringify(initiation.body)).toBe(200);
    expect(initiation.body.data.status).toBe('payment_initiated');
    const hotel = await create({ bookingType: 'hotel', paymentMethod: 'payAtHotel', hotelBooking: {
      hotelId: String(demoId('hotel-hotel-1')), roomId: String(demoId('room-hotel-1-double')),
      checkIn: addDays(plan.today, 1), checkOut: addDays(plan.today, 3), rooms: 1, guests: 2, guestDetails,
    } });
    expect(hotel.status, JSON.stringify(hotel.body)).toBe(201);
    const tour = await create({ bookingType: 'package', paymentMethod: 'bankTransfer', packageBooking: {
      itineraryId: String(demoId('itinerary-tour-1-3')), startDate: addDays(plan.today, 7), travelers: 2, guestDetails,
    } });
    expect(tour.status, JSON.stringify(tour.body)).toBe(201);
    const guide = await create({ bookingType: 'guide', paymentMethod: 'bankTransfer', guideBooking: {
      providerId: String(demoId('provider-travelGuide-1')), serviceId: 'demo-travelGuide-1-4',
      date: addDays(plan.today, 1), startTime: '09:00', endTime: '13:00', guests: 2, guestDetails,
    } });
    expect(guide.status, JSON.stringify(guide.body)).toBe(201);
  });

  it('preserves existing customer data, provider edits, passwords and reserved inventory on re-run', async () => {
    const tripId = demoId(`trip-transport-1-${plan.today}-0`);
    await Trip.updateOne({ _id: tripId }, { $set: { availableSeats: 13, bookedSeats: 1, 'seatLayout.0.status': 'booked' } });
    const roomId = demoId('room-hotel-1-double');
    await RoomAvailability.updateOne({ roomId, date: plan.today }, { $set: { bookedRooms: 1, availableRooms: 4 } });
    await ProviderProfile.updateOne({ _id: demoId('provider-restaurant-1') }, { $set: { description: 'Edited by the provider' } });
    const changedHash = await bcrypt.hash('changed-password', 4);
    await User.updateOne({ _id: demoId('user-restaurant-1') }, { $set: { passwordHash: changedHash } });
    const result = await applyDemoCatalog(plan);
    expect(Object.values(result).reduce((sum, value) => sum + (value || 0), 0)).toBe(0);
    expect((await Trip.findById(tripId))!.availableSeats).toBe(13);
    expect((await Trip.findById(tripId))!.seatLayout[0].status).toBe('booked');
    expect((await RoomAvailability.findOne({ roomId, date: plan.today }))!.availableRooms).toBe(4);
    expect((await ProviderProfile.findById(demoId('provider-restaurant-1')))!.description).toBe('Edited by the provider');
    expect((await User.findById(demoId('user-restaurant-1')).select('+passwordHash'))!.passwordHash).toBe(changedHash);
    expect(JSON.stringify(await User.findById(originalId).select('+passwordHash').lean())).toBe(original);
    expect(await User.countDocuments()).toBe(21);
  });

  it('refuses unrelated email collisions without partial inserts', async () => {
    await User.deleteOne({ _id: demoId('user-tour-4') });
    await User.create({ email: 'demo.tour4@banjara.example', name: 'Unrelated owner', phone: '03001111112',
      passwordHash: 'not-a-demo-hash', role: 'customer', status: 'active' });
    const before = await User.countDocuments();
    await expect(applyDemoCatalog(plan)).rejects.toThrow('unrelated account');
    expect(await User.countDocuments()).toBe(before);
  });

  it('refuses remote or production execution', () => {
    expect(() => assertLocalDemoSeedAllowed({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1/banjara' })).toThrow();
    expect(() => assertLocalDemoSeedAllowed({ NODE_ENV: 'development', MONGODB_URI: 'mongodb+srv://example.test/banjara' })).toThrow();
    expect(() => assertLocalDemoSeedAllowed({ NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:27018/banjara' })).not.toThrow();
  });
});
