import { ProviderProfile, type IStructuredAddress } from '../models/ProviderProfile';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Room } from '../models/Room';
import { Vehicle } from '../models/Vehicle';
import { AppError, assertFound } from '../utils/AppError';
import type { ProviderService, ProviderType, VerificationStatus } from '../types/provider.types';
import * as bookingService from './booking.service';
import { publicGuideDetails } from './guide.service';

function uniqueUrls(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const next = String(value ?? '').trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
  }
  return result;
}

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
    structuredAddress?: IStructuredAddress;
    latitude?: number;
    longitude?: number;
    yearsExperience?: number;
    transportDetails?: Record<string, unknown>;
    hotelDetails?: Record<string, unknown>;
    tourDetails?: Record<string, unknown>;
    restaurantDetails?: Record<string, unknown>;
    guideDetails?: Record<string, unknown>;
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
      ...input.structuredAddress,
      city: input.city,
      formattedAddress: input.address,
      country: 'Pakistan',
    },
    yearsExperience: input.yearsExperience,
    verificationStatus: 'pending',
    transportDetails: input.transportDetails,
    hotelDetails: input.hotelDetails,
    tourDetails: input.tourDetails,
    restaurantDetails: input.restaurantDetails,
    guideDetails: input.guideDetails,
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
    restaurantDetails,
    guideDetails,
    structuredAddress,
    ...rest
  } = patch;

  if (hotelDetails && typeof hotelDetails === 'object') {
    profile.set('hotelDetails', hotelDetails);
    profile.markModified('hotelDetails');
  }
  if (transportDetails && typeof transportDetails === 'object') {
    profile.set('transportDetails', transportDetails);
    profile.markModified('transportDetails');
  }
  if (tourDetails && typeof tourDetails === 'object') {
    profile.set('tourDetails', tourDetails);
    profile.markModified('tourDetails');
  }
  if (restaurantDetails && typeof restaurantDetails === 'object') {
    profile.set('restaurantDetails', restaurantDetails);
    profile.markModified('restaurantDetails');
  }
  if (guideDetails && typeof guideDetails === 'object') {
    profile.set('guideDetails', guideDetails);
    profile.markModified('guideDetails');
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
  if (structuredAddress || typeof rest.address === 'string' || typeof rest.city === 'string') {
    profile.structuredAddress = {
      ...(structuredAddress as IStructuredAddress | undefined),
      city: profile.city,
      formattedAddress: profile.address,
      country: (structuredAddress as IStructuredAddress | undefined)?.country || 'Pakistan',
    };
  }

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

/** Public catalog for travelers — restaurants, guides, tours by service + city. */
export async function searchProviderCatalog(query: {
  service?: string;
  city?: string;
  limit?: number;
}) {
  const service = String(query.service || '').trim();
  const city = String(query.city || '').trim();
  const limit = Math.min(Math.max(Number(query.limit) || 40, 1), 100);

  const filter: Record<string, unknown> = {
    verificationStatus: { $in: ['approved', 'pending'] },
  };
  if (service) filter.services = service;
  if (city) {
    filter.$or = [
      { city: new RegExp(city, 'i') },
      { 'restaurantDetails.city': new RegExp(city, 'i') },
      { 'tourDetails.destination': new RegExp(city, 'i') },
      { address: new RegExp(city, 'i') },
    ];
  }

  return ProviderProfile.find(filter).sort({ rating: -1, createdAt: -1 }).limit(limit);
}

/** Traveler-facing provider card — omit identity docs and private contact fields. */
export async function getPublicProviderById(id: string) {
  const profile = assertFound(await ProviderProfile.findById(id).lean(), 'Provider not found');
  const vehicles = await Vehicle.find({
    providerId: id,
    status: { $nin: ['rejected', 'suspended'] },
  })
    .select('name type images seatCount brand vehicleModel registrationNumber')
    .lean();

  const transport = profile.transportDetails
    ? {
        businessName: profile.transportDetails.businessName,
        vehicleTypes: profile.transportDetails.vehicleTypes,
        vehicleCount: profile.transportDetails.vehicleCount,
        ownershipType: profile.transportDetails.ownershipType,
        operatingCities: profile.transportDetails.operatingCities,
        operatingRoutes: profile.transportDetails.operatingRoutes,
        pickupLocations: profile.transportDetails.pickupLocations,
        dropoffLocations: profile.transportDetails.dropoffLocations,
        description: profile.transportDetails.description,
        pricingMethod: profile.transportDetails.pricingMethod,
        priceAmount: profile.transportDetails.priceAmount,
        pricePercent: profile.transportDetails.pricePercent,
        vehicleClass: profile.transportDetails.vehicleClass,
        ownerName: profile.transportDetails.ownerName,
        vehicleModel: profile.transportDetails.vehicleModel,
        vehicleMakeYear: profile.transportDetails.vehicleMakeYear,
        registrationNumber: profile.transportDetails.registrationNumber,
        driverName: profile.transportDetails.driverName,
        hasInsurance: profile.transportDetails.hasInsurance,
        insuranceCompany: profile.transportDetails.insuranceCompany,
        driverExperienceYears: profile.transportDetails.driverExperienceYears,
        vehicleImageFront: profile.transportDetails.vehicleImageFront,
        vehicleImageBack: profile.transportDetails.vehicleImageBack,
        driverPhoto: profile.transportDetails.driverPhoto,
      }
    : undefined;

  const hotel = profile.hotelDetails as Record<string, unknown> | undefined;
  const tour = profile.tourDetails as Record<string, unknown> | undefined;
  const restaurant = profile.restaurantDetails as Record<string, unknown> | undefined;
  const guideRaw = profile.guideDetails as Record<string, unknown> | undefined;
  const guide = publicGuideDetails(guideRaw as never);

  const galleryImages = uniqueUrls([
    profile.logo,
    guide?.profilePhoto as string | undefined,
    ...((guide?.photos as Array<{ url?: string }> | undefined)?.map((p) => p.url) ?? []),
    transport?.vehicleImageFront,
    transport?.vehicleImageBack,
    ...vehicles.flatMap((v) => (Array.isArray(v.images) ? v.images : [])),
    ...((hotel?.outlookImages as string[]) ?? []),
    ...((hotel?.roomImages as string[]) ?? []),
    ...((hotel?.restaurantImages as string[]) ?? []),
    ...((hotel?.images as string[]) ?? []),
    ...((tour?.images as string[]) ?? []),
    ...((restaurant?.images as string[]) ?? []),
  ]);

  return {
    ...profile,
    transportDetails: transport,
    guideDetails: guide,
    galleryImages,
    fleetVehicles: vehicles.map((v) => ({
      id: String(v._id),
      name: v.name,
      type: v.type,
      images: Array.isArray(v.images) ? v.images : [],
      registrationNumber: v.registrationNumber,
    })),
    documents: undefined,
    cnicFront: undefined,
    cnicBack: undefined,
  };
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
