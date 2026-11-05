import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';
import { assertLocalDemoSeedAllowed } from '../src/seed/demo';
import { DEMO_CATEGORIES, buildDemoCatalog, addDays } from '../src/seed/demoCatalog';
import { demoImageResolver } from '../src/seed/demoImages';

async function verify() {
  assertLocalDemoSeedAllowed(env);
  logger.level = 'error';
  const directory = path.resolve(__dirname, '../.local-demo');
  const credentials = JSON.parse(await readFile(path.join(directory, 'credentials.json'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
  const resolver = demoImageResolver();
  const plan = buildDemoCatalog({ now: new Date(report.completedAt), passwordHash: 'not-used', image: resolver.image });
  await connectDatabase();
  const app = createApp();
  let logins = 0;
  let profiles = 0;
  for (const account of plan.accounts) {
    const login = await request(app).post('/api/auth/login').send({ email: account.email, password: credentials.password });
    assert.equal(login.status, 200, `Login failed for ${account.email}`);
    assert.equal(login.body.data.user.role, 'provider');
    assert.equal(login.body.data.user.providerId, account.providerId);
    const token = login.body.data.tokens.accessToken;
    const me = await request(app).get('/api/providers/me').set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.verificationStatus, 'approved');
    if (account.category === 'transport') assert.equal(me.body.data.onboardingProgress.completed, true);
    const profile = await request(app).get(`/api/providers/public/${account.providerId}`);
    assert.equal(profile.status, 200);
    assert.ok(profile.body.data.logo, `Missing public image for ${account.email}`);
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`).expect(200);
    logins++;
    profiles++;
  }
  const visible: Record<string, number> = {};
  for (const category of DEMO_CATEGORIES) {
    const response = await request(app).get('/api/providers/catalog').query({ service: category, limit: 100 });
    assert.equal(response.status, 200);
    const expected = new Set(plan.accounts.filter(account => account.category === category).map(account => account.providerId));
    const found = response.body.data.filter((row: { _id: string }) => expected.has(String(row._id)));
    assert.equal(found.length, 4, `${category} demo providers are not all visible`);
    visible[category] = found.length;
  }
  const trips = await request(app).get('/api/trips/search').query({ limit: 100 });
  assert.equal(trips.status, 200);
  const expectedTrips = new Set(plan.records.filter(record => record.model === 'Trip').map(record => String(record.data._id)));
  const visibleTrips = trips.body.data.items.filter((trip: { _id: string }) => expectedTrips.has(String(trip._id)));
  assert.equal(visibleTrips.length, 16);
  assert.ok(visibleTrips.every((trip: { availableSeats: number }) => trip.availableSeats > 0));

  for (const account of plan.accounts.filter(account => account.category === 'hotel')) {
    const hotel = plan.records.find(record => record.model === 'Hotel' && String(record.data.providerId) === account.providerId)!;
    await request(app).get(`/api/hotels/${hotel.data._id}`).expect(200);
    const rooms = await request(app).get(`/api/rooms/hotel/${hotel.data._id}`).query({
      checkIn: addDays(plan.today, 1), checkOut: addDays(plan.today, 3), guests: 2, rooms: 1,
    });
    assert.equal(rooms.status, 200);
    assert.equal(rooms.body.data.length, 2);
  }
  const itineraries = await request(app).get('/api/tour-itineraries').query({ limit: 100 });
  assert.equal(itineraries.status, 200);
  const expectedItineraries = new Set(plan.records.filter(record => record.model === 'TourItinerary').map(record => String(record.data._id)));
  const published = itineraries.body.data.items.filter((item: { id: string }) => expectedItineraries.has(item.id));
  assert.equal(published.length, 8);
  for (const account of plan.accounts.filter(account => account.category === 'travelGuide')) {
    await request(app).get(`/api/guides/${account.providerId}/availability`).expect(200);
  }
  const summary = { verifiedAt: new Date().toISOString(), logins, publicProfiles: profiles, visibleProviders: visible,
    visibleTrips: visibleTrips.length, hotelsWithAvailableRooms: 4, publishedPackages: published.length,
    guidesWithAvailability: 4, photosVerifiedDuringSeed: report.photos.verified };
  await writeFile(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

verify().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed'); process.exitCode = 1; })
  .finally(async () => { await disconnectDatabase(); });
