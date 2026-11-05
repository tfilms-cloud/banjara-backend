import mongoose from 'mongoose';
import {
  TourItinerary,
  type TourDifficulty,
  type TourType,
  type ITourItinerary,
} from '../models/TourItinerary';
import { ProviderProfile } from '../models/ProviderProfile';
import { AppError, assertFound } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeDays(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        dayNumber: Number(row.dayNumber ?? index + 1),
        title: String(row.title ?? `Day ${index + 1}`).trim(),
        description: String(row.description ?? '').trim(),
      };
    })
    .filter((day) => day.title);
}

function asTourType(value: unknown): TourType {
  const v = String(value ?? 'trek');
  if (v === 'expedition' || v === 'summit' || v === 'trek') return v;
  return 'trek';
}

function asDifficulty(value: unknown): TourDifficulty | undefined {
  const v = String(value ?? '');
  if (v === 'easy' || v === 'moderate' || v === 'hard') return v;
  return undefined;
}

function toPublic(doc: unknown) {
  const data = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown> & {
    _id?: unknown;
    providerId?: unknown;
    toObject?: () => Record<string, unknown>;
  };
  const plain = typeof data.toObject === 'function' ? data.toObject() : { ...data };
  const provider = plain.providerId;
  return {
    ...plain,
    id: String(plain._id ?? plain.id ?? ''),
    providerId:
      provider && typeof provider === 'object' && provider !== null && '_id' in provider
        ? String((provider as { _id: unknown })._id)
        : String(provider ?? ''),
  };
}

export async function createItinerary(providerId: string, input: Record<string, unknown>) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  if (!(profile.services ?? []).includes('tour')) {
    throw new AppError('Only tour operators can create itineraries', 403);
  }

  const submitForReview = Boolean(input.submitForReview);
  const created = await TourItinerary.create({
    providerId,
    title: String(input.title ?? '').trim(),
    tourType: asTourType(input.tourType),
    summary: String(input.summary ?? '').trim(),
    description: String(input.description ?? '').trim(),
    destination: String(input.destination ?? '').trim(),
    region: input.region ? String(input.region).trim() : undefined,
    durationDays: Number(input.durationDays ?? 1),
    durationNights:
      input.durationNights != null && input.durationNights !== ''
        ? Number(input.durationNights)
        : undefined,
    difficulty: asDifficulty(input.difficulty),
    maxParticipants: Number(input.maxParticipants ?? 1),
    pricePerPerson: Number(input.pricePerPerson ?? 0),
    currency: String(input.currency ?? 'PKR'),
    included: stringList(input.included),
    excluded: stringList(input.excluded),
    days: normalizeDays(input.days),
    coverImage: String(input.coverImage ?? '').trim(),
    images: stringList(input.images),
    departureLocation: input.departureLocation
      ? String(input.departureLocation).trim()
      : undefined,
    bestSeason: input.bestSeason ? String(input.bestSeason).trim() : undefined,
    status: submitForReview ? 'pending' : 'draft',
    featured: false,
  });

  return toPublic(created.toObject());
}

export async function updateItinerary(
  providerId: string,
  id: string,
  input: Record<string, unknown>
) {
  const item = assertFound(await TourItinerary.findById(id), 'Itinerary not found');
  if (item.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);

  if (input.title !== undefined) item.title = String(input.title).trim();
  if (input.tourType !== undefined) item.tourType = asTourType(input.tourType);
  if (input.summary !== undefined) item.summary = String(input.summary).trim();
  if (input.description !== undefined) item.description = String(input.description).trim();
  if (input.destination !== undefined) item.destination = String(input.destination).trim();
  if (input.region !== undefined) item.region = String(input.region).trim();
  if (input.durationDays !== undefined) item.durationDays = Number(input.durationDays);
  if (input.durationNights !== undefined) {
    item.durationNights =
      input.durationNights === '' || input.durationNights == null
        ? undefined
        : Number(input.durationNights);
  }
  if (input.difficulty !== undefined) item.difficulty = asDifficulty(input.difficulty);
  if (input.maxParticipants !== undefined) item.maxParticipants = Number(input.maxParticipants);
  if (input.pricePerPerson !== undefined) item.pricePerPerson = Number(input.pricePerPerson);
  if (input.currency !== undefined) item.currency = String(input.currency);
  if (input.coverImage !== undefined) item.coverImage = String(input.coverImage).trim();
  if (input.departureLocation !== undefined) {
    item.departureLocation = String(input.departureLocation).trim();
  }
  if (input.bestSeason !== undefined) item.bestSeason = String(input.bestSeason).trim();
  if (input.included !== undefined) item.included = stringList(input.included);
  if (input.excluded !== undefined) item.excluded = stringList(input.excluded);
  if (input.images !== undefined) item.images = stringList(input.images);
  if (input.days !== undefined) item.days = normalizeDays(input.days);

  if (input.submitForReview === true) {
    item.status = 'pending';
    item.rejectionReason = undefined;
  } else if (item.status === 'rejected') {
    item.status = 'draft';
  }

  await item.save();
  return toPublic(item.toObject());
}

export async function listProviderItineraries(providerId: string, query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query, 40);
  const filter: Record<string, unknown> = { providerId };
  if (query.tourType) filter.tourType = asTourType(query.tourType);
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    TourItinerary.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    TourItinerary.countDocuments(filter),
  ]);

  return paginatedResult(items.map((item) => toPublic(item)), total, page, limit);
}

export async function getItinerary(
  id: string,
  opts?: { publicOnly?: boolean; providerId?: string; admin?: boolean }
) {
  const item = assertFound(
    await TourItinerary.findById(id)
      .populate(
        'providerId',
        'businessName logo rating totalReviews yearsExperience city verificationStatus description'
      )
      .lean(),
    'Itinerary not found'
  );

  const ownerId =
    item.providerId && typeof item.providerId === 'object' && '_id' in (item.providerId as object)
      ? String((item.providerId as { _id: unknown })._id)
      : String(item.providerId ?? '');

  if (opts?.admin || (opts?.providerId && opts.providerId === ownerId)) {
    return toPublic(item);
  }
  if (item.status !== 'published') {
    throw new AppError('Itinerary not found', 404);
  }
  return toPublic(item);
}

export async function deleteItinerary(providerId: string, id: string) {
  const item = assertFound(await TourItinerary.findById(id), 'Itinerary not found');
  if (item.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  if (item.status === 'published') {
    item.status = 'draft';
    item.featured = false;
    item.publishedAt = undefined;
    await item.save();
    return toPublic(item.toObject());
  }
  await item.deleteOne();
  return { id, deleted: true };
}

export async function listPublishedItineraries(query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query, 40);
  const filter: Record<string, unknown> = { status: 'published' };
  if (query.tourType) filter.tourType = asTourType(query.tourType);
  if (query.featured === 'true') filter.featured = true;
  if (query.providerId && mongoose.isValidObjectId(String(query.providerId))) {
    filter.providerId = query.providerId;
  }

  let sort: Record<string, 1 | -1> = { featured: -1, publishedAt: -1, createdAt: -1 };
  if (query.sort === 'newest') sort = { publishedAt: -1, createdAt: -1 };
  if (query.sort === 'popular') sort = { pricePerPerson: 1, publishedAt: -1 };

  const [items, total] = await Promise.all([
    TourItinerary.find(filter)
      .populate(
        'providerId',
        'businessName logo rating totalReviews yearsExperience city verificationStatus'
      )
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    TourItinerary.countDocuments(filter),
  ]);

  return paginatedResult(items.map((item) => toPublic(item)), total, page, limit);
}

export async function getTourTypeCatalog(tourType: string) {
  const type = asTourType(tourType);
  const base = { status: 'published' as const, tourType: type };

  const [featured, popular, newest] = await Promise.all([
    TourItinerary.find({ ...base, featured: true })
      .populate('providerId', 'businessName logo rating')
      .sort({ publishedAt: -1 })
      .limit(12)
      .lean(),
    TourItinerary.find(base)
      .populate('providerId', 'businessName logo rating')
      .sort({ pricePerPerson: 1, publishedAt: -1 })
      .limit(12)
      .lean(),
    TourItinerary.find(base)
      .populate('providerId', 'businessName logo rating')
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(12)
      .lean(),
  ]);

  const featuredRows =
    featured.length > 0
      ? featured
      : await TourItinerary.find(base)
          .populate('providerId', 'businessName logo rating')
          .sort({ publishedAt: -1 })
          .limit(12)
          .lean();

  return {
    tourType: type,
    featured: featuredRows.map((item) => toPublic(item)),
    popular: popular.map((item) => toPublic(item)),
    newest: newest.map((item) => toPublic(item)),
  };
}

export async function getBestTourOperators(limit = 12) {
  const published = await TourItinerary.aggregate([
    { $match: { status: 'published' } },
    {
      $group: {
        _id: '$providerId',
        itineraryCount: { $sum: 1 },
        featuredCount: { $sum: { $cond: ['$featured', 1, 0] } },
      },
    },
  ]);

  const providerIds = published.map((row) => row._id);
  if (!providerIds.length) return [];

  const profiles = await ProviderProfile.find({
    _id: { $in: providerIds },
    services: 'tour',
    verificationStatus: { $in: ['approved', 'pending'] },
  })
    .select(
      'businessName logo rating totalReviews yearsExperience city verificationStatus description'
    )
    .lean();

  const countMap = new Map(
    published.map((row) => [
      String(row._id),
      {
        itineraryCount: row.itineraryCount as number,
        featuredCount: row.featuredCount as number,
      },
    ])
  );

  return profiles
    .map((profile) => {
      const stats = countMap.get(String(profile._id)) ?? {
        itineraryCount: 0,
        featuredCount: 0,
      };
      const rating = Number(profile.rating ?? 0);
      const years = Number(profile.yearsExperience ?? 0);
      const score =
        rating * 2 + years * 0.5 + stats.itineraryCount * 1 + stats.featuredCount * 0.5;
      return {
        id: String(profile._id),
        businessName: profile.businessName,
        logo: profile.logo ?? null,
        rating,
        reviewCount: Number(profile.totalReviews ?? 0),
        yearsExperience: years,
        city: profile.city ?? null,
        verified: profile.verificationStatus === 'approved',
        description: profile.description ?? '',
        itineraryCount: stats.itineraryCount,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 40));
}

export async function listAdminItineraries(query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query, 40);
  const filter: Record<string, unknown> = {};
  if (query.tourType) filter.tourType = asTourType(query.tourType);
  if (query.status) filter.status = query.status;
  if (query.providerId && mongoose.isValidObjectId(String(query.providerId))) {
    filter.providerId = query.providerId;
  }
  if (query.featured === 'true') filter.featured = true;
  if (query.featured === 'false') filter.featured = false;

  const [items, total] = await Promise.all([
    TourItinerary.find(filter)
      .populate('providerId', 'businessName city verificationStatus')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    TourItinerary.countDocuments(filter),
  ]);

  return paginatedResult(items.map((item) => toPublic(item)), total, page, limit);
}

export async function moderateItinerary(
  id: string,
  action: 'approve' | 'reject' | 'feature' | 'unfeature' | 'unpublish',
  reason?: string
) {
  const item = assertFound(await TourItinerary.findById(id), 'Itinerary not found');

  if (action === 'approve') {
    item.status = 'published';
    item.publishedAt = item.publishedAt ?? new Date();
    item.rejectionReason = undefined;
  } else if (action === 'reject') {
    if (!reason?.trim()) throw new AppError('Rejection reason is required', 400);
    item.status = 'rejected';
    item.featured = false;
    item.rejectionReason = reason.trim();
  } else if (action === 'feature') {
    if (item.status !== 'published') {
      throw new AppError('Only published itineraries can be featured', 400);
    }
    item.featured = true;
  } else if (action === 'unfeature') {
    item.featured = false;
  } else if (action === 'unpublish') {
    item.status = 'draft';
    item.featured = false;
  }

  await item.save();
  return toPublic(item.toObject());
}

export type { ITourItinerary };
