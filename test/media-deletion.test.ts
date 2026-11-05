import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { setupTestDb, clearDatabase, teardownTestDb, ensureIndexes } from './helpers/db';
import { makeUser, authed } from './helpers/auth';

const fake = vi.hoisted(() => ({ remove: vi.fn(), from: vi.fn() }));
vi.mock('../src/config/supabase', async (original) => ({
  ...await original<typeof import('../src/config/supabase')>(),
  getSupabase: () => ({ storage: { from: fake.from } }),
}));
import { env } from '../src/config/env';
import { MediaDeletion } from '../src/models/MediaDeletion';
import { createApp } from '../src/app';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { upsertGuideDetails } from '../src/services/guide.service';
import { requestMediaDeletion, cleanupRemovedMedia, parseStorageObject } from '../src/services/mediaDeletion.service';

const app = createApp();
const owner = '111111111111111111111111';
const other = '222222222222222222222222';
const path = `vehicles/${owner}/1790000000-abc123.jpg`;
const originalUrl = env.SUPABASE_URL;
const originalBucket = env.SUPABASE_STORAGE_BUCKET;
const publicUrl = (objectPath = path) => `${env.SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(env.SUPABASE_STORAGE_BUCKET)}/${objectPath}`;
const due = () => MediaDeletion.updateMany({}, { $set: { nextAttemptAt: new Date(0) } });

beforeAll(async () => {
  env.SUPABASE_URL = 'https://media-test.supabase.co';
  env.SUPABASE_STORAGE_BUCKET = 'Banjara Images';
  await setupTestDb(); await ensureIndexes();
}, 60_000);
afterAll(async () => {
  env.SUPABASE_URL = originalUrl; env.SUPABASE_STORAGE_BUCKET = originalBucket;
  await teardownTestDb();
});
beforeEach(async () => {
  await clearDatabase(); vi.clearAllMocks();
  fake.from.mockReturnValue({ remove: fake.remove });
  fake.remove.mockResolvedValue({ data: [], error: null });
});

describe('Uploaded image removal', () => {
  it('deletes an unreferenced own image and is safe to repeat', async () => {
    expect(await requestMediaDeletion(publicUrl(), owner)).toEqual({ status: 'deleted' });
    expect(fake.from).toHaveBeenCalledWith('Banjara Images');
    expect(fake.remove).toHaveBeenCalledWith([path]);
    expect(await MediaDeletion.countDocuments()).toBe(0);
    expect(await requestMediaDeletion(publicUrl(), owner)).toEqual({ status: 'deleted' });
  });

  it('rejects another owner, foreign project/bucket, traversal and raw paths', async () => {
    await expect(requestMediaDeletion(publicUrl(), other)).rejects.toMatchObject({ statusCode: 403 });
    for (const value of [
      publicUrl().replace('media-test.supabase.co', 'evil.example'),
      publicUrl().replace('Banjara%20Images', 'another-bucket'),
      publicUrl().replace('/vehicles/', '/vehicles/../'),
      publicUrl().replace('/vehicles/', '/vehicles/%2e%2e/'),
      publicUrl().replace('/vehicles/', '/vehicles%2f'),
      `payment-file:payments/${owner}/../other.jpg`, path,
    ]) await expect(requestMediaDeletion(value, owner)).rejects.toMatchObject({ statusCode: 422 });
    expect(fake.remove).not.toHaveBeenCalled();
    expect(await MediaDeletion.countDocuments()).toBe(0);
  });

  it('keeps a saved/shared image until ALL references are removed', async () => {
    const db = mongoose.connection.db!;
    await db.collection('vehicles').insertOne({ images: [publicUrl()] });
    await db.collection('providerprofiles').insertOne({ transportDetails: { vehicleImageFront: publicUrl() } });
    expect(await requestMediaDeletion(publicUrl(), owner)).toEqual({ status: 'pending' });
    expect(fake.remove).not.toHaveBeenCalled();
    await db.collection('vehicles').deleteMany({}); await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 0 });
    await db.collection('providerprofiles').deleteMany({}); await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 1 });
    expect(await MediaDeletion.countDocuments()).toBe(0);
  });

  it('preserves nested guide images and historical booking snapshots', async () => {
    const db = mongoose.connection.db!;
    await db.collection('providerprofiles').insertOne({ guideDetails: { documents: [{ fileUrl: publicUrl() }] } });
    await db.collection('bookings').insertOne({ guideBooking: { photo: publicUrl() } });
    expect(await requestMediaDeletion(publicUrl(), owner)).toEqual({ status: 'pending' });
    await db.collection('providerprofiles').deleteMany({}); await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 0 });
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('clears a guide photo and its mirrored logo when the removal is saved', async () => {
    const provider = await makeUser(app, 'provider');
    const photoPath = `guides/${provider.id}/1790000000-guide.jpg`;
    const photo = publicUrl(photoPath);
    await ProviderProfile.findByIdAndUpdate(provider.providerId, {
      services: ['travelGuide'], logo: photo,
      guideDetails: { profilePhoto: photo, cnicFrontUrl: photo, cnicBackUrl: photo },
    });
    expect(await requestMediaDeletion(photo, provider.id)).toEqual({ status: 'pending' });
    await upsertGuideDetails(provider.providerId!, { profilePhoto: '', cnicFrontUrl: '', cnicBackUrl: '' });
    const saved = await ProviderProfile.findById(provider.providerId);
    expect(saved?.logo).toBe(''); expect(saved?.guideDetails?.profilePhoto).toBe('');
    await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 1 });
  });

  it('removes unsent private receipts but protects submitted proof and payment chat', async () => {
    const privatePath = `payments/${owner}/00000000-0000-4000-8000-000000000001.jpg`;
    const ref = `payment-file:${privatePath}`;
    const db = mongoose.connection.db!;
    await db.collection('payments').insertOne({ proof: { receiptUrls: [ref] } });
    await db.collection('paymentmessages').insertOne({ imageUrl: `${env.SUPABASE_URL}/storage/v1/object/sign/${env.SUPABASE_PAYMENT_BUCKET}/${privatePath}?token=old` });
    expect(await requestMediaDeletion(ref, owner)).toEqual({ status: 'pending' });
    await db.collection('payments').deleteMany({}); await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 0 });
    await db.collection('paymentmessages').deleteMany({}); await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 1 });
    expect(fake.from).toHaveBeenLastCalledWith(env.SUPABASE_PAYMENT_BUCKET);
    expect(fake.remove).toHaveBeenLastCalledWith([privatePath]);
  });

  it('persists retries during storage errors without exposing vendor diagnostics', async () => {
    fake.remove.mockResolvedValueOnce({ error: { message: 'vendor-secret-details' } });
    expect(await requestMediaDeletion(publicUrl(), owner)).toEqual({ status: 'pending' });
    expect(await MediaDeletion.findOne()).toMatchObject({ attempts: 1 });
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 0 });
    await due();
    expect(await cleanupRemovedMedia()).toEqual({ deleted: 1 });
  });

  it('does not apply old cleanup requests after switching Supabase projects', async () => {
    fake.remove.mockResolvedValueOnce({ error: { message: 'offline' } });
    await requestMediaDeletion(publicUrl(), owner); await due();
    env.SUPABASE_URL = 'https://different-project.supabase.co';
    try {
      expect(await cleanupRemovedMedia()).toEqual({ deleted: 0 });
      expect(fake.remove).toHaveBeenCalledTimes(1);
    } finally { env.SUPABASE_URL = 'https://media-test.supabase.co'; }
  });

  it('validates authentication and body through the real API route', async () => {
    expect((await request(app).delete('/api/uploads').send({ reference: publicUrl() })).status).toBe(401);
    const user = await makeUser(app, 'customer');
    expect((await authed(app, user.token).delete('/api/uploads').send({ reference: {} })).status).toBe(422);
    expect((await authed(app, user.token).delete('/api/uploads').send({ reference: publicUrl() })).status).toBe(403);
    const ownPath = `avatars/${user.id}/1790000000-avatar.jpg`;
    const response = await authed(app, user.token).delete('/api/uploads').send({ reference: publicUrl(ownPath) });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ status: 'deleted' });
    expect(fake.remove).toHaveBeenLastCalledWith([ownPath]);
  });

  it('only accepts private payment objects in the private bucket', () => {
    expect(parseStorageObject(`${env.SUPABASE_URL}/storage/v1/object/sign/${env.SUPABASE_PAYMENT_BUCKET}/${path}?token=a`)).toBeNull();
  });
});
