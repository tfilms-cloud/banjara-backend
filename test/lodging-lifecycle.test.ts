import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Hotel } from '../src/models/Hotel';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { authed, makeUser, type TestUser } from './helpers/auth';

const BUSINESS = {
  businessName: 'Rakaposhi View Guest House',
  ownerName: 'Ali Khan',
  phone: '03001234567',
  email: 'host@example.com',
  description: 'Family-run guest house facing Rakaposhi.',
  city: 'Hunza',
  address: 'Karimabad, Hunza',
  yearsExperience: 8,
};
const PROPERTY = {
  hotelName: 'Rakaposhi View Guest House',
  hotelType: 'guestHouse',
  managerName: 'Ali Khan',
  phone: '03001234567',
  village: 'Karimabad',
  district: 'Hunza',
  city: 'Hunza',
  address: 'Karimabad, Hunza',
  businessRegistered: 'yes',
  businessRegistrationNumber: 'GB-HTL-2231',
  yearsExperience: 8,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  restaurantAvailable: 'no',
  amenities: ['WiFi', 'Parking'],
};
const PHOTOS = {
  outlookImages: ['https://example.com/outside.jpg'],
  roomImages: ['https://example.com/room.jpg'],
};

/** The lodging application on the website: same calls, same order. */
describe('Lodging: application, approval, booking and stay', () => {
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

  const me = async (owner: TestUser) => (await authed(app, owner.token).get('/api/providers/me')).body.data;
  const nextStep = async (owner: TestUser) => (await me(owner)).onboardingProgress?.nextStep;
  const checkpoint = (owner: TestUser, step: string) =>
    authed(app, owner.token).post('/api/providers/me/onboarding/checkpoint').send({ step });
  const save = (owner: TestUser, body: Record<string, unknown>) =>
    authed(app, owner.token).put('/api/providers/me').send(body);

  /** Steps 3–7, ending with one room. */
  async function completeApplication(owner: TestUser) {
    await save(owner, BUSINESS);
    expect(await nextStep(owner)).toBe('location');

    await save(owner, { latitude: 36.3167, longitude: 74.65, address: BUSINESS.address, city: 'Hunza' });
    expect((await checkpoint(owner, 'location')).status).toBe(200);
    expect(await nextStep(owner)).toBe('property');

    await save(owner, { hotelDetails: PROPERTY });
    expect((await checkpoint(owner, 'property')).status).toBe(200);
    expect(await nextStep(owner)).toBe('photos');

    // The website merges each step into the saved details before sending.
    await save(owner, { hotelDetails: { ...PROPERTY, ...PHOTOS } });
    expect((await checkpoint(owner, 'photos')).status).toBe(200);
    expect(await nextStep(owner)).toBe('rooms');

    const hotel = await Hotel.findOne({ providerId: owner.providerId });
    expect(hotel).toBeTruthy();
    const room = await authed(app, owner.token).post('/api/rooms').send({
      hotelId: hotel!._id.toString(),
      name: 'Mountain view double',
      roomType: 'double',
      bedType: 'Double bed',
      capacity: 2,
      pricePerNight: 6000,
      totalRooms: 3,
      images: ['https://example.com/room.jpg'],
    });
    expect(room.status).toBe(201);
    expect(await nextStep(owner)).toBe('review');
    return { hotelId: hotel!._id.toString(), roomId: room.body.data._id as string };
  }

  it('walks the steps in order and submits', async () => {
    const owner = await makeUser(app, 'provider', { service: 'hotel', approved: false });
    await completeApplication(owner);
    const submitted = await authed(app, owner.token).post('/api/providers/me/onboarding/submit').send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.onboardingProgress.nextStep).toBe('submitted');
    expect(submitted.body.data.onboardingProgress.completedSteps).toEqual([
      'business', 'location', 'property', 'photos', 'rooms', 'review',
    ]);
  });

  it('refuses to skip ahead or confirm incomplete steps', async () => {
    const owner = await makeUser(app, 'provider', { service: 'hotel', approved: false });
    await save(owner, BUSINESS);
    expect((await checkpoint(owner, 'photos')).status).toBe(422); // still on location

    await save(owner, { latitude: 36.3167, longitude: 74.65 });
    await checkpoint(owner, 'location');
    await save(owner, { hotelDetails: { ...PROPERTY, checkInTime: '2pm', district: '' } });
    const incomplete = await checkpoint(owner, 'property');
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.message).toMatch(/district/i);
    expect(incomplete.body.message).toMatch(/check-in/i);

    expect((await authed(app, owner.token).post('/api/providers/me/onboarding/submit').send({})).status).toBe(422);
  });

  it('asks for a restaurant photo only when there is a restaurant', async () => {
    const owner = await makeUser(app, 'provider', { service: 'hotel', approved: false });
    await save(owner, BUSINESS);
    await save(owner, { latitude: 36.3167, longitude: 74.65 });
    await checkpoint(owner, 'location');
    const withRestaurant = { ...PROPERTY, restaurantAvailable: 'yes' };
    await save(owner, { hotelDetails: withRestaurant });
    await checkpoint(owner, 'property');
    await save(owner, { hotelDetails: { ...withRestaurant, ...PHOTOS } });
    const res = await checkpoint(owner, 'photos');
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/restaurant photo/i);
  });

  it('approving the provider publishes their hotel, and a stay goes from booking to check-out', async () => {
    const admin = await makeUser(app, 'admin');
    const owner = await makeUser(app, 'provider', { service: 'hotel', approved: false });
    const { hotelId, roomId } = await completeApplication(owner);
    await authed(app, owner.token).post('/api/providers/me/onboarding/submit').send({});

    expect((await Hotel.findById(hotelId))?.approvalStatus).toBe('pending');
    const approve = await authed(app, admin.token).put(`/api/admin/providers/${owner.providerId}/approve`).send({});
    expect(approve.status).toBe(200);
    const hotel = await Hotel.findById(hotelId);
    expect(hotel?.approvalStatus).toBe('approved');
    expect(hotel?.status).toBe('active');
    // The type chosen in the application, not a default.
    expect(hotel?.hotelType).toBe('guestHouse');
    expect((await ProviderProfile.findById(owner.providerId))?.verificationStatus).toBe('approved');

    // A traveller books two nights, paying at the hotel.
    const guest = await makeUser(app, 'customer');
    const booking = await authed(app, guest.token)
      .post('/api/bookings')
      .send({
        bookingType: 'hotel',
        paymentMethod: 'payAtHotel',
        hotelBooking: {
          hotelId,
          roomId,
          checkIn: '2030-03-10',
          checkOut: '2030-03-12',
          rooms: 1,
          guests: 2,
          guestDetails: { name: 'Sara Ahmed', email: 'sara@example.com', phone: '03007654321' },
        },
      });
    expect(booking.status).toBe(201);
    const bookingId = booking.body.data._id as string;
    // 2 nights x 6,000 + 10% tax + 200 fee
    expect(booking.body.data.totalAmount).toBe(13400);

    const host = (path: string, body: Record<string, unknown> = {}) =>
      authed(app, owner.token).put(`/api/providers/${path}`).send(body);
    expect((await host(`bookings/${bookingId}/status`, { status: 'confirmed' })).status).toBe(200);
    expect((await host(`bookings/${bookingId}/cash-received`)).body.data.paymentStatus).toBe('paid');
    expect((await host(`hotel/bookings/${bookingId}/check-in`)).status).toBe(200);
    expect((await host(`hotel/bookings/${bookingId}/check-out`)).status).toBe(200);
    expect((await Booking.findById(bookingId))?.bookingStatus).toBe('completed');
  });
});
