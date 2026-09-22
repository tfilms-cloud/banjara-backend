import { env } from '../config/env';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { ProviderProfile } from '../models/ProviderProfile';
import { User } from '../models/User';
import { AppError, assertFound } from '../utils/AppError';
import { generateBookingNumber } from '../utils/bookingNumber';
import { buildTicketQrDataUrl } from '../utils/qrCode';
import { getPagination, paginatedResult } from '../utils/pagination';
import type { PaymentMethod } from '../types/booking.types';
import * as hotelService from './hotel.service';
import * as paymentService from './payment.service';
import * as notificationService from './notification.service';

function calcPricing(subtotal: number, discount = 0) {
  const tax = Math.round(subtotal * env.TAX_RATE);
  const serviceFee = env.SERVICE_FEE;
  const totalAmount = Math.max(0, subtotal + tax + serviceFee - discount);
  return { subtotal, tax, serviceFee, discount, totalAmount, currency: 'PKR' };
}

async function reserveTripSeats(tripId: string, seats: string[]) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new AppError('Trip not found', 404);
  if (trip.status === 'cancelled') throw new AppError('Trip is cancelled', 400);

  for (const seatNumber of seats) {
    const seat = trip.seatLayout.find((s: { seatNumber: string; status: string }) => s.seatNumber === seatNumber);
    if (!seat) throw new AppError(`Seat ${seatNumber} does not exist`, 400);
    if (seat.status !== 'available') throw new AppError(`Seat ${seatNumber} is not available`, 409);
    seat.status = 'reserved';
  }

  trip.availableSeats = trip.seatLayout.filter((s: { status: string }) => s.status === 'available').length;
  trip.bookedSeats = trip.seatLayout.filter(
    (s: { status: string }) => s.status === 'booked' || s.status === 'reserved'
  ).length;
  await trip.save();
  return trip;
}

async function confirmTripSeats(tripId: string, seats: string[]) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new AppError('Trip not found', 404);
  for (const seatNumber of seats) {
    const seat = trip.seatLayout.find((s: { seatNumber: string; status: string }) => s.seatNumber === seatNumber);
    if (seat) seat.status = 'booked';
  }
  trip.availableSeats = trip.seatLayout.filter((s: { status: string }) => s.status === 'available').length;
  trip.bookedSeats = trip.seatLayout.filter((s: { status: string }) => s.status === 'booked').length;
  await trip.save();
  return trip;
}

async function releaseTripSeats(tripId: string, seats: string[]) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new AppError('Trip not found', 404);
  for (const seatNumber of seats) {
    const seat = trip.seatLayout.find((s: { seatNumber: string; status: string }) => s.seatNumber === seatNumber);
    if (seat && (seat.status === 'reserved' || seat.status === 'booked')) seat.status = 'available';
  }
  trip.availableSeats = trip.seatLayout.filter((s: { status: string }) => s.status === 'available').length;
  trip.bookedSeats = trip.seatLayout.filter((s: { status: string }) => s.status === 'booked').length;
  await trip.save();
  return trip;
}

export async function createBooking(
  customerId: string,
  input: {
    bookingType: 'transport' | 'hotel' | 'package';
    paymentMethod: PaymentMethod;
    transportBooking?: {
      tripId: string;
      seats: string[];
      pickupPoint?: string;
      dropoffPoint?: string;
      passengerDetails: { name: string; phone?: string }[];
    };
    hotelBooking?: {
      hotelId: string;
      roomId: string;
      checkIn: string;
      checkOut: string;
      rooms: number;
      guests: number;
      guestDetails: {
        name: string;
        email: string;
        phone: string;
        specialRequests?: string;
      };
    };
  }
) {
  // Note: wrap in MongoDB transactions when running a replica set in production.
  let providerId = '';
  let pricing = calcPricing(0);
  let transportBooking;
  let hotelBooking;
  let reservedTripSeats: string[] | null = null;
  let reservedHotel: { roomId: string; checkIn: string; checkOut: string; rooms: number } | null = null;

  try {
    if (input.bookingType === 'transport') {
      if (!input.transportBooking) throw new AppError('Transport booking details required', 400);
      const trip = await reserveTripSeats(
        input.transportBooking.tripId,
        input.transportBooking.seats
      );
      reservedTripSeats = input.transportBooking.seats;
      providerId = trip.providerId.toString();
      pricing = calcPricing(trip.price * input.transportBooking.seats.length);
      transportBooking = {
        ...input.transportBooking,
        vehicleId: trip.vehicleId.toString(),
      };
    } else if (input.bookingType === 'hotel') {
      if (!input.hotelBooking) throw new AppError('Hotel booking details required', 400);
      await hotelService.validateHotelBooking(input.hotelBooking);
      const reserved = await hotelService.reserveRoomsForRange(
        input.hotelBooking.roomId,
        input.hotelBooking.checkIn,
        input.hotelBooking.checkOut,
        input.hotelBooking.rooms
      );
      reservedHotel = {
        roomId: input.hotelBooking.roomId,
        checkIn: input.hotelBooking.checkIn,
        checkOut: input.hotelBooking.checkOut,
        rooms: input.hotelBooking.rooms,
      };
      providerId = reserved.room.providerId.toString();
      const priced = await hotelService.calculateHotelSubtotal(
        input.hotelBooking.roomId,
        input.hotelBooking.checkIn,
        input.hotelBooking.checkOut,
        input.hotelBooking.rooms
      );
      pricing = calcPricing(priced.subtotal);
      hotelBooking = {
        ...input.hotelBooking,
        nights: priced.nights,
        pricePerNight: priced.pricePerNight,
        nightlyRates: priced.nightlyRates,
        stayStatus: 'booked' as const,
      };
    } else {
      throw new AppError('Package bookings are not enabled yet', 400);
    }

    const bookingNumber = await generateBookingNumber();
    const booking = await Booking.create({
      bookingNumber,
      customerId,
      providerId,
      bookingType: input.bookingType,
      transportBooking,
      hotelBooking,
      ...pricing,
      paymentStatus: 'pending',
      bookingStatus: 'pending',
    });

    const payment = await paymentService.createPayment({
      bookingId: booking._id.toString(),
      customerId,
      providerId,
      amount: pricing.totalAmount,
      method: input.paymentMethod,
    });

    const verified = await paymentService.verifyPayment(payment._id.toString());

    booking.paymentStatus = verified.status === 'paid' ? 'paid' : verified.status;
    booking.bookingStatus = 'confirmed';
    booking.paymentId = verified._id;
    booking.ticketQr = buildTicketQrDataUrl(booking.bookingNumber);
    await booking.save();

    if (input.bookingType === 'transport' && input.transportBooking) {
      await confirmTripSeats(input.transportBooking.tripId, input.transportBooking.seats);
    }

    await notificationService.createNotification({
      userId: customerId,
      type: 'bookingConfirmed',
      title: 'Booking confirmed',
      message: `Your booking ${booking.bookingNumber} is confirmed.`,
      data: { bookingId: booking._id.toString() },
    });

    return booking;
  } catch (error) {
    if (reservedTripSeats && input.transportBooking) {
      await releaseTripSeats(input.transportBooking.tripId, reservedTripSeats).catch(() => undefined);
    }
    if (reservedHotel) {
      await hotelService
        .releaseRoomsForRange(
          reservedHotel.roomId,
          reservedHotel.checkIn,
          reservedHotel.checkOut,
          reservedHotel.rooms
        )
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function getBooking(id: string, requester?: { id: string; role: string; providerId?: string }) {
  const booking = await Booking.findById(id);
  if (!booking) throw new AppError('Booking not found', 404);
  if (requester) {
    const isOwner = booking.customerId.toString() === requester.id;
    const isProvider = requester.providerId === booking.providerId.toString();
    const isAdmin = requester.role === 'admin';
    if (!isOwner && !isProvider && !isAdmin) throw new AppError('Forbidden', 403);
  }
  return booking;
}

/** Attach chat counterpart ids for API clients without mutating the mongoose doc. */
export async function serializeBooking(booking: InstanceType<typeof Booking>) {
  const provider = await ProviderProfile.findById(booking.providerId).select('userId businessName');
  const customer = await User.findById(booking.customerId).select('name email phone');
  const doc = booking.toObject();
  return {
    ...doc,
    id: booking._id.toString(),
    customerId: booking.customerId.toString(),
    providerId: booking.providerId.toString(),
    providerUserId: provider?.userId?.toString() ?? null,
    providerBusinessName: provider?.businessName ?? null,
    customerName: customer?.name ?? null,
    customerPhone: customer?.phone ?? null,
    customerEmail: customer?.email ?? null,
  };
}

export async function getMyBookings(customerId: string, query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query);
  const filter = { customerId };
  const [items, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Booking.countDocuments(filter),
  ]);
  return paginatedResult(items, total, page, limit);
}

export async function getProviderBookings(providerId: string, query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query);
  const filter = { providerId };
  const [items, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Booking.countDocuments(filter),
  ]);
  return paginatedResult(items, total, page, limit);
}

export async function cancelBooking(
  id: string,
  requester: { id: string; role: string; providerId?: string }
) {
  const booking = await getBooking(id, requester);
  if (booking.bookingStatus === 'cancelled') return booking;
  if (booking.bookingStatus === 'completed') {
    throw new AppError('Completed bookings cannot be cancelled', 400);
  }

  booking.bookingStatus = 'cancelled';
  if (booking.paymentStatus === 'paid') {
    booking.paymentStatus = 'refunded';
    if (booking.paymentId) {
      await paymentService.refundPayment(booking.paymentId.toString());
    }
  }

  if (booking.bookingType === 'transport' && booking.transportBooking) {
    await releaseTripSeats(booking.transportBooking.tripId, booking.transportBooking.seats);
  }
  if (booking.bookingType === 'hotel' && booking.hotelBooking) {
    await hotelService.releaseRoomsForRange(
      booking.hotelBooking.roomId,
      booking.hotelBooking.checkIn,
      booking.hotelBooking.checkOut,
      booking.hotelBooking.rooms
    );
  }

  await booking.save();
  await notificationService.createNotification({
    userId: booking.customerId.toString(),
    type: 'bookingCancelled',
    title: 'Booking cancelled',
    message: `Booking ${booking.bookingNumber} was cancelled.`,
    data: { bookingId: booking._id.toString() },
  });
  return booking;
}

export async function getTicket(id: string, requester: { id: string; role: string; providerId?: string }) {
  const booking = await getBooking(id, requester);
  if (booking.bookingStatus !== 'confirmed' && booking.bookingStatus !== 'completed') {
    throw new AppError('Ticket available only for confirmed bookings', 400);
  }
  return {
    bookingNumber: booking.bookingNumber,
    bookingType: booking.bookingType,
    customerId: booking.customerId,
    providerId: booking.providerId,
    transportBooking: booking.transportBooking,
    hotelBooking: booking.hotelBooking,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.bookingStatus,
    qrCode: booking.ticketQr ?? buildTicketQrDataUrl(booking.bookingNumber),
    createdAt: booking.createdAt,
  };
}

export async function getProviderEarnings(providerId: string) {
  const bookings = await Booking.find({
    providerId,
    bookingStatus: { $in: ['confirmed', 'completed'] },
  });

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const sum = (list: typeof bookings) => list.reduce((acc, b) => acc + b.totalAmount, 0);
  const totalRevenue = sum(bookings);
  const today = sum(bookings.filter((b) => b.createdAt >= startOfDay));
  const thisWeek = sum(bookings.filter((b) => b.createdAt >= startOfWeek));
  const thisMonth = sum(bookings.filter((b) => b.createdAt >= startOfMonth));
  const platformFees = Math.round(totalRevenue * env.PLATFORM_FEE_RATE);
  const pendingPayout = Math.round(thisMonth * (1 - env.PLATFORM_FEE_RATE));

  return {
    totalRevenue,
    today,
    thisWeek,
    thisMonth,
    todayRevenue: today,
    weeklyRevenue: thisWeek,
    monthlyRevenue: thisMonth,
    pendingPayout,
    completedPayout: Math.max(0, totalRevenue - platformFees - pendingPayout),
    platformFees,
    netEarnings: totalRevenue - platformFees,
  };
}

export async function updateProviderBookingStatus(
  bookingId: string,
  providerId: string,
  status: 'confirmed' | 'cancelled' | 'completed' | 'rejected'
) {
  const booking = assertFound(await Booking.findById(bookingId), 'Booking not found');
  if (booking.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);

  if (status === 'rejected') {
    if (booking.bookingStatus === 'cancelled') return booking;
    booking.bookingStatus = 'cancelled';
    if (booking.paymentStatus === 'paid') {
      booking.paymentStatus = 'refunded';
      if (booking.paymentId) {
        await paymentService.refundPayment(booking.paymentId.toString());
      }
    }
    if (booking.bookingType === 'transport' && booking.transportBooking) {
      await releaseTripSeats(booking.transportBooking.tripId, booking.transportBooking.seats);
    }
    if (booking.bookingType === 'hotel' && booking.hotelBooking) {
      await hotelService.releaseRoomsForRange(
        booking.hotelBooking.roomId,
        booking.hotelBooking.checkIn,
        booking.hotelBooking.checkOut,
        booking.hotelBooking.rooms
      );
    }
    await booking.save();
    await notificationService.createNotification({
      userId: booking.customerId.toString(),
      type: 'bookingCancelled',
      title: 'Booking rejected',
      message: `Booking ${booking.bookingNumber} was rejected by the provider.`,
      data: { bookingId: booking._id.toString() },
    });
    return booking;
  }

  if (status === 'cancelled') {
    return cancelBooking(bookingId, { id: '', role: 'provider', providerId });
  }

  if (status === 'confirmed') {
    if (booking.bookingStatus === 'cancelled') {
      throw new AppError('Cancelled bookings cannot be confirmed', 400);
    }
    booking.bookingStatus = 'confirmed';
    await booking.save();
    await notificationService.createNotification({
      userId: booking.customerId.toString(),
      type: 'bookingConfirmed',
      title: 'Booking accepted',
      message: `Booking ${booking.bookingNumber} was accepted.`,
      data: { bookingId: booking._id.toString() },
    });
    return booking;
  }

  if (status === 'completed') {
    if (booking.bookingStatus !== 'confirmed') {
      throw new AppError('Only confirmed bookings can be completed', 400);
    }
    booking.bookingStatus = 'completed';
    await booking.save();
    return booking;
  }

  throw new AppError('Invalid booking status', 400);
}
