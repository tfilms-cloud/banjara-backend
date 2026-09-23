import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Hotel } from '../src/models/Hotel';
import { ProviderProfile } from '../src/models/ProviderProfile';
import { listHotels } from '../src/services/admin.service';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';

describe('admin hotel list sync', () => {
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

  it('fixes hotelType on existing listings without wiping provider edits', async () => {
    const provider = await makeUser(app, 'provider', { service: 'hotel' });
    await ProviderProfile.findByIdAndUpdate(provider.providerId, {
      hotelDetails: { hotelName: 'Application Name', city: 'Islamabad', hotelType: 'hotel' },
    });

    // Provider registration already created the listing.
    const created = await Hotel.findOne({ providerId: provider.providerId });
    expect(created?.hotelType).toBe('hotel');

    // Provider edits the live listing, then turns out to be a guest house.
    await Hotel.updateOne(
      { _id: created!._id },
      { $set: { name: 'Edited Name', description: 'Edited', amenities: ['wifi'] } }
    );
    await ProviderProfile.findByIdAndUpdate(provider.providerId, { providerType: ['guestHouse'] });

    await listHotels();
    const after = await Hotel.findById(created!._id);
    expect(after?.hotelType).toBe('guestHouse');
    expect(after?.name).toBe('Edited Name');
    expect(after?.description).toBe('Edited');
    expect(after?.amenities).toEqual(['wifi']);
  });
});
