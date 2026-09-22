import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Hotel } from '../src/models/Hotel';
import { Room } from '../src/models/Room';
import { RoomAvailability } from '../src/models/RoomAvailability';
import { reserveRoomsForRange, releaseRoomsForRange } from '../src/services/hotel.service';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRoom(app: ReturnType<typeof createApp>) {
  const provider = await makeUser(app, 'provider', { service: 'hotel' });
  const hotel = await Hotel.create({
    providerId: provider.providerId,
    name: 'Test Hotel',
    hotelType: 'hotel',
    address: '123 Road',
    city: 'Islamabad',
  });
  const room = await Room.create({
    hotelId: hotel._id,
    providerId: provider.providerId,
    name: 'Deluxe',
    roomType: 'double',
    bedType: 'queen',
    capacity: 2,
    pricePerNight: 1000,
    totalRooms: 4,
    availableRooms: 4,
  });
  return { provider, hotel, room };
}

describe('Phase 3.2 — hotel rollback must not release other bookings', () => {
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

  it('leaves another customer holding intact when a later night fails', async () => {
    const { room } = await makeRoom(app);
    const roomId = room._id.toString();
    const FIRST_NIGHT = '2030-01-01';
    const LAST_NIGHT = '2030-11-30';

    // A requests a long stay; its pre-check passes for every night (nothing is booked yet).
    const longStay = reserveRoomsForRange(roomId, '2030-01-01', '2030-12-01', 1);

    // Wait until A has actually committed its first night, so we know it passed the
    // pre-check and is mid-loop. Then B grabs the final night entirely.
    for (let i = 0; i < 400; i += 1) {
      const row = await RoomAvailability.findOne({ roomId, date: FIRST_NIGHT });
      if (row && row.bookedRooms >= 1) break;
      await sleep(5);
    }
    const lastNightGrab = reserveRoomsForRange(roomId, LAST_NIGHT, '2030-12-01', 4);

    const [aResult, bResult] = await Promise.allSettled([longStay, lastNightGrab]);

    expect(bResult.status).toBe('fulfilled');
    expect(aResult.status).toBe('rejected');

    const night = await RoomAvailability.findOne({ roomId, date: LAST_NIGHT });
    // B's holding must be untouched.
    expect(night?.bookedRooms).toBe(4);
    expect(night?.availableRooms).toBe(0);

    // A's earlier nights must be released back to full availability.
    const firstNight = await RoomAvailability.findOne({ roomId, date: FIRST_NIGHT });
    expect(firstNight?.bookedRooms).toBe(0);
    expect(firstNight?.availableRooms).toBe(4);
  });

  it('releaseRoomsForRange releases exactly the nights in the range it is given', async () => {
    const { room } = await makeRoom(app);
    const roomId = room._id.toString();

    await reserveRoomsForRange(roomId, '2030-07-01', '2030-07-02', 1);
    await reserveRoomsForRange(roomId, '2030-07-02', '2030-07-03', 1);

    await releaseRoomsForRange(roomId, '2030-07-01', '2030-07-02', 1);

    const released = await RoomAvailability.findOne({ roomId, date: '2030-07-01' });
    const kept = await RoomAvailability.findOne({ roomId, date: '2030-07-02' });
    expect(released?.bookedRooms).toBe(0);
    expect(kept?.bookedRooms).toBe(1);
  });
});
