import { Hotel, type IHotel } from '../models/Hotel';
import { Room, type IRoom } from '../models/Room';
import { RoomAvailability } from '../models/RoomAvailability';
import { Booking } from '../models/Booking';
import { ProviderProfile, type IHotelDetails, type IProviderProfile } from '../models/ProviderProfile';
import { AppError, assertFound } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';
import { escapeRegex } from '../utils/regex';
import { log } from '../utils/logger';
import { assertApprovedProvider } from './provider.service';

export function bookableHotelFilter(): Record<string, unknown> {
  return {
    status: 'active',
    $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }],
  };
}

function datesBetween(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return dates;
  }
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function getNightSnapshot(roomId: string, date: string, room: IRoom) {
  const day = await RoomAvailability.findOne({ roomId, date });
  if (day) {
    return {
      totalRooms: day.totalRooms,
      bookedRooms: day.bookedRooms,
      blockedRooms: day.blockedRooms,
      availableRooms: day.availableRooms,
      priceOverride: day.priceOverride,
    };
  }
  return {
    totalRooms: room.totalRooms,
    bookedRooms: 0,
    blockedRooms: 0,
    availableRooms: room.totalRooms,
    priceOverride: undefined as number | undefined,
  };
}

/** One DB round-trip for a date range instead of findOne per night. */
async function getNightSnapshotsForRange(roomId: string, dates: string[], room: IRoom) {
  if (dates.length === 0) return new Map<string, Awaited<ReturnType<typeof getNightSnapshot>>>();

  const rows = await RoomAvailability.find({
    roomId,
    date: { $in: dates },
  }).lean();

  const byDate = new Map(rows.map((row) => [row.date, row]));
  const snapshots = new Map<string, Awaited<ReturnType<typeof getNightSnapshot>>>();

  for (const date of dates) {
    const day = byDate.get(date);
    if (day) {
      snapshots.set(date, {
        totalRooms: day.totalRooms,
        bookedRooms: day.bookedRooms,
        blockedRooms: day.blockedRooms,
        availableRooms: day.availableRooms,
        priceOverride: day.priceOverride,
      });
    } else {
      snapshots.set(date, {
        totalRooms: room.totalRooms,
        bookedRooms: 0,
        blockedRooms: 0,
        availableRooms: room.totalRooms,
        priceOverride: undefined,
      });
    }
  }

  return snapshots;
}

async function assertRoomOwnedByProvider(roomId: string, providerId: string) {
  const room = assertFound(await Room.findById(roomId), 'Room not found');
  if (room.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  return room;
}

async function assertHotelOwnedByProvider(hotelId: string, providerId: string) {
  const hotel = assertFound(await Hotel.findById(hotelId), 'Hotel not found');
  if (hotel.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  return hotel;
}

export async function createHotel(providerId: string, input: Record<string, unknown>) {
  await assertApprovedProvider(providerId);
  const lat = Number(input.latitude ?? 0);
  const lng = Number(input.longitude ?? 0);
  return Hotel.create({
    ...input,
    providerId,
    location: { type: 'Point', coordinates: [lng, lat] },
    status: 'draft',
    approvalStatus: 'pending',
    isVerified: false,
  });
}

function mapHotelType(value?: unknown): IHotel['hotelType'] {
  const raw = String(value ?? 'hotel')
    .replace(/[_-\s]/g, '')
    .toLowerCase();
  if (raw === 'resort') return 'resort';
  if (raw === 'lodge') return 'lodge';
  if (raw === 'guesthouse') return 'guestHouse';
  return 'hotel';
}

function asDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const doc = value as { toObject?: () => Record<string, unknown> };
  if (typeof doc.toObject === 'function') return doc.toObject();
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/** Guest-house/lodge providers list as guestHouse; everyone else never does. */
function resolveHotelType(
  providerType: IProviderProfile['providerType'] | undefined,
  details: Record<string, unknown>
): IHotel['hotelType'] {
  const offersGuestStay = (providerType ?? []).some(
    (type) => type === 'guestHouse' || type === 'lodge'
  );
  let hotelType = mapHotelType(details.hotelType);
  if (offersGuestStay && (hotelType === 'hotel' || hotelType === 'resort')) {
    hotelType = 'guestHouse';
  }
  if (!offersGuestStay && (hotelType === 'guestHouse' || hotelType === 'lodge')) {
    hotelType = 'hotel';
  }
  return hotelType;
}

/** Create or update the Hotel listing so admin can review it in Hotels. */
export async function upsertHotelFromProviderProfile(
  profile: Pick<
    IProviderProfile,
    '_id' | 'services' | 'providerType' | 'businessName' | 'description' | 'address' | 'city' | 'phone' | 'email' | 'location'
  > & { hotelDetails?: IHotelDetails | Record<string, unknown> }
) {
  const offersHotel = (profile.services ?? []).some((service) => service === 'hotel');
  if (!offersHotel) return null;

  const details = asDetails(profile.hotelDetails);
  const name = String(details.hotelName ?? profile.businessName ?? '').trim();
  const address = String(details.address ?? profile.address ?? '').trim();
  const city = String(details.city ?? profile.city ?? '').trim();
  if (name.length < 2 || address.length < 3 || city.length < 2) return null;

  const lat = Number(details.latitude ?? profile.location?.coordinates?.[1] ?? 0);
  const lng = Number(details.longitude ?? profile.location?.coordinates?.[0] ?? 0);

  const hotelType = resolveHotelType(profile.providerType, details);

  const payload = {
    name,
    description: String(details.description ?? profile.description ?? ''),
    hotelType,
    address,
    city,
    phone: String(details.phone ?? profile.phone ?? ''),
    email: String(details.email ?? profile.email ?? ''),
    amenities: stringList(details.amenities),
    images: stringList(details.images),
    checkInTime: String(details.checkInTime ?? '14:00'),
    checkOutTime: String(details.checkOutTime ?? '12:00'),
    location: {
      type: 'Point' as const,
      coordinates: [lng, lat] as [number, number],
    },
  };

  const existing = await Hotel.findOne({ providerId: profile._id });
  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return Hotel.create({
    ...payload,
    providerId: profile._id,
    status: 'draft',
    approvalStatus: 'pending',
    isVerified: false,
  });
}

export async function syncHotelListingsFromApplications() {
  const profiles = await ProviderProfile.find({
    services: 'hotel',
    $or: [{ 'hotelDetails.hotelName': { $exists: true, $ne: '' } }, { 'hotelDetails.city': { $exists: true, $ne: '' } }],
  });
  if (!profiles.length) return;

  const existing = await Hotel.find({
    providerId: { $in: profiles.map((profile) => profile._id) },
  }).select('providerId hotelType');
  const existingByProvider = new Map(existing.map((hotel) => [hotel.providerId.toString(), hotel]));

  // Existing listings only get their type corrected: providers edit name, photos,
  // amenities etc. after approval, and this runs on every admin hotel-list load.
  await Promise.all(
    profiles.map((profile) => {
      const hotel = existingByProvider.get(profile._id.toString());
      if (!hotel) return upsertHotelFromProviderProfile(profile);
      const hotelType = resolveHotelType(profile.providerType, asDetails(profile.hotelDetails));
      if (hotel.hotelType === hotelType) return null;
      return Hotel.updateOne({ _id: hotel._id }, { $set: { hotelType } });
    })
  );
}

async function roomHasAvailabilityForRange(
  room: IRoom,
  checkIn: string,
  checkOut: string,
  roomsNeeded: number,
  guests?: number
) {
  if (guests != null && guests > room.capacity * roomsNeeded) return false;
  const dates = datesBetween(checkIn, checkOut);
  if (dates.length === 0) return false;
  const snaps = await getNightSnapshotsForRange(room._id.toString(), dates, room);
  for (const date of dates) {
    const snap = snaps.get(date);
    if (!snap || snap.availableRooms < roomsNeeded) return false;
  }
  return true;
}

async function computeStayPriceFrom(room: IRoom, checkIn: string, checkOut: string, roomsNeeded: number) {
  const dates = datesBetween(checkIn, checkOut);
  if (dates.length === 0) return room.pricePerNight;
  const snaps = await getNightSnapshotsForRange(room._id.toString(), dates, room);
  let total = 0;
  for (const date of dates) {
    const snap = snaps.get(date);
    total += (snap?.priceOverride ?? room.pricePerNight) * roomsNeeded;
  }
  return Math.round(total / dates.length / roomsNeeded);
}

export async function searchHotels(query: Record<string, unknown>) {
  const { page, limit, skip } = getPagination(query);
  const filter: Record<string, unknown> = { ...bookableHotelFilter() };

  if (query.destination) filter.city = new RegExp(escapeRegex(String(query.destination)), 'i');
  if (query.hotelType) filter.hotelType = query.hotelType;
  if (query.minRating) filter.rating = { $gte: Number(query.minRating) };
  if (query.minPrice || query.maxPrice) {
    filter.priceFrom = {};
    if (query.minPrice) (filter.priceFrom as Record<string, number>).$gte = Number(query.minPrice);
    if (query.maxPrice) (filter.priceFrom as Record<string, number>).$lte = Number(query.maxPrice);
  }
  if (query.amenities) {
    const list = String(query.amenities)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (list.length) filter.amenities = { $all: list };
  }

  let sort: Record<string, 1 | -1> = { rating: -1, reviewCount: -1 };
  if (query.sort === 'priceLowToHigh') sort = { priceFrom: 1 };
  if (query.sort === 'priceHighToLow') sort = { priceFrom: -1 };
  if (query.sort === 'rating') sort = { rating: -1, reviewCount: -1 };
  if (query.sort === 'mostReviewed') sort = { reviewCount: -1, rating: -1 };

  const checkIn = query.checkIn ? String(query.checkIn) : '';
  const checkOut = query.checkOut ? String(query.checkOut) : '';
  const roomsNeeded = query.rooms ? Number(query.rooms) : 1;
  const guests = query.guests ? Number(query.guests) : undefined;

  let items = await Hotel.find(filter)
    .populate('providerId', 'businessName logo rating')
    .sort(sort)
    .skip(skip)
    .limit(limit * 3);

  if (checkIn && checkOut) {
    const hotelIds = items.map((h) => h._id);
    const allRooms = await Room.find({ hotelId: { $in: hotelIds }, status: 'active' });
    const roomsByHotel = new Map<string, typeof allRooms>();
    for (const room of allRooms) {
      const key = room.hotelId.toString();
      const list = roomsByHotel.get(key) ?? [];
      list.push(room);
      roomsByHotel.set(key, list);
    }

    const eligible: typeof items = [];
    for (const hotel of items) {
      const activeRooms = roomsByHotel.get(hotel._id.toString()) ?? [];
      let matched = false;
      let fromPrice = hotel.priceFrom;
      for (const room of activeRooms) {
        if (await roomHasAvailabilityForRange(room, checkIn, checkOut, roomsNeeded, guests)) {
          matched = true;
          const stayFrom = await computeStayPriceFrom(room, checkIn, checkOut, 1);
          fromPrice = fromPrice ? Math.min(fromPrice, stayFrom) : stayFrom;
        }
      }
      if (matched) {
        hotel.priceFrom = fromPrice;
        eligible.push(hotel);
      }
      if (eligible.length >= limit) break;
    }
    items = eligible;
  }

  if (query.sort === 'priceLowToHigh') {
    items.sort((a, b) => a.priceFrom - b.priceFrom);
  } else if (query.sort === 'priceHighToLow') {
    items.sort((a, b) => b.priceFrom - a.priceFrom);
  }

  const total = checkIn && checkOut ? items.length : await Hotel.countDocuments(filter);
  return paginatedResult(items.slice(0, limit), total, page, limit);
}

export async function listHotels(providerId?: string) {
  if (providerId) {
    return Hotel.find({ providerId }).sort({ createdAt: -1 });
  }
  return Hotel.find(bookableHotelFilter()).sort({ createdAt: -1 });
}

export async function getHotel(id: string) {
  return assertFound(await Hotel.findById(id).populate('providerId'), 'Hotel not found');
}

/**
 * Hotel fields a provider may change. Approval / verification / moderation fields
 * (`approvalStatus`, `isVerified`, `status`, `rejectionReason`, `rating`, `reviewCount`)
 * are absent on purpose — only the admin approve/reject/suspend routes may set them.
 * An allow-list is used instead of a deny-list so a newly added sensitive schema field
 * fails closed.
 */
const HOTEL_PROVIDER_FIELDS = [
  'name',
  'description',
  'hotelType',
  'address',
  'city',
  'country',
  'phone',
  'email',
  'amenities',
  'images',
  'checkInTime',
  'checkOutTime',
  'cancellationPolicy',
  'priceFrom',
] as const;

export async function updateHotel(providerId: string, id: string, patch: Record<string, unknown>) {
  const hotel = assertFound(await Hotel.findById(id), 'Hotel not found');
  if (hotel.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);

  const update: Record<string, unknown> = {};
  for (const field of HOTEL_PROVIDER_FIELDS) {
    if (patch[field] !== undefined) update[field] = patch[field];
  }
  if (typeof patch.latitude === 'number' && typeof patch.longitude === 'number') {
    update.location = {
      type: 'Point',
      coordinates: [patch.longitude, patch.latitude],
    };
  }

  Object.assign(hotel, update);
  await hotel.save();
  return hotel;
}

export async function deleteHotel(providerId: string, id: string) {
  const hotel = assertFound(await Hotel.findById(id), 'Hotel not found');
  if (hotel.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  hotel.status = 'inactive';
  await hotel.save();
  return hotel;
}

export async function createRoom(
  providerId: string,
  input: {
    hotelId: string;
    name: string;
    roomType: 'single' | 'double' | 'twin' | 'deluxe' | 'suite' | 'family';
    bedType: string;
    capacity: number;
    size?: number;
    pricePerNight: number;
    totalRooms: number;
    amenities?: string[];
    breakfastIncluded?: boolean;
    cancellationPolicy?: string;
    images?: string[];
  }
) {
  const hotel = await assertHotelOwnedByProvider(input.hotelId, providerId);

  const room = await Room.create({
    ...input,
    providerId,
    availableRooms: input.totalRooms,
    status: 'active',
  });

  if (!hotel.priceFrom || input.pricePerNight < hotel.priceFrom) {
    hotel.priceFrom = input.pricePerNight;
    await hotel.save();
  }
  return room;
}

export async function listRoomsByHotel(hotelId: string, query: Record<string, unknown> = {}) {
  const rooms = await Room.find({ hotelId, status: 'active' }).sort({ pricePerNight: 1 });
  const checkIn = query.checkIn ? String(query.checkIn) : '';
  const checkOut = query.checkOut ? String(query.checkOut) : '';
  const roomsNeeded = query.rooms ? Number(query.rooms) : 1;
  const guests = query.guests ? Number(query.guests) : undefined;

  if (!checkIn || !checkOut) return rooms;

  const nights = datesBetween(checkIn, checkOut);
  if (nights.length === 0) return [];

  const enriched = [];
  for (const room of rooms) {
    if (guests != null && guests > room.capacity * roomsNeeded) continue;
    const snaps = await getNightSnapshotsForRange(room._id.toString(), nights, room);
    let minAvailable = room.totalRooms;
    let ok = true;
    for (const date of nights) {
      const day = snaps.get(date);
      if (!day || day.availableRooms < roomsNeeded) {
        ok = false;
        break;
      }
      minAvailable = Math.min(minAvailable, day.availableRooms);
    }
    if (!ok) continue;
    const first = snaps.get(nights[0]);
    enriched.push({
      ...room.toObject(),
      pricePerNight: first?.priceOverride ?? room.pricePerNight,
      availableRooms: minAvailable,
    });
  }
  return enriched;
}

export async function getRoom(id: string) {
  return assertFound(await Room.findById(id), 'Room not found');
}

/**
 * Room fields a provider may edit. `availableRooms`/`bookedRooms` are booking-driven and
 * derived respectively; `hotelId`/`providerId` are identity fields.
 */
const ROOM_PROVIDER_FIELDS = [
  'name',
  'roomType',
  'bedType',
  'capacity',
  'size',
  'pricePerNight',
  'totalRooms',
  'amenities',
  'breakfastIncluded',
  'cancellationPolicy',
  'images',
  'status',
] as const;

export async function updateRoom(providerId: string, id: string, patch: Record<string, unknown>) {
  const room = await assertRoomOwnedByProvider(id, providerId);

  const update: Record<string, unknown> = {};
  for (const field of ROOM_PROVIDER_FIELDS) {
    if (patch[field] !== undefined) update[field] = patch[field];
  }
  if (typeof patch.sizeSqm === 'number') update.size = patch.sizeSqm;
  if (typeof patch.quantity === 'number') update.totalRooms = patch.quantity;
  if (patch.freeCancellation === true) update.cancellationPolicy = 'Free cancellation';
  if (patch.freeCancellation === false) update.cancellationPolicy = 'Non-refundable';
  if (patch.available === true) update.status = 'active';
  if (patch.available === false) update.status = 'inactive';

  const nextTotal = typeof update.totalRooms === 'number' ? Number(update.totalRooms) : room.totalRooms;
  if (typeof update.totalRooms === 'number') {
    const delta = nextTotal - room.totalRooms;
    room.availableRooms = Math.max(0, Math.min(nextTotal, room.availableRooms + delta));
  }

  Object.assign(room, update);
  await room.save();
  return room;
}

export async function deleteRoom(providerId: string, id: string) {
  const room = await assertRoomOwnedByProvider(id, providerId);
  room.status = 'inactive';
  await room.save();
  return room;
}

export async function getRoomAvailability(roomId: string, providerId?: string) {
  if (providerId) await assertRoomOwnedByProvider(roomId, providerId);
  return RoomAvailability.find({ roomId }).sort({ date: 1 });
}

export async function upsertAvailability(
  providerId: string,
  roomId: string,
  date: string,
  patch: Partial<{
    totalRooms: number;
    blockedRooms: number;
    priceOverride: number;
  }>
) {
  const room = await assertRoomOwnedByProvider(roomId, providerId);
  const day = await RoomAvailability.findOne({ roomId, date });
  const total = patch.totalRooms ?? day?.totalRooms ?? room.totalRooms;
  // `bookedRooms` is booking-driven and `availableRooms` is derived — never provider-set.
  const booked = day?.bookedRooms ?? 0;
  const blocked = patch.blockedRooms ?? day?.blockedRooms ?? 0;
  const available = Math.max(0, total - booked - blocked);

  if (available < 0 || booked + blocked > total) {
    throw new AppError('Invalid availability values', 400);
  }

  return RoomAvailability.findOneAndUpdate(
    { roomId, date },
    {
      $set: {
        totalRooms: total,
        bookedRooms: booked,
        blockedRooms: blocked,
        availableRooms: available,
        ...(patch.priceOverride != null ? { priceOverride: patch.priceOverride } : {}),
      },
    },
    { upsert: true, new: true }
  );
}

export async function blockRooms(providerId: string, roomId: string, date: string, count: number) {
  if (!Number.isInteger(count) || count < 1) {
    throw new AppError('count must be a positive integer', 422);
  }
  const room = await assertRoomOwnedByProvider(roomId, providerId);
  const snap = await getNightSnapshot(roomId, date, room);
  if (count > snap.availableRooms) throw new AppError('Not enough rooms to block', 400);
  return upsertAvailability(providerId, roomId, date, {
    totalRooms: snap.totalRooms,
    blockedRooms: snap.blockedRooms + count,
  });
}

export async function unblockRooms(providerId: string, roomId: string, date: string, count: number) {
  if (!Number.isInteger(count) || count < 1) {
    throw new AppError('count must be a positive integer', 422);
  }
  await assertRoomOwnedByProvider(roomId, providerId);
  const day = assertFound(await RoomAvailability.findOne({ roomId, date }), 'Availability not found');
  const blocked = Math.max(0, day.blockedRooms - count);
  const released = day.blockedRooms - blocked;
  day.blockedRooms = blocked;
  day.availableRooms += released;
  await day.save();
  return day;
}

export async function bulkUpsertAvailability(
  providerId: string,
  input: {
    roomId: string;
    from: string;
    to: string;
    totalRooms?: number;
    priceOverride?: number;
    block?: boolean;
    unblock?: boolean;
    blockCount?: number;
  }
) {
  const room = await assertRoomOwnedByProvider(input.roomId, providerId);
  const dates = datesBetween(input.from, input.to);
  if (dates.length === 0) throw new AppError('Invalid date range', 400);
  if (dates.length > 120) throw new AppError('Date range too large (max 120 nights)', 400);

  const results = [];
  for (const date of dates) {
    if (input.block) {
      results.push(
        await blockRooms(providerId, input.roomId, date, input.blockCount ?? room.totalRooms)
      );
      continue;
    }
    if (input.unblock) {
      const day = await RoomAvailability.findOne({ roomId: input.roomId, date });
      if (day?.blockedRooms) {
        results.push(
          await unblockRooms(providerId, input.roomId, date, input.blockCount ?? day.blockedRooms)
        );
      }
      continue;
    }
    const snap = await getNightSnapshot(input.roomId, date, room);
    results.push(
      await upsertAvailability(providerId, input.roomId, date, {
        totalRooms: input.totalRooms ?? snap.totalRooms,
        blockedRooms: snap.blockedRooms,
        ...(input.priceOverride != null ? { priceOverride: input.priceOverride } : {}),
      })
    );
  }
  return results;
}

export async function ensureRoomAvailabilityForRange(
  roomId: string,
  checkIn: string,
  checkOut: string,
  roomsNeeded: number
) {
  const room = assertFound(await Room.findById(roomId), 'Room not found');
  const dates = datesBetween(checkIn, checkOut);
  if (dates.length === 0) throw new AppError('Invalid date range', 400);

  for (const date of dates) {
    const snap = await getNightSnapshot(roomId, date, room);
    if (snap.availableRooms < roomsNeeded) {
      throw new AppError(
        'This room is no longer available for one or more selected nights.',
        409
      );
    }
  }
  return { room, nights: dates.length, dates };
}

async function atomicallyReserveNight(
  roomId: string,
  date: string,
  roomsNeeded: number,
  room: IRoom
) {
  const updated = await RoomAvailability.findOneAndUpdate(
    { roomId, date, availableRooms: { $gte: roomsNeeded } },
    { $inc: { bookedRooms: roomsNeeded, availableRooms: -roomsNeeded } },
    { new: true }
  );
  if (updated) return updated;

  const existing = await RoomAvailability.findOne({ roomId, date });
  if (existing) {
    throw new AppError(
      'This room is no longer available for one or more selected nights.',
      409
    );
  }

  if (room.totalRooms < roomsNeeded) {
    throw new AppError(
      'This room is no longer available for one or more selected nights.',
      409
    );
  }

  try {
    return await RoomAvailability.create({
      roomId,
      date,
      totalRooms: room.totalRooms,
      bookedRooms: roomsNeeded,
      blockedRooms: 0,
      availableRooms: room.totalRooms - roomsNeeded,
    });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code: number }).code === 11000) {
      return atomicallyReserveNight(roomId, date, roomsNeeded, room);
    }
    throw error;
  }
}

export async function reserveRoomsForRange(
  roomId: string,
  checkIn: string,
  checkOut: string,
  roomsNeeded: number
) {
  const { room, dates, nights } = await ensureRoomAvailabilityForRange(
    roomId,
    checkIn,
    checkOut,
    roomsNeeded
  );

  const reservedDates: string[] = [];
  try {
    for (const date of dates) {
      await atomicallyReserveNight(roomId, date, roomsNeeded, room);
      reservedDates.push(date);
    }
  } catch (error) {
    if (reservedDates.length) {
      // Roll back ONLY the nights this call actually reserved. Releasing the whole
      // requested range would decrement nights held by other bookings (their
      // `bookedRooms` still satisfies the guard), silently overbooking the hotel.
      await releaseSpecificDates(roomId, reservedDates, roomsNeeded).catch((rollbackError) => {
        // A failed rollback means inventory is now wrong and a human must look at it.
        // Log loudly; still re-throw the original error to the caller.
        log().error(
          { roomId, dates: reservedDates, roomsNeeded, err: rollbackError },
          '[hotel] inventory rollback failed'
        );
      });
    }
    throw error;
  }

  return { room, nights, dates };
}

/** Release a specific list of nights. Only nights with at least `roomsCount` booked are touched. */
export async function releaseSpecificDates(roomId: string, dates: string[], roomsCount: number) {
  const room = assertFound(await Room.findById(roomId), 'Room not found');
  for (const date of dates) {
    await RoomAvailability.findOneAndUpdate(
      { roomId, date, bookedRooms: { $gte: roomsCount } },
      { $inc: { bookedRooms: -roomsCount, availableRooms: roomsCount } }
    );
  }
  return { room, dates };
}

export async function releaseRoomsForRange(
  roomId: string,
  checkIn: string,
  checkOut: string,
  roomsCount: number
) {
  const dates = datesBetween(checkIn, checkOut);
  return releaseSpecificDates(roomId, dates, roomsCount);
}

export async function calculateHotelSubtotal(
  roomId: string,
  checkIn: string,
  checkOut: string,
  roomsCount: number
) {
  const room = assertFound(await Room.findById(roomId), 'Room not found');
  const dates = datesBetween(checkIn, checkOut);
  if (dates.length === 0) throw new AppError('Invalid date range', 400);

  const snaps = await getNightSnapshotsForRange(roomId, dates, room);
  let subtotal = 0;
  const nightlyRates: Array<{ date: string; rate: number }> = [];

  for (const date of dates) {
    const snap = snaps.get(date);
    const rate = snap?.priceOverride ?? room.pricePerNight;
    subtotal += rate * roomsCount;
    nightlyRates.push({ date, rate });
  }

  const avgNightly =
    dates.length && roomsCount
      ? Math.round(subtotal / (dates.length * roomsCount))
      : room.pricePerNight;

  return { subtotal, nights: dates.length, nightlyRates, room, pricePerNight: avgNightly };
}

export async function validateHotelBooking(input: {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
}) {
  const hotel = assertFound(await Hotel.findById(input.hotelId), 'Hotel not found');
  if (hotel.status !== 'active') throw new AppError('Hotel is not available for booking', 400);
  if (hotel.approvalStatus === 'pending' || hotel.approvalStatus === 'rejected') {
    throw new AppError('Hotel is not approved for bookings', 400);
  }
  if (hotel.approvalStatus === 'suspended') {
    throw new AppError('Hotel is temporarily unavailable', 400);
  }

  const room = assertFound(await Room.findById(input.roomId), 'Room not found');
  if (room.hotelId.toString() !== input.hotelId) {
    throw new AppError('Room does not belong to this hotel', 400);
  }
  if (room.status !== 'active') throw new AppError('Room is not available', 400);
  if (input.guests > room.capacity * input.rooms) {
    throw new AppError('Too many guests for the selected rooms', 400);
  }

  await ensureRoomAvailabilityForRange(input.roomId, input.checkIn, input.checkOut, input.rooms);
  return { hotel, room };
}

export async function getHotelQuote(input: {
  hotelId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guests: number;
}) {
  await validateHotelBooking(input);
  return calculateHotelSubtotal(input.roomId, input.checkIn, input.checkOut, input.rooms);
}

export async function setHotelApprovalStatus(
  hotelId: string,
  status: IHotel['approvalStatus'],
  reason?: string
) {
  const hotel = assertFound(await Hotel.findById(hotelId), 'Hotel not found');
  hotel.approvalStatus = status;
  hotel.rejectionReason = reason;
  if (status === 'approved') {
    hotel.status = 'active';
    hotel.isVerified = true;
  } else if (status === 'rejected' || status === 'suspended') {
    hotel.status = 'inactive';
    hotel.isVerified = false;
  } else if (status === 'pending' || status === 'changes_requested') {
    hotel.isVerified = false;
  }
  await hotel.save();
  return hotel;
}

export async function getProviderHotelDashboard(providerId: string) {
  const hotels = await Hotel.find({ providerId });
  const hotelIds = hotels.map((h) => h._id);
  const rooms = await Room.find({ providerId, status: 'active' });
  const today = new Date().toISOString().slice(0, 10);

  const bookings = await Booking.find({
    providerId,
    bookingType: 'hotel',
    bookingStatus: { $in: ['pending', 'confirmed', 'completed'] },
  });

  const todayBookings = bookings.filter((b) => b.createdAt.toISOString().slice(0, 10) === today);
  const checkInsToday = bookings.filter(
    (b) => b.hotelBooking?.checkIn === today && ['confirmed', 'pending'].includes(b.bookingStatus)
  );
  const checkOutsToday = bookings.filter(
    (b) =>
      b.hotelBooking?.checkOut === today &&
      ['confirmed', 'completed'].includes(b.bookingStatus)
  );
  const revenue = bookings
    .filter((b) => ['confirmed', 'completed'].includes(b.bookingStatus))
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return {
    hotels: hotels.length,
    rooms: rooms.reduce((sum, r) => sum + r.totalRooms, 0),
    availableRooms: rooms.reduce((sum, r) => sum + r.availableRooms, 0),
    todayBookings: todayBookings.length,
    checkInsToday: checkInsToday.length,
    checkOutsToday: checkOutsToday.length,
    revenue,
    rating:
      hotels.length > 0
        ? Math.round((hotels.reduce((sum, h) => sum + h.rating, 0) / hotels.length) * 10) / 10
        : 0,
    pendingHotels: hotels.filter((h) => h.approvalStatus === 'pending').length,
    hotelIds,
  };
}

export async function lookupBookingByCode(bookingNumber: string, providerId: string) {
  const booking = assertFound(
    await Booking.findOne({ bookingNumber, providerId, bookingType: 'hotel' }),
    'Booking not found'
  );
  return booking;
}

export async function providerCheckIn(bookingId: string, providerId: string) {
  const booking = assertFound(await Booking.findById(bookingId), 'Booking not found');
  if (booking.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  if (booking.bookingType !== 'hotel') throw new AppError('Not a hotel booking', 400);
  if (booking.bookingStatus === 'cancelled') throw new AppError('Booking is cancelled', 400);
  if (booking.bookingStatus !== 'confirmed') {
    throw new AppError('Only confirmed bookings can be checked in', 400);
  }
  if (booking.hotelBooking) {
    booking.hotelBooking = { ...booking.hotelBooking, stayStatus: 'checked_in' };
  }
  await booking.save();
  return booking;
}

export async function providerCheckOut(bookingId: string, providerId: string) {
  const booking = assertFound(await Booking.findById(bookingId), 'Booking not found');
  if (booking.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  if (booking.bookingType !== 'hotel') throw new AppError('Not a hotel booking', 400);
  if (booking.hotelBooking?.stayStatus !== 'checked_in') {
    throw new AppError('Guest must be checked in first', 400);
  }
  if (booking.hotelBooking) {
    booking.hotelBooking = { ...booking.hotelBooking, stayStatus: 'checked_out' };
  }
  booking.bookingStatus = 'completed';
  await booking.save();
  return booking;
}
