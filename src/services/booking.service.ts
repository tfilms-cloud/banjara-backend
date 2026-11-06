import { paymentTransaction } from '../utils/paymentTransaction';
import { env } from '../config/env';
import mongoose from 'mongoose';
import { Booking } from '../models/Booking';
import { Payment } from '../models/Payment';
import { Trip } from '../models/Trip';
import { ProviderProfile } from '../models/ProviderProfile';
import { User } from '../models/User';
import { PickupPoint } from '../models/PickupPoint';
import { Vehicle } from '../models/Vehicle';
import { Room } from '../models/Room';
import { Hotel } from '../models/Hotel';
import { TourItinerary } from '../models/TourItinerary';
import { AppError, assertFound } from '../utils/AppError';
import { generateBookingNumber } from '../utils/bookingNumber';
import { buildTicketQrDataUrl } from '../utils/qrCode';
import { getPagination, paginatedResult } from '../utils/pagination';
import { log } from '../utils/logger';
import type { PaymentMethod } from '../types/booking.types';
import * as hotelService from './hotel.service';
import * as paymentService from './payment.service';
import { isP2PMethod } from '../types/payment.types';
import * as notificationService from './notification.service';
import * as serviceCatalogService from './serviceCatalog.service';
import * as guideService from './guide.service';
import {
  confirmTripSeats,
  releaseTripSeats,
  reserveTripSeats,
  recomputeTripSeatCounters,
} from './tripSeat.service';

export { recomputeTripSeatCounters };

function calcPricing(subtotal: number, discount = 0) {
  const tax = Math.round(subtotal * env.TAX_RATE);
  const serviceFee = env.SERVICE_FEE;
  const totalAmount = Math.max(0, subtotal + tax + serviceFee - discount);
  return { subtotal, tax, serviceFee, discount, totalAmount, currency: 'PKR' };
}

export async function createBooking(
  customerId: string,
  input: {
    bookingType: 'transport' | 'hotel' | 'package' | 'guide';
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
    packageBooking?: {
      itineraryId: string;
      startDate: string;
      travelers: number;
      guestDetails: {
        name: string;
        email: string;
        phone: string;
        specialRequests?: string;
      };
    };
    guideBooking?: {
      providerId: string;
      serviceId?: string;
      date: string;
      startTime: string;
      endTime?: string;
      durationHours?: number;
      guests: number;
      meetingPoint?: string;
      availableLocation?: string;
      specialRequest?: string;
      guestDetails: {
        name: string;
        email: string;
        phone: string;
        specialRequests?: string;
      };
    };
  }
) {
  paymentService.assertSupportedPaymentMethod(input.paymentMethod);

  // Creation retains compensating cleanup; later payment/cancellation transitions
  // use transactions so released inventory cannot be confirmed again.
  let providerId = '';
  let pricing = calcPricing(0);
  let transportBooking;
  let hotelBooking;
  let packageBooking;
  let guideBooking;
  let reservedTripSeats: string[] | null = null;
  let reservedHotel: { roomId: string; checkIn: string; checkOut: string; rooms: number } | null = null;
  let createdBooking: InstanceType<typeof Booking> | null = null;
  let createdPaymentId: string | null = null;

  try {
    if (input.bookingType === 'transport') {
      if (!input.transportBooking) throw new AppError('Transport booking details required', 400);
      const trip = await reserveTripSeats(
        input.transportBooking.tripId,
        input.transportBooking.seats
      );
      reservedTripSeats = input.transportBooking.seats;
      providerId = trip.providerId.toString();
      // (A failed check below releases the seats just reserved: see the catch.)
      const seatCount = input.transportBooking.seats.length;
      const passengerCount = input.transportBooking.passengerDetails.length;
      if (trip.bookingMode === 'vehicle') {
        // Hiring the whole vehicle: every seat, one vehicle fare, 1+ named passengers.
        if (seatCount !== trip.totalSeats) {
          throw new AppError('This trip is booked as a whole vehicle. Book every seat.', 422);
        }
        pricing = calcPricing(trip.price);
      } else {
        if (seatCount > 10) throw new AppError('You can book up to 10 seats at a time', 422);
        if (passengerCount !== seatCount) {
          throw new AppError('Number of passengers must match number of seats', 422);
        }
        pricing = calcPricing(trip.price * seatCount);
      }
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
    } else if (input.bookingType === 'package') {
      if (!input.packageBooking) throw new AppError('Package booking details required', 400);
      const itinerary = assertFound(
        await TourItinerary.findById(input.packageBooking.itineraryId),
        'Itinerary not found'
      );
      if (itinerary.status !== 'published') {
        throw new AppError('This package is not available for booking', 400);
      }
      const travelers = Number(input.packageBooking.travelers);
      if (!Number.isFinite(travelers) || travelers < 1) {
        throw new AppError('Travelers must be at least 1', 400);
      }
      if (travelers > itinerary.maxParticipants) {
        throw new AppError(
          `Maximum ${itinerary.maxParticipants} travelers allowed for this package`,
          400
        );
      }
      const startDate = String(input.packageBooking.startDate).trim();
      const start = new Date(startDate);
      if (Number.isNaN(start.getTime())) {
        throw new AppError('Invalid start date', 400);
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today) {
        throw new AppError('Start date must be today or later', 400);
      }

      providerId = itinerary.providerId.toString();
      pricing = calcPricing(itinerary.pricePerPerson * travelers);
      packageBooking = {
        itineraryId: itinerary._id.toString(),
        startDate,
        travelers,
        guestDetails: input.packageBooking.guestDetails,
        title: itinerary.title,
        tourType: itinerary.tourType,
        destination: itinerary.destination,
        durationDays: itinerary.durationDays,
        pricePerPerson: itinerary.pricePerPerson,
        currency: itinerary.currency || 'PKR',
      };
    } else if (input.bookingType === 'guide') {
      if (!input.guideBooking) throw new AppError('Guide booking details required', 400);
      const prepared = await guideService.prepareGuideBooking(input.guideBooking);
      providerId = prepared.providerId;
      pricing = calcPricing(prepared.subtotal);
      guideBooking = prepared.guideBooking;
    } else {
      throw new AppError('Unsupported booking type', 400);
    }

    const bookingNumber = await generateBookingNumber();
    createdBooking = await Booking.create({
      bookingNumber,
      customerId,
      providerId,
      bookingType: input.bookingType,
      transportBooking,
      hotelBooking,
      packageBooking,
      guideBooking,
      ...pricing,
      paymentStatus: 'pending',
      bookingStatus: 'pending',
    });

    const payment = await paymentService.createPayment({
      bookingId: createdBooking._id.toString(),
      customerId,
      providerId,
      amount: pricing.totalAmount,
      method: input.paymentMethod,
    });
    createdPaymentId = payment._id.toString();

    // Pay-later remains pending; transfers require proof and provider verification.
    // P2P (bank/Easypaisa/JazzCash/Raast): stay unpaid until proof + provider confirm.
    let verified = payment;
    if (!isP2PMethod(input.paymentMethod)) {
      verified = await paymentService.verifyPayment(createdPaymentId);
    }

    createdBooking.paymentStatus =
      verified.status === 'paid' || verified.status === 'confirmed'
        ? 'paid'
        : (verified.status as typeof createdBooking.paymentStatus);
    createdBooking.paymentId = verified._id;

    // All services stay pending until the provider approves (or P2P confirms).
    createdBooking.bookingStatus = 'pending';
    await createdBooking.save();
  } catch (error) {
    // Compensate in reverse order. Best-effort: a compensation failure is logged but
    // must never mask the original error.
    if (createdPaymentId) {
      await paymentService.refundPaymentAsSystem(createdPaymentId).catch((refundError) => {
        log().error({ paymentId: createdPaymentId, err: refundError }, '[booking] payment compensation failed');
      });
    }
    if (createdBooking) {
      await Booking.findByIdAndUpdate(createdBooking._id, {
        bookingStatus: 'cancelled',
        paymentStatus: 'failed',
      }).catch((updateError) => {
        log().error({ bookingId: createdBooking?._id.toString(), err: updateError }, '[booking] booking compensation failed');
      });
    }
    if (reservedTripSeats && input.transportBooking) {
      await releaseTripSeats(input.transportBooking.tripId, reservedTripSeats).catch((releaseError) => {
        log().error({ tripId: input.transportBooking?.tripId, seats: reservedTripSeats, err: releaseError }, '[booking] seat release failed');
      });
    }
    if (reservedHotel) {
      await hotelService
        .releaseRoomsForRange(
          reservedHotel.roomId,
          reservedHotel.checkIn,
          reservedHotel.checkOut,
          reservedHotel.rooms
        )
        .catch((releaseError) => {
          log().error({ ...reservedHotel, err: releaseError }, '[booking] room release failed');
        });
    }
    throw error;
  }

  const booking = assertFound(createdBooking, 'Booking not created');

  const isPendingApproval = booking.bookingStatus === 'pending';

  // Non-critical side effects: notification failures must never roll back the booking.
  await notificationService
    .createNotification({
      userId: customerId,
      type: isPendingApproval ? 'bookingPending' : 'bookingConfirmed',
      title: isPendingApproval ? 'Booking pending approval' : 'Booking confirmed',
      message: isPendingApproval
        ? `Your booking ${booking.bookingNumber} is waiting for the provider to approve.`
        : `Your booking ${booking.bookingNumber} is confirmed.`,
      data: { bookingId: booking._id.toString() },
    })
    .catch((notificationError) => {
      log().error(
        { bookingId: booking._id.toString(), err: notificationError },
        '[booking] customer notification failed'
      );
    });

  if (isPendingApproval) {
    const provider = await ProviderProfile.findById(providerId).select('userId businessName').lean();
    if (provider?.userId) {
      await notificationService
        .createNotification({
          userId: provider.userId.toString(),
          type: 'bookingRequest',
          title: 'New booking request',
          message: `Booking ${booking.bookingNumber} needs your approval.`,
          data: { bookingId: booking._id.toString() },
        })
        .catch((notificationError) => {
          log().error(
            { bookingId: booking._id.toString(), err: notificationError },
            '[booking] provider notification failed'
          );
        });
    }
  }

  return serializeBooking(booking);
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
  const [enriched] = await enrichBookings([booking]);
  return enriched;
}

/**
 * Batch-enrich bookings with customer, trip route/time, pickup names, vehicle, and hotel info.
 * Used by provider list + booking detail so the app never invents placeholder data.
 */
export async function enrichBookings(bookings: Array<InstanceType<typeof Booking> | Record<string, unknown>>) {
  if (!bookings.length) return [];

  const docs = bookings.map((b) => ('toObject' in b && typeof b.toObject === 'function' ? b.toObject() : b)) as Array<
    Record<string, unknown> & {
      _id: mongoose.Types.ObjectId;
      customerId: mongoose.Types.ObjectId | string;
      providerId: mongoose.Types.ObjectId | string;
      paymentId?: mongoose.Types.ObjectId | string;
      transportBooking?: Record<string, unknown>;
      hotelBooking?: Record<string, unknown>;
      packageBooking?: Record<string, unknown>;
    }
  >;

  const customerIds = [...new Set(docs.map((d) => String(d.customerId)).filter(Boolean))];
  const providerIds = [...new Set(docs.map((d) => String(d.providerId)).filter(Boolean))];
  const tripIds = [
    ...new Set(
      docs
        .map((d) => String(d.transportBooking?.tripId ?? ''))
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  const pickupIds = [
    ...new Set(
      docs
        .flatMap((d) => [
          String(d.transportBooking?.pickupPoint ?? ''),
          String(d.transportBooking?.dropoffPoint ?? ''),
        ])
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  const hotelIds = [
    ...new Set(
      docs
        .map((d) => String(d.hotelBooking?.hotelId ?? ''))
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  const roomIds = [
    ...new Set(
      docs
        .map((d) => String(d.hotelBooking?.roomId ?? ''))
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  const itineraryIds = [
    ...new Set(
      docs
        .map((d) => String(d.packageBooking?.itineraryId ?? ''))
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];
  const paymentIds = [
    ...new Set(
      docs
        .map((d) => String(d.paymentId ?? ''))
        .filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];

  const trips = tripIds.length
    ? await Trip.find({ _id: { $in: tripIds } })
        .select(
          'origin destination departureDate departureTime arrivalTime arrivalDate journeyType returnDate returnTime bookingMode description status vehicleId'
        )
        .lean()
    : [];

  const vehicleIds = [
    ...new Set(
      [
        ...docs.map((d) => String(d.transportBooking?.vehicleId ?? '')),
        ...trips.map((t) => String(t.vehicleId ?? '')),
      ].filter((id) => id && mongoose.isValidObjectId(id))
    ),
  ];

  const [customers, providers, pickups, vehicles, hotels, rooms, itineraries, payments] =
    await Promise.all([
      customerIds.length
        ? User.find({ _id: { $in: customerIds } }).select('name email phone').lean()
        : Promise.resolve([]),
      providerIds.length
        ? ProviderProfile.find({ _id: { $in: providerIds } }).select('userId businessName').lean()
        : Promise.resolve([]),
      pickupIds.length
        ? PickupPoint.find({ _id: { $in: pickupIds } }).select('name address latitude longitude').lean()
        : Promise.resolve([]),
      vehicleIds.length
        ? Vehicle.find({ _id: { $in: vehicleIds } })
            .select('name type brand vehicleModel registrationNumber seatCount')
            .lean()
        : Promise.resolve([]),
      hotelIds.length
        ? Hotel.find({ _id: { $in: hotelIds } }).select('name city address').lean()
        : Promise.resolve([]),
      roomIds.length
        ? Room.find({ _id: { $in: roomIds } }).select('name roomType').lean()
        : Promise.resolve([]),
      itineraryIds.length
        ? TourItinerary.find({ _id: { $in: itineraryIds } })
            .select('title tourType destination durationDays coverImage pricePerPerson')
            .lean()
        : Promise.resolve([]),
      paymentIds.length
        ? Payment.find({ _id: { $in: paymentIds } }).select('method status').lean()
        : Promise.resolve([]),
    ]);

  const customerMap = new Map(customers.map((c) => [String(c._id), c]));
  const providerMap = new Map(providers.map((p) => [String(p._id), p]));
  const tripMap = new Map(trips.map((t) => [String(t._id), t]));
  const pickupMap = new Map(pickups.map((p) => [String(p._id), p]));
  const vehicleMap = new Map(vehicles.map((v) => [String(v._id), v]));
  const hotelMap = new Map(hotels.map((h) => [String(h._id), h]));
  const roomMap = new Map(rooms.map((r) => [String(r._id), r]));
  const itineraryMap = new Map(itineraries.map((i) => [String(i._id), i]));
  const paymentMap = new Map(payments.map((p) => [String(p._id), p]));

  return docs.map((doc) => {
    const customer = customerMap.get(String(doc.customerId));
    const provider = providerMap.get(String(doc.providerId));
    const transport = (doc.transportBooking ?? {}) as Record<string, unknown>;
    const hotel = (doc.hotelBooking ?? {}) as Record<string, unknown>;
    const pkg = (doc.packageBooking ?? {}) as Record<string, unknown>;
    const trip = transport.tripId ? tripMap.get(String(transport.tripId)) : undefined;
    const pickupId = String(transport.pickupPoint ?? '');
    const dropoffId = String(transport.dropoffPoint ?? '');
    const pickup = pickupId ? pickupMap.get(pickupId) : undefined;
    const dropoff = dropoffId ? pickupMap.get(dropoffId) : undefined;
    const vehicle =
      (transport.vehicleId ? vehicleMap.get(String(transport.vehicleId)) : undefined) ||
      (trip?.vehicleId ? vehicleMap.get(String(trip.vehicleId)) : undefined);
    const hotelDoc = hotel.hotelId ? hotelMap.get(String(hotel.hotelId)) : undefined;
    const roomDoc = hotel.roomId ? roomMap.get(String(hotel.roomId)) : undefined;
    const itineraryDoc = pkg.itineraryId ? itineraryMap.get(String(pkg.itineraryId)) : undefined;
    const seats = Array.isArray(transport.seats) ? transport.seats.map(String) : [];
    const passengers = Array.isArray(transport.passengerDetails)
      ? (transport.passengerDetails as Record<string, unknown>[])
      : [];

    const pickupLabel =
      pickup?.name ||
      (!mongoose.isValidObjectId(pickupId) && pickupId ? pickupId : '') ||
      '';
    const dropoffLabel =
      dropoff?.name ||
      (!mongoose.isValidObjectId(dropoffId) && dropoffId ? dropoffId : '') ||
      '';

    const packageTitle =
      (pkg.title ? String(pkg.title) : '') || itineraryDoc?.title || null;
    const packageDestination =
      (pkg.destination ? String(pkg.destination) : '') || itineraryDoc?.destination || null;

    const paymentDoc = doc.paymentId ? paymentMap.get(String(doc.paymentId)) : undefined;

    return {
      ...doc,
      id: String(doc._id),
      customerId: String(doc.customerId),
      providerId: String(doc.providerId),
      paymentId: doc.paymentId ? String(doc.paymentId) : null,
      paymentMethod: paymentDoc?.method ?? null,
      providerUserId: provider?.userId ? String(provider.userId) : null,
      providerBusinessName: provider?.businessName ?? null,
      customerName: customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      customerEmail: customer?.email ?? null,
      // Transport enrichment
      tripId: transport.tripId ? String(transport.tripId) : null,
      tripOrigin: trip?.origin ?? null,
      tripDestination: trip?.destination ?? null,
      tripDate: trip?.departureDate ?? null,
      tripDepartureTime: trip?.departureTime ?? null,
      tripArrivalTime: trip?.arrivalTime ?? null,
      tripArrivalDate: trip?.arrivalDate ?? null,
      tripJourneyType: trip?.journeyType ?? null,
      tripReturnDate: trip?.returnDate ?? null,
      tripReturnTime: trip?.returnTime ?? null,
      tripBookingMode: trip?.bookingMode ?? null,
      tripDescription: trip?.description ?? null,
      tripStatus: trip?.status ?? null,
      routeLabel:
        trip?.origin && trip?.destination
          ? `${trip.origin} → ${trip.destination}`
          : packageTitle && packageDestination
            ? `${packageTitle} · ${packageDestination}`
            : packageTitle || null,
      seats,
      passengerDetails: passengers.map((p) => ({
        name: String(p.name ?? ''),
        phone: p.phone ? String(p.phone) : undefined,
        age: p.age != null ? Number(p.age) : undefined,
        gender: p.gender ? String(p.gender) : undefined,
      })),
      pickupPointId: pickupId || null,
      pickupName: pickupLabel || null,
      pickupAddress: pickup?.address ?? null,
      dropoffPointId: dropoffId || null,
      dropoffName: dropoffLabel || null,
      dropoffAddress: dropoff?.address ?? null,
      vehicleId: vehicle ? String(vehicle._id) : transport.vehicleId ? String(transport.vehicleId) : null,
      vehicleName: vehicle?.name ?? null,
      vehicleType: vehicle?.type ?? null,
      vehicleBrand: vehicle?.brand ?? null,
      vehicleModel: vehicle?.vehicleModel ?? null,
      vehiclePlate: vehicle?.registrationNumber ?? null,
      vehicleSeatCount: vehicle?.seatCount ?? null,
      passengerCount: Math.max(
        seats.length,
        passengers.length,
        pkg.travelers != null ? Number(pkg.travelers) : 0,
        1
      ),
      // Hotel enrichment
      hotelId: hotel.hotelId ? String(hotel.hotelId) : null,
      hotelName: hotelDoc?.name ?? null,
      hotelCity: hotelDoc?.city ?? null,
      roomId: hotel.roomId ? String(hotel.roomId) : null,
      roomName: roomDoc?.name ?? (hotel.roomName ? String(hotel.roomName) : null),
      roomType: roomDoc?.roomType ?? null,
      checkIn: hotel.checkIn ? String(hotel.checkIn) : null,
      checkOut: hotel.checkOut ? String(hotel.checkOut) : null,
      roomsCount: hotel.rooms != null ? Number(hotel.rooms) : null,
      guestsCount: hotel.guests != null ? Number(hotel.guests) : null,
      nights: hotel.nights != null ? Number(hotel.nights) : null,
      /** booked → checked_in → checked_out (hotel stays). */
      stayStatus: hotel.stayStatus ? String(hotel.stayStatus) : null,
      guestDetails: hotel.guestDetails ?? pkg.guestDetails ?? null,
      specialRequests:
        (hotel.guestDetails && typeof hotel.guestDetails === 'object'
          ? String((hotel.guestDetails as Record<string, unknown>).specialRequests ?? '')
          : '') ||
        (pkg.guestDetails && typeof pkg.guestDetails === 'object'
          ? String((pkg.guestDetails as Record<string, unknown>).specialRequests ?? '')
          : '') ||
        null,
      notes: trip?.description ? String(trip.description) : null,
      // Package / tour enrichment
      packageBooking: Object.keys(pkg).length ? pkg : doc.packageBooking ?? null,
      guideBooking: doc.guideBooking ?? null,
      itineraryId: pkg.itineraryId ? String(pkg.itineraryId) : null,
      packageTitle,
      packageTourType: (pkg.tourType ? String(pkg.tourType) : '') || itineraryDoc?.tourType || null,
      packageDestination,
      packageStartDate: pkg.startDate ? String(pkg.startDate) : null,
      packageTravelers: pkg.travelers != null ? Number(pkg.travelers) : null,
      packageDurationDays:
        pkg.durationDays != null
          ? Number(pkg.durationDays)
          : itineraryDoc?.durationDays ?? null,
      packagePricePerPerson:
        pkg.pricePerPerson != null
          ? Number(pkg.pricePerPerson)
          : itineraryDoc?.pricePerPerson ?? null,
      packageCoverImage: itineraryDoc?.coverImage ?? null,
    };
  });
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
  const { page, limit, skip } = getPagination(query, 50);
  const filter = { providerId };
  const [items, total] = await Promise.all([
    Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Booking.countDocuments(filter),
  ]);
  const enriched = await enrichBookings(items);
  return paginatedResult(enriched, total, page, limit);
}

/**
 * Nudge providers about bookings still awaiting approval.
 * One reminder per booking (tracked via providerReminderSentAt).
 */
export async function sendPendingBookingReminders(olderThanMinutes = env.PENDING_BOOKING_REMINDER_MINUTES) {
  const cutoff = new Date(Date.now() - Math.max(1, olderThanMinutes) * 60 * 1000);
  const pending = await Booking.find({
    bookingStatus: 'pending',
    createdAt: { $lte: cutoff },
    $or: [{ providerReminderSentAt: { $exists: false } }, { providerReminderSentAt: null }],
  })
    .sort({ createdAt: 1 })
    .limit(50);

  let reminded = 0;

  for (const booking of pending) {
    const provider = await ProviderProfile.findById(booking.providerId).select('userId').lean();
    if (!provider?.userId) {
      // Mark anyway so we don't retry forever on orphan profiles.
      booking.providerReminderSentAt = new Date();
      await booking.save();
      continue;
    }

    const bookingId = booking._id.toString();
    try {
      await notificationService.notifyUser({
        userId: provider.userId.toString(),
        type: 'bookingReminder',
        title: 'Booking still waiting',
        message: `Booking ${booking.bookingNumber} is still pending your approval.`,
        data: { bookingId },
      });

      booking.providerReminderSentAt = new Date();
      await booking.save();
      reminded += 1;
    } catch (err) {
      log().error({ bookingId, err }, '[booking] pending reminder notification failed');
    }
  }

  return { scanned: pending.length, reminded };
}

export async function cancelBooking(
  id: string,
  requester: { id: string; role: string; providerId?: string },
  options?: { replaced?: boolean; silent?: boolean }
) {
  await getBooking(id, requester); // Authorization before beginning a transaction.
  const booking = await paymentTransaction(async session => {
    const current = assertFound(await Booking.findById(id).session(session), 'Booking not found');
    if (['cancelled', 'expired'].includes(current.bookingStatus)) return current;
    if (current.bookingStatus === 'completed') throw new AppError('Completed bookings cannot be cancelled', 400);
    current.bookingStatus = 'cancelled';
    if (current.paymentId) {
      const payment = await paymentService.refundPaymentAsSystem(current.paymentId.toString(), session);
      current.paymentStatus = payment.status;
    }
    if (current.bookingType === 'transport' && current.transportBooking) {
      await releaseTripSeats(current.transportBooking.tripId, current.transportBooking.seats, session);
    }
    if (current.bookingType === 'hotel' && current.hotelBooking) {
      const h = current.hotelBooking;
      await hotelService.releaseRoomsForRange(h.roomId, h.checkIn, h.checkOut, h.rooms, session);
    }
    await current.save({ session });
    return current;
  });

  // Seat-hold replacement: no cancel push — a new booking notification follows.
  if (options?.silent || options?.replaced) {
    return booking;
  }

  const bookingId = booking._id.toString();
  const number = booking.bookingNumber;
  const byProvider = requester.role === 'provider';
  const byCustomer = requester.role === 'customer';

  const customerTitle = byProvider ? 'Booking cancelled by provider' : 'Booking cancelled';
  const customerMessage = byProvider
    ? `Your booking ${number} was cancelled by the service provider.`
    : byCustomer
      ? `You cancelled booking ${number}.`
      : `Booking ${number} was cancelled.`;

  await notificationService
    .createNotification({
      userId: booking.customerId.toString(),
      type: 'bookingCancelled',
      title: customerTitle,
      message: customerMessage,
      data: { bookingId },
    })
    .catch((err) => {
      log().error({ bookingId, err }, '[booking] cancel customer notification failed');
    });

  // Keep the provider in the loop when the customer cancels.
  if (byCustomer) {
    const provider = await ProviderProfile.findById(booking.providerId)
      .select('userId')
      .lean();
    if (provider?.userId) {
      await notificationService
        .createNotification({
          userId: provider.userId.toString(),
          type: 'bookingCancelled',
          title: 'Booking cancelled by customer',
          message: `Customer cancelled booking ${number}.`,
          data: { bookingId },
        })
        .catch((err) => {
          log().error({ bookingId, err }, '[booking] cancel provider notification failed');
        });
    }
  }

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
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const profile = await ProviderProfile.findById(providerId).select('services').lean();
  const serviceKey = Array.isArray(profile?.services) ? profile?.services[0] : undefined;
  const platformFeePercent = await serviceCatalogService.getFeePercentForServiceKey(serviceKey);
  const feeRate = Math.min(1, Math.max(0, platformFeePercent / 100));

  // Aggregated in the database rather than loading every booking into memory.
  const [row] = await Booking.aggregate([
    {
      $match: {
        providerId: new mongoose.Types.ObjectId(providerId),
        bookingStatus: { $in: ['confirmed', 'completed'] },
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        today: { $sum: { $cond: [{ $gte: ['$createdAt', startOfDay] }, '$totalAmount', 0] } },
        thisWeek: { $sum: { $cond: [{ $gte: ['$createdAt', startOfWeek] }, '$totalAmount', 0] } },
        thisMonth: { $sum: { $cond: [{ $gte: ['$createdAt', startOfMonth] }, '$totalAmount', 0] } },
      },
    },
  ]);

  const totalRevenue = row?.totalRevenue ?? 0;
  const today = row?.today ?? 0;
  const thisWeek = row?.thisWeek ?? 0;
  const thisMonth = row?.thisMonth ?? 0;
  const platformFees = Math.round(totalRevenue * feeRate);
  const pendingPayout = Math.round(thisMonth * (1 - feeRate));

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
    platformFeePercent,
    platformFeeRate: feeRate,
    serviceKey: serviceKey ? String(serviceKey) : null,
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
    return serializeBooking(await cancelBooking(bookingId, { id: '', role: 'provider', providerId }));
  }

  if (status === 'cancelled') {
    const cancelled = await cancelBooking(
      bookingId,
      { id: '', role: 'provider', providerId }
    );
    return serializeBooking(cancelled);
  }

  if (status === 'confirmed') {
    let changed = false;
    const confirmed = await paymentTransaction(async session => {
      changed = false;
      const current = assertFound(await Booking.findById(bookingId).session(session), 'Booking not found');
      if (current.bookingStatus === 'confirmed') return current;
      if (!['pending', 'payment_verification'].includes(current.bookingStatus)) {
        throw new AppError('This booking can no longer be confirmed', 409);
      }
      if (current.paymentId) {
        const payment = assertFound(await Payment.findById(current.paymentId).session(session), 'Payment not found');
        if (isP2PMethod(payment.method) && !['confirmed', 'paid'].includes(payment.status)) {
          throw new AppError('Confirm receipt of the customer payment first.', 409);
        }
        if (['card', 'mobileWallet'].includes(payment.method)) throw new AppError('Gateway payments are unavailable', 409);
      }
      if (current.bookingType === 'transport' && current.transportBooking) {
        await confirmTripSeats(current.transportBooking.tripId, current.transportBooking.seats, session);
      }
      current.bookingStatus = 'confirmed';
      current.ticketQr = current.ticketQr || buildTicketQrDataUrl(current.bookingNumber);
      await current.save({ session });
      changed = true;
      return current;
    });

    // Tell the traveller (only on the actual change). Like every booking notification,
    // a failure here must never undo the confirmation.
    if (changed) {
      await notificationService
        .createNotification({
          userId: confirmed.customerId.toString(),
          type: 'bookingConfirmed',
          title: 'Booking confirmed',
          message: `Your booking ${confirmed.bookingNumber} was approved by the provider.`,
          data: { bookingId },
        })
        .catch((err) => {
          log().error({ bookingId, err }, '[booking] confirm customer notification failed');
        });
    }
    return serializeBooking(confirmed);
  }

  if (status === 'completed') {
    if (booking.bookingStatus !== 'confirmed') {
      throw new AppError('Only confirmed bookings can be completed', 400);
    }
    booking.bookingStatus = 'completed';
    await booking.save();
    await notificationService
      .createNotification({
        userId: booking.customerId.toString(),
        type: 'bookingCompleted',
        title: 'Trip completed',
        message: `Thanks for travelling with BANJARA. How was booking ${booking.bookingNumber}? Leave a review.`,
        data: { bookingId },
      })
      .catch((err) => {
        log().error({ bookingId, err }, '[booking] complete customer notification failed');
      });
    return serializeBooking(booking);
  }

  throw new AppError('Invalid booking status', 400);
}

/**
 * The driver records that a cash booking was paid in person. Only for cash: online
 * methods are confirmed through their own payment flow, never by hand.
 */
export async function markCashReceived(bookingId: string, providerId: string, actorUserId: string) {
  const result = await paymentTransaction(async (session) => {
    const booking = assertFound(await Booking.findById(bookingId).session(session), 'Booking not found');
    if (booking.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
    if (!['confirmed', 'completed'].includes(booking.bookingStatus)) {
      throw new AppError('Approve the booking before recording payment', 409);
    }
    if (booking.paymentStatus === 'paid') return { booking, changed: false };

    const payment = booking.paymentId ? await Payment.findById(booking.paymentId).session(session) : null;
    if (!payment) throw new AppError('This booking has no payment record', 409);
    // Cash (rides) and pay-at-hotel (stays) are both paid in person.
    if (payment.method !== 'cash' && payment.method !== 'payAtHotel') {
      throw new AppError('Only cash or pay-at-hotel payments can be marked as received by hand', 409);
    }

    const now = new Date();
    payment.status = 'paid';
    payment.paidAt = now;
    payment.confirmedAt = now;
    payment.confirmedBy = actorUserId as never;
    await payment.save({ session });
    booking.paymentStatus = 'paid';
    await booking.save({ session });
    return { booking, changed: true };
  });

  if (result.changed) {
    await notificationService
      .createNotification({
        userId: result.booking.customerId.toString(),
        type: 'paymentConfirmed',
        title: 'Payment received',
        message: `Your ${result.booking.bookingType === "hotel" ? "host" : "driver"} recorded your payment for booking ${result.booking.bookingNumber}.`,
        data: { bookingId },
      })
      .catch((err) => {
        log().error({ bookingId, err }, '[booking] cash received notification failed');
      });
  }
  return serializeBooking(result.booking);
}
