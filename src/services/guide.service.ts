import { Types } from 'mongoose';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import type {
  GuideAvailability,
  GuideDetails,
  GuideOfferedService,
  Weekday,
} from '../types/guide.types';
import { DEFAULT_GUIDE_WEEKLY } from '../types/guide.types';
import { AppError, assertFound } from '../utils/AppError';
import { randomUUID } from 'crypto';

function asGuide(profile: { guideDetails?: GuideDetails | null; tourDetails?: Record<string, unknown> }) {
  const existing = (profile.guideDetails ?? {}) as GuideDetails;
  // Migrate legacy tourDetails guide fields when guideDetails is empty
  if (!existing.fullName && !existing.languages?.length && profile.tourDetails) {
    const t = profile.tourDetails;
    return {
      ...existing,
      fullName: String(t.companyName ?? existing.fullName ?? ''),
      gender: (t.gender as GuideDetails['gender']) ?? existing.gender,
      yearsExperience: Number(t.yearsExperience ?? existing.yearsExperience ?? 0) || undefined,
      shortBio: String(t.experienceHistory ?? t.description ?? existing.shortBio ?? ''),
      detailedDescription: String(t.experienceHistory ?? t.description ?? existing.detailedDescription ?? ''),
      areasCovered: Array.isArray(t.operatingAreas)
        ? (t.operatingAreas as string[])
        : existing.areasCovered,
      specialSkills: Array.isArray(t.specialties) ? (t.specialties as string[]) : existing.specialSkills,
      certifications: Array.isArray(t.certifications)
        ? (t.certifications as string[])
        : existing.certifications,
      languages: [
        ...((t.regionalLanguages as string[]) ?? []).map((language) => ({
          language,
          proficiency: 'native' as const,
        })),
        ...((t.internationalLanguages as string[]) ?? []).map((language) => ({
          language,
          proficiency: 'fluent' as const,
        })),
      ],
      dailyHireRate: Number(t.dailyHireRate ?? t.price ?? existing.dailyHireRate ?? 0) || undefined,
      photos: Array.isArray(t.images)
        ? (t.images as string[]).map((url, i) => ({
            id: `legacy-${i}`,
            url,
            category: 'other' as const,
          }))
        : existing.photos,
    } satisfies GuideDetails;
  }
  return existing;
}

function weekdayFromDate(isoDate: string): Weekday {
  const d = new Date(`${isoDate}T12:00:00`);
  const map: Weekday[] = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  return map[d.getDay()];
}

function timeToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Strip private verification docs from public payloads */
export function publicGuideDetails(guide: GuideDetails | undefined | null) {
  if (!guide) return undefined;
  const {
    cnicNumber: _c,
    cnicFrontUrl: _f,
    cnicBackUrl: _b,
    documents: _d,
    changesRequestedNote: _n,
    ...safe
  } = guide;
  return {
    ...safe,
    documents: undefined,
    cnicNumber: undefined,
    cnicFrontUrl: undefined,
    cnicBackUrl: undefined,
    // Only show verified badge signal via profileStatus when approved
    profileStatus: guide.profileStatus === 'approved' ? 'approved' : undefined,
  };
}

export async function getMyGuide(providerId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  if (!profile.services?.includes('travelGuide')) {
    throw new AppError('Not a guide provider', 400);
  }
  return {
    providerId: profile._id.toString(),
    verificationStatus: profile.verificationStatus,
    guideDetails: asGuide(profile as never),
    rating: profile.rating,
    totalReviews: profile.totalReviews,
    businessName: profile.businessName,
    ownerName: profile.ownerName,
    city: profile.city,
    logo: profile.logo,
  };
}

export async function upsertGuideDetails(providerId: string, patch: GuideDetails, submit = false) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  if (!profile.services?.includes('travelGuide')) {
    throw new AppError('Not a guide provider', 400);
  }
  const current = asGuide(profile as never);
  const next: GuideDetails = {
    ...current,
    ...patch,
    services: patch.services ?? current.services,
    availability: patch.availability ?? current.availability ?? {
      weekly: DEFAULT_GUIDE_WEEKLY,
      blockedDates: [],
    },
    languages: patch.languages ?? current.languages,
    documents: patch.documents ?? current.documents,
    photos: patch.photos ?? current.photos,
  };

  if (submit) {
    next.profileStatus = 'pending';
    // Keep provider verification pending until admin approves
    if (profile.verificationStatus === 'rejected') {
      profile.verificationStatus = 'pending';
      profile.rejectionReason = undefined;
    }
  } else if (!next.profileStatus) {
    next.profileStatus = 'draft';
  }

  if (next.fullName) {
    profile.businessName = next.fullName;
    profile.ownerName = next.fullName;
  }
  if (next.profilePhoto) profile.logo = next.profilePhoto;
  else if (patch.profilePhoto === '' && profile.logo === current.profilePhoto) profile.logo = '';
  if (next.phone) profile.phone = next.phone;
  if (next.email) profile.email = next.email;
  if (next.city) profile.city = next.city;
  if (next.shortBio || next.detailedDescription) {
    profile.description = next.shortBio || next.detailedDescription || profile.description;
  }
  if (next.yearsExperience != null) profile.yearsExperience = next.yearsExperience;

  profile.set('guideDetails', next);
  profile.markModified('guideDetails');
  await profile.save();
  return getMyGuide(providerId);
}

export async function addGuideService(providerId: string, service: Omit<GuideOfferedService, 'id'> & { id?: string }) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  const guide = asGuide(profile as never);
  const id = service.id || randomUUID();
  const nextService: GuideOfferedService = { ...service, id, active: service.active !== false };
  const services = [...(guide.services ?? []).filter((s) => s.id !== id), nextService];
  return upsertGuideDetails(providerId, { ...guide, services });
}

export async function removeGuideService(providerId: string, serviceId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  const guide = asGuide(profile as never);
  const services = (guide.services ?? []).filter((s) => s.id !== serviceId);
  return upsertGuideDetails(providerId, { ...guide, services });
}

export async function setGuideAvailability(providerId: string, availability: GuideAvailability) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  const guide = asGuide(profile as never);
  return upsertGuideDetails(providerId, { ...guide, availability });
}

export function assertGuideAvailable(
  guide: GuideDetails,
  date: string,
  startTime: string,
  endTime?: string
) {
  const availability = guide.availability;
  if (!availability) return;

  if (availability.blockedDates?.includes(date)) {
    throw new AppError('Guide is not available on this date', 400);
  }
  if (availability.availableFrom && date < availability.availableFrom) {
    throw new AppError('Guide is not available before the listed start date', 400);
  }
  if (availability.availableUntil && date > availability.availableUntil) {
    throw new AppError('Guide is not available after the listed end date', 400);
  }

  const day = weekdayFromDate(date);
  const slot = (availability.weekly ?? DEFAULT_GUIDE_WEEKLY).find((w) => w.day === day);
  if (!slot || !slot.enabled) {
    throw new AppError(`Guide is not available on ${day}`, 400);
  }

  const startMin = timeToMinutes(startTime);
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);
  if (startMin < slotStart || startMin >= slotEnd) {
    throw new AppError('Start time is outside guide availability', 400);
  }
  if (endTime) {
    const endMin = timeToMinutes(endTime);
    if (endMin <= startMin || endMin > slotEnd) {
      throw new AppError('End time is outside guide availability', 400);
    }
  }

  if (availability.advanceBookingHours != null) {
    const when = new Date(`${date}T${startTime}:00`);
    const hoursAhead = (when.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursAhead < availability.advanceBookingHours) {
      throw new AppError(
        `This guide requires at least ${availability.advanceBookingHours} hours advance booking`,
        400
      );
    }
  }
}

export async function assertNoGuideDoubleBooking(
  providerId: string,
  date: string,
  startTime: string,
  endTime?: string,
  excludeBookingId?: string
) {
  const filter: Record<string, unknown> = {
    providerId: new Types.ObjectId(providerId),
    bookingType: 'guide',
    bookingStatus: { $in: ['pending', 'confirmed'] },
    'guideBooking.date': date,
  };
  if (excludeBookingId) {
    filter._id = { $ne: new Types.ObjectId(excludeBookingId) };
  }
  const existing = await Booking.find(filter).lean();
  const startMin = timeToMinutes(startTime);
  const endMin = endTime ? timeToMinutes(endTime) : startMin + 60;
  for (const row of existing) {
    const gb = (row as { guideBooking?: { startTime?: string; endTime?: string } }).guideBooking;
    if (!gb?.startTime) continue;
    const otherStart = timeToMinutes(gb.startTime);
    const otherEnd = gb.endTime ? timeToMinutes(gb.endTime) : otherStart + 60;
    const overlaps = startMin < otherEnd && endMin > otherStart;
    if (overlaps) {
      throw new AppError('Guide already has a booking overlapping this time', 409);
    }
  }
}

export function calcGuidePrice(input: {
  pricingType: GuideOfferedService['pricingType'];
  unitPrice: number;
  guests: number;
  durationHours?: number;
}) {
  const { pricingType, unitPrice, guests, durationHours = 1 } = input;
  if (unitPrice < 0) throw new AppError('Invalid price', 400);
  switch (pricingType) {
    case 'per_person':
      return unitPrice * guests;
    case 'per_hour':
      return unitPrice * Math.max(1, durationHours);
    case 'per_day':
      return unitPrice * Math.max(1, Math.ceil(durationHours / 8));
    case 'per_group':
    case 'custom':
    default:
      return unitPrice;
  }
}

export async function prepareGuideBooking(input: {
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
}) {
  const profile = assertFound(
    await ProviderProfile.findById(input.providerId),
    'Guide not found'
  );
  if (!profile.services?.includes('travelGuide')) {
    throw new AppError('Provider is not a travel guide', 400);
  }
  if (profile.verificationStatus !== 'approved') {
    throw new AppError('This guide is not available for booking yet', 400);
  }

  const guide = asGuide(profile as never);
  if (guide.profileStatus && !['approved', undefined].includes(guide.profileStatus as never)) {
    // Allow booking when provider is approved even if profileStatus lagging
    if (guide.profileStatus !== 'approved' && profile.verificationStatus !== 'approved') {
      throw new AppError('This guide profile is not approved', 400);
    }
  }

  const service = input.serviceId
    ? (guide.services ?? []).find((s) => s.id === input.serviceId && s.active !== false)
    : (guide.services ?? []).find((s) => s.active !== false);

  const pricingType = service?.pricingType ?? 'per_day';
  const unitPrice = service?.price ?? guide.dailyHireRate ?? 0;
  if (!unitPrice || unitPrice <= 0) {
    throw new AppError('Guide has not set a hire rate', 400);
  }

  const guests = Number(input.guests) || 1;
  if (service) {
    if (guests < service.minGuests || guests > service.maxGuests) {
      throw new AppError(
        `Guests must be between ${service.minGuests} and ${service.maxGuests}`,
        400
      );
    }
  }

  assertGuideAvailable(guide, input.date, input.startTime, input.endTime);
  await assertNoGuideDoubleBooking(
    profile._id.toString(),
    input.date,
    input.startTime,
    input.endTime
  );

  const durationHours =
    input.durationHours ??
    service?.durationHours ??
    (input.endTime
      ? Math.max(1, (timeToMinutes(input.endTime) - timeToMinutes(input.startTime)) / 60)
      : 8);

  const subtotal = calcGuidePrice({
    pricingType,
    unitPrice,
    guests,
    durationHours,
  });

  return {
    providerId: profile._id.toString(),
    subtotal,
    guideBooking: {
      serviceId: service?.id,
      serviceName: service?.name ?? 'Guide hire',
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      durationHours,
      guests,
      meetingPoint: input.meetingPoint ?? service?.meetingPoint,
      availableLocation: input.availableLocation,
      specialRequest: input.specialRequest ?? input.guestDetails.specialRequests,
      pricingType,
      unitPrice,
      currency: service?.currency ?? 'PKR',
      guestDetails: input.guestDetails,
      serviceStatus: 'pending' as const,
    },
  };
}

export async function getPublicGuideAvailability(providerId: string) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Guide not found');
  if (profile.verificationStatus !== 'approved') {
    throw new AppError('Guide not available', 404);
  }
  const guide = asGuide(profile as never);
  return {
    weekly: guide.availability?.weekly ?? DEFAULT_GUIDE_WEEKLY,
    blockedDates: guide.availability?.blockedDates ?? [],
    availableFrom: guide.availability?.availableFrom,
    availableUntil: guide.availability?.availableUntil,
    minBookingHours: guide.availability?.minBookingHours,
    maxBookingHours: guide.availability?.maxBookingHours,
    advanceBookingHours: guide.availability?.advanceBookingHours,
  };
}

export async function searchGuides(query: {
  destination?: string;
  date?: string;
  guests?: number;
  guideType?: string;
  language?: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minExperience?: number;
}) {
  const filter: Record<string, unknown> = {
    services: 'travelGuide',
    verificationStatus: 'approved',
  };
  if (query.destination) {
    const re = new RegExp(query.destination.trim(), 'i');
    filter.$or = [
      { city: re },
      { 'guideDetails.city': re },
      { 'guideDetails.areasCovered': re },
      { 'guideDetails.currentLocation': re },
      { 'tourDetails.operatingAreas': re },
    ];
  }
  if (query.minRating != null) {
    filter.rating = { $gte: Number(query.minRating) };
  }
  if (query.minExperience != null) {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      {
        $or: [
          { yearsExperience: { $gte: Number(query.minExperience) } },
          { 'guideDetails.yearsExperience': { $gte: Number(query.minExperience) } },
        ],
      },
    ];
  }

  const rows = await ProviderProfile.find(filter).limit(100).lean();
  return rows
    .map((profile) => {
      const guide = publicGuideDetails(asGuide(profile as never));
      const services = (guide?.services ?? []).filter((s) => s.active !== false);
      const rate =
        services[0]?.price ??
        guide?.dailyHireRate ??
        Number((profile.tourDetails as { dailyHireRate?: number } | undefined)?.dailyHireRate ?? 0);
      return {
        id: String(profile._id),
        businessName: profile.businessName,
        ownerName: profile.ownerName,
        city: profile.city,
        logo: profile.logo || guide?.profilePhoto,
        rating: profile.rating,
        totalReviews: profile.totalReviews,
        yearsExperience: guide?.yearsExperience ?? profile.yearsExperience,
        guide,
        fromPrice: rate || undefined,
        services,
      };
    })
    .filter((row) => {
      if (query.guideType) {
        const t = query.guideType.toLowerCase();
        const types = row.guide?.guideTypes ?? [];
        const svcMatch = row.services.some((s) => s.category === t || s.category.includes(t as never));
        if (!types.includes(t as never) && !svcMatch) return false;
      }
      if (query.language) {
        const lang = query.language.toLowerCase();
        const langs = row.guide?.languages ?? [];
        if (!langs.some((l) => l.language.toLowerCase().includes(lang))) return false;
      }
      if (query.minPrice != null && (row.fromPrice ?? 0) < Number(query.minPrice)) return false;
      if (query.maxPrice != null && row.fromPrice != null && row.fromPrice > Number(query.maxPrice)) {
        return false;
      }
      if (query.guests != null) {
        const g = Number(query.guests);
        if (row.services.length && !row.services.some((s) => g >= s.minGuests && g <= s.maxGuests)) {
          return false;
        }
      }
      if (query.date && row.guide) {
        try {
          assertGuideAvailable(row.guide as GuideDetails, query.date, '10:00');
        } catch {
          return false;
        }
      }
      return true;
    });
}
