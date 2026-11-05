import { Trip } from '../models/Trip';
import type { ClientSession } from 'mongoose';
import { AppError, assertFound } from '../utils/AppError';

/**
 * Atomically reserves seats with a single conditional update (no read-check-write).
 *
 * Counter semantics (applied consistently across reserve/confirm/release):
 *   availableSeats = seats in `available`
 *   bookedSeats    = seats in `reserved` OR `booked`
 *
 * Soft-hold (`reserved`) is used while P2P payment awaits provider approval.
 * Seats become `booked` only after payment is confirmed.
 */
export async function reserveTripSeats(tripId: string, seats: string[]) {
  const unique = [...new Set(seats)];

  const trip = await Trip.findOneAndUpdate(
    {
      _id: tripId,
      status: { $ne: 'cancelled' },
      $and: unique.map((seatNumber) => ({
        seatLayout: { $elemMatch: { seatNumber, status: 'available' } },
      })),
    },
    {
      $set: { 'seatLayout.$[s].status': 'reserved' },
      $inc: { availableSeats: -unique.length, bookedSeats: unique.length },
    },
    {
      arrayFilters: [{ 's.seatNumber': { $in: unique } }],
      new: true,
    }
  );

  if (!trip) {
    const existing = await Trip.findById(tripId);
    if (!existing) throw new AppError('Trip not found', 404);
    if (existing.status === 'cancelled') throw new AppError('Trip is cancelled', 400);
    const missing = unique.find(
      (seatNumber) => !existing.seatLayout.some((s) => s.seatNumber === seatNumber)
    );
    if (missing) throw new AppError(`Seat ${missing} does not exist`, 400);
    const taken = unique.find((seatNumber) => {
      const seat = existing.seatLayout.find((s) => s.seatNumber === seatNumber);
      return seat?.status !== 'available';
    });
    if (taken) throw new AppError(`Seat ${taken} is not available`, 409);
    throw new AppError('Seats could not be reserved', 409);
  }

  return trip;
}

/** Finalize soft-hold → booked (after provider confirms payment / approves booking). */
export async function confirmTripSeats(tripId: string, seats: string[], session?: ClientSession) {
  const unique = [...new Set(seats)];
  const trip = await Trip.findOneAndUpdate(
    {
      _id: tripId,
      $and: unique.map((seatNumber) => ({
        seatLayout: { $elemMatch: { seatNumber, status: 'reserved' } },
      })),
    },
    { $set: { 'seatLayout.$[s].status': 'booked' } },
    { arrayFilters: [{ 's.seatNumber': { $in: unique } }], new: true, session }
  );

  if (!trip) {
    if (session) throw new AppError('Seat reservation is no longer available', 409);
    const existing = await Trip.findById(tripId);
    if (!existing) throw new AppError('Trip not found', 404);
    return existing;
  }
  return trip;
}

/** Release reserved/booked seats back to available (cancel / expire / reject). */
export async function releaseTripSeats(tripId: string, seats: string[], session?: ClientSession) {
  const unique = [...new Set(seats)];
  const trip = await Trip.findOneAndUpdate(
    {
      _id: tripId,
      $and: unique.map((seatNumber) => ({
        seatLayout: { $elemMatch: { seatNumber, status: { $in: ['reserved', 'booked'] } } },
      })),
    },
    {
      $set: { 'seatLayout.$[s].status': 'available' },
      $inc: { availableSeats: unique.length, bookedSeats: -unique.length },
    },
    { arrayFilters: [{ 's.seatNumber': { $in: unique } }], new: true, session }
  );

  if (!trip) {
    const existing = await Trip.findById(tripId);
    if (!existing) throw new AppError('Trip not found', 404);
    return existing;
  }
  return trip;
}

export async function recomputeTripSeatCounters(tripId: string) {
  const trip = assertFound(await Trip.findById(tripId), 'Trip not found');
  trip.availableSeats = trip.seatLayout.filter((s) => s.status === 'available').length;
  trip.bookedSeats = trip.seatLayout.filter(
    (s) => s.status === 'reserved' || s.status === 'booked'
  ).length;
  await trip.save();
  return trip;
}
