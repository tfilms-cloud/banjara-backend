import { ProviderProfile } from '../models/ProviderProfile';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Room } from '../models/Room';
import { AppError, assertFound } from '../utils/AppError';
import type { ProviderService, ProviderType, VerificationStatus } from '../types/provider.types';
import * as bookingService from './booking.service';

export async function registerProvider(
  userId: string,
  input: {
    businessName: string;
    ownerName: string;
    providerType: ProviderType[];
    services: ProviderService[];
    description?: string;
    phone: string;
    email: string;
    website?: string;
    socialMedia?: string;
    address: string;
    city: string;
    latitude?: number;
    longitude?: number;
    yearsExperience?: number;
    transportDetails?: Record<string, unknown>;
    hotelDetails?: Record<string, unknown>;
    tourDetails?: Record<string, unknown>;
  }
) {
  const existing = await ProviderProfile.findOne({ userId });
  if (existing) throw new AppError('Provider profile already exists', 409);
  if (!input.services?.length || input.services.length > 1) {
    throw new AppError('A provider can offer only one service', 400);
  }

  const profile = await ProviderProfile.create({
    userId,
    businessName: input.businessName,
    ownerName: input.ownerName,
    providerType: input.providerType.slice(0, 1),
    services: input.services.slice(0, 1),
    description: input.description ?? '',
    phone: input.phone,
    email: input.email.toLowerCase(),
    website: input.website,
    socialMedia: input.socialMedia,
    address: input.address,
    city: input.city,
    location: {
      type: 'Point',
      coordinates: [input.longitude ?? 0, input.latitude ?? 0],
    },
    locationUpdatedAt:
      input.latitude != null && input.longitude != null ? new Date() : undefined,
    structuredAddress: {
      city: input.city,
      formattedAddress: input.address,
      country: 'Pakistan',
    },
    yearsExperience: input.yearsExperience,
    verificationStatus: 'pending',
    transportDetails: input.transportDetails,
    hotelDetails: input.hotelDetails,
    tourDetails: input.tourDetails,
  });

  return profile;
}

export async function getMyProvider(userId: string) {
  return assertFound(await ProviderProfile.findOne({ userId }), 'Provider profile not found');
}

export async function getProviderStatus(userId: string) {
  const profile = await getMyProvider(userId);
  return {
    verificationStatus: profile.verificationStatus,
    businessName: profile.businessName,
    services: profile.services,
  };
}

export async function updateMyProvider(userId: string, patch: Record<string, unknown>) {
  const profile = assertFound(await ProviderProfile.findOne({ userId }), 'Provider profile not found');

  const {
    latitude,
    longitude,
    services,
    providerType,
    hotelDetails,
    transportDetails,
    tourDetails,
    ...rest
  } = patch;

  if (hotelDetails && typeof hotelDetails === 'object') {
    profile.set('hotelDetails', hotelDetails);
  }
  if (transportDetails && typeof transportDetails === 'object') {
    profile.set('transportDetails', transportDetails);
  }
  if (tourDetails && typeof tourDetails === 'object') {
    profile.set('tourDetails', tourDetails);
  }

  if (Array.isArray(services)) {
    if (services.length > 1) {
      throw new AppError('A provider can offer only one service', 400);
    }
    if (
      profile.verificationStatus === 'approved' &&
      profile.services[0] &&
      services[0] &&
      services[0] !== profile.services[0]
    ) {
      throw new AppError('You can edit this service, but you cannot switch to another service', 400);
    }
    profile.services = services.slice(0, 1) as typeof profile.services;
  }

  if (Array.isArray(providerType)) {
    profile.providerType = providerType.slice(0, 1) as typeof profile.providerType;
  }

  Object.assign(profile, rest);

  if (typeof latitude === 'number' && typeof longitude === 'number') {
    profile.location = {
      type: 'Point',
      coordinates: [longitude, latitude],
    };
    profile.locationUpdatedAt = new Date();
  }

  await profile.save();
  return profile;
}

export async function assertApprovedProvider(providerId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  if (profile.verificationStatus !== 'approved') {
    throw new AppError('Provider must be approved before managing services', 403);
  }
  return profile;
}

export async function assertTransportProvider(providerId: string) {
  const profile = await assertApprovedProvider(providerId);
  const canTrip = (profile.services ?? []).some((service) => service === 'transport');
  if (!canTrip) {
    throw new AppError('Only transport providers can organise trips', 403);
  }
  return profile;
}

export async function setVerificationStatus(providerId: string, status: VerificationStatus) {
  return assertFound(
    await ProviderProfile.findByIdAndUpdate(providerId, { verificationStatus: status }, { new: true }),
    'Provider not found'
  );
}

export async function listProviders(filter: { verificationStatus?: string } = {}) {
  return ProviderProfile.find(filter as Record<string, unknown>).sort({ createdAt: -1 });
}

export async function getProviderDashboard(providerId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  const today = new Date().toISOString().slice(0, 10);

  const [tripsToday, rooms, earnings, totalBookings, pendingBookings, completedBookings, hotelCheckIns] =
    await Promise.all([
      Trip.find({ providerId, departureDate: today, status: { $nin: ['cancelled'] } }),
      Room.find({ providerId, status: 'active' }),
      bookingService.getProviderEarnings(providerId),
      Booking.countDocuments({ providerId }),
      Booking.countDocuments({ providerId, bookingStatus: 'pending' }),
      Booking.countDocuments({ providerId, bookingStatus: 'completed' }),
      Booking.countDocuments({
        providerId,
        bookingType: 'hotel',
        'hotelBooking.checkIn': today,
        bookingStatus: { $in: ['confirmed', 'pending'] },
      }),
    ]);

  const availableSeats = tripsToday.reduce((sum, t) => sum + t.availableSeats, 0);
  const bookedSeats = tripsToday.reduce((sum, t) => sum + t.bookedSeats, 0);

  const availableRooms = rooms.reduce((sum, r) => sum + (r.availableRooms ?? 0), 0);
  const occupiedRooms = rooms.reduce(
    (sum, r) => sum + Math.max(0, (r.totalRooms ?? 0) - (r.availableRooms ?? 0)),
    0
  );

  return {
    provider: {
      id: profile._id.toString(),
      businessName: profile.businessName,
      verificationStatus: profile.verificationStatus,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      services: profile.services,
    },
    transport: {
      todaysTrips: tripsToday.length,
      availableSeats,
      bookedSeats,
      revenue: earnings.todayRevenue ?? earnings.today,
    },
    hotel: {
      checkIns: hotelCheckIns,
      availableRooms,
      occupiedRooms,
      revenue: earnings.todayRevenue ?? earnings.today,
    },
    general: {
      totalBookings,
      pendingBookings,
      completedBookings,
      rating: profile.rating,
      todaysRevenue: earnings.todayRevenue ?? earnings.today,
    },
    earnings,
  };
}
