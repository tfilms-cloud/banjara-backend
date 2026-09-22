import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Hotel } from '../src/models/Hotel';
import { Vehicle } from '../src/models/Vehicle';
import { Trip } from '../src/models/Trip';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';

async function createHotel(app: ReturnType<typeof createApp>, provider: TestUser) {
  const res = await authed(app, provider.token).post('/api/hotels').send({
    name: `Hotel ${Date.now()}`,
    hotelType: 'hotel',
    address: '123 Test Road',
    city: 'Islamabad',
  });
  if (res.status !== 201) throw new Error(`hotel create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data._id as string;
}

async function createTrip(app: ReturnType<typeof createApp>, provider: TestUser) {
  const vehicle = await Vehicle.create({
    providerId: provider.providerId,
    name: `Bus ${Date.now()}`,
    type: 'bus',
    brand: 'Hino',
    vehicleModel: 'AK',
    year: 2021,
    registrationNumber: `REG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    seatCount: 20,
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
  return res.body.data._id as string;
}

describe('Phase 1.3 — providers cannot self-approve listings', () => {
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

  it('does not let a provider approve/verify their own hotel', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    const hotelId = await createHotel(app, provider);

    const res = await authed(app, provider.token)
      .put(`/api/hotels/${hotelId}`)
      .send({ approvalStatus: 'approved', isVerified: true });
    expect(res.status).not.toBe(500);

    const hotel = await Hotel.findById(hotelId);
    expect(hotel?.approvalStatus).toBe('pending');
    expect(hotel?.isVerified).toBe(false);
  });

  it('lets a provider edit a legitimate hotel field', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    const hotelId = await createHotel(app, provider);

    const res = await authed(app, provider.token)
      .put(`/api/hotels/${hotelId}`)
      .send({ description: 'A lovely place' });
    expect(res.status).toBe(200);

    const hotel = await Hotel.findById(hotelId);
    expect(hotel?.description).toBe('A lovely place');
  });

  it("rejects a provider editing someone else's hotel", async () => {
    const owner = await makeUser(app, 'provider', { service: 'hotel' });
    const other = await makeUser(app, 'provider', { service: 'hotel' });
    const hotelId = await createHotel(app, owner);

    const res = await authed(app, other.token).put(`/api/hotels/${hotelId}`).send({ description: 'hacked' });
    expect(res.status).toBe(403);
  });

  it('still lets an admin approve a hotel', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    const admin = await makeUser(app, 'admin');
    const hotelId = await createHotel(app, provider);

    const res = await authed(app, admin.token).put(`/api/admin/hotels/${hotelId}/approve`);
    expect(res.status).toBe(200);

    const hotel = await Hotel.findById(hotelId);
    expect(hotel?.approvalStatus).toBe('approved');
    expect(hotel?.isVerified).toBe(true);
  });

  it('does not let a provider set moderation fields on their own trip', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const tripId = await createTrip(app, provider);

    const res = await authed(app, provider.token)
      .put(`/api/trips/${tripId}`)
      .send({ status: 'completed', bookedSeats: 5, availableSeats: 0, seatLayout: [] });
    expect(res.status).not.toBe(500);

    const trip = await Trip.findById(tripId);
    expect(trip?.status).toBe('scheduled');
    expect(trip?.bookedSeats).toBe(0);
    expect(trip?.availableSeats).toBe(20);
  });

  it('lets a provider edit a legitimate trip field', async () => {
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const tripId = await createTrip(app, provider);

    const res = await authed(app, provider.token)
      .put(`/api/trips/${tripId}`)
      .send({ description: 'Scenic route' });
    expect(res.status).toBe(200);

    const trip = await Trip.findById(tripId);
    expect(trip?.description).toBe('Scenic route');
  });

  it("rejects a provider editing someone else's trip", async () => {
    const owner = await makeUser(app, 'provider', { service: 'transport' });
    const other = await makeUser(app, 'provider', { service: 'transport' });
    const tripId = await createTrip(app, owner);

    const res = await authed(app, other.token).put(`/api/trips/${tripId}`).send({ description: 'hacked' });
    expect(res.status).toBe(403);
  });
});
