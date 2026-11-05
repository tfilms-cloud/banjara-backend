import mongoose from 'mongoose';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import { Review } from '../models/Review';
import { AppError, assertFound } from '../utils/AppError';
import * as notificationService from './notification.service';

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function resolveOverall(input: {
  rating?: number;
  paymentRating?: number;
  serviceRating?: number;
}) {
  if (input.paymentRating != null && input.serviceRating != null) {
    return round1((input.paymentRating + input.serviceRating) / 2);
  }
  if (input.rating != null) return input.rating;
  throw new AppError('Rating is required', 400);
}

function mapServiceType(bookingType: string): 'transport' | 'hotel' | 'tour' | 'guide' {
  if (bookingType === 'hotel') return 'hotel';
  if (bookingType === 'package') return 'tour';
  if (bookingType === 'guide') return 'guide';
  return 'transport';
}

function canReviewBooking(booking: InstanceType<typeof Booking>) {
  if (booking.bookingStatus === 'cancelled' || booking.bookingStatus === 'expired') {
    return false;
  }
  if (booking.bookingStatus === 'completed') return true;
  // After successful payment / confirmation — customer can rate payment + service so far.
  const paid = ['paid', 'confirmed'].includes(String(booking.paymentStatus));
  const confirmed = ['confirmed', 'pending', 'payment_verification'].includes(
    String(booking.bookingStatus)
  );
  return paid && confirmed;
}

async function recomputeProviderRating(providerId: mongoose.Types.ObjectId) {
  const stats = await Review.aggregate([
    { $match: { providerId } },
    {
      $group: {
        _id: '$providerId',
        avg: { $avg: '$rating' },
        avgPayment: { $avg: '$paymentRating' },
        avgService: { $avg: '$serviceRating' },
        count: { $sum: 1 },
      },
    },
  ]);
  const row = stats[0];
  await ProviderProfile.findByIdAndUpdate(providerId, {
    rating: row ? round1(row.avg) : 0,
    totalReviews: row ? row.count : 0,
  });
}

function serializeReview(doc: InstanceType<typeof Review>) {
  return {
    id: doc._id.toString(),
    _id: doc._id.toString(), // Preserve existing API clients alongside the public id.
    bookingId: doc.bookingId.toString(),
    customerId: doc.customerId.toString(),
    providerId: doc.providerId.toString(),
    serviceType: doc.serviceType,
    rating: doc.rating,
    paymentRating: doc.paymentRating ?? null,
    serviceRating: doc.serviceRating ?? null,
    comment: doc.comment ?? '',
    paymentComment: doc.paymentComment ?? '',
    serviceComment: doc.serviceComment ?? '',
    categories: doc.categories ?? {},
    providerReply: doc.providerReply ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createReview(
  customerId: string,
  input: {
    bookingId: string;
    rating?: number;
    paymentRating?: number;
    serviceRating?: number;
    comment?: string;
    paymentComment?: string;
    serviceComment?: string;
    categories?: Record<string, number>;
  }
) {
  const booking = assertFound(await Booking.findById(input.bookingId), 'Booking not found');
  if (booking.customerId.toString() !== customerId) throw new AppError('Forbidden', 403);
  if (!canReviewBooking(booking)) {
    throw new AppError(
      'You can rate after payment is confirmed or the booking is completed',
      400
    );
  }

  const existing = await Review.findOne({ bookingId: booking._id });
  if (existing) throw new AppError('You already rated this booking', 409);

  const paymentRating = input.paymentRating ?? input.categories?.payment;
  const serviceRating = input.serviceRating ?? input.categories?.service;
  const overall = resolveOverall({
    rating: input.rating,
    paymentRating,
    serviceRating,
  });

  const categories = {
    ...(input.categories ?? {}),
    ...(paymentRating != null ? { payment: paymentRating } : {}),
    ...(serviceRating != null ? { service: serviceRating } : {}),
  };

  const review = await Review.create({
    bookingId: booking._id,
    customerId,
    providerId: booking.providerId,
    serviceType: mapServiceType(booking.bookingType),
    rating: overall,
    paymentRating,
    serviceRating,
    comment: input.comment?.trim() ?? '',
    paymentComment: input.paymentComment?.trim() ?? '',
    serviceComment: input.serviceComment?.trim() ?? '',
    categories,
  });

  await recomputeProviderRating(booking.providerId);

  const provider = await ProviderProfile.findById(booking.providerId).select('userId');
  if (provider?.userId) {
    await notificationService.createNotification({
      userId: provider.userId.toString(),
      type: 'newReview',
      title: 'New customer rating',
      message: `You received ${overall}/5 (payment ${paymentRating ?? '—'} · service ${serviceRating ?? '—'})`,
      data: { reviewId: review._id.toString(), bookingId: booking._id.toString() },
    });
  }

  await notificationService.createNotification({
    userId: customerId,
    type: 'newReview',
    title: 'Thanks for your rating',
    message: 'Your feedback helps other travelers choose with confidence.',
    data: { reviewId: review._id.toString() },
  });

  return serializeReview(review);
}

export async function getReviewForBooking(customerId: string, bookingId: string) {
  const booking = assertFound(await Booking.findById(bookingId), 'Booking not found');
  if (booking.customerId.toString() !== customerId) throw new AppError('Forbidden', 403);
  const review = await Review.findOne({ bookingId: booking._id });
  return review ? serializeReview(review) : null;
}

export async function listProviderReviews(providerId: string) {
  const rows = await Review.find({ providerId }).sort({ createdAt: -1 });
  return rows.map(serializeReview);
}

export async function updateReview(
  customerId: string,
  id: string,
  patch: {
    rating?: number;
    paymentRating?: number;
    serviceRating?: number;
    comment?: string;
    paymentComment?: string;
    serviceComment?: string;
    categories?: Record<string, number>;
  }
) {
  const review = assertFound(await Review.findById(id), 'Review not found');
  if (review.customerId.toString() !== customerId) throw new AppError('Forbidden', 403);

  if (patch.paymentRating != null) review.paymentRating = patch.paymentRating;
  if (patch.serviceRating != null) review.serviceRating = patch.serviceRating;
  if (patch.comment != null) review.comment = patch.comment;
  if (patch.paymentComment != null) review.paymentComment = patch.paymentComment;
  if (patch.serviceComment != null) review.serviceComment = patch.serviceComment;
  if (patch.categories != null) review.categories = patch.categories;

  const paymentRating = review.paymentRating ?? patch.categories?.payment;
  const serviceRating = review.serviceRating ?? patch.categories?.service;
  if (paymentRating != null && serviceRating != null) {
    review.rating = resolveOverall({ paymentRating, serviceRating });
    review.categories = {
      ...(review.categories ?? {}),
      payment: paymentRating,
      service: serviceRating,
    };
  } else if (patch.rating != null) {
    review.rating = patch.rating;
  }

  await review.save();
  await recomputeProviderRating(review.providerId);
  return serializeReview(review);
}

export async function replyToReview(providerId: string, id: string, reply: string) {
  const review = assertFound(await Review.findById(id), 'Review not found');
  if (review.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  review.providerReply = reply;
  await review.save();
  return serializeReview(review);
}
